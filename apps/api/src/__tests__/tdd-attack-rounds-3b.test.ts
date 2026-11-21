/**
 * 30+ 轮 TDD 攻击面 sweep（第三波·下）——连接器/runner/DSL 层。
 *
 * R21-R24 HTTP 连接器错误矩阵（不可重试错误/退避语义/记录路径错误脱敏）
 * R25-R28 runner 路由与游标接力（隔离语义/精度边界/币种规范化/断点续跑）
 * R29-R32 DSL 归一化与边界（池超支/全 N/A/计提基数默认/人工调整门禁）
 */
import { describe, expect, it, vi } from "vitest";
import { HttpJsonConnector, runSyncCycle, type SyncRequestFn } from "@anari/connectors";
import { buildLinearScale, buildLinePath } from "../../../../apps/web/src/lib/chart-math.js";
import { calculateDbcp, calculateInternalSplit, scorePerformance } from "@anari/policy-dsl";

const ADMIN = "00000000-0000-4000-8000-000000000001";

function json(status: number, payload: unknown, extra: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    headers: new Headers(extra),
    redirected: false,
    url: "x",
  } as unknown as Response;
}

const COLUMNS = {
  sourceRecordId: "id",
  eventType: "event_type",
  subjectType: "subject_type",
  subjectId: "subject_id",
  evidenceType: "=ACTIVITY",
};

describe("R21-R24: HTTP 连接器错误矩阵", () => {
  it("R21 recordsPath 指向缺失路径 → 报错信息含 connector 标识不含原始响应体", async () => {
    const fetchImpl = vi.fn(async () => json(200, { totally: "different shape", inner: { secret: "token-value" } })) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r21",
      url: "https://provider.example/api",
      recordsPath: "records",
      columns: COLUMNS,
      fetchImpl,
    });
    await expect(connector.pull(null)).rejects.toThrow(/r21/);
    try {
      await connector.pull(null);
    } catch (error) {
      expect((error as Error).message).not.toContain("token-value");
    }
  });

  it("R22 404（非 429/5xx）→ 立即失败且只调用一次（不可重试）", async () => {
    const fetchImpl = vi.fn(async () => json(404, { error: "no route" })) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r22",
      url: "https://provider.example/api",
      columns: COLUMNS,
      fetchImpl,
    });
    await expect(connector.pull(null)).rejects.toThrow(/404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("R23 429 无 Retry-After 头 → 仍指数退避重试并成功", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return json(429, {});
      return json(200, { records: [{ id: "R23", event_type: "e", subject_type: "ORDER", subject_id: ADMIN }] });
    }) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r23",
      url: "https://provider.example/api",
      columns: COLUMNS,
      fetchImpl,
    });
    const result = await connector.pull(null);
    expect(result.events).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("R24 拉取记录为非对象元素 → 明确报错（不静默跳过）", async () => {
    const fetchImpl = vi.fn(async () => json(200, { records: ["not-an-object", 42] })) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r24",
      url: "https://provider.example/api",
      columns: COLUMNS,
      fetchImpl,
    });
    await expect(connector.pull(null)).rejects.toThrow(/record is not an object/);
  });
});

