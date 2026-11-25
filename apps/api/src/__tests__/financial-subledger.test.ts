/**
 * 迁移 111：财务子账最小闭环（发票 / 收款 / 退款 / 冲销 / FX 重估）。
 *
 * 覆盖：
 * - 发票 → 收款 → 退款 → 冲销链；
 * - FX 重估（1e6 BigInt：原币金额 × 汇率差）；
 * - 关闭会计期间拒绝所有子账写入（复用 createFinancialFact 门禁）；
 * - ISO 4217 币种与 6 位小数精度。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const APPROVER = "00000000-0000-4000-8000-000000000002";

const LEGAL_ENTITY = "LE-SUBLEDGER";
const PERIOD = "2026-10";
const ORDER = "SO-SUBLEDGER-1";
const CONTRACT = "CT-SUBLEDGER-1";

function createStore() {
  return new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "Financial subledger tenant",
      slug: "subledger",
    },
  });
}

function buildAppFor(
  platformStore = createStore(),
  personId = ADMIN,
) {
  return buildApp(
    () => new Store(TENANT),
    undefined,
    {
      async authenticate() {
        return {
          tenantId: TENANT,
          userId: personId,
          roles: ["admin", "finance", "integration"],
          personId,
        };
      },
    },
    platformStore,
  );
}

interface InjectResult {
  statusCode: number;
  json(): unknown;
}

async function post(
  app: Awaited<ReturnType<typeof buildApp>>,
  url: string,
  payload: Record<string, unknown> = {},
): Promise<InjectResult> {
  return (await app.inject({
    method: "POST",
    url,
    payload,
    headers: { "content-type": "application/json" },
  })) as unknown as InjectResult;
}

async function get(
  app: Awaited<ReturnType<typeof buildApp>>,
  url: string,
): Promise<InjectResult> {
  return (await app.inject({ method: "GET", url })) as unknown as InjectResult;
}

function errorMessage(result: InjectResult): string {
  return (result.json() as { error: { message: string } }).error.message;
}

function errorDetails(result: InjectResult): string {
  return JSON.stringify(
    (result.json() as { error: { details?: unknown } }).error.details ?? [],
  );
}

interface FactBody {
  id: string;
  documentType?: string;
  documentId?: string;
  relatedFactId?: string;
  reversalOf?: string;
  amount: string;
  currency: string;
  fxRate?: string;
  functionalCurrency?: string;
  functionalAmount?: string;
  taxRate?: string;
  taxAmount?: string;
  totalAmount?: string;
  orderId?: string;
  contractRef?: string;
  recognitionStatus: string;
  payload?: Record<string, unknown>;
}

interface InvoiceTaxBody {
  code: string;
  rate: string;
  base: string;
  taxAmount: string;
}

function envelope(result: InjectResult): { data: FactBody } {
  return result.json() as { data: FactBody };
}

function invoicePayload(overrides: Record<string, unknown> = {}) {
  return {
    legalEntityId: LEGAL_ENTITY,
    accountingPeriod: PERIOD,
    orderId: ORDER,
    currency: "USD",
    amount: "1000.00",
    functionalCurrency: "USD",
    sourceVersion: "v1",
    ...overrides,
  };
}

describe("Financial subledger (migration 111)", () => {
  it("builds an invoice -> payment -> refund -> reversal chain", async () => {
    const platformStore = createStore();
    const app = buildAppFor(platformStore);

    const invoiceRes = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload(),
    );
    expect(invoiceRes.statusCode).toBe(201);
    const invoice = envelope(invoiceRes).data;
    expect(invoice.documentType).toBe("INVOICE");
    expect(invoice.recognitionStatus).toBe("POSTED");
    expect(invoice.amount).toBe("1000");
    expect(invoice.fxRate).toBe("1");
    expect(invoice.functionalCurrency).toBe("USD");
    expect(invoice.functionalAmount).toBe("1000");

    const paymentRes = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoice.id,
      documentType: "PAYMENT",
      amount: "400.00",
    });
    expect(paymentRes.statusCode).toBe(201);
    const payment = envelope(paymentRes).data;
    expect(payment.documentType).toBe("PAYMENT");
    expect(payment.amount).toBe("400");
    expect(payment.relatedFactId).toBe(invoice.id);
    expect(payment.orderId).toBe(ORDER);

    const refundRes = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoice.id,
      documentType: "REFUND",
      amount: "100.00",
    });
    expect(refundRes.statusCode).toBe(201);
    const refund = envelope(refundRes).data;
    expect(refund.documentType).toBe("REFUND");
    // REFUND 金额符号由类型决定：请求正数，入库负数。
    expect(refund.amount).toBe("-100");
    expect(refund.relatedFactId).toBe(invoice.id);

    const reversalRes = await post(
      app,
      `/api/v1/financial-facts/${invoice.id}/reverse`,
      {},
    );
    expect(reversalRes.statusCode).toBe(201);
    const reversal = envelope(reversalRes).data;
    expect(reversal.documentType).toBe("REVERSAL");
    expect(reversal.amount).toBe("-1000");
    expect(reversal.reversalOf).toBe(invoice.id);
    expect(reversal.relatedFactId).toBe(invoice.id);
    expect(reversal.functionalAmount).toBe("-1000");

    // 同一事实不能被重复冲销。
    const doubleReverse = await post(
      app,
      `/api/v1/financial-facts/${invoice.id}/reverse`,
      {},
    );
    expect(doubleReverse.statusCode).toBe(409);
    expect(
      (doubleReverse.json() as { error: { message: string } }).error.message,
    ).toMatch(/FACT_ALREADY_REVERSED/);

    const ledger = await get(
      app,
      `/api/v1/financial-subledger?orderId=${ORDER}`,
    );
    expect(ledger.statusCode).toBe(200);
    const subledger = (
      ledger.json() as {
        data: {
          invoices: FactBody[];
          payments: FactBody[];
          refunds: FactBody[];
          revaluations: FactBody[];
          reversals: FactBody[];
          chain: FactBody[];
          totals: Record<string, { net: string }>;
        };
      }
    ).data;
    expect(subledger.invoices).toHaveLength(1);
    expect(subledger.payments).toHaveLength(1);
    expect(subledger.refunds).toHaveLength(1);
    expect(subledger.revaluations).toHaveLength(0);
    expect(subledger.reversals).toHaveLength(1);
    expect(subledger.chain).toHaveLength(4);
    expect(new Set(subledger.chain.map((fact) => fact.documentType))).toEqual(
      new Set(["INVOICE", "PAYMENT", "REFUND", "REVERSAL"]),
    );
    expect(subledger.totals.USD).toMatchObject({
      invoiced: "1000",
      paid: "400",
      refunded: "-100",
      reversed: "-1000",
      net: "300",
    });
  });

  it("revalues a foreign-currency invoice with the 1e6 BigInt delta", async () => {
    const platformStore = createStore();
    const app = buildAppFor(platformStore);

    const invoiceRes = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        orderId: undefined,
        contractRef: CONTRACT,
        amount: "1000.00",
        currency: "USD",
        functionalCurrency: "EUR",
        fxRate: "0.900000",
      }),
    );
    expect(invoiceRes.statusCode).toBe(201);
    const invoice = envelope(invoiceRes).data;
    expect(invoice.functionalCurrency).toBe("EUR");
    expect(invoice.fxRate).toBe("0.9");
    expect(invoice.functionalAmount).toBe("900");

    // 1000 USD × (0.95 - 0.90) = 50 EUR。
    const revaluationRes = await post(app, "/api/v1/financial-revaluations", {
      factId: invoice.id,
      fxRate: "0.950000",
      functionalCurrency: "EUR",
      reason: "month-end rate",
    });
    expect(revaluationRes.statusCode).toBe(201);
    const revaluation = envelope(revaluationRes).data;
    expect(revaluation.documentType).toBe("FX_REVALUATION");
    expect(revaluation.relatedFactId).toBe(invoice.id);
    expect(revaluation.amount).toBe("50");
    expect(revaluation.currency).toBe("EUR");
    expect(revaluation.functionalAmount).toBe("50");

    const ledger = await get(
      app,
      `/api/v1/financial-subledger?contractRef=${CONTRACT}`,
    );
    expect(ledger.statusCode).toBe(200);
    const subledger = (
      ledger.json() as {
        data: {
          invoices: FactBody[];
          revaluations: FactBody[];
          totals: Record<string, { revalued: string }>;
        };
      }
    ).data;
    expect(subledger.invoices).toHaveLength(1);
    expect(subledger.revaluations).toHaveLength(1);
    expect(subledger.totals.EUR?.revalued).toBe("50");

    // 服务端重算后拒绝客户端不一致的功能币金额。
    const inconsistent = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        orderId: "SO-SUBLEDGER-FX-BAD",
        currency: "USD",
        functionalCurrency: "EUR",
        amount: "100.00",
        fxRate: "1.100000",
        functionalAmount: "100.00",
      }),
    );
    expect(inconsistent.statusCode).toBe(409);
    expect(
      (inconsistent.json() as { error: { message: string } }).error.message,
    ).toMatch(/FUNCTIONAL_AMOUNT_INCONSISTENT/);

    // 跨币种缺少汇率在协议层即 400。
    const missingRate = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        orderId: "SO-SUBLEDGER-FX-NO-RATE",
        currency: "USD",
        functionalCurrency: "EUR",
      }),
    );
    expect(missingRate.statusCode).toBe(400);
    expect(
      JSON.stringify(
        (missingRate.json() as { error: { details: unknown } }).error.details,
      ),
    ).toContain("fxRate");
  });

  it("rejects every subledger write while the accounting period is closed", async () => {
    const platformStore = createStore();
    const app = buildAppFor(platformStore);

    const invoiceRes = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload(),
    );
    expect(invoiceRes.statusCode).toBe(201);
    const invoice = envelope(invoiceRes).data;

    const close = await post(app, "/api/v1/accounting-periods/close", {
      legalEntityId: LEGAL_ENTITY,
      period: PERIOD,
      actorPersonId: ADMIN,
      reason: "month-end close",
    });
    expect(close.statusCode).toBe(202);
    const change = (close.json() as { data: { id: string } }).data;
    const approverApp = buildAppFor(platformStore, APPROVER);
    const approve = await post(
      approverApp,
      `/api/v1/accounting-periods/change-requests/${change.id}/decide`,
      { decision: "APPROVE", approverPersonId: APPROVER, note: "approved" },
    );
    expect(approve.statusCode).toBe(200);
    expect(
      (
        approve.json() as {
          data: { period: { status: string } };
        }
      ).data.period.status,
    ).toBe("CLOSED");

    const payment = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoice.id,
      documentType: "PAYMENT",
      amount: "10.00",
    });
    expect(payment.statusCode).toBe(409);
    expect(
      (payment.json() as { error: { message: string } }).error.message,
    ).toMatch(/PERIOD_CLOSED/);

    const reversal = await post(
      app,
      `/api/v1/financial-facts/${invoice.id}/reverse`,
      {},
    );
    expect(reversal.statusCode).toBe(409);
    expect(
      (reversal.json() as { error: { message: string } }).error.message,
    ).toMatch(/PERIOD_CLOSED/);

    const revaluation = await post(app, "/api/v1/financial-revaluations", {
      factId: invoice.id,
      fxRate: "0.950000",
      functionalCurrency: "USD",
    });
    expect(revaluation.statusCode).toBe(409);
    expect(
      (revaluation.json() as { error: { message: string } }).error.message,
    ).toMatch(/PERIOD_CLOSED/);

    const invoiceBlocked = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({ orderId: "SO-SUBLEDGER-CLOSED" }),
    );
    expect(invoiceBlocked.statusCode).toBe(409);
    expect(
      (invoiceBlocked.json() as { error: { message: string } }).error.message,
    ).toMatch(/PERIOD_CLOSED/);
  });

  it("enforces ISO 4217 currencies and 6-decimal precision", async () => {
    const app = buildAppFor();

    const badCurrency = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({ currency: "usd", functionalCurrency: "usd" }),
    );
    expect(badCurrency.statusCode).toBe(400);

    const badFunctional = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({ functionalCurrency: "EU" }),
    );
    expect(badFunctional.statusCode).toBe(400);

    const tooPrecise = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({ amount: "1.1234567" }),
    );
    expect(tooPrecise.statusCode).toBe(400);

    const negative = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({ amount: "-1" }),
    );
    expect(negative.statusCode).toBe(400);

    const tooPreciseRate = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        orderId: "SO-SUBLEDGER-RATE",
        currency: "USD",
        functionalCurrency: "EUR",
        fxRate: "0.1234567",
      }),
    );
    expect(tooPreciseRate.statusCode).toBe(400);

    const accepted = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        orderId: "SO-SUBLEDGER-PRECISE",
        amount: "10.123456",
      }),
    );
    expect(accepted.statusCode).toBe(201);
    expect(envelope(accepted).data.amount).toBe("10.123456");
    expect(envelope(accepted).data.functionalAmount).toBe("10.123456");
  });

  it("requires orderId or contractRef for subledger reads", async () => {
    const app = buildAppFor();
    const missing = await get(app, "/api/v1/financial-subledger");
    expect(missing.statusCode).toBe(400);
  });
});

// ----------------------------------------------------------------------
// 迁移 112：账龄 / 税额 / 坏账 / ERP 对账 / 复式记账。
// ----------------------------------------------------------------------

interface CrossCurrencySettlementBody {
  factId: string;
  documentType: string;
  currency: string;
  amount: string;
  convertedAmount: string;
  conversion: string;
  functionalCurrency: string | null;
  fxRate: string | null;
  functionalAmount: string | null;
}

interface AgingRow {
  invoiceFactId: string;
  documentId: string | null;
  currency: string;
  bucket: string;
  ageDays: number;
  openAmount: string;
  status: string;
  totalAmount: string;
  taxAmount: string;
  payments: string;
  refunds: string;
  writeOffs: string;
  crossCurrencySettlements?: CrossCurrencySettlementBody[];
}

interface AgingTotals {
  currency: string;
  openAmount: string;
  buckets: Record<string, string>;
}

interface JournalLineBody {
  accountCode: string;
  debit: string;
  credit: string;
}

interface JournalBody {
  id: string;
  documentId: string;
  documentType: string;
  currency: string;
  totalDebit: string;
  totalCredit: string;
  lines: JournalLineBody[];
}

async function aging(
  app: Awaited<ReturnType<typeof buildApp>>,
  legalEntityId: string,
  asOf: string,
): Promise<{
  invoices: AgingRow[];
  totals: AgingTotals[];
}> {
  const res = await get(
    app,
    `/api/v1/financial-subledger/aging?legalEntityId=${legalEntityId}&asOf=${asOf}`,
  );
  expect(res.statusCode).toBe(200);
  return (
    res.json() as {
      data: { invoices: AgingRow[]; totals: AgingTotals[] };
    }
  ).data;
}

async function journalsFor(
  app: Awaited<ReturnType<typeof buildApp>>,
  documentId: string,
): Promise<JournalBody[]> {
  const res = await get(
    app,
    `/api/v1/financial-journals?documentId=${documentId}`,
  );
  expect(res.statusCode).toBe(200);
  return (
    res.json() as { data: { journals: JournalBody[] } }
  ).data.journals;
}

function assertBalanced(journal: JournalBody | undefined): void {
  expect(journal).toBeDefined();
  if (!journal) return;
  expect(journal.totalDebit).toBe(journal.totalCredit);
  const debit = journal.lines.reduce(
    (sum, line) => sum + Number(line.debit),
    0,
  );
  const credit = journal.lines.reduce(
    (sum, line) => sum + Number(line.credit),
    0,
  );
  expect(debit).toBe(credit);
  expect(debit).toBeGreaterThan(0);
}

function invoiceBody(
  documentId: string,
  amount: string,
  issuedAt: string,
  overrides: Record<string, unknown> = {},
) {
  return invoicePayload({
    documentId,
    amount,
    issuedAt,
    ...overrides,
  });
}

describe("Financial subledger aging / tax / bad debt / GL (migration 112)", () => {
  it("buckets invoice open amounts and totals by aging window", async () => {
    const app = buildAppFor();
    const asOf = "2026-11-25";

    const invoices = [
      ["INV-AGE-1", "1000.00", "2026-11-25T00:00:00.000Z", 10],
      ["INV-AGE-2", "500.00", "2026-11-15T00:00:00.000Z", undefined],
      ["INV-AGE-3", "300.00", "2026-10-15T00:00:00.000Z", undefined],
      ["INV-AGE-4", "200.00", "2026-09-10T00:00:00.000Z", undefined],
      ["INV-AGE-5", "100.00", "2026-07-25T00:00:00.000Z", undefined],
    ] as const;
    const created = new Map<string, FactBody>();
    for (const [documentId, amount, issuedAt, taxRate] of invoices) {
      const res = await post(
        app,
        "/api/v1/financial-invoices",
        invoiceBody(documentId, amount, issuedAt, {
          taxRate,
          accountingPeriod: "2026-11",
        }),
      );
      expect(res.statusCode).toBe(201);
      created.set(documentId, envelope(res).data);
    }
    const invoiceB = created.get("INV-AGE-2");
    expect(invoiceB).toBeDefined();
    if (!invoiceB) return;

    // 收款 100 + 退款 50 → open = 500 - 100 - (-50) = 450。
    const payment = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoiceB.id,
      documentType: "PAYMENT",
      amount: "100.00",
    });
    expect(payment.statusCode).toBe(201);
    const refund = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoiceB.id,
      documentType: "REFUND",
      amount: "50.00",
    });
    expect(refund.statusCode).toBe(201);

    const result = await aging(app, LEGAL_ENTITY, asOf);
    const byDocument = new Map(
      result.invoices.map((row) => [row.documentId, row]),
    );
    expect(byDocument.get("INV-AGE-1")).toMatchObject({
      bucket: "CURRENT",
      ageDays: 0,
      totalAmount: "1100",
      taxAmount: "100",
      openAmount: "1100",
    });
    expect(byDocument.get("INV-AGE-2")).toMatchObject({
      bucket: "1-30",
      ageDays: 10,
      payments: "100",
      refunds: "-50",
      openAmount: "450",
    });
    expect(byDocument.get("INV-AGE-3")?.bucket).toBe("31-60");
    expect(byDocument.get("INV-AGE-4")?.bucket).toBe("61-90");
    expect(byDocument.get("INV-AGE-5")?.bucket).toBe("90+");
    expect(byDocument.get("INV-AGE-5")?.ageDays).toBe(123);

    expect(result.totals).toHaveLength(1);
    expect(result.totals[0]).toMatchObject({
      currency: "USD",
      openAmount: "2150",
      buckets: {
        CURRENT: "1100",
        "1-30": "450",
        "31-60": "300",
        "61-90": "200",
        "90+": "100",
      },
    });
  });

  it("computes tax with 1e6 fixed point and rejects client drift", async () => {
    const app = buildAppFor();
    const res = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-TAX-1",
        amount: "1000.00",
        taxRate: 13,
      }),
    );
    expect(res.statusCode).toBe(201);
    const invoice = envelope(res).data;
    expect(invoice.taxRate).toBe("13");
    expect(invoice.taxAmount).toBe("130");
    expect(invoice.totalAmount).toBe("1130");

    const journals = await journalsFor(app, "INV-TAX-1");
    expect(journals).toHaveLength(1);
    const journal = journals[0];
    assertBalanced(journal);
    expect(journal?.totalDebit).toBe("1130");
    expect(journal?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "AR", debit: "1130", credit: "0" }),
        expect.objectContaining({ accountCode: "REVENUE", debit: "0", credit: "1000" }),
        expect.objectContaining({ accountCode: "TAX_PAYABLE", debit: "0", credit: "130" }),
      ]),
    );

    const drifted = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-TAX-2",
        amount: "1000.00",
        taxRate: 13,
        taxAmount: "129.00",
      }),
    );
    expect(drifted.statusCode).toBe(409);
    expect(
      (drifted.json() as { error: { message: string } }).error.message,
    ).toMatch(/TAX_AMOUNT_INCONSISTENT/);

    const withoutRate = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-TAX-3",
        amount: "1000.00",
        taxAmount: "130.00",
      }),
    );
    expect(withoutRate.statusCode).toBe(409);
    expect(
      (withoutRate.json() as { error: { message: string } }).error.message,
    ).toMatch(/TAX_RATE_REQUIRED/);

    const tooHigh = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-TAX-4",
        amount: "1000.00",
        taxRate: 101,
      }),
    );
    expect(tooHigh.statusCode).toBe(400);

    const negative = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-TAX-5",
        amount: "1000.00",
        taxRate: -1,
      }),
    );
    expect(negative.statusCode).toBe(400);

    const tooPrecise = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-TAX-6",
        amount: "1000.00",
        taxRate: 1.1234567,
      }),
    );
    expect(tooPrecise.statusCode).toBe(400);

    // 0.5% × 10.00 = 0.05，验证定点四舍五入与合计。
    const fraction = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-TAX-7",
        amount: "10.00",
        taxRate: 0.5,
      }),
    );
    expect(fraction.statusCode).toBe(201);
    expect(envelope(fraction).data.taxAmount).toBe("0.05");
    expect(envelope(fraction).data.totalAmount).toBe("10.05");
  });

  it("provisions bad debt by aging matrix and writes off the open amount", async () => {
    const app = buildAppFor();
    const asOf = "2026-11-25";
    const period = "2026-11";
    const invoices = [
      ["INV-BD-CURRENT", "1000.00", "2026-11-25T00:00:00.000Z"],
      ["INV-BD-1-30", "1000.00", "2026-11-15T00:00:00.000Z"],
      ["INV-BD-31-60", "1000.00", "2026-10-15T00:00:00.000Z"],
      ["INV-BD-61-90", "1000.00", "2026-09-10T00:00:00.000Z"],
      ["INV-BD-90PLUS", "1000.00", "2026-07-25T00:00:00.000Z"],
    ] as const;
    const created = new Map<string, FactBody>();
    for (const [documentId, amount, issuedAt] of invoices) {
      const res = await post(
        app,
        "/api/v1/financial-invoices",
        invoiceBody(documentId, amount, issuedAt, {
          accountingPeriod: period,
        }),
      );
      expect(res.statusCode).toBe(201);
      created.set(documentId, envelope(res).data);
    }

    const provision = await post(
      app,
      "/api/v1/financial-bad-debt/provision",
      { legalEntityId: LEGAL_ENTITY, accountingPeriod: period, asOf },
    );
    expect(provision.statusCode).toBe(201);
    const provisionData = (
      provision.json() as {
        data: {
          provisions: FactBody[];
          skipped: unknown[];
          totals: Array<{ currency: string; provisionAmount: string }>;
          matrix: Record<string, number>;
        };
      }
    ).data;
    // CURRENT 0% 不提；1-30 2% = 20；31-60 5% = 50；61-90 10% = 100；
    // 90+ 50% = 500 → 合计 670。
    expect(provisionData.provisions).toHaveLength(4);
    expect(provisionData.matrix["90+"]).toBe(50);
    expect(provisionData.totals).toEqual([
      { currency: "USD", provisionAmount: "670" },
    ]);
    expect(
      provisionData.provisions.every(
        (fact) =>
          fact.documentType === "BAD_DEBT_PROVISION" &&
          fact.recognitionStatus === "POSTED",
      ),
    ).toBe(true);
    for (const fact of provisionData.provisions) {
      assertBalanced((await journalsFor(app, fact.documentId ?? ""))[0]);
    }

    // 同发票 + 同期间幂等：不重复计提。
    const second = await post(
      app,
      "/api/v1/financial-bad-debt/provision",
      { legalEntityId: LEGAL_ENTITY, accountingPeriod: period, asOf },
    );
    expect(second.statusCode).toBe(201);
    const secondData = (
      second.json() as {
        data: { provisions: FactBody[]; skipped: unknown[] };
      }
    ).data;
    expect(secondData.provisions).toHaveLength(0);
    expect(secondData.skipped).toHaveLength(4);

    const badInvoice = created.get("INV-BD-61-90");
    expect(badInvoice).toBeDefined();
    if (!badInvoice) return;

    const writeOff = await post(app, "/api/v1/financial-bad-debt/write-off", {
      invoiceFactId: badInvoice.id,
      reason: "confirmed uncollectible",
    });
    expect(writeOff.statusCode).toBe(201);
    const writeOffData = (
      writeOff.json() as {
        data: FactBody & {
          writeOffAmount: string;
          openAmountBefore: string;
          openAmountAfter: string;
        };
      }
    ).data;
    expect(writeOffData.documentType).toBe("BAD_DEBT_WRITE_OFF");
    // 核销冲减 AR：事实金额为负，核销额本身为正数。
    expect(writeOffData.amount).toBe("-1000");
    expect(writeOffData.writeOffAmount).toBe("1000");
    expect(writeOffData.openAmountBefore).toBe("1000");
    expect(writeOffData.openAmountAfter).toBe("0");
    const writeOffJournal = (
      await journalsFor(app, writeOffData.documentId ?? "")
    )[0];
    assertBalanced(writeOffJournal);
    expect(writeOffJournal?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "ALLOWANCE", debit: "1000", credit: "0" }),
        expect.objectContaining({ accountCode: "AR", debit: "0", credit: "1000" }),
      ]),
    );

    const afterAging = await aging(app, LEGAL_ENTITY, asOf);
    const written = afterAging.invoices.find(
      (row) => row.documentId === "INV-BD-61-90",
    );
    expect(written?.status).toBe("SETTLED");
    expect(written?.openAmount).toBe("0");
    expect(written?.writeOffs).toBe("1000");
    // 1000 × 5 - 1000 = 4000。
    expect(afterAging.totals[0]?.openAmount).toBe("4000");

    const duplicate = await post(app, "/api/v1/financial-bad-debt/write-off", {
      invoiceFactId: badInvoice.id,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(
      (duplicate.json() as { error: { message: string } }).error.message,
    ).toMatch(/INVOICE_ALREADY_WRITTEN_OFF/);
  });

  it("supports partial bad-debt write-offs without exceeding the open amount", async () => {
    const app = buildAppFor();
    const period = "2026-11";
    const asOf = "2026-11-25";
    const invoice = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-PARTIAL-WO", "1000.00", "2026-11-15T00:00:00.000Z", {
        accountingPeriod: period,
        orderId: "SO-PARTIAL-WO",
      }),
    );
    expect(invoice.statusCode).toBe(201);
    const invoiceFact = envelope(invoice).data;

    const rowsFor = async () =>
      (await aging(app, LEGAL_ENTITY, asOf)).invoices.filter(
        (row) => row.documentId === "INV-PARTIAL-WO",
      )[0];

    // 1) 部分核销 300：事实金额 -300，open 1000 → 700。
    const partial = await post(app, "/api/v1/financial-bad-debt/write-off", {
      invoiceFactId: invoiceFact.id,
      amount: "300.00",
      reason: "partial uncollectible",
    });
    expect(partial.statusCode).toBe(201);
    const partialData = (
      partial.json() as {
        data: FactBody & {
          writeOffAmount: string;
          openAmountBefore: string;
          openAmountAfter: string;
        };
      }
    ).data;
    expect(partialData.documentType).toBe("BAD_DEBT_WRITE_OFF");
    expect(partialData.recognitionStatus).toBe("POSTED");
    // 核销冲减 AR：事实金额为负，核销额正数落 payload / 响应。
    expect(partialData.amount).toBe("-300");
    expect(partialData.writeOffAmount).toBe("300");
    expect(partialData.openAmountBefore).toBe("1000");
    expect(partialData.openAmountAfter).toBe("700");
    expect(partialData.functionalAmount).toBe("-300");

    // GL 凭证金额 = 核销额（300），借 ALLOWANCE / 贷 AR，借贷平衡。
    const partialJournal = (
      await journalsFor(app, partialData.documentId ?? "")
    )[0];
    assertBalanced(partialJournal);
    expect(partialJournal?.totalDebit).toBe("300");
    expect(partialJournal?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "ALLOWANCE", debit: "300", credit: "0" }),
        expect.objectContaining({ accountCode: "AR", debit: "0", credit: "300" }),
      ]),
    );

    let row = await rowsFor();
    expect(row).toMatchObject({
      writeOffs: "300",
      openAmount: "700",
      status: "OPEN",
    });

    // 2) 第二次核销 800 > open 700 → 409 WRITE_OFF_EXCEEDS_OPEN，open 不变。
    const exceeds = await post(app, "/api/v1/financial-bad-debt/write-off", {
      invoiceFactId: invoiceFact.id,
      amount: "800",
    });
    expect(exceeds.statusCode).toBe(409);
    expect(
      (exceeds.json() as { error: { message: string } }).error.message,
    ).toMatch(/WRITE_OFF_EXCEEDS_OPEN/);
    row = await rowsFor();
    expect(row).toMatchObject({ writeOffs: "300", openAmount: "700" });

    // 3) 金额 0 / 负数 / 超过 6 位小数 → 400（契约层拒绝，不落事实）。
    for (const invalid of ["0", "0.000000", "-5", "-0.000001", "1.0000001"]) {
      const rejected = await post(
        app,
        "/api/v1/financial-bad-debt/write-off",
        { invoiceFactId: invoiceFact.id, amount: invalid },
      );
      expect(rejected.statusCode).toBe(400);
    }
    row = await rowsFor();
    expect(row).toMatchObject({ writeOffs: "300", openAmount: "700" });

    // 4) 金额缺省 = 全额核销剩余 open 700；累计核销 1000，open 归零。
    const remaining = await post(
      app,
      "/api/v1/financial-bad-debt/write-off",
      { invoiceFactId: invoiceFact.id, reason: "confirmed uncollectible" },
    );
    expect(remaining.statusCode).toBe(201);
    const remainingData = (
      remaining.json() as {
        data: FactBody & {
          writeOffAmount: string;
          openAmountBefore: string;
          openAmountAfter: string;
        };
      }
    ).data;
    expect(remainingData.amount).toBe("-700");
    expect(remainingData.writeOffAmount).toBe("700");
    expect(remainingData.openAmountBefore).toBe("700");
    expect(remainingData.openAmountAfter).toBe("0");
    const remainingJournal = (
      await journalsFor(app, remainingData.documentId ?? "")
    )[0];
    assertBalanced(remainingJournal);
    expect(remainingJournal?.totalDebit).toBe("700");
    expect(remainingJournal?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "ALLOWANCE", debit: "700", credit: "0" }),
        expect.objectContaining({ accountCode: "AR", debit: "0", credit: "700" }),
      ]),
    );

    row = await rowsFor();
    expect(row).toMatchObject({
      writeOffs: "1000",
      openAmount: "0",
      status: "SETTLED",
    });

    // 5) 已核销完再核销（缺省或显式）→ 409，不会超过 open。
    const closed = await post(app, "/api/v1/financial-bad-debt/write-off", {
      invoiceFactId: invoiceFact.id,
      amount: "1",
    });
    expect(closed.statusCode).toBe(409);
    expect(
      (closed.json() as { error: { message: string } }).error.message,
    ).toMatch(/INVOICE_ALREADY_WRITTEN_OFF/);
    row = await rowsFor();
    expect(row).toMatchObject({ writeOffs: "1000", openAmount: "0" });
  });

  it("honours a body matrix override for provisioning", async () => {
    const app = buildAppFor();
    const period = "2026-11";
    const res = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-BD-OVERRIDE", "1000.00", "2026-11-15T00:00:00.000Z", {
        accountingPeriod: period,
      }),
    );
    expect(res.statusCode).toBe(201);

    const provision = await post(
      app,
      "/api/v1/financial-bad-debt/provision",
      {
        legalEntityId: LEGAL_ENTITY,
        accountingPeriod: period,
        asOf: "2026-11-25",
        matrix: { "1-30": 7 },
      },
    );
    expect(provision.statusCode).toBe(201);
    const data = (
      provision.json() as {
        data: {
          provisions: FactBody[];
          totals: Array<{ provisionAmount: string }>;
        };
      }
    ).data;
    expect(data.provisions).toHaveLength(1);
    expect(data.provisions[0]?.amount).toBe("70");
    expect(data.totals[0]?.provisionAmount).toBe("70");
  });

  it("reconciles the subledger against ERP facts by document type", async () => {
    const app = buildAppFor();
    const period = "2026-10";
    const invoice = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-REC-1", "1000.00", "2026-10-05T00:00:00.000Z", {
        accountingPeriod: period,
        orderId: "SO-REC-1",
      }),
    );
    expect(invoice.statusCode).toBe(201);
    const payment = await post(app, "/api/v1/financial-payments", {
      relatedFactId: envelope(invoice).data.id,
      documentType: "PAYMENT",
      amount: "400.00",
    });
    expect(payment.statusCode).toBe(201);

    // ERP 侧：发票少 100，收款一致。
    const erpInvoice = await post(app, "/api/v1/financial-facts", {
      sourceSystem: "ERP",
      sourceRecordId: "ERP-INV-1",
      factType: "REVENUE",
      amount: "900.00",
      currency: "USD",
      recognitionStatus: "POSTED",
      legalEntityId: LEGAL_ENTITY,
      accountingPeriod: period,
      instrumentType: "INVOICE",
      orderId: "SO-REC-1",
      sourceVersion: "v1",
      documentType: "INVOICE",
      documentId: "ERP-INV-1",
      payload: {},
    });
    expect(erpInvoice.statusCode).toBe(201);
    const erpPayment = await post(app, "/api/v1/financial-facts", {
      sourceSystem: "ERP",
      sourceRecordId: "ERP-PAY-1",
      factType: "PAYMENT",
      amount: "400.00",
      currency: "USD",
      recognitionStatus: "POSTED",
      legalEntityId: LEGAL_ENTITY,
      accountingPeriod: period,
      instrumentType: "PAYMENT",
      orderId: "SO-REC-1",
      sourceVersion: "v1",
      documentType: "PAYMENT",
      documentId: "ERP-PAY-1",
      payload: {},
    });
    expect(erpPayment.statusCode).toBe(201);

    const variance = await get(
      app,
      `/api/v1/financial-subledger/reconciliation?period=${period}&legalEntityId=${LEGAL_ENTITY}`,
    );
    expect(variance.statusCode).toBe(200);
    const varianceData = (
      variance.json() as {
        data: {
          status: string;
          rows: Array<{
            documentType: string;
            subledgerAmount: string;
            erpAmount: string;
            difference: string;
            status: string;
          }>;
          totals: Array<{ currency: string; difference: string }>;
        };
      }
    ).data;
    expect(varianceData.status).toBe("VARIANCE");
    const invoiceRow = varianceData.rows.find(
      (row) => row.documentType === "INVOICE",
    );
    expect(invoiceRow).toMatchObject({
      subledgerAmount: "1000",
      erpAmount: "900",
      difference: "100",
      status: "VARIANCE",
    });
    const paymentRow = varianceData.rows.find(
      (row) => row.documentType === "PAYMENT",
    );
    expect(paymentRow).toMatchObject({
      subledgerAmount: "400",
      erpAmount: "400",
      difference: "0",
      status: "PASS",
    });
    expect(varianceData.totals[0]?.difference).toBe("100");

    // 补齐 ERP 差额后整体 PASS。
    const correction = await post(app, "/api/v1/financial-facts", {
      sourceSystem: "ERP",
      sourceRecordId: "ERP-INV-2",
      factType: "REVENUE",
      amount: "100.00",
      currency: "USD",
      recognitionStatus: "POSTED",
      legalEntityId: LEGAL_ENTITY,
      accountingPeriod: period,
      instrumentType: "INVOICE",
      orderId: "SO-REC-1",
      sourceVersion: "v1",
      documentType: "INVOICE",
      documentId: "ERP-INV-2",
      payload: {},
    });
    expect(correction.statusCode).toBe(201);

    const pass = await get(
      app,
      `/api/v1/financial-subledger/reconciliation?period=${period}&legalEntityId=${LEGAL_ENTITY}`,
    );
    expect(pass.statusCode).toBe(200);
    const passData = (
      pass.json() as {
        data: { status: string; rows: Array<{ status: string }> };
      }
    ).data;
    expect(passData.status).toBe("PASS");
    expect(passData.rows.every((row) => row.status === "PASS")).toBe(true);
  });

  it("generates balanced journals for every subledger document type", async () => {
    const app = buildAppFor();
    const period = "2026-10";

    const invoice = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-GL-1", "1000.00", "2026-10-05T00:00:00.000Z", {
        accountingPeriod: period,
        orderId: "SO-GL-1",
        taxRate: 10,
      }),
    );
    expect(invoice.statusCode).toBe(201);
    const invoiceFact = envelope(invoice).data;
    assertBalanced((await journalsFor(app, "INV-GL-1"))[0]);

    const payment = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoiceFact.id,
      documentType: "PAYMENT",
      amount: "200.00",
      documentId: "PAY-GL-1",
    });
    expect(payment.statusCode).toBe(201);
    const paymentJournal = (await journalsFor(app, "PAY-GL-1"))[0];
    assertBalanced(paymentJournal);
    expect(paymentJournal?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "CASH", debit: "200", credit: "0" }),
        expect.objectContaining({ accountCode: "AR", debit: "0", credit: "200" }),
      ]),
    );

    const refund = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoiceFact.id,
      documentType: "REFUND",
      amount: "50.00",
      documentId: "REF-GL-1",
    });
    expect(refund.statusCode).toBe(201);
    assertBalanced((await journalsFor(app, "REF-GL-1"))[0]);

    // 冲销收款 → 反向凭证（借 AR / 贷 CASH）。
    const paymentFact = envelope(payment).data;
    const reversal = await post(
      app,
      `/api/v1/financial-facts/${paymentFact.id}/reverse`,
      { reason: "duplicate payment" },
    );
    expect(reversal.statusCode).toBe(201);
    const reversalFact = envelope(reversal).data;
    const reversalJournal = (
      await journalsFor(app, reversalFact.documentId ?? "")
    )[0];
    assertBalanced(reversalJournal);
    expect(reversalJournal?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "AR", debit: "200", credit: "0" }),
        expect.objectContaining({ accountCode: "CASH", debit: "0", credit: "200" }),
      ]),
    );

    // 外币发票 + 重估。
    const fxInvoice = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-GL-FX", "1000.00", "2026-10-05T00:00:00.000Z", {
        accountingPeriod: period,
        orderId: "SO-GL-FX",
        currency: "USD",
        functionalCurrency: "EUR",
        fxRate: "0.900000",
      }),
    );
    expect(fxInvoice.statusCode).toBe(201);
    const fxFact = envelope(fxInvoice).data;
    assertBalanced((await journalsFor(app, "INV-GL-FX"))[0]);
    const revaluation = await post(app, "/api/v1/financial-revaluations", {
      factId: fxFact.id,
      fxRate: "0.950000",
      functionalCurrency: "EUR",
      reason: "month-end",
    });
    expect(revaluation.statusCode).toBe(201);
    const revaluationFact = envelope(revaluation).data;
    const fxJournal = (
      await journalsFor(app, revaluationFact.documentId ?? "")
    )[0];
    assertBalanced(fxJournal);
    expect(fxJournal?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "AR", debit: "50", credit: "0" }),
        expect.objectContaining({ accountCode: "FX_GAIN_LOSS", debit: "0", credit: "50" }),
      ]),
    );

    // 坏账计提 + 核销。
    const badInvoice = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-GL-BD", "1000.00", "2026-09-01T00:00:00.000Z", {
        accountingPeriod: period,
        orderId: "SO-GL-BD",
      }),
    );
    expect(badInvoice.statusCode).toBe(201);
    const badFact = envelope(badInvoice).data;
    const provision = await post(
      app,
      "/api/v1/financial-bad-debt/provision",
      {
        legalEntityId: LEGAL_ENTITY,
        accountingPeriod: period,
        asOf: "2026-11-25",
      },
    );
    expect(provision.statusCode).toBe(201);
    const provisionFact = (
      provision.json() as { data: { provisions: FactBody[] } }
    ).data.provisions[0];
    expect(provisionFact).toBeDefined();
    if (!provisionFact) return;
    expect(provisionFact.amount).toBe("100");
    assertBalanced((await journalsFor(app, provisionFact.documentId ?? ""))[0]);

    const writeOff = await post(app, "/api/v1/financial-bad-debt/write-off", {
      invoiceFactId: badFact.id,
      accountingPeriod: period,
      legalEntityId: LEGAL_ENTITY,
    });
    expect(writeOff.statusCode).toBe(201);
    const writeOffFact = envelope(writeOff).data;
    assertBalanced((await journalsFor(app, writeOffFact.documentId ?? ""))[0]);

    // 手工凭证：平衡 → 201；不平衡 → 409。
    const manual = await post(app, "/api/v1/financial-journals", {
      documentType: "INVOICE",
      documentId: "MANUAL-GL-1",
      legalEntityId: LEGAL_ENTITY,
      accountingPeriod: period,
      currency: "USD",
      description: "manual accrual",
      lines: [
        { accountCode: "AR", debit: "100.00" },
        { accountCode: "REVENUE", credit: "100.00" },
      ],
    });
    expect(manual.statusCode).toBe(201);
    assertBalanced(
      (manual.json() as { data: JournalBody }).data,
    );

    const unbalanced = await post(app, "/api/v1/financial-journals", {
      documentType: "INVOICE",
      documentId: "MANUAL-GL-2",
      legalEntityId: LEGAL_ENTITY,
      accountingPeriod: period,
      currency: "USD",
      lines: [
        { accountCode: "AR", debit: "100.00" },
        { accountCode: "REVENUE", credit: "90.00" },
      ],
    });
    expect(unbalanced.statusCode).toBe(409);
    expect(
      (unbalanced.json() as { error: { message: string } }).error.message,
    ).toMatch(/JOURNAL_NOT_BALANCED/);

    const unknownAccount = await post(app, "/api/v1/financial-journals", {
      documentType: "INVOICE",
      documentId: "MANUAL-GL-3",
      legalEntityId: LEGAL_ENTITY,
      accountingPeriod: period,
      currency: "USD",
      lines: [
        { accountCode: "NOPE", debit: "100.00" },
        { accountCode: "REVENUE", credit: "100.00" },
      ],
    });
    expect(unknownAccount.statusCode).toBe(409);
    expect(
      (unknownAccount.json() as { error: { message: string } }).error.message,
    ).toMatch(/UNKNOWN_GL_ACCOUNT/);

    // 科目表已种子化。
    const accounts = await get(app, "/api/v1/financial-gl-accounts");
    expect(accounts.statusCode).toBe(200);
    const codes = (
      accounts.json() as { data: Array<{ code: string }> }
    ).data.map((account) => account.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "AR",
        "REVENUE",
        "TAX_PAYABLE",
        "CASH",
        "FX_GAIN_LOSS",
        "BAD_DEBT_EXPENSE",
        "ALLOWANCE",
      ]),
    );
  });

  it("rejects aging-window writes, journals and bad debt while the period is closed", async () => {
    const platformStore = createStore();
    const app = buildAppFor(platformStore);
    const period = "2026-10";
    const invoice = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-CLOSED-1", "1000.00", "2026-10-05T00:00:00.000Z", {
        accountingPeriod: period,
      }),
    );
    expect(invoice.statusCode).toBe(201);
    const invoiceFact = envelope(invoice).data;

    const close = await post(app, "/api/v1/accounting-periods/close", {
      legalEntityId: LEGAL_ENTITY,
      period,
      actorPersonId: ADMIN,
      reason: "month-end close",
    });
    expect(close.statusCode).toBe(202);
    const change = (close.json() as { data: { id: string } }).data;
    const approverApp = buildAppFor(platformStore, APPROVER);
    const approve = await post(
      approverApp,
      `/api/v1/accounting-periods/change-requests/${change.id}/decide`,
      { decision: "APPROVE", approverPersonId: APPROVER, note: "approved" },
    );
    expect(approve.statusCode).toBe(200);

    const provision = await post(
      app,
      "/api/v1/financial-bad-debt/provision",
      { legalEntityId: LEGAL_ENTITY, accountingPeriod: period },
    );
    expect(provision.statusCode).toBe(409);
    expect(
      (provision.json() as { error: { message: string } }).error.message,
    ).toMatch(/PERIOD_CLOSED/);

    const writeOff = await post(app, "/api/v1/financial-bad-debt/write-off", {
      invoiceFactId: invoiceFact.id,
    });
    expect(writeOff.statusCode).toBe(409);
    expect(
      (writeOff.json() as { error: { message: string } }).error.message,
    ).toMatch(/PERIOD_CLOSED/);

    const manual = await post(app, "/api/v1/financial-journals", {
      documentType: "INVOICE",
      documentId: "MANUAL-CLOSED",
      legalEntityId: LEGAL_ENTITY,
      accountingPeriod: period,
      currency: "USD",
      lines: [
        { accountCode: "AR", debit: "10.00" },
        { accountCode: "REVENUE", credit: "10.00" },
      ],
    });
    expect(manual.statusCode).toBe(409);
    expect(
      (manual.json() as { error: { message: string } }).error.message,
    ).toMatch(/PERIOD_CLOSED/);
  });
});

// ----------------------------------------------------------------------
// 迁移 112 follow-up：账龄跨币种收款折算（X/Y/Z 三币种链）。
// 规则：同币种直接用原币；事实功能币 = 发票币种 → functionalAmount；
// 事实功能币 = 发票功能币 → 用发票 fxRate 反算；缺可用折算 → 409。
// ----------------------------------------------------------------------

function journalLine(journal: JournalBody | undefined, accountCode: string) {
  return journal?.lines.find((line) => line.accountCode === accountCode);
}

describe("Financial subledger aging cross-currency conversion", () => {
  it("converts EUR and JPY settlements into the USD invoice open amount", async () => {
    const app = buildAppFor();
    const asOf = "2026-11-25";
    const period = "2026-10";

    const invoiceRes = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-XCUR-1", "1000.00", "2026-10-01T00:00:00.000Z", {
        accountingPeriod: period,
        orderId: "SO-XCUR-1",
      }),
    );
    expect(invoiceRes.statusCode).toBe(201);
    const invoice = envelope(invoiceRes).data;

    // EUR 收款：EUR → functional USD @1.1，200 EUR = 220 USD。
    const eurPaymentRes = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoice.id,
      documentType: "PAYMENT",
      documentId: "PAY-XEUR",
      amount: "200.00",
      currency: "EUR",
      functionalCurrency: "USD",
      fxRate: "1.100000",
    });
    expect(eurPaymentRes.statusCode).toBe(201);
    const eurPayment = envelope(eurPaymentRes).data;
    expect(eurPayment.currency).toBe("EUR");
    expect(eurPayment.functionalCurrency).toBe("USD");
    expect(eurPayment.fxRate).toBe("1.1");
    expect(eurPayment.functionalAmount).toBe("220");

    // JPY 收款：JPY → functional USD @0.0067，30000 JPY = 201 USD。
    const jpyPaymentRes = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoice.id,
      documentType: "PAYMENT",
      documentId: "PAY-XJPY",
      amount: "30000.00",
      currency: "JPY",
      functionalCurrency: "USD",
      fxRate: "0.006700",
    });
    expect(jpyPaymentRes.statusCode).toBe(201);
    const jpyPayment = envelope(jpyPaymentRes).data;
    expect(jpyPayment.functionalAmount).toBe("201");

    // EUR 退款：50 EUR = 55 USD 减少（退款金额入库为负）。
    const eurRefundRes = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoice.id,
      documentType: "REFUND",
      documentId: "REF-XEUR",
      amount: "50.00",
      currency: "EUR",
      functionalCurrency: "USD",
      fxRate: "1.100000",
    });
    expect(eurRefundRes.statusCode).toBe(201);
    const eurRefund = envelope(eurRefundRes).data;
    expect(eurRefund.amount).toBe("-50");
    expect(eurRefund.functionalAmount).toBe("-55");

    const agingData = await aging(app, LEGAL_ENTITY, asOf);
    const row = agingData.invoices.find(
      (candidate) => candidate.documentId === "INV-XCUR-1",
    );
    expect(row).toBeDefined();
    if (!row) return;
    // open = 1000 - 220 - 201 - (-55) = 634。
    expect(row).toMatchObject({
      currency: "USD",
      payments: "421",
      refunds: "-55",
      openAmount: "634",
    });
    expect(row.crossCurrencySettlements).toHaveLength(3);
    expect(
      row.crossCurrencySettlements?.every(
        (entry) => entry.conversion === "FUNCTIONAL_CURRENCY",
      ),
    ).toBe(true);
    expect(
      row.crossCurrencySettlements?.map((entry) => entry.convertedAmount),
    ).toEqual(expect.arrayContaining(["220", "201", "-55"]));
    expect(agingData.totals[0]).toMatchObject({
      currency: "USD",
      payments: "421",
      refunds: "-55",
      openAmount: "634",
      buckets: { "31-60": "634" },
    });

    // GL：发票 AR 借 1000 USD；每张凭证平衡；收付 AR 金额仍是原币，
    // 用同一折算规则（functionalAmount）还原为 USD 后与账龄 open 一致。
    const invoiceJournal = (await journalsFor(app, "INV-XCUR-1"))[0];
    const eurPaymentJournal = (await journalsFor(app, "PAY-XEUR"))[0];
    const jpyPaymentJournal = (await journalsFor(app, "PAY-XJPY"))[0];
    const eurRefundJournal = (await journalsFor(app, "REF-XEUR"))[0];
    for (const journal of [
      invoiceJournal,
      eurPaymentJournal,
      jpyPaymentJournal,
      eurRefundJournal,
    ]) {
      assertBalanced(journal);
    }
    expect(journalLine(invoiceJournal, "AR")?.debit).toBe("1000");
    expect(eurPaymentJournal?.currency).toBe("EUR");
    expect(journalLine(eurPaymentJournal, "AR")?.credit).toBe("200");
    expect(jpyPaymentJournal?.currency).toBe("JPY");
    expect(journalLine(jpyPaymentJournal, "AR")?.credit).toBe("30000");
    expect(eurRefundJournal?.currency).toBe("EUR");
    expect(journalLine(eurRefundJournal, "AR")?.debit).toBe("50");

    const glOpenInUsd =
      1000 -
      Number(eurPayment.functionalAmount) -
      Number(jpyPayment.functionalAmount) -
      Number(eurRefund.functionalAmount);
    expect(glOpenInUsd).toBe(634);
    expect(Number(row.openAmount)).toBe(glOpenInUsd);

    // 子账仍按原币回读，折算只发生在账龄视图（可追溯）。
    const ledgerRes = await get(
      app,
      "/api/v1/financial-subledger?orderId=SO-XCUR-1",
    );
    expect(ledgerRes.statusCode).toBe(200);
    const totals = (
      ledgerRes.json() as {
        data: {
          totals: Record<
            string,
            { invoiced: string; paid: string; refunded: string; net: string }
          >;
        };
      }
    ).data.totals;
    expect(totals.USD).toMatchObject({
      invoiced: "1000",
      paid: "0",
      refunded: "0",
      net: "1000",
    });
    expect(totals.EUR).toMatchObject({
      paid: "200",
      refunded: "-50",
      net: "150",
    });
    expect(totals.JPY).toMatchObject({ paid: "30000", net: "30000" });
  });

  it("supports an invoice X / payment Y / functional Z chain via invoice fxRate", async () => {
    const app = buildAppFor();
    const asOf = "2026-11-25";
    const period = "2026-10";

    // 发票 X=USD，功能币 Z=EUR（USD→EUR 0.9）。
    const invoiceRes = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-XYZ-1", "1000.00", "2026-10-01T00:00:00.000Z", {
        accountingPeriod: period,
        orderId: "SO-XYZ-1",
        currency: "USD",
        functionalCurrency: "EUR",
        fxRate: "0.900000",
      }),
    );
    expect(invoiceRes.statusCode).toBe(201);
    const invoice = envelope(invoiceRes).data;

    // 收款 Y=JPY，功能币 Z=EUR：30000 JPY × 0.0067 = 201 EUR。
    const paymentRes = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoice.id,
      documentType: "PAYMENT",
      documentId: "PAY-XYZ",
      amount: "30000.00",
      currency: "JPY",
      functionalCurrency: "EUR",
      fxRate: "0.006700",
    });
    expect(paymentRes.statusCode).toBe(201);
    const payment = envelope(paymentRes).data;
    expect(payment.functionalCurrency).toBe("EUR");
    expect(payment.functionalAmount).toBe("201");

    // X = Z / (USD→EUR 0.9) = 201 / 0.9 = 223.333333 USD（HALF_UP）。
    const agingData = await aging(app, LEGAL_ENTITY, asOf);
    const row = agingData.invoices.find(
      (candidate) => candidate.documentId === "INV-XYZ-1",
    );
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.payments).toBe("223.333333");
    expect(row.openAmount).toBe("776.666667");
    expect(row.crossCurrencySettlements).toHaveLength(1);
    expect(row.crossCurrencySettlements?.[0]).toMatchObject({
      conversion: "INVOICE_FX_RATE_INVERSE",
      currency: "JPY",
      amount: "30000",
      functionalCurrency: "EUR",
      functionalAmount: "201",
      convertedAmount: "223.333333",
    });

    // GL 平衡 + 同一反算规则下与账龄 open 一致。
    const paymentJournal = (await journalsFor(app, "PAY-XYZ"))[0];
    assertBalanced(paymentJournal);
    expect(paymentJournal?.currency).toBe("JPY");
    expect(journalLine(paymentJournal, "AR")?.credit).toBe("30000");
    const invoiceJournal = (await journalsFor(app, "INV-XYZ-1"))[0];
    assertBalanced(invoiceJournal);
    expect(journalLine(invoiceJournal, "AR")?.debit).toBe("1000");

    const convertedBack = 1000 - 223.333333;
    expect(Number(row.openAmount)).toBeCloseTo(convertedBack, 6);

    const ledgerRes = await get(
      app,
      "/api/v1/financial-subledger?orderId=SO-XYZ-1",
    );
    const ledger = (
      ledgerRes.json() as { data: { totals: Record<string, { paid: string }> } }
    ).data.totals;
    expect(ledger.JPY?.paid).toBe("30000");
  });

  it("fails closed when a cross-currency settlement has no usable FX", async () => {
    const app = buildAppFor();
    const asOf = "2026-11-25";
    const period = "2026-10";

    const invoiceRes = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-NOFX-1", "1000.00", "2026-10-01T00:00:00.000Z", {
        accountingPeriod: period,
        orderId: "SO-NOFX-1",
      }),
    );
    expect(invoiceRes.statusCode).toBe(201);
    const invoice = envelope(invoiceRes).data;

    // ERP 直连 PAYMENT：JPY 原币且无 functionalCurrency/functionalAmount，
    // 账龄无法折算时必须 409，不能当作 0 或直接忽略。
    const paymentRes = await post(app, "/api/v1/financial-facts", {
      sourceSystem: "ERP",
      sourceRecordId: "PAY-NOFX",
      factType: "PAYMENT",
      amount: "5000.00",
      currency: "JPY",
      recognitionStatus: "POSTED",
      legalEntityId: LEGAL_ENTITY,
      accountingPeriod: period,
      instrumentType: "PAYMENT",
      orderId: "SO-NOFX-1",
      sourceVersion: "v1",
      documentType: "PAYMENT",
      documentId: "PAY-NOFX-1",
      relatedFactId: invoice.id,
      payload: {},
    });
    expect(paymentRes.statusCode).toBe(201);

    const agingRes = await get(
      app,
      `/api/v1/financial-subledger/aging?legalEntityId=${LEGAL_ENTITY}&asOf=${asOf}`,
    );
    expect(agingRes.statusCode).toBe(409);
    const error = (
      agingRes.json() as { error: { message: string } }
    ).error.message;
    expect(error).toMatch(/CROSS_CURRENCY_FX_REQUIRED/);
    expect(error).toContain("JPY");
    expect(error).toContain("USD");

    // 依赖账龄的坏账计提同样 fail-closed。
    const provisionRes = await post(
      app,
      "/api/v1/financial-bad-debt/provision",
      { legalEntityId: LEGAL_ENTITY, accountingPeriod: period, asOf },
    );
    expect(provisionRes.statusCode).toBe(409);
    expect(
      (provisionRes.json() as { error: { message: string } }).error.message,
    ).toMatch(/CROSS_CURRENCY_FX_REQUIRED/);
  });
});

/**
 * 迁移 115：发票多税种（VAT 13% + WHT 6% 等）。
 *
 * 覆盖：
 * - 逐税种 1e6 定点计算、先取整后汇总（tax_amount）与含税总额（totalAmount）；
 * - payload.taxBreakdown 明细（code / rate / base / taxAmount），不新增列；
 * - taxes 与旧 taxRate 互斥、空数组 / 超 5 条 / 重复 code / 越界 code&rate（400）；
 * - 客户端 taxAmount 必须等于逐税种汇总（409），只有 taxAmount 无税率（409）；
 * - 收款按含税总额核销、账龄 open 用含税总额；
 * - GL：单一 TAX_PAYABLE 贷记汇总税额，凭证借贷平衡且不新增科目。
 */
