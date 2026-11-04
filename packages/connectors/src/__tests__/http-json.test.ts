import { describe, expect, it } from "vitest";
import {
  HttpJsonConnector,
  buildFeishuBitablePullConfig,
  buildHubspotSearchPullConfig,
} from "../index.js";

const records = [
  {
    id: "crm-1",
    event: "order.updated",
    subject_type: "WORK_PACKAGE",
    subject_id: "00000000-0000-4000-8000-000000000010",
    evidence_type: "ORDER",
    amount: 1000,
  },
  {
    id: "crm-2",
    event: "order.updated",
    subject_type: "WORK_PACKAGE",
    subject_id: "00000000-0000-4000-8000-000000000011",
    evidence_type: "ORDER",
    amount: 2000,
  },
];

function fakeFetch() {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("limit")).toBe("1");
    const cursor = url.searchParams.get("after");
    const start = cursor === "crm-1" ? 1 : 0;
    const page = records.slice(start, start + 1);
    const next = start + 1 < records.length ? records[start]!.id : null;
    return new Response(
      JSON.stringify({ data: page, meta: { nextCursor: next } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

describe("HTTP JSON connector", () => {
  it("maps pages and follows a configured cursor", async () => {
    const connector = new HttpJsonConnector({
      sourceSystem: "crm-rest",
      url: "https://crm.example/api/orders",
      columns: {
        sourceRecordId: "id",
        eventType: "event",
        subjectType: "subject_type",
        subjectId: "subject_id",
        evidenceType: "evidence_type",
      },
      recordsPath: "data",
      nextCursorPath: "meta.nextCursor",
      cursorParam: "after",
      pageSizeParam: "limit",
      pageSize: 1,
      fetchImpl: fakeFetch(),
    });

    const first = await connector.pull(null);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]!.sourceRecordId).toBe("crm-1");
    expect(first.events[0]!.payload.amount).toBe(1000);
    expect(first.nextCursor).toBe("crm-1");

    const second = await connector.pull(first.nextCursor);
    expect(second.events[0]!.sourceRecordId).toBe("crm-2");
    expect(second.nextCursor).toBeNull();
  });

  it("rejects an empty mapped identifier", async () => {
    const connector = new HttpJsonConnector({
      sourceSystem: "crm-rest",
      url: "https://crm.example/api/orders",
      columns: {
        sourceRecordId: "missing",
        eventType: "event",
        subjectType: "subject_type",
        subjectId: "subject_id",
        evidenceType: "evidence_type",
      },
      fetchImpl: (async () =>
        new Response(JSON.stringify([{ id: "x" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    await expect(connector.pull(null)).rejects.toThrow(
      "Mapped field sourceRecordId",
    );
  });
});

describe("provider pull presets", () => {
  const columns = {
    sourceRecordId: "id",
    eventType: "eventType",
    subjectType: "subjectType",
    subjectId: "subjectId",
    evidenceType: "evidenceType",
  };

  it("pulls HubSpot search pages with a POST body cursor", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        after?: number;
      };
      const page = body.after ? 1 : 0;
      return new Response(
        JSON.stringify({
          results:
            page === 0
              ? [{ id: "deal-1", eventType: "deal.won", subjectType: "ORDER", subjectId: "order-1", evidenceType: "ORDER" }]
              : [{ id: "deal-2", eventType: "deal.won", subjectType: "ORDER", subjectId: "order-2", evidenceType: "ORDER" }],
          paging:
            page === 0 ? { next: { after: 100 } } : undefined,
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const config = buildHubspotSearchPullConfig({
      accessToken: "pat-token",
      objectType: "deals",
      properties: ["dealname", "amount"],
      columns,
      fetchImpl,
    });
    const connector = new HttpJsonConnector(config);
    const first = await connector.pull(null);
    expect(first.events).toHaveLength(1);
    expect(first.nextCursor).toBe("100");
    const second = await connector.pull(first.nextCursor);
    expect(second.events).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    expect(calls[0]!.init.method).toBe("POST");
    const sentBody = JSON.parse(String(calls[1]!.init.body)) as Record<string, unknown>;
    expect(sentBody.after).toBe("100");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer pat-token");
  });

  it("pulls Feishu bitable records with page_token pagination", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: URL | string) => {
      urls.push(String(url));
      const hasMore = String(url).includes("page_token=");
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            items: hasMore
              ? [{ id: "rec-2", eventType: "record.changed", subjectType: "WORK_PACKAGE", subjectId: "wp-2", evidenceType: "DELIVERABLE" }]
              : [{ id: "rec-1", eventType: "record.changed", subjectType: "WORK_PACKAGE", subjectId: "wp-1", evidenceType: "DELIVERABLE" }],
            has_more: !hasMore,
            page_token: hasMore ? undefined : "token-2",
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const config = buildFeishuBitablePullConfig({
      tenantAccessToken: "t-token",
      appToken: "app-1",
      tableId: "tbl-1",
      columns,
      fetchImpl,
    });
    const connector = new HttpJsonConnector(config);
    const first = await connector.pull(null);
    expect(first.events).toHaveLength(1);
    expect(first.nextCursor).toBe("token-2");
    const second = await connector.pull("token-2");
    expect(second.events).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(urls[1]).toContain("page_token=token-2");
    expect(urls[0]).toContain("page_size=100");
  });
});
