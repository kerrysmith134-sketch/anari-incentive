/**
 * 审计加固批（P1）：负池参数拒绝、cap 舍入钳制、内部拆最大余数。
 */
import { describe, expect, it } from "vitest";
import {
  calculateInternalSplit,
  calculateOrderContribution,
} from "../index.js";

const policy = {
  code: "POOL_GUARD",
  version: 1,
  currency: "CNY",
  poolRate: "0.05",
  poolCap: "100000",
  rounding: "HALF_UP" as const,
  calculator: "SIMPLE_POOL" as const,
  evaluation: { dimensionWeights: { QUALITY: "1" }, floor: "0.5", ceiling: "1.5" },
};

const calculationInput = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  cycleId: "00000000-0000-4000-8000-000000000020",
  policyVersionId: "00000000-0000-4000-8000-000000000100",
  mode: "SHADOW" as const,
  order: { id: "order-1", grossProfit: "100000", currency: "CNY" },
  participants: [
    {
      personId: "00000000-0000-4000-8000-000000000001",
      workPackageId: "00000000-0000-4000-8000-000000000010",
      attributionWeight: "1",
      role: "OWNER" as const,
      evaluationMultiplier: "1",
    },
  ],
};

describe("audit hardening: pool guards", () => {
  it("rejects negative poolRate / poolCap at calculation time", () => {
    expect(() =>
      calculateOrderContribution(
        { ...policy, poolRate: "-0.05" },
        calculationInput,
      ),
    ).toThrow(/cannot be negative/i);
    expect(() =>
      calculateOrderContribution(
        { ...policy, poolCap: "-1" },
        calculationInput,
      ),
    ).toThrow(/cannot be negative/i);
  });

  it("rounded pool never exceeds the cap", () => {
    const result = calculateOrderContribution(
      { ...policy, poolRate: "0.05", poolCap: "10.005" },
      { ...calculationInput, order: { ...calculationInput.order, grossProfit: "1000" } },
    );
    // 10.005 上限 → 舍入后的池不得超过 cap 的 2 位下限 10.00
    expect(result.poolRounded).toBe("10");
  });
});

describe("audit hardening: internal split uses largest remainder", () => {
  it("allocations never exceed the remaining pool and sum exactly to the quantized totals", () => {
    const people = Array.from({ length: 100 }, (_, index) => ({
      personId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      sharePercent: "1",
    }));
    const result = calculateInternalSplit({
      commissionPool: "0.50",
      marketingReward: "0",
      executiveSupplement: "0",
      participants: people,
    });
    // 之前：每人 1% 的 0.005 各自 HALF_UP → 合计 1.00（超过剩余池 0.50）
    const total = result.allocations.reduce(
      (acc, entry) => acc + Math.round(Number(entry.amount) * 100),
      0,
    );
    expect(total).toBeLessThanOrEqual(50);
    expect(result.valid).toBe(true);
  });

  it("keeps the remainder deterministic for uneven splits", () => {
    const result = calculateInternalSplit({
      commissionPool: "100.01",
      marketingReward: "0",
      executiveSupplement: "0",
      participants: [
        { personId: "00000000-0000-4000-8000-00000000000b", sharePercent: "33.33" },
        { personId: "00000000-0000-4000-8000-00000000000a", sharePercent: "33.33" },
        { personId: "00000000-0000-4000-8000-00000000000c", sharePercent: "33.34" },
      ],
    });
    const cents = result.allocations.map((entry) =>
      Math.round(Number(entry.amount) * 100),
    );
    const total = cents.reduce((acc, value) => acc + value, 0);
    expect(total).toBe(10001);
    expect(result.valid).toBe(true);
  });
});
