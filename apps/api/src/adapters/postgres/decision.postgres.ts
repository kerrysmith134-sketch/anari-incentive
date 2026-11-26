/**
 * 通用 JEV Decision Record PostgreSQL Adapter（118）。
 *
 * 与内存 Adapter 同语义；所有查询带 tenant_id，事务内设置 app.tenant_id
 * 以满足 RLS。证据/判断/校验/决定在数据库层另有 append-only 触发器兜底。
 */
import type { PoolClient, QueryResultRow } from "pg";
import {
  decisionCaseStatusAfterCollection,
  decisionCaseStatusAfterVerification,
  decisionEvidenceAggregateHash,
  decisionEvidenceHashMatches,
  humanDecisionJudgments,
  isDecisionCaseMutable,
  normalizeDecisionHash,
  selectFinalHumanJudgment,
  type AppendDecisionEvidenceInput,
  type CreateDecisionCaseInput,
  type DecideDecisionCaseInput,
  type DecisionCase,
  type DecisionCaseDetail,
  type DecisionEvidence,
  type DecisionJudgment,
  type DecisionJsonObject,
  type DecisionRecord,
  type DecisionVerification,
  type RecordDecisionVerificationInput,
  type SubmitDecisionJudgmentInput,
} from "@anari/domain";
import { ConflictError } from "../../store.js";
import type { DecisionPort } from "../../store-ports.js";
import { decimalText, notFound } from "../shared.js";
import type {
  PgPlatformStoreBase,
  PgPlatformStoreBaseShape,
} from "./base.postgres.js";

function timestampOf(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}

function jsonObject(value: unknown): DecisionJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as DecisionJsonObject)
    : {};
}

function jsonArray(value: unknown): DecisionJsonObject[] {
  return Array.isArray(value) ? (value as DecisionJsonObject[]) : [];
}

