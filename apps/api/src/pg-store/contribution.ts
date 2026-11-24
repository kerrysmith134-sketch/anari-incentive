/**
 * Contribution：贡献事件与贡献确认书
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * `loadContributionAttestation` 仅本领域使用，保持 private。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type PoolClient, type QueryResultRow } from "pg";
import {
  type ContributionAttestation,
  type ContributionEvent,
  type ContributionEventFilter,
  type ContributionEventIngestResult,
  type CreateContributionEventInput,
} from "@anari/domain";
import { type CreateContributionAttestationBody } from "@anari/contracts";
import { ConflictError, NotFoundError } from "../store.js";
import { PgStoreAttribution } from "./attribution.js";
import { iso, notFound } from "../pg-store-support.js";

export class PgStoreContribution extends PgStoreAttribution {
  /**
   * NPV2-015：贡献事件批量录入（幂等）。同事务内先查 (source, external_id)
   * 命中既有事件放入 duplicates，未命中逐条 INSERT；ACTIVITY 事件仅记录
   * 活动量事实，不作为贡献认定依据。
   */
  async ingestContributionEvents(
    inputs: CreateContributionEventInput[],
  ): Promise<ContributionEventIngestResult> {
    const inserted: ContributionEvent[] = [];
    const duplicates: ContributionEvent[] = [];
    // NPV2 AUD-020：并发幂等——ON CONFLICT 命中部分唯一索引时回查既有
    // 事件归入 duplicates，消除 SELECT-then-INSERT 竞态。
    await this.tx(async (client) => {
      for (const input of inputs) {
        if (input.externalId) {
          const { rows: insertedRows } = await client.query(
            `INSERT INTO contribution_events
              (tenant_id, actor_person_id, subject_person_id, action, target_type,
               target_id, occurred_at, source, external_id, kind, outcome,
               evidence_refs, correction_of)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (tenant_id, source, external_id) WHERE external_id IS NOT NULL
             DO NOTHING
             RETURNING *`,
            [
              this.tenantId,
              input.actorPersonId ?? null,
              input.subjectPersonId,
              input.action,
              input.targetType,
              input.targetId,
              input.occurredAt,
              input.source,
              input.externalId ?? null,
              input.kind,
              JSON.stringify(input.outcome),
              JSON.stringify(input.evidenceRefs),
              input.correctionOfEventId ?? null,
            ],
          );
          if (insertedRows[0]) {
            inserted.push(this.mapContributionEvent(insertedRows[0]));
            continue;
          }
          const { rows: existingRows } = await client.query(
            `SELECT * FROM contribution_events
              WHERE tenant_id = $1 AND source = $2 AND external_id = $3`,
            [this.tenantId, input.source, input.externalId],
          );
          if (existingRows[0]) {
            duplicates.push(this.mapContributionEvent(existingRows[0]));
          }
          continue;
        }
        const id = randomUUID();
        const { rows } = await client.query(
          `INSERT INTO contribution_events
            (tenant_id, actor_person_id, subject_person_id, action, target_type,
             target_id, occurred_at, source, external_id, kind, outcome,
             evidence_refs, correction_of)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            this.tenantId,
            input.actorPersonId ?? null,
            input.subjectPersonId,
            input.action,
            input.targetType,
            input.targetId,
            input.occurredAt,
            input.source,
            input.externalId ?? null,
            input.kind,
            JSON.stringify(input.outcome),
            JSON.stringify(input.evidenceRefs),
            input.correctionOfEventId ?? null,
          ],
        );
        inserted.push(this.mapContributionEvent(rows[0]));
      }
    });
    return { inserted, duplicates };
  }

  async listContributionEvents(
    filter?: ContributionEventFilter,
  ): Promise<ContributionEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.subjectPersonId) {
      params.push(filter.subjectPersonId);
      conditions.push(`subject_person_id = $${params.length}`);
    }
    if (filter?.kind) {
      params.push(filter.kind);
      conditions.push(`kind = $${params.length}`);
    }
    if (filter?.source) {
      params.push(filter.source);
      conditions.push(`source = $${params.length}`);
    }
    if (filter?.occurredFrom) {
      params.push(filter.occurredFrom);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (filter?.occurredTo) {
      params.push(filter.occurredTo);
      conditions.push(`occurred_at <= $${params.length}`);
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.tx(async (client) =>
      client.query(
        `SELECT * FROM contribution_events ${where}
          ORDER BY occurred_at DESC`,
        params,
      ),
    );
    return rows.map((row: QueryResultRow) => this.mapContributionEvent(row));
  }

  async getContributionEvent(id: string): Promise<ContributionEvent> {
    const { rows } = await this.tx(async (client) =>
      client.query(
        "SELECT * FROM contribution_events WHERE tenant_id = $1 AND id = $2",
        [this.tenantId, id],
      ),
    );
    if (!rows[0]) notFound("ContributionEvent", id);
    return this.mapContributionEvent(rows[0]);
  }

  private mapContributionEvent(row: QueryResultRow): ContributionEvent {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      actorPersonId: row.actor_person_id ?? undefined,
      subjectPersonId: row.subject_person_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      occurredAt: new Date(row.occurred_at).toISOString(),
      source: row.source,
      externalId: row.external_id ?? undefined,
      kind: row.kind,
      outcome: row.outcome ?? { summary: "" },
      evidenceRefs: row.evidence_refs ?? [],
      correctionOfEventId: row.correction_of ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async createContributionAttestation(
    input: CreateContributionAttestationBody,
  ): Promise<ContributionAttestation> {
    return this.tx(async (client) => {
      const workPackage = await this.loadWorkPackage(
        client,
        input.workPackageId,
      );
      const participants = new Set([
        workPackage.ownerPersonId,
        ...workPackage.members.map((member) => member.personId),
      ]);
      if (!participants.has(input.subjectPersonId)) {
        throw new ConflictError(
          "ATTESTATION_SUBJECT_NOT_PARTICIPANT: subject is not on the work package",
        );
      }
      if (input.subjectPersonId === input.attesterPersonId) {
        throw new ConflictError(
          "ATTESTATION_SELF: a person cannot attest their own contribution",
        );
      }
      const id = randomUUID();
      try {
        await client.query(
          `INSERT INTO contribution_attestations
            (id, tenant_id, work_package_id, subject_person_id,
             attester_person_id, attestation_type, statement, evidence_refs)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [
            id,
            this.tenantId,
            input.workPackageId,
            input.subjectPersonId,
            input.attesterPersonId,
            input.attestationType,
            input.statement,
            JSON.stringify(input.evidenceRefs ?? []),
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Work package or attestation person not found`,
          );
        }
        throw error;
      }
      return this.loadContributionAttestation(client, id);
    });
  }

  async listContributionAttestations(filter?: {
    workPackageId?: string;
    subjectPersonId?: string;
  }): Promise<ContributionAttestation[]> {
    return this.tx(async (client) => {
      const params: string[] = [this.tenantId];
      let sql =
        "SELECT id FROM contribution_attestations WHERE tenant_id=$1";
      if (filter?.workPackageId) {
        params.push(filter.workPackageId);
        sql += ` AND work_package_id=$${params.length}`;
      }
      if (filter?.subjectPersonId) {
        params.push(filter.subjectPersonId);
        sql += ` AND subject_person_id=$${params.length}`;
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await client.query(sql, params);
      const attestations: ContributionAttestation[] = [];
      for (const row of rows) {
        attestations.push(
          await this.loadContributionAttestation(client, row.id),
        );
      }
      return attestations;
    });
  }

  async withdrawContributionAttestation(
    id: string,
    requesterPersonId: string,
  ): Promise<ContributionAttestation> {
    return this.tx(async (client) => {
      const current = await this.loadContributionAttestation(client, id);
      if (current.attesterPersonId !== requesterPersonId) {
        throw new ConflictError(
          "ATTESTATION_WITHDRAWAL_FORBIDDEN: only the attester can withdraw",
        );
      }
      if (current.status === "WITHDRAWN") {
        throw new ConflictError(
          `contribution attestation ${id} is already withdrawn`,
        );
      }
      await client.query(
        `UPDATE contribution_attestations
            SET status='WITHDRAWN', withdrawn_at=now(), updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id],
      );
      return this.loadContributionAttestation(client, id);
    });
  }

  private async loadContributionAttestation(
    client: PoolClient,
    id: string,
  ): Promise<ContributionAttestation> {
    const { rows } = await client.query(
      `SELECT * FROM contribution_attestations
        WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, id],
    );
    const row = rows[0];
    if (!row) notFound("ContributionAttestation", id);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workPackageId: row.work_package_id,
      subjectPersonId: row.subject_person_id,
      attesterPersonId: row.attester_person_id,
      attestationType: row.attestation_type,
      statement: row.statement,
      evidenceRefs: (row.evidence_refs as string[] | null) ?? [],
      status: row.status,
      withdrawnAt: iso(row.withdrawn_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
}
