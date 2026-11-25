/**
 * 2026-11-21 审计包 Wave 1（P0）：资源同步管道闭环。
 *
 * NP-001 SyncResource/SyncCheckpoint/Quarantine 端点与 Store 全链路；
 * NP-002 runner 全流程走真实 API；
 * NP-003 checkpoint 只在目标写入成功后推进（注入失败不丢数据、可重放）；
 * NP-004 FinancialFact 金额/币种类型化（拒绝硬编码 0/CNY、不吞错误）；
 * NP-015 路由由 mapping.targetType 决定（不再从 evidenceType 猜测）；
 * NP-016 运行计数与逐条结果精确对账。
 */
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import { runSyncCycle, SyncRequestError, type SyncRequestFn } from "@anari/connectors";

const TENANT_A = "00000000-0000-4000-8000-000000000001";
const TENANT_B = "00000000-0000-4000-8000-000000000009";
const ADMIN = "00000000-0000-4000-8000-000000000001";

function buildAppFor(tenantId: string) {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: tenantId,
      name: `Sync test tenant ${tenantId.slice(-4)}`,
      slug: `sync-test-${tenantId.slice(-4)}`,
    },
  });
  const app = buildApp(
    () => new Store(tenantId),
    undefined,
    {
      async authenticate() {
        return {
          tenantId,
          userId: "sync-test",
          roles: ["admin", "integration"],
          personId: ADMIN,
        };
      },
    },
    platformStore,
  );
  return app;
}

/** 把 buildApp 包成 runner 的 request 函数（dev 头 + envelope 解包）。 */
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
    const parsed = payload ? (JSON.parse(payload) as { data?: T; error?: { message?: string; code?: string } }) : {};
    if (res.statusCode >= 400) {
      throw new SyncRequestError(
        parsed.error?.message ?? `HTTP ${res.statusCode}`,
        res.statusCode,
        parsed.error?.code,
      );
    }
    return parsed.data as T;
  };
}

async function seedConnectionMappingSchedule(
  app: Awaited<ReturnType<typeof buildApp>>,
  providerUrl: string,
  targetType: string,
) {
  const inject = injectRequestFactory(app);
  const connection = await inject<{ id: string }>("/api/v1/integration-connections", {
    method: "POST",
    body: JSON.stringify({
      provider: "generic",
      connectionName: `wave1-${Date.now()}`,
      credentialRef: "vault/creds",
      config: { url: providerUrl, recordsPath: "records", nextCursorPath: "next_cursor" },
    }),
  });
  const mapping = await inject<{ id: string; targetType: string }>(
    `/api/v1/integration-connections/${connection.id}/mappings`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "wave1 mapping",
        mappingType: "HTTP_JSON",
        sourceSystem: "wave1-system",
        targetType,
        fieldMap: {
          sourceRecordId: "record_id",
          eventType: "event_type",
          subjectType: "subject_type",
          subjectId: "subject_id",
          evidenceType: "evidence_type",
          occurredAt: "occurred_at",
          sourceUpdatedAt: "updated_at",
        },
        config: { allowUuidPassthrough: true },
        version: 1,
      }),
    },
  );
  const schedule = await inject<{ id: string; connectionId: string; name: string }>(
    `/api/v1/integration-connections/${connection.id}/schedules`,
    {
      method: "POST",
      body: JSON.stringify({
        name: `wave1-sched-${Date.now()}`,
        intervalMinutes: 60,
      }),
    },
  );
  return { inject, connection, mapping, schedule };
}

interface ProviderResponse {
  records: Array<Record<string, unknown>>;
  next_cursor?: string | null;
}

/** 极简 provider stub：按路径返回固定 records，可编程单次故障。 */
function stubProviderFetch(responses: ProviderResponse[], failOnNth?: number) {
  let calls = 0;
  return vi.fn(async (input: unknown) => {
    calls += 1;
    if (failOnNth !== undefined && calls >= failOnNth) {
      throw new Error("PROVIDER_FETCH_INJECTED_FAILURE");
    }
    const response = responses[Math.min(calls - 1, responses.length - 1)]!;
    return {
      ok: true,
      status: 200,
      json: async () => response,
      headers: new Headers(),
      redirected: false,
      url: String(input),
    } as unknown as Response;
  });
}

