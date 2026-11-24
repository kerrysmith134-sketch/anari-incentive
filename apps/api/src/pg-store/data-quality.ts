/**
 * Governance：数据质量问题与命令
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * `loadDataQualityIssue` / `mapDataQualityIssue` 仅本领域使用。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type PoolClient, type QueryResultRow } from "pg";
import {
  assertTransition,
  dataQualityIssueTransitions,
  type DataQualityIssue,
} from "@anari/domain";
import { sha256 } from "@anari/policy-dsl";
import { ConflictError } from "../store.js";
import { PgStoreNotifications } from "./notifications.js";
import { iso, notFound, asJson } from "../pg-store-support.js";

export class PgStoreDataQuality extends PgStoreNotifications {
  async createDataQualityIssue(input: {
    objectType: string;
    objectId: string;
    issueCode: string;
    severity: "INFO" | "WARNING" | "BLOCKING";
    details?: Record<string, unknown>;
    assignedTo?: string;
    dueAt?: string;
  }): Promise<DataQualityIssue> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO data_quality_issues
          (id, tenant_id, object_type, object_id, issue_code, severity,
           status, details, assigned_to, due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          randomUUID(),
          this.tenantId,
          input.objectType,
          input.objectId,
          input.issueCode,
          input.severity,
          input.assignedTo ? "ASSIGNED" : "OPEN",
          JSON.stringify(input.details ?? {}),
          input.assignedTo ?? null,
          input.dueAt ?? null,
        ],
      );
      const issue = this.mapDataQualityIssue(rows[0]);
      await this.appendAudit(client, {
        action: "DATA_QUALITY_ISSUE_CREATED",
        objectType: "DATA_QUALITY_ISSUE",
        objectId: issue.id,
        actorType: "SYSTEM",
        afterHash: sha256({
          severity: issue.severity,
          issueCode: issue.issueCode,
          objectId: issue.objectId,
        }),
        reason: issue.issueCode,
      });
      return issue;
    });
  }

  async getDataQualityIssue(id: string): Promise<DataQualityIssue> {
    return this.tx((client) => this.loadDataQualityIssue(client, id));
  }

  async listDataQualityIssues(filter?: {
    status?: string;
  }): Promise<DataQualityIssue[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM data_quality_issues
          WHERE tenant_id=$1 AND ($2::text IS NULL OR status::text=$2)
          ORDER BY created_at DESC`,
        [this.tenantId, filter?.status ?? null],
      );
      return rows.map((row) => this.mapDataQualityIssue(row));
    });
  }

  async commandDataQualityIssue(
    id: string,
    input: {
      command:
        | "ASSIGN"
        | "START"
        | "RESOLVE"
        | "WAIVE"
        | "REOPEN"
        | "ESCALATE";
      assignedTo?: string;
      actorPersonId?: string;
      reason?: string;
    },
  ): Promise<DataQualityIssue> {
    return this.tx(async (client) => {
      const issue = await this.loadDataQualityIssue(client, id);
      const target = {
        ASSIGN: "ASSIGNED",
        START: "IN_PROGRESS",
        RESOLVE: "RESOLVED",
        WAIVE: "WAIVED_WITH_APPROVAL",
        REOPEN: "REOPENED",
      } as const;
      if (input.command !== "ESCALATE") {
        assertTransition(
          dataQualityIssueTransitions,
          "DataQualityIssue",
          issue.status,
          target[input.command],
        );
      }
      switch (input.command) {
        case "ASSIGN":
          if (!input.assignedTo) {
            throw new ConflictError("DQ_ASSIGNEE_REQUIRED");
          }
          await client.query(
            `UPDATE data_quality_issues
                SET status='ASSIGNED', assigned_to=$1, updated_at=now()
              WHERE tenant_id=$2 AND id=$3`,
            [input.assignedTo, this.tenantId, id],
          );
          break;
        case "START":
          await client.query(
            `UPDATE data_quality_issues
                SET status='IN_PROGRESS', updated_at=now()
              WHERE tenant_id=$1 AND id=$2`,
            [this.tenantId, id],
          );
          break;
        case "RESOLVE":
          await client.query(
            `UPDATE data_quality_issues
                SET status='RESOLVED', resolved_at=now(), updated_at=now()
              WHERE tenant_id=$1 AND id=$2`,
            [this.tenantId, id],
          );
          break;
        case "WAIVE":
          if (!input.actorPersonId || !input.reason) {
            throw new ConflictError("DQ_WAIVER_REQUIRES_APPROVER_AND_REASON");
          }
          await client.query(
            `UPDATE data_quality_issues
                SET status='WAIVED_WITH_APPROVAL', waived_by=$1,
                    waiver_reason=$2, updated_at=now()
              WHERE tenant_id=$3 AND id=$4`,
            [input.actorPersonId, input.reason, this.tenantId, id],
          );
          break;
        case "REOPEN":
          await client.query(
            `UPDATE data_quality_issues
                SET status='REOPENED', resolved_at=NULL, updated_at=now()
              WHERE tenant_id=$1 AND id=$2`,
            [this.tenantId, id],
          );
          break;
        case "ESCALATE":
          if (
            issue.status === "RESOLVED" ||
            issue.status === "WAIVED_WITH_APPROVAL"
          ) {
            throw new ConflictError("DQ_ISSUE_CLOSED");
          }
          await client.query(
            `UPDATE data_quality_issues
                SET escalated_at=now(), escalation_reason=$1,
                    updated_at=now()
              WHERE tenant_id=$2 AND id=$3`,
            [input.reason ?? "ESCALATED", this.tenantId, id],
          );
          break;
      }
      const updated = await this.loadDataQualityIssue(client, id);
      await this.appendAudit(client, {
        action: `DATA_QUALITY_${input.command}`,
        objectType: "DATA_QUALITY_ISSUE",
        objectId: id,
        actorType: input.actorPersonId ? "USER" : "SYSTEM",
        actorId: input.actorPersonId,
        afterHash: sha256({
          status: updated.status,
          assignedTo: updated.assignedTo,
          waiverReason: updated.waiverReason,
        }),
        reason: input.reason ?? input.command,
      });
      return updated;
    });
  }

  private async loadDataQualityIssue(
    client: PoolClient,
    id: string,
  ): Promise<DataQualityIssue> {
    const { rows } = await client.query(
      `SELECT * FROM data_quality_issues WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, id],
    );
    if (!rows[0]) notFound("DataQualityIssue", id);
    return this.mapDataQualityIssue(rows[0]);
  }

  private mapDataQualityIssue(row: QueryResultRow): DataQualityIssue {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      objectType: row.object_type,
      objectId: row.object_id,
      issueCode: row.issue_code,
      severity: row.severity,
      status: row.status,
      assignedTo: row.assigned_to ?? undefined,
      details: asJson<Record<string, unknown>>(row.details, {}),
      dueAt: iso(row.due_at),
      escalatedAt: iso(row.escalated_at),
      escalationReason: row.escalation_reason ?? undefined,
      waiverReason: row.waiver_reason ?? undefined,
      waivedBy: row.waived_by ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      resolvedAt: iso(row.resolved_at),
    };
  }
}
