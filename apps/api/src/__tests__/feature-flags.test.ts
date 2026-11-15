/**
 * AUD-017 / D-04：租户模块 feature flags。
 *
 * 验收：新租户默认仅启用 P0（扩展域 API 403 FEATURE_DISABLED）；
 * 平台管理员显式开启后可用；变更写审计事件；未知模块键 400；
 * 前端同步数据源 GET /api/v1/tenant-modules。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const TENANT = "00000000-0000-4000-8000-000000000010";

function authFor(roles: string[]) {
  return {
    async authenticate() {
      return {
        tenantId: TENANT,
        userId: "user-ops",
        roles,
        personId: ADMIN,
      };
    },
  };
}

/** P0-only 租户（默认能力集：扩展域全部关闭）。 */
function setupP0Only() {
  const appStore = new Store(TENANT);
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "P0 tenant",
      slug: "p0-tenant",
      modules: [], // AUD-017：显式 P0-only（新租户生产默认）。
    },
  });
  const app = buildApp(() => appStore, undefined, authFor(["admin"]), platformStore);
  return { app, appStore, platformStore };
}

describe("AUD-017: 租户模块 feature flags", () => {
  it("默认 P0-only：扩展域 API 返回 403 FEATURE_DISABLED；tenant-modules 报告空能力集", async () => {
    const { app } = setupP0Only();
    const payroll = await app.inject({ method: "GET", url: "/api/v1/payroll-runs" });
    expect(payroll.statusCode).toBe(403);
    expect(payroll.json().error.code).toBe("FEATURE_DISABLED");

    const equity = await app.inject({ method: "GET", url: "/api/v1/equity-grants" });
    expect(equity.statusCode).toBe(403);
    expect(equity.json().error.code).toBe("FEATURE_DISABLED");

    const pool = await app.inject({ method: "GET", url: "/api/v1/strategic-pools" });
    expect([403, 404]).toContain(pool.statusCode);
    if (pool.statusCode === 403) {
      expect(pool.json().error.code).toBe("FEATURE_DISABLED");
    }

    const modules = await app.inject({ method: "GET", url: "/api/v1/tenant-modules" });
    expect(modules.statusCode).toBe(200);
    expect(modules.json().data.modules).toEqual([]);
  });

  it("管理员开启 PAYROLL/EQUITY 后可用；变更写审计；未知模块键 400", async () => {
    const { app } = setupP0Only();

    const invalid = await app.inject({
      method: "PUT",
      url: `/api/v1/platform/tenants/${TENANT}/modules`,
      payload: { modules: ["TELEPORT"] },
    });
    expect(invalid.statusCode).toBe(400);

    const enable = await app.inject({
      method: "PUT",
      url: `/api/v1/platform/tenants/${TENANT}/modules`,
      payload: { modules: ["PAYROLL", "EQUITY"] },
    });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().data.modules.sort()).toEqual(["EQUITY", "PAYROLL"]);

    const payroll = await app.inject({ method: "GET", url: "/api/v1/payroll-runs" });
    expect(payroll.statusCode).toBe(200);

    const equity = await app.inject({ method: "GET", url: "/api/v1/equity-grants" });
    expect(equity.statusCode).toBe(200);

    // 战略池仍未启用 → 仍然 FEATURE_DISABLED
    const pool = await app.inject({ method: "GET", url: "/api/v1/strategic-pools" });
    if (pool.statusCode !== 404) {
      expect(pool.statusCode).toBe(403);
      expect(pool.json().error.code).toBe("FEATURE_DISABLED");
    }

    // 审计事件：TENANT_MODULE_FLAGS_UPDATED 带前后状态
    const audit = await app.inject({
      method: "GET",
      url: "/api/v1/audit-events?limit=50",
    });
    const events = (audit.json() as { data?: Array<{ action?: string; reason?: string }> }).data ?? [];
    const flagEvent = events.find((entry) => entry.action === "TENANT_MODULE_FLAGS_UPDATED");
    expect(flagEvent).toBeDefined();
    expect(flagEvent?.reason).toContain("->");
    expect(flagEvent?.reason).toContain("PAYROLL");

    // 关闭后再次 403
    const disable = await app.inject({
      method: "PUT",
      url: `/api/v1/platform/tenants/${TENANT}/modules`,
      payload: { modules: [] },
    });
    expect(disable.statusCode).toBe(200);
    const payrollAgain = await app.inject({ method: "GET", url: "/api/v1/payroll-runs" });
    expect(payrollAgain.statusCode).toBe(403);
    expect(payrollAgain.json().error.code).toBe("FEATURE_DISABLED");
  });

  it("悬赏任务（P0 制度域）不受 EQUITY 门禁影响", async () => {
    const { app } = setupP0Only();
    const bounties = await app.inject({ method: "GET", url: "/api/v1/bounties" });
    expect(bounties.statusCode).toBe(200);
  });
});
