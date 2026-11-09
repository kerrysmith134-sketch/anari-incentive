import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  FormField,
  InfoNotice,
  PageHeader,
  Panel,
  Select,
  Tabs,
  Textarea,
  TextInput,
} from "../components/ui.js";
import { PersonSelect } from "../components/PersonSelect.js";
import { useToast } from "../contexts/ToastContext.js";
import { api, ApiError } from "../lib/api.js";
import { useDocumentTitle } from "../lib/hooks.js";

interface PerformanceComponent {
  metricId: string;
  name: string;
  score: string;
  effectiveWeight: string;
  weightedScore: string;
  applicable: boolean;
  naReason?: string;
}

interface PerformanceScore {
  finalScore: string;
  kp: string;
  rawScore: string;
  complete: boolean;
  renormalized: boolean;
  note?: string;
  components: PerformanceComponent[];
  naMetricIds: string[];
}

interface ClosureRate {
  taskCount: number;
  requiredWeight: string;
  qualifiedWeight: string;
  closureRate: string;
  note?: string;
  tasks: Array<{
    workPackageId: string;
    title: string;
    grade: string;
    weight: string;
    status: string;
    validClosure: boolean;
    reason?: string;
  }>;
}

interface EquityTax {
  deferredFiling: boolean;
  taxableBase: string;
  taxRatePercent: string;
  taxAmount: string;
  note: string;
}

interface AnnualScorecard {
  companyScore: string;
  kp: string;
  weightedScore: string;
  profitTargetMet: boolean;
  functionalBonusPoolRatePercent: string;
}

interface MonthlyStar {
  awarded: boolean;
  note?: string;
  candidates: Array<{
    personId: string;
    eligible: boolean;
    reasonCode?: string;
    amount: string;
  }>;
}

interface DbcpResult {
  grossProfit: string;
  totalDeductions: string;
  managementProvision: string;
  dbcp: string;
}

interface CommissionResult {
  marginPercent: string;
  bandRatePercent: string;
  commission: string;
  eligible: boolean;
  reason?: string;
}

interface SupplementResult {
  managementK: string;
  grossSupplement: string;
  supplement: string;
}

interface ProfitSharingResult {
  eligible: boolean;
  reason?: string;
  poolRatePercent: string;
  poolAmount: string;
  approvedPoolAmount: string;
  totalPoints: string;
  allocations: Array<{ personId: string; valuePoints: string; points: string; amount: string }>;
}

interface BountyResult {
  timeCoefficient: string;
  qualityCoefficient: string;
  amount: string;
  recoverableAmount: string;
}

interface TechAwardResult {
  awardType: string;
  grossAmount: string;
  personalAmount: string;
  note?: string;
}

interface OverseasResult {
  grossAmount: string;
  deduction: string;
  netAmount: string;
  recoverableAmount: string;
  disqualified: boolean;
  note?: string;
}

interface GrantResult {
  positionBasePercent: string;
  performanceCoefficient: string;
  tenureCoefficient: string;
  grantPercent: string;
  cumulativePercent: string;
  saturationCapPercent: string;
  withinSaturation: boolean;
  note?: string;
}

interface VestingResult {
  vestedUnits: string;
  unvestedUnits: string;
  vestedPercent: string;
  acceleratedUnits: string;
  fullyVested: boolean;
  note?: string;
}

interface RepurchaseResult {
  fairValuePerUnit: string;
  repurchasePrice: string;
  noticeDeadlineDays: number;
  completionDeadlineDays: number;
  liquidityDiscountApplied: boolean;
  minimumPriceApplied: boolean;
  installmentAllowed: boolean;
  annualCapApplied: boolean;
  note?: string;
}

interface MonthlyWageResult {
  floatingRatePercent: string;
  performanceWageStandard: string;
  kp: string;
  payable: string;
  cappedAtOnePointOne: boolean;
}

interface FunctionalBonusResult {
  quarterlyScore: string;
  kq: string;
  eligible: boolean;
  baseAmount: string;
  amount: string;
}

interface StrikeResult {
  strikePrice: string;
  discountRatePercent: string;
}

interface CapTableResult {
  totalGrantedPercent: string;
  poolRemainingPercent: string;
  saturation: Array<{
    personId: string;
    positionLevel: string;
    cumulativePercent: string;
    capPercent: string;
    saturated: boolean;
  }>;
}

const MONTHLY_METRICS = [
  {
    metricId: "M-001",
    name: "任务按期有效闭环率",
    period: "MONTHLY",
    applicableRoles: ["*"],
    weight: "70",
    metricType: "PIECEWISE_LINEAR",
    dataSource: "飞书团队执行看板",
    sourceFields: [],
    calculationRule: "",
    ownerRole: "直属主管",
    evidenceRule: "",
    applicabilityRule: "",
    exceptionRule: "",
    approvalRule: "",
    version: 1,
    scoringAnchors: [
      { raw: "0", score: "0" },
      { raw: "60", score: "60" },
      { raw: "80", score: "80" },
      { raw: "100", score: "100" },
      { raw: "110", score: "110" },
    ],
    maxScore: "110",
  },
  {
    metricId: "M-002",
    name: "岗位胜任能力考试",
    period: "MONTHLY",
    applicableRoles: ["*"],
    weight: "15",
    metricType: "POSITIVE_LINEAR",
    dataSource: "Anari Academy",
    sourceFields: [],
    calculationRule: "",
    ownerRole: "HR",
    evidenceRule: "",
    applicabilityRule: "",
    exceptionRule: "",
    approvalRule: "",
    version: 1,
    target: "100",
    maxScore: "100",
  },
  {
    metricId: "M-003",
    name: "价值观落地",
    period: "MONTHLY",
    applicableRoles: ["*"],
    weight: "15",
    metricType: "INTERVAL_EVENT",
    dataSource: "价值观事件证据",
    sourceFields: [],
    calculationRule: "",
    ownerRole: "直属主管",
    evidenceRule: "",
    applicabilityRule: "",
    exceptionRule: "",
    approvalRule: "",
    version: 1,
    minScore: "0",
    maxScore: "110",
  },
];

