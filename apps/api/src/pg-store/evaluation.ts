/**
 * Evaluation：评估周期、评分量表、草稿与决定
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * `loadRubric` / `loadEvaluationDraft` / 各 mapper 仅本领域使用。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type PoolClient, type QueryResultRow } from "pg";
import {
  assertTransition,
  evaluationCycleTransitions,
  evaluationDraftTransitions,
  type EvaluationCycle,
  type EvaluationDecision,
  type EvaluationDraft,
  type Rubric,
} from "@anari/domain";
import { sha256 } from "@anari/policy-dsl";
import { ConflictError } from "../store.js";
import { PgStoreAppeals } from "./appeals.js";
import { iso, notFound, asNumber, asJson } from "../pg-store-support.js";

export class PgStoreEvaluation extends PgStoreAppeals {
  async createEvaluationCycle(input: {
    name: string;
    cycleType: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    policyVersionId?: string;
    rubricVersionId?: string;
  }): Promise<EvaluationCycle> {
    return this.tx(async (client) => {
      if (
        new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()
      ) {
        throw new ConflictError("CYCLE_DATES_INVALID");
      }
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO evaluation_cycles
          (id, tenant_id, name, cycle_type, starts_at, ends_at, timezone,
           status, policy_version_id, rubric_version_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9)
         RETURNING *`,
        [
          id,
          this.tenantId,
          input.name,
          input.cycleType,
          input.startsAt,
          input.endsAt,
          input.timezone,
          input.policyVersionId ?? null,
          input.rubricVersionId ?? null,
        ],
      );
      return this.mapEvaluationCycle(rows[0]);
    });
  }

  async getEvaluationCycle(id: string): Promise<EvaluationCycle> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM evaluation_cycles WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id],
      );
      if (!rows[0]) notFound("EvaluationCycle", id);
      return this.mapEvaluationCycle(rows[0]);
    });
  }

  async listEvaluationCycles(): Promise<EvaluationCycle[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM evaluation_cycles
          WHERE tenant_id=$1
          ORDER BY starts_at DESC`,
        [this.tenantId],
      );
      return rows.map((row) => this.mapEvaluationCycle(row));
    });
  }

  private mapEvaluationCycle(row: QueryResultRow): EvaluationCycle {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      cycleType: row.cycle_type,
      startsAt: iso(row.starts_at) ?? new Date().toISOString(),
      endsAt: iso(row.ends_at) ?? new Date().toISOString(),
      timezone: row.timezone,
      status: row.status,
      policyVersionId: row.policy_version_id ?? undefined,
      rubricVersionId: row.rubric_version_id ?? undefined,
      version: asNumber(row.version),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  async createRubric(input: {
    code: string;
    name: string;
    dimensions: string[];
    scoringAnchors: Record<string, unknown>;
    scope?: Record<string, unknown>;
    effectiveFrom: string;
  }): Promise<Rubric> {
    return this.tx(async (client) => {
      const { rows: versionRows } = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version
           FROM rubrics WHERE tenant_id=$1 AND code=$2`,
        [this.tenantId, input.code],
      );
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO rubrics
          (id, tenant_id, code, name, dimensions, scoring_anchors, scope,
           status, version, effective_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$9)
         RETURNING *`,
        [
          id,
          this.tenantId,
          input.code,
          input.name,
          JSON.stringify(input.dimensions),
          JSON.stringify(input.scoringAnchors),
          JSON.stringify(input.scope ?? {}),
          asNumber(versionRows[0]?.version),
          input.effectiveFrom,
        ],
      );
      return this.mapRubric(rows[0]);
    });
  }

  async listRubrics(): Promise<Rubric[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM rubrics WHERE tenant_id=$1 ORDER BY created_at DESC`,
        [this.tenantId],
      );
      return rows.map((row) => this.mapRubric(row));
    });
  }

  async advanceEvaluationCycle(
    id: string,
    input: { status: string; reason?: string; actorPersonId?: string },
  ): Promise<EvaluationCycle> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM evaluation_cycles WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [this.tenantId, id],
      );
      if (!rows[0]) notFound("EvaluationCycle", id);
      assertTransition(
        evaluationCycleTransitions,
        "EvaluationCycle",
        rows[0].status,
        input.status as never,
      );
      const { rows: updated } = await client.query(
        `UPDATE evaluation_cycles
            SET status=$3,
                locked_at = CASE WHEN $3 = 'SETTLED' THEN now() ELSE locked_at END,
                updated_at = now(),
                version = version + 1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [this.tenantId, id, input.status],
      );
      await this.appendAudit(client, {
        action: "EVALUATION_CYCLE_ADVANCED",
        objectType: "EVALUATION_CYCLE",
        objectId: id,
        actorType: "USER",
        actorId: input.actorPersonId,
        reason: `${rows[0].status} -> ${input.status}${input.reason ? `: ${input.reason}` : ""}`,
      });
      return this.mapEvaluationCycle(updated[0]);
    });
  }

  async createEvaluationDraft(input: {
    cycleId: string;
    personId: string;
    generatedByType: "AGENT" | "USER" | "SYSTEM";
    generatedById?: string;
    modelProvider?: string;
    modelName?: string;
    promptVersion?: string;
    agentTaskId?: string;
    evidenceSnapshotHash: string;
    draftPayload: Record<string, unknown>;
    strengths?: string[];
    counterEvidence?: string[];
    missingInformation?: string[];
    uncertainty?: Record<string, unknown>;
  }): Promise<EvaluationDraft> {
    return this.tx(async (client) => {
      const id = randomUUID();
      try {
        const { rows } = await client.query(
          `INSERT INTO evaluation_drafts
            (id, tenant_id, cycle_id, person_id, generated_by_type,
             generated_by_id, model_provider, model_name, prompt_version,
             agent_task_id, evidence_snapshot_hash, draft_payload, strengths,
             counter_evidence, missing_information, uncertainty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           RETURNING *`,
          [
            id,
            this.tenantId,
            input.cycleId,
            input.personId,
            input.generatedByType,
            input.generatedById ?? null,
            input.modelProvider ?? null,
            input.modelName ?? null,
            input.promptVersion ?? null,
            input.agentTaskId ?? null,
            input.evidenceSnapshotHash,
            JSON.stringify(input.draftPayload),
            JSON.stringify(input.strengths ?? []),
            JSON.stringify(input.counterEvidence ?? []),
            JSON.stringify(input.missingInformation ?? []),
            JSON.stringify(input.uncertainty ?? {}),
          ],
        );
        return this.mapEvaluationDraft(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new ConflictError("EVALUATION_REFERENCE_NOT_FOUND");
        }
        throw error;
      }
    });
  }

  async getEvaluationDraft(id: string): Promise<EvaluationDraft> {
    return this.tx((client) => this.loadEvaluationDraft(client, id));
  }

  async listEvaluationDrafts(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<EvaluationDraft[]> {
    return this.tx(async (client) => {
      const conditions = ["tenant_id=$1"];
      const values: unknown[] = [this.tenantId];
      if (filter?.cycleId) {
        values.push(filter.cycleId);
        conditions.push(`cycle_id=$${values.length}`);
      }
      if (filter?.personId) {
        values.push(filter.personId);
        conditions.push(`person_id=$${values.length}`);
      }
      const { rows } = await client.query(
        `SELECT * FROM evaluation_drafts
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC`,
        values,
      );
      return rows.map((row) => this.mapEvaluationDraft(row));
    });
  }

  async submitEvaluationDraft(id: string): Promise<EvaluationDraft> {
    return this.tx(async (client) => {
      const draft = await this.loadEvaluationDraft(client, id);
      assertTransition(
        evaluationDraftTransitions,
        "EvaluationDraft",
        draft.status,
        "SUBMITTED",
      );
      await client.query(
        `UPDATE evaluation_drafts
            SET status='SUBMITTED', updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id],
      );
      return this.loadEvaluationDraft(client, id);
    });
  }

  async decideEvaluationDraft(
    id: string,
    input: {
      reviewerPersonId: string;
      rubricVersionId: string;
      decision: "APPROVE" | "REJECT";
      scores: Record<string, number>;
      rationale: string;
      independentScores: Record<string, number>;
      independentRationale: string;
      evidenceOpened?: number;
      reviewStartedAt?: string;
      dimensionStates?: Record<
        string,
        "ASSESSED" | "NOT_APPLICABLE" | "INSUFFICIENT_EVIDENCE"
      >;
    },
  ): Promise<{ draft: EvaluationDraft; decision?: EvaluationDecision }> {
    return this.tx(async (client) => {
      const draft = await this.loadEvaluationDraft(client, id);
      assertTransition(
        evaluationDraftTransitions,
        "EvaluationDraft",
        draft.status,
        input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      );
      if (input.reviewerPersonId === draft.personId) {
        throw new ConflictError("SELF_REVIEW_FORBIDDEN");
      }
      const rubric = await this.loadRubric(client, input.rubricVersionId);
      if (input.decision === "REJECT") {
        await client.query(
          `UPDATE evaluation_drafts
              SET status='REJECTED', updated_at=now()
            WHERE tenant_id=$1 AND id=$2`,
          [this.tenantId, id],
        );
        return { draft: await this.loadEvaluationDraft(client, id) };
      }
      // NP-006：允许"全部维度 NOT_APPLICABLE/INSUFFICIENT_EVIDENCE"的决定
      // （无数字分）；逐维度校验在下方循环里完成。

      // NP-006/D-03：维度状态完整语义——NOT_APPLICABLE / INSUFFICIENT_EVIDENCE
      // 可不填数字分（填了必须为 0）；ASSESSED/未声明状态必须有分，0 分须
      // ASSESSED + 独立理由。
      const states = input.dimensionStates ?? {};
      const effectiveScores: Record<string, number> = { ...input.scores };
      for (const dimension of rubric.dimensions) {
        const state = states[dimension];
        const hasScore = dimension in input.scores;
        if (state === "NOT_APPLICABLE" || state === "INSUFFICIENT_EVIDENCE") {
          if (hasScore && input.scores[dimension] !== 0) {
            throw new ConflictError(
              `DIMENSION_STATE_SCORE_CONFLICT: ${dimension} is ${state} but has a numeric score`,
            );
          }
          delete effectiveScores[dimension];
          continue;
        }
        if (!hasScore) {
          throw new ConflictError(`EVALUATION_DIMENSION_MISSING: ${dimension}`);
        }
        if (input.scores[dimension] === 0) {
          if (state !== "ASSESSED") {
            throw new ConflictError(
              `ZERO_SCORE_REQUIRES_ASSESSED_STATE: ${dimension} scored 0 without an ASSESSED dimension state`,
            );
          }
          if ((input.independentRationale ?? "").trim().length < 3) {
            throw new ConflictError(
              `ZERO_SCORE_REQUIRES_ASSESSED_STATE: ${dimension} scored 0 without an evidence-backed rationale`,
            );
          }
        }
      }
      const { rows: priorRows } = await client.query(
        `SELECT * FROM evaluation_decisions
          WHERE tenant_id=$1 AND cycle_id=$2 AND person_id=$3
          ORDER BY decision_version DESC
          FOR UPDATE`,
        [this.tenantId, draft.cycleId, draft.personId],
      );
      const latest = priorRows[0];
      await client.query(
        `UPDATE evaluation_decisions
            SET status='SUPERSEDED'
          WHERE tenant_id=$1 AND cycle_id=$2 AND person_id=$3
            AND status='APPROVED'`,
        [this.tenantId, draft.cycleId, draft.personId],
      );
      const decisionId = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO evaluation_decisions
          (id, tenant_id, cycle_id, person_id, decision_version, status,
           rubric_version_id, evidence_snapshot_hash, scores, rationale,
           reviewer_person_id, approved_at, supersedes_id,
           independent_scores, independent_rationale, evidence_opened,
           dimension_states)
         VALUES ($1,$2,$3,$4,$5,'APPROVED',$6,$7,$8,$9,$10,now(),$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          decisionId,
          this.tenantId,
          draft.cycleId,
          draft.personId,
          latest ? asNumber(latest.decision_version) + 1 : 1,
          input.rubricVersionId,
          draft.evidenceSnapshotHash,
          JSON.stringify(effectiveScores),
          input.rationale,
          input.reviewerPersonId,
          latest?.id ?? null,
          JSON.stringify(input.independentScores ?? {}),
          input.independentRationale ?? "",
          input.evidenceOpened ?? null,
          JSON.stringify(input.dimensionStates ?? {}),
        ],
      );
      await client.query(
        `UPDATE evaluation_drafts
            SET status='APPROVED', updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id],
      );
      await this.appendAudit(client, {
        action: "EVALUATION_DECISION_RECORDED",
        objectType: "EVALUATION_DECISION",
        objectId: decisionId,
        actorType: "USER",
        actorId: input.reviewerPersonId,
        afterHash: sha256({
          cycleId: draft.cycleId,
          personId: draft.personId,
          scores: input.scores,
          version: rows[0]?.decision_version,
        }),
        reason: `cycle ${draft.cycleId}`,
      });
      return {
        draft: await this.loadEvaluationDraft(client, id),
        decision: this.mapEvaluationDecision(rows[0]),
      };
    });
  }

  async listEvaluationDecisions(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<EvaluationDecision[]> {
    return this.tx(async (client) => {
      const conditions = ["tenant_id=$1"];
      const values: unknown[] = [this.tenantId];
      if (filter?.cycleId) {
        values.push(filter.cycleId);
        conditions.push(`cycle_id=$${values.length}`);
      }
      if (filter?.personId) {
        values.push(filter.personId);
        conditions.push(`person_id=$${values.length}`);
      }
      const { rows } = await client.query(
        `SELECT * FROM evaluation_decisions
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC`,
        values,
      );
      return rows.map((row) => this.mapEvaluationDecision(row));
    });
  }

  async getEvaluationDecision(id: string): Promise<EvaluationDecision> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM evaluation_decisions WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id],
      );
      if (!rows[0]) notFound("EvaluationDecision", id);
      return this.mapEvaluationDecision(rows[0]);
    });
  }

  private async loadRubric(client: PoolClient, id: string): Promise<Rubric> {
    const { rows } = await client.query(
      `SELECT * FROM rubrics WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, id],
    );
    if (!rows[0]) notFound("Rubric", id);
    return this.mapRubric(rows[0]);
  }

  private async loadEvaluationDraft(
    client: PoolClient,
    id: string,
  ): Promise<EvaluationDraft> {
    const { rows } = await client.query(
      `SELECT * FROM evaluation_drafts WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, id],
    );
    if (!rows[0]) notFound("EvaluationDraft", id);
    return this.mapEvaluationDraft(rows[0]);
  }

  private mapRubric(row: QueryResultRow): Rubric {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      dimensions: asJson<string[]>(row.dimensions, []),
      scoringAnchors: asJson<Record<string, unknown>>(row.scoring_anchors, {}),
      scope: asJson<Record<string, unknown>>(row.scope, {}),
      status: row.status,
      version: asNumber(row.version),
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to ? String(row.effective_to) : undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapEvaluationDraft(row: QueryResultRow): EvaluationDraft {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      personId: row.person_id,
      generatedByType: row.generated_by_type,
      generatedById: row.generated_by_id ?? undefined,
      modelProvider: row.model_provider ?? undefined,
      modelName: row.model_name ?? undefined,
      promptVersion: row.prompt_version ?? undefined,
      agentTaskId: row.agent_task_id ?? undefined,
      evidenceSnapshotHash: row.evidence_snapshot_hash,
      draftPayload: asJson<Record<string, unknown>>(row.draft_payload, {}),
      strengths: asJson<string[]>(row.strengths, []),
      counterEvidence: asJson<string[]>(row.counter_evidence, []),
      missingInformation: asJson<string[]>(row.missing_information, []),
      uncertainty: asJson<Record<string, unknown>>(row.uncertainty, {}),
      status: row.status,
      version: asNumber(row.version),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapEvaluationDecision(row: QueryResultRow): EvaluationDecision {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      personId: row.person_id,
      decisionVersion: asNumber(row.decision_version),
      status: row.status,
      rubricVersionId: row.rubric_version_id,
      evidenceSnapshotHash: row.evidence_snapshot_hash,
      scores: asJson<Record<string, number>>(row.scores, {}),
      rationale: row.rationale,
      reviewerPersonId: row.reviewer_person_id,
      independentScores: asJson<Record<string, number>>(
        row.independent_scores,
        {},
      ),
      independentRationale: row.independent_rationale ?? "",
      dimensionStates:
        Object.keys(asJson<Record<string, unknown>>(row.dimension_states, {}))
          .length > 0
          ? asJson<EvaluationDecision["dimensionStates"]>(
              row.dimension_states,
              {},
            )
          : undefined,
      evidenceOpened:
        row.evidence_opened === null || row.evidence_opened === undefined
          ? undefined
          : asNumber(row.evidence_opened),
      approvedAt: iso(row.approved_at),
      supersedesId: row.supersedes_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
}
