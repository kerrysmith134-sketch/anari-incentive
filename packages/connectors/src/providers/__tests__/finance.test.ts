import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFinancialFactSchema } from "@anari/contracts";
import {
  FINANCE_API_KEY_ENV,
  FINANCE_BASE_URL_ENV,
  FINANCE_SOURCE_SYSTEM,
  FINANCIAL_FACTS_PATH,
  financeAuthHeaders,
  financeProvider,
  financeRecognitionStatus,
} from "../finance.js";
import type { CanonicalWrite, PullTarget } from "../types.js";

const fixturesDir = join(process.cwd(), "fixtures", "connectors");

const FIXTURES = {
  reports: "finance-reports.sample.json",
  payments: "finance-payments.sample.json",
  vouchers: "finance-vouchers.sample.json",
} as const;

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as unknown;
}

function recordsOf(json: unknown): Array<Record<string, unknown>> {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("fixture is missing data[]");
  return data as Array<Record<string, unknown>>;
}

const targetByPath = new Map(
  financeProvider.targets.map((entry) => [entry.path, entry]),
);

function target(path: string): PullTarget {
  const found = targetByPath.get(path);
  if (!found) throw new Error(`provider target ${path} not found`);
  return found;
}

function normalizeOne(entry: PullTarget, record: unknown): CanonicalWrite[] {
  const write = entry.normalize(record);
  return Array.isArray(write) ? write : [write];
}

function normalizeAll(path: string, json: unknown): CanonicalWrite[] {
  const entry = target(path);
  return entry
    .extract(json)
    .flatMap((record) => normalizeOne(entry, record));
}

describe("financeProvider metadata", () => {
  it("declares the baoxiao v1 read endpoints and env-based configuration", () => {
    expect(financeProvider.code).toBe("anari-finance");
    expect(financeProvider.sourceSystem).toBe("ANARI_BAOXIAO");
    expect(financeProvider.baseUrlEnv).toBe("ANARI_FINANCE_BASE_URL");
    expect(financeProvider.tokenEnv).toBe("ANARI_FINANCE_API_KEY");
    expect(financeProvider.baseUrlEnv).toBe(FINANCE_BASE_URL_ENV);
    expect(financeProvider.tokenEnv).toBe(FINANCE_API_KEY_ENV);
    expect(financeProvider.targets.map((entry) => entry.path)).toEqual([
      "/api/v1/reports",
      "/api/v1/payments",
      "/api/v1/vouchers",
    ]);
    for (const entry of financeProvider.targets) {
      expect(entry.method).toBe("GET");
    }
  });

  it("uses the Bearer header that requireApiKey reads", () => {
    const headers = financeAuthHeaders("anari_live_9f2c_deadbeef");
    expect(headers).toEqual({ Authorization: "Bearer anari_live_9f2c_deadbeef" });
    expect(headers["x-api-key"]).toBeUndefined();
    // server/lib/api-keys.js accepts only a Bearer value carrying the anari_ prefix;
    // a bare key (also via X-API-Key) is ignored and the request gets 401.
    expect(headers.Authorization).toMatch(/^Bearer anari_/);
    expect(() => financeAuthHeaders("sk-test-not-anari")).toThrow(/anari_/);
  });

  it("declares paging that matches the server's offset/limit handling", () => {
    const reports = target("/api/v1/reports");
    expect(reports.pageParam).toBe("offset");
    expect(reports.limitParam).toBe("limit");
    expect(reports.pageSize).toBe(50);
    const payments = target("/api/v1/payments");
    expect(payments.pageParam).toBe("offset");
    expect(payments.limitParam).toBe("limit");
    expect(payments.pageSize).toBe(50);
    // vouchers has no offset parameter, only limit (server clamps it to 1..200).
    const vouchers = target("/api/v1/vouchers");
    expect(vouchers.pageParam).toBeUndefined();
    expect(vouchers.limitParam).toBe("limit");
    expect(vouchers.pageSize).toBe(200);
  });
});

