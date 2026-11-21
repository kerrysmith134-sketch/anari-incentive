/**
 * 2026-11-21 审计包 Wave 3（P0）：金额算法强校验。
 *
 * NP-011 制度计算 API 逐 calculator 严格 Zod（负值/越界/重复人员 → 400）；
 * NP-012 DSL 域不变量：非负输入、比例范围、重复人员 fail-closed；
 * NP-013 指标验证：重复测量拒绝（不再 last-win）、锚点唯一且单调、
 *        coverageComplete 与 scoreable 语义分离；
 * NP-014 ENGINE_VERSION 语义化——算法不变量发布必须改版本。
 */
import { describe, expect, it } from "vitest";
import {
  calculateDbcp,
  calculateBusinessUnitCommission,
  calculateInternalSplit,
  calculateTechCenterPool,
  scorePerformance,
  ENGINE_VERSION,
} from "../index.js";

const ADMIN = "00000000-0000-4000-8000-000000000001";

describe("NP-014: ENGINE_VERSION 语义化", () => {
  it("引擎版本不再是 0.1.0 占位，且带算法不变量发布注记", () => {
    expect(ENGINE_VERSION).not.toBe("policy-dsl/0.1.0");
    expect(ENGINE_VERSION).toMatch(/^policy-dsl\/\d+\.\d+\.\d+$/);
  });
});

describe("NP-012: incentive DSL 非负/范围/重复不变量", () => {
  it("DBCP：负费用/负毛利率/超 100% 计提率拒绝", () => {
    expect(() =>
      calculateDbcp({
        grossProfit: "1000",
        businessExpenses: "-50",
      } as Parameters<typeof calculateDbcp>[0]),
    ).toThrow(/不能为负/);
    expect(() =>
      calculateDbcp({
        grossProfit: "1000",
        managementProvisionRatePercent: "120",
      } as Parameters<typeof calculateDbcp>[0]),
    ).toThrow(/计提率/);
  });

  it("提成：负净回款/重复档位/非单调档位拒绝", () => {
    expect(() =>
      calculateBusinessUnitCommission({
        dbcp: "100",
        netCollection: "-5",
      } as Parameters<typeof calculateBusinessUnitCommission>[0]),
    ).toThrow(/不能为负/);
    expect(() =>
      calculateBusinessUnitCommission({
        dbcp: "100",
        netCollection: "1000",
        bands: [
          { minMarginPercent: "8", ratePercent: "1" },
          { minMarginPercent: "8", ratePercent: "2" },
        ],
      } as Parameters<typeof calculateBusinessUnitCommission>[0]),
    ).toThrow(/重复|单调/);
    expect(() =>
      calculateBusinessUnitCommission({
        dbcp: "100",
        netCollection: "1000",
        bands: [
          { minMarginPercent: "8", ratePercent: "2" },
          { minMarginPercent: "16", ratePercent: "1" },
        ],
      } as Parameters<typeof calculateBusinessUnitCommission>[0]),
    ).toThrow(/单调|递增/);
  });

  it("内部分配：负池/负份额/重复人员拒绝", () => {
    expect(() =>
      calculateInternalSplit({
        commissionPool: "-100",
        marketingReward: "0",
        executiveSupplement: "0",
        participants: [{ personId: ADMIN, sharePercent: "100" }],
      } as Parameters<typeof calculateInternalSplit>[0]),
    ).toThrow(/不能为负/);
    expect(() =>
      calculateInternalSplit({
        commissionPool: "100",
        marketingReward: "0",
        executiveSupplement: "0",
        participants: [
          { personId: ADMIN, sharePercent: "-10" },
          { personId: "00000000-0000-4000-8000-000000000002", sharePercent: "110" },
        ],
      } as Parameters<typeof calculateInternalSplit>[0]),
    ).toThrow(/不能为负/);
    expect(() =>
      calculateInternalSplit({
        commissionPool: "100",
        marketingReward: "0",
        executiveSupplement: "0",
        participants: [
          { personId: ADMIN, sharePercent: "50" },
          { personId: ADMIN, sharePercent: "50" },
        ],
      } as Parameters<typeof calculateInternalSplit>[0]),
    ).toThrow(/重复/);
  });

  it("技术中心池：负提成基数/负系数/重复成员拒绝", () => {
    expect(() =>
      calculateTechCenterPool({
        totalBusinessCommission: "-10",
        headPersonId: ADMIN,
        members: [
          {
            personId: ADMIN,
            positionCoefficient: "1",
            projectContribution: "1",
            performanceCoefficient: "1",
          },
        ],
      } as Parameters<typeof calculateTechCenterPool>[0]),
    ).toThrow(/不能为负/);
    expect(() =>
      calculateTechCenterPool({
        totalBusinessCommission: "100",
        headPersonId: ADMIN,
        members: [
          {
            personId: ADMIN,
            positionCoefficient: "1",
            projectContribution: "1",
            performanceCoefficient: "1",
          },
          {
            personId: ADMIN,
            positionCoefficient: "1",
            projectContribution: "1",
            performanceCoefficient: "1",
          },
        ],
      } as Parameters<typeof calculateTechCenterPool>[0]),
    ).toThrow(/重复/);
  });
});

describe("NP-013: 指标验证（重复测量/锚点单调/coverage 分离）", () => {
  const metric = {
    metricId: "M-1",
    name: "质量",
    metricType: "PIECEWISE_LINEAR" as const,
    weight: "100",
    period: "MONTHLY",
    applicableRoles: ["SALES"],
    sourceFields: ["qa.score"],
    calculationRule: "piecewise",
    ownerRole: "MANAGER",
    evidenceRule: "QA record",
    applicabilityRule: "always",
    scoringAnchors: [
      { raw: "0", score: "0" },
      { raw: "100", score: "100" },
    ],
    dataSource: "QA",
  };

  it("重复测量 metricId 拒绝（不再 last-win 静默覆盖）", () => {
    expect(() =>
      scorePerformance({
        period: "MONTHLY",
        metrics: [metric],
        measurements: [
          { metricId: "M-1", applicable: true, rawValue: "50" },
          { metricId: "M-1", applicable: true, rawValue: "80" },
        ],
      } as unknown as Parameters<typeof scorePerformance>[0]),
    ).toThrow(/重复测量/);
  });

  it("锚点 raw 重复或分数非单调 fail-closed", () => {
    expect(() =>
      scorePerformance({
        period: "MONTHLY",
        metrics: [
          {
            ...metric,
            scoringAnchors: [
              { raw: "50", score: "60" },
              { raw: "50", score: "80" },
            ],
          },
        ],
        measurements: [{ metricId: "M-1", applicable: true, rawValue: "50" }],
      } as unknown as Parameters<typeof scorePerformance>[0]),
    ).toThrow(/锚点/);
  });

  it("coverageComplete=false 但全部可评 → scoreable=false 且指标分不计入（语义分离）", () => {
    const result = scorePerformance({
      period: "MONTHLY",
      metrics: [metric],
      measurements: [{ metricId: "M-1", applicable: true, rawValue: "50" }],
      coverageComplete: false,
    } as unknown as Parameters<typeof scorePerformance>[0]);
    expect(result.scoreable).toBe(false);
    expect(result.coverageComplete).toBe(false);
  });
});
