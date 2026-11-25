import { describe, expect, it } from "vitest";
import type {
  PerformanceMetricSpec,
  PersonalTaskInventory,
  TaskPod,
  AiMember,
} from "@anari/domain";
import {
  calculateAnnualProfitSharing,
  calculateAnnualScorecard,
  calculateBountySettlement,
  calculateBusinessUnitCommission,
  calculateCapTableSnapshot,
  calculateDbcp,
  calculateEquityGrant,
  calculateExecutiveSupplement,
  calculateFunctionalQuarterlyBonus,
  calculateInternalSplit,
  calculateMonthlyPerformanceWage,
  calculateOptionStrikePrice,
  calculateOverseasSalesAward,
  calculateRepurchase,
  calculateTechCenterAward,
  calculateTechCenterPool,
  calculateVestingSchedule,
  evaluateMonthlyStar,
  monthlyMetricTemplate,
  quarterlyMetricTemplate,
  scorePerformance,
  validatePersonalTaskInventory,
  validateTaskPod,
} from "../index.js";

function spec(
  partial: Partial<PerformanceMetricSpec> & Pick<PerformanceMetricSpec, "metricId" | "name" | "period" | "weight" | "metricType">,
): PerformanceMetricSpec {
  return {
    applicableRoles: ["*"],
    dataSource: "test",
    sourceFields: [],
    calculationRule: "",
    ownerRole: "HR",
    evidenceRule: "evidence",
    applicabilityRule: "N/A",
    exceptionRule: "review",
    approvalRule: "approval",
    version: 1,
    ...partial,
  };
}

const MONTHLY = monthlyMetricTemplate();

function monthlyMeasurement(
  closureRate: string | null,
  examScore: string | null,
  valueAdjustment: string,
) {
  return [
    {
      metricId: "M-001",
      rawValue: closureRate,
      applicable: closureRate !== null,
      naReason: closureRate === null ? "无任务样本" : undefined,
    },
    {
      metricId: "M-002",
      rawValue: examScore,
      applicable: examScore !== null,
      naReason: examScore === null ? "无正式考试安排" : undefined,
    },
    {
      metricId: "M-003",
      applicable: true,
      eventAdjustment: valueAdjustment,
      evidenceRefs: ["ev-1"],
    },
  ];
}

