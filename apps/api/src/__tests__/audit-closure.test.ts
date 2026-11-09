import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";

let app: FastifyInstance;
let platformStore: MemoryPlatformStore;

async function call(
  method: "GET" | "POST" | "PUT",
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

beforeEach(() => {
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: MEMBER, employeeCode: "E002", displayName: "Contributor" },
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
  app = buildApp(new Store(), undefined, undefined, platformStore);
});

async function decidedDraft(reviewerPersonId: string): Promise<string> {
  const now = new Date();
  const cycle = await call("POST", "/api/v1/evaluation-cycles", {
    name: `一致性周期-${reviewerPersonId.slice(-1)}`,
    cycleType: "QUARTERLY",
    startsAt: new Date(now.getTime() - 864e5).toISOString(),
    endsAt: new Date(now.getTime() + 864e5).toISOString(),
    timezone: "Asia/Shanghai",
  });
  const cycleId = cycle.body.data.id;
  const rubric = await call("POST", "/api/v1/rubrics", {
    code: `RUB-AGREE-${Date.now()}-${reviewerPersonId.slice(-1)}`,
    name: "一致性 rubric",
    dimensions: ["QUALITY", "IMPACT"],
    scoringAnchors: {},
    effectiveFrom: "2026-01-01",
  });
  const draft = await call("POST", "/api/v1/evaluation-drafts", {
    cycleId,
    personId: MEMBER,
    generatedByType: "USER",
    evidenceSnapshotHash: `ev-${reviewerPersonId}-${Date.now()}`,
    draftPayload: { summary: "复核" },
  });
  await call("POST", `/api/v1/evaluation-drafts/${draft.body.data.id}/submit`);
  const decision = await call(
    "POST",
    `/api/v1/evaluation-drafts/${draft.body.data.id}/decision`,
    {
      reviewerPersonId,
      rubricVersionId: rubric.body.data.id,
      decision: "APPROVE",
      scores: { QUALITY: 4, IMPACT: 3 },
      rationale: "复核通过",
      independentScores: { QUALITY: 4, IMPACT: 3 },
      independentRationale: "先独立判断",
    },
  );
  expect(decision.status).toBeLessThan(300);
  return cycleId;
}

