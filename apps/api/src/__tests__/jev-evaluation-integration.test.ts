/**
 * JEV × 评价流程集成（2026-11-27）。
 *
 * 覆盖四条不变量：
 * 1. score-from-facts 产生 FORMAL 结果时自动创建/关联 kind=PERFORMANCE 的
 *    JEV 案件（subject=评分记录 id），并写入一条 PERFORMANCE_SCORE 证据
 *    （contentHash = factsHash）；同一 recordId 重复关联幂等，只开一案一证；
 * 2. 评价决定必须通过 JEV：创建/关联案件端点幂等；没有 decision record 的
 *    评价决定不能进入最终批准（409 DECISION_CASE_REQUIRED）；
 * 3. JEV decide 成功后评价决定被推进为 JEV_DECIDED（record 是唯一凭据），
 *    第二次决定 409；
 * 4. 人工独立判断与 AI 建议严格分离：人工判断物化自真实提交，AI 只能写
 *    AI_MODEL 建议，AI 不能决定，人工判断者不能自决。
 *
 * 说明：评价决定本身（evaluation_decisions）是 append-only 的历史决定，
 * 没有状态写端口；因此「推进状态」以 JEV decision record 为唯一事实，并在
 * API 响应/查询里派生 decision.jev（PENDING_JEV → JEV_DECIDED）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import { DEMO_CYCLE_ID } from "../store-support.js";

const TENANT = "tenant-demo";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const REVIEWER = "00000000-0000-4000-8000-000000000003";
const DECIDER = "00000000-0000-4000-8000-000000000004";
const RUBRIC_VERSION_ID = "00000000-0000-4000-8000-0000000000aa";
const POLICY_VERSION_ID = "policy-jev-eval-2026-11";
/** 模型标识不要求 uuid：AI 判断不绑定人员身份。 */
const MODEL_ID = "vllm/qwen2.5-72b-instruct@2026-11";
const AI_TOKEN = `jev-eval-${"y".repeat(40)}`;
const AI_TOKEN_HEADER = "x-decision-ai-token";

const ALL_ROLES = ["admin", "manager", "finance"];

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let store: Store;
let platformStore: MemoryPlatformStore;
let actingPerson = ADMIN;
let actingRoles: string[] = [...ALL_ROLES];

function actAs(personId: string, roles: string[] = ALL_ROLES): void {
  actingPerson = personId;
  actingRoles = [...roles];
}

interface InjectResult {
  statusCode: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(): any;
}

async function call(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<InjectResult> {
  return (await app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
    headers,
  })) as unknown as InjectResult;
}

function errorCode(result: InjectResult): string {
  return result.json()?.error?.code;
}

/** 月度指标集：权重合计 100%（复用 018 权威评分口径）。 */
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

function measurementRecords(
  entries: Array<{ metricId: string; value: string }>,
) {
  return entries.map((entry) => ({
    metricId: entry.metricId,
    name: `指标 ${entry.metricId}`,
    value: entry.value,
    source: "CONNECTOR",
    sourceRef: `src-${entry.metricId}`,
    sourceSystem: "FEISHU",
    sourceRecordId: `rec-${entry.metricId}`,
    sourceVersion: "1",
    observedAt: "2026-11-01T00:00:00.000Z",
    qualityStatus: "VALID",
  }));
}

async function publishPolicy(): Promise<void> {
  await store.publishPolicy({
    policy: {
      code: `PERF-JEV-${POLICY_VERSION_ID}`,
      version: 1,
      currency: "CNY",
      poolRate: "10",
      poolCap: "1000000",
      rounding: "HALF_UP",
    },
    policyVersionId: POLICY_VERSION_ID,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    approvedBy: ADMIN,
    applicability: {
      legalEntity: "ANARI",
      jurisdictions: ["CN"],
      workLocations: ["SZ"],
      employeeCategories: ["FULL_TIME"],
      workTimeTypes: ["STANDARD"],
    },
  });
}

