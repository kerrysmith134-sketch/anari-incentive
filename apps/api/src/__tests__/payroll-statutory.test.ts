import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const PERSON = "00000000-0000-4000-8000-000000000001";
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
        { id: PERSON, employeeCode: "E001", displayName: "Sales Lead" },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore);
});

async function createContract(fixed = "8000", social = "0.05") {
  const created = await call("POST", "/api/v1/employment-contracts", {
    personId: PERSON,
    contractCode: `CT-STAT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    employmentType: "FULL_TIME",
    startDate: "2026-01-01T00:00:00Z",
    workLocation: "Shanghai",
    currency: "CNY",
    fixedMonthlySalary: fixed,
    minimumMonthlyWage: "2690",
    taxRate: "0.1",
    socialInsuranceRate: social,
    bankAccountRef: "BANK-STAT-1",
    consentSignatureRef: "ESIGN-1",
  });
  expect(created.status).toBe(201);
}

describe("statutory payroll flow", () => {
  it("applies cumulative withholding when the tenant enables STATUTORY_CN", async () => {
    await createContract();
    const settings = await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/settings",
      { payrollTaxMode: "STATUTORY_CN" },
    );
    expect(settings.status).toBe(200);

    const run = await call("POST", "/api/v1/payroll-runs", {
      cycleId: CYCLE,
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-11-30T23:59:59Z",
      currency: "CNY",
      preparedBy: PERSON,
    });
    expect(run.status).toBe(201);
    const calculated = await call(
      "POST",
      `/api/v1/payroll-runs/${run.body.data.id}/calculate`,
    );
    expect(calculated.status).toBe(200);
    const line = calculated.body.data.lines[0];
    // gross 8000 - social 400 - basic 5000 = 2600 taxable, 3% bracket.
    expect(line.taxCalculationMode).toBe("STATUTORY_CN");
    expect(line.ytdTaxableIncome).toBe("2600");
    expect(line.taxAmount).toBe("78");
    expect(line.ytdTaxWithheld).toBe("78");
    expect(line.iitRatePercent).toBe(3);
  });

  it("exports a tax filing CSV with year-to-date columns", async () => {
    await createContract();
    await call("POST", "/api/v1/platform/tenants/tenant-demo/settings", {
      payrollTaxMode: "STATUTORY_CN",
    });
    const run = await call("POST", "/api/v1/payroll-runs", {
      cycleId: CYCLE,
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-11-30T23:59:59Z",
      currency: "CNY",
      preparedBy: PERSON,
    });
    await call("POST", `/api/v1/payroll-runs/${run.body.data.id}/calculate`);

    const filing = await call(
      "GET",
      `/api/v1/payroll-runs/${run.body.data.id}/tax-filing`,
    );
    expect(filing.status).toBe(200);
    const [header, row] = filing.text.trim().split("\n");
    expect(header).toContain("ytd_taxable_income");
    expect(header).toContain("iit_rate_percent");
    expect(row).toContain("STATUTORY_CN");
    expect(row).toContain("2600");
    expect(row).toContain("78");
  });

  it("rejects an unknown bank file format and serves ICBC preset", async () => {
    await createContract("8000", "0");
    const run = await call("POST", "/api/v1/payroll-runs", {
      cycleId: CYCLE,
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-11-30T23:59:59Z",
      currency: "CNY",
      preparedBy: PERSON,
    });
    await call("POST", `/api/v1/payroll-runs/${run.body.data.id}/calculate`);

    const bad = await call(
      "GET",
      `/api/v1/payroll-runs/${run.body.data.id}/bank-file?format=HSBC`,
    );
    expect(bad.status).toBe(400);

    const icbc = await call(
      "GET",
      `/api/v1/payroll-runs/${run.body.data.id}/bank-file?format=ICBC`,
    );
    expect(icbc.status).toBe(200);
    const [header, row] = icbc.text.trim().split("\n");
    expect(header).toContain("net_amount_fen");
    expect(row).toContain("SALARY".length > 0 ? "BANK-STAT-1" : "");
  });
});
