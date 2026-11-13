/*
 * NPV2-014：核心 Repository 统一契约测试。
 *
 * 同一套契约在 MemoryStore 与 PgStore 上运行：工作包 / 证据与申报 /
 * 贡献确认 / 评价 / 计算 / 台账 / 申诉 / 审计 八个域的核心生命周期与不变量。
 * 契约跑在 store 层（不经 HTTP），用随机后缀隔离每次运行的造数。
 *
 * 已知实现差异（显式记录，不允许 silently differ）：
 * - Memory 为进程内实现，无 RLS；租户隔离与连接复用由 PgStore 专属测试
 *   覆盖（pg-store.test.ts），契约套件不重复断言。
 * - Memory 台账哈希链与 PG 共用 InMemoryLedger/PG 触发器实现，断言一致。
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, describe, it, afterAll } from "vitest";
import { Store, ConflictError } from "../store.js";
import type { IncentiveStore } from "../store-interface.js";
import { PgStore, DEMO_TENANT_ID, DEMO_REQUESTER_ID } from "../pg-store.js";
import { referencePolicy } from "../policy-registry.js";

/**
 * 契约套件专用租户与人员（NPV2-014 隔离）：与 pg-store.test 的演示
 * 租户/周期完全隔离，避免结算清扫把契约台账条目算进同一批次。
 * PG 侧在 beforeAll 间真实建租户/人员/周期；Memory 侧用同名常量
 * （Store 不做人员外键校验）。
 */
const CONTRACT_TENANT_ID = "00000000-0000-4000-8000-00000000c7a2";
const OWNER = "00000000-0000-4000-8000-00000000c801";
const MEMBER = "00000000-0000-4000-8000-00000000c802";
const ADJUDICATOR = "00000000-0000-4000-8000-00000000c803";
const DEMO_CYCLE_ID = "00000000-0000-4000-8000-000000000020";

const APPLICABILITY = {
  legalEntity: "N-Perform Contract Entity",
  jurisdictions: ["CN"],
  workLocations: ["Shanghai"],
  employeeCategories: ["FULL_TIME"],
  workTimeTypes: ["FULL_TIME"],
};

const databaseUrl = process.env.DATABASE_URL;
const describePg = databaseUrl ? describe : describe.skip;

interface ContractCtx {
  cycleId: string;
}

