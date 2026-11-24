import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import {
  calculateBusinessUnitCommission,
  calculateDbcp,
  calculateEquityTax,
  calculateOrderContribution,
  calculateRepurchase,
  currencyMinorUnits,
  currencyStep,
  formatCurrencyAmount,
  formatDecimal,
} from "../index.js";

const policy = (currency: string): PolicyDefinition => ({
  code: "ORDER_CONTRIBUTION_V1",
  version: 1,
  currency,
  poolRate: "1",
  poolCap: "100000",
  rounding: "HALF_UP",
});

const input = (currency: string, grossProfit: string): CalculationInput => ({
  tenantId: "tenant-1",
  cycleId: "cycle-1",
  policyVersionId: "policy-v1",
  mode: "SHADOW",
  order: { id: "order-1", grossProfit, currency },
  participants: [
    {
      personId: "00000000-0000-4000-8000-000000000001",
      workPackageId: "00000000-0000-4000-8000-000000000010",
      attributionWeight: "0.5",
      role: "OWNER",
    },
    {
      personId: "00000000-0000-4000-8000-000000000002",
      workPackageId: "00000000-0000-4000-8000-000000000010",
      attributionWeight: "0.5",
      role: "CONTRIBUTOR",
    },
  ],
});

describe("ISO 4217 currency precision", () => {
  it("knows zero-, two- and three-decimal currencies", () => {
    expect(currencyMinorUnits("JPY")).toBe(0);
    expect(currencyMinorUnits("USD")).toBe(2);
    expect(currencyMinorUnits("KWD")).toBe(3);
    expect(currencyMinorUnits("usd")).toBe(2);
    expect(currencyStep("JPY")).toBe(1_000_000n);
    expect(currencyStep("USD")).toBe(10_000n);
    expect(currencyStep("KWD")).toBe(1_000n);
  });

  it("rejects non-ISO currency codes", () => {
    expect(() => currencyMinorUnits("US")).toThrow(/INVALID_CURRENCY/);
    expect(() => currencyMinorUnits("RMB1")).toThrow(/INVALID_CURRENCY/);
  });

  it("formats to the currency minimum unit", () => {
    expect(formatCurrencyAmount(1_234_567n, "JPY")).toBe("1");
    expect(formatCurrencyAmount(1_234_567n, "USD")).toBe("1.23");
    expect(formatCurrencyAmount(1_234_567n, "KWD")).toBe("1.234");
    // 与既有 1e6 格式保持一致（无币种上下文时）。
    expect(formatDecimal(1_234_567n)).toBe("1.234567");
  });

  it("allocates JPY without fractional yen", () => {
    const result = calculateOrderContribution(policy("JPY"), input("JPY", "100"));
    expect(result.poolRounded).toBe("100");
    expect(result.lines.map((line) => line.roundedAmount)).toEqual(["50", "50"]);
  });

  it("allocates KWD at 0.001 precision", () => {
    const result = calculateOrderContribution(policy("KWD"), input("KWD", "1"));
    // 1 KWD 对半分：0.500 + 0.500，余数按 0.001 计。
    expect(result.lines.map((line) => line.roundedAmount)).toEqual(["0.5", "0.5"]);
    expect(
      result.lines.reduce(
        (sum, line) => sum + Number(line.roundedAmount),
        0,
      ),
    ).toBe(1);
  });

  it("allocates odd JPY pools without losing or inventing yen", () => {
    const result = calculateOrderContribution(policy("JPY"), input("JPY", "101"));
    const total = result.lines.reduce(
      (sum, line) => sum + Number(line.roundedAmount),
      0,
    );
    expect(total).toBe(101);
    for (const line of result.lines) {
      expect(line.roundedAmount).not.toContain(".");
    }
  });
});

describe("incentive modules use input currency", () => {
  it("rounds DBCP and commission to JPY whole yen", () => {
    const dbcp = calculateDbcp({
      grossProfit: "100.4",
      businessExpenses: "0",
      laborAndTravel: "0",
      allocatedBusinessUnitExpenses: "0",
      allocatedBackendPayroll: "0",
      managementProvisionRatePercent: "0",
      currency: "JPY",
    });
    expect(dbcp.grossProfit).toBe("100");
    expect(dbcp.dbcp).toBe("100");

    const commission = calculateBusinessUnitCommission({
      dbcp: "160",
      netCollection: "1000",
      currency: "JPY",
    });
    expect(commission.commission).not.toContain(".");
  });

  it("keeps CNY two-decimal behavior by default", () => {
    const dbcp = calculateDbcp({
      grossProfit: "100.44",
      businessExpenses: "0",
      laborAndTravel: "0",
      allocatedBusinessUnitExpenses: "0",
      allocatedBackendPayroll: "0",
      managementProvisionRatePercent: "0",
    });
    expect(dbcp.grossProfit).toBe("100.44");
  });
});

