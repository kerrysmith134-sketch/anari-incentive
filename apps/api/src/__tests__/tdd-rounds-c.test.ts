/*
 * TDD rounds 33–40: extended verification rounds. Zero-defect streak check.
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

/** Accepted work package + confirmed claim + decision, ready for a formal run. */
async function moneyPath(): Promise<{ workPackageId: string; runId: string }> {
  const created = await call("POST", "/api/v1/work-packages", {
    title: "TDD package",
    objective: "Deliver",
    ownerPersonId: OWNER,
    members: [
      { personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "x" },
      { personId: MEMBER, responsibilityCode: "CONTRIBUTOR", expectedOutput: "y" },
    ],
    acceptanceCriteria: ["ok"],
  });
  const workPackageId = created.body.data.id;
  for (const [step, payload] of [
    ["commit", { expectedVersion: 1 }],
    ["start", {}],
    ["submit", {}],
    ["accept", { reviewerPersonId: MEMBER }],
  ] as const) {
    await call(
      "POST",
      `/api/v1/work-packages/${workPackageId}/${step}`,
      payload as Record<string, unknown>,
    );
  }
  const claim = await call("POST", "/api/v1/contribution-claims", {
    workPackageId,
    claimantPersonId: OWNER,
    claimType: "DELIVERABLE_CONTRIBUTION",
    claimedContribution: { dimensions: ["QUALITY"], summary: "Did the work" },
    evidenceRefs: ["evidence-1"],
    rationale: "On time",
  });
  await call("POST", `/api/v1/contribution-claims/${claim.body.data.id}/submit`);
  await call("POST", "/api/v1/attribution-decisions", {
    claimId: claim.body.data.id,
    adjudicatorPersonId: ADJUDICATOR,
    status: "CONFIRMED",
    acceptedFacts: ["Did the work"],
    rejectedFacts: [],
    contributionDimensions: { QUALITY: 1 },
    rationale: "Supported",
  });
  await call("POST", `/api/v1/policy-versions/${POLICY}/legal-gate`, {
    policyApproved: true,
    minimumWageChecked: true,
    democraticProcedureRef: "dp",
    employeeNoticeRef: "notice",
    dataProtectionAssessmentRef: "dpia",
    recordedBy: ADJUDICATOR,
  });
  const run = await call("POST", "/api/v1/calculation-runs", {
    cycleId: CYCLE,
    policyVersionId: POLICY,
    mode: "FORMAL",
    order: { id: "o1", grossProfit: "100000", currency: "CNY" },
    participants: [
      { personId: OWNER, workPackageId, attributionWeight: "1", role: "OWNER" },
    ],
  });
  const runId = run.body.data.id;
  await call("POST", "/api/v1/employee-confirmations", {
    personId: OWNER,
    targetType: "CALCULATION",
    targetId: runId,
    decision: "CONFIRMED",
  });
  await call("POST", `/api/v1/calculation-runs/${runId}/approve`);
  await call("POST", `/api/v1/calculation-runs/${runId}/lock`, {
    confirmation: "LOCK_CALCULATION",
  });
  return { workPackageId, runId };
}

describe("round 33: locking a calculation twice is refused", () => {
  it("returns 409 on the second lock", async () => {
    const { runId } = await moneyPath();
    const again = await call("POST", `/api/v1/calculation-runs/${runId}/lock`, {
      confirmation: "LOCK_CALCULATION",
    });
    expect(again.status).toBe(409);
  });
});

describe("round 34: the same ledger entry cannot settle into two active batches", () => {
  it("rejects the second STANDARD batch for the cycle", async () => {
    await moneyPath();
    const first = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    expect(first.status).toBe(201);
    const second = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    expect(second.status).toBe(409);
  });
});

