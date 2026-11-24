import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ColumnMapping } from "../mapping.js";
import { mapRecordToEvent } from "../mapping.js";
import { FIELD_MAPPING_PRESETS } from "../presets.js";
import { HttpJsonConnector } from "../http-json.js";
import { parseFinancialFact } from "../sync-runner.js";

const root = process.cwd();

function readSample(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, "fixtures", "connectors", name), "utf8"),
  ) as Record<string, unknown>;
}

function columnsFor(code: string): ColumnMapping {
  const preset = FIELD_MAPPING_PRESETS.find((entry) => entry.code === code);
  if (!preset) throw new Error(`preset ${code} not found`);
  return {
    sourceRecordId: preset.fieldMap.sourceRecordId!,
    eventType: preset.fieldMap.eventType!,
    subjectType: preset.fieldMap.subjectType!,
    subjectId: preset.fieldMap.subjectId!,
    evidenceType: preset.fieldMap.evidenceType!,
    occurredAt: preset.fieldMap.occurredAt,
    sourceUpdatedAt: preset.fieldMap.sourceUpdatedAt,
  };
}

describe("sanitized provider contract samples", () => {
  it("maps a HubSpot deal as an OPPORTUNITY, never as an ORDER", () => {
    const sample = readSample("hubspot-deals.sample.json");
    const record = (sample.results as Array<Record<string, unknown>>)[0]!;
    const event = mapRecordToEvent(record, columnsFor("hubspot-deals"));
    expect(event.subjectType).toBe("OPPORTUNITY");
    expect(event.evidenceType).toBe("CRM_DEAL");
    expect(event.occurredAt).toBe("2026-10-12T08:00:00.000Z");
    expect(event.sourceUpdatedAt).toBe("2026-10-20T09:30:00.000Z");
  });

  it("maps Feishu Bitable records with sourceUpdatedAt separate from occurredAt", () => {
    const sample = readSample("feishu-bitable.sample.json");
    const items = (sample.data as { items: Array<Record<string, unknown>> }).items;
    const event = mapRecordToEvent(items[0]!, columnsFor("feishu-bitable"));
    expect(event.sourceRecordId).toBe("rec_sanitized_001");
    expect(event.occurredAt).toBe("2026-10-01T00:00:00.000Z");
    expect(event.sourceUpdatedAt).toBe("2026-10-21T02:03:04.000Z");
  });

  it("maps ERP orders as evidence with an incremental update field", () => {
    const sample = readSample("erp-orders.sample.json");
    const record = (sample.records as Array<Record<string, unknown>>)[0]!;
    const event = mapRecordToEvent(record, columnsFor("erp-orders"));
    expect(event.subjectType).toBe("ORDER");
    expect(event.evidenceType).toBe("ERP_ORDER");
    expect(event.sourceUpdatedAt).toBe("2026-10-22T11:22:33.000Z");
  });
});

describe("HTTP connector fault injection", () => {
  const config = {
    sourceSystem: "contract-test",
    url: "https://provider.example/api/records",
    columns: columnsFor("erp-orders"),
  };

  it("retries 500 and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("boom", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          records: [
            {
              order_id: "SO-1",
              event_type: "order.confirmed",
              occurred_at: "2026-10-02T00:00:00.000Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const connector = new HttpJsonConnector({ ...config, fetchImpl });
    const result = await connector.pull(null);
    expect(calls).toBe(2);
    expect(result.events).toHaveLength(1);
  });

  it("fails 401 without retrying (token refresh belongs to the runner)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401 });
    }) as typeof fetch;
    const connector = new HttpJsonConnector({ ...config, fetchImpl });
    await expect(connector.pull(null)).rejects.toThrow(/failed: 401/);
    expect(calls).toBe(1);
  });

  it("fails when recordsPath is missing or not an array", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const connector = new HttpJsonConnector({ ...config, fetchImpl });
    await expect(connector.pull(null)).rejects.toThrow(/records not found/);
  });

  it("fails closed on a non-object record", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ records: ["not-an-object"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const connector = new HttpJsonConnector({ ...config, fetchImpl });
    await expect(connector.pull(null)).rejects.toThrow(/not an object/);
  });
});

describe("financial fact typed parsing", () => {
  const base = {
    sourceRecordId: "FACT-1",
    evidenceType: "REVENUE",
    payload: { amount: "100.00", currency: "usd" },
  };

  it("accepts DRAFT facts for pre-accounting evidence", () => {
    const parsed = parseFinancialFact(base);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.recognitionStatus).toBe("DRAFT");
    expect(parsed.currency).toBe("USD");
  });

  it("rejects POSTED facts missing legal entity/period/instrument/version", () => {
    const parsed = parseFinancialFact({
      ...base,
      payload: {
        ...base.payload,
        recognitionStatus: "POSTED",
      },
    });
    expect("error" in parsed).toBe(true);
    if ("error" in parsed) {
      expect(parsed.error).toContain("POSTED requires");
      expect(parsed.reason).toBe("SCHEMA_MISMATCH");
    }
  });

  it("accepts POSTED facts with full accounting semantics", () => {
    const parsed = parseFinancialFact({
      ...base,
      payload: {
        ...base.payload,
        recognitionStatus: "POSTED",
        legalEntityId: "LE-1",
        accountingPeriod: "2026-10",
        instrumentType: "INVOICE",
        sourceVersion: "v1",
        orderId: "SO-1",
        fxSnapshot: {
          rate: "7.1",
          quoteCurrency: "CNY",
          source: "ecb",
          asOf: "2026-10-31T00:00:00.000Z",
        },
      },
    });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.legalEntityId).toBe("LE-1");
    expect(parsed.accountingPeriod).toBe("2026-10");
    expect(parsed.instrumentType).toBe("INVOICE");
    expect(parsed.fxSnapshot?.quoteCurrency).toBe("CNY");
  });

  it("requires PAYMENT facts to reference order or contract", () => {
    const parsed = parseFinancialFact({
      ...base,
      payload: {
        ...base.payload,
        instrumentType: "PAYMENT",
      },
    });
    expect("error" in parsed).toBe(true);
    if ("error" in parsed) expect(parsed.error).toContain("PAYMENT requires");
  });
});
