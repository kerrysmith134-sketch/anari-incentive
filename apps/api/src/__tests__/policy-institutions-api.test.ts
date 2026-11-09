/*
 * API surface for the 2026 institutional policy set (016/017/018/011/008/003 +
 * task-based AI-native organisation). Each endpoint is exercised through the
 * real Fastify app and persisted in the platform store.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";

let app: FastifyInstance;
let platformStore: MemoryPlatformStore;

async function call(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

const monthlyMetrics = [
  {
    metricId: "M-001",
    name: "任务按期有效闭环率",
    period: "MONTHLY",
    applicableRoles: ["*"],
    weight: "70",
    metricType: "PIECEWISE_LINEAR",
    dataSource: "飞书",
    sourceFields: [],
    calculationRule: "",
    ownerRole: "主管",
    evidenceRule: "",
    applicabilityRule: "",
    exceptionRule: "",
    approvalRule: "",
    version: 1,
    scoringAnchors: [
      { raw: "0", score: "0" },
      { raw: "100", score: "100" },
    ],
  },
  {
    metricId: "M-002",
    name: "岗位胜任能力考试",
    period: "MONTHLY",
    applicableRoles: ["*"],
    weight: "15",
    metricType: "POSITIVE_LINEAR",
    dataSource: "Academy",
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
    dataSource: "事件",
    sourceFields: [],
    calculationRule: "",
    ownerRole: "主管",
    evidenceRule: "",
    applicabilityRule: "",
    exceptionRule: "",
    approvalRule: "",
    version: 1,
    minScore: "0",
    maxScore: "110",
  },
];

beforeEach(() => {
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: MEMBER, employeeCode: "E002", displayName: "Contributor" },
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
  app = buildApp(new Store(), undefined, undefined, platformStore);
});

describe("performance endpoints (017/018)", () => {
  it("serves monthly, quarterly and annual metric templates", async () => {
    const monthly = await call(
      "GET",
      "/api/v1/policy/performance/templates?period=MONTHLY",
    );
    expect(monthly.status).toBe(200);
    expect(monthly.body.data.map((row: { metricId: string }) => row.metricId)).toEqual([
      "M-001",
      "M-002",
      "M-003",
    ]);
    const quarterly = await call(
      "GET",
      "/api/v1/policy/performance/templates?period=QUARTERLY&role=SALES",
    );
    expect(quarterly.status).toBe(200);
    expect(quarterly.body.data).toHaveLength(5);
    expect(quarterly.body.data[0].weight).toBe("30");
    const missingRole = await call(
      "GET",
      "/api/v1/policy/performance/templates?period=QUARTERLY",
    );
    expect(missingRole.status).toBe(400);
    const annual = await call(
      "GET",
      "/api/v1/policy/performance/templates?period=ANNUAL",
    );
    expect(annual.body.data.map((row: { weight: string }) => row.weight)).toEqual([
      "20",
      "30",
      "20",
      "30",
    ]);
  });

  it("scores a monthly evaluation and stores a versioned record", async () => {
    const scored = await call(
      "POST",
      "/api/v1/policy/performance/score",
      {
        personId: OWNER,
        period: "MONTHLY",
        metrics: monthlyMetrics,
        measurements: [
          { metricId: "M-001", rawValue: "80", applicable: true },
          { metricId: "M-002", rawValue: "90", applicable: true },
          { metricId: "M-003", applicable: true, eventAdjustment: "3" },
        ],
      },
    );
    expect(scored.status).toBe(200);
    expect(scored.body.data.finalScore).toBe("84.95");
    expect(scored.body.data.kp).toBe("0.8495");
    expect(scored.body.data.recordId).toBeTruthy();
    const records = await call(
      "GET",
      `/api/v1/policy/performance/scores?personId=${OWNER}`,
    );
    expect(records.body.data).toHaveLength(1);
    expect(records.body.data[0].recordType).toBe("PERFORMANCE_SCORE");
  });

  it("rejects a malformed metric input with 400 instead of 500", async () => {
    const response = await call("POST", "/api/v1/policy/performance/score", {
      personId: OWNER,
      period: "MONTHLY",
      metrics: [
        {
          ...monthlyMetrics[0],
          metricType: "PIECEWISE_LINEAR",
          scoringAnchors: [],
        },
      ],
      measurements: [{ metricId: "M-001", rawValue: "90", applicable: true }],
    });
    expect(response.status).toBe(400);
  });

  it("computes monthly wage, functional bonus, annual scorecard and profit sharing", async () => {
    const wage = await call(
      "POST",
      "/api/v1/policy/performance/monthly-wage",
      { monthlyTotalWage: "30000", wageBand: "BASE", monthlyScore: "105" },
    );
    expect(wage.body.data.payable).toBe("6300");
    const bonus = await call(
      "POST",
      "/api/v1/policy/performance/functional-quarterly-bonus",
      { fixedMonthlyWage: "10000", quarterlyScore: "120" },
    );
    expect(bonus.body.data.amount).toBe("1200");
    const scorecard = await call(
      "POST",
      "/api/v1/policy/performance/annual-scorecard",
      {
        revenueAchievementScore: "100",
        distributableProfitAchievementScore: "110",
        netCollectionAchievementScore: "100",
        strategyAchievementScore: "120",
        distributableNetProfit: "12000000",
        netProfitTarget: "10000000",
        functionalBonusPoolRatePercent: "8",
      },
    );
    expect(scorecard.body.data.companyScore).toBe("105");
    const sharing = await call(
      "POST",
      "/api/v1/policy/performance/annual-profit-sharing",
      {
        distributableNetProfit: "10000000",
        netProfitTarget: "10000000",
        poolRatePercent: "8",
        people: [
          {
            personId: OWNER,
            monthlyWageBase: "20000",
            gradeCoefficient: "1.5",
            weightedQuarterlyKp: "1.1",
            attendanceRatio: "1",
          },
        ],
      },
    );
    expect(sharing.body.data.eligible).toBe(true);
    expect(sharing.body.data.poolAmount).toBe("800000");
    expect(sharing.body.data.allocations[0].amount).toBe("800000");
  });

  it("evaluates the monthly star and records a no-award outcome", async () => {
    const awarded = await call(
      "POST",
      "/api/v1/policy/performance/monthly-star/evaluate",
      {
        period: "2026-11",
        candidates: [
          {
            personId: OWNER,
            rank: 1,
            monthlyScore: "110",
            m003Score: "110",
            verifiedPositiveEvents: 1,
            seriousViolation: false,
            consecutiveMonths: 3,
            awardedThisYear: 0,
          },
        ],
      },
    );
    expect(awarded.body.data.awarded).toBe(true);
    expect(awarded.body.data.candidates[0].amount).toBe("1000");
    const none = await call(
      "POST",
      "/api/v1/policy/performance/monthly-star/evaluate",
      {
        period: "2026-11",
        candidates: [
          {
            personId: MEMBER,
            rank: 2,
            monthlyScore: "108",
            m003Score: "110",
            verifiedPositiveEvents: 1,
            seriousViolation: false,
            consecutiveMonths: 1,
            awardedThisYear: 0,
          },
        ],
      },
    );
    expect(none.body.data.awarded).toBe(false);
    expect(none.body.data.note).toContain("不递补");
  });
});

describe("incentive endpoints (016/008/003)", () => {
  it("computes DBCP, band commission, supplement and internal split", async () => {
    const dbcp = await call("POST", "/api/v1/policy/incentive/dbcp", {
      grossProfit: "1000000",
      businessExpenses: "50000",
      laborAndTravel: "100000",
      allocatedBusinessUnitExpenses: "20000",
      allocatedBackendPayroll: "30000",
      period: "2026-Q4",
    });
    expect(dbcp.body.data.dbcp).toBe("750000");
    const commission = await call(
      "POST",
      "/api/v1/policy/incentive/business-unit-commission",
      { dbcp: "750000", netCollection: "1000000", period: "2026-Q4" },
    );
    expect(commission.body.data.commission).toBe("30000");
    const supplement = await call(
      "POST",
      "/api/v1/policy/incentive/executive-supplement",
      { dbcp: "1000000", managementScore: "90", marketingReward: "5000" },
    );
    expect(supplement.body.data.supplement).toBe("13000");
    const split = await call(
      "POST",
      "/api/v1/policy/incentive/internal-split",
      {
        commissionPool: "30000",
        marketingReward: "5000",
        executiveSupplement: "13000",
        participants: [
          { personId: OWNER, sharePercent: "60" },
          { personId: MEMBER, sharePercent: "40" },
        ],
      },
    );
    expect(split.body.data.allocations).toEqual([
      { personId: OWNER, amount: "7200" },
      { personId: MEMBER, amount: "4800" },
    ]);
  });

  it("settles bounties, tech center awards/pool and overseas awards", async () => {
    const bounty = await call(
      "POST",
      "/api/v1/policy/incentive/bounty-settlement",
      {
        baseReward: "10000",
        delayWorkingDays: 5,
        qualityGrade: "MINOR_DEFECT",
        personalContributionShare: "1",
        personId: OWNER,
      },
    );
    expect(bounty.body.data.amount).toBe("7125");
    const techAward = await call(
      "POST",
      "/api/v1/policy/incentive/tech-center/award",
      { awardType: "INVENTION_PATENT_GRANTED" },
    );
    expect(techAward.body.data.grossAmount).toBe("5000");
    const pool = await call(
      "POST",
      "/api/v1/policy/incentive/tech-center/pool",
      {
        totalBusinessCommission: "100000",
        headPersonId: OWNER,
        members: [
          {
            personId: OWNER,
            positionCoefficient: "1.2",
            projectContribution: "1",
            performanceCoefficient: "1",
          },
        ],
        headReview: {
          roadmapAchievementPercent: "80",
          crossFunctionalSatisfaction: "4",
          techDebtControlled: true,
          retentionMet: true,
        },
      },
    );
    expect(pool.body.data.poolAmount).toBe("19000");
    expect(pool.body.data.headAdjustment).toBe("0.1");
    const overseas = await call(
      "POST",
      "/api/v1/policy/incentive/overseas-sales/award",
      { awardType: "NEW_CUSTOMER_STAR", newCustomerCount: 8 },
    );
    expect(overseas.body.data.grossAmount).toBe("10000");
  });
});

describe("equity endpoints (011)", () => {
  it("computes grant, strike price, vesting, repurchase and cap table", async () => {
    const grant = await call("POST", "/api/v1/policy/equity/grant-calc", {
      positionLevel: "L1",
      financingStage: "A",
      performanceGrade: "B",
      tenureStage: "A",
    });
    expect(grant.body.data.grantPercent).toBe("2.5");
    const strike = await call("POST", "/api/v1/policy/equity/option-strike", {
      latestPreferredPrice: "50",
      stage: "A",
    });
    expect(strike.body.data.strikePrice).toBe("27.5");
    const vesting = await call("POST", "/api/v1/policy/equity/vesting", {
      totalUnits: "10000",
      vestingStart: "2026-01-01T00:00:00Z",
      asOf: "2027-01-01T00:00:00Z",
    });
    expect(vesting.body.data.vestedUnits).toBe("2500");
    const repurchase = await call(
      "POST",
      "/api/v1/policy/equity/repurchase",
      {
        scenario: "INVOLUNTARY",
        holdingMonths: 24,
        costAmount: "0",
        latestFinancingPrice: "10",
        shares: "10000",
      },
    );
    expect(repurchase.body.data.repurchasePrice).toBe("80000");
    const capTable = await call("POST", "/api/v1/policy/equity/cap-table", {
      totalShares: "1000000",
      grants: [
        {
          personId: OWNER,
          positionLevel: "L1",
          instrument: "LP_SHARE",
          grantedPercent: "4",
          vestedPercent: "4",
        },
      ],
    });
    expect(capTable.body.data.totalGrantedPercent).toBe("4");
  });
});

describe("task pods and AI-native organisation", () => {
  async function createAiMember(): Promise<string> {
    const response = await call("POST", "/api/v1/ai-members", {
      name: "证据助理",
      role: "EVIDENCE_AGENT",
      aiVersion: "1.0.0",
      responsibilities: ["归集证据", "识别异常"],
    });
    expect(response.status).toBe(201);
    return response.body.data.recordId;
  }

  it("registers an AI member then creates a valid task pod", async () => {
    const aiRecordId = await createAiMember();
    const ai = (await call("GET", "/api/v1/ai-members")).body.data[0];
    const aiId = ai.payload.id;
    const created = await call("POST", "/api/v1/task-pods", {
      title: "海外市场进入",
      objective: "完成认证与首批客户上线",
      initiatorPersonId: OWNER,
      members: [
        { kind: "PERSON", memberId: OWNER, role: "INITIATOR" },
        {
          kind: "AI",
          memberId: aiId,
          role: "EVIDENCE_AGENT",
          aiVersion: "1.0.0",
        },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("OPEN");
    const list = await call("GET", "/api/v1/task-pods");
    expect(list.body.data).toHaveLength(1);
    const podRecordId = created.body.data.recordId;
    const completed = await call(
      "POST",
      `/api/v1/task-pods/${podRecordId}/status`,
      { status: "COMPLETED" },
    );
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe("COMPLETED");
    expect(aiRecordId).toBeTruthy();
  });

  it("rejects an unregistered AI member", async () => {
    const response = await call("POST", "/api/v1/task-pods", {
      title: "无登记 AI",
      objective: "验证门禁",
      initiatorPersonId: OWNER,
      members: [
        { kind: "PERSON", memberId: OWNER, role: "INITIATOR" },
        { kind: "AI", memberId: "ai-missing", role: "X" },
      ],
    });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("未登记");
  });

  it("validates and accepts a personal task inventory", async () => {
    const invalid = await call(
      "POST",
      "/api/v1/personal-task-inventories",
      {
        personId: OWNER,
        period: "2026-Q4",
        tasks: [
          {
            taskId: "t1",
            name: "周报汇总",
            deliverable: "周报",
            measure: "每周五前",
            mode: "HYBRID",
          },
        ],
      },
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toContain("AI 工作流");
    const valid = await call(
      "POST",
      "/api/v1/personal-task-inventories",
      {
        personId: OWNER,
        period: "2026-Q4",
        tasks: [
          {
            taskId: "t1",
            name: "周报汇总",
            deliverable: "周报",
            measure: "每周五前",
            mode: "HYBRID",
            aiWorkflow: "AI 汇总飞书数据，人复核签发",
            aiTransformationCandidate: true,
          },
        ],
      },
    );
    expect(valid.status).toBe(201);
    const recordId = valid.body.data.recordId;
    const submitted = await call(
      "POST",
      `/api/v1/personal-task-inventories/${recordId}/status`,
      { status: "SUBMITTED" },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe("SUBMITTED");
    const accepted = await call(
      "POST",
      `/api/v1/personal-task-inventories/${recordId}/status`,
      { status: "ACCEPTED", reviewerPersonId: ADMIN },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe("ACCEPTED");
  });
});

describe("M-001 closure rate and goal cards", () => {
  async function acceptedPackage(
    title: string,
    packageType: string,
    withEvidence: boolean,
  ): Promise<string> {
    const dueAt = new Date(Date.now() + 7 * 864e5).toISOString();
    const created = await call("POST", "/api/v1/work-packages", {
      title,
      objective: "验证 M-001 取数",
      packageType,
      ownerPersonId: OWNER,
      members: [
        { personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "交付" },
      ],
      acceptanceCriteria: ["验收通过"],
      dueAt,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    if (withEvidence) {
      await call("POST", "/api/v1/evidence", {
        subjectType: "WORK_PACKAGE",
        subjectId: id,
        evidenceType: "DELIVERABLE",
        sourceSystem: "tdd",
        observedAt: new Date().toISOString(),
        normalizedPayload: { note: "交付证据" },
      });
    }
    for (const [step, payload] of [
      ["commit", { expectedVersion: 1 }],
      ["start", {}],
      ["submit", {}],
      ["accept", { reviewerPersonId: ADMIN }],
    ] as const) {
      const response = await call(
        "POST",
        `/api/v1/work-packages/${id}/${step}`,
        payload as Record<string, unknown>,
      );
      expect(response.status).toBeLessThan(300);
    }
    return id;
  }

  it("computes weighted closure rate from task grades and evidence", async () => {
    const start = new Date(Date.now() - 864e5).toISOString();
    const end = new Date(Date.now() + 30 * 864e5).toISOString();
    await acceptedPackage("重要任务", "IMPORTANT", true);
    await acceptedPackage("关键任务缺证据", "CRITICAL", false);
    const response = await call(
      "POST",
      "/api/v1/policy/performance/closure-rate",
      { personId: OWNER, startsAt: start, endsAt: end, period: "2026-11" },
    );
    expect(response.status).toBe(200);
    // 重要 2 分有效 + 关键 3 分缺证据 → 2/5 = 40%
    expect(response.body.data.requiredWeight).toBe("5");
    expect(response.body.data.qualifiedWeight).toBe("2");
    expect(response.body.data.closureRate).toBe("40");
    expect(response.body.data.tasks).toHaveLength(2);
  });

  it("returns N/A instead of zero when no tasks are due", async () => {
    const response = await call(
      "POST",
      "/api/v1/policy/performance/closure-rate",
      {
        personId: OWNER,
        startsAt: "2020-01-01T00:00:00Z",
        endsAt: "2020-01-31T00:00:00Z",
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.data.note).toContain("N/A");
    expect(response.body.data.closureRate).toBe("0");
  });

  function goalMetric(id: string, weight: string) {
    return {
      metricId: id,
      name: id,
      period: "QUARTERLY",
      applicableRoles: ["SALES"],
      weight,
      metricType: "POSITIVE_LINEAR",
      dataSource: "AI财务",
      sourceFields: [],
      calculationRule: "",
      target: "100",
      ownerRole: "主管",
      evidenceRule: "",
      applicabilityRule: "",
      exceptionRule: "",
      approvalRule: "",
      version: 1,
    };
  }

  it("validates 100% weights, locks a goal card and refuses silent overwrite", async () => {
    const invalid = await call(
      "POST",
      "/api/v1/policy/performance/goal-cards",
      {
        personId: OWNER,
        period: "QUARTERLY",
        roleCode: "SALES",
        metrics: [goalMetric("Q-S-001", "60"), goalMetric("Q-S-002", "35")],
      },
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toContain("100%");
    const created = await call(
      "POST",
      "/api/v1/policy/performance/goal-cards",
      {
        personId: OWNER,
        period: "QUARTERLY",
        roleCode: "SALES",
        metrics: [goalMetric("Q-S-001", "60"), goalMetric("Q-S-002", "40")],
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.data.totalWeight).toBe("100");
    const locked = await call(
      "POST",
      `/api/v1/policy/performance/goal-cards/${created.body.data.recordId}/lock`,
      {},
    );
    expect(locked.status).toBe(200);
    expect(locked.body.data.status).toBe("LOCKED");
    const again = await call(
      "POST",
      `/api/v1/policy/performance/goal-cards/${created.body.data.recordId}/lock`,
      {},
    );
    expect(again.status).toBe(409);
  });
});

describe("equity tax and grant workflow", () => {
  it("computes deferred vs non-deferred tax", async () => {
    const nonDeferred = await call("POST", "/api/v1/policy/equity/tax", {
      deferredFiling: false,
      strikePrice: "1",
      fairValuePerUnit: "5",
      units: "1000",
      wageTaxRatePercent: "20",
    });
    expect(nonDeferred.body.data.taxableBase).toBe("4000");
    expect(nonDeferred.body.data.taxAmount).toBe("800");
    const deferred = await call("POST", "/api/v1/policy/equity/tax", {
      deferredFiling: true,
      strikePrice: "1",
      fairValuePerUnit: "5",
      units: "1000",
      salePricePerUnit: "10",
    });
    expect(deferred.body.data.taxableBase).toBe("9000");
    expect(deferred.body.data.taxAmount).toBe("1800");
  });

  it("walks the eight-step grant workflow with policy gates", async () => {
    const created = await call("POST", "/api/v1/policy/equity/grant-cases", {
      personId: OWNER,
      instrument: "OPTION",
      positionLevel: "L1",
      financingStage: "A",
      performanceGrade: "B",
      tenureStage: "A",
      grantPercent: "2.5",
      totalUnits: "25000",
      strikePrice: "27.5",
      married: true,
    });
    expect(created.status).toBe(201);
    const recordId = created.body.data.recordId;
    const advance = (status: string, extra: Record<string, unknown> = {}) =>
      call("POST", `/api/v1/policy/equity/grant-cases/${recordId}/advance`, {
        status,
        ...extra,
      });
    expect((await advance("CALCULATION")).status).toBe(200);
    expect((await advance("PLAN")).status).toBe(200);
    expect((await advance("SHAREHOLDER_APPROVAL")).status).toBe(200);
    const noResolution = await advance("AGREEMENT");
    expect(noResolution.status).toBe(400);
    const noRisk = await advance("AGREEMENT", {
      shareholderResolutionRef: "SH-2026-011",
    });
    expect(noRisk.status).toBe(400);
    expect(noRisk.body.error.message).toContain("风险");
    expect(
      (
        await advance("AGREEMENT", {
          shareholderResolutionRef: "SH-2026-011",
          riskAcknowledged: true,
        })
      ).status,
    ).toBe(200);
    const noAgreement = await advance("REGISTRATION");
    expect(noAgreement.status).toBe(400);
    const noSpouse = await advance("REGISTRATION", {
      agreementSigned: true,
    });
    expect(noSpouse.status).toBe(400);
    expect(noSpouse.body.error.message).toContain("配偶");
    expect(
      (
        await advance("REGISTRATION", {
          agreementSigned: true,
          spouseConfirmationSigned: true,
        })
      ).status,
    ).toBe(200);
    expect((await advance("TAX_FILING")).status).toBe(400);
    expect(
      (
        await advance("TAX_FILING", {
          taxFilingRef: "TAX-2026-88",
        })
      ).status,
    ).toBe(200);
    expect((await advance("LEDGERED")).status).toBe(400);
    expect(
      (await advance("LEDGERED", { capTableUpdated: true })).status,
    ).toBe(200);
    const list = await call("GET", "/api/v1/policy/equity/grant-cases");
    expect(list.body.data[0].status).toBe("LEDGERED");
  });
});

describe("incentive award batches", () => {
  function payload(batchNo: string, sourceRecordId = "record-1") {
    return {
      batchNo,
      awardType: "MONTHLY_STAR",
      period: "2026-11",
      currency: "CNY",
      createdBy: ADMIN,
      sourceRecordIds: [sourceRecordId],
      lines: [
        {
          personId: MEMBER,
          amount: "500",
          sourceRecordId,
          sourceLineRef: "line-1",
          note: "月明星",
        },
      ],
    };
  }

  it("runs DRAFT → PENDING_APPROVAL → APPROVED → LOCKED → EXPORTED → ACKNOWLEDGED", async () => {
    const created = await call(
      "POST",
      "/api/v1/incentive-award-batches",
      payload("AWARD-001"),
    );
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("DRAFT");
    expect(created.body.data.totalAmount).toBe("500");
    const id = created.body.data.id;
    const submit = await call(
      "POST",
      `/api/v1/incentive-award-batches/${id}/commands`,
      { command: "SUBMIT" },
    );
    expect(submit.body.data.status).toBe("PENDING_APPROVAL");
    const approve = await call(
      "POST",
      `/api/v1/incentive-award-batches/${id}/commands`,
      { command: "APPROVE" },
    );
    expect(approve.body.data.status).toBe("APPROVED");
    expect(approve.body.data.approvedBy).toBe(OWNER);
    const lock = await call(
      "POST",
      `/api/v1/incentive-award-batches/${id}/commands`,
      { command: "LOCK" },
    );
    expect(lock.body.data.status).toBe("LOCKED");
    const exported = await call(
      "POST",
      `/api/v1/incentive-award-batches/${id}/commands`,
      { command: "EXPORT" },
    );
    expect(exported.body.data.status).toBe("EXPORTED");
    const csv = await app.inject({
      method: "GET",
      url: `/api/v1/incentive-award-batches/${id}/export`,
    } as never);
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("批次号");
    expect(csv.body).toContain("月明星");
    const acknowledged = await call(
      "POST",
      `/api/v1/incentive-award-batches/${id}/commands`,
      { command: "ACKNOWLEDGE", paymentRef: "BANK-2026-11" },
    );
    expect(acknowledged.body.data.status).toBe("ACKNOWLEDGED");
    expect(acknowledged.body.data.paymentRef).toBe("BANK-2026-11");
  });

  it("refuses self-approval and duplicate source records", async () => {
    const created = await call(
      "POST",
      "/api/v1/incentive-award-batches",
      { ...payload("AWARD-002", "record-self"), createdBy: OWNER },
    );
    const id = created.body.data.id;
    await call("POST", `/api/v1/incentive-award-batches/${id}/commands`, {
      command: "SUBMIT",
    });
    const self = await call(
      "POST",
      `/api/v1/incentive-award-batches/${id}/commands`,
      { command: "APPROVE" },
    );
    // 默认调用人 OWNER 同时是创建人，自批被阻断。
    expect(self.status).toBe(409);
    const duplicate = await call(
      "POST",
      "/api/v1/incentive-award-batches",
      payload("AWARD-003", "record-self"),
    );
    expect(duplicate.status).toBe(409);
  });

  it("rejects empty lines and non-positive amounts", async () => {
    const empty = await call("POST", "/api/v1/incentive-award-batches", {
      batchNo: "AWARD-EMPTY",
      awardType: "MONTHLY_STAR",
      period: "2026-11",
      currency: "CNY",
      lines: [],
    });
    expect(empty.status).toBe(400);
    const negative = await call("POST", "/api/v1/incentive-award-batches", {
      batchNo: "AWARD-NEG",
      awardType: "MONTHLY_STAR",
      period: "2026-11",
      currency: "CNY",
      lines: [{ personId: MEMBER, amount: "-1" }],
    });
    expect(negative.status).toBe(409);
  });
});