describe("equity repurchase uses the policy currency minor units", () => {
  const base = {
    scenario: "INVOLUNTARY" as const,
    holdingMonths: 24,
    costAmount: "0",
    shares: "9",
  };

  it("rounds JPY repurchase to whole yen (HALF_UP) and does not apply the CNY floor", () => {
    // 1234.567 × 0.8 × 9 = 8888.8824 → 8889 日元
    const result = calculateRepurchase({
      ...base,
      latestFinancingPrice: "1234.567",
      currency: "JPY",
    });
    expect(result.fairValuePerUnit).toBe("987.6536");
    expect(result.repurchasePrice).toBe("8889");
    expect(result.repurchasePrice).not.toContain(".");
    // 5 万元人民币最低回购价是 CNY 制度阈值，不套用到 JPY。
    expect(result.minimumPriceApplied).toBe(false);
    expect(result.note).toContain("非 CNY 币种未做汇率换算");
  });

  it("does not apply the CNY 50万 annual cap to non-CNY amounts", () => {
    // 100000 × 0.8 × 10 = 800000（若按 CNY 阈值会被判为可分期）
    const result = calculateRepurchase({
      scenario: "INVOLUNTARY",
      holdingMonths: 24,
      costAmount: "0",
      shares: "10",
      latestFinancingPrice: "100000",
      currency: "JPY",
    });
    expect(result.repurchasePrice).toBe("800000");
    expect(result.annualCapApplied).toBe(false);
    expect(result.installmentAllowed).toBe(false);
  });

  it("rounds KWD repurchase to 0.001", () => {
    // 1.234 × 0.8 × 3 = 2.9616 → 2.962 KWD
    const result = calculateRepurchase({
      ...base,
      shares: "3",
      latestFinancingPrice: "1.234",
      currency: "KWD",
    });
    expect(result.repurchasePrice).toBe("2.962");
    expect(result.minimumPriceApplied).toBe(false);
  });

  it("keeps the CNY 5万 floor and two-decimal precision by default", () => {
    const result = calculateRepurchase({
      scenario: "INVOLUNTARY",
      holdingMonths: 24,
      costAmount: "0",
      shares: "10000",
      latestFinancingPrice: "0.2",
    });
    expect(result.repurchasePrice).toBe("50000");
    expect(result.minimumPriceApplied).toBe(true);
    const explicit = calculateRepurchase({
      scenario: "INVOLUNTARY",
      holdingMonths: 24,
      costAmount: "0",
      shares: "10000",
      latestFinancingPrice: "0.2",
      currency: "CNY",
    });
    expect(explicit.repurchasePrice).toBe("50000");
    expect(explicit.minimumPriceApplied).toBe(true);
  });

  it("rejects non-ISO currency codes fail-closed", () => {
    expect(() =>
      calculateRepurchase({ ...base, latestFinancingPrice: "1", currency: "RMB1" }),
    ).toThrow(/INVALID_CURRENCY/);
  });
});

describe("equity tax uses the policy currency minor units", () => {
  it("rounds JPY taxableBase and taxAmount to whole yen", () => {
    // (150.4 - 100) × 3 = 151.2 → 151 日元；20% = 30.24 → 30 日元
    const result = calculateEquityTax({
      deferredFiling: false,
      strikePrice: "100",
      fairValuePerUnit: "150.4",
      units: "3",
      wageTaxRatePercent: "20",
      currency: "JPY",
    });
    expect(result.taxableBase).toBe("151");
    expect(result.taxAmount).toBe("30");
  });

  it("rounds JPY half yen up and never emits fractional yen", () => {
    // (0.5 - 0) × 1 = 0.5 → 1 日元
    const result = calculateEquityTax({
      deferredFiling: false,
      strikePrice: "0",
      fairValuePerUnit: "0.5",
      units: "1",
      currency: "JPY",
    });
    expect(result.taxableBase).toBe("1");
    expect(result.taxableBase).not.toContain(".");
  });

  it("rounds KWD deferred taxableBase and taxAmount to 0.001", () => {
    // (1.234567 - 1) × 1000 = 234.567 → 234.567 KWD；20% = 46.9134 → 46.913
    const result = calculateEquityTax({
      deferredFiling: true,
      strikePrice: "1",
      fairValuePerUnit: "1.5",
      salePricePerUnit: "1.234567",
      units: "1000",
      currency: "KWD",
    });
    expect(result.taxableBase).toBe("234.567");
    expect(result.taxAmount).toBe("46.913");
  });

  it("keeps the CNY two-decimal tax behavior by default", () => {
    const result = calculateEquityTax({
      deferredFiling: false,
      strikePrice: "1",
      fairValuePerUnit: "5",
      units: "1000",
      wageTaxRatePercent: "20",
    });
    expect(result.taxableBase).toBe("4000");
    expect(result.taxAmount).toBe("800");
  });
});
