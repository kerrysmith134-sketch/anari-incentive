import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import { calculateByPolicy } from "../calculate.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";

const basePolicy: PolicyDefinition = {
  code: "TDD-TIERED",
  version: 1,
  currency: "CNY",
  poolRate: "0",
  poolCap: "999999999",
  rounding: "HALF_UP",
  calculator: "TIERED",
  tiers: [
    { upTo: "500000", ratePercent: "3" },
    { upTo: "1000000", ratePercent: "5" },
    { upTo: null, ratePercent: "8" },
  ],
};

const input: CalculationInput = {
  tenantId: 'tenant-demo',
  cycleId: "00000000-0000-4000-8000-000000000020",
  policyVersionId: "00000000-0000-4000-8000-000000000100",
  mode: "SHADOW",
  order: {
    id: "order-tiered",
    grossProfit: "1200000",
    currency: "CNY",
  },
  participants: [
    {
      personId: OWNER,
      workPackageId: "wp-1",
      attributionWeight: "0.6",
      role: "OWNER",
    },
    {
      personId: MEMBER,
      workPackageId: "wp-1",
      attributionWeight: "0.4",
      role: "CONTRIBUTOR",
    },
  ],
};

describe("TIERED calculator", () => {
  it("computes escalating brackets: 50万×3% + 50万×5% + 20万×8%", () => {
    const result = calculateByPolicy(basePolicy, input);
    // 15000 + 25000 + 16000 = 56000
    expect(result.pool).toBe("56000");
    const total = result.lines.reduce(
      (sum, line) => sum + Number(line.roundedAmount),
      0,
    );
    expect(total).toBe(56000);
  });

  it("caps the commission at poolCap", () => {
    const capped = {
      ...basePolicy,
      poolCap: "30000",
    };
    const result = calculateByPolicy(capped, input);
    expect(result.pool).toBe("56000");
    expect(result.poolRounded).toBe("30000");
    const total = result.lines.reduce(
      (sum, line) => sum + Number(line.roundedAmount),
      0,
    );
    expect(total).toBe(30000);
  });

  it("is deterministic — same input, same result hash", () => {
    const a = calculateByPolicy(basePolicy, input);
    const b = calculateByPolicy(basePolicy, input);
    expect(a.resultHash).toBe(b.resultHash);
  });

  it("rejects a TIERED policy without tiers", () => {
    expect(() => calculateByPolicy({ ...basePolicy, tiers: [] }, input)).toThrow(
      /at least one tier/,
    );
  });

  it("handles below-first-bracket gross profit", () => {
    const small: CalculationInput = {
      ...input,
      order: { ...input.order, grossProfit: "100000" },
    };
    const result = calculateByPolicy(basePolicy, small);
    // 100000 × 3% = 3000
    expect(result.pool).toBe("3000");
  });
});

const teamPolicy: PolicyDefinition = {
  code: "TDD-TEAM",
  version: 1,
  currency: "CNY",
  poolRate: "0.05",
  poolCap: "100000",
  rounding: "HALF_UP",
  calculator: "TEAM_POOL",
  roleWeights: { OWNER: "1.5", CONTRIBUTOR: "0.75" },
};

describe("TEAM_POOL calculator", () => {
  it("applies role weights to attribution weights before allocation", () => {
    const result = calculateByPolicy(teamPolicy, input);
    // pool = 1200000 × 5% = 60000, capped at 100000 → 60000
    expect(result.pool).toBe("60000");
    // effective weights 0.6×1.5=0.9 vs 0.4×0.75=0.3 → 75% / 25%
    const ownerLine = result.lines.find((line) => line.personId === OWNER)!;
    const memberLine = result.lines.find(
      (line) => line.personId === MEMBER,
    )!;
    expect(Number(ownerLine.roundedAmount)).toBe(45000);
    expect(Number(memberLine.roundedAmount)).toBe(15000);
    expect(result.lines[0]?.incentiveType).toBe("TEAM_CONTRIBUTION");
  });

  it("defaults missing role weights to 1", () => {
    const result = calculateByPolicy(
      { ...teamPolicy, roleWeights: {} },
      input,
    );
    const ownerLine = result.lines.find((line) => line.personId === OWNER)!;
    const memberLine = result.lines.find(
      (line) => line.personId === MEMBER,
    )!;
    // weights 0.6 / 0.4 → 36000 / 24000
    expect(Number(ownerLine.roundedAmount)).toBe(36000);
    expect(Number(memberLine.roundedAmount)).toBe(24000);
  });

  it("is deterministic", () => {
    const a = calculateByPolicy(teamPolicy, input);
    const b = calculateByPolicy(teamPolicy, input);
    expect(a.resultHash).toBe(b.resultHash);
  });
});
