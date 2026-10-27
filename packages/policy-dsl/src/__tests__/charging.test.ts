import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import {
  PolicyGateError,
  calculateChargingProjectContribution,
} from "../index.js";

const policy: PolicyDefinition = {
  code: "CHARGING_PROJECT_CONTRIBUTION_V1",
  version: 1,
  currency: "CNY",
  poolRate: "0.04",
  poolCap: "150000",
  rounding: "HALF_UP",
  cashCollectionWeight: "0.4",
  retentionHoldbackRate: "0.05",
  qualityGate: { requireAcceptance: true, blockOnSafetyIncident: true },
};

function input(overrides: Partial<CalculationInput["order"]> = {}): CalculationInput {
  return {
    tenantId: "tenant-demo",
    cycleId: "00000000-0000-4000-8000-000000000020",
    policyVersionId: "00000000-0000-4000-8000-000000000101",
    mode: "SHADOW",
    order: {
      id: "charging-site-001",
      grossProfit: "1000000",
      currency: "CNY",
      contractAmount: "2000000",
      cashCollected: "1500000",
      projectType: "DC_FAST_CHARGING_STATION",
      siteId: "site-001",
      safetyIncidents: 0,
      acceptanceStatus: "ACCEPTED",
      ...overrides,
    },
    participants: [
      {
        personId: "00000000-0000-4000-8000-000000000001",
        workPackageId: "00000000-0000-4000-8000-000000000010",
        attributionWeight: "0.5",
        role: "SALES_LEAD",
      },
      {
        personId: "00000000-0000-4000-8000-000000000002",
        workPackageId: "00000000-0000-4000-8000-000000000010",
        attributionWeight: "0.3",
        role: "SOLUTION_ENGINEER",
      },
      {
        personId: "00000000-0000-4000-8000-000000000003",
        workPackageId: "00000000-0000-4000-8000-000000000010",
        attributionWeight: "0.2",
        role: "DELIVERY_MANAGER",
      },
    ],
  };
}

describe("charging project contribution", () => {
  it("applies cash collection and retention holdback", () => {
    const result = calculateChargingProjectContribution(policy, input());
    // base 40,000; cash factor 0.75; adjusted 36,000; retention 1,800; payable 34,200
    expect(result.pool).toBe("40000");
    expect(result.cashFactor).toBe("0.75");
    expect(result.retentionHeld).toBe("1800");
    expect(result.poolRounded).toBe("34200");
    expect(result.lines.map((line) => line.roundedAmount)).toEqual([
      "17100",
      "10260",
      "6840",
    ]);
    expect(
      result.lines.reduce((sum, line) => sum + Number(line.roundedAmount), 0),
    ).toBe(34200);
  });

  it("pays the full cash-adjusted pool when collected", () => {
    const result = calculateChargingProjectContribution(
      policy,
      input({ cashCollected: "2000000" }),
    );
    expect(result.cashFactor).toBe("1");
    expect(result.poolRounded).toBe("38000");
    expect(result.retentionHeld).toBe("2000");
  });

  it("reduces the pool when no cash is collected", () => {
    const result = calculateChargingProjectContribution(
      policy,
      input({ cashCollected: "0" }),
    );
    expect(result.cashFactor).toBe("0");
    expect(result.poolRounded).toBe("22800");
    expect(result.retentionHeld).toBe("1200");
  });

  it("blocks on an open safety incident", () => {
    expect(() =>
      calculateChargingProjectContribution(
        policy,
        input({ safetyIncidents: 1 }),
      ),
    ).toThrow(PolicyGateError);
  });

  it("blocks before customer acceptance", () => {
    expect(() =>
      calculateChargingProjectContribution(
        policy,
        input({ acceptanceStatus: "PENDING" }),
      ),
    ).toThrow(/ACCEPTANCE_NOT_COMPLETE/);
  });

  it("is deterministic for the same input", () => {
    const a = calculateChargingProjectContribution(policy, input());
    const b = calculateChargingProjectContribution(policy, input());
    expect(a.resultHash).toBe(b.resultHash);
  });
});
