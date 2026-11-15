/**
 * D-07：正式结算 GO 闸门——新租户默认只跑影子结算，创建批次/导出/支付
 * 均返回稳定 403 SETTLEMENT_GO_REQUIRED；显式开启后才放行。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const ADMIN = "00000000-0000-4000-8000-000000000001";

function setup() {
  const platformStore = new MemoryPlatformStore();
  return (async () => {
    const tenant = await platformStore.createTenant({
      name: "Shadow tenant",
      slug: `shadow-${Date.now()}`,
    });
    // 薪酬路由先过 PAYROLL 模块门禁——先启用模块才能观察到 GO 闸门本身。
    await platformStore.updateTenantSettings({
      tenantId: tenant.id,
      settings: { modules: ["PAYROLL"] },
    });
    const appStore = new Store(tenant.id);
    const app = buildApp(
      () => appStore,
      undefined,
      {
        async authenticate() {
          return {
            tenantId: tenant.id,
            userId: "finance-1",
            roles: ["admin", "finance"],
            personId: ADMIN,
          };
        },
      },
      platformStore,
    );
    return { app, platformStore, tenant };
  })();
}

describe("D-07 settlement GO gate", () => {
  it("新租户（默认无 GO）：创建结算批次 → 403 SETTLEMENT_GO_REQUIRED", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/settlement-batches",
      payload: {
        cycleId: "00000000-0000-4000-8000-000000000020",
        batchNo: `SB-${Date.now()}`,
        kind: "STANDARD",
        currency: "CNY",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("SETTLEMENT_GO_REQUIRED");
  });

  it("新租户：结算导出与薪酬支付同样被闸门拦住", async () => {
    const { app } = await setup();
    const exportRes = await app.inject({
      method: "POST",
      url: "/api/v1/settlement-batches/00000000-0000-4000-8000-0000000000aa/exports",
      payload: { exportedBy: ADMIN },
    });
    expect(exportRes.statusCode).toBe(403);
    expect(exportRes.json().error.code).toBe("SETTLEMENT_GO_REQUIRED");

    const payRes = await app.inject({
      method: "POST",
      url: "/api/v1/payroll-runs/00000000-0000-4000-8000-0000000000bb/pay",
      payload: {},
    });
    expect(payRes.statusCode).toBe(403);
    expect(payRes.json().error.code).toBe("SETTLEMENT_GO_REQUIRED");
  });

  it("租户显式开启 GO 后，闸门放行（后续业务错误不再是 GO 码）", async () => {
    const { app, platformStore, tenant } = await setup();
    await platformStore.updateTenantSettings({
      tenantId: tenant.id,
      settings: { modules: ["PAYROLL"], settlementGo: true },
    });
    const payRes = await app.inject({
      method: "POST",
      url: "/api/v1/payroll-runs/00000000-0000-4000-8000-0000000000bb/pay",
      payload: {},
    });
    expect(payRes.json().error?.code).not.toBe("SETTLEMENT_GO_REQUIRED");
    // 运行不存在 → NOT_FOUND（证明已越过 GO 闸门进入业务校验）
    expect(payRes.statusCode).toBe(404);
  });

  it("演示租户（seed 已开启 GO）不被闸门拦截", async () => {
    const platformStore = new MemoryPlatformStore();
    const app = buildApp(
      () => new Store("tenant-demo"),
      undefined,
      {
        async authenticate() {
          return {
            tenantId: "tenant-demo",
            userId: "finance-1",
            roles: ["admin", "finance"],
            personId: ADMIN,
          };
        },
      },
      platformStore,
    );
    const payRes = await app.inject({
      method: "POST",
      url: "/api/v1/payroll-runs/00000000-0000-4000-8000-0000000000bb/pay",
      payload: {},
    });
    expect(payRes.json().error?.code).not.toBe("SETTLEMENT_GO_REQUIRED");
  });
});
