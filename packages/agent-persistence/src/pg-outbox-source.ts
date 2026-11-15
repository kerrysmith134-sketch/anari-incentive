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

  /** 旧式非原子拉取（兼容单租户语义）。 */
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

  /**
   * NPV2-002：平台事务本地提升——outbox_events 有 FORCE RLS 且策略含
   * platform_admin 旁路；全局队列（跨租户消费）用事务本地提升，短时显式。
   */
  private async platformTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.platform_admin', 'on', true)",
      );
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await this.rollbackQuiet(client);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * NPV2-023：原子领取——跨租户 FOR UPDATE SKIP LOCKED（平台事务本地
   * 提升），租约到期前其他 poller 不会重复消费；attempt_count 同步推进。
   */
  async claimBatchAtomic(input: {
    workerId: string;
    leaseMs: number;
    limit: number;
    /** 单租户 worker 传入本租户：claim 只取本租户事件（防跨租户消费）。 */
    tenantId?: string;
  }): Promise<OutboxEvent[]> {
    return this.platformTx(async (client) => {
      const { rows } = await client.query(
        `SELECT id, tenant_id, event_type, payload, occurred_at
           FROM outbox_events
          WHERE published_at IS NULL
            AND (claimed_until IS NULL OR claimed_until < now())
            AND ($2::uuid IS NULL OR tenant_id = $2::uuid)
          ORDER BY occurred_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [input.limit, input.tenantId ?? null],
      );
      const claimed: OutboxEvent[] = [];
      for (const row of rows) {
        await client.query(
          `UPDATE outbox_events
              SET claimed_by = $2, claimed_until = $3,
                  attempt_count = attempt_count + 1
            WHERE id = $1`,
          [
            row.id,
            input.workerId,
            new Date(Date.now() + input.leaseMs).toISOString(),
          ],
        );
        claimed.push({
          id: row.id,
          tenantId: row.tenant_id,
          eventType: row.event_type,
          payload: row.payload ?? {},
          occurredAt: new Date(row.occurred_at).toISOString(),
        });
      }
      return claimed;
    });
  }

  /** 崩溃恢复：过期租约复位，事件可被重新领取（不丢失）。 */
  async recoverExpiredClaims(): Promise<number> {
    return this.platformTx(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE outbox_events
          SET claimed_by = NULL, claimed_until = NULL
        WHERE published_at IS NULL
          AND claimed_until IS NOT NULL AND claimed_until < now()`,
      );
      return rowCount ?? 0;
    });
  }

  private async rollbackQuiet(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
  }
  /** NPV2-023：全局队列——按 id 发布（platformTx 提升跨租户可见）。 */
  async markPublished(id: string): Promise<void> {
    return this.platformTx(async (client) => {
      await client.query(
        "UPDATE outbox_events SET published_at = now() WHERE id=$1",
        [id],
      );
    });
  }
}
