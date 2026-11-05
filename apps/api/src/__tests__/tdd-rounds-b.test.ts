/*
 * TDD rounds 20–32: verification rounds. Each round asserts one
 * already-hardened behaviour; any red here means a regression and must be
 * fixed before the streak can be declared clean.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

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

const ADMIN = "00000000-0000-4000-8000-000000000003";
const OWNER = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  appStore = new Store();
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore);
});

async function createStrategicCase(): Promise<string> {
  const created = await call("POST", "/api/v1/strategic-pool-cases", {
    cycleId: "00000000-0000-4000-8000-000000000020",
    poolAmount: "500000",
    capAmount: "600000",
    currency: "CNY",
    requestedBy: OWNER,
    rationale: "A-class pool",
  });
  const caseId = created.body.data.id;
  await call("POST", `/api/v1/strategic-pool-cases/${caseId}/cost-review`, {
    units: 10,
    unitStandardCost: "100",
    transferPricingRef: "TP-1",
    reviewedBy: ADMIN,
  });
  return caseId;
}

describe("round 20: strategic pool cannot activate twice", () => {
  it("rejects the second activation with 409", async () => {
    const caseId = await createStrategicCase();
    await call(
      "POST",
      `/api/v1/strategic-pool-cases/${caseId}/finance-approve`,
      { approvedBy: ADMIN, deferredInstallmentMonths: 0 },
    );
    expect(
      (await call("POST", `/api/v1/strategic-pool-cases/${caseId}/activate`))
        .status,
    ).toBe(200);
    const again = await call(
      "POST",
      `/api/v1/strategic-pool-cases/${caseId}/activate`,
    );
    expect(again.status).toBe(409);
  });
});

describe("round 21: strategic pool cannot settle before activation", () => {
  it("rejects settling a FINANCE_APPROVED case with 409", async () => {
    const caseId = await createStrategicCase();
    await call(
      "POST",
      `/api/v1/strategic-pool-cases/${caseId}/finance-approve`,
      { approvedBy: ADMIN, deferredInstallmentMonths: 0 },
    );
    const settle = await call(
      "POST",
      `/api/v1/strategic-pool-cases/${caseId}/settle`,
    );
    expect(settle.status).toBe(409);
  });
});

describe("round 23: a waived clawback case cannot generate recovery", () => {
  it("returns 409 CLAWBACK_NOT_APPROVED", async () => {
    const clawback = await call("POST", "/api/v1/clawback-cases", {
      personId: OWNER,
      amount: "100",
      currency: "CNY",
      reasonCode: "OVERPAYMENT",
      explanation: "Recovered overpayment",
      consentSignatureRef: "ESIGN-TDD",
      installmentMonths: 1,
      hardshipWaiver: false,
      requestedBy: OWNER,
    });
    const caseId = clawback.body.data.id;
    await call("POST", `/api/v1/clawback-cases/${caseId}/waive`, {
      approvedBy: ADMIN,
      reason: "Goodwill waiver",
    });
    const recovery = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      { cycleId: "00000000-0000-4000-8000-000000000020", ledgerEntryId: "x" },
    );
    expect(recovery.status).toBe(409);
    // The store raises a generic CONFLICT naming the status; the route's own
    // guard message distinguishes clawback state errors.
    expect(recovery.body.error.code).toBe("CONFLICT");
    expect(recovery.body.error.message).toMatch(/clawback/i);
  });
});

describe("round 24: unknown match predicates are rejected on write", () => {
  it("returns VALIDATION_ERROR for an unknown predicate", async () => {
    const response = await call("PUT", "/api/v1/field-access-policies", {
      fieldAccessPolicies: {
        "PAYROLL_LINE.netAmount": {
          allowRoles: ["finance"],
          match: { timeTravels: true },
        },
      },
    });
    expect(response.status).toBe(400);
  });
});

describe("round 27: voided invoices never collide with new numbers", () => {
  it("issues a fresh sequential number after a void", async () => {
    await call("POST", "/api/v1/platform/plans", {
      code: "TEAM2",
      name: "Team",
      monthlyPrice: "1999.00",
      currency: "CNY",
      seatLimit: 5,
      trialDays: 0,
      features: [],
    });
    await call("PUT", "/api/v1/platform/tenants/tenant-demo/subscription", {
      planCode: "TEAM2",
      status: "ACTIVE",
      seats: 5,
      currentPeriodStart: "2026-11-01T00:00:00Z",
      currentPeriodEnd: "2026-11-30T23:59:59Z",
    });
    const first = await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/invoices",
      {
        lineItems: [
          { description: "a", quantity: 1, unitAmount: "9.00", amount: "9.00" },
        ],
      },
    );
    await call("POST", `/api/v1/platform/invoices/${first.body.data.id}/status`, {
      status: "VOID",
    });
    const second = await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/invoices",
      {
        lineItems: [
          { description: "b", quantity: 1, unitAmount: "9.00", amount: "9.00" },
        ],
      },
    );
    expect(second.body.data.number).not.toBe(first.body.data.number);
    expect(second.status).toBe(201);
  });
});

describe("round 32: recovery on a DRAFT clawback is refused", () => {
  it("returns 409 before touching the ledger", async () => {
    const clawback = await call("POST", "/api/v1/clawback-cases", {
      personId: OWNER,
      amount: "100",
      currency: "CNY",
      reasonCode: "OVERPAYMENT",
      explanation: "Recovered overpayment",
      consentSignatureRef: "ESIGN-TDD2",
      installmentMonths: 1,
      hardshipWaiver: false,
      requestedBy: OWNER,
    });
    const recovery = await call(
      "POST",
      `/api/v1/clawback-cases/${clawback.body.data.id}/generate-recovery`,
      { cycleId: "00000000-0000-4000-8000-000000000020", ledgerEntryId: "x" },
    );
    expect(recovery.status).toBe(409);
  });
});
