import { describe, expect, it } from "vitest";
import {
  CHINA_IIT_ANNUAL_BRACKETS,
  calculateCumulativeIit,
  monthlyTaxableIncome,
} from "../index.js";

describe("calculateCumulativeIit", () => {
  it.each([
    ["0", "0"],
    ["3000", "90"],
    ["36000", "1080"],
    ["40000", "1480"],
    ["144000", "11880"],
    ["150000", "13080"],
    ["300000", "43080"],
    ["420000", "73080"],
    ["660000", "145080"],
    ["960000", "250080"],
    ["1000000", "268080"],
  ])("computes annual tax for cumulative income %s", (income, expected) => {
    const result = calculateCumulativeIit({
      cumulativeTaxableIncome: income,
    });
    expect(result.annualTaxDue).toBe(expected);
    expect(result.taxForPeriod).toBe(expected);
  });

  it("keeps the boundary amount in the lower bracket", () => {
    expect(
      calculateCumulativeIit({ cumulativeTaxableIncome: "36000.01" })
        .ratePercent,
    ).toBe(10);
    expect(
      calculateCumulativeIit({ cumulativeTaxableIncome: "36000" }).ratePercent,
    ).toBe(3);
  });

  it("rounds withholding to fen (0.01 CNY)", () => {
    expect(
      calculateCumulativeIit({ cumulativeTaxableIncome: "40000.005" })
        .annualTaxDue,
    ).toBe("1480");
    expect(
      calculateCumulativeIit({ cumulativeTaxableIncome: "40000.055" })
        .annualTaxDue,
    ).toBe("1480.01");
  });

  it("subtracts tax already withheld to get the period amount", () => {
    const result = calculateCumulativeIit({
      cumulativeTaxableIncome: "40000",
      taxAlreadyWithheld: "1000",
    });
    expect(result.annualTaxDue).toBe("1480");
    expect(result.taxAlreadyWithheld).toBe("1000");
    expect(result.taxForPeriod).toBe("480");
  });

  it("never produces a negative period amount when withholding exceeded the annual due", () => {
    const result = calculateCumulativeIit({
      cumulativeTaxableIncome: "40000",
      taxAlreadyWithheld: "2000",
    });
    expect(result.taxForPeriod).toBe("0");
  });

  it("handles negative taxable income as zero", () => {
    const result = calculateCumulativeIit({
      cumulativeTaxableIncome: "-100",
    });
    expect(result.annualTaxDue).toBe("0");
    expect(result.ratePercent).toBe(0);
  });

  it("supports a caller-supplied bracket table", () => {
    const result = calculateCumulativeIit({
      cumulativeTaxableIncome: "1000",
      brackets: [
        { upTo: null, ratePercent: 50, quickDeduction: "0" },
      ],
    });
    expect(result.annualTaxDue).toBe("500");
    expect(CHINA_IIT_ANNUAL_BRACKETS).toHaveLength(7);
  });
});

describe("monthlyTaxableIncome", () => {
  it("subtracts social insurance, special deductions and the basic deduction", () => {
    expect(
      monthlyTaxableIncome({
        grossIncome: "20000",
        socialInsurance: "2000",
        specialAdditionalDeductions: "1000",
      }),
    ).toBe("12000");
  });

  it("defaults the basic deduction to 5000", () => {
    expect(monthlyTaxableIncome({ grossIncome: "8000" })).toBe("3000");
  });

  it("floors taxable income at zero", () => {
    expect(monthlyTaxableIncome({ grossIncome: "3000" })).toBe("0");
  });
});
