import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import {
  calculateOrderContribution,
  compareWithReference,
  deriveEvaluationMultiplier,
} from "../index.js";

const evaluation = {
  dimensionWeights: { QUALITY: "0.5", SPEED: "0.5" },
  floor: "0.8",
  ceiling: "1.2",
};

describe("evaluation multiplier", () => {
  it("maps weighted scores into the configured range", () => {
    const result = deriveEvaluationMultiplier(
      evaluation,
      { QUALITY: 4, SPEED: 3 },
      "person-1",
    );
    expect(result.blockers).toEqual([]);
    expect(result.multiplier).toBe("1.08");
  });

  it("blocks missing and out-of-range scores", () => {
    expect(
      deriveEvaluationMultiplier(evaluation, { QUALITY: 4 }, "person-1")
        .blockers,
    ).toContain("EVALUATION_SCORE_MISSING:person-1:SPEED");
    expect(
      deriveEvaluationMultiplier(
        evaluation,
        { QUALITY: 6, SPEED: 3 },
        "person-1",
      ).blockers,
    ).toContain("EVALUATION_SCORE_OUT_OF_RANGE:person-1:QUALITY");
  });

  it("applies multipliers to attribution weights and preserves the pool", () => {
    const policy: PolicyDefinition = {
      code: "GENERIC_CONTRIBUTION_V1",
      version: 1,
      currency: "CNY",
      poolRate: "0.05",
      poolCap: "100000",
      rounding: "HALF_UP",
      calculator: "SIMPLE_POOL",
    };
    const input: CalculationInput = {
      tenantId: "tenant-1",
      cycleId: "cycle-1",
      policyVersionId: "policy-1",
      mode: "SHADOW",
      order: { id: "order-1", grossProfit: "100000", currency: "CNY" },
      participants: [
        {
          personId: "person-1",
          workPackageId: "wp-1",
          attributionWeight: "0.6",
          evaluationMultiplier: "1.5",
          role: "OWNER",
        },
        {
          personId: "person-2",
          workPackageId: "wp-1",
          attributionWeight: "0.4",
          evaluationMultiplier: "0.5",
          role: "CONTRIBUTOR",
        },
      ],
    };
    const result = calculateOrderContribution(policy, input);
    expect(result.poolRounded).toBe("5000");
    const owner = Number(
      result.lines.find((line) => line.personId === "person-1")!.roundedAmount,
    );
    const member = Number(
      result.lines.find((line) => line.personId === "person-2")!.roundedAmount,
    );
    expect(owner).toBeGreaterThan(member);
    expect(owner + member).toBeCloseTo(5000, 6);
    expect(compareWithReference(policy, input, result.lines)).toEqual([]);
  });
});
