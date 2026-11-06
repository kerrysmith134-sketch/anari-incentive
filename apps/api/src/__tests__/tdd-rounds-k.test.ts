/*
 * TDD rounds 137–148: fifth wave — AI-04 pre-review workflow, ATT-06
 * independent judgment enforcement, employee claim self-service.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";
const POLICY = "00000000-0000-4000-8000-000000000100";

let app: FastifyInstance;
let appStore: Store;
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
  appStore = new Store();
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: MEMBER, employeeCode: "E002", displayName: "Contributor" },
        { id: ADMIN, employeeCode: "E003", displayName: "Adjudicator" },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore);
});

async function seedCycleWindow(): Promise<string> {
  // Create a cycle whose window covers "now" so claims filed now count.
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 864e5).toISOString();
  const end = new Date(now.getTime() + 7 * 864e5).toISOString();
  const cycle = await call("POST", "/api/v1/evaluation-cycles", {
    name: "预审测试周期",
    cycleType: "MONTHLY",
    startsAt: start,
    endsAt: end,
    timezone: "Asia/Shanghai",
  });
  expect(cycle.status).toBe(201);
  return cycle.body.data.id;
}

async function seedClaimWithEvidence(personId: string): Promise<string> {
  const created = await call("POST", "/api/v1/work-packages", {
    title: `预审工作包 ${personId.slice(-4)}`,
    objective: "验证 AI 预审链路",
    ownerPersonId: personId,
    members: [
      { personId, responsibilityCode: "OWNER", expectedOutput: "x" },
    ],
    acceptanceCriteria: ["ok"],
  });
  const workPackageId = created.body.data.id;
  await call("POST", "/api/v1/evidence", {
    subjectType: "WORK_PACKAGE",
    subjectId: workPackageId,
    evidenceType: "DELIVERABLE",
    sourceSystem: "tdd",
    observedAt: new Date().toISOString(),
    normalizedPayload: { note: "delivered" },
  });
  for (const [step, payload] of [
    ["commit", { expectedVersion: 1 }],
    ["start", {}],
    ["submit", {}],
    ["accept", { reviewerPersonId: ADMIN }],
  ] as const) {
    await call(
      "POST",
      `/api/v1/work-packages/${workPackageId}/${step}`,
      payload as Record<string, unknown>,
    );
  }
  const claim = await call("POST", "/api/v1/contribution-claims", {
    workPackageId,
    claimantPersonId: personId,
    claimType: "DELIVERABLE_CONTRIBUTION",
    claimedContribution: { dimensions: ["QUALITY"], summary: "按标准交付" },
    evidenceRefs: [],
    rationale: "按期交付并附证据",
  });
  expect(claim.status).toBe(201);
  return claim.body.data.id;
}

// ---------------------------------------------------------------------------
// Rounds 137–140 — AI-04 pre-review workflow.
// ---------------------------------------------------------------------------
describe("rounds 137–140: AI pre-review generates agent drafts", () => {
  it("round 137: generates one AGENT draft per claimant with provenance", async () => {
    const cycleId = await seedCycleWindow();
    await seedClaimWithEvidence(OWNER);
    await seedClaimWithEvidence(MEMBER);
    const pre = await call(
      "POST",
      `/api/v1/evaluation-cycles/${cycleId}/pre-review`,
      {},
    );
    expect(pre.status).toBe(200);
    expect(pre.body.data.created).toHaveLength(2);
    for (const draft of pre.body.data.created) {
      expect(draft.draftId).toBeTruthy();
      expect([0, 1]).toContain(draft.evidenceCount);
    }
    const drafts = await call(
      "GET",
      `/api/v1/evaluation-drafts?cycleId=${cycleId}`,
    );
    const agentDrafts = drafts.body.data.filter(
      (draft: { generatedByType: string }) => draft.generatedByType === "AGENT",
    );
    expect(agentDrafts).toHaveLength(2);
    for (const draft of agentDrafts) {
      expect(draft.modelProvider).toBe("builtin");
      expect(draft.promptVersion).toBe("pre-review-v1");
    }
  });

  it("round 138: is idempotent per cycle+person", async () => {
    const cycleId = await seedCycleWindow();
    await seedClaimWithEvidence(OWNER);
    const first = await call(
      "POST",
      `/api/v1/evaluation-cycles/${cycleId}/pre-review`,
      {},
    );
    expect(first.body.data.created).toHaveLength(1);
    const second = await call(
      "POST",
      `/api/v1/evaluation-cycles/${cycleId}/pre-review`,
      {},
    );
    expect(second.body.data.created).toHaveLength(0);
    expect(second.body.data.skipped[0].reason).toBe("ALREADY_PRE_REVIEWED");
  });

  it("round 139: writes an ai_suggestion_logs entry per draft", async () => {
    const cycleId = await seedCycleWindow();
    await seedClaimWithEvidence(OWNER);
    await call("POST", `/api/v1/evaluation-cycles/${cycleId}/pre-review`, {});
    const logs = await call("GET", "/api/v1/ai-suggestion-logs");
    const preReviewLogs = logs.body.data.filter(
      (log: { suggestionType: string }) =>
        log.suggestionType === "PRE_REVIEW_DRAFT",
    );
    expect(preReviewLogs).toHaveLength(1);
    expect(preReviewLogs[0].modelProvider).toBe("builtin");
    expect(preReviewLogs[0].validationStatus).toBe("VALIDATED");
  });

  it("round 140: reports when the cycle window has no claimants", async () => {
    const cycleId = await seedCycleWindow();
    const pre = await call(
      "POST",
      `/api/v1/evaluation-cycles/${cycleId}/pre-review`,
      {},
    );
    expect(pre.status).toBe(200);
    expect(pre.body.data.created).toHaveLength(0);
    expect(pre.body.data.note).toContain("无可预审对象");
  });
});

// ---------------------------------------------------------------------------
// Rounds 141–144 — ATT-06 independent judgment enforcement.
// ---------------------------------------------------------------------------
describe("rounds 141–144: ATT-06 independent judgment is mandatory", () => {
  async function submittedDraft(): Promise<string> {
    const cycleId = await seedCycleWindow();
    const rubric = await call("POST", "/api/v1/rubrics", {
      code: `RUB-${Date.now()}`,
      name: "TDD rubric",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-01-01",
    });
    const draft = await call("POST", "/api/v1/evaluation-drafts", {
      cycleId,
      personId: MEMBER,
      generatedByType: "AGENT",
      evidenceSnapshotHash: `ev-${Date.now()}`,
      draftPayload: { summary: "AI 预审草稿" },
    });
    await call("POST", `/api/v1/evaluation-drafts/${draft.body.data.id}/submit`);
    return draft.body.data.id;
  }

  it("round 141: rejects a decision without independentScores", async () => {
    const draftId = await submittedDraft();
    const rubric = await call("GET", "/api/v1/rubrics");
    const decision = await call(
      "POST",
      `/api/v1/evaluation-drafts/${draftId}/decision`,
      {
        reviewerPersonId: ADMIN,
        rubricVersionId: rubric.body.data[0].id,
        decision: "APPROVE",
        scores: { QUALITY: 4 },
        rationale: "复核通过",
      },
    );
    expect(decision.status).toBe(400);
  });

  it("round 142: rejects an empty independent rationale", async () => {
    const draftId = await submittedDraft();
    const rubric = await call("GET", "/api/v1/rubrics");
    const decision = await call(
      "POST",
      `/api/v1/evaluation-drafts/${draftId}/decision`,
      {
        reviewerPersonId: ADMIN,
        rubricVersionId: rubric.body.data[0].id,
        decision: "APPROVE",
        scores: { QUALITY: 4 },
        rationale: "复核通过",
        independentScores: { QUALITY: 4 },
        independentRationale: "",
      },
    );
    expect(decision.status).toBe(400);
  });

  it("round 143: a complete independent judgment is accepted and persisted", async () => {
    const draftId = await submittedDraft();
    const rubric = await call("GET", "/api/v1/rubrics");
    const decision = await call(
      "POST",
      `/api/v1/evaluation-drafts/${draftId}/decision`,
      {
        reviewerPersonId: ADMIN,
        rubricVersionId: rubric.body.data[0].id,
        decision: "APPROVE",
        scores: { QUALITY: 4 },
        rationale: "复核通过",
        independentScores: { QUALITY: 4 },
        independentRationale: "先独立判断：证据覆盖充分",
        evidenceOpened: 2,
      },
    );
    expect(decision.status).toBeLessThan(300);
    const persisted = decision.body.data.decision;
    expect(persisted.independentScores).toEqual({ QUALITY: 4 });
    expect(persisted.independentRationale).toContain("先独立判断");
    expect(persisted.evidenceOpened).toBe(2);
  });

  it("round 144: the reviewer still cannot be the draft subject", async () => {
    const cycleId = await seedCycleWindow();
    const rubric = await call("POST", "/api/v1/rubrics", {
      code: `RUB-S-${Date.now()}`,
      name: "TDD rubric self",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-01-01",
    });
    const draft = await call("POST", "/api/v1/evaluation-drafts", {
      cycleId,
      personId: MEMBER,
      generatedByType: "USER",
      evidenceSnapshotHash: `ev-s-${Date.now()}`,
      draftPayload: { summary: "自我评价草稿" },
    });
    await call("POST", `/api/v1/evaluation-drafts/${draft.body.data.id}/submit`);
    const decision = await call(
      "POST",
      `/api/v1/evaluation-drafts/${draft.body.data.id}/decision`,
      {
        reviewerPersonId: MEMBER,
        rubricVersionId: rubric.body.data.id,
        decision: "APPROVE",
        scores: { QUALITY: 5 },
        rationale: "自我批准尝试",
        independentScores: { QUALITY: 5 },
        independentRationale: "我自己觉得很好",
      },
    );
    expect(decision.status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// Rounds 145–148 — employee claim self-service + identity names.
// ---------------------------------------------------------------------------
describe("round 145: employee files a claim for themselves end to end", () => {
  it("creates the claim scoped to the caller", async () => {
    const created = await call("POST", "/api/v1/work-packages", {
      title: "员工申报工作包",
      objective: "验证员工自助申报",
      ownerPersonId: MEMBER,
      members: [
        { personId: MEMBER, responsibilityCode: "OWNER", expectedOutput: "x" },
      ],
      acceptanceCriteria: ["ok"],
    });
    const workPackageId = created.body.data.id;
    for (const [step, payload] of [
      ["commit", { expectedVersion: 1 }],
      ["start", {}],
      ["submit", {}],
      ["accept", { reviewerPersonId: ADMIN }],
    ] as const) {
      await call(
        "POST",
        `/api/v1/work-packages/${workPackageId}/${step}`,
        payload as Record<string, unknown>,
      );
    }
    const employeeApp = buildApp(
      appStore,
      undefined,
      {
        async authenticate() {
          return {
            tenantId: "tenant-demo",
            userId: "emp-m",
            roles: ["employee"],
            personId: MEMBER,
          };
        },
      },
      platformStore,
    );
    const claim = await employeeApp.inject({
      method: "POST",
      url: "/api/v1/contribution-claims",
      payload: {
        workPackageId,
        claimantPersonId: MEMBER,
        claimType: "DELIVERABLE_CONTRIBUTION",
        claimedContribution: {
          dimensions: ["QUALITY"],
          summary: "完成了本包交付",
        },
        evidenceRefs: [],
        rationale: "按期交付",
      },
    } as never);
    expect(claim.statusCode).toBe(201);
    expect(claim.json().data.claimantPersonId).toBe(MEMBER);
    const forOther = await employeeApp.inject({
      method: "POST",
      url: "/api/v1/contribution-claims",
      payload: {
        workPackageId,
        claimantPersonId: OWNER,
        claimType: "DELIVERABLE_CONTRIBUTION",
        claimedContribution: { dimensions: ["QUALITY"], summary: "代报尝试" },
        evidenceRefs: [],
        rationale: "为他人申报应被拒",
      },
    } as never);
    expect(forOther.statusCode).toBe(403);
  });
});

describe("round 146: identity exposes display and tenant names", () => {
  it("returns displayName and tenantName for a seeded person", async () => {
    const identity = await call("GET", "/api/v1/platform/identity");
    expect(identity.status).toBe(200);
    // Dev header authenticator maps to the demo person; the name should be
    // the person display name, not a raw id.
    expect(identity.body.data.displayName).toBeTruthy();
    expect(identity.body.data.displayName).not.toMatch(/^[0-9a-f-]{36}$/);
    expect(identity.body.data.tenantName).toBe("Demo tenant");
  });
});

describe("round 147: metric definitions seed registers the PRD seven", () => {
  it("in-memory metric registry API stays functional", async () => {
    const created = await call("POST", "/api/v1/metric-definitions", {
      code: "EVIDENCE_COVERAGE",
      version: 1,
      name: "证据覆盖率",
      description: "已验收工作包中附有有效证据的占比",
      dataType: "PERCENT",
      unit: "%",
      aggregationMethod: "AVG",
      sourceContract: { target: 70 },
      effectiveFrom: "2026-01-01",
    });
    expect(created.status).toBe(201);
    const list = await call("GET", "/api/v1/metric-definitions");
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe("round 148: pre-review is manager/admin gated", () => {
  it("returns 403 for an employee", async () => {
    const cycleId = await seedCycleWindow();
    const employeeApp = buildApp(
      appStore,
      undefined,
      {
        async authenticate() {
          return {
            tenantId: "tenant-demo",
            userId: "emp-m",
            roles: ["employee"],
            personId: MEMBER,
          };
        },
      },
      platformStore,
    );
    const response = await employeeApp.inject({
      method: "POST",
      url: `/api/v1/evaluation-cycles/${cycleId}/pre-review`,
      payload: {},
    } as never);
    expect(response.statusCode).toBe(403);
  });
});
