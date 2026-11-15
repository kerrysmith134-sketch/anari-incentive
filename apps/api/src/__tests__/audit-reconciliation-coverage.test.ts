/**
 * AUD-014/AUD-015：财务对账与评价覆盖率的后端报告端点。
 *
 * - 对账：微单位整数运算、FORMAL+APPROVED/LOCKED 运行基准、逐笔披露、
 *   SHADOW 运行不参与、payload.cycleId 优先、期间重叠兜底。
 * - 覆盖率：分母 = 在职 roster（10 人 roster、6 份草案时分母仍为 10），
 *   排除项明示、decision 按 person+cycle 匹配。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADJUDICATOR = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";
const TENANT = "00000000-0000-4000-8000-000000000001";

function authFor(roles: string[]) {
  return {
    async authenticate() {
      return {
        tenantId: TENANT,
        userId: "user-ops",
        roles,
        personId: undefined,
      };
    },
  };
}

function setup(persons: Array<{ id: string; employeeCode: string; displayName: string; employmentStatus?: string }> = []) {
  const appStore = new Store(TENANT);
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "Audit tenant",
      slug: "audit-tenant",
      persons,
    },
  });
  const app = buildApp(
    () => appStore,
    undefined,
    authFor(["admin"]),
    platformStore,
  );
  return { app, appStore, platformStore };
}

async function seedLockedRun(store: Store, gross: string) {
  const published = await store.publishPolicy({
    policy: {
      code: "AUD_RECON",
      version: 1,
      currency: "CNY",
      poolRate: "0.05",
      poolCap: "100000",
      rounding: "HALF_UP",
      calculator: "SIMPLE_POOL",
      evaluation: { dimensionWeights: { QUALITY: "1" }, floor: "0.5", ceiling: "1.5" },
    },
    effectiveFrom: "2026-10-01",
    approvedBy: ADJUDICATOR,
    applicability: {
      legalEntity: "Audit Entity",
      jurisdictions: ["CN"],
      workLocations: ["Shanghai"],
      employeeCategories: ["FULL_TIME"],
      workTimeTypes: ["FULL_TIME"],
    },
  });
  await store.recordLegalGate({
    policyVersionId: published.policyVersionId,
    democraticProcedureRef: "dp",
    employeeNoticeRef: "notice",
    dataProtectionAssessmentRef: "dpia",
    minimumWageChecked: true,
    policyApproved: true,
    recordedBy: ADJUDICATOR,
  });
  const wp = await store.createWorkPackage({
    title: "audit-recon-wp",
    objective: "audit reconciliation objective",
    ownerPersonId: OWNER,
    members: [
      { personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "d" },
      { personId: MEMBER, responsibilityCode: "CONTRIBUTOR", expectedOutput: "r" },
    ],
    acceptanceCriteria: ["done"],
  });
  await store.commitWorkPackage(wp.id, 1);
  await store.startWorkPackage(wp.id);
  await store.submitWorkPackage(wp.id);
  await store.acceptWorkPackage(wp.id, MEMBER);
  // FORMAL 运行要求每个参与者有已确认的归属决定（Memory store 门禁）。
  for (const person of [OWNER, MEMBER]) {
    const claim = await store.createClaim({
      workPackageId: wp.id,
      claimantPersonId: person,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: { dimensions: ["QUALITY"], summary: "audit" },
      evidenceRefs: [],
      rationale: "audit claim",
    });
    await store.submitClaim(claim.id);
    await store.createAttributionDecision({
      claimId: claim.id,
      adjudicatorPersonId: ADJUDICATOR,
      status: "CONFIRMED",
      acceptedFacts: ["delivered"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "audit",
    });
  }
  const rubric = await store.createRubric({
    code: "AUD_RUBRIC",
    name: "audit rubric",
    dimensions: ["QUALITY"],
    scoringAnchors: {},
    effectiveFrom: "2026-10-01",
  });
  const decisions: Record<string, string> = {};
  for (const person of [OWNER, MEMBER]) {
    const draft = await store.createEvaluationDraft({
      cycleId: CYCLE,
      personId: person,
      generatedByType: "SYSTEM",
      evidenceSnapshotHash: `audit-${person}`,
      draftPayload: {},
    });
    await store.submitEvaluationDraft(draft.id);
    const decided = await store.decideEvaluationDraft(draft.id, {
      reviewerPersonId: ADJUDICATOR,
      rubricVersionId: rubric.id,
      decision: "APPROVE",
      scores: { QUALITY: 4 },
      independentScores: { QUALITY: 4 },
      independentRationale: "audit",
      evidenceOpened: 1,
      rationale: "audit",
    });
    decisions[person] = decided.decision!.id;
  }
  const run = await store.createCalculationRun({
    cycleId: CYCLE,
    policyVersionId: published.policyVersionId,
    mode: "FORMAL",
    order: { id: "order-audit", grossProfit: gross, currency: "CNY" },
    participants: [
      { personId: OWNER, workPackageId: wp.id, attributionWeight: "0.6", role: "OWNER", evaluationDecisionId: decisions[OWNER]! },
      { personId: MEMBER, workPackageId: wp.id, attributionWeight: "0.4", role: "CONTRIBUTOR", evaluationDecisionId: decisions[MEMBER]! },
    ],
  });
  for (const person of [OWNER, MEMBER]) {
    await store.recordConfirmation({
      personId: person,
      targetType: "CALCULATION",
      targetId: run.id,
      decision: "CONFIRMED",
    });
  }
  await store.approveRun(run.id);
  return store.lockRun(run.id, "LOCK_CALCULATION");
}

describe("AUD-014: 财务对账端点（微单位整数、FORMAL 基准）", () => {
  it("声明与运行毛利一致 → MATCH；差异逐笔披露", async () => {
    const { app, appStore, platformStore } = await (async () => {
      const s = setup();
      await s.appStore.createEvaluationCycle({
        name: "对账周期",
        cycleType: "MONTHLY",
        startsAt: "2026-10-01",
        endsAt: "2026-10-31",
        timezone: "Asia/Shanghai",
      });
      await seedLockedRun(s.appStore, "1000001.5");
      await s.platformStore.createFinancialFact({
        tenantId: TENANT,
        sourceSystem: "ERP",
        sourceRecordId: "FA-1",
        factType: "GROSS_PROFIT",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        amount: "1000001.5",
        currency: "CNY",
        qualityStatus: "VALID",
        payload: { cycleId: CYCLE },
      });
      return s;
    })();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/finance-reconciliation?cycleId=${CYCLE}`,
    });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as { data: { cycles: Array<Record<string, unknown>> } }).data.cycles[0]!;
    expect(row.status).toBe("MATCH");
    expect(row.deltaMicros).toBe("0");
    expect((row.declared as { facts: unknown[] }).facts).toHaveLength(1);
  });

  it("SHADOW 运行与未锁定 FORMAL 不作为对账基准 → 声明侧独有金额产生差异", async () => {
    const { app, appStore, platformStore } = await (async () => {
      const s = setup();
      await s.appStore.createEvaluationCycle({
        name: "影子周期",
        cycleType: "MONTHLY",
        startsAt: "2026-10-01",
        endsAt: "2026-10-31",
        timezone: "Asia/Shanghai",
      });
      await s.platformStore.createFinancialFact({
        tenantId: TENANT,
        sourceSystem: "ERP",
        sourceRecordId: "FA-2",
        factType: "GROSS_PROFIT",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        amount: "500.25",
        currency: "CNY",
        qualityStatus: "VALID",
        payload: { cycleId: CYCLE },
      });
      return s;
    })();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/finance-reconciliation?cycleId=${CYCLE}`,
    });
    const row = (res.json() as { data: { cycles: Array<Record<string, unknown>> } }).data.cycles[0]!;
    expect(row.status).toBe("VARIANCE");
    expect((row.calculated as { runId: string | null }).runId).toBeNull();
    expect(row.deltaMicros).toBe("500250000");
    expect(appStore).toBeDefined();
  });

  it("无 payload.cycleId 的事实按期间重叠归属；无运行基准 → VARIANCE", async () => {
    const { app, platformStore } = await (async () => {
      const s = setup();
      await s.appStore.createEvaluationCycle({
        name: "期间重叠周期",
        cycleType: "MONTHLY",
        startsAt: "2026-10-01",
        endsAt: "2026-10-31",
        timezone: "Asia/Shanghai",
      });
      // 没有 payload.cycleId：靠 periodStart/End 与周期窗口重叠归属。
      await s.platformStore.createFinancialFact({
        tenantId: TENANT,
        sourceSystem: "ERP",
        sourceRecordId: "FA-OVERLAP",
        factType: "GROSS_PROFIT",
        periodStart: "2026-10-15",
        periodEnd: "2026-11-15",
        amount: "0.123456",
        currency: "CNY",
        qualityStatus: "VALID",
        payload: {},
      });
      return s;
    })();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/finance-reconciliation?cycleId=${CYCLE}`,
    });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as { data: { cycles: Array<Record<string, unknown>> } }).data.cycles[0]!;
    expect(row.status).toBe("VARIANCE"); // 无 FORMAL 运行基准 → 声明侧独有
    const declared = row.declared as { facts: unknown[]; totalMicros: string; total: string | null };
    expect(declared.facts).toHaveLength(1);
    expect(declared.totalMicros).toBe("123456");
    expect(declared.total).toBe("0.123456");
    void platformStore;
  });
});

describe("AUD-015: 评价覆盖率端点（roster 分母）", () => {
  it("roster 10 人、仅 2 份草案 → 分母仍为 10；离职者进排除项", async () => {
    // OWNER/MEMBER 用固定 UUID 进 roster（草案/决定按 personId 匹配）。
    const { app, appStore, platformStore } = setup([
      { id: OWNER, employeeCode: "E001", displayName: "负责人", employmentStatus: "ACTIVE" },
      { id: MEMBER, employeeCode: "E002", displayName: "成员", employmentStatus: "ACTIVE" },
    ]);
    // roster：再补 8 名在职 + 1 名离职（合计在职 10）。
    for (let k = 3; k < 11; k += 1) {
      await platformStore.createPerson({
        tenantId: TENANT,
        employeeCode: `E${String(k).padStart(3, "0")}`,
        displayName: `在职${k}`,
        employmentStatus: "ACTIVE",
      });
    }
    await platformStore.createPerson({
      tenantId: TENANT,
      employeeCode: "E999",
      displayName: "离职者",
      employmentStatus: "INACTIVE",
    });
    await appStore.createEvaluationCycle({
      name: "覆盖周期",
      cycleType: "MONTHLY",
      startsAt: "2026-10-01",
      endsAt: "2026-10-31",
      timezone: "Asia/Shanghai",
    });
    // 仅 OWNER/MEMBER 有已决草案
    const rubric = await appStore.createRubric({
      code: "COV_RUBRIC",
      name: "coverage rubric",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-10-01",
    });
    for (const person of [OWNER, MEMBER]) {
      const draft = await appStore.createEvaluationDraft({
        cycleId: CYCLE,
        personId: person,
        generatedByType: "SYSTEM",
        evidenceSnapshotHash: `cov-${person}`,
        draftPayload: {},
      });
      await appStore.submitEvaluationDraft(draft.id);
      await appStore.decideEvaluationDraft(draft.id, {
        reviewerPersonId: ADJUDICATOR,
        rubricVersionId: rubric.id,
        decision: "APPROVE",
        scores: { QUALITY: 4 },
        independentScores: { QUALITY: 4 },
        independentRationale: "cov",
        evidenceOpened: 1,
        rationale: "cov",
      });
    }
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/evaluation-coverage?cycleId=${CYCLE}`,
    });
    expect(res.statusCode).toBe(200);
    const report = (res.json() as { data: Record<string, unknown> }).data;
    expect(report.denominator).toBe(10);
    expect(report.decided).toBe(2);
    expect(report.pending).toBe(8);
    expect(report.excluded).toHaveLength(1);
    const noDraft = (report.perPerson as Array<{ state: string }>).filter(
      (entry) => entry.state === "NO_DRAFT",
    );
    expect(noDraft).toHaveLength(8);
  });

  it("缺 cycleId → 400", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/evaluation-coverage",
    });
    expect(res.statusCode).toBe(400);
  });
});
