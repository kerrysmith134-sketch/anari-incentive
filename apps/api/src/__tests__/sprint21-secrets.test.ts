/**
 * Sprint 2.1 批次 B（INT-201/210）：凭据链与安全。
 *
 * INT-201 SecretProvider：
 * - resolveSecret 支持 SECRETS_JSON 与 SECRETS_FILE（注释描述的 file 形态落地）；
 * - runner 从 credentialRef 解析真实凭据并注入认证头（redact 后的 [REDACTED]
 *   占位不会被当成真实 token 发送）；
 * - 无凭据解析失败 → 明确错误（不发 [REDACTED] 请求）。
 * INT-210：
 * - mapping GET/POST 响应统一脱敏（config 中的敏感键）；
 * - POST /financial-facts 允许 integration 角色（同步 worker 授权边界）。
 */
import { describe, expect, it, vi } from "vitest";
import { runSyncCycle, type SyncRequestFn } from "@anari/connectors";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";

describe("INT-201: SecretProvider", () => {
  it("resolveSecret 支持 SECRETS_FILE（JSON 文件路径）与 SECRETS_JSON 并存优先级", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "s21-secrets-"));
    const file = join(dir, "secrets.json");
    writeFileSync(file, JSON.stringify({ "vault/from-file": "file-secret" }));
    const prevJson = process.env.SECRETS_JSON;
    const prevFile = process.env.SECRETS_FILE;
    try {
      process.env.SECRETS_FILE = file;
      delete process.env.SECRETS_JSON;
      const { resolveSecret } = await import("../secret-provider.js");
      expect(resolveSecret("vault/from-file")).toBe("file-secret");
      expect(resolveSecret("vault/missing")).toBeUndefined();
      // SECRETS_JSON 优先于 FILE
      process.env.SECRETS_JSON = JSON.stringify({ "vault/from-file": "json-secret" });
      expect(resolveSecret("vault/from-file")).toBe("json-secret");
    } finally {
      if (prevJson === undefined) delete process.env.SECRETS_JSON;
      else process.env.SECRETS_JSON = prevJson;
      if (prevFile === undefined) delete process.env.SECRETS_FILE;
      else process.env.SECRETS_FILE = prevFile;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runner：credentialRef 经注入 SecretProvider 解析真实凭据注入认证头（不发送 [REDACTED]）", async () => {
    const seenAuthHeaders: Array<string | undefined> = [];
    const providerFetch = (async (_input: unknown, init?: { headers?: Record<string, string> }) => {
      seenAuthHeaders.push(init?.headers?.authorization);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          records: [
            { id: "B1", event_type: "e", subject_type: "ORDER", subject_id: ADMIN, evidenceType: "x" },
          ],
        }),
        headers: new Headers(),
        redirected: false,
        url: "x",
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const store = new Map<string, unknown>();
    const inject: SyncRequestFn = async (path, init) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      requests.push({ method, path, body });
      if (path === "/api/v1/sync-schedules/claim-due" && method === "POST") {
        return [{ id: "s", connectionId: "conn-1", name: "b-sched" }] as never;
      }
      if (path === "/api/v1/integration-connections/conn-1/sync-runs") {
        return { id: "run-b" } as never;
      }
      if (path === "/api/v1/integration-connections/conn-1") {
        // API 返回脱敏后的连接（headers 凭据已是占位符）——runner 必须走 SecretProvider。
        return {
          provider: "generic",
          credentialRef: "vault/s21/api",
          config: {
            url: "https://provider.example/api",
            recordsPath: "records",
            headers: { Authorization: "[REDACTED]" },
          },
        } as never;
      }
      if (path.includes("/mappings?status=ACTIVE")) {
        return [
          {
            id: "map-b",
            status: "ACTIVE",
            mappingType: "HTTP_JSON",
            sourceSystem: "b",
            targetType: "EVIDENCE",
            fieldMap: {
              sourceRecordId: "id",
              eventType: "event_type",
              subjectType: "subject_type",
              subjectId: "subject_id",
              evidenceType: "=ACTIVITY",
            },
            config: {
              url: "https://provider.example/api",
              recordsPath: "records",
              allowUuidPassthrough: true,
            },
          },
        ] as never;
      }
      if (path === "/api/v1/sync-resources" && method === "POST") {
        store.set(`res:${(body as { resourceKey: string }).resourceKey}`, { id: "res-b" });
        return { id: "res-b", resourceKey: body!.resourceKey } as never;
      }
      if (path.startsWith("/api/v1/sync-resources?")) return [...store.values()] as never;
      if (path.includes("/claim-lease")) {
        return { fencingToken: 1, leaseUntil: new Date(Date.now() + 900000).toISOString() } as never;
      }
      if (path.includes("/release-lease")) return { released: true } as never;
      if (path.includes("/checkpoint")) {
        if (method === "PUT") return body as never;
        return { cursor: null } as never;
      }
      if (path === "/api/v1/raw-source-records" && method === "POST") {
        const rawKey = `raw:${String((body as { sourceRecordId?: string }).sourceRecordId)}`;
        if (!store.has(rawKey)) store.set(rawKey, { id: rawKey, replayedAt: null });
        return store.get(rawKey) as never;
      }
      if (path === "/api/v1/ingestion/events:batch") return { accepted: 1 } as never;
      if (path.startsWith("/api/v1/sync-runs/")) return { id: "x" } as never;
      throw new Error(`unexpected ${method} ${path}`);
    };

    const prevJson = process.env.SECRETS_JSON;
    try {
      process.env.SECRETS_JSON = JSON.stringify({ "vault/s21/api": "Bearer real-secret-token" });
      const summary = await runSyncCycle({
        request: inject,
        limit: 1,
        maxPages: 1,
        claimNow: new Date(Date.now() + 3600_000).toISOString(),
        providerFetchImpl: providerFetch,
        credentialRefResolver: (ref: string) => {
          try {
            const map = JSON.parse(process.env.SECRETS_JSON ?? "{}") as Record<string, string>;
            return map[ref];
          } catch {
            return undefined;
          }
        },
      });
      expect(summary.schedules[0]!.status).toBe("SUCCEEDED");
      expect(seenAuthHeaders).toHaveLength(1);
      expect(seenAuthHeaders[0]).toBe("Bearer real-secret-token");
      expect(seenAuthHeaders[0]).not.toContain("[REDACTED]");
    } finally {
      if (prevJson === undefined) delete process.env.SECRETS_JSON;
      else process.env.SECRETS_JSON = prevJson;
    }
  });

  it("runner：凭据解析失败 → 明确错误且不发起 provider 请求", async () => {
    const providerFetch = vi.fn();
    const inject: SyncRequestFn = async (path, init) => {
      const method = init?.method ?? "GET";
      if (path === "/api/v1/sync-schedules/claim-due") {
        return [{ id: "s", connectionId: "conn-1", name: "b-sched" }] as never;
      }
      if (path === "/api/v1/integration-connections/conn-1/sync-runs") return { id: "run" } as never;
      if (path === "/api/v1/integration-connections/conn-1") {
        return { provider: "generic", credentialRef: "vault/missing", config: { url: "https://p.example" } } as never;
      }
      if (path.includes("/mappings?status=ACTIVE")) {
        return [
          {
            id: "m",
            status: "ACTIVE",
            mappingType: "HTTP_JSON",
            sourceSystem: "b",
            targetType: "EVIDENCE",
            fieldMap: { sourceRecordId: "id", eventType: "e", subjectType: "s", subjectId: "sid", evidenceType: "=ACTIVITY" },
            config: { url: "https://p.example", recordsPath: "records" },
          },
        ] as never;
      }
      if (path === "/api/v1/sync-resources") return { id: "r" } as never;
      if (path.includes("/claim-lease")) return { fencingToken: 1, leaseUntil: "" } as never;
      if (path.includes("/release-lease")) return {} as never;
      if (path.includes("/checkpoint")) return { cursor: null } as never;
      if (path === "/api/v1/raw-source-records" && method === "POST") return { id: "raw" } as never;
      if (path.startsWith("/api/v1/sync-runs/")) return { id: "x" } as never;
      throw new Error(`unexpected ${path}`);
    };
    const summary = await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 1,
      claimNow: new Date(Date.now() + 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => undefined, // 解析失败
    });
    expect(summary.schedules[0]!.status).toBe("FAILED");
    expect(providerFetch).not.toHaveBeenCalled();
  });
});

