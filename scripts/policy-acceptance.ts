/**
 * 2026 制度验收数据集：每份制度的考核/激励计算各取一个可人工复核的场景，
 * 用引擎输出与独立期望值逐项比对，产出 Markdown/JSON 报告。
 *
 * 运行：npm run policy:acceptance
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateAnnualProfitSharing,
  calculateAnnualScorecard,
  calculateBountySettlement,
  calculateBusinessUnitCommission,
  calculateCapTableSnapshot,
  calculateDbcp,
  calculateEquityGrant,
  calculateEquityTax,
  calculateExecutiveSupplement,
  calculateFunctionalQuarterlyBonus,
  calculateInternalSplit,
  calculateMonthlyPerformanceWage,
  calculateOverseasSalesAward,
  calculateRepurchase,
  calculateTaskClosureRate,
  calculateTechCenterAward,
  calculateTechCenterPool,
  calculateVestingSchedule,
  evaluateMonthlyStar,
  monthlyMetricTemplate,
  scorePerformance,
} from "@anari/policy-dsl";

export interface AcceptanceCase {
  id: string;
  policy: string;
  title: string;
  expected: Record<string, string>;
  run: () => Record<string, string>;
}

const MONTHLY = monthlyMetricTemplate();

export const POLICY_ACCEPTANCE_CASES: AcceptanceCase[] = [
  {
    id: "M-001",
    policy: "017/018 月度绩效",
    title: "任务闭环率：权重 2/3/1，三条中两条有效",
    expected: { requiredWeight: "6", qualifiedWeight: "3", rate: "50" },
    run: () => {
      const result = calculateTaskClosureRate([
        { weight: "2", status: "ACCEPTED", dueAt: "2026-11-10", acceptedAt: "2026-11-09", hasEvidence: true },
        { weight: "3", status: "ACCEPTED", dueAt: "2026-11-10", acceptedAt: "2026-11-10", hasEvidence: false },
        { weight: "1", status: "ACCEPTED", dueAt: "2026-11-10", acceptedAt: "2026-11-10", hasEvidence: true },
      ]);
      return {
        requiredWeight: result.requiredWeight,
        qualifiedWeight: result.qualifiedWeight,
        rate: result.rate,
      };
    },
  },
  {
    id: "PERF-01",
    policy: "017/018 月度绩效",
    title: "销售月度：M-001 95 / M-002 88 / M-003 +4",
    expected: { finalScore: "95.3", kp: "0.953" },
    run: () => {
      const result = scorePerformance({
        personId: "p-sales",
        period: "MONTHLY",
        metrics: MONTHLY,
        measurements: [
          { metricId: "M-001", rawValue: "95", applicable: true },
          { metricId: "M-002", rawValue: "88", applicable: true },
          { metricId: "M-003", applicable: true, eventAdjustment: "4" },
        ],
      });
      return { finalScore: result.finalScore, kp: result.kp };
    },
  },
  {
    id: "PERF-02",
    policy: "017/018 月度绩效",
    title: "产品经理月度：考试 N/A，按 70/85 与 15/85 归一",
    expected: { rawScore: "86.2353", kp: "0.8624", renormalized: "true" },
    run: () => {
      const result = scorePerformance({
        personId: "p-pm",
        period: "MONTHLY",
        metrics: MONTHLY,
        measurements: [
          { metricId: "M-001", rawValue: "82", applicable: true },
          { metricId: "M-002", applicable: false, naReason: "无正式考试" },
          { metricId: "M-003", applicable: true, eventAdjustment: "6" },
        ],
      });
      return {
        rawScore: result.rawScore,
        kp: result.kp,
        renormalized: String(result.renormalized),
      };
    },
  },
  {
    id: "PERF-03",
    policy: "017/018 月度绩效",
    title: "基层月度绩效工资：30000 × 20% × Kp 0.953",
    expected: { standard: "6000", kp: "0.953", payable: "5718" },
    run: () => {
      const result = calculateMonthlyPerformanceWage({
        monthlyTotalWage: "30000",
        wageBand: "BASE",
        monthlyScore: "95.3",
      });
      return {
        standard: result.performanceWageStandard,
        kp: result.kp,
        payable: result.payable,
      };
    },
  },
  {
    id: "PERF-04",
    policy: "017/018 月度绩效",
    title: "经理级月度绩效工资：40000 × 30% × Kp 0.8624",
    expected: { standard: "12000", kp: "0.8624", payable: "10348.24" },
    run: () => {
      const result = calculateMonthlyPerformanceWage({
        monthlyTotalWage: "40000",
        wageBand: "MANAGER",
        monthlyScore: "86.2353",
      });
      return {
        standard: result.performanceWageStandard,
        kp: result.kp,
        payable: result.payable,
      };
    },
  },
  {
    id: "PERF-05",
    policy: "016 职能季度奖金",
    title: "固定工资 12000，季度 S=118 → Kq 1.18",
    expected: { base: "1200", kq: "1.18", amount: "1416", eligible: "true" },
    run: () => {
      const result = calculateFunctionalQuarterlyBonus({
        fixedMonthlyWage: "12000",
        quarterlyScore: "118",
      });
      return {
        base: result.baseAmount,
        kq: result.kq,
        amount: result.amount,
        eligible: String(result.eligible),
      };
    },
  },
  {
    id: "PERF-06",
    policy: "016 职能季度奖金",
    title: "季度 S=100 → 无奖金资格",
    expected: { kq: "1", amount: "0", eligible: "false" },
    run: () => {
      const result = calculateFunctionalQuarterlyBonus({
        fixedMonthlyWage: "12000",
        quarterlyScore: "100",
      });
      return { kq: result.kq, amount: result.amount, eligible: String(result.eligible) };
    },
  },
  {
    id: "PERF-07",
    policy: "017 年度计分卡",
    title: "108/112/96/120 加权 110.4，封顶 105",
    expected: { companyScore: "105", kp: "1.05", profitTargetMet: "true", poolRate: "8" },
    run: () => {
      const result = calculateAnnualScorecard({
        revenueAchievementScore: "108",
        distributableProfitAchievementScore: "112",
        netCollectionAchievementScore: "96",
        strategyAchievementScore: "120",
        distributableNetProfit: "12000000",
        netProfitTarget: "10000000",
        functionalBonusPoolRatePercent: "8",
      });
      return {
        companyScore: result.companyScore,
        kp: result.kp,
        profitTargetMet: String(result.profitTargetMet),
        poolRate: result.functionalBonusPoolRatePercent,
      };
    },
  },
  {
    id: "PERF-08",
    policy: "016 年度利润分享",
    title: "P_y=1000 万、目标 800 万、8% 池；岗位价值点分配",
    expected: {
      pool: "800000",
      approved: "800000",
      first: "567741.94",
      second: "232258.06",
      totalPoints: "46500",
    },
    run: () => {
      const result = calculateAnnualProfitSharing({
        distributableNetProfit: "10000000",
        netProfitTarget: "8000000",
        poolRatePercent: "8",
        people: [
          { personId: "p-finance", monthlyWageBase: "20000", gradeCoefficient: "1.5", weightedQuarterlyKp: "1.1", attendanceRatio: "1" },
          { personId: "p-hr", monthlyWageBase: "15000", gradeCoefficient: "1", weightedQuarterlyKp: "1", attendanceRatio: "0.9" },
        ],
      });
      return {
        pool: result.poolAmount,
        approved: result.approvedPoolAmount,
        first: result.allocations[0]!.amount,
        second: result.allocations[1]!.amount,
        totalPoints: result.totalPoints,
      };
    },
  },
  {
    id: "INC-01",
    policy: "016 DBCP",
    title: "毛利 200 万，费用/分摊/5% 管理计提后 DBCP 147 万",
    expected: { provision: "100000", dbcp: "1470000" },
    run: () => {
      const result = calculateDbcp({
        grossProfit: "2000000",
        businessExpenses: "80000",
        laborAndTravel: "250000",
        allocatedBusinessUnitExpenses: "40000",
        allocatedBackendPayroll: "60000",
      });
      return { provision: result.managementProvision, dbcp: result.dbcp };
    },
  },
  {
    id: "INC-02",
    policy: "016 业务中心提成",
    title: "DBCP 147 万 / 净回款 500 万 = 29.4% → 3% 档",
    expected: { margin: "29.4", rate: "3", commission: "150000" },
    run: () => {
      const result = calculateBusinessUnitCommission({
        dbcp: "1470000",
        netCollection: "5000000",
      });
      return {
        margin: result.marginPercent,
        rate: result.bandRatePercent,
        commission: result.commission,
      };
    },
  },
  {
    id: "INC-03",
    policy: "016 执行总监补差",
    title: "DBCP 147 万 × 2% × K 0.92 − 营销 2 万",
    expected: { k: "0.92", gross: "27048", supplement: "7048" },
    run: () => {
      const result = calculateExecutiveSupplement({
        dbcp: "1470000",
        managementScore: "92",
        marketingReward: "20000",
      });
      return {
        k: result.managementK,
        gross: result.grossSupplement,
        supplement: result.supplement,
      };
    },
  },
  {
    id: "INC-04",
    policy: "016 内部份额",
    title: "B=15 万、M=2 万、G=7048，剩余池按 60/40",
    expected: { remaining: "122952", first: "73771.2", second: "49180.8" },
    run: () => {
      const result = calculateInternalSplit({
        commissionPool: "150000",
        marketingReward: "20000",
        executiveSupplement: "7048",
        participants: [
          { personId: "p-sales", sharePercent: "60" },
          { personId: "p-support", sharePercent: "40" },
        ],
      });
      return {
        remaining: result.remainingPool,
        first: result.allocations[0]!.amount,
        second: result.allocations[1]!.amount,
      };
    },
  },
  {
    id: "INC-05",
    policy: "016 悬赏",
    title: "基础 2 万，延期 5 日 0.75，轻微缺陷 0.95，个人 80%",
    expected: { time: "0.75", quality: "0.95", amount: "11400" },
    run: () => {
      const result = calculateBountySettlement({
        baseReward: "20000",
        delayWorkingDays: 5,
        qualityGrade: "MINOR_DEFECT",
        personalContributionShare: "0.8",
      });
      return {
        time: result.timeCoefficient,
        quality: result.qualityCoefficient,
        amount: result.amount,
      };
    },
  },
  {
    id: "TECH-01",
    policy: "008 产品技术中心",
    title: "发明专利授权",
    expected: { amount: "5000" },
    run: () => ({
      amount: calculateTechCenterAward({ awardType: "INVENTION_PATENT_GRANTED" }).grossAmount,
    }),
  },
  {
    id: "TECH-02",
    policy: "008 产品技术中心",
    title: "客户定制项目费 20 万 × 30%",
    expected: { amount: "60000" },
    run: () => ({
      amount: calculateTechCenterAward({ awardType: "CUSTOM_PROJECT", baseAmount: "200000" }).grossAmount,
    }),
  },
  {
    id: "TECH-03",
    policy: "008 产品技术中心",
    title: "年度降本 300 万 × 1%，上限 1 万",
    expected: { amount: "10000" },
    run: () => ({
      amount: calculateTechCenterAward({ awardType: "COST_OPTIMIZATION", baseAmount: "3000000" }).grossAmount,
    }),
  },
  {
    id: "TECH-04",
    policy: "008 产品技术中心",
    title: "季度池：业务提成 15 万 × 19%，负责人 +0.1",
    expected: { pool: "28500", head: "16108.7", pm: "12391.3" },
    run: () => {
      const result = calculateTechCenterPool({
        totalBusinessCommission: "150000",
        headPersonId: "p-head",
        members: [
          { personId: "p-head", positionCoefficient: "1.2", projectContribution: "1", performanceCoefficient: "1" },
          { personId: "p-pm", positionCoefficient: "1", projectContribution: "1", performanceCoefficient: "1" },
        ],
        headReview: {
          roadmapAchievementPercent: "85",
          crossFunctionalSatisfaction: "4.2",
          techDebtControlled: true,
          retentionMet: true,
        },
      });
      return {
        pool: result.poolAmount,
        head: result.allocations.find((row) => row.personId === "p-head")!.amount,
        pm: result.allocations.find((row) => row.personId === "p-pm")!.amount,
      };
    },
  },
  {
    id: "OVERSEAS-01",
    policy: "003 海外销售",
    title: "开发明星 8 个新客户，坏账损失 3000 扣 50%",
    expected: { gross: "10000", deduction: "1500", net: "8500" },
    run: () => {
      const result = calculateOverseasSalesAward({
        awardType: "NEW_CUSTOMER_STAR",
        newCustomerCount: 8,
        badDebtLoss: "3000",
      });
      return {
        gross: result.grossAmount,
        deduction: result.deduction,
        net: result.netAmount,
      };
    },
  },
  {
    id: "OVERSEAS-02",
    policy: "003 海外销售",
    title: "KA 首签且年度成交 1200 万",
    expected: { gross: "50000" },
    run: () => ({
      gross: calculateOverseasSalesAward({
        awardType: "KA_BREAKTHROUGH",
        firstSigning: true,
        annualCustomerOrderAmount: "12000000",
      }).grossAmount,
    }),
  },
  {
    id: "EQUITY-01",
    policy: "011 股权激励",
    title: "L1 / A 轮 / B 绩效 / A 轮加入 → 2.5%",
    expected: { base: "2.5", grant: "2.5", cap: "10", within: "true" },
    run: () => {
      const result = calculateEquityGrant({
        positionLevel: "L1",
        financingStage: "A",
        performanceGrade: "B",
        tenureStage: "A",
      });
      return {
        base: result.positionBasePercent,
        grant: result.grantPercent,
        cap: result.saturationCapPercent,
        within: String(result.withinSaturation),
      };
    },
  },
  {
    id: "EQUITY-02",
    policy: "011 股权激励",
    title: "L3 / B 轮 / A 绩效 / B 轮加入 → 0.184%",
    expected: { grant: "0.184" },
    run: () => ({
      grant: calculateEquityGrant({
        positionLevel: "L3",
        financingStage: "B",
        performanceGrade: "A",
        tenureStage: "B",
      }).grantPercent,
    }),
  },
  {
    id: "EQUITY-03",
    policy: "011 股权激励",
    title: "L3 Refresh：初始 0.2% × 20% × 1.15",
    expected: { grant: "0.046" },
    run: () => ({
      grant: calculateEquityGrant({
        positionLevel: "L3",
        financingStage: "B",
        performanceGrade: "A",
        tenureStage: "B",
        isRefresh: true,
        initialGrantPercent: "0.2",
      }).grantPercent,
    }),
  },
  {
    id: "EQUITY-04",
    policy: "011 股权激励",
    title: "10000 单位，30 个月归属 62.5%",
    expected: { percent: "62.5", units: "6250" },
    run: () => {
      const result = calculateVestingSchedule({
        totalUnits: "10000",
        vestingStart: "2026-01-01T00:00:00Z",
        asOf: "2028-07-01T00:00:00Z",
      });
      return { percent: result.vestedPercent, units: result.vestedUnits };
    },
  },
  {
    id: "EQUITY-05",
    policy: "011 股权激励",
    title: "24 个月双触发加速至 75%",
    expected: { percent: "75", units: "7500" },
    run: () => {
      const result = calculateVestingSchedule({
        totalUnits: "10000",
        vestingStart: "2026-01-01T00:00:00Z",
        asOf: "2028-01-01T00:00:00Z",
        acceleration: { type: "DOUBLE_TRIGGER" },
      });
      return { percent: result.vestedPercent, units: result.vestedUnits };
    },
  },
  {
    id: "EQUITY-06",
    policy: "011 股权激励",
    title: "被动离职回购：10 元 × 80% × 10000",
    expected: { fair: "8", price: "80000", notice: "30" },
    run: () => {
      const result = calculateRepurchase({
        scenario: "INVOLUNTARY",
        holdingMonths: 24,
        costAmount: "0",
        latestFinancingPrice: "10",
        shares: "10000",
      });
      return {
        fair: result.fairValuePerUnit,
        price: result.repurchasePrice,
        notice: String(result.noticeDeadlineDays),
      };
    },
  },
  {
    id: "EQUITY-07",
    policy: "011 股权激励",
    title: "未递延纳税：行权价 1、公允 5、1000 单位",
    expected: { base: "4000", tax: "800" },
    run: () => {
      const result = calculateEquityTax({
        deferredFiling: false,
        strikePrice: "1",
        fairValuePerUnit: "5",
        units: "1000",
        wageTaxRatePercent: "20",
      });
      return { base: result.taxableBase, tax: result.taxAmount };
    },
  },
  {
    id: "EQUITY-08",
    policy: "011 股权激励",
    title: "递延纳税：转让价 10、行权价 1、1000 单位",
    expected: { base: "9000", tax: "1800" },
    run: () => {
      const result = calculateEquityTax({
        deferredFiling: true,
        strikePrice: "1",
        fairValuePerUnit: "5",
        salePricePerUnit: "10",
        units: "1000",
      });
      return { base: result.taxableBase, tax: result.taxAmount };
    },
  },
  {
    id: "EQUITY-09",
    policy: "011 股权激励",
    title: "Cap Table：累计 5.1%，池剩余 94.9%",
    expected: { total: "5.1", remaining: "94.9" },
    run: () => {
      const result = calculateCapTableSnapshot({
        totalShares: "1000000",
        grants: [
          { personId: "p1", positionLevel: "L1", instrument: "LP_SHARE", grantedPercent: "4", vestedPercent: "4" },
          { personId: "p1", positionLevel: "L1", instrument: "REFRESH", grantedPercent: "1", vestedPercent: "0" },
          { personId: "p2", positionLevel: "L3", instrument: "OPTION", grantedPercent: "0.1", vestedPercent: "0" },
        ],
      });
      return {
        total: result.totalGrantedPercent,
        remaining: result.poolRemainingPercent,
      };
    },
  },
  {
    id: "STAR-01",
    policy: "016 月明星",
    title: "排名第一、总分 110、价值观 20、连续 3 个月",
    expected: { awarded: "true", amount: "1000" },
    run: () => {
      const result = evaluateMonthlyStar([
        {
          personId: "p1",
          rank: 1,
          monthlyScore: "110",
          m003Score: "20",
          verifiedPositiveEvents: 1,
          seriousViolation: false,
          consecutiveMonths: 3,
          awardedThisYear: 0,
        },
      ]);
      return {
        awarded: String(result.awarded),
        amount: result.candidates[0]!.amount,
      };
    },
  },
];

export interface AcceptanceResult {
  id: string;
  policy: string;
  title: string;
  passed: boolean;
  mismatches: Array<{ field: string; expected: string; actual: string }>;
  actual: Record<string, string>;
}

export function runPolicyAcceptance(): {
  results: AcceptanceResult[];
  passed: number;
  failed: number;
} {
  const results = POLICY_ACCEPTANCE_CASES.map((testCase) => {
    const actual = testCase.run();
    const mismatches = Object.entries(testCase.expected)
      .filter(([field, expected]) => actual[field] !== expected)
      .map(([field, expected]) => ({
        field,
        expected,
        actual: actual[field] ?? "<missing>",
      }));
    return {
      id: testCase.id,
      policy: testCase.policy,
      title: testCase.title,
      passed: mismatches.length === 0,
      mismatches,
      actual,
    };
  });
  return {
    results,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
  };
}

export function renderAcceptanceMarkdown(
  results: AcceptanceResult[],
  generatedAt = new Date().toISOString(),
): string {
  const lines = [
    "# 2026 制度验收报告",
    "",
    `生成时间：${generatedAt}`,
    "",
    `| 编号 | 制度 | 场景 | 结果 | 实际值 |`,
    `| --- | --- | --- | --- | --- |`,
  ];
  for (const result of results) {
    lines.push(
      `| ${result.id} | ${result.policy} | ${result.title} | ${
        result.passed ? "PASS" : "FAIL"
      } | ${Object.entries(result.actual)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")} |`,
    );
  }
  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    lines.push("", "## 差异", "");
    for (const result of failed) {
      for (const mismatch of result.mismatches) {
        lines.push(
          `- ${result.id}.${mismatch.field}: 期望 ${mismatch.expected}，实际 ${mismatch.actual}`,
        );
      }
    }
  }
  lines.push(
    "",
    `合计 ${results.length} 条，通过 ${results.filter((result) => result.passed).length} 条，失败 ${failed.length} 条。`,
    "",
  );
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runPolicyAcceptance();
  const generatedAt = new Date().toISOString();
  const dir = join(process.cwd(), "reports");
  mkdirSync(dir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  writeFileSync(
    join(dir, `policy-acceptance-${stamp}.json`),
    JSON.stringify({ generatedAt, ...report }, null, 2),
  );
  writeFileSync(
    join(dir, `policy-acceptance-${stamp}.md`),
    renderAcceptanceMarkdown(report.results, generatedAt),
  );
  for (const result of report.results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${result.id} ${result.title}`,
    );
    for (const mismatch of result.mismatches) {
      console.log(
        `  ${mismatch.field}: expected ${mismatch.expected}, got ${mismatch.actual}`,
      );
    }
  }
  console.log(`\n${report.passed}/${report.results.length} passed`);
  if (report.failed > 0) process.exitCode = 1;
}
