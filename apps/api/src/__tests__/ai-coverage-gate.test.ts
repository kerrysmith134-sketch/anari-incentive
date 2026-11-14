/*
 * NPV2-004/005/006 回归：numeric AI 提案默认关闭；确定性覆盖评估始终可用；
 * 零分只能在 ASSESSED 维度出现。
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";

let app: FastifyInstance;
let platformStore: MemoryPlatformStore;

async function call(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

function harnessSamples(count = 100) {
  return Array.from({ length: count }, (_, index) => {
    const score = (index % 5) + 1;
    return {
      sampleId: `harness-${index}`,
      subgroup: index % 2 === 0 ? "ROLE_A" : "ROLE_B",
      humanScoreA: score,
      humanScoreB: score,
      aiScore: score,
      counterfactualScores: [score],
      promptInjectionPassed: true,
      holdout: index % 5 === 0,
    };
  });
}

async function passedEvaluation(goldSet: string) {
  return call("POST", "/api/v1/model-evaluation-runs:evaluate", {
    evaluationType: "IRR",
    modelProvider: "anthropic",
    modelName: "claude",
    promptVersion: "v1",
    datasetRef: goldSet,
    samples: harnessSamples(),
    thresholds: {
      minSampleSize: 10,
      minKappa: 0.6,
      maxSubgroupErrorGap: 0.1,
      minCounterfactualStability: 0.95,
      minPromptInjectionPassRate: 1,
      minHoldoutSampleSize: 10,
    },
  });
}

const evidence = [
  { id: "cov-e1", type: "DELIVERY", text: "a", dimension: "QUALITY", quality: "VALID" },
  { id: "cov-e2", type: "DELIVERY", text: "b", dimension: "TIMELINESS", quality: "VALID" },
];

beforeEach(() => {
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: ADMIN, employeeCode: "E003", displayName: "Finance" },
      ],
    },
  });
  app = buildApp(new Store(), undefined, undefined, platformStore);
});

describe("AI numeric scoring gate (NPV2-006)", () => {
  it("rejects numeric proposals by default and points at coverage", async () => {
    const evaluation = await passedEvaluation("gate-off");
    const response = await call("POST", "/api/v1/ai-score-proposals", {
      cycleId: CYCLE,
      personId: OWNER,
      requestedBy: OWNER,
      evaluationRunId: evaluation.body.data.id,
      dimensions: ["QUALITY"],
      evidence,
    });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain("AI_NUMERIC_SCORING_DISABLED");
    expect(response.body.error.message).toContain("/api/v1/ai-evidence-coverage");
  });

  it("allows numeric proposals only when the tenant explicitly enables them", async () => {
    const enable = await call("POST", "/api/v1/platform/tenants/tenant-demo/settings", {
      aiNumericScoringEnabled: true,
    });
    expect(enable.status).toBeLessThan(300);
    const evaluation = await passedEvaluation("gate-on");
    const response = await call("POST", "/api/v1/ai-score-proposals", {
      cycleId: CYCLE,
      personId: OWNER,
      requestedBy: OWNER,
      evaluationRunId: evaluation.body.data.id,
      dimensions: ["QUALITY", "TIMELINESS"],
      evidence,
    });
    expect(response.status).toBe(201);
    expect(response.body.data.overallScore).toBeGreaterThan(0);
  });
});

describe("deterministic evidence coverage endpoint (NPV2-004)", () => {
  it("assesses coverage without any numeric score", async () => {
    const response = await call("POST", "/api/v1/ai-evidence-coverage", {
      subjectType: "PERSON",
      subjectId: OWNER,
      cycleId: CYCLE,
      dimensions: ["QUALITY", "TIMELINESS"],
      evidence: [evidence[0]],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.coverageBand).toBe("PARTIAL");
    expect(response.body.data.missingDimensions).toEqual(["TIMELINESS"]);
    expect(JSON.stringify(response.body.data)).not.toContain("overallScore");
    const again = await call("POST", "/api/v1/ai-evidence-coverage", {
      subjectType: "PERSON",
      subjectId: OWNER,
      cycleId: CYCLE,
      dimensions: ["QUALITY", "TIMELINESS"],
      evidence: [evidence[0]],
    });
    expect(again.body.data.evidenceSnapshotHash).toBe(
      response.body.data.evidenceSnapshotHash,
    );
  });

  it("rejects unknown subjects", async () => {
    const response = await call("POST", "/api/v1/ai-evidence-coverage", {
      subjectType: "PERSON",
      subjectId: "00000000-0000-4000-8000-0000000000ff",
      cycleId: CYCLE,
      dimensions: ["QUALITY"],
      evidence: [],
    });
    expect(response.status).toBe(404);
  });
});

describe("zero-score state semantics (NPV2-005)", () => {
  it("refuses a zero score on a dimension explicitly marked NOT_APPLICABLE", async () => {
    await call("POST", "/api/v1/platform/tenants/tenant-demo/settings", {
      aiNumericScoringEnabled: true,
      evidenceDefaultRule: "ZERO",
    });
    const evaluation = await passedEvaluation("state-zero");
    const response = await call("POST", "/api/v1/ai-score-proposals", {
      cycleId: CYCLE,
      personId: OWNER,
      evaluationRunId: evaluation.body.data.id,
      dimensions: ["QUALITY", "TIMELINESS"],
      evidence: [evidence[0]],
      zeroScoreRationale: "本周期未参与交付，经复核确认为零",
      dimensionStates: {
        QUALITY: "ASSESSED",
        TIMELINESS: "NOT_APPLICABLE",
      },
    });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain(
      "AI_ZERO_SCORE_REQUIRES_ASSESSED",
    );
  });
});
