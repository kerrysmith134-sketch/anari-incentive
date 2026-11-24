import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import { currencyMinorUnits } from "./currency.js";
import {
  div,
  formatDecimal,
  min,
  mul,
  parseDecimal,
  roundTo,
} from "./decimal.js";
import { allocatePool, type OrderContributionResult } from "./evaluator.js";
import type { CalculationLine } from "@anari/domain";
import { sha256 } from "./hash.js";

/**
 * 阶梯提成（TIERED）：毛利按区间累进计提，区间上界为 upTo（null = 无上限）；
 * 超出 poolCap 时按 cap 截断。仍用统一分配器分配到人（最大余数法）。
 * Trace 记录每个区间的计提，便于解释“为什么是这么多”。
 */
export function calculateTiered(
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
  // Bracket math walks lowerBound forward, so unsorted or duplicated `upTo`
  // values silently change the payout. Sort numerically; null (∞) last.
  const tiers = [...(policy.tiers ?? [])].sort((left, right) => {
    if (left.upTo === null) return right.upTo === null ? 0 : 1;
    if (right.upTo === null) return -1;
    const leftValue = parseDecimal(left.upTo);
    const rightValue = parseDecimal(right.upTo);
    return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
  });
  if (tiers.length === 0) {
    throw new Error("TIERED policy requires at least one tier");
  }

  let remaining = grossProfit;
  let lowerBound = 0n;
  let commission = 0n;
  const bracketTrace: Array<Record<string, string>> = [];
  for (const tier of tiers) {
    if (remaining <= 0n) break;
    const upper = tier.upTo === null ? null : parseDecimal(tier.upTo);
    const span = upper === null ? remaining : min(remaining, upper - lowerBound);
    if (span <= 0n) {
      lowerBound = upper ?? lowerBound;
      continue;
    }
    const portion = div(mul(span, parseDecimal(tier.ratePercent)), parseDecimal("100"));
    commission += portion;
    bracketTrace.push({
      upTo: tier.upTo ?? "∞",
      span: formatDecimal(span),
      ratePercent: tier.ratePercent,
      portion: formatDecimal(portion),
    });
    remaining -= span;
    if (upper === null) break;
    lowerBound = upper;
  }

  const capValue = parseDecimal(policy.poolCap);
  if (capValue < 0n) throw new Error("poolCap cannot be negative");
  const capped = min(commission, capValue);
  const poolRounded = roundTo(
    capped,
    currencyMinorUnits(policy.currency),
    policy.rounding,
  );
  const lines: CalculationLine[] = allocatePool(policy, input, poolRounded, {
    baseAmount: grossProfit,
    trace: {
      commission: formatDecimal(commission),
      brackets: JSON.stringify(bracketTrace),
    },
  });

  const inputSnapshotHash = sha256(input);
  const resultHash = sha256({
    engineVersion: "tiered-v1",
    policyCode: policy.code,
    policyVersion: policy.version,
    inputSnapshotHash,
    commission: formatDecimal(commission),
    poolRounded: formatDecimal(poolRounded),
    lines,
  });

  return {
    lines,
    pool: formatDecimal(commission),
    poolRounded: formatDecimal(poolRounded),
    inputSnapshotHash,
    resultHash,
    engineVersion: "tiered-v1",
  };
}

/**
 * 团队池（TEAM_POOL）：资金池 = min(毛利 × poolRate, poolCap)；
 * 每个参与人的有效权重 = 申报权重 × policy.roleWeights[role]（缺省 1）；
 * 池按有效权重比例分配（统一分配器，最大余数法）。
 */
export function calculateTeamPool(
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
  const pool = min(
    mul(grossProfit, parseDecimal(policy.poolRate)),
    (() => {
      const capValue = parseDecimal(policy.poolCap);
      if (parseDecimal(policy.poolRate) < 0n || capValue < 0n) {
        throw new Error("poolRate and poolCap cannot be negative");
      }
      return capValue;
    })(),
  );
  const poolRounded = roundTo(
    pool,
    currencyMinorUnits(policy.currency),
    policy.rounding,
  );

  const roleWeights = policy.roleWeights ?? {};
  const FACTOR = 1_000_000n;
  const effectiveParticipants = input.participants.map((participant) => {
    const roleWeight = parseDecimal(roleWeights[participant.role] ?? "1");
    return {
      ...participant,
      attributionWeight: formatDecimal(
        div(mul(parseDecimal(participant.attributionWeight), roleWeight), FACTOR),
      ),
    };
  });

  const lines: CalculationLine[] = allocatePool(
    policy,
    { ...input, participants: effectiveParticipants },
    poolRounded,
    {
      baseAmount: grossProfit,
      incentiveType: policy.incentiveType ?? "TEAM_CONTRIBUTION",
      trace: {
        roleWeights: JSON.stringify(roleWeights),
      },
    },
  );

  const inputSnapshotHash = sha256(input);
  const resultHash = sha256({
    engineVersion: "team-pool-v1",
    policyCode: policy.code,
    policyVersion: policy.version,
    inputSnapshotHash,
    poolRounded: formatDecimal(poolRounded),
    lines,
  });

  return {
    lines,
    pool: formatDecimal(pool),
    poolRounded: formatDecimal(poolRounded),
    inputSnapshotHash,
    resultHash,
    engineVersion: "team-pool-v1",
  };
}
