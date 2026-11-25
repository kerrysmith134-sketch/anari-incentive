/**
 * Ticketing 工作项 PostgreSQL Adapter（114）。
 *
 * 语义与内存 Adapter 一致：来源感知 upsert、(tenant, item, from, to, at, actor)
 * 幂等事件、贡献按 (item, person, role) 幂等。所有查询带 tenant_id，事务内
 * 设置 app.tenant_id 以同时满足 RLS。
 */
import type { QueryResultRow } from "pg";
import {
  assertValidWorkItemImport,
  hasStatusTransition,
  normalizeIsoTimestamp,
  planStatusTransition,
  workItemEventKey,
  type WorkItem,
  type WorkItemContribution,
  type WorkItemEvent,
  type WorkItemEventInput,
  type WorkItemFilter,
  type WorkItemImportInput,
  type WorkItemImportResult,
} from "@anari/domain";
import { decimalText, iso, notFound } from "../shared.js";
import type { WorkItemPort } from "../../store-ports.js";
import type {
  PgPlatformStoreBase,
  PgPlatformStoreBaseShape,
} from "./base.postgres.js";

function timestampOf(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}

function decimalOrUndefined(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : decimalText(String(value));
}

export function PgWorkItemMixin(
  Base: abstract new (
    ...args: ConstructorParameters<typeof PgPlatformStoreBase>
  ) => PgPlatformStoreBaseShape,
) {
  return class extends Base implements WorkItemPort {
    private mapWorkItem(row: QueryResultRow): WorkItem {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        sourceSystem: row.source_system,
        externalId: row.external_id,
        projectId: row.project_id,
        title: row.title,
        type: row.type,
        priority: row.priority ?? undefined,
        status: row.status,
        assigneePersonId: row.assignee_person_id ?? undefined,
        reporterPersonId: row.reporter_person_id ?? undefined,
        startedAt: iso(row.started_at),
        dueAt: iso(row.due_at),
        completedAt: iso(row.completed_at),
        weight: decimalOrUndefined(row.weight),
        currency: row.currency ? String(row.currency).trim() : undefined,
        amount: decimalOrUndefined(row.amount),
        payload: (row.payload as Record<string, unknown> | null) ?? {},
        createdAt: timestampOf(row.created_at),
        updatedAt: timestampOf(row.updated_at),
      };
    }

    private mapWorkItemEvent(row: QueryResultRow): WorkItemEvent {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        workItemId: row.work_item_id,
        fromStatus: row.from_status ?? undefined,
        toStatus: row.to_status,
        occurredAt: timestampOf(row.occurred_at),
        actorPersonId: row.actor_person_id ?? undefined,
        createdAt: timestampOf(row.created_at),
      };
    }

    private mapContribution(row: QueryResultRow): WorkItemContribution {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        workItemId: row.work_item_id,
        personId: row.person_id,
        role: row.role,
        weight: decimalOrUndefined(row.weight),
        ratio: decimalOrUndefined(row.ratio),
        createdAt: timestampOf(row.created_at),
        updatedAt: timestampOf(row.updated_at),
      };
    }

    async importWorkItem(
      input: WorkItemImportInput,
    ): Promise<WorkItemImportResult> {
      assertValidWorkItemImport(input);
      const timestamp = new Date().toISOString();
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: existingRows } = await client.query(
          `SELECT * FROM work_items
            WHERE tenant_id=$1 AND source_system=$2 AND external_id=$3
            FOR UPDATE`,
          [input.tenantId, input.sourceSystem, input.externalId],
        );
        const storedRow = existingRows[0] as QueryResultRow | undefined;
        const created = !storedRow;
        const storedStatus = storedRow
          ? (storedRow.status as WorkItem["status"])
          : undefined;
        let row: QueryResultRow;
        if (storedRow) {
          const { rows } = await client.query(
            `UPDATE work_items SET
               project_id=$4, title=$5, type=$6, status=$7,
               priority=COALESCE($8::text, priority),
               assignee_person_id=COALESCE($9::uuid, assignee_person_id),
               reporter_person_id=COALESCE($10::uuid, reporter_person_id),
               started_at=COALESCE($11::timestamptz, started_at),
               due_at=COALESCE($12::timestamptz, due_at),
               completed_at=COALESCE($13::timestamptz, completed_at),
               weight=COALESCE($14::numeric, weight),
               currency=COALESCE($15::char(3), currency),
               amount=COALESCE($16::numeric, amount),
               payload=COALESCE($17::jsonb, payload),
               updated_at=now()
             WHERE tenant_id=$1 AND id=$2 AND source_system=$3
             RETURNING *`,
            [
              input.tenantId,
              storedRow.id,
              input.sourceSystem,
              input.projectId,
              input.title,
              input.type,
              input.status,
              input.priority ?? null,
              input.assigneePersonId ?? null,
              input.reporterPersonId ?? null,
              normalizeIsoTimestamp(input.startedAt) ?? null,
              normalizeIsoTimestamp(input.dueAt) ?? null,
              normalizeIsoTimestamp(input.completedAt) ?? null,
              input.weight ?? null,
              input.currency?.toUpperCase() ?? null,
              input.amount ?? null,
              input.payload === undefined
                ? null
                : JSON.stringify(input.payload),
            ],
          );
          row = rows[0];
        } else {
          const { rows } = await client.query(
            `INSERT INTO work_items
               (tenant_id, source_system, external_id, project_id, title, type,
                priority, status, assignee_person_id, reporter_person_id,
                started_at, due_at, completed_at, weight, currency, amount,
                payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                     $17)
             RETURNING *`,
            [
              input.tenantId,
              input.sourceSystem,
              input.externalId,
              input.projectId,
              input.title,
              input.type,
              input.priority ?? null,
              input.status,
              input.assigneePersonId ?? null,
              input.reporterPersonId ?? null,
              normalizeIsoTimestamp(input.startedAt) ?? null,
              normalizeIsoTimestamp(input.dueAt) ?? null,
              normalizeIsoTimestamp(input.completedAt) ?? null,
              input.weight ?? null,
              input.currency?.toUpperCase() ?? null,
              input.amount ?? null,
              JSON.stringify(input.payload ?? {}),
            ],
          );
          row = rows[0];
        }
        const workItem = this.mapWorkItem(row);

        const { rows: eventRows } = await client.query(
          `SELECT * FROM work_item_events
            WHERE tenant_id=$1 AND work_item_id=$2`,
          [input.tenantId, workItem.id],
        );
        const eventKeys = new Set(
          eventRows.map((event: QueryResultRow) =>
            workItemEventKey({
              fromStatus: event.from_status ?? undefined,
              toStatus: event.to_status,
              occurredAt: timestampOf(event.occurred_at),
              actorPersonId: event.actor_person_id ?? undefined,
            }),
          ),
        );
        const appended: WorkItemEvent[] = [];
        const append = async (event: WorkItemEventInput): Promise<void> => {
          const normalized: WorkItemEventInput = {
            ...event,
            occurredAt: normalizeIsoTimestamp(event.occurredAt),
          };
          const key = workItemEventKey(normalized);
          if (eventKeys.has(key)) return;
          const occurredAt = normalized.occurredAt ?? timestamp;
          const { rows: inserted } = await client.query(
            `INSERT INTO work_item_events
               (tenant_id, work_item_id, from_status, to_status, occurred_at,
                actor_person_id)
             VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING *`,
            [
              input.tenantId,
              workItem.id,
              normalized.fromStatus ?? null,
              normalized.toStatus,
              occurredAt,
              normalized.actorPersonId ?? null,
            ],
          );
          eventKeys.add(key);
          appended.push(this.mapWorkItemEvent(inserted[0]));
        };

        for (const event of input.events ?? []) {
          await append(event);
        }
        if (!created) {
          const transition = hasStatusTransition(
            input.events,
            storedStatus,
            input.status,
          )
            ? null
            : planStatusTransition(storedStatus, input.status, timestamp);
          if (transition) await append(transition);
        }

        const contributions: WorkItemContribution[] = [];
        for (const contribution of input.contributions ?? []) {
          const { rows: upserted } = await client.query(
            `INSERT INTO work_item_contributions
               (tenant_id, work_item_id, person_id, role, weight, ratio)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (tenant_id, work_item_id, person_id, role)
             DO UPDATE SET
               weight=COALESCE(EXCLUDED.weight, work_item_contributions.weight),
               ratio=COALESCE(EXCLUDED.ratio, work_item_contributions.ratio),
               updated_at=now()
             RETURNING *`,
            [
              input.tenantId,
              workItem.id,
              contribution.personId,
              contribution.role,
              contribution.weight ?? null,
              contribution.ratio ?? null,
            ],
          );
          contributions.push(this.mapContribution(upserted[0]));
        }

        return {
          workItem,
          created,
          events: appended,
          contributions,
        };
      });
    }

    async listWorkItems(
      tenantId: string,
      filter?: WorkItemFilter,
    ): Promise<WorkItem[]> {
      const { rows } = await this.tenantQuery(
        tenantId,
        `SELECT DISTINCT w.*
           FROM work_items w
           LEFT JOIN work_item_contributions c
             ON c.tenant_id = w.tenant_id AND c.work_item_id = w.id
          WHERE w.tenant_id=$1
            AND ($2::text IS NULL OR w.project_id=$2)
            AND (
              $3::uuid IS NULL
              OR w.assignee_person_id=$3
              OR c.person_id=$3
            )
          ORDER BY w.updated_at DESC`,
        [tenantId, filter?.projectId ?? null, filter?.personId ?? null],
      );
      return rows.map((row: QueryResultRow) => this.mapWorkItem(row));
    }

    async getWorkItem(
      tenantId: string,
      workItemId: string,
    ): Promise<{
      workItem: WorkItem;
      events: WorkItemEvent[];
      contributions: WorkItemContribution[];
    }> {
      const { rows } = await this.tenantQuery(
        tenantId,
        "SELECT * FROM work_items WHERE tenant_id=$1 AND id=$2",
        [tenantId, workItemId],
      );
      if (!rows[0]) notFound("WorkItem", workItemId);
      const { rows: eventRows } = await this.tenantQuery(
        tenantId,
        `SELECT * FROM work_item_events
          WHERE tenant_id=$1 AND work_item_id=$2
          ORDER BY occurred_at ASC, created_at ASC`,
        [tenantId, workItemId],
      );
      const { rows: contributionRows } = await this.tenantQuery(
        tenantId,
        `SELECT * FROM work_item_contributions
          WHERE tenant_id=$1 AND work_item_id=$2
          ORDER BY role ASC, created_at ASC`,
        [tenantId, workItemId],
      );
      return {
        workItem: this.mapWorkItem(rows[0]),
        events: eventRows.map((row: QueryResultRow) =>
          this.mapWorkItemEvent(row),
        ),
        contributions: contributionRows.map((row: QueryResultRow) =>
          this.mapContribution(row),
        ),
      };
    }
  };
}
