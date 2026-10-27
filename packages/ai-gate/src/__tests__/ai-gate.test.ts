import { describe, expect, it } from "vitest";
import {
  AiGateError,
  EvidenceAssistant,
  assertScoringAllowed,
} from "../index.js";

const evidence = [
  {
    id: "ev-1",
    source: "crm",
    type: "ORDER",
    text: "Order delivered and accepted",
  },
  {
    id: "ev-2",
    source: "ticket",
    type: "SUPPORT",
    text: "Customer confirmed the technical validation",
  },
];

describe("AI evaluation gate", () => {
  it("blocks scoring before the evaluation gate passes", () => {
    expect(() =>
      assertScoringAllowed({
        passed: false,
        sampleSize: 50,
        metrics: {},
        blockers: ["GOLD_SET_TOO_SMALL"],
      }),
    ).toThrow(AiGateError);
  });

  it("blocks scoring when the gate is missing", () => {
    expect(() => assertScoringAllowed(undefined)).toThrow(/GATE_MISSING/);
  });

  it("allows scoring only after a passed gate", () => {
    expect(() =>
      assertScoringAllowed({
        passed: true,
        sampleSize: 200,
        metrics: {
          interRaterReliability: 0.81,
          subgroupMaxErrorGap: 0.04,
          counterfactualStability: 0.97,
          promptInjectionPassRate: 1,
        },
        blockers: [],
      }),
    ).not.toThrow();
  });
});

describe("EvidenceAssistant", () => {
  it("summarizes with citations and reports missing evidence types", () => {
    const assistant = new EvidenceAssistant();
    const result = assistant.summarize(evidence, [
      "ORDER",
      "SUPPORT",
      "ACCEPTANCE",
    ]);
    expect(result.citations).toEqual(["ev-1@crm", "ev-2@ticket"]);
    expect(result.gaps).toEqual(["ACCEPTANCE"]);
    expect(result.summary).toContain("Order delivered");
  });

  it("detects gaps without producing a score", () => {
    const assistant = new EvidenceAssistant();
    expect(assistant.detectGaps(["ORDER", "ACCEPTANCE"], evidence)).toEqual([
      "ACCEPTANCE",
    ]);
  });
});
