import type {
  BountyQualityGrade,
  BountySettlementInput,
  BountySettlementResult,
  BusinessUnitCommissionInput,
  BusinessUnitCommissionResult,
  DbcpStatementInput,
  DbcpStatementResult,
  ExecutiveSupplementInput,
  ExecutiveSupplementResult,
  InternalSplitInput,
  InternalSplitResult,
  OverseasSalesAwardInput,
  OverseasSalesAwardResult,
  TechCenterAwardInput,
  TechCenterAwardResult,
  TechCenterPoolInput,
  TechCenterPoolResult,
} from "@anari/domain";
import {
  div,
  formatDecimal,
  max,
  min,
  mul,
  parseDecimal,
  roundTo,
  sum,
} from "./decimal.js";

const HUNDRED = parseDecimal("100");
const ZERO = parseDecimal("0");
const clamp = (value: bigint, lower: bigint, upper: bigint): bigint =>
  value < lower ? lower : value > upper ? upper : value;

/** 016 第六条：业务中心可分配贡献利润（DBCP）。 */
export function calculateDbcp(input: DbcpStatementInput): DbcpStatementResult {
  const grossProfit = parseDecimal(input.grossProfit);
  const base = parseDecimal(
    input.managementProvisionBase ?? input.grossProfit,
  );
  const rate = parseDecimal(input.managementProvisionRatePercent ?? "5");
  const provision = div(mul(base, rate), HUNDRED);
  const deductions =
    parseDecimal(input.businessExpenses) +
    parseDecimal(input.laborAndTravel) +
    parseDecimal(input.allocatedBusinessUnitExpenses) +
    parseDecimal(input.allocatedBackendPayroll) +
    provision;
  return {
    grossProfit: formatDecimal(roundTo(grossProfit, 2, "HALF_UP")),
    totalDeductions: formatDecimal(roundTo(deductions, 2, "HALF_UP")),
    managementProvision: formatDecimal(roundTo(provision, 2, "HALF_UP")),
    dbcp: formatDecimal(roundTo(grossProfit - deductions, 2, "HALF_UP")),
  };
}

const DEFAULT_MARGIN_BANDS = [
  { minMarginPercent: "8", ratePercent: "1" },
  { minMarginPercent: "12", ratePercent: "1.5" },
  { minMarginPercent: "16", ratePercent: "2" },
  { minMarginPercent: "20", ratePercent: "2.5" },
  { minMarginPercent: "25", ratePercent: "3" },
];

/**
 * 016 第七条：提成基数=实际净回款；按 DBCP 利润率命中档位，
 * 该档提成率对当期全部净回款整体适用；不乘 Kp。
 */
export function calculateBusinessUnitCommission(
  input: BusinessUnitCommissionInput,
): BusinessUnitCommissionResult {
  const dbcp = parseDecimal(input.dbcp);
  const netCollection = parseDecimal(input.netCollection);
  if (netCollection <= 0n) {
    return {
      marginPercent: "0",
      bandRatePercent: "0",
      commission: "0",
      eligible: false,
      reason: "当期净回款为零",
    };
  }
  if (dbcp <= 0n) {
    return {
      marginPercent: formatDecimal(roundTo(div(mul(dbcp, HUNDRED), netCollection), 4, "HALF_UP")),
      bandRatePercent: "0",
      commission: "0",
      eligible: false,
      reason: "当期 DBCP 小于等于零",
    };
  }
  const margin = div(mul(dbcp, HUNDRED), netCollection);
  const bands = (input.bands ?? DEFAULT_MARGIN_BANDS)
    .map((band) => ({
      min: parseDecimal(band.minMarginPercent),
      rate: parseDecimal(band.ratePercent),
    }))
    .sort((left, right) => Number(left.min - right.min));
  let rate = ZERO;
  for (const band of bands) {
    if (margin >= band.min) rate = band.rate;
  }
  const commission = div(mul(netCollection, rate), HUNDRED);
  return {
    marginPercent: formatDecimal(roundTo(margin, 4, "HALF_UP")),
    bandRatePercent: formatDecimal(rate),
    commission: formatDecimal(roundTo(commission, 2, "HALF_UP")),
    eligible: rate > 0n,
    reason: rate === 0n ? "可分配利润率低于 8%" : undefined,
  };
}