describe("audit closure endpoints", () => {
  it("computes reviewer agreement and stores a snapshot", async () => {
    await decidedDraft(OWNER);
    await decidedDraft(ADMIN);
    // Different cycles are not paired; create a same-cycle pair through the store.
    const now = new Date();
    const cycle = await call("POST", "/api/v1/evaluation-cycles", {
      name: "配对周期",
      cycleType: "QUARTERLY",
      startsAt: new Date(now.getTime() - 864e5).toISOString(),
      endsAt: new Date(now.getTime() + 864e5).toISOString(),
      timezone: "Asia/Shanghai",
    });
    const cycleId = cycle.body.data.id;
    const rubric = await call("POST", "/api/v1/rubrics", {
      code: `RUB-PAIR-${Date.now()}`,
      name: "配对 rubric",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-01-01",
    });
    for (const [reviewer, score] of [
      [OWNER, 4],
      [ADMIN, 5],
    ] as const) {
      const draft = await call("POST", "/api/v1/evaluation-drafts", {
        cycleId,
        personId: MEMBER,
        generatedByType: "USER",
        evidenceSnapshotHash: `pair-${reviewer}-${Date.now()}`,
        draftPayload: { summary: "配对" },
      });
      const submitted = await call("POST", `/api/v1/evaluation-drafts/${draft.body.data.id}/submit`);
      const decided = await call(
        "POST",
        `/api/v1/evaluation-drafts/${draft.body.data.id}/decision`,
        {
          reviewerPersonId: reviewer,
          rubricVersionId: rubric.body.data.id,
          decision: "APPROVE",
          scores: { QUALITY: score },
          rationale: "复核通过",
          independentScores: { QUALITY: score },
          independentRationale: "独立判断",
        },
      );
      expect(submitted.status).toBeLessThan(300);
      expect(decided.status).toBeLessThan(300);
    }
    const report = await call("GET", "/api/v1/reports/reviewer-agreement");
        expect(report.status).toBe(200);
    expect(report.body.data.pairCount).toBe(1);
    expect(report.body.data.exactAgreementRate).toBe(0);
    expect(report.body.data.withinOneRate).toBe(1);
    const snapshot = await call(
      "POST",
      "/api/v1/reports/reviewer-agreement:snapshot",
    );
    expect(snapshot.status).toBe(201);
    expect(snapshot.body.data.recordType).toBe("REVIEWER_AGREEMENT_AUDIT");
  });

  it("finalizes and exports an annual review snapshot", async () => {
    const finalized = await call(
      "POST",
      "/api/v1/reports/policy-review:finalize",
      {
        from: "2025-11-01T00:00:00Z",
        to: "2026-11-01T00:00:00Z",
        report: { policies: { published: 3 }, appeals: { open: 1 } },
        signedOffBy: ADMIN,
      },
    );
    expect(finalized.status).toBe(201);
    expect(finalized.body.data.status).toBe("FINAL");
    expect(finalized.body.data.payload.reportHash).toContain("sha256:");
    const snapshots = await call(
      "GET",
      "/api/v1/reports/policy-review/snapshots",
    );
    expect(snapshots.body.data).toHaveLength(1);
    const exportResponse = await app.inject({
      method: "GET",
      url: `/api/v1/reports/policy-review/snapshots/${finalized.body.data.id}/export`,
    } as never);
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.body).toContain("年度制度审查报告");
    expect(exportResponse.body).toContain("sha256:");
  });

  it("persists gold-set samples and re-evaluates from datasetRef only", async () => {
    const imported = await call(
      "POST",
      "/api/v1/model-evaluation-datasets:import",
      {
        code: "GOLD-REF-ONLY",
        name: "金标集",
        labelSource: "专家双评",
        ownerPersonId: ADMIN,
        refreshedAt: new Date().toISOString(),
        nextRefreshDueAt: new Date(Date.now() + 90 * 864e5).toISOString(),
        samples: [
          {
            sampleId: "s1",
            subgroup: "A",
            humanScoreA: 4,
            humanScoreB: 4,
            aiScore: 4,
            counterfactualScores: [4],
            promptInjectionPassed: true,
          },
          {
            sampleId: "s2",
            subgroup: "A",
            humanScoreA: 3,
            humanScoreB: 3,
            aiScore: 3,
            counterfactualScores: [3],
            promptInjectionPassed: true,
          },
        ],
      },
    );
    expect(imported.status).toBe(201);
    const samples = await call(
      "GET",
      `/api/v1/model-evaluation-datasets/${imported.body.data.dataset.id}/samples`,
    );
    expect(samples.body.data.samples).toHaveLength(2);
    const evaluated = await call(
      "POST",
      "/api/v1/model-evaluation-runs:evaluate",
      {
        evaluationType: "DRAFT_QUALITY",
        modelProvider: "builtin",
        modelName: "m",
        promptVersion: "v1",
        datasetRef: "GOLD-REF-ONLY",
      },
    );
    expect(evaluated.status).toBe(201);
    expect(evaluated.body.data.datasetRef).toBe("GOLD-REF-ONLY");
  });

  it("manages statutory deduction types and legal bases", async () => {
    const put = await call("PUT", "/api/v1/statutory-deduction-types", {
      types: [
        {
          type: "COURT_ORDER",
          priority: 0,
          capRate: "0.5",
          requiresCourtOrder: true,
        },
      ],
    });
    expect(put.status).toBe(200);
    const get = await call("GET", "/api/v1/statutory-deduction-types");
    expect(get.body.data[0].type).toBe("COURT_ORDER");
    const bases = await call("PUT", "/api/v1/deduction-legal-bases", {
      bases: { COURT_ORDER: { courtOrderRef: "C-1" } },
    });
    expect(bases.status).toBe(200);
  });

  it("creates gold label tasks and training runs", async () => {
    const task = await call("POST", "/api/v1/gold-label-tasks", {
      datasetId: "00000000-0000-4000-8000-000000000099",
      sampleIds: ["s1"],
      assigneePersonId: ADMIN,
    });
    expect(task.status).toBe(201);
    const completed = await call(
      "POST",
      `/api/v1/gold-label-tasks/${task.body.data.id}/complete`,
      { completedBy: ADMIN, scores: { s1: 4 } },
    );
    expect(completed.body.data.status).toBe("COMPLETED");
    const training = await call("POST", "/api/v1/model-training-runs", {
      datasetId: "00000000-0000-4000-8000-000000000099",
      baseModel: "m",
      promptVersion: "v1",
    });
    expect(training.status).toBe(201);
    const callback = await call(
      "POST",
      `/api/v1/model-training-runs/${training.body.data.id}/callback`,
      { status: "SUCCEEDED", metrics: { kappa: 0.8 }, artifactRef: "s3://m" },
    );
    expect(callback.body.data.status).toBe("SUCCEEDED");
  });
});