/** 锁定目标卡 + 冻结快照 + 正式评分，返回 score-from-facts 的 data。 */
async function scoreFormalPerformance(): Promise<Record<string, unknown>> {
  actAs(ADMIN);
  await publishPolicy();
  const card = await call("POST", "/api/v1/policy/performance/goal-cards", {
    personId: MEMBER,
    period: "MONTHLY",
    roleCode: "SALES",
    metrics: monthlyMetrics,
    cycleId: DEMO_CYCLE_ID,
  });
  expect(card.statusCode).toBe(201);
  const recordId = card.json().data.recordId as string;
  const locked = await call(
    "POST",
    `/api/v1/policy/performance/goal-cards/${recordId}/lock`,
    {},
  );
  expect(locked.statusCode).toBe(200);

  const snapshot = await call("POST", "/api/v1/metric-measurement-snapshots", {
    cycleId: DEMO_CYCLE_ID,
    personId: MEMBER,
    rubricVersionId: RUBRIC_VERSION_ID,
    measurements: measurementRecords([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]),
  });
  expect(snapshot.statusCode).toBe(201);

  const scored = await call(
    "POST",
    "/api/v1/policy/performance/score-from-facts",
    {
      cycleId: DEMO_CYCLE_ID,
      personId: MEMBER,
      policyVersionId: POLICY_VERSION_ID,
    },
  );
  expect(scored.statusCode).toBe(200);
  expect(scored.json().data.eligibility).toBe("FORMAL");
  return scored.json().data as Record<string, unknown>;
}

/** 通过真实评价流程产生一条 APPROVED 评价决定（reviewer=REVIEWER）。 */
async function decideEvaluation(): Promise<string> {
  actAs(ADMIN);
  const rubric = await call("POST", "/api/v1/rubrics", {
    code: "JEV_EVAL_RUBRIC",
    name: "JEV evaluation rubric",
    dimensions: ["QUALITY"],
    scoringAnchors: { 1: "below", 3: "meets", 5: "exceeds" },
    effectiveFrom: "2026-10-01",
  });
  expect(rubric.statusCode).toBe(201);
  const rubricId = rubric.json().data.id as string;

  const draft = await call("POST", "/api/v1/evaluation-drafts", {
    cycleId: DEMO_CYCLE_ID,
    personId: MEMBER,
    generatedByType: "USER",
    evidenceSnapshotHash: "evidence-jev-eval",
    draftPayload: { summary: "交付完整" },
  });
  expect(draft.statusCode).toBe(201);
  const draftId = draft.json().data.id as string;
  const submitted = await call(
    "POST",
    `/api/v1/evaluation-drafts/${draftId}/submit`,
  );
  expect(submitted.statusCode).toBe(200);

  // 复核人必须是会话身份（不可代他人签署评价决定）。
  actAs(REVIEWER);
  const decided = await call(
    "POST",
    `/api/v1/evaluation-drafts/${draftId}/decision`,
    {
      reviewerPersonId: REVIEWER,
      rubricVersionId: rubricId,
      decision: "APPROVE",
      scores: { QUALITY: 4 },
      independentScores: { QUALITY: 3 },
      independentRationale: "先看证据再下判断：交付质量达标",
      evidenceOpened: 2,
      rationale: "最终决定：维持 4 分",
    },
  );
  expect(decided.statusCode).toBe(200);
  const decisionId = decided.json().data.decision.id as string;
  expect(decisionId).toBeTruthy();
  actAs(ADMIN);
  return decisionId;
}

interface DecisionCaseShape {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  status: string;
  context: Record<string, unknown>;
}

interface CaseDetailShape {
  case: DecisionCaseShape;
  evidence: Array<{
    sourceType: string;
    sourceId: string;
    contentHash: string;
  }>;
  judgments: {
    human: Array<{
      id: string;
      actorId: string;
      independentScores: Record<string, unknown>;
    }>;
    ai: Array<{
      id: string;
      actorId: string;
      modelRef?: string;
      independentScores: Record<string, unknown>;
    }>;
  };
  record?: { id: string; decidedBy: string };
}

beforeEach(() => {
  process.env.DECISION_AI_TOKEN = AI_TOKEN;
  actAs(ADMIN);
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "JEV evaluation tenant",
      slug: "jev-evaluation",
      persons: [
        { id: ADMIN, employeeCode: "E001", displayName: "Admin" },
        { id: MEMBER, employeeCode: "E002", displayName: "Evaluatee" },
        { id: REVIEWER, employeeCode: "E003", displayName: "Reviewer" },
        { id: DECIDER, employeeCode: "E004", displayName: "Decider" },
      ],
    },
  });
  store = new Store();
  app = buildApp(
    store,
    undefined,
    {
      async authenticate() {
        return {
          tenantId: TENANT,
          userId: actingPerson,
          personId: actingPerson,
          roles: [...actingRoles],
        };
      },
    },
    platformStore,
  );
});

afterEach(() => {
  delete process.env.DECISION_AI_TOKEN;
});

