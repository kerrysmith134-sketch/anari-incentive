/**
 * ANARI-ERP provider 契约测试。
 *
 * 断言三类事实：端点/分页参数（对得上 Anari-ERP routers/finance.py 的真实签名）、
 * 字段映射与金额字符串（/api/v1/financial-facts 的 decimal 是字符串），以及缺字段
 * 时的 fail-closed（不猜金额/币种/id，返回 []；信封形状不对直接抛错）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CanonicalWrite, PullTarget } from "../types.js";
import {
  AR_COLLECTION_PLAN_PATH,
  AP_PAYMENT_PLAN_PATH,
  FINANCIAL_FACTS_PATH,
  MARGIN_PORTFOLIO_PATH,
  erpProvider,
  normalizeErpApPayment,
  normalizeErpArCollection,
  normalizeErpMarginRow,
} from "../erp.js";

const FIXTURES = fileURLToPath(
  new URL("../../../../../fixtures/connectors/", import.meta.url),
);

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(FIXTURES, name), "utf8"),
  ) as Record<string, unknown>;
}

function target(path: string): PullTarget {
  const found = erpProvider.targets.find((entry) => entry.path === path);
  if (!found) throw new Error(`missing target ${path}`);
  return found;
}

function single(writes: CanonicalWrite[]): CanonicalWrite {
  expect(writes).toHaveLength(1);
  return writes[0]!;
}

function suggestionsOf(
  fixture: Record<string, unknown>,
): Record<string, unknown>[] {
  return fixture.suggestions as Record<string, unknown>[];
}

function rowsOf(fixture: Record<string, unknown>): Record<string, unknown>[] {
  return fixture.rows as Record<string, unknown>[];
}

describe("erpProvider contract", () => {
  it("declares the ERP source, env vars and the three read-only endpoints", () => {
    expect(erpProvider).toMatchObject({
      code: "anari-erp",
      sourceSystem: "ANARI_ERP",
      baseUrlEnv: "ANARI_ERP_BASE_URL",
      tokenEnv: "ANARI_ERP_TOKEN",
    });
    expect(erpProvider.targets.map((entry) => entry.path)).toEqual([
      AP_PAYMENT_PLAN_PATH,
      AR_COLLECTION_PLAN_PATH,
      MARGIN_PORTFOLIO_PATH,
    ]);
    expect(erpProvider.targets.every((entry) => entry.method === "GET")).toBe(
      true,
    );
  });

  it("writes every fact to /api/v1/financial-facts", () => {
    const payment = suggestionsOf(
      readFixture("erp-ap-payment-plan.sample.json"),
    )[0]!;
    const write = single(normalizeErpApPayment(payment));
    expect(write.path).toBe(FINANCIAL_FACTS_PATH);
    expect(write.externalId).toBe(write.body.sourceRecordId);
  });
});

describe("pagination parameters match the real endpoints", () => {
  it("AP payment plan has neither page nor limit parameters", () => {
    const ap = target(AP_PAYMENT_PLAN_PATH);
    // routers/finance.py: ap_payment_plan(as_of, cash_available) —— 无 limit/page。
    expect(ap.pageParam).toBeUndefined();
    expect(ap.limitParam).toBeUndefined();
    expect(ap.pageSize).toBeUndefined();
  });

  it("AR collection plan exposes only the 200-row limit cap", () => {
    const ar = target(AR_COLLECTION_PLAN_PATH);
    // Query(50, ge=1, le=200)；没有 offset/page，一页即上限。
    expect(ar.pageParam).toBeUndefined();
    expect(ar.limitParam).toBe("limit");
    expect(ar.pageSize).toBe(200);
  });

  it("margin portfolio exposes only the 500-row limit cap", () => {
    const margin = target(MARGIN_PORTFOLIO_PATH);
    // Query(200, ge=1, le=500)；没有 offset/page。
    expect(margin.pageParam).toBeUndefined();
    expect(margin.limitParam).toBe("limit");
    expect(margin.pageSize).toBe(500);
  });
});

describe("extract", () => {
  it("reads the suggestions/rows envelopes the ERP actually returns", () => {
    expect(
      target(AP_PAYMENT_PLAN_PATH).extract(
        readFixture("erp-ap-payment-plan.sample.json"),
      ),
    ).toHaveLength(2);
    expect(
      target(AR_COLLECTION_PLAN_PATH).extract(
        readFixture("erp-ar-collection-plan.sample.json"),
      ),
    ).toHaveLength(2);
    expect(
      target(MARGIN_PORTFOLIO_PATH).extract(
        readFixture("erp-margin-portfolio.sample.json"),
      ),
    ).toHaveLength(3);
  });

  it("throws on schema drift instead of reporting an empty page", () => {
    const ap = target(AP_PAYMENT_PLAN_PATH);
    // 鉴权失败时 ERP 返回 {"detail": "Not authenticated"}，不能当成 0 条。
    expect(() => ap.extract({ detail: "Not authenticated" })).toThrow(
      /suggestions/,
    );
    expect(() => ap.extract(null)).toThrow(/suggestions/);
    expect(() => ap.extract({ suggestions: "not-an-array" })).toThrow(
      /suggestions/,
    );
  });

  it("drops non-object entries but keeps well-formed ones", () => {
    const ap = target(AP_PAYMENT_PLAN_PATH);
    expect(
      ap.extract({ suggestions: [null, 1, "x", { payment_id: 1 }] }),
    ).toEqual([{ payment_id: 1 }]);
  });
});

describe("AP payment plan → AP_PAYMENT", () => {
  it("maps the real fields, keeps the raw record, and stays DRAFT", () => {
    const payment = suggestionsOf(
      readFixture("erp-ap-payment-plan.sample.json"),
    )[0]!;
    const write = single(normalizeErpApPayment(payment));

    expect(write.body).toMatchObject({
      sourceSystem: "ANARI_ERP",
      sourceRecordId: "AP_PAYMENT:9001",
      factType: "AP_PAYMENT",
      amount: "12800.5",
      currency: "CNY",
      qualityStatus: "VALID",
      recognitionStatus: "DRAFT",
    });
    // payload 是原始记录本身（保留 included/reasons/due_date 等决策字段）。
    expect(write.body.payload).toBe(payment);
    expect(write.body.periodStart).toBeUndefined();
    expect(write.body.periodEnd).toBeUndefined();
  });

  it("ingests deferred suggestions too (included=false is still a payable)", () => {
    const deferred = suggestionsOf(
      readFixture("erp-ap-payment-plan.sample.json"),
    )[1]!;
    const write = single(normalizeErpApPayment(deferred));
    expect(write.body.sourceRecordId).toBe("AP_PAYMENT:9002");
    expect(write.body.amount).toBe("4200");
    expect(write.body.currency).toBe("USD");
    expect(write.body.payload).toBe(deferred);
  });

  it("keeps sourceRecordId stable when the mutable due date changes", () => {
    const payment = suggestionsOf(
      readFixture("erp-ap-payment-plan.sample.json"),
    )[0]!;
    const original = single(normalizeErpApPayment(payment));
    const rescheduled = single(
      normalizeErpApPayment({ ...payment, due_date: "2026-12-31" }),
    );
    expect(rescheduled.body.sourceRecordId).toBe(
      original.body.sourceRecordId,
    );
  });

  it("accepts numeric ids and decimal-string amounts without float round-trips", () => {
    const payment = suggestionsOf(
      readFixture("erp-ap-payment-plan.sample.json"),
    )[0]!;
    const fromStringId = single(
      normalizeErpApPayment({ ...payment, payment_id: "9001" }),
    );
    expect(fromStringId.body.sourceRecordId).toBe("AP_PAYMENT:9001");

    const stringAmount = single(
      normalizeErpApPayment({ ...payment, amount: "12800.500000" }),
    );
    expect(stringAmount.body.amount).toBe("12800.500000");

    // Python float 在 JSON 里可能是指数形式（极小值）；展开成 decimal 字符串。
    const exponential = single(
      normalizeErpApPayment({ ...payment, amount: 1e-7 }),
    );
    expect(exponential.body.amount).toBe("0.0000001");
  });

  it("is idempotent for the same source record", () => {
    const payment = suggestionsOf(
      readFixture("erp-ap-payment-plan.sample.json"),
    )[0]!;
    expect(normalizeErpApPayment(payment)).toEqual(
      normalizeErpApPayment(structuredClone(payment)),
    );
  });

  it("fails closed on missing id, amount or currency", () => {
    const payment = suggestionsOf(
      readFixture("erp-ap-payment-plan.sample.json"),
    )[0]!;
    expect(normalizeErpApPayment({ ...payment, payment_id: undefined })).toEqual(
      [],
    );
    expect(normalizeErpApPayment({ ...payment, amount: undefined })).toEqual(
      [],
    );
    expect(normalizeErpApPayment({ ...payment, amount: 0 })).toEqual([]);
    expect(normalizeErpApPayment({ ...payment, amount: -1 })).toEqual([]);
    expect(normalizeErpApPayment({ ...payment, amount: "12,800.50" })).toEqual(
      [],
    );
    expect(normalizeErpApPayment({ ...payment, amount: "1e5" })).toEqual([]);
    expect(normalizeErpApPayment({ ...payment, amount: Number.NaN })).toEqual(
      [],
    );
    expect(normalizeErpApPayment({ ...payment, currency: "CN" })).toEqual([]);
    expect(
      normalizeErpApPayment({ ...payment, currency: undefined }),
    ).toEqual([]);
    expect(normalizeErpApPayment(null)).toEqual([]);
    expect(normalizeErpApPayment([payment])).toEqual([]);
    expect(normalizeErpApPayment("payment")).toEqual([]);
  });

  it("normalizes lowercase currency codes to ISO uppercase", () => {
    const payment = suggestionsOf(
      readFixture("erp-ap-payment-plan.sample.json"),
    )[0]!;
    const write = single(normalizeErpApPayment({ ...payment, currency: "cny" }));
    expect(write.body.currency).toBe("CNY");
  });

  it("only POSTED when all accounting prerequisites and a trace relation exist", () => {
    const payment = suggestionsOf(
      readFixture("erp-ap-payment-plan.sample.json"),
    )[0]!;
    const accounting = {
      legal_entity_id: "LE-CN-01",
      accounting_period: "2026-11",
      instrument_type: "PAYMENT",
      source_version: "erp-7.2.0",
      order_id: "SO-2026-0412",
    };

    const posted = single(
      normalizeErpApPayment({ ...payment, ...accounting }),
    );
    expect(posted.body).toMatchObject({
      recognitionStatus: "POSTED",
      legalEntityId: "LE-CN-01",
      accountingPeriod: "2026-11",
      instrumentType: "PAYMENT",
      sourceVersion: "erp-7.2.0",
      orderId: "SO-2026-0412",
    });

    const missingVersion = single(
      normalizeErpApPayment({
        ...payment,
        ...accounting,
        source_version: undefined,
      }),
    );
    expect(missingVersion.body.recognitionStatus).toBe("DRAFT");

    const noRelation = single(
      normalizeErpApPayment({
        ...payment,
        ...accounting,
        order_id: undefined,
      }),
    );
    expect(noRelation.body.recognitionStatus).toBe("DRAFT");

    // 合同引用与订单引用等价：满足 order/contract 追溯即可。
    const byContract = single(
      normalizeErpApPayment({
        ...payment,
        ...accounting,
        order_id: undefined,
        contract_ref: "CT-2026-0412",
      }),
    );
    expect(byContract.body.recognitionStatus).toBe("POSTED");
    expect(byContract.body.contractRef).toBe("CT-2026-0412");

    // instrument_type 不在目标 enum 里：DRAFT，并且不把非法值写进 body。
    const invalidInstrument = single(
      normalizeErpApPayment({
        ...payment,
        ...accounting,
        instrument_type: "PAYABLE",
      }),
    );
    expect(invalidInstrument.body.recognitionStatus).toBe("DRAFT");
    expect(invalidInstrument.body.instrumentType).toBeUndefined();

    // 期间格式非法同样不能进 POSTED。
    const invalidPeriod = single(
      normalizeErpApPayment({
        ...payment,
        ...accounting,
        accounting_period: "2026-13",
      }),
    );
    expect(invalidPeriod.body.recognitionStatus).toBe("DRAFT");
    expect(invalidPeriod.body.accountingPeriod).toBeUndefined();
  });
});

describe("AR collection plan → AR_COLLECTION", () => {
  it("maps the receivable to an AR fact with the order reference", () => {
    const receivable = suggestionsOf(
      readFixture("erp-ar-collection-plan.sample.json"),
    )[0]!;
    const write = single(normalizeErpArCollection(receivable));

    expect(write.body).toMatchObject({
      sourceSystem: "ANARI_ERP",
      sourceRecordId: "AR_COLLECTION:501",
      factType: "AR_COLLECTION",
      amount: "8600",
      currency: "EUR",
      qualityStatus: "VALID",
      recognitionStatus: "DRAFT",
      orderId: "SO-2026-0077",
    });
    expect(write.body.payload).toBe(receivable);
    expect(write.externalId).toBe("AR_COLLECTION:501");
  });

  it("keeps the CNY row as CNY (no cross-currency conversion)", () => {
    const receivable = suggestionsOf(
      readFixture("erp-ar-collection-plan.sample.json"),
    )[1]!;
    const write = single(normalizeErpArCollection(receivable));
    expect(write.body.amount).toBe("12000");
    expect(write.body.currency).toBe("CNY");
  });

  it("fails closed on missing id/amount/currency or non-positive amounts", () => {
    const receivable = suggestionsOf(
      readFixture("erp-ar-collection-plan.sample.json"),
    )[0]!;
    expect(
      normalizeErpArCollection({ ...receivable, receivable_id: undefined }),
    ).toEqual([]);
    expect(normalizeErpArCollection({ ...receivable, amount: undefined })).toEqual(
      [],
    );
    expect(normalizeErpArCollection({ ...receivable, amount: 0 })).toEqual([]);
    expect(normalizeErpArCollection({ ...receivable, currency: "EURO" })).toEqual(
      [],
    );
    expect(normalizeErpArCollection(undefined)).toEqual([]);
  });
});

describe("margin portfolio → MARGIN", () => {
  it("maps gross margin in order currency", () => {
    const row = rowsOf(readFixture("erp-margin-portfolio.sample.json"))[0]!;
    const write = single(normalizeErpMarginRow(row));

    expect(write.body).toMatchObject({
      sourceSystem: "ANARI_ERP",
      sourceRecordId: "MARGIN:77:SO-2026-0077",
      factType: "MARGIN",
      amount: "11000",
      currency: "EUR",
      qualityStatus: "VALID",
      recognitionStatus: "DRAFT",
      orderId: "SO-2026-0077",
    });
    expect(write.body.payload).toBe(row);
  });

  it("marks estimated margins UNVERIFIED", () => {
    const row = rowsOf(readFixture("erp-margin-portfolio.sample.json"))[1]!;
    expect(row.estimated).toBe(true);
    const write = single(normalizeErpMarginRow(row));
    expect(write.body.qualityStatus).toBe("UNVERIFIED");
    expect(write.body.amount).toBe("5400");
  });

  it("skips rows whose gross margin is null instead of writing zero", () => {
    const row = rowsOf(readFixture("erp-margin-portfolio.sample.json"))[2]!;
    expect(row.gross_margin).toBeNull();
    expect(normalizeErpMarginRow(row)).toEqual([]);
  });

  it("allows negative gross margin but not missing identity or currency", () => {
    const row = rowsOf(readFixture("erp-margin-portfolio.sample.json"))[0]!;
    const loss = single(normalizeErpMarginRow({ ...row, gross_margin: -1500.25 }));
    expect(loss.body.amount).toBe("-1500.25");

    expect(normalizeErpMarginRow({ ...row, order_number: undefined })).toEqual(
      [],
    );
    expect(normalizeErpMarginRow({ ...row, so_id: 0 })).toEqual([]);
    expect(normalizeErpMarginRow({ ...row, currency: "EU" })).toEqual([]);
    expect(normalizeErpMarginRow({})).toEqual([]);
  });
});