describe("NP-001: sync-resources / checkpoint / quarantine 端点", () => {
  it("POST 创建资源 + 重复 409 + GET 列表过滤", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const connection = await inject<{ id: string }>("/api/v1/integration-connections", {
      method: "POST",
      body: JSON.stringify({
        provider: "generic",
        connectionName: `conn-${Date.now()}`,
        credentialRef: "vault/creds",
        config: {},
      }),
    });
    const created = await inject<{ id: string; resourceKey: string; status: string }>(
      "/api/v1/sync-resources",
      {
        method: "POST",
        body: JSON.stringify({
          connectionId: connection.id,
          resourceKey: "mapping-1",
        }),
      },
    );
    expect(created.resourceKey).toBe("mapping-1");
    expect(created.status).toBe("ACTIVE");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sync-resources",
      payload: JSON.stringify({
        connectionId: connection.id,
        resourceKey: "mapping-1",
      }),
      headers: { "content-type": "application/json", "x-tenant-id": TENANT_A, "x-user-id": "sync-test", "x-person-id": ADMIN },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("SYNC_RESOURCE_EXISTS");
    const list = await inject<Array<{ resourceKey: string }>>(
      `/api/v1/sync-resources?connectionId=${connection.id}`,
    );
    expect(list.map((r) => r.resourceKey)).toEqual(["mapping-1"]);
  });

  it("checkpoint 默认空游标；PUT 持久化后 GET 返回", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const connection = await inject<{ id: string }>("/api/v1/integration-connections", {
      method: "POST",
      body: JSON.stringify({
        provider: "generic",
        connectionName: `conn-${Date.now()}`,
        credentialRef: "vault/creds",
        config: {},
      }),
    });
    const resource = await inject<{ id: string }>("/api/v1/sync-resources", {
      method: "POST",
      body: JSON.stringify({
        connectionId: connection.id,
        resourceKey: "r1",
      }),
    });
    const fresh = await inject<{ cursor: string | null }>(
      `/api/v1/sync-resources/${resource.id}/checkpoint`,
    );
    expect(fresh.cursor).toBeNull();
    // INT-205：只有租约持有人可以推进 checkpoint。
    const lease = await inject<{ fencingToken: number }>(
      `/api/v1/sync-resources/${resource.id}/claim-lease`,
      { method: "POST", body: JSON.stringify({ leaseOwner: "cp-test", leaseSeconds: 300 }) },
    );
    await inject(`/api/v1/sync-resources/${resource.id}/checkpoint`, {
      method: "PUT",
      body: JSON.stringify({
        cursor: "cursor-42",
        lastRunId: "00000000-0000-4000-8000-0000000000cc",
        leaseOwner: "cp-test",
        fencingToken: lease.fencingToken,
      }),
    });
    const saved = await inject<{ cursor: string | null; lastRunId: string | null }>(
      `/api/v1/sync-resources/${resource.id}/checkpoint`,
    );
    expect(saved.cursor).toBe("cursor-42");
    expect(saved.lastRunId).toBe("00000000-0000-4000-8000-0000000000cc");
  });

  it("quarantine 写入 + 列表 + 非法 reason 400", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const record = await inject<{ id: string; reason: string }>(
      "/api/v1/ingestion-quarantine",
      {
        method: "POST",
        body: JSON.stringify({
          sourceSystem: "wave1-system",
          externalRecordId: "REC-1",
          reason: "SCHEMA_MISMATCH",
          payload: { raw: { a: 1 } },
        }),
      },
    );
    expect(record.reason).toBe("SCHEMA_MISMATCH");
    const list = await inject<Array<{ externalRecordId: string | null }>>(
      "/api/v1/ingestion-quarantine?sourceSystem=wave1-system",
    );
    expect(list.map((r) => r.externalRecordId)).toContain("REC-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ingestion-quarantine",
      payload: JSON.stringify({
        sourceSystem: "wave1-system",
        externalRecordId: "REC-2",
        reason: "NOT_A_VALID_REASON",
        payload: {},
      }),
      headers: { "content-type": "application/json", "x-tenant-id": TENANT_A, "x-user-id": "sync-test", "x-person-id": ADMIN },
    });
    expect(res.statusCode).toBe(400);
  });

  it("跨租户隔离：租户 B 看不到租户 A 的资源/checkpoint/quarantine", async () => {
    const appA = buildAppFor(TENANT_A);
    const injectA = injectRequestFactory(appA);
    const connection = await injectA<{ id: string }>("/api/v1/integration-connections", {
      method: "POST",
      body: JSON.stringify({
        provider: "generic",
        connectionName: `conn-${Date.now()}`,
        credentialRef: "vault/creds",
        config: {},
      }),
    });
    const resource = await injectA<{ id: string }>("/api/v1/sync-resources", {
      method: "POST",
      body: JSON.stringify({
        connectionId: connection.id,
        resourceKey: "rA",
      }),
    });
    await injectA("/api/v1/ingestion-quarantine", {
      method: "POST",
      body: JSON.stringify({
        sourceSystem: "sys",
        externalRecordId: "Q-A",
        reason: "OTHER",
        payload: {},
      }),
    });
    const appB = buildAppFor(TENANT_B);
    const resCheckpoint = await appB.inject({
      method: "GET",
      url: `/api/v1/sync-resources/${resource.id}/checkpoint`,
      headers: { "content-type": "application/json", "x-tenant-id": TENANT_B, "x-user-id": "sync-test", "x-person-id": ADMIN },
    });
    expect(resCheckpoint.statusCode).toBe(404);
    const listB = await injectRequestFactory(appB)<Array<{ externalRecordId: string | null }>>(
      "/api/v1/ingestion-quarantine?sourceSystem=sys",
    );
    expect(listB).toHaveLength(0);
  });
});

