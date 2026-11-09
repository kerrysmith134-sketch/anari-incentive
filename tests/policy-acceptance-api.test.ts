import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../apps/api/src/app.js";
import { MemoryPlatformStore } from "../apps/api/src/platform-store.js";
import { Store } from "../apps/api/src/store.js";
import { monthlyMetricTemplate } from "@anari/policy-dsl";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";

let app: FastifyInstance;
let platformStore: MemoryPlatformStore;

async function post(url: string, payload: Record<string, unknown>) {
  const response = await app.inject({ method: "POST", url, payload } as never);
  return {
    status: response.statusCode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

beforeEach(() => {
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
  app = buildApp(new Store(), undefined, undefined, platformStore);
});

describe("policy acceptance through the HTTP API", () => {
  it("returns the same monthly score and Kp as the engine dataset", async () => {
    const response = await post("/api/v1/policy/performance/score", {
      personId: OWNER,
      period: "MONTHLY",
      metrics: monthlyMetricTemplate(),
      measurements: [
        { metricId: "M-001", rawValue: "95", applicable: true },
        { metricId: "M-002", rawValue: "88", applicable: true },
        { metricId: "M-003", applicable: true, eventAdjustment: "4" },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.finalScore).toBe("95.3");
    expect(response.body.data.kp).toBe("0.953");
  });

  it("returns the same monthly performance wage", async () => {
    const response = await post("/api/v1/policy/performance/monthly-wage", {
      monthlyTotalWage: "30000",
      wageBand: "BASE",
      monthlyScore: "95.3",
    });
    expect(response.body.data.payable).toBe("5718");
  });

  it("returns the same DBCP and commission", async () => {
    const dbcp = await post("/api/v1/policy/incentive/dbcp", {
      grossProfit: "2000000",
      businessExpenses: "80000",
      laborAndTravel: "250000",
      allocatedBusinessUnitExpenses: "40000",
      allocatedBackendPayroll: "60000",
    });
    expect(dbcp.body.data.dbcp).toBe("1470000");
    const commission = await post(
      "/api/v1/policy/incentive/business-unit-commission",
      { dbcp: "1470000", netCollection: "5000000" },
    );
    expect(commission.body.data.commission).toBe("150000");
  });

  it("persists a multi-line award batch with the same total", async () => {
    const response = await post("/api/v1/incentive-award-batches", {
      batchNo: "ACCEPTANCE-API-1",
      awardType: "TECH_CENTER_AWARD",
      period: "2026-Q4",
      currency: "CNY",
      createdBy: ADMIN,
      lines: [
        { personId: OWNER, amount: "500" },
        { personId: MEMBER, amount: "250.50" },
      ],
    });
    expect(response.status).toBe(201);
    expect(response.body.data.totalAmount).toBe("750.5");
    const records = await platformStore.listIncentiveAwardBatches("tenant-demo");
    expect(records[0]!.totalAmount).toBe("750.5");
  });
});
