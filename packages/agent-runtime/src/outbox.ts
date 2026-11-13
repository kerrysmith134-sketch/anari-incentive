import type { AgentTask } from "./types.js";
import type { AgentScheduler } from "./scheduler.js";

export interface OutboxEvent {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface OutboxClaimContext {
  workerId: string;
  /** 租约时长毫秒；崩溃后租约到期，事件可被重新领取（不丢失）。 */
  leaseMs: number;
}

export interface OutboxSource {
  /** 旧式非原子拉取（兼容）；实现原子 claim 的源可不暴露。 */
  claimBatch(limit: number): Promise<OutboxEvent[]>;
  markPublished(id: string): Promise<void>;
  /**
   * NPV2-023：原子领取——FOR UPDATE SKIP LOCKED + 租约；两个 poller
   * 竞争同一事件时恰有一个成功。实现方应同时推进 attempt_count。
   */
  claimBatchAtomic?(input: OutboxClaimContext & {
    limit: number;
  }): Promise<OutboxEvent[]>;
  /** NPV2-023：崩溃恢复——过期租约复位，事件可被重新领取。 */
  recoverExpiredClaims?(): Promise<number>;
}

/**
 * Polls the transactional outbox and turns domain events into proactive agent
 * work. Events are marked published after dispatch; agent tasks are
 * idempotent, so a crash after dispatch but before markPublished is safe.
 */
export class OutboxPoller {
  constructor(
    private readonly source: OutboxSource,
    private readonly scheduler: AgentScheduler,
    private readonly batchSize = 50,
  ) {}

  /**
   * NPV2-023：一轮消费。支持原子 claim 的源走租约路径（先恢复过期租约）；
   * 重复投递安全——scheduler.emit 的幂等键含 eventId，同一事件重复处理
   * 不会产生重复任务。
   */
  async pollOnce(
    claim?: OutboxClaimContext,
  ): Promise<AgentTask[]> {
    const tasks: AgentTask[] = [];
    if (claim && this.source.claimBatchAtomic) {
      if (this.source.recoverExpiredClaims) {
        await this.source.recoverExpiredClaims();
      }
      const events = await this.source.claimBatchAtomic({
        ...claim,
        limit: this.batchSize,
      });
      for (const event of events) {
        const produced = await this.scheduler.emit(
          event.eventType,
          event.payload,
          event.id,
        );
        tasks.push(...produced);
        await this.source.markPublished(event.id);
      }
      return tasks;
    }
    const events = await this.source.claimBatch(this.batchSize);
    for (const event of events) {
      const produced = await this.scheduler.emit(
        event.eventType,
        event.payload,
        event.id,
      );
      tasks.push(...produced);
      await this.source.markPublished(event.id);
    }
    return tasks;
  }
}