describe("INT-215: raw record retention classification", () => {
  it("FINANCIAL_FACT 资源的原始记录必须标为 FINANCIAL，DEFAULT 被拒绝", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const seed = await seedConnectionMappingSchedule(
      app,
      "https://provider.example/api/financial-raw",
      "FINANCIAL_FACT",
    );
    const resource = await inject<{ id: string }>("/api/v1/sync-resources", {
      method: "POST",
      body: JSON.stringify({
        connectionId: seed.connection.id,
        resourceKey: "financial-raw",
        mappingId: seed.mapping.id,
      }),
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/raw-source-records",
      payload: {
        sourceSystem: "wave1-system",
        externalRecordId: "RAW-FIN-1",
        payload: { amount: "1", currency: "USD" },
        resourceId: resource.id,
        retentionClass: "DEFAULT",
      },
      headers: { "content-type": "application/json" },
    });
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().error.message).toMatch(/RETENTION_CLASS_MISMATCH/);

    const inferred = await app.inject({
      method: "POST",
      url: "/api/v1/raw-source-records",
      payload: {
        sourceSystem: "wave1-system",
        externalRecordId: "RAW-FIN-2",
        payload: { amount: "1", currency: "USD" },
        resourceId: resource.id,
      },
      headers: { "content-type": "application/json" },
    });
    expect(inferred.statusCode).toBe(201);
    expect(
      (inferred.json() as { data: { retentionClass: string } }).data
        .retentionClass,
    ).toBe("FINANCIAL");
  });
});

