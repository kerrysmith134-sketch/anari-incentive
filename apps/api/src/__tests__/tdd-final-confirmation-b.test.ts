import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  calculateAnnualProfitSharing,
  calculateAnnualScorecard,
  calculateBusinessUnitCommission,
  calculateDbcp,
  calculateEquityGrant,
  calculateInternalSplit,
  calculateOverseasSalesAward,
  calculateTechCenterAward,
  calculateVestingSchedule,
  scorePerformance,
} from "@anari/policy-dsl";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";

let app: FastifyInstance;
let appStore: Store;
let platformStore: MemoryPlatformStore;

async function call(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    text: response.body,
    headers: response.headers,
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

describe("final confirmation rounds 65-80", () => {
  it("65: piecewise score above the last anchor clamps at maxScore", () => {
    const result = scorePerformance({
      personId: OWNER,
      period: "QUARTERLY",
      metrics: [
        {
          metricId: "P",
          name: "分段",
          period: "QUARTERLY",
          applicableRoles: ["*"],
          weight: "100",
          metricType: "PIECEWISE_LINEAR",
          dataSource: "test",
          sourceFields: [],
          calculationRule: "",
          ownerRole: "HR",
          evidenceRule: "",
          applicabilityRule: "",
          exceptionRule: "",
          approvalRule: "",
          version: 1,
          maxScore: "120",
          scoringAnchors: [
            { raw: "0", score: "0" },
            { raw: "100", score: "150" },
          ],
        },
      ],
      measurements: [{ metricId: "P", rawValue: "999", applicable: true }],
    });
    expect(result.finalScore).toBe("120");
  });

  it("66: reverse linear with zero raw returns the max score", () => {
    const result = scorePerformance({
      personId: OWNER,
      period: "QUARTERLY",
      metrics: [
        {
          metricId: "R",
          name: "缺陷率",
          period: "QUARTERLY",
          applicableRoles: ["*"],
          weight: "100",
          metricType: "REVERSE_LINEAR",
          dataSource: "test",
          sourceFields: [],
          calculationRule: "",
          ownerRole: "HR",
          evidenceRule: "",
          applicabilityRule: "",
          exceptionRule: "",
          approvalRule: "",
          version: 1,
          target: "5",
          maxScore: "150",
        },
      ],
      measurements: [{ metricId: "R", rawValue: "0", applicable: true }],
    });
    expect(result.finalScore).toBe("150");
  });

  it("67: annual scorecard zero profit kills the functional pool", () => {
    const result = calculateAnnualScorecard({
      revenueAchievementScore: "100",
      distributableProfitAchievementScore: "0",
      netCollectionAchievementScore: "100",
      strategyAchievementScore: "100",
      distributableNetProfit: "0",
      netProfitTarget: "10000000",
      functionalBonusPoolRatePercent: "10",
    });
    expect(result.profitTargetMet).toBe(false);
    expect(result.functionalBonusPoolRatePercent).toBe("0");
  });

  it("68: DBCP management provision can use a non-gross base", () => {
    const result = calculateDbcp({
      grossProfit: "1000000",
      businessExpenses: "0",
      laborAndTravel: "0",
      allocatedBusinessUnitExpenses: "0",
      allocatedBackendPayroll: "0",
      managementProvisionBase: "2000000",
    });
    expect(result.managementProvision).toBe("100000");
    expect(result.dbcp).toBe("900000");
  });

  it("69: custom commission bands override the default table", () => {
    const result = calculateBusinessUnitCommission({
      dbcp: "100000",
      netCollection: "1000000",
      bands: [{ minMarginPercent: "0", ratePercent: "5" }],
    });
    expect(result.bandRatePercent).toBe("5");
    expect(result.commission).toBe("50000");
  });

  it("70: internal split rejects 99% total", () => {
    const result = calculateInternalSplit({
      commissionPool: "10000",
      marketingReward: "0",
      executiveSupplement: "0",
      participants: [{ personId: OWNER, sharePercent: "99" }],
    });
    expect(result.valid).toBe(false);
  });

  it("71: hardware delay of 100% zeroes the project award", () => {
    const result = calculateTechCenterAward({
      awardType: "HARDWARE_DC_DELIVERY",
      delayRatio: "1",
    });
    expect(result.grossAmount).toBe("0");
  });

  it("72: seven new customers do not qualify for the star award", () => {
    const result = calculateOverseasSalesAward({
      awardType: "NEW_CUSTOMER_STAR",
      newCustomerCount: 7,
    });
    expect(result.grossAmount).toBe("0");
  });

  it("73: Pre-A Refresh is refused", () => {
    const result = calculateEquityGrant({
      positionLevel: "L3",
      financingStage: "PRE_A",
      performanceGrade: "A",
      tenureStage: "A",
      isRefresh: true,
      initialGrantPercent: "0.5",
    });
    expect(result.grantPercent).toBe("0");
    expect(result.note).toContain("Pre-A");
  });

  it("74: double-trigger acceleration never exceeds total units", () => {
    const result = calculateVestingSchedule({
      totalUnits: "10000",
      vestingStart: "2026-01-01T00:00:00Z",
      asOf: "2029-12-01T00:00:00Z",
      acceleration: { type: "DOUBLE_TRIGGER" },
    });
    expect(Number(result.vestedUnits)).toBeLessThanOrEqual(10000);
    expect(Number(result.unvestedUnits)).toBeGreaterThanOrEqual(0);
  });

  it("75: an acknowledged award batch can still be downloaded", async () => {
    const created = await call("POST", "/api/v1/incentive-award-batches", {
      batchNo: "R75",
      awardType: "MONTHLY_STAR",
      period: "2026-11",
      currency: "CNY",
      createdBy: ADMIN,
      lines: [{ personId: MEMBER, amount: "500" }],
    });
    const id = created.body.data.id;
    for (const command of ["SUBMIT", "APPROVE", "LOCK", "EXPORT"]) {
      const response = await call(
        "POST",
        `/api/v1/incentive-award-batches/${id}/commands`,
        { command },
      );
      expect(response.status).toBe(200);
    }
    await call("POST", `/api/v1/incentive-award-batches/${id}/commands`, {
      command: "ACKNOWLEDGE",
      paymentRef: "BANK-ACK",
    });
    const download = await call(
      "GET",
      `/api/v1/incentive-award-batches/${id}/export`,
    );
    expect(download.status).toBe(200);
  });

  it("76: personal data package carries an export hash header", async () => {
    const response = await call("GET", "/api/v1/me/data-package");
    expect(response.status).toBe(200);
    expect(response.headers["x-export-hash"]).toMatch(/^sha256:/);
    expect(response.headers["x-export-watermark"]).toBeTruthy();
  });

  it("77: an employee cannot read another person's notification", async () => {
    const other = await appStore.createNotification({
      recipientPersonId: OWNER,
      audience: "PERSON",
      title: "仅主管可见",
      body: "x",
    });
    const employee = buildApp(
      appStore,
      undefined,
      {
        async authenticate() {
          return {
            tenantId: "tenant-demo",
            userId: "emp",
            roles: ["employee"],
            personId: MEMBER,
          };
        },
      },
      platformStore,
    );
    const response = await employee.inject({
      method: "POST",
      url: `/api/v1/notifications/${other.id}/read`,
    } as never);
    expect(response.statusCode).toBe(403);
  });

  it("78: goal card with 99% weight is rejected", async () => {
    const response = await call(
      "POST",
      "/api/v1/policy/performance/goal-cards",
      {
        personId: OWNER,
        period: "QUARTERLY",
        roleCode: "SALES",
        metrics: [
          {
            metricId: "Q-1",
            name: "指标",
            period: "QUARTERLY",
            applicableRoles: ["SALES"],
            weight: "99",
            metricType: "POSITIVE_LINEAR",
            dataSource: "AI财务",
            sourceFields: [],
            calculationRule: "",
            target: "100",
            ownerRole: "主管",
            evidenceRule: "",
            applicabilityRule: "",
            exceptionRule: "",
            approvalRule: "",
            version: 1,
          },
        ],
      },
    );
    expect(response.status).toBe(400);
  });

  it("79: agreement snapshot records INSUFFICIENT when there are no pairs", async () => {
    const response = await call(
      "POST",
      "/api/v1/reports/reviewer-agreement:snapshot",
    );
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe("INSUFFICIENT");
  });

  it("80: policy record optimistic versioning rejects stale writes", async () => {
    const record = await platformStore.savePolicyEngineRecord({
      tenantId: "tenant-demo",
      recordType: "TEST_RECORD",
      payload: { value: 1 },
    });
    await platformStore.updatePolicyEngineRecord({
      tenantId: "tenant-demo",
      recordId: record.id,
      payload: { value: 2 },
    });
    await expect(
      platformStore.updatePolicyEngineRecord({
        tenantId: "tenant-demo",
        recordId: record.id,
        payload: { value: 3 },
        version: 1,
      }),
    ).rejects.toThrow(/version mismatch/);
  });
});
