/**
 * 评估周期域路由（NPV2-011）：
 * 周期管理、预审、草稿、决定。行为与拆分前等价。
 *
 * 2026-11-27 起评价也接入 JEV Decision Record（118）：
 * - 每条评价决定都必须有一个 kind=PERFORMANCE 的案件（subject=
 *   EVALUATION_DECISION/决定 id），案件证据来自「决定事实」与「独立判断」；
 * - 只有 JEV 案件已有最终决定记录（decision record）的评价决定才能进入
 *   最终批准，否则 409 DECISION_CASE_REQUIRED；
 * - 人工独立判断（reviewerPersonId）与新写入的 AI 建议分表存放，AI 永远
 *   不能成为最终依据。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type {
  DecisionPort,
  ModelgovPort,
} from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import { randomUUID } from "node:crypto";
import { ForbiddenError } from "@anari/auth";
import { sha256 } from "@anari/policy-dsl";
import type {
  DecisionCaseDetail,
  EvaluationDecision,
} from "@anari/domain";
import { preReviewSchema } from "@anari/contracts";
import { ConflictError } from "../../store.js";
import {
  data,
  idOf,
  ownPersonId,
  parse,
  requireActorRequired,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";

/** 评价决定进入 JEV 的唯一 subjectType（也是幂等键的一部分）。 */
const EVALUATION_DECISION_SUBJECT = "EVALUATION_DECISION";

/** 400：请求体缺失/不合法（本模块不引入新 Zod 契约，手工校验）。 */
class EvaluationDecisionInputError extends Error {
  readonly statusCode = 400;
  readonly code = "INVALID_INPUT";
}

/** 409 DECISION_CASE_REQUIRED：评价决定没有 JEV 案件/最终记录。 */
function decisionCaseRequired(message: string): ConflictError {
  const error = new ConflictError(message);
  Object.defineProperty(error, "code", {
    value: "DECISION_CASE_REQUIRED",
    configurable: true,
  });
  return error;
}

/** 409：案件 subject 不是评价决定（防止把别的案件挂到评价流程上）。 */
function decisionCaseSubjectMismatch(message: string): ConflictError {
  const error = new ConflictError(message);
  Object.defineProperty(error, "code", {
    value: "DECISION_CASE_SUBJECT_MISMATCH",
    configurable: true,
  });
  return error;
}

/** 评价决定事实：JEV 证据原文（服务端重算 hash，不落库原文）。 */
function evaluationDecisionFacts(decision: EvaluationDecision) {
  return {
    kind: "EVALUATION_DECISION/v1",
    decisionId: decision.id,
    cycleId: decision.cycleId,
    personId: decision.personId,
    decisionVersion: decision.decisionVersion,
    status: decision.status,
    rubricVersionId: decision.rubricVersionId,
    evidenceSnapshotHash: decision.evidenceSnapshotHash,
    scores: decision.scores,
    rationale: decision.rationale,
    reviewerPersonId: decision.reviewerPersonId,
    approvedAt: decision.approvedAt ?? null,
    supersedesId: decision.supersedesId ?? null,
  };
}

/** 先于 AI 建议记录的独立判断事实（ATT-06 已有字段的物化）。 */
function independentJudgmentFacts(decision: EvaluationDecision) {
  return {
    kind: "EVALUATION_INDEPENDENT_JUDGMENT/v1",
    decisionId: decision.id,
    decisionVersion: decision.decisionVersion,
    independentScores: decision.independentScores ?? {},
    independentRationale: decision.independentRationale ?? "",
    evidenceOpened: decision.evidenceOpened ?? 0,
    reviewStartedAt: decision.reviewStartedAt ?? null,
  };
}

function hasIndependentJudgment(decision: EvaluationDecision): boolean {
  return (
    (decision.independentRationale ?? "").trim().length > 0 ||
    Object.keys(decision.independentScores ?? {}).length > 0
  );
}

/** 评价决定 + JEV 状态（前端/审计只需一个对象）。 */
function evaluationDecisionWithJev(
  decision: EvaluationDecision,
  detail?: DecisionCaseDetail,
) {
  const record = detail?.record;
  return {
    ...decision,
    jev: {
      required: true,
      caseId: detail?.case.id ?? null,
      caseStatus: detail?.case.status ?? "MISSING",
      recordId: record?.id ?? null,
      decided: Boolean(record),
      decidedBy: record?.decidedBy ?? null,
      decidedAt: record?.decidedAt ?? null,
    },
  };
}

