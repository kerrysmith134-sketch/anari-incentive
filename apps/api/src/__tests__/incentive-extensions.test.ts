import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { calculatePayroll } from "../payroll.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import type { AmountLedgerEntry, EmploymentContract } from "@anari/domain";

const OWNER = "00000000-0000-4000-8000-000000000001";
const CYCLE = "00000000-0000-4000-8000-000000000020";

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
        {
          id: "00000000-0000-4000-8000-000000000002",
          employeeCode: "E002",
          displayName: "Contributor",
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          employeeCode: "E003",
          displayName: "Adjudicator",
        },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore);
});

describe("strategic pool lifecycle (INC-09)", () => {
  it("walks draft to settlement with cost accounting and separation of duties", async () => {
    const created = await call("POST", "/api/v1/strategic-pool-cases", {
      cycleId: CYCLE,
      poolAmount: "500000",
      capAmount: "600000",
      currency: "CNY",
      requestedBy: OWNER,
      rationale: "A-class contribution profit pool for DC charging sales",
    });
    expect(created.status).toBe(201);
    const caseId = created.body.data.id;

    const overCap = await call("POST", "/api/v1/strategic-pool-cases", {
      cycleId: CYCLE,
      poolAmount: "700000",
      capAmount: "600000",
      currency: "CNY",
      requestedBy: OWNER,
      rationale: "too big",
    });
    expect(overCap.status).toBe(409);

    const wrongState = await call(
      "POST",
      `/api/v1/strategic-pool-cases/${caseId}/finance-approve`,
      { approvedBy: "00000000-0000-4000-8000-000000000003", deferredInstallmentMonths: 3 },
    );
    expect(wrongState.status).toBe(409);

    const reviewed = await call(
      "POST",
      `/api/v1/strategic-pool-cases/${caseId}/cost-review`,
      {
        units: 1200,
        unitStandardCost: "1800",
        transferPricingRef: "TP-AUDIT-2026-11",
        reviewedBy: "00000000-0000-4000-8000-000000000002",
      },
    );
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.status).toBe("COST_REVIEWED");
    expect(reviewed.body.data.totalStandardCost).toBe("2160000");

    const selfApproval = await call(
      "POST",
      `/api/v1/strategic-pool-cases/${caseId}/finance-approve`,
      { approvedBy: OWNER, deferredInstallmentMonths: 3 },
    );
    expect(selfApproval.status).toBe(409);
    expect(selfApproval.body.error.code).toBe("CONFLICT");

    const approved = await call(
      "POST",
      `/api/v1/strategic-pool-cases/${caseId}/finance-approve`,
      {
        approvedBy: "00000000-0000-4000-8000-000000000003",
        deferredInstallmentMonths: 3,
      },
    );
    expect(approved.body.data.status).toBe("FINANCE_APPROVED");
    expect(approved.body.data.deferredInstallmentMonths).toBe(3);

    const activated = await call(
      "POST",
      `/api/v1/strategic-pool-cases/${caseId}/activate`,
    );
    expect(activated.body.data.status).toBe("ACTIVE");

    const settled = await call(
      "POST",
      `/api/v1/strategic-pool-cases/${caseId}/settle`,
    );
    expect(settled.body.data.status).toBe("SETTLED");
    expect(settled.body.data.settledAt).toBeTruthy();

    const listed = await call("GET", "/api/v1/strategic-pool-cases");
    expect(listed.body.data).toHaveLength(1);
  });
});

describe("statutory deduction registry (LG-06)", () => {
  const contract: EmploymentContract = {
    id: "00000000-0000-4000-8000-0000000000c1",
    tenantId: "tenant-demo",
    personId: OWNER,
    contractCode: "CT-LG06",
    employmentType: "FULL_TIME",
    startDate: "2026-01-01T00:00:00.000Z",
    workLocation: "Shanghai",
    currency: "CNY",
    fixedMonthlySalary: "8000",
    minimumMonthlyWage: "2690",
    taxRate: "0",
    socialInsuranceRate: "0",
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

  function recoveryEntry(amount: string): AmountLedgerEntry {
    return {
      id: `ledger-${amount}`,
      tenantId: "tenant-demo",
      personId: OWNER,
      cycleId: CYCLE,
      calculationRunId: "00000000-0000-4000-8000-0000000000c2",
      entryType: "RECOVERY",
      amount,
      currency: "CNY",
      status: "LOCKED",
      idempotencyKey: `key-${amount}`,
      entryHash: "hash",
      prevHash: "prev",
      createdAt: "2026-10-01T00:00:00.000Z",
      lockedAt: "2026-10-01T00:00:00.000Z",
    };
  }

  it("classifies deductions, applies the registry priority and default cap", () => {
    const result = calculatePayroll({
      contracts: [contract],
      ledger: [recoveryEntry("-900")],
      statutoryDeductionTypes: [
        {
          type: "RECOVERY",
          priority: 0,
          requiresConsent: true,
          capRate: "0.1",
        },
      ],
      cycleId: CYCLE,
      currency: "CNY",
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-11-30T23:59:59.000Z",
    });
    const breakdown = result.lines[0]!.deductionBreakdown;
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]!.statutory).toBe(true);
    expect(breakdown[0]!.requiresConsent).toBe(true);
    expect(breakdown[0]!.priority).toBe(0);
    // Registry default cap 10% of 8000 = 800; the 900 deduction breaches it.
    expect(result.lines[0]!.deductionTypeCapPassed).toBe(false);
    expect(result.lines[0]!.deductionTypeCapBreaches).toEqual(["RECOVERY"]);
  });

  it("leaves unregistered types untouched", () => {
    const result = calculatePayroll({
      contracts: [contract],
      ledger: [recoveryEntry("-100")],
      cycleId: CYCLE,
      currency: "CNY",
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-11-30T23:59:59.000Z",
    });
    expect(result.lines[0]!.deductionBreakdown[0]!.statutory).toBeUndefined();
    expect(result.lines[0]!.deductionTypeCapPassed).toBe(true);
  });
});

