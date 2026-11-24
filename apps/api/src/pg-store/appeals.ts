/**
 * Settlement：申诉与重算请求
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type PoolClient, type QueryResultRow } from "pg";
import {
  appealCaseTransitions,
  assertTransition,
  type AppealCase,
  type CalculationRun,
  type RecalculationRequest,
} from "@anari/domain";
import { type ResolveAppealInput } from "../store-interface.js";
import { ConflictError, NotFoundError } from "../store.js";
import { PgStoreSettlement } from "./settlement.js";
import { iso, notFound } from "../pg-store-support.js";

export class PgStoreAppeals extends PgStoreSettlement {
  async createAppeal(input: {
    appellantPersonId: string;
    targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER" | "CALCULATION";
    targetId: string;
    reasonCode: string;
    statement: string;
    evidenceRefs?: string[];
    dueAt?: string;
  }): Promise<AppealCase> {
    return this.tx(async (client) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO appeal_cases
          (id, tenant_id, appellant_person_id, target_type, target_id,
           appeal_reason_code, statement, evidence_refs, status, due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'OPEN',$9)`,
        [
          id,
          this.tenantId,
          input.appellantPersonId,
          input.targetType,
          input.targetId,
          input.reasonCode,
          input.statement,
          JSON.stringify(input.evidenceRefs ?? []),
          input.dueAt ?? null,
        ],
      );
      return this.loadAppeal(client, id);
    });
  }

  async getAppeal(id: string): Promise<AppealCase> {
    return this.tx((client) => this.loadAppeal(client, id));
  }

  async listAppeals(): Promise<AppealCase[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT id FROM appeal_cases WHERE tenant_id=$1 ORDER BY created_at DESC",
        [this.tenantId],
      );
      const appeals = [];
      for (const row of rows) {
        appeals.push(await this.loadAppeal(client, row.id));
      }
      return appeals;
    });
  }

  async triageAppeal(
    id: string,
    reviewerPersonId: string,
  ): Promise<AppealCase> {
    return this.tx(async (client) => {
      const appeal = await this.loadAppeal(client, id);
      if (reviewerPersonId === appeal.appellantPersonId) {
        throw new ConflictError("the appellant cannot triage their own appeal");
      }
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        appeal.status,
        "TRIAGED",
      );
      await client.query(
        "UPDATE appeal_cases SET status='TRIAGED', reviewer_person_id=$3 WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, id, reviewerPersonId],
      );
      return this.loadAppeal(client, id);
    });
  }

  async reviewAppeal(id: string): Promise<AppealCase> {
    return this.tx(async (client) => {
      const appeal = await this.loadAppeal(client, id);
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        appeal.status,
        "UNDER_REVIEW",
      );
      await client.query(
        "UPDATE appeal_cases SET status='UNDER_REVIEW' WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, id],
      );
      return this.loadAppeal(client, id);
    });
  }

  async resolveAppeal(
    id: string,
    input: ResolveAppealInput,
  ): Promise<AppealCase> {
    return this.tx(async (client) => {
      const appeal = await this.loadAppeal(client, id);
      if (
        input.reviewerPersonId === appeal.appellantPersonId ||
        (appeal.reviewerPersonId &&
          input.reviewerPersonId !== appeal.reviewerPersonId)
      ) {
        throw new ConflictError(
          "the appellant or a different reviewer cannot resolve this appeal",
        );
      }
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        appeal.status,
        "DECIDED",
      );
      const nextStatus =
        input.resolution === "CHANGE" ? "RECALCULATION_REQUIRED" : "CLOSED";
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        "DECIDED",
        nextStatus,
      );
      await client.query(
        `UPDATE appeal_cases
            SET status=$3, resolution=$4, resolved_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [
          this.tenantId,
          id,
          nextStatus,
          `${input.resolution}: ${input.rationale}`,
        ],
      );
      return this.loadAppeal(client, id);
    });
  }

  private async loadAppeal(
    client: PoolClient,
    id: string,
  ): Promise<AppealCase> {
    const { rows } = await client.query(
      "SELECT * FROM appeal_cases WHERE tenant_id=$1 AND id=$2",
      [this.tenantId, id],
    );
    const row = rows[0];
    if (!row) notFound("AppealCase", id);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      appellantPersonId: row.appellant_person_id,
      targetType: row.target_type,
      targetId: row.target_id,
      reasonCode: row.appeal_reason_code,
      statement: row.statement,
      evidenceRefs: (row.evidence_refs ?? []) as string[],
      status: row.status,
      reviewerPersonId: row.reviewer_person_id ?? undefined,
      resolution: row.resolution ?? undefined,
      dueAt: iso(row.due_at),
      createdAt: iso(row.created_at)!,
      resolvedAt: iso(row.resolved_at),
    };
  }

  async createRecalculationRequest(input: {
    targetType: "EVIDENCE" | "ATTRIBUTION" | "EVALUATION" | "LEDGER";
    targetId: string;
    reasonCode: string;
    explanation: string;
    requestedBy: string;
  }): Promise<RecalculationRequest> {
    return this.tx(async (client) => {
      try {
        const { rows } = await client.query(
          `INSERT INTO recalculation_requests
            (id, tenant_id, target_type, target_id, reason_code,
             explanation, requested_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            randomUUID(),
            this.tenantId,
            input.targetType,
            input.targetId,
            input.reasonCode,
            input.explanation,
            input.requestedBy,
          ],
        );
        return this.mapRecalculationRequest(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.requestedBy} not found`);
        }
        throw error;
      }
    });
  }

  async getRecalculationRequest(id: string): Promise<RecalculationRequest> {
    return this.tx(async (client) =>
      this.loadRecalculationRequest(client, id),
    );
  }

  async listRecalculationRequests(filter?: {
    status?: "OPEN" | "APPROVED" | "REJECTED" | "COMPLETED";
    targetType?: "EVIDENCE" | "ATTRIBUTION" | "EVALUATION" | "LEDGER";
  }): Promise<RecalculationRequest[]> {
    return this.tx(async (client) => {
      const params: string[] = [this.tenantId];
      let sql =
        "SELECT * FROM recalculation_requests WHERE tenant_id=$1";
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status=$${params.length}`;
      }
      if (filter?.targetType) {
        params.push(filter.targetType);
        sql += ` AND target_type=$${params.length}`;
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await client.query(sql, params);
      return rows.map((row) => this.mapRecalculationRequest(row));
    });
  }

  async approveRecalculationRequest(
    id: string,
    approvedBy: string,
  ): Promise<RecalculationRequest> {
    return this.tx(async (client) => {
      const request = await this.loadRecalculationRequest(client, id);
      if (request.status !== "OPEN") {
        throw new ConflictError(
          `recalculation request ${id} is ${request.status}`,
        );
      }
      try {
        const { rows } = await client.query(
          `UPDATE recalculation_requests
              SET status='APPROVED', approved_by=$3, approved_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [this.tenantId, id, approvedBy],
        );
        return this.mapRecalculationRequest(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${approvedBy} not found`);
        }
        throw error;
      }
    });
  }

  async rejectRecalculationRequest(
    id: string,
    reviewedBy: string,
  ): Promise<RecalculationRequest> {
    return this.tx(async (client) => {
      const request = await this.loadRecalculationRequest(client, id);
      if (request.status !== "OPEN") {
        throw new ConflictError(
          `recalculation request ${id} is ${request.status}`,
        );
      }
      try {
        const { rows } = await client.query(
          `UPDATE recalculation_requests
              SET status='REJECTED', approved_by=$3, approved_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [this.tenantId, id, reviewedBy],
        );
        return this.mapRecalculationRequest(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${reviewedBy} not found`);
        }
        throw error;
      }
    });
  }

  async completeRecalculationRequest(
    id: string,
    newCalculationRunId: string,
  ): Promise<RecalculationRequest> {
    return this.tx(async (client) => {
      const request = await this.loadRecalculationRequest(client, id);
      if (request.status !== "APPROVED") {
        throw new ConflictError(
          `recalculation request ${id} is ${request.status}`,
        );
      }
      try {
        const { rows } = await client.query(
          `UPDATE recalculation_requests
              SET status='COMPLETED', new_calculation_run_id=$3
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [this.tenantId, id, newCalculationRunId],
        );
        return this.mapRecalculationRequest(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `CalculationRun ${newCalculationRunId} not found`,
          );
        }
        throw error;
      }
    });
  }

  private async loadRecalculationRequest(
    client: PoolClient,
    id: string,
  ): Promise<RecalculationRequest> {
    const { rows } = await client.query(
      "SELECT * FROM recalculation_requests WHERE tenant_id=$1 AND id=$2",
      [this.tenantId, id],
    );
    if (!rows[0]) notFound("RecalculationRequest", id);
    return this.mapRecalculationRequest(rows[0]);
  }

  private mapRecalculationRequest(row: QueryResultRow): RecalculationRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      targetType: row.target_type,
      targetId: row.target_id,
      reasonCode: row.reason_code,
      explanation: row.explanation,
      requestedBy: row.requested_by,
      status: row.status,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      newCalculationRunId: row.new_calculation_run_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
}
