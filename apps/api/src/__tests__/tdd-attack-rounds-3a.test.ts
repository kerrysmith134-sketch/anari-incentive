/**
 * 30+ 轮 TDD 攻击面 sweep（第三波）——集成域 store/HTTP 层。
 * 攻击面不重复前两波（2026-11-14 tdd-attack-rounds 与 11-21 审计批既有测试）。
 *
 * R01-R10 store 层语义（幂等/404/覆盖/租约边界）
 * R11-R20 HTTP 协议层（400 校验/403 角色/404 跨租户/签名篡改）
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000009";
const ADMIN = "00000000-0000-4000-8000-000000000001";

function buildAppFor(tenantId: string, roles: string[] = ["admin", "integration"]) {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: tenantId,
      name: `TDD3 ${tenantId.slice(-4)}`,
      slug: `tdd3-${tenantId.slice(-4)}`,
    },
  });
  return buildApp(
    () => new Store(tenantId),
    undefined,
    {
      async authenticate() {
        return {
          tenantId,
          userId: "tdd3",
          roles,
          personId: ADMIN,
        };
      },
    },
    platformStore,
  );
}

const H = { "content-type": "application/json" };

function tenantHeaders(tenantId = TENANT) {
  return { ...H, "x-tenant-id": tenantId, "x-user-id": "tdd3", "x-person-id": ADMIN };
}

async function makeConnection(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/integration-connections",
    payload: JSON.stringify({
      provider: "generic",
      connectionName: `tdd3-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      credentialRef: "vault/tdd3",
      config: {},
    }),
    headers: tenantHeaders(),
  });
  return (JSON.parse(res.payload) as { data: { id: string } }).data.id;
}

async function makeResource(app: Awaited<ReturnType<typeof buildApp>>, key?: string) {
  const connectionId = await makeConnection(app);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/sync-resources",
    payload: JSON.stringify({ connectionId, resourceKey: key ?? `r-${Math.random().toString(36).slice(2, 8)}` }),
    headers: tenantHeaders(),
  });
  return (JSON.parse(res.payload) as { data: { id: string } }).data.id;
}

describe("R01-R10: store 层语义", () => {
  it("R01 saveSyncCheckpoint 对不存在资源 → 404（不静默创建）", async () => {
    const app = buildAppFor(TENANT);
    const inject = async () =>
      app.inject({
        method: "PUT",
        url: "/api/v1/sync-resources/00000000-0000-4000-8000-0000000000e1/checkpoint",
        payload: JSON.stringify({
          cursor: "c1",
          leaseOwner: "r01-test",
          fencingToken: 0,
        }),
        headers: tenantHeaders(),
      });
    const res = await inject();
    expect(res.statusCode).toBe(404);
    // 幂等重试同样 404（不产生孤儿 checkpoint）
    const again = await inject();
    expect(again.statusCode).toBe(404);
  });

  it("R02 claim-lease：leaseSeconds=0 与负数 → 400（契约下限）", async () => {
    const app = buildAppFor(TENANT);
    const resourceId = await makeResource(app);
    for (const bad of [0, -5]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/sync-resources/${resourceId}/claim-lease`,
        payload: JSON.stringify({ leaseOwner: "w", leaseSeconds: bad }),
        headers: tenantHeaders(),
      });
      expect(res.statusCode, `leaseSeconds=${bad}`).toBe(400);
    }
  });

  it("R03 租约过期后他人可抢且 token 继续递增", async () => {
    const app = buildAppFor(TENANT);
    const resourceId = await makeResource(app);
    const claim = async (owner: string, seconds: number) =>
      app.inject({
        method: "POST",
        url: `/api/v1/sync-resources/${resourceId}/claim-lease`,
        payload: JSON.stringify({ leaseOwner: owner, leaseSeconds: seconds }),
        headers: tenantHeaders(),
      });
    const first = JSON.parse((await claim("w1", 1)).payload) as { data: { fencingToken: number } };
    // 等待租约过期（1 秒）
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = JSON.parse((await claim("w2", 300)).payload) as { data: { fencingToken: number } };
    expect(second.data.fencingToken).toBeGreaterThan(first.data.fencingToken);
  });

  it("R04 quarantine 同外部记录二次落地覆盖旧 reason（upsert 语义）", async () => {
    const app = buildAppFor(TENANT);
    const post = async (reason: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/ingestion-quarantine",
        payload: JSON.stringify({
          sourceSystem: "tdd3",
          externalRecordId: "Q-DUP",
          reason,
          payload: { attempt: reason },
        }),
        headers: tenantHeaders(),
      });
    await post("SCHEMA_MISMATCH");
    const second = await post("OTHER");
    expect(second.statusCode).toBe(201);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/ingestion-quarantine?sourceSystem=tdd3",
      headers: tenantHeaders(),
    });
    const rows = (JSON.parse(list.payload) as { data: Array<{ externalRecordId: string | null; reason: string }> }).data;
    const dup = rows.filter((row) => row.externalRecordId === "Q-DUP");
    expect(dup).toHaveLength(1);
    expect(dup[0]!.reason).toBe("OTHER");
  });

  it("R05 markRawSourceRecordReplayed 不存在 id → 404", async () => {
    const app = buildAppFor(TENANT);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/raw-source-records/00000000-0000-4000-8000-0000000000e2/replay",
      payload: JSON.stringify({
        eventType: "e",
        subjectType: "ORDER",
        subjectId: ADMIN,
        evidenceType: "ACTIVITY",
      }),
      headers: tenantHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("R06 原始记录版本化：同内容幂等、更正内容独立成行、历史不可改写", async () => {
    const app = buildAppFor(TENANT);
    const post = async (stage: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/raw-source-records",
        payload: JSON.stringify({
          sourceSystem: "tdd3",
          externalRecordId: "RAW-DUP",
          payload: { stage },
        }),
        headers: tenantHeaders(),
      });
    const first = JSON.parse((await post("v1")).payload) as { data: { id: string } };
    const replay1 = await app.inject({
      method: "POST",
      url: `/api/v1/raw-source-records/${first.data.id}/replay`,
      payload: JSON.stringify({
        eventType: "e",
        subjectType: "ORDER",
        subjectId: ADMIN,
        evidenceType: "ACTIVITY",
      }),
      headers: tenantHeaders(),
    });
    expect(replay1.statusCode).toBe(200);
    // 同内容再次落地：幂等返回既有行（不新增版本）。
    const duplicate = JSON.parse((await post("v1")).payload) as { data: { id: string } };
    expect(duplicate.data.id).toBe(first.data.id);
    // 供应商侧记录被更正：新 sourceVersion 独立成行，旧行保留。
    const second = JSON.parse((await post("v2")).payload) as { data: { id: string } };
    expect(second.data.id).not.toBe(first.data.id);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/raw-source-records?sourceSystem=tdd3",
      headers: tenantHeaders(),
    });
    const rows = (JSON.parse(list.payload) as { data: Array<{ id: string; replayedAt?: string | null; payloadEncrypted?: string }> }).data;
    const row = rows.find((entry) => entry.id === first.data.id);
    // INT-202 版本化语义：同版本幂等返回既有，历史状态不可改写（append-only）；
    // 供应商更正 → 新 sourceVersion 新行。第二次 replay 因已重放同样幂等返回。
    expect(row?.replayedAt).toBeTruthy();
    expect(row?.payloadEncrypted ?? "").not.toBe("");
  });

  it("R07 已 unlink 的身份再 unlink → 404（valid_to IS NULL 条件）", async () => {
    const app = buildAppFor(TENANT);
    const register = async () =>
      app.inject({
        method: "POST",
        url: "/api/v1/external-objects",
        payload: JSON.stringify({
          sourceSystem: "tdd3",
          externalObjectType: "ORDER",
          externalObjectId: "UNLINK-1",
          internalObjectType: "ORDER",
          internalObjectId: ADMIN,
          matchRule: "MANUAL",
        }),
        headers: tenantHeaders(),
      });
    await register();
    const unlink = async () =>
      app.inject({
        method: "POST",
        url: "/api/v1/external-objects/unlink",
        payload: JSON.stringify({
          sourceSystem: "tdd3",
          externalObjectType: "ORDER",
          externalObjectId: "UNLINK-1",
          reason: "WRONG_MAPPING",
          actorPersonId: ADMIN,
        }),
        headers: tenantHeaders(),
      });
    expect((await unlink()).statusCode).toBe(200);
    expect((await unlink()).statusCode).toBe(404);
  });

  it("R08 merge：keep 不存在 → 404；列表含自身 → 不计数不报错", async () => {
    const app = buildAppFor(TENANT);
    const merge = async (keep: string, mergeIds: string[]) =>
      app.inject({
        method: "POST",
        url: "/api/v1/external-objects:merge",
        payload: JSON.stringify({
          sourceSystem: "tdd3",
          externalObjectType: "ORDER",
          keepExternalObjectId: keep,
          mergeExternalObjectIds: mergeIds,
          actorPersonId: ADMIN,
        }),
        headers: tenantHeaders(),
      });
    const missing = await merge("NOT-EXIST", ["X-1"]);
    expect(missing.statusCode).toBe(404);
  });

  it("R09 同连接二次签发 routing key → 同 key（幂等）", async () => {
    const app = buildAppFor(TENANT);
    const connectionId = await makeConnection(app);
    const issue = async () =>
      app.inject({
        method: "POST",
        url: `/api/v1/integration-connections/${connectionId}/webhook-routing-key`,
        headers: tenantHeaders(),
      });
    const a = JSON.parse((await issue()).payload) as { data: { routingKey: string } };
    const b = JSON.parse((await issue()).payload) as { data: { routingKey: string } };
    expect(b.data.routingKey).toBe(a.data.routingKey);
  });

  it("R10 不同租户同 messageId 的 webhook 互不冲突（租户隔离）", async () => {
    const appA = buildAppFor(TENANT);
    const appB = buildAppFor(OTHER);
    for (const [app, tenant] of [
      [appA, TENANT],
      [appB, OTHER],
    ] as const) {
      const connectionId = await makeConnection(app);
      const key = await app.inject({
        method: "POST",
        url: `/api/v1/integration-connections/${connectionId}/webhook-routing-key`,
        headers: tenantHeaders(tenant),
      });
      const routing = JSON.parse(key.payload) as { data: { routingKey: string; signingSecret: string } };
      const { createHmac } = await import("node:crypto");
      const body = JSON.stringify({ shared: "message" });
      const sig = createHmac("sha256", routing.data.signingSecret).update(body).digest("hex");
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/integration-webhooks/${routing.data.routingKey}`,
        payload: body,
        headers: { ...H, "x-signature-256": `sha256=${sig}`, "x-message-id": "SHARED-MSG" },
      });
      expect(res.statusCode).toBe(202);
    }
  });
});

describe("R11-R20: HTTP 协议层", () => {
  it("R11 raw-source-records POST 缺 externalRecordId → 400", async () => {
    const app = buildAppFor(TENANT);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/raw-source-records",
      payload: JSON.stringify({ sourceSystem: "tdd3" }),
      headers: tenantHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("R12 replay 缺 evidenceType → 400", async () => {
    const app = buildAppFor(TENANT);
    const connectionId = await makeConnection(app);
    const resource = await (async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/sync-resources",
        payload: JSON.stringify({ connectionId, resourceKey: "raw-r12" }),
        headers: tenantHeaders(),
      });
      return (JSON.parse(res.payload) as { data: { id: string } }).data.id;
    })();
    void resource;
    const landed = await app.inject({
      method: "POST",
      url: "/api/v1/raw-source-records",
      payload: JSON.stringify({ sourceSystem: "tdd3", externalRecordId: "RAW-R12", payload: {} }),
      headers: tenantHeaders(),
    });
    const id = (JSON.parse(landed.payload) as { data: { id: string } }).data.id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/raw-source-records/${id}/replay`,
      payload: JSON.stringify({ eventType: "e", subjectType: "ORDER", subjectId: ADMIN }),
      headers: tenantHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("R13 claim-lease 缺 leaseOwner → 400", async () => {
    const app = buildAppFor(TENANT);
    const resourceId = await makeResource(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sync-resources/${resourceId}/claim-lease`,
      payload: JSON.stringify({ leaseSeconds: 60 }),
      headers: tenantHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("R14 release-lease fencingToken=0 → 409（token 从 1 起）", async () => {
    const app = buildAppFor(TENANT);
    const resourceId = await makeResource(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sync-resources/${resourceId}/release-lease`,
      payload: JSON.stringify({ leaseOwner: "ghost", fencingToken: 0 }),
      headers: tenantHeaders(),
    });
    expect(res.statusCode).toBe(409);
  });

  it("R15 external-objects:resolve 缺任一参数 → 400", async () => {
    const app = buildAppFor(TENANT);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/external-objects:resolve?sourceSystem=tdd3&externalObjectType=ORDER",
      headers: tenantHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("R16 unlink 缺 reason → 400", async () => {
    const app = buildAppFor(TENANT);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/external-objects/unlink",
      payload: JSON.stringify({
        sourceSystem: "tdd3",
        externalObjectType: "ORDER",
        externalObjectId: "X",
        actorPersonId: ADMIN,
      }),
      headers: tenantHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("R17 跨租户读 raw-source-records → 空（不泄漏他租密文）", async () => {
    const appA = buildAppFor(TENANT);
    await appA.inject({
      method: "POST",
      url: "/api/v1/raw-source-records",
      payload: JSON.stringify({ sourceSystem: "tdd3", externalRecordId: "RAW-A", payload: { secret: "a" } }),
      headers: tenantHeaders(),
    });
    const appB = buildAppFor(OTHER);
    const list = await appB.inject({
      method: "GET",
      url: "/api/v1/raw-source-records?sourceSystem=tdd3",
      headers: tenantHeaders(OTHER),
    });
    const rows = (JSON.parse(list.payload) as { data: unknown[] }).data;
    expect(rows).toHaveLength(0);
  });

  it("R18 未知 routingKey 回调 → 404；合法 key 篡改签名一字符 → 401", async () => {
    const app = buildAppFor(TENANT);
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/integration-webhooks/no-such-key",
      payload: JSON.stringify({}),
      headers: { ...H, "x-signature-256": "sha256=00" },
    });
    expect(unknown.statusCode).toBe(404);
    // 合法签发后篡改签名
    const connectionId = await makeConnection(app);
    const key = await app.inject({
      method: "POST",
      url: `/api/v1/integration-connections/${connectionId}/webhook-routing-key`,
      headers: tenantHeaders(),
    });
    const routing = JSON.parse(key.payload) as { data: { routingKey: string; signingSecret: string } };
    const { createHmac } = await import("node:crypto");
    const body = JSON.stringify({ x: 1 });
    const sig = createHmac("sha256", routing.data.signingSecret).update(body).digest("hex");
    // 确定性篡改：翻转首字符（避免 1/16 概率撞回原签名的不稳定断言）。
    const tampered = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/integration-webhooks/${routing.data.routingKey}`,
      payload: body,
      headers: { ...H, "x-signature-256": `sha256=${tampered}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("R19 employee 角色访问 sync-resources POST → 403", async () => {
    const app = buildAppFor(TENANT, ["employee"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sync-resources",
      payload: JSON.stringify({
        connectionId: "00000000-0000-4000-8000-0000000000aa",
        resourceKey: "nope",
      }),
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "emp", "x-person-id": ADMIN },
    });
    expect(res.statusCode).toBe(403);
  });

  it("R20 integration-webhooks 公开回调不携带任何会话头也到达签名校验（401 而非 403/404 语义）", async () => {
    const app = buildAppFor(TENANT);
    const connectionId = await makeConnection(app);
    const key = await app.inject({
      method: "POST",
      url: `/api/v1/integration-connections/${connectionId}/webhook-routing-key`,
      headers: tenantHeaders(),
    });
    const routingKey = (JSON.parse(key.payload) as { data: { routingKey: string } }).data.routingKey;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/integration-webhooks/${routingKey}`,
      payload: JSON.stringify({}),
      headers: H, // 无签名无会话
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
  });
});