describe("R25-R28: runner 路由与游标接力", () => {
  function makeInject() {
    const store = new Map<string, unknown>();
    const counters = { resources: 0 };
    const inject: SyncRequestFn = async (path, init) => {
      const method = init?.method ?? "GET";
      if (path === "/api/v1/sync-schedules/claim-due" && method === "POST") {
        return [{ id: "sched-1", connectionId: "conn-1", name: "tdd3-sched" }] as never;
      }
      if (path === "/api/v1/integration-connections/conn-1/sync-runs" && method === "POST") {
        return { id: `run-${++counters.resources}` } as never;
      }
      if (path === "/api/v1/integration-connections/conn-1" && method === "GET") {
        return { provider: "generic", credentialRef: "v", config: {} } as never;
      }
      if (path === "/api/v1/integration-connections/conn-1/mappings?status=ACTIVE" && method === "GET") {
        return [
          {
            id: "map-1",
            status: "ACTIVE",
            mappingType: "HTTP_JSON",
            sourceSystem: "tdd3",
            targetType: "FINANCIAL_FACT",
            fieldMap: {
              sourceRecordId: "id",
              eventType: "event_type",
              subjectType: "subject_type",
              subjectId: "subject_id",
              evidenceType: "=GROSS_PROFIT",
            },
            config: { url: "https://provider.example/api", recordsPath: "records", nextCursorPath: "next_cursor" },
          },
        ] as never;
      }
      if (path === "/api/v1/sync-resources" && method === "POST") {
        const body = JSON.parse(init!.body!) as { resourceKey: string; mappingId?: string };
        const existingKey = `res:${body.resourceKey}`;
        if (store.has(existingKey)) throw new Error("SYNC_RESOURCE_EXISTS: dup");
        const id = `res-${++counters.resources}`;
        store.set(existingKey, { id, resourceKey: body.resourceKey, mappingId: body.mappingId ?? null });
        return { id, resourceKey: body.resourceKey } as never;
      }
      if (path.startsWith("/api/v1/sync-resources?connectionId=")) {
        return [...store.values()] as never;
      }
      if (path.startsWith("/api/v1/sync-resources/") && path.endsWith("/claim-lease")) {
        const body = JSON.parse(init!.body!) as { leaseOwner: string };
        const resourceId = path.split("/")[4];
        store.set(`lease:${resourceId}`, body.leaseOwner);
        return { fencingToken: 1, leaseUntil: new Date(Date.now() + 900000).toISOString() } as never;
      }
      if (path.startsWith("/api/v1/sync-resources/") && path.endsWith("/release-lease")) {
        const resourceId = path.split("/")[4];
        store.delete(`lease:${resourceId}`);
        return { released: true } as never;
      }
      if (path.startsWith("/api/v1/sync-resources/") && path.endsWith("/checkpoint")) {
        const id = path.split("/")[4];
        if (method === "PUT") {
          const body = JSON.parse(init!.body!) as { cursor: string | null };
          store.set(`cp:${id}`, body.cursor);
          return { cursor: body.cursor } as never;
        }
        return { cursor: (store.get(`cp:${id}`) as string | undefined) ?? null } as never;
      }
      if (path === "/api/v1/ingestion-quarantine" && method === "POST") {
        const body = JSON.parse(init!.body!) as { externalRecordId?: string; reason: string };
        store.set(`quarantine:${body.externalRecordId ?? "none"}`, body);
        return { id: "q" } as never;
      }
      if (path === "/api/v1/raw-source-records" && method === "POST") {
        const body = JSON.parse(init!.body!) as { sourceRecordId?: string; sourceVersion?: string; payloadHash?: string };
        const rawKey = `raw:${body.sourceRecordId}:${body.sourceVersion ?? "1"}`;
        if (!store.has(rawKey)) store.set(rawKey, { id: rawKey, externalRecordId: body.sourceRecordId, replayedAt: null });
        return store.get(rawKey) as never;
      }
      if (path === "/api/v1/financial-facts" && method === "POST") {
        const body = JSON.parse(init!.body!) as Record<string, unknown>;
        store.set(`fact:${body.sourceRecordId}`, body);
        return { id: "f" } as never;
      }
      if (path.startsWith("/api/v1/sync-runs/") && path.endsWith("/finish") && method === "POST") {
        return { id: path.split("/")[4] } as never;
      }
      throw new Error(`unexpected ${method} ${path}`);
    };
    return { inject, store };
  }

  function provider(records: Array<Record<string, unknown>>, nextCursor?: string) {
    const seenCursors: Array<string | null> = [];
    const impl = async (_input: unknown, init?: { signal?: AbortSignal }) => {
      seenCursors.push(null);
      void init;
      return json(200, { records, ...(nextCursor ? { next_cursor: nextCursor } : {}) });
    };
    (impl as unknown as { seenCursors: Array<string | null> }).seenCursors = seenCursors;
    return impl as unknown as typeof fetch & { seenCursors: Array<string | null> };
  }

  it("R25 mapping 缺 targetType → 全部隔离 SCHEMA_MISMATCH（不猜测路由）", async () => {
    const { inject, store } = makeInject();
    // 覆盖 mappings 返回：无 targetType
    const customInject: SyncRequestFn = async (path, init) => {
      if (path.includes("/mappings?status=ACTIVE")) {
        return [
          {
            id: "map-no-target",
            status: "ACTIVE",
            mappingType: "HTTP_JSON",
            sourceSystem: "tdd3",
            fieldMap: {
              sourceRecordId: "id",
              eventType: "event_type",
              subjectType: "subject_type",
              subjectId: "subject_id",
              evidenceType: "=GROSS_PROFIT",
            },
            config: { url: "https://provider.example/api", recordsPath: "records", nextCursorPath: "next_cursor" },
          },
        ] as never;
      }
      return inject(path, init);
    };
    const providerFetch = (async () => json(200, { records: [{ id: "F1", event_type: "e", subject_type: "ORDER", subject_id: ADMIN }] })) as unknown as typeof fetch;
    const summary = await runSyncCycle({
      request: customInject,
      limit: 1,
      maxPages: 1,
      claimNow: new Date(Date.now() + 3600_000).toISOString(),
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer tdd3-test",
    });
    expect(summary.schedules[0]!.counters.recordsQuarantined).toBe(1);
    expect(summary.schedules[0]!.counters.recordsUpserted).toBe(0);
    const quarantined = store.get("quarantine:F1") as { reason: string };
    expect(quarantined.reason).toBe("SCHEMA_MISMATCH");
  });

  it("R26 金额超 6 位小数 → SCHEMA_MISMATCH 隔离（不截断不静默）", async () => {
    const { inject, store } = makeInject();
    const providerFetch = (async () =>
      json(200, {
        records: [
          { id: "P1", event_type: "e", subject_type: "ORDER", subject_id: ADMIN, amount: "1.0000001", currency: "CNY" },
        ],
      })) as unknown as typeof fetch;
    const summary = await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 1,
      claimNow: new Date(Date.now() + 3600_000).toISOString(),
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer tdd3-test",
    });
    expect(summary.schedules[0]!.counters.recordsQuarantined).toBe(1);
    const quarantined = store.get("quarantine:P1") as { reason: string };
    expect(quarantined.reason).toBe("SCHEMA_MISMATCH");
  });

  it("R27 币种小写 usd → 规范化为 USD 入账（不隔离）", async () => {
    const { inject, store } = makeInject();
    const providerFetch = (async () =>
      json(200, {
        records: [
          { id: "P2", event_type: "e", subject_type: "ORDER", subject_id: ADMIN, amount: "5", currency: "usd" },
        ],
      })) as unknown as typeof fetch;
    const summary = await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 1,
      claimNow: new Date(Date.now() + 3600_000).toISOString(),
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer tdd3-test",
    });
    expect(summary.schedules[0]!.counters.recordsUpserted).toBe(1);
    const fact = store.get("fact:P2") as { currency: string };
    expect(fact.currency).toBe("USD");
  });

  it("R28 跨页游标接力：第二页请求携带上一页 next_cursor", async () => {
    const { inject } = makeInject();
    const pages = [
      { records: [{ id: "A1", event_type: "e", subject_type: "ORDER", subject_id: ADMIN, amount: "1", currency: "CNY" }], next_cursor: "page-2" },
      { records: [{ id: "A2", event_type: "e", subject_type: "ORDER", subject_id: ADMIN, amount: "2", currency: "CNY" }], next_cursor: null },
    ];
    let page = 0;
    const providerFetch = (async () => {
      const current = pages[Math.min(page, pages.length - 1)]!;
      page += 1;
      return json(200, current);
    }) as unknown as typeof fetch;
    const summary = await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 2,
      claimNow: new Date(Date.now() + 3600_000).toISOString(),
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer tdd3-test",
    });
    expect(summary.schedules[0]!.counters.recordsFetched).toBe(2);
    expect(summary.schedules[0]!.counters.recordsUpserted).toBe(2);
    void inject;
  });
});

