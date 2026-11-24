/**
 * 审计加固批（P0/P1）回归：授权收口与跨租户防护。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const TENANT = "00000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "00000000-0000-4000-8000-000000000010";

function authFor(
  roles: string[],
  personId?: string,
  tenantId = TENANT,
  servicePrincipal?: boolean,
) {
  return {
    async authenticate() {
      return {
        tenantId,
        userId: `user-${personId ?? "machine"}`,
        roles,
        personId,
        ...(servicePrincipal ? { servicePrincipal: true } : {}),
      };
    },
  };
}

function setup(
  roles: string[],
  personId?: string,
  tenantId = TENANT,
  shared?: { appStore: Store; platformStore: MemoryPlatformStore },
) {
  const appStore = shared?.appStore ?? new Store(tenantId);
  const platformStore =
    shared?.platformStore ??
    new MemoryPlatformStore({
      demoTenant: { id: TENANT, name: "Tenant", slug: "t1", modules: [] },
    });
  if (!shared && tenantId !== TENANT) {
    void platformStore.createTenant({ name: "Other", slug: "t2" });
  }
  const app = buildApp(
    () => appStore,
    undefined,
    authFor(roles, personId, tenantId),
    platformStore,
  );
  return { app, appStore, platformStore };
}

/** 同一份存储上的不同身份 app（模拟同一租户内的员工/经理）。 */
function setup2(roles: string[], personId?: string) {
  const appStore = new Store(TENANT);
  const platformStore = new MemoryPlatformStore({
    demoTenant: { id: TENANT, name: "Tenant", slug: "t1", modules: [] },
  });
  return setup(roles, personId, TENANT, { appStore, platformStore });
}

async function seedTodo(store: Store, assigneePersonId: string, key: string) {
  return store.upsertAgentTodo({
    title: `todo ${key}`,
    assigneePersonId,
    sourceType: "AGENT_FINDING",
    sourceId: key,
    idempotencyKey: key,
  });
}

