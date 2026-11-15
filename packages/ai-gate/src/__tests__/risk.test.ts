import { describe, expect, it } from "vitest";
import { assessAiRisk } from "../risk.js";

describe("retired numeric AI risk classification", () => {
  it("fails closed so score-derived risk tiers cannot be revived", () => {
    expect(() => assessAiRisk({ overallScore: 0, confidence: 0.1, evidenceCount: 0 }))
      .toThrow("AI_NUMERIC_SCORING_DISABLED");
  });
});
