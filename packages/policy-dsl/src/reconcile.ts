import type { CalculationLine } from "@anari/domain";
import { formatDecimal, parseDecimal, sub } from "./decimal.js";

/**
 * 独立期望账（如财务导出的表格）中的一行。
 *
 * 2026-11-21 审计：同一人可能有多笔订单 / 多个激励类型，旧的
 * `new Map(actual.map(...))` 会按 personId 覆盖，只保留最后一行。
 * 现按业务维度聚合并求和。
 *
 * - 不提供任何维度字段时：按 personId 汇总比较（兼容旧调用）。
 * - 提供 `currency` / `incentiveType` / `dimensionKey` 时：按
 *   `personId|currency|incentiveType` 比较，避免跨币种/跨激励类型净额抵消。
 * - `dimensionKey` 是显式的维度键（格式约定为
 *   `personId|CURRENCY|INCENTIVE_TYPE`，空维度留空），用于调用方直接对齐
 *   引擎侧计算；它优先于 `currency` / `incentiveType` 字段。
 */
export interface ExpectedLine {
  personId: string;
  amount: string;
  /** 可选的币种维度；提供时参与分组并统一大写比较。 */
  currency?: string;
  /** 可选的激励类型维度；提供时参与分组。 */
  incentiveType?: string;
  /** 可选的显式维度键，优先于 currency / incentiveType。 */
  dimensionKey?: string;
}

/**
 * 对账差异。既有字段语义保持不变；在维度比较模式下额外附带维度字段，
 * 便于财务定位是哪一个币种/激励类型/维度键出了差异。
 */
export interface ReconciliationDifference {
  personId: string;
  expected: string;
  actual: string | null;
  delta: string;
  currency?: string;
  incentiveType?: string;
  dimensionKey?: string;
}

interface Group {
  personId: string;
  /** 归一化后的币种（大写）；缺失为空字符串。 */
  currency: string;
  /** 归一化后的激励类型；缺失为空字符串。 */
  incentiveType: string;
  /** 显式维度键（仅期望账可提供）。 */
  dimensionKey?: string;
  amount: bigint;
  /** 该组包含的原始金额字符串，用于单行时保持原样输出。 */
  rawAmounts: string[];
}

function normalizeCurrency(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : "";
}

function normalizeIncentiveType(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * 期望账声明的比较颗粒度（grain）。只有被期望账显式声明的维度才参与分组，
 * 避免要求引擎侧必然存在的 incentiveType 与未声明该维度的期望账对齐。
 * `fullKey` 用于显式 dimensionKey 或 actual 侧维度歧义时的完整维度键。
 */
interface Grain {
  currency: boolean;
  incentiveType: boolean;
  fullKey: boolean;
}

function resolveGrain(expected: ExpectedLine[]): Grain {
  return {
    currency: expected.some((line) => Boolean(normalizeCurrency(line.currency))),
    incentiveType: expected.some((line) =>
      Boolean(normalizeIncentiveType(line.incentiveType)),
    ),
    fullKey: expected.some((line) => Boolean(line.dimensionKey?.trim())),
  };
}

function fullDimensionKey(
  personId: string,
  currency: string,
  incentiveType: string,
): string {
  return `${personId.trim()}|${currency}|${incentiveType}`;
}

function grainKey(
  personId: string,
  grain: Grain,
  currency: string,
  incentiveType: string,
): string {
  if (grain.fullKey) return fullDimensionKey(personId, currency, incentiveType);
  const parts = [personId.trim()];
  if (grain.currency) parts.push(currency);
  if (grain.incentiveType) parts.push(incentiveType);
  return parts.join("|");
}

function expectedGroupKey(
  line: ExpectedLine,
  grain: Grain,
  useDimensions: boolean,
): string {
  if (!useDimensions) return line.personId.trim();
  const explicit = line.dimensionKey?.trim();
  if (explicit) return explicit;
  return grainKey(
    line.personId,
    grain,
    normalizeCurrency(line.currency),
    normalizeIncentiveType(line.incentiveType),
  );
}

function actualGroupKey(line: CalculationLine, grain: Grain): string {
  const currency = normalizeCurrency(line.currency);
  const incentiveType = normalizeIncentiveType(line.incentiveType);
  // 期望账未声明任何维度但 actual 存在维度歧义时，必须用完整维度键报告，
  // 不能投影到 personId 后静默跨维度求和。
  if (grain.fullKey || (!grain.currency && !grain.incentiveType)) {
    return fullDimensionKey(line.personId, currency, incentiveType);
  }
  return grainKey(line.personId, grain, currency, incentiveType);
}

/**
 * actual 侧在同一 personId 下出现多个不同的非空（币种/激励类型）组合时，
 * 按 personId 汇总会做跨币种/跨类型净额抵消。此时自动升级为维度比较；
 * 若期望账仍是 person 级汇总，会显式报告维度缺失，而不是静默抵消。
 */
function actualHasAmbiguousDimensions(actual: CalculationLine[]): boolean {
  const dimensionsByPerson = new Map<string, Set<string>>();
  for (const line of actual) {
    const currency = normalizeCurrency(line.currency);
    const incentiveType = normalizeIncentiveType(line.incentiveType);
    if (!currency && !incentiveType) continue;
    const person = line.personId.trim();
    const dimensions = dimensionsByPerson.get(person) ?? new Set<string>();
    dimensions.add(`${currency}|${incentiveType}`);
    dimensionsByPerson.set(person, dimensions);
  }
  return [...dimensionsByPerson.values()].some(
    (dimensions) => dimensions.size > 1,
  );
}

function aggregateExpected(
  lines: ExpectedLine[],
  useDimensions: boolean,
  grain: Grain,
): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const line of lines) {
    const key = expectedGroupKey(line, grain, useDimensions);
    const current = groups.get(key);
    if (current) {
      current.amount += parseDecimal(line.amount);
      current.rawAmounts.push(line.amount);
      continue;
    }
    groups.set(key, {
      personId: line.personId.trim(),
      currency: normalizeCurrency(line.currency),
      incentiveType: normalizeIncentiveType(line.incentiveType),
      dimensionKey: line.dimensionKey?.trim() || undefined,
      amount: parseDecimal(line.amount),
      rawAmounts: [line.amount],
    });
  }
  return groups;
}