describe("NP-002/003/004/015/016: runner 全流程（注入式 request）", () => {
  it("targetType=FINANCIAL_FACT：金额/币种从 payload 类型化入账，checkpoint 推进，计数精确", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const providerUrl = "https://provider.example/api/orders";
    const seed = await seedConnectionMappingSchedule(app, providerUrl, "FINANCIAL_FACT");
    const providerFetch = stubProviderFetch([
      {
        records: [
          {
            record_id: "FA-1",
            event_type: "updated",
            subject_type: "ORDER",
            subject_id: "00000000-0000-4000-8000-0000000000e1",
            evidence_type: "GROSS_PROFIT",
            occurred_at: "2026-10-15T00:00:00.000Z",
            amount: "1234.5",
            currency: "USD",
          },
          {
            record_id: "FA-BAD",
            event_type: "updated",
            subject_type: "ORDER",
            subject_id: "00000000-0000-4000-8000-0000000000e2",
            evidence_type: "GROSS_PROFIT",
            occurred_at: "2026-10-16T00:00:00.000Z",
            amount: "10",
            currency: "us$",
          },
        ],
        next_cursor: "page-2",
      },
    ]);
    const summary = await runSyncCycle({
      request: inject,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 2 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer wave1-test",
    });
    expect(summary.schedules).toHaveLength(1);
    const counters = summary.schedules[0]!.counters;
    // NP-016：计数与逐条结果对账——2 条拉取，1 条入账，1 条隔离。
    expect(counters.recordsFetched).toBe(2);
    expect(counters.recordsUpserted).toBe(1);
    expect(counters.recordsQuarantined).toBe(1);
    expect(counters.recordsFailed).toBe(0);
    // NP-004：金额/币种从 payload 类型化（不再硬编码 0/CNY）。
    const facts = await inject<Array<{ sourceRecordId: string; amount: string; currency: string; factType: string }>>(
      "/api/v1/financial-facts",
    );
    const fact = facts.find((f) => f.sourceRecordId === "FA-1");
    expect(fact).toBeDefined();
    expect(fact!.amount).toBe("1234.5");
    expect(fact!.currency).toBe("USD");
    expect(fact!.factType).toBe("GROSS_PROFIT");
    // 坏币种 → INVALID_CURRENCY 隔离（不吞掉、不写 facts）。
    const quarantine = await inject<Array<{ externalRecordId: string | null; reason: string }>>(
      "/api/v1/ingestion-quarantine?sourceSystem=wave1-system",
    );
    const badRow = quarantine.find((r) => r.externalRecordId === "FA-BAD");
    expect(badRow?.reason).toBe("INVALID_CURRENCY");
    // NP-003：全部写入成功后 checkpoint 才推进到本页游标。
    const resources = await inject<Array<{ id: string }>>(
      `/api/v1/sync-resources?connectionId=${seed.connection.id}`,
    );
    const checkpoint = await inject<{ cursor: string | null }>(
      `/api/v1/sync-resources/${resources[0]!.id}/checkpoint`,
    );
    expect(checkpoint.cursor).toBe("page-2");
  });

  it("targetType=EVIDENCE：即使 evidenceType 是财务词也走证据通道（NP-015）", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const providerUrl = "https://provider.example/api/deals";
    await seedConnectionMappingSchedule(app, providerUrl, "EVIDENCE");
    const providerFetch = stubProviderFetch([
      {
        records: [
          {
            record_id: "EV-1",
            event_type: "stage_changed",
            subject_type: "ORDER",
            subject_id: "00000000-0000-4000-8000-0000000000e3",
            evidence_type: "GROSS_PROFIT",
            occurred_at: "2026-10-15T00:00:00.000Z",
          },
        ],
      },
    ]);
    const summary = await runSyncCycle({
      request: inject,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 2 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer wave1-test",
    });
    expect(summary.schedules[0]!.counters.recordsUpserted).toBe(1);
    const facts = await inject<Array<unknown>>("/api/v1/financial-facts");
    expect(facts).toHaveLength(0);
  });

  it("NP-003：目标写入注入失败 → 运行 FAILED 且 checkpoint 不推进；修复后重放幂等", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const providerUrl = "https://provider.example/api/orders2";
    const seed = await seedConnectionMappingSchedule(app, providerUrl, "FINANCIAL_FACT");
    const providerFetch = stubProviderFetch([
      {
        records: [
          {
            record_id: "FA-FAIL",
            event_type: "updated",
            subject_type: "ORDER",
            subject_id: "00000000-0000-4000-8000-0000000000e4",
            evidence_type: "REVENUE",
            occurred_at: "2026-10-17T00:00:00.000Z",
            amount: "88.25",
            currency: "CNY",
          },
        ],
      },
    ]);
    // 第一次：financial-facts 写入失败（注入）。
    let failFinancialFacts = true;
    const failingRequest: SyncRequestFn = async (path, init) => {
      if (failFinancialFacts && path === "/api/v1/financial-facts" && (init?.method ?? "GET") === "POST") {
        throw new Error("INJECTED_TARGET_WRITE_FAILURE");
      }
      return inject(path, init);
    };
    const summary = await runSyncCycle({
      request: failingRequest,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 2 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer wave1-test",
    });
    expect(summary.schedules[0]!.status).toBe("FAILED");
    expect(summary.schedules[0]!.counters.recordsFailed).toBe(1);
    const resources = await inject<Array<{ id: string }>>(
      `/api/v1/sync-resources?connectionId=${seed.connection.id}`,
    );
    const checkpoint = await inject<{ cursor: string | null }>(
      `/api/v1/sync-resources/${resources[0]!.id}/checkpoint`,
    );
    expect(checkpoint.cursor).toBeNull();
    // 修复后重放：数据写入成功（replay 不丢数据）。
    // intervalMinutes=60 使首次 claim 推进了 nextRunAt——重试用 claimNow 越过到期时间。
    failFinancialFacts = false;
    const retry = await runSyncCycle({
      request: inject,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 6 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer wave1-test",
    });
    expect(retry.schedules).toHaveLength(1);
    expect(retry.schedules[0]!.counters.recordsUpserted).toBe(1);
    const facts = await inject<Array<{ sourceRecordId: string }>>("/api/v1/financial-facts");
    expect(facts.filter((f) => f.sourceRecordId === "FA-FAIL")).toHaveLength(1);
  });

  it("INT-210：未知 409（期间关闭/状态冲突）不得被当作幂等成功", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const seed = await seedConnectionMappingSchedule(
      app,
      "https://provider.example/api/orders3",
      "FINANCIAL_FACT",
    );
    const providerFetch = stubProviderFetch([
      {
        records: [
          {
            record_id: "FA-409",
            event_type: "updated",
            subject_type: "ORDER",
            subject_id: "00000000-0000-4000-8000-0000000000e5",
            evidence_type: "REVENUE",
            occurred_at: "2026-10-17T00:00:00.000Z",
            amount: "10.00",
            currency: "CNY",
          },
        ],
      },
    ]);
    const conflictRequest: SyncRequestFn = async (path, init) => {
      if (path === "/api/v1/financial-facts" && (init?.method ?? "GET") === "POST") {
        throw new SyncRequestError(
          "PERIOD_CLOSED: accounting period 2026-10 is locked",
          409,
          "PERIOD_CLOSED",
        );
      }
      return inject(path, init);
    };
    const summary = await runSyncCycle({
      request: conflictRequest,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 2 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer wave1-test",
    });
    expect(summary.schedules[0]!.status).toBe("FAILED");
    expect(summary.schedules[0]!.counters.recordsFailed).toBe(1);
    expect(summary.schedules[0]!.counters.recordsDuplicate).toBe(0);
    void seed;
  });

  it("COMMERCIAL_OPPORTUNITY：runner 直接 upsert Commercial 机会", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    await seedConnectionMappingSchedule(
      app,
      "https://provider.example/api/commercial",
      "COMMERCIAL_OPPORTUNITY",
    );
    const providerFetch = stubProviderFetch([
      {
        records: [
          {
            record_id: "OPP-1",
            event_type: "upserted",
            subject_type: "OPPORTUNITY",
            subject_id: ADMIN,
            evidence_type: "COMMERCIAL",
            occurred_at: "2026-10-01T00:00:00.000Z",
            externalAccountId: "HS-ACC-1",
            accountName: "Imported Co",
            externalOpportunityId: "HS-DEAL-1",
            name: "Deal one",
            currency: "USD",
            estimatedAmount: "1000",
          },
        ],
      },
    ]);
    const summary = await runSyncCycle({
      request: inject,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 2 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer wave1-test",
    });
    expect(summary.schedules[0]!.status).toBe("SUCCEEDED");
    expect(summary.schedules[0]!.counters.recordsCreated).toBe(1);
    const opportunities = await inject<Array<{ name: string; externalOpportunityId: string; currency: string }>>(
      "/api/v1/commercial/opportunities",
    );
    expect(
      opportunities.some(
        (item) => item.externalOpportunityId === "HS-DEAL-1" && item.name === "Deal one",
      ),
    ).toBe(true);
  });

  it("INT-214：OAuth 401 → invalidate + 重新取 token 重试一次", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    await seedConnectionMappingSchedule(
      app,
      "https://provider.example/api/oauth",
      "EVIDENCE",
    );
    let calls = 0;
    let tokenVersion = 1;
    const authorizations: string[] = [];
    const providerFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      calls += 1;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      authorizations.push(headers.authorization ?? "");
      if (calls === 1) {
        return {
          ok: false,
          status: 401,
          json: async () => ({}),
          headers: new Headers(),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          records: [
            {
              record_id: "OAUTH-1",
              event_type: "updated",
              subject_type: "PERSON",
              subject_id: ADMIN,
              evidence_type: "ACTIVITY",
              occurred_at: "2026-10-01T00:00:00.000Z",
            },
          ],
        }),
        headers: new Headers(),
      } as unknown as Response;
    });
    const oauthTokenResolver = () => ({
      async getToken() {
        return `token-${tokenVersion}`;
      },
      invalidate() {
        tokenVersion += 1;
      },
    });
    const summary = await runSyncCycle({
      request: inject,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 2 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      oauthTokenResolver,
    });
    expect(summary.schedules[0]!.status).toBe("SUCCEEDED");
    expect(calls).toBe(2);
    expect(tokenVersion).toBe(2);
    expect(authorizations[0]).toBe("Bearer token-1");
    expect(authorizations[1]).toBe("Bearer token-2");
  });

  it("INT-206：增量水位使用 sourceUpdatedAt，而不是 occurredAt", async () => {
    const app = buildAppFor(TENANT_A);
    const inject = injectRequestFactory(app);
    const seed = await seedConnectionMappingSchedule(
      app,
      "https://provider.example/api/deals-watermark",
      "EVIDENCE",
    );
    const providerFetch = stubProviderFetch([
      {
        records: [
          {
            record_id: "WM-1",
            event_type: "updated",
            subject_type: "PERSON",
            subject_id: ADMIN,
            evidence_type: "ACTIVITY",
            occurred_at: "2026-10-01T00:00:00.000Z",
            updated_at: "2026-10-20T12:00:00.000Z",
          },
        ],
      },
    ]);
    await runSyncCycle({
      request: inject,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 2 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer wave1-test",
    });
    const resources = await inject<Array<{ id: string }>>(
      `/api/v1/sync-resources?connectionId=${seed.connection.id}`,
    );
    const checkpoint = await inject<{ watermark: string | null }>(
      `/api/v1/sync-resources/${resources[0]!.id}/checkpoint`,
    );
    expect(checkpoint.watermark).toBe("2026-10-20T12:00:00.000Z");
  });
});