/** 2026 制度中心：把 017/018 绩效、016 激励、008/003 专项、011 股权落到可计算界面。 */
export function InstitutionsPage() {
  useDocumentTitle("2026 制度中心");
  const toast = useToast();
  const [tab, setTab] = useState("performance");

  // 绩效
  const [personId, setPersonId] = useState("");
  const [closureRate, setClosureRate] = useState("95");
  const [examScore, setExamScore] = useState("90");
  const [valueAdjustment, setValueAdjustment] = useState("3");
  const [manualAdjustment, setManualAdjustment] = useState("0");
  const [manualReason, setManualReason] = useState("");
  const [performance, setPerformance] = useState<PerformanceScore | null>(null);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [closureStart, setClosureStart] = useState(
    new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10),
  );
  const [closureEnd, setClosureEnd] = useState(
    new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
  );
  const [closure, setClosure] = useState<ClosureRate | null>(null);

  const [revenueScore, setRevenueScore] = useState("100");
  const [profitScore, setProfitScore] = useState("105");
  const [collectionScore, setCollectionScore] = useState("100");
  const [strategyScore, setStrategyScore] = useState("110");
  const [netProfit, setNetProfit] = useState("12000000");
  const [profitTarget, setProfitTarget] = useState("10000000");
  const [poolRate, setPoolRate] = useState("8");
  const [scorecard, setScorecard] = useState<AnnualScorecard | null>(null);

  const [starRank, setStarRank] = useState("1");
  const [starScore, setStarScore] = useState("110");
  const [starM003, setStarM003] = useState("20");
  const [starEvents, setStarEvents] = useState("1");
  const [starConsecutive, setStarConsecutive] = useState("1");
  const [starViolation, setStarViolation] = useState(false);
  const [starAwarded, setStarAwarded] = useState("0");
  const [starResult, setStarResult] = useState<MonthlyStar | null>(null);

  // 激励
  const [grossProfit, setGrossProfit] = useState("1000000");
  const [businessExpenses, setBusinessExpenses] = useState("50000");
  const [laborTravel, setLaborTravel] = useState("100000");
  const [allocatedBu, setAllocatedBu] = useState("20000");
  const [allocatedBackend, setAllocatedBackend] = useState("30000");
  const [netCollection, setNetCollection] = useState("1000000");
  const [dbcpResult, setDbcpResult] = useState<DbcpResult | null>(null);
  const [commissionResult, setCommissionResult] = useState<CommissionResult | null>(null);

  const [managementScore, setManagementScore] = useState("90");
  const [marketingReward, setMarketingReward] = useState("5000");
  const [supplementResult, setSupplementResult] = useState<SupplementResult | null>(null);

  const [sharingProfit, setSharingProfit] = useState("10000000");
  const [sharingTarget, setSharingTarget] = useState("10000000");
  const [sharingRate, setSharingRate] = useState("8");
  const [wageBase, setWageBase] = useState("20000");
  const [gradeCoefficient, setGradeCoefficient] = useState("1.5");
  const [weightedKp, setWeightedKp] = useState("1.1");
  const [attendance, setAttendance] = useState("1");
  const [sharingResult, setSharingResult] = useState<ProfitSharingResult | null>(null);

  // 专项
  const [bountyBase, setBountyBase] = useState("10000");
  const [bountyDelay, setBountyDelay] = useState("5");
  const [bountyQuality, setBountyQuality] = useState("MINOR_DEFECT");
  const [bountyShare, setBountyShare] = useState("1");
  const [bountyResult, setBountyResult] = useState<BountyResult | null>(null);
  const [techAwardType, setTechAwardType] = useState("INVENTION_PATENT_GRANTED");
  const [techBase, setTechBase] = useState("100000");
  const [techResult, setTechResult] = useState<TechAwardResult | null>(null);
  const [overseasType, setOverseasType] = useState("NEW_CUSTOMER_STAR");
  const [overseasCount, setOverseasCount] = useState("8");
  const [overseasAmount, setOverseasAmount] = useState("5000000");
  const [overseasResult, setOverseasResult] = useState<OverseasResult | null>(null);

  // 股权
  const [positionLevel, setPositionLevel] = useState("L1");
  const [financingStage, setFinancingStage] = useState("A");
  const [performanceGrade, setPerformanceGrade] = useState("B");
  const [tenureStage, setTenureStage] = useState("A");
  const [existingGrant, setExistingGrant] = useState("0");
  const [grantResult, setGrantResult] = useState<GrantResult | null>(null);
  const [vestingUnits, setVestingUnits] = useState("10000");
  const [vestingStart, setVestingStart] = useState("2026-01-01");
  const [vestingAsOf, setVestingAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [vestingResult, setVestingResult] = useState<VestingResult | null>(null);
  const [repurchaseScenario, setRepurchaseScenario] = useState("INVOLUNTARY");
  const [holdingMonths, setHoldingMonths] = useState("24");
  const [latestPrice, setLatestPrice] = useState("10");
  const [shareCount, setShareCount] = useState("10000");
  const [repurchaseResult, setRepurchaseResult] = useState<RepurchaseResult | null>(null);
  const [wageTotal, setWageTotal] = useState("30000");
  const [wageBand, setWageBand] = useState("BASE");
  const [wageScore, setWageScore] = useState("105");
  const [wageResult, setWageResult] = useState<MonthlyWageResult | null>(null);
  const [bonusWage, setBonusWage] = useState("10000");
  const [bonusScore, setBonusScore] = useState("120");
  const [bonusResult, setBonusResult] = useState<FunctionalBonusResult | null>(null);
  const [strikePrice, setStrikePrice] = useState("50");
  const [strikeStage, setStrikeStage] = useState("A");
  const [strikeResult, setStrikeResult] = useState<StrikeResult | null>(null);
  const [capTableText, setCapTableText] = useState(
    '{"totalShares":"1000000","grants":[{"personId":"00000000-0000-4000-8000-000000000001","positionLevel":"L1","instrument":"LP_SHARE","grantedPercent":"4","vestedPercent":"4"}]}',
  );
  const [capTableResult, setCapTableResult] = useState<CapTableResult | null>(null);
  const [taxDeferred, setTaxDeferred] = useState("no");
  const [taxStrike, setTaxStrike] = useState("1");
  const [taxFair, setTaxFair] = useState("5");
  const [taxSale, setTaxSale] = useState("10");
  const [taxUnits, setTaxUnits] = useState("1000");
  const [taxResult, setTaxResult] = useState<EquityTax | null>(null);

  function fail(error: unknown, fallback: string) {
    const message = error instanceof ApiError ? error.message : fallback;
    toast.error("计算失败", message);
    return message;
  }

  async function runPerformance(event: FormEvent) {
    event.preventDefault();
    setPerformanceError(null);
    try {
      const result = await api<PerformanceScore>("/api/v1/policy/performance/score", {
        method: "POST",
        body: {
          personId,
          period: "MONTHLY",
          metrics: MONTHLY_METRICS,
          measurements: [
            { metricId: "M-001", rawValue: closureRate, applicable: true },
            { metricId: "M-002", rawValue: examScore, applicable: true },
            { metricId: "M-003", applicable: true, eventAdjustment: valueAdjustment },
          ],
          manualAdjustment,
          manualAdjustmentReason: manualReason,
          performanceGrade: "B",
        },
      });
      setPerformance(result);
    } catch (error) {
      setPerformanceError(fail(error, "绩效评分失败"));
    }
  }

  async function runClosure(event: FormEvent) {
    event.preventDefault();
    try {
      setClosure(
        await api<ClosureRate>("/api/v1/policy/performance/closure-rate", {
          method: "POST",
          body: {
            personId,
            startsAt: `${closureStart}T00:00:00Z`,
            endsAt: `${closureEnd}T23:59:59Z`,
          },
        }),
      );
    } catch (error) {
      fail(error, "闭环率取数失败");
    }
  }

  async function runTax(event: FormEvent) {
    event.preventDefault();
    try {
      setTaxResult(
        await api<EquityTax>("/api/v1/policy/equity/tax", {
          method: "POST",
          body: {
            deferredFiling: taxDeferred === "yes",
            strikePrice: taxStrike,
            fairValuePerUnit: taxFair,
            salePricePerUnit: taxSale,
            units: taxUnits,
          },
        }),
      );
    } catch (error) {
      fail(error, "税务测算失败");
    }
  }

  async function runScorecard(event: FormEvent) {
    event.preventDefault();
    try {
      setScorecard(
        await api<AnnualScorecard>("/api/v1/policy/performance/annual-scorecard", {
          method: "POST",
          body: {
            revenueAchievementScore: revenueScore,
            distributableProfitAchievementScore: profitScore,
            netCollectionAchievementScore: collectionScore,
            strategyAchievementScore: strategyScore,
            distributableNetProfit: netProfit,
            netProfitTarget: profitTarget,
            functionalBonusPoolRatePercent: poolRate,
          },
        }),
      );
    } catch (error) {
      fail(error, "年度计分卡计算失败");
    }
  }

  async function runStar(event: FormEvent) {
    event.preventDefault();
    try {
      setStarResult(
        await api<MonthlyStar>("/api/v1/policy/performance/monthly-star/evaluate", {
          method: "POST",
          body: {
            period: new Date().toISOString().slice(0, 7),
            candidates: [
              {
                personId,
                rank: Number(starRank),
                monthlyScore: starScore,
                m003Score: starM003,
                verifiedPositiveEvents: Number(starEvents),
                seriousViolation: starViolation,
                consecutiveMonths: Number(starConsecutive),
                awardedThisYear: Number(starAwarded),
              },
            ],
          },
        }),
      );
    } catch (error) {
      fail(error, "月明星评选失败");
    }
  }

  async function runDbcp(event: FormEvent) {
    event.preventDefault();
    try {
      const dbcp = await api<DbcpResult>("/api/v1/policy/incentive/dbcp", {
        method: "POST",
        body: {
          grossProfit,
          businessExpenses,
          laborAndTravel: laborTravel,
          allocatedBusinessUnitExpenses: allocatedBu,
          allocatedBackendPayroll: allocatedBackend,
        },
      });
      setDbcpResult(dbcp);
      setCommissionResult(
        await api<CommissionResult>(
          "/api/v1/policy/incentive/business-unit-commission",
          { method: "POST", body: { dbcp: dbcp.dbcp, netCollection } },
        ),
      );
    } catch (error) {
      fail(error, "DBCP 核算失败");
    }
  }

  async function runSupplement(event: FormEvent) {
    event.preventDefault();
    try {
      setSupplementResult(
        await api<SupplementResult>("/api/v1/policy/incentive/executive-supplement", {
          method: "POST",
          body: {
            dbcp: dbcpResult?.dbcp ?? grossProfit,
            managementScore,
            marketingReward,
          },
        }),
      );
    } catch (error) {
      fail(error, "管理补差计算失败");
    }
  }

  async function runSharing(event: FormEvent) {
    event.preventDefault();
    try {
      setSharingResult(
        await api<ProfitSharingResult>(
          "/api/v1/policy/performance/annual-profit-sharing",
          {
            method: "POST",
            body: {
              distributableNetProfit: sharingProfit,
              netProfitTarget: sharingTarget,
              poolRatePercent: sharingRate,
              people: [
                {
                  personId,
                  monthlyWageBase: wageBase,
                  gradeCoefficient,
                  weightedQuarterlyKp: weightedKp,
                  attendanceRatio: attendance,
                },
              ],
            },
          },
        ),
      );
    } catch (error) {
      fail(error, "年度利润分享计算失败");
    }
  }

  async function runBounty(event: FormEvent) {
    event.preventDefault();
    try {
      setBountyResult(
        await api<BountyResult>("/api/v1/policy/incentive/bounty-settlement", {
          method: "POST",
          body: {
            baseReward: bountyBase,
            delayWorkingDays: Number(bountyDelay),
            qualityGrade: bountyQuality,
            personalContributionShare: bountyShare,
          },
        }),
      );
    } catch (error) {
      fail(error, "悬赏核定失败");
    }
  }

  async function runTech(event: FormEvent) {
    event.preventDefault();
    try {
      setTechResult(
        await api<TechAwardResult>("/api/v1/policy/incentive/tech-center/award", {
          method: "POST",
          body: {
            awardType: techAwardType,
            baseAmount: techBase,
          },
        }),
      );
    } catch (error) {
      fail(error, "技术中心奖励计算失败");
    }
  }

  async function runOverseas(event: FormEvent) {
    event.preventDefault();
    try {
      setOverseasResult(
        await api<OverseasResult>("/api/v1/policy/incentive/overseas-sales/award", {
          method: "POST",
          body: {
            awardType: overseasType,
            newCustomerCount: Number(overseasCount),
            annualCustomerOrderAmount: overseasAmount,
            firstSigning: true,
          },
        }),
      );
    } catch (error) {
      fail(error, "海外销售奖励计算失败");
    }
  }

  async function runGrant(event: FormEvent) {
    event.preventDefault();
    try {
      setGrantResult(
        await api<GrantResult>("/api/v1/policy/equity/grant-calc", {
          method: "POST",
          body: {
            positionLevel,
            financingStage,
            performanceGrade,
            tenureStage,
            existingGrantPercent: existingGrant,
          },
        }),
      );
    } catch (error) {
      fail(error, "配股计算失败");
    }
  }

  async function runVesting(event: FormEvent) {
    event.preventDefault();
    try {
      setVestingResult(
        await api<VestingResult>("/api/v1/policy/equity/vesting", {
          method: "POST",
          body: {
            totalUnits: vestingUnits,
            vestingStart: `${vestingStart}T00:00:00Z`,
            asOf: `${vestingAsOf}T00:00:00Z`,
          },
        }),
      );
    } catch (error) {
      fail(error, "归属测算失败");
    }
  }

  async function runWage(event: FormEvent) {
    event.preventDefault();
    try {
      setWageResult(
        await api<MonthlyWageResult>(
          "/api/v1/policy/performance/monthly-wage",
          {
            method: "POST",
            body: {
              monthlyTotalWage: wageTotal,
              wageBand,
              monthlyScore: wageScore,
            },
          },
        ),
      );
    } catch (error) {
      fail(error, "月度绩效工资测算失败");
    }
  }

  async function runFunctionalBonus(event: FormEvent) {
    event.preventDefault();
    try {
      setBonusResult(
        await api<FunctionalBonusResult>(
          "/api/v1/policy/performance/functional-quarterly-bonus",
          {
            method: "POST",
            body: { fixedMonthlyWage: bonusWage, quarterlyScore: bonusScore },
          },
        ),
      );
    } catch (error) {
      fail(error, "职能季度奖金测算失败");
    }
  }

  async function runStrike(event: FormEvent) {
    event.preventDefault();
    try {
      setStrikeResult(
        await api<StrikeResult>("/api/v1/policy/equity/option-strike", {
          method: "POST",
          body: { latestPreferredPrice: strikePrice, stage: strikeStage },
        }),
      );
    } catch (error) {
      fail(error, "行权价测算失败");
    }
  }

  async function runCapTable(event: FormEvent) {
    event.preventDefault();
    try {
      setCapTableResult(
        await api<CapTableResult>("/api/v1/policy/equity/cap-table", {
          method: "POST",
          body: JSON.parse(capTableText) as Record<string, unknown>,
        }),
      );
    } catch (error) {
      fail(error, "Cap Table 计算失败");
    }
  }

  async function runRepurchase(event: FormEvent) {
    event.preventDefault();
    try {
      setRepurchaseResult(
        await api<RepurchaseResult>("/api/v1/policy/equity/repurchase", {
          method: "POST",
          body: {
            scenario: repurchaseScenario,
            holdingMonths: Number(holdingMonths),
            costAmount: "0",
            latestFinancingPrice: latestPrice,
            shares: shareCount,
          },
        }),
      );
    } catch (error) {
      fail(error, "回购测算失败");
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="制度落地"
        title="2026 制度中心"
        description="按《绩效考核与激励管理制度》《激励分配制度》《配套附件》《股权激励管理办法》《产品技术中心激励政策》《销售激励制度》逐条承接：可计算、可解释、可留痕。"
      />
      <Tabs
        items={[
          { id: "performance", label: "绩效计分" },
          { id: "incentive", label: "激励分配" },
          { id: "special", label: "专项奖励" },
          { id: "equity", label: "股权测算" },
        ]}
        active={tab}
        onChange={setTab}
        label="制度视图"
      />

      <div className="tab-panel">
        {tab === "performance" ? (
          <div className="stack">
            <Panel title="月度绩效评分（M-001 / M-002 / M-003）">
              <form onSubmit={runPerformance}>
                <div className="form-grid">
                  <FormField label="员工">
                    <PersonSelect value={personId} onChange={setPersonId} />
                  </FormField>
                  <FormField label="M-001 任务按期有效闭环率" hint="按任务等级权重：一般 1 / 重要 2 / 关键 3 / 公司级 5">
                    <TextInput value={closureRate} onChange={(event) => setClosureRate(event.target.value)} />
                  </FormField>
                  <FormField label="M-002 岗位胜任能力考试" hint="Anari Academy 正式考试成绩；无安排应记 N/A">
                    <TextInput value={examScore} onChange={(event) => setExamScore(event.target.value)} />
                  </FormField>
                  <FormField label="M-003 价值观事件调整" hint="突出正向 +1~+5；重大正向 +5~+10；负向为负值；钳制 0~110">
                    <TextInput value={valueAdjustment} onChange={(event) => setValueAdjustment(event.target.value)} />
                  </FormField>
                  <FormField label="主管人工调整（可选）" hint="必须写明理由，否则系统拒绝">
                    <TextInput value={manualAdjustment} onChange={(event) => setManualAdjustment(event.target.value)} />
                  </FormField>
                  <FormField label="调整理由">
                    <TextInput value={manualReason} onChange={(event) => setManualReason(event.target.value)} placeholder="例如：补充核实重大贡献证据" />
                  </FormField>
                </div>
                <div className="form-actions">
                  <Button type="submit">计算月度绩效</Button>
                </div>
              </form>
              {performanceError ? <InfoNotice tone="warning">{performanceError}</InfoNotice> : null}
              {performance ? (
                <div className="stack">
                  <div className="stat-grid stat-grid--three">
                    <div className="stat-card"><span>综合得分 S</span><strong>{performance.finalScore}</strong></div>
                    <div className="stat-card"><span>绩效系数 Kp</span><strong>{performance.kp}</strong></div>
                    <div className="stat-card"><span>评价完整性</span><strong>{performance.complete ? "完整" : "无法形成完整评价"}</strong></div>
                  </div>
                  <InfoNotice tone={performance.renormalized ? "info" : "success"}>
                    {performance.note ?? "按事前锁定权重计算，未触发 N/A 归一化。"}
                  </InfoNotice>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>指标</th><th>得分</th><th>有效权重</th><th>加权分</th><th>状态</th></tr></thead>
                      <tbody>
                        {performance.components.map((component) => (
                          <tr key={component.metricId}>
                            <td>{component.metricId} · {component.name}</td>
                            <td>{component.score}</td>
                            <td>{component.effectiveWeight}%</td>
                            <td>{component.weightedScore}</td>
                            <td>{component.applicable ? <Badge tone="success">适用</Badge> : <Badge tone="warning">N/A</Badge>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </Panel>

            <Panel title="M-001 从工作包取数（任务等级权重 1 / 2 / 3 / 5）">
              <form onSubmit={runClosure}>
                <div className="form-grid">
                  <FormField label="员工"><PersonSelect value={personId} onChange={setPersonId} /></FormField>
                  <FormField label="统计开始日"><TextInput type="date" value={closureStart} onChange={(event) => setClosureStart(event.target.value)} /></FormField>
                  <FormField label="统计结束日"><TextInput type="date" value={closureEnd} onChange={(event) => setClosureEnd(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">计算有效闭环率</Button></div>
              </form>
              {closure ? (
                <div className="stack">
                  <div className="stat-grid stat-grid--three">
                    <div className="stat-card"><span>应完成权重</span><strong>{closure.requiredWeight}</strong></div>
                    <div className="stat-card"><span>有效闭环权重</span><strong>{closure.qualifiedWeight}</strong></div>
                    <div className="stat-card"><span>有效闭环率</span><strong>{closure.closureRate}%</strong></div>
                  </div>
                  {closure.note ? <InfoNotice tone="info">{closure.note}</InfoNotice> : null}
                  <div className="muted">
                    按期 + 验收通过 + 有可核验证据才算有效闭环；延期、缺证据或未验收不计入。
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>任务</th><th>等级</th><th>权重</th><th>状态</th><th>结果</th></tr></thead>
                      <tbody>
                        {closure.tasks.map((task) => (
                          <tr key={task.workPackageId}>
                            <td>{task.title}</td>
                            <td>{task.grade}</td>
                            <td>{task.weight}</td>
                            <td>{task.status}</td>
                            <td>{task.validClosure ? <Badge tone="success">有效闭环</Badge> : <Badge tone="warning">{task.reason}</Badge>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </Panel>

            <Panel title="公司年度计分卡（20% / 30% / 20% / 30%）">
              <form onSubmit={runScorecard}>
                <div className="form-grid">
                  <FormField label="确认收入达成率得分"><TextInput value={revenueScore} onChange={(event) => setRevenueScore(event.target.value)} /></FormField>
                  <FormField label="可分配净利润达成率得分"><TextInput value={profitScore} onChange={(event) => setProfitScore(event.target.value)} /></FormField>
                  <FormField label="净回款达成率得分"><TextInput value={collectionScore} onChange={(event) => setCollectionScore(event.target.value)} /></FormField>
                  <FormField label="战略成果完成率得分"><TextInput value={strategyScore} onChange={(event) => setStrategyScore(event.target.value)} /></FormField>
                  <FormField label="年度可分配净利润 P_y"><TextInput value={netProfit} onChange={(event) => setNetProfit(event.target.value)} /></FormField>
                  <FormField label="年度净利润目标 T_NP"><TextInput value={profitTarget} onChange={(event) => setProfitTarget(event.target.value)} /></FormField>
                  <FormField label="职能年终奖池计提比例（5%-10%）"><TextInput value={poolRate} onChange={(event) => setPoolRate(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">计算年度得分</Button></div>
              </form>
              {scorecard ? (
                <div className="stat-grid stat-grid--three">
                  <div className="stat-card"><span>公司年度绩效 S_company</span><strong>{scorecard.companyScore}</strong></div>
                  <div className="stat-card"><span>年度 Kp</span><strong>{scorecard.kp}</strong></div>
                  <div className="stat-card"><span>职能年终奖</span><strong>{scorecard.profitTargetMet ? `按 ${scorecard.functionalBonusPoolRatePercent}% 计提` : "池为 0"}</strong></div>
                </div>
              ) : null}
            </Panel>

            <Panel title="月明星评选（排名第一 + M-003 + 证据 + 无严重违规）">
              <form onSubmit={runStar}>
                <div className="form-grid">
                  <FormField label="员工"><PersonSelect value={personId} onChange={setPersonId} /></FormField>
                  <FormField label="公司月度排名"><TextInput value={starRank} onChange={(event) => setStarRank(event.target.value)} /></FormField>
                  <FormField label="月度综合得分" hint="月明星要求总分不低于 110"><TextInput value={starScore} onChange={(event) => setStarScore(event.target.value)} /></FormField>
                  <FormField label="价值观单项得分（20 分制）" hint="月明星单独填报：价值观单项≥20 分，月度总分≥110 分"><TextInput value={starM003} onChange={(event) => setStarM003(event.target.value)} /></FormField>
                  <FormField label="已核实突出正向事件数"><TextInput value={starEvents} onChange={(event) => setStarEvents(event.target.value)} /></FormField>
                  <FormField label="连续满足条件的自然月数"><TextInput value={starConsecutive} onChange={(event) => setStarConsecutive(event.target.value)} /></FormField>
                  <FormField label="本年度已获次数"><TextInput value={starAwarded} onChange={(event) => setStarAwarded(event.target.value)} /></FormField>
                  <FormField label="存在经调查确认的严重违规">
                    <Select value={starViolation ? "yes" : "no"} onChange={(event) => setStarViolation(event.target.value === "yes")}>
                      <option value="no">否</option><option value="yes">是</option>
                    </Select>
                  </FormField>
                </div>
                <div className="form-actions"><Button type="submit">评选月明星</Button></div>
              </form>
              {starResult ? (
                <InfoNotice tone={starResult.awarded ? "success" : "info"}>
                  {starResult.awarded
                    ? `奖励金额：${starResult.candidates[0]?.amount ?? "0"} 元。${starResult.note ?? ""}`
                    : starResult.note ?? "当月不予发放。"}
                </InfoNotice>
              ) : null}
            </Panel>
          </div>
        ) : null}

        {tab === "incentive" ? (
          <div className="stack">
            <Panel title="业务中心 DBCP 与季度提成（016 第六、七条）">
              <form onSubmit={runDbcp}>
                <div className="form-grid">
                  <FormField label="毛利"><TextInput value={grossProfit} onChange={(event) => setGrossProfit(event.target.value)} /></FormField>
                  <FormField label="业务费用（运费/报关/佣金等）"><TextInput value={businessExpenses} onChange={(event) => setBusinessExpenses(event.target.value)} /></FormField>
                  <FormField label="人工及差旅"><TextInput value={laborTravel} onChange={(event) => setLaborTravel(event.target.value)} /></FormField>
                  <FormField label="分摊业务中心费用"><TextInput value={allocatedBu} onChange={(event) => setAllocatedBu(event.target.value)} /></FormField>
                  <FormField label="分摊后端人员工资"><TextInput value={allocatedBackend} onChange={(event) => setAllocatedBackend(event.target.value)} /></FormField>
                  <FormField label="实际净回款" hint="提成基数为扣除退款、退汇、折让、坏账冲减后的净回款"><TextInput value={netCollection} onChange={(event) => setNetCollection(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">核算 DBCP 与提成</Button></div>
              </form>
              {dbcpResult ? (
                <div className="stat-grid stat-grid--three">
                  <div className="stat-card"><span>管理计提（5%）</span><strong>{dbcpResult.managementProvision}</strong></div>
                  <div className="stat-card"><span>DBCP</span><strong>{dbcpResult.dbcp}</strong></div>
                  <div className="stat-card"><span>可分配利润率</span><strong>{commissionResult?.marginPercent ?? "—"}%</strong></div>
                  <div className="stat-card"><span>命中提成率</span><strong>{commissionResult?.bandRatePercent ?? "0"}%</strong></div>
                  <div className="stat-card"><span>季度提成</span><strong>{commissionResult?.commission ?? "0"}</strong></div>
                  <div className="stat-card"><span>资格</span><strong>{commissionResult?.eligible ? "具备" : "不具备"}</strong></div>
                </div>
              ) : null}
            </Panel>

            <Panel title="月度绩效工资（月工资总额 × 职级比例 × 月度 Kp）">
              <form onSubmit={runWage}>
                <div className="form-grid">
                  <FormField label="月度工资总额"><TextInput value={wageTotal} onChange={(event) => setWageTotal(event.target.value)} /></FormField>
                  <FormField label="职级">
                    <Select value={wageBand} onChange={(event) => setWageBand(event.target.value)}>
                      <option value="BASE">基层（20%）</option>
                      <option value="MANAGER">经理级及以上（30%）</option>
                      <option value="DIRECTOR">总监级及以上（40%）</option>
                    </Select>
                  </FormField>
                  <FormField label="月度综合得分 S"><TextInput value={wageScore} onChange={(event) => setWageScore(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">测算绩效工资</Button></div>
              </form>
              {wageResult ? (
                <div className="stat-grid stat-grid--three">
                  <div className="stat-card"><span>绩效工资标准</span><strong>{wageResult.performanceWageStandard}</strong></div>
                  <div className="stat-card"><span>月度 Kp</span><strong>{wageResult.kp}</strong></div>
                  <div className="stat-card"><span>实发绩效工资</span><strong>{wageResult.payable}</strong></div>
                </div>
              ) : null}
            </Panel>

            <Panel title="职能部门季度奖金（固定月工资 × 10% × Kq）">
              <form onSubmit={runFunctionalBonus}>
                <div className="form-grid">
                  <FormField label="固定月工资基数"><TextInput value={bonusWage} onChange={(event) => setBonusWage(event.target.value)} /></FormField>
                  <FormField label="季度综合得分 S" hint="S>100 才具备奖金资格"><TextInput value={bonusScore} onChange={(event) => setBonusScore(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">测算季度奖金</Button></div>
              </form>
              {bonusResult ? (
                <div className="stat-grid stat-grid--three">
                  <div className="stat-card"><span>奖金基数</span><strong>{bonusResult.baseAmount}</strong></div>
                  <div className="stat-card"><span>Kq</span><strong>{bonusResult.kq}</strong></div>
                  <div className="stat-card"><span>应发 / 资格</span><strong>{bonusResult.amount} · {bonusResult.eligible ? "具备" : "不具备"}</strong></div>
                </div>
              ) : null}
            </Panel>

            <Panel title="执行总监管理补差（G = DBCP × 2% × K管理 − M）">
              <form onSubmit={runSupplement}>
                <div className="form-grid">
                  <FormField label="管理绩效得分 S管理"><TextInput value={managementScore} onChange={(event) => setManagementScore(event.target.value)} /></FormField>
                  <FormField label="营销职能奖励 M"><TextInput value={marketingReward} onChange={(event) => setMarketingReward(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">计算管理补差</Button></div>
              </form>
              {supplementResult ? (
                <div className="stat-grid stat-grid--three">
                  <div className="stat-card"><span>K管理</span><strong>{supplementResult.managementK}</strong></div>
                  <div className="stat-card"><span>补差前</span><strong>{supplementResult.grossSupplement}</strong></div>
                  <div className="stat-card"><span>应发补差</span><strong>{supplementResult.supplement}</strong></div>
                </div>
              ) : null}
            </Panel>

            <Panel title="职能部门年度利润分享（P_y ≥ T_NP 且 P_y > 0）">
              <form onSubmit={runSharing}>
                <div className="form-grid">
                  <FormField label="年度可分配净利润"><TextInput value={sharingProfit} onChange={(event) => setSharingProfit(event.target.value)} /></FormField>
                  <FormField label="年度净利润目标"><TextInput value={sharingTarget} onChange={(event) => setSharingTarget(event.target.value)} /></FormField>
                  <FormField label="池子计提比例（5%-10%）"><TextInput value={sharingRate} onChange={(event) => setSharingRate(event.target.value)} /></FormField>
                  <FormField label="员工"><PersonSelect value={personId} onChange={setPersonId} /></FormField>
                  <FormField label="固定月工资基数"><TextInput value={wageBase} onChange={(event) => setWageBase(event.target.value)} /></FormField>
                  <FormField label="职级系数" hint="基层 1.0 / 经理级 1.5 / 总监级 2.0"><TextInput value={gradeCoefficient} onChange={(event) => setGradeCoefficient(event.target.value)} /></FormField>
                  <FormField label="个人有效季度 Kp 加权平均"><TextInput value={weightedKp} onChange={(event) => setWeightedKp(event.target.value)} /></FormField>
                  <FormField label="年度在岗比例"><TextInput value={attendance} onChange={(event) => setAttendance(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">测算利润分享</Button></div>
              </form>
              {sharingResult ? (
                <div className="stack">
                  <div className="stat-grid stat-grid--three">
                    <div className="stat-card"><span>净利润条件</span><strong>{sharingResult.eligible ? "已达成" : "未达成"}</strong></div>
                    <div className="stat-card"><span>奖金池</span><strong>{sharingResult.poolAmount}</strong></div>
                    <div className="stat-card"><span>批准池（受预算约束）</span><strong>{sharingResult.approvedPoolAmount}</strong></div>
                  </div>
                  {sharingResult.allocations.map((row) => (
                    <InfoNotice key={row.personId} tone="info">
                      个人点数 {row.points}（岗位价值点 {row.valuePoints}）→ 分配 {row.amount} 元
                    </InfoNotice>
                  ))}
                </div>
              ) : null}
            </Panel>
          </div>
        ) : null}

        {tab === "special" ? (
          <div className="stack">
            <Panel title="专项悬赏核定（时间系数 × 质量系数）">
              <form onSubmit={runBounty}>
                <div className="form-grid">
                  <FormField label="事前批准基础奖励"><TextInput value={bountyBase} onChange={(event) => setBountyBase(event.target.value)} /></FormField>
                  <FormField label="延期工作日" hint="1-3 日 0.90；4-7 日 0.75；8-15 日 0.50；超过 15 日 0"><TextInput value={bountyDelay} onChange={(event) => setBountyDelay(event.target.value)} /></FormField>
                  <FormField label="质量结果">
                    <Select value={bountyQuality} onChange={(event) => setBountyQuality(event.target.value)}>
                      <option value="PASS">一次验收通过（1.00）</option>
                      <option value="MINOR_DEFECT">轻微缺陷按期修复（0.95）</option>
                      <option value="REWORK">需实质返工（0.80）</option>
                      <option value="MULTIPLE_REWORK">多次返工/明显影响（0.50）</option>
                      <option value="FAILED">核心验收失败（0）</option>
                    </Select>
                  </FormField>
                  <FormField label="个人贡献分配比例"><TextInput value={bountyShare} onChange={(event) => setBountyShare(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">核算悬赏金额</Button></div>
              </form>
              {bountyResult ? (
                <div className="stat-grid stat-grid--three">
                  <div className="stat-card"><span>时间系数</span><strong>{bountyResult.timeCoefficient}</strong></div>
                  <div className="stat-card"><span>质量系数</span><strong>{bountyResult.qualityCoefficient}</strong></div>
                  <div className="stat-card"><span>核定金额</span><strong>{bountyResult.amount}</strong></div>
                </div>
              ) : null}
            </Panel>

            <Panel title="产品技术中心专项奖励（008）">
              <form onSubmit={runTech}>
                <div className="form-grid">
                  <FormField label="奖励类型">
                    <Select value={techAwardType} onChange={(event) => setTechAwardType(event.target.value)}>
                      <option value="INVENTION_PATENT_ACCEPTED">发明专利受理（2000）</option>
                      <option value="INVENTION_PATENT_GRANTED">发明专利授权（5000）</option>
                      <option value="UTILITY_OR_SOFTWARE_ACCEPTED">实用新型/软著受理（200）</option>
                      <option value="UTILITY_OR_SOFTWARE_GRANTED">实用新型/软著授权（1000）</option>
                      <option value="DESIGN_PATENT_GRANTED">外观专利授权（100）</option>
                      <option value="TECH_BREAKTHROUGH">单项技术突破（3000）</option>
                      <option value="TECH_BREAKTHROUGH_SIGNIFICANT">显著竞争力/成本节约（5000）</option>
                      <option value="CUSTOM_PROJECT">客户定制项目（定制费 30%-50%）</option>
                      <option value="COST_OPTIMIZATION">成本优化（年度节约 1%-2%，上限 10000）</option>
                      <option value="HARDWARE_AC_DELIVERY">交流桩项目（2000）</option>
                      <option value="HARDWARE_DC_DELIVERY">直流桩项目（5000）</option>
                      <option value="SOFTWARE_MILESTONE">软件里程碑（1000/节点）</option>
                      <option value="SOFTWARE_GA_STABLE">GA 稳定运行 30 天（3000-5000）</option>
                      <option value="SLA_MONTH">月度 SLA 全达标（500）</option>
                      <option value="KNOWLEDGE_CONTRIBUTION">知识贡献（50-100/条，季度上限 1000）</option>
                      <option value="CUSTOMER_SATISFACTION_QUARTER">客户满意度≥90%（500/季度）</option>
                      <option value="STRATEGIC_CUSTOMER_SUPPORT">促成战略客户签约（1000-3000）</option>
                      <option value="TEAM_EXCELLENCE">半年度技术骨干（3000）</option>
                      <option value="SPECIAL_TECH_CONTRIBUTION">特殊技术贡献（总经理核定）</option>
                    </Select>
                  </FormField>
                  <FormField label="计算基数" hint="定制费 / 年度节约金额；固定奖励可留空">
                    <TextInput value={techBase} onChange={(event) => setTechBase(event.target.value)} />
                  </FormField>
                </div>
                <div className="form-actions"><Button type="submit">计算奖励</Button></div>
              </form>
              {techResult ? (
                <InfoNotice tone="success">
                  应发 {techResult.grossAmount} 元{techResult.note ? `；${techResult.note}` : ""}
                </InfoNotice>
              ) : null}
            </Panel>

            <Panel title="海外销售激励（003）">
              <form onSubmit={runOverseas}>
                <div className="form-grid">
                  <FormField label="奖励类型">
                    <Select value={overseasType} onChange={(event) => setOverseasType(event.target.value)}>
                      <option value="NEW_CUSTOMER_STAR">开发明星奖（8 个新客户/季度）</option>
                      <option value="KA_BREAKTHROUGH">KA 客户突破奖（年度 500 万/1000 万）</option>
                      <option value="IMPORTANT_CUSTOMER_BREAKTHROUGH">重要客户突破奖（年度 300 万）</option>
                      <option value="QUARTERLY_CHAMPION">季度销冠</option>
                      <option value="ANNUAL_CHAMPION">年度销冠</option>
                    </Select>
                  </FormField>
                  <FormField label="季度新客户数"><TextInput value={overseasCount} onChange={(event) => setOverseasCount(event.target.value)} /></FormField>
                  <FormField label="客户年度累计订单额"><TextInput value={overseasAmount} onChange={(event) => setOverseasAmount(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">计算海外销售奖励</Button></div>
              </form>
              {overseasResult ? (
                <InfoNotice tone={overseasResult.disqualified ? "warning" : "success"}>
                  应发 {overseasResult.grossAmount}，扣减 {overseasResult.deduction}，实发 {overseasResult.netAmount}
                  {overseasResult.recoverableAmount !== "0" ? `；需追回 ${overseasResult.recoverableAmount}` : ""}
                  {overseasResult.note ? `。${overseasResult.note}` : ""}
                </InfoNotice>
              ) : null}
            </Panel>
          </div>
        ) : null}

        {tab === "equity" ? (
          <div className="stack">
            <Panel title="四维配股测算（岗位基准 × 绩效系数 × 司龄系数）">
              <form onSubmit={runGrant}>
                <div className="form-grid">
                  <FormField label="岗位等级">
                    <Select value={positionLevel} onChange={(event) => setPositionLevel(event.target.value)}>
                      <option value="L1">L1 · C-Level</option>
                      <option value="L2">L2 · VP/总监</option>
                      <option value="L3">L3 · 高级工程师/高级经理</option>
                      <option value="L4">L4 · 中级工程师/中级经理</option>
                      <option value="L5">L5 · 初级工程师</option>
                    </Select>
                  </FormField>
                  <FormField label="融资阶段">
                    <Select value={financingStage} onChange={(event) => setFinancingStage(event.target.value)}>
                      <option value="PRE_A">Pre-A/天使</option>
                      <option value="A">A 轮</option>
                      <option value="B">B 轮</option>
                      <option value="C_PRE_IPO">C 轮/Pre-IPO</option>
                    </Select>
                  </FormField>
                  <FormField label="年度绩效评级">
                    <Select value={performanceGrade} onChange={(event) => setPerformanceGrade(event.target.value)}>
                      <option value="S">S 卓越</option><option value="A">A 优秀</option><option value="B">B 良好</option><option value="C">C 待改进</option><option value="D">D 不合格（一票否决）</option>
                    </Select>
                  </FormField>
                  <FormField label="加入时融资阶段（司龄）">
                    <Select value={tenureStage} onChange={(event) => setTenureStage(event.target.value)}>
                      <option value="FOUNDING">创始期（1.2）</option>
                      <option value="A">A 轮加入（1.0）</option>
                      <option value="B">B 轮加入（0.8）</option>
                      <option value="C">C 轮后加入（0.5）</option>
                    </Select>
                  </FormField>
                  <FormField label="当前累计授予比例（%）"><TextInput value={existingGrant} onChange={(event) => setExistingGrant(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">计算授予比例</Button></div>
              </form>
              {grantResult ? (
                <div className="stat-grid stat-grid--three">
                  <div className="stat-card"><span>岗位基准</span><strong>{grantResult.positionBasePercent}%</strong></div>
                  <div className="stat-card"><span>本次授予</span><strong>{grantResult.grantPercent}%</strong></div>
                  <div className="stat-card"><span>累计 / 饱和上限</span><strong>{grantResult.cumulativePercent}% / {grantResult.saturationCapPercent}%</strong></div>
                </div>
              ) : null}
            </Panel>

            <Panel title="期权行权价（最近优先股价格 × (1−折扣率)）">
              <form onSubmit={runStrike}>
                <div className="form-grid">
                  <FormField label="最近一轮优先股每股价格"><TextInput value={strikePrice} onChange={(event) => setStrikePrice(event.target.value)} /></FormField>
                  <FormField label="融资阶段">
                    <Select value={strikeStage} onChange={(event) => setStrikeStage(event.target.value)}>
                      <option value="PRE_A">Pre-A/天使</option>
                      <option value="A">A 轮</option>
                      <option value="B">B 轮</option>
                      <option value="C_PRE_IPO">C 轮/Pre-IPO</option>
                      <option value="POST_IPO">上市后</option>
                    </Select>
                  </FormField>
                </div>
                <div className="form-actions"><Button type="submit">计算行权价</Button></div>
              </form>
              {strikeResult ? (
                <div className="stat-grid stat-grid--three">
                  <div className="stat-card"><span>折扣率</span><strong>{strikeResult.discountRatePercent}%</strong></div>
                  <div className="stat-card"><span>行权价</span><strong>{strikeResult.strikePrice}</strong></div>
                </div>
              ) : null}
            </Panel>

            <Panel title="Cap Table 与饱和度">
              <form onSubmit={runCapTable}>
                <FormField label="Cap Table 输入 JSON" hint="grants: personId / positionLevel / instrument / grantedPercent / vestedPercent">
                  <Textarea rows={8} value={capTableText} onChange={(event) => setCapTableText(event.target.value)} />
                </FormField>
                <div className="form-actions"><Button type="submit">生成 Cap Table 快照</Button></div>
              </form>
              {capTableResult ? (
                <div className="stack">
                  <div className="stat-grid stat-grid--three">
                    <div className="stat-card"><span>累计授予</span><strong>{capTableResult.totalGrantedPercent}%</strong></div>
                    <div className="stat-card"><span>池剩余</span><strong>{capTableResult.poolRemainingPercent}%</strong></div>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>人员</th><th>等级</th><th>累计</th><th>上限</th><th>饱和</th></tr></thead>
                      <tbody>
                        {capTableResult.saturation.map((row) => (
                          <tr key={row.personId}>
                            <td className="mono">{row.personId.slice(0, 8)}</td>
                            <td>{row.positionLevel}</td>
                            <td>{row.cumulativePercent}%</td>
                            <td>{row.capPercent}%</td>
                            <td>{row.saturated ? <Badge tone="warning">已饱和</Badge> : <Badge tone="success">可继续</Badge>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </Panel>

            <Panel title="归属测算（4 年 / 1 年 cliff / 按月归属）">
              <form onSubmit={runVesting}>
                <div className="form-grid">
                  <FormField label="授予单位数"><TextInput value={vestingUnits} onChange={(event) => setVestingUnits(event.target.value)} /></FormField>
                  <FormField label="授予日"><TextInput type="date" value={vestingStart} onChange={(event) => setVestingStart(event.target.value)} /></FormField>
                  <FormField label="测算日期"><TextInput type="date" value={vestingAsOf} onChange={(event) => setVestingAsOf(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">测算归属</Button></div>
              </form>
              {vestingResult ? (
                <div className="stat-grid stat-grid--three">
                  <div className="stat-card"><span>已归属</span><strong>{vestingResult.vestedUnits}（{vestingResult.vestedPercent}%）</strong></div>
                  <div className="stat-card"><span>未归属</span><strong>{vestingResult.unvestedUnits}</strong></div>
                  <div className="stat-card"><span>加速归属</span><strong>{vestingResult.acceleratedUnits}</strong></div>
                </div>
              ) : null}
            </Panel>

            <Panel title="回购测算（情形矩阵 + 公允价值三级）">
              <form onSubmit={runRepurchase}>
                <div className="form-grid">
                  <FormField label="回购情形">
                    <Select value={repurchaseScenario} onChange={(event) => setRepurchaseScenario(event.target.value)}>
                      <option value="VOLUNTARY">主动离职</option>
                      <option value="INVOLUNTARY">被动离职（公司无过错）</option>
                      <option value="FAULT">过错离职</option>
                      <option value="RETIREMENT">退休</option>
                      <option value="DEATH">身故</option>
                    </Select>
                  </FormField>
                  <FormField label="已持有月数"><TextInput value={holdingMonths} onChange={(event) => setHoldingMonths(event.target.value)} /></FormField>
                  <FormField label="最近融资每股价格"><TextInput value={latestPrice} onChange={(event) => setLatestPrice(event.target.value)} /></FormField>
                  <FormField label="份额/股数"><TextInput value={shareCount} onChange={(event) => setShareCount(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">测算回购价</Button></div>
              </form>
              {repurchaseResult ? (
                <div className="stat-grid stat-grid--three">
                  <div className="stat-card"><span>公允价值/单位</span><strong>{repurchaseResult.fairValuePerUnit}</strong></div>
                  <div className="stat-card"><span>回购总价</span><strong>{repurchaseResult.repurchasePrice}</strong></div>
                  <div className="stat-card"><span>通知/完成时限</span><strong>{repurchaseResult.noticeDeadlineDays} / {repurchaseResult.completionDeadlineDays} 日</strong></div>
                </div>
              ) : null}
              {repurchaseResult?.note ? <InfoNotice tone="info">{repurchaseResult.note}</InfoNotice> : null}
            </Panel>

            <Panel title="股权激励税务测算（递延备案 / 未备案）">
              <form onSubmit={runTax}>
                <div className="form-grid">
                  <FormField label="是否已办理递延纳税备案">
                    <Select value={taxDeferred} onChange={(event) => setTaxDeferred(event.target.value)}>
                      <option value="no">未备案（工资薪金所得）</option>
                      <option value="yes">已备案（财产转让所得 20%）</option>
                    </Select>
                  </FormField>
                  <FormField label="行权价"><TextInput value={taxStrike} onChange={(event) => setTaxStrike(event.target.value)} /></FormField>
                  <FormField label="公允价值/单位"><TextInput value={taxFair} onChange={(event) => setTaxFair(event.target.value)} /></FormField>
                  <FormField label="转让/回购价/单位"><TextInput value={taxSale} onChange={(event) => setTaxSale(event.target.value)} /></FormField>
                  <FormField label="单位数"><TextInput value={taxUnits} onChange={(event) => setTaxUnits(event.target.value)} /></FormField>
                </div>
                <div className="form-actions"><Button type="submit">测算税负</Button></div>
              </form>
              {taxResult ? (
                <div className="stack">
                  <div className="stat-grid stat-grid--three">
                    <div className="stat-card"><span>应纳税所得额</span><strong>{taxResult.taxableBase}</strong></div>
                    <div className="stat-card"><span>适用税率</span><strong>{taxResult.taxRatePercent}%</strong></div>
                    <div className="stat-card"><span>税额</span><strong>{taxResult.taxAmount}</strong></div>
                  </div>
                  <InfoNotice tone="info">{taxResult.note}</InfoNotice>
                </div>
              ) : null}
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}