/**
 * 创建/关联评价决定的 JEV 案件（幂等）。
 *
 * - 同一 decisionId 只开一个案：先按 (subjectType, subjectId) 只读查询；
 * - 证据两条：EVALUATION_DECISION（决定事实，FOR）与 INDEPENDENT_JUDGMENT
 *   （先于 AI 建议的独立判断，FOR）——独立判断缺失时退回
 *   EVIDENCE_SNAPSHOT 证据，保证至少两个独立来源类型；
 * - 反证缺失在案件 context.evidenceGaps 显式声明（CoverageChecker 允许
 *   “显式缺失”，但绝不由服务端伪造反证）；
 * - 评价决定已记录的独立判断物化为 HUMAN judgment（actorId =
 *   reviewerPersonId），它来自真实提交，不是代填的新判断；同一 actor
 *   只写一次。
 */
async function ensureEvaluationDecisionCase(input: {
  platformStore: ModelgovPort & DecisionPort;
  tenantId: string;
  decision: EvaluationDecision;
  createdBy: string;
}): Promise<{ created: boolean; detail: DecisionCaseDetail }> {
  const { platformStore, tenantId, decision, createdBy } = input;
  let decisionCase = await platformStore.findDecisionCaseBySubject(
    tenantId,
    EVALUATION_DECISION_SUBJECT,
    decision.id,
  );
  let created = false;
  if (!decisionCase) {
    created = true;
    decisionCase = await platformStore.createDecisionCase({
      tenantId,
      kind: "PERFORMANCE",
      subjectType: EVALUATION_DECISION_SUBJECT,
      subjectId: decision.id,
      context: {
        flow: "EVALUATION_DECISION",
        cycleId: decision.cycleId,
        personId: decision.personId,
        decisionVersion: decision.decisionVersion,
        rubricVersionId: decision.rubricVersionId,
        evidenceSnapshotHash: decision.evidenceSnapshotHash,
        decisionStatus: decision.status,
        reviewerPersonId: decision.reviewerPersonId,
        // 反证缺失必须显式声明；没有来源就不伪造 AGAINST 证据。
        evidenceGaps: [
          {
            supports: "AGAINST",
            reason: "评价决定未记录反证来源，按显式缺失处理",
          },
        ],
      },
      createdBy,
    });
  }
  let detail = await platformStore.getDecisionCase(tenantId, decisionCase.id);

  const finalContent = evaluationDecisionFacts(decision);
  if (
    !detail.evidence.some(
      (entry) =>
        entry.sourceType === "EVALUATION_DECISION" &&
        entry.sourceId === decision.id,
    )
  ) {
    await platformStore.appendDecisionEvidence({
      tenantId,
      caseId: decisionCase.id,
      sourceType: "EVALUATION_DECISION",
      sourceId: decision.id,
      content: finalContent,
      contentHash: sha256(finalContent),
      supports: "FOR",
    });
    detail = await platformStore.getDecisionCase(tenantId, decisionCase.id);
  }

  if (hasIndependentJudgment(decision)) {
    const independentContent = independentJudgmentFacts(decision);
    if (
      !detail.evidence.some(
        (entry) =>
          entry.sourceType === "INDEPENDENT_JUDGMENT" &&
          entry.sourceId === decision.id,
      )
    ) {
      await platformStore.appendDecisionEvidence({
        tenantId,
        caseId: decisionCase.id,
        sourceType: "INDEPENDENT_JUDGMENT",
        sourceId: decision.id,
        content: independentContent,
        contentHash: sha256(independentContent),
        supports: "FOR",
      });
      detail = await platformStore.getDecisionCase(tenantId, decisionCase.id);
    }
  } else {
    const snapshotContent = {
      kind: "EVALUATION_EVIDENCE_SNAPSHOT/v1",
      decisionId: decision.id,
      evidenceSnapshotHash: decision.evidenceSnapshotHash,
    };
    if (
      !detail.evidence.some(
        (entry) =>
          entry.sourceType === "EVIDENCE_SNAPSHOT" &&
          entry.sourceId === String(decision.evidenceSnapshotHash),
      )
    ) {
      await platformStore.appendDecisionEvidence({
        tenantId,
        caseId: decisionCase.id,
        sourceType: "EVIDENCE_SNAPSHOT",
        sourceId: String(decision.evidenceSnapshotHash),
        content: snapshotContent,
        contentHash: sha256(snapshotContent),
        supports: "FOR",
      });
      detail = await platformStore.getDecisionCase(tenantId, decisionCase.id);
    }
  }

  // 独立判断物化：只在确有独立判断、且该 reviewer 还没有人工判断时写一次。
  if (
    hasIndependentJudgment(decision) &&
    detail.judgments.human.every(
      (judgment) => judgment.actorId !== decision.reviewerPersonId,
    )
  ) {
    await platformStore.submitDecisionJudgment({
      tenantId,
      caseId: decisionCase.id,
      actorType: "HUMAN",
      actorId: decision.reviewerPersonId,
      independentScores: decision.independentScores ?? {},
      independentRationale: decision.independentRationale ?? "",
      dimensionStates: {
        source: "EVALUATION_DECISION",
        decisionId: decision.id,
        decisionVersion: decision.decisionVersion,
        evidenceOpened: decision.evidenceOpened ?? 0,
        finalDecision: false,
      },
    });
    detail = await platformStore.getDecisionCase(tenantId, decisionCase.id);
  }
  return { created, detail };
}

