import { describe, expect, it } from "vitest";
import { CsvConnector, parseCsv } from "../index.js";

const csv = `order_id,event,subject_type,subject_id,evidence_type,amount,note
order-1,order.updated,WORK_PACKAGE,00000000-0000-4000-8000-000000000010,ORDER,1000,"won, pending"
order-2,order.updated,WORK_PACKAGE,00000000-0000-4000-8000-000000000011,ORDER,2000,"said ""ok"""`;

describe("CSV connector", () => {
  it("parses quoted fields", () => {
    const rows = parseCsv(csv);
    expect(rows[1]![6]).toBe("won, pending");
    expect(rows[2]![6]).toBe('said "ok"');
  });

  it("normalizes rows into ingestion events with pagination", async () => {
    const connector = new CsvConnector(csv, {
      sourceSystem: "crm",
      pageSize: 1,
      columns: {
        sourceRecordId: "order_id",
        eventType: "event",
        subjectType: "subject_type",
        subjectId: "subject_id",
        evidenceType: "evidence_type",
      },
    });
    const first = await connector.pull(null);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]!.sourceRecordId).toBe("order-1");
    expect(first.events[0]!.payload.amount).toBe("1000");
    expect(first.nextCursor).toBe("1");

    const second = await connector.pull(first.nextCursor);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]!.sourceRecordId).toBe("order-2");
    expect(second.nextCursor).toBeNull();
  });
});
