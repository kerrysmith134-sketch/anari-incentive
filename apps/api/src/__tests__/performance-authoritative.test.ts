/*
 * 权威绩效评分（018）：POST /api/v1/policy/performance/score-from-facts
 *
 * 不变量：
 * - 分值只能来自「已锁定目标卡（指标/权重/目标）」+「已通过 contentHash
 *   复核的冻结计量快照（metricId/value）」，缺任一项即 409
 *   PERFORMANCE_FACTS_NOT_READY，绝不退回客户端输入；
 * - 正式资格 eligibility：
 *   FORMAL = complete && scoreable && 指标全覆盖且逐项 quality=VALID &&
 *            制度版本已发布且与周期绑定一致；
 *   INCOMPLETE = 缺指标/质量非 VALID，补齐后可重算；
 *   BLOCKED = 制度版本缺失/未发布/不适用，分数仅作参考；
 * - 只有 FORMAL 才写 COMPUTED；任何成功保存的评分都会原子消费快照
 *   （consumedByRecordId），已消费快照再次评分 409 SNAPSHOT_ALREADY_CONSUMED；
 *   记录落库失败时消费回滚，快照恢复 FROZEN；
 * - 快照逐项必须带 sourceRef/sourceSystem/sourceRecordId/sourceVersion，
 *   缺失即 409 PERFORMANCE_SOURCE_TRACE_MISSING；
 * - 制度版本与周期绑定不一致 409 POLICY_VERSION_MISMATCH；
 * - 客户端 metricInputs 只能补充说明性字段，覆盖权威字段即 409
 *   PERFORMANCE_INPUT_OVERRIDES_FACTS；
 * - 旧 /score 保留兼容，但标记 source=CLIENT_INPUT、记录状态 INCOMPLETE，
 *   永远不写正式 COMPUTED。
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  MetricMeasurementSnapshot,
  PolicyVersionSummary,
} from "@anari/domain";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import { DEMO_CYCLE_ID } from "../store-support.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const RUBRIC_VERSION_ID = "00000000-0000-4000-8000-0000000000aa";
const POLICY_VERSION_ID = "policy-017-018-2026-11";
const OTHER_POLICY_VERSION_ID = "policy-017-018-2026-10";

let app: FastifyInstance;
let store: Store;
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

/** 月度指标集：权重合计 100%（017/018 A.1）。 */
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

type MeasurementInput = {
  metricId: string;
  value: string;
  qualityStatus?: "VALID" | "MISSING" | "STALE" | "CONFLICTED";
  /** null 表示刻意缺失，用于来源追溯失败用例。 */
  sourceRef?: string | null;
  sourceSystem?: string | null;
  sourceRecordId?: string | null;
  sourceVersion?: string | null;
};

function measurementRecords(entries: MeasurementInput[]) {
  return entries.map((entry) => {
    const sourceFields: Record<string, string> = {};
    const sourceRef =
      entry.sourceRef === null ? undefined : entry.sourceRef ?? `src-${entry.metricId}`;
    const sourceSystem =
      entry.sourceSystem === null
        ? undefined
        : entry.sourceSystem ?? "FEISHU";
    const sourceRecordId =
      entry.sourceRecordId === null
        ? undefined
        : entry.sourceRecordId ?? `rec-${entry.metricId}`;
    const sourceVersion =
      entry.sourceVersion === null
        ? undefined
        : entry.sourceVersion ?? "1";
    if (sourceRef) sourceFields.sourceRef = sourceRef;
    if (sourceSystem) sourceFields.sourceSystem = sourceSystem;
    if (sourceRecordId) sourceFields.sourceRecordId = sourceRecordId;
    if (sourceVersion) sourceFields.sourceVersion = sourceVersion;
    return {
      metricId: entry.metricId,
      name: `指标 ${entry.metricId}`,
      value: entry.value,
      source: "CONNECTOR",
      ...sourceFields,
      observedAt: "2026-11-01T00:00:00.000Z",
      qualityStatus: entry.qualityStatus ?? "VALID",
    };
  });
}

