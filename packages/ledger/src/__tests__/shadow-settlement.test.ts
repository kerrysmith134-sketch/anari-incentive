import { describe, expect, it } from "vitest";
import { compareShadowSettlement } from "../shadow-settlement.js";

const engine = [
  { personKey: "E001", amount: "6000.00", currency: "CNY" },
  { personKey: "E002", amount: "4000.00", currency: "CNY" },
];

describe("shadow settlement comparison", () => {
  it("reports a clean match with totals and a hash", () => {
    const report = compareShadowSettlement(engine, [
      { personKey: "E001", amount: "6000", currency: "cny" },
      { personKey: "E002", amount: "4000.00", currency: "CNY" },
    ]);
    expect(report.withinTolerance).toBe(true);
    expect(report.counts).toEqual({
      matched: 2,
      variances: 0,
      missingInFinance: 0,
      missingInEngine: 0,
    });
    expect(report.totals).toEqual({
      engine: "10000",
      finance: "10000",
      variance: "0",
    });
    expect(report.rows.every((row) => row.status === "MATCH")).toBe(true);
    expect(report.reportHash).toMatch(/^sha256:/);
  });

  it("accepts a variance inside the absolute tolerance", () => {
    const report = compareShadowSettlement(
      engine,
      [
        { personKey: "E001", amount: "5995", currency: "CNY" },
        { personKey: "E002", amount: "4005", currency: "CNY" },
      ],
      { tolerance: "5" },
    );
    expect(report.withinTolerance).toBe(true);
    expect(report.counts.matched).toBe(2);
    expect(report.rows[0]?.variance).toBe("-5");
  });

  it("flags a variance outside the tolerance with a signed delta", () => {
    const report = compareShadowSettlement(
      engine,
      [
        { personKey: "E001", amount: "6000", currency: "CNY" },
        { personKey: "E002", amount: "3900", currency: "CNY" },
      ],
      { tolerance: "10" },
    );
    expect(report.withinTolerance).toBe(false);
    expect(report.counts.variances).toBe(1);
    expect(report.rows[1]).toMatchObject({
      personKey: "E002",
      engine: "4000",
      finance: "3900",
      variance: "-100",
      status: "VARIANCE",
    });
    expect(report.totals.variance).toBe("-100");
  });

  it("flags rows missing on either side", () => {
    const report = compareShadowSettlement(engine, [
      { personKey: "E001", amount: "6000", currency: "CNY" },
      { personKey: "E003", amount: "50", currency: "CNY" },
    ]);
    expect(report.withinTolerance).toBe(false);
    expect(report.counts).toEqual({
      matched: 1,
      variances: 0,
      missingInFinance: 1,
      missingInEngine: 1,
    });
    expect(
      report.rows.find((row) => row.personKey === "E002")?.status,
    ).toBe("MISSING_IN_FINANCE");
    expect(
      report.rows.find((row) => row.personKey === "E003")?.status,
    ).toBe("MISSING_IN_ENGINE");
    expect(report.totals.variance).toBe("-3950");
  });

  it("keeps currencies separate and aggregates duplicate lines", () => {
    const report = compareShadowSettlement(
      [
        { personKey: "E001", amount: "100", currency: "CNY" },
        { personKey: "E001", amount: "50", currency: "CNY" },
        { personKey: "E001", amount: "10", currency: "USD" },
      ],
      [
        { personKey: "E001", amount: "150", currency: "CNY" },
        { personKey: "E001", amount: "10", currency: "USD" },
      ],
    );
    expect(report.withinTolerance).toBe(true);
    expect(report.rows).toHaveLength(2);
    expect(report.rows.map((row) => row.currency)).toEqual(["CNY", "USD"]);
    expect(report.totals.engine).toBe("160");
  });

  it("rejects a negative tolerance", () => {
    expect(() =>
      compareShadowSettlement(engine, engine, { tolerance: "-1" }),
    ).toThrow(/tolerance/);
  });
});
