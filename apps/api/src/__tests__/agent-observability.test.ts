/**
 * AUD-023：Agent 可观测性持久化事实。
 *
 * 验收：标注/用量/AI-off 基线落库（幂等）；agent-metrics 报告从这些事实
 * 自动计算 falsePositiveRate 与 aiOffFloor；无事实时保持明确 unavailable
 * 原因（不以静态输入冒充实时指标）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const MANAGER = "00000000-0000-4000-8000-000000000001";

let appStore: Store;

function app() {
  const platformStore = new MemoryPlatformStore();
  return buildApp(
    () => appStore,
    undefined,
    {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "user-manager",
          roles: ["manager"],
          personId: MANAGER,
        };
      },
    },
    platformStore,
  );
}

describe("AUD-023: 可观测性持久化事实 → 自动指标", () => {
  beforeEach(() => {
    appStore = new Store("tenant-demo");
  });

  it("无标注/无基线时指标保持 unavailable（明确原因），报告披露 token 事实说明", async () => {
    const client = app();
    const res = await client.inject({ method: "GET", url: "/api/v1/reports/agent-metrics" });
    expect(res.statusCode).toBe(200);
    const report = res.json() as { data: Record<string, unknown> };
    const availability = (report.data.availability as Array<{
      metric: string;
      available: boolean;
      reason?: string;
    }>);
    const fp = availability.find((entry) => entry.metric === "falsePositiveRate")!;
    const off = availability.find((entry) => entry.metric === "aiOffFloor")!;
    expect(fp.available).toBe(false);
    expect(off.available).toBe(false);
    
    // 报告 note 同时披露 unavailable 语义与成本口径（单价目录未配置）。
    const note = (report.data as { note?: string }).note ?? "";
    expect(note).toContain("unavailable");
    expect(note).toContain("单价目录");
  });

  it("标注落库（幂等）后 falsePositiveRate 自动可用", async () => {
    const client = app();
    const post = async (label: string, taskId?: string) =>
      client.inject({
        method: "POST",
        url: "/api/v1/agent-feedback-labels",
        payload: { taskId, label },
      });
    const first = await post("FALSE_POSITIVE", "11111111-1111-4111-8111-111111111111");
    expect(first.statusCode).toBe(201);
    // 幂等：同 (task, labeledBy, label) 重复标注返回同一条
    const dup = await post("FALSE_POSITIVE", "11111111-1111-4111-8111-111111111111");
    expect(dup.statusCode).toBe(201);
    expect((dup.json() as { data: { id: string } }).data.id).toBe(
      (first.json() as { data: { id: string } }).data.id,
    );
    await post("CONFIRMED_POSITIVE", "22222222-2222-4222-8222-222222222222");
    await post("CONFIRMED_POSITIVE", "33333333-3333-4333-8333-333333333333");

    const res = await client.inject({ method: "GET", url: "/api/v1/reports/agent-metrics" });
    const report = res.json() as {
      data: { falsePositiveRate: number | null; availability: Array<{ metric: string; available: boolean }> };
    };
    expect(report.data.falsePositiveRate).toBeCloseTo(0.3333, 4);
    const availability = report.data.availability;
    expect(availability.find((entry) => entry.metric === "falsePositiveRate")!.available).toBe(
      true,
    );
  });

  it("AI-off 基线录入后 aiOffFloor 自动可用；ESCOBTED 之类未知枚举 400", async () => {
    const client = app();
    const bad = await client.inject({
      method: "POST",
      url: "/api/v1/agent-feedback-labels",
      payload: { label: "ESCOBTED" },
    });
    expect(bad.statusCode).toBe(400);

    const baseline = await client.inject({
      method: "POST",
      url: "/api/v1/agent-ai-off-baselines",
      payload: {
        windowStart: "2026-10-01",
        windowEnd: "2026-10-31",
        completionRate: "0.62",
        sampleSize: 50,
      },
    });
    expect(baseline.statusCode).toBe(201);

    const res = await client.inject({ method: "GET", url: "/api/v1/reports/agent-metrics" });
    const report = res.json() as { data: { aiOffFloor: { baselineCompletionRate: number | null } } };
    expect(report.data.aiOffFloor.baselineCompletionRate).toBeCloseTo(0.62, 4);
  });

  it("模型用量写通 upsertAgentModelUsage 并在报告披露（事实层）", async () => {
    const client = app();
    await appStore.upsertAgentModelUsage({
      provider: "openai-compatible",
      model: "m1",
      requests: 2,
      promptTokens: 100,
      completionTokens: 40,
    });
    await appStore.upsertAgentModelUsage({
      provider: "openai-compatible",
      model: "m1",
      requests: 1,
      promptTokens: 50,
      completionTokens: 10,
    });
    const usage = await appStore.listAgentModelUsage();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.requests).toBe(3);
    expect(usage[0]!.promptTokens).toBe(150);
    expect(usage[0]!.completionTokens).toBe(50);
    const res = await client.inject({ method: "GET", url: "/api/v1/reports/agent-metrics" });
    const report = res.json() as { data: { modelUsage: Array<{ promptTokens: number }> } };
    expect(report.data.modelUsage[0]!.promptTokens).toBe(150);
  });
});