/** 发布一个可用的制度版本（默认覆盖 2026 全年）。 */
async function publishPolicy(options?: {
  policyVersionId?: string;
  effectiveFrom?: string;
}) {
  const policyVersionId = options?.policyVersionId ?? POLICY_VERSION_ID;
  await store.publishPolicy({
    policy: {
      code: `PERF-MONTHLY-${policyVersionId}`,
      version: 1,
      currency: "CNY",
      poolRate: "10",
      poolCap: "1000000",
      rounding: "HALF_UP",
    },
    policyVersionId,
    effectiveFrom: options?.effectiveFrom ?? "2026-01-01T00:00:00.000Z",
    approvedBy: OWNER,
    applicability: {
      legalEntity: "ANARI",
      jurisdictions: ["CN"],
      workLocations: ["SZ"],
      employeeCategories: ["FULL_TIME"],
      workTimeTypes: ["STANDARD"],
    },
  });
}

/** 把已发布版本改成未发布状态，模拟「政策未发布」。 */
function markPolicyUnpublished(policyVersionId: string) {
  const summaries = (
    store as unknown as {
      publishedPolicySummaries: Map<string, PolicyVersionSummary>;
    }
  ).publishedPolicySummaries;
  const summary = summaries.get(policyVersionId);
  expect(summary).toBeTruthy();
  summaries.set(policyVersionId, { ...summary!, status: "DRAFT" });
}

async function lockGoalCard(options?: { personId?: string; cycleId?: string }) {
  const created = await call("POST", "/api/v1/policy/performance/goal-cards", {
    personId: options?.personId ?? OWNER,
    period: "MONTHLY",
    roleCode: "SALES",
    metrics: monthlyMetrics,
    ...(options?.cycleId ? { cycleId: options.cycleId } : {}),
  });
  expect(created.status).toBe(201);
  const recordId = created.body.data.recordId;
  const locked = await call(
    "POST",
    `/api/v1/policy/performance/goal-cards/${recordId}/lock`,
    {},
  );
  expect(locked.status).toBe(200);
  return created.body.data as { id: string; recordId: string };
}

async function freezeSnapshot(
  entries: MeasurementInput[],
  options?: { personId?: string; cycleId?: string },
) {
  const created = await call("POST", "/api/v1/metric-measurement-snapshots", {
    cycleId: options?.cycleId ?? DEMO_CYCLE_ID,
    personId: options?.personId ?? OWNER,
    rubricVersionId: RUBRIC_VERSION_ID,
    measurements: measurementRecords(entries),
  });
  expect(created.status).toBe(201);
  return created.body.data as MetricMeasurementSnapshot;
}

function scoreFromFacts(extra?: Record<string, unknown>) {
  return call("POST", "/api/v1/policy/performance/score-from-facts", {
    cycleId: DEMO_CYCLE_ID,
    personId: OWNER,
    policyVersionId: POLICY_VERSION_ID,
    ...(extra ?? {}),
  });
}

async function listScoreRecords() {
  const records = await call(
    "GET",
    `/api/v1/policy/performance/scores?personId=${OWNER}`,
  );
  expect(records.status).toBe(200);
  return records.body.data as Array<{ id: string; status: string }>;
}

beforeEach(() => {
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: MEMBER, employeeCode: "E002", displayName: "Contributor" },
      ],
    },
  });
  store = new Store();
  app = buildApp(store, undefined, undefined, platformStore);
});