describe("round 35: claimant cannot adjudicate their own claim", () => {
  it("returns 4xx on self-adjudication", async () => {
    const created = await call("POST", "/api/v1/work-packages", {
      title: "Self package",
      objective: "Deliver",
      ownerPersonId: OWNER,
      members: [
        { personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "x" },
      ],
      acceptanceCriteria: ["ok"],
    });
    const workPackageId = created.body.data.id;
    for (const [step, payload] of [
      ["commit", { expectedVersion: 1 }],
      ["start", {}],
      ["submit", {}],
      ["accept", { reviewerPersonId: ADJUDICATOR }],
    ] as const) {
      await call(
        "POST",
        `/api/v1/work-packages/${workPackageId}/${step}`,
        payload as Record<string, unknown>,
      );
    }
    const claim = await call("POST", "/api/v1/contribution-claims", {
      workPackageId,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: { dimensions: ["QUALITY"], summary: "Did the work" },
      evidenceRefs: ["evidence-9"],
      rationale: "On time and complete",
    });
    await call("POST", `/api/v1/contribution-claims/${claim.body.data.id}/submit`);
    const decision = await call("POST", "/api/v1/attribution-decisions", {
      claimId: claim.body.data.id,
      adjudicatorPersonId: OWNER,
      status: "CONFIRMED",
      acceptedFacts: ["s"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "self",
    });
    expect(decision.status).toBeGreaterThanOrEqual(400);
  });
});

describe("round 36: ledger chain verifies after an adjustment", () => {
  it("stays valid", async () => {
    const { runId } = await moneyPath();
    const ledger = await call("GET", "/api/v1/ledger");
    const entry = ledger.body.data.find(
      (candidate: { personId: string }) => candidate.personId === OWNER,
    );
    await call("POST", `/api/v1/ledger/${entry.id}/adjustments`, {
      amount: "-10",
      reasonCode: "MANUAL_FIX",
      explanation: "Rounding correction",
      approvedBy: ADJUDICATOR,
      idempotencyKey: "tdd-adjust-1",
    });
    const verify = await call("GET", "/api/v1/ledger/verify");
    expect(verify.body.data.valid).toBe(true);
    expect(runId).toBeTruthy();
  });
});

describe("round 37: adjustment idempotency key replays the original", () => {
  it("returns the same adjustment and never creates a second one", async () => {
    await moneyPath();
    const ledger = await call("GET", "/api/v1/ledger");
    const entry = ledger.body.data[0];
    const body = {
      amount: "-5",
      reasonCode: "MANUAL_FIX",
      explanation: "First",
      approvedBy: ADJUDICATOR,
      idempotencyKey: "tdd-adjust-dup",
    };
    const firstAdjust = await call(
      "POST",
      `/api/v1/ledger/${entry.id}/adjustments`,
      body,
    );
    expect([200, 201]).toContain(firstAdjust.status);
    const secondAdjust = await call(
      "POST",
      `/api/v1/ledger/${entry.id}/adjustments`,
      { ...body, explanation: "Second attempt" },
    );
    expect([200, 201]).toContain(secondAdjust.status);
    expect(secondAdjust.body.data.entry.id).toBe(firstAdjust.body.data.entry.id);
    const after = await call("GET", "/api/v1/ledger");
    const adjustments = after.body.data.filter(
      (candidate: { entryType: string }) => candidate.entryType === "ADJUSTMENT",
    );
    expect(adjustments).toHaveLength(1);
  });
});

describe("round 38: formal runs without a legal gate are blocked", () => {
  it("returns CALCULATION_BLOCKED when the gate is missing", async () => {
    const created = await call("POST", "/api/v1/work-packages", {
      title: "No gate package",
      objective: "Deliver",
      ownerPersonId: OWNER,
      members: [
        { personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "x" },
      ],
      acceptanceCriteria: ["ok"],
    });
    const workPackageId = created.body.data.id;
    for (const [step, payload] of [
      ["commit", { expectedVersion: 1 }],
      ["start", {}],
      ["submit", {}],
      ["accept", { reviewerPersonId: ADJUDICATOR }],
    ] as const) {
      await call(
        "POST",
        `/api/v1/work-packages/${workPackageId}/${step}`,
        payload as Record<string, unknown>,
      );
    }
    const claim = await call("POST", "/api/v1/contribution-claims", {
      workPackageId,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: { dimensions: ["QUALITY"], summary: "Did the work" },
      evidenceRefs: ["evidence-9"],
      rationale: "On time and complete",
    });
    await call("POST", `/api/v1/contribution-claims/${claim.body.data.id}/submit`);
    await call("POST", "/api/v1/attribution-decisions", {
      claimId: claim.body.data.id,
      adjudicatorPersonId: ADJUDICATOR,
      status: "CONFIRMED",
      acceptedFacts: ["s"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "ok",
    });
    const ungated = await call("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: POLICY,
      mode: "FORMAL",
      order: { id: "o2", grossProfit: "1000", currency: "CNY" },
      participants: [
        { personId: OWNER, workPackageId, attributionWeight: "1", role: "OWNER" },
      ],
    });
    // The gate recorded for POLICY is still valid, so instead probe a policy
    // with no gate: any unknown policy id must 4xx, not 5xx.
    const unknown = await call("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: "00000000-0000-4000-8000-000000000999",
      mode: "FORMAL",
      order: { id: "o3", grossProfit: "1000", currency: "CNY" },
      participants: [
        { personId: OWNER, workPackageId, attributionWeight: "1", role: "OWNER" },
      ],
    });
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    expect(unknown.status).toBeLessThan(500);
    // Fresh cycle: POLICY has no legal gate recorded, so FORMAL is blocked.
    expect(ungated.status).toBe(422);
    expect(ungated.body.error.code).toBe("CALCULATION_BLOCKED");
  });
});

describe("round 39: employee cannot read another person's ledger line", () => {
  it("filters the ledger to the caller's person", async () => {
    await moneyPath();
    const employeeApp = buildApp(
      appStore,
      undefined,
      {
        async authenticate() {
          return {
            tenantId: "tenant-demo",
            userId: "emp-2",
            roles: ["employee"],
            personId: MEMBER,
          };
        },
      },
      platformStore,
    );
    const response = await employeeApp.inject({
      method: "GET",
      url: "/api/v1/ledger",
    } as never);
    expect(response.statusCode).toBe(200);
    const entries = response.json().data;
    expect(
      entries.every((entry: { personId: string }) => entry.personId === MEMBER),
    ).toBe(true);
  });
});

describe("round 40: notification creation requires manager/integration", () => {
  it("rejects a plain employee creating notifications for others", async () => {
    const employeeApp = buildApp(
      appStore,
      undefined,
      {
        async authenticate() {
          return {
            tenantId: "tenant-demo",
            userId: "emp-2",
            roles: ["employee"],
            personId: MEMBER,
          };
        },
      },
      platformStore,
    );
    const response = await employeeApp.inject({
      method: "POST",
      url: "/api/v1/notifications",
      payload: {
        recipientPersonId: OWNER,
        audience: "PERSON",
        title: "phish",
        body: "click here",
        sourceType: "MANUAL",
        sourceId: "x",
      },
    } as never);
    expect(response.statusCode).toBe(403);
  });
});
