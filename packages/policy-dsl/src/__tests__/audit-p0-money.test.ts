import { describe, expect, it } from "vitest";
import {
  calculateAnnualProfitSharing,
  calculateBountySettlement,
  calculateOverseasSalesAward,
  calculateTechCenterAward,
  calculateTechCenterPool,
} from "../index.js";

const person = (id: string) => ({
  personId: id,
  monthlyWageBase: "1000",
  gradeCoefficient: "1",
  weightedQuarterlyKp: "1",
  attendanceRatio: "1",
});

describe("P0 money invariants", () => {
  it("annual 0.50 pool / 100 people never produces a negative allocation", () => {
    const result = calculateAnnualProfitSharing({
      distributableNetProfit: "5",
      netProfitTarget: "1",
      poolRatePercent: "10",
      people: Array.from({ length: 100 }, (_, index) => person(`p${index}`)),
    });
    const amounts = result.allocations.map((row) => Number(row.amount));
    expect(amounts.every((amount) => amount >= 0)).toBe(true);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(0.5, 6);
    expect(amounts.filter((amount) => amount === 0.01)).toHaveLength(50);
  });

  it("annual sharing rejects duplicate people", () => {
    expect(() =>
      calculateAnnualProfitSharing({
        distributableNetProfit: "5",
        netProfitTarget: "1",
        poolRatePercent: "10",
        people: [person("same"), person("same")],
      }),
    ).toThrow(/DUPLICATE_PERSON_ID/);
  });

  it("annual negative reserved budget is ignored, not subtracted", () => {
    const result = calculateAnnualProfitSharing({
      distributableNetProfit: "5",
      netProfitTarget: "1",
      poolRatePercent: "10",
      reservedBudgetBalance: "-1",
      people: [person("p1")],
    });
    expect(result.approvedPoolAmount).toBe("0.5");
    expect(result.allocations[0]!.amount).toBe("0.5");
  });

  it("tech center pool never allocates more than the pool", () => {
    const result = calculateTechCenterPool({
      totalBusinessCommission: "0.1053",
      members: [
        { personId: "a", positionCoefficient: "1", projectContribution: "1", performanceCoefficient: "1" },
        { personId: "b", positionCoefficient: "1", projectContribution: "1", performanceCoefficient: "1" },
        { personId: "c", positionCoefficient: "1", projectContribution: "1", performanceCoefficient: "1" },
      ],
    });
    const total = result.allocations.reduce((sum, row) => sum + Number(row.amount), 0);
    expect(total).toBeLessThanOrEqual(Number(result.poolAmount));
    expect(total).toBeCloseTo(0.02, 6);
  });

  it("tech center JPY pool uses 0-decimal minor units", () => {
    const result = calculateTechCenterPool({
      totalBusinessCommission: "10.526315",
      currency: "JPY",
      members: [
        { personId: "a", positionCoefficient: "1", projectContribution: "1", performanceCoefficient: "1" },
        { personId: "b", positionCoefficient: "1", projectContribution: "1", performanceCoefficient: "1" },
        { personId: "c", positionCoefficient: "1", projectContribution: "1", performanceCoefficient: "1" },
      ],
    });
    const total = result.allocations.reduce((sum, row) => sum + Number(row.amount), 0);
    expect(total).toBeLessThanOrEqual(2);
    expect(result.allocations.every((row) => !row.amount.includes("."))).toBe(true);
  });

  it("bounty settlement uses currency minor units (JPY has no decimals)", () => {
    const result = calculateBountySettlement({
      baseReward: "101",
      delayWorkingDays: 0,
      qualityGrade: "PASS",
      personalContributionShare: "0.5",
      currency: "JPY",
    });
    expect(result.amount).toBe("51");
  });

  it("bounty share outside 0..1 is rejected", () => {
    expect(() =>
      calculateBountySettlement({
        baseReward: "100",
        delayWorkingDays: 0,
        qualityGrade: "PASS",
        personalContributionShare: "1.5",
      }),
    ).toThrow(/personalContributionShare/);
  });

  it("tech award negative delay cannot increase the award", () => {
    const base = calculateTechCenterAward({
      awardType: "HARDWARE_AC_DELIVERY",
      quantity: 1,
    });
    const negative = calculateTechCenterAward({
      awardType: "HARDWARE_AC_DELIVERY",
      quantity: 1,
      delayRatio: "-0.5",
    });
    expect(Number(negative.personalAmount)).toBeLessThanOrEqual(
      Number(base.personalAmount),
    );
  });

  it("tech award personalShare outside 0..1 is rejected", () => {
    expect(() =>
      calculateTechCenterAward({ awardType: "SLA_MONTH", personalShare: "2" }),
    ).toThrow(/personalShare/);
  });

  it("overseas new-customer award fails closed without verified qualified count", () => {
    const result = calculateOverseasSalesAward({
      awardType: "NEW_CUSTOMER_STAR",
      newCustomerCount: 8,
    });
    expect(result.grossAmount).toBe("0");
    expect(result.note).toMatch(/缺少核实/);
  });

  it("overseas KA award requires explicit qualification", () => {
    const result = calculateOverseasSalesAward({
      awardType: "KA_BREAKTHROUGH",
      firstSigning: true,
      annualCustomerOrderAmount: "10000000",
    });
    expect(result.grossAmount).toBe("0");
  });
});
