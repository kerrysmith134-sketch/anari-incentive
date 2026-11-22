/**
 * 2026-11-21 审计包 Wave 2（P0）：凭据/映射保真/身份解析/外部入口。
 *
 * NP-005 SecretProvider：连接配置脱敏——API 响应与日志永不回显凭据值；
 * NP-006 mapping builder 保留 constants/transforms/method/body/cursorBodyKey/egressAllowlist；
 * NP-007 预设常量表达式（=前缀），常量不再被当作源路径查找；
 * NP-008 外部对象身份解析：非 UUID 主体走 ExternalObjectIdentity，未解析→隔离；
 * NP-009 webhook 不透明路由键 + 每连接签名 + 原始载荷落库；
 * NP-010 testConnection 真实 provider 探测（认证/端点/样例）。
 */
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import {
  buildHttpJsonConnectorConfig,
  HttpJsonConnector,
  FIELD_MAPPING_PRESETS,
  runSyncCycle,
  type SyncRequestFn,
} from "@anari/connectors";

const TENANT_A = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";

function buildAppFor(
  tenantId: string,
  options?: Parameters<typeof buildApp>[4],
) {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: tenantId,
      name: `Wave2 tenant ${tenantId.slice(-4)}`,
      slug: `wave2-${tenantId.slice(-4)}`,
    },
  });
  const app = buildApp(
    () => new Store(tenantId),
    undefined,
    {
      async authenticate() {
        return {
          tenantId,
          userId: "wave2-test",
          roles: ["admin", "integration"],
          personId: ADMIN,
        };
      },
    },
    platformStore,
    options,
  );
  return app;
}

function injectRequestFactory(app: Awaited<ReturnType<typeof buildApp>>): SyncRequestFn {
  return async <T>(path: string, init?: { method?: string; body?: string }) => {
    const res = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST" | "PUT",
      url: path,
      ...(init?.body
        ? { payload: init.body, headers: { "content-type": "application/json" } }
        : {}),
    });
    const payload = res.payload.toString();
    const parsed = payload ? (JSON.parse(payload) as { data?: T; error?: { message?: string } }) : {};
    if (res.statusCode >= 400) {
      throw new Error(parsed.error?.message ?? `HTTP ${res.statusCode}`);
    }
    return parsed.data as T;
  };
}

describe("NP-005: 连接凭据脱敏 + NP-010 真实探测", () => {
  it("INT-201 红线：config 敏感键 schema 拒绝；credentialRef-only 连接 GET 不回显敏感值", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    // A1 红线：config 带 Authorization header → schema 400（凭据只走 credentialRef）。
    // injectRequestFactory 对非 2xx 抛 ApiError——用捕获断言状态码。
    let rejectedStatus = 0;
    try {
      await inject("/api/v1/integration-connections", {
        method: "POST",
        body: JSON.stringify({
          provider: "generic",
          connectionName: `secret-${Date.now()}`,
          credentialRef: "vault/prod/api-key",
          config: {
            url: "https://provider.example/api",
            headers: {
              Authorization: "Bearer sk-super-secret-value",
              "X-Api-Key": "ak-another-secret",
            },
          },
        }),
      });
    } catch (caught) {
      rejectedStatus = /400|validation/i.test(caught instanceof Error ? caught.message : "") ? 400 : 0;
    }
    expect(rejectedStatus).toBe(400);
    // 合法路径：credentialRef-only → 创建成功，GET 响应无任何敏感值。
    const connection = await inject<{ id: string; config: Record<string, unknown> }>(
      "/api/v1/integration-connections",
      {
        method: "POST",
        body: JSON.stringify({
          provider: "generic",
          connectionName: `secret-ok-${Date.now()}`,
          credentialRef: "vault/prod/api-key",
          config: { url: "https://provider.example/api" },
        }),
      },
    );
    const fetched = await inject<Record<string, unknown>>(
      `/api/v1/integration-connections/${connection.id}`,
    );
    const raw = JSON.stringify(fetched);
    expect(raw).not.toContain("sk-super-secret-value");
    expect(raw).not.toContain("ak-another-secret");
    // credentialRef 本身允许回显（是引用不是值）。
    expect(raw).toContain("vault/prod/api-key");
  });

  it("NP-010：testConnection 通过注入探针真实请求 provider——成功含样例与时间，失败含脱敏诊断", async () => {
    // 状态化探针（buildApp options 注入）：默认成功，可切换失败。
    let probeResult: {
      ok: boolean;
      status?: number;
      detail?: string;
      sample?: unknown;
    } = { ok: true, sample: { records: [{ record_id: "PR-1" }] } };
    const probe = vi.fn(async () => probeResult);
    const app = buildAppFor(TENANT_A, { integrationProbe: probe });
    const inject = injectRequestFactory(app);
    const connection = await inject<{ id: string }>("/api/v1/integration-connections", {
      method: "POST",
      body: JSON.stringify({
        provider: "generic",
        connectionName: `probe-${Date.now()}`,
        credentialRef: "vault/prod/api-key",
        config: { url: "https://provider.example/api", probePath: "/orders" },
      }),
    });
    const ok = await inject<{
      ok: boolean;
      checks: Array<{ name: string; ok: boolean; detail?: string }>;
      sample?: unknown;
      testedAt?: string;
    }>(`/api/v1/integration-connections/${connection.id}/test`);
    expect(ok.ok).toBe(true);
    expect(ok.checks.some((check) => check.name.includes("provider"))).toBe(true);
    expect(ok.sample).toBeDefined();
    expect(ok.testedAt).toBeTruthy();
    expect(probe).toHaveBeenCalled();

    // 失败探测：诊断不含凭据值。
    probeResult = { ok: false, status: 401, detail: "provider returned 401 unauthorized" };
    const bad = await inject<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> }>(
      `/api/v1/integration-connections/${connection.id}/test`,
    );
    expect(bad.ok).toBe(false);
    const providerCheck = bad.checks.find((check) => check.name.includes("provider"))!;
    expect(providerCheck.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("sk-super-secret-value");
  });
});