describe("FORMAL performance score → JEV case", () => {
  it("auto-creates one PERFORMANCE case + PERFORMANCE_SCORE evidence, idempotently", async () => {
    const result = await scoreFormalPerformance();
    const recordId = result.recordId as string;
    const factsHash = result.factsHash as string;
    const decisionCaseId = result.decisionCaseId as string;
    expect(recordId).toBeTruthy();
    expect(factsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(decisionCaseId).toBeTruthy();

    const fetched = await call(
      "GET",
      `/api/v1/policy/performance/scores/${recordId}/decision-case`,
    );
    expect(fetched.statusCode).toBe(200);
    const detail = fetched.json().data as CaseDetailShape;
    expect(detail.case.id).toBe(decisionCaseId);
    expect(detail.case.kind).toBe("PERFORMANCE");
    expect(detail.case.subjectType).toBe("PERFORMANCE_SCORE");
    expect(detail.case.subjectId).toBe(recordId);
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0]).toMatchObject({
      sourceType: "PERFORMANCE_SCORE",
      sourceId: recordId,
      contentHash: factsHash,
    });

    // 幂等：同一 recordId 再次关联返回同一案件，不新增案件/证据。
    const again = await call(
      "POST",
      `/api/v1/policy/performance/scores/${recordId}/decision-case`,
      {},
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().data.created).toBe(false);
    expect(again.json().data.case.id).toBe(decisionCaseId);
    expect(again.json().data.evidence).toHaveLength(1);

    // 重复评分本身被一次性事实凭证挡住，不产生第二个案件。
    const replay = await call(
      "POST",
      "/api/v1/policy/performance/score-from-facts",
      {
        cycleId: DEMO_CYCLE_ID,
        personId: MEMBER,
        policyVersionId: POLICY_VERSION_ID,
      },
    );
    expect(replay.statusCode).toBe(409);
    expect(errorCode(replay)).toBe("SNAPSHOT_ALREADY_CONSUMED");

    const afterReplay = await call(
      "GET",
      `/api/v1/policy/performance/scores/${recordId}/decision-case`,
    );
    expect(afterReplay.json().data.case.id).toBe(decisionCaseId);
    expect(afterReplay.json().data.evidence).toHaveLength(1);
  });
});

