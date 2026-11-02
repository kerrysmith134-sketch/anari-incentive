import { describe, expect, it } from "vitest";
import { assessAiRisk } from "../risk.js";

describe("AI risk classification", () => {
  it("keeps an explicitly low, well-evidenced proposal low", () => {
    const result = assessAiRisk({
      overallScore: 4,
      confidence: 0.9,
      evidenceCount: 4,
      requestedTier: "LOW",
    });
    expect(result.riskTier).toBe("LOW");
    expect(result.secondReviewRequired).toBe(false);
    expect(result.secondReviewSlaHours).toBeUndefined();
  });

  it("escalates zero-scored dimensions to critical and never downgrades", () => {
    const result = assessAiRisk({
      overallScore: 4,
      confidence: 1,
      evidenceCount: 6,
      hasZeroScore: true,
      requestedTier: "LOW",
    });
    expect(result.riskTier).toBe("CRITICAL");
    expect(result.secondReviewRequired).toBe(true);
    expect(result.secondReviewSlaHours).toBe(8);
    expect(result.riskReasons).toContain("ZERO_SCORE_ADVERSE_IMPACT");
  });

  it("requires a second review for low confidence and sparse evidence", () => {
    const result = assessAiRisk({
      overallScore: 3,
      confidence: 0.3,
      evidenceCount: 1,
    });
    expect(result.riskTier).toBe("HIGH");
    expect(result.secondReviewRequired).toBe(true);
    expect(result.secondReviewSlaHours).toBe(24);
    expect(result.riskReasons).toEqual(
      expect.arrayContaining(["LOW_CONFIDENCE", "LIMITED_EVIDENCE"]),
    );
  });
});
