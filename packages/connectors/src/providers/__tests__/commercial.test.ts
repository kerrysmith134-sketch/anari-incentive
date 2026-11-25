import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  importCommercialAccountSchema,
  importCommercialOrderSchema,
  importCommercialQuoteSchema,
} from "@anari/contracts";
import {
  commercialProvider,
  extractCommercialNextCursor,
  extractCommercialRecords,
  normalizeCommercialAccount,
  normalizeCommercialOrder,
  normalizeCommercialQuote,
} from "../commercial.js";
import type { CanonicalWrite, PullTarget } from "../types.js";

const root = process.cwd();

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(root, "fixtures", "connectors", name), "utf8"),
  ) as unknown;
}

const customersJson = readFixture("commercial-customers.sample.json");
const quotesJson = readFixture("commercial-quotes.sample.json");
const ordersJson = readFixture("commercial-orders.sample.json");

const customerRecords = extractCommercialRecords(customersJson);
const quoteRecords = extractCommercialRecords(quotesJson);
const orderRecords = extractCommercialRecords(ordersJson);

function targetFor(path: string): PullTarget {
  const target = commercialProvider.targets.find((entry) => entry.path === path);
  if (!target) throw new Error(`target ${path} not found`);
  return target;
}

function asWrite(
  result: CanonicalWrite | CanonicalWrite[],
): CanonicalWrite {
  if (Array.isArray(result)) {
    if (result.length !== 1) {
      throw new Error(`expected one write, got ${result.length}`);
    }
    return result[0]!;
  }
  return result;
}

function writesOf(
  result: CanonicalWrite | CanonicalWrite[],
): CanonicalWrite[] {
  return Array.isArray(result) ? result : [result];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected an object fixture record");
  }
  return value as Record<string, unknown>;
}

describe("ANARI Commercial provider metadata", () => {
  it("declares the real endpoints, env vars, and page/limit paging", () => {
    expect(commercialProvider.code).toBe("anari-commercial");
    expect(commercialProvider.sourceSystem).toBe("ANARI_COMMERCIAL");
    expect(commercialProvider.baseUrlEnv).toBe("ANARI_COMMERCIAL_BASE_URL");
    expect(commercialProvider.tokenEnv).toBe("ANARI_COMMERCIAL_TOKEN");
    expect(commercialProvider.targets.map((target) => target.path)).toEqual([
      "/api/v1/customers",
      // 真实路由是 /quotations，不是 /quotes。
      "/api/v1/quotations",
      "/api/v1/orders",
    ]);
    for (const target of commercialProvider.targets) {
      expect(target.method).toBe("GET");
      expect(target.pageParam).toBe("page");
      expect(target.limitParam).toBe("limit");
      expect(target.pageSize).toBe(100);
    }
  });
});

describe("Commercial envelope extraction", () => {
  it("extracts {success,data,meta} records", () => {
    expect(customerRecords).toHaveLength(2);
    expect(quoteRecords).toHaveLength(2);
    expect(orderRecords).toHaveLength(1);
  });

  it("reads meta.next_cursor and tolerates a null cursor", () => {
    expect(extractCommercialNextCursor(customersJson)).toBe(
      "eyJ1cGRhdGVkX2F0IjoiMjAyNi0xMS0yMFQxMDoyMDozMCswMDowMCIsImlkIjoiMjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyIn0=",
    );
    expect(extractCommercialNextCursor(quotesJson)).toBeNull();
    expect(extractCommercialNextCursor(ordersJson)).toBeNull();
  });

  it("fails loudly when the records array is missing", () => {
    expect(() =>
      extractCommercialRecords({ success: true, data: { id: "x" } }),
    ).toThrow(/records array/);
  });
});