describe("NP-006/007: mapping builder 保真与常量表达式", () => {
  it("builder 保留 constants/transforms/method/body/cursorBodyKey/egressAllowlist", () => {
    const config = buildHttpJsonConnectorConfig(
      {
        provider: "generic",
        credentialRef: "v",
        config: {
          url: "https://provider.example/search",
          method: "POST",
          body: { query: "deals" },
          cursorBodyKey: "after",
          egressAllowlist: ["provider.example"],
        },
      },
      {
        mappingType: "HTTP_JSON",
        sourceSystem: "crm",
        fieldMap: {
          sourceRecordId: "id",
          eventType: "properties.dealstage",
          subjectType: "=ORDER",
          subjectId: "properties.associatedcompanyid",
          evidenceType: "=CRM_DEAL",
          occurredAt: "properties.closedate|date",
        },
        config: {
          constants: { subjectType: "ORDER", evidenceType: "CRM_DEAL" },
          transforms: { occurredAt: ["date"] },
        },
      },
    );
    expect(config).not.toBeNull();
    expect(config!.method).toBe("POST");
    expect(config!.body).toEqual({ query: "deals" });
    expect(config!.cursorBodyKey).toBe("after");
    expect(config!.egressAllowlist).toEqual(["provider.example"]);
    expect(config!.columns.constants?.evidenceType).toBe("CRM_DEAL");
    expect(config!.columns.transforms?.occurredAt).toEqual(["date"]);
  });

  it("常量表达式（=前缀）与列级 constants 均生效——不再把常量当源路径查找", async () => {
    const providerFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        records: [
          {
            id: "D-1",
            properties: { dealstage: "closedwon", closedate: "2026-10-15", company: "00000000-0000-4000-8000-0000000000e5" },
          },
        ],
        next_cursor: null,
      }),
      headers: new Headers(),
      redirected: false,
      url: "x",
    })) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "crm",
      url: "https://provider.example/api/deals",
      columns: {
        sourceRecordId: "id",
        eventType: "properties.dealstage",
        subjectType: "=ORDER",
        subjectId: "properties.company",
        evidenceType: "=CRM_DEAL",
        occurredAt: "properties.closedate",
      },
      fetchImpl: providerFetch,
    });
    const pulled = await connector.pull(null);
    expect(pulled.events).toHaveLength(1);
    const event = pulled.events[0]! as unknown as Record<string, unknown>;
    expect(event.evidenceType).toBe("CRM_DEAL");
    expect(event.subjectType).toBe("ORDER");
    expect(event.subjectId).toBe("00000000-0000-4000-8000-0000000000e5");
  });

  it("NP-007：预设 evidenceType 使用 =常量表达式；preset 造出的映射经 connector 拉取后 evidenceType 非空", async () => {
    for (const preset of FIELD_MAPPING_PRESETS) {
      const evidence = preset.fieldMap.evidenceType ?? "";
      if (preset.config.targetType === "EVIDENCE" || preset.targetType === "EVIDENCE") {
        expect(evidence.startsWith("="), `${preset.code} evidenceType should be a constant`).toBe(true);
      }
    }
    // ERP 预设端到端：拉取记录后 evidenceType/subjectType 来自常量。
    const erp = FIELD_MAPPING_PRESETS.find((preset) => preset.code === "erp-orders")!;
    const providerFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        records: [
          {
            order_id: "O-1",
            event_type: "created",
            occurred_at: "2026-10-18T00:00:00.000Z",
            amount: "500",
            currency: "CNY",
          },
        ],
      }),
      headers: new Headers(),
      redirected: false,
      url: "x",
    })) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: erp.sourceSystem,
      url: "https://erp.example/api/orders",
      columns: {
        sourceRecordId: erp.fieldMap.sourceRecordId!,
        eventType: erp.fieldMap.eventType!,
        subjectType: erp.fieldMap.subjectType!,
        subjectId: erp.fieldMap.subjectId!,
        evidenceType: erp.fieldMap.evidenceType!,
        occurredAt: erp.fieldMap.occurredAt,
      },
      fetchImpl: providerFetch,
    });
    const pulled = await connector.pull(null);
    expect((pulled.events[0] as unknown as Record<string, unknown>).evidenceType).toBe("ERP_ORDER");
  });
});

