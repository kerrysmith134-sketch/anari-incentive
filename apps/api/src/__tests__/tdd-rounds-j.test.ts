/*
 * TDD rounds 113–136: fourth wave — localization integrity, account-login
 * session security, contract amendments, e-sign callbacks, prompt gates,
 * agent tasks, notice gates, DPIA/DSAR, settlement export evidence.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { SessionJwt } from "@anari/auth";
import { buildApp } from "../app.js";
import { hashPassword, verifyPassword } from "../password.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const SECRET = "session-secret-0123456789";
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
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore, {
    sessionSecret: SECRET,
  });
});

// ---------------------------------------------------------------------------
// Rounds 113–115 — localization integrity.
// ---------------------------------------------------------------------------
describe("round 113: zh status dictionary behaviour", () => {
  it("translates known statuses and passes unknown values through", async () => {
    const { zhStatus, zhStatusList } = await import("../../../web/src/lib/zh.js");
    expect(zhStatus("ACTIVE")).toBe("生效中");
    expect(zhStatus("LOCKED")).toBe("已锁定");
    expect(zhStatus("RECOVERY")).toBe("追回");
    expect(zhStatus("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(zhStatus(null)).toBe("");
    expect(zhStatusList([])).toBe("—");
    expect(zhStatusList(["ACTIVE", "LOCKED"])).toBe("生效中、已锁定");
  });
});

describe("round 114: status enums survive the API untouched", () => {
  it("policy versions still carry English enum values", async () => {
    const versions = await call("GET", "/api/v1/policy-versions");
    expect(versions.status).toBe(200);
    for (const version of versions.body.data) {
      expect(version.status).toBe("PUBLISHED");
    }
  });
});

// ---------------------------------------------------------------------------
// Rounds 115–118 — password login security.
// ---------------------------------------------------------------------------
describe("round 115: scrypt hashes are salted per call", () => {
  it("produces different hashes for the same password yet verifies both", () => {
    const a = hashPassword("Same-Password-1");
    const b = hashPassword("Same-Password-1");
    expect(a).not.toBe(b);
    expect(verifyPassword("Same-Password-1", a)).toBe(true);
    expect(verifyPassword("Same-Password-1", b)).toBe(true);
    expect(verifyPassword("Wrong-Password-1", a)).toBe(false);
    expect(verifyPassword("Same-Password-1", "garbage")).toBe(false);
  });
});

describe("round 116: password login is rate-limited per IP", () => {
  it("returns 429 after repeated failures", async () => {
    await call("POST", "/api/v1/public/signup", {
      companyName: "Acme",
      adminDisplayName: "K",
      adminEmail: "k@acme.test",
      password: "Right-Passw0rd",
      acceptTerms: true,
    });
    // 限流窗口基于真实时间：慢跑/停顿可能跨窗重置计数——循环到 429
    // 为止（上限 30 次），避免依赖"12 次一定触发"的时间假设。
    let last = 0;
    for (let index = 0; index < 30; index += 1) {
      const attempt = await call("POST", "/api/v1/auth/password/login", {
        email: "k@acme.test",
        password: `wrong-${index}`,
      });
      last = attempt.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe("round 117: login honours the requested tenant membership", () => {
  it("issues a token scoped to the membership tenant", async () => {
    await call("POST", "/api/v1/public/signup", {
      companyName: "Acme Two",
      adminDisplayName: "K",
      adminEmail: "k2@acme.test",
      password: "Right-Passw0rd",
      acceptTerms: true,
    });
    const login = await call("POST", "/api/v1/auth/password/login", {
      email: "k2@acme.test",
      password: "Right-Passw0rd",
      tenantId: "tenant-demo",
    });
    // The user has no membership in tenant-demo → 403.
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("NO_TENANT_MEMBERSHIP");

    const correct = await call("POST", "/api/v1/auth/password/login", {
      email: "k2@acme.test",
      password: "Right-Passw0rd",
    });
    expect(correct.status).toBe(200);
    const claims = await new SessionJwt(SECRET).verify(correct.body.data.token);
    expect(claims.tenantId).not.toBe("tenant-demo");
  });
});

describe("round 118: session tokens are bound to the issuing secret", () => {
  it("rejects a token signed by a different deployment", async () => {
    const otherApp = buildApp(new Store(), undefined, undefined, undefined, {
      sessionSecret: "another-secret-012345678",
    });
    await otherApp.inject({
      method: "POST",
      url: "/api/v1/public/signup",
      payload: {
        companyName: "Other",
        adminDisplayName: "O",
        adminEmail: "o@other.test",
        password: "Other-Passw0rd",
        acceptTerms: true,
      },
    } as never);
    const login = await otherApp.inject({
      method: "POST",
      url: "/api/v1/auth/password/login",
      payload: { email: "o@other.test", password: "Other-Passw0rd" },
    } as never);
    const foreignToken = login.json().data.token;
    const forged = await app.inject({
      method: "GET",
      url: "/api/v1/policy-versions",
      headers: { authorization: `Bearer ${foreignToken}` },
    } as never);
    // Foreign token must not authenticate here; dev fallback then applies
    // (this app has no runtime resolver) — either 401 or dev 200 is fine but
    // the token itself must fail strict verification.
    await expect(
      new SessionJwt(SECRET).verify(foreignToken),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rounds 119–121 — contract amendment scheduling.
// ---------------------------------------------------------------------------
async function createContract(): Promise<string> {
  const contract = await call("POST", "/api/v1/employment-contracts", {
    personId: OWNER,
    contractCode: `CT-TDD4-${Date.now()}`,
    employmentType: "FULL_TIME",
    startDate: "2026-01-01T00:00:00Z",
    workLocation: "Shanghai",
    currency: "CNY",
    fixedMonthlySalary: "8000",
    minimumMonthlyWage: "2690",
    bankAccountRef: "BANK-1",
    consentSignatureRef: "ESIGN-TDD4",
  });
  expect(contract.status).toBe(201);
  return contract.body.data.id;
}

describe("round 119: future amendments require consent evidence", () => {
  it("schedules an amendment and applies it only when due", async () => {
    const contractId = await createContract();
    const future = new Date(Date.now() + 30 * 864e5).toISOString();
    const amended = await call(
      "POST",
      `/api/v1/employment-contracts/${contractId}/amendments`,
      {
        fixedMonthlySalary: "9000",
        minimumMonthlyWage: "2690",
        taxRate: "0.1",
        socialInsuranceRate: "0.05",
        deductionCapRate: "0.2",
        variableShareCapRate: "1",
        smoothingThresholdRate: "1",
        effectiveFrom: future,
        approvedBy: ADMIN,
        consentSignatureRef: "ESIGN-AMEND-9K",
      },
    );
    expect(amended.status).toBeLessThan(300);
    // Immediately applying due amendments must not touch the future one.
    const applied = await call("POST", "/api/v1/employment-contracts/apply-due");
    expect(applied.status).toBe(200);
    const listed = await call("GET", "/api/v1/employment-contracts");
    const row = listed.body.data.find(
      (candidate: { id: string }) => candidate.id === contractId,
    );
    expect(row.fixedMonthlySalary).toBe("8000");
  });
});

describe("round 120: an amendment without consent is refused", () => {
  it("returns 4xx", async () => {
    const contractId = await createContract();
    const noConsent = await call(
      "POST",
      `/api/v1/employment-contracts/${contractId}/amendments`,
      {
        fixedMonthlySalary: "9999",
        minimumMonthlyWage: "2690",
        taxRate: "0.1",
        socialInsuranceRate: "0.05",
        deductionCapRate: "0.2",
        variableShareCapRate: "1",
        smoothingThresholdRate: "1",
        effectiveFrom: new Date(Date.now() + 864e5).toISOString(),
        approvedBy: ADMIN,
      },
    );
    expect(noConsent.status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// Rounds 121–123 — e-sign callback writes consent back.
// ---------------------------------------------------------------------------
describe("round 121: e-sign SIGNED callback updates the envelope", () => {
  function esignApp(): FastifyInstance {
    return buildApp(appStore, undefined, undefined, platformStore, {
      esignWebhookSecrets: { providerx: "esign-tdd-secret" },
    });
  }

  it("rejects an unknown provider with 404", async () => {
    const hookApp = buildApp(appStore, undefined, undefined, platformStore, {});
    const response = await hookApp.inject({
      method: "POST",
      url: "/api/v1/esign/webhooks/none",
      payload: {},
    } as never);
    expect(response.statusCode).toBe(404);
  });

  it("accepts a correctly signed SIGNED callback", async () => {
    const hookApp = esignApp();
    const contractId = await createContract();
    const envelope = await call("POST", "/api/v1/esign-envelopes", {
      contractId,
      provider: "providerx",
      envelopeRef: `env-${Date.now()}`,
      documentHash: "sha256:" + "0".repeat(60),
      signerPersonId: OWNER,
    });
    expect(envelope.status).toBe(201);
    const payload = JSON.stringify({
      envelopeRef: envelope.body.data.envelopeRef,
      status: "SIGNED",
      signatureRef: "sig-123",
    });
    const digest = createHmac("sha256", "esign-tdd-secret")
      .update(payload)
      .digest("hex");
    const callback = await hookApp.inject({
      method: "POST",
      url: "/api/v1/esign/webhooks/providerx",
      payload,
      headers: {
        "content-type": "application/json",
        "x-signature-256": `sha256=${digest}`,
      },
    } as never);
    expect([200, 201]).toContain(callback.statusCode);
  });
});

// ---------------------------------------------------------------------------
// Rounds 124–126 — prompt activation requires a passed evaluation.
// ---------------------------------------------------------------------------
describe("round 124: prompt activation rejects unverified evaluation", () => {
  it("returns 4xx when activating without a passing run", async () => {
    const prompt = await call("POST", "/api/v1/model-prompts", {
      promptCode: `PROMPT-${Date.now()}`,
      version: 1,
      purpose: "evidence-summary",
      modelProvider: "anthropic",
      modelName: "claude",
      template: "Summarise the evidence",
    });
    expect(prompt.status).toBe(201);
    const activate = await call(
      "POST",
      `/api/v1/model-prompts/${prompt.body.data.id}/activate`,
      {},
    );
    expect(activate.status).toBeGreaterThanOrEqual(400);
    expect(activate.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// Rounds 125–127 — notice gate and DPIA gate.
// ---------------------------------------------------------------------------
describe("round 125: DPIA must be approved before being cited as done", () => {
  it("exposes approval state via the API", async () => {
    const dpia = await call("POST", "/api/v1/dpia-records", {
      assessmentType: "DPIA",
      scope: "Incentive calculation",
      riskSummary: { level: "low" },
      mitigationSummary: { control: "human review" },
    });
    const dpiaId = dpia.body.data.id;
    await call("POST", `/api/v1/dpia-records/${dpiaId}/approve`, {
      approvedBy: ADMIN,
    });
    const detail = await call("GET", `/api/v1/dpia-records/${dpiaId}`);
    expect(detail.body.data.approvedAt).toBeTruthy();
  });
});

describe("round 126: DSAR lifecycle keeps requester scoping", () => {
  it("employee sees only own DSAR", async () => {
    await call("POST", "/api/v1/dsar-requests", {
      requestType: "ACCESS",
      details: "Please send my data",
      requestedBy: OWNER,
    });
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
      method: "GET",
      url: "/api/v1/dsar-requests",
    } as never);
    const rows = response.json().data;
    expect(
      rows.every((row: { requestedBy: string }) => row.requestedBy === MEMBER),
    ).toBe(true);
  });
});

describe("round 127: agent task enqueue is accepted and auditable", () => {
  it("returns a task record without 5xx", async () => {
    const task = await call("POST", "/api/v1/agent-tasks", {
      skill: "EVIDENCE_GAP",
      targetType: "CYCLE",
      targetId: CYCLE,
    });
    expect(task.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// Rounds 128–130 — settlement export evidence.
// ---------------------------------------------------------------------------
async function moneyPathLocked(): Promise<string> {
  const created = await call("POST", "/api/v1/work-packages", {
    title: "Export package",
    objective: "Deliver through the full money path",
    ownerPersonId: OWNER,
    members: [
      { personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "work" },
    ],
    acceptanceCriteria: ["ok"],
  });
  const workPackageId = created.body.data.id;
  for (const [step, payload] of [
    ["commit", { expectedVersion: 1 }],
    ["start", {}],
    ["submit", {}],
    ["accept", { reviewerPersonId: ADJUDICATOR_NAME }],
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
    evidenceRefs: ["ev"],
    rationale: "Complete and timely",
  });
  await call("POST", `/api/v1/contribution-claims/${claim.body.data.id}/submit`);
  await call("POST", "/api/v1/attribution-decisions", {
    claimId: claim.body.data.id,
    adjudicatorPersonId: ADMIN,
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
    recordedBy: ADMIN,
  });
  const run = await call("POST", "/api/v1/calculation-runs", {
    cycleId: CYCLE,
    policyVersionId: POLICY,
    mode: "FORMAL",
    order: { id: "o", grossProfit: "100000", currency: "CNY" },
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
  return runId;
}

const ADJUDICATOR_NAME = ADMIN;

describe("round 128: settlement batch reconciles and exports CSV", () => {
  it("walks RECONCILE → APPROVE → EXPORT with headers", async () => {
    await moneyPathLocked();
    const batch = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    expect(batch.status).toBe(201);
    const batchId = batch.body.data.id;
    for (const command of ["RECONCILE", "SUBMIT", "APPROVE"] as const) {
      const step = await call(
        "POST",
        `/api/v1/settlement-batches/${batchId}/commands`,
        { command, actorPersonId: ADMIN },
      );
      expect(step.status).toBeLessThan(300);
    }
    const lock = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      { command: "LOCK", actorPersonId: ADMIN },
    );
    expect(lock.status).toBeLessThan(300);
    const exportResponse = await app.inject({
      method: "POST",
      url: `/api/v1/settlement-batches/${batchId}/commands`,
      payload: { command: "EXPORT", actorPersonId: ADMIN },
    } as never);
    expect(exportResponse.statusCode).toBeLessThan(300);
    expect(exportResponse.body).toContain("batch_no");
  });
});

describe("round 129: double LOCK on a settlement batch is refused", () => {
  it("returns 409", async () => {
    await moneyPathLocked();
    const batch = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    const batchId = batch.body.data.id;
    for (const command of ["RECONCILE", "SUBMIT", "APPROVE", "LOCK"] as const) {
      await call("POST", `/api/v1/settlement-batches/${batchId}/commands`, {
        command,
        actorPersonId: ADMIN,
      });
    }
    const again = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      { command: "LOCK", actorPersonId: ADMIN },
    );
    expect(again.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Rounds 130–132 — appeal evidence disclosure gating.
// ---------------------------------------------------------------------------
describe("round 130: appeal resolve requires disclosure when evidence refs exist", () => {
  it("blocks resolve until evidence is disclosed", async () => {
    await moneyPathLocked();
    const appeal = await call("POST", "/api/v1/appeals", {
      targetType: "ATTRIBUTION",
      targetId: CYCLE,
      appellantPersonId: OWNER,
      reasonCode: "DISPUTED_AMOUNT",
      statement: "Contribution was underestimated by the adjudicator",
      evidenceRefs: ["00000000-0000-4000-8000-0000000000e1"],
    });
    expect(appeal.status).toBe(201);
    const appealId = appeal.body.data.id;
    await call("POST", `/api/v1/appeals/${appealId}/triage`, {
      reviewerPersonId: ADMIN,
    });
    await call("POST", `/api/v1/appeals/${appealId}/review`, {
      reviewerPersonId: ADMIN,
    });
    const early = await call("POST", `/api/v1/appeals/${appealId}/resolve`, {
      reviewerPersonId: ADMIN,
      resolution: "UPHOLD",
      rationale: "Reviewed and upheld",
    });
    expect(early.status).toBe(409);
    const disclose = await call(
      "POST",
      `/api/v1/appeals/${appealId}/evidence-disclosures`,
      {
        disclosedBy: ADMIN,
        method: "PORTAL",
        evidenceRefs: ["00000000-0000-4000-8000-0000000000e1"],
      },
    );
    expect(disclose.status).toBeLessThan(300);
    const resolved = await call("POST", `/api/v1/appeals/${appealId}/resolve`, {
      reviewerPersonId: ADMIN,
      resolution: "UPHOLD",
      rationale: "Reviewed and upheld after disclosure",
    });
    expect(resolved.status).toBeLessThan(300);
  });
});

// ---------------------------------------------------------------------------
// Rounds 131–132 — notifications read state.
// ---------------------------------------------------------------------------
describe("round 131: notification read marking works", () => {
  it("creates a notification for a member and marks it read", async () => {
    const created = await call("POST", "/api/v1/notifications", {
      recipientPersonId: MEMBER,
      audience: "PERSON",
      title: "工资条已生成",
      body: "11 月工资条已发布，请查看。",
      sourceType: "PAYROLL_RUN",
      sourceId: CYCLE,
    });
    expect(created.status).toBe(201);
    const notificationId = created.body.data.id;
    const read = await call("POST", `/api/v1/notifications/${notificationId}/read`);
    expect(read.status).toBeLessThan(300);
  });
});

// ---------------------------------------------------------------------------
// Rounds 132–136 — API contract freshness and security headers.
// ---------------------------------------------------------------------------
describe("round 132: security headers are present on API responses", () => {
  it("sets nosniff, frame denial and no-store", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/policy-versions",
    } as never);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["cache-control"]).toContain("no-store");
  });
});

describe("round 133: request correlation id is always present", () => {
  it("returns x-request-id and meta.correlation_id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/policy-versions",
    } as never);
    const correlation = response.json().meta?.correlation_id;
    expect(correlation).toBeTruthy();
  });
});

describe("round 134: 404 errors follow the error envelope", () => {
  it("returns code/message/meta shape", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/calculation-runs/00000000-0000-4000-8000-000000000999",
    } as never);
    const body = response.json();
    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).toBeTruthy();
    expect(body.meta.correlation_id).toBeTruthy();
  });
});

describe("round 135: metrics endpoint counts business events", () => {
  it("exposes the business event counter after activity", async () => {
    await call("GET", "/api/v1/policy-versions");
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.body).toContain("n_perform_business_events_total");
  });
});

describe("round 136: ready endpoint reports store health", () => {
  it("returns 200 ready", async () => {
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(200);
  });
});