describe("审计加固：待办完成收口（AUD-005/011）", () => {
  it("员工不能完成他人的待办；本人可以；管理器可代办", async () => {
    const { app, appStore } = setup(["employee"], MEMBER);
    const foreign = await seedTodo(appStore, OWNER, "foreign-todo");
    const mine = await seedTodo(appStore, MEMBER, "my-todo");

    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/agent-todos/${foreign.id}/complete`,
      payload: {},
    });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/agent-todos/${mine.id}/complete`,
      payload: {},
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { data: { completedByPersonId?: string } }).data.completedByPersonId).toBe(
      MEMBER,
    );

    const manager = setup2(["manager"], MEMBER);
    const todoForManager = await seedTodo(manager.appStore, OWNER, "manager-todo");
    const managerDone = await manager.app.inject({
      method: "POST",
      url: `/api/v1/agent-todos/${todoForManager.id}/complete`,
      payload: {},
    });
    expect(managerDone.statusCode).toBe(200);
  });

  it("机器令牌（无 person 声明）系统完成：completed_by 为 null，不写非法 UUID", async () => {
    const { app, appStore } = setup(["integration"]);
    const todo = await seedTodo(appStore, OWNER, "system-todo");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/agent-todos/${todo.id}/complete`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { status: string; completedByPersonId?: string } }).data;
    expect(data.status).toBe("DONE");
    expect(data.completedByPersonId).toBeUndefined();
  });

  it("员工读取他人待办 → 403（person-level IDOR 收口）", async () => {
    const { app, appStore } = setup(["employee"], MEMBER);
    const foreign = await seedTodo(appStore, OWNER, "read-foreign");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/agent-todos/${foreign.id}`,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("审计加固：证据互链与验收人收口", () => {
  it("员工不能建立证据互链；管理器可以", async () => {
    const shared = new Store(TENANT);
    const sharedPlatform = new MemoryPlatformStore({
      demoTenant: { id: TENANT, name: "Tenant", slug: "t1", modules: [] },
    });
    const employee = setup(["employee"], MEMBER, TENANT, {
      appStore: shared,
      platformStore: sharedPlatform,
    });
    const first = await employee.appStore.createEvidence({
      sourceSystem: "TEST",
      subjectType: "WORK_PACKAGE",
      subjectId: "00000000-0000-4000-8000-000000000030",
      evidenceType: "NOTE",
      normalizedPayload: { note: "a" },
      qualityStatus: "VALID",
    });
    const second = await employee.appStore.createEvidence({
      sourceSystem: "TEST",
      subjectType: "WORK_PACKAGE",
      subjectId: "00000000-0000-4000-8000-000000000030",
      evidenceType: "NOTE",
      normalizedPayload: { note: "b" },
      qualityStatus: "VALID",
    });
    const denied = await employee.app.inject({
      method: "POST",
      url: `/api/v1/evidence/${first.id}/links`,
      payload: { toEvidenceId: second.id, relationType: "SUPPORTS" },
    });
    expect(denied.statusCode).toBe(403);

    const manager = setup(["manager"], MEMBER, TENANT, {
      appStore: shared,
      platformStore: sharedPlatform,
    });
    const link = await manager.app.inject({
      method: "POST",
      url: `/api/v1/evidence/${first.id}/links`,
      payload: { toEvidenceId: second.id, relationType: "SUPPORTS" },
    });
    expect(link.statusCode).toBe(201);
  });

  it("工作包验收人必须是会话身份（不可代他人验收）", async () => {
    // 验收人 = MEMBER 会话；OWNER 是交付所有者，不能验收自己的交付。
    const { app, appStore } = setup(["manager"], MEMBER);
    const wp = await appStore.createWorkPackage({
      title: "accept-probe",
      objective: "accept probe objective",
      ownerPersonId: OWNER,
      members: [
        { personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "d" },
        { personId: MEMBER, responsibilityCode: "CONTRIBUTOR", expectedOutput: "r" },
      ],
      acceptanceCriteria: ["done"],
    });
    await appStore.commitWorkPackage(wp.id, 1);
    await appStore.startWorkPackage(wp.id);
    await appStore.submitWorkPackage(wp.id);

    const forged = await app.inject({
      method: "POST",
      url: `/api/v1/work-packages/${wp.id}/accept`,
      payload: { reviewerPersonId: OWNER },
    });
    expect(forged.statusCode).toBe(403);

    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/work-packages/${wp.id}/accept`,
      payload: { reviewerPersonId: MEMBER },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("月度政策复核签署人必须是会话身份", async () => {
    const { app } = setup(["finance"], MEMBER);
    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/reports/policy-review:finalize",
      payload: {
        from: "2026-01-01",
        to: "2026-12-31",
        report: { summary: "ok" },
        signedOffBy: OWNER,
      },
    });
    expect(forged.statusCode).toBe(403);
  });
});

describe("NP-002/003/004/005：裁决身份、盲审掩码、chat 出境门禁", () => {
  it("NP-002：归属裁决人必须是会话身份", async () => {
    const { app, appStore } = setup(["manager"], OWNER);
    const wp = await appStore.createWorkPackage({
      title: "np002-wp",
      objective: "np002 objective",
      ownerPersonId: OWNER,
      members: [
        { personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "d" },
        { personId: MEMBER, responsibilityCode: "CONTRIBUTOR", expectedOutput: "r" },
      ],
      acceptanceCriteria: ["done"],
    });
    await appStore.commitWorkPackage(wp.id, 1);
    await appStore.startWorkPackage(wp.id);
    await appStore.submitWorkPackage(wp.id);
    await appStore.acceptWorkPackage(wp.id, MEMBER);
    const claim = await appStore.createClaim({
      workPackageId: wp.id,
      claimantPersonId: MEMBER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: { dimensions: ["QUALITY"], summary: "x" },
      evidenceRefs: [],
      rationale: "np002",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/attribution-decisions",
      payload: {
        claimId: claim.id,
        adjudicatorPersonId: MEMBER,
        status: "CONFIRMED",
        acceptedFacts: [],
        rejectedFacts: [],
        contributionDimensions: { QUALITY: 1 },
        rationale: "forged adjudicator",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("NP-003：评价复核人必须是会话身份", async () => {
    const { app, appStore } = setup(["manager"], OWNER);
    const rubric = await appStore.createRubric({
      code: "NP003_RUBRIC",
      name: "np003",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-10-01",
    });
    const draft = await appStore.createEvaluationDraft({
      cycleId: "00000000-0000-4000-8000-000000000020",
      personId: MEMBER,
      generatedByType: "USER",
      evidenceSnapshotHash: "np003",
      draftPayload: {},
    });
    await appStore.submitEvaluationDraft(draft.id);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/evaluation-drafts/${draft.id}/decision`,
      payload: {
        reviewerPersonId: MEMBER,
        rubricVersionId: rubric.id,
        decision: "APPROVE",
        scores: { QUALITY: 4 },
        independentScores: { QUALITY: 4 },
        independentRationale: "independent",
        rationale: "forged reviewer",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("NP-004：AI 草案在 SUBMITTED 阶段由服务端掩码，决定后揭示", async () => {
    const { app, appStore } = setup(["manager"], OWNER);
    const rubric = await appStore.createRubric({
      code: "NP004_RUBRIC",
      name: "np004",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-10-01",
    });
    const draft = await appStore.createEvaluationDraft({
      cycleId: "00000000-0000-4000-8000-000000000020",
      personId: MEMBER,
      generatedByType: "AGENT",
      evidenceSnapshotHash: "np004",
      strengthPayload: undefined,
      draftPayload: { secret: "ai-draft-content" },
      strengths: ["strong evidence"],
      counterEvidence: ["weak counter"],
      missingInformation: ["acceptance record"],
    } as never);
    await appStore.submitEvaluationDraft(draft.id);

    const masked = await app.inject({
      method: "GET",
      url: `/api/v1/evaluation-drafts/${draft.id}`,
    });
    const maskedBody = (masked.json() as { data: Record<string, unknown> }).data;
    expect(maskedBody.contentHidden).toBe(true);
    expect(maskedBody.draftPayload).toEqual({});
    expect(maskedBody.strengths).toEqual([]);

    // 复核（本人会话）批准后内容揭示
    const decided = await app.inject({
      method: "POST",
      url: `/api/v1/evaluation-drafts/${draft.id}/decision`,
      payload: {
        reviewerPersonId: OWNER,
        rubricVersionId: rubric.id,
        decision: "APPROVE",
        scores: { QUALITY: 4 },
        independentScores: { QUALITY: 4 },
        independentRationale: "independent",
        rationale: "np004",
      },
    });
    expect(decided.statusCode).toBe(200);
    const revealed = await app.inject({
      method: "GET",
      url: `/api/v1/evaluation-drafts/${draft.id}`,
    });
    const revealedBody = (revealed.json() as { data: Record<string, unknown> }).data;
    expect(revealedBody.contentHidden).toBeUndefined();
    expect(revealedBody.draftPayload).toEqual({ secret: "ai-draft-content" });
  });

  it("NP-005：/agent-chat 必须过模型供应商数据策略门禁", async () => {
    const platformStore = new MemoryPlatformStore({
      demoTenant: { id: TENANT, name: "Tenant", slug: "t1" },
    });
    const previous = process.env.NODE_ENV;
    const previousSigning = process.env.WEBHOOK_SIGNING_SECRET;
    const previousRaw = process.env.WEBHOOK_RAW_KEY;
    process.env.NODE_ENV = "production";
    // P0 密钥分离：生产 buildApp 需要独立的签名/加密密钥（否则 fail-closed）。
    process.env.WEBHOOK_SIGNING_SECRET =
      "test-production-webhook-signing-secret-0123456789";
    process.env.WEBHOOK_RAW_KEY =
      "test-production-webhook-raw-key-0123456789abcdef";
    try {
      const app = buildApp(
        () => new Store(TENANT),
        undefined,
        authFor(["manager"], OWNER),
        platformStore,
        {
          agentChat: {
            provider: "deepseek",
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: "k",
            model: "deepseek-chat",
          },
        },
      );
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/agent-chat",
        payload: { messages: [{ role: "user", content: "推进周期" }] },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toContain(
        "MODEL_PROVIDER_POLICY_REQUIRED",
      );
    } finally {
      process.env.NODE_ENV = previous;
      if (previousSigning === undefined) delete process.env.WEBHOOK_SIGNING_SECRET;
      else process.env.WEBHOOK_SIGNING_SECRET = previousSigning;
      if (previousRaw === undefined) delete process.env.WEBHOOK_RAW_KEY;
      else process.env.WEBHOOK_RAW_KEY = previousRaw;
    }
  });
});

describe("审计加固：服务主体 vs 无 person 用户令牌（AUD-005）", () => {
  /** 租户已启用 PAYROLL + 结算 GO，才能观察到 actor 校验本身。 */
  function payrollReady(servicePrincipal: boolean | undefined) {
    const platformStore = new MemoryPlatformStore({
      demoTenant: {
        id: TENANT,
        name: "Tenant",
        slug: "t1",
        modules: ["PAYROLL"],
      },
    });
    void platformStore.updateTenantSettings({
      tenantId: TENANT,
      settings: { settlementGo: true },
    });
    return buildApp(
      () => new Store(TENANT),
      undefined,
      authFor(["admin", "finance"], undefined, TENANT, servicePrincipal),
      platformStore,
    );
  }

  const payload = {
    cycleId: "00000000-0000-4000-8000-000000000020",
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-10-31T23:59:59.999Z",
    currency: "CNY",
    preparedBy: OWNER,
  };

  it("无 person 且非服务主体：actor 写入一律 403（不能凭角色任意署名）", async () => {
    const app = payrollReady(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payroll-runs",
      payload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/service principal/);
  });

  it("服务主体（显式标记）可代办：越过 actor 校验进入业务校验", async () => {
    const app = payrollReady(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payroll-runs",
      payload,
    });
    // 不再是 actor 403——周期不存在等业务错误决定结果。
    expect(res.statusCode).not.toBe(403);
  });

  it("无 person 用户代签政策复核同样 fail-closed", async () => {
    const app = payrollReady(false);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports/policy-review:finalize",
      payload: {
        from: "2026-01-01",
        to: "2026-12-31",
        report: { summary: "ok" },
        signedOffBy: OWNER,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/service principal/);
  });
});

describe("审计加固：模块开关跨租户防护", () => {
  it("租户管理员不能修改其他租户的模块开关", async () => {
    const { app } = setup(["admin"], OWNER);
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/platform/tenants/${OTHER_TENANT}/modules`,
      payload: { modules: ["PAYROLL"] },
    });
    expect(res.statusCode).toBe(403);
  });
});