describe("017/018 performance engine", () => {
  it("M-001 closure rate + M-002 exam + M-003 event produce weighted score and Kp", () => {
    const result = scorePerformance({
      personId: "p1",
      period: "MONTHLY",
      metrics: MONTHLY,
      measurements: monthlyMeasurement("80", "90", "3"),
    });
    // 80×70% + 90×15% + 103×15% = 84.95
    expect(result.rawScore).toBe("84.95");
    expect(result.finalScore).toBe("84.95");
    expect(result.kp).toBe("0.8495");
    expect(result.complete).toBe(true);
    expect(result.renormalized).toBe(false);
  });

  it("N/A does not score zero; weights are renormalized", () => {
    const result = scorePerformance({
      personId: "p1",
      period: "MONTHLY",
      metrics: MONTHLY,
      measurements: monthlyMeasurement("80", null, "3"),
    });
    // (80×70 + 103×15) / 85 = 84.0588
    expect(result.rawScore).toBe("84.0588");
    expect(result.naMetricIds).toEqual(["M-002"]);
    expect(result.renormalized).toBe(true);
    expect(result.complete).toBe(true);
  });

  it("all N/A means no complete evaluation instead of zero", () => {
    const result = scorePerformance({
      personId: "p1",
      period: "MONTHLY",
      metrics: MONTHLY,
      measurements: [
        { metricId: "M-001", applicable: false, naReason: "no task" },
        { metricId: "M-002", applicable: false, naReason: "no exam" },
        { metricId: "M-003", applicable: false, naReason: "no event" },
      ],
    });
    expect(result.complete).toBe(false);
    expect(result.note).toContain("无法形成完整评价");
  });

  it("M-003 is clamped to 0-110", () => {
    const positive = scorePerformance({
      personId: "p1",
      period: "MONTHLY",
      metrics: MONTHLY,
      measurements: monthlyMeasurement("100", "100", "20"),
    });
    expect(positive.components.find((row) => row.metricId === "M-003")?.score).toBe("110");
    const negative = scorePerformance({
      personId: "p1",
      period: "MONTHLY",
      metrics: MONTHLY,
      measurements: monthlyMeasurement("100", "100", "-130"),
    });
    expect(negative.components.find((row) => row.metricId === "M-003")?.score).toBe("0");
  });

  it("周期封顶: monthly 110, quarterly 150, annual 105", () => {
    const monthly = scorePerformance({
      personId: "p1",
      period: "MONTHLY",
      metrics: MONTHLY,
      measurements: monthlyMeasurement("100", "100", "10"),
    });
    // 100×70% + 100×15% + 110×15% = 101.5（月度上限 110 尚未触及）
    expect(monthly.finalScore).toBe("101.5");
    const overridden = scorePerformance({
      personId: "p1",
      period: "MONTHLY",
      metrics: MONTHLY,
      measurements: monthlyMeasurement("100", "100", "10"),
      manualAdjustment: "20",
      manualAdjustmentReason: "总经理特别调整",
    });
    expect(overridden.finalScore).toBe("110");
    expect(overridden.kp).toBe("1.1");

    const quarterly = scorePerformance({
      personId: "p1",
      period: "QUARTERLY",
      metrics: [
        spec({
          metricId: "Q-1",
          name: "回款",
          period: "QUARTERLY",
          weight: "100",
          metricType: "POSITIVE_LINEAR",
          target: "100",
        }),
      ],
      measurements: [{ metricId: "Q-1", rawValue: "200", applicable: true }],
    });
    // 200% 得分封顶 150（单项上限），周期上限 150
    expect(quarterly.finalScore).toBe("150");

    const annual = scorePerformance({
      personId: "p1",
      period: "ANNUAL",
      metrics: [
        spec({
          metricId: "A-1",
          name: "年度",
          period: "ANNUAL",
          weight: "100",
          metricType: "POSITIVE_LINEAR",
          target: "100",
          maxScore: "200",
        }),
      ],
      measurements: [{ metricId: "A-1", rawValue: "200", applicable: true }],
    });
    // 单项 200，年度周期封顶 105
    expect(annual.finalScore).toBe("105");
  });

  it("manual adjustment requires a written reason", () => {
    expect(() =>
      scorePerformance({
        personId: "p1",
        period: "MONTHLY",
        metrics: MONTHLY,
        measurements: monthlyMeasurement("100", "100", "0"),
        manualAdjustment: "2",
      }),
    ).toThrow(/reason/);
  });

  it("piecewise linear interpolates between anchors", () => {
    const result = scorePerformance({
      personId: "p1",
      period: "MONTHLY",
      metrics: [
        spec({
          metricId: "P-1",
          name: "分段",
          period: "MONTHLY",
          weight: "100",
          metricType: "PIECEWISE_LINEAR",
          scoringAnchors: [
            { raw: "0", score: "0" },
            { raw: "80", score: "80" },
            { raw: "100", score: "100" },
            { raw: "120", score: "150" },
          ],
        }),
      ],
      measurements: [{ metricId: "P-1", rawValue: "90", applicable: true }],
    });
    expect(result.finalScore).toBe("90");
  });

  it("reverse linear scores lower raw values higher", () => {
    const result = scorePerformance({
      personId: "p1",
      period: "QUARTERLY",
      metrics: [
        spec({
          metricId: "R-1",
          name: "缺陷率",
          period: "QUARTERLY",
          weight: "100",
          metricType: "REVERSE_LINEAR",
          target: "5",
          maxScore: "150",
        }),
      ],
      measurements: [{ metricId: "R-1", rawValue: "10", applicable: true }],
    });
    expect(result.finalScore).toBe("50");
  });

  it("monthly performance wage = total wage × band rate × Kp (cap 1.10)", () => {
    const base = calculateMonthlyPerformanceWage({
      monthlyTotalWage: "30000",
      wageBand: "BASE",
      monthlyScore: "105",
    });
    expect(base.floatingRatePercent).toBe("20");
    expect(base.performanceWageStandard).toBe("6000");
    expect(base.payable).toBe("6300");
    const capped = calculateMonthlyPerformanceWage({
      monthlyTotalWage: "30000",
      wageBand: "DIRECTOR",
      monthlyScore: "150",
    });
    expect(capped.kp).toBe("1.1");
    expect(capped.payable).toBe("13200");
    expect(capped.cappedAtOnePointOne).toBe(true);
  });

  it("functional quarterly bonus requires S>100 and caps Kq at 1.50", () => {
    const eligible = calculateFunctionalQuarterlyBonus({
      fixedMonthlyWage: "10000",
      quarterlyScore: "120",
    });
    expect(eligible.baseAmount).toBe("1000");
    expect(eligible.kq).toBe("1.2");
    expect(eligible.amount).toBe("1200");
    expect(eligible.eligible).toBe(true);
    const noQualification = calculateFunctionalQuarterlyBonus({
      fixedMonthlyWage: "10000",
      quarterlyScore: "100",
    });
    expect(noQualification.eligible).toBe(false);
    expect(noQualification.amount).toBe("0");
    const capped = calculateFunctionalQuarterlyBonus({
      fixedMonthlyWage: "10000",
      quarterlyScore: "160",
    });
    expect(capped.kq).toBe("1.5");
    expect(capped.amount).toBe("1500");
  });

  it("annual scorecard caps each item at 120 and company score at 105", () => {
    const result = calculateAnnualScorecard({
      revenueAchievementScore: "100",
      distributableProfitAchievementScore: "110",
      netCollectionAchievementScore: "100",
      strategyAchievementScore: "120",
      distributableNetProfit: "12000000",
      netProfitTarget: "10000000",
      functionalBonusPoolRatePercent: "8",
    });
    // 20 + 33 + 20 + 36 = 109 → 105
    expect(result.companyScore).toBe("105");
    expect(result.kp).toBe("1.05");
    expect(result.profitTargetMet).toBe(true);
    expect(result.functionalBonusPoolRatePercent).toBe("8");
  });

  it("annual profit sharing is zero unless P_y >= target and > 0", () => {
    const below = calculateAnnualProfitSharing({
      distributableNetProfit: "9000000",
      netProfitTarget: "10000000",
      poolRatePercent: "8",
      people: [
        {
          personId: "p1",
          monthlyWageBase: "20000",
          gradeCoefficient: "1",
          weightedQuarterlyKp: "1.1",
          attendanceRatio: "1",
        },
      ],
    });
    expect(below.eligible).toBe(false);
    expect(below.approvedPoolAmount).toBe("0");

    const above = calculateAnnualProfitSharing({
      distributableNetProfit: "10000000",
      netProfitTarget: "10000000",
      poolRatePercent: "8",
      people: [
        {
          personId: "p1",
          monthlyWageBase: "20000",
          gradeCoefficient: "1.5",
          weightedQuarterlyKp: "1.1",
          attendanceRatio: "1",
        },
        {
          personId: "p2",
          monthlyWageBase: "20000",
          gradeCoefficient: "1",
          weightedQuarterlyKp: "1",
          attendanceRatio: "1",
        },
      ],
    });
    expect(above.eligible).toBe(true);
    expect(above.poolAmount).toBe("800000");
    // p1 points 33000, p2 20000 → 498113.21 / 301886.79
    expect(above.allocations[0]!.amount).toBe("498113.21");
    expect(above.allocations[1]!.amount).toBe("301886.79");
  });

  it("monthly star requires rank one, total>=110, values>=20, evidence and no violation", () => {
    const base = {
      personId: "p1",
      rank: 1,
      monthlyScore: "110",
      m003Score: "110",
      verifiedPositiveEvents: 1,
      seriousViolation: false,
      consecutiveMonths: 1,
      awardedThisYear: 0,
    };
    const first = evaluateMonthlyStar([base]);
    expect(first.awarded).toBe(true);
    expect(first.candidates[0]!.amount).toBe("500");
    const third = evaluateMonthlyStar([{ ...base, consecutiveMonths: 3 }]);
    expect(third.candidates[0]!.amount).toBe("1000");
    const rankTwo = evaluateMonthlyStar([{ ...base, rank: 2 }]);
    expect(rankTwo.awarded).toBe(false);
    expect(rankTwo.candidates[0]!.reasonCode).toBe("NOT_RANK_ONE");
    const lowTotal = evaluateMonthlyStar([
      { ...base, monthlyScore: "105", m003Score: "20" },
    ]);
    expect(lowTotal.candidates[0]!.reasonCode).toBe(
      "TOTAL_SCORE_BELOW_THRESHOLD",
    );
    const lowValues = evaluateMonthlyStar([
      { ...base, monthlyScore: "110", m003Score: "15" },
    ]);
    expect(lowValues.candidates[0]!.reasonCode).toBe("M003_BELOW_THRESHOLD");
    const violation = evaluateMonthlyStar([
      { ...base, seriousViolation: true },
    ]);
    expect(violation.awarded).toBe(false);
    expect(violation.note).toContain("不递补");
  });

  it("quarterly templates match the policy weights (A.3-A.8)", () => {
    const sales = quarterlyMetricTemplate("SALES");
    expect(sales.map((metric) => metric.weight)).toEqual(["30", "35", "15", "10", "10"]);
    const pm = quarterlyMetricTemplate("PRODUCT_MANAGER");
    expect(pm.map((metric) => metric.weight)).toEqual(["45", "30", "15", "10"]);
    const finance = quarterlyMetricTemplate("FINANCE");
    expect(finance.map((metric) => metric.weight)).toEqual(["30", "25", "25", "20"]);
    expect(() => quarterlyMetricTemplate("UNKNOWN")).toThrow(/no quarterly/);
  });
});