/** 八域共享契约：对任一 IncentiveStore 实现运行同一组断言。 */
function registerContractSuite(
  label: string,
  store: IncentiveStore,
  ctx: ContractCtx,
) {
  const suffix = randomUUID().slice(0, 8);
  const contractSubjectId = randomUUID();
  const appealTargetId = randomUUID();

  /** 发布一份契约专用政策并过法务门禁，返回 policyVersionId。 */
  async function publishedPolicyId(codePrefix: string): Promise<string> {
    const published = await store.publishPolicy({
      policy: { ...referencePolicy, code: `${codePrefix}_${suffix}` },
      effectiveFrom: "2026-10-01",
      approvedBy: ADJUDICATOR,
      applicability: APPLICABILITY,
    });
    const policyVersionId = published.policyVersionId;
    await store.recordLegalGate({
      policyVersionId,
      democraticProcedureRef: `dp-${suffix}`,
      employeeNoticeRef: `notice-${suffix}`,
      dataProtectionAssessmentRef: `dpia-${suffix}`,
      minimumWageChecked: true,
      policyApproved: true,
      recordedBy: ADJUDICATOR,
    });
    return policyVersionId;
  }

  /** 契约造数：接受态工作包。 */
  async function acceptedWorkPackage(title: string): Promise<string> {
    const wp = await store.createWorkPackage({
      title: `${title} ${suffix}`,
      objective: "Deliver a validated customer order",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "Order delivery",
        },
        {
          personId: MEMBER,
          responsibilityCode: "CONTRIBUTOR",
          expectedOutput: "Technical validation",
        },
      ],
      acceptanceCriteria: ["Customer accepts the delivery"],
    });
    await store.commitWorkPackage(wp.id, 1);
    await store.startWorkPackage(wp.id);
    await store.submitWorkPackage(wp.id);
    await store.acceptWorkPackage(wp.id, MEMBER);
    return wp.id;
  }

  /** 契约造数：已确认归属的申报。 */
  async function confirmedClaim(workPackageId: string, personId: string) {
    const claim = await store.createClaim({
      workPackageId,
      claimantPersonId: personId,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: {
        dimensions: ["QUALITY"],
        summary: "Delivered the agreed scope",
      },
      evidenceRefs: [`ev-${suffix}`],
      rationale: "Delivered the agreed scope",
    });
    await store.submitClaim(claim.id);
    const decision = await store.createAttributionDecision({
      claimId: claim.id,
      adjudicatorPersonId: ADJUDICATOR,
      status: "CONFIRMED",
      acceptedFacts: ["Delivered"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "Evidence supports the claim",
    });
    return { claimId: claim.id, decision };
  }

  /** 契约造数：完整计算运行（锁定后返回台账 INCENTIVE 分录）。 */
  async function lockedRun(workPackageId: string, policyVersionId: string, orderSuffix: string) {
    const run = await store.createCalculationRun({
      cycleId: ctx.cycleId,
      policyVersionId,
      mode: "FORMAL",
      order: {
        id: `order-${orderSuffix}-${suffix}`,
        grossProfit: "100000",
        currency: "CNY",
      },
      requestedBy: OWNER,
      participants: [
        {
          personId: OWNER,
          workPackageId,
          attributionWeight: "0.6",
          role: "OWNER",
        },
        {
          personId: MEMBER,
          workPackageId,
          attributionWeight: "0.4",
          role: "CONTRIBUTOR",
        },
      ],
    });
    await store.recordConfirmation({
      personId: OWNER,
      targetType: "CALCULATION",
      targetId: run.id,
      decision: "CONFIRMED",
    });
    await store.recordConfirmation({
      personId: MEMBER,
      targetType: "CALCULATION",
      targetId: run.id,
      decision: "CONFIRMED",
    });
    await store.approveRun(run.id);
    const locked = await store.lockRun(run.id, "LOCK_CALCULATION");
    return { run, locked };
  }

  it("工作包域：提交→承诺→启动→提交成果→验收；乐观锁拒绝过期承诺", async () => {
    const wp = await store.createWorkPackage({
      title: `contract-wp ${suffix}`,
      objective: "Contract objective",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "delivery",
        },
        {
          personId: MEMBER,
          responsibilityCode: "CONTRIBUTOR",
          expectedOutput: "review",
        },
      ],
      acceptanceCriteria: ["done"],
    });
    await store.commitWorkPackage(wp.id, 1);
    await store.startWorkPackage(wp.id);
    await store.submitWorkPackage(wp.id);
    const accepted = await store.acceptWorkPackage(wp.id, MEMBER);
    expect(accepted.status).toBe("ACCEPTED");
    await expect(store.commitWorkPackage(wp.id, 1)).rejects.toThrow(
      ConflictError,
    );
    const snapshots = await store.listWorkPackageVersions(wp.id);
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it("证据与申报域：证据登记与互链；申报提交后归属决定落库", async () => {
    const first = await store.createEvidence({
      sourceSystem: "CONTRACT_SUITE",
      subjectType: "WORK_PACKAGE",
      subjectId: contractSubjectId,
      evidenceType: "NOTE",
      normalizedPayload: { note: `contract evidence ${suffix}` },
      qualityStatus: "VALID",
    });
    const second = await store.createEvidence({
      sourceSystem: "CONTRACT_SUITE",
      subjectType: "WORK_PACKAGE",
      subjectId: contractSubjectId,
      evidenceType: "NOTE",
      normalizedPayload: { note: `supporting ${suffix}` },
      qualityStatus: "VALID",
    });
    const link = await store.linkEvidence(first.id, {
      toEvidenceId: second.id,
      relationType: "SUPPORTS",
      rationale: "contract link",
    });
    expect(link.toEvidenceId).toBe(second.id);
    const links = await store.listEvidenceLinks(first.id);
    expect(links.some((l) => l.id === link.id)).toBe(true);
    const listed = await store.listEvidence("WORK_PACKAGE", contractSubjectId);
    expect(listed.length).toBeGreaterThanOrEqual(2);

    const workPackageId = await acceptedWorkPackage(`ev-claim ${suffix}`);
    const { claimId, decision } = await confirmedClaim(workPackageId, OWNER);
    expect(decision.status).toBe("CONFIRMED");
    const decisions = await store.listDecisions(claimId);
    expect(decisions.some((d) => d.id === decision.id)).toBe(true);
  });

  it("贡献确认域：确认记录按人可查（CALCULATION 确认）", async () => {
    const policyVersionId = await publishedPolicyId("CONTRACT_CONFIRM");
    const workPackageId = await acceptedWorkPackage(`confirm ${suffix}`);
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    const { run } = await lockedRun(workPackageId, policyVersionId, "confirm");
    const confirmations = await store.listConfirmations(OWNER);
    expect(
      confirmations.some(
        (c) => c.targetId === run.id && c.decision === "CONFIRMED",
      ),
    ).toBe(true);
  });

  it("评价域：周期在位；量规→草案→提交→决定；自评拒绝", async () => {
    const cycle = await store.getEvaluationCycle(ctx.cycleId);
    expect(cycle.id).toBe(ctx.cycleId);

    const rubric = await store.createRubric({
      code: `CONTRACT_RUBRIC_${suffix}`,
      name: "Contract rubric",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-10-01",
    });
    const draft = await store.createEvaluationDraft({
      cycleId: ctx.cycleId,
      personId: OWNER,
      generatedByType: "USER",
      evidenceSnapshotHash: `contract-eval-${suffix}`,
      draftPayload: {},
    });
    await store.submitEvaluationDraft(draft.id);
    const result = await store.decideEvaluationDraft(draft.id, {
      reviewerPersonId: ADJUDICATOR,
      rubricVersionId: rubric.id,
      decision: "APPROVE",
      scores: { QUALITY: 4 },
      independentScores: { QUALITY: 4 },
      independentRationale: "Contract review",
      evidenceOpened: 1,
      rationale: "Reviewed",
    });
    expect(result.decision?.status).toBe("APPROVED");

    // 自评不变量：复核人不得评自己
    const selfDraft = await store.createEvaluationDraft({
      cycleId: ctx.cycleId,
      personId: OWNER,
      generatedByType: "USER",
      evidenceSnapshotHash: `contract-self-${suffix}`,
      draftPayload: {},
    });
    await store.submitEvaluationDraft(selfDraft.id);
    await expect(
      store.decideEvaluationDraft(selfDraft.id, {
        reviewerPersonId: OWNER,
        rubricVersionId: rubric.id,
        decision: "APPROVE",
        scores: { QUALITY: 5 },
        independentScores: { QUALITY: 5 },
        independentRationale: "self",
        evidenceOpened: 1,
        rationale: "self review",
      }),
    ).rejects.toThrow();
  });

  it("计算域：法务门禁→FORMAL 运行→确认→批准→锁定→台账 1e6 整数分录", async () => {
    const policyVersionId = await publishedPolicyId("CONTRACT_CALC");
    const workPackageId = await acceptedWorkPackage(`calc ${suffix}`);
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    const { run, locked } = await lockedRun(workPackageId, policyVersionId, "calc");
    const refetched = await store.getRun(run.id);
    expect(refetched.status).toBe("LOCKED");
    expect(locked.status).toBe("LOCKED");
    const entries = (await store.listLedger()).filter(
      (e) => e.calculationRunId === run.id && e.entryType === "INCENTIVE",
    );
    expect(entries.length).toBe(2);
    for (const entry of entries) {
      // 1e6 精度：金额为整数（bigint 字符串）
      expect(Number.isInteger(Number(entry.amount))).toBe(true);
    }
    expect(await store.verifyLedger()).toBe(true);
  });

  it("台账域：冲销幂等、链有效；调整落记录；冲销后余额保持", async () => {
    const policyVersionId = await publishedPolicyId("CONTRACT_LEDGER");
    const workPackageId = await acceptedWorkPackage(`ledger ${suffix}`);
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    const { run } = await lockedRun(workPackageId, policyVersionId, "ledger");

    const ownerEntry = (await store.listLedger()).find(
      (e) =>
        e.calculationRunId === run.id &&
        e.personId === OWNER &&
        e.entryType === "INCENTIVE",
    );
    expect(ownerEntry).toBeDefined();
    const before = Number(ownerEntry!.amount);

    const reversal = await store.reverseLedgerEntry(ownerEntry!.id, {
      idempotencyKey: `contract-reversal-${run.id}`,
      reason: "Order corrected",
      approvedBy: ADJUDICATOR,
    });
    expect(reversal.entryType).toBe("REVERSAL");
    expect(Number(reversal.amount)).toBe(-before);
    const replay = await store.reverseLedgerEntry(ownerEntry!.id, {
      idempotencyKey: `contract-reversal-${run.id}`,
      reason: "Order corrected",
      approvedBy: ADJUDICATOR,
    });
    expect(replay.id).toBe(reversal.id);
    expect(await store.verifyLedger()).toBe(true);

    const adjusted = await store.adjustLedgerEntry(ownerEntry!.id, {
      amount: "1000000",
      reasonCode: "CONTRACT_ADJUSTMENT",
      explanation: "contract adjust",
      approvedBy: ADJUDICATOR,
      idempotencyKey: `contract-adjust-${run.id}`,
      entryType: "ADJUSTMENT",
    });
    expect(adjusted.entry.entryType).toBe("ADJUSTMENT");
    const records = await store.listAdjustmentRecords();
    expect(records.some((r) => r.id === adjusted.record.id)).toBe(true);
    // 冲销 +X/-X 抵销，调整后 owner 净额 = 调整额
    const ownerEntries = (await store.listLedger()).filter(
      (e) =>
        e.personId === OWNER &&
        e.calculationRunId === run.id &&
        e.status === "LOCKED",
    );
    const total = ownerEntries.reduce((acc, e) => acc + Number(e.amount), 0);
    expect(total).toBe(1000000);
  });

  it("申诉域：创建→分派→复核→裁决（DECIDED）；自裁拒绝", async () => {
    const workPackageId = await acceptedWorkPackage(`appeal ${suffix}`);
    const appeal = await store.createAppeal({
      appellantPersonId: OWNER,
      targetType: "ATTRIBUTION",
      targetId: workPackageId,
      reasonCode: "CONTRACT_APPEAL",
      statement: "Attribution does not reflect the delivered scope",
    });
    const triaged = await store.triageAppeal(appeal.id, ADJUDICATOR);
    expect(triaged.status).toBe("TRIAGED");
    const reviewed = await store.reviewAppeal(appeal.id);
    expect(reviewed.status).toBe("UNDER_REVIEW");
    const resolved = await store.resolveAppeal(reviewed.id, {
      reviewerPersonId: ADJUDICATOR,
      resolution: "UPHOLD",
      rationale: "Original attribution stands",
    });
    expect(resolved.status).toBe("CLOSED");
    const fetched = await store.getAppeal(appeal.id);
    expect(fetched.id).toBe(appeal.id);

    // 自裁拒绝：申诉人不能裁决自己的申诉
    const own = await store.createAppeal({
      appellantPersonId: MEMBER,
      targetType: "EVALUATION",
      targetId: appealTargetId,
      reasonCode: "CONTRACT_APPEAL_SELF",
      statement: "self appeal",
    });
    await store.triageAppeal(own.id, ADJUDICATOR);
    await store.reviewAppeal(own.id);
    await expect(
      store.resolveAppeal(own.id, {
        reviewerPersonId: MEMBER,
        resolution: "UPHOLD",
        rationale: "self resolve",
      }),
    ).rejects.toThrow();
  });

  it("贡献事件域：批量录入幂等；ACTIVITY 活动量标记；更正链可查", async () => {
    const base = {
      subjectPersonId: OWNER,
      source: `contract-${suffix}`,
      action: "DELIVERED",
      targetType: "WORK_PACKAGE",
      targetId: `wp-${suffix}`,
      occurredAt: "2026-10-12T10:00:00.000Z",
      kind: "CONTRIBUTION" as const,
      outcome: { summary: "delivered scope" },
      evidenceRefs: [`ev-${suffix}`],
    };
    const first = await store.ingestContributionEvents([
      { ...base, externalId: `ext-1-${suffix}` },
    ]);
    const firstEvent = first.inserted[0]!;
    expect(first.inserted.length).toBe(1);
    // 幂等重放：同 (source, externalId) 命中既有事件，不重复入库
    const replay = await store.ingestContributionEvents([
      { ...base, externalId: `ext-1-${suffix}` },
    ]);
    expect(replay.inserted.length).toBe(0);
    expect(replay.duplicates[0]!.id).toBe(firstEvent.id);

    // ACTIVITY 事件承载活动量（metrics），不作贡献认定
    const activity = await store.ingestContributionEvents([
      {
        ...base,
        kind: "ACTIVITY",
        action: "PUSHED_COMMITS",
        externalId: `ext-2-${suffix}`,
        outcome: { summary: "10 commits", metrics: { commits: 10 } },
      },
    ]);
    expect(activity.inserted[0]!.kind).toBe("ACTIVITY");

    // 更正链：correction_of 指向原事件，原事件不删除
    const correction = await store.ingestContributionEvents([
      {
        ...base,
        action: "DELIVERED_CORRECTED",
        externalId: `ext-3-${suffix}`,
        correctionOfEventId: firstEvent.id,
        outcome: { summary: "corrected: 8 of 10 items" },
      },
    ]);
    expect(correction.inserted[0]!.correctionOfEventId).toBe(firstEvent.id);

    const list = await store.listContributionEvents({
      subjectPersonId: OWNER,
      source: `contract-${suffix}`,
    });
    expect(list.length).toBe(3);
    const fetched = await store.getContributionEvent(activity.inserted[0]!.id);
    expect(fetched.kind).toBe("ACTIVITY");
    expect(await store.verifyAuditChain()).toBe(true);
  });

  it("贡献认定草案域：断言必带证据；ACTIVITY 事件拒绝；人工决策门禁", async () => {
    const workPackageId = await acceptedWorkPackage(`assess ${suffix}`);
    const { claimId } = await confirmedClaim(workPackageId, OWNER);
    // 先落两笔真实事件（CONTRIBUTION + ACTIVITY）作草案依据素材
    const events = await store.ingestContributionEvents([
      {
        subjectPersonId: OWNER,
        source: `assess-${suffix}`,
        action: "DELIVERED",
        targetType: "WORK_PACKAGE",
        targetId: workPackageId,
        occurredAt: "2026-10-12T10:00:00.000Z",
        kind: "CONTRIBUTION",
        outcome: { summary: "delivered scope" },
        evidenceRefs: [`ev-${suffix}`],
        externalId: `a-1-${suffix}`,
      },
      {
        subjectPersonId: OWNER,
        source: `assess-${suffix}`,
        action: "PUSHED_COMMITS",
        targetType: "WORK_PACKAGE",
        targetId: workPackageId,
        occurredAt: "2026-10-12T11:00:00.000Z",
        kind: "ACTIVITY",
        outcome: { summary: "10 commits", metrics: { commits: 10 } },
        evidenceRefs: [`ev-${suffix}`],
        externalId: `a-2-${suffix}`,
      },
    ]);
    const contributionEventId = events.inserted[0]!.id;
    const activityEventId = events.inserted[1]!.id;

    // 断言缺证据引用 → 契约级拒绝
    await expect(
      store.createContributionAssessmentDraft({
        claimId,
        generatedByType: "USER",
        supporting: [
          { statement: "delivered", evidenceRefs: [], basis: "CLAIM" },
        ],
        counter: [],
        missingInformation: [],
        alternativeExplanations: [],
        uncertainty: { band: "MEDIUM", reasons: ["partial evidence"] },
        basedOnEventIds: [],
      }),
    ).rejects.toThrow();

    // 依据事件含 ACTIVITY → 存储层 409（NPV2-015 消费侧强制）
    await expect(
      store.createContributionAssessmentDraft({
        claimId,
        generatedByType: "USER",
        supporting: [
          {
            statement: "high throughput",
            evidenceRefs: [`ev-${suffix}`],
            basis: "EVENT",
            relatedEventId: activityEventId,
          },
        ],
        counter: [],
        missingInformation: [],
        alternativeExplanations: [],
        uncertainty: { band: "LOW", reasons: [] },
        basedOnEventIds: [activityEventId],
      }),
    ).rejects.toThrow("ACTIVITY_EVENT_NOT_USABLE_AS_CONTRIBUTION");

    // 正常草案：支持/反证/缺失/替代解释/定性不确定性
    const draft = await store.createContributionAssessmentDraft({
      claimId,
      generatedByType: "USER",
      supporting: [
        {
          statement: "scope delivered as agreed",
          evidenceRefs: [`ev-${suffix}`],
          basis: "EVENT",
          relatedEventId: contributionEventId,
        },
      ],
      counter: [
        {
          statement: "one item returned for rework",
          evidenceRefs: [`ev-${suffix}`],
          basis: "REVIEWER",
        },
      ],
      missingInformation: ["customer acceptance record missing"],
      alternativeExplanations: [
        {
          statement: "rework was caused by upstream spec change",
          evidenceRefs: [`ev-${suffix}`],
          basis: "REVIEWER",
        },
      ],
      uncertainty: { band: "MEDIUM", reasons: ["single-cycle sample"] },
      basedOnEventIds: [contributionEventId],
    });
    expect(draft.activityEventsExcluded).toBe(true);
    expect(draft.status).toBe("DRAFT");

    // 未经人工决策不能进入正式决定：DRAFT 直接链接被拒
    const decision = (await store.listDecisions(claimId)).find(
      (d) => d.id,
    )!;
    await expect(
      store.linkContributionAssessmentDecision(draft.id, {
        attributionDecisionId: decision.id,
        linkedBy: ADJUDICATOR,
      }),
    ).rejects.toThrow("ASSESSMENT_DRAFT_NOT_SUBMITTED");

    // 提交后链接人工决定 → DECIDED
    const submitted = await store.submitContributionAssessmentDraft(draft.id);
    expect(submitted.status).toBe("SUBMITTED");
    const decided = await store.linkContributionAssessmentDecision(
      submitted.id,
      { attributionDecisionId: decision.id, linkedBy: ADJUDICATOR },
    );
    expect(decided.status).toBe("DECIDED");
    expect(decided.attributionDecisionId).toBe(decision.id);

    // 决定与申报不匹配 → 拒绝
    const otherWp = await acceptedWorkPackage(`assess-2 ${suffix}`);
    const otherClaim = await confirmedClaim(otherWp, OWNER);
    const strayDraft = await store.createContributionAssessmentDraft({
      claimId: otherClaim.claimId,
      generatedByType: "USER",
      supporting: [
        {
          statement: "delivered",
          evidenceRefs: [`ev-${suffix}`],
          basis: "CLAIM",
        },
      ],
      counter: [],
      missingInformation: [],
      alternativeExplanations: [],
      uncertainty: { band: "LOW", reasons: [] },
      basedOnEventIds: [],
    });
    await store.submitContributionAssessmentDraft(strayDraft.id);
    await expect(
      store.linkContributionAssessmentDecision(strayDraft.id, {
        attributionDecisionId: decision.id,
        linkedBy: ADJUDICATOR,
      }),
    ).rejects.toThrow("ASSESSMENT_DECISION_CLAIM_MISMATCH");

    // 不存在的决定 → 404 语义（人工决定必须先存在）
    const freshDraft = await store.createContributionAssessmentDraft({
      claimId,
      generatedByType: "USER",
      supporting: [
        {
          statement: "delivered",
          evidenceRefs: [`ev-${suffix}`],
          basis: "CLAIM",
        },
      ],
      counter: [],
      missingInformation: [],
      alternativeExplanations: [],
      uncertainty: { band: "LOW", reasons: [] },
      basedOnEventIds: [],
    });
    await store.submitContributionAssessmentDraft(freshDraft.id);
    await expect(
      store.linkContributionAssessmentDecision(freshDraft.id, {
        attributionDecisionId: randomUUID(),
        linkedBy: ADJUDICATOR,
      }),
    ).rejects.toThrow("not found");
  });

  it("审计域：追加事件后哈希链可验证", async () => {
    await store.recordAuditEvent({
      actorType: "USER",
      actorId: OWNER,
      action: `CONTRACT_AUDIT_${suffix}`,
      objectType: "CONTRACT_SUITE",
      objectId: appealTargetId,
    });
    expect(await store.verifyAuditChain()).toBe(true);
  });
}

