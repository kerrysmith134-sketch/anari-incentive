/*
 * 批量导入与人工修正：奖励批次 CSV、劳动合同 CSV、股权授予修正。
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";

let app: FastifyInstance;
let platformStore: MemoryPlatformStore;

async function call(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    payload: response.payload,
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
        { id: MEMBER, employeeCode: "E002", displayName: "Teammate" },
        { id: ADMIN, employeeCode: "E003", displayName: "Finance" },
      ],
    },
  });
  app = buildApp(new Store(), undefined, undefined, platformStore);
});

describe("incentive award batch CSV import", () => {
  const header = { batchNo: "IMP-1", awardType: "MANUAL", period: "2026-11", currency: "CNY" };

  it("imports rows by employee code and creates one batch", async () => {
    const response = await call("POST", "/api/v1/incentive-award-batches:import", {
      ...header,
      csv: "工号,金额,备注\nE001,5000,季度提成\nE002,3200",
    });
    expect(response.status).toBe(201);
    expect(response.body.data.imported).toBe(2);
    expect(response.body.data.batch.lineCount).toBe(2);
    const amounts = response.body.data.batch.lines.map(
      (line: { amount: string; personId: string }) => [line.personId, line.amount],
    );
    expect(amounts).toContainEqual([OWNER, "5000"]);
    expect(amounts).toContainEqual([MEMBER, "3200"]);
  });

  it("rejects the whole file when any row is invalid", async () => {
    const response = await call("POST", "/api/v1/incentive-award-batches:import", {
      ...header,
      csv: "工号,金额\nE001,5000\nE999,100\nE002,-5",
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CSV_ROWS_INVALID");
    expect(response.body.error.details).toHaveLength(2);
    const list = await call("GET", "/api/v1/incentive-award-batches");
    expect(list.body.data).toHaveLength(0);
  });

  it("accepts a person_id column and source references", async () => {
    const response = await call("POST", "/api/v1/incentive-award-batches:import", {
      ...header,
      csv: "person_id,金额,来源标识,来源行\n" + `${OWNER},800,calc-1,line-1`,
    });
    expect(response.status).toBe(201);
    expect(response.body.data.batch.lines[0].sourceRecordId).toBe("calc-1");
  });
});

describe("employment contract CSV import", () => {
  it("creates contracts for every valid row", async () => {
    const response = await call("POST", "/api/v1/employment-contracts:import", {
      csv:
        "工号,合同编号,开始日期,固定月薪,币种\n" +
        "E001,HT-2026-001,2026-12-01,12000,CNY\n" +
        "E002,HT-2026-002,2026-12-01,9000,CNY",
    });
    expect(response.status).toBe(200);
    expect(response.body.data.created).toBe(2);
    expect(response.body.data.failed).toBe(0);
  });

  it("reports per-row failures without blocking the rest", async () => {
    const response = await call("POST", "/api/v1/employment-contracts:import", {
      csv:
        "工号,合同编号,开始日期,固定月薪\n" +
        "E001,HT-2026-010,2026-12-01,12000\n" +
        "E001,HT-2026-011,2026-12-15,12000\n" +
        "E999,HT-2026-012,2026-12-01,8000\n" +
        "E002,HT-2026-013,2026/12/01,8000",
    });
    expect(response.status).toBe(200);
    expect(response.body.data.created).toBe(1);
    expect(response.body.data.failed).toBe(3);
    const messages = response.body.data.errors.map(
      (item: { error: string }) => item.error,
    );
    expect(messages.some((item: string) => item.includes("期间重叠"))).toBe(true);
    expect(messages.some((item: string) => item.includes("没有匹配的员工"))).toBe(true);
    expect(messages.some((item: string) => item.includes("YYYY-MM-DD"))).toBe(true);
  });
});

describe("equity grant manual adjustment", () => {
  async function createGrant() {
    const created = await call("POST", "/api/v1/equity-grants", {
      personId: OWNER,
      grantCode: `EQ-${Date.now()}`,
      grantType: "RSU",
      totalUnits: "10000",
      strikePrice: "1",
      currency: "CNY",
      grantDate: "2025-01-01T00:00:00.000Z",
      vestingStart: "2025-01-01T00:00:00.000Z",
      cliffMonths: 0,
      vestingMonths: 48,
    });
    expect(created.status).toBe(201);
    return created.body.data.id as string;
  }

  it("patches units and strike with a reason and bumps the version", async () => {
    const grantId = await createGrant();
    const adjusted = await call(
      "POST",
      `/api/v1/equity-grants/${grantId}/adjust`,
      { totalUnits: "12000", strikePrice: "1.5", reason: "股东会决议修正配股" },
    );
    expect(adjusted.status).toBe(200);
    expect(adjusted.body.data.totalUnits).toBe("12000");
    expect(adjusted.body.data.strikePrice).toBe("1.5");
    expect(adjusted.body.data.version).toBe(2);
  });

  it("never edits below the exercised units", async () => {
    const grantId = await createGrant();
    const exercise = await call(
      "POST",
      `/api/v1/equity-grants/${grantId}/exercises`,
      { units: "2000", requestedBy: OWNER },
    );
    expect(exercise.status).toBe(201);
    const adjusted = await call(
      "POST",
      `/api/v1/equity-grants/${grantId}/adjust`,
      { totalUnits: "1000", reason: "误配回收" },
    );
    expect(adjusted.status).toBe(409);
    expect(adjusted.body.error.message).toContain("EQ_UNITS_BELOW_EXERCISED");
  });

  it("requires a written reason", async () => {
    const grantId = await createGrant();
    const adjusted = await call(
      "POST",
      `/api/v1/equity-grants/${grantId}/adjust`,
      { strikePrice: "2" },
    );
    expect(adjusted.status).toBe(400);
  });
});
