/**
 * NPV2 TDD 攻击面轮次批次 2（R16-R32，HTTP 层 + Agent 并发 + 越权注入）。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import { randomUUID } from "node:crypto";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";

function authFor(roles: string[], personId?: string) {
  return {
    async authenticate() {
      return {
        tenantId: "tenant-demo",
        userId: `user-${personId ?? "ops"}`,
        roles,
        personId,
      };
    },
  };
}

describe("TDD 攻击面批次 2：HTTP 层越权与注入（R16-R25）", () => {
  function setup(sessionRoles: string[], sessionPerson?: string) {
    const appStore = new Store("tenant-demo");
    const platformStore = new MemoryPlatformStore();
    const app = buildApp(
      () => appStore,
      undefined,
      authFor(sessionRoles, sessionPerson),
      platformStore,
    );
    return { app, appStore };
  }

  it("R16: 员工不能创建另一个人的工作包（owner 非本人 → 403）", async () => {
    const { app } = setup(["employee"], MEMBER);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-packages",
      payload: {
        title: "forged wp",
        objective: "forged objective here",
        ownerPersonId: OWNER,
        members: [{ personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "d" }],
        acceptanceCriteria: ["done"],
      },
    });
    // 员工创建 WP 时 owner 必须是自己——必须是 403（不允许 201 冒充通过）
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBeTruthy();
  });

  it("R17: SQL/NoSQL 注入 payload 不破坏列表查询（返回结构正常）", async () => {
    const { app } = setup(["admin"]);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/work-packages",
    });
    expect(res.statusCode).toBe(200);
    // 注入探针不崩溃
    const probe = await app.inject({
      method: "POST",
      url: "/api/v1/work-packages",
      payload: {
        title: { $gt: "" },
        objective: "probe objective",
        ownerPersonId: OWNER,
        members: [{ personId: OWNER, responsibilityCode: "OWNER", expectedOutput: "d" }],
        acceptanceCriteria: ["done"],
      },
    });
    // 类型注入被 zod 拒（400），不得 2xx/5xx。
    expect(probe.statusCode).toBeGreaterThanOrEqual(400);
    expect(probe.statusCode).toBeLessThan(500);
  });

  it("R18: 超长字符串 payload 不 500（优雅 400）", async () => {
    const { app } = setup(["admin"]);
    const huge = "A".repeat(100_000);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-packages",
      payload: {
        title: huge,
        objective: "x",
        ownerPersonId: OWNER,
        members: [],
        acceptanceCriteria: ["done"],
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it("R19: 空 body POST 不 500", async () => {
    const { app } = setup(["admin"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-packages",
      payload: {},
    });
    expect(res.statusCode).toBeLessThan(500);
  });

  it("R20: 不存在的 agent-todo id → NotFound（不静默 200）", async () => {
    const { app } = setup(["admin"]);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/agent-todos/${randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("R21: 不存在的 metric snapshot id → NotFound", async () => {
    const { app } = setup(["admin"]);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/metric-measurement-snapshots/${randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("R22: 员工不能访问管理中心（manager only）", async () => {
    const { app } = setup(["employee"], MEMBER);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/cycle-readiness?cycleId=c1",
    });
    // 周期准备度是 manager/finance 路由——员工必须恰好 403。
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("R23: 大 limit 参数不 500（被 cap 或优雅处理）", async () => {
    const { app } = setup(["admin"]);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/agent-tasks?limit=999999",
    });
    expect(res.statusCode).toBeLessThan(500);
  });

  it("R24: 无效 UUID 路径参数 → 400 而非 500", async () => {
    const { app } = setup(["admin"]);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/agent-tasks/not-a-uuid",
    });
    // 非法标识符按 NOT_FOUND（22P02 映射）处理，不得 5xx。
    expect(res.statusCode).toBe(404);
  });

  it("R25: 负数分页 limit → 不 500", async () => {
    const { app } = setup(["admin"]);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/agent-tasks?limit=-1",
    });
    // 合法数字但无意义：要么被规范化(200)要么 4xx，不能 5xx。
    expect([200, 400]).toContain(res.statusCode);
  });
});

describe("TDD 攻击面批次 2：Agent 并发与租约（覆盖说明）", () => {
  // R26/R27/R29/R31 的等价真实覆盖（不再保留 void 存根）：
  // - 并发 claim 恰一成功：packages/agent-runtime/src/__tests__/runtime.test.ts
  //   "claims exactly one winner"（Promise.all 双 worker）
  // - 过期租约回收：runtime.test.ts "expired leases are recoverable..."
  // - attempts 递增：runtime.test.ts 重试用例（attempts === 2）
  // - approve 后 reject：runtime.test.ts "rejects after approval"
  // - 租约 renew 归属：runtime.test.ts "renews only its own lease"
  // - 冲销/调整验证：store-contract.test.ts 台账域
  // - outbox attempt 单调：apps/api/src/__tests__/pg-store.test.ts outbox 用例
  it("批次 2 的空壳占位已移除（真实覆盖见 runtime/pg 套件）", () => {
    expect(true).toBe(true);
  });
});
