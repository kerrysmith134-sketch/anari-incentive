import type {
  CapTableSnapshotInput,
  CapTableSnapshotResult,
  EquityPositionLevel,
  FinancingStage,
  GrantCalculationInput,
  GrantCalculationResult,
  RepurchaseInput,
  RepurchaseResult,
  VestingPoint,
  VestingScheduleInput,
  VestingScheduleResult,
} from "@anari/domain";
import {
  div,
  formatDecimal,
  max,
  min,
  mul,
  parseDecimal,
  roundTo,
  sub,
  sum,
} from "./decimal.js";

const HUNDRED = parseDecimal("100");
const ZERO = parseDecimal("0");

/** 第9条 岗位基准配股矩阵（百分数，完全摊薄后）。 */
const POSITION_MATRIX: Record<
  EquityPositionLevel,
  Record<FinancingStage, [string, string]>
> = {
  L1: { PRE_A: ["3", "5"], A: ["2", "3"], B: ["1", "2"], C_PRE_IPO: ["0.5", "1"], POST_IPO: ["0.5", "1"] },
  L2: { PRE_A: ["1", "2"], A: ["0.5", "1.5"], B: ["0.5", "1"], C_PRE_IPO: ["0.2", "0.5"], POST_IPO: ["0.2", "0.5"] },
  L3: { PRE_A: ["0.3", "0.8"], A: ["0.15", "0.5"], B: ["0.1", "0.3"], C_PRE_IPO: ["0.05", "0.15"], POST_IPO: ["0.05", "0.15"] },
  L4: { PRE_A: ["0.1", "0.3"], A: ["0.08", "0.2"], B: ["0.05", "0.1"], C_PRE_IPO: ["0.02", "0.05"], POST_IPO: ["0.02", "0.05"] },
  L5: { PRE_A: ["0.05", "0.1"], A: ["0.03", "0.08"], B: ["0.02", "0.05"], C_PRE_IPO: ["0.01", "0.03"], POST_IPO: ["0.01", "0.03"] },
};

const SATURATION_CAPS: Record<EquityPositionLevel, string> = {
  L1: "10",
  L2: "5",
  L3: "1",
  L4: "0.5",
  L5: "0.2",
};

const PERFORMANCE_COEFFICIENTS = {
  S: "1.4",
  A: "1.15",
  B: "1",
  C: "0.6",
  D: "0",
} as const;

const TENURE_COEFFICIENTS = {
  FOUNDING: "1.2",
  A: "1",
  B: "0.8",
  C: "0.5",
} as const;

const REFRESH_RATIO_MIDPOINT: Record<EquityPositionLevel, string> = {
  L1: "32.5",
  L2: "25",
  L3: "20",
  L4: "15",
  L5: "7.5",
};

/**
 * 第8-13条：个人授予比例 = 岗位基准 × 绩效系数 × 司龄系数；
 * 第四条所述的融资阶段折扣系数作用于期权行权价（见 calculateOptionStrikePrice）。
 * 同时检查岗位等级饱和上限。
 */
export function calculateEquityGrant(
  input: GrantCalculationInput,
): GrantCalculationResult {
  const range = POSITION_MATRIX[input.positionLevel][input.financingStage];
  const explicitBase = input.positionBasePercent
    ? parseDecimal(input.positionBasePercent)
    : div(
        parseDecimal(range[0]) + parseDecimal(range[1]),
        parseDecimal("2"),
      );
  const positionBase = max(ZERO, explicitBase);
  const performance = parseDecimal(
    PERFORMANCE_COEFFICIENTS[input.performanceGrade],
  );
  const tenure = parseDecimal(TENURE_COEFFICIENTS[input.tenureStage]);
  const cap = parseDecimal(SATURATION_CAPS[input.positionLevel]);
  const existing = parseDecimal(input.existingGrantPercent ?? "0");

  let grantPercent: bigint;
  if (input.isRefresh) {
    if (input.financingStage === "PRE_A") {
      grantPercent = ZERO;
    } else if (input.performanceGrade === "C" || input.performanceGrade === "D") {
      grantPercent = ZERO;
    } else {
      const initial = parseDecimal(
        input.initialGrantPercent ?? input.positionBasePercent ?? "0",
      );
      const ratio = parseDecimal(REFRESH_RATIO_MIDPOINT[input.positionLevel]);
      // 第18条：Refresh 额度 = 初始授予 × Refresh 比例，再乘绩效系数；
      // 司龄系数只作用于初始授予，不重复作用于 Refresh。
      grantPercent = mul(div(mul(initial, ratio), HUNDRED), performance);
    }
  } else {
    grantPercent = mul(mul(positionBase, performance), tenure);
  }
  const cumulative = existing + grantPercent;
  const withinSaturation = cumulative <= cap;
  return {
    positionBasePercent: formatDecimal(roundTo(positionBase, 4, "HALF_UP")),
    performanceCoefficient: formatDecimal(performance),
    tenureCoefficient: formatDecimal(tenure),
    financingDiscountCoefficient: "1",
    grantPercent: formatDecimal(roundTo(grantPercent, 4, "HALF_UP")),
    cumulativePercent: formatDecimal(roundTo(cumulative, 4, "HALF_UP")),
    saturationCapPercent: formatDecimal(cap),
    withinSaturation,
    performanceGrade: input.performanceGrade,
    note: input.isRefresh && input.financingStage === "PRE_A"
      ? "Pre-A 阶段原则上不进行 Refresh"
      : !withinSaturation
        ? "累计授予超过岗位等级饱和上限，不再新增 ESOP 授予"
        : undefined,
  };
}

