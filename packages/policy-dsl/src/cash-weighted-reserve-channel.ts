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
  assertRange("grossProfit", grossProfit, { min: ZERO });

  // 2026-11-21 审计：现金加权模型的边界在入口 fail-closed 校验，不静默 clamp。
  const invoiceAmount = parseDecimal(
    input.order.invoiceAmount ??
      input.order.contractAmount ??
      input.order.grossProfit,
  );
  assertRange("invoiceAmount", invoiceAmount, {
    min: ZERO,
    minExclusive: true,
  });
  const cashCollected = parseDecimal(
    input.order.cashCollected ??
      input.order.invoiceAmount ??
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
  const reserveRate = parseDecimal(policy.afterSalesReserveRate ?? "0");
  assertRange("afterSalesReserveRate", reserveRate, { min: ZERO, max: ONE });

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
  assertRange("channelShare", channelShare, { min: ZERO, max: ONE });
  if (channelShare > 0n && !input.order.channelPartnerId) {
    blockers.push("CHANNEL_PARTNER_MISSING");
  }
  if (blockers.length > 0) throw new PolicyGateError(blockers);

  const cashFactor = min(ONE, div(cashCollected, invoiceAmount));

  const basePool = min(mul(grossProfit, poolRate), poolCap);
  const cashAdjustedPool = mul(
    basePool,
    add(sub(ONE, cashWeight), mul(cashWeight, cashFactor)),
  );
  const afterSalesReserve = mul(cashAdjustedPool, reserveRate);
  const payablePool = sub(cashAdjustedPool, afterSalesReserve);
  const channelPool = mul(payablePool, channelShare);
  const internalPool = sub(payablePool, channelPool);

  const minorUnits = currencyMinorUnits(policy.currency);
  const internalRounded = roundTo(internalPool, minorUnits, policy.rounding);
  const channelRounded = roundTo(channelPool, minorUnits, policy.rounding);
  const reserveRounded = roundTo(afterSalesReserve, minorUnits, policy.rounding);
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
