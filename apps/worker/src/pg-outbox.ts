import type { Pool, PoolClient } from "pg";
import type { OutboxEvent, OutboxSource } from "@anari/agent-runtime";

export class PgOutboxSource implements OutboxSource {
  constructor(
    private readonly pool: Pool,
    private readonly tenantId: string,
  ) {}

  private async withTenant<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        this.tenantId,
      ]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimBatch(limit: number): Promise<OutboxEvent[]> {
    return this.withTenant(async (client) => {
      const { rows } = await client.query(
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
    });
  }

  async markPublished(id: string): Promise<void> {
    await this.withTenant((client) =>
      client.query(
        "UPDATE outbox_events SET published_at = now() WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, id],
      ),
    );
  }
}
