import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import { calculateOrderContribution, type OrderContributionResult } from "./evaluator.js";
import { calculateCashWeightedRetention } from "./cash-weighted-retention.js";
import { calculateCashWeightedReserveChannel } from "./cash-weighted-reserve-channel.js";
import { calculateTeamPool, calculateTiered } from "./tiered-team.js";

/**
 * Generic calculator dispatch. The core selects a calculator from policy data,
 * never from an industry code. A new pack can reuse an existing calculator or
 * introduce a new one behind the restricted policy DSL.
 */
export function calculateByPolicy(
  policy: PolicyDefinition,
  input: CalculationInput,
): OrderContributionResult {
  switch (policy.calculator ?? "SIMPLE_POOL") {
    case "SIMPLE_POOL":
      return calculateOrderContribution(policy, input);
    case "TIERED":
      return calculateTiered(policy, input);
    case "TEAM_POOL":
      return calculateTeamPool(policy, input);
    case "CASH_WEIGHTED_POOL":
    case "CASH_WEIGHTED_RETENTION_POOL":
      return calculateCashWeightedRetention(policy, input);
    case "CASH_WEIGHTED_RESERVE_CHANNEL_POOL":
      return calculateCashWeightedReserveChannel(policy, input);
    default:
      throw new Error(`Unsupported calculator: ${policy.calculator}`);
  }
}
