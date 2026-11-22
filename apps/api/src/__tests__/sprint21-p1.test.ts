/**
 * Sprint 2.1 P1 批次 H：Provider Schema Discovery / Data Lineage / 资源级调度节流。
 *
 * Schema Discovery（P1）：POST /integration-connections/:id/schema-preview——
 *   probe 真实拉取一页样本 → 推断顶层字段集合 → 与现有 fieldMap 对比给出
 *   drift 警告（供应商字段变化检测）→ 应用 fieldMap 展示映射后事件预览。
 * Data Lineage（P1）：GET /raw-source-records/:id/lineage——从原始记录追溯
 *   投影产物（按 sourceSystem+externalRecordId 匹配证据节点）。
 * 资源级调度节流（P1 Resource Scheduler 简版）：checkpoint 记录
 *   intervalOverrideMinutes；runner claim 后若距上次同步不足间隔 → release+跳过。
 */
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { SyncRequestFn } from "@anari/connectors";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";

function buildAppFor(tenantId: string, options?: Parameters<typeof buildApp>[4]) {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: tenantId,
      name: `P1 ${tenantId.slice(-4)}`,
      slug: `p1-${tenantId.slice(-4)}`,
    },
  });
  return buildApp(
    () => new Store(tenantId),
    undefined,
    {
      async authenticate() {
        return {
          tenantId,
          userId: "p1",
          roles: ["admin", "integration"],
          personId: ADMIN,
        };
      },
    },
    platformStore,
    options,
  );
}

const H = { "content-type": "application/json" };

async function makeConnection(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/integration-connections",
    payload: JSON.stringify({
      provider: "generic",
      connectionName: `p1-${Date.now()}`,
      credentialRef: "vault/p1",
      config: { url: "https://provider.example/api" },
    }),
    headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
  });
  return (JSON.parse(res.payload) as { data: { id: string } }).data.id;
}

