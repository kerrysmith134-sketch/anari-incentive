import type {
  CalculationInput,
  CalculationLine,
  PolicyDefinition,
} from "@anari/domain";
import {
  add,
  div,
  formatDecimal,
  isPositive,
  min,
  mul,
  parseDecimal,
  roundTo,
  sum,
} from "./decimal.js";
import { sha256 } from "./hash.js";

export const ENGINE_VERSION = "policy-dsl/0.1.0";
const CENT = 10_000n; // 0.01 at 1e6 scale

export interface OrderContributionResult {
  lines: CalculationLine[];
  pool: string;
  poolRounded: string;
  inputSnapshotHash: string;
  resultHash: string;
  engineVersion: string;
}

export interface AllocatableParticipant {
  personId: string;
  workPackageId: string;
  role: string;
  weight: bigint;
  normalized: bigint;
  raw: bigint;
  rounded: bigint;
  remainder: bigint;
}

function normalizeWeights(
  participants: CalculationInput["participants"],
): { total: bigint; parsed: Array<{ weight: bigint; source: (typeof participants)[number] }> } {
  const parsed = participants.map((participant) => {
    const attribution = parseDecimal(participant.attributionWeight);
    const multiplier = parseDecimal(participant.evaluationMultiplier ?? "1");
    if (attribution < 0n || multiplier < 0n) {
      throw new Error(
        `Attribution/evaluation weight cannot be negative for ${participant.personId}`,
      );
    }
    return {
      weight: mul(attribution, multiplier),
      source: participant,
    };
  });
  const total = sum(parsed.map((item) => item.weight));
  if (total <= 0n) {
    throw new Error("At least one participant must have a positive weight");
  }
  return { total, parsed };
}

/**
 * Deterministic order-contribution pool calculation.
 *
 * Policy:
 *   pool = min(grossProfit * poolRate, poolCap)
 *   line = pool * normalized attribution weight
 *
 * Lines are first floored to cents, then the remaining cents are allocated by
 * the largest fractional remainder ("largest remainder" / Hamilton method).
 * Remainder ties are broken by personId ascending. This keeps the sum of
 * rounded lines equal to the rounded pool and gives the independent reference
 * a precise, reproducible tie-break rule.
 */
export interface AllocatePoolOptions {
  incentiveType?: string;
  baseAmount?: bigint;
  trace?: Record<string, unknown>;
}

/**
 * Allocate a rounded pool across participants using human-confirmed weights.
 *
 * Lines are first floored to cents, then the remaining cents are allocated by
 * the largest fractional remainder ("largest remainder" / Hamilton method).
 * Remainder ties are broken by personId ascending. This keeps the sum of
 * rounded lines equal to the rounded pool and gives the independent reference
 * a precise, reproducible tie-break rule.
 */
export function allocatePool(
  policy: PolicyDefinition,
  input: CalculationInput,
  poolRounded: bigint,
  options: AllocatePoolOptions = {},
): CalculationLine[] {
  const { total, parsed } = normalizeWeights(input.participants);
  const incentiveType = options.incentiveType ?? policy.incentiveType ?? "CONTRIBUTION";
  const baseAmount = options.baseAmount ?? parseDecimal(input.order.grossProfit);

  const participants: AllocatableParticipant[] = parsed.map((item) => {
    const normalized = div(item.weight, total);
    const raw = div(mul(poolRounded, item.weight), total);
    // Floor first; leftover cents are distributed deterministically below.
    const rounded = roundTo(raw, 2, "DOWN");
    return {
      personId: item.source.personId,
      workPackageId: item.source.workPackageId,
      role: item.source.role,
      weight: item.weight,
      normalized,
      raw,
      rounded,
      remainder: raw % CENT,
    };
  });

  let allocated = sum(participants.map((participant) => participant.rounded));
  let remainder = poolRounded - allocated;

  if (remainder !== 0n) {
    const step = remainder > 0n ? CENT : -CENT;
    const order = [...participants].sort((a, b) => {
      if (a.remainder !== b.remainder) {
        return Number(b.remainder - a.remainder);
      }
      return a.personId.localeCompare(b.personId);
    });
    let remaining = remainder;
    for (const participant of order) {
      if (remaining === 0n) break;
      const next = participant.rounded + step;
      if (next < 0n) continue;
      participant.rounded = next;
      participant.remainder = 0n;
      remaining -= step;
    }
    if (remaining !== 0n) {
      throw new Error("Unable to allocate rounding remainder without a negative line");
    }
    allocated = sum(participants.map((participant) => participant.rounded));
    remainder = poolRounded - allocated;
  }

  if (allocated !== poolRounded) {
    throw new Error(
      `Allocation invariant failed: allocated ${allocated} != pool ${poolRounded}`,
    );
  }

  return participants.map((participant) => ({
    lineKey: [
      participant.personId,
      participant.workPackageId,
      incentiveType,
    ].join(":"),
    personId: participant.personId,
    workPackageId: participant.workPackageId,
    incentiveType,
    baseAmount: formatDecimal(baseAmount),
    multiplier: formatDecimal(participant.normalized),
    rawAmount: formatDecimal(participant.raw),
    roundedAmount: formatDecimal(participant.rounded),
    currency: policy.currency,
    trace: {
      policyCode: policy.code,
      policyVersion: policy.version,
      poolRounded: formatDecimal(poolRounded),
      poolRate: policy.poolRate,
      poolCap: policy.poolCap,
      baseAmount: formatDecimal(baseAmount),
      normalizedWeight: formatDecimal(participant.normalized),
      rounding: policy.rounding,
      engineVersion: ENGINE_VERSION,
      ...options.trace,
    },
  }));
}

