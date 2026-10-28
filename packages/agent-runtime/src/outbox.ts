import type { AgentTask } from "./types.js";
import type { AgentScheduler } from "./scheduler.js";

export interface OutboxEvent {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface OutboxSource {
  claimBatch(limit: number): Promise<OutboxEvent[]>;
  markPublished(id: string): Promise<void>;
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

  async pollOnce(): Promise<AgentTask[]> {
    const events = await this.source.claimBatch(this.batchSize);
    const tasks: AgentTask[] = [];
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
