/**
 * Notification：站内通知
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type QueryResultRow } from "pg";
import { type InAppNotification } from "@anari/domain";
import { PgStoreMeasurement } from "./measurement.js";
import { iso, notFound } from "../pg-store-support.js";

export class PgStoreNotifications extends PgStoreMeasurement {
  async createNotification(input: {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
    idempotencyKey?: string;
  }): Promise<InAppNotification> {
    return this.tx(async (client) => {
      if (input.idempotencyKey) {
        const existing = await client.query(
          `SELECT * FROM notifications
            WHERE tenant_id = $1 AND idempotency_key = $2
            LIMIT 1`,
          [this.tenantId, input.idempotencyKey],
        );
        if (existing.rows[0]) return this.mapNotification(existing.rows[0]);
      }
      const { rows } = await client.query(
        `INSERT INTO notifications
          (id, tenant_id, recipient_person_id, audience, title, body,
           source_type, source_id, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
         DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          this.tenantId,
          input.recipientPersonId ?? null,
          input.audience,
          input.title,
          input.body,
          input.sourceType ?? null,
          input.sourceId ?? null,
          input.idempotencyKey ?? null,
        ],
      );
      if (rows[0]) return this.mapNotification(rows[0]);
      // 并发窗口：唯一索引挡下重复插入——回查既有通知。
      const raced = await client.query(
        `SELECT * FROM notifications
          WHERE tenant_id = $1 AND idempotency_key = $2
          LIMIT 1`,
        [this.tenantId, input.idempotencyKey],
      );
      return this.mapNotification(raced.rows[0]);
    });
  }

  async listNotifications(filter?: {
    recipientPersonId?: string;
    audience?: string;
    status?: string;
  }): Promise<InAppNotification[]> {
    return this.tx(async (client) => {
      const conditions = ["tenant_id=$1"];
      const values: unknown[] = [this.tenantId];
      if (filter?.recipientPersonId) {
        values.push(filter.recipientPersonId);
        conditions.push(`recipient_person_id=$${values.length}`);
      }
      if (filter?.audience) {
        values.push(filter.audience);
        conditions.push(`audience=$${values.length}`);
      }
      if (filter?.status) {
        values.push(filter.status);
        conditions.push(`status=$${values.length}`);
      }
      const { rows } = await client.query(
        `SELECT * FROM notifications
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC`,
        values,
      );
      return rows.map((row) => this.mapNotification(row));
    });
  }

  async markNotificationRead(id: string): Promise<InAppNotification> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE notifications
            SET status='READ', read_at=COALESCE(read_at, now())
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [this.tenantId, id],
      );
      if (!rows[0]) notFound("Notification", id);
      return this.mapNotification(rows[0]);
    });
  }

  private mapNotification(row: QueryResultRow): InAppNotification {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      recipientPersonId: row.recipient_person_id ?? undefined,
      audience: row.audience,
      title: row.title,
      body: row.body,
      sourceType: row.source_type ?? undefined,
      sourceId: row.source_id ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      readAt: iso(row.read_at),
    };
  }
}
