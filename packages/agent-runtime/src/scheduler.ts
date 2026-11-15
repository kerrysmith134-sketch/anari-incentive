import { randomUUID } from "node:crypto";
import type { AgentTask } from "./types.js";
import { AgentRuntimeError, type AgentRuntime } from "./runtime.js";

export interface ScheduleRule {
  id: string;
  agentType: string;
  intervalMs: number;
  input?: Record<string, unknown>;
  lastRunAt?: number;
}

export interface EventRule {
  id: string;
  eventType: string;
  agentType: string;
  input?: Record<string, unknown>;
}

export type ThresholdComparator = ">" | ">=" | "<" | "<=" | "==";

export interface ThresholdRule {
  id: string;
  metric: string;
  comparator: ThresholdComparator;
  value: number;
  agentType: string;
  input?: Record<string, unknown>;
}

function matches(value: number, comparator: ThresholdComparator, target: number) {
  switch (comparator) {
    case ">": return value > target;
    case ">=": return value >= target;
    case "<": return value < target;
    case "<=": return value <= target;
    case "==": return value === target;
  }
}

/**
 * Deterministic scheduler for proactive agent work.
 *
 * This is intentionally not a cron daemon: a worker calls `tick()` on its own
 * cadence, `emit()` on domain events, and `evaluateThresholds()` after metric
 * refreshes. Idempotency keys make repeated ticks/events safe.
 */
export class AgentScheduler {
  private readonly schedules = new Map<string, ScheduleRule>();
  private readonly events = new Map<string, EventRule>();
  private readonly thresholds = new Map<string, ThresholdRule>();

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly tenantId: string,
    private readonly prefix = "scheduler",
    /**
     * AUD-013 follow-up：autoRun=false 时 tick/emit/阈值只入队不执行，
     * 由多租户 Dispatcher 统一 claim 执行——避免与调度器直接 run 的
     * 双执行窗口（同一 QUEUED 行被两边同时执行）。
     */
    private readonly options: { autoRun?: boolean } = {},
  ) {}

  /** 所属租户（Outbox 跨租户分发校验用）。 */
  get tenant(): string {
    return this.tenantId;
  }

  private async dispatch(task: AgentTask): Promise<AgentTask> {
    if (this.options.autoRun === false) return task;
    try {
      return await this.runtime.run(task.id);
    } catch (error) {
      // 任务已被其他 worker 领取（RUNNING）——跳过而非中断整批。
      if (
        error instanceof AgentRuntimeError &&
        error.code === "AGENT_TASK_NOT_CLAIMABLE"
      ) {
        return task;
      }
      throw error;
    }
  }

  addSchedule(rule: ScheduleRule): void {
    this.schedules.set(rule.id, rule);
  }

  addEventRule(rule: EventRule): void {
    this.events.set(rule.id, rule);
  }

  addThresholdRule(rule: ThresholdRule): void {
    this.thresholds.set(rule.id, rule);
  }

  async tick(now = Date.now()): Promise<AgentTask[]> {
    const tasks: AgentTask[] = [];
    for (const rule of this.schedules.values()) {
      const last = rule.lastRunAt ?? -Infinity;
      if (now - last < rule.intervalMs) continue;
      rule.lastRunAt = now;
      const bucket = Math.floor(now / rule.intervalMs);
      const task = await this.runtime.enqueue({
        tenantId: this.tenantId,
        agentType: rule.agentType,
        triggerType: "SCHEDULE",
        triggerRef: rule.id,
        input: rule.input,
        idempotencyKey: `${this.prefix}:schedule:${rule.id}:${bucket}`,
      });
      tasks.push(await this.dispatch(task));
    }
    return tasks;
  }

  async emit(
    eventType: string,
    payload: Record<string, unknown> = {},
    eventId: string = randomUUID(),
  ): Promise<AgentTask[]> {
    const tasks: AgentTask[] = [];
    for (const rule of this.events.values()) {
      if (rule.eventType !== eventType) continue;
      const task = await this.runtime.enqueue({
        tenantId: this.tenantId,
        agentType: rule.agentType,
        triggerType: "EVENT",
        triggerRef: eventType,
        input: { ...rule.input, ...payload },
        idempotencyKey: `${this.prefix}:event:${eventType}:${eventId}:${rule.id}`,
      });
      tasks.push(await this.dispatch(task));
    }
    return tasks;
  }

  async evaluateThresholds(
    metrics: Record<string, number>,
  ): Promise<AgentTask[]> {
    const tasks: AgentTask[] = [];
    for (const rule of this.thresholds.values()) {
      const value = metrics[rule.metric];
      if (value === undefined || !matches(value, rule.comparator, rule.value)) {
        continue;
      }
      const task = await this.runtime.enqueue({
        tenantId: this.tenantId,
        agentType: rule.agentType,
        triggerType: "THRESHOLD",
        triggerRef: `${rule.metric}${rule.comparator}${rule.value}`,
        input: { ...rule.input, metric: rule.metric, value },
        idempotencyKey: `${this.prefix}:threshold:${rule.id}:${rule.metric}:${value}`,
      });
      tasks.push(await this.dispatch(task));
    }
    return tasks;
  }

  list(): {
    schedules: ScheduleRule[];
    events: EventRule[];
    thresholds: ThresholdRule[];
  } {
    return {
      schedules: [...this.schedules.values()],
      events: [...this.events.values()],
      thresholds: [...this.thresholds.values()],
    };
  }
}