/** 第12条：行权价 = 最近一轮优先股每股价格 × (1 - 折扣率)。 */
export function calculateOptionStrikePrice(
  latestPreferredPrice: string,
  stage: FinancingStage,
  discountRatePercent?: string,
): { strikePrice: string; discountRatePercent: string } {
  const defaults: Record<FinancingStage, string> = {
    PRE_A: "65",
    A: "45",
    B: "30",
    C_PRE_IPO: "10",
    POST_IPO: "0",
  };
  const rate = parseDecimal(discountRatePercent ?? defaults[stage]);
  const strike = mul(
    parseDecimal(latestPreferredPrice),
    parseDecimal("1") - div(rate, HUNDRED),
  );
  return {
    strikePrice: formatDecimal(roundTo(strike, 4, "HALF_UP")),
    discountRatePercent: formatDecimal(rate),
  };
}

function monthsBetween(startIso: string, asOfIso: string): number {
  const start = new Date(startIso);
  const asOf = new Date(asOfIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(asOf.getTime())) {
    throw new Error("invalid vesting date");
  }
  let months =
    (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - start.getUTCMonth());
  if (asOf.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * 第19条：4 年、1 年 cliff、月度归属；满 12 个月归属 25%，
 * 此后每月 1/48。第20-21条：双触发/身故/退休/清算加速。
 */
export function calculateVestingSchedule(
  input: VestingScheduleInput,
): VestingScheduleResult {
  const cliff = input.cliffMonths ?? 12;
  const totalMonths = input.vestingMonths ?? 48;
  const elapsed = monthsBetween(input.vestingStart, input.asOf);
  const total = parseDecimal(input.totalUnits);
  const points: VestingPoint[] = [];
  const usable = Math.min(elapsed, totalMonths);
  if (usable >= cliff) {
    for (let month = cliff; month <= usable; month += 1) {
      const percent =
        month >= totalMonths
          ? HUNDRED
          : parseDecimal("25") +
            div(
              mul(parseDecimal(String(month - cliff)), HUNDRED),
              parseDecimal(String(totalMonths)),
            );
      points.push({
        month,
        vestedPercent: formatDecimal(roundTo(percent, 4, "HALF_UP")),
        vestedUnits: formatDecimal(
          roundTo(div(mul(total, percent), HUNDRED), 4, "HALF_UP"),
        ),
      });
    }
  }
  const baseVestedPercent =
    points.length > 0 ? parseDecimal(points[points.length - 1]!.vestedPercent) : ZERO;
  let vested = div(mul(total, baseVestedPercent), HUNDRED);
  const unvestedBefore = total - vested;
  let accelerated = ZERO;
  const acceleration = input.acceleration ?? { type: "NONE" as const };
  let note: string | undefined;
  switch (acceleration.type) {
    case "DEATH_OR_DISABILITY":
    case "LIQUIDATION":
      accelerated = unvestedBefore;
      note = "身故/丧失劳动能力或公司清算：未归属部分 100% 加速";
      break;
    case "DOUBLE_TRIGGER":
      accelerated = min(unvestedBefore, div(mul(total, parseDecimal("25")), HUNDRED));
      note = "双触发加速 12 个月归属（额外归属未归属部分的 25%）";
      break;
    case "RETIREMENT":
      if ((acceleration.serviceYears ?? 0) >= 5) {
        // 第21条：按未归属月数比例加速，最高为未归属部分的 50%。
        accelerated = min(
          unvestedBefore,
          div(mul(unvestedBefore, parseDecimal("50")), HUNDRED),
        );
        note = "退休（司龄满 5 年且绩效 B+）：未归属部分最高加速 50%";
      }
      break;
    case "IPO":
      note = "IPO 不自动加速；未归属部分可转为上市后 RSU";
      break;
    case "NONE":
    default:
      break;
  }
  vested += accelerated;
  const unvested = total - vested;
  return {
    asOf: input.asOf,
    vestingStart: input.vestingStart,
    cliffMonths: cliff,
    vestingMonths: totalMonths,
    vestedUnits: formatDecimal(roundTo(vested, 4, "HALF_UP")),
    unvestedUnits: formatDecimal(roundTo(unvested, 4, "HALF_UP")),
    vestedPercent: formatDecimal(
      roundTo(div(mul(vested, HUNDRED), total), 4, "HALF_UP"),
    ),
    acceleratedUnits: formatDecimal(roundTo(accelerated, 4, "HALF_UP")),
    fullyVested: unvested === 0n,
    points,
    note,
  };
}

/**
 * 第22-25条：回购情形矩阵、公允价值三级确定、20% 流动性折扣、
 * 非过错最低 5 万元、超 50 万元可分期、年度回购总额 50 万元上限。
 */
export function calculateRepurchase(input: RepurchaseInput): RepurchaseResult {
  const shares = parseDecimal(input.shares ?? "1");
  let fairUnit = ZERO;
  let note: string | undefined;
  if (
    input.latestFinancingPrice &&
    !input.valuationDeviationOver50Percent
  ) {
    fairUnit = mul(parseDecimal(input.latestFinancingPrice), parseDecimal("0.8"));
    note = "采用最近 12 个月融资投后估值，并计 20% 流动性折扣";
  } else if (input.auditedNetAssets || input.registeredCapital) {
    const netAssetsPerUnit = input.auditedNetAssets
      ? div(parseDecimal(input.auditedNetAssets), shares)
      : ZERO;
    const registeredPerUnit = input.registeredCapital
      ? div(parseDecimal(input.registeredCapital), shares)
      : ZERO;
    fairUnit = max(netAssetsPerUnit, registeredPerUnit);
    note = input.valuationDeviationOver50Percent
      ? "融资估值偏离实际经营超过 50%，改用经审计净资产法"
      : "无最近融资，采用经审计净资产与注册资本较高者";
  } else if (input.appraisalValue) {
    fairUnit = div(parseDecimal(input.appraisalValue), shares);
    note = "采用第三方评估机构评估值";
  }
  const fairTotal = mul(fairUnit, shares);
  let price = ZERO;
  let noticeDeadlineDays = 30;
  let completionDeadlineDays = 90;
  switch (input.scenario) {
    case "VOLUNTARY":
      if (input.holdingMonths < 12) {
        price = ZERO;
        note = "12 个月最低持有期内主动离职，按成本价 0 元回购";
      } else {
        price = div(mul(fairTotal, parseDecimal("50")), HUNDRED);
        note = "最低持有期后按公允价值 50% 回购";
      }
      noticeDeadlineDays = 30;
      completionDeadlineDays = 90;
      break;
    case "INVOLUNTARY":
      price = fairTotal;
      noticeDeadlineDays = 30;
      completionDeadlineDays = 180;
      break;
    case "FAULT":
      price = ZERO;
      noticeDeadlineDays = 15;
      completionDeadlineDays = 60;
      note = "过错离职按名义价 0 元回购，可另行追偿损失";
      break;
    case "RETIREMENT":
      price = fairTotal;
      noticeDeadlineDays = 60;
      completionDeadlineDays = 0;
      note = "退休可选择保留份额或按公允价值回购";
      break;
    case "DEATH":
      price = fairTotal;
      noticeDeadlineDays = 90;
      completionDeadlineDays = 0;
      note = "继承人可选择保留或按公允价值回购";
      break;
    default:
      throw new Error(`unsupported repurchase scenario: ${input.scenario}`);
  }
  let minimumPriceApplied = false;
  const inMinimumHolding =
    input.scenario === "VOLUNTARY" && input.holdingMonths < 12;
  if (input.scenario !== "FAULT" && !inMinimumHolding && price > 0n && price < parseDecimal("50000")) {
    price = parseDecimal("50000");
    minimumPriceApplied = true;
    note = `${note ?? ""}；非过错回购价不低于人民币 5 万元`;
  }
  const annualCapApplied = price > parseDecimal("500000");
  const installmentAllowed = price > parseDecimal("500000");
  return {
    scenario: input.scenario,
    fairValuePerUnit: formatDecimal(roundTo(fairUnit, 4, "HALF_UP")),
    repurchasePrice: formatDecimal(roundTo(price, 2, "HALF_UP")),
    noticeDeadlineDays,
    completionDeadlineDays,
    liquidityDiscountApplied: Boolean(input.latestFinancingPrice) && !input.valuationDeviationOver50Percent,
    minimumPriceApplied,
    installmentAllowed,
    annualCapApplied,
    note,
  };
}

/** 第29-33条：递延纳税备案与否的税务测算。 */
export function calculateEquityTax(input: {
  deferredFiling: boolean;
  strikePrice: string;
  fairValuePerUnit: string;
  units: string;
  salePricePerUnit?: string;
  wageTaxRatePercent?: string;
}): {
  deferredFiling: boolean;
  taxableBase: string;
  taxRatePercent: string;
  taxAmount: string;
  note: string;
} {
  const units = parseDecimal(input.units);
  const strike = parseDecimal(input.strikePrice);
  if (input.deferredFiling) {
    const sale = parseDecimal(input.salePricePerUnit ?? input.fairValuePerUnit);
    const base = max(ZERO, mul(sale - strike, units));
    const rate = parseDecimal("20");
    return {
      deferredFiling: true,
      taxableBase: formatDecimal(roundTo(base, 2, "HALF_UP")),
      taxRatePercent: formatDecimal(rate),
      taxAmount: formatDecimal(
        roundTo(div(mul(base, rate), HUNDRED), 2, "HALF_UP"),
      ),
      note: "已办理递延纳税备案：行权暂不纳税，转让/回购时按财产转让所得 20% 计税",
    };
  }
  const fair = parseDecimal(input.fairValuePerUnit);
  const base = max(ZERO, mul(fair - strike, units));
  const rate = parseDecimal(input.wageTaxRatePercent ?? "20");
  return {
    deferredFiling: false,
    taxableBase: formatDecimal(roundTo(base, 2, "HALF_UP")),
    taxRatePercent: formatDecimal(rate),
    taxAmount: formatDecimal(
      roundTo(div(mul(base, rate), HUNDRED), 2, "HALF_UP"),
    ),
    note: "未办理递延纳税备案：行权价低于公允价值的差额按工资薪金所得计税（3%-45% 超额累进，按传入税率测算）",
  };
}

/** 第34条：Cap Table 与饱和度报告。 */
export function calculateCapTableSnapshot(
  input: CapTableSnapshotInput,
): CapTableSnapshotResult {
  const totalGranted = sum(
    input.grants.map((grant) => parseDecimal(grant.grantedPercent)),
  );
  const byPerson = new Map<string, { level: EquityPositionLevel; total: bigint }>();
  for (const grant of input.grants) {
    const current = byPerson.get(grant.personId);
    byPerson.set(grant.personId, {
      level: grant.positionLevel,
      total: (current?.total ?? ZERO) + parseDecimal(grant.grantedPercent),
    });
  }
  const saturation = [...byPerson.entries()].map(([personId, entry]) => {
    const cap = parseDecimal(SATURATION_CAPS[entry.level]);
    return {
      personId,
      positionLevel: entry.level,
      cumulativePercent: formatDecimal(roundTo(entry.total, 4, "HALF_UP")),
      capPercent: formatDecimal(cap),
      saturated: entry.total >= cap,
    };
  });
  return {
    totalGrantedPercent: formatDecimal(roundTo(totalGranted, 4, "HALF_UP")),
    poolRemainingPercent: formatDecimal(
      roundTo(max(ZERO, sub(HUNDRED, totalGranted)), 4, "HALF_UP"),
    ),
    saturation,
  };
}
