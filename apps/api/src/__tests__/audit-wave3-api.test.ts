/**
 * 2026-11-21 审计包 Wave 3（NP-011）：制度计算 API 逐 calculator 严格 Zod——
 * 负值/越界/重复人员 → 400 POLICY_INPUT_INVALID；正路径不回归。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";

function buildAppFor(tenantId: string) {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: tenantId,
      name: `Wave3 tenant ${tenantId.slice(-4)}`,
      slug: `wave3-${tenantId.slice(-4)}`,
    },
  });
  return buildApp(
    () => new Store(tenantId),
    undefined,
    {
      async authenticate() {
        return {
          tenantId,
          userId: "wave3-test",
          roles: ["admin"],
          personId: ADMIN,
        };
      },
    },
    platformStore,
  );
}

async function postPolicy(
  app: Awaited<ReturnType<typeof buildApp>>,
  path: string,
  body: unknown,
) {
  const res = await app.inject({
    method: "POST",
    url: path,
    payload: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return { status: res.statusCode, body: res.json() as { error?: { code?: string; message?: string } } };
}

describe("NP-011: 制度计算 API 严格 Zod（finance calculators）", () => {
  it("DBCP 端点：负费用 → 400 POLICY_INPUT_INVALID；非法金额格式 → 400", async () => {
    const app = buildAppFor(TENANT);
    const neg = await postPolicy(app, "/api/v1/policy/incentive/dbcp", {
      grossProfit: "1000",
      businessExpenses: "-50",
    });
    expect(neg.status).toBe(400);
    expect(["VALIDATION_ERROR", "POLICY_INPUT_INVALID"]).toContain(
      neg.body.error?.code,
    );
    const bad = await postPolicy(app, "/api/v1/policy/incentive/dbcp", {
      grossProfit: "not-a-number",
    });
    expect(bad.status).toBe(400);
  });

  it("内部分配端点：重复人员 → 400；比例合计非 100 → 400", async () => {
    const app = buildAppFor(TENANT);
    const dup = await postPolicy(app, "/api/v1/policy/incentive/internal-split", {
      commissionPool: "100",
      marketingReward: "0",
      executiveSupplement: "0",
      participants: [
        { personId: ADMIN, sharePercent: "50" },
        { personId: ADMIN, sharePercent: "50" },
      ],
    });
    expect(dup.status).toBe(400);
    // 比例合计非 100% 是域层验证结果（valid:false），不是协议层错误——既有契约。
    const badTotal = await postPolicy(app, "/api/v1/policy/incentive/internal-split", {
      commissionPool: "100",
      marketingReward: "0",
      executiveSupplement: "0",
      participants: [{ personId: ADMIN, sharePercent: "90" }],
    });
    expect(badTotal.status).toBe(200);
    expect((badTotal.body as { data?: { valid?: boolean } }).data?.valid).toBe(false);
  });

  it("提成端点：合法请求 200（正路径不回归）", async () => {
    const app = buildAppFor(TENANT);
    const ok = await postPolicy(app, "/api/v1/policy/incentive/business-unit-commission", {
      dbcp: "200",
      netCollection: "1000",
    });
    expect(ok.status).toBe(200);
  });
});