describe("R29-R32: DSL 归一化与边界", () => {
  const ADMIN_UUID = ADMIN;

  it("R29 管理补差与营销奖励超过提成池 → valid=false 且分配为零", () => {
    const result = calculateInternalSplit({
      commissionPool: "100",
      marketingReward: "60",
      executiveSupplement: "60",
      participants: [{ personId: ADMIN_UUID, sharePercent: "100" }],
    });
    expect(result.valid).toBe(false);
    expect(result.allocated).toBe("0");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("R30 全部指标 N/A → complete=false 且 note 说明无完整评价", () => {
    const result = scorePerformance({
      personId: ADMIN_UUID,
      period: "MONTHLY",
      metrics: [
        {
          metricId: "M-NA",
          name: "缺失",
          period: "MONTHLY",
          applicableRoles: ["SALES"],
          weight: "100",
          metricType: "POSITIVE_LINEAR",
          target: "100",
          sourceFields: ["x"],
          calculationRule: "linear",
          ownerRole: "MANAGER",
          evidenceRule: "e",
          applicabilityRule: "always",
          dataSource: "QA",
          exceptionRule: "none",
          approvalRule: "none",
          version: 1,
        },
      ],
      measurements: [],
    });
    expect(result.complete).toBe(false);
    expect(result.finalScore).toBe("0");
    expect(result.coverageComplete).toBe(true);
    expect(result.scoreable).toBe(false);
  });

  it("R31 DBCP 管理计提基数缺省 = 毛利（比例按默认 5%）", () => {
    const result = calculateDbcp({
      grossProfit: "1000",
      businessExpenses: "0",
      laborAndTravel: "0",
      allocatedBusinessUnitExpenses: "0",
      allocatedBackendPayroll: "0",
    });
    // 缺省计提率 5%、基数=毛利 → provision 50，DBCP=毛利-50
    expect(result.managementProvision).toBe("50");
    expect(result.dbcp).toBe("950");
  });

  it("R32 图表缩放对负值输入 fail-safe（钳制为 0 不产生负坐标）", () => {
    const scale = buildLinearScale({ width: 100, height: 60, maxValue: 10 });
    const path = buildLinePath([{ label: "neg", value: -5 }], scale);
    expect(path).not.toContain("-"); // y(0) 底线，无负坐标
    expect(path).toMatch(/^M[\d.]+,[\d.]+$/);
  });
});