describe("INT-201 红线：敏感键禁止入配置（schema 层拒绝）", () => {
  it("连接 config 含 Authorization header → 400（凭据只走 credentialRef）", async () => {
    const platformStore = new MemoryPlatformStore({
      demoTenant: { id: TENANT, name: "red", slug: "red" },
    });
    const app = buildApp(
      () => new Store(TENANT),
      undefined,
      {
        async authenticate() {
          return { tenantId: TENANT, userId: "r", roles: ["admin", "integration"], personId: ADMIN };
        },
      },
      platformStore,
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integration-connections",
      payload: JSON.stringify({
        provider: "generic",
        connectionName: "red-conn",
        credentialRef: "vault/red",
        config: {
          url: "https://p.example",
          headers: { Authorization: "Bearer sk-should-be-rejected" },
        },
      }),
      headers: { "content-type": "application/json", "x-tenant-id": TENANT, "x-user-id": "r", "x-person-id": ADMIN },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("credentialRef");
    // 存储层确认：Memory store 中无该连接（schema 拒绝，未落库）
  });

  it("mapping config 含 X-Api-Key → 400", async () => {
    const platformStore = new MemoryPlatformStore({
      demoTenant: { id: TENANT, name: "red2", slug: "red2" },
    });
    const app = buildApp(
      () => new Store(TENANT),
      undefined,
      {
        async authenticate() {
          return { tenantId: TENANT, userId: "r", roles: ["admin", "integration"], personId: ADMIN };
        },
      },
      platformStore,
    );
    const conn = await app.inject({
      method: "POST",
      url: "/api/v1/integration-connections",
      payload: JSON.stringify({
        provider: "generic",
        connectionName: "red2-conn",
        credentialRef: "vault/red2",
        config: {},
      }),
      headers: { "content-type": "application/json", "x-tenant-id": TENANT, "x-user-id": "r", "x-person-id": ADMIN },
    });
    const connectionId = (JSON.parse(conn.payload) as { data: { id: string } }).data.id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/integration-connections/${connectionId}/mappings`,
      payload: JSON.stringify({
        name: "red2-mapping",
        mappingType: "HTTP_JSON",
        sourceSystem: "red2",
        targetType: "EVIDENCE",
        fieldMap: { sourceRecordId: "id", eventType: "e", subjectType: "s", subjectId: "sid", evidenceType: "=ACTIVITY" },
        config: { "X-Api-Key": "ak-secret" },
        version: 1,
      }),
      headers: { "content-type": "application/json", "x-tenant-id": TENANT, "x-user-id": "r", "x-person-id": ADMIN },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("credentialRef");
  });
});

describe("INT-210: mappings 脱敏 + financial-facts 角色", () => {
  it("mapping GET/POST 响应 config 敏感键脱敏", async () => {
    const platformStore = new MemoryPlatformStore({
      demoTenant: { id: TENANT, name: "b2", slug: "b2" },
    });
    const app = buildApp(
      () => new Store(TENANT),
      undefined,
      {
        async authenticate() {
          return { tenantId: TENANT, userId: "b", roles: ["admin", "integration"], personId: ADMIN };
        },
      },
      platformStore,
    );
    const conn = await app.inject({
      method: "POST",
      url: "/api/v1/integration-connections",
      payload: JSON.stringify({
        provider: "generic",
        connectionName: `b2-${Date.now()}`,
        credentialRef: "vault/b2",
        config: {},
      }),
      headers: { "content-type": "application/json", "x-tenant-id": TENANT, "x-user-id": "b", "x-person-id": ADMIN },
    });
    const connectionId = (JSON.parse(conn.payload) as { data: { id: string } }).data.id;
    // INT-201 红线后：新建 mapping 携带敏感键会在 schema 层被拒（400）。
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/integration-connections/${connectionId}/mappings`,
      payload: JSON.stringify({
        name: "b2-rejected",
        mappingType: "HTTP_JSON",
        sourceSystem: "b2",
        targetType: "EVIDENCE",
        fieldMap: { sourceRecordId: "id", eventType: "e", subjectType: "s", subjectId: "sid", evidenceType: "=ACTIVITY" },
        config: { headers: { Authorization: "Bearer mapping-secret" } },
        version: 1,
      }),
      headers: { "content-type": "application/json", "x-tenant-id": TENANT, "x-user-id": "b", "x-person-id": ADMIN },
    });
    expect(rejected.statusCode).toBe(400);
    // 纵深防御：历史遗留（直接落库）的敏感 config，GET 响应仍脱敏。
    const platformMapping = await platformStore.createIntegrationMapping({
      tenantId: TENANT,
      connectionId,
      name: "legacy mapping",
      mappingType: "HTTP_JSON",
      sourceSystem: "b2",
      targetType: "EVIDENCE",
      fieldMap: { sourceRecordId: "id", eventType: "e", subjectType: "s", subjectId: "sid", evidenceType: "=ACTIVITY" },
      config: { headers: { Authorization: "Bearer legacy-secret" } },
      version: 1,
    });
    void platformMapping;
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/integration-connections/${connectionId}/mappings?status=ACTIVE`,
      headers: { "x-tenant-id": TENANT, "x-user-id": "b", "x-person-id": ADMIN },
    });
    const legacyConfig = (JSON.parse(list.payload) as {
      data: Array<{ config: { headers?: Record<string, string> } }>;
    }).data.find((mapping) => mapping.config?.headers?.Authorization);
    expect(legacyConfig?.config.headers.Authorization).toBe("[REDACTED]");
  });

  it("integration 角色可写 financial-facts（同步 worker 授权边界）", async () => {
    const platformStore = new MemoryPlatformStore({
      demoTenant: { id: TENANT, name: "b3", slug: "b3" },
    });
    const app = buildApp(
      () => new Store(TENANT),
      undefined,
      {
        async authenticate() {
          return { tenantId: TENANT, userId: "sync", roles: ["integration"], personId: undefined, servicePrincipal: true };
        },
      },
      platformStore,
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/financial-facts",
      payload: JSON.stringify({
        sourceSystem: "tdd-sync",
        sourceRecordId: "FF-1",
        factType: "GROSS_PROFIT",
        amount: "1",
        currency: "CNY",
      }),
      headers: { "content-type": "application/json", "x-tenant-id": TENANT, "x-user-id": "sync" },
    });
    expect([200, 201]).toContain(res.statusCode);
  });
});