describe("clawback recovery generation (INC-10)", () => {
  it("appends a locked recovery adjustment and opens a RECOVERY batch once", async () => {
    // Full money-path setup: package -> claim -> decision -> formal run -> lock.
    const created = await call("POST", "/api/v1/work-packages", {
      title: "Clawback source package",
      objective: "Deliver a validated customer order",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "Order delivery",
        },
        {
          personId: "00000000-0000-4000-8000-000000000002",
          responsibilityCode: "CONTRIBUTOR",
          expectedOutput: "Technical validation",
        },
      ],
      acceptanceCriteria: ["Customer accepts the delivery"],
    });
    const workPackageId = created.body.data.id;
    for (const [step, payload] of [
      ["commit", { expectedVersion: 1 }],
      ["start", {}],
      ["submit", {}],
      [
        "accept",
        { reviewerPersonId: "00000000-0000-4000-8000-000000000002" },
      ],
    ] as const) {
      const response = await call(
        "POST",
        `/api/v1/work-packages/${workPackageId}/${step}`,
        payload as Record<string, unknown>,
      );
           expect(response.status).toBe(200);
    }
    const claim = await call("POST", "/api/v1/contribution-claims", {
      workPackageId,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: {
        dimensions: ["QUALITY"],
        summary: "Delivered the agreed scope",
      },
      evidenceRefs: ["evidence-1"],
      rationale: "Delivered the agreed scope on time",
    });
    await call("POST", `/api/v1/contribution-claims/${claim.body.data.id}/submit`);
    const decision = await call("POST", "/api/v1/attribution-decisions", {
      claimId: claim.body.data.id,
      adjudicatorPersonId: "00000000-0000-4000-8000-000000000003",
      status: "CONFIRMED",
      acceptedFacts: ["Delivered the agreed scope"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "Evidence supports the claim",
    });
    expect(decision.status).toBe(201);
    const gate = await call(
      "POST",
      "/api/v1/policy-versions/00000000-0000-4000-8000-000000000100/legal-gate",
      {
        policyApproved: true,
        minimumWageChecked: true,
        democraticProcedureRef: "demo-dp-1",
        employeeNoticeRef: "demo-notice-1",
        dataProtectionAssessmentRef: "demo-dpia-1",
        recordedBy: "00000000-0000-4000-8000-000000000003",
      },
    );
    expect(gate.status).toBe(200);
    const run = await call("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: "00000000-0000-4000-8000-000000000100",
      mode: "FORMAL",
      order: { id: "order-1", grossProfit: "100000", currency: "CNY" },
      participants: [
        {
          personId: OWNER,
          workPackageId,
          attributionWeight: "1",
          role: "OWNER",
        },
      ],
    });
    expect(run.status).toBe(201);
    const runId = run.body.data.id;
    await call("POST", "/api/v1/employee-confirmations", {
      personId: OWNER,
      targetType: "CALCULATION",
      targetId: runId,
      decision: "CONFIRMED",
    });
    await call("POST", `/api/v1/calculation-runs/${runId}/approve`);
    const locked = await call("POST", `/api/v1/calculation-runs/${runId}/lock`, {
      confirmation: "LOCK_CALCULATION",
    });
    expect(locked.status).toBe(200);

    const ledger = await call("GET", "/api/v1/ledger");
    const entry = ledger.body.data.find(
      (candidate: { personId: string }) => candidate.personId === OWNER,
    );
    expect(entry).toBeTruthy();

    // Clawback case -> approve -> generate recovery.
    const clawback = await call("POST", "/api/v1/clawback-cases", {
      personId: OWNER,
      amount: "500",
      currency: "CNY",
      reasonCode: "CUSTOMER_CLAWBACK",
      explanation: "Customer recovered part of the payment",
      consentSignatureRef: "ESIGN-CLAWBACK-1",
      installmentMonths: 1,
      hardshipWaiver: false,
      requestedBy: OWNER,
    });
    expect(clawback.status).toBe(201);
    const caseId = clawback.body.data.id;
    const approvedCase = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/approve`,
      { approvedBy: "00000000-0000-4000-8000-000000000003" },
    );
    expect(approvedCase.status).toBe(200);

    const recovery = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      { cycleId: CYCLE, ledgerEntryId: entry.id },
    );
    expect(recovery.status).toBe(200);
    expect(recovery.body.data.recoveryBatch.kind).toBe("RECOVERY");

    const duplicate = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      { cycleId: CYCLE, ledgerEntryId: entry.id, createBatch: false },
    );
    expect(duplicate.status).toBe(409);
  });
});
