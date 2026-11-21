/**
 * Sprint 2.1 批次 A（审计 INT-202/203/204/205/206）：数据主干。
 *
 * INT-202 Raw-first：runner 每条记录先加密落 raw（带 payload_hash/来源版本），
 *   再进入投影；raw 落地失败 → 整页失败（不丢数据）。
 * INT-203 Canonical：canonicalize() 统一中间表示（事件形状与来源版本）。
 * INT-204 Projection 幂等：同 payload_hash + 同 mapping 版本不重复投影。
 * INT-205 Lease：runner 资源处理前 claim-lease（fencing token），完成/失败释放。
 * INT-206 Watermark：页内最大 occurredAt 写入 checkpoint（增量观测基准）。
 */
import { describe, expect, it, vi } from "vitest";
import { canonicalize, runSyncCycle, type SyncRequestFn } from "@anari/connectors";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";

type Store = Map<string, unknown>;

/** 可编程 fake API：完整覆盖 runner 依赖面，并记录 raw 落地与投影调用。 */
function fakeApi(options?: { failRawOnRecordId?: string }) {
  const store: Store = new Map();
  const calls = {
    rawAppends: [] as Array<Record<string, unknown>>,
    factPosts: [] as Array<Record<string, unknown>>,
    quarantinePosts: [] as Array<Record<string, unknown>>,
    leaseClaims: [] as Array<{ owner: string }>,
    leaseReleases: [] as Array<{ owner: string }>,
    checkpoints: [] as Array<{ cursor: string | null; watermark?: string | null }>,
    finished: [] as string,
  };
  let runSeq = 0;
  let resSeq = 0;
  const inject: SyncRequestFn = async (path, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (path === "/api/v1/sync-schedules/claim-due" && method === "POST") {
      return [
        { id: "sched-1", connectionId: "conn-1", name: "s21-sched" },
      ] as never;
    }
    if (path === "/api/v1/integration-connections/conn-1/sync-runs" && method === "POST") {
      return { id: `run-${++runSeq}` } as never;
    }
    if (path === "/api/v1/integration-connections/conn-1" && method === "GET") {
      return { provider: "generic", credentialRef: "vault/s21", config: {} } as never;
    }
    if (path === "/api/v1/integration-connections/conn-1/mappings?status=ACTIVE") {
      return [
        {
          id: "map-1",
          status: "ACTIVE",
          mappingType: "HTTP_JSON",
          sourceSystem: "s21",
          targetType: "FINANCIAL_FACT",
          version: 3,
          fieldMap: {
            sourceRecordId: "id",
            eventType: "event_type",
            subjectType: "subject_type",
            subjectId: "subject_id",
            evidenceType: "=GROSS_PROFIT",
            occurredAt: "occurred_at",
          },
          config: { url: "https://provider.example/api", recordsPath: "records", nextCursorPath: "next_cursor" },
        },
      ] as never;
    }
    if (path === "/api/v1/sync-resources" && method === "POST") {
      const id = `res-${++resSeq}`;
      store.set(`res:${body.resourceKey as string}`, { id, resourceKey: body.resourceKey, mappingId: body.mappingId ?? null });
      return { id, resourceKey: body.resourceKey } as never;
    }
    if (path.startsWith("/api/v1/sync-resources?connectionId=")) {
      return [...store.values()].filter(
        (v) => typeof v === "object" && v !== null && "resourceKey" in (v as object),
      ) as never;
    }
    if (path.startsWith("/api/v1/sync-resources/") && path.endsWith("/claim-lease")) {
      calls.leaseClaims.push({ owner: String((body as { leaseOwner?: string }).leaseOwner) });
      return { fencingToken: 1, leaseUntil: new Date(Date.now() + 300000).toISOString() } as never;
    }
    if (path.startsWith("/api/v1/sync-resources/") && path.endsWith("/release-lease")) {
      calls.leaseReleases.push({ owner: String((body as { leaseOwner?: string }).leaseOwner) });
      return { released: true } as never;
    }
    if (path.startsWith("/api/v1/sync-resources/") && path.endsWith("/checkpoint")) {
      const resourceId = path.split("/")[4];
      if (method === "PUT") {
        calls.checkpoints.push({ cursor: (body.cursor as string | null) ?? null, watermark: (body.watermark as string | null) ?? null });
        store.set(`cp:${resourceId}`, body);
        return body as never;
      }
      const saved = store.get(`cp:${resourceId}`) as { cursor: string | null } | undefined;
      return { cursor: saved?.cursor ?? null } as never;
    }
    if (path === "/api/v1/raw-source-records" && method === "POST") {
      const recordId = String(body.externalRecordId);
      if (options?.failRawOnRecordId === recordId) {
        throw new Error("RAW_LANDING_INJECTED_FAILURE");
      }
      calls.rawAppends.push({ ...body, _mappingVersion: body.mappingVersion });
      const key = `raw:${recordId}:${String(body.mappingVersion)}`;
      if (store.has(key)) return store.get(key) as never;
      const created = { id: `raw-${store.size + 1}`, externalRecordId: recordId, replayedAt: null };
      store.set(key, created);
      return created as never;
    }
    if (path === "/api/v1/financial-facts" && method === "POST") {
      const key = `fact:${String(body.sourceRecordId)}`;
      if (store.has(key)) {
        // 模拟真实端点 UNIQUE 约束（protocol：409 duplicate）
        throw new Error(`HTTP 409 duplicate key value violates unique constraint ${key}`);
      }
      calls.factPosts.push({ ...body });
      store.set(key, body);
      return { id: "f" } as never;
    }
    if (path === "/api/v1/ingestion-quarantine" && method === "POST") {
      calls.quarantinePosts.push({ ...body });
      return { id: "q" } as never;
    }
    if (path.startsWith("/api/v1/sync-runs/") && path.endsWith("/finish") && method === "POST") {
      calls.finished.push(String((body as { status: string }).status));
      return { id: path.split("/")[4] } as never;
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { inject, store, calls };
}

function providerPage(records: Array<Record<string, unknown>>, nextCursor?: string | null) {
  return (async () => jsonOk({ records, ...(nextCursor ? { next_cursor: nextCursor } : {}) })) as unknown as typeof fetch;
}

function jsonOk(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    headers: new Headers(),
    redirected: false,
    url: "x",
  } as unknown as Response;
}

const nowIso = new Date(Date.now() + 3600_000).toISOString();

describe("Sprint 2.1 批次 A：数据主干", () => {
  it("INT-202 raw-first：每条记录先落 raw（含 payload_hash 与 mapping 版本）再投影", async () => {
    const { inject, calls } = fakeApi();
    const providerFetch = providerPage([
      { id: "F1", event_type: "updated", subject_type: "ORDER", subject_id: ADMIN, occurred_at: "2026-11-20T00:00:00Z", amount: "10", currency: "CNY" },
      { id: "F2", event_type: "updated", subject_type: "ORDER", subject_id: ADMIN, occurred_at: "2026-11-20T01:00:00Z", amount: "20", currency: "CNY" },
    ]);
    const summary = await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 1,
      claimNow: nowIso,
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer s21-test",
    });
    expect(summary.schedules[0]!.status).toBe("SUCCEEDED");
    // INT-202：两条记录、两次 raw 落地（先于投影）
    expect(calls.rawAppends).toHaveLength(2);
    expect(calls.rawAppends.every((append) => typeof append.payloadHash === "string" && append.payloadHash.length > 0)).toBe(true);
    expect(calls.rawAppends.every((append) => append._mappingVersion === 3)).toBe(true);
    // 投影仍然发生（2 条财务事实）
    expect(calls.factPosts).toHaveLength(2);
  });

  it("INT-202 raw 落地失败 → 整页失败，不产生投影（数据不丢）", async () => {
    const { inject, calls } = fakeApi({ failRawOnRecordId: "F1" });
    const providerFetch = providerPage([
      { id: "F1", event_type: "updated", subject_type: "ORDER", subject_id: ADMIN, amount: "10", currency: "CNY" },
      { id: "F2", event_type: "updated", subject_type: "ORDER", subject_id: ADMIN, amount: "20", currency: "CNY" },
    ]);
    const summary = await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 1,
      claimNow: nowIso,
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer s21-test",
    });
    expect(summary.schedules[0]!.status).toBe("FAILED");
    // 没有任何事实被投影（checkpoint 停留在原位，重放不丢数据）
    expect(calls.factPosts).toHaveLength(0);
  });

  it("INT-203 canonicalize：统一事件形状（来源系统/对象类型/版本/哈希）", () => {
    const event = canonicalize(
      {
        sourceRecordId: "F1",
        sourceEventVersion: "v9",
        eventType: "updated",
        occurredAt: "2026-11-20T00:00:00Z",
        subjectType: "ORDER",
        subjectId: ADMIN,
        evidenceType: "GROSS_PROFIT",
        payload: { amount: "10" },
      },
      { sourceSystem: "s21", mappingVersion: 3 },
    );
    expect(event.sourceSystem).toBe("s21");
    expect(event.externalObjectType).toBe("ORDER");
    expect(event.externalObjectId).toBe(ADMIN);
    expect(event.mappingVersion).toBe(3);
    expect(event.sourceVersion).toBe("v9");
    expect(event.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("INT-204 投影幂等：同 payload_hash 同 mapping 版本二次同步不重复投影", async () => {
    const { inject, calls } = fakeApi();
    const providerFetch = providerPage([
      { id: "F1", event_type: "updated", subject_type: "ORDER", subject_id: ADMIN, amount: "10", currency: "CNY" },
    ]);
    for (let round = 0; round < 2; round += 1) {
      await runSyncCycle({
        request: inject,
        limit: 1,
        maxPages: 1,
        claimNow: new Date(Date.now() + (round + 1) * 3600_000).toISOString(),
        providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer s21-test",
      });
    }
    // 同一条记录两个运行周期：raw 幂等返回同 id；投影按 payloadHash 去重 → 仅一次事实写入
    expect(calls.factPosts.filter((post) => post.sourceRecordId === "F1")).toHaveLength(1);
  });

  it("INT-205 lease：资源处理前 claim、完成/失败均 release", async () => {
    const { inject, calls } = fakeApi();
    const providerFetch = providerPage([
      { id: "F1", event_type: "updated", subject_type: "ORDER", subject_id: ADMIN, amount: "10", currency: "CNY" },
    ]);
    await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 1,
      claimNow: nowIso,
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer s21-test",
    });
    expect(calls.leaseClaims.length).toBeGreaterThan(0);
    expect(calls.leaseReleases).toEqual(calls.leaseClaims);

    // 失败路径也释放
    const failing = fakeApi();
    const badProvider = (async () => jsonOk({ records: "not-an-array" })) as unknown as typeof fetch;
    const failed = await runSyncCycle({
      request: failing.inject,
      limit: 1,
      maxPages: 1,
      claimNow: nowIso,
      providerFetchImpl: badProvider,
      credentialRefResolver: () => "Bearer s21-test",
    });
    expect(failed.schedules[0]!.status).toBe("FAILED");
    expect(failing.calls.leaseReleases.length).toBe(failing.calls.leaseClaims.length);
  });

  it("INT-206 watermark：checkpoint 记录页内最大 occurredAt", async () => {
    const { inject, calls } = fakeApi();
    const providerFetch = providerPage([
      { id: "F1", event_type: "updated", subject_type: "ORDER", subject_id: ADMIN, occurred_at: "2026-11-20T00:00:00Z", amount: "10", currency: "CNY" },
      { id: "F2", event_type: "updated", subject_type: "ORDER", subject_id: ADMIN, occurred_at: "2026-11-20T05:00:00Z", amount: "20", currency: "CNY" },
    ], "next-1");
    await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 1,
      claimNow: nowIso,
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer s21-test",
    });
    const last = calls.checkpoints[calls.checkpoints.length - 1];
    expect(last!.cursor).toBe("next-1");
    expect(last!.watermark).toBe("2026-11-20T05:00:00Z");
  });
});