/**
 * sync-run 级重放（Mapping Studio 失败面板）：
 * - FAILED / PARTIAL 才可重放；跨租户 404；SUCCEEDED 409；
 * - 只重做目标写入：不新建 run、不推进 checkpoint、原 run 审计保留；
 * - 幂等：已重放记录 skipped；body.rawRecordIds 可精确指定。
 */
interface ReplayResult {
  replayed: number;
  skipped: number;
  failed: number;
  rawRecordIds: string[];
}

async function seedReplayRunFixture(
  app: Awaited<ReturnType<typeof buildApp>>,
  options: { sourceSystem?: string; externalRecordIds?: string[] } = {},
) {
  const inject = injectRequestFactory(app);
  const sourceSystem = options.sourceSystem ?? "replay-system";
  const connection = await inject<{ id: string }>(
    "/api/v1/integration-connections",
    {
      method: "POST",
      body: JSON.stringify({
        provider: "generic",
        connectionName: `replay-${Date.now()}`,
        credentialRef: "vault/creds",
        config: {
          url: "https://provider.example/api/replay",
          recordsPath: "records",
        },
      }),
    },
  );
  const mapping = await inject<{ id: string }>(
    `/api/v1/integration-connections/${connection.id}/mappings`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "replay mapping",
        mappingType: "HTTP_JSON",
        sourceSystem,
        targetType: "EVIDENCE",
        fieldMap: {
          sourceRecordId: "record_id",
          eventType: "event_type",
          subjectType: "subject_type",
          subjectId: "subject_id",
          evidenceType: "evidence_type",
          occurredAt: "occurred_at",
        },
        config: { allowUuidPassthrough: true },
        version: 1,
      }),
    },
  );
  const resource = await inject<{ id: string }>("/api/v1/sync-resources", {
    method: "POST",
    body: JSON.stringify({
      connectionId: connection.id,
      resourceKey: `replay-resource-${Date.now()}`,
      mappingId: mapping.id,
    }),
  });
  const run = await inject<{ id: string; status: string }>(
    `/api/v1/integration-connections/${connection.id}/sync-runs`,
    { method: "POST", body: JSON.stringify({ status: "QUEUED" }) },
  );
  const records: Array<{ id: string; externalRecordId: string }> = [];
  for (const externalRecordId of options.externalRecordIds ?? [
    "RR-1",
    "RR-2",
  ]) {
    records.push(
      await inject<{ id: string; externalRecordId: string }>(
        "/api/v1/raw-source-records",
        {
          method: "POST",
          body: JSON.stringify({
            sourceSystem,
            externalRecordId,
            resourceId: resource.id,
            payload: {
              record_id: externalRecordId,
              event_type: "updated",
              subject_type: "PERSON",
              subject_id: ADMIN,
              evidence_type: "ACTIVITY",
              occurred_at: "2026-10-01T00:00:00.000Z",
            },
          }),
        },
      ),
    );
  }
  return { inject, connection, mapping, resource, run, records, sourceSystem };
}

