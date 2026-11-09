/*
 * Regressions from the full audit of the policy engines: recovery caps,
 * incomplete weight sets, negative Kp, and order-dependent brackets.
 */
import { describe, expect, it } from "vitest";
import type {
  CalculationInput,
  PerformanceMetricSpec,
  PolicyDefinition,
} from "@anari/domain";
import {
  calculateBountySettlement,
  calculateOverseasSalesAward,
  calculateTechCenterAward,
} from "../incentive.js";
import {
  calculateMonthlyPerformanceWage,
  scorePerformance,
} from "../performance.js";
import { calculateByPolicy } from "../calculate.js";

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

const baseMetric = spec({
  metricId: "M-001",
  name: "交付",
  period: "MONTHLY",
  weight: "70",
  metricType: "POSITIVE_LINEAR",
  target: "100",
});

const secondMetric = spec({
  metricId: "M-002",
  name: "考试",
  period: "MONTHLY",
  weight: "15",
  metricType: "POSITIVE_LINEAR",
  target: "100",
});

describe("bounty failed-quality recovery", () => {
  it("recovers the amount actually paid instead of zero", () => {
    const result = calculateBountySettlement({
      baseReward: "10000",
      delayWorkingDays: 0,
      qualityGrade: "FAILED",
      personalContributionShare: "1",
      paidAmount: "8000",
    });
    expect(result.amount).toBe("0");
    expect(result.recoverableAmount).toBe("8000");
  });
});

describe("overseas new-customer gate", () => {
  it("pays only when enough customers meet the first-order and collection gates", () => {
    expect(
      calculateOverseasSalesAward({
        awardType: "NEW_CUSTOMER_STAR",
        newCustomerCount: 8,
        qualifiedNewCustomerCount: 7,
      }).grossAmount,
    ).toBe("0");
    expect(
      calculateOverseasSalesAward({
        awardType: "NEW_CUSTOMER_STAR",
        newCustomerCount: 8,
        qualifiedNewCustomerCount: 8,
      }).grossAmount,
    ).toBe("10000");
  });
});

describe("tech center award bounds", () => {
  it("clamps percentage awards into the institutional range", () => {
    expect(
      calculateTechCenterAward({
        awardType: "CUSTOM_PROJECT",
        baseAmount: "100000",
        approvedAmount: "10",
      }).grossAmount,
    ).toBe("30000");
    expect(
      calculateTechCenterAward({
        awardType: "COST_OPTIMIZATION",
        baseAmount: "2000000",
        approvedAmount: "0.5",
      }).grossAmount,
    ).toBe("10000");
  });

  it("honours SLA, satisfaction and half-year evidence gates", () => {
    expect(
      calculateTechCenterAward({ awardType: "SLA_MONTH", slaMet: false })
        .grossAmount,
    ).toBe("0");
    expect(
      calculateTechCenterAward({
        awardType: "CUSTOMER_SATISFACTION_QUARTER",
        satisfactionScore: "85",
      }).grossAmount,
    ).toBe("0");
    expect(
      calculateTechCenterAward({
        awardType: "CUSTOMER_SATISFACTION_QUARTER",
        satisfactionScore: "95",
      }).grossAmount,
    ).toBe("500");
    expect(
      calculateTechCenterAward({
        awardType: "TEAM_EXCELLENCE",
        halfYearEvidence: false,
      }).grossAmount,
    ).toBe("0");
  });

  it("requires KA qualification for the breakthrough award", () => {
    expect(
      calculateOverseasSalesAward({
        awardType: "KA_BREAKTHROUGH",
        firstSigning: true,
        annualCustomerOrderAmount: "10000000",
        kaQualified: false,
      }).grossAmount,
    ).toBe("0");
  });

  it("clamps fixed-range awards", () => {
    expect(
      calculateTechCenterAward({
        awardType: "SOFTWARE_GA_STABLE",
        approvedAmount: "100",
      }).grossAmount,
    ).toBe("3000");
    expect(
      calculateTechCenterAward({
        awardType: "KNOWLEDGE_CONTRIBUTION",
        quantity: 2,
        approvedAmount: "10",
      }).grossAmount,
    ).toBe("100");
  });
});

describe("performance weight validation", () => {
  it("rejects an incomplete weight set that is not N/A-renormalised", () => {
    expect(() =>
      scorePerformance({
        personId: "p1",
        period: "MONTHLY",
        metrics: [baseMetric, secondMetric],
        measurements: [
          { metricId: "M-001", rawValue: "100", applicable: true },
          { metricId: "M-002", rawValue: "100", applicable: true },
        ],
      }),
    ).toThrow(/100%/);
  });

  it("never pays a negative performance wage", () => {
    const result = calculateMonthlyPerformanceWage({
      monthlyTotalWage: "30000",
      wageBand: "BASE",
      monthlyScore: "-50",
    });
    expect(result.kp).toBe("0");
    expect(result.payable).toBe("0");
  });
});

describe("tiered brackets are order independent", () => {
  const input: CalculationInput = {
    tenantId: "tenant-demo",
    cycleId: "00000000-0000-4000-8000-000000000020",
    policyVersionId: "00000000-0000-4000-8000-000000000100",
    mode: "SHADOW",
    order: { id: "order-tiered-audit", grossProfit: "300", currency: "CNY" },
    participants: [
      {
        personId: "00000000-0000-4000-8000-000000000001",
        workPackageId: "wp-1",
        attributionWeight: "1",
        role: "OWNER",
      },
    ],
  };
  const policy: PolicyDefinition = {
    code: "AUDIT-TIERED",
    version: 1,
    currency: "CNY",
    poolRate: "0",
    poolCap: "1000000",
    rounding: "HALF_UP",
    calculator: "TIERED",
    tiers: [{ upTo: "100", ratePercent: "1" }],
  };

  it("produces the same payout for ascending and descending tier arrays", () => {
    const ascending = calculateByPolicy(
      {
        ...policy,
        tiers: [
          { upTo: "100", ratePercent: "1" },
          { upTo: "200", ratePercent: "2" },
        ],
      },
      input,
    );
    const descending = calculateByPolicy(
      {
        ...policy,
        tiers: [
          { upTo: "200", ratePercent: "2" },
          { upTo: "100", ratePercent: "1" },
        ],
      },
      input,
    );
    expect(descending.pool).toBe(ascending.pool);
    expect(ascending.pool).toBe("3");
  });
});
