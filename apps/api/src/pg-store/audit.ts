/**
 * Governance / Audit：审计事件与哈希链
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 审计链顺序与 `appendAudit` 行为保持原样；`appendAudit` 本身在基类。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { type AuditEvent } from "@anari/domain";
import { sha256 } from "@anari/policy-dsl";
import { PgStoreBase } from "./base.js";
import { iso } from "../pg-store-support.js";

export class PgStoreAudit extends PgStoreBase {
  async listAuditEvents(limit = 100): Promise<AuditEvent[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM audit_events
          WHERE tenant_id = $1
          ORDER BY sequence DESC
          LIMIT $2`,
        [this.tenantId, Math.max(1, Math.min(limit, 500))],
      );
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        sequence: Number(row.sequence),
        actorType: row.actor_type,
        actorId: row.actor_id ?? undefined,
        action: row.action,
        objectType: row.object_type,
        objectId: row.object_id ?? undefined,
        beforeHash: row.before_hash ?? undefined,
        afterHash: row.after_hash ?? undefined,
        reason: row.reason ?? undefined,
        correlationId: row.correlation_id,
        occurredAt: iso(row.occurred_at) ?? new Date().toISOString(),
        prevHash: row.prev_hash,
        eventHash: row.event_hash,
      }));
    });
  }

  async verifyAuditChain(): Promise<boolean> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT *,
                encode(digest(
                  prev_hash || '|' || tenant_id::text || '|' || action || '|' ||
                  COALESCE(object_type, '') || '|' || COALESCE(object_id::text, '') || '|' ||
                  COALESCE(before_hash, '') || '|' || COALESCE(after_hash, '') || '|' ||
                  COALESCE(correlation_id::text, '') || '|' || occurred_at::text,
                  'sha256'
                ), 'hex') AS recomputed
           FROM audit_events
          WHERE tenant_id = $1
          ORDER BY sequence`,
        [this.tenantId],
      );
      let prevHash = "GENESIS";
      let expectedSequence = 1;
      for (const row of rows) {
        if (Number(row.sequence) !== expectedSequence) return false;
        if (row.prev_hash !== prevHash) return false;
        if (row.event_hash !== row.recomputed) return false;
        prevHash = row.event_hash;
        expectedSequence += 1;
      }
      return true;
    });
  }

  async recordAuditEvent(input: {
    actorType: "USER" | "AGENT" | "SYSTEM" | "INTEGRATION";
    actorId?: string;
    action: string;
    objectType: string;
    objectId?: string;
    beforeHash?: string;
    afterHash?: string;
    reason?: string;
  }): Promise<void> {
    await this.tx(async (client) => this.appendAudit(client, input));
  }
}