/**
 * 016 第八条：执行总监管理补差 G = DBCP×2%×K管理 − M。
 * K管理：<80 分=0；80-100 分=S/100；≥100 分=1.00。
 */
export function calculateExecutiveSupplement(
  input: ExecutiveSupplementInput,
): ExecutiveSupplementResult {
  const score = parseDecimal(input.managementScore);
  let managementK = ZERO;
  if (score >= HUNDRED) managementK = parseDecimal("1");
  else if (score >= parseDecimal("80")) managementK = div(score, HUNDRED);
  const gross = div(
    mul(mul(parseDecimal(input.dbcp), parseDecimal("2")), managementK),
    HUNDRED,
  );
  const supplement = max(ZERO, gross - parseDecimal(input.marketingReward));
  return {
    managementK: formatDecimal(roundTo(managementK, 4, "HALF_UP")),
    grossSupplement: formatDecimal(roundTo(gross, 2, "HALF_UP")),
    supplement: formatDecimal(roundTo(supplement, 2, "HALF_UP")),
  };
}

/**
 * 016 第八条：B = 业务中心实际提成池；R = B − M − G；
 * 其他岗位按协商比例分配，比例合计必须为 100%，不得再次包含 M/G，合计不得超过 B。
 */
export function calculateInternalSplit(
  input: InternalSplitInput,
): InternalSplitResult {
  const pool = parseDecimal(input.commissionPool);
  const marketing = parseDecimal(input.marketingReward);
  const supplement = parseDecimal(input.executiveSupplement);
  const remaining = pool - marketing - supplement;
  const errors: string[] = [];
  if (remaining < 0n) {
    errors.push("营销奖励与管理补差合计超过业务中心提成池");
  }
  const shareTotal = sum(
    input.participants.map((participant) => parseDecimal(participant.sharePercent)),
  );
  if (shareTotal !== HUNDRED) {
    errors.push("其他岗位分配比例合计必须为 100%");
  }
  if (remaining < 0n) {
    return {
      remainingPool: formatDecimal(remaining),
      allocated: "0",
      unallocated: "0",
      allocations: input.participants.map((participant) => ({
        personId: participant.personId,
        amount: "0",
      })),
      valid: false,
      errors,
    };
  }
  const allocations = input.participants.map((participant) => ({
    personId: participant.personId,
    amount: roundTo(
      div(mul(remaining, parseDecimal(participant.sharePercent)), HUNDRED),
      2,
      "HALF_UP",
    ),
  }));
  const allocated = sum(allocations.map((entry) => entry.amount));
  const unallocated = max(ZERO, remaining - allocated);
  return {
    remainingPool: formatDecimal(roundTo(remaining, 2, "HALF_UP")),
    allocated: formatDecimal(roundTo(allocated, 2, "HALF_UP")),
    unallocated: formatDecimal(roundTo(unallocated, 2, "HALF_UP")),
    allocations: allocations.map((entry) => ({
      personId: entry.personId,
      amount: formatDecimal(entry.amount),
    })),
    valid: errors.length === 0,
    errors,
  };
}

