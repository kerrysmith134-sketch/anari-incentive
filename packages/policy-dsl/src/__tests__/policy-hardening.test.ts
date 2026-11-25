import { describe, expect, it } from "vitest";
import type { PerformanceMetricSpec } from "@anari/domain";
import {
  calculateAnnualProfitSharing,
  calculateAnnualScorecard,
  calculateBountySettlement,
  calculateBusinessUnitCommission,
  calculateDbcp,
  calculateEquityGrant,
  calculateInternalSplit,
  calculateOverseasSalesAward,
  calculateRepurchase,
  calculateTechCenterAward,
  calculateVestingSchedule,
  evaluateMonthlyStar,
  scorePerformance,
} from "../index.js";

function spec(
  partial: Partial<PerformanceMetricSpec> &
    Pick<
      PerformanceMetricSpec,
      "metricId" | "name" | "period" | "weight" | "metricType"
    >,
): PerformanceMetricSpec {
  return {
    applicableRoles: ["*"],
    dataSource: "test",
    sourceFields: [],
    calculationRule: "",
    ownerRole: "HR",
    evidenceRule: "",
    applicabilityRule: "",
    exceptionRule: "",
    approvalRule: "",
    version: 1,
    ...partial,
  };
}

describe("policy hardening rounds 01-24", () => {
  it("01: DBCP can go negative and still returns a deterministic value", () => {
    const result = calculateDbcp({
      grossProfit: "1000",
      businessExpenses: "2000",
      laborAndTravel: "0",
      allocatedBusinessUnitExpenses: "0",
      allocatedBackendPayroll: "0",
    });
    expect(result.managementProvision).toBe("50");
    expect(result.dbcp).toBe("-1050");
  });

  it("02: commission margin exactly 8% hits the 1% band", () => {
    const result = calculateBusinessUnitCommission({
      dbcp: "80000",
      netCollection: "1000000",
    });
    expect(result.marginPercent).toBe("8");
    expect(result.bandRatePercent).toBe("1");
    expect(result.commission).toBe("10000");
  });

  it("03: margin just below 8% pays zero", () => {
    const result = calculateBusinessUnitCommission({
      dbcp: "79999",
      netCollection: "1000000",
    });
    expect(result.eligible).toBe(false);
    expect(result.commission).toBe("0");
  });

  it("04: margin exactly 25% hits the 3% band", () => {
    const result = calculateBusinessUnitCommission({
      dbcp: "250000",
      netCollection: "1000000",
    });
    expect(result.bandRatePercent).toBe("3");
    expect(result.commission).toBe("30000");
  });

  it("05: internal split rejects a pool overflow", () => {
    const result = calculateInternalSplit({
      commissionPool: "1000",
      marketingReward: "800",
      executiveSupplement: "300",
      participants: [{ personId: "p1", sharePercent: "100" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain("超过");
    expect(result.allocations[0]!.amount).toBe("0");
  });

  it("06: internal split rejects 101% total even if pool is positive", () => {
    const result = calculateInternalSplit({
      commissionPool: "10000",
      marketingReward: "0",
      executiveSupplement: "0",
      participants: [
        { personId: "p1", sharePercent: "50" },
        { personId: "p2", sharePercent: "51" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain("100%");
  });

  it("07: a missed key milestone zeroes the bounty even without delay", () => {
    const result = calculateBountySettlement({
      baseReward: "10000",
      delayWorkingDays: 0,
      keyMilestoneMissed: true,
      qualityGrade: "PASS",
      personalContributionShare: "1",
    });
    expect(result.timeCoefficient).toBe("0");
    expect(result.amount).toBe("0");
  });

  it("08: an approved extension restores the time coefficient", () => {
    const result = calculateBountySettlement({
      baseReward: "10000",
      delayWorkingDays: 30,
      extensionApproved: true,
      qualityGrade: "PASS",
      personalContributionShare: "1",
    });
    expect(result.timeCoefficient).toBe("1");
    expect(result.amount).toBe("10000");
  });

  it("09: cost optimization is capped at 10,000", () => {
    const result = calculateTechCenterAward({
      awardType: "COST_OPTIMIZATION",
      baseAmount: "2000000",
      approvedAmount: "2",
    });
    expect(result.grossAmount).toBe("10000");
    expect(result.cappable).toBe(true);
  });

  it("10: knowledge contribution is capped at 1,000 per quarter", () => {
    const result = calculateTechCenterAward({
      awardType: "KNOWLEDGE_CONTRIBUTION",
      quantity: 30,
      approvedAmount: "100",
    });
    expect(result.grossAmount).toBe("1000");
  });

  it("11: saturation is inclusive at the cap", () => {
    const result = calculateEquityGrant({
      positionLevel: "L3",
      financingStage: "A",
      performanceGrade: "B",
      tenureStage: "A",
      positionBasePercent: "0.1",
      existingGrantPercent: "0.9",
    });
    expect(result.cumulativePercent).toBe("1");
    expect(result.saturationCapPercent).toBe("1");
    expect(result.withinSaturation).toBe(true);
  });

  it("12: C grade is not eligible for Refresh", () => {
    const result = calculateEquityGrant({
      positionLevel: "L3",
      financingStage: "B",
      performanceGrade: "C",
      tenureStage: "B",
      isRefresh: true,
      initialGrantPercent: "0.2",
    });
    expect(result.grantPercent).toBe("0");
  });

  it("13: one day before cliff vests nothing", () => {
    const result = calculateVestingSchedule({
      totalUnits: "10000",
      vestingStart: "2026-01-01T00:00:00Z",
      asOf: "2026-12-31T00:00:00Z",
    });
    expect(result.vestedUnits).toBe("0");
    expect(result.points).toHaveLength(0);
  });

  it("14: repurchase with no fair-value input prices at zero and does not invent 50k", () => {
    const result = calculateRepurchase({
      scenario: "INVOLUNTARY",
      holdingMonths: 24,
      costAmount: "0",
    });
    expect(result.fairValuePerUnit).toBe("0");
    expect(result.repurchasePrice).toBe("0");
    expect(result.minimumPriceApplied).toBe(false);
  });

  it("15: involuntary repurchase applies the 50,000 floor", () => {
    const result = calculateRepurchase({
      scenario: "INVOLUNTARY",
      holdingMonths: 24,
      costAmount: "0",
      latestFinancingPrice: "1",
      shares: "10000",
    });
    // 1 × 0.8 × 10000 = 8000 → floor 50000
    expect(result.repurchasePrice).toBe("50000");
    expect(result.minimumPriceApplied).toBe(true);
  });

  it("16: annual profit sharing respects the reserved budget balance", () => {
    const result = calculateAnnualProfitSharing({
      distributableNetProfit: "10000000",
      netProfitTarget: "8000000",
      poolRatePercent: "8",
      reservedBudgetBalance: "500000",
      people: [
        {
          personId: "p1",
          monthlyWageBase: "20000",
          gradeCoefficient: "1",
          weightedQuarterlyKp: "1",
          attendanceRatio: "1",
        },
      ],
    });
    expect(result.poolAmount).toBe("800000");
    expect(result.approvedPoolAmount).toBe("500000");
    expect(result.allocations[0]!.amount).toBe("500000");
  });

  it("17: monthly star stops at three awards per year", () => {
    const result = evaluateMonthlyStar([
      {
        personId: "p1",
        rank: 1,
        monthlyScore: "110",
        m003Score: "20",
        verifiedPositiveEvents: 1,
        seriousViolation: false,
        consecutiveMonths: 4,
        awardedThisYear: 3,
      },
    ]);
    expect(result.awarded).toBe(false);
    expect(result.candidates[0]!.reasonCode).toBe(
      "ANNUAL_AWARD_LIMIT_REACHED",
    );
  });

  it("18: duplicate metric ids are rejected", () => {
    const metric = spec({
      metricId: "DUP",
      name: "重复",
      period: "MONTHLY",
      weight: "100",
      metricType: "POSITIVE_LINEAR",
      target: "100",
    });
    expect(() =>
      scorePerformance({
        personId: "p1",
        period: "MONTHLY",
        metrics: [metric, metric],
        measurements: [{ metricId: "DUP", rawValue: "100", applicable: true }],
      }),
    ).toThrow(/duplicate/i);
  });

  it("19: metric period mismatch is rejected", () => {
    expect(() =>
      scorePerformance({
        personId: "p1",
        period: "QUARTERLY",
        metrics: [
          spec({
            metricId: "M",
            name: "月度",
            period: "MONTHLY",
            weight: "100",
            metricType: "POSITIVE_LINEAR",
            target: "100",
          }),
        ],
        measurements: [{ metricId: "M", rawValue: "100", applicable: true }],
      }),
    ).toThrow(/period/);
  });

  it("20: manual adjustment without reason is rejected", () => {
    expect(() =>
      scorePerformance({
        personId: "p1",
        period: "MONTHLY",
        metrics: [
          spec({
            metricId: "M",
            name: "单指标",
            period: "MONTHLY",
            weight: "100",
            metricType: "POSITIVE_LINEAR",
            target: "100",
          }),
        ],
        measurements: [{ metricId: "M", rawValue: "100", applicable: true }],
        manualAdjustment: "5",
      }),
    ).toThrow(/reason/);
  });

  it("21: all-N/A metrics never produce a zero Kp", () => {
    const result = scorePerformance({
      personId: "p1",
      period: "MONTHLY",
      metrics: [
        spec({
          metricId: "M",
          name: "全N/A",
          period: "MONTHLY",
          weight: "100",
          metricType: "POSITIVE_LINEAR",
          target: "100",
        }),
      ],
      measurements: [
        { metricId: "M", applicable: false, naReason: "no sample" },
      ],
    });
    expect(result.complete).toBe(false);
    expect(result.kp).toBe("0");
    expect(result.note).toContain("无法形成完整评价");
  });

  it("22: annual scorecard clamps each component at 120 and total at 105", () => {
    const result = calculateAnnualScorecard({
      revenueAchievementScore: "999",
      distributableProfitAchievementScore: "999",
      netCollectionAchievementScore: "999",
      strategyAchievementScore: "999",
    });
    expect(result.components.every((component) => Number(component.score) <= 120)).toBe(true);
    expect(result.companyScore).toBe("105");
  });

  it("23: KA at 9.99M stays in the 30k tier", () => {
    const result = calculateOverseasSalesAward({
      awardType: "KA_BREAKTHROUGH",
      kaQualified: true,
      firstSigning: true,
      annualCustomerOrderAmount: "9999999",
    });
    expect(result.grossAmount).toBe("30000");
  });

  it("24: malicious poaching disqualifies and recovers paid amount", () => {
    const result = calculateOverseasSalesAward({
      awardType: "ANNUAL_CHAMPION",
      rank: 1,
      targetExceeded: true,
      maliciousPoaching: true,
      paidAmount: "50000",
    });
    expect(result.disqualified).toBe(true);
    expect(result.netAmount).toBe("0");
    expect(result.recoverableAmount).toBe("50000");
  });
});
