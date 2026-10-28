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

export interface CashWeightedReserveChannelResult extends OrderContributionResult {
  cashFactor: string;
  afterSalesReserve: string;
  channelPool: string;
  internalPool: string;
  qualityGate: "PASSED";
}

/**
 * Generic cash-weighted pool with an after-sales reserve and an optional channel split.
 * The policy pack selects this calculator; the calculator has no industry knowledge.
 *
 * - base pool = min(grossProfit * poolRate, poolCap)
 * - cash factor = min(1, cashCollected / invoiceAmount)
 * - cash-adjusted pool = basePool * (1 - weight + weight * cashFactor)
 * - after-sales reserve = cash-adjusted pool * afterSalesReserveRate
 * - payable pool = cash-adjusted pool - after-sales reserve
 * - channel pool = payable pool * channelShare
 * - internal pool = payable pool - channel pool
 * - line = internal pool * confirmed attribution weight
 *
 * Credit approval and quality holds are hard gates. Channel share is recorded
 * separately; internal employees are not paid on the channel partner's share.
 */
export function calculateCashWeightedReserveChannel(
  policy: PolicyDefinition,
  input: CalculationInput,
): CashWeightedReserveChannelResult {
  if (input.order.currency !== policy.currency) {
    throw new Error(
      `Currency mismatch: order ${input.order.currency}, policy ${policy.currency}`,
    );
  }
  const grossProfit = parseDecimal(input.order.grossProfit);
  if (grossProfit < 0n) throw new Error("Gross profit cannot be negative");

  const blockers: string[] = [];
  if (
    policy.creditGate?.requireCreditApproval &&
    input.order.creditApproved !== true
  ) {
    blockers.push("CREDIT_NOT_APPROVED");
  }
  if (
    policy.creditGate?.blockOnQualityHold &&
    input.order.qualityHold === true
  ) {
    blockers.push("QUALITY_HOLD");
  }
  const channelShare = parseDecimal(input.order.channelShare ?? "0");
  if (channelShare < 0n || channelShare > parseDecimal("1")) {
    throw new Error("channelShare must be between 0 and 1");
  }
  if (channelShare > 0n && !input.order.channelPartnerId) {
    blockers.push("CHANNEL_PARTNER_MISSING");
  }
  if (blockers.length > 0) throw new PolicyGateError(blockers);

  const invoiceAmount = parseDecimal(
    input.order.invoiceAmount ??
      input.order.contractAmount ??
      input.order.grossProfit,
  );
  const cashCollected = parseDecimal(
    input.order.cashCollected ??
      input.order.invoiceAmount ??
      input.order.contractAmount ??
      input.order.grossProfit,
  );
  const cashFactor =
    invoiceAmount > 0n
      ? min(parseDecimal("1"), div(cashCollected, invoiceAmount))
      : parseDecimal("1");

  const basePool = min(
    mul(grossProfit, parseDecimal(policy.poolRate)),
    parseDecimal(policy.poolCap),
  );
  const cashWeight = parseDecimal(policy.cashCollectionWeight ?? "0");
  const cashAdjustedPool = mul(
    basePool,
    add(sub(parseDecimal("1"), cashWeight), mul(cashWeight, cashFactor)),
  );
  const reserveRate = parseDecimal(policy.afterSalesReserveRate ?? "0");
  const afterSalesReserve = mul(cashAdjustedPool, reserveRate);
  const payablePool = sub(cashAdjustedPool, afterSalesReserve);
  const channelPool = mul(payablePool, channelShare);
  const internalPool = sub(payablePool, channelPool);

  const internalRounded = roundTo(internalPool, 2, policy.rounding);
  const channelRounded = roundTo(channelPool, 2, policy.rounding);
  const reserveRounded = roundTo(afterSalesReserve, 2, policy.rounding);
  const lines = allocatePool(policy, input, internalRounded, {
    incentiveType: policy.incentiveType ?? "CONTRIBUTION",
    baseAmount: grossProfit,
    trace: {
      pool: formatDecimal(basePool),
      cashAdjustedPool: formatDecimal(cashAdjustedPool),
      cashFactor: formatDecimal(cashFactor),
      afterSalesReserve: formatDecimal(reserveRounded),
      payablePool: formatDecimal(payablePool),
      channelShare: formatDecimal(channelShare),
      channelPool: formatDecimal(channelRounded),
      internalPool: formatDecimal(internalRounded),
      invoiceAmount: formatDecimal(invoiceAmount),
      cashCollected: formatDecimal(cashCollected),
      channelPartnerId: input.order.channelPartnerId,
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
    afterSalesReserve: formatDecimal(reserveRounded),
    channelPool: formatDecimal(channelRounded),
    internalPool: formatDecimal(internalRounded),
    lines,
  });

  return {
    lines,
    pool: formatDecimal(basePool),
    poolRounded: formatDecimal(internalRounded),
    inputSnapshotHash,
    resultHash,
    engineVersion: ENGINE_VERSION,
    cashFactor: formatDecimal(cashFactor),
    afterSalesReserve: formatDecimal(reserveRounded),
    channelPool: formatDecimal(channelRounded),
    internalPool: formatDecimal(internalRounded),
    qualityGate: "PASSED",
  };
}