describe("016 incentive allocation engine", () => {
  it("DBCP subtracts business expenses, labor, allocations and 5% provision", () => {
    const result = calculateDbcp({
      grossProfit: "1000000",
      businessExpenses: "50000",
      laborAndTravel: "100000",
      allocatedBusinessUnitExpenses: "20000",
      allocatedBackendPayroll: "30000",
    });
    expect(result.managementProvision).toBe("50000");
    expect(result.dbcp).toBe("750000");
  });

  it("commission applies the whole net collection at the margin band rate", () => {
    const result = calculateBusinessUnitCommission({
      dbcp: "750000",
      netCollection: "1000000",
    });
    expect(result.marginPercent).toBe("75");
    expect(result.bandRatePercent).toBe("3");
    expect(result.commission).toBe("30000");
    const middle = calculateBusinessUnitCommission({
      dbcp: "100000",
      netCollection: "1000000",
    });
    expect(middle.marginPercent).toBe("10");
    expect(middle.bandRatePercent).toBe("1");
    expect(middle.commission).toBe("10000");
    const below = calculateBusinessUnitCommission({
      dbcp: "50000",
      netCollection: "1000000",
    });
    expect(below.eligible).toBe(false);
    expect(below.commission).toBe("0");
    expect(
      calculateBusinessUnitCommission({ dbcp: "100000", netCollection: "0" })
        .commission,
    ).toBe("0");
    expect(
      calculateBusinessUnitCommission({ dbcp: "-1", netCollection: "100" })
        .commission,
    ).toBe("0");
  });

  it("executive supplement = DBCP×2%×K管理 − M, floored at zero", () => {
    const result = calculateExecutiveSupplement({
      dbcp: "1000000",
      managementScore: "90",
      marketingReward: "5000",
    });
    expect(result.managementK).toBe("0.9");
    expect(result.grossSupplement).toBe("18000");
    expect(result.supplement).toBe("13000");
    expect(
      calculateExecutiveSupplement({
        dbcp: "1000000",
        managementScore: "70",
        marketingReward: "0",
      }).supplement,
    ).toBe("0");
    expect(
      calculateExecutiveSupplement({
        dbcp: "1000000",
        managementScore: "120",
        marketingReward: "0",
      }).managementK,
    ).toBe("1");
  });

  it("internal split allocates only R = B − M − G and requires 100%", () => {
    const result = calculateInternalSplit({
      commissionPool: "30000",
      marketingReward: "5000",
      executiveSupplement: "13000",
      participants: [
        { personId: "p1", sharePercent: "60" },
        { personId: "p2", sharePercent: "40" },
      ],
    });
    expect(result.remainingPool).toBe("12000");
    expect(result.allocations).toEqual([
      { personId: "p1", amount: "7200" },
      { personId: "p2", amount: "4800" },
    ]);
    expect(result.valid).toBe(true);
    const invalid = calculateInternalSplit({
      commissionPool: "30000",
      marketingReward: "5000",
      executiveSupplement: "13000",
      participants: [{ personId: "p1", sharePercent: "90" }],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]).toContain("100%");
  });

  it("bounty applies time and quality coefficients", () => {
    const result = calculateBountySettlement({
      baseReward: "10000",
      delayWorkingDays: 5,
      qualityGrade: "MINOR_DEFECT",
      personalContributionShare: "1",
    });
    expect(result.timeCoefficient).toBe("0.75");
    expect(result.qualityCoefficient).toBe("0.95");
    expect(result.amount).toBe("7125");
    expect(
      calculateBountySettlement({
        baseReward: "10000",
        delayWorkingDays: 20,
        qualityGrade: "PASS",
        personalContributionShare: "1",
      }).amount,
    ).toBe("0");
    expect(
      calculateBountySettlement({
        baseReward: "10000",
        delayWorkingDays: 20,
        extensionApproved: true,
        qualityGrade: "PASS",
        personalContributionShare: "1",
      }).amount,
    ).toBe("10000");
  });

  it("tech center awards follow 008 fixed and percentage rules", () => {
    expect(
      calculateTechCenterAward({
        awardType: "INVENTION_PATENT_GRANTED",
      }).grossAmount,
    ).toBe("5000");
    expect(
      calculateTechCenterAward({
        awardType: "CUSTOM_PROJECT",
        baseAmount: "100000",
      }).grossAmount,
    ).toBe("30000");
    expect(
      calculateTechCenterAward({
        awardType: "COST_OPTIMIZATION",
        baseAmount: "2000000",
      }).grossAmount,
    ).toBe("10000");
    expect(
      calculateTechCenterAward({
        awardType: "HARDWARE_DC_DELIVERY",
        delayRatio: "0.2",
      }).grossAmount,
    ).toBe("4000");
    expect(
      calculateTechCenterAward({
        awardType: "KNOWLEDGE_CONTRIBUTION",
        quantity: 30,
      }).grossAmount,
    ).toBe("1000");
    expect(
      calculateTechCenterAward({ awardType: "SLA_MONTH" }).grossAmount,
    ).toBe("500");
  });

  it("tech center pool is 19% of commission and applies head adjustment", () => {
    const result = calculateTechCenterPool({
      totalBusinessCommission: "100000",
      headPersonId: "head",
      members: [
        {
          personId: "head",
          positionCoefficient: "1.2",
          projectContribution: "1",
          performanceCoefficient: "1",
        },
        {
          personId: "pm",
          positionCoefficient: "1",
          projectContribution: "1",
          performanceCoefficient: "1",
        },
      ],
      headReview: {
        roadmapAchievementPercent: "85",
        crossFunctionalSatisfaction: "3",
        techDebtControlled: false,
        retentionMet: true,
      },
    });
    expect(result.poolAmount).toBe("19000");
    expect(result.headAdjustment).toBe("-0.2");
    expect(result.allocations.find((row) => row.personId === "head")!.weight).toBe("1");
    expect(result.allocations.find((row) => row.personId === "pm")!.weight).toBe("1");
  });

  it("overseas sales awards follow 003 thresholds and clawbacks", () => {
    const newStar = calculateOverseasSalesAward({
      awardType: "NEW_CUSTOMER_STAR",
      qualifiedNewCustomerCount: 8,
      newCustomerCount: 8,
      badDebtLoss: "2000",
    });
    expect(newStar.grossAmount).toBe("10000");
    expect(newStar.deduction).toBe("1000");
    expect(newStar.netAmount).toBe("9000");
    expect(
      calculateOverseasSalesAward({
        awardType: "KA_BREAKTHROUGH",
        kaQualified: true,
        firstSigning: true,
        annualCustomerOrderAmount: "10000000",
      }).grossAmount,
    ).toBe("50000");
    expect(
      calculateOverseasSalesAward({
        awardType: "IMPORTANT_CUSTOMER_BREAKTHROUGH",
        firstSigning: true,
        annualCustomerOrderAmount: "3000000",
      }).grossAmount,
    ).toBe("10000");
    expect(
      calculateOverseasSalesAward({
        awardType: "QUARTERLY_CHAMPION",
        rank: 1,
        targetExceeded: true,
      }).grossAmount,
    ).toBe("10000");
    const clawback = calculateOverseasSalesAward({
      awardType: "KA_BREAKTHROUGH",
      firstSigning: true,
      annualCustomerOrderAmount: "5000000",
      kaNextYearDropRatio: "0.4",
      paidAmount: "30000",
    });
    expect(clawback.recoverableAmount).toBe("15000");
    const poaching = calculateOverseasSalesAward({
      awardType: "ANNUAL_CHAMPION",
      rank: 1,
      targetExceeded: true,
      maliciousPoaching: true,
      paidAmount: "50000",
    });
    expect(poaching.disqualified).toBe(true);
    expect(poaching.recoverableAmount).toBe("50000");
  });
});

