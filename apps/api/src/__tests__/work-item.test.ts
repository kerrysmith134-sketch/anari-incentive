/**
 * 114：Ticketing Canonical Work Item。
 *
 * 覆盖：来源感知导入创建/更新、状态事件幂等、显式历史事件、多人贡献
 * upsert、缺字段隔离（runner）、runner 写入与二次同步更新计数。
 */
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import { runSyncCycle, type SyncRequestFn } from "@anari/connectors";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const PERSON_B = "00000000-0000-4000-8000-000000000002";

type App = Awaited<ReturnType<typeof buildApp>>;

function buildAppFor(tenantId = TENANT): App {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: tenantId,
      name: `Work item tenant ${tenantId.slice(-4)}`,
      slug: `work-item-${tenantId.slice(-4)}`,
    },
  });
  return buildApp(
    () => new Store(tenantId),
    undefined,
    {
      async authenticate() {
        return {
          tenantId,
          userId: "work-item-test",
          roles: ["admin", "manager", "finance", "integration"],
          personId: ADMIN,
        };
      },
    },
    platformStore,
  );
}

interface InjectResult {
  statusCode: number;
  json(): unknown;
}

async function post(
  app: App,
  url: string,
  payload: Record<string, unknown>,
): Promise<InjectResult> {
  return (await app.inject({
    method: "POST",
    url,
    payload,
    headers: { "content-type": "application/json" },
  })) as unknown as InjectResult;
}

async function get(app: App, url: string): Promise<InjectResult> {
  return (await app.inject({ method: "GET", url })) as unknown as InjectResult;
}

function dataOf<T>(result: InjectResult): T {
  return (result.json() as { data: T }).data;
}

interface ImportedWorkItem {
  id: string;
  status: string;
  title: string;
  externalId: string;
  projectId: string;
  currency?: string;
  amount?: string;
  weight?: string;
}

interface ImportResult {
  workItem: ImportedWorkItem;
  created: boolean;
  events: Array<{
    fromStatus?: string;
    toStatus: string;
    occurredAt: string;
  }>;
  contributions: Array<{
    personId: string;
    role: string;
    weight?: string;
    ratio?: string;
  }>;
}

interface WorkItemDetail {
  workItem: ImportedWorkItem;
  events: Array<{ fromStatus?: string; toStatus: string }>;
  contributions: Array<{ personId: string; role: string; ratio?: string }>;
}

function baseImport(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourceSystem: "pingcode",
    externalId: "PC-1",
    projectId: "PROJ-1",
    title: "Charger firmware regression",
    type: "BUG",
    priority: "HIGH",
    status: "OPEN",
    assigneePersonId: ADMIN,
    weight: "1.5",
    currency: "usd",
    amount: "1000",
    contributions: [
      { personId: ADMIN, role: "OWNER", ratio: "0.6" },
      { personId: PERSON_B, role: "REVIEWER", ratio: "0.4" },
    ],
    ...overrides,
  };
}

/** 把 buildApp 包成 runner 的 request 函数（dev 头 + envelope 解包）。 */
function injectRequestFactory(app: App): SyncRequestFn {
  return async <T>(path: string, init?: { method?: string; body?: string }) => {
    const res = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST" | "PUT",
      url: path,
      ...(init?.body
        ? { payload: init.body, headers: { "content-type": "application/json" } }
        : {}),
    });
    const payload = res.payload.toString();
    const parsed = payload
      ? (JSON.parse(payload) as { data?: T; error?: { message?: string } })
      : {};
    if (res.statusCode >= 400) {
      throw new Error(
        `HTTP ${res.statusCode}: ${parsed.error?.message ?? "request failed"}`,
      );
    }
    return parsed.data as T;
  };
}