describe("Financial subledger multi-tax invoices (migration 115)", () => {
  it("computes two taxes (13% + 6%) per code and aggregates into tax_amount", async () => {
    const app = buildAppFor();
    const res = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-MT-1",
        amount: "1000.00",
        taxes: [
          { code: "VAT", rate: 13 },
          { code: "WHT", rate: 6 },
        ],
      }),
    );
    expect(res.statusCode).toBe(201);
    const invoice = envelope(res).data;
    // 逐税种先算再汇总：130 + 60 = 190；发票总额 1000 + 190 = 1190。
    expect(invoice.taxRate).toBeUndefined();
    expect(invoice.taxAmount).toBe("190");
    expect(invoice.totalAmount).toBe("1190");
    expect(invoice.payload?.taxBreakdown).toEqual([
      { code: "VAT", rate: "13", base: "1000", taxAmount: "130" },
      { code: "WHT", rate: "6", base: "1000", taxAmount: "60" },
    ] satisfies InvoiceTaxBody[]);

    const journal = (await journalsFor(app, "INV-MT-1"))[0];
    assertBalanced(journal);
    expect(journal?.totalDebit).toBe("1190");
    expect(journal?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "AR", debit: "1190", credit: "0" }),
        expect.objectContaining({ accountCode: "REVENUE", debit: "0", credit: "1000" }),
        expect.objectContaining({
          accountCode: "TAX_PAYABLE",
          debit: "0",
          credit: "190",
        }),
      ]),
    );
    // 不按税种新增科目：仍是一借两贷三行。
    expect(journal?.lines).toHaveLength(3);

    // 冲销凭证 = 原凭证借贷互换：TAX_PAYABLE 借方 = 汇总税额，仍平衡。
    const reversalRes = await post(
      app,
      `/api/v1/financial-facts/${invoice.id}/reverse`,
      { reason: "multi-tax audit" },
    );
    expect(reversalRes.statusCode).toBe(201);
    const reversal = envelope(reversalRes).data;
    const reversalJournal = (
      await journalsFor(app, reversal.documentId ?? "")
    )[0];
    assertBalanced(reversalJournal);
    expect(reversalJournal?.totalDebit).toBe("1190");
    expect(reversalJournal?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountCode: "AR",
          debit: "0",
          credit: "1190",
        }),
        expect.objectContaining({
          accountCode: "TAX_PAYABLE",
          debit: "190",
          credit: "0",
        }),
      ]),
    );
  });

  it("rounds each tax before summing and re-validates client taxAmount", async () => {
    const app = buildAppFor();
    // 0.000003 × 50% = 0.0000015 → HALF_UP 0.000002；两条合计 0.000004。
    // 若先合并税率（100%）一次取整只会得到 0.000003，验证“先逐条取整”。
    const res = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-MT-ROUND",
        amount: "0.000003",
        taxes: [
          { code: "VAT", rate: 50 },
          { code: "WHT", rate: 50 },
        ],
      }),
    );
    expect(res.statusCode).toBe(201);
    const invoice = envelope(res).data;
    expect(invoice.taxAmount).toBe("0.000004");
    expect(invoice.totalAmount).toBe("0.000007");

    // 客户端 taxAmount 与逐税种汇总一致 → 201。
    const accepted = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-MT-ROUND-2",
        amount: "1000.00",
        taxes: [
          { code: "VAT", rate: 13 },
          { code: "WHT", rate: 6 },
        ],
        taxAmount: "190.00",
      }),
    );
    expect(accepted.statusCode).toBe(201);
    expect(envelope(accepted).data.taxAmount).toBe("190");

    // 用“汇总税率一次取整”的 0.000003 冒充 → 409（汇总校验失败）。
    const drifted = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-MT-ROUND-3",
        amount: "0.000003",
        taxes: [
          { code: "VAT", rate: 50 },
          { code: "WHT", rate: 50 },
        ],
        taxAmount: "0.000003",
      }),
    );
    expect(drifted.statusCode).toBe(409);
    expect(errorMessage(drifted)).toMatch(/TAX_AMOUNT_INCONSISTENT/);

    // 只有 taxAmount、没有 taxRate / taxes → 409（无口径可校验）。
    const noRate = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-MT-ROUND-4",
        amount: "1000.00",
        taxAmount: "190.00",
      }),
    );
    expect(noRate.statusCode).toBe(409);
    expect(errorMessage(noRate)).toMatch(/TAX_RATE_REQUIRED/);
  });

  it("rejects taxRate + taxes, empty/oversized arrays and duplicate codes", async () => {
    const app = buildAppFor();
    const both = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-MT-BAD-BOTH",
        taxRate: 13,
        taxes: [{ code: "VAT", rate: 13 }],
      }),
    );
    expect(both.statusCode).toBe(400);
    expect(errorDetails(both)).toMatch(/MUTUALLY_EXCLUSIVE_TAX_INPUT/);

    const empty = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({ documentId: "INV-MT-BAD-EMPTY", taxes: [] }),
    );
    expect(empty.statusCode).toBe(400);
    expect(errorDetails(empty)).toMatch(/between 1 and 5/);

    const oversized = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-MT-BAD-MANY",
        taxes: Array.from({ length: 6 }, (_, index) => ({
          code: `T${index}`,
          rate: 1,
        })),
      }),
    );
    expect(oversized.statusCode).toBe(400);
    expect(errorDetails(oversized)).toMatch(/between 1 and 5/);

    // 重复 code（大小写/首尾空白归一后相同）→ 400，拒绝歧义税率。
    const duplicate = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-MT-BAD-DUP",
        taxes: [
          { code: "VAT", rate: 13 },
          { code: " vat ", rate: 6 },
        ],
      }),
    );
    expect(duplicate.statusCode).toBe(400);
    expect(errorDetails(duplicate)).toMatch(/DUPLICATE_TAX_CODE/);

    const longCode = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-MT-BAD-CODE",
        taxes: [{ code: "X".repeat(33), rate: 5 }],
      }),
    );
    expect(longCode.statusCode).toBe(400);
    expect(errorDetails(longCode)).toMatch(/at most 32 characters/);

    const blankCode = await post(
      app,
      "/api/v1/financial-invoices",
      invoicePayload({
        documentId: "INV-MT-BAD-BLANK",
        taxes: [{ code: "   ", rate: 5 }],
      }),
    );
    expect(blankCode.statusCode).toBe(400);

    for (const rate of [101, -1, 1.1234567]) {
      const bad = await post(
        app,
        "/api/v1/financial-invoices",
        invoicePayload({
          documentId: `INV-MT-BAD-RATE-${rate}`,
          taxes: [{ code: "VAT", rate }],
        }),
      );
      expect(bad.statusCode).toBe(400);
    }

    // 全部在写库前失败：不产生任何发票事实。
    const agingRes = await get(
      app,
      `/api/v1/financial-subledger/aging?legalEntityId=${LEGAL_ENTITY}&asOf=2026-11-25`,
    );
    expect(agingRes.statusCode).toBe(200);
    expect(
      (agingRes.json() as { data: { invoices: AgingRow[] } }).data.invoices,
    ).toHaveLength(0);
  });

  it("settles against the tax-inclusive total and ages the open amount with tax", async () => {
    const app = buildAppFor();
    const asOf = "2026-11-25";
    const createRes = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-MT-AGING", "1000.00", "2026-11-20T00:00:00.000Z", {
        accountingPeriod: "2026-11",
        taxes: [
          { code: "VAT", rate: 13 },
          { code: "WHT", rate: 6 },
        ],
      }),
    );
    expect(createRes.statusCode).toBe(201);
    const invoice = envelope(createRes).data;
    expect(invoice.totalAmount).toBe("1190");

    // 只付不含税额 1000 → 税额仍开放：open = 1190 - 1000 = 190。
    const partial = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoice.id,
      documentType: "PAYMENT",
      amount: "1000.00",
    });
    expect(partial.statusCode).toBe(201);
    // 收付事实记录被核销发票的含税总额口径（迁移 115）。
    expect(envelope(partial).data.payload).toMatchObject({
      invoiceTaxAmount: "190",
      invoiceTotalAmount: "1190",
    });

    const partialAging = await aging(app, LEGAL_ENTITY, asOf);
    expect(partialAging.invoices).toHaveLength(1);
    expect(partialAging.invoices[0]).toMatchObject({
      documentId: "INV-MT-AGING",
      taxAmount: "190",
      totalAmount: "1190",
      payments: "1000",
      openAmount: "190",
      status: "OPEN",
    });
    expect(partialAging.totals[0]?.openAmount).toBe("190");

    // 补齐税额 190 → 含税总额结清，账龄 open 归零。
    const settle = await post(app, "/api/v1/financial-payments", {
      relatedFactId: invoice.id,
      documentType: "PAYMENT",
      amount: "190.00",
    });
    expect(settle.statusCode).toBe(201);

    const settledAging = await aging(app, LEGAL_ENTITY, asOf);
    expect(settledAging.invoices[0]).toMatchObject({
      payments: "1190",
      openAmount: "0",
      status: "SETTLED",
    });
    expect(settledAging.totals[0]?.openAmount).toBe("0");
  });

  it("keeps legacy single-rate invoices working alongside multi-tax", async () => {
    const app = buildAppFor();
    const legacy = await post(
      app,
      "/api/v1/financial-invoices",
      invoiceBody("INV-MT-LEGACY", "1000.00", "2026-11-20T00:00:00.000Z", {
        taxRate: 13,
      }),
    );
    expect(legacy.statusCode).toBe(201);
    const legacyInvoice = envelope(legacy).data;
    expect(legacyInvoice.taxRate).toBe("13");
    expect(legacyInvoice.taxAmount).toBe("130");
    // 单税率发票不写 taxBreakdown，避免两种口径同时出现。
    expect(legacyInvoice.payload?.taxBreakdown).toBeUndefined();
  });
});