/**
 * Deterministic order-contribution pool calculation.
 *
 * Policy:
 *   pool = min(grossProfit * poolRate, poolCap)
 *   line = pool * normalized attribution weight
 */
export function calculateOrderContribution(
  policy: PolicyDefinition,
  input: CalculationInput,
): OrderContributionResult {
  if (input.order.currency !== policy.currency) {
    throw new Error(
      `Currency mismatch: order ${input.order.currency}, policy ${policy.currency}`,
    );
  }
  const grossProfit = parseDecimal(input.order.grossProfit);
  if (grossProfit < 0n) {
    throw new Error("Gross profit cannot be negative");
  }

  // 池参数不得为负（负池会产生负激励分录并绕开 RECOVERY 确认门禁）。
  const rateValue = parseDecimal(policy.poolRate);
  const capValue = parseDecimal(policy.poolCap);
  if (rateValue < 0n || capValue < 0n) {
    throw new Error("poolRate and poolCap cannot be negative");
  }
  const pool = min(mul(grossProfit, rateValue), capValue);
  // 舍入向上不得越过 cap：以 cap 的向下 2 位为硬上限。
  const poolRounded = min(roundTo(pool, 2, policy.rounding), roundTo(capValue, 2, "DOWN"));
  const lines = allocatePool(policy, input, poolRounded, {
    baseAmount: grossProfit,
    trace: { pool: formatDecimal(pool) },
  });

  const inputSnapshotHash = sha256(input);
  const resultHash = sha256({
    engineVersion: ENGINE_VERSION,
    policyCode: policy.code,
    policyVersion: policy.version,
    inputSnapshotHash,
    pool: formatDecimal(pool),
    poolRounded: formatDecimal(poolRounded),
    lines,
  });

  return {
    lines,
    pool: formatDecimal(pool),
    poolRounded: formatDecimal(poolRounded),
    inputSnapshotHash,
    resultHash,
    engineVersion: ENGINE_VERSION,
  };
}

/**
 * Tiny AST evaluator used by the first policy slice. It is intentionally
 * limited to the primitives needed for the reference policy; adding an
 * operator requires a new conformance test and a schema version bump.
 */
export type PolicyRule =
  | { op: "CONST"; value: string }
  | { op: "INPUT"; key: string }
  | { op: "ADD"; args: PolicyRule[] }
  | { op: "MULTIPLY"; args: PolicyRule[] }
  | { op: "MIN"; args: PolicyRule[] }
  | { op: "MAX"; args: PolicyRule[] }
  | { op: "ROUND"; value: PolicyRule; decimals: number; mode: "HALF_UP" | "HALF_EVEN" | "DOWN" };

export function evaluateRule(
  rule: PolicyRule,
  inputs: Record<string, string>,
): bigint {
  switch (rule.op) {
    case "CONST":
      return parseDecimal(rule.value);
    case "INPUT": {
      const value = inputs[rule.key];
      if (value === undefined) throw new Error(`Missing input: ${rule.key}`);
      return parseDecimal(value);
    }
    case "ADD":
      return sum(rule.args.map((arg) => evaluateRule(arg, inputs)));
    case "MULTIPLY":
      return rule.args
        .map((arg) => evaluateRule(arg, inputs))
        .reduce((acc, value) => mul(acc, value), parseDecimal("1"));
    case "MIN":
      return rule.args
        .map((arg) => evaluateRule(arg, inputs))
        .reduce((acc, value) => (value < acc ? value : acc));
    case "MAX":
      return rule.args
        .map((arg) => evaluateRule(arg, inputs))
        .reduce((acc, value) => (value > acc ? value : acc));
    case "ROUND":
      return roundTo(
        evaluateRule(rule.value, inputs),
        rule.decimals,
        rule.mode,
      );
  }
}

export function assertPositivePool(pool: string): void {
  if (!isPositive(parseDecimal(pool))) {
    throw new Error("Incentive pool must be positive");
  }
}

export { add, div, formatDecimal, mul, parseDecimal, roundTo, sum };
