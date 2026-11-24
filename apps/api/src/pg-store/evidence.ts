/**
 * Evidence：证据节点、事件摄取与证据链接
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type QueryResultRow } from "pg";
import {
  type EvidenceLink,
  type EvidenceNode,
  type IngestionBatch,
  type IngestionResult,
} from "@anari/domain";
import {
  type CreateEvidenceInput,
  type CreateEvidenceLinkInput,
} from "@anari/contracts";
import { sha256 } from "@anari/policy-dsl";
import { PgStoreWorkPackage } from "./work-package.js";
import { iso, asJson } from "../pg-store-support.js";

export class PgStoreEvidence extends PgStoreWorkPackage {
  async createEvidence(input: CreateEvidenceInput): Promise<EvidenceNode> {
    return this.tx(async (client) => {
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO evidence_nodes
          (id, tenant_id, evidence_type, subject_type, subject_id,
           source_system, source_uri, observed_at, quality_status,
           normalized_payload, payload_hash, supersedes_id, submitted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, now()),$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          id,
          this.tenantId,
          input.evidenceType,
          input.subjectType,
          input.subjectId,
          input.sourceSystem,
          input.sourceUri ?? null,
          input.observedAt ?? null,
          input.qualityStatus ?? "UNVERIFIED",
          JSON.stringify(input.normalizedPayload),
          sha256(input.normalizedPayload),
          input.supersedesId ?? null,
          input.submittedBy ?? null,
        ],
      );
      return this.mapEvidence(rows[0]);
    });
  }

  async ingestEvents(batch: IngestionBatch): Promise<IngestionResult> {
    return this.tx(async (client) => {
      let accepted = 0;
      let duplicates = 0;
      const evidenceIds: string[] = [];
      for (const event of batch.events) {
        const version = event.sourceEventVersion ?? "1";
        const rawId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO raw_events
            (id, tenant_id, source_system, source_record_id, source_event_version,
             event_type, occurred_at, payload, payload_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, source_system, source_record_id, source_event_version)
           DO NOTHING
           RETURNING id`,
          [
            rawId,
            this.tenantId,
            batch.sourceSystem,
            event.sourceRecordId,
            version,
            event.eventType,
            event.occurredAt ?? null,
            JSON.stringify(event.payload),
            sha256(event.payload),
          ],
        );
        if (inserted.rowCount === 0) {
          duplicates += 1;
          continue;
        }
        const evidenceId = randomUUID();
        await client.query(
          `INSERT INTO evidence_nodes
            (id, tenant_id, raw_event_id, evidence_type, subject_type, subject_id,
             source_system, source_uri, observed_at, quality_status,
             normalized_payload, payload_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, now()),$10,$11,$12)`,
          [
            evidenceId,
            this.tenantId,
            rawId,
            event.evidenceType,
            event.subjectType,
            event.subjectId,
            batch.sourceSystem,
            event.sourceUri ?? null,
            event.occurredAt ?? null,
            event.qualityStatus ?? "UNVERIFIED",
            JSON.stringify(event.payload),
            sha256(event.payload),
          ],
        );
        accepted += 1;
        evidenceIds.push(evidenceId);
      }
      return { accepted, duplicates, evidenceIds };
    });
  }

  async listEvidence(
    subjectType?: string,
    subjectId?: string,
  ): Promise<EvidenceNode[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM evidence_nodes
          WHERE tenant_id=$1
            AND ($2::text IS NULL OR subject_type=$2)
            AND ($3::uuid IS NULL OR subject_id=$3)
          ORDER BY observed_at DESC`,
        [this.tenantId, subjectType ?? null, subjectId ?? null],
      );
      return rows.map((row) => this.mapEvidence(row));
    });
  }

  async linkEvidence(
    fromEvidenceId: string,
    input: CreateEvidenceLinkInput,
  ): Promise<EvidenceLink> {
    return this.tx(async (client) => {
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO evidence_links
          (id, tenant_id, from_evidence_id, to_evidence_id, relation_type, rationale)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, from_evidence_id, to_evidence_id, relation_type)
         DO UPDATE SET rationale = COALESCE(EXCLUDED.rationale, evidence_links.rationale)
         RETURNING *`,
        [
          id,
          this.tenantId,
          fromEvidenceId,
          input.toEvidenceId,
          input.relationType,
          input.rationale ?? null,
        ],
      );
      return this.mapEvidenceLink(rows[0]);
    });
  }

  async listEvidenceLinks(evidenceId: string): Promise<EvidenceLink[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM evidence_links
          WHERE tenant_id=$1
            AND (from_evidence_id=$2 OR to_evidence_id=$2)
          ORDER BY created_at`,
        [this.tenantId, evidenceId],
      );
      return rows.map((row) => this.mapEvidenceLink(row));
    });
  }

  private mapEvidence(row: QueryResultRow): EvidenceNode {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      evidenceType: row.evidence_type,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      sourceSystem: row.source_system,
      sourceUri: row.source_uri ?? undefined,
      observedAt: iso(row.observed_at)!,
      qualityStatus: row.quality_status,
      normalizedPayload: asJson(row.normalized_payload, {}),
      payloadHash: row.payload_hash,
      supersedesId: row.supersedes_id ?? undefined,
      submittedBy: row.submitted_by ?? undefined,
      createdAt: iso(row.created_at)!,
    };
  }

  private mapEvidenceLink(row: QueryResultRow): EvidenceLink {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      fromEvidenceId: row.from_evidence_id,
      toEvidenceId: row.to_evidence_id,
      relationType: row.relation_type,
      rationale: row.rationale ?? undefined,
      createdAt: iso(row.created_at)!,
    };
  }
}