describe("NP-008: 外部对象身份解析", () => {
  it("resolve 端点：命中返回内部对象；未命中 404；upsert 注册后可解析", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const internalId = "00000000-0000-4000-8000-0000000000e6";
    await inject("/api/v1/external-objects", {
      method: "POST",
      body: JSON.stringify({
        sourceSystem: "crm",
        externalObjectType: "COMPANY",
        externalObjectId: "HUB-777",
        internalObjectType: "ORDER",
        internalObjectId: internalId,
        matchRule: "MANUAL",
      }),
    });
    const resolved = await inject<{ internalObjectId: string }>(
      "/api/v1/external-objects:resolve?sourceSystem=crm&externalObjectType=COMPANY&externalObjectId=HUB-777",
    );
    expect(resolved.internalObjectId).toBe(internalId);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/external-objects:resolve?sourceSystem=crm&externalObjectType=COMPANY&externalObjectId=MISSING",
      headers: { "x-tenant-id": TENANT_A, "x-user-id": "wave2-test", "x-person-id": ADMIN },
    });
    expect(res.statusCode).toBe(404);
  });

  it("runner：非 UUID 主体经身份解析替换；未解析 → UNRESOLVED_IDENTITY 隔离", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const providerUrl = "https://provider.example/api/deals2";
    const injectSeed = injectRequestFactory(app);
    const connection = await injectSeed<{ id: string }>("/api/v1/integration-connections", {
      method: "POST",
      body: JSON.stringify({
        provider: "generic",
        connectionName: `np8-${Date.now()}`,
        credentialRef: "vault/creds",
        config: { url: providerUrl, recordsPath: "records" },
      }),
    });
    await injectSeed(`/api/v1/integration-connections/${connection.id}/mappings`, {
      method: "POST",
      body: JSON.stringify({
        name: "np8 mapping",
        mappingType: "HTTP_JSON",
        sourceSystem: "crm",
        targetType: "EVIDENCE",
        fieldMap: {
          sourceRecordId: "id",
          eventType: "event_type",
          subjectType: "subject_type",
          subjectId: "subject_id",
          evidenceType: "=ACTIVITY",
          occurredAt: "occurred_at",
        },
        config: {},
        version: 1,
      }),
    });
    await injectSeed(`/api/v1/integration-connections/${connection.id}/schedules`, {
      method: "POST",
      body: JSON.stringify({ name: `np8-sched-${Date.now()}`, intervalMinutes: 60 }),
    });
    // 注册一个外部身份（HUB-1 → 内部 ORDER UUID），HUB-404 不注册。
    await inject("/api/v1/external-objects", {
      method: "POST",
      body: JSON.stringify({
        sourceSystem: "crm",
        externalObjectType: "ORDER",
        externalObjectId: "HUB-1",
        internalObjectType: "ORDER",
        internalObjectId: "00000000-0000-4000-8000-0000000000e7",
        matchRule: "MANUAL",
      }),
    });
    const providerFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        records: [
          { id: "E1", event_type: "created", subject_type: "ORDER", subject_id: "HUB-1", occurred_at: "2026-10-18T00:00:00.000Z" },
          { id: "E2", event_type: "created", subject_type: "ORDER", subject_id: "HUB-404", occurred_at: "2026-10-18T00:00:00.000Z" },
        ],
      }),
      headers: new Headers(),
      redirected: false,
      url: "x",
    })) as unknown as typeof fetch;
    const summary = await runSyncCycle({
      request: inject,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 2 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer foundation-test",
    });
    expect(summary.schedules[0]!.status).toBe("SUCCEEDED");
    expect(summary.schedules[0]!.counters.recordsUpserted).toBe(1);
    expect(summary.schedules[0]!.counters.recordsQuarantined).toBe(1);
    // 已解析的事件以内部 UUID 入库（证据 subjectId = 内部对象）。
    const evidence = await inject<Array<{ subjectId: string; sourceSystem: string }>>(
      "/api/v1/evidence?subjectType=ORDER&subjectId=00000000-0000-4000-8000-0000000000e7",
    );
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((node) => node.sourceSystem === "crm")).toBe(true);
    const quarantine = await inject<Array<{ externalRecordId: string | null; reason: string }>>(
      "/api/v1/ingestion-quarantine?sourceSystem=crm",
    );
    const unresolved = quarantine.find((record) => record.externalRecordId === "E2");
    expect(unresolved?.reason).toBe("UNRESOLVED_IDENTITY");
  });
});