describe("performance scoring bound to locked facts", () => {
  it("fails closed with 409 PERFORMANCE_FACTS_NOT_READY when no goal card is locked", async () => {
    await publishPolicy();
    await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);
    const response = await scoreFromFacts();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PERFORMANCE_FACTS_NOT_READY");
    expect(response.body.error.message).toContain("目标卡");
  });

  it("fails closed with 409 PERFORMANCE_FACTS_NOT_READY when no verified snapshot exists", async () => {
    await publishPolicy();
    await lockGoalCard();
    const response = await scoreFromFacts();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PERFORMANCE_FACTS_NOT_READY");
    expect(response.body.error.message).toContain("快照");
  });

  it("certifies FORMAL only when facts are complete, VALID, traceable and the policy is published", async () => {
    await publishPolicy();
    const card = await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    const snapshot = await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);

    const response = await scoreFromFacts();
    expect(response.status).toBe(200);
    const result = response.body.data;
    expect(result.source).toBe("LOCKED_FACTS");
    expect(result.eligibility).toBe("FORMAL");
    expect(result.blockers).toEqual([]);
    expect(result.finalScore).toBe("84.95");
    expect(result.kp).toBe("0.8495");
    expect(result.factsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.facts.goalCardId).toBe(card.id);
    expect(result.facts.goalCardVersion).toBe(2);
    expect(result.facts.snapshotId).toBe(snapshot.id);
    expect(result.facts.snapshotContentHash).toBe(snapshot.contentHash);
    expect(result.facts.snapshotStatus).toBe("FROZEN");
    expect(result.facts.policyVersionId).toBe(POLICY_VERSION_ID);
    expect(result.facts.policyVersionStatus).toBe("PUBLISHED");
    expect(result.facts.policyBound).toBe(true);
    expect(result.policyVersion.policyBound).toBe(true);
    expect(result.coverage).toEqual({ complete: true, missingMetricIds: [] });
    expect(result.warnings).toEqual([]);
    expect(result.recordId).toBeTruthy();
    // 正式评分写 COMPUTED，且快照被该记录消费。
    expect(result.snapshot.status).toBe("CONSUMED");
    expect(result.snapshot.consumedByRecordId).toBe(result.recordId);

    const storedSnapshot = await call(
      "GET",
      `/api/v1/metric-measurement-snapshots/${snapshot.id}`,
    );
    expect(storedSnapshot.body.data.status).toBe("CONSUMED");
    expect(storedSnapshot.body.data.consumedByRecordId).toBe(result.recordId);

    const records = await listScoreRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe("COMPUTED");

    // 已消费快照不能再次评分（不产生第二条正式记录）。
    const replay = await scoreFromFacts();
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe("SNAPSHOT_ALREADY_CONSUMED");
    expect(await listScoreRecords()).toHaveLength(1);

    // 锁定后周期绑定仍在：score-from-facts 可以精确命中该 cycle 的锁定卡。
    const cards = await call(
      "GET",
      `/api/v1/policy/performance/goal-cards?personId=${OWNER}&status=LOCKED`,
    );
    expect(cards.status).toBe(200);
    expect(cards.body.data[0].payload.cycleId).toBe(DEMO_CYCLE_ID);
    expect(cards.body.data[0].payload.status).toBe("LOCKED");

    // 快照值按评分函数落到权威字段：M-001 rawValue、M-003 eventAdjustment。
    const byMetric = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result.components as any[]).map((row) => [row.metricId, row]),
    );
    expect(byMetric.get("M-001")).toMatchObject({
      applicable: true,
      rawValue: "80",
      score: "80",
    });
    expect(byMetric.get("M-003")).toMatchObject({ applicable: true, score: "103" });
  });

  it("matches FORMAL against the policy version bound on the cycle", async () => {
    await publishPolicy();
    const cycle = await store.createEvaluationCycle({
      name: "2026-10 bound cycle",
      cycleType: "MONTHLY",
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-31T23:59:59.000Z",
      timezone: "Asia/Shanghai",
      policyVersionId: POLICY_VERSION_ID,
      rubricVersionId: RUBRIC_VERSION_ID,
    });
    await lockGoalCard({ cycleId: cycle.id });
    await freezeSnapshot(
      [
        { metricId: "M-001", value: "80" },
        { metricId: "M-002", value: "90" },
        { metricId: "M-003", value: "3" },
      ],
      { cycleId: cycle.id },
    );
    const response = await scoreFromFacts({ cycleId: cycle.id });
    expect(response.status).toBe(200);
    expect(response.body.data.eligibility).toBe("FORMAL");
    expect(response.body.data.facts.cyclePolicyVersionId).toBe(
      POLICY_VERSION_ID,
    );
    expect(response.body.data.facts.policyBindingSource).toBe("CYCLE");
  });

  it("reports INCOMPLETE when a card metric is missing and consumes the used snapshot", async () => {
    await publishPolicy();
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    const snapshot = await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
    ]);
    const response = await scoreFromFacts();
    expect(response.status).toBe(200);
    const result = response.body.data;
    expect(result.eligibility).toBe("INCOMPLETE");
    expect(result.finalScore).toBe("81.76");
    expect(result.scoreable).toBe(false);
    expect(result.coverage).toEqual({
      complete: false,
      missingMetricIds: ["M-003"],
    });
    expect(result.warnings).not.toEqual([]);
    // 评分成功即消费事实：非正式结果也要留痕，不能复用同一快照。
    expect(result.snapshot.status).toBe("CONSUMED");
    expect(result.snapshot.consumedByRecordId).toBe(result.recordId);

    const records = await listScoreRecords();
    expect(records[0]!.status).toBe("INCOMPLETE");

    const replay = await scoreFromFacts();
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe("SNAPSHOT_ALREADY_CONSUMED");
    const storedSnapshot = await call(
      "GET",
      `/api/v1/metric-measurement-snapshots/${snapshot.id}`,
    );
    expect(storedSnapshot.body.data.status).toBe("CONSUMED");
  });

  it("reports INCOMPLETE when a snapshot measurement is not VALID", async () => {
    await publishPolicy();
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "999", qualityStatus: "STALE" },
      { metricId: "M-003", value: "3" },
    ]);
    const response = await scoreFromFacts();
    expect(response.status).toBe(200);
    expect(response.body.data.eligibility).toBe("INCOMPLETE");
    // 过期的 999 不得参与评分：M-002 记 N/A，其余按 70:15 同比例归一。
    expect(response.body.data.finalScore).toBe("84.06");
    expect(response.body.data.naMetricIds).toEqual(["M-002"]);
    expect(response.body.data.renormalized).toBe(true);
    expect(await listScoreRecords()).toMatchObject([
      { status: "INCOMPLETE" },
    ]);
  });

  it("reports BLOCKED when the policy version is not published, and never writes COMPUTED", async () => {
    await publishPolicy();
    markPolicyUnpublished(POLICY_VERSION_ID);
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    const snapshot = await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);
    const response = await scoreFromFacts();
    expect(response.status).toBe(200);
    const result = response.body.data;
    expect(result.eligibility).toBe("BLOCKED");
    expect(result.facts.policyBound).toBe(false);
    expect(result.blockers[0]).toContain("未发布");
    expect(result.warnings.join(" ")).toContain("不得作为正式评价依据");
    // 参考分留痕为 BLOCKED，绝不写 COMPUTED；事实同样一次性消费。
    expect(result.snapshot.status).toBe("CONSUMED");
    expect(await listScoreRecords()).toMatchObject([{ status: "BLOCKED" }]);
    const storedSnapshot = await call(
      "GET",
      `/api/v1/metric-measurement-snapshots/${snapshot.id}`,
    );
    expect(storedSnapshot.body.data.status).toBe("CONSUMED");
  });

  it("rejects a policy version that conflicts with the cycle binding with 409", async () => {
    await publishPolicy();
    const cycle = await store.createEvaluationCycle({
      name: "2026-10 other-policy cycle",
      cycleType: "MONTHLY",
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-31T23:59:59.000Z",
      timezone: "Asia/Shanghai",
      policyVersionId: OTHER_POLICY_VERSION_ID,
      rubricVersionId: RUBRIC_VERSION_ID,
    });
    await lockGoalCard({ cycleId: cycle.id });
    await freezeSnapshot(
      [
        { metricId: "M-001", value: "80" },
        { metricId: "M-002", value: "90" },
        { metricId: "M-003", value: "3" },
      ],
      { cycleId: cycle.id },
    );
    const response = await scoreFromFacts({ cycleId: cycle.id });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("POLICY_VERSION_MISMATCH");
    expect(await listScoreRecords()).toHaveLength(0);
  });

  it("rejects snapshots without per-measurement source traceability with 409", async () => {
    await publishPolicy();
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    await freezeSnapshot([
      { metricId: "M-001", value: "80", sourceRecordId: null },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);
    const response = await scoreFromFacts();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PERFORMANCE_SOURCE_TRACE_MISSING");
    expect(response.body.error.message).toContain("sourceRecordId");
    expect(await listScoreRecords()).toHaveLength(0);
  });

  it("rolls the snapshot consumption back when the score record cannot be persisted", async () => {
    await publishPolicy();
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    const snapshot = await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);

    const originalUpdate = platformStore.updatePolicyEngineRecord.bind(platformStore);
    let attempts = 0;
    platformStore.updatePolicyEngineRecord = async (input) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("simulated record persistence failure");
      }
      return originalUpdate(input);
    };

    const failed = await scoreFromFacts();
    expect(failed.status).toBe(500);
    const afterFailure = await call(
      "GET",
      `/api/v1/metric-measurement-snapshots/${snapshot.id}`,
    );
    expect(afterFailure.body.data.status).toBe("FROZEN");
    expect(afterFailure.body.data.consumedByRecordId).toBeUndefined();
    // 只有非正式草稿留痕，绝不出现 COMPUTED。
    const failedRecords = await listScoreRecords();
    expect(failedRecords.some((row) => row.status === "COMPUTED")).toBe(false);
    expect(failedRecords.every((row) => row.status === "BLOCKED")).toBe(true);

    // 回滚后同一快照仍可正式评分（记录最终落库成功时消费才生效）。
    const retried = await scoreFromFacts();
    expect(retried.status).toBe(200);
    expect(retried.body.data.eligibility).toBe("FORMAL");
    const afterRetry = await call(
      "GET",
      `/api/v1/metric-measurement-snapshots/${snapshot.id}`,
    );
    expect(afterRetry.body.data.status).toBe("CONSUMED");
    expect(afterRetry.body.data.consumedByRecordId).toBe(
      retried.body.data.recordId,
    );
    const retriedRecords = await listScoreRecords();
    expect(retriedRecords[0]!.status).toBe("COMPUTED");
  });

  it("does not consume the snapshot when the initial score record cannot be saved", async () => {
    await publishPolicy();
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    const snapshot = await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);

    const originalSave = platformStore.savePolicyEngineRecord.bind(platformStore);
    platformStore.savePolicyEngineRecord = async () => {
      throw new Error("simulated initial record persistence failure");
    };

    const failed = await scoreFromFacts();
    expect(failed.status).toBe(500);
    const afterFailure = await call(
      "GET",
      `/api/v1/metric-measurement-snapshots/${snapshot.id}`,
    );
    expect(afterFailure.body.data.status).toBe("FROZEN");
    expect(await listScoreRecords()).toHaveLength(0);

    platformStore.savePolicyEngineRecord = originalSave;
    const retried = await scoreFromFacts();
    expect(retried.status).toBe(200);
    expect(retried.body.data.eligibility).toBe("FORMAL");
    const afterRetry = await call(
      "GET",
      `/api/v1/metric-measurement-snapshots/${snapshot.id}`,
    );
    expect(afterRetry.body.data.status).toBe("CONSUMED");
    expect(afterRetry.body.data.consumedByRecordId).toBe(
      retried.body.data.recordId,
    );
  });

  it("rejects client inputs that try to override authoritative facts with 409", async () => {
    await publishPolicy();
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);

    for (const overrides of [
      { metricId: "M-001", rawValue: "100" },
      { metricId: "M-001", value: "100" },
      { metricId: "M-002", applicable: false },
      { metricId: "M-003", eventAdjustment: "50" },
    ]) {
      const response = await scoreFromFacts({ metricInputs: [overrides] });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("PERFORMANCE_INPUT_OVERRIDES_FACTS");
    }

    // 快照里没有的指标同样不能由客户端补齐。
    const fabricated = await scoreFromFacts({
      metricInputs: [{ metricId: "M-999", sampleSize: 1 }],
    });
    expect(fabricated.status).toBe(409);
    expect(fabricated.body.error.code).toBe("PERFORMANCE_INPUT_OVERRIDES_FACTS");
    expect(await listScoreRecords()).toHaveLength(0);
  });

  it("accepts non-authoritative supplements without moving the score", async () => {
    await publishPolicy();
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);

    const first = await scoreFromFacts();
    expect(first.status).toBe(200);
    expect(first.body.data.eligibility).toBe("FORMAL");

    // 快照一次性消费后，补数据需重新冻结；补充字段不得改变分值。
    await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);
    const supplemented = await scoreFromFacts({
      metricInputs: [
        {
          metricId: "M-001",
          sampleSize: 12,
          evidenceRefs: ["evidence-42"],
        },
      ],
    });
    expect(supplemented.status).toBe(200);
    expect(supplemented.body.data.finalScore).toBe(first.body.data.finalScore);
    expect(supplemented.body.data.factsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(supplemented.body.data.factsHash).not.toBe(first.body.data.factsHash);
    // 补充字段进入记录，但不参与取值。
    const records = await call(
      "GET",
      `/api/v1/policy/performance/scores?personId=${OWNER}`,
    );
    expect(records.body.data[0].payload.request.metricInputs).toEqual([
      {
        metricId: "M-001",
        sampleSize: 12,
        evidenceRefs: ["evidence-42"],
      },
    ]);
  });

  it("refuses a snapshot whose contentHash no longer verifies", async () => {
    await publishPolicy();
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    const snapshot = await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);
    const stored = (
      store as unknown as {
        metricSnapshots: Map<string, MetricMeasurementSnapshot>;
      }
    ).metricSnapshots.get(snapshot.id);
    expect(stored).toBeTruthy();
    stored!.measurements[0]!.value = "999";

    const response = await scoreFromFacts();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PERFORMANCE_FACTS_NOT_READY");
    expect(response.body.error.message).toContain("contentHash");
    expect(await listScoreRecords()).toHaveLength(0);
  });

  it("refuses to score when more than one frozen snapshot makes the facts ambiguous", async () => {
    await publishPolicy();
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);
    await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);
    const response = await scoreFromFacts();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PERFORMANCE_FACTS_AMBIGUOUS");
    expect(await listScoreRecords()).toHaveLength(0);
  });

  it("keeps legacy /score working but marks it CLIENT_INPUT with a warning and never COMPUTED", async () => {
    const legacy = await call("POST", "/api/v1/policy/performance/score", {
      personId: OWNER,
      period: "MONTHLY",
      metrics: monthlyMetrics,
      measurements: [
        { metricId: "M-001", rawValue: "80", applicable: true },
        { metricId: "M-002", rawValue: "90", applicable: true },
        { metricId: "M-003", applicable: true, eventAdjustment: "3" },
      ],
    });
    expect(legacy.status).toBe(200);
    expect(legacy.body.data.source).toBe("CLIENT_INPUT");
    expect(legacy.body.data.factsHash).toBeUndefined();
    expect(legacy.body.data.warnings).toHaveLength(1);
    expect(legacy.body.data.warnings[0]).toContain("不得作为正式评价依据");
    const records = await listScoreRecords();
    expect(records[0]!.status).toBe("INCOMPLETE");
    // 分值仍与旧行为一致（兼容）。
    expect(legacy.body.data.finalScore).toBe("84.95");
  });
});
