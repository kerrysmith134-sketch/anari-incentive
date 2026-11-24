import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import {
  calculateOrderContribution,
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
