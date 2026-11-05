/*
 * TDD rounds 01–06: adversarial probes expected to expose real defects.
 * Each `round NN` describe block is one TDD round: red first, then fixed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { payrollBankFileCsv } from "../payroll.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import type { PayrollRun } from "@anari/domain";

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
        {
          id: "00000000-0000-4000-8000-000000000001",
          employeeCode: "E001",
          displayName: "Sales Lead",
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          employeeCode: "E003",
          displayName: "Admin",
        },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore);
});

// ---------------------------------------------------------------------------
// Round 01 — money integrity: invoice line items must reject zero amounts.
// ---------------------------------------------------------------------------
describe("round 01: invoice rejects non-positive amounts", () => {
  it("rejects a zero-amount line item with 400", async () => {
    await call("POST", "/api/v1/platform/plans", {
      code: "TEAM",
      name: "Team",
      monthlyPrice: "1999.00",
      currency: "CNY",
      seatLimit: 5,
      trialDays: 0,
      features: [],
    });
    await call("PUT", "/api/v1/platform/tenants/tenant-demo/subscription", {
      planCode: "TEAM",
      status: "ACTIVE",
      seats: 5,
      currentPeriodStart: "2026-11-01T00:00:00Z",
      currentPeriodEnd: "2026-11-30T23:59:59Z",
    });
    const zero = await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/invoices",
      {
        lineItems: [
          {
            description: "Zero line",
            quantity: 1,
            unitAmount: "0.00",
            amount: "0.00",
          },
        ],
      },
    );
    expect(zero.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Round 02 — bank file fen rounding must be HALF_UP, also for negatives.
// ---------------------------------------------------------------------------
const run = (net: string): PayrollRun =>
  makeRun(net);

function makeRun(net: string): PayrollRun {
    return ({
      id: "run-1",
      tenantId: "tenant-demo",
      cycleId: "cycle-1",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      currency: "CNY",
      status: "CALCULATED",
      preparedBy: "p1",
      totalGross: net,
      totalDeductions: "0",
      totalTax: "0",
      totalSocialInsurance: "0",
      totalNet: net,
      lineCount: 1,
      blockedCount: 0,
      createdAt: "2026-11-05T00:00:00Z",
      updatedAt: "2026-11-05T00:00:00Z",
      version: 1,
      lines: [
        {
          id: "l1",
          tenantId: "tenant-demo",
          runId: "run-1",
          personId: "p1",
          contractId: "c1",
          currency: "CNY",
          fixedAmount: "0",
          incentiveAmount: net,
          grossAmount: net,
          deductionAmount: "0",
          taxAmount: "0",
          socialInsuranceAmount: "0",
          netAmount: net,
          minimumMonthlyWage: "0",
          minimumWagePassed: true,
          deductionCapRate: "0.2",
          deductionCapAmount: "0",
          deductionCapPassed: true,
          variableShareRate: "0",
          variableShareCapRate: "1",
          variableShareCapAmount: "0",
          variableSharePassed: true,
          deductionTypeCapPassed: true,
          deductionTypeCapBreaches: [],
          priorIncentiveAmount: "0",
          incentiveChangeRate: "0",
          smoothingThresholdRate: "1",
          smoothingPassed: true,
          noticeAcknowledgementPassed: true,
          noticeAcknowledgementMissing: [],
          deductionBreakdown: [],
          bankAccountRef: "BANK-1",
          createdAt: "2026-11-05T00:00:00Z",
        },
      ],
    }) as unknown as PayrollRun;
}

describe("round 02: ICBC bank file rounds fen HALF_UP", () => {
  it("rounds half a fen up for positive nets", () => {
    const csv = payrollBankFileCsv(run("0.005"), "ICBC");
    const row = csv.trim().split("\n")[1]!;
    expect(row).toContain(",1,");
  });

  it("rounds half a fen away from zero for negative nets", () => {
    const csv = payrollBankFileCsv(run("-0.005"), "ICBC");
    const row = csv.trim().split("\n")[1]!;
    expect(row).toContain(",-1,");
  });
});

// ---------------------------------------------------------------------------
// Round 03 — parallel invoice creation must not collide on invoice numbers.
// ---------------------------------------------------------------------------
describe("round 03: parallel invoice creation keeps numbers unique", () => {
  it("issues distinct numbers under parallel requests", async () => {
    await call("POST", "/api/v1/platform/plans", {
      code: "TEAM",
      name: "Team",
      monthlyPrice: "1999.00",
      currency: "CNY",
      seatLimit: 5,
      trialDays: 0,
      features: [],
    });
    await call("PUT", "/api/v1/platform/tenants/tenant-demo/subscription", {
      planCode: "TEAM",
      status: "ACTIVE",
      seats: 5,
      currentPeriodStart: "2026-11-01T00:00:00Z",
      currentPeriodEnd: "2026-11-30T23:59:59Z",
    });
    const results = await Promise.all([
      call("POST", "/api/v1/platform/tenants/tenant-demo/invoices", {
        lineItems: [
          { description: "a", quantity: 1, unitAmount: "1.00", amount: "1.00" },
        ],
      }),
      call("POST", "/api/v1/platform/tenants/tenant-demo/invoices", {
        lineItems: [
          { description: "b", quantity: 1, unitAmount: "1.00", amount: "1.00" },
        ],
      }),
      call("POST", "/api/v1/platform/tenants/tenant-demo/invoices", {
        lineItems: [
          { description: "c", quantity: 1, unitAmount: "1.00", amount: "1.00" },
        ],
      }),
    ]);
    const numbers = results.map((r) => r.body.data?.number);
    expect(new Set(numbers).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Rounds 07–10 — session JWT hardening + signup hygiene (verification).
// ---------------------------------------------------------------------------
describe("round 07: expired session token is rejected", () => {
  it("returns 401 SESSION_INVALID", async () => {
    const { SessionJwt } = await import("@anari/auth");
    const jwt = new SessionJwt("secret-0123456789abcdef");
    const token = await jwt.sign({
      tenantId: "tenant-demo",
      userId: "u1",
      roles: ["employee"],
      ttlSeconds: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const sessionAuth = new (
      await import("@anari/auth")
    ).SessionAuthenticator("secret-0123456789abcdef");
    await expect(sessionAuth.authenticate({ authorization: `Bearer ${token}` })).rejects.toThrow(
      /invalid or expired/,
    );
  });
});

describe("round 08: alg=none token is rejected", () => {
  it("returns SESSION_INVALID for an unsigned token", async () => {
    const { SessionAuthenticator } = await import("@anari/auth");
    const b64 = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      tenantId: "tenant-demo",
      userId: "attacker",
      roles: ["admin"],
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;
    const sessionAuth = new SessionAuthenticator("secret-0123456789abcdef");
    await expect(
      sessionAuth.authenticate({ authorization: `Bearer ${forged}` }),
    ).rejects.toThrow();
  });
});

describe("round 09: signup honeypot rejects bots", () => {
  it("400s when the honeypot field carries content", async () => {
    const response = await call("POST", "/api/v1/public/signup", {
      companyName: "Acme",
      adminDisplayName: "K",
      adminEmail: "a@b.test",
      acceptTerms: true,
      website: "spam.example",
    });
    expect(response.status).toBe(400);
  });
});

describe("round 10: unlimited seat plan (-1) onboards freely", () => {
  it("never returns SEAT_LIMIT_REACHED", async () => {
    await call("POST", "/api/v1/platform/plans", {
      code: "ENT",
      name: "Enterprise",
      monthlyPrice: "9999.00",
      currency: "CNY",
      seatLimit: -1,
      trialDays: 0,
      features: [],
    });
    await call("PUT", "/api/v1/platform/tenants/tenant-demo/subscription", {
      planCode: "ENT",
      status: "ACTIVE",
      seats: 1,
      currentPeriodStart: "2026-11-01T00:00:00Z",
      currentPeriodEnd: "2026-11-30T23:59:59Z",
    });
    for (let index = 0; index < 5; index += 1) {
      const created = await call(
        "POST",
        "/api/v1/platform/tenants/tenant-demo/persons",
        {
          employeeCode: `E-U${index}`,
          displayName: `Unlimited ${index}`,
        },
      );
      expect(created.status).toBe(201);
    }
  });
});

// ---------------------------------------------------------------------------
// Rounds 11–12 — retention disposal processor hardening.
// ---------------------------------------------------------------------------
async function createApprovedDisposal() {
  const policy = await call("POST", "/api/v1/retention-policies", {
    dataCategory: "AI_EVALUATION_EVIDENCE",
    retentionMonths: 12,
    legalBasis: "consent",
    legalHold: false,
  });
  const disposal = await call("POST", "/api/v1/retention-disposal-requests", {
    retentionPolicyId: policy.body.data.id,
    requestedBy: "00000000-0000-4000-8000-000000000001",
    reason: "retention elapsed",
    scheduledFor: new Date(Date.now() + 1000).toISOString(),
  });
  await call(
    "POST",
    `/api/v1/retention-disposal-requests/${disposal.body.data.id}/approve`,
    { approvedBy: "00000000-0000-4000-8000-000000000003" },
  );
  return { policy: policy.body.data, disposal: disposal.body.data };
}

describe("round 11: legal hold set after approval blocks the processor", () => {
  it("skips a held category, then completes after the hold clears", async () => {
    const { policy, disposal } = await createApprovedDisposal();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await call(
      "POST",
      `/api/v1/retention-policies/${policy.id}/legal-hold`,
      { legalHold: true },
    );
    const held = await call(
      "POST",
      "/api/v1/retention-disposal-requests:process",
      { actorPersonId: "00000000-0000-4000-8000-000000000003" },
    );
    expect(held.status).toBe(200);
    expect(held.body.data.processedCount).toBe(0);

    await call("POST", `/api/v1/retention-policies/${policy.id}/legal-hold`, {
      legalHold: false,
    });
    const cleared = await call(
      "POST",
      "/api/v1/retention-disposal-requests:process",
      { actorPersonId: "00000000-0000-4000-8000-000000000003" },
    );
    expect(cleared.body.data.processedCount).toBe(1);
    expect(cleared.body.data.completed).toContain(disposal.id);
  });
});

describe("round 12: processor reports a bad actor instead of 500", () => {
  it("marks the request skipped with the reason", async () => {
    await createApprovedDisposal();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const response = await call(
      "POST",
      "/api/v1/retention-disposal-requests:process",
      { actorPersonId: "00000000-0000-4000-8000-000000000999" },
    );
    expect(response.status).toBe(200);
    expect(response.body.data.processedCount).toBe(0);
    expect(response.body.data.skipped.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Rounds 13–18 — payroll math boundaries (pure calculation probes).
// ---------------------------------------------------------------------------
import { calculatePayroll } from "../payroll.js";
import type { AmountLedgerEntry, EmploymentContract } from "@anari/domain";

const contract: EmploymentContract = {
  id: "00000000-0000-4000-8000-0000000000c1",
  tenantId: "tenant-demo",
  personId: "00000000-0000-4000-8000-000000000001",
  contractCode: "CT-TDD",
  employmentType: "FULL_TIME",
  startDate: "2026-01-01T00:00:00.000Z",
  workLocation: "Shanghai",
  currency: "CNY",
  fixedMonthlySalary: "8000",
  minimumMonthlyWage: "2690",
  taxRate: "0.1",
  socialInsuranceRate: "0.05",
  deductionCapRate: "0.2",
  variableShareCapRate: "1",
  deductionOrder: ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
  deductionTypeCaps: {},
  smoothingThresholdRate: "1",
  bankAccountRef: "BANK-1",
  payPlanVersion: 1,
  consentSignatureRef: "ESIGN-1",
  consentSignedAt: "2026-01-01T00:00:00.000Z",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
};

const CYCLE = "00000000-0000-4000-8000-000000000020";

function ledger(
  amount: string,
  entryType: AmountLedgerEntry["entryType"] = "INCENTIVE",
): AmountLedgerEntry {
  return {
    id: `ledger-${amount}-${entryType}`,
    tenantId: "tenant-demo",
    personId: contract.personId,
    cycleId: CYCLE,
    calculationRunId: "00000000-0000-4000-8000-0000000000c2",
    entryType,
    amount,
    currency: "CNY",
    status: "LOCKED",
    idempotencyKey: `key-${amount}-${entryType}`,
    entryHash: "hash",
    prevHash: "prev",
    createdAt: "2026-11-01T00:00:00.000Z",
    lockedAt: "2026-11-01T00:00:00.000Z",
  };
}

const NOV = {
  cycleId: CYCLE,
  currency: "CNY",
  periodStart: "2026-11-01T00:00:00.000Z",
  periodEnd: "2026-11-30T23:59:59.000Z",
};

describe("round 13: statutory bracket boundary at exactly 144000", () => {
  it("lands on the 10% bracket with quick deduction 2520", () => {
    const result = calculatePayroll({
      contracts: [{ ...contract, taxRate: "0" }],
      ledger: [],
      taxMode: "STATUTORY_CN",
      priorYtd: {
        [contract.personId]: { taxableIncome: "141400", taxWithheld: "11620" },
      },
      ...NOV,
    });
    const line = result.lines[0]!;
    expect(line.ytdTaxableIncome).toBe("144000");
    expect(line.iitRatePercent).toBe(10);
    expect(line.iitQuickDeduction).toBe("2520");
    expect(line.taxAmount).toBe("260");
  });
});

describe("round 14: over-withholding clamps the period tax at zero", () => {
  it("never goes negative", () => {
    const result = calculatePayroll({
      contracts: [{ ...contract, taxRate: "0" }],
      ledger: [],
      taxMode: "STATUTORY_CN",
      priorYtd: {
        [contract.personId]: { taxableIncome: "141400", taxWithheld: "50000" },
      },
      ...NOV,
    });
    expect(result.lines[0]!.taxAmount).toBe("0");
  });
});

describe("round 15: smoothing ignores the first period (prior = 0)", () => {
  it("passes even with a large first incentive", () => {
    const result = calculatePayroll({
      contracts: [{ ...contract, smoothingThresholdRate: "0.1" }],
      ledger: [ledger("5000")],
      priorIncentives: { [contract.id]: "0" },
      ...NOV,
    });
    expect(result.lines[0]!.smoothingPassed).toBe(true);
  });
});

describe("round 16: deduction exactly at the cap passes", () => {
  it("treats equality as compliant", () => {
    const result = calculatePayroll({
      contracts: [{ ...contract, deductionCapRate: "0.2" }],
      ledger: [ledger("-1600", "RECOVERY")],
      ...NOV,
    });
    expect(result.lines[0]!.deductionCapPassed).toBe(true);
    expect(result.blockedCount).toBe(0);
  });
});

describe("round 17: variable share with zero gross does not divide by zero", () => {
  it("reports rate 0 and passes", () => {
    const result = calculatePayroll({
      contracts: [{ ...contract, fixedMonthlySalary: "0" }],
      ledger: [],
      ...NOV,
    });
    const line = result.lines[0]!;
    expect(line.grossAmount).toBe("0");
    expect(line.variableShareRate).toBe("0");
    expect(line.variableSharePassed).toBe(true);
  });
});

describe("round 18: bank CSV neutralises formula injection", () => {
  it("prefixes a leading = in the bank reference", () => {
    const base = run("100");
    const hostile = payrollBankFileCsv(
      {
        ...base,
        lines: [{ ...base.lines![0]!, bankAccountRef: "=cmd|' !C" }],
      } as unknown as PayrollRun,
      "GENERIC",
    );
    const row = hostile.trim().split("\n")[1]!;
    expect(row).toContain("'=cmd");
  });
});
