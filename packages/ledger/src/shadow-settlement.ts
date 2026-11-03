import { add, formatDecimal, parseDecimal, sha256, sub } from "@anari/policy-dsl";

export interface ShadowSettlementLine {
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

export interface ShadowSettlementRow {
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

function keyOf(line: ShadowSettlementLine): string {
  return `${line.personKey.trim()}|${line.currency.trim().toUpperCase()}`;
}

function aggregate(
  lines: readonly ShadowSettlementLine[],
): Map<string, ShadowSettlementLine> {
  const aggregated = new Map<string, ShadowSettlementLine>();
  for (const line of lines) {
    const key = keyOf(line);
    const current = aggregated.get(key);
    aggregated.set(key, {
      personKey: line.personKey.trim(),
      currency: line.currency.trim().toUpperCase(),
      amount: formatDecimal(
        add(parseDecimal(current?.amount ?? "0"), parseDecimal(line.amount)),
      ),
    });
  }
  return aggregated;
}

/**
 * Compare the engine settlement against an independent finance export.
 *
 * The caller runs this in shadow mode before go-live: any variance, missing
 * person or currency mismatch must be explained before finance uses the
 * engine output. Tolerance is absolute per aggregated person+currency line.
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
    const engineAmount = expected?.amount ?? null;
    const financeAmount = actual?.amount ?? null;
    if (engineAmount !== null) engineTotal = add(engineTotal, parseDecimal(engineAmount));
    if (financeAmount !== null) financeTotal = add(financeTotal, parseDecimal(financeAmount));

    if (engineAmount !== null && financeAmount !== null) {
      const variance = sub(
        parseDecimal(financeAmount),
        parseDecimal(engineAmount),
      );
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
      });
      continue;
    }

    if (engineAmount !== null) {
      counts.missingInFinance += 1;
      varianceTotal = sub(varianceTotal, parseDecimal(engineAmount));
      rows.push({
        personKey: expected?.personKey ?? key,
        currency: expected?.currency ?? "",
        engine: engineAmount,
        finance: null,
        variance: formatDecimal(-parseDecimal(engineAmount)),
        status: "MISSING_IN_FINANCE",
      });
      continue;
    }

    if (financeAmount !== null) {
      counts.missingInEngine += 1;
      varianceTotal = add(varianceTotal, parseDecimal(financeAmount));
      rows.push({
        personKey: actual?.personKey ?? key,
        currency: actual?.currency ?? "",
        engine: null,
        finance: financeAmount,
        variance: financeAmount,
        status: "MISSING_IN_ENGINE",
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
