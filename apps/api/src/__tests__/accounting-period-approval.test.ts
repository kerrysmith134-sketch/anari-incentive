/**
 * 迁移 113：会计期间审批人目录 + 审批通知。
 *
 * 覆盖：
 *  - 目录 GET/PUT（全量替换、软停用）；
 *  - 跨租户人员 / 非 ACTIVE 人员拒绝；
 *  - 创建期间变更请求 → 通知除请求人外的有效审批人；
 *  - 批准/驳回 → 请求人收到结果通知；
 *  - 空目录回退到租户 admin/finance 角色且不阻断请求。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000011";
const FINANCE = "00000000-0000-4000-8000-000000000012";
const REVIEWER = "00000000-0000-4000-8000-000000000013";

const LEGAL_ENTITY = "LE-APPROVERS";
const PERIOD = "2026-11";

function createStore() {
  return new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "Approver tenant",
      slug: "approver-tenant",
      persons: [
        { id: ADMIN, employeeCode: "E101", displayName: "Admin User" },
        { id: FINANCE, employeeCode: "E102", displayName: "Finance User" },
        { id: REVIEWER, employeeCode: "E103", displayName: "Reviewer User" },
      ],
    },
  });
}

/**
 * 给 ADMIN/FINANCE 建立 user → membership(角色) 链接，供空目录角色回退使用；
 * 同时创建一个 INACTIVE 人员验证 PUT 拒绝。
 */
async function seedRoles(platformStore: MemoryPlatformStore): Promise<string> {
  for (const [personId, roleCodes, subject] of [
    [ADMIN, ["admin", "finance"], "approver-admin"],
    [FINANCE, ["finance"], "approver-finance"],
  ] as const) {
    const user = await platformStore.createUser({
      authSubject: subject,
      displayName: `${subject} display`,
    });
    await platformStore.addMembership({
      tenantId: TENANT,
      userId: user.id,
      roleCodes: [...roleCodes],
    });
    await platformStore.linkPersonUser({
      tenantId: TENANT,
      personId,
      userId: user.id,
    });
  }
  const inactive = await platformStore.createPerson({
    tenantId: TENANT,
    employeeCode: "E104",
    displayName: "Former Employee",
    employmentStatus: "INACTIVE",
  });
  return inactive.id;
}

