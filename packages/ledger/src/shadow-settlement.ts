import { add, formatDecimal, parseDecimal, sha256, sub } from "@anari/policy-dsl";

/**
 * Optional reconciliation dimensions. Only non-empty values participate in the
 * aggregation key, so legacy lines without any of these fields keep the
 * historical `personKey|currency` grouping (and therefore a stable reportHash).
 */
export const SHADOW_SETTLEMENT_DIMENSIONS = [
  "legalEntity",
  "accountingPeriod",
  "orderId",
  "contractRef",
  "payoutBatch",
  "incentiveType",
] as const;

export type ShadowSettlementDimension =
  (typeof SHADOW_SETTLEMENT_DIMENSIONS)[number];

export type ShadowSettlementDimensions = Partial<
  Record<ShadowSettlementDimension, string>
>;

export interface ShadowSettlementLine extends ShadowSettlementDimensions {
  /** Stable identity shared by the engine and the finance export. */
  personKey: string;
  amount: string;
  currency: string;
}

export type ShadowSettlementStatus =
  | "MATCH"
  | "VARIANCE"
  | "MISSING_IN_FINANCE"
  | "MISSING_IN_ENGINE";

export interface ShadowSettlementRow extends ShadowSettlementDimensions {
  personKey: string;
  currency: string;
  engine: string | null;
  finance: string | null;
  variance: string | null;
  status: ShadowSettlementStatus;
}

export interface ShadowSettlementReport {
  generatedAt: string;
  tolerance: string;
  rows: ShadowSettlementRow[];
  totals: {
    engine: string;
    finance: string;
    variance: string;
  };
  counts: {
    matched: number;
    variances: number;
    missingInFinance: number;
    missingInEngine: number;
  };
  withinTolerance: boolean;
  reportHash: string;
}

interface AggregatedLine {
  personKey: string;
  currency: string;
  amount: bigint;
  dimensions: ShadowSettlementDimensions;
}

function normalizeDimensionValue(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function dimensionsOf(
  line: ShadowSettlementLine,
): ShadowSettlementDimensions {
  const dimensions: ShadowSettlementDimensions = {};
  for (const field of SHADOW_SETTLEMENT_DIMENSIONS) {
    const value = normalizeDimensionValue(line[field]);
    if (value) dimensions[field] = value;
  }
  return dimensions;
}

function keyOf(line: ShadowSettlementLine): string {
  const base = `${line.personKey.trim()}|${line.currency.trim().toUpperCase()}`;
  const dimensionParts = SHADOW_SETTLEMENT_DIMENSIONS.flatMap((field) => {
    const value = normalizeDimensionValue(line[field]);
    return value ? [`${field}=${value}`] : [];
  });
  // Unit separator avoids collisions with values that contain "|". Legacy
  // lines with no dimensions keep exactly the historical key.
  return dimensionParts.length > 0
    ? `${base}\u001f${dimensionParts.join("\u001f")}`
    : base;
}

function aggregate(
  lines: readonly ShadowSettlementLine[],
): Map<string, AggregatedLine> {
  const aggregated = new Map<string, AggregatedLine>();
  for (const line of lines) {
    const key = keyOf(line);
    const current = aggregated.get(key);
    if (current) {
      current.amount = add(current.amount, parseDecimal(line.amount));
      continue;
    }
    aggregated.set(key, {
      personKey: line.personKey.trim(),
      currency: line.currency.trim().toUpperCase(),
      amount: parseDecimal(line.amount),
      dimensions: dimensionsOf(line),
    });
  }
  return aggregated;
}

/**
 * Only emit dimension fields that were actually present, so legacy rows keep
 * their exact historical shape (and reportHash).
 */
function dimensionFields(
  line: AggregatedLine | undefined,
): ShadowSettlementDimensions {
  return line ? { ...line.dimensions } : {};
}

/**
 * Compare the engine settlement against an independent finance export.
 *
 * The caller runs this in shadow mode before go-live: any variance, missing
 * person or currency mismatch must be explained before finance uses the
 * engine output. Tolerance is absolute per aggregated reconciliation line
 * (person + currency + any supplied dimensions). Lines that differ in
 * legalEntity / accountingPeriod / orderId / contractRef / payoutBatch /
 * incentiveType are never netted against each other.
 */
export function compareShadowSettlement(
  engineLines: readonly ShadowSettlementLine[],
  financeLines: readonly ShadowSettlementLine[],
  options: { tolerance?: string; generatedAt?: string } = {},
): ShadowSettlementReport {
  const tolerance = options.tolerance ?? "0";
  const toleranceValue = parseDecimal(tolerance);
  if (toleranceValue < 0n) {
    throw new Error("shadow settlement tolerance must not be negative");
  }
  const engine = aggregate(engineLines);
  const finance = aggregate(financeLines);
  const keys = [...new Set([...engine.keys(), ...finance.keys()])].sort();

  const rows: ShadowSettlementRow[] = [];
  const counts = {
    matched: 0,
    variances: 0,
    missingInFinance: 0,
    missingInEngine: 0,
  };
  let engineTotal = 0n;
  let financeTotal = 0n;
  let varianceTotal = 0n;

  for (const key of keys) {
    const expected = engine.get(key);
    const actual = finance.get(key);
    const engineValue = expected?.amount ?? null;
    const financeValue = actual?.amount ?? null;
    const engineAmount =
      engineValue === null ? null : formatDecimal(engineValue);
    const financeAmount =
      financeValue === null ? null : formatDecimal(financeValue);
    if (engineValue !== null) engineTotal = add(engineTotal, engineValue);
    if (financeValue !== null) financeTotal = add(financeTotal, financeValue);

    if (engineValue !== null && financeValue !== null) {
      const variance = sub(financeValue, engineValue);
      varianceTotal = add(varianceTotal, variance);
      const within = variance <= toleranceValue && variance >= -toleranceValue;
      const status: ShadowSettlementStatus = within ? "MATCH" : "VARIANCE";
      if (within) counts.matched += 1;
      else counts.variances += 1;
      rows.push({
        personKey: expected?.personKey ?? actual?.personKey ?? key,
        currency: expected?.currency ?? actual?.currency ?? "",
        engine: engineAmount,
        finance: financeAmount,
        variance: formatDecimal(variance),
        status,
        ...dimensionFields(expected ?? actual),
      });
      continue;
    }

    if (engineValue !== null) {
      counts.missingInFinance += 1;
      varianceTotal = sub(varianceTotal, engineValue);
      rows.push({
        personKey: expected?.personKey ?? key,
        currency: expected?.currency ?? "",
        engine: engineAmount,
        finance: null,
        variance: formatDecimal(-engineValue),
        status: "MISSING_IN_FINANCE",
        ...dimensionFields(expected),
      });
      continue;
    }

    if (financeValue !== null) {
      counts.missingInEngine += 1;
      varianceTotal = add(varianceTotal, financeValue);
      rows.push({
        personKey: actual?.personKey ?? key,
        currency: actual?.currency ?? "",
        engine: null,
        finance: financeAmount,
        variance: financeAmount,
        status: "MISSING_IN_ENGINE",
        ...dimensionFields(actual),
      });
    }
  }

  const withinTolerance =
    counts.variances === 0 &&
    counts.missingInFinance === 0 &&
    counts.missingInEngine === 0;

  const report: ShadowSettlementReport = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    tolerance,
    rows,
    totals: {
      engine: formatDecimal(engineTotal),
      finance: formatDecimal(financeTotal),
      variance: formatDecimal(varianceTotal),
    },
    counts,
    withinTolerance,
    reportHash: sha256({ tolerance, rows, counts }),
  };
  return report;
}
