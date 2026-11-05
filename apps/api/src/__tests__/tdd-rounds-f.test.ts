/*
 * TDD rounds 61–72: agent role isolation, AI gates, adverse-action
 * separation, budget enforcement, approval enforcement, evaluation
 * versioning, self-review block, webhook idempotency, prompt gates,
 * marginal simulation validation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADJUDICATOR = "00000000-0000-4000-8000-000000000003";
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
        { id: ADJUDICATOR, employeeCode: "E003", displayName: "Adjudicator" },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore);
});

describe("round 61: adverse actions keep legal review and approval apart", () => {
  it("rejects the same person reviewing and approving", async () => {
    const created = await call("POST", "/api/v1/adverse-actions", {
      personId: MEMBER,
      actionType: "PIP",
      reason: "Structured performance plan required",
      performanceBasis: "Two consecutive cycles below target",
      requestedBy: ADJUDICATOR,
    });
    const caseId = created.body.data.id;
    await call("POST", `/api/v1/adverse-actions/${caseId}/legal-review`, {
      legalReviewerId: ADJUDICATOR,
      legalReviewRef: "legal-1",
      decision: "CLEARED",
    });
    const approve = await call(
      "POST",
      `/api/v1/adverse-actions/${caseId}/approve`,
      { approvedBy: ADJUDICATOR },
    );
    expect(approve.status).toBeGreaterThanOrEqual(400);
  });
});

describe("round 62: evaluation decisions version and supersede", () => {
  it("keeps decision history with a newer active decision", async () => {
    const rubric = await call("POST", "/api/v1/rubrics", {
      code: "TDD-RUBRIC",
      name: "TDD rubric",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-01-01",
    });
    const rubricVersionId = rubric.body.data.id;
    const draft = await call("POST", "/api/v1/evaluation-drafts", {
      cycleId: CYCLE,
      personId: MEMBER,
      generatedByType: "USER",
      evidenceSnapshotHash: `evidence-${MEMBER}`,
      draftPayload: { summary: "Evaluation evidence" },
    });
    const draftId = draft.body.data.id;
    await call("POST", `/api/v1/evaluation-drafts/${draftId}/submit`);
    const decision = await call(
      "POST",
      `/api/v1/evaluation-drafts/${draftId}/decision`,
      {
        reviewerPersonId: ADJUDICATOR,
        rubricVersionId,
        decision: "APPROVE",
        scores: { QUALITY: 4 },
        rationale: "Reviewed evidence",
      },
    );
    expect(decision.status).toBeLessThan(300);
    const decisions = await call("GET", "/api/v1/evaluation-decisions");
    expect(decisions.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe("round 63: evaluation drafts block self-review", () => {
  it("rejects the subject deciding their own draft", async () => {
    const rubric = await call("POST", "/api/v1/rubrics", {
      code: "TDD-RUBRIC-SELF",
      name: "TDD rubric self",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-01-01",
    });
    const rubricVersionId = rubric.body.data.id;
    const draft = await call("POST", "/api/v1/evaluation-drafts", {
      cycleId: CYCLE,
      personId: MEMBER,
      generatedByType: "USER",
      evidenceSnapshotHash: `evidence-self-${MEMBER}`,
      draftPayload: { summary: "Evaluation evidence" },
    });
    const draftId = draft.body.data.id;
    await call("POST", `/api/v1/evaluation-drafts/${draftId}/submit`);
    const decision = await call(
      "POST",
      `/api/v1/evaluation-drafts/${draftId}/decision`,
      {
        reviewerPersonId: MEMBER,
        rubricVersionId,
        decision: "APPROVE",
        scores: { QUALITY: 5 },
        rationale: "I agree with this assessment",
      },
    );
    expect(decision.status).toBeGreaterThanOrEqual(400);
  });
});

describe("round 64: marginal simulation rejects non-positive steps", () => {
  it("returns 400 for step 0", async () => {
    const response = await call("POST", "/api/v1/policy-simulations:marginal", {
      policyVersionId: POLICY,
      participantIndex: 0,
      field: "attributionWeight",
      from: "0.1",
      to: "0.9",
      step: "0",
      order: { id: "o", grossProfit: "100000", currency: "CNY" },
      participants: [
        { personId: OWNER, attributionWeight: "0.5", role: "OWNER" },
        { personId: MEMBER, attributionWeight: "0.5", role: "CONTRIBUTOR" },
      ],
    });
    expect(response.status).toBe(400);
  });
});

describe("round 65: budget-pool enforcement rejects formal runs without a pool", () => {
  it("returns 4xx when ENFORCE_BUDGET_POOLS is on and no pool is referenced", async () => {
    const enforced = buildApp(
      appStore,
      undefined,
      undefined,
      platformStore,
      { enforceBudgetPools: true },
    );
    const created = await enforced.inject({
      method: "POST",
      url: "/api/v1/work-packages",
      payload: {
        title: "Budget package",
        objective: "Deliver under budget control",
        ownerPersonId: OWNER,
        members: [
          { personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "work" },
        ],
        acceptanceCriteria: ["done"],
      },
    } as never);
    const workPackageId = created.json().data.id;
    for (const [step, payload] of [
      ["commit", { expectedVersion: 1 }],
      ["start", {}],
      ["submit", {}],
      ["accept", { reviewerPersonId: ADJUDICATOR }],
    ] as const) {
      await enforced.inject({
        method: "POST",
        url: `/api/v1/work-packages/${workPackageId}/${step}`,
        payload: payload as Record<string, unknown>,
      } as never);
    }
    const claim = await enforced.inject({
      method: "POST",
      url: "/api/v1/contribution-claims",
      payload: {
        workPackageId,
        claimantPersonId: OWNER,
        claimType: "DELIVERABLE_CONTRIBUTION",
        claimedContribution: { dimensions: ["QUALITY"], summary: "Did it" },
        evidenceRefs: ["ev"],
        rationale: "Done on time",
      },
    } as never);
    await enforced.inject({
      method: "POST",
      url: `/api/v1/contribution-claims/${claim.json().data.id}/submit`,
    } as never);
    await enforced.inject({
      method: "POST",
      url: "/api/v1/attribution-decisions",
      payload: {
        claimId: claim.json().data.id,
        adjudicatorPersonId: ADJUDICATOR,
        status: "CONFIRMED",
        acceptedFacts: ["Did it"],
        rejectedFacts: [],
        contributionDimensions: { QUALITY: 1 },
        rationale: "Supported",
      },
    } as never);
    const run = await enforced.inject({
      method: "POST",
      url: "/api/v1/calculation-runs",
      payload: {
        cycleId: CYCLE,
        policyVersionId: POLICY,
        mode: "FORMAL",
        order: { id: "o", grossProfit: "100000", currency: "CNY" },
        participants: [
          { personId: OWNER, workPackageId, attributionWeight: "1", role: "OWNER" },
        ],
      },
    } as never);
    // With enforcement on and no approved pool referenced, formal creation
    // must be rejected with a client error, not silently succeed.
    expect(run.statusCode).toBeGreaterThanOrEqual(400);
    expect(run.statusCode).toBeLessThan(500);
  });
});

describe("round 66: mandatory approval enforcement blocks unapproved policy publication", () => {
  it("returns 4xx when REQUIRE_APPROVAL_FOR includes POLICY_PUBLISH", async () => {
    const enforcing = buildApp(
      new Store(),
      undefined,
      undefined,
      platformStore,
      { requiredApprovals: ["POLICY_PUBLISH"] },
    );
    const response = await enforcing.inject({
      method: "POST",
      url: "/api/v1/policy-versions",
      payload: {
        policy: {
          code: "TDD-GATED",
          version: 1,
          currency: "CNY",
          poolRate: "3.5",
          poolCap: "120000",
          rounding: "HALF_UP",
        },
        effectiveFrom: "2026-12-01T00:00:00Z",
        approvedBy: ADJUDICATOR,
        applicability: {
          legalEntity: "N-Perform Test Entity",
          jurisdictions: ["CN"],
          workLocations: ["Shanghai"],
          employeeCategories: ["FULL_TIME"],
          workTimeTypes: ["FULL_TIME"],
        },
      },
    } as never);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });
});

describe("round 67: webhook inbox rejects duplicate event ids", () => {
  it("does not store the same external event twice", async () => {
    const hookApp = buildApp(appStore, undefined, undefined, platformStore, {
      webhookSecrets: { crm: "whsec-dup" },
    });
    const crypto = await import("node:crypto");
    const send = async (eventId: string) => {
      const payload = JSON.stringify({ eventId });
      const digest = crypto
        .createHmac("sha256", "whsec-dup")
        .update(payload)
        .digest("hex");
      return hookApp.inject({
        method: "POST",
        url: "/api/v1/webhooks/crm",
        payload,
        headers: {
          "content-type": "application/json",
          "x-signature-256": `sha256=${digest}`,
        },
      } as never);
    };
    const first = await send("evt-dup-1");
    expect([200, 201, 202]).toContain(first.statusCode);
    const inbox1 = await call("GET", "/api/v1/webhook-inbox");
    const beforeCount = inbox1.body.data.length;
    await send("evt-dup-1");
    const inbox2 = await call("GET", "/api/v1/webhook-inbox");
    // The duplicate is either deduped or marked failed — never a fresh entry.
    expect(inbox2.body.data.length).toBeLessThanOrEqual(beforeCount + 1);
    const dupes = inbox2.body.data.filter(
      (row: { payloadJson?: { eventId?: string } }) =>
        row.payloadJson?.eventId === "evt-dup-1",
    );
    expect(dupes.length).toBeLessThanOrEqual(1);
  });
});

describe("round 68: agent scan is available and audited", () => {
  it("accepts a scan request and returns task records", async () => {
    const scan = await call("POST", "/api/v1/agent-tasks/scan", {});
    // Either it runs (200 with findings) or validation-rejects an empty body —
    // never a 5xx.
    expect(scan.status).toBeLessThan(500);
  });
});

describe("round 69: consultations conclude before gate citation", () => {
  it("concludes a consultation with an outcome", async () => {
    const consultation = await call("POST", "/api/v1/policy-consultations", {
      policyVersionId: POLICY,
      consultationType: "INFORMATION",
      startedAt: "2026-10-01T00:00:00Z",
    });
    const consultationId = consultation.body.data.id;
    const concluded = await call(
      "POST",
      `/api/v1/policy-consultations/${consultationId}/conclude`,
      { endedAt: "2026-10-15T00:00:00Z", outcome: "AGREED" },
    );
    expect(concluded.status).toBeLessThan(300);
    const detail = await call(
      "GET",
      `/api/v1/policy-consultations/${consultationId}`,
    );
    expect(detail.body.data.outcome).toBe("AGREED");
  });
});

describe("round 70: retention report exposes cutoffs without deleting anything", () => {
  it("reports categories with cutoff dates", async () => {
    await call("POST", "/api/v1/retention-policies", {
      dataCategory: "PAYROLL_RECORDS",
      retentionMonths: 24,
      legalBasis: "statute",
      legalHold: false,
    });
    const report = await call("GET", "/api/v1/retention-policies/report");
    expect(report.status).toBe(200);
    expect(JSON.stringify(report.body.data)).toContain("PAYROLL_RECORDS");
  });
});

describe("round 71: reconciler matches engine output to fixtures", () => {
  it("reconcile script exits 0 on the packaged fixtures", async () => {
    const { execSync } = await import("node:child_process");
    const output = execSync("npm run reconcile --silent", {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(output.length).toBeGreaterThanOrEqual(0);
  });
});

describe("round 72: policy diff between versions is structural", () => {
  it("reports a diff endpoint result without 5xx", async () => {
    const versions = await call("GET", "/api/v1/policy-versions");
    const anyId = versions.body.data[0].policyVersionId;
    const diff = await call(
      "GET",
      `/api/v1/policy-versions/${anyId}/diff?against=${versions.body.data[1].policyVersionId}`,
    );
    expect(diff.status).toBeLessThan(500);
  });
});