/** 016 第十四条：悬赏时间系数、质量系数与核定金额。 */
export function calculateBountySettlement(
  input: BountySettlementInput,
): BountySettlementResult {
  let timeCoefficient: bigint;
  if (input.extensionApproved) {
    timeCoefficient = parseDecimal("1");
  } else if (input.keyMilestoneMissed || input.delayWorkingDays > 15) {
    timeCoefficient = ZERO;
  } else if (input.delayWorkingDays <= 0) {
    timeCoefficient = parseDecimal("1");
  } else if (input.delayWorkingDays <= 3) {
    timeCoefficient = parseDecimal("0.9");
  } else if (input.delayWorkingDays <= 7) {
    timeCoefficient = parseDecimal("0.75");
  } else {
    timeCoefficient = parseDecimal("0.5");
  }

  const qualityMap: Record<BountyQualityGrade, string> = {
    PASS: "1",
    MINOR_DEFECT: "0.95",
    REWORK: "0.8",
    MULTIPLE_REWORK: "0.5",
    FAILED: "0",
  };
  const qualityCoefficient = parseDecimal(qualityMap[input.qualityGrade]);
  const share = parseDecimal(input.personalContributionShare);
  const amount = roundTo(
    mul(
      mul(mul(parseDecimal(input.baseReward), timeCoefficient), qualityCoefficient),
      share,
    ),
    2,
    "HALF_UP",
  );
  // Quality FAILED zeroes the current settlement, so `amount` cannot cap the
  // recovery. The already-paid reward is the upper bound (never recover more
  // than was actually paid).
  const recoverable =
    qualityCoefficient === 0n && input.paidAmount
      ? max(parseDecimal(input.paidAmount), ZERO)
      : ZERO;
  return {
    timeCoefficient: formatDecimal(timeCoefficient),
    qualityCoefficient: formatDecimal(qualityCoefficient),
    amount: formatDecimal(amount),
    recoverableAmount: formatDecimal(recoverable),
  };
}

const TECH_AWARD_FIXED: Partial<Record<string, string>> = {
  INVENTION_PATENT_ACCEPTED: "2000",
  INVENTION_PATENT_GRANTED: "5000",
  UTILITY_OR_SOFTWARE_ACCEPTED: "200",
  UTILITY_OR_SOFTWARE_GRANTED: "1000",
  DESIGN_PATENT_GRANTED: "100",
  TECH_BREAKTHROUGH: "3000",
  TECH_BREAKTHROUGH_SIGNIFICANT: "5000",
  HARDWARE_AC_DELIVERY: "2000",
  HARDWARE_DC_DELIVERY: "5000",
  SOFTWARE_MILESTONE: "1000",
  SLA_MONTH: "500",
  CUSTOMER_SATISFACTION_QUARTER: "500",
  TEAM_EXCELLENCE: "3000",
};

/**
 * 008 产品技术中心专项奖励。规则中的区间取制度下限，特殊贡献/GA/战略客户
 * 等由总经理核定金额覆盖。
 */