export function registerEvaluationRoutes(deps: {
  /** 模型治理端口 + JEV 决策端口（同一平台门面实例）。 */
  platformStore: ModelgovPort & DecisionPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/evaluation-cycles/:id/pre-review", async (request) => {
      requireRoles(request, "manager", "admin");
      const body = parse(preReviewSchema, request.body);
      const store = storeFor(request);
      const cycle = await store.getEvaluationCycle(idOf(request));
      const windowStart = Date.parse(cycle.startsAt);
      const windowEnd = Date.parse(cycle.endsAt);

      // 参与人：周期窗口内提交过申报的人（或显式指定）。
      const claims = await store.listClaims();
      const claimByPerson = new Map<string, number>();
      for (const claim of claims) {
        const at = Date.parse(claim.createdAt);
        if (at < windowStart || at > windowEnd) continue;
        claimByPerson.set(
          claim.claimantPersonId,
          (claimByPerson.get(claim.claimantPersonId) ?? 0) + 1,
        );
      }
      const personIds =
        body.personIds && body.personIds.length > 0
          ? body.personIds
          : [...claimByPerson.keys()];
      if (personIds.length === 0) {
        return data(
          { created: [], skipped: [], note: "周期窗口内没有申报人，无可预审对象" },
          request,
        );
      }

      // 幂等：同一周期同一人只生成一次 AGENT 草稿。
      const existingDrafts = await store.listEvaluationDrafts({ cycleId: cycle.id });
      const alreadyDone = new Set(
        existingDrafts
          .filter((draft) => draft.generatedByType === "AGENT")
          .map((draft) => draft.personId),
      );

      const evidence = await store.listEvidence();
      const created: Array<Record<string, unknown>> = [];
      const skipped: Array<{ personId: string; reason: string }> = [];
      const timestamp = new Date().toISOString();
      for (const personId of personIds) {
        if (alreadyDone.has(personId)) {
          skipped.push({ personId, reason: "ALREADY_PRE_REVIEWED" });
          continue;
        }
        // 证据：主体为本人，或主体为其参与的工作包。
        const ownEvidence = evidence.filter(
          (node) =>
            (node.subjectType === "PERSON" && node.subjectId === personId) ||
            (node.subjectType === "WORK_PACKAGE" &&
              claimByPerson.has(personId) === true &&
              node.normalizedPayload?.workPackageId === personId),
        );
        const verifiedCount = ownEvidence.filter(
          (node) => node.qualityStatus === "VALID",
        ).length;
        const dimensions = ["QUALITY", "TIMELINESS", "COLLABORATION"];
        const strengths = verifiedCount >= 2
          ? ["已验收交付并附有效证据", "贡献链路完整可追溯"]
          : [];
        const missingInformation =
          verifiedCount === 0
            ? ["缺少已验证证据：所有维度需人工核定"]
            : dimensions.filter(
                (_, index) => index >= Math.min(verifiedCount, dimensions.length),
              ).map((dimension) => `${dimension} 维度证据不足`);
        const snapshot = {
          personId,
          cycleId: cycle.id,
          claims: claimByPerson.get(personId) ?? 0,
          evidenceCount: ownEvidence.length,
          verifiedCount,
          generatedAt: timestamp,
        };
        const snapshotHash = sha256(snapshot);
        const draft = await store.createEvaluationDraft({
          cycleId: cycle.id,
          personId,
          generatedByType: "AGENT",
          modelProvider: "builtin",
          modelName: "evidence-coverage-v1",
          promptVersion: "pre-review-v1",
          evidenceSnapshotHash: snapshotHash,
          draftPayload: snapshot,
          strengths,
          counterEvidence: [],
          missingInformation,
          uncertainty: {
            confidence: verifiedCount >= 2 ? 0.8 : 0.3,
            basis: "evidence-coverage",
          },
        });
        await platformStore.createAiSuggestion({
          tenantId: tenantOf(request),
          agentTaskId: randomUUID(),
          targetType: "EVALUATION_DRAFT",
          targetId: draft.id,
          suggestionType: "PRE_REVIEW_DRAFT",
          modelProvider: "builtin",
          modelName: "evidence-coverage-v1",
          promptVersion: "pre-review-v1",
          inputHash: snapshotHash,
          outputJson: {
            draftId: draft.id,
            personId,
            evidenceCount: ownEvidence.length,
            verifiedCount,
          },
          validationStatus: "VALIDATED",
        });
        countEvent("pre_review_draft_generated");
        created.push({
          draftId: draft.id,
          personId,
          evidenceCount: ownEvidence.length,
          verifiedCount,
          strengths,
          missingInformation,
        });
      }
      return data({ created, skipped }, request);
    });

    // ------------------------------------------------------------------
    // 评价决定 × JEV（118 / 2026-11-27）
    //
    // 评价决定不能再绕过 JEV：先创建/关联 kind=PERFORMANCE 的案件，经
    // 人工独立判断 + AI 建议（可选）+ 服务端 5 个 checker 校验后，由授权
    // 人决定。没有最终 decision record 的评价决定不能进入最终批准。
    // ------------------------------------------------------------------
    app.post("/api/v1/evaluation-decisions/:id/decision-case", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const createdBy = requireActorRequired(
        request,
        ownPersonId(request),
        "creating an evaluation decision JEV case",
      );
      const tenantId = tenantOf(request);
      const decision = await storeFor(request).getEvaluationDecision(
        idOf(request),
      );
      const ensured = await ensureEvaluationDecisionCase({
        platformStore,
        tenantId,
        decision,
        createdBy,
      });
      if (ensured.created) countEvent("evaluation_decision_case_created");
      return reply.status(ensured.created ? 201 : 200).send(
        data(
          {
            created: ensured.created,
            subjectType: EVALUATION_DECISION_SUBJECT,
            subjectId: decision.id,
            case: ensured.detail.case,
            evidence: ensured.detail.evidence,
            judgments: ensured.detail.judgments,
            decision: evaluationDecisionWithJev(decision, ensured.detail),
          },
          request,
        ),
      );
    });

    app.get("/api/v1/evaluation-decisions/:id/decision-case", async (request) => {
      requireRoles(request, "manager", "finance");
      const tenantId = tenantOf(request);
      const decision = await storeFor(request).getEvaluationDecision(
        idOf(request),
      );
      const decisionCase = await platformStore.findDecisionCaseBySubject(
        tenantId,
        EVALUATION_DECISION_SUBJECT,
        decision.id,
      );
      if (!decisionCase) {
        return data(
          {
            case: null,
            evidence: [],
            judgments: { human: [], ai: [] },
            verifications: [],
            links: [],
            record: null,
            decision: evaluationDecisionWithJev(decision),
          },
          request,
        );
      }
      const detail = await platformStore.getDecisionCase(
        tenantId,
        decisionCase.id,
      );
      return data(
        {
          ...detail,
          decision: evaluationDecisionWithJev(decision, detail),
        },
        request,
      );
    });

    // 评价 JEV 决定：只处理 subject=EVALUATION_DECISION 的案件，成功后把
    // 评价决定推进为 JEV_DECIDED（record 是唯一凭据，评价决定本身不可改写）。
    app.post("/api/v1/evaluation-decisions/:id/decision-case/decide", async (request) => {
      requireRoles(request, "manager", "finance");
      const tenantId = tenantOf(request);
      const decision = await storeFor(request).getEvaluationDecision(
        idOf(request),
      );
      const body = (request.body ?? {}) as {
        rationale?: unknown;
        finalJudgmentId?: unknown;
        decidedBy?: unknown;
      };
      const rationale =
        typeof body.rationale === "string" ? body.rationale.trim() : "";
      if (!rationale) {
        throw new EvaluationDecisionInputError(
          "deciding an evaluation JEV case requires a rationale",
        );
      }
      const decidedBy = requireActorRequired(
        request,
        body.decidedBy ?? ownPersonId(request),
        "deciding an evaluation decision JEV case",
      );
      const decisionCase = await platformStore.findDecisionCaseBySubject(
        tenantId,
        EVALUATION_DECISION_SUBJECT,
        decision.id,
      );
      if (!decisionCase) {
        throw decisionCaseRequired(
          `评价决定 ${decision.id} 尚未关联 JEV 案件：先调用 POST /api/v1/evaluation-decisions/:id/decision-case`,
        );
      }
      const before = await platformStore.getDecisionCase(
        tenantId,
        decisionCase.id,
      );
      if (before.case.subjectType !== EVALUATION_DECISION_SUBJECT) {
        throw decisionCaseSubjectMismatch(
          `案件 ${decisionCase.id} 的 subjectType 是 ${before.case.subjectType}，不是 ${EVALUATION_DECISION_SUBJECT}`,
        );
      }
      const record = await platformStore.decideDecisionCase({
        tenantId,
        caseId: decisionCase.id,
        finalJudgmentId:
          typeof body.finalJudgmentId === "string"
            ? body.finalJudgmentId
            : undefined,
        decidedBy,
        rationale,
      });
      const detail = await platformStore.getDecisionCase(
        tenantId,
        decisionCase.id,
      );
      countEvent("evaluation_decision_jev_decided");
      return data(
        {
          record,
          case: detail.case,
          decision: evaluationDecisionWithJev(decision, detail),
        },
        request,
      );
    });

    // 最终批准门禁：没有 JEV record 的评价决定一律 409 DECISION_CASE_REQUIRED。
    // 该端点幂等，只做门禁校验与状态回传；批准的唯一凭据是 decision record。
    app.post("/api/v1/evaluation-decisions/:id/final-approval", async (request) => {
      requireRoles(request, "manager", "finance");
      const tenantId = tenantOf(request);
      const decision = await storeFor(request).getEvaluationDecision(
        idOf(request),
      );
      const decisionCase = await platformStore.findDecisionCaseBySubject(
        tenantId,
        EVALUATION_DECISION_SUBJECT,
        decision.id,
      );
      if (!decisionCase) {
        throw decisionCaseRequired(
          `评价决定 ${decision.id} 没有 JEV 案件记录：不能进入最终批准`,
        );
      }
      const detail = await platformStore.getDecisionCase(
        tenantId,
        decisionCase.id,
      );
      if (detail.case.subjectType !== EVALUATION_DECISION_SUBJECT) {
        throw decisionCaseSubjectMismatch(
          `案件 ${decisionCase.id} 的 subjectType 是 ${detail.case.subjectType}，不是 ${EVALUATION_DECISION_SUBJECT}`,
        );
      }
      if (!detail.record) {
        throw decisionCaseRequired(
          `JEV 案件 ${decisionCase.id} 尚无最终决定记录（状态 ${detail.case.status}）：不能进入最终批准`,
        );
      }
      countEvent("evaluation_decision_final_approved");
      return data(
        {
          approved: true,
          decision: evaluationDecisionWithJev(decision, detail),
          case: detail.case,
          record: detail.record,
        },
        request,
      );
    });
  };
}
