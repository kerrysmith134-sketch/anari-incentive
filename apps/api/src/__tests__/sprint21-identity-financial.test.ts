/**
 * Sprint 2.1 批次 C（INT-207/208）：身份强类型 + 财务事实版本账本。
 *
 * INT-207：
 * - UUID 直通默认关闭：UUID 形态的外部 ID 同样必须经 ExternalObjectIdentity
 *   解析（格式不能证明租户归属与对象指向）；仅 mapping.config
 *   .allowUuidPassthrough === true 时显式放行。
 * - confirmedBy 由会话身份决定，不信任 body 提交。
 * - resolve 临时错误（非 404）→ 整页失败重试；仅未解析（404）→ 隔离。
 *
 * INT-208 FinancialFact Revision Ledger：
 * - 同键新 sourceUpdatedAt 更新主表并把旧值写入 append-only revisions；
 * - 迟到旧快照（sourceUpdatedAt 早于现行）→ 409 STALE_FINANCIAL_FACT 且
 *   主表不变（财务红线：旧快照不得覆盖新快照）；
 * - 无 sourceUpdatedAt 的重复提交视为更新（旧值进 revisions）。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import { runSyncCycle, type SyncRequestFn } from "@anari/connectors";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const SESSION_PERSON = "00000000-0000-4000-8000-000000000002";

function buildAppFor(tenantId: string) {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: tenantId,
      name: `S21C ${tenantId.slice(-4)}`,
      slug: `s21c-${tenantId.slice(-4)}`,
      persons: [
        { id: ADMIN, employeeCode: "E001", displayName: "管理员" },
        { id: SESSION_PERSON, employeeCode: "E002", displayName: "复核人" },
      ],
    },
  });
  return buildApp(
    () => new Store(tenantId),
    undefined,
    {
      async authenticate() {
        return {
          tenantId,
          userId: "s21c",
          roles: ["admin", "integration"],
          personId: SESSION_PERSON,
        };
      },
    },
    platformStore,
  );
}

const H = { "content-type": "application/json" };

describe("INT-207: 身份强类型", () => {
  it("UUID 直通默认关闭：未注册的 UUID 主体 → 隔离 UNRESOLVED_IDENTITY", async () => {
    const app = buildAppFor(TENANT);
    const inject: SyncRequestFn = async (path, init) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      if (path === "/api/v1/sync-schedules/claim-due" && method === "POST") {
        return [{ id: "s", connectionId: "conn-1", name: "c-sched" }] as never;
      }
      if (path === "/api/v1/integration-connections/conn-1/sync-runs") return { id: "run" } as never;
      if (path === "/api/v1/integration-connections/conn-1") {
        return { provider: "generic", credentialRef: "vault/c", config: {} } as never;
      }
      if (path.includes("/mappings?status=ACTIVE")) {
        return [
          {
            id: "m-c",
            status: "ACTIVE",
            mappingType: "HTTP_JSON",
            sourceSystem: "c-system",
            targetType: "EVIDENCE",
            fieldMap: {
              sourceRecordId: "id",
              eventType: "event_type",
              subjectType: "subject_type",
              subjectId: "subject_id",
              evidenceType: "=ACTIVITY",
            },
            config: { url: "https://p.example", recordsPath: "records" },
          },
        ] as never;
      }
      if (path === "/api/v1/sync-resources" && method === "POST") return { id: "res-c" } as never;
      if (path.startsWith("/api/v1/sync-resources?")) return [{ id: "res-c" }] as never;
      if (path.includes("/claim-lease")) {
        return { fencingToken: 1, leaseUntil: new Date(Date.now() + 900000).toISOString() } as never;
      }
      if (path.includes("/release-lease")) return { released: true } as never;
      if (path.includes("/checkpoint")) {
        if (method === "PUT") return body as never;
        return { cursor: null } as never;
      }
      if (path === "/api/v1/raw-source-records" && method === "POST") return { id: "raw" } as never;
      if (path.startsWith("/api/v1/external-objects:resolve")) {
        throw new Error(
          "ExternalObjectIdentity c-system/ORDER/11111111-1111-4111-8111-111111111111 not found",
        );
      }
      if (path === "/api/v1/ingestion-quarantine" && method === "POST") return { id: "q" } as never;
      if (path.startsWith("/api/v1/sync-runs/")) return { id: "x" } as never;
      throw new Error(`unexpected ${method} ${path}`);
    };
    const providerFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        records: [
          {
            id: "C1",
            event_type: "created",
            subject_type: "ORDER",
            subject_id: "11111111-1111-4111-8111-111111111111", // UUID 形态但未注册
            occurred_at: "2026-11-21T00:00:00Z",
          },
        ],
      }),
      headers: new Headers(),
      redirected: false,
      url: "x",
    })) as unknown as typeof fetch;
    const summary = await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 1,
      claimNow: new Date(Date.now() + 3600_000).toISOString(),
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer s21c-test",
    });
    expect(summary.schedules[0]!.counters.recordsQuarantined).toBe(1);
    expect(summary.schedules[0]!.counters.recordsUpserted).toBe(0);
  });

  it("allowUuidPassthrough=true 的 mapping → UUID 主体显式直通投影", async () => {
    const app = buildAppFor(TENANT);
    const inject: SyncRequestFn = async (path, init) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      if (path === "/api/v1/sync-schedules/claim-due" && method === "POST") {
        return [{ id: "s", connectionId: "conn-1", name: "c-sched" }] as never;
      }
      if (path === "/api/v1/integration-connections/conn-1/sync-runs") return { id: "run" } as never;
      if (path === "/api/v1/integration-connections/conn-1") {
        return { provider: "generic", credentialRef: "vault/c", config: {} } as never;
      }
      if (path.includes("/mappings?status=ACTIVE")) {
        return [
          {
            id: "m-c2",
            status: "ACTIVE",
            mappingType: "HTTP_JSON",
            sourceSystem: "c-system",
            targetType: "EVIDENCE",
            fieldMap: {
              sourceRecordId: "id",
              eventType: "event_type",
              subjectType: "subject_type",
              subjectId: "subject_id",
              evidenceType: "=ACTIVITY",
            },
            config: {
              url: "https://p.example",
              recordsPath: "records",
              allowUuidPassthrough: true,
            },
          },
        ] as never;
      }
      if (path === "/api/v1/sync-resources" && method === "POST") return { id: "res-c" } as never;
      if (path.startsWith("/api/v1/sync-resources?")) return [{ id: "res-c" }] as never;
      if (path.includes("/claim-lease")) {
        return { fencingToken: 1, leaseUntil: new Date(Date.now() + 900000).toISOString() } as never;
      }
      if (path.includes("/release-lease")) return { released: true } as never;
      if (path.includes("/checkpoint")) {
        if (method === "PUT") return body as never;
        return { cursor: null } as never;
      }
      if (path === "/api/v1/raw-source-records" && method === "POST") return { id: "raw" } as never;
      if (path === "/api/v1/ingestion/events:batch" && method === "POST") {
        return { accepted: 1 } as never;
      }
      if (path.startsWith("/api/v1/sync-runs/")) return { id: "x" } as never;
      throw new Error(`unexpected ${method} ${path}`);
    };
    const providerFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        records: [
          {
            id: "C2",
            event_type: "created",
            subject_type: "ORDER",
            subject_id: "22222222-2222-4222-8222-222222222222",
            occurred_at: "2026-11-21T00:00:00Z",
          },
        ],
      }),
      headers: new Headers(),
      redirected: false,
      url: "x",
    })) as unknown as typeof fetch;
    const summary = await runSyncCycle({
      request: inject,
      limit: 1,
      maxPages: 1,
      claimNow: new Date(Date.now() + 3600_000).toISOString(),
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer s21c-test",
    });
    expect(summary.schedules[0]!.counters.recordsUpserted).toBe(1);
    expect(summary.schedules[0]!.counters.recordsQuarantined).toBe(0);
  });

  it("confirmedBy 忽略 body 提交——一律使用会话身份", async () => {
    const app = buildAppFor(TENANT);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/external-objects",
      payload: JSON.stringify({
        sourceSystem: "c-system",
        externalObjectType: "ORDER",
        externalObjectId: "CONFIRM-1",
        internalObjectType: "ORDER",
        internalObjectId: ADMIN, // 伪造的内部对象
        matchRule: "MANUAL",
        confirmedBy: ADMIN, // body 提交的确认人必须被忽略
      }),
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "s21c", "x-person-id": SESSION_PERSON },
    });
    expect(res.statusCode).toBe(201);
    const identity = (JSON.parse(res.payload) as { data: { confirmedBy?: string } }).data;
    // 会话身份是 SESSION_PERSON；body 提交的 ADMIN 不生效。
    expect(identity.confirmedBy).toBe(SESSION_PERSON);
  });
});

describe("INT-208: FinancialFact Revision Ledger", () => {
  const base = {
    sourceSystem: "erp",
    sourceRecordId: "FF-REV-1",
    factType: "GROSS_PROFIT",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    currency: "CNY",
    qualityStatus: "VALID" as const,
  };

  function factApp() {
    return buildAppFor(TENANT);
  }

  const postFact = async (
    app: Awaited<ReturnType<typeof buildAppFor>>,
    overrides: Record<string, unknown>,
  ) =>
    app.inject({
      method: "POST",
      url: "/api/v1/financial-facts",
      payload: JSON.stringify({ ...base, amount: "100", ...overrides }),
      headers: { ...H, "x-tenant-id": TENANT, "x-user-id": "s21c", "x-person-id": SESSION_PERSON },
    });

  it("新 sourceUpdatedAt 更新主表；迟到的旧快照 → 409 STALE_FINANCIAL_FACT 且金额不变", async () => {
    const app = factApp();
    const first = await postFact(app, {
      amount: "100",
      sourceUpdatedAt: "2026-11-20T10:00:00.000Z",
    });
    expect(first.statusCode).toBe(201);
    // 迟到快照（来源更新时间早于现行）
    const stale = await postFact(app, {
      amount: "999",
      sourceUpdatedAt: "2026-11-19T08:00:00.000Z",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toContain("STALE_FINANCIAL_FACT");
    // 主表金额未被覆盖（财务红线）
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/financial-facts",
      headers: { "x-tenant-id": TENANT, "x-user-id": "s21c", "x-person-id": SESSION_PERSON },
    });
    const row = (JSON.parse(list.payload) as { data: Array<{ sourceRecordId: string; amount: string }> }).data.find(
      (entry) => entry.sourceRecordId === base.sourceRecordId,
    );
    expect(row?.amount).toBe("100");
    // 较新快照正常更新
    const newer = await postFact(app, {
      amount: "150",
      sourceUpdatedAt: "2026-11-21T09:00:00.000Z",
    });
    expect(newer.statusCode).toBe(201);
    const list2 = await app.inject({
      method: "GET",
      url: "/api/v1/financial-facts",
      headers: { "x-tenant-id": TENANT, "x-user-id": "s21c", "x-person-id": SESSION_PERSON },
    });
    const row2 = (JSON.parse(list2.payload) as { data: Array<{ sourceRecordId: string; amount: string }> }).data.find(
      (entry) => entry.sourceRecordId === base.sourceRecordId,
    );
    expect(row2?.amount).toBe("150");
  });

  it("无 sourceUpdatedAt 的重复提交视为更新（旧值进 revisions）", async () => {
    const app = factApp();
    await postFact(app, { amount: "200" });
    const again = await postFact(app, { amount: "300" });
    expect([200, 201]).toContain(again.statusCode);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/financial-facts",
      headers: { "x-tenant-id": TENANT, "x-user-id": "s21c", "x-person-id": SESSION_PERSON },
    });
    const row = (JSON.parse(list.payload) as { data: Array<{ sourceRecordId: string; amount: string }> }).data.find(
      (entry) => entry.sourceRecordId === base.sourceRecordId,
    );
    expect(row?.amount).toBe("300");
  });
});
