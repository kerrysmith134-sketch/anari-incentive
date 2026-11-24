/**
 * 2026-11-21 审计：影子结算不能只按 personKey + currency 聚合，
 * 否则不同法人 / 会计期间 / 订单 / 发放批次的差异会被净额抵消。
 * 本文件同时锁定旧输入（无维度字段）的 reportHash 稳定性。
 */
import { describe, expect, it } from "vitest";
import {
  compareShadowSettlement,
  type ShadowSettlementLine,
} from "../shadow-settlement.js";

const GENERATED_AT = "2026-11-21T00:00:00.000Z";

function line(
  personKey: string,
  amount: string,
  currency: string,
  dimensions: Partial<ShadowSettlementLine> = {},
): ShadowSettlementLine {
  return { personKey, amount, currency, ...dimensions };
}

describe("shadow settlement dimensions", () => {
  it("同一人同币种、不同 legalEntity 不合并", () => {
    const engine = [
      line("E001", "60", "CNY", { legalEntity: "ANARI-CN" }),
      line("E001", "40", "CNY", { legalEntity: "ANARI-HK" }),
    ];
    const finance = [
      line("E001", "60", "CNY", { legalEntity: "ANARI-CN" }),
      line("E001", "40", "CNY", { legalEntity: "ANARI-HK" }),
    ];
    const report = compareShadowSettlement(engine, finance, {
      generatedAt: GENERATED_AT,
    });
    expect(report.rows).toHaveLength(2);
    expect(report.counts).toEqual({
      matched: 2,
      variances: 0,
      missingInFinance: 0,
      missingInEngine: 0,
    });
    expect(report.rows.map((row) => row.legalEntity).sort()).toEqual([
      "ANARI-CN",
      "ANARI-HK",
    ]);
    expect(report.totals.engine).toBe("100");
    expect(report.totals.variance).toBe("0");
  });

  it("不同 legalEntity 的差异不会被净额抵消", () => {
    // 旧实现合并后合计 100 = 100，会误报 MATCH。
    const report = compareShadowSettlement(
      [
        line("E001", "100", "CNY", { legalEntity: "ANARI-CN" }),
        line("E001", "-20", "CNY", { legalEntity: "ANARI-HK" }),
      ],
      [line("E001", "80", "CNY", { legalEntity: "ANARI-CN" })],
      { generatedAt: GENERATED_AT },
    );
    expect(report.withinTolerance).toBe(false);
    expect(report.counts.variances).toBe(1);
    expect(report.counts.missingInFinance).toBe(1);
    expect(report.rows).toHaveLength(2);
    const cn = report.rows.find((row) => row.legalEntity === "ANARI-CN");
    const hk = report.rows.find((row) => row.legalEntity === "ANARI-HK");
    expect(cn).toMatchObject({
      engine: "100",
      finance: "80",
      variance: "-20",
      status: "VARIANCE",
    });
    expect(hk).toMatchObject({
      engine: "-20",
      finance: null,
      status: "MISSING_IN_FINANCE",
    });
  });

  it("不同 accountingPeriod 不合并", () => {
    const report = compareShadowSettlement(
      [
        line("E001", "100", "CNY", { accountingPeriod: "2026-10" }),
        line("E001", "100", "CNY", { accountingPeriod: "2026-11" }),
      ],
      [
        line("E001", "100", "CNY", { accountingPeriod: "2026-10" }),
        line("E001", "100", "CNY", { accountingPeriod: "2026-11" }),
      ],
      { generatedAt: GENERATED_AT },
    );
    expect(report.rows).toHaveLength(2);
    expect(report.rows.map((row) => row.accountingPeriod)).toEqual([
      "2026-10",
      "2026-11",
    ]);
    expect(report.counts.matched).toBe(2);
  });

  it("orderId / payoutBatch / contractRef 参与分组，同维度内仍正确求和", () => {
    const report = compareShadowSettlement(
      [
        line("E001", "50", "CNY", { orderId: "O-1", payoutBatch: "B-1" }),
        line("E001", "50", "CNY", { orderId: "O-1", payoutBatch: "B-1" }),
        line("E001", "30", "CNY", { orderId: "O-2", payoutBatch: "B-1" }),
      ],
      [
        line("E001", "100", "CNY", { orderId: "O-1", payoutBatch: "B-1" }),
        line("E001", "30", "CNY", { orderId: "O-2", payoutBatch: "B-1" }),
      ],
      { generatedAt: GENERATED_AT },
    );
    expect(report.withinTolerance).toBe(true);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({ orderId: "O-1", engine: "100" });
  });

  it("一侧缺失维度时 fail-closed 报告缺失，而不是静默匹配", () => {
    const report = compareShadowSettlement(
      [line("E001", "100", "CNY", { legalEntity: "ANARI-CN" })],
      [line("E001", "100", "CNY")],
      { generatedAt: GENERATED_AT },
    );
    expect(report.withinTolerance).toBe(false);
    expect(report.counts).toEqual({
      matched: 0,
      variances: 0,
      missingInFinance: 1,
      missingInEngine: 1,
    });
    expect(report.totals.variance).toBe("0");
  });

  it("空白维度值视为未提供，不进入聚合键", () => {
    const report = compareShadowSettlement(
      [line("E001", "100", "CNY", { legalEntity: "   ", orderId: "" })],
      [line("E001", "100", "CNY")],
      { generatedAt: GENERATED_AT },
    );
    expect(report.withinTolerance).toBe(true);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).not.toHaveProperty("legalEntity");
  });

  it("旧输入（无维度字段）行为与 reportHash 保持稳定", () => {
    const engine = [
      { personKey: "E001", amount: "6000.00", currency: "CNY" },
      { personKey: "E002", amount: "4000.00", currency: "CNY" },
    ];
    const finance = [
      { personKey: "E001", amount: "6000", currency: "cny" },
      { personKey: "E002", amount: "4000.00", currency: "CNY" },
    ];
    const report = compareShadowSettlement(engine, finance, {
      generatedAt: GENERATED_AT,
    });
    expect(report.reportHash).toBe(
      "sha256:e37ed7d4280b2b04a788aa4297e9723c5106c1e61b813288dde1b27377b83671",
    );
    expect(report.rows).toEqual([
      {
        personKey: "E001",
        currency: "CNY",
        engine: "6000",
        finance: "6000",
        variance: "0",
        status: "MATCH",
      },
      {
        personKey: "E002",
        currency: "CNY",
        engine: "4000",
        finance: "4000",
        variance: "0",
        status: "MATCH",
      },
    ]);
  });

  it("旧的多币种聚合行为与 reportHash 保持稳定", () => {
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
      { generatedAt: GENERATED_AT },
    );
    expect(report.reportHash).toBe(
      "sha256:4084f79c32a48b287a9b7d205ad1ae23e90ecef1b6ea6a850376ed0d9f19d127",
    );
    expect(report.rows).toHaveLength(2);
  });
});
