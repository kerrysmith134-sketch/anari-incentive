/**
 * NP-023（B 方案）：对账差异一键生成调整分录。
 *
 * POST /api/v1/reports/finance-reconciliation/:cycleId/adjustment：
 * - 财务角色专用；MATCH 周期拒绝（无可调整差异）；
 * - 目标分录必须属于该周期对账基准运行且为 LOCKED 的 INCENTIVE；
 * - 复用 adjustLedgerEntry（幂等 + AdjustmentRecord + 锁定）；
 * - 落审计 RECONCILIATION_ADJUSTMENT_POSTED（含差异上下文）。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const FINANCE = "00000000-0000-4000-8000-000000000001";
const MANAGER = "00000000-0000-4000-8000-000000000004";
const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADJUDICATOR = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";
const CYCLE_B = "00000000-0000-4000-8000-000000000021";
const TENANT = "00000000-0000-4000-8000-000000000001";

function setup() {
  const appStore = new Store(TENANT);
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "Recon tenant",
      slug: "recon-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "负责人" },
        { id: MEMBER, employeeCode: "E002", displayName: "成员" },
      ],
    },
  });
  const app = buildApp(
    () => appStore,
    undefined,
    {
      async authenticate() {
        return {
          tenantId: TENANT,
          userId: "finance-1",
          roles: ["admin", "finance"],
          personId: FINANCE,
        };
      },
    },
    platformStore,
  );
  return { app, appStore, platformStore };
}

/** 与 audit-reconciliation-coverage.test.ts 相同的锁定 FORMAL 运行种子。 */
async function seedLockedRun(store: Store, cycleId: string, gross: string) {
  const published = await store.publishPolicy({
    policy: {
      code: `RECON_ADJ_${cycleId.slice(-4)}`,
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
    title: `recon-adj-wp-${cycleId.slice(-4)}`,
    objective: "reconciliation adjustment objective",
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
    code: `ADJ_RUBRIC_${cycleId.slice(-4)}`,
    name: "adjustment rubric",
    dimensions: ["QUALITY"],
    scoringAnchors: {},
    effectiveFrom: "2026-10-01",
  });
  const decisions: Record<string, string> = {};
  for (const person of [OWNER, MEMBER]) {
    const draft = await store.createEvaluationDraft({
      cycleId,
      personId: person,
      generatedByType: "SYSTEM",
      evidenceSnapshotHash: `adj-${person}`,
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
    cycleId,
    policyVersionId: published.policyVersionId,
    mode: "FORMAL",
    order: { id: `order-${cycleId.slice(-4)}`, grossProfit: gross, currency: "CNY" },
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

async function seedVarianceCycle(appStore: Store, platformStore: MemoryPlatformStore) {
  await appStore.createEvaluationCycle({
    name: "差异周期",
    cycleType: "MONTHLY",
    startsAt: "2026-10-01",
    endsAt: "2026-10-31",
    timezone: "Asia/Shanghai",
  });
  const run = await seedLockedRun(appStore, CYCLE, "1000");
  await platformStore.createFinancialFact({
    tenantId: TENANT,
    sourceSystem: "ERP",
    sourceRecordId: "FA-V1",
    factType: "GROSS_PROFIT",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    amount: "1100",
    currency: "CNY",
    qualityStatus: "VALID",
    payload: { cycleId: CYCLE },
  });
  return run;
}

describe("NP-023: 对账差异一键生成调整分录", () => {
  it("MATCH 周期 → 409 RECONCILIATION_NO_VARIANCE（无可调整差异）", async () => {
    const { app, appStore, platformStore } = setup();
    await appStore.createEvaluationCycle({
      name: "一致周期",
      cycleType: "MONTHLY",
      startsAt: "2026-10-01",
      endsAt: "2026-10-31",
      timezone: "Asia/Shanghai",
    });
    await seedLockedRun(appStore, CYCLE, "1000");
    await platformStore.createFinancialFact({
      tenantId: TENANT,
      sourceSystem: "ERP",
      sourceRecordId: "FA-M1",
      factType: "GROSS_PROFIT",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      amount: "1000",
      currency: "CNY",
      qualityStatus: "VALID",
      payload: { cycleId: CYCLE },
    });
    const entries = await appStore.listLedger();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/reports/finance-reconciliation/${CYCLE}/adjustment`,
      payload: {
        ledgerEntryId: entries[0]!.id,
        amount: "1",
        reasonCode: "RECONCILIATION_VARIANCE",
        explanation: "不该被允许：周期已一致",
        approvedBy: FINANCE,
        idempotencyKey: `adj-match-${Date.now()}`,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("RECONCILIATION_NO_VARIANCE");
  });

  it("VARIANCE + 基准运行 INCENTIVE 分录 → 201，ADJUSTMENT 入账 + 审计 + 差异上下文", async () => {
    const { app, appStore, platformStore } = setup();
    await seedVarianceCycle(appStore, platformStore);
    const incentiveBefore = (await appStore.listLedger()).filter(
      (entry) => entry.entryType === "INCENTIVE",
    );
    const target = incentiveBefore.find((entry) => entry.cycleId === CYCLE)!;
    const adjustmentsBefore = (await appStore.listLedger()).filter(
      (entry) => entry.entryType === "ADJUSTMENT",
    );
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/reports/finance-reconciliation/${CYCLE}/adjustment`,
      payload: {
        ledgerEntryId: target.id,
        amount: "50",
        reasonCode: "RECONCILIATION_VARIANCE",
        explanation: "财务申报比运行基准高 100，先调整该分录 50",
        approvedBy: FINANCE,
        idempotencyKey: `adj-ok-${Date.now()}`,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: {
        entry: { id: string; entryType: string; status: string; sourceEntryId: string | null };
        reconciliation: { status: string; deltaMicros: string };
      };
    };
    expect(body.data.entry.entryType).toBe("ADJUSTMENT");
    expect(body.data.entry.status).toBe("LOCKED");
    expect(body.data.entry.sourceEntryId).toBe(target.id);
    expect(body.data.reconciliation.status).toBe("VARIANCE");
    expect(body.data.reconciliation.deltaMicros).toBe("100000000");
    const adjustmentsAfter = (await appStore.listLedger()).filter(
      (entry) => entry.entryType === "ADJUSTMENT",
    );
    expect(adjustmentsAfter).toHaveLength(adjustmentsBefore.length + 1);
    const audits = await appStore.listAuditEvents();
    expect(
      audits.some(
        (event) =>
          event.action === "RECONCILIATION_ADJUSTMENT_POSTED" &&
          event.objectId === target.calculationRunId,
      ),
    ).toBe(true);
  });

  it("目标分录不属于基准运行 → 409 RECONCILIATION_SOURCE_MISMATCH", async () => {
    const { app, appStore, platformStore } = setup();
    await seedVarianceCycle(appStore, platformStore);
    // 第二个周期自己的运行与分录
    await appStore.createEvaluationCycle({
      name: "另一周期",
      cycleType: "MONTHLY",
      startsAt: "2026-11-01",
      endsAt: "2026-11-30",
      timezone: "Asia/Shanghai",
    });
    await seedLockedRun(appStore, CYCLE_B, "2000");
    const otherEntries = (await appStore.listLedger()).filter(
      (entry) => entry.cycleId === CYCLE_B,
    );
    expect(otherEntries.length).toBeGreaterThan(0);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/reports/finance-reconciliation/${CYCLE}/adjustment`,
      payload: {
        ledgerEntryId: otherEntries[0]!.id,
        amount: "10",
        reasonCode: "RECONCILIATION_VARIANCE",
        explanation: "跨运行分录必须被拒绝",
        approvedBy: FINANCE,
        idempotencyKey: `adj-mismatch-${Date.now()}`,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("RECONCILIATION_SOURCE_MISMATCH");
  });

  it("非 finance 角色 → 403", async () => {
    const { app, appStore, platformStore } = setup();
    await seedVarianceCycle(appStore, platformStore);
    const managerApp = buildApp(
      () => appStore,
      undefined,
      {
        async authenticate() {
          return {
            tenantId: TENANT,
            userId: "manager-1",
            roles: ["manager"],
            personId: MANAGER,
          };
        },
      },
      platformStore,
    );
    const entries = (await appStore.listLedger()).filter(
      (entry) => entry.cycleId === CYCLE,
    );
    const res = await managerApp.inject({
      method: "POST",
      url: `/api/v1/reports/finance-reconciliation/${CYCLE}/adjustment`,
      payload: {
        ledgerEntryId: entries[0]!.id,
        amount: "10",
        reasonCode: "RECONCILIATION_VARIANCE",
        explanation: "经理不允许直接调账",
        approvedBy: MANAGER,
        idempotencyKey: `adj-role-${Date.now()}`,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("幂等：同 idempotencyKey 重复提交 → 同一条调整分录，账本不重复入账", async () => {
    const { app, appStore, platformStore } = setup();
    await seedVarianceCycle(appStore, platformStore);
    const entries = (await appStore.listLedger()).filter(
      (entry) => entry.cycleId === CYCLE && entry.entryType === "INCENTIVE",
    );
    const key = `adj-idem-${Date.now()}`;
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/reports/finance-reconciliation/${CYCLE}/adjustment`,
      payload: {
        ledgerEntryId: entries[0]!.id,
        amount: "50",
        reasonCode: "RECONCILIATION_VARIANCE",
        explanation: "财务申报比运行基准高 100，先调整该分录 50",
        approvedBy: FINANCE,
        idempotencyKey: key,
      },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/reports/finance-reconciliation/${CYCLE}/adjustment`,
      payload: {
        ledgerEntryId: entries[0]!.id,
        amount: "50",
        reasonCode: "RECONCILIATION_VARIANCE",
        explanation: "财务申报比运行基准高 100，先调整该分录 50",
        approvedBy: FINANCE,
        idempotencyKey: key,
      },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.entry.id).toBe(first.json().data.entry.id);
    const ledger = await appStore.listLedger();
    expect(
      ledger.filter((entry) => entry.idempotencyKey === key),
    ).toHaveLength(1);
  });
});
