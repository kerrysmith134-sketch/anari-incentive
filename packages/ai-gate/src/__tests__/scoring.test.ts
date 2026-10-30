import { describe, expect, it } from "vitest";
import { AiGateError, scoreEvidence, type EvaluationGate } from "../index.js";

const passedGate: EvaluationGate = {
  passed: true,
  sampleSize: 100,
  metrics: {},
  blockers: [],
};

describe("AI numeric scoring gate", () => {
  it("scores evidence only when the evaluation gate passed", () => {
    const result = scoreEvidence(
      {
        dimensions: ["QUALITY", "TIMELINESS"],
        evidence: [
          { id: "e1", type: "DELIVERY", text: "Signed", dimension: "QUALITY", quality: "VALID" },
          { id: "e2", type: "DELIVERY", text: "On time", dimension: "TIMELINESS", quality: "UNVERIFIED" },
          { id: "e3", type: "DELIVERY", text: "Late", dimension: "TIMELINESS", quality: "STALE" },
        ],
      },
      passedGate,
    );
    expect(result.scores.QUALITY).toBeGreaterThan(0);
    expect(result.scores.TIMELINESS).toBeLessThan(
      result.scores.QUALITY as number,
    );
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.citations).toEqual(["e1", "e2", "e3"]);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("flags dimensions without usable evidence instead of silently zeroing", () => {
    const result = scoreEvidence(
      {
        dimensions: ["QUALITY", "COLLABORATION"],
        evidence: [
          {
            id: "e1",
            type: "DELIVERY",
            text: "Signed",
            dimension: "QUALITY",
            quality: "VALID",
          },
        ],
      },
      passedGate,
    );
    expect(result.insufficientEvidence).toEqual(["COLLABORATION"]);
    expect(result.scores.COLLABORATION).toBe(0);
  });

  it("refuses to score when the gate failed", () => {
    expect(() =>
      scoreEvidence(
        { dimensions: ["QUALITY"], evidence: [] },
        { ...passedGate, passed: false, blockers: ["HUMAN_IRR_TOO_LOW"] },
      ),
    ).toThrow(AiGateError);
  });
});