describe("011 equity engine", () => {
  it("four-factor grant: 2.5% L1 A-round B grade A-round join", () => {
    const result = calculateEquityGrant({
      positionLevel: "L1",
      financingStage: "A",
      performanceGrade: "B",
      tenureStage: "A",
    });
    expect(result.positionBasePercent).toBe("2.5");
    expect(result.grantPercent).toBe("2.5");
    expect(result.cumulativePercent).toBe("2.5");
    expect(result.withinSaturation).toBe(true);
  });

  it("applies performance and tenure coefficients", () => {
    const result = calculateEquityGrant({
      positionLevel: "L3",
      financingStage: "B",
      performanceGrade: "A",
      tenureStage: "B",
    });
    // 0.2 × 1.15 × 0.8 = 0.184
    expect(result.grantPercent).toBe("0.184");
  });

  it("C/D grades reduce or veto grants", () => {
    expect(
      calculateEquityGrant({
        positionLevel: "L3",
        financingStage: "A",
        performanceGrade: "D",
        tenureStage: "A",
      }).grantPercent,
    ).toBe("0");
    expect(
      calculateEquityGrant({
        positionLevel: "L3",
        financingStage: "A",
        performanceGrade: "C",
        tenureStage: "A",
      }).grantPercent,
    ).toBe("0.195");
  });

  it("saturation caps cumulative grants by level", () => {
    const result = calculateEquityGrant({
      positionLevel: "L2",
      financingStage: "A",
      performanceGrade: "B",
      tenureStage: "A",
      existingGrantPercent: "4.5",
    });
    // The requested 1.0% would exceed the 5% cap, so it is clamped to the
    // 0.5% headroom instead of being granted in full.
    expect(result.grantPercent).toBe("0.5");
    expect(result.cumulativePercent).toBe("5");
    expect(result.saturationCapPercent).toBe("5");
    expect(result.withinSaturation).toBe(false);
  });

  it("refresh is initial grant × level ratio × performance", () => {
    const result = calculateEquityGrant({
      positionLevel: "L3",
      financingStage: "B",
      performanceGrade: "A",
      tenureStage: "B",
      isRefresh: true,
      initialGrantPercent: "0.2",
    });
    // 0.2 × 20% × 1.15 = 0.046
    expect(result.grantPercent).toBe("0.046");
    const preA = calculateEquityGrant({
      positionLevel: "L3",
      financingStage: "PRE_A",
      performanceGrade: "A",
      tenureStage: "A",
      isRefresh: true,
      initialGrantPercent: "0.5",
    });
    expect(preA.grantPercent).toBe("0");
  });

  it("option strike price uses stage discount", () => {
    const result = calculateOptionStrikePrice("50", "A");
    expect(result.discountRatePercent).toBe("45");
    expect(result.strikePrice).toBe("27.5");
    expect(calculateOptionStrikePrice("50", "POST_IPO").strikePrice).toBe("50");
  });

  it("vesting: 4 years with 1-year cliff and monthly 1/48", () => {
    const atCliff = calculateVestingSchedule({
      totalUnits: "10000",
      vestingStart: "2026-01-01T00:00:00Z",
      asOf: "2027-01-01T00:00:00Z",
    });
    expect(atCliff.vestedUnits).toBe("2500");
    expect(atCliff.vestedPercent).toBe("25");
    expect(atCliff.points).toHaveLength(1);
    const at18 = calculateVestingSchedule({
      totalUnits: "10000",
      vestingStart: "2026-01-01T00:00:00Z",
      asOf: "2027-07-01T00:00:00Z",
    });
    expect(at18.vestedPercent).toBe("37.5");
    expect(at18.vestedUnits).toBe("3750");
    const full = calculateVestingSchedule({
      totalUnits: "10000",
      vestingStart: "2026-01-01T00:00:00Z",
      asOf: "2030-01-01T00:00:00Z",
    });
    expect(full.vestedUnits).toBe("10000");
    expect(full.fullyVested).toBe(true);
    const beforeCliff = calculateVestingSchedule({
      totalUnits: "10000",
      vestingStart: "2026-01-01T00:00:00Z",
      asOf: "2026-12-01T00:00:00Z",
    });
    expect(beforeCliff.vestedUnits).toBe("0");
  });

  it("acceleration: double trigger +25%, death/liquidation 100%, retirement 50%", () => {
    const base = {
      totalUnits: "10000",
      vestingStart: "2026-01-01T00:00:00Z",
      asOf: "2028-01-01T00:00:00Z",
    };
    expect(
      calculateVestingSchedule({
        ...base,
        acceleration: { type: "DOUBLE_TRIGGER" },
      }).vestedPercent,
    ).toBe("75");
    expect(
      calculateVestingSchedule({
        ...base,
        acceleration: { type: "DEATH_OR_DISABILITY" },
      }).vestedUnits,
    ).toBe("10000");
    expect(
      calculateVestingSchedule({
        ...base,
        acceleration: { type: "RETIREMENT", serviceYears: 5 },
      }).vestedPercent,
    ).toBe("75");
    expect(
      calculateVestingSchedule({
        ...base,
        acceleration: { type: "IPO" },
      }).vestedPercent,
    ).toBe("50");
  });

  it("repurchase matrix: minimum holding, fair value, minimum price", () => {
    const voluntaryEarly = calculateRepurchase({
      scenario: "VOLUNTARY",
      holdingMonths: 6,
      costAmount: "0",
      latestFinancingPrice: "10",
      shares: "10000",
    });
    expect(voluntaryEarly.repurchasePrice).toBe("0");
    const involuntary = calculateRepurchase({
      scenario: "INVOLUNTARY",
      holdingMonths: 24,
      costAmount: "0",
      latestFinancingPrice: "10",
      shares: "10000",
    });
    // 10 × 80% × 10000 = 80000
    expect(involuntary.fairValuePerUnit).toBe("8");
    expect(involuntary.repurchasePrice).toBe("80000");
    const small = calculateRepurchase({
      scenario: "INVOLUNTARY",
      holdingMonths: 24,
      costAmount: "0",
      latestFinancingPrice: "0.2",
      shares: "10000",
    });
    expect(small.minimumPriceApplied).toBe(true);
    expect(small.repurchasePrice).toBe("50000");
    const fault = calculateRepurchase({
      scenario: "FAULT",
      holdingMonths: 24,
      costAmount: "10000",
      latestFinancingPrice: "10",
      shares: "10000",
    });
    expect(fault.repurchasePrice).toBe("0");
    const large = calculateRepurchase({
      scenario: "INVOLUNTARY",
      holdingMonths: 24,
      costAmount: "0",
      latestFinancingPrice: "100",
      shares: "10000",
    });
    expect(large.annualCapApplied).toBe(true);
    expect(large.installmentAllowed).toBe(true);
  });

  it("cap table aggregates grants and saturation by level", () => {
    const result = calculateCapTableSnapshot({
      totalShares: "1000000",
      grants: [
        {
          personId: "p1",
          positionLevel: "L1",
          instrument: "LP_SHARE",
          grantedPercent: "4",
          vestedPercent: "4",
        },
        {
          personId: "p1",
          positionLevel: "L1",
          instrument: "REFRESH",
          grantedPercent: "1",
          vestedPercent: "0.5",
        },
        {
          personId: "p2",
          positionLevel: "L3",
          instrument: "OPTION",
          grantedPercent: "0.1",
          vestedPercent: "0.05",
        },
      ],
    });
    expect(result.totalGrantedPercent).toBe("5.1");
    expect(result.poolRemainingPercent).toBe("94.9");
    expect(result.saturation[0]).toMatchObject({
      personId: "p1",
      cumulativePercent: "5",
      capPercent: "10",
      saturated: false,
    });
  });
});

