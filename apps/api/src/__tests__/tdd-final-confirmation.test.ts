import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AmountLedgerEntry, EmploymentContract } from "@anari/domain";
import { buildApp } from "../app.js";
import { calculatePayroll } from "../payroll.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";

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
    text: response.body,
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
  app = buildApp(appStore, undefined, undefined, platformStore);
});

async function award(batchNo: string, source: string, note?: string) {
  const created = await call("POST", "/api/v1/incentive-award-batches", {
    batchNo,
    awardType: "MONTHLY_STAR",
    period: "2026-11",
    currency: "CNY",
    createdBy: ADMIN,
    sourceRecordIds: [source],
    lines: [
      {
        personId: MEMBER,
        amount: "500",
        sourceRecordId: source,
        sourceLineRef: "l1",
        note,
      },
    ],
  });
  expect(created.status).toBe(201);
  return created.body.data.id as string;
}

async function cmd(id: string, command: string, extra = {}) {
  return call("POST", `/api/v1/incentive-award-batches/${id}/commands`, {
    command,
    ...extra,
  });
}

async function moveTo(id: string, target: string) {
  for (const step of ["SUBMIT", "APPROVE", "LOCK", "EXPORT"]) {
    if (["SUBMIT", "APPROVE", "LOCK", "EXPORT"].indexOf(step) > ["SUBMIT", "APPROVE", "LOCK", "EXPORT"].indexOf(target)) break;
    const response = await cmd(id, step);
    expect(response.status).toBe(200);
    if (step === target) break;
  }
}

const contract: EmploymentContract = {
  id: "00000000-0000-4000-8000-0000000000d1",
  tenantId: "tenant-demo",
  personId: OWNER,
  contractCode: "CT-SMOOTH-1",
  employmentType: "FULL_TIME",
  startDate: "2026-01-01T00:00:00.000Z",
  workLocation: "Shenzhen",
  currency: "CNY",
  fixedMonthlySalary: "8000",
  minimumMonthlyWage: "2360",
  taxRate: "0",
  socialInsuranceRate: "0",
  deductionCapRate: "1",
  variableShareCapRate: "1",
  deductionOrder: ["RECOVERY", "OTHER"],
  deductionTypeCaps: {},
  smoothingThresholdRate: "1",
  smoothingMode: "RAMP",
  smoothingWindowPeriods: 3,
  smoothingMaxStepRate: "0.5",
  payPlanVersion: 1,
  consentSignatureRef: "sig",
  consentSignedAt: "2026-01-01T00:00:00.000Z",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
};

