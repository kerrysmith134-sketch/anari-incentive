import type { PolicyDefinition } from "@anari/domain";

/**
 * Reference policy for the first vertical slice. The ID is a stable UUID so
 * the same value can be used by the in-memory store and the PostgreSQL seed.
 */
export const REFERENCE_POLICY_ID = "00000000-0000-4000-8000-000000000100";

export const referencePolicy: PolicyDefinition = {
  code: "ORDER_CONTRIBUTION_V1",
  version: 1,
  currency: "CNY",
  poolRate: "0.05",
  poolCap: "100000",
  rounding: "HALF_UP",
  minimumWage: { monthlyMinimum: "2690", checked: false },
};

export const policies = new Map<string, PolicyDefinition>([
  [REFERENCE_POLICY_ID, referencePolicy],
]);