describe("task-based AI-native organisation", () => {
  const ai: AiMember = {
    id: "ai-1",
    tenantId: "t1",
    name: "证据助理",
    role: "EVIDENCE_AGENT",
    aiVersion: "1.2.0",
    responsibilities: ["归集证据"],
    ownerPersonId: "p1",
    active: true,
    createdAt: "2026-11-09T00:00:00Z",
    updatedAt: "2026-11-09T00:00:00Z",
    version: 2,
  };

  const pod: TaskPod = {
    id: "pod-1",
    tenantId: "t1",
    title: "海外市场进入",
    objective: "完成首批认证与客户上线",
    initiatorPersonId: "p1",
    status: "ACTIVE",
    members: [
      { kind: "PERSON", memberId: "p1", role: "INITIATOR" },
      { kind: "AI", memberId: "ai-1", role: "EVIDENCE_AGENT", aiVersion: "1.2.0" },
    ],
    startsAt: "2026-10-01T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    version: 1,
  };

  it("validates task pods and registered AI member versions", () => {
    expect(validateTaskPod(pod, [ai]).valid).toBe(true);
    const unregistered = validateTaskPod(
      {
        ...pod,
        members: [
          ...pod.members,
          { kind: "AI", memberId: "ai-x", role: "X" },
        ],
      },
      [ai],
    );
    expect(unregistered.valid).toBe(false);
    expect(unregistered.errors.join()).toContain("未登记");
    const badVersion = validateTaskPod(
      {
        ...pod,
        members: [
          { kind: "PERSON", memberId: "p1", role: "INITIATOR" },
          { kind: "AI", memberId: "ai-1", role: "X", aiVersion: "0.9" },
        ],
      },
      [ai],
    );
    expect(badVersion.errors.join()).toContain("版本快照");
    const notInitiator = validateTaskPod(
      { ...pod, initiatorPersonId: "p2" },
      [ai],
    );
    expect(notInitiator.errors.join()).toContain("发起人");
  });

  it("requires AI workflow annotation and one AI transformation candidate", () => {
    const inventory: PersonalTaskInventory = {
      id: "inv-1",
      tenantId: "t1",
      personId: "p1",
      period: "2026-Q4",
      tasks: [
        {
          taskId: "t-1",
          name: "周报汇总",
          deliverable: "周报",
          measure: "每周五前提交",
          mode: "HYBRID",
        },
      ],
      status: "DRAFT",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      version: 1,
    };
    const result = validatePersonalTaskInventory(inventory);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain("AI 工作流");
    expect(result.errors.join()).toContain("AI 化改造");
    const fixed = validatePersonalTaskInventory({
      ...inventory,
      tasks: [
        {
          ...inventory.tasks[0]!,
          aiWorkflow: "AI 汇总飞书数据，人复核签发",
          aiTransformationCandidate: true,
        },
      ],
    });
    expect(fixed.valid).toBe(true);
  });
});