function incentive(amount: string): AmountLedgerEntry {
  return {
    id: `ledger-${amount}`,
    tenantId: "tenant-demo",
    personId: OWNER,
    cycleId: "00000000-0000-4000-8000-000000000020",
    calculationRunId: "00000000-0000-4000-8000-0000000000d2",
    entryType: "INCENTIVE",
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

function payroll(overrides: Partial<EmploymentContract> = {}, prior = "1000") {
  return calculatePayroll({
    contracts: [{ ...contract, ...overrides }],
    ledger: [incentive("100")],
    priorIncentives: { [contract.id]: prior },
    cycleId: "00000000-0000-4000-8000-000000000020",
    currency: "CNY",
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-10-31T23:59:59.000Z",
  });
}

describe("final confirmation rounds 45-64", () => {
  it("45: approving twice is refused", async () => {
    const id = await award("R45", "s45");
    expect((await cmd(id, "SUBMIT")).status).toBe(200);
    expect((await cmd(id, "APPROVE")).status).toBe(200);
    expect((await cmd(id, "APPROVE")).status).toBe(409);
  });

  it("46: exporting twice is refused", async () => {
    const id = await award("R46", "s46");
    await moveTo(id, "EXPORT");
    expect((await cmd(id, "EXPORT")).status).toBe(409);
  });

  it("47: acknowledging twice is refused", async () => {
    const id = await award("R47", "s47");
    await moveTo(id, "EXPORT");
    expect(
      (await cmd(id, "ACKNOWLEDGE", { paymentRef: "BANK-1" })).status,
    ).toBe(200);
    expect(
      (await cmd(id, "ACKNOWLEDGE", { paymentRef: "BANK-2" })).status,
    ).toBe(409);
  });

  it("48: a source record used by a locked batch cannot be reused", async () => {
    const id = await award("R48-A", "locked-source");
    await moveTo(id, "LOCK");
    const duplicate = await call(
      "POST",
      "/api/v1/incentive-award-batches",
      {
        batchNo: "R48-B",
        awardType: "MONTHLY_STAR",
        period: "2026-11",
        currency: "CNY",
        lines: [{ personId: MEMBER, amount: "500", sourceRecordId: "locked-source" }],
      },
    );
    expect(duplicate.status).toBe(409);
  });

  it("49: built-in email DLP blocks an export", async () => {
    const id = await award("R49", "s49", "contact ceo@example.com");
    await moveTo(id, "EXPORT");
    const response = await call(
      "GET",
      `/api/v1/incentive-award-batches/${id}/export`,
    );
    expect(response.status).toBe(409);
  });

  it("50: finalizing the same annual report twice creates two immutable snapshots", async () => {
    const payload = {
      from: "2025-01-01T00:00:00Z",
      to: "2026-01-01T00:00:00Z",
      report: { stable: true },
      signedOffBy: ADMIN,
    };
    const first = await call(
      "POST",
      "/api/v1/reports/policy-review:finalize",
      payload,
    );
    const second = await call(
      "POST",
      "/api/v1/reports/policy-review:finalize",
      payload,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.payload.reportHash).toBe(
      second.body.data.payload.reportHash,
    );
    const list = await call("GET", "/api/v1/reports/policy-review/snapshots");
    expect(list.body.data).toHaveLength(2);
  });

  it("51: two decisions by the same reviewer do not count as a pair", async () => {
    const now = new Date();
    const cycle = await call("POST", "/api/v1/evaluation-cycles", {
      name: "同评审周期",
      cycleType: "QUARTERLY",
      startsAt: new Date(now.getTime() - 864e5).toISOString(),
      endsAt: new Date(now.getTime() + 864e5).toISOString(),
      timezone: "Asia/Shanghai",
    });
    const cycleId = cycle.body.data.id;
    const rubric = await call("POST", "/api/v1/rubrics", {
      code: `RUB-SAME-${Date.now()}`,
      name: "同评审",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-01-01",
    });
    for (const suffix of ["a", "b"]) {
      const draft = await call("POST", "/api/v1/evaluation-drafts", {
        cycleId,
        personId: MEMBER,
        generatedByType: "USER",
        evidenceSnapshotHash: `same-${suffix}-${Date.now()}`,
        draftPayload: { summary: "同评审" },
      });
      await call("POST", `/api/v1/evaluation-drafts/${draft.body.data.id}/submit`);
      const decided = await call(
        "POST",
        `/api/v1/evaluation-drafts/${draft.body.data.id}/decision`,
        {
          reviewerPersonId: OWNER,
          rubricVersionId: rubric.body.data.id,
          decision: "APPROVE",
          scores: { QUALITY: 4 },
          rationale: "复核通过",
          independentScores: { QUALITY: 4 },
          independentRationale: "独立判断",
        },
      );
      expect(decided.status).toBeLessThan(300);
    }
    const report = await call("GET", "/api/v1/reports/reviewer-agreement");
    expect(report.body.data.insufficient).toBe(true);
    expect(report.body.data.pairCount).toBe(0);
  });

  it("52: importing the same gold-set code and version twice is refused", async () => {
    const payload = {
      code: "GOLD-DUP",
      name: "重复金标集",
      labelSource: "专家",
      ownerPersonId: ADMIN,
      refreshedAt: new Date().toISOString(),
      nextRefreshDueAt: new Date(Date.now() + 864e5).toISOString(),
      samples: [
        { sampleId: "a", subgroup: "A", humanScoreA: 4, humanScoreB: 4, aiScore: 4, counterfactualScores: [4], promptInjectionPassed: true },
        { sampleId: "b", subgroup: "A", humanScoreA: 3, humanScoreB: 3, aiScore: 3, counterfactualScores: [3], promptInjectionPassed: true },
      ],
    };
    expect(
      (await call("POST", "/api/v1/model-evaluation-datasets:import", payload)).status,
    ).toBe(201);
    expect(
      (await call("POST", "/api/v1/model-evaluation-datasets:import", payload)).status,
    ).toBe(409);
  });

  it("53: task pod rejects a stale AI member version", async () => {
    const ai = await call("POST", "/api/v1/ai-members", {
      name: "版本助理",
      role: "EVIDENCE_AGENT",
      aiVersion: "2.0.0",
      responsibilities: ["证据"],
    });
    const aiId = ai.body.data.id;
    const response = await call("POST", "/api/v1/task-pods", {
      title: "版本任务组",
      objective: "验证版本快照",
      initiatorPersonId: OWNER,
      members: [
        { kind: "PERSON", memberId: OWNER, role: "INITIATOR" },
        { kind: "AI", memberId: aiId, role: "EVIDENCE_AGENT", aiVersion: "1.0.0" },
      ],
    });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("版本快照");
  });

  it("54: personal task inventory rejects duplicate task ids", async () => {
    const task = {
      taskId: "dup",
      name: "任务",
      deliverable: "交付物",
      measure: "口径",
      mode: "HUMAN",
    };
    const response = await call(
      "POST",
      "/api/v1/personal-task-inventories",
      {
        personId: OWNER,
        period: "2026-Q4",
        tasks: [task, task],
      },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("重复");
  });

  it("55: RAMP caps a downward jump as well as an upward jump", () => {
    const line = payroll().lines[0]!;
    // prior 1000, max 50% step → lower bound 500; raw 100 → 500
    expect(line.rawIncentiveAmount).toBe("100");
    expect(line.smoothedIncentiveAmount).toBe("500");
  });

  it("56: MOVING_AVERAGE with a window of 1 uses the raw amount", () => {
    const line = payroll({
      smoothingMode: "MOVING_AVERAGE",
      smoothingWindowPeriods: 1,
    }).lines[0]!;
    expect(line.smoothedIncentiveAmount).toBe("100");
  });

  it("57: RAMP with no prior period passes the raw amount", () => {
    const line = payroll({ smoothingMode: "RAMP" }, "0").lines[0]!;
    expect(line.smoothedIncentiveAmount).toBe("100");
  });

  it("58: consent-required deductions block without a consent reference", () => {
    const result = calculatePayroll({
      contracts: [{ ...contract, deductionOrder: ["UNION_FEE"] }],
      ledger: [
        {
          ...incentive("-100"),
          id: "union-1",
          entryType: "UNION_FEE",
        } as unknown as AmountLedgerEntry,
      ],
      statutoryDeductionTypes: [
        { type: "UNION_FEE", priority: 0, requiresConsent: true },
      ],
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
    });
    expect(result.lines[0]!.deductionLegalBasisPassed).toBe(false);
    expect(result.lines[0]!.deductionLegalBasisMissing).toEqual([
      "UNION_FEE:EMPLOYEE_CONSENT",
    ]);
  });

  it("59: statutory registry preserves a newly registered custom type", async () => {
    await call("PUT", "/api/v1/statutory-deduction-types", {
      types: [{ type: "UNION_FEE", priority: 1, requiresConsent: true }],
    });
    const response = await call("GET", "/api/v1/statutory-deduction-types");
    expect(response.body.data[0].type).toBe("UNION_FEE");
    expect(response.body.data[0].requiresConsent).toBe(true);
  });

  it("60: read-all is idempotent", async () => {
    await appStore.createNotification({
      recipientPersonId: MEMBER,
      audience: "PERSON",
      title: "提醒",
      body: "x",
    });
    const first = await call("POST", "/api/v1/notifications/read-all");
    const second = await call("POST", "/api/v1/notifications/read-all");
    expect(first.body.data.marked).toBe(1);
    expect(second.body.data.marked).toBe(0);
  });

  it("61: data governance coverage has no unmapped core table", async () => {
    const response = await call("GET", "/api/v1/data-map");
    expect(response.status).toBe(200);
    expect(response.body.data.summary.entityPiiCoverage.missingTableMappings).toEqual([]);
  });

  it("62: multi-line award total is exact to two decimals", async () => {
    const response = await call("POST", "/api/v1/incentive-award-batches", {
      batchNo: "R62",
      awardType: "TECH_CENTER_AWARD",
      period: "2026-Q4",
      currency: "CNY",
      lines: [
        { personId: OWNER, amount: "500" },
        { personId: MEMBER, amount: "250.50" },
      ],
    });
    expect(response.status).toBe(201);
    expect(response.body.data.totalAmount).toBe("750.5");
  });

  it("63: an approved batch can still be cancelled", async () => {
    const id = await award("R63", "s63");
    expect((await cmd(id, "SUBMIT")).status).toBe(200);
    expect((await cmd(id, "APPROVE")).status).toBe(200);
    expect((await cmd(id, "CANCEL")).status).toBe(200);
  });

  it("64: cancelled batch is terminal", async () => {
    const id = await award("R64", "s64");
    expect((await cmd(id, "CANCEL")).status).toBe(200);
    expect((await cmd(id, "SUBMIT")).status).toBe(409);
    expect((await cmd(id, "CANCEL")).status).toBe(409);
  });
});
