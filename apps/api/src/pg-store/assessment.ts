/**
 * Contribution：贡献评估草稿
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 草稿校验会读取 claim（`getClaim`，来自 claims 层）。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { type QueryResultRow } from "pg";
import {
  type AttributionDecision,
  type EvidenceNode,
  type ContributionAssessmentDraft,
  type ContributionAssessmentDraftFilter,
  type CreateContributionAssessmentDraftInput,
  type ContributionEvent,
} from "@anari/domain";
import { ConflictError, NotFoundError } from "../store.js";
import { PgStoreContribution } from "./contribution.js";
import { notFound } from "../pg-store-support.js";

export class PgStoreAssessment extends PgStoreContribution {
  /** NPV2-016 校验：断言必须有证据引用；依据事件不得含 ACTIVITY 事件。 */
  private async assertAssessmentDraftUsable(
    input: CreateContributionAssessmentDraftInput,
    claim: { id: string; claimantPersonId: string },
  ): Promise<void> {
    const assertions = [
      ...input.supporting,
      ...input.counter,
      ...input.alternativeExplanations,
    ];
    if (assertions.some((a) => a.evidenceRefs.length === 0)) {
      throw new ConflictError(
        "ASSESSMENT_ASSERTION_REQUIRES_EVIDENCE: every assertion must cite evidence",
      );
    }
    await this.tx(async (client) => {
      // AUD-008：证据引用必须真实可解析且与 claim 主体相关（同租户由
      // tenant_id 过滤保证；跨主体在 SQL 侧判 subject_id）。
      const refs = [...new Set(assertions.flatMap((a) => a.evidenceRefs))];
      for (const ref of refs) {
        const { rows } = await client.query(
          "SELECT subject_id FROM evidence_nodes WHERE tenant_id = $1 AND id = $2",
          [this.tenantId, ref],
        );
        if (!rows[0]) {
          throw new NotFoundError(`EvidenceNode ${ref} not found`);
        }
        const subjectId = rows[0].subject_id as string;
        if (subjectId !== claim.id && subjectId !== claim.claimantPersonId) {
          throw new ConflictError(
            `ASSESSMENT_EVIDENCE_CROSS_SUBJECT: ${ref} does not belong to claim ${claim.id} or its subject`,
          );
        }
      }
      for (const eventId of input.basedOnEventIds) {
        const { rows } = await client.query(
          "SELECT kind FROM contribution_events WHERE tenant_id = $1 AND id = $2",
          [this.tenantId, eventId],
        );
        if (!rows[0]) {
          throw new NotFoundError(`ContributionEvent ${eventId} not found`);
        }
        if (rows[0].kind === "ACTIVITY") {
          throw new ConflictError(
            `ACTIVITY_EVENT_NOT_USABLE_AS_CONTRIBUTION: ${eventId} is an activity record and may not back a contribution assertion`,
          );
        }
      }
    });
  }

  async createContributionAssessmentDraft(
    input: CreateContributionAssessmentDraftInput,
  ): Promise<ContributionAssessmentDraft> {
    const claim = await this.getClaim(input.claimId);
    await this.assertAssessmentDraftUsable(input, claim);
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO contribution_assessment_drafts
          (tenant_id, claim_id, subject_person_id, generated_by_type,
           generated_by_id, model_provider, model_name, prompt_version,
           supporting, counter, missing_information, alternative_explanations,
           uncertainty, based_on_event_ids, activity_events_excluded)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
         RETURNING *`,
        [
          this.tenantId,
          input.claimId,
          claim.claimantPersonId,
          input.generatedByType,
          input.generatedById ?? null,
          input.modelProvider ?? null,
          input.modelName ?? null,
          input.promptVersion ?? null,
          JSON.stringify(input.supporting),
          JSON.stringify(input.counter),
          JSON.stringify(input.missingInformation),
          JSON.stringify(input.alternativeExplanations),
          JSON.stringify(input.uncertainty),
          JSON.stringify(input.basedOnEventIds),
        ],
      );
      return this.mapContributionAssessmentDraft(rows[0]);
    });
  }

  async listContributionAssessmentDrafts(
    filter?: ContributionAssessmentDraftFilter,
  ): Promise<ContributionAssessmentDraft[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.claimId) {
      params.push(filter.claimId);
      conditions.push(`claim_id = $${params.length}`);
    }
    if (filter?.subjectPersonId) {
      params.push(filter.subjectPersonId);
      conditions.push(`subject_person_id = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.tx(async (client) =>
      client.query(
        `SELECT * FROM contribution_assessment_drafts ${where}
          ORDER BY created_at DESC`,
        params,
      ),
    );
    return rows.map((row: QueryResultRow) =>
      this.mapContributionAssessmentDraft(row),
    );
  }

  async getContributionAssessmentDraft(
    id: string,
  ): Promise<ContributionAssessmentDraft> {
    const { rows } = await this.tx(async (client) =>
      client.query(
        "SELECT * FROM contribution_assessment_drafts WHERE tenant_id = $1 AND id = $2",
        [this.tenantId, id],
      ),
    );
    if (!rows[0]) notFound("ContributionAssessmentDraft", id);
    return this.mapContributionAssessmentDraft(rows[0]);
  }

  async submitContributionAssessmentDraft(
    id: string,
  ): Promise<ContributionAssessmentDraft> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE contribution_assessment_drafts
            SET status = 'SUBMITTED', updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT'
          RETURNING *`,
        [this.tenantId, id],
      );
      if (!rows[0]) {
        const current = await this.getContributionAssessmentDraft(id);
        throw new ConflictError(
          `ASSESSMENT_DRAFT_NOT_DRAFT: draft is ${current.status}`,
        );
      }
      return this.mapContributionAssessmentDraft(rows[0]);
    });
  }

  async discardContributionAssessmentDraft(
    id: string,
  ): Promise<ContributionAssessmentDraft> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE contribution_assessment_drafts
            SET status = 'DISCARDED', updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status IN ('DRAFT','SUBMITTED')
          RETURNING *`,
        [this.tenantId, id],
      );
      if (!rows[0]) {
        const current = await this.getContributionAssessmentDraft(id);
        throw new ConflictError(
          `ASSESSMENT_DRAFT_NOT_DISCARDABLE: draft is ${current.status}`,
        );
      }
      return this.mapContributionAssessmentDraft(rows[0]);
    });
  }

  /** 硬规则：SUBMITTED 后链接已存在的人工归属决定才转 DECIDED。 */
  async linkContributionAssessmentDecision(
    id: string,
    input: { attributionDecisionId: string; linkedBy: string },
  ): Promise<ContributionAssessmentDraft> {
    return this.tx(async (client) => {
      const { rows: draftRows } = await client.query(
        `SELECT * FROM contribution_assessment_drafts
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
        [this.tenantId, id],
      );
      if (!draftRows[0]) notFound("ContributionAssessmentDraft", id);
      const draft = this.mapContributionAssessmentDraft(draftRows[0]);
      if (draft.status !== "SUBMITTED") {
        throw new ConflictError(
          `ASSESSMENT_DRAFT_NOT_SUBMITTED: ${draft.status} drafts cannot be linked to a decision; submit first`,
        );
      }
      const { rows: decisionRows } = await client.query(
        "SELECT id, claim_id FROM attribution_decisions WHERE tenant_id = $1 AND id = $2",
        [this.tenantId, input.attributionDecisionId],
      );
      if (!decisionRows[0]) {
        throw new NotFoundError(
          `AttributionDecision ${input.attributionDecisionId} not found; a human attribution decision must exist first`,
        );
      }
      if (decisionRows[0].claim_id !== draft.claimId) {
        throw new ConflictError(
          "ASSESSMENT_DECISION_CLAIM_MISMATCH: decision belongs to a different claim",
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE contribution_assessment_drafts
            SET status = 'DECIDED', attribution_decision_id = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
        [this.tenantId, id, input.attributionDecisionId],
      );
      return this.mapContributionAssessmentDraft(updated[0]);
    });
  }

  private mapContributionAssessmentDraft(
    row: QueryResultRow,
  ): ContributionAssessmentDraft {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      claimId: row.claim_id,
      subjectPersonId: row.subject_person_id,
      generatedByType: row.generated_by_type,
      generatedById: row.generated_by_id ?? undefined,
      modelProvider: row.model_provider ?? undefined,
      modelName: row.model_name ?? undefined,
      promptVersion: row.prompt_version ?? undefined,
      supporting: row.supporting ?? [],
      counter: row.counter ?? [],
      missingInformation: row.missing_information ?? [],
      alternativeExplanations: row.alternative_explanations ?? [],
      uncertainty: row.uncertainty ?? { band: "HIGH", reasons: [] },
      basedOnEventIds: row.based_on_event_ids ?? [],
      activityEventsExcluded: row.activity_events_excluded ?? true,
      status: row.status,
      attributionDecisionId: row.attribution_decision_id ?? undefined,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
