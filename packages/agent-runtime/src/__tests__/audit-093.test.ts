/**
 * 审计加固批（P0）回归：调度器只入队模式与 Outbox 跨租户分发。
 */
import { describe, expect, it, vi } from "vitest";
import { AgentScheduler } from "../scheduler.js";
import { OutboxPoller, type OutboxEvent, type OutboxSource } from "../outbox.js";
import type { AgentRuntime } from "../runtime.js";

function stubRuntime(tenant: string) {
  const enqueued: Array<{ tenantId: string; idempotencyKey: string }> = [];
  const runtime = {
    async enqueue(input: { tenantId: string; idempotencyKey: string }) {
      enqueued.push({ tenantId: input.tenantId, idempotencyKey: input.idempotencyKey });
      return {
        id: `task-${enqueued.length}`,
        tenantId: input.tenantId,
        status: "QUEUED",
      };
    },
    run: vi.fn(async (taskId: string) => ({
      id: taskId,
      tenantId: tenant,
      status: "SUCCEEDED",
    })),
  };
  return { runtime: runtime as unknown as AgentRuntime, enqueued };
}

describe("AUD-013: scheduler autoRun=false（只入队，执行权归 Dispatcher）", () => {
  it("tick 只 enqueue 不 run", async () => {
    const { runtime, enqueued } = stubRuntime("tenant-a");
    const scheduler = new AgentScheduler(runtime, "tenant-a", "probe", {
      autoRun: false,
    });
    scheduler.addSchedule({ id: "s", agentType: "EVIDENCE_GAP", intervalMs: 1000 });
    const tasks = await scheduler.tick(5000);
    expect(tasks).toHaveLength(1);
    expect(enqueued[0]!.tenantId).toBe("tenant-a");
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("默认 autoRun=true 时照旧执行", async () => {
    const { runtime } = stubRuntime("tenant-a");
    const scheduler = new AgentScheduler(runtime, "tenant-a");
    scheduler.addSchedule({ id: "s", agentType: "EVIDENCE_GAP", intervalMs: 1000 });
    await scheduler.tick(5000);
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });
});

describe("AUD-013/P0: Outbox 跨租户分发", () => {
  function sourceWith(events: OutboxEvent[]): OutboxSource {
    return {
      async claimBatch() {
        return events;
      },
      async markPublished() {},
    };
  }

  it("无 schedulerFor 时拒绝把其它租户事件落成本租户任务", async () => {
    const { runtime } = stubRuntime("tenant-a");
    const bound = new AgentScheduler(runtime, "tenant-a");
    bound.addEventRule({
      id: "r",
      eventType: "ContributionClaimSubmitted",
      agentType: "CONTRIBUTION_ANOMALY",
    });
    const poller = new OutboxPoller(
      sourceWith([
        {
          id: "evt-1",
          tenantId: "tenant-b",
          eventType: "ContributionClaimSubmitted",
          payload: {},
          occurredAt: new Date().toISOString(),
        },
      ]),
      bound,
    );
    await expect(poller.pollOnce()).rejects.toThrow(/OUTBOX_CROSS_TENANT_DISPATCH/);
  });

  it("提供 schedulerFor 时按事件租户分发", async () => {
    const a = stubRuntime("tenant-a");
    const b = stubRuntime("tenant-b");
    const schedulerA = new AgentScheduler(a.runtime, "tenant-a");
    const schedulerB = new AgentScheduler(b.runtime, "tenant-b");
    for (const scheduler of [schedulerA, schedulerB]) {
      scheduler.addEventRule({
        id: "r",
        eventType: "ContributionClaimSubmitted",
        agentType: "CONTRIBUTION_ANOMALY",
      });
    }
    const poller = new OutboxPoller(
      sourceWith([
        {
          id: "evt-b",
          tenantId: "tenant-b",
          eventType: "ContributionClaimSubmitted",
          payload: {},
          occurredAt: new Date().toISOString(),
        },
      ]),
      schedulerA,
      50,
      { schedulerFor: (tenant) => (tenant === "tenant-b" ? schedulerB : schedulerA) },
    );
    const tasks = await poller.pollOnce();
    expect(tasks).toHaveLength(1);
    expect(a.enqueued).toHaveLength(0);
    expect(b.enqueued).toHaveLength(1);
    expect(b.enqueued[0]!.tenantId).toBe("tenant-b");
  });
});