describe("expense reports", () => {
  it("maps a real reports response to EXPENSE_REPORT facts", () => {
    const json = readFixture(FIXTURES.reports);
    const records = recordsOf(json);
    const facts = normalizeAll("/api/v1/reports", json);

    expect(facts).toHaveLength(2);
    const first = facts[0]!;
    expect(first.path).toBe(FINANCIAL_FACTS_PATH);
    expect(first.externalId).toBe("rpt-2026-10-014");
    expect(first.body).toMatchObject({
      sourceSystem: FINANCE_SOURCE_SYSTEM,
      sourceRecordId: "rpt-2026-10-014",
      factType: "EXPENSE_REPORT",
      amount: "1250.5",
      currency: "CNY",
      periodStart: "2026-10-14",
      periodEnd: "2026-10-14",
      recognitionStatus: "DRAFT",
      qualityStatus: "UNVERIFIED",
    });
    expect(first.body.sourceUpdatedAt).toBe("2026-10-16T09:20:00.000Z");
    // “payload 保留原始”：整条来源记录原样投递。
    expect(first.body.payload).toEqual(records[0]);

    // 目标接口的请求契约就是 packages/contracts createFinancialFactSchema。
    expect(() => createFinancialFactSchema.parse(first.body)).not.toThrow();

    const second = facts[1]!;
    expect(second.body.amount).toBe("800"); // 整数金额不凭空补小数位
    expect(second.externalId).toBe("rpt-2026-10-021");
  });

  it("extracts each offset page independently", () => {
    const pageOne = readFixture(FIXTURES.reports);
    const all = recordsOf(pageOne);
    const pageTwo = {
      success: true,
      data: all.slice(1),
      meta: { limit: 50, offset: 50, count: 1 },
    };
    const facts = normalizeAll("/api/v1/reports", pageTwo);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.externalId).toBe("rpt-2026-10-021");
  });
});

describe("payments", () => {
  it("keeps PG numeric strings verbatim and defaults to the CNY ledger currency", () => {
    const json = readFixture(FIXTURES.payments);
    const records = recordsOf(json);
    const facts = normalizeAll("/api/v1/payments", json);

    expect(facts).toHaveLength(2);
    const first = facts[0]!;
    expect(first.body).toMatchObject({
      sourceSystem: FINANCE_SOURCE_SYSTEM,
      sourceRecordId: "pay_5f2a9c31",
      factType: "PAYMENT",
      amount: "1250.50", // 不四舍五入、不重算
      currency: "CNY", // 付款列表不返回币种；账本本位币为 CNY
      recognitionStatus: "DRAFT",
    });
    expect(first.body.payload).toEqual(records[0]);
    // 付款列表没有时间字段，不能拿创建时间冒充付款日。
    expect(first.body.periodStart).toBeUndefined();
    expect(first.body.periodEnd).toBeUndefined();
    expect(() => createFinancialFactSchema.parse(first.body)).not.toThrow();
  });

  it("accepts numeric amounts from the SQLite driver", () => {
    const [fact] = normalizeOne(target("/api/v1/payments"), {
      id: "pay_0a1b2c3d",
      refType: "report",
      refId: "rpt-2026-10-030",
      amount: 42.75,
      direction: "out",
      status: "paid",
      bankRef: null,
    });
    expect(fact!.body.amount).toBe("42.75");
    expect(fact!.body.currency).toBe("CNY");
  });

  it("keeps explicit source currencies and normalizes their case", () => {
    const [fact] = normalizeOne(target("/api/v1/payments"), {
      id: "pay_0a1b2c3e",
      amount: "10.00",
      currency: "usd",
      direction: "out",
      status: "paid",
    });
    expect(fact!.body.currency).toBe("USD");
  });
});

describe("accounting vouchers", () => {
  it("uses the voucher number as the stable id and the period as the date range", () => {
    const json = readFixture(FIXTURES.vouchers);
    const records = recordsOf(json);
    const facts = normalizeAll("/api/v1/vouchers", json);

    expect(facts).toHaveLength(2);
    const first = facts[0]!;
    expect(first.body).toMatchObject({
      sourceRecordId: "JV-2026-10-rpt-2026-10-014",
      factType: "VOUCHER",
      amount: "1250.5",
      currency: "CNY",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      accountingPeriod: "2026-10",
      recognitionStatus: "DRAFT",
    });
    expect(first.externalId).toBe("JV-2026-10-rpt-2026-10-014");
    expect(first.body.payload).toEqual(records[0]);
    expect(() => createFinancialFactSchema.parse(first.body)).not.toThrow();
  });

  it("falls back to the voucher id when voucherNo is missing", () => {
    const [fact] = normalizeOne(target("/api/v1/vouchers"), {
      id: "vch_4a1b9e2c7d31",
      period: "2026-02",
      amount: 100,
      currency: "CNY",
      status: "draft",
    });
    expect(fact!.body.sourceRecordId).toBe("vch_4a1b9e2c7d31");
    // 2026-02 has 28 days (UTC, no local-timezone drift).
    expect(fact!.body.periodStart).toBe("2026-02-01");
    expect(fact!.body.periodEnd).toBe("2026-02-28");
  });
});

