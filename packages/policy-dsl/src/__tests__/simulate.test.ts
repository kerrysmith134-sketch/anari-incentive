import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import { simulatePolicyChange } from "../index.js";

const current: PolicyDefinition = {
  code: "GENERIC_CONTRIBUTION_V1",
  version: 1,
  currency: "CNY",
  poolRate: "0.05",
  poolCap: "100000",
  rounding: "HALF_UP",
  calculator: "SIMPLE_POOL",
};

const proposed: PolicyDefinition = { ...current, version: 2, poolRate: "0.06" };

function input(grossProfit: string): CalculationInput {
  return {
    tenantId: "tenant-1",
    cycleId: "cycle-1",
    policyVersionId: "policy-1",
    mode: "SHADOW",
    order: { id: "order-1", grossProfit, currency: "CNY" },
    participants: [
      {
        personId: "person-1",
        workPackageId: "wp-1",
        attributionWeight: "1",
        role: "OWNER",
      },
    ],
  };
}

describe("simulatePolicyChange", () => {
  it("reports per-person and total deltas", () => {
    const result = simulatePolicyChange(current, proposed, [
      { personId: "person-1", input: input("100000") },
      { personId: "person-2", input: input("200000") },
    ]);
    expect(result.currentTotal).toBe("15000");
    expect(result.proposedTotal).toBe("18000");
    expect(result.deltaTotal).toBe("3000");
    expect(result.affectedPeople).toBe(2);
    expect(result.lines[0]!.delta).toBe("1000");
    expect(result.lines[1]!.delta).toBe("2000");
    expect(result.blockers).toEqual([]);
  });

  it("flags evaluation-weighted policies as not decision-grade in simulation", () => {
    const evaluated: PolicyDefinition = {
      ...current,
      evaluation: {
        dimensionWeights: { QUALITY: "1" },
        floor: "0.5",
        ceiling: "1.5",
      },
    };
    const result = simulatePolicyChange(evaluated, proposed, [
      { personId: "person-1", input: input("100000") },
    ]);
    expect(result.blockers).toContain(
      "EVALUATION_WEIGHTS_NOT_RESOLVED_IN_SIMULATION",
    );
  });
});
