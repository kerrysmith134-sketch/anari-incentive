import type {
  AnnualProfitSharingInput,
  AnnualProfitSharingResult,
  AnnualScorecardInput,
  AnnualScorecardResult,
  FunctionalQuarterlyBonusInput,
  FunctionalQuarterlyBonusResult,
  MetricMeasurement,
  MonthlyPerformanceWageInput,
  MonthlyPerformanceWageResult,
  MonthlyStarCandidate,
  MonthlyStarEvaluationResult,
  PerformanceComponentResult,
  PerformanceMetricSpec,
  PerformancePeriod,
  PerformanceScoreRequest,
  PerformanceScoreResult,
  ScoringAnchor,
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
import { sha256 } from "./hash.js";


/**
 * M-001：任务按期有效闭环率 = 按期验收通过任务权重和 ÷ 应完成任务权重和。
 * 只有“已验收 + 按期 + 有可核验证据”计入有效闭环；无任务时返回 N/A 提示。
 */
export function calculateTaskClosureRate(
  tasks: Array<{
    weight: string;
    status: string;
    dueAt: string;
    acceptedAt?: string;
    hasEvidence: boolean;
  }>,
): {
  requiredWeight: string;
  qualifiedWeight: string;
  rate: string;
  note?: string;
} {
  let requiredWeight = ZERO;
  let qualifiedWeight = ZERO;
  for (const task of tasks) {
    const weight = parseDecimal(task.weight);
    requiredWeight += weight;
    const accepted = task.status === "ACCEPTED";
    const onTime = accepted && Boolean(task.acceptedAt) && task.acceptedAt! <= task.dueAt;
    if (accepted && onTime && task.hasEvidence) {
      qualifiedWeight += weight;
    }
  }
  return {
    requiredWeight: formatDecimal(requiredWeight),
    qualifiedWeight: formatDecimal(qualifiedWeight),
    rate:
      requiredWeight === 0n
        ? "0"
        : formatDecimal(
            div(mul(qualifiedWeight, HUNDRED), requiredWeight),
          ),
    note:
      requiredWeight === 0n
        ? "当期无应完成任务，M-001 记 N/A，不得直接记 0"
        : undefined,
  };
}

export const PERFORMANCE_CYCLE_CAPS: Record<PerformancePeriod, string> = {
  MONTHLY: "110",
  QUARTERLY: "150",
  ANNUAL: "105",
};

/**
 * 018 A.1 / 第十三条：同一岗位同一周期指标权重合计必须为 100%，
 * 指标必须有唯一 ID、目标/锚点与数据源；正式评分不得缺少锁定目标。
 */
export function validatePerformanceMetricSet(
  metrics: PerformanceMetricSpec[],
  period: PerformancePeriod,
): { valid: boolean; errors: string[]; totalWeight: string } {
  const errors: string[] = [];
  if (metrics.length === 0) errors.push("指标集不能为空");
  const seen = new Set<string>();
  let total = ZERO;
  for (const metric of metrics) {
    if (seen.has(metric.metricId)) {
      errors.push(`指标 ${metric.metricId} 重复`);
    }
    seen.add(metric.metricId);
    if (metric.period !== period) {
      errors.push(`指标 ${metric.metricId} 周期 ${metric.period} 与目标卡 ${period} 不一致`);
    }
    const weight = parseDecimal(metric.weight);
    if (weight <= 0n) errors.push(`指标 ${metric.metricId} 权重必须大于 0`);
    total += weight;
    if (metric.metricType === "POSITIVE_LINEAR" && !metric.target) {
      errors.push(`指标 ${metric.metricId} 缺少事前锁定的目标值`);
    }
    if (
      (metric.metricType === "PIECEWISE_LINEAR" ||
        metric.metricType === "REVERSE_LINEAR") &&
      (!metric.scoringAnchors || metric.scoringAnchors.length === 0) &&
      !metric.target
    ) {
      errors.push(`指标 ${metric.metricId} 缺少评分锚点或目标值`);
    }
    if (!metric.dataSource.trim()) {
      errors.push(`指标 ${metric.metricId} 缺少权威数据源`);
    }
  }
  if (metrics.length > 0 && total !== HUNDRED) {
    errors.push(
      `指标权重合计必须为 100%，当前为 ${formatDecimal(total)}%`,
    );
  }
  return {
    valid: errors.length === 0,
    errors,
    totalWeight: formatDecimal(total),
  };
}

const HUNDRED = parseDecimal("100");
const ZERO = parseDecimal("0");
const DEFAULT_MAX_SCORE = parseDecimal("150");

function clamp(value: bigint, lower: bigint, upper: bigint): bigint {
  return min(max(value, lower), upper);
}

function interpolate(
  anchors: ScoringAnchor[],
  raw: bigint,
): { score: bigint; capped: boolean } {
  const sorted = [...anchors].sort(
    (left, right) => Number(parseDecimal(left.raw) - parseDecimal(right.raw)),
  );
  if (sorted.length === 0) throw new Error("scoring anchors required");
  const points = sorted.map((anchor) => ({
    raw: parseDecimal(anchor.raw),
    score: parseDecimal(anchor.score),
  }));
  if (raw <= points[0]!.raw) {
    return { score: points[0]!.score, capped: raw < points[0]!.raw };
  }
  const last = points[points.length - 1]!;
  if (raw >= last.raw) {
    return { score: last.score, capped: raw > last.raw };
  }
  for (let index = 1; index < points.length; index += 1) {
    const lower = points[index - 1]!;
    const upper = points[index]!;
    if (raw <= upper.raw) {
      const span = upper.raw - lower.raw;
      if (span === 0n) return { score: upper.score, capped: false };
      const offset = div(
        mul(upper.score - lower.score, raw - lower.raw),
        span,
      );
      return { score: lower.score + offset, capped: false };
    }
  }
  return { score: last.score, capped: false };
}

export function scoreMetric(
  metric: PerformanceMetricSpec,
  measurement: MetricMeasurement,
): { score: bigint; capped: boolean } {
  const maxScore = parseDecimal(metric.maxScore ?? formatDecimal(DEFAULT_MAX_SCORE));
  const raw = measurement.rawValue ? parseDecimal(measurement.rawValue) : ZERO;
  switch (metric.metricType) {
    case "POSITIVE_LINEAR": {
      if (!metric.target) {
        throw new Error(
          `metric ${metric.metricId} requires a locked target before scoring`,
        );
      }
      const target = parseDecimal(metric.target);
      if (target <= 0n) return { score: ZERO, capped: false };
      const rawScore = div(mul(raw, HUNDRED), target);
      return {
        score: clamp(rawScore, ZERO, maxScore),
        capped: rawScore > maxScore,
      };
    }
    case "REVERSE_LINEAR": {
      if (metric.scoringAnchors && metric.scoringAnchors.length > 0) {
        const result = interpolate(metric.scoringAnchors, raw);
        return {
          score: clamp(result.score, ZERO, maxScore),
          capped: result.score > maxScore,
        };
      }
      if (!metric.target) {
        throw new Error(
          `metric ${metric.metricId} requires a target or anchors`,
        );
      }
      const target = parseDecimal(metric.target);
      if (raw <= 0n) return { score: maxScore, capped: false };
      const rawScore = div(mul(target, HUNDRED), raw);
      return {
        score: clamp(rawScore, ZERO, maxScore),
        capped: rawScore > maxScore,
      };
    }
    case "PIECEWISE_LINEAR": {
      if (!metric.scoringAnchors || metric.scoringAnchors.length === 0) {
        throw new Error(
          `metric ${metric.metricId} requires scoring anchors`,
        );
      }
      const result = interpolate(metric.scoringAnchors, raw);
      return {
        score: clamp(result.score, ZERO, maxScore),
        capped: result.score > maxScore,
      };
    }
    case "WEIGHTED_ACCEPTANCE": {
      const acceptance = measurement.acceptanceScore
        ? parseDecimal(measurement.acceptanceScore)
        : raw;
      return {
        score: clamp(acceptance, ZERO, maxScore),
        capped: acceptance > maxScore,
      };
    }
    case "INTERVAL_EVENT": {
      const minScore = parseDecimal(metric.minScore ?? "0");
      const adjustment = measurement.eventAdjustment
        ? parseDecimal(measurement.eventAdjustment)
        : ZERO;
      const capped = maxScore < DEFAULT_MAX_SCORE ? maxScore : parseDecimal("110");
      const rawScore = HUNDRED + adjustment;
      return {
        score: clamp(rawScore, minScore, min(capped, maxScore)),
        capped: rawScore > capped || rawScore < minScore,
      };
    }
    default:
      throw new Error(`unsupported scoring function: ${metric.metricType}`);
  }
}

function isApplicable(
  metric: PerformanceMetricSpec,
  measurement: MetricMeasurement,
): boolean {
  if (!measurement.applicable) return false;
  if (metric.metricType === "INTERVAL_EVENT") return true;
  if (metric.metricType === "WEIGHTED_ACCEPTANCE") {
    return measurement.acceptanceScore !== undefined && measurement.acceptanceScore !== null;
  }
  return measurement.rawValue !== undefined && measurement.rawValue !== null;
}

/**
 * 018 B.1 / B.3 / C.1：确定性评分、N/A 同比例归一、周期封顶、Kp=S/100。
 */
export function scorePerformance(
  request: PerformanceScoreRequest,
): PerformanceScoreResult {
  const seenMetricIds = new Set<string>();
  for (const metric of request.metrics) {
    if (seenMetricIds.has(metric.metricId)) {
      throw new Error(`duplicate metric id: ${metric.metricId}`);
    }
    seenMetricIds.add(metric.metricId);
  }
  const metricById = new Map(
    request.metrics.map((metric) => [metric.metricId, metric]),
  );
  const measurementById = new Map(
    request.measurements.map((measurement) => [measurement.metricId, measurement]),
  );
  const components: PerformanceComponentResult[] = [];
  const applicableMetrics: Array<{
    metric: PerformanceMetricSpec;
    measurement: MetricMeasurement;
    score: bigint;
    capped: boolean;
  }> = [];
  const naMetricIds: string[] = [];

  for (const metric of request.metrics) {
    if (metric.period !== request.period) {
      throw new Error(
        `metric ${metric.metricId} period ${metric.period} does not match ${request.period}`,
      );
    }
    const measurement = measurementById.get(metric.metricId) ?? {
      metricId: metric.metricId,
      applicable: false,
      naReason: "未提供测量值",
    };
    if (!isApplicable(metric, measurement)) {
      naMetricIds.push(metric.metricId);
      components.push({
        metricId: metric.metricId,
        name: metric.name,
        applicable: false,
        naReason: measurement.naReason ?? "N/A",
        rawValue: measurement.rawValue ?? undefined,
        score: "0",
        effectiveWeight: "0",
        weightedScore: "0",
        capped: false,
      });
      continue;
    }
    const scored = scoreMetric(metric, measurement);
    applicableMetrics.push({
      metric,
      measurement,
      score: scored.score,
      capped: scored.capped,
    });
  }

  if (applicableMetrics.length === 0) {
    return {
      personId: request.personId,
      period: request.period,
      components,
      rawScore: "0",
      scoreBeforeCap: "0",
      finalScore: "0",
      cycleCap: PERFORMANCE_CYCLE_CAPS[request.period],
      kp: "0",
      naMetricIds,
      renormalized: false,
      complete: false,
      note: "无法形成完整评价：所有指标均为 N/A",
      resultHash: sha256({ request, complete: false }),
    };
  }

  const applicableWeightTotal = sum(
    applicableMetrics.map((entry) => parseDecimal(entry.metric.weight)),
  );
  if (applicableWeightTotal <= 0n) {
    throw new Error("applicable metric weights must be positive");
  }
  // Only a genuine N/A removal justifies renormalising. A weight set that is
  // merely incomplete must not masquerade as an N/A evaluation.
  const renormalized =
    naMetricIds.length > 0 && applicableWeightTotal !== HUNDRED;
  if (applicableWeightTotal !== HUNDRED && naMetricIds.length === 0) {
    throw new Error(
      `metric weights must total 100% (got ${formatDecimal(applicableWeightTotal)}) unless metrics are marked N/A`,
    );
  }

  let weightedScore = ZERO;
  for (const entry of applicableMetrics) {
    const weight = parseDecimal(entry.metric.weight);
    const effectiveWeight = div(mul(weight, HUNDRED), applicableWeightTotal);
    const contribution = div(mul(entry.score, weight), HUNDRED);
    weightedScore += contribution;
    components.push({
      metricId: entry.metric.metricId,
      name: entry.metric.name,
      applicable: true,
      rawValue: entry.measurement.rawValue ?? undefined,
      score: formatDecimal(roundTo(entry.score, 2, "HALF_UP")),
      effectiveWeight: formatDecimal(roundTo(effectiveWeight, 4, "HALF_UP")),
      weightedScore: formatDecimal(roundTo(contribution, 4, "HALF_UP")),
      capped: entry.capped,
    });
  }
  // B.3：N/A 后按其余适用指标权重同比例归一化。
  weightedScore = div(mul(weightedScore, HUNDRED), applicableWeightTotal);

  const adjustment = request.manualAdjustment
    ? parseDecimal(request.manualAdjustment)
    : ZERO;
  if (adjustment !== 0n && !request.manualAdjustmentReason?.trim()) {
    throw new Error("manual adjustment requires a written reason");
  }
  const scoreBeforeCap = weightedScore + adjustment;
  const cycleCap = parseDecimal(PERFORMANCE_CYCLE_CAPS[request.period]);
  const finalScore = clamp(scoreBeforeCap, ZERO, cycleCap);
  const kp = roundTo(div(finalScore, HUNDRED), 4, "HALF_UP");

  const componentsSorted = [...components].sort((left, right) =>
    left.metricId.localeCompare(right.metricId),
  );
  const resultWithoutHash = {
    personId: request.personId,
    period: request.period,
    components: componentsSorted,
    rawScore: formatDecimal(roundTo(weightedScore, 4, "HALF_UP")),
    scoreBeforeCap: formatDecimal(roundTo(scoreBeforeCap, 4, "HALF_UP")),
    finalScore: formatDecimal(roundTo(finalScore, 2, "HALF_UP")),
    cycleCap: formatDecimal(cycleCap),
    kp: formatDecimal(kp),
    naMetricIds,
    renormalized,
    complete: true,
    note: renormalized
      ? "存在 N/A 指标，已按其余适用指标同比例归一化权重"
      : undefined,
  };
  return {
    ...resultWithoutHash,
    resultHash: sha256(resultWithoutHash),
  };
}

const WAGE_BAND_RATES: Record<string, string> = {
  BASE: "20",
  MANAGER: "30",
  DIRECTOR: "40",
};

/** 第二十条：实发 = 月度工资总额 × 职级浮动比例 × 月度 Kp（上限 1.10）。 */
export function calculateMonthlyPerformanceWage(
  input: MonthlyPerformanceWageInput,
): MonthlyPerformanceWageResult {
  const ratePercent = parseDecimal(
    input.floatingRatePercent ?? WAGE_BAND_RATES[input.wageBand] ?? "20",
  );
  const standard = div(mul(parseDecimal(input.monthlyTotalWage), ratePercent), HUNDRED);
  const rawKp = div(parseDecimal(input.monthlyScore), HUNDRED);
  // Kp is a multiplier: a negative score must never turn into a negative wage.
  const cappedKp = clamp(rawKp, ZERO, parseDecimal("1.1"));
  const payable = div(mul(standard, cappedKp), parseDecimal("1"));
  return {
    floatingRatePercent: formatDecimal(ratePercent),
    performanceWageStandard: formatDecimal(roundTo(standard, 2, "HALF_UP")),
    kp: formatDecimal(roundTo(cappedKp, 4, "HALF_UP")),
    payable: formatDecimal(roundTo(payable, 2, "HALF_UP")),
    cappedAtOnePointOne: rawKp > parseDecimal("1.1"),
  };
}

/** 第十一条 / C.2：S>100 才有资格，Kq=S/100，封顶 1.50。 */
export function calculateFunctionalQuarterlyBonus(
  input: FunctionalQuarterlyBonusInput,
): FunctionalQuarterlyBonusResult {
  const score = parseDecimal(input.quarterlyScore);
  const eligible = score > HUNDRED;
  const kq = min(div(score, HUNDRED), parseDecimal("1.5"));
  const baseAmount = div(mul(parseDecimal(input.fixedMonthlyWage), parseDecimal("10")), HUNDRED);
  const amount = eligible
    ? div(mul(baseAmount, kq), parseDecimal("1"))
    : ZERO;
  return {
    quarterlyScore: input.quarterlyScore,
    kq: formatDecimal(roundTo(kq, 4, "HALF_UP")),
    eligible,
    baseAmount: formatDecimal(roundTo(baseAmount, 2, "HALF_UP")),
    amount: formatDecimal(roundTo(amount, 2, "HALF_UP")),
  };
}

/** 第十四条 / A.9：四维年度计分卡，S_company=min(105, 加权和)。 */
export function calculateAnnualScorecard(
  input: AnnualScorecardInput,
): AnnualScorecardResult {
  const definitions = [
    { metricId: "ANNUAL-REVENUE", name: "公司确认收入达成率", weightPercent: "20", score: input.revenueAchievementScore },
    { metricId: "ANNUAL-PROFIT", name: "公司年度可分配净利润达成率", weightPercent: "30", score: input.distributableProfitAchievementScore },
    { metricId: "ANNUAL-COLLECTION", name: "净回款达成率", weightPercent: "20", score: input.netCollectionAchievementScore },
    { metricId: "ANNUAL-STRATEGY", name: "公司年度关键战略成果完成率", weightPercent: "30", score: input.strategyAchievementScore },
  ];
  const components = definitions.map((definition) => ({
    ...definition,
    score: formatDecimal(
      clamp(parseDecimal(definition.score), ZERO, parseDecimal("120")),
    ),
  }));
  let weighted = ZERO;
  for (const component of components) {
    weighted += div(
      mul(parseDecimal(component.score), parseDecimal(component.weightPercent)),
      HUNDRED,
    );
  }
  const companyScore = min(weighted, parseDecimal("105"));
  const kp = div(companyScore, HUNDRED);
  const profitTargetMet =
    input.distributableNetProfit !== undefined &&
    input.netProfitTarget !== undefined
      ? parseDecimal(input.distributableNetProfit) >=
          parseDecimal(input.netProfitTarget) &&
        parseDecimal(input.distributableNetProfit) > 0n
      : false;
  let poolRate = profitTargetMet
    ? parseDecimal(input.functionalBonusPoolRatePercent ?? "5")
    : ZERO;
  poolRate = clamp(poolRate, ZERO, parseDecimal("10"));
  return {
    components,
    weightedScore: formatDecimal(roundTo(weighted, 4, "HALF_UP")),
    companyScore: formatDecimal(roundTo(companyScore, 2, "HALF_UP")),
    kp: formatDecimal(roundTo(kp, 4, "HALF_UP")),
    profitTargetMet,
    functionalBonusPoolRatePercent: formatDecimal(poolRate),
  };
}

/** 第十二条：年度利润分享，池子受净利润条件、5%-10% 与预留预算约束。 */
export function calculateAnnualProfitSharing(
  input: AnnualProfitSharingInput,
): AnnualProfitSharingResult {
  const profit = parseDecimal(input.distributableNetProfit);
  const target = parseDecimal(input.netProfitTarget);
  const eligible = profit >= target && profit > 0n;
  const rate = clamp(
    parseDecimal(input.poolRatePercent),
    ZERO,
    parseDecimal("10"),
  );
  if (!eligible) {
    return {
      eligible: false,
      reason: "年度可分配净利润未达到目标或不为正，年度职能奖金池为 0",
      poolRatePercent: formatDecimal(rate),
      poolAmount: "0",
      approvedPoolAmount: "0",
      totalPoints: "0",
      allocations: input.people.map((person) => ({
        personId: person.personId,
        valuePoints: "0",
        points: "0",
        amount: "0",
      })),
    };
  }
  const poolAmount = div(mul(profit, rate), HUNDRED);
  const approvedPool = input.reservedBudgetBalance
    ? min(poolAmount, parseDecimal(input.reservedBudgetBalance))
    : poolAmount;

  const prepared = input.people.map((person) => {
    const valuePoints = mul(
      parseDecimal(person.monthlyWageBase),
      parseDecimal(person.gradeCoefficient),
    );
    const points = mul(
      mul(valuePoints, parseDecimal(person.weightedQuarterlyKp)),
      parseDecimal(person.attendanceRatio),
    );
    return { person, valuePoints, points };
  });
  const totalPoints = sum(prepared.map((entry) => entry.points));
  if (totalPoints <= 0n) {
    return {
      eligible: true,
      reason: "符合条件人员分配点数为 0",
      poolRatePercent: formatDecimal(rate),
      poolAmount: formatDecimal(roundTo(poolAmount, 2, "HALF_UP")),
      approvedPoolAmount: formatDecimal(roundTo(approvedPool, 2, "HALF_UP")),
      totalPoints: "0",
      allocations: prepared.map((entry) => ({
        personId: entry.person.personId,
        valuePoints: formatDecimal(roundTo(entry.valuePoints, 2, "HALF_UP")),
        points: "0",
        amount: "0",
      })),
    };
  }
  const allocations = prepared.map((entry) => ({
    personId: entry.person.personId,
    valuePoints: formatDecimal(roundTo(entry.valuePoints, 2, "HALF_UP")),
    points: formatDecimal(roundTo(entry.points, 4, "HALF_UP")),
    amount: roundTo(div(mul(approvedPool, entry.points), totalPoints), 2, "HALF_UP"),
  }));
  const allocated = sum(allocations.map((entry) => entry.amount));
  const residual = approvedPool - allocated;
  if (residual !== 0n && allocations.length > 0) {
    const largest = [...prepared].sort((left, right) =>
      left.points === right.points ? 0 : left.points > right.points ? -1 : 1,
    )[0]!;
    const targetAllocation = allocations.find(
      (entry) => entry.personId === largest.person.personId,
    )!;
    targetAllocation.amount += residual;
  }
  return {
    eligible: true,
    poolRatePercent: formatDecimal(rate),
    poolAmount: formatDecimal(roundTo(poolAmount, 2, "HALF_UP")),
    approvedPoolAmount: formatDecimal(roundTo(approvedPool, 2, "HALF_UP")),
    totalPoints: formatDecimal(roundTo(totalPoints, 4, "HALF_UP")),
    allocations: allocations.map((entry) => ({
      ...entry,
      amount: formatDecimal(roundTo(entry.amount, 2, "HALF_UP")),
    })),
  };
}

/**
 * 第九条 / 018 A.2 月明星：排名第一 + 月度总分≥110 + 价值观单项≥20 +
 * 已核实正向事件 + 无严重违规；奖励 500 元，连续三个月自第三个月起
 * 1000 元，每年最多 3 次。M-003 的 20 分是价值观单项门槛，
 * 110 分是月度总分门槛（2026-11-09 业务口径确认）。
 */
export function evaluateMonthlyStar(
  candidates: MonthlyStarCandidate[],
  options: {
    m003Threshold?: string;
    totalScoreThreshold?: string;
    maxAwardsPerYear?: number;
  } = {},
): MonthlyStarEvaluationResult {
  const m003Threshold = parseDecimal(options.m003Threshold ?? "20");
  const totalScoreThreshold = parseDecimal(
    options.totalScoreThreshold ?? "110",
  );
  const maxAwards = options.maxAwardsPerYear ?? 3;
  const evaluated = candidates.map((candidate) => {
    let reasonCode: string | undefined;
    if (candidate.rank !== 1) reasonCode = "NOT_RANK_ONE";
    else if (parseDecimal(candidate.monthlyScore) < totalScoreThreshold)
      reasonCode = "TOTAL_SCORE_BELOW_THRESHOLD";
    else if (parseDecimal(candidate.m003Score) < m003Threshold)
      reasonCode = "M003_BELOW_THRESHOLD";
    else if (candidate.verifiedPositiveEvents < 1)
      reasonCode = "NO_VERIFIED_POSITIVE_EVENT";
    else if (candidate.seriousViolation) reasonCode = "SERIOUS_VIOLATION";
    else if (candidate.awardedThisYear >= maxAwards)
      reasonCode = "ANNUAL_AWARD_LIMIT_REACHED";
    const eligible = reasonCode === undefined;
    const amount = eligible
      ? candidate.consecutiveMonths >= 3
        ? "1000"
        : "500"
      : "0";
    return {
      personId: candidate.personId,
      eligible,
      reasonCode,
      amount,
    };
  });
  const winners = evaluated.filter((entry) => entry.eligible);
  return {
    awarded: winners.length > 0,
    candidates: evaluated,
    note:
      winners.length === 0
        ? "当月无人同时满足条件，不予发放、不递补、不顺延"
        : winners.length > 1
          ? "存在并列第一，按制度应人工复核排名口径"
          : undefined,
  };
}

// ---------------------------------------------------------------------------
// A.2 / A.3-A.8 / A.9 metric templates
// ---------------------------------------------------------------------------

function metric(
  partial: Omit<PerformanceMetricSpec, "version" | "sourceFields" | "calculationRule" | "evidenceRule" | "applicabilityRule" | "exceptionRule" | "approvalRule" | "ownerRole" | "dataSource"> &
    Partial<PerformanceMetricSpec>,
): PerformanceMetricSpec {
  return {
    version: 1,
    sourceFields: [],
    calculationRule: "",
    evidenceRule: "以权威业务系统记录与验收证据为准",
    applicabilityRule: "无有效样本时标记 N/A，不得直接记 0",
    exceptionRule: "异常进入人工复核，保留原始值与调整理由",
    approvalRule: "主管审核、总经理终审",
    ownerRole: "HR",
    dataSource: "业务系统",
    ...partial,
  } as PerformanceMetricSpec;
}

export function monthlyMetricTemplate(): PerformanceMetricSpec[] {
  return [
    metric({
      metricId: "M-001",
      name: "任务按期有效闭环率",
      period: "MONTHLY",
      applicableRoles: ["*"],
      weight: "70",
      metricType: "PIECEWISE_LINEAR",
      dataSource: "飞书团队执行看板+决策模型过程管理数据",
      scoringAnchors: [
        { raw: "0", score: "0" },
        { raw: "60", score: "60" },
        { raw: "80", score: "80" },
        { raw: "100", score: "100" },
        { raw: "110", score: "110" },
      ],
      maxScore: "110",
      calculationRule:
        "有效闭环率 = 按期验收通过任务权重总和 ÷ 当期应完成任务权重总和 × 100%",
      ownerRole: "直属主管",
    }),
    metric({
      metricId: "M-002",
      name: "岗位胜任能力考试",
      period: "MONTHLY",
      applicableRoles: ["*"],
      weight: "15",
      metricType: "POSITIVE_LINEAR",
      dataSource: "Anari Academy 正式考试",
      target: "100",
      maxScore: "100",
      calculationRule: "正式考试百分制成绩；练习成绩不得替代；无安排记 N/A",
      ownerRole: "HR",
    }),
    metric({
      metricId: "M-003",
      name: "价值观落地",
      period: "MONTHLY",
      applicableRoles: ["*"],
      weight: "15",
      metricType: "INTERVAL_EVENT",
      dataSource: "经核实的价值观践行事件证据",
      minScore: "0",
      maxScore: "110",
      calculationRule:
        "以 100 分为基准：突出正向 +1~+5，明显负向 -1~-5，重大正向 +5~+10，严重负向 -5~-15；累计后钳制 0~110",
      ownerRole: "直属主管",
    }),
  ];
}

const QUARTERLY_TEMPLATES: Record<
  string,
  Array<Omit<PerformanceMetricSpec, "period" | "version" | "sourceFields" | "calculationRule" | "evidenceRule" | "applicabilityRule" | "exceptionRule" | "approvalRule" | "ownerRole" | "dataSource"> & Partial<PerformanceMetricSpec>>
> = {
  SALES: [
    { metricId: "Q-S-001", name: "实际回款额", applicableRoles: ["SALES"], weight: "30", metricType: "POSITIVE_LINEAR", dataSource: "AI财务+商务系统" },
    { metricId: "Q-S-002", name: "实际贡献毛利额", applicableRoles: ["SALES"], weight: "35", metricType: "POSITIVE_LINEAR", dataSource: "AI财务+商务+ERP" },
    { metricId: "Q-S-003", name: "有效商机额", applicableRoles: ["SALES"], weight: "15", metricType: "POSITIVE_LINEAR", dataSource: "CRM" },
    { metricId: "Q-S-004", name: "L2C 转化率", applicableRoles: ["SALES"], weight: "10", metricType: "PIECEWISE_LINEAR", dataSource: "CRM" },
    { metricId: "Q-S-005", name: "CRM 数据卫生", applicableRoles: ["SALES"], weight: "10", metricType: "PIECEWISE_LINEAR", dataSource: "CRM" },
  ],
  EXECUTIVE_DIRECTOR: [
    { metricId: "Q-ED-001", name: "有效营销询盘数", applicableRoles: ["EXECUTIVE_DIRECTOR"], weight: "20", metricType: "POSITIVE_LINEAR", dataSource: "AI Marketing+CRM" },
    { metricId: "Q-ED-002", name: "有效询盘转化率", applicableRoles: ["EXECUTIVE_DIRECTOR"], weight: "15", metricType: "PIECEWISE_LINEAR", dataSource: "CRM" },
    { metricId: "Q-ED-003", name: "营销 ROAS", applicableRoles: ["EXECUTIVE_DIRECTOR"], weight: "15", metricType: "POSITIVE_LINEAR", dataSource: "AI Marketing+AI财务" },
    { metricId: "Q-ED-004", name: "业务中心收入目标达成率", applicableRoles: ["EXECUTIVE_DIRECTOR"], weight: "25", metricType: "POSITIVE_LINEAR", dataSource: "AI财务+商务系统" },
    { metricId: "Q-ED-005", name: "全员 OKR 加权完成率", applicableRoles: ["EXECUTIVE_DIRECTOR"], weight: "25", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "OKR 系统" },
  ],
  PRODUCT_MANAGER: [
    { metricId: "Q-PM-001", name: "季度承诺工作包有效完成率", applicableRoles: ["PRODUCT_MANAGER"], weight: "45", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "PingCode/Gitee" },
    { metricId: "Q-PM-002", name: "客户定制及产品支持任务闭环率", applicableRoles: ["PRODUCT_MANAGER"], weight: "30", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "工单系统+PingCode" },
    { metricId: "Q-PM-003", name: "产品问题分析与持续迭代", applicableRoles: ["PRODUCT_MANAGER"], weight: "15", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "工单+PingCode+Gitee" },
    { metricId: "Q-PM-004", name: "知识库及产品培训贡献", applicableRoles: ["PRODUCT_MANAGER"], weight: "10", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "知识库+Anari Academy" },
  ],
  CUSTOMER_SERVICE: [
    { metricId: "Q-CS-001", name: "售前技术支持有效交付", applicableRoles: ["CUSTOMER_SERVICE"], weight: "25", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "CRM+工单系统" },
    { metricId: "Q-CS-002", name: "售后技术服务有效解决", applicableRoles: ["CUSTOMER_SERVICE"], weight: "35", metricType: "PIECEWISE_LINEAR", dataSource: "工单系统" },
    { metricId: "Q-CS-003", name: "内部技术支持任务闭环", applicableRoles: ["CUSTOMER_SERVICE"], weight: "20", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "工单+PingCode" },
    { metricId: "Q-CS-004", name: "知识库及培训贡献", applicableRoles: ["CUSTOMER_SERVICE"], weight: "10", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "Anari Academy+知识库" },
    { metricId: "Q-CS-005", name: "服务过程质量", applicableRoles: ["CUSTOMER_SERVICE"], weight: "10", metricType: "PIECEWISE_LINEAR", dataSource: "工单+CRM" },
  ],
  SUPPLY_CHAIN: [
    { metricId: "Q-SC-001", name: "采购需求按期交付率", applicableRoles: ["SUPPLY_CHAIN"], weight: "35", metricType: "PIECEWISE_LINEAR", dataSource: "ERP" },
    { metricId: "Q-SC-002", name: "ERP 供应商综合绩效", applicableRoles: ["SUPPLY_CHAIN"], weight: "35", metricType: "PIECEWISE_LINEAR", dataSource: "ERP" },
    { metricId: "Q-SC-003", name: "可验证采购成本优化", applicableRoles: ["SUPPLY_CHAIN"], weight: "20", metricType: "POSITIVE_LINEAR", dataSource: "ERP+AI财务" },
    { metricId: "Q-SC-004", name: "采购异常处理闭环率", applicableRoles: ["SUPPLY_CHAIN"], weight: "10", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "ERP+工单+商务" },
  ],
  FINANCE: [
    { metricId: "Q-F-001", name: "财务基础工作质量与及时性", applicableRoles: ["FINANCE"], weight: "30", metricType: "PIECEWISE_LINEAR", dataSource: "AI财务" },
    { metricId: "Q-F-002", name: "出口退税及时率及申报质量", applicableRoles: ["FINANCE"], weight: "25", metricType: "PIECEWISE_LINEAR", dataSource: "AI财务" },
    { metricId: "Q-F-003", name: "费用预算管理与控制", applicableRoles: ["FINANCE"], weight: "25", metricType: "PIECEWISE_LINEAR", dataSource: "AI财务+ERP" },
    { metricId: "Q-F-004", name: "经营分析与财务改善成果", applicableRoles: ["FINANCE"], weight: "20", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "AI财务+商务/PingCode" },
  ],
};

export function quarterlyMetricTemplate(roleCode: string): PerformanceMetricSpec[] {
  const key = roleCode.toUpperCase().replace(/-/g, "_");
  const rows = QUARTERLY_TEMPLATES[key];
  if (!rows) {
    throw new Error(
      `no quarterly metric template for role ${roleCode}; 由总经理按最相近岗位归级并更新附件`,
    );
  }
  return rows.map((row) =>
    metric({
      ...row,
      period: "QUARTERLY",
      sourceFields: [],
      calculationRule: "按事前锁定的目标卡与评分函数计算",
    }),
  );
}

export function annualMetricTemplate(): PerformanceMetricSpec[] {
  return [
    metric({ metricId: "ANNUAL-REVENUE", name: "公司确认收入达成率", period: "ANNUAL", applicableRoles: ["*"], weight: "20", metricType: "POSITIVE_LINEAR", dataSource: "AI财务系统", target: "100", maxScore: "120" }),
    metric({ metricId: "ANNUAL-PROFIT", name: "公司年度可分配净利润达成率", period: "ANNUAL", applicableRoles: ["*"], weight: "30", metricType: "POSITIVE_LINEAR", dataSource: "AI财务系统", target: "100", maxScore: "120" }),
    metric({ metricId: "ANNUAL-COLLECTION", name: "净回款达成率", period: "ANNUAL", applicableRoles: ["*"], weight: "20", metricType: "POSITIVE_LINEAR", dataSource: "AI财务系统", target: "100", maxScore: "120" }),
    metric({ metricId: "ANNUAL-STRATEGY", name: "公司年度关键战略成果完成率", period: "ANNUAL", applicableRoles: ["*"], weight: "30", metricType: "WEIGHTED_ACCEPTANCE", dataSource: "OKR/商务/CRM/PingCode/ERP", maxScore: "120" }),
  ];
}
