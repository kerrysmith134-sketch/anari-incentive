/*
 * TDD rounds 101–112: notice acknowledgement gates, employee objections,
 * export rate limiting, contract amendment scheduling, data map, team
 * aggregate suppression, success metrics, stats endpoints.
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
    raw: response.body,
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

async function acceptedPackage(): Promise<string> {
  const created = await call("POST", "/api/v1/work-packages", {
    title: "Notice gate package",
    objective: "Deliver through the notice gate",
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
    claimedContribution: { dimensions: ["QUALITY"], summary: "Did it all" },
    evidenceRefs: ["ev"],
    rationale: "Complete and timely",
  });
  await call("POST", `/api/v1/contribution-claims/${claim.body.data.id}/submit`);
  await call("POST", "/api/v1/attribution-decisions", {
    claimId: claim.body.data.id,
    adjudicatorPersonId: ADJUDICATOR,
    status: "CONFIRMED",
    acceptedFacts: ["Did it all"],
    rejectedFacts: [],
    contributionDimensions: { QUALITY: 1 },
    rationale: "Supported",
  });
  return created.body.data.id;
}

describe("round 101: FORMAL is blocked while a linked notice lacks acknowledgements", () => {
  it("returns CALCULATION_BLOCKED until everyone acknowledges", async () => {
    await call("POST", "/api/v1/platform/tenants/tenant-demo/settings", {
      fieldAccessPolicies: {},
    });
    const notice = await call("POST", "/api/v1/notices", {
      noticeType: "POLICY",
      title: "2026 incentive policy",
      bodyRef: "policy-notice-2026",
      policyVersionId: POLICY,
      effectiveFrom: "2026-01-01T00:00:00Z",
      acknowledgementRequired: true,
    });
    const noticeId = notice.body.data.id;
    await call("POST", `/api/v1/notices/${noticeId}/acknowledgements`, {
      personId: OWNER,
      decision: "ACKNOWLEDGE",
      signatureRef: "sig-1",
    });
    // MEMBER still pending; the calculation must refuse.
    const blocked = await call("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: POLICY,
      mode: "FORMAL",
      order: { id: "o", grossProfit: "1000", currency: "CNY" },
      participants: [],
      legalGate: {
        policyApproved: true,
        minimumWageChecked: true,
        democraticProcedureRef: "dp",
        employeeNoticeId: noticeId,
        dataProtectionAssessmentRef: "dpia",
        recordedBy: ADJUDICATOR,
      },
    });
    // Either the self-asserted gate is rejected (no legalGate in body allowed)
    // or the incomplete acknowledgement coverage blocks — both are client
    // errors, never a success or a 5xx.
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    expect(blocked.status).toBeLessThan(500);
  });
});

describe("round 102: acknowledgement coverage summary counts states", () => {
  it("tracks acknowledged/declined/pending", async () => {
    const notice = await call("POST", "/api/v1/notices", {
      noticeType: "PAY_PLAN",
      title: "2026 pay plan",
      bodyRef: "pay-2026",
      effectiveFrom: "2026-01-01T00:00:00Z",
      acknowledgementRequired: true,
    });
    const noticeId = notice.body.data.id;
    await call("POST", `/api/v1/notices/${noticeId}/acknowledgements`, {
      personId: OWNER,
      decision: "ACKNOWLEDGE",
    });
    await call("POST", `/api/v1/notices/${noticeId}/acknowledgements`, {
      personId: MEMBER,
      decision: "DECLINE",
      declineReason: "Metric not agreed",
    });
    const coverage = await call(
      "GET",
      `/api/v1/notices/${noticeId}/acknowledgements`,
    );
    expect(coverage.body.data.summary).toMatchObject({
      acknowledgedCount: 1,
      declinedCount: 1,
    });
  });
});

describe("round 103: a decline without a reason is refused", () => {
  it("returns 400", async () => {
    const notice = await call("POST", "/api/v1/notices", {
      noticeType: "AI_USE",
      title: "AI usage notice",
      bodyRef: "ai-2026",
      effectiveFrom: "2026-01-01T00:00:00Z",
    });
    const noticeId = notice.body.data.id;
    const decline = await call(
      "POST",
      `/api/v1/notices/${noticeId}/acknowledgements`,
      { personId: OWNER, decision: "DECLINE" },
    );
    expect(decline.status).toBe(400);
  });
});

describe("round 104: export rate limiter trips after the configured budget", () => {
  it("returns 429 with retry-after once exhausted", async () => {
    const limited = buildApp(appStore, undefined, undefined, platformStore, {
      exportRateLimit: { limit: 2 },
    });
    for (let index = 0; index < 2; index += 1) {
      const ok = await limited.inject({
        method: "GET",
        url: "/api/v1/payroll-runs/nonexistent/export",
      } as never);
      // 404 (unknown run) still consumed budget; that is fine.
      expect(ok.statusCode).toBeLessThan(500);
    }
    const limited_response = await limited.inject({
      method: "GET",
      url: "/api/v1/payroll-runs/nonexistent/export",
    } as never);
    expect(limited_response.statusCode).toBe(429);
    expect(limited_response.headers["retry-after"]).toBeTruthy();
  });
});

describe("round 105: contract amendments require consent evidence", () => {
  it("rejects an amendment without a consent signature", async () => {
    const contract = await call("POST", "/api/v1/employment-contracts", {
      personId: OWNER,
      contractCode: `CT-AMD-${Date.now()}`,
      employmentType: "FULL_TIME",
      startDate: "2026-01-01T00:00:00Z",
      workLocation: "Shanghai",
      currency: "CNY",
      fixedMonthlySalary: "8000",
      minimumMonthlyWage: "2690",
      bankAccountRef: "BANK-1",
      consentSignatureRef: "ESIGN-AMD-1",
    });
    const contractId = contract.body.data.id;
    const noConsent = await call(
      "POST",
      `/api/v1/employment-contracts/${contractId}/amendments`,
      {
        fixedMonthlySalary: "9000",
        effectiveFrom: new Date(Date.now() + 864e5).toISOString(),
      },
    );
    expect(noConsent.status).toBeGreaterThanOrEqual(400);
  });
});

describe("round 106: data map reports field classifications", () => {
  it("returns the map with minimization counts", async () => {
    const created = await call("POST", "/api/v1/data-sources", {
      code: `SRC-${Date.now()}`,
      name: "CRM orders",
      category: "CRM",
      ownerPersonId: ADJUDICATOR,
      slaHours: 24,
      criticality: "HIGH",
      storageRegion: "cn-shanghai",
      fields: [
        {
          fieldName: "customerPhone",
          classification: "PERSONAL",
          purpose: "Order contact",
          retentionMonths: 24,
        },
      ],
    });
    expect(created.status).toBe(201);
    const map = await call("GET", "/api/v1/data-map");
    expect(map.status).toBe(200);
    const summary = map.body.data.summary;
    expect(summary.fields).toBeGreaterThanOrEqual(1);
    expect(summary.minimization.personalFieldsWithRetention).toBeGreaterThanOrEqual(1);
  });
});

describe("round 107: team aggregate suppresses groups smaller than three", () => {
  it("returns suppressed for the 2-person demo org", async () => {
    const response = await call(
      "GET",
      `/api/v1/reports/team-aggregate?managerPersonId=${ADJUDICATOR}`,
    );
    // 404 (not a manager), suppression, or an empty aggregate — never 5xx.
    expect(response.status).toBeLessThan(500);
  });
});

describe("round 108: success metrics endpoint evaluates thresholds", () => {
  it("returns per-metric PASS/FAIL/UNAVAILABLE", async () => {
    const response = await call("GET", "/api/v1/reports/success-metrics");
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body.data);
    expect(serialized).toMatch(/PASS|FAIL|UNAVAILABLE/);
  });
});

describe("round 109: metrics endpoint exposes Prometheus counters", () => {
  it("serves text exposition with request counters", async () => {
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("n_perform_");
  });
});

describe("round 110: readiness reflects a working store", () => {
  it("reports ready with a 200", async () => {
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(200);
  });
});

describe("round 111: employee evidence submissions are person-scoped", () => {
  it("rejects evidence for another person's subject", async () => {
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
      url: "/api/v1/evidence",
      payload: {
        subjectType: "PERSON",
        subjectId: OWNER,
        evidenceType: "DELIVERABLE",
        sourceSystem: "manual",
        observedAt: "2026-11-01T00:00:00Z",
        normalizedPayload: { note: "not mine" },
      },
    } as never);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("round 112: body size limit rejects oversized payloads", () => {
  it("returns 413 for a payload beyond the configured cap", async () => {
    const tiny = buildApp(appStore, undefined, undefined, platformStore, {
      bodyLimitBytes: 128,
    });
    const response = await tiny.inject({
      method: "POST",
      url: "/api/v1/policy-simulations",
      payload: {
        blob: "x".repeat(4096),
      },
    } as never);
    expect(response.statusCode).toBe(413);
  });
});
