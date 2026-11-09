/**
 * Types for the institutional policy set effective 2026-11-09:
 *
 * - 安纳瑞能源绩效考核与激励管理制度（017）
 * - 安纳瑞能源绩效考核制度配套附件（018）
 * - 安纳瑞能源激励分配制度（016）
 * - 安纳瑞股权激励管理办法（011）
 * - 产品技术中心专项激励政策（008）
 * - 销售激励制度（003）
 * - 任务制与 AI 原生组织推进说明
 *
 * All calculations are deterministic and money uses DecimalString inputs; the
 * engines in @anari/policy-dsl return DecimalString outputs.
 */
import type { DecimalString, UUID } from "./types.js";

// ---------------------------------------------------------------------------
// Performance appraisal (017 / 018)
// ---------------------------------------------------------------------------

export type PerformancePeriod = "MONTHLY" | "QUARTERLY" | "ANNUAL";

/** B.2 五类评分函数。 */
export type ScoringFunction =
  | "POSITIVE_LINEAR"
  | "REVERSE_LINEAR"
  | "PIECEWISE_LINEAR"
  | "WEIGHTED_ACCEPTANCE"
  | "INTERVAL_EVENT";

export type PerformanceGrade = "S" | "A" | "B" | "C" | "D";

export interface ScoringAnchor {
  /** 原始指标值锚点。 */
  raw: DecimalString;
  /** 该锚点对应得分。 */
  score: DecimalString;
}

/** A.1 指标字典：每个指标必须具备的元数据。 */
export interface PerformanceMetricSpec {
  metricId: string;
  name: string;
  period: PerformancePeriod;
  applicableRoles: string[];
  /** 权重，百分数，例如 70 表示 70%。同一岗位同一周期合计 100。 */
  weight: DecimalString;
  metricType: ScoringFunction;
  dataSource: string;
  sourceFields: string[];
  calculationRule: string;
  /** 目标值；正向线性目标值对应 100 分。 */
  target?: DecimalString;
  scoringAnchors?: ScoringAnchor[];
  /** A 类单项封顶，默认 150（B.4）。 */
  maxScore?: DecimalString;
  ownerRole: string;
  evidenceRule: string;
  applicabilityRule: string;
  exceptionRule: string;
  approvalRule: string;
  /** M-003 事件分值上下限。 */
  minScore?: DecimalString;
  maxEventAdjustment?: DecimalString;
  version: number;
}

export interface MetricMeasurement {
  metricId: string;
  /** 原始值。N/A 时可为空。 */
  rawValue?: DecimalString | null;
  applicable: boolean;
  naReason?: string;
  /** M-003 经核实事件累计调整值（已由人工认定）。 */
  eventAdjustment?: DecimalString;
  /** D 类加权验收的里程碑得分合计（0-100）。 */
  acceptanceScore?: DecimalString;
  evidenceRefs?: string[];
  /** 样本量/样本口径，用于异常提示。 */
  sampleSize?: number;
}

export interface PerformanceScoreRequest {
  personId: UUID;
  period: PerformancePeriod;
  metrics: PerformanceMetricSpec[];
  measurements: MetricMeasurement[];
  /** 主管人工调整（仅允许调整综合分，需说明理由）。 */
  manualAdjustment?: DecimalString;
  manualAdjustmentReason?: string;
  performanceGrade?: PerformanceGrade;
}

/**
 * 第十三条 季度目标卡 / A.1 指标集：季度开始前锁定目标、权重、
 * 评分函数、数据源与异常规则；锁定后不得追溯调整。
 */