describe("evaluation decision requires JEV", () => {
  it("blocks final approval with 409 DECISION_CASE_REQUIRED until a case exists", async () => {
    const decisionId = await decideEvaluation();

    const blocked = await call(
      "POST",
      `/api/v1/evaluation-decisions/${decisionId}/final-approval`,
    );
    expect(blocked.statusCode).toBe(409);
    expect(errorCode(blocked)).toBe("DECISION_CASE_REQUIRED");

    const empty = await call(
      "GET",
      `/api/v1/evaluation-decisions/${decisionId}/decision-case`,
    );
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data.case).toBeNull();
    expect(empty.json().data.decision.jev.decided).toBe(false);

    const created = await call(
      "POST",
      `/api/v1/evaluation-decisions/${decisionId}/decision-case`,
    );
    expect(created.statusCode).toBe(201);
    const caseId = created.json().data.case.id as string;
    expect(created.json().data.case.kind).toBe("PERFORMANCE");
    expect(created.json().data.case.subjectType).toBe("EVALUATION_DECISION");
    expect(created.json().data.case.subjectId).toBe(decisionId);
    // 两个独立来源类型：决定事实 + 先于 AI 建议的独立判断。
    expect(
      (created.json().data.evidence as Array<{ sourceType: string }>)
        .map((entry) => entry.sourceType)
        .sort(),
    ).toEqual(["EVALUATION_DECISION", "INDEPENDENT_JUDGMENT"]);
    // 独立判断物化为 HUMAN judgment（来自真实提交，不是代填）。
    expect(created.json().data.judgments.human).toHaveLength(1);
    expect(created.json().data.judgments.human[0].actorId).toBe(REVIEWER);
    expect(created.json().data.judgments.ai).toHaveLength(0);

    // 幂等：再次创建返回同一案件，不重复证据/判断。
    const again = await call(
      "POST",
      `/api/v1/evaluation-decisions/${decisionId}/decision-case`,
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().data.created).toBe(false);
    expect(again.json().data.case.id).toBe(caseId);
    expect(again.json().data.evidence).toHaveLength(2);
    expect(again.json().data.judgments.human).toHaveLength(1);

    // 有案件但还没有 decision record：仍然不能进入最终批准。
    const stillBlocked = await call(
      "POST",
      `/api/v1/evaluation-decisions/${decisionId}/final-approval`,
    );
    expect(stillBlocked.statusCode).toBe(409);
    expect(errorCode(stillBlocked)).toBe("DECISION_CASE_REQUIRED");
  });

  it("separates human judgment from AI advice and advances only through JEV decide", async () => {
    const decisionId = await decideEvaluation();
    const created = await call(
      "POST",
      `/api/v1/evaluation-decisions/${decisionId}/decision-case`,
    );
    expect(created.statusCode).toBe(201);
    const caseId = created.json().data.case.id as string;

    // AI 只作为建议：需要服务凭据（普通会话 403）。
    const forbiddenAi = await call(
      "POST",
      `/api/v1/decision-cases/${caseId}/judgments`,
      {
        actorType: "AI_MODEL",
        actorId: MODEL_ID,
        modelRef: MODEL_ID,
        independentRationale: "模型建议",
      },
    );
    expect(forbiddenAi.statusCode).toBe(403);

    const ai = await call(
      "POST",
      `/api/v1/decision-cases/${caseId}/judgments`,
      {
        actorType: "AI_MODEL",
        actorId: MODEL_ID,
        modelRef: MODEL_ID,
        independentScores: { QUALITY: 3.5 },
        independentRationale: "模型建议：证据覆盖基本完整",
        dimensionStates: { advisoryOnly: true },
      },
      { [AI_TOKEN_HEADER]: AI_TOKEN },
    );
    expect(ai.statusCode).toBe(201);

    // 服务端 5 个 checker：人工判断已物化、两来源覆盖、反证显式缺失、
    // decider 与人工判断者不同 → 校验通过。校验人必须是会话身份。
    actAs(DECIDER);
    const verified = await call(
      "POST",
      `/api/v1/decision-cases/${caseId}/verify`,
      { verifiedBy: DECIDER, decidedBy: DECIDER },
    );
    expect(verified.statusCode).toBe(201);
    actAs(ADMIN);

    const detail = await call(
      "GET",
      `/api/v1/evaluation-decisions/${decisionId}/decision-case`,
    );
    const judgments = detail.json().data.judgments as CaseDetailShape["judgments"];
    expect(judgments.human.map((entry) => entry.actorId)).toEqual([REVIEWER]);
    expect(judgments.ai.map((entry) => entry.actorId)).toEqual([MODEL_ID]);
    expect(judgments.ai[0]?.modelRef).toBe(MODEL_ID);
    // 人工判断保留独立得分，AI 建议不进入人工数组。
    expect(judgments.human[0]?.independentScores).toEqual({ QUALITY: 3 });

    // AI actor 不能决定。
    actAs(MODEL_ID, ["manager"]);
    const aiDecide = await call(
      "POST",
      `/api/v1/evaluation-decisions/${decisionId}/decision-case/decide`,
      { rationale: "AI 试图决定" },
    );
    expect(aiDecide.statusCode).toBe(409);
    expect(errorCode(aiDecide)).toBe("AI_MODEL_CANNOT_DECIDE");

    // 人工判断者不能自决。
    actAs(REVIEWER);
    const selfDecide = await call(
      "POST",
      `/api/v1/evaluation-decisions/${decisionId}/decision-case/decide`,
      { rationale: "自决" },
    );
    expect(selfDecide.statusCode).toBe(409);
    expect(errorCode(selfDecide)).toBe("SELF_DECISION_FORBIDDEN");

    // 授权人决定：评价决定推进为 JEV_DECIDED。
    actAs(DECIDER);
    const decided = await call(
      "POST",
      `/api/v1/evaluation-decisions/${decisionId}/decision-case/decide`,
      { rationale: "JEV 授权人最终决定" },
    );
    expect(decided.statusCode).toBe(200);
    const record = decided.json().data.record as { id: string; decidedBy: string };
    expect(record.decidedBy).toBe(DECIDER);
    expect(decided.json().data.case.status).toBe("DECIDED");
    expect(decided.json().data.decision.jev.decided).toBe(true);
    expect(decided.json().data.decision.jev.recordId).toBe(record.id);

    // record 不可改写：再次决定 409。
    const second = await call(
      "POST",
      `/api/v1/evaluation-decisions/${decisionId}/decision-case/decide`,
      { rationale: "重复决定" },
    );
    expect(second.statusCode).toBe(409);
    expect(errorCode(second)).toBe("DECISION_RECORD_IMMUTABLE");

    // 最终批准：record 存在才放行。
    const approved = await call(
      "POST",
      `/api/v1/evaluation-decisions/${decisionId}/final-approval`,
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.approved).toBe(true);
    expect(approved.json().data.decision.jev.decided).toBe(true);
    expect(approved.json().data.record.id).toBe(record.id);

    // 没有登记案件的评价决定：JEV decide 直接 409 DECISION_CASE_REQUIRED。
    const otherDecision = await decideEvaluation();
    const noCase = await call(
      "POST",
      `/api/v1/evaluation-decisions/${otherDecision}/decision-case/decide`,
      { rationale: "没有案件" },
    );
    expect(noCase.statusCode).toBe(409);
    expect(errorCode(noCase)).toBe("DECISION_CASE_REQUIRED");
  });
});