function aggregateActual(
  lines: CalculationLine[],
  useDimensions: boolean,
  grain: Grain,
): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const line of lines) {
    const key = useDimensions
      ? actualGroupKey(line, grain)
      : line.personId.trim();
    const currency = normalizeCurrency(line.currency);
    const incentiveType = normalizeIncentiveType(line.incentiveType);
    const current = groups.get(key);
    if (current) {
      current.amount += parseDecimal(line.roundedAmount);
      current.rawAmounts.push(line.roundedAmount);
      continue;
    }
    groups.set(key, {
      personId: line.personId.trim(),
      currency,
      incentiveType,
      amount: parseDecimal(line.roundedAmount),
      rawAmounts: [line.roundedAmount],
    });
  }
  return groups;
}

/** 单行时保留原始字符串（与旧行为一致），多行求和后统一格式化。 */
function displayAmount(group: Group): string {
  return group.rawAmounts.length === 1
    ? group.rawAmounts[0]!
    : formatDecimal(group.amount);
}

function dimensionFields(
  group: Group,
  useDimensions: boolean,
): Pick<
  ReconciliationDifference,
  "currency" | "incentiveType" | "dimensionKey"
> {
  if (!useDimensions) return {};
  return {
    ...(group.currency ? { currency: group.currency } : {}),
    ...(group.incentiveType
      ? { incentiveType: group.incentiveType }
      : {}),
    ...(group.dimensionKey ? { dimensionKey: group.dimensionKey } : {}),
  };
}

/**
 * Compare an independent expected ledger (e.g. a spreadsheet export) with the
 * engine output. Any difference must be explained before formal settlement;
 * the script exits non-zero if this array is non-empty.
 *
 * 同一业务维度的多行会先求和再比较（不再按 personId 覆盖）。维度比较的
 * 触发条件：期望账提供了 currency / incentiveType / dimensionKey，或
 * actual 侧同一人出现跨币种/跨激励类型。否则保持旧的 personId 汇总语义。
 */
export function reconcileLines(
  expected: ExpectedLine[],
  actual: CalculationLine[],
): ReconciliationDifference[] {
  const grain = resolveGrain(expected);
  const useDimensions =
    grain.currency ||
    grain.incentiveType ||
    grain.fullKey ||
    actualHasAmbiguousDimensions(actual);
  const expectedGroups = aggregateExpected(expected, useDimensions, grain);
  const actualGroups = aggregateActual(actual, useDimensions, grain);
  const differences: ReconciliationDifference[] = [];

  for (const [key, expectedGroup] of expectedGroups) {
    const actualGroup = actualGroups.get(key);
    const expectedDisplay = displayAmount(expectedGroup);
    if (!actualGroup) {
      differences.push({
        personId: expectedGroup.personId,
        expected: expectedDisplay,
        actual: null,
        delta: expectedDisplay,
        ...dimensionFields(expectedGroup, useDimensions),
      });
      continue;
    }
    const delta = sub(actualGroup.amount, expectedGroup.amount);
    if (delta !== 0n) {
      differences.push({
        personId: expectedGroup.personId,
        expected: expectedDisplay,
        actual: displayAmount(actualGroup),
        delta: formatDecimal(delta),
        ...dimensionFields(
          useDimensions ? expectedGroup : actualGroup,
          useDimensions,
        ),
      });
    }
  }

  for (const [key, actualGroup] of actualGroups) {
    if (expectedGroups.has(key)) continue;
    const actualDisplay = displayAmount(actualGroup);
    differences.push({
      personId: actualGroup.personId,
      expected: "0",
      actual: actualDisplay,
      delta: actualDisplay,
      ...dimensionFields(actualGroup, useDimensions),
    });
  }

  return differences;
}
