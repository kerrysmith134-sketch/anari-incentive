import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import {
  PolicyGateError,
  calculateChargingEquipmentSales,
} from "../index.js";

const policy: PolicyDefinition = {
  code: "CHARGING_EQUIPMENT_SALES_V1",
  version: 1,
  currency: "CNY",
  poolRate: "0.035",
  poolCap: "120000",
  rounding: "HALF_UP",
  cashCollectionWeight: "0.5",
  afterSalesReserveRate: "0.03",
  creditGate: { requireCreditApproval: true, blockOnQualityHold: true },
};

function input(overrides: Partial<CalculationInput["order"]> = {}): CalculationInput {
  return {
    tenantId: "tenant-demo",
    cycleId: "00000000-0000-4000-8000-000000000020",
    policyVersionId: "00000000-0000-4000-8000-000000000102",
    mode: "SHADOW",
    order: {
      id: "equipment-order-001",
      grossProfit: "600000",
      currency: "CNY",
      invoiceAmount: "3000000",
      cashCollected: "2400000",
      creditApproved: true,
      qualityHold: false,
      channelShare: "0",
      ...overrides,
    },
    participants: [
      {
        personId: "00000000-0000-4000-8000-000000000001",
        workPackageId: "00000000-0000-4000-8000-000000000010",
        attributionWeight: "0.6",
        role: "SALES_LEAD",
      },
      {
        personId: "00000000-0000-4000-8000-000000000002",
        workPackageId: "00000000-0000-4000-8000-000000000010",
        attributionWeight: "0.4",
        role: "PRODUCT_MANAGER",
      },
    ],
  };
}

describe("charging equipment sales", () => {
  it("applies cash weighting and after-sales reserve", () => {
    const result = calculateChargingEquipmentSales(policy, input());
    // base 21,000; factor 0.8; adjusted 18,900; reserve 567; payable 18,333
    expect(result.pool).toBe("21000");
    expect(result.cashFactor).toBe("0.8");
    expect(result.afterSalesReserve).toBe("567");
    expect(result.poolRounded).toBe("18333");
    expect(result.lines.map((line) => line.roundedAmount)).toEqual([
      "10999.8",
      "7333.2",
    ]);
    expect(
      result.lines.reduce((sum, line) => sum + Number(line.roundedAmount), 0),
    ).toBe(18333);
  });

  it("splits channel share out of the internal pool", () => {
    const result = calculateChargingEquipmentSales(
      policy,
      input({
        id: "equipment-order-002",
        grossProfit: "200000",
        invoiceAmount: "1000000",
        cashCollected: "1000000",
        channelPartnerId: "partner-001",
        channelShare: "0.15",
      }),
    );
    // base 7,000; reserve 210; payable 6,790; channel 1,018.5; internal 5,771.5
    expect(result.pool).toBe("7000");
    expect(result.afterSalesReserve).toBe("210");
    expect(result.channelPool).toBe("1018.5");
    expect(result.internalPool).toBe("5771.5");
    expect(result.poolRounded).toBe("5771.5");
  });

  it("caps the pool", () => {
    const result = calculateChargingEquipmentSales(
      policy,
      input({
        id: "equipment-order-003",
        grossProfit: "10000000",
        invoiceAmount: "20000000",
        cashCollected: "10000000",
      }),
    );
    expect(result.pool).toBe("120000");
    expect(result.cashFactor).toBe("0.5");
    expect(result.poolRounded).toBe("87300");
  });

  it("blocks without credit approval", () => {
    expect(() =>
      calculateChargingEquipmentSales(
        policy,
        input({ creditApproved: false }),
      ),
    ).toThrow(PolicyGateError);
  });

  it("blocks on quality hold", () => {
    expect(() =>
      calculateChargingEquipmentSales(policy, input({ qualityHold: true })),
    ).toThrow(/QUALITY_HOLD/);
  });

  it("blocks a channel share without a partner", () => {
    expect(() =>
      calculateChargingEquipmentSales(
        policy,
        input({ channelShare: "0.1" }),
      ),
    ).toThrow(/CHANNEL_PARTNER_MISSING/);
  });
});
