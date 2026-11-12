/*
 * Security hardening regressions found by the full-surface audit:
 * tenant admin must not act as a platform operator, signup must never reset an
 * existing password, approvals must carry the session identity, and employees
 * must not drive each other's workflow.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Authenticator } from "@anari/auth";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";
const TENANT = "tenant-demo";

let app: FastifyInstance;
let appStore: Store;
let platformStore: MemoryPlatformStore;

function authFor(
  roles: string[],
  personId?: string,
  tenantId = TENANT,
): Authenticator {
  return {
    async authenticate() {
      return { tenantId, userId: `user-${personId ?? "ops"}`, roles, personId };
    },
  };
}

function freshPlatformStore() {
  return new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: MEMBER, employeeCode: "E002", displayName: "Teammate" },
        { id: ADMIN, employeeCode: "E003", displayName: "Finance" },
      ],
    },
  });
}

async function call(
  target: FastifyInstance,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown> | string,
) {
  const response = await target.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    headers: response.headers,
    text: response.body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

beforeEach(() => {
  appStore = new Store();
  platformStore = freshPlatformStore();
  app = buildApp(appStore, undefined, undefined, platformStore, {
    sessionSecret: "session-secret-0123456789",
  });
});

describe("public signup cannot take over an existing account", () => {
  it("rejects a duplicate email and leaves the original password intact", async () => {
    const first = await call(app, "POST", "/api/v1/public/signup", {
      companyName: "Acme",
      adminDisplayName: "Owner",
      adminEmail: "victim@acme.test",
      password: "Original-Passw0rd",
      acceptTerms: true,
    });
    expect(first.status).toBe(201);
    const originalTenant = first.body.data.tenantId as string;

    const attack = await call(app, "POST", "/api/v1/public/signup", {
      companyName: "Attacker",
      adminDisplayName: "Attacker",
      adminEmail: "victim@acme.test",
      password: "Attacker-Passw0rd",
      acceptTerms: true,
    });
    expect(attack.status).toBe(409);
    expect(attack.body.error.message).toContain("EMAIL_ALREADY_REGISTERED");

    const login = await call(app, "POST", "/api/v1/auth/password/login", {
      email: "victim@acme.test",
      password: "Original-Passw0rd",
    });
    expect(login.status).toBe(200);
    expect(login.body.data.tenantId).toBe(originalTenant);
    const forged = await call(app, "POST", "/api/v1/auth/password/login", {
      email: "victim@acme.test",
      password: "Attacker-Passw0rd",
    });
    expect(forged.status).toBe(401);
  });
});

describe("tenant admin is not a platform operator", () => {
  it("cannot read or rewrite another tenant", async () => {
    const victim = await platformStore.createTenant({
      name: "Victim Co",
      slug: "victim-co",
    });
    const tenantAdmin = buildApp(
      new Store(TENANT),
      undefined,
      authFor(["admin"], OWNER),
      platformStore,
    );

    const settings = await call(
      tenantAdmin,
      "POST",
      `/api/v1/platform/tenants/${victim.id}/settings`,
      { exportDlpEnabled: false },
    );
    expect(settings.status).toBe(403);

    const tenants = await call(tenantAdmin, "GET", "/api/v1/platform/tenants");
    expect(tenants.status).toBe(200);
    expect(tenants.body.data).toHaveLength(1);
    expect(tenants.body.data[0].id).toBe(TENANT);

    const allUsers = await call(tenantAdmin, "GET", "/api/v1/platform/users");
    expect(allUsers.status).toBe(403);
  });

  it("cannot reset a password for a user outside its tenant", async () => {
    const victim = await platformStore.createTenant({
      name: "Victim Co",
      slug: "victim-co-2",
    });
    const outsider = await platformStore.createUser({
      authSubject: "outsider@victim.test",
      displayName: "Outsider",
      email: "outsider@victim.test",
    });
    await platformStore.addMembership({
      tenantId: victim.id,
      userId: outsider.id,
      roleCodes: ["admin"],
    });
    const tenantAdmin = buildApp(
      new Store(TENANT),
      undefined,
      authFor(["admin"], OWNER),
      platformStore,
      { sessionSecret: "session-secret-0123456789" },
    );
    const reset = await call(
      tenantAdmin,
      "POST",
      "/api/v1/platform/users/set-password",
      { userId: outsider.id, password: "Hijacked-Pass1" },
    );
    expect(reset.status).toBe(403);
  });
});

describe("identity carries the authenticated roles", () => {
  it("falls back to session roles when membership has none", async () => {
    const employee = buildApp(
      new Store(TENANT),
      undefined,
      authFor(["employee"], MEMBER),
      platformStore,
    );
    const identity = await call(employee, "GET", "/api/v1/platform/identity");
    expect(identity.status).toBe(200);
    expect(identity.body.data.roles).toEqual(["employee"]);
  });
});

describe("employee data is not tenant-wide", () => {
  it("hides incentive award batches from employees", async () => {
    const created = await call(app, "POST", "/api/v1/incentive-award-batches", {
      batchNo: "AUDIT-AWARD-1",
      awardType: "MONTHLY_STAR",
      period: "2026-11",
      currency: "CNY",
      lines: [{ personId: OWNER, amount: "5000" }],
    });
    expect(created.status).toBe(201);
    const employee = buildApp(
      new Store(TENANT),
      undefined,
      authFor(["employee"], MEMBER),
      platformStore,
    );
    const list = await call(employee, "GET", "/api/v1/incentive-award-batches");
    expect(list.status).toBe(403);
    const detail = await call(
      employee,
      "GET",
      `/api/v1/incentive-award-batches/${created.body.data.id}`,
    );
    expect(detail.status).toBe(403);
  });

  it("scopes policy goal cards and grant cases to the caller", async () => {
    for (const personId of [OWNER, MEMBER]) {
      await platformStore.savePolicyEngineRecord({
        tenantId: TENANT,
        recordType: "PERFORMANCE_GOAL_CARD",
        personId,
        status: "DRAFT",
        payload: { personId, metrics: [] },
      });
      await platformStore.savePolicyEngineRecord({
        tenantId: TENANT,
        recordType: "EQUITY_GRANT_CASE",
        personId,
        status: "QUALIFICATION",
        payload: { personId, grantPercent: "1" },
      });
    }
    const employee = buildApp(
      new Store(TENANT),
      undefined,
      authFor(["employee"], MEMBER),
      platformStore,
    );
    const cards = await call(
      employee,
      "GET",
      "/api/v1/policy/performance/goal-cards",
    );
    expect(cards.status).toBe(200);
    expect(
      cards.body.data.every(
        (row: { personId: string }) => row.personId === MEMBER,
      ),
    ).toBe(true);
    const cases = await call(
      employee,
      "GET",
      "/api/v1/policy/equity/grant-cases",
    );
    expect(cases.status).toBe(200);
    expect(
      cases.body.data.every(
        (row: { personId: string }) => row.personId === MEMBER,
      ),
    ).toBe(true);
  });
});

describe("approval identity comes from the session", () => {
  it("cannot fabricate a SYSTEM requester and self-approve", async () => {
    const finance = buildApp(
      new Store(TENANT),
      undefined,
      authFor(["finance"], OWNER),
      platformStore,
    );
    const created = await call(finance, "POST", "/api/v1/approval-requests", {
      actionType: "PAYROLL_EXPORT",
      targetType: "PAYROLL_RUN",
      targetId: "00000000-0000-4000-8000-0000000000aa",
      requestedByType: "SYSTEM",
      riskTier: "T2",
      requiredApprovals: 1,
      payload: { scope: "audit" },
      idempotencyKey: `audit-approval-${Date.now()}`,
    });
    expect(created.status).toBe(201);
    const decided = await call(
      finance,
      "POST",
      `/api/v1/approval-requests/${created.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: OWNER,
        payloadHash: created.body.data.payloadHash,
      },
    );
    expect(decided.status).toBe(409);
    expect(decided.body.error.message).toMatch(/SEPARATION_OF_DUTIES/);
  });

  it("refuses to decide under somebody else's identity", async () => {
    const admin = buildApp(appStore, undefined, authFor(["admin"], ADMIN), platformStore);
    const created = await call(admin, "POST", "/api/v1/approval-requests", {
      actionType: "PAYROLL_EXPORT",
      targetType: "PAYROLL_RUN",
      targetId: "00000000-0000-4000-8000-0000000000ab",
      requestedByType: "USER",
      requestedById: ADMIN,
      riskTier: "T2",
      requiredApprovals: 1,
      payload: { scope: "audit" },
      idempotencyKey: `audit-approval-2-${Date.now()}`,
    });
    expect(created.status).toBe(201);
    const finance = buildApp(
      new Store(TENANT),
      undefined,
      authFor(["finance"], OWNER),
      platformStore,
    );
    const decided = await call(
      finance,
      "POST",
      `/api/v1/approval-requests/${created.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: MEMBER,
        payloadHash: created.body.data.payloadHash,
      },
    );
    expect(decided.status).toBe(403);
  });
});

describe("workflow mutations require participation", () => {
  it("stops an employee from driving another person's work package", async () => {
    const workPackage = await appStore.createWorkPackage({
      title: "Owner delivery",
      objective: "Deliver",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "Delivery",
        },
      ],
      acceptanceCriteria: ["Accepted"],
    });
    const employee = buildApp(
      appStore,
      undefined,
      authFor(["employee"], MEMBER),
      platformStore,
    );
    const start = await call(
      employee,
      "POST",
      `/api/v1/work-packages/${workPackage.id}/start`,
      {},
    );
    expect(start.status).toBe(403);
    const owner = buildApp(
      appStore,
      undefined,
      authFor(["employee"], OWNER),
      platformStore,
    );
    const committed = await call(
      owner,
      "POST",
      `/api/v1/work-packages/${workPackage.id}/commit`,
      { expectedVersion: 1 },
    );
    expect(committed.status).toBe(200);
  });

  it("stops an employee from submitting another person's claim", async () => {
    const workPackage = await appStore.createWorkPackage({
      title: "Claim package",
      objective: "Deliver",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "Delivery",
        },
      ],
      acceptanceCriteria: ["Accepted"],
    });
    await appStore.commitWorkPackage(workPackage.id, 1);
    await appStore.startWorkPackage(workPackage.id);
    await appStore.submitWorkPackage(workPackage.id);
    await appStore.acceptWorkPackage(workPackage.id, MEMBER);
    const claim = await appStore.createClaim({
      workPackageId: workPackage.id,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: { dimensions: ["QUALITY"], summary: "Done" },
      evidenceRefs: ["ev-1"],
      rationale: "Delivered the agreed scope",
    });
    const employee = buildApp(
      appStore,
      undefined,
      authFor(["employee"], MEMBER),
      platformStore,
    );
    const submitted = await call(
      employee,
      "POST",
      `/api/v1/contribution-claims/${claim.id}/submit`,
    );
    expect(submitted.status).toBe(403);
  });
});

describe("decision APIs bind the session actor (NPV2-003 sweep)", () => {
  it("rejects payroll approval for a different person", async () => {
    const financeSession = buildApp(
      new Store(),
      undefined,
      authFor(["finance"], OWNER),
      platformStore,
    );
    const run = await call(app, "POST", "/api/v1/payroll-runs", {
      cycleId: CYCLE,
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-11-30T23:59:59Z",
      currency: "CNY",
      preparedBy: MEMBER,
    });
    const approved = await call(
      financeSession,
      "POST",
      `/api/v1/payroll-runs/${run.body.data.id}/approve`,
      { approvedBy: MEMBER },
    );
    expect(approved.status).toBe(403);
    expect(approved.body.error.message).toContain(
      "authenticated identity",
    );
  });

  it("rejects bounty acceptance under another identity", async () => {
    const bounty = await call(app, "POST", "/api/v1/bounties", {
      title: "NPV2-003",
      description: "actor binding",
      rewardAmount: "100",
      currency: "CNY",
      createdBy: OWNER,
    });
    // 先把悬赏推进到 SUBMITTED，避免状态守卫（409）抢在身份校验之前。
    await call(app, "POST", `/api/v1/bounties/${bounty.body.data.id}/claim`, {
      personId: MEMBER,
    });
    await call(app, "POST", `/api/v1/bounties/${bounty.body.data.id}/submit`, {
      personId: MEMBER,
      submissionRef: "doc-1",
    });
    const financeSession = buildApp(
      new Store(),
      undefined,
      authFor(["finance"], OWNER),
      platformStore,
    );
    const accepted = await call(
      financeSession,
      "POST",
      `/api/v1/bounties/${bounty.body.data.id}/accept`,
      { reviewerPersonId: MEMBER },
    );
    expect(accepted.status).toBe(403);
    expect(accepted.body.error.message).toContain("authenticated identity");
  });

  it("rejects AI proposal decisions for another person", async () => {
    const financeSession = buildApp(
      new Store(),
      undefined,
      authFor(["finance"], OWNER),
      platformStore,
    );
    const decided = await call(
      financeSession,
      "POST",
      "/api/v1/ai-score-proposals/00000000-0000-4000-8000-0000000000e1/decide",
      {
        decision: "ACCEPT",
        decidedBy: MEMBER,
        independentScores: { QUALITY: 3 },
        reviewStartedAt: new Date(Date.now() - 60_000).toISOString(),
        evidenceOpened: 1,
      },
    );
    expect(decided.status).toBe(403);
  });
});

describe("malformed input returns a client error", () => {
  it("treats an empty JSON body as {} for bodyless command routes", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/read-all",
      headers: { "content-type": "application/json" },
      payload: "",
    } as never);
    expect(response.statusCode).toBeLessThan(300);
  });

  it("maps invalid JSON to 400 instead of 500", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/notifications",
      headers: { "content-type": "application/json" },
      payload: "{bad json",
    } as never);
    expect(response.statusCode).toBe(400);
  });

  it("rejects an invalid report window and vesting date with 400", async () => {
    const report = await call(
      app,
      "GET",
      "/api/v1/reports/policy-review?to=not-a-date",
    );
    expect(report.status).toBe(400);
    const vesting = await call(
      app,
      "GET",
      `/api/v1/equity-grants/${OWNER}/vesting?asOf=garbage`,
    );
    expect(vesting.status).toBe(400);
  });
});

describe("clawback consent is single-use", () => {
  it("rejects a second case backed by the same written consent", async () => {
    const base = {
      personId: OWNER,
      amount: "100",
      currency: "CNY",
      reasonCode: "OVERPAYMENT",
      explanation: "Same debt",
      consentSignatureRef: "ESIGN-SINGLE-USE",
      installmentMonths: 1,
      requestedBy: OWNER,
    };
    const first = await call(app, "POST", "/api/v1/clawback-cases", base);
    expect(first.status).toBe(201);
    const second = await call(app, "POST", "/api/v1/clawback-cases", base);
    expect(second.status).toBe(409);
    expect(second.body.error.message).toContain(
      "CLAWBACK_CONSENT_ALREADY_USED",
    );
  });
});

describe("clawback cannot recover more than the award", () => {
  it("rejects a case that exceeds the remaining source amount", async () => {
    const entry = appStore.ledger.append({
      tenantId: TENANT,
      personId: OWNER,
      cycleId: CYCLE,
      calculationRunId: "00000000-0000-4000-8000-0000000000c1",
      calculationLineId: "audit-clawback-line",
      entryType: "INCENTIVE",
      amount: "3000",
      currency: "CNY",
      idempotencyKey: "audit-clawback-source",
    });
    appStore.ledger.lock(entry.id);
    const created = await call(app, "POST", "/api/v1/clawback-cases", {
      personId: OWNER,
      amount: "4000",
      currency: "CNY",
      reasonCode: "OVERPAYMENT",
      explanation: "More than the award",
      consentSignatureRef: "ESIGN-AUDIT-1",
      installmentMonths: 1,
      requestedBy: OWNER,
    });
    expect(created.status).toBe(201);
    const caseId = created.body.data.id;
    await call(app, "POST", `/api/v1/clawback-cases/${caseId}/approve`, {
      approvedBy: ADMIN,
    });
    const recovery = await call(
      app,
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      { cycleId: CYCLE, ledgerEntryId: entry.id, createBatch: false },
    );
    expect(recovery.status).toBe(409);
    expect(recovery.body.error.message).toContain("CLAWBACK_EXCEEDS_REMAINING");
  });
});