async function finishReplayRun(
  inject: ReturnType<typeof injectRequestFactory>,
  runId: string,
  status: "FAILED" | "SUCCEEDED" | "PARTIAL",
  overrides: Record<string, unknown> = {},
) {
  return inject(`/api/v1/sync-runs/${runId}/finish`, {
    method: "POST",
    body: JSON.stringify({
      status,
      recordsSeen: 2,
      recordsUpserted: 0,
      recordsFetched: 2,
      recordsRawPersisted: 2,
      recordsFailed: status === "SUCCEEDED" ? 0 : 2,
      ...overrides,
    }),
  });
}

describe("sync-run 级重放（INT-209 run-level）", () => {
  it("FAILED run 重放成功：目标写入完成、不新建 run、不推进 checkpoint", async () => {
    const app = buildAppFor(TENANT_A);
    const fixture = await seedReplayRunFixture(app);
    await finishReplayRun(fixture.inject, fixture.run.id, "FAILED");
    const runsBefore = await fixture.inject<Array<{ id: string }>>(
      `/api/v1/integration-connections/${fixture.connection.id}/sync-runs`,
    );
    const checkpointBefore = await fixture.inject<{ cursor: string | null }>(
      `/api/v1/sync-resources/${fixture.resource.id}/checkpoint`,
    );

    const result = await fixture.inject<ReplayResult>(
      `/api/v1/sync-runs/${fixture.run.id}/replay`,
      { method: "POST" },
    );
    expect(result.replayed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect([...result.rawRecordIds].sort()).toEqual(
      fixture.records.map((record) => record.id).sort(),
    );

    const evidence = await fixture.inject<Array<{ sourceSystem: string }>>(
      "/api/v1/evidence",
    );
    expect(
      evidence.filter((node) => node.sourceSystem === fixture.sourceSystem),
    ).toHaveLength(2);

    // 不创建新 run，原 run 仍是 FAILED（审计保留）。
    const runsAfter = await fixture.inject<Array<{ id: string; status: string }>>(
      `/api/v1/integration-connections/${fixture.connection.id}/sync-runs`,
    );
    expect(runsAfter).toHaveLength(runsBefore.length);
    const originalRun = runsAfter.find((run) => run.id === fixture.run.id);
    expect(originalRun?.status).toBe("FAILED");

    // checkpoint 不被重置/推进。
    const checkpointAfter = await fixture.inject<{ cursor: string | null }>(
      `/api/v1/sync-resources/${fixture.resource.id}/checkpoint`,
    );
    expect(checkpointAfter.cursor).toBe(checkpointBefore.cursor);
  });

  it("PARTIAL run 也可重放（可重放状态白名单）", async () => {
    const app = buildAppFor(TENANT_A);
    const fixture = await seedReplayRunFixture(app, {
      externalRecordIds: ["PR-1"],
    });
    await finishReplayRun(fixture.inject, fixture.run.id, "PARTIAL");
    const result = await fixture.inject<ReplayResult>(
      `/api/v1/sync-runs/${fixture.run.id}/replay`,
      { method: "POST" },
    );
    expect(result.replayed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("重复重放幂等：已处理记录 skipped，目标写入不重复", async () => {
    const app = buildAppFor(TENANT_A);
    const fixture = await seedReplayRunFixture(app);
    await finishReplayRun(fixture.inject, fixture.run.id, "FAILED");
    const first = await fixture.inject<ReplayResult>(
      `/api/v1/sync-runs/${fixture.run.id}/replay`,
      { method: "POST" },
    );
    expect(first.replayed).toBe(2);

    const second = await fixture.inject<ReplayResult>(
      `/api/v1/sync-runs/${fixture.run.id}/replay`,
      { method: "POST" },
    );
    expect(second.replayed).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.failed).toBe(0);
    expect(second.rawRecordIds).toEqual([]);
    const evidence = await fixture.inject<Array<{ sourceSystem: string }>>(
      "/api/v1/evidence",
    );
    expect(
      evidence.filter((node) => node.sourceSystem === fixture.sourceSystem),
    ).toHaveLength(2);
  });

  it("跨租户 404（不泄露 run 是否存在）", async () => {
    const appA = buildAppFor(TENANT_A);
    const fixture = await seedReplayRunFixture(appA);
    await finishReplayRun(fixture.inject, fixture.run.id, "FAILED");
    const appB = buildAppFor(TENANT_B);
    const res = await appB.inject({
      method: "POST",
      url: `/api/v1/sync-runs/${fixture.run.id}/replay`,
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT_B,
        "x-user-id": "sync-test",
        "x-person-id": ADMIN,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("SUCCEEDED 409（非可重放状态）", async () => {
    const app = buildAppFor(TENANT_A);
    const fixture = await seedReplayRunFixture(app);
    await finishReplayRun(fixture.inject, fixture.run.id, "SUCCEEDED");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sync-runs/${fixture.run.id}/replay`,
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT_A,
        "x-user-id": "sync-test",
        "x-person-id": ADMIN,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("SYNC_RUN_NOT_REPLAYABLE");
  });

  it("body.rawRecordIds 精确重放；未知记录 404", async () => {
    const app = buildAppFor(TENANT_A);
    const fixture = await seedReplayRunFixture(app);
    await finishReplayRun(fixture.inject, fixture.run.id, "FAILED");
    const target = fixture.records[0]!;
    const result = await fixture.inject<ReplayResult>(
      `/api/v1/sync-runs/${fixture.run.id}/replay`,
      {
        method: "POST",
        body: JSON.stringify({ rawRecordIds: [target.id] }),
      },
    );
    expect(result.replayed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.rawRecordIds).toEqual([target.id]);

    // 其余记录仍待重放；已指定重放的那条自动跳过。
    const rest = await fixture.inject<ReplayResult>(
      `/api/v1/sync-runs/${fixture.run.id}/replay`,
      { method: "POST" },
    );
    expect(rest.replayed).toBe(1);
    expect(rest.skipped).toBe(1);
    expect(rest.rawRecordIds).toEqual([fixture.records[1]!.id]);

    // 跨租户 / 未知 raw record id → 404（不泄露存在性）。
    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/sync-runs/${fixture.run.id}/replay`,
      payload: JSON.stringify({
        rawRecordIds: ["00000000-0000-4000-8000-0000000000ff"],
      }),
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT_A,
        "x-user-id": "sync-test",
        "x-person-id": ADMIN,
      },
    });
    expect(missing.statusCode).toBe(404);
  });
});