registerContractSuite(
  "MemoryStore 契约",
  new Store(DEMO_TENANT_ID),
  { cycleId: DEMO_CYCLE_ID },
);

describePg("PgStore 契约", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  // 契约租户 + 三名成员（租户上下文插入，RLS 合规），与演示租户隔离。
  const contractPersons: Array<[string, string]> = [
    [OWNER, "C001"],
    [MEMBER, "C002"],
    [ADJUDICATOR, "C003"],
    // PgStore.createCalculationRun 的 requested_by 固定为演示请求人（NPV2-003
    // 范畴的存量行为），契约租户必须补种该人员以满足外键。
    [DEMO_REQUESTER_ID, "C004"],
  ];
  const ctx: ContractCtx = { cycleId: DEMO_CYCLE_ID };
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO tenants (id, name, slug, default_currency)
       VALUES ($1, 'Contract Tenant', 'contract-suite', 'CNY')
       ON CONFLICT (id) DO NOTHING`,
      [CONTRACT_TENANT_ID],
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        CONTRACT_TENANT_ID,
      ]);
      for (const [id, code] of contractPersons) {
        await client.query(
          `INSERT INTO people (tenant_id, id, employee_code, display_name)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [CONTRACT_TENANT_ID, id, code, `Contract Person ${code}`],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const store = new PgStore(pool, CONTRACT_TENANT_ID);
    const cycle = await store.createEvaluationCycle({
      name: `Contract cycle ${randomUUID().slice(0, 8)}`,
      cycleType: "MONTHLY",
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-31T23:59:59.000Z",
      timezone: "Asia/Shanghai",
    });
    ctx.cycleId = cycle.id;
  });
  afterAll(async () => {
    await pool.end();
  });
  registerContractSuite(
    "PgStore 契约",
    new PgStore(pool, CONTRACT_TENANT_ID),
    ctx,
  );
});
