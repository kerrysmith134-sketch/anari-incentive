import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import { calculatePayroll } from "../payroll.js";

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

async function createContract(
  fixed = "8000",
  social = "0.05",
  options: {
    currency?: string;
    taxRate?: string;
    minimumMonthlyWage?: string;
  } = {},
) {
  const created = await call("POST", "/api/v1/employment-contracts", {
    personId: PERSON,
    contractCode: `CT-STAT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    employmentType: "FULL_TIME",
    startDate: "2026-01-01T00:00:00Z",
    workLocation: "Shanghai",
    currency: options.currency ?? "CNY",
    fixedMonthlySalary: fixed,
    minimumMonthlyWage: options.minimumMonthlyWage ?? "2690",
    taxRate: options.taxRate ?? "0.1",
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

describe("multi-currency payroll", () => {
  it("pays a JPY run at 0 decimals with China statutory deductions disabled", async () => {
    await createContract("8000.6", "0.05", {
      currency: "JPY",
      taxRate: "0.1",
      minimumMonthlyWage: "0",
    });
    // Even with the tenant set to China's statutory mode, a JPY run must not
    // borrow RMB IIT/social-insurance rules.
    await call("POST", "/api/v1/platform/tenants/tenant-demo/settings", {
      payrollTaxMode: "STATUTORY_CN",
    });
    const run = await call("POST", "/api/v1/payroll-runs", {
      cycleId: CYCLE,
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-11-30T23:59:59Z",
      currency: "JPY",
      preparedBy: PERSON,
    });
    expect(run.status).toBe(201);
    expect(run.body.data.currency).toBe("JPY");
    expect(run.body.data.statutoryCurrencyUnsupported).toBe(true);

    const calculated = await call(
      "POST",
      `/api/v1/payroll-runs/${run.body.data.id}/calculate`,
    );
    expect(calculated.status).toBe(200);
    const line = calculated.body.data.lines[0];
    expect(line.currency).toBe("JPY");
    // 8000.6 JPY rounds HALF_UP to the 0-decimal minor unit.
    expect(line.grossAmount).toBe("8001");
    expect(line.netAmount).toBe("8001");
    expect(line.taxAmount).toBe("0");
    expect(line.socialInsuranceAmount).toBe("0");
    expect(line.statutoryCurrencyUnsupported).toBe(true);
    expect(line.taxCalculationMode).toBeUndefined();
    expect(calculated.body.data.totalTax).toBe("0");
    expect(calculated.body.data.totalSocialInsurance).toBe("0");
    expect(calculated.body.data.totalGross).toBe("8001");

    const csv = await call(
      "GET",
      `/api/v1/payroll-runs/${run.body.data.id}/export`,
    );
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(",JPY,");

    // ICBC/CMB templates are RMB-only; fail closed instead of mis-scaling.
    const bank = await call(
      "GET",
      `/api/v1/payroll-runs/${run.body.data.id}/bank-file?format=ICBC`,
    );
    expect(bank.status).toBe(409);
  });

  it("pays a KWD run at 3 decimals with China statutory deductions disabled", async () => {
    await createContract("1000.1236", "0.05", {
      currency: "KWD",
      taxRate: "0.1",
      minimumMonthlyWage: "0",
    });
    const run = await call("POST", "/api/v1/payroll-runs", {
      cycleId: CYCLE,
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-11-30T23:59:59Z",
      currency: "KWD",
      preparedBy: PERSON,
    });
    expect(run.status).toBe(201);
    const calculated = await call(
      "POST",
      `/api/v1/payroll-runs/${run.body.data.id}/calculate`,
    );
    expect(calculated.status).toBe(200);
    const line = calculated.body.data.lines[0];
    expect(line.currency).toBe("KWD");
    expect(line.grossAmount).toBe("1000.124");
    expect(line.netAmount).toBe("1000.124");
    expect(line.taxAmount).toBe("0");
    expect(line.socialInsuranceAmount).toBe("0");
    expect(line.statutoryCurrencyUnsupported).toBe(true);
    expect(calculated.body.data.totalGross).toBe("1000.124");
    expect(calculated.body.data.totalTax).toBe("0");
  });

  it("defaults an omitted run currency to CNY", async () => {
    const run = await call("POST", "/api/v1/payroll-runs", {
      cycleId: CYCLE,
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-11-30T23:59:59Z",
      preparedBy: PERSON,
    });
    expect(run.status).toBe(201);
    expect(run.body.data.currency).toBe("CNY");
    expect(run.body.data.statutoryCurrencyUnsupported).toBeUndefined();
  });

  it("rejects saving a line whose currency differs from the run", async () => {
    await createContract();
    const contracts = await platformStore.listEmploymentContracts(
      "tenant-demo",
    );
    const calculation = calculatePayroll({
      contracts,
      ledger: [],
      cycleId: CYCLE,
      currency: "CNY",
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-11-30T23:59:59Z",
    });
    const jpyRun = await platformStore.createPayrollRun({
      tenantId: "tenant-demo",
      cycleId: CYCLE,
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-11-30T23:59:59Z",
      currency: "JPY",
      preparedBy: PERSON,
    });
    await expect(
      platformStore.savePayrollCalculation({
        tenantId: "tenant-demo",
        runId: jpyRun.id,
        lines: calculation.lines,
        totalGross: calculation.totalGross,
        totalDeductions: calculation.totalDeductions,
        totalTax: calculation.totalTax,
        totalSocialInsurance: calculation.totalSocialInsurance,
        totalNet: calculation.totalNet,
        blockedCount: calculation.blockedCount,
      }),
    ).rejects.toThrow("PAYROLL_LINE_CURRENCY_MISMATCH");
  });
});
