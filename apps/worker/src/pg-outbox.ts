import type { Pool } from "pg";
import type { OutboxEvent, OutboxSource } from "@anari/agent-runtime";

export class PgOutboxSource implements OutboxSource {
  constructor(
    private readonly pool: Pool,
    private readonly tenantId: string,
  ) {}

  async claimBatch(limit: number): Promise<OutboxEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, event_type, payload, occurred_at
         FROM outbox_events
        WHERE tenant_id = $1 AND published_at IS NULL
        ORDER BY occurred_at, id
        LIMIT $2`,
      [this.tenantId, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      eventType: row.event_type,
      payload: row.payload ?? {},
      occurredAt: new Date(row.occurred_at).toISOString(),
    }));
  }

  async markPublished(id: string): Promise<void> {
    await this.pool.query(
      "UPDATE outbox_events SET published_at = now() WHERE tenant_id=$1 AND id=$2",
      [this.tenantId, id],
    );
  }
}
