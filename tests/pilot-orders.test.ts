import { describe, expect, it } from "vitest";
import {
  parsePilotOrdersCsv,
  planPilotOrderImports,
  type ExistingPilotFinancialFact,
} from "../scripts/pilot-orders.js";

const HEADER =
  "order_id,title,objective,owner_employee_code,participants,gross_profit,currency,period_start,period_end";
const ROW =
  'SO-001,"Overseas charger order","Sales and delivery",E001,"E001:OWNER|E002:CONTRIBUTOR",128000.500000,cny,2026-10-01,2026-10-31';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("pilot order import preflight", () => {
  it("strips a UTF-8 BOM and normalises currency and roles", () => {
    const [order] = parsePilotOrdersCsv("\uFEFF" + csv(ROW));
    expect(order?.orderId).toBe("SO-001");
    expect(order?.currency).toBe("CNY");
    expect(order?.participants).toEqual([
      { employeeCode: "E001", role: "OWNER" },
      { employeeCode: "E002", role: "CONTRIBUTOR" },
    ]);
  });

  it("adds the declared owner when omitted from the participant list", () => {
    const row =
      'SO-002,"Battery project","Delivery",E001,"E002:CONTRIBUTOR",10.25,USD,2026-10-01,2026-10-31';
    expect(parsePilotOrdersCsv(csv(row))[0]?.participants[0]).toEqual({
      employeeCode: "E001",
      role: "OWNER",
    });
  });

  it("rejects duplicate headers and duplicate order ids before any import", () => {
    expect(() => parsePilotOrdersCsv(HEADER + ",ORDER_ID\n" + ROW))
      .toThrow(/duplicate header/i);
    expect(() => parsePilotOrdersCsv(csv(ROW, ROW)))
      .toThrow(/duplicate order_id/i);
  });

  it("rejects malformed row width, missing values and invalid financial dimensions", () => {
    expect(() => parsePilotOrdersCsv(csv(ROW + ",unexpected")))
      .toThrow(/field\(s\)/);
    expect(() =>
      parsePilotOrdersCsv(
        csv('SO-003,"x","y",E001,"E001:OWNER",1.1234567,CNY,2026-10-01,2026-10-31'),
      ),
    ).toThrow(/6 decimal places/i);
    expect(() =>
      parsePilotOrdersCsv(
        csv('SO-004,"x","y",E001,"E001:OWNER",1,US,2026-10-01,2026-10-31'),
      ),
    ).toThrow(/3-letter ISO currency/i);
    expect(() =>
      parsePilotOrdersCsv(
        csv('SO-005,"x","y",E001,"E001:OWNER",1,CNY,2026-02-30,2026-10-31'),
      ),
    ).toThrow(/valid YYYY-MM-DD/i);
    expect(() =>
      parsePilotOrdersCsv(
        csv('SO-006,"x","y",E001,"E001:OWNER",1,CNY,2026-11-01,2026-10-31'),
      ),
    ).toThrow(/must not be after/i);
  });

  it("rejects duplicate members and inconsistent owner role", () => {
    expect(() =>
      parsePilotOrdersCsv(
        csv('SO-007,"x","y",E001,"E001:OWNER|E001:CONTRIBUTOR",1,CNY,2026-10-01,2026-10-31'),
      ),
    ).toThrow(/duplicate participant/i);
    expect(() =>
      parsePilotOrdersCsv(
        csv('SO-008,"x","y",E001,"E001:CONTRIBUTOR",1,CNY,2026-10-01,2026-10-31'),
      ),
    ).toThrow(/must have role OWNER/i);
  });

  it("plans both resources, repairs either missing side, then skips only a complete order", () => {
    const [order] = parsePilotOrdersCsv(csv(ROW));
    if (!order) throw new Error("test order missing");
    const fact: ExistingPilotFinancialFact = {
      sourceRecordId: order.orderId,
      amount: "128000.5",
      currency: "CNY",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      orderId: order.orderId,
      qualityStatus: "VALID",
      payload: { orderId: order.orderId, cycleId: "cycle-1" },
    };

    expect(planPilotOrderImports([order], [], [], "cycle-1").map((item) => item.action))
      .toEqual(["CREATE_BOTH"]);
    expect(
      planPilotOrderImports([order], ["试点订单 SO-001"], [], "cycle-1").map((item) => item.action),
    ).toEqual(["CREATE_FINANCIAL_FACT"]);
    expect(
      planPilotOrderImports([order], [], [fact], "cycle-1").map((item) => item.action),
    ).toEqual(["CREATE_WORK_PACKAGE"]);
    expect(
      planPilotOrderImports([order], ["试点订单 SO-001"], [fact], "cycle-1").map((item) => item.action),
    ).toEqual(["SKIP"]);
  });

  it("refuses to silently revise an existing fact with a changed amount or period", () => {
    const [order] = parsePilotOrdersCsv(csv(ROW));
    if (!order) throw new Error("test order missing");
    expect(() =>
      planPilotOrderImports(
        [order],
        ["试点订单 SO-001"],
        [{ sourceRecordId: order.orderId, amount: "128000.51", currency: "CNY", periodStart: "2026-10-01", periodEnd: "2026-10-31", orderId: order.orderId, qualityStatus: "VALID", payload: { orderId: order.orderId, cycleId: "cycle-1" } }],
        "cycle-1",
      ),
    ).toThrow(/controlled finance correction/i);
  });

  it("fails closed on ambiguous duplicate persistent state", () => {
    const [order] = parsePilotOrdersCsv(csv(ROW));
    if (!order) throw new Error("test order missing");
    expect(() =>
      planPilotOrderImports([order], ["试点订单 SO-001", "试点订单 SO-001"], [], "cycle-1"),
    ).toThrow(/multiple work packages/i);
    expect(() =>
      planPilotOrderImports(
        [order],
        [],
        [
          { sourceRecordId: order.orderId, amount: order.grossProfit, currency: order.currency, periodStart: order.periodStart, periodEnd: order.periodEnd, orderId: order.orderId, qualityStatus: "VALID", payload: { orderId: order.orderId, cycleId: "cycle-1" } },
          { sourceRecordId: order.orderId, amount: order.grossProfit, currency: order.currency, periodStart: order.periodStart, periodEnd: order.periodEnd, orderId: order.orderId, qualityStatus: "VALID", payload: { orderId: order.orderId, cycleId: "cycle-1" } },
        ],
        "cycle-1",
      ),
    ).toThrow(/multiple PILOT_IMPORT financial facts/i);
  });
});
