import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import {
  add,
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
import { sha256 } from "./hash.js";
import { PolicyGateError } from "./errors.js";


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
  if (grossProfit < 0n) throw new Error("Gross profit cannot be negative");

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

  const contractAmount = parseDecimal(
    input.order.contractAmount ?? input.order.grossProfit,
  );
  const cashCollected = parseDecimal(
    input.order.cashCollected ??
      input.order.contractAmount ??
      input.order.grossProfit,
  );
  const cashFactor =
    contractAmount > 0n ? min(parseDecimal("1"), div(cashCollected, contractAmount)) : parseDecimal("1");

  const basePool = min(
    mul(grossProfit, parseDecimal(policy.poolRate)),
    (() => {
      const capValue = parseDecimal(policy.poolCap);
      if (parseDecimal(policy.poolRate) < 0n || capValue < 0n) {
        throw new Error("poolRate and poolCap cannot be negative");
      }
      return capValue;
    })(),
  );
  const cashWeight = parseDecimal(policy.cashCollectionWeight ?? "0");
  const cashAdjustedPool = mul(
    basePool,
    add(sub(parseDecimal("1"), cashWeight), mul(cashWeight, cashFactor)),
  );
  const retentionRate = parseDecimal(policy.retentionHoldbackRate ?? "0");
  const retentionHeld = mul(cashAdjustedPool, retentionRate);
  const payablePool = sub(cashAdjustedPool, retentionHeld);

  const payableRounded = roundTo(payablePool, 2, policy.rounding);
  const retentionRounded = roundTo(retentionHeld, 2, policy.rounding);
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
