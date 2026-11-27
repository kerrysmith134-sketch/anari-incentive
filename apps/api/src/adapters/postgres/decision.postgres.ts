/**
 * 通用 JEV Decision Record PostgreSQL Adapter（118）。
 *
 * 与内存 Adapter 同语义；所有查询带 tenant_id，事务内设置 app.tenant_id
 * 以满足 RLS。证据/判断/校验/决定在数据库层另有 append-only 触发器兜底。
 */
import type { PoolClient, QueryResultRow } from "pg";
import {
  DECISION_LINK_KIND_BY_RESOURCE_TYPE,
  canonicalDecisionJson,
  decisionCaseStatusAfterCollection,
  decisionCaseStatusAfterVerification,
  decisionEvidenceAggregateHash,
  decisionEvidenceHashMatches,
  decisionEvidenceRequirementFinding,
  decisionJudgmentsAggregateHash,
  decisionVerificationIsCurrent,
  humanDecisionJudgments,
  isDecisionCaseMutable,
  normalizeDecisionHash,
  runDecisionVerification,
  selectFinalHumanJudgment,
  type AppendDecisionEvidenceInput,
  type CreateDecisionCaseInput,
  type DecideDecisionCaseInput,
  type DecisionCase,
  type DecisionCaseDetail,
  type DecisionCaseLink,
  type DecisionEvidence,
  type DecisionJudgment,
  type DecisionJsonObject,
  type DecisionRecord,
  type DecisionVerification,
  type LinkDecisionCaseInput,
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

/** 决策域冲突统一把 "CODE: detail" 前缀暴露为 HTTP error.code。 */
function decisionConflict(message: string): ConflictError {
  const code = message.split(":", 1)[0]?.trim() || "DECISION_CONFLICT";
  const error = new ConflictError(message);
  Object.defineProperty(error, "code", { value: code, configurable: true });
  return error;
}

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

    private mapDecisionEvidence(
      row: QueryResultRow,
      includeContent = false,
    ): DecisionEvidence {
      const evidence: DecisionEvidence = {
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
      // content 只在服务端校验路径读取；详情接口不返回原始内容。
      // 存储为 canonical JSON 文本，JSON.parse 后重算即可得到同一 hash
      // （包括 content 本身为 null 的合法证据）。
      if (includeContent && row.content !== null && row.content !== undefined) {
        try {
          evidence.content = JSON.parse(String(row.content));
        } catch {
          evidence.content = undefined;
        }
      }
      return evidence;
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
        verifiedCaseVersion:
          row.verified_case_version === null ||
          row.verified_case_version === undefined
            ? 0
            : Number(row.verified_case_version),
        evidenceHash: row.evidence_hash ?? "",
        judgmentsHash: row.judgments_hash ?? "",
        verifiedAt: timestampOf(row.verified_at),
      };
    }

    private mapDecisionLink(row: QueryResultRow): DecisionCaseLink {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        caseId: row.case_id,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        note: row.note ?? undefined,
        linkedBy: row.linked_by,
        linkedAt: timestampOf(row.linked_at),
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
        throw decisionConflict(
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

    private async loadEvidence(
      client: PoolClient,
      tenantId: string,
      caseId: string,
      includeContent = false,
    ): Promise<DecisionEvidence[]> {
      const { rows } = await client.query(
        `SELECT * FROM decision_evidence
          WHERE tenant_id=$1 AND case_id=$2
          ORDER BY created_at ASC, id ASC`,
        [tenantId, caseId],
      );
      return rows.map((row: QueryResultRow) =>
        this.mapDecisionEvidence(row, includeContent),
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
        throw decisionConflict(
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
                supports, weight, created_at, content)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
              // 服务端复核副本：canonical JSON 文本，校验时重算 content_hash。
              canonicalDecisionJson(input.content),
            ],
          );
          inserted = rows[0] as QueryResultRow;
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw decisionConflict(
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
        throw decisionConflict(
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
            throw decisionConflict(
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

        const evidence = await this.loadEvidence(
          client,
          input.tenantId,
          input.caseId,
          true,
        );
        const judgments = await this.loadJudgments(
          client,
          input.tenantId,
          input.caseId,
        );
        // 权威结果只来自服务端 5 个 checker；passed 不接受客户端声明。
        const result = runDecisionVerification({
          case: decisionCase,
          evidence,
          judgments,
          decidedBy: input.decidedBy,
        });

        const { rows } = await client.query(
          `INSERT INTO decision_verifications
             (tenant_id, case_id, checks, findings, passed, verified_by,
              verified_at, verified_case_version, evidence_hash, judgments_hash)
           VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            input.tenantId,
            input.caseId,
            JSON.stringify(result.checks),
            JSON.stringify(result.findings),
            result.passed,
            input.verifiedBy,
            new Date().toISOString(),
            decisionCase.version + 1,
            result.binding.evidenceHash,
            result.binding.judgmentsHash,
          ],
        );
        await client.query(
          `UPDATE decision_cases
              SET status=$3, version=version+1
            WHERE tenant_id=$1 AND id=$2`,
          [
            input.tenantId,
            input.caseId,
            decisionCaseStatusAfterVerification(
              result.passed,
              humanDecisionJudgments(judgments).length > 0,
            ),
          ],
        );
        return this.mapDecisionVerification(rows[0] as QueryResultRow);
      });
    }

    async linkDecisionCase(
      input: LinkDecisionCaseInput,
    ): Promise<DecisionCaseLink> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: caseRows } = await client.query(
          `SELECT * FROM decision_cases WHERE tenant_id=$1 AND id=$2`,
          [input.tenantId, input.caseId],
        );
        const caseRow = caseRows[0] as QueryResultRow | undefined;
        if (!caseRow) notFound("DecisionCase", input.caseId);
        const decisionCase = this.mapDecisionCase(caseRow);
        const expectedKind =
          DECISION_LINK_KIND_BY_RESOURCE_TYPE[input.resourceType];
        if (expectedKind !== decisionCase.kind) {
          throw decisionConflict(
            `DECISION_LINK_KIND_MISMATCH: ${input.resourceType} requires a ${expectedKind} case, got ${decisionCase.kind}`,
          );
        }
        try {
          const { rows } = await client.query(
            `INSERT INTO decision_case_links
               (tenant_id, case_id, resource_type, resource_id, note,
                linked_by, linked_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [
              input.tenantId,
              input.caseId,
              input.resourceType,
              input.resourceId,
              input.note ?? null,
              input.linkedBy,
              new Date().toISOString(),
            ],
          );
          return this.mapDecisionLink(rows[0] as QueryResultRow);
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw decisionConflict(
              "DECISION_LINK_ALREADY_RECORDED: this business object already references the case",
            );
          }
          throw error;
        }
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
          throw decisionConflict(
            "DECISION_RECORD_IMMUTABLE: this case already has a final decision",
          );
        }
        this.requireMutableCase(decisionCase, input.caseId);

        const evidence = await this.loadEvidence(
          client,
          input.tenantId,
          input.caseId,
        );
        const evidenceRequirement = decisionEvidenceRequirementFinding(
          decisionCase.kind,
          evidence,
        );
        if (evidenceRequirement) {
          throw decisionConflict(
            `EVIDENCE_REQUIRED: ${decisionCase.kind} decision requires at least one FOR or AGAINST evidence`,
          );
        }
        const judgments = await this.loadJudgments(
          client,
          input.tenantId,
          input.caseId,
        );
        const currentFacts = {
          caseVersion: decisionCase.version,
          evidenceHash: decisionEvidenceAggregateHash(evidence),
          judgmentsHash: decisionJudgmentsAggregateHash(judgments),
        };

        const { rows: verificationRows } = await client.query(
          `SELECT * FROM decision_verifications
            WHERE tenant_id=$1 AND case_id=$2
            ORDER BY seq ASC`,
          [input.tenantId, input.caseId],
        );
        const latest = verificationRows.at(-1) as QueryResultRow | undefined;
        if (!latest) {
          throw decisionConflict(
            "DECISION_VERIFICATION_REQUIRED: record a verification before deciding",
          );
        }
        if (!latest.passed) {
          throw decisionConflict(
            "DECISION_VERIFICATION_NOT_PASSED: the latest verification did not pass",
          );
        }
        const latestVerification = this.mapDecisionVerification(latest);
        if (!decisionVerificationIsCurrent(latestVerification, currentFacts)) {
          throw decisionConflict(
            "DECISION_STALE_VERIFICATION: evidence or judgments changed after the latest passing verification",
          );
        }

        const human = humanDecisionJudgments(judgments);
        if (human.length === 0) {
          throw decisionConflict(
            "HUMAN_JUDGMENT_REQUIRED: a human independent judgment is required",
          );
        }
        if (human.some((judgment) => judgment.actorId === input.decidedBy)) {
          throw decisionConflict(
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
          throw decisionConflict(
            "AI_MODEL_CANNOT_DECIDE: an AI judgment actor cannot authorize the final decision",
          );
        }

        const finalJudgment = selectFinalHumanJudgment(
          judgments,
          input.finalJudgmentId,
        );
        if (!finalJudgment) {
          throw decisionConflict(
            "FINAL_JUDGMENT_MUST_BE_HUMAN: the final judgment must be a human judgment on this case",
          );
        }

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
              currentFacts.evidenceHash,
              version,
              new Date().toISOString(),
            ],
          );
          inserted = rows[0] as QueryResultRow;
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw decisionConflict(
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
        const { rows: linkRows } = await client.query(
          `SELECT * FROM decision_case_links
            WHERE tenant_id=$1 AND case_id=$2
            ORDER BY linked_at ASC, id ASC`,
          [tenantId, caseId],
        );
        const decisionCase = this.mapDecisionCase(caseRow);
        const evidence = evidenceRows.map((row: QueryResultRow) =>
          this.mapDecisionEvidence(row),
        );
        const currentFacts = {
          // 决定动作只把案件推进到 DECIDED（版本 +1），事实未变。
          caseVersion:
            decisionCase.status === "DECIDED"
              ? decisionCase.version - 1
              : decisionCase.version,
          evidenceHash: decisionEvidenceAggregateHash(evidence),
          judgmentsHash: decisionJudgmentsAggregateHash(judgments),
        };
        return {
          case: decisionCase,
          evidence,
          judgments: {
            human: humanDecisionJudgments(judgments),
            ai: judgments.filter(
              (judgment) => judgment.actorType === "AI_MODEL",
            ),
          },
          verifications: verificationRows.map((row: QueryResultRow) => {
            const verification = this.mapDecisionVerification(row);
            return {
              ...verification,
              stale: !decisionVerificationIsCurrent(verification, currentFacts),
            };
          }),
          links: linkRows.map((row: QueryResultRow) =>
            this.mapDecisionLink(row),
          ),
          record: recordRows[0]
            ? this.mapDecisionRecord(recordRows[0] as QueryResultRow)
            : undefined,
        };
      });
    }
  };
}
