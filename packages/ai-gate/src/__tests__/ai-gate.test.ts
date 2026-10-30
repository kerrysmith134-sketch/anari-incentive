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

import {
  cohenKappa,
  evaluateGate,
  type EvaluationSample,
} from "../evaluate.js";

function sample(
  index: number,
  overrides: Partial<EvaluationSample> = {},
): EvaluationSample {
  const score = (index % 5) + 1;
  return {
    sampleId: `s-${index}`,
    subgroup: index % 2 === 0 ? "ROLE_A" : "ROLE_B",
    humanScoreA: score,
    humanScoreB: score,
    aiScore: score,
    counterfactualScores: [score],
    promptInjectionPassed: true,
    ...overrides,
  };
}

describe("AI evaluation harness", () => {
  it("computes Cohen's kappa", () => {
    expect(cohenKappa([1, 2, 3], [1, 2, 3])).toBe(1);
    expect(cohenKappa([1, 1, 2, 2], [1, 2, 1, 2])).toBe(0);
  });

  it("passes a gate with high agreement and stability", () => {
    const gate = evaluateGate(
      Array.from({ length: 100 }, (_, index) => sample(index)),
      {
        minSampleSize: 10,
        minKappa: 0.6,
        maxSubgroupErrorGap: 0.1,
        minCounterfactualStability: 0.95,
        minPromptInjectionPassRate: 1,
      },
    );
    expect(gate.passed).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  it("blocks when AI-human agreement exceeds human-human agreement", () => {
    const samples = Array.from({ length: 20 }, (_, index) =>
      sample(index, {
        humanScoreA: (index % 5) + 1,
        humanScoreB: index % 2 === 0 ? 1 : 5,
        aiScore: (index % 5) + 1,
      }),
    );
    const gate = evaluateGate(samples, {
      minSampleSize: 10,
      minKappa: 0.1,
      maxSubgroupErrorGap: 1,
      minCounterfactualStability: 0.5,
      minPromptInjectionPassRate: 1,
    });
    expect(gate.passed).toBe(false);
    expect(gate.blockers).toContain("AI_HUMAN_AGREEMENT_ABOVE_HUMAN");
  });

  it("blocks a gate with low human agreement", () => {
    const samples = Array.from({ length: 20 }, (_, index) =>
      sample(index, {
        humanScoreA: index % 2 === 0 ? 1 : 5,
        humanScoreB: index % 2 === 0 ? 5 : 1,
      }),
    );
    const gate = evaluateGate(samples, {
      minSampleSize: 10,
      minKappa: 0.6,
      maxSubgroupErrorGap: 1,
      minCounterfactualStability: 0.5,
      minPromptInjectionPassRate: 1,
    });
    expect(gate.passed).toBe(false);
    expect(gate.blockers).toContain("HUMAN_IRR_TOO_LOW");
  });
});