export interface PerformanceGoalCard {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  period: PerformancePeriod;
  roleCode: string;
  metrics: PerformanceMetricSpec[];
  status: "DRAFT" | "LOCKED" | "ADJUSTED";
  lockedAt?: string;
  lockedBy?: UUID;
  adjustmentReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PerformanceComponentResult {
  metricId: string;
  name: string;
  applicable: boolean;
  naReason?: string;
  rawValue?: DecimalString;
  score: DecimalString;
  /** 实际参与归一化的权重（N/A 后按比例放大）。 */
  effectiveWeight: DecimalString;
  weightedScore: DecimalString;
  capped: boolean;
}

export interface PerformanceScoreResult {
  personId: UUID;
  period: PerformancePeriod;
  components: PerformanceComponentResult[];
  /** 加权原始分（未封顶）。 */
  rawScore: DecimalString;
  /** 含人工调整后的综合分（未按周期封顶）。 */
  scoreBeforeCap: DecimalString;
  /** 周期封顶后的正式综合得分 S。 */
  finalScore: DecimalString;
  cycleCap: DecimalString;
  /** 通用绩效系数 Kp = S / 100，保留 4 位小数。 */
  kp: DecimalString;
  naMetricIds: string[];
  renormalized: boolean;
  complete: boolean;
  note?: string;
  resultHash: string;
}

/** 第二十条 / C.4 月度绩效工资。 */
export type WageBand = "BASE" | "MANAGER" | "DIRECTOR";

export interface MonthlyPerformanceWageInput {
  monthlyTotalWage: DecimalString;
  wageBand: WageBand;
  monthlyScore: DecimalString;
  /** 职级浮动比例覆盖值，百分数；不传则按制度 20/30/40。 */
  floatingRatePercent?: DecimalString;
}

export interface MonthlyPerformanceWageResult {
  floatingRatePercent: DecimalString;
  performanceWageStandard: DecimalString;
  kp: DecimalString;
  payable: DecimalString;
  cappedAtOnePointOne: boolean;
}

/** 第十一条 / C.2 职能部门季度奖金。 */
export interface FunctionalQuarterlyBonusInput {
  fixedMonthlyWage: DecimalString;
  quarterlyScore: DecimalString;
}

export interface FunctionalQuarterlyBonusResult {
  quarterlyScore: DecimalString;
  kq: DecimalString;
  eligible: boolean;
  baseAmount: DecimalString;
  amount: DecimalString;
}

/** 第十四条 / A.9 公司年度计分卡。 */
export interface AnnualScorecardComponentInput {
  metricId: string;
  name: string;
  weightPercent: DecimalString;
  /** 单项得分，按制度单项原则上封顶 120。 */
  score: DecimalString;
}

export interface AnnualScorecardInput {
  revenueAchievementScore: DecimalString;
  distributableProfitAchievementScore: DecimalString;
  netCollectionAchievementScore: DecimalString;
  strategyAchievementScore: DecimalString;
  /** 年度可分配净利润与目标，用于判断职能年终奖前置条件。 */
  distributableNetProfit?: DecimalString;
  netProfitTarget?: DecimalString;
  /** 总经理确定的职能年终奖池计提比例（5-10）。 */
  functionalBonusPoolRatePercent?: DecimalString;
}

export interface AnnualScorecardResult {
  components: AnnualScorecardComponentInput[];
  weightedScore: DecimalString;
  companyScore: DecimalString;
  kp: DecimalString;
  profitTargetMet: boolean;
  functionalBonusPoolRatePercent: DecimalString;
}

/** 第十二条 职能部门年度利润分享。 */
export interface AnnualProfitSharingPersonInput {
  personId: UUID;
  /** 固定月工资基数。 */
  monthlyWageBase: DecimalString;
  /** 职级系数：基层 1.0、经理级 1.5、总监级 2.0。 */
  gradeCoefficient: DecimalString;
  /** 个人有效季度 Kp 加权平均。 */
  weightedQuarterlyKp: DecimalString;
  /** 年度在岗比例 0-1。 */
  attendanceRatio: DecimalString;
}

export interface AnnualProfitSharingInput {
  distributableNetProfit: DecimalString;
  netProfitTarget: DecimalString;
  /** 总经理确定的池子计提比例，百分数 5-10。 */
  poolRatePercent: DecimalString;
  people: AnnualProfitSharingPersonInput[];
  /** 已预留激励预算余额，作为硬约束。 */
  reservedBudgetBalance?: DecimalString;
}

export interface AnnualProfitSharingAllocation {
  personId: UUID;
  valuePoints: DecimalString;
  points: DecimalString;
  amount: DecimalString;
}

export interface AnnualProfitSharingResult {
  eligible: boolean;
  reason?: string;
  poolRatePercent: DecimalString;
  poolAmount: DecimalString;
  approvedPoolAmount: DecimalString;
  totalPoints: DecimalString;
  allocations: AnnualProfitSharingAllocation[];
}

/** 第九条 月明星。 */
export interface MonthlyStarCandidate {
  personId: UUID;
  rank: number;
  monthlyScore: DecimalString;
  /** 价值观单项得分；月明星评选按 20 分制填报。 */
  m003Score: DecimalString;
  verifiedPositiveEvents: number;
  seriousViolation: boolean;
  /** 连续满足条件的自然月数（含当月）。 */
  consecutiveMonths: number;
  awardedThisYear: number;
}

export interface MonthlyStarEvaluationResult {
  awarded: boolean;
  candidates: Array<{
    personId: UUID;
    eligible: boolean;
    reasonCode?: string;
    amount: DecimalString;
  }>;
  note?: string;
}

// ---------------------------------------------------------------------------
// Incentive allocation (016)
// ---------------------------------------------------------------------------

export interface DbcpStatementInput {
  grossProfit: DecimalString;
  businessExpenses: DecimalString;
  laborAndTravel: DecimalString;
  allocatedBusinessUnitExpenses: DecimalString;
  allocatedBackendPayroll: DecimalString;
  /** 管理计提比例，百分数，默认 5。 */
  managementProvisionRatePercent?: DecimalString;
  /** 管理计提基数，默认毛利。 */
  managementProvisionBase?: DecimalString;
}

export interface DbcpStatementResult {
  grossProfit: DecimalString;
  totalDeductions: DecimalString;
  managementProvision: DecimalString;
  dbcp: DecimalString;
}

export interface BusinessUnitCommissionInput {
  dbcp: DecimalString;
  netCollection: DecimalString;
  /** 覆盖档位表，用于模拟；不传使用制度默认档位。 */
  bands?: Array<{ minMarginPercent: DecimalString; ratePercent: DecimalString }>;
}

export interface BusinessUnitCommissionResult {
  marginPercent: DecimalString;
  bandRatePercent: DecimalString;
  commission: DecimalString;
  eligible: boolean;
  reason?: string;
}

/** 第八条 执行总监管理补差。 */
export interface ExecutiveSupplementInput {
  dbcp: DecimalString;
  managementScore: DecimalString;
  marketingReward: DecimalString;
}

export interface ExecutiveSupplementResult {
  managementK: DecimalString;
  grossSupplement: DecimalString;
  supplement: DecimalString;
}

export interface InternalSplitParticipant {
  personId: UUID;
  /** 占剩余池 R 的比例，百分数。 */
  sharePercent: DecimalString;
}

export interface InternalSplitInput {
  commissionPool: DecimalString;
  marketingReward: DecimalString;
  executiveSupplement: DecimalString;
  participants: InternalSplitParticipant[];
}

export interface InternalSplitResult {
  remainingPool: DecimalString;
  allocated: DecimalString;
  unallocated: DecimalString;
  allocations: Array<{ personId: UUID; amount: DecimalString }>;
  valid: boolean;
  errors: string[];
}

/** 第十四条 悬赏核定。 */
export type BountyQualityGrade =
  | "PASS"
  | "MINOR_DEFECT"
  | "REWORK"
  | "MULTIPLE_REWORK"
  | "FAILED";

export interface BountySettlementInput {
  baseReward: DecimalString;
  delayWorkingDays: number;
  keyMilestoneMissed?: boolean;
  extensionApproved?: boolean;
  qualityGrade: BountyQualityGrade;
  personalContributionShare: DecimalString;
  /** 已支付金额，用于计算追回上限。 */
  paidAmount?: DecimalString;
}

export interface BountySettlementResult {
  timeCoefficient: DecimalString;
  qualityCoefficient: DecimalString;
  amount: DecimalString;
  recoverableAmount: DecimalString;
}

/** 008 产品技术中心专项奖励。 */
export type TechCenterAwardType =
  | "INVENTION_PATENT_ACCEPTED"
  | "INVENTION_PATENT_GRANTED"
  | "UTILITY_OR_SOFTWARE_ACCEPTED"
  | "UTILITY_OR_SOFTWARE_GRANTED"
  | "DESIGN_PATENT_GRANTED"
  | "TECH_BREAKTHROUGH"
  | "TECH_BREAKTHROUGH_SIGNIFICANT"
  | "CUSTOM_PROJECT"
  | "COST_OPTIMIZATION"
  | "HARDWARE_AC_DELIVERY"
  | "HARDWARE_DC_DELIVERY"
  | "SOFTWARE_MILESTONE"
  | "SOFTWARE_GA_STABLE"
  | "SLA_MONTH"
  | "KNOWLEDGE_CONTRIBUTION"
  | "CUSTOMER_SATISFACTION_QUARTER"
  | "STRATEGIC_CUSTOMER_SUPPORT"
  | "TEAM_EXCELLENCE"
  | "SPECIAL_TECH_CONTRIBUTION";

export interface TechCenterAwardInput {
  awardType: TechCenterAwardType;
  /** 定制项目费、年度节约金额、GA 奖励等可变基数。 */
  baseAmount?: DecimalString;
  /** 专利/软著数量、知识点条数、里程碑数量、项目数量等。 */
  quantity?: number;
  /** 延期比例（硬件项目），0-1。 */
  delayRatio?: DecimalString;
  /** 特殊技术贡献由总经理核定金额。 */
  approvedAmount?: DecimalString;
  /** 个人贡献分配比例 0-1。 */
  personalShare?: DecimalString;
}

export interface TechCenterAwardResult {
  awardType: TechCenterAwardType;
  grossAmount: DecimalString;
  personalAmount: DecimalString;
  cappable: boolean;
  note?: string;
}

export interface TechCenterPoolInput {
  totalBusinessCommission: DecimalString;
  members: Array<{
    personId: UUID;
    positionCoefficient: DecimalString;
    projectContribution: DecimalString;
    performanceCoefficient: DecimalString;
  }>;
  /** 负责人四项考核结果。 */
  headReview?: {
    roadmapAchievementPercent: DecimalString;
    crossFunctionalSatisfaction: DecimalString;
    techDebtControlled: boolean;
    retentionMet: boolean;
  };
  headPersonId?: UUID;
}

export interface TechCenterPoolResult {
  poolAmount: DecimalString;
  headAdjustment: DecimalString;
  allocations: Array<{ personId: UUID; weight: DecimalString; amount: DecimalString }>;
}

/** 003 海外销售激励。 */
export interface OverseasSalesAwardInput {
  awardType:
    | "NEW_CUSTOMER_STAR"
    | "KA_BREAKTHROUGH"
    | "IMPORTANT_CUSTOMER_BREAKTHROUGH"
    | "QUARTERLY_CHAMPION"
    | "ANNUAL_CHAMPION";
  newCustomerCount?: number;
  annualCustomerOrderAmount?: DecimalString;
  firstSigning?: boolean;
  rank?: number;
  targetExceeded?: boolean;
  /** 退款/坏账损失金额，按 50% 追减。 */
  badDebtLoss?: DecimalString;
  /** KA 次年在手订单下降比例 0-1，>30% 时追回 50%。 */
  kaNextYearDropRatio?: DecimalString;
  paidAmount?: DecimalString;
  maliciousPoaching?: boolean;
}

export interface OverseasSalesAwardResult {
  grossAmount: DecimalString;
  deduction: DecimalString;
  netAmount: DecimalString;
  recoverableAmount: DecimalString;
  disqualified: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Equity incentive (011)
// ---------------------------------------------------------------------------

export type EquityInstrument =
  | "LP_SHARE"
  | "OPTION"
  | "RSU"
  | "REFRESH"
  | "PHANTOM";

export type EquityPositionLevel = "L1" | "L2" | "L3" | "L4" | "L5";
export type FinancingStage = "PRE_A" | "A" | "B" | "C_PRE_IPO" | "POST_IPO";
export type TenureStage = "FOUNDING" | "A" | "B" | "C";
export type EquityPerformanceGrade = "S" | "A" | "B" | "C" | "D";

export interface GrantCalculationInput {
  positionLevel: EquityPositionLevel;
  financingStage: FinancingStage;
  performanceGrade: EquityPerformanceGrade;
  tenureStage: TenureStage;
  /** 岗位基准比例（百分数）；不传则取矩阵区间中值。 */
  positionBasePercent?: DecimalString;
  /** 当前累计授予比例（完全摊薄后，百分数），用于饱和检查。 */
  existingGrantPercent?: DecimalString;
  /** 本次是否为 Refresh。 */
  isRefresh?: boolean;
  /** 初始授予比例，Refresh 基数。 */
  initialGrantPercent?: DecimalString;
}

export interface GrantCalculationResult {
  positionBasePercent: DecimalString;
  performanceCoefficient: DecimalString;
  tenureCoefficient: DecimalString;
  financingDiscountCoefficient: DecimalString;
  grantPercent: DecimalString;
  cumulativePercent: DecimalString;
  saturationCapPercent: DecimalString;
  withinSaturation: boolean;
  performanceGrade: EquityPerformanceGrade;
  note?: string;
}

export interface VestingPoint {
  /** 距授予日的月数。 */
  month: number;
  vestedPercent: DecimalString;
  vestedUnits: DecimalString;
}

export interface VestingScheduleInput {
  totalUnits: DecimalString;
  vestingStart: string;
  asOf: string;
  cliffMonths?: number;
  vestingMonths?: number;
  acceleration?: {
    type:
      | "NONE"
      | "DOUBLE_TRIGGER"
      | "DEATH_OR_DISABILITY"
      | "RETIREMENT"
      | "LIQUIDATION"
      | "IPO";
    /** 退休时已服务年限。 */
    serviceYears?: number;
  };
}

export interface VestingScheduleResult {
  asOf: string;
  vestingStart: string;
  cliffMonths: number;
  vestingMonths: number;
  vestedUnits: DecimalString;
  unvestedUnits: DecimalString;
  vestedPercent: DecimalString;
  acceleratedUnits: DecimalString;
  fullyVested: boolean;
  points: VestingPoint[];
  note?: string;
}

export type RepurchaseScenario =
  | "VOLUNTARY"
  | "INVOLUNTARY"
  | "FAULT"
  | "RETIREMENT"
  | "DEATH";

export interface RepurchaseInput {
  scenario: RepurchaseScenario;
  /** 已持有月数（用于 12 个月最低持有期）。 */
  holdingMonths: number;
  /** 授予成本/注册资本对应份额。 */
  costAmount: DecimalString;
  /** 最近一轮融资投后估值（每股/每份价格）。 */
  latestFinancingPrice?: DecimalString;
  shares?: DecimalString;
  /** 经审计净资产。 */
  auditedNetAssets?: DecimalString;
  registeredCapital?: DecimalString;
  /** 第三方评估值。 */
  appraisalValue?: DecimalString;
  /** 融资估值偏离实际经营是否超过 50%。 */
  valuationDeviationOver50Percent?: boolean;
}

export interface RepurchaseResult {
  scenario: RepurchaseScenario;
  fairValuePerUnit: DecimalString;
  repurchasePrice: DecimalString;
  noticeDeadlineDays: number;
  completionDeadlineDays: number;
  liquidityDiscountApplied: boolean;
  minimumPriceApplied: boolean;
  installmentAllowed: boolean;
  annualCapApplied: boolean;
  note?: string;
}

export interface CapTableSnapshotInput {
  totalShares: DecimalString;
  grants: Array<{
    personId: UUID;
    positionLevel: EquityPositionLevel;
    instrument: EquityInstrument;
    grantedPercent: DecimalString;
    vestedPercent: DecimalString;
  }>;
}

export interface CapTableSnapshotResult {
  totalGrantedPercent: DecimalString;
  poolRemainingPercent: DecimalString;
  saturation: Array<{
    personId: UUID;
    positionLevel: EquityPositionLevel;
    cumulativePercent: DecimalString;
    capPercent: DecimalString;
    saturated: boolean;
  }>;
}

/** 第29-33条：递延纳税与未备案两种税务口径测算。 */
export interface EquityTaxInput {
  deferredFiling: boolean;
  strikePrice: DecimalString;
  fairValuePerUnit: DecimalString;
  units: DecimalString;
  /** 转让/回购价格；递延口径下用于计算财产转让所得。 */
  salePricePerUnit?: DecimalString;
  /** 未备案时按工资薪金所得适用税率；默认 20%。 */
  wageTaxRatePercent?: DecimalString;
}

export interface EquityTaxResult {
  deferredFiling: boolean;
  taxableBase: DecimalString;
  taxRatePercent: DecimalString;
  taxAmount: DecimalString;
  note: string;
}

/** 第15-16条 授予决策流程与第29条税务备案。 */
export type EquityGrantCaseStatus =
  | "QUALIFICATION"
  | "CALCULATION"
  | "PLAN"
  | "SHAREHOLDER_APPROVAL"
  | "AGREEMENT"
  | "REGISTRATION"
  | "TAX_FILING"
  | "LEDGERED"
  | "REJECTED";

export interface EquityGrantCase {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  instrument: EquityInstrument;
  status: EquityGrantCaseStatus;
  positionLevel: EquityPositionLevel;
  financingStage: FinancingStage;
  performanceGrade: EquityPerformanceGrade;
  tenureStage: TenureStage;
  grantPercent: DecimalString;
  totalUnits: DecimalString;
  strikePrice: DecimalString;
  married: boolean;
  spouseConfirmationSigned: boolean;
  agreementSigned: boolean;
  /** 《员工承诺函》确认知悉创业公司风险与税务风险。 */
  riskAcknowledged: boolean;
  shareholderResolutionRef?: string;
  taxFilingRef?: string;
  capTableUpdated: boolean;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Task pods and AI-native organisation
// ---------------------------------------------------------------------------

export type TaskPodStatus = "OPEN" | "ACTIVE" | "COMPLETED" | "DISSOLVED";
export type TaskPodMemberKind = "PERSON" | "AI";
export type TaskExecutionMode = "HUMAN" | "AI" | "HYBRID";

export interface TaskPodMember {
  kind: TaskPodMemberKind;
  /** 人员 ID 或 AI 成员 ID。 */
  memberId: UUID;
  role: string;
  /** AI 成员的版本快照。 */
  aiVersion?: string;
  responsibility?: string;
}

export interface TaskPod {
  id: UUID;
  tenantId: UUID;
  title: string;
  objective: string;
  /** 发起人对结果负责。 */
  initiatorPersonId: UUID;
  status: TaskPodStatus;
  members: TaskPodMember[];
  startsAt: string;
  dueAt?: string;
  completedAt?: string;
  /** 完成后是否转入下一任务。 */
  successorTaskPodId?: UUID;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AiMember {
  id: UUID;
  tenantId: UUID;
  name: string;
  role: string;
  /** AI 成员自身的版本号，例如 1.2.0；任务组须记录版本快照。 */
  aiVersion: string;
  responsibilities: string[];
  /** 登记 AI 成员的负责人。 */
  ownerPersonId: UUID;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** 记录版本（乐观锁）。 */
  version: number;
}

export interface PersonalTaskItem {
  taskId: string;
  name: string;
  deliverable: string;
  measure: string;
  mode: TaskExecutionMode;
  /** AI 化工作流说明（人机协同/全 AI 任务必填）。 */
  aiWorkflow?: string;
  /** 是否为本人最高频、最耗时任务。 */
  aiTransformationCandidate?: boolean;
}

export interface PersonalTaskInventory {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  period: string;
  tasks: PersonalTaskItem[];
  status: "DRAFT" | "SUBMITTED" | "ACCEPTED" | "RETURNED";
  reviewerPersonId?: UUID;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * 制度计算留痕记录：绩效评分、月明星、DBCP、激励核定、股权回购、
 * 任务组与 AI 成员等统一以类型化 JSONB 记录，保留版本与时间。
 */
export interface PolicyEngineRecord {
  id: UUID;
  tenantId: UUID;
  recordType: string;
  personId?: UUID;
  period?: string;
  status?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Incentive award batches (016/008/003 payout shell)
// ---------------------------------------------------------------------------

export type IncentiveAwardType =
  | "BUSINESS_UNIT_COMMISSION"
  | "FUNCTIONAL_QUARTERLY_BONUS"
  | "ANNUAL_PROFIT_SHARING"
  | "MONTHLY_STAR"
  | "TECH_CENTER_AWARD"
  | "OVERSEAS_SALES_AWARD"
  | "BOUNTY_SETTLEMENT"
  | "MANUAL";

export type IncentiveAwardBatchStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "LOCKED"
  | "EXPORTED"
  | "ACKNOWLEDGED"
  | "CANCELLED";

export interface IncentiveAwardLine {
  id: UUID;
  batchId: UUID;
  personId: UUID;
  amount: DecimalString;
  currency: string;
  sourceRecordId?: UUID;
  sourceLineRef?: string;
  note?: string;
}

/**
 * 制度激励发放批次：把政策计算器结果变成可审批、可锁定、可导出、
 * 可回执的应付批次。金额事实不写入订单计算账本，避免与业务提成
 * 的 settlement/payroll 通道重复出账；来源 record 只允许被一个
 * 非取消批次引用。
 */
export interface IncentiveAwardBatch {
  id: UUID;
  tenantId: UUID;
  batchNo: string;
  awardType: IncentiveAwardType;
  period: string;
  cycleId?: UUID;
  currency: string;
  status: IncentiveAwardBatchStatus;
  totalAmount: DecimalString;
  lineCount: number;
  sourceRecordIds: UUID[];
  createdBy: UUID;
  approvedBy?: UUID;
  approvedAt?: string;
  lockedAt?: string;
  exportedAt?: string;
  acknowledgedAt?: string;
  paymentRef?: string;
  lines: IncentiveAwardLine[];
  createdAt: string;
  updatedAt: string;
  version: number;
}