function buildAppFor(
  platformStore: MemoryPlatformStore,
  personId: string,
  store: Store,
  roles: string[] = ["admin", "finance"],
) {
  return buildApp(
    store,
    undefined,
    {
      async authenticate() {
        return {
          tenantId: TENANT,
          userId: `${personId}-user`,
          personId,
          roles,
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

async function request(
  app: Awaited<ReturnType<typeof buildApp>>,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
): Promise<InjectResult> {
  return (await app.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    headers: { "content-type": "application/json" },
  })) as unknown as InjectResult;
}

function body<T>(res: InjectResult): T {
  return (res.json() as { data: T }).data;
}

async function notificationsFor(
  store: Store,
  personId: string,
): Promise<Array<{ sourceType?: string; sourceId?: string; title: string }>> {
  return store.listNotifications({ recipientPersonId: personId });
}

describe("accounting period approver directory", () => {
  it("replaces and lists approvers, deactivating removed people", async () => {
    const platformStore = createStore();
    await seedRoles(platformStore);
    const store = new Store(TENANT);
    const app = buildAppFor(platformStore, ADMIN, store);

    const initial = await request(app, "GET", "/api/v1/accounting-period-approvers");
    expect(initial.statusCode).toBe(200);
    expect(body<{ source: string }>(initial).source).toBe("ROLE_FALLBACK");

    const put = await request(app, "PUT", "/api/v1/accounting-period-approvers", {
      personIds: [REVIEWER, FINANCE],
    });
    expect(put.statusCode).toBe(200);
    const saved = body<{ approvers: Array<{ personId: string }>; source: string }>(put);
    expect(saved.source).toBe("DIRECTORY");
    expect(saved.approvers.map((row) => row.personId).sort()).toEqual(
      [FINANCE, REVIEWER].sort(),
    );

    // 全量替换：移除 REVIEWER，行保留但置为 inactive。
    const replace = await request(app, "PUT", "/api/v1/accounting-period-approvers", {
      personIds: [FINANCE],
    });
    expect(replace.statusCode).toBe(200);

    const listed = await request(app, "GET", "/api/v1/accounting-period-approvers");
    expect(listed.statusCode).toBe(200);
    const current = body<{ approvers: Array<{ personId: string }> }>(listed);
    expect(current.approvers.map((row) => row.personId)).toEqual([FINANCE]);
    const directory = await platformStore.listAccountingPeriodApprovers(TENANT);
    expect(directory.find((row) => row.personId === REVIEWER)?.active).toBe(false);
  });

  it("rejects cross-tenant and non-active approvers", async () => {
    const platformStore = createStore();
    const inactiveId = await seedRoles(platformStore);
    const otherTenant = await platformStore.createTenant({
      name: "Other tenant",
      slug: "other-approver-tenant",
    });
    const outsider = await platformStore.createPerson({
      tenantId: otherTenant.id,
      employeeCode: "E201",
      displayName: "Outsider",
    });
    const store = new Store(TENANT);
    const app = buildAppFor(platformStore, ADMIN, store);

    const crossTenant = await request(
      app,
      "PUT",
      "/api/v1/accounting-period-approvers",
      { personIds: [outsider.id] },
    );
    expect(crossTenant.statusCode).toBe(409);
    expect((crossTenant.json() as { error: { message: string } }).error.message).toMatch(
      /APPROVER_NOT_IN_TENANT/,
    );

    const inactive = await request(
      app,
      "PUT",
      "/api/v1/accounting-period-approvers",
      { personIds: [inactiveId] },
    );
    expect(inactive.statusCode).toBe(409);
    expect((inactive.json() as { error: { message: string } }).error.message).toMatch(
      /APPROVER_INACTIVE/,
    );

    const empty = await request(
      app,
      "PUT",
      "/api/v1/accounting-period-approvers",
      { personIds: [] },
    );
    expect(empty.statusCode).toBe(400);
  });

  it("notifies configured approvers (excluding requester) when a request is created", async () => {
    const platformStore = createStore();
    await seedRoles(platformStore);
    const store = new Store(TENANT);
    const requesterApp = buildAppFor(platformStore, ADMIN, store);

    const configure = await request(
      requesterApp,
      "PUT",
      "/api/v1/accounting-period-approvers",
      { personIds: [FINANCE, REVIEWER] },
    );
    expect(configure.statusCode).toBe(200);

    const close = await request(
      requesterApp,
      "POST",
      "/api/v1/accounting-periods/close",
      {
        legalEntityId: LEGAL_ENTITY,
        period: PERIOD,
        actorPersonId: ADMIN,
        reason: "month-end close",
      },
    );
    expect(close.statusCode).toBe(202);
    const change = body<{ id: string; status: string; action: string }>(close);
    expect(change.status).toBe("PENDING");

    const financeNotes = await notificationsFor(store, FINANCE);
    const financeNote = financeNotes.find(
      (note) => note.sourceId === change.id,
    );
    expect(financeNote?.sourceType).toBe("ACCOUNTING_PERIOD_APPROVAL");
    expect(financeNote?.title).toContain("待审批");

    const reviewerNotes = await notificationsFor(store, REVIEWER);
    expect(
      reviewerNotes.some(
        (note) =>
          note.sourceType === "ACCOUNTING_PERIOD_APPROVAL" &&
          note.sourceId === change.id,
      ),
    ).toBe(true);

    // 请求人不通知自己。
    const requesterNotes = await notificationsFor(store, ADMIN);
    expect(
      requesterNotes.some(
        (note) =>
          note.sourceType === "ACCOUNTING_PERIOD_APPROVAL" &&
          note.sourceId === change.id,
      ),
    ).toBe(false);
  });

  it("notifies the requester with the approval or rejection result", async () => {
    const platformStore = createStore();
    await seedRoles(platformStore);
    const store = new Store(TENANT);
    const requesterApp = buildAppFor(platformStore, ADMIN, store);
    const approverApp = buildAppFor(platformStore, FINANCE, store, ["finance"]);

    const close = await request(
      requesterApp,
      "POST",
      "/api/v1/accounting-periods/close",
      {
        legalEntityId: "LE-RESULT",
        period: PERIOD,
        actorPersonId: ADMIN,
        reason: "close for result notification",
      },
    );
    expect(close.statusCode).toBe(202);
    const change = body<{ id: string }>(close);

    const approve = await request(
      approverApp,
      "POST",
      `/api/v1/accounting-periods/change-requests/${change.id}/decide`,
      { decision: "APPROVE", approverPersonId: FINANCE, note: "approved by finance" },
    );
    expect(approve.statusCode).toBe(200);

    const requesterNotes = await notificationsFor(store, ADMIN);
    const resultNote = requesterNotes.find(
      (note) => note.sourceId === change.id,
    );
    expect(resultNote?.sourceType).toBe("ACCOUNTING_PERIOD_APPROVAL_RESULT");
    expect(resultNote?.title).toContain("已批准");

    // 驳回也必须通知请求人。
    const rejectClose = await request(
      requesterApp,
      "POST",
      "/api/v1/accounting-periods/close",
      {
        legalEntityId: "LE-RESULT-REJECT",
        period: PERIOD,
        actorPersonId: ADMIN,
        reason: "close for rejection notification",
      },
    );
    expect(rejectClose.statusCode).toBe(202);
    const rejectedChange = body<{ id: string }>(rejectClose);
    const reject = await request(
      approverApp,
      "POST",
      `/api/v1/accounting-periods/change-requests/${rejectedChange.id}/decide`,
      { decision: "REJECT", approverPersonId: FINANCE, note: "missing support" },
    );
    expect(reject.statusCode).toBe(200);

    const afterReject = await notificationsFor(store, ADMIN);
    const rejectionNote = afterReject.find(
      (note) => note.sourceId === rejectedChange.id,
    );
    expect(rejectionNote?.sourceType).toBe(
      "ACCOUNTING_PERIOD_APPROVAL_RESULT",
    );
    expect(rejectionNote?.title).toContain("已驳回");
  });

  it("falls back to tenant admin/finance roles when the directory is empty", async () => {
    const platformStore = createStore();
    await seedRoles(platformStore);
    const store = new Store(TENANT);
    const requesterApp = buildAppFor(platformStore, ADMIN, store);

    const close = await request(
      requesterApp,
      "POST",
      "/api/v1/accounting-periods/close",
      {
        legalEntityId: "LE-FALLBACK",
        period: PERIOD,
        actorPersonId: ADMIN,
        reason: "directory is empty",
      },
    );
    expect(close.statusCode).toBe(202);

    const resolution = await request(
      requesterApp,
      "GET",
      "/api/v1/accounting-period-approvers",
    );
    expect(resolution.statusCode).toBe(200);
    const effective = body<{
      source: string;
      approvers: Array<{ personId: string }>;
    }>(resolution);
    expect(effective.source).toBe("ROLE_FALLBACK");
    expect(effective.approvers.map((row) => row.personId).sort()).toEqual(
      [ADMIN, FINANCE].sort(),
    );

    // 不能因为目录为空阻断请求；FINANCE（角色回退、非请求人）收到通知。
    const change = body<{ id: string }>(close);
    const financeNotes = await notificationsFor(store, FINANCE);
    expect(
      financeNotes.some(
        (note) =>
          note.sourceType === "ACCOUNTING_PERIOD_APPROVAL" &&
          note.sourceId === change.id,
      ),
    ).toBe(true);
  });
});