export function calculateTechCenterAward(
  input: TechCenterAwardInput,
): TechCenterAwardResult {
  const quantity = BigInt(Math.max(0, Math.trunc(input.quantity ?? 1)));
  const share = parseDecimal(input.personalShare ?? "1");
  let gross = ZERO;
  let cappable = false;
  let note: string | undefined;

  const fixed = TECH_AWARD_FIXED[input.awardType];
  if (fixed) {
    gross = mul(parseDecimal(fixed), parseDecimal(quantity.toString()));
    if (input.awardType === "SLA_MONTH" && input.slaMet === false) {
      gross = ZERO;
      note = "SLA 未达标，本月不计奖";
    }
    if (
      input.awardType === "CUSTOMER_SATISFACTION_QUARTER" &&
      input.satisfactionScore !== undefined &&
      parseDecimal(input.satisfactionScore) < parseDecimal("90")
    ) {
      gross = ZERO;
      note = "客户满意度低于 90%，季度奖不予发放";
    }
    if (
      input.awardType === "TEAM_EXCELLENCE" &&
      input.halfYearEvidence === false
    ) {
      gross = ZERO;
      note = "缺少半年度评审证据，团队卓越奖不予发放";
    }
  } else {
    switch (input.awardType) {
      case "CUSTOM_PROJECT": {
        // 制度区间 30%-50%：低于下限按 30%，高于上限按 50%。
        const rate = clamp(
          parseDecimal(input.approvedAmount ?? "30"),
          parseDecimal("30"),
          parseDecimal("50"),
        );
        gross = div(
          mul(parseDecimal(input.baseAmount ?? "0"), rate),
          HUNDRED,
        );
        note = "定制费 30%-50%，默认按下限 30%，由技术中心负责人核定";
        break;
      }
      case "COST_OPTIMIZATION": {
        // 制度区间 1%-2%，上限 10000 元。
        const rate = clamp(
          parseDecimal(input.approvedAmount ?? "1"),
          parseDecimal("1"),
          parseDecimal("2"),
        );
        gross = min(
          div(mul(parseDecimal(input.baseAmount ?? "0"), rate), HUNDRED),
          parseDecimal("10000"),
        );
        cappable = true;
        note = "年度节约金额的 1%-2%，上限 10000 元";
        break;
      }
      case "SOFTWARE_GA_STABLE": {
        gross = clamp(
          parseDecimal(input.approvedAmount ?? "3000"),
          parseDecimal("3000"),
          parseDecimal("5000"),
        );
        note = "GA 稳定运行 30 天奖励 3000-5000 元，默认下限";
        break;
      }
      case "KNOWLEDGE_CONTRIBUTION": {
        const perItem = clamp(
          parseDecimal(input.approvedAmount ?? "50"),
          parseDecimal("50"),
          parseDecimal("100"),
        );
        gross = min(
          mul(perItem, parseDecimal(quantity.toString())),
          parseDecimal("1000"),
        );
        cappable = true;
        note = "每条 50-100 元，季度上限 1000 元";
        break;
      }
      case "STRATEGIC_CUSTOMER_SUPPORT": {
        gross = clamp(
          parseDecimal(input.approvedAmount ?? "1000"),
          parseDecimal("1000"),
          parseDecimal("3000"),
        );
        note = "1000-3000 元，需业务团队书面确认";
        break;
      }
      case "SPECIAL_TECH_CONTRIBUTION": {
        gross = parseDecimal(input.approvedAmount ?? "0");
        note = "报总经理核定";
        break;
      }
      default:
        throw new Error(`unsupported tech center award type: ${input.awardType}`);
    }
  }

  if (input.awardType === "HARDWARE_AC_DELIVERY" || input.awardType === "HARDWARE_DC_DELIVERY") {
    const delay = min(parseDecimal(input.delayRatio ?? "0"), parseDecimal("1"));
    gross = mul(gross, parseDecimal("1") - delay);
    note = "按延期比例扣减";
  }
  const personal = roundTo(mul(gross, share), 2, "HALF_UP");
  return {
    awardType: input.awardType,
    grossAmount: formatDecimal(roundTo(gross, 2, "HALF_UP")),
    personalAmount: formatDecimal(personal),
    cappable,
    note,
  };
}

/**
 * 008 第六条：产品技术中心季度奖金池 = 公司整体业务提成总额的 19%；
 * 个人权重 = 岗位价值系数（基准±0.2）× 项目贡献度 × 绩效系数；
 * 负责人四项考核全部达标 +0.1，两项及以上未达标 -0.2。
 */
export function calculateTechCenterPool(
  input: TechCenterPoolInput,
): TechCenterPoolResult {
  const pool = div(
    mul(parseDecimal(input.totalBusinessCommission), parseDecimal("19")),
    HUNDRED,
  );
  let headAdjustment = ZERO;
  if (input.headReview) {
    const review = input.headReview;
    const met = [
      parseDecimal(review.roadmapAchievementPercent) >= parseDecimal("80"),
      parseDecimal(review.crossFunctionalSatisfaction) >= parseDecimal("4"),
      review.techDebtControlled,
      review.retentionMet,
    ];
    const missed = met.filter((value) => !value).length;
    if (missed === 0) headAdjustment = parseDecimal("0.1");
    else if (missed >= 2) headAdjustment = parseDecimal("-0.2");
  }
  const prepared = input.members.map((member) => {
    const coefficient =
      member.personId === input.headPersonId
        ? member.positionCoefficient
        : member.positionCoefficient;
    const adjusted = max(
      ZERO,
      parseDecimal(coefficient) + (member.personId === input.headPersonId ? headAdjustment : ZERO),
    );
    const weight = mul(
      mul(adjusted, parseDecimal(member.projectContribution)),
      parseDecimal(member.performanceCoefficient),
    );
    return { personId: member.personId, weight };
  });
  const totalWeight = sum(prepared.map((entry) => entry.weight));
  const allocations = prepared.map((entry) => ({
    personId: entry.personId,
    weight: formatDecimal(roundTo(entry.weight, 4, "HALF_UP")),
    amount:
      totalWeight <= 0n
        ? "0"
        : formatDecimal(
            roundTo(div(mul(pool, entry.weight), totalWeight), 2, "HALF_UP"),
          ),
  }));
  return {
    poolAmount: formatDecimal(roundTo(pool, 2, "HALF_UP")),
    headAdjustment: formatDecimal(headAdjustment),
    allocations,
  };
}

