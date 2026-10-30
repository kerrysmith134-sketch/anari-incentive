import { describe, expect, it } from "vitest";
import type { SettlementBatch, SettlementLine } from "@anari/domain";
import { settlementCsv } from "../store.js";

describe("settlement CSV", () => {
  it("neutralises spreadsheet formulas without corrupting negative amounts", () => {
    const batch: SettlementBatch = {
      id: "10000000-0000-4000-8000-000000000001",
      tenantId: "10000000-0000-4000-8000-000000000002",
      cycleId: "10000000-0000-4000-8000-000000000003",
      batchNo: "=cmd|' /C calc'!A0",
      status: "EXPORTED",
      kind: "STANDARD",
      currency: "CNY",
      totalAmount: "-100",
      lineCount: 1,
      createdAt: "2026-10-30T00:00:00.000Z",
      updatedAt: "2026-10-30T00:00:00.000Z",
    };
    const line: SettlementLine = {
      id: "10000000-0000-4000-8000-000000000004",
      tenantId: batch.tenantId,
      batchId: batch.id,
      ledgerId: "10000000-0000-4000-8000-000000000005",
      personId: "10000000-0000-4000-8000-000000000006",
      personCode: "+E001",
      personName: "=HYPERLINK(\"https://example.invalid\")",
      amount: "-100",
      currency: "CNY",
      status: "ACTIVE",
      active: true,
      createdAt: "2026-10-30T00:00:00.000Z",
    };

    const csv = settlementCsv(batch, [line]);
    expect(csv).toContain("'=cmd|' /C calc'!A0");
    expect(csv).toContain("'+E001");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain(",-100,CNY");
  });
});
