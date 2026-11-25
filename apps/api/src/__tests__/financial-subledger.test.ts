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
  orderId?: string;
  contractRef?: string;
  recognitionStatus: string;
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