export function PgDecisionMixin(
  Base: abstract new (
    ...args: ConstructorParameters<typeof PgPlatformStoreBase>
  ) => PgPlatformStoreBaseShape,
) {
  return class extends Base implements DecisionPort {
    private mapDecisionCase(row: QueryResultRow): DecisionCase {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        kind: row.kind,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        context: jsonObject(row.context),
        status: row.status,
        version: Number(row.version),
        createdBy: row.created_by,
        createdAt: timestampOf(row.created_at),
      };
    }

    private mapDecisionEvidence(row: QueryResultRow): DecisionEvidence {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        caseId: row.case_id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        contentHash: row.content_hash,
        supports: row.supports,
        weight:
          row.weight === null || row.weight === undefined
            ? undefined
            : decimalText(String(row.weight)),
        createdAt: timestampOf(row.created_at),
      };
    }

    private mapDecisionJudgment(row: QueryResultRow): DecisionJudgment {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        caseId: row.case_id,
        actorType: row.actor_type,
        actorId: row.actor_id,
        modelRef: row.model_ref ?? undefined,
        independentScores: jsonObject(row.independent_scores),
        independentRationale: row.independent_rationale,
        dimensionStates: jsonObject(row.dimension_states),
        confidence:
          row.confidence === null || row.confidence === undefined
            ? undefined
            : Number(row.confidence),
        createdAt: timestampOf(row.created_at),
      };
    }

    private mapDecisionVerification(
      row: QueryResultRow,
    ): DecisionVerification {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        caseId: row.case_id,
        checks: jsonObject(row.checks),
        findings: jsonArray(row.findings),
        passed: Boolean(row.passed),
        verifiedBy: row.verified_by,
        verifiedAt: timestampOf(row.verified_at),
      };
    }

    private mapDecisionRecord(row: QueryResultRow): DecisionRecord {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        caseId: row.case_id,
        finalJudgmentId: row.final_judgment_id,
        decidedBy: row.decided_by,
        rationale: row.rationale,
        evidenceHash: row.evidence_hash,
        version: Number(row.version),
        decidedAt: timestampOf(row.decided_at),
      };
    }

    private requireMutableCase(
      decisionCase: DecisionCase,
      caseId: string,
    ): void {
      if (!isDecisionCaseMutable(decisionCase.status)) {
        throw new ConflictError(
          `DECISION_CASE_NOT_MUTABLE: case ${caseId} is ${decisionCase.status}`,
        );
      }
    }

    private async loadJudgments(
      client: PoolClient,
      tenantId: string,
      caseId: string,
    ): Promise<DecisionJudgment[]> {
      const { rows } = await client.query(
        `SELECT * FROM decision_judgments
          WHERE tenant_id=$1 AND case_id=$2
          ORDER BY seq ASC`,
        [tenantId, caseId],
      );
      return rows.map((row: QueryResultRow) =>
        this.mapDecisionJudgment(row),
      );
    }

    async createDecisionCase(
      input: CreateDecisionCaseInput,
    ): Promise<DecisionCase> {
      const { rows } = await this.tenantQuery(
        input.tenantId,
        `INSERT INTO decision_cases
           (tenant_id, kind, subject_type, subject_id, context, status,
            version, created_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,'DRAFT',1,$6)
         RETURNING *`,
        [
          input.tenantId,
          input.kind,
          input.subjectType,
          input.subjectId,
          JSON.stringify(input.context ?? {}),
          input.createdBy,
        ],
      );
      return this.mapDecisionCase(rows[0] as QueryResultRow);
    }

    async appendDecisionEvidence(
      input: AppendDecisionEvidenceInput,
    ): Promise<DecisionEvidence> {
      if (!decisionEvidenceHashMatches(input.content, input.contentHash)) {
        throw new ConflictError(
          `EVIDENCE_HASH_MISMATCH: content does not match ${input.contentHash}`,
        );
      }
      const contentHash = normalizeDecisionHash(input.contentHash);
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: caseRows } = await client.query(
          `SELECT * FROM decision_cases
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.caseId],
        );
        const caseRow = caseRows[0] as QueryResultRow | undefined;
        if (!caseRow) notFound("DecisionCase", input.caseId);
        const decisionCase = this.mapDecisionCase(caseRow);
        this.requireMutableCase(decisionCase, input.caseId);

        let inserted: QueryResultRow;
        try {
          const { rows } = await client.query(
            `INSERT INTO decision_evidence
               (tenant_id, case_id, source_type, source_id, content_hash,
                supports, weight, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [
              input.tenantId,
              input.caseId,
              input.sourceType,
              input.sourceId,
              contentHash,
              input.supports,
              input.weight ?? null,
              new Date().toISOString(),
            ],
          );
          inserted = rows[0] as QueryResultRow;
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw new ConflictError(
              "EVIDENCE_ALREADY_RECORDED: identical evidence is already on this case",
            );
          }
          throw error;
        }
        await client.query(
          `UPDATE decision_cases
              SET status=$3, version=version+1
            WHERE tenant_id=$1 AND id=$2`,
          [
            input.tenantId,
            input.caseId,
            decisionCaseStatusAfterCollection(decisionCase.status),
          ],
        );
        return this.mapDecisionEvidence(inserted);
      });
    }

    async submitDecisionJudgment(
      input: SubmitDecisionJudgmentInput,
    ): Promise<DecisionJudgment> {
      if (
        input.confidence !== undefined &&
        (input.confidence < 0 || input.confidence > 1)
      ) {
        throw new ConflictError(
          "CONFIDENCE_OUT_OF_RANGE: confidence must be between 0 and 1",
        );
      }
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: caseRows } = await client.query(
          `SELECT * FROM decision_cases
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.caseId],
        );
        const caseRow = caseRows[0] as QueryResultRow | undefined;
        if (!caseRow) notFound("DecisionCase", input.caseId);
        const decisionCase = this.mapDecisionCase(caseRow);
        this.requireMutableCase(decisionCase, input.caseId);

        const modelRef =
          input.actorType === "AI_MODEL"
            ? (input.modelRef ?? input.actorId)
            : (input.modelRef ?? null);
        let inserted: QueryResultRow;
        try {
          const { rows } = await client.query(
            `INSERT INTO decision_judgments
               (tenant_id, case_id, actor_type, actor_id, model_ref,
                independent_scores, independent_rationale, dimension_states,
                confidence, created_at)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10)
             RETURNING *`,
            [
              input.tenantId,
              input.caseId,
              input.actorType,
              input.actorId,
              modelRef,
              JSON.stringify(input.independentScores ?? {}),
              input.independentRationale,
              JSON.stringify(input.dimensionStates ?? {}),
              input.confidence ?? null,
              new Date().toISOString(),
            ],
          );
          inserted = rows[0] as QueryResultRow;
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw new ConflictError(
              `JUDGMENT_IMMUTABLE: ${input.actorType} ${input.actorId} already judged this case`,
            );
          }
          throw error;
        }
        await client.query(
          `UPDATE decision_cases
              SET status=$3, version=version+1
            WHERE tenant_id=$1 AND id=$2`,
          [
            input.tenantId,
            input.caseId,
            decisionCaseStatusAfterCollection(decisionCase.status),
          ],
        );
        return this.mapDecisionJudgment(inserted);
      });
    }

    async recordDecisionVerification(
      input: RecordDecisionVerificationInput,
    ): Promise<DecisionVerification> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: caseRows } = await client.query(
          `SELECT * FROM decision_cases
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.caseId],
        );
        const caseRow = caseRows[0] as QueryResultRow | undefined;
        if (!caseRow) notFound("DecisionCase", input.caseId);
        const decisionCase = this.mapDecisionCase(caseRow);
        this.requireMutableCase(decisionCase, input.caseId);

        const { rows } = await client.query(
          `INSERT INTO decision_verifications
             (tenant_id, case_id, checks, findings, passed, verified_by,
              verified_at)
           VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)
           RETURNING *`,
          [
            input.tenantId,
            input.caseId,
            JSON.stringify(input.checks ?? {}),
            JSON.stringify(input.findings ?? []),
            input.passed,
            input.verifiedBy,
            new Date().toISOString(),
          ],
        );
        const { rows: humanRows } = await client.query(
          `SELECT count(*)::int AS count FROM decision_judgments
            WHERE tenant_id=$1 AND case_id=$2 AND actor_type='HUMAN'`,
          [input.tenantId, input.caseId],
        );
        await client.query(
          `UPDATE decision_cases
              SET status=$3, version=version+1
            WHERE tenant_id=$1 AND id=$2`,
          [
            input.tenantId,
            input.caseId,
            decisionCaseStatusAfterVerification(
              input.passed,
              Number((humanRows[0] as QueryResultRow).count) > 0,
            ),
          ],
        );
        return this.mapDecisionVerification(rows[0] as QueryResultRow);
      });
    }

    async decideDecisionCase(
      input: DecideDecisionCaseInput,
    ): Promise<DecisionRecord> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: caseRows } = await client.query(
          `SELECT * FROM decision_cases
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.caseId],
        );
        const caseRow = caseRows[0] as QueryResultRow | undefined;
        if (!caseRow) notFound("DecisionCase", input.caseId);
        const decisionCase = this.mapDecisionCase(caseRow);

        const { rows: recordRows } = await client.query(
          `SELECT * FROM decision_records
            WHERE tenant_id=$1 AND case_id=$2`,
          [input.tenantId, input.caseId],
        );
        if (recordRows[0]) {
          throw new ConflictError(
            "DECISION_RECORD_IMMUTABLE: this case already has a final decision",
          );
        }
        this.requireMutableCase(decisionCase, input.caseId);

        const judgments = await this.loadJudgments(
          client,
          input.tenantId,
          input.caseId,
        );
        const human = humanDecisionJudgments(judgments);
        if (human.length === 0) {
          throw new ConflictError(
            "HUMAN_JUDGMENT_REQUIRED: a human independent judgment is required",
          );
        }
        if (human.some((judgment) => judgment.actorId === input.decidedBy)) {
          throw new ConflictError(
            "SELF_DECISION_FORBIDDEN: the decider submitted a human judgment on this case",
          );
        }
        if (
          judgments.some(
            (judgment) =>
              judgment.actorType === "AI_MODEL" &&
              judgment.actorId === input.decidedBy,
          )
        ) {
          throw new ConflictError(
            "AI_MODEL_CANNOT_DECIDE: an AI judgment actor cannot authorize the final decision",
          );
        }

        const { rows: verificationRows } = await client.query(
          `SELECT * FROM decision_verifications
            WHERE tenant_id=$1 AND case_id=$2
            ORDER BY seq ASC`,
          [input.tenantId, input.caseId],
        );
        const latest = verificationRows.at(-1) as QueryResultRow | undefined;
        if (!latest) {
          throw new ConflictError(
            "DECISION_VERIFICATION_REQUIRED: record a verification before deciding",
          );
        }
        if (!latest.passed) {
          throw new ConflictError(
            "DECISION_VERIFICATION_NOT_PASSED: the latest verification did not pass",
          );
        }

        const finalJudgment = selectFinalHumanJudgment(
          judgments,
          input.finalJudgmentId,
        );
        if (!finalJudgment) {
          throw new ConflictError(
            "FINAL_JUDGMENT_MUST_BE_HUMAN: the final judgment must be a human judgment on this case",
          );
        }

        const { rows: evidenceRows } = await client.query(
          `SELECT * FROM decision_evidence
            WHERE tenant_id=$1 AND case_id=$2
            ORDER BY created_at ASC, id ASC`,
          [input.tenantId, input.caseId],
        );
        const evidence = evidenceRows.map((row: QueryResultRow) =>
          this.mapDecisionEvidence(row),
        );
        const version = decisionCase.version + 1;
        let inserted: QueryResultRow;
        try {
          const { rows } = await client.query(
            `INSERT INTO decision_records
               (tenant_id, case_id, final_judgment_id, decided_by, rationale,
                evidence_hash, version, decided_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [
              input.tenantId,
              input.caseId,
              finalJudgment.id,
              input.decidedBy,
              input.rationale,
              decisionEvidenceAggregateHash(evidence),
              version,
              new Date().toISOString(),
            ],
          );
          inserted = rows[0] as QueryResultRow;
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw new ConflictError(
              "DECISION_RECORD_IMMUTABLE: this case already has a final decision",
            );
          }
          throw error;
        }
        await client.query(
          `UPDATE decision_cases SET status='DECIDED', version=$3
            WHERE tenant_id=$1 AND id=$2`,
          [input.tenantId, input.caseId, version],
        );
        return this.mapDecisionRecord(inserted);
      });
    }

    async getDecisionCase(
      tenantId: string,
      caseId: string,
    ): Promise<DecisionCaseDetail> {
      return this.transactionFor(tenantId, async (client) => {
        const { rows: caseRows } = await client.query(
          `SELECT * FROM decision_cases WHERE tenant_id=$1 AND id=$2`,
          [tenantId, caseId],
        );
        const caseRow = caseRows[0] as QueryResultRow | undefined;
        if (!caseRow) notFound("DecisionCase", caseId);
        const { rows: evidenceRows } = await client.query(
          `SELECT * FROM decision_evidence
            WHERE tenant_id=$1 AND case_id=$2
            ORDER BY created_at ASC, id ASC`,
          [tenantId, caseId],
        );
        const judgments = await this.loadJudgments(
          client,
          tenantId,
          caseId,
        );
        const { rows: verificationRows } = await client.query(
          `SELECT * FROM decision_verifications
            WHERE tenant_id=$1 AND case_id=$2
            ORDER BY seq ASC`,
          [tenantId, caseId],
        );
        const { rows: recordRows } = await client.query(
          `SELECT * FROM decision_records
            WHERE tenant_id=$1 AND case_id=$2`,
          [tenantId, caseId],
        );
        return {
          case: this.mapDecisionCase(caseRow),
          evidence: evidenceRows.map((row: QueryResultRow) =>
            this.mapDecisionEvidence(row),
          ),
          judgments: {
            human: humanDecisionJudgments(judgments),
            ai: judgments.filter(
              (judgment) => judgment.actorType === "AI_MODEL",
            ),
          },
          verifications: verificationRows.map((row: QueryResultRow) =>
            this.mapDecisionVerification(row),
          ),
          record: recordRows[0]
            ? this.mapDecisionRecord(recordRows[0] as QueryResultRow)
            : undefined,
        };
      });
    }
  };
}
