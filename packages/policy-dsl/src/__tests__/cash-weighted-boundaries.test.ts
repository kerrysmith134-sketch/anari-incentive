/**
 * 2026-11-21 审计：现金加权模型（retention / reserve-channel）必须在
 * 计算入口 fail-closed 校验范围，负现金、>1 权重、零合同额、负池上限等
 * 不得产生负数金额或超额激励池；合法边界 0 / 1 必须放行。
 */
import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import {
  PolicyRangeError,
  calculateCashWeightedReserveChannel,
  calculateCashWeightedRetention,
} from "../index.js";

const retentionPolicy: PolicyDefinition = {
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

const reservePolicy: PolicyDefinition = {
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

function retentionInput(
  overrides: Partial<CalculationInput["order"]> = {},
): CalculationInput {
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
        attributionWeight: "0.5",
        role: "SOLUTION_ENGINEER",
      },
    ],
  };
}

function reserveInput(
  overrides: Partial<CalculationInput["order"]> = {},
): CalculationInput {
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
        attributionWeight: "0.5",
        role: "SALES_LEAD",
      },
      {
        personId: "00000000-0000-4000-8000-000000000002",
        workPackageId: "00000000-0000-4000-8000-000000000010",
        attributionWeight: "0.5",
        role: "PRODUCT_MANAGER",
      },
    ],
  };
}

function expectRangeError(run: () => unknown, field: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PolicyRangeError);
    expect((error as PolicyRangeError).code).toBe("POLICY_RANGE_VIOLATION");
    expect((error as PolicyRangeError).field).toBe(field);
    return;
  }
  throw new Error(`expected PolicyRangeError for ${field}, but call succeeded`);
}

describe("cash-weighted retention — input range fail-closed", () => {
  it("拒绝负现金、负数/超限权重与负池参数", () => {
    expectRangeError(
      () =>
        calculateCashWeightedRetention(
          retentionPolicy,
          retentionInput({ cashCollected: "-1" }),
        ),
      "cashCollected",
    );
    for (const weight of ["-0.1", "1.0001", "2"]) {
      expectRangeError(
        () =>
          calculateCashWeightedRetention(
            { ...retentionPolicy, cashCollectionWeight: weight },
            retentionInput(),
          ),
        "cashCollectionWeight",
      );
    }
    for (const rate of ["-0.01", "1.01"]) {
      expectRangeError(
        () =>
          calculateCashWeightedRetention(
            { ...retentionPolicy, retentionHoldbackRate: rate },
            retentionInput(),
          ),
        "retentionHoldbackRate",
      );
    }
    expectRangeError(
      () =>
        calculateCashWeightedRetention(
          { ...retentionPolicy, poolRate: "-0.04" },
          retentionInput(),
        ),
      "poolRate",
    );
    expectRangeError(
      () =>
        calculateCashWeightedRetention(
          { ...retentionPolicy, poolCap: "-1" },
          retentionInput(),
        ),
      "poolCap",
    );
  });

  it("拒绝零合同额与负毛利的输入", () => {
    expectRangeError(
      () =>
        calculateCashWeightedRetention(
          retentionPolicy,
          retentionInput({ contractAmount: "0" }),
        ),
      "contractAmount",
    );
    expectRangeError(
      () =>
        calculateCashWeightedRetention(
          retentionPolicy,
          retentionInput({ contractAmount: "-100", cashCollected: "0" }),
        ),
      "contractAmount",
    );
    expectRangeError(
      () =>
        calculateCashWeightedRetention(
          retentionPolicy,
          retentionInput({ grossProfit: "-1" }),
        ),
      "grossProfit",
    );
  });

  it("合法边界 0 与 1 通过：cashCollectionWeight", () => {
    const noWeight = calculateCashWeightedRetention(
      { ...retentionPolicy, cashCollectionWeight: "0" },
      retentionInput(),
    );
    expect(noWeight.cashFactor).toBe("0.75");
    expect(noWeight.poolRounded).toBe("38000");
    expect(noWeight.retentionHeld).toBe("2000");

    const fullWeight = calculateCashWeightedRetention(
      { ...retentionPolicy, cashCollectionWeight: "1" },
      retentionInput(),
    );
    expect(fullWeight.poolRounded).toBe("28500");
    expect(fullWeight.retentionHeld).toBe("1500");
  });

  it("合法边界 retentionHoldbackRate=1 不产生负应发金额", () => {
    const result = calculateCashWeightedRetention(
      { ...retentionPolicy, retentionHoldbackRate: "1" },
      retentionInput(),
    );
    expect(result.poolRounded).toBe("0");
    expect(result.retentionHeld).toBe("36000");
    expect(result.lines.every((line) => line.roundedAmount === "0")).toBe(true);
  });

  it("合法边界 cashCollected=0 与足额收款通过，超额收款不会超额计算", () => {
    const zeroCash = calculateCashWeightedRetention(
      retentionPolicy,
      retentionInput({ cashCollected: "0" }),
    );
    expect(zeroCash.cashFactor).toBe("0");

    const fullCash = calculateCashWeightedRetention(
      retentionPolicy,
      retentionInput({ cashCollected: "2000000" }),
    );
    expect(fullCash.cashFactor).toBe("1");

    const overCash = calculateCashWeightedRetention(
      retentionPolicy,
      retentionInput({ cashCollected: "3000000" }),
    );
    expect(overCash.cashFactor).toBe("1");
    expect(overCash.poolRounded).toBe(fullCash.poolRounded);
  });
});