describe("NP-009: webhook 不透明路由键 + 原始载荷", () => {
  it("连接可签发 routing key；签名回调无需员工 bearer 即可入库且保留原始载荷", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const connection = await inject<{ id: string }>("/api/v1/integration-connections", {
      method: "POST",
      body: JSON.stringify({
        provider: "generic",
        connectionName: `hook-${Date.now()}`,
        credentialRef: "vault/creds",
        config: { url: "https://provider.example" },
      }),
    });
    // 签名密钥只在签发时一次性返回（之后任何响应都不再含它）。
    const routing = await inject<{ routingKey: string; signingSecret: string }>(
      `/api/v1/integration-connections/${connection.id}/webhook-routing-key`,
      { method: "POST" },
    );
    expect(routing.routingKey).toMatch(/^[a-z0-9]{16,}$/i);
    expect(routing.signingSecret).toMatch(/^.{16,}$/);
    const leaked = JSON.stringify(
      await inject<Record<string, unknown>>(
        `/api/v1/integration-connections/${connection.id}`,
      ),
    );
    expect(leaked).not.toContain(routing.signingSecret);

    // 供应商带 HMAC 签名回调（无需员工会话——路由键即租户入口）。
    const crypto = await import("node:crypto");
    const bodyText = JSON.stringify({ event: "deal.updated", dealId: "D-9" });
    const signature = crypto
      .createHmac("sha256", routing.signingSecret)
      .update(bodyText)
      .digest("hex");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/integration-webhooks/${routing.routingKey}`,
      payload: bodyText,
      headers: {
        "content-type": "application/json",
        "x-signature-256": `sha256=${signature}`,
        "x-message-id": "MSG-9",
      },
    });
    expect(res.statusCode).toBe(202);
    // 原始载荷已落库：webhook 收件箱按来源可查（process 端点消费）。
    const inbox = await inject<Array<{ messageId: string }>>(
      "/api/v1/webhook-inbox?sourceSystem=generic",
    );
    expect(inbox.some((entry) => entry.messageId === "MSG-9")).toBe(true);
    // 无效签名被拒（401 而非 403——无需会话的公开路由）。
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/integration-webhooks/${routing.routingKey}`,
      payload: bodyText,
      headers: {
        "content-type": "application/json",
        "x-signature-256": "sha256=deadbeef",
        "x-message-id": "MSG-BAD",
      },
    });
    expect(bad.statusCode).toBe(401);
  });
});
