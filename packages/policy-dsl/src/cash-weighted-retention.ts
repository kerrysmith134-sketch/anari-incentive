import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import {
  add,
  assertRange,
  div,
  formatDecimal,
  min,
  mul,
  parseDecimal,
  roundTo,
  sub,
} from "./decimal.js";
import {
  allocatePool,
  ENGINE_VERSION,
  type OrderContributionResult,
} from "./evaluator.js";
import { currencyMinorUnits } from "./currency.js";
import { sha256 } from "./hash.js";
import { PolicyGateError } from "./errors.js";

const ZERO = parseDecimal("0");
const ONE = parseDecimal("1");

export interface ChargingProjectResult extends OrderContributionResult {
  cashFactor: string;
  retentionHeld: string;
  qualityGate: "PASSED";
}

/**
 * Generic cash-weighted pool with a retention holdback and acceptance/safety gates.
 * The policy pack selects this calculator; the calculator has no industry knowledge.
 *
 * - base pool = min(grossProfit * poolRate, poolCap)
 * - cash factor = min(1, cashCollected / contractAmount)
 * - cash-adjusted pool = basePool * (1 - weight + weight * cashFactor)
 * - retention = cash-adjusted pool * retentionHoldbackRate
 * - payable pool = cash-adjusted pool - retention
 *
 * The retention is recorded but not allocated until warranty expiry; the
 * first slice only calculates and exposes it. Quality gates (acceptance,
 * safety incidents) block the calculation before money is produced.
 */
export function calculateCashWeightedRetention(
  policy: PolicyDefinition,
  input: CalculationInput,
): ChargingProjectResult {
  if (input.order.currency !== policy.currency) {
    throw new Error(
      `Currency mismatch: order ${input.order.currency}, policy ${policy.currency}`,
    );
  }
  const grossProfit = parseDecimal(input.order.grossProfit);
  assertRange("grossProfit", grossProfit, { min: ZERO });

  // 2026-11-21 审计：现金加权模型的边界在入口 fail-closed 校验，不静默 clamp。
  // 任何越界输入都必须在产生金额与 resultHash 之前失败。
  const contractAmount = parseDecimal(
    input.order.contractAmount ?? input.order.grossProfit,
  );
  assertRange("contractAmount", contractAmount, {
    min: ZERO,
    minExclusive: true,
  });
  const cashCollected = parseDecimal(
    input.order.cashCollected ??
      input.order.contractAmount ??
      input.order.grossProfit,
  );
  assertRange("cashCollected", cashCollected, { min: ZERO });
  const poolRate = parseDecimal(policy.poolRate);
  assertRange("poolRate", poolRate, { min: ZERO });
  const poolCap = parseDecimal(policy.poolCap);
  assertRange("poolCap", poolCap, { min: ZERO });
  const cashWeight = parseDecimal(policy.cashCollectionWeight ?? "0");
  assertRange("cashCollectionWeight", cashWeight, { min: ZERO, max: ONE });
  const retentionRate = parseDecimal(policy.retentionHoldbackRate ?? "0");
  assertRange("retentionHoldbackRate", retentionRate, {
    min: ZERO,
    max: ONE,
  });

  const blockers: string[] = [];
  if (
    policy.qualityGate?.requireAcceptance &&
    input.order.acceptanceStatus !== "ACCEPTED"
  ) {
    blockers.push("ACCEPTANCE_NOT_COMPLETE");
  }
  if (
    policy.qualityGate?.blockOnSafetyIncident &&
    (input.order.safetyIncidents ?? 0) > 0
  ) {
    blockers.push("SAFETY_INCIDENT_OPEN");
  }
  if (blockers.length > 0) throw new PolicyGateError(blockers);

  const cashFactor = min(ONE, div(cashCollected, contractAmount));

  const basePool = min(mul(grossProfit, poolRate), poolCap);
  const cashAdjustedPool = mul(
    basePool,
    add(sub(ONE, cashWeight), mul(cashWeight, cashFactor)),
  );
  const retentionHeld = mul(cashAdjustedPool, retentionRate);
  const payablePool = sub(cashAdjustedPool, retentionHeld);

  const minorUnits = currencyMinorUnits(policy.currency);
  const payableRounded = roundTo(payablePool, minorUnits, policy.rounding);
  const retentionRounded = roundTo(retentionHeld, minorUnits, policy.rounding);
  const lines = allocatePool(policy, input, payableRounded, {
    incentiveType: policy.incentiveType ?? "CONTRIBUTION",
    baseAmount: grossProfit,
    trace: {
      pool: formatDecimal(basePool),
      cashAdjustedPool: formatDecimal(cashAdjustedPool),
      cashFactor: formatDecimal(cashFactor),
      retentionHeld: formatDecimal(retentionRounded),
      contractAmount: formatDecimal(contractAmount),
      cashCollected: formatDecimal(cashCollected),
      projectType: input.order.projectType,
      siteId: input.order.siteId,
    },
  });

  const inputSnapshotHash = sha256(input);
  const resultHash = sha256({
    engineVersion: ENGINE_VERSION,
    policyCode: policy.code,
    policyVersion: policy.version,
    inputSnapshotHash,
    cashFactor: formatDecimal(cashFactor),
    basePool: formatDecimal(basePool),
    payablePool: formatDecimal(payableRounded),
    retentionHeld: formatDecimal(retentionRounded),
    lines,
  });

  return {
    lines,
    pool: formatDecimal(basePool),
    poolRounded: formatDecimal(payableRounded),
    inputSnapshotHash,
    resultHash,
    engineVersion: ENGINE_VERSION,
    cashFactor: formatDecimal(cashFactor),
    retentionHeld: formatDecimal(retentionRounded),
    qualityGate: "PASSED",
  };
}
