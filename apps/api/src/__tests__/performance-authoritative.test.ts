/*
 * 权威绩效评分（018）：POST /api/v1/policy/performance/score-from-facts
 *
 * 不变量：
 * - 分值只能来自「已锁定目标卡（指标/权重/目标）」+「已通过 contentHash
 *   复核的冻结计量快照（metricId/value）」，缺任一项即 409
 *   PERFORMANCE_FACTS_NOT_READY，绝不退回客户端输入；
 * - 客户端 metricInputs 只能补充说明性字段，覆盖权威字段（rawValue/value/
 *   applicable/...）或补齐快照里没有的测量即 409
 *   PERFORMANCE_INPUT_OVERRIDES_FACTS；
 * - 响应带 source=LOCKED_FACTS 与 factsHash（锁定卡 + 快照 id/version/hash
 *   的稳定 sha256），同输入重放哈希一致；
 * - 旧 /score 保留兼容，但标记 source=CLIENT_INPUT 并给出告警。
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MetricMeasurementSnapshot } from "@anari/domain";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import { DEMO_CYCLE_ID } from "../store-support.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const RUBRIC_VERSION_ID = "00000000-0000-4000-8000-0000000000aa";
const POLICY_VERSION_ID = "policy-017-018-2026-11";

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
};

function measurementRecords(entries: MeasurementInput[]) {
  return entries.map((entry) => ({
    metricId: entry.metricId,
    name: `指标 ${entry.metricId}`,
    value: entry.value,
    source: "CONNECTOR",
    sourceRef: `src-${entry.metricId}`,
    observedAt: "2026-11-01T00:00:00.000Z",
    qualityStatus: entry.qualityStatus ?? "VALID",
  }));
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
  options?: { personId?: string },
) {
  const created = await call("POST", "/api/v1/metric-measurement-snapshots", {
    cycleId: DEMO_CYCLE_ID,
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
    await lockGoalCard();
    const response = await scoreFromFacts();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PERFORMANCE_FACTS_NOT_READY");
    expect(response.body.error.message).toContain("快照");
  });

  it("scores from the locked card + frozen snapshot and reports LOCKED_FACTS with a facts hash", async () => {
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
    expect(result.finalScore).toBe("84.95");
    expect(result.kp).toBe("0.8495");
    expect(result.factsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.facts.goalCardId).toBe(card.id);
    expect(result.facts.goalCardVersion).toBe(2);
    expect(result.facts.snapshotId).toBe(snapshot.id);
    expect(result.facts.snapshotContentHash).toBe(snapshot.contentHash);
    expect(result.facts.policyVersionId).toBe(POLICY_VERSION_ID);
    expect(result.coverage).toEqual({ complete: true, missingMetricIds: [] });
    expect(result.warnings).toEqual([]);
    expect(result.recordId).toBeTruthy();

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

  it("ignores snapshot values whose quality status is not VALID", async () => {
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "999", qualityStatus: "STALE" },
      { metricId: "M-003", value: "3" },
    ]);
    const response = await scoreFromFacts();
    expect(response.status).toBe(200);
    // 过期的 999 不得参与评分：M-002 记 N/A，其余按 70:15 同比例归一。
    expect(response.body.data.finalScore).toBe("84.06");
    expect(response.body.data.naMetricIds).toEqual(["M-002"]);
    expect(response.body.data.renormalized).toBe(true);
  });

  it("rejects client inputs that try to override authoritative facts with 409", async () => {
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
  });

  it("accepts non-authoritative supplements without moving the score and hashes replay identically", async () => {
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
      { metricId: "M-003", value: "3" },
    ]);

    const first = await scoreFromFacts();
    const replay = await scoreFromFacts();
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body.data.factsHash).toBe(first.body.data.factsHash);

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
    // 补充字段进入绑定，哈希随之变化（同输入仍然稳定重放）。
    expect(supplemented.body.data.factsHash).not.toBe(first.body.data.factsHash);
    const supplementedReplay = await scoreFromFacts({
      metricInputs: [
        {
          metricId: "M-001",
          sampleSize: 12,
          evidenceRefs: ["evidence-42"],
        },
      ],
    });
    expect(supplementedReplay.body.data.factsHash).toBe(
      supplemented.body.data.factsHash,
    );
  });

  it("refuses a snapshot whose contentHash no longer verifies", async () => {
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
  });

  it("downgrades to non-scoreable when the snapshot misses a card metric", async () => {
    await lockGoalCard({ cycleId: DEMO_CYCLE_ID });
    await freezeSnapshot([
      { metricId: "M-001", value: "80" },
      { metricId: "M-002", value: "90" },
    ]);
    const response = await scoreFromFacts();
    expect(response.status).toBe(200);
    expect(response.body.data.finalScore).toBe("81.76");
    expect(response.body.data.scoreable).toBe(false);
    expect(response.body.data.coverage).toEqual({
      complete: false,
      missingMetricIds: ["M-003"],
    });
    expect(response.body.data.warnings).not.toEqual([]);
  });

  it("keeps legacy /score working but marks it CLIENT_INPUT with a warning", async () => {
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
    // 分值仍与旧行为一致（兼容）。
    expect(legacy.body.data.finalScore).toBe("84.95");
  });
});
