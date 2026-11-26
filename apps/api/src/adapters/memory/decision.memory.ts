/**
 * 通用 JEV Decision Record 内存 Adapter（118）。
 *
 * 语义与 PostgreSQL Adapter 完全一致：
 * - 证据 append-only + hash 重算，重复内容不会再落一条；
 * - 判断 append-only，(case, actorType, actorId) 唯一，第二次提交 409；
 * - 校验 append-only，决定时只认最新一次校验；
 * - record 一案一条，重复决定 409；AI 不能成为决定人。
 */
import { randomUUID } from "node:crypto";
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
  type DecisionRecord,
  type DecisionVerification,
  type RecordDecisionVerificationInput,
  type SubmitDecisionJudgmentInput,
} from "@anari/domain";
import { ConflictError } from "../../store.js";
import type { DecisionPort } from "../../store-ports.js";
import { notFound, now } from "../shared.js";
import type {
  MemoryPlatformStoreBase,
  MemoryPlatformStoreBaseShape,
} from "./base.memory.js";

export function MemoryDecisionMixin(
  Base: abstract new (
    ...args: ConstructorParameters<typeof MemoryPlatformStoreBase>
  ) => MemoryPlatformStoreBaseShape,
) {
  return class extends Base implements DecisionPort {
    private readonly decisionCases = new Map<string, DecisionCase>();
    private readonly decisionEvidence = new Map<string, DecisionEvidence[]>();
    private readonly decisionJudgments = new Map<
      string,
      DecisionJudgment[]
    >();
    private readonly decisionVerifications = new Map<
      string,
      DecisionVerification[]
    >();
    private readonly decisionRecords = new Map<string, DecisionRecord>();

    private requireDecisionCase(
      tenantId: string,
      caseId: string,
    ): DecisionCase {
      const decisionCase = this.decisionCases.get(caseId);
      // 跨租户一律按不存在处理，避免探知其他租户的 case id。
      if (!decisionCase || decisionCase.tenantId !== tenantId) {
        notFound("DecisionCase", caseId);
      }
      return decisionCase;
    }

    private requireMutableDecisionCase(
      tenantId: string,
      caseId: string,
    ): DecisionCase {
      const decisionCase = this.requireDecisionCase(tenantId, caseId);
      if (!isDecisionCaseMutable(decisionCase.status)) {
        throw new ConflictError(
          `DECISION_CASE_NOT_MUTABLE: case ${caseId} is ${decisionCase.status}`,
        );
      }
      return decisionCase;
    }

    private evidenceOf(caseId: string): DecisionEvidence[] {
      return this.decisionEvidence.get(caseId) ?? [];
    }

    private judgmentsOf(caseId: string): DecisionJudgment[] {
      return this.decisionJudgments.get(caseId) ?? [];
    }

    private verificationsOf(caseId: string): DecisionVerification[] {
      return this.decisionVerifications.get(caseId) ?? [];
    }

    async createDecisionCase(
      input: CreateDecisionCaseInput,
    ): Promise<DecisionCase> {
      const decisionCase: DecisionCase = {
        id: randomUUID(),
        tenantId: input.tenantId,
        kind: input.kind,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        context: input.context ?? {},
        status: "DRAFT",
        version: 1,
        createdBy: input.createdBy,
        createdAt: now(),
      };
      this.decisionCases.set(decisionCase.id, decisionCase);
      return decisionCase;
    }

    async appendDecisionEvidence(
      input: AppendDecisionEvidenceInput,
    ): Promise<DecisionEvidence> {
      return this.withCommandLock(
        `decision:${input.tenantId}:${input.caseId}`,
        async () => {
          const decisionCase = this.requireMutableDecisionCase(
            input.tenantId,
            input.caseId,
          );
          if (
            !decisionEvidenceHashMatches(input.content, input.contentHash)
          ) {
            throw new ConflictError(
              `EVIDENCE_HASH_MISMATCH: content does not match ${input.contentHash}`,
            );
          }
          const contentHash = normalizeDecisionHash(input.contentHash);
          const evidence = this.evidenceOf(input.caseId);
          if (
            evidence.some(
              (entry) =>
                entry.sourceType === input.sourceType &&
                entry.sourceId === input.sourceId &&
                normalizeDecisionHash(entry.contentHash) === contentHash,
            )
          ) {
            throw new ConflictError(
              "EVIDENCE_ALREADY_RECORDED: identical evidence is already on this case",
            );
          }
          const recorded: DecisionEvidence = {
            id: randomUUID(),
            tenantId: input.tenantId,
            caseId: input.caseId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            contentHash,
            supports: input.supports,
            weight: input.weight,
            createdAt: now(),
          };
          evidence.push(recorded);
          this.decisionEvidence.set(input.caseId, evidence);
          decisionCase.status = decisionCaseStatusAfterCollection(
            decisionCase.status,
          );
          decisionCase.version += 1;
          return recorded;
        },
      );
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
      return this.withCommandLock(
        `decision:${input.tenantId}:${input.caseId}`,
        async () => {
          const decisionCase = this.requireMutableDecisionCase(
            input.tenantId,
            input.caseId,
          );
          const judgments = this.judgmentsOf(input.caseId);
          // 一人一判：同一 actor 的第二次提交不是“更新”，而是拒绝。
          if (
            judgments.some(
              (judgment) =>
                judgment.actorType === input.actorType &&
                judgment.actorId === input.actorId,
            )
          ) {
            throw new ConflictError(
              `JUDGMENT_IMMUTABLE: ${input.actorType} ${input.actorId} already judged this case`,
            );
          }
          const judgment: DecisionJudgment = {
            id: randomUUID(),
            tenantId: input.tenantId,
            caseId: input.caseId,
            actorType: input.actorType,
            actorId: input.actorId,
            modelRef:
              input.actorType === "AI_MODEL"
                ? (input.modelRef ?? input.actorId)
                : input.modelRef,
            independentScores: input.independentScores ?? {},
            independentRationale: input.independentRationale,
            dimensionStates: input.dimensionStates ?? {},
            confidence: input.confidence,
            createdAt: now(),
          };
          judgments.push(judgment);
          this.decisionJudgments.set(input.caseId, judgments);
          decisionCase.status = decisionCaseStatusAfterCollection(
            decisionCase.status,
          );
          decisionCase.version += 1;
          return judgment;
        },
      );
    }

    async recordDecisionVerification(
      input: RecordDecisionVerificationInput,
    ): Promise<DecisionVerification> {
      return this.withCommandLock(
        `decision:${input.tenantId}:${input.caseId}`,
        async () => {
          const decisionCase = this.requireMutableDecisionCase(
            input.tenantId,
            input.caseId,
          );
          const verification: DecisionVerification = {
            id: randomUUID(),
            tenantId: input.tenantId,
            caseId: input.caseId,
            checks: input.checks,
            findings: input.findings ?? [],
            passed: input.passed,
            verifiedBy: input.verifiedBy,
            verifiedAt: now(),
          };
          const verifications = this.verificationsOf(input.caseId);
          verifications.push(verification);
          this.decisionVerifications.set(input.caseId, verifications);
          decisionCase.status = decisionCaseStatusAfterVerification(
            input.passed,
            humanDecisionJudgments(
              this.judgmentsOf(input.caseId),
            ).length > 0,
          );
          decisionCase.version += 1;
          return verification;
        },
      );
    }

    async decideDecisionCase(
      input: DecideDecisionCaseInput,
    ): Promise<DecisionRecord> {
      return this.withCommandLock(
        `decision:${input.tenantId}:${input.caseId}`,
        async () => {
          const decisionCase = this.requireDecisionCase(
            input.tenantId,
            input.caseId,
          );
          if (this.decisionRecords.has(input.caseId)) {
            throw new ConflictError(
              "DECISION_RECORD_IMMUTABLE: this case already has a final decision",
            );
          }
          this.requireMutableDecisionCase(input.tenantId, input.caseId);

          const judgments = this.judgmentsOf(input.caseId);
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

          const verifications = this.verificationsOf(input.caseId);
          // 数组即写入顺序；同一毫秒内的两条校验不能靠随机 id 判“最新”。
          const latest = verifications.at(-1);
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

          const version = decisionCase.version + 1;
          const record: DecisionRecord = {
            id: randomUUID(),
            tenantId: input.tenantId,
            caseId: input.caseId,
            finalJudgmentId: finalJudgment.id,
            decidedBy: input.decidedBy,
            rationale: input.rationale,
            evidenceHash: decisionEvidenceAggregateHash(
              this.evidenceOf(input.caseId),
            ),
            version,
            decidedAt: now(),
          };
          this.decisionRecords.set(input.caseId, record);
          decisionCase.status = "DECIDED";
          decisionCase.version = version;
          return record;
        },
      );
    }

    async getDecisionCase(
      tenantId: string,
      caseId: string,
    ): Promise<DecisionCaseDetail> {
      const decisionCase = this.requireDecisionCase(tenantId, caseId);
      const judgments = this.judgmentsOf(caseId);
      return {
        case: decisionCase,
        evidence: [...this.evidenceOf(caseId)],
        judgments: {
          human: humanDecisionJudgments(judgments),
          ai: judgments.filter(
            (judgment) => judgment.actorType === "AI_MODEL",
          ),
        },
        verifications: [...this.verificationsOf(caseId)],
        record: this.decisionRecords.get(caseId),
      };
    }
  };
}