async function seedWorkItemSync(app: App): Promise<void> {
  const inject = injectRequestFactory(app);
  const connection = await inject<{ id: string }>("/api/v1/integration-connections", {
    method: "POST",
    body: JSON.stringify({
      provider: "generic",
      connectionName: `work-item-${Date.now()}`,
      credentialRef: "vault/creds",
      config: {
        url: "https://provider.example/api/pingcode",
        recordsPath: "records",
        nextCursorPath: "next_cursor",
      },
    }),
  });
  await inject(`/api/v1/integration-connections/${connection.id}/mappings`, {
    method: "POST",
    body: JSON.stringify({
      name: "pingcode work items",
      mappingType: "HTTP_JSON",
      sourceSystem: "pingcode",
      targetType: "WORK_ITEM",
      fieldMap: {
        sourceRecordId: "id",
        eventType: "=WORK_ITEM_UPSERTED",
        subjectType: "=WORK_ITEM",
        subjectId: "id",
        evidenceType: "=WORK_ITEM",
        occurredAt: "updated_at",
        sourceUpdatedAt: "updated_at",
      },
      config: {},
      version: 1,
    }),
  });
  await inject(`/api/v1/integration-connections/${connection.id}/schedules`, {
    method: "POST",
    body: JSON.stringify({
      name: `work-item-sched-${Date.now()}`,
      intervalMinutes: 60,
    }),
  });
}

interface ProviderResponse {
  records: Array<Record<string, unknown>>;
  next_cursor?: string | null;
}