describe("customer → /api/v1/commercial/import/accounts", () => {
  it("maps the real customer JSON, including a UUID owner", () => {
    const write = asWrite(
      targetFor("/api/v1/customers").normalize(customerRecords[0]),
    );
    expect(write.path).toBe("/api/v1/commercial/import/accounts");
    expect(write.externalId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(write.body).toEqual({
      sourceSystem: "ANARI_COMMERCIAL",
      externalAccountId: "11111111-1111-4111-8111-111111111111",
      name: "Nordic Charge Partner AB",
      ownerPersonId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(importCommercialAccountSchema.safeParse(write.body).success).toBe(
      true,
    );
  });

  it("omits ownerPersonId when the source owner is null", () => {
    const write = asWrite(
      targetFor("/api/v1/customers").normalize(customerRecords[1]),
    );
    expect(write.body).toEqual({
      sourceSystem: "ANARI_COMMERCIAL",
      externalAccountId: "22222222-2222-4222-8222-222222222222",
      name: "Iberia Fleet Solutions SL",
    });
    expect(write.body).not.toHaveProperty("ownerPersonId");
    expect(importCommercialAccountSchema.safeParse(write.body).success).toBe(
      true,
    );
  });

  it("omits a non-UUID owner instead of forwarding an invalid person id", () => {
    const direct = normalizeCommercialAccount({
      id: "55555555-5555-4555-8555-555555555555",
      name: "Legacy Owner Ltd",
      owner_id: "not-a-uuid",
    });
    const write = asWrite(direct);
    expect(write.body).not.toHaveProperty("ownerPersonId");
  });

  it("skips records missing the external account id or name", () => {
    expect(normalizeCommercialAccount({ name: "No id" })).toEqual([]);
    expect(
      normalizeCommercialAccount({
        id: "55555555-5555-4555-8555-555555555555",
      }),
    ).toEqual([]);
  });
});

describe("quote → /api/v1/commercial/import/quotes", () => {
  it("derives a customer-level opportunity for real quotes without one", () => {
    const quote = asRecord(quoteRecords[0]);
    expect(quote.customer_id).toBeTruthy();
    expect(quote).not.toHaveProperty("opportunity_id");
    const writes = writesOf(normalizeCommercialQuote(quote));
    expect(writes.map((write) => write.path)).toEqual([
      "/api/v1/commercial/import/accounts",
      "/api/v1/commercial/import/opportunities",
      "/api/v1/commercial/import/quotes",
    ]);
    expect(writes[2]!.body.externalOpportunityId).toBe(
      `CUST-${String(quote.customer_id)}`,
    );
  });

  it("maps when an explicit opportunity_id is present (no customer_id fallback)", () => {
    const sent = {
      ...asRecord(quoteRecords[0]),
      opportunity_id: "99999999-9999-4999-8999-999999999999",
    };
    const write = asWrite(normalizeCommercialQuote(sent));
    expect(write.path).toBe("/api/v1/commercial/import/quotes");
    expect(write.externalId).toBe("33333333-3333-4333-8333-333333333333");
    expect(write.body).toEqual({
      sourceSystem: "ANARI_COMMERCIAL",
      externalOpportunityId: "99999999-9999-4999-8999-999999999999",
      externalQuoteId: "33333333-3333-4333-8333-333333333333",
      currency: "USD",
      amount: "48000.00",
      status: "ISSUED",
    });
    // created_at 是草稿创建时间，不得伪装成 issuedAt。
    expect(write.body).not.toHaveProperty("issuedAt");
    expect(importCommercialQuoteSchema.safeParse(write.body).success).toBe(
      true,
    );
  });

  it("normalizes acceptedAt to the UTC Z form required by the import contract", () => {
    const accepted = {
      ...asRecord(quoteRecords[1]),
      opportunity_id: "99999999-9999-4999-8999-999999999999",
    };
    const write = asWrite(normalizeCommercialQuote(accepted));
    expect(write.body).toMatchObject({
      externalQuoteId: "33333333-3333-4333-8333-333333333334",
      currency: "USD",
      // total_original（成交币种），不是 total_usd。
      amount: "60800.00",
      status: "ACCEPTED",
      acceptedAt: "2026-11-19T10:00:00.000Z",
    });
    expect(importCommercialQuoteSchema.safeParse(write.body).success).toBe(
      true,
    );
  });

  it("skips when the amount cannot be expressed in the document currency", () => {
    const eurWithoutOriginal = {
      ...asRecord(quoteRecords[0]),
      opportunity_id: "99999999-9999-4999-8999-999999999999",
      currency: "EUR",
      total_original: null,
    };
    expect(normalizeCommercialQuote(eurWithoutOriginal)).toEqual([]);
  });
});

describe("order → /api/v1/commercial/import/orders", () => {
  it("derives quote/contract parents for real orders without one", () => {
    const order = asRecord(orderRecords[0]);
    expect(order.quotation_id).toBeTruthy();
    expect(order).not.toHaveProperty("contract_id");
    const writes = writesOf(normalizeCommercialOrder(order));
    expect(writes.map((write) => write.path)).toEqual([
      "/api/v1/commercial/import/accounts",
      "/api/v1/commercial/import/opportunities",
      "/api/v1/commercial/import/quotes",
      "/api/v1/commercial/import/contracts",
      "/api/v1/commercial/import/orders",
    ]);
    expect(writes[3]!.body.status).toBe("SIGNED");
    expect(writes[4]!.body.externalContractId).toBe(
      `CONTRACT-${String(order.quotation_id)}`,
    );
  });

  it("maps header and lines when an explicit contract_id is present", () => {
    const order = {
      ...asRecord(orderRecords[0]),
      contract_id: "99999999-9999-4999-8999-999999999998",
    };
    const write = asWrite(normalizeCommercialOrder(order));
    expect(write.path).toBe("/api/v1/commercial/import/orders");
    expect(write.externalId).toBe("44444444-4444-4444-8444-444444444444");
    expect(write.body).toEqual({
      sourceSystem: "ANARI_COMMERCIAL",
      externalOrderId: "44444444-4444-4444-8444-444444444444",
      externalContractId: "99999999-9999-4999-8999-999999999998",
      orderNumber: "AN-O-2026-0031",
      currency: "USD",
      // in_production 在 N-Perform 只有三态时仍是 CONFIRMED（非取消）。
      status: "CONFIRMED",
      lines: [
        {
          kind: "PRODUCT",
          description: "AC Charger 22kW",
          quantity: "10",
          unitPrice: "1200.00",
          amount: "12000.00",
          currency: "USD",
        },
        {
          kind: "PRODUCT",
          description: "DC Fast Charger 120kW",
          quantity: "2",
          unitPrice: "30400.00",
          amount: "60800.00",
          currency: "USD",
        },
      ],
    });
    expect(importCommercialOrderSchema.safeParse(write.body).success).toBe(
      true,
    );
  });

  it("maps cancelled orders to CANCELLED", () => {
    const cancelled = {
      ...asRecord(orderRecords[0]),
      contract_id: "99999999-9999-4999-8999-999999999998",
      status: "cancelled",
    };
    const write = asWrite(normalizeCommercialOrder(cancelled));
    expect(write.body.status).toBe("CANCELLED");
    expect(importCommercialOrderSchema.safeParse(write.body).success).toBe(
      true,
    );
  });

  it("skips a line where quantity × unitPrice cannot equal amount", () => {
    // N-Perform rejects this at import (ORDER_LINE_AMOUNT_MISMATCH); 33.33×3
    // = 99.99 ≠ 100.00 and 100/3 is not exact, so the line must not be emitted.
    const roundedUnitPrice = {
      ...asRecord(orderRecords[0]),
      contract_id: "99999999-9999-4999-8999-999999999998",
      items: [
        {
          product_name: "Rounded price item",
          quantity: 3,
          discounted_price_usd: "33.33",
          total_usd: "100.00",
        },
      ],
    };
    expect(normalizeCommercialOrder(roundedUnitPrice)).toEqual([]);
  });

  it("skips an order whose lines cannot be priced", () => {
    const emptyItems = {
      ...asRecord(orderRecords[0]),
      contract_id: "99999999-9999-4999-8999-999999999998",
      items: [{ quantity: 3 }],
    };
    expect(normalizeCommercialOrder(emptyItems)).toEqual([]);

    const eurWithOnlyUsdLines = {
      ...asRecord(orderRecords[0]),
      contract_id: "99999999-9999-4999-8999-999999999998",
      currency: "EUR",
    };
    expect(normalizeCommercialOrder(eurWithOnlyUsdLines)).toEqual([]);
  });
});