/** 003 海外销售激励。 */
export function calculateOverseasSalesAward(
  input: OverseasSalesAwardInput,
): OverseasSalesAwardResult {
  if (input.maliciousPoaching) {
    return {
      grossAmount: "0",
      deduction: "0",
      netAmount: "0",
      recoverableAmount: input.paidAmount ?? "0",
      disqualified: true,
      note: "内部恶意抢单，取消当季度全部奖金",
    };
  }
  let gross = ZERO;
  let note: string | undefined;
  switch (input.awardType) {
    case "NEW_CUSTOMER_STAR": {
      // 达标客户数（首单≥10 万、回款≤50 天）优先；旧调用方仍可只传总数。
      const qualified =
        input.qualifiedNewCustomerCount ?? input.newCustomerCount ?? 0;
      if (qualified >= 8) {
        gross = parseDecimal("10000");
        note = "每季度成功开发 8 个及以上达标新客户（首单≥10 万元且回款周期≤50 天）";
      } else if ((input.newCustomerCount ?? 0) >= 8) {
        note = "新客户数量达到 8 个，但达标客户数不足（首单≥10 万、回款≤50 天）";
      }
      break;
    }
    case "KA_BREAKTHROUGH": {
      if (input.kaQualified === false) {
        note = "未满足 KA 行业前 50/地区头部资格，不予发放突破奖";
        break;
      }
      const amount = parseDecimal(input.annualCustomerOrderAmount ?? "0");
      if (input.firstSigning && amount >= parseDecimal("10000000")) {
        gross = parseDecimal("50000");
      } else if (input.firstSigning && amount >= parseDecimal("5000000")) {
        gross = parseDecimal("30000");
      }
      note = "KA 客户首次签约且年度成交额≥500 万元；≥1000 万元为 5 万元";
      break;
    }
    case "IMPORTANT_CUSTOMER_BREAKTHROUGH":
      if (
        input.firstSigning &&
        parseDecimal(input.annualCustomerOrderAmount ?? "0") >= parseDecimal("3000000")
      ) {
        gross = parseDecimal("10000");
      }
      note = "单一客户首次签约且年度成交额≥300 万元";
      break;
    case "QUARTERLY_CHAMPION":
      if (input.rank === 1 && input.targetExceeded) {
        gross = parseDecimal("10000");
      }
      note = "季度回款排名第一且超额完成季度目标";
      break;
    case "ANNUAL_CHAMPION":
      if (input.rank === 1 && input.targetExceeded) {
        gross = parseDecimal("50000");
        note = "年度回款排名第一且超额完成年度目标，另授“年度金牌销售”称号";
      }
      break;
    default:
      throw new Error(`unsupported overseas award type: ${input.awardType}`);
  }
  const badDebt = parseDecimal(input.badDebtLoss ?? "0");
  const deduction = min(gross, div(mul(badDebt, parseDecimal("50")), HUNDRED));
  const net = max(ZERO, gross - deduction);
  let recoverable = ZERO;
  if (
    input.awardType === "KA_BREAKTHROUGH" &&
    input.kaNextYearDropRatio !== undefined &&
    parseDecimal(input.kaNextYearDropRatio) > parseDecimal("0.3") &&
    input.paidAmount
  ) {
    recoverable = div(mul(parseDecimal(input.paidAmount), parseDecimal("50")), HUNDRED);
    note = `${note ?? ""}；KA 次年在手订单下降超 30%，追回已发奖金的 50%`;
  }
  return {
    grossAmount: formatDecimal(roundTo(gross, 2, "HALF_UP")),
    deduction: formatDecimal(roundTo(deduction, 2, "HALF_UP")),
    netAmount: formatDecimal(roundTo(net, 2, "HALF_UP")),
    recoverableAmount: formatDecimal(roundTo(recoverable, 2, "HALF_UP")),
    disqualified: false,
    note,
  };
}
