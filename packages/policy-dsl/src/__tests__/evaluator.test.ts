import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import {
  calculateOrderContribution,
  compareWithReference,
  formatDecimal,
  parseDecimal,
} from "../index.js";

const policy: PolicyDefinition = {
  code: "ORDER_CONTRIBUTION_V1",
  version: 1,
  currency: "CNY",
  poolRate: "0.05",
  poolCap: "100000",
  rounding: "HALF_UP",
};

function input(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    tenantId: "tenant-1",
    cycleId: "cycle-1",
    policyVersionId: "policy-v1",
    mode: "SHADOW",
    order: { id: "order-1", grossProfit: "100000", currency: "CNY" },
    participants: [
      {
        personId: "00000000-0000-4000-8000-000000000003",
        workPackageId: "00000000-0000-4000-8000-000000000010",
        attributionWeight: "0.5",
        role: "OWNER",
      },
      {
        personId: "00000000-0000-4000-8000-000000000001",
        workPackageId: "00000000-0000-4000-8000-000000000010",
        attributionWeight: "0.3",
        role: "CONTRIBUTOR",
      },
      {
        personId: "00000000-0000-4000-8000-000000000002",
        workPackageId: "00000000-0000-4000-8000-000000000010",
        attributionWeight: "0.2",
        role: "CONTRIBUTOR",
      },
    ],
    ...overrides,
  };
}

describe("decimal", () => {
  it("parses and formats without floating point drift", () => {
    expect(formatDecimal(parseDecimal("0.1"))).toBe("0.1");
    expect(formatDecimal(parseDecimal("100.05"))).toBe("100.05");
    expect(formatDecimal(parseDecimal("-3.5"))).toBe("-3.5");
  });
});

describe("calculateOrderContribution", () => {
  it("allocates the pool by normalized attribution weights", () => {
    const result = calculateOrderContribution(policy, input());
    expect(result.pool).toBe("5000");
    expect(result.poolRounded).toBe("5000");
    expect(result.lines.map((line) => line.roundedAmount)).toEqual([
      "2500",
      "1500",
      "1000",
    ]);
    expect(result.lines.reduce((sum, line) => sum + Number(line.roundedAmount), 0)).toBe(5000);
  });

  it("applies the pool cap", () => {
    const result = calculateOrderContribution(
      policy,
      input({ order: { id: "order-1", grossProfit: "10000000", currency: "CNY" } }),
    );
    expect(result.pool).toBe("100000");
    expect(result.lines.reduce((sum, line) => sum + Number(line.roundedAmount), 0)).toBe(100000);
  });

  it("allocates leftover cents deterministically", () => {
    const result = calculateOrderContribution(
      policy,
      input({
        order: { id: "order-1", grossProfit: "100", currency: "CNY" },
        participants: [
          {
            personId: "00000000-0000-4000-8000-000000000001",
            workPackageId: "00000000-0000-4000-8000-000000000010",
            attributionWeight: "1",
            role: "OWNER",
          },
          {
            personId: "00000000-0000-4000-8000-000000000002",
            workPackageId: "00000000-0000-4000-8000-000000000010",
            attributionWeight: "1",
            role: "CONTRIBUTOR",
          },
          {
            personId: "00000000-0000-4000-8000-000000000003",
            workPackageId: "00000000-0000-4000-8000-000000000010",
            attributionWeight: "1",
            role: "CONTRIBUTOR",
          },
        ],
      }),
    );
    expect(result.pool).toBe("5");
    expect(result.lines.reduce((sum, line) => sum + Number(line.roundedAmount), 0)).toBe(5);
    const amounts = result.lines.map((line) => line.roundedAmount).sort();
    expect(amounts).toEqual(["1.66", "1.67", "1.67"]);
  });

  it("is deterministic: same input produces the same result hash", () => {
    const a = calculateOrderContribution(policy, input());
    const b = calculateOrderContribution(policy, input());
    expect(a.resultHash).toBe(b.resultHash);
    expect(a.inputSnapshotHash).toBe(b.inputSnapshotHash);
  });

  it("matches the independent reference implementation", () => {
    const result = calculateOrderContribution(policy, input());
    expect(compareWithReference(policy, input(), result.lines)).toEqual([]);
  });

  it("rejects negative gross profit", () => {
    expect(() =>
      calculateOrderContribution(
        policy,
        input({ order: { id: "order-1", grossProfit: "-1", currency: "CNY" } }),
      ),
    ).toThrow(/negative/i);
  });

  it("rejects currency mismatch", () => {
    expect(() =>
      calculateOrderContribution(
        policy,
        input({ order: { id: "order-1", grossProfit: "100", currency: "USD" } }),
      ),
    ).toThrow(/currency/i);
  });

  it("rejects a zero total weight", () => {
    expect(() =>
      calculateOrderContribution(
        policy,
        input({
          participants: [
            {
              personId: "00000000-0000-4000-8000-000000000001",
              workPackageId: "00000000-0000-4000-8000-000000000010",
              attributionWeight: "0",
              role: "OWNER",
            },
          ],
        }),
      ),
    ).toThrow(/positive weight/i);
  });
});
