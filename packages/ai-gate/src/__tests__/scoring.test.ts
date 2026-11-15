import { describe, expect, it } from "vitest";
import { scoreEvidence, type EvaluationGate } from "../index.js";

const passedGate: EvaluationGate = { passed: true, sampleSize: 100, metrics: {}, blockers: [] };

describe("retired numeric evidence scoring", () => {
  it("fails closed even when a model evaluation gate passed", () => {
    expect(() => scoreEvidence({ dimensions: ["QUALITY"], evidence: [] }, passedGate))
      .toThrow("AI_NUMERIC_SCORING_DISABLED");
  });
});