function stubProviderFetch(responses: ProviderResponse[]) {
  let calls = 0;
  return vi.fn(async (input: unknown) => {
    calls += 1;
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

describe("114 work items: source-aware import", () => {
  it("creates once, is idempotent, and exposes events/contributions", async () => {
    const app = buildAppFor();
    const created = await post(app, "/api/v1/work-items/import", baseImport());
    expect(created.statusCode).toBe(201);
    const first = dataOf<ImportResult>(created);
    expect(first.created).toBe(true);
    expect(first.workItem.externalId).toBe("PC-1");
    expect(first.workItem.projectId).toBe("PROJ-1");
    expect(first.workItem.currency).toBe("USD");
    // 创建不产生“伪状态变化”：初始状态在 work_items.status，事件为 0。
    expect(first.events).toHaveLength(0);
    // 多人贡献：两个人都落库。
    expect(first.contributions).toHaveLength(2);

    // 同 payload 重复导入：不新建、不追加事件、贡献不重复。
    const again = await post(app, "/api/v1/work-items/import", baseImport());
    expect(again.statusCode).toBe(200);
    const second = dataOf<ImportResult>(again);
    expect(second.created).toBe(false);
    expect(second.workItem.id).toBe(first.workItem.id);
    expect(second.events).toHaveLength(0);
    expect(second.contributions).toHaveLength(2);

    const detail = dataOf<WorkItemDetail>(
      await get(app, `/api/v1/work-items/${first.workItem.id}`),
    );
    expect(detail.events).toHaveLength(0);
    expect(detail.contributions).toHaveLength(2);

    // 项目过滤 + 贡献人过滤（PERSON_B 只是评审人，不是负责人）。
    const byProject = dataOf<ImportedWorkItem[]>(
      await get(app, "/api/v1/work-items?projectId=PROJ-1"),
    );
    expect(byProject.map((item) => item.externalId)).toEqual(["PC-1"]);
    const byContributor = dataOf<ImportedWorkItem[]>(
      await get(app, `/api/v1/work-items?personId=${PERSON_B}`),
    );
    expect(byContributor.map((item) => item.externalId)).toEqual(["PC-1"]);
    const byOtherProject = dataOf<ImportedWorkItem[]>(
      await get(app, "/api/v1/work-items?projectId=PROJ-2"),
    );
    expect(byOtherProject).toHaveLength(0);
  });

  it("appends exactly one event per real status change and none on replay", async () => {
    const app = buildAppFor();
    const first = dataOf<ImportResult>(
      await post(app, "/api/v1/work-items/import", baseImport()),
    );
    const transition = await post(
      app,
      "/api/v1/work-items/import",
      baseImport({ status: "IN_PROGRESS", title: "Charger firmware regression v2" }),
    );
    const moved = dataOf<ImportResult>(transition);
    expect(moved.created).toBe(false);
    expect(moved.events).toHaveLength(1);
    expect(moved.events[0]!.fromStatus).toBe("OPEN");
    expect(moved.events[0]!.toStatus).toBe("IN_PROGRESS");
    expect(moved.workItem.title).toBe("Charger firmware regression v2");

    // 状态未再变化：重复导入不得制造“伪历史”。
    const replay = dataOf<ImportResult>(
      await post(
        app,
        "/api/v1/work-items/import",
        baseImport({ status: "IN_PROGRESS", title: "Charger firmware regression v2" }),
      ),
    );
    expect(replay.events).toHaveLength(0);

    const detail = dataOf<WorkItemDetail>(
      await get(app, `/api/v1/work-items/${first.workItem.id}`),
    );
    expect(detail.events.map((event) => event.toStatus)).toEqual([
      "IN_PROGRESS",
    ]);
  });

  it("deduplicates supplied historical events and skips the implicit duplicate", async () => {
    const app = buildAppFor();
    const first = dataOf<ImportResult>(
      await post(app, "/api/v1/work-items/import", baseImport()),
    );
    const withHistory = baseImport({
      status: "DONE",
      completedAt: "2026-11-20T10:00:00.000Z",
      events: [
        {
          fromStatus: "OPEN",
          toStatus: "DONE",
          occurredAt: "2026-11-20T09:00:00.000Z",
          actorPersonId: ADMIN,
        },
      ],
    });
    const done = dataOf<ImportResult>(
      await post(app, "/api/v1/work-items/import", withHistory),
    );
    // 显式历史已表达 OPEN→DONE：不再补一条隐式事件。
    expect(done.events).toHaveLength(1);
    expect(done.events[0]!.occurredAt).toBe("2026-11-20T09:00:00.000Z");

    // 同一时刻的不同写法（带/不带毫秒）仍是同一事件——幂等键先归一。
    const replayBody = baseImport({
      status: "DONE",
      completedAt: "2026-11-20T10:00:00.000Z",
      events: [
        {
          fromStatus: "OPEN",
          toStatus: "DONE",
          occurredAt: "2026-11-20T09:00:00Z",
          actorPersonId: ADMIN,
        },
      ],
    });
    const replay = dataOf<ImportResult>(
      await post(app, "/api/v1/work-items/import", replayBody),
    );
    expect(replay.events).toHaveLength(0);

    const detail = dataOf<WorkItemDetail>(
      await get(app, `/api/v1/work-items/${first.workItem.id}`),
    );
    expect(detail.events).toHaveLength(1);
    expect(detail.workItem.status).toBe("DONE");
  });

  it("upserts multi-person contributions instead of duplicating them", async () => {
    const app = buildAppFor();
    const first = dataOf<ImportResult>(
      await post(app, "/api/v1/work-items/import", baseImport()),
    );
    const updated = dataOf<ImportResult>(
      await post(
        app,
        "/api/v1/work-items/import",
        baseImport({
          contributions: [
            { personId: ADMIN, role: "OWNER", ratio: "0.5" },
            {
              personId: "00000000-0000-4000-8000-000000000003",
              role: "CONTRIBUTOR",
              weight: "2",
            },
          ],
        }),
      ),
    );
    expect(updated.contributions).toHaveLength(2);
    const detail = dataOf<WorkItemDetail>(
      await get(app, `/api/v1/work-items/${first.workItem.id}`),
    );
    // ADMIN/OWNER 更新 ratio；PERSON_B 的既有贡献保留；新增第三人。
    expect(detail.contributions).toHaveLength(3);
    const owner = detail.contributions.find(
      (entry) => entry.personId === ADMIN && entry.role === "OWNER",
    );
    expect(owner?.ratio).toBe("0.5");
    expect(
      detail.contributions.some(
        (entry) => entry.personId === PERSON_B && entry.role === "REVIEWER",
      ),
    ).toBe(true);
  });

  it("rejects amount without currency at the contract boundary", async () => {
    const app = buildAppFor();
    const result = await post(
      app,
      "/api/v1/work-items/import",
      baseImport({ currency: undefined }),
    );
    expect(result.statusCode).toBe(400);
    const listed = dataOf<ImportedWorkItem[]>(
      await get(app, "/api/v1/work-items?projectId=PROJ-1"),
    );
    expect(listed).toHaveLength(0);
  });
});

describe("114 work items: sync runner WORK_ITEM target", () => {
  it("quarantines records missing required fields and imports the valid one", async () => {
    const app = buildAppFor();
    await seedWorkItemSync(app);
    const providerFetch = stubProviderFetch([
      {
        records: [
          {
            id: "PC-100",
            projectId: "PROJ-9",
            title: "Valid task",
            type: "TASK",
            status: "OPEN",
            updated_at: "2026-11-10T00:00:00.000Z",
          },
          {
            id: "PC-101",
            title: "Missing project",
            type: "TASK",
            status: "OPEN",
            updated_at: "2026-11-10T00:00:00.000Z",
          },
          {
            id: "PC-102",
            projectId: "PROJ-9",
            title: "Bad status",
            type: "TASK",
            status: "WHATEVER",
            updated_at: "2026-11-10T00:00:00.000Z",
          },
        ],
      },
    ]);
    const summary = await runSyncCycle({
      request: injectRequestFactory(app),
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 2 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer work-item-test",
    });
    expect(summary.schedules[0]!.status).toBe("SUCCEEDED");
    expect(summary.schedules[0]!.counters.recordsFetched).toBe(3);
    expect(summary.schedules[0]!.counters.recordsCreated).toBe(1);
    expect(summary.schedules[0]!.counters.recordsUpdated).toBe(0);
    expect(summary.schedules[0]!.counters.recordsInvalid).toBe(2);
    expect(summary.schedules[0]!.counters.recordsQuarantined).toBe(2);

    const quarantined = dataOf<
      Array<{ externalRecordId: string | null; reason: string }>
    >(await get(app, "/api/v1/ingestion-quarantine?sourceSystem=pingcode"));
    expect(
      quarantined.map((entry) => entry.externalRecordId).sort(),
    ).toEqual(["PC-101", "PC-102"]);
    expect(quarantined.every((entry) => entry.reason === "SCHEMA_MISMATCH")).toBe(
      true,
    );

    const items = dataOf<ImportedWorkItem[]>(
      await get(app, "/api/v1/work-items?projectId=PROJ-9"),
    );
    expect(items.map((item) => item.externalId)).toEqual(["PC-100"]);
  });

  it("writes work items and counts created/updated across two cycles", async () => {
    const app = buildAppFor();
    await seedWorkItemSync(app);
    const providerFetch = stubProviderFetch([
      {
        records: [
          {
            id: "PC-200",
            projectId: "PROJ-20",
            title: "First snapshot",
            type: "STORY",
            status: "OPEN",
            currency: "USD",
            amount: "500",
            assignments: [],
            contributions: [
              { personId: ADMIN, role: "OWNER", ratio: "1" },
            ],
            updated_at: "2026-11-10T00:00:00.000Z",
          },
        ],
      },
      {
        records: [
          {
            id: "PC-200",
            projectId: "PROJ-20",
            title: "Second snapshot",
            type: "STORY",
            status: "DONE",
            completedAt: "2026-11-12T00:00:00.000Z",
            currency: "USD",
            amount: "500",
            contributions: [
              { personId: ADMIN, role: "OWNER", ratio: "1" },
              { personId: PERSON_B, role: "REVIEWER", ratio: "0.5" },
            ],
            updated_at: "2026-11-12T00:00:00.000Z",
          },
        ],
      },
    ]);
    const request = injectRequestFactory(app);
    const firstRun = await runSyncCycle({
      request,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 2 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer work-item-test",
    });
    expect(firstRun.schedules[0]!.status).toBe("SUCCEEDED");
    expect(firstRun.schedules[0]!.counters.recordsCreated).toBe(1);
    expect(firstRun.schedules[0]!.counters.recordsUpdated).toBe(0);

    const secondRun = await runSyncCycle({
      request,
      limit: 10,
      maxPages: 1,
      claimNow: new Date(Date.now() + 4 * 3600_000).toISOString(),
      providerFetchImpl: providerFetch as unknown as typeof fetch,
      credentialRefResolver: () => "Bearer work-item-test",
    });
    expect(secondRun.schedules[0]!.status).toBe("SUCCEEDED");
    expect(secondRun.schedules[0]!.counters.recordsCreated).toBe(0);
    expect(secondRun.schedules[0]!.counters.recordsUpdated).toBe(1);

    const items = dataOf<ImportedWorkItem[]>(
      await get(app, "/api/v1/work-items?projectId=PROJ-20"),
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("DONE");
    expect(items[0]!.title).toBe("Second snapshot");

    const detail = dataOf<WorkItemDetail>(
      await get(app, `/api/v1/work-items/${items[0]!.id}`),
    );
    // 只有一次真实状态变化；重复同步不得追加第二条。
    expect(detail.events.map((event) => event.toStatus)).toEqual(["DONE"]);
    expect(detail.contributions).toHaveLength(2);
  });
});