describe("cash-weighted reserve channel — input range fail-closed", () => {
  it("拒绝零/负发票金额与负现金", () => {
    expectRangeError(
      () =>
        calculateCashWeightedReserveChannel(
          reservePolicy,
          reserveInput({ invoiceAmount: "0" }),
        ),
      "invoiceAmount",
    );
    expectRangeError(
      () =>
        calculateCashWeightedReserveChannel(
          reservePolicy,
          reserveInput({ invoiceAmount: "-1" }),
        ),
      "invoiceAmount",
    );
    expectRangeError(
      () =>
        calculateCashWeightedReserveChannel(
          reservePolicy,
          reserveInput({ cashCollected: "-0.01" }),
        ),
      "cashCollected",
    );
  });

  it("拒绝负池参数与超限权重/预留比例", () => {
    expectRangeError(
      () =>
        calculateCashWeightedReserveChannel(
          { ...reservePolicy, poolRate: "-0.01" },
          reserveInput(),
        ),
      "poolRate",
    );
    expectRangeError(
      () =>
        calculateCashWeightedReserveChannel(
          { ...reservePolicy, poolCap: "-1" },
          reserveInput(),
        ),
      "poolCap",
    );
    for (const weight of ["-0.1", "1.01"]) {
      expectRangeError(
        () =>
          calculateCashWeightedReserveChannel(
            { ...reservePolicy, cashCollectionWeight: weight },
            reserveInput(),
          ),
        "cashCollectionWeight",
      );
    }
    for (const rate of ["-0.01", "1.01"]) {
      expectRangeError(
        () =>
          calculateCashWeightedReserveChannel(
            { ...reservePolicy, afterSalesReserveRate: rate },
            reserveInput(),
          ),
        "afterSalesReserveRate",
      );
    }
    for (const share of ["-0.01", "1.01"]) {
      expectRangeError(
        () =>
          calculateCashWeightedReserveChannel(
            reservePolicy,
            reserveInput({ channelShare: share, channelPartnerId: "partner-1" }),
          ),
        "channelShare",
      );
    }
  });

  it("合法边界 0 与 1 通过：权重、预留比例、渠道比例", () => {
    const noWeight = calculateCashWeightedReserveChannel(
      { ...reservePolicy, cashCollectionWeight: "0" },
      reserveInput(),
    );
    expect(noWeight.pool).toBe("21000");
    expect(noWeight.afterSalesReserve).toBe("630");
    expect(noWeight.internalPool).toBe("20370");

    const fullWeight = calculateCashWeightedReserveChannel(
      { ...reservePolicy, cashCollectionWeight: "1" },
      reserveInput(),
    );
    expect(fullWeight.pool).toBe("21000");
    expect(fullWeight.internalPool).toBe("16296");

    const fullReserve = calculateCashWeightedReserveChannel(
      { ...reservePolicy, afterSalesReserveRate: "1" },
      reserveInput(),
    );
    expect(fullReserve.internalPool).toBe("0");
    expect(fullReserve.channelPool).toBe("0");

    const fullChannel = calculateCashWeightedReserveChannel(
      reservePolicy,
      reserveInput({ channelShare: "1", channelPartnerId: "partner-1" }),
    );
    expect(fullChannel.channelPool).toBe("18333");
    expect(fullChannel.internalPool).toBe("0");
  });
});
