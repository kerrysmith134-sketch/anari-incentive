import { describe, expect, it } from "vitest";
import { HttpJsonConnector } from "../index.js";

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