describe("skips records that cannot become a valid fact", () => {
  const baseReport = recordsOf(readFixture(FIXTURES.reports))[0]!;
  const basePayment = recordsOf(readFixture(FIXTURES.payments))[0]!;

  it("skips reports without a stable id or a usable total", () => {
    const entry = target("/api/v1/reports");
    expect(normalizeOne(entry, { ...baseReport, id: "" })).toEqual([]);
    expect(normalizeOne(entry, { ...baseReport, totalCNY: undefined })).toEqual([]);
    expect(normalizeOne(entry, { ...baseReport, totalCNY: "1,250.50" })).toEqual([]);
    expect(normalizeOne(entry, { ...baseReport, totalCNY: Number.NaN })).toEqual([]);
  });

  it("skips payments with unusable amount or currency", () => {
    const entry = target("/api/v1/payments");
    expect(normalizeOne(entry, { ...basePayment, id: undefined })).toEqual([]);
    expect(normalizeOne(entry, { ...basePayment, amount: null })).toEqual([]);
    expect(normalizeOne(entry, { ...basePayment, amount: "-" })).toEqual([]);
    expect(normalizeOne(entry, { ...basePayment, currency: "CN" })).toEqual([]);
  });

  it("returns no write for non-object records", () => {
    expect(target("/api/v1/vouchers").normalize(null)).toEqual([]);
    expect(target("/api/v1/vouchers").normalize("vch_1")).toEqual([]);
    expect(target("/api/v1/vouchers").normalize([{ id: "vch_1" }])).toEqual([]);
  });

  it("throws on a broken envelope instead of reporting zero rows", () => {
    const entry = target("/api/v1/reports");
    expect(() => entry.extract({ success: false, error: "单据不存在" })).toThrow(
      /单据不存在/,
    );
    expect(() => entry.extract({ success: true })).toThrow(/data array/);
    expect(() => entry.extract(null)).toThrow(/JSON object/);
  });

  it("never emits undefined placeholders in the POST body", () => {
    const cases: Array<[string, string]> = [
      ["/api/v1/reports", FIXTURES.reports],
      ["/api/v1/payments", FIXTURES.payments],
      ["/api/v1/vouchers", FIXTURES.vouchers],
    ];
    for (const [path, file] of cases) {
      for (const fact of normalizeAll(path, readFixture(file))) {
        for (const [key, value] of Object.entries(fact.body)) {
          expect(value, `${path}.${key}`).not.toBeUndefined();
        }
        // JSON round-trip must be lossless for the HTTP call.
        expect(JSON.parse(JSON.stringify(fact.body))).toEqual(fact.body);
      }
    }
  });
});

describe("recognition status", () => {
  it("only marks POSTED when every accounting field required by the contract exists", () => {
    const entry = target("/api/v1/payments");
    const [base] = recordsOf(readFixture(FIXTURES.payments));
    const complete = {
      ...base,
      legalEntityId: "LE-CN-01",
      accountingPeriod: "2026-10",
      instrumentType: "PAYMENT",
      sourceVersion: "baoxiao-openapi-v1",
      orderId: "SO-2026-0001",
    };
    const [posted] = normalizeOne(entry, complete);
    expect(posted!.body.recognitionStatus).toBe("POSTED");
    expect(posted!.body).toMatchObject({
      legalEntityId: "LE-CN-01",
      instrumentType: "PAYMENT",
      sourceVersion: "baoxiao-openapi-v1",
      orderId: "SO-2026-0001",
    });
    expect(() => createFinancialFactSchema.parse(posted!.body)).not.toThrow();

    // 报销开放 API 不返回法人 → 即使期间齐全也只能是 DRAFT。
    const { legalEntityId: _omitted, ...withoutLegalEntity } = complete;
    const [draft] = normalizeOne(entry, withoutLegalEntity);
    expect(draft!.body.recognitionStatus).toBe("DRAFT");
    expect(draft!.body.legalEntityId).toBeUndefined();

    expect(
      financeRecognitionStatus({
        accountingPeriod: "2026-10",
        instrumentType: "PAYMENT",
        sourceVersion: "v1",
        orderId: "SO-1",
      }),
    ).toBe("DRAFT");
  });

  it("produces only bodies accepted by POST /api/v1/financial-facts", () => {
    const cases: Array<[string, string]> = [
      ["/api/v1/reports", FIXTURES.reports],
      ["/api/v1/payments", FIXTURES.payments],
      ["/api/v1/vouchers", FIXTURES.vouchers],
    ];
    for (const [path, file] of cases) {
      for (const fact of normalizeAll(path, readFixture(file))) {
        expect(fact.path).toBe(FINANCIAL_FACTS_PATH);
        const parsed = createFinancialFactSchema.parse(fact.body);
        expect(parsed.sourceSystem).toBe(FINANCE_SOURCE_SYSTEM);
        expect(parsed.recognitionStatus).toBe("DRAFT");
        expect(parsed.currency).toMatch(/^[A-Z]{3}$/);
        expect(parsed.amount).toMatch(/^-?\d+(\.\d+)?$/);
      }
    }
  });
});