describe("Schema Discovery（P1）", () => {
  it("schema-preview：probe 样本 → 字段集合 + 映射预览 + drift 警告", async () => {
    const probe = vi.fn(async () => ({
      ok: true,
      sample: {
        id: "S1",
        event_type: "created",
        subject_type: "ORDER",
        subject_id: ADMIN,
        new_vendor_field: "brand-new",
      },
    }));
    const app = buildAppFor(TENANT, { integrationProbe: probe });
    const connectionId = await makeConnection(app);
    // 建一个映射（fieldMap 引用部分字段）
    await app.inject({
      method: "POST",
      url: `/api/v1/integration-connections/${connectionId}/mappings`,
      payload: JSON.stringify({
        name: "p1-mapping",
        mappingType: "HTTP_JSON",
        sourceSystem: "p1-system",
        targetType: "EVIDENCE",
        fieldMap: {
          sourceRecordId: "id",
          eventType: "event_type",
          subjectType: "subject_type",
          subjectId: "subject_id",
          evidenceType: "=ACTIVITY",
        },
        config: {},
        version: 1,
      }),
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/integration-connections/${connectionId}/schema-preview`,
      payload: JSON.stringify({ probePath: "" }),
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
    });
    expect(res.statusCode, res.payload).toBe(200);
    const body = JSON.parse(res.payload) as {
      data: {
        fields: string[];
        mappedPreview: Record<string, string>;
        drift: string[];
      };
    };
    // 样本顶层字段被推断
    expect(body.data.fields).toEqual(expect.arrayContaining(["id", "event_type", "subject_type", "subject_id", "new_vendor_field"]));
    // fieldMap 应用：源路径 → 样本值
    expect(body.data.mappedPreview.sourceRecordId).toBe("S1");
    expect(body.data.mappedPreview.evidenceType).toBe("ACTIVITY");
    // drift：供应商新字段未在 fieldMap 中引用 → 警告
    expect(body.data.drift.some((entry) => entry.includes("new_vendor_field"))).toBe(true);
  });

  it("probe 失败 → 诊断脱敏且 ok=false", async () => {
    const app = buildAppFor(TENANT, {
      integrationProbe: async () => ({ ok: false, detail: "provider returned 401" }),
    });
    const connectionId = await makeConnection(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/integration-connections/${connectionId}/schema-preview`,
      payload: JSON.stringify({}),
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { data: { ok: boolean; detail?: string } };
    expect(body.data.ok).toBe(false);
    expect(body.data.detail).toContain("401");
  });
});

describe("Sync Health Dashboard（P1）", () => {
  it("聚合最近运行的 成功率/延迟/错误分布", async () => {
    const app = buildAppFor(TENANT);
    const connectionId = await makeConnection(app);
    // 造两次 run：一成一败
    for (const status of ["SUCCEEDED", "FAILED"]) {
      await app.inject({
        method: "POST",
        url: `/api/v1/integration-connections/${connectionId}/sync-runs`,
        payload: JSON.stringify({ status: "RUNNING" }),
        headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
      });
    }
    const runsRes = await app.inject({
      method: "GET",
      url: `/api/v1/integration-connections/${connectionId}/sync-runs`,
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
    });
    const runs = (JSON.parse(runsRes.payload) as { data: Array<{ id: string }> }).data;
    for (const [index, run] of runs.entries()) {
      await app.inject({
        method: "POST",
        url: `/api/v1/sync-runs/${run.id}/finish`,
        payload: JSON.stringify({
          status: index === 0 ? "FAILED" : "SUCCEEDED",
          recordsSeen: 10,
          recordsUpserted: index === 0 ? 0 : 10,
          recordsFetched: 10,
          errorSummary: index === 0 ? "HTTP connector failed: 500" : undefined,
        }),
        headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
      });
    }
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/sync-health?connectionId=${connectionId}`,
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
    });
    expect(res.statusCode, res.payload).toBe(200);
    const report = (JSON.parse(res.payload) as { data: {
      totalRuns: number; succeeded: number; failed: number;
      successRate: number; avgDurationMs: number | null;
      errorSummaryCounts: Record<string, number>;
    } }).data;
    expect(report.totalRuns).toBe(2);
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.successRate).toBe(0.5);
    expect(report.avgDurationMs).not.toBeNull();
    expect(Object.keys(report.errorSummaryCounts).length).toBeGreaterThan(0);
  });
});

describe("Data Lineage（P1）", () => {
  it("raw 记录血缘：从原始记录追溯投影产物（证据节点）", async () => {
    const app = buildAppFor(TENANT);
    // 落一条 raw + 一条匹配的证据（同 sourceSystem + subjectId 链）
    await app.inject({
      method: "POST",
      url: "/api/v1/raw-source-records",
      payload: JSON.stringify({
        sourceSystem: "lineage-sys",
        externalRecordId: "LIN-1",
        payload: { subject: ADMIN },
      }),
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
    });
    // 投影时 payload 与 raw 相同 → lineage 按规范化 payload 匹配
    await app.inject({
      method: "POST",
      url: "/api/v1/ingestion/events:batch",
      payload: JSON.stringify({
        sourceSystem: "lineage-sys",
        events: [
          {
            sourceRecordId: "LIN-1",
            eventType: "created",
            subjectType: "ORDER",
            subjectId: ADMIN,
            evidenceType: "ACTIVITY",
            payload: { subject: ADMIN },
          },
        ],
      }),
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/raw-source-records/lineage?sourceSystem=lineage-sys&externalRecordId=LIN-1",
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "p1", "x-person-id": ADMIN },
    });
    expect(res.statusCode, res.payload).toBe(200);
    const body = JSON.parse(res.payload) as {
      data: {
        raw: { externalRecordId: string } | null;
        projections: Array<{ kind: string; id: string }>;
      };
    };
    expect(body.data.raw?.externalRecordId).toBe("LIN-1");
    expect(body.data.projections.some((p) => p.kind === "EVIDENCE")).toBe(true);
  });
});

describe("资源级调度节流（P1 Resource Scheduler 简版）", () => {
  it("checkpoint intervalOverrideMinutes：距上次同步不足间隔 → runner release+跳过", async () => {
    // 通过 store 语义验证：intervalOverride 逻辑在 runner，由 checkpoint
    // updatedAt + intervalOverrideMinutes 判断。此处用 fakeApi 驱动。
    const { runSyncCycle } = await import("@anari/connectors");
    const store = new Map<string, unknown>();
    let releases = 0;
    const inject: SyncRequestFn = async (path, init) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      if (path === "/api/v1/sync-schedules/claim-due" && method === "POST") {
        return [{ id: "s", connectionId: "conn-1", name: "sched" }] as never;
      }
      if (path === "/api/v1/integration-connections/conn-1/sync-runs") return { id: "run" } as never;
      if (path === "/api/v1/integration-connections/conn-1") {
        return { provider: "generic", credentialRef: "vault/x", config: {} } as never;
      }
      if (path.includes("/mappings?status=ACTIVE")) {
        return [
          {
            id: "m",
            status: "ACTIVE",
            mappingType: "HTTP_JSON",
            sourceSystem: "s",
            targetType: "EVIDENCE",
            fieldMap: { sourceRecordId: "id", eventType: "e", subjectType: "s", subjectId: "sid", evidenceType: "=ACTIVITY" },
            config: { url: "https://p.example", recordsPath: "records" },
          },
        ] as never;
      }
      if (path === "/api/v1/sync-resources" && method === "POST") return { id: "r" } as never;
      if (path.startsWith("/api/v1/sync-resources?")) return [{ id: "r" }] as never;
      if (path.includes("/claim-lease")) {
        return { fencingToken: 1, leaseUntil: new Date(Date.now() + 900000).toISOString() } as never;
      }
      if (path.includes("/release-lease")) {
        releases += 1;
        return { released: true } as never;
      }
      if (path.includes("/checkpoint")) {
        if (method === "PUT") return body as never;
        // checkpoint.updatedAt 刚刚同步过 + intervalOverrideMinutes=60 → 应跳过
        return {
          cursor: null,
          watermark: null,
          updatedAt: new Date().toISOString(),
          intervalOverrideMinutes: 60,
        } as never;
      }
      if (path.startsWith("/api/v1/sync-runs/")) return { id: "x" } as never;
      throw new Error(`unexpected ${method} ${path}`);
    };
    const providerFetch = vi.fn();
    const summary = await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 1,
      claimNow: new Date(Date.now() + 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer x",
    });
    // 资源被节流：无投影、run SUCCEEDED、资源被 release
    expect(summary.schedules[0]!.counters.recordsUpserted).toBe(0);
    expect(summary.schedules[0]!.status).toBe("SUCCEEDED");
    expect(releases).toBeGreaterThan(0);
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
