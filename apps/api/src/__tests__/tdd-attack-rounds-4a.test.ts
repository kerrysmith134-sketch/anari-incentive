/**
 * 第四波 TDD（R33-R48）：集成域 API + connector 拉取层。
 * 停止条件：连续多轮（整批 + 全量回归）零缺陷。
 */
import { describe, expect, it, vi } from "vitest";
import { HttpJsonConnector } from "@anari/connectors";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";

function buildAppFor(tenantId: string, roles: string[] = ["admin", "integration"]) {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: tenantId,
      name: `R4 ${tenantId.slice(-4)}`,
      slug: `r4-${tenantId.slice(-4)}`,
    },
  });
  return buildApp(
    () => new Store(tenantId),
    undefined,
    {
      async authenticate() {
        return { tenantId, userId: "r4", roles, personId: ADMIN };
      },
    },
    platformStore,
  );
}

const H = { "content-type": "application/json" };

function headers(tenantId = TENANT) {
  return { ...H, "x-tenant-id": tenantId, "x-user-id": "r4", "x-person-id": ADMIN };
}

describe("R33-R40: raw ledger / 生命周期 / 租约 / 隔离区", () => {
  it("R33 listRawSourceRecords replayedOnly 过滤：已重放与未重放分列", async () => {
    const app = buildAppFor(TENANT);
    for (const [id, replay] of [
      ["RAW-A", false],
      ["RAW-B", true],
    ] as Array<[string, boolean]>) {
      const landed = await app.inject({
        method: "POST",
        url: "/api/v1/raw-source-records",
        payload: JSON.stringify({ sourceSystem: "r4", externalRecordId: id, payload: {} }),
        headers: headers(),
      });
      const rawId = (JSON.parse(landed.payload) as { data: { id: string } }).data.id;
      if (replay) {
        await app.inject({
          method: "POST",
          url: `/api/v1/raw-source-records/${rawId}/replay`,
          payload: JSON.stringify({
            eventType: "e",
            subjectType: "ORDER",
            subjectId: ADMIN,
            evidenceType: "ACTIVITY",
          }),
          headers: headers(),
        });
      }
    }
    const replayedOnly = await app.inject({
      method: "GET",
      url: "/api/v1/raw-source-records?sourceSystem=r4&replayed=1",
      headers: headers(),
    });
    const replayedList = (JSON.parse(replayedOnly.payload) as { data: Array<{ id: string }> }).data;
    expect(replayedList).toHaveLength(1);
  });

  it("R34 lineage 对未知来源系统 → raw null 且 projections 空（200 不报错）", async () => {
    const app = buildAppFor(TENANT);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/raw-source-records/lineage?sourceSystem=ghost&externalRecordId=X",
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { data: { raw: unknown; projections: unknown[] } };
    expect(body.data.raw).toBeNull();
    expect(body.data.projections).toHaveLength(0);
  });

  it("R35 已 unlink 身份 resolve → 404（软删除后不可解析）", async () => {
    const app = buildAppFor(TENANT);
    await app.inject({
      method: "POST",
      url: "/api/v1/external-objects",
      payload: JSON.stringify({
        sourceSystem: "r4",
        externalObjectType: "ORDER",
        externalObjectId: "SOFT-1",
        internalObjectType: "ORDER",
        internalObjectId: ADMIN,
      }),
      headers: headers(),
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/external-objects/unlink",
      payload: JSON.stringify({
        sourceSystem: "r4",
        externalObjectType: "ORDER",
        externalObjectId: "SOFT-1",
        reason: "WRONG_MAPPING",
        actorPersonId: ADMIN,
      }),
      headers: headers(),
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/external-objects:resolve?sourceSystem=r4&externalObjectType=ORDER&externalObjectId=SOFT-1",
      headers: headers(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("R36 mergeExternalObjects 对不存在的 merge 目标跳过（merged 不含它）", async () => {
    const app = buildAppFor(TENANT);
    await app.inject({
      method: "POST",
      url: "/api/v1/external-objects",
      payload: JSON.stringify({
        sourceSystem: "r4",
        externalObjectType: "ORDER",
        externalObjectId: "KEEP-1",
        internalObjectType: "ORDER",
        internalObjectId: ADMIN,
      }),
      headers: headers(),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/external-objects:merge",
      payload: JSON.stringify({
        sourceSystem: "r4",
        externalObjectType: "ORDER",
        keepExternalObjectId: "KEEP-1",
        mergeExternalObjectIds: ["GHOST-9"],
        actorPersonId: ADMIN,
      }),
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.payload) as { data: { merged: number } }).data.merged).toBe(0);
  });

  it("R37 二次 merge 同批 → 幂等（映射值不变）", async () => {
    const app = buildAppFor(TENANT);
    const register = async (id: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/external-objects",
        payload: JSON.stringify({
          sourceSystem: "r4",
          externalObjectType: "ORDER",
          externalObjectId: id,
          internalObjectType: "ORDER",
          internalObjectId: "00000000-0000-4000-8000-0000000000f1",
        }),
        headers: headers(),
      });
    await register("M-KEEP");
    await register("M-A");
    const merge = async () =>
      app.inject({
        method: "POST",
        url: "/api/v1/external-objects:merge",
        payload: JSON.stringify({
          sourceSystem: "r4",
          externalObjectType: "ORDER",
          keepExternalObjectId: "M-KEEP",
          mergeExternalObjectIds: ["M-A"],
          actorPersonId: ADMIN,
        }),
        headers: headers(),
      });
    const first_merge = await merge();
    expect(first_merge.statusCode).toBe(200);
    const again = JSON.parse((await merge()).payload) as { data: { merged: number } };
    expect(again.data.merged).toBe(1);
    const resolve = await app.inject({
      method: "GET",
      url: "/api/v1/external-objects:resolve?sourceSystem=r4&externalObjectType=ORDER&externalObjectId=M-A",
      headers: headers(),
    });
    expect(resolve.statusCode).toBe(200);
  });

  it("R38 同 owner 续租 → token 递增且不 409", async () => {
    const app = buildAppFor(TENANT);
    const connectionId = await makeConnection(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sync-resources",
      payload: JSON.stringify({ connectionId, resourceKey: "renew" }),
      headers: headers(),
    });
    const resourceId = (JSON.parse(res.payload) as { data: { id: string } }).data.id;
    const claim = async () =>
      app.inject({
        method: "POST",
        url: `/api/v1/sync-resources/${resourceId}/claim-lease`,
        payload: JSON.stringify({ leaseOwner: "same-worker", leaseSeconds: 600 }),
        headers: headers(),
      });
    const first = JSON.parse((await claim()).payload) as { data: { fencingToken: number } };
    const second = JSON.parse((await claim()).payload) as { data: { fencingToken: number } };
    expect(second.data.fencingToken).toBe(first.data.fencingToken + 1);
  });

  it("R39 未 claim 直接 release → 409 stale", async () => {
    const app = buildAppFor(TENANT);
    const connectionId = await makeConnection(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sync-resources",
      payload: JSON.stringify({ connectionId, resourceKey: "never-claimed" }),
      headers: headers(),
    });
    const resourceId = (JSON.parse(res.payload) as { data: { id: string } }).data.id;
    const release = await app.inject({
      method: "POST",
      url: `/api/v1/sync-resources/${resourceId}/release-lease`,
      payload: JSON.stringify({ leaseOwner: "w", fencingToken: 1 }),
      headers: headers(),
    });
    expect(release.statusCode).toBe(409);
  });

  it("R40 已处置隔离记录二次 resolve → 404（resolved_at IS NULL 条件）", async () => {
    const app = buildAppFor(TENANT);
    const landed = await app.inject({
      method: "POST",
      url: "/api/v1/ingestion-quarantine",
      payload: JSON.stringify({ sourceSystem: "r4", externalRecordId: "QR-1", reason: "OTHER" }),
      headers: headers(),
    });
    const id = (JSON.parse(landed.payload) as { data: { id: string } }).data.id;
    const resolve = async () =>
      app.inject({
        method: "POST",
        url: `/api/v1/ingestion-quarantine/${id}/resolve`,
        payload: JSON.stringify({ resolutionNote: "done", actorPersonId: ADMIN }),
        headers: headers(),
      });
    expect((await resolve()).statusCode).toBe(200);
    expect((await resolve()).statusCode).toBe(404);
  });

  it("R41 resolve 不存在的隔离记录 → 404", async () => {
    const app = buildAppFor(TENANT);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ingestion-quarantine/00000000-0000-4000-8000-0000000000e5/resolve",
      payload: JSON.stringify({ resolutionNote: "x", actorPersonId: ADMIN }),
      headers: headers(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("R42-R48: connector 拉取层", () => {
  function ok(payload: unknown): Response {
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      headers: new Headers(),
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

  it("R45 updatedSinceParam 与 cursorParam 共存 → 两者同时注入", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      urls.push(String(input));
      return ok({ records: [] });
    }) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r45",
      url: "https://provider.example/api",
      cursorParam: "cursor",
      updatedSinceParam: "updated_since",
      columns: COLUMNS,
      fetchImpl,
    });
    await connector.pull("cur-1", "2026-11-20T00:00:00Z");
    expect(urls[0]).toContain("cursor=cur-1");
    expect(urls[0]).toContain("updated_since=");
  });

  it("R46 空 records 数组 + nextCursor → 正常返回空事件并保留游标", async () => {
    const fetchImpl = vi.fn(async () => ok({ records: [], next_cursor: "page-9" })) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r46",
      url: "https://provider.example/api",
      nextCursorPath: "next_cursor",
      columns: COLUMNS,
      fetchImpl,
    });
    const result = await connector.pull(null);
    expect(result.events).toHaveLength(0);
    expect(result.nextCursor).toBe("page-9");
  });

  it("R50 cursor 通过 cursorParam 注入 GET URL（分页基础）", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      urls.push(String(input));
      return ok({ records: [] });
    }) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r50",
      url: "https://provider.example/api",
      cursorParam: "page_token",
      columns: COLUMNS,
      fetchImpl,
    });
    await connector.pull("tkn-42");
    expect(urls[0]).toContain("page_token=tkn-42");
  });
});

async function makeConnection(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/integration-connections",
    payload: JSON.stringify({
      provider: "generic",
      connectionName: `r4-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      credentialRef: "vault/r4",
      config: {},
    }),
    headers: headers(),
  });
  return (JSON.parse(res.payload) as { data: { id: string } }).data.id;
}
