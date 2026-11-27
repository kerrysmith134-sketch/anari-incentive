/**
 * 评价周期域路由（周期/量规/草案/决议/指标定义/员工确认）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { notifyBestEffort } from "../../notify.js";
import type { AssessmentPort, DecisionPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  decisionBlindReviewContentVisible,
  type DecisionJudgment,
} from "@anari/domain";
import {
  advanceCycleSchema,
  createEvaluationCycleSchema,
  createEvaluationDraftSchema,
  createMetricDefinitionSchema,
  createRubricSchema,
  decideEvaluationDraftSchema,
  recordConfirmationSchema,
  createMetricMeasurementSnapshotSchema,
  linkMetricMeasurementSnapshotSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  personFilter,
  isPrivileged,
  ownPersonId,
  requireActorRequired,
} from "../../http-helpers.js";

/** 盲审待判断状态：AI/SYSTEM 草案处于 SUBMITTED 时尚未有人独立判断。 */
const BLIND_REVIEW_PENDING_STATUS = "SUBMITTED";

/**
 * 复核人「独立判断」的 JEV 案件 subjectType。
 *
 * 独立判断必须先于 AI 建议生效，且不能靠前端按钮：这里的 HUMAN judgment
 * 是 append-only、一人一判、不能代填的服务端事实，盲审可见性以它为准。
 */
const EVALUATION_DRAFT_SUBJECT = "EVALUATION_DRAFT";

/** 400：独立判断请求体不合法（本模块不引入新 Zod 契约，手工校验）。 */
class EvaluationDraftInputError extends Error {
  readonly statusCode = 400;
  readonly code = "INVALID_INPUT";
}

/**
 * 403 + 稳定机器码：ForbiddenError.code 固定为 FORBIDDEN，盲审拒绝需要
 * 把 SELF_REVIEW_FORBIDDEN 这类可编程码暴露给调用方（与 JEV 路由同口径）。
 */
function blindReviewForbidden(code: string, message: string): ForbiddenError {
  const error = new ForbiddenError(`${code}: ${message}`);
  Object.defineProperty(error, "code", { value: code, configurable: true });
  return error;
}

/** 409 + 稳定机器码（ConflictError.code 默认是 CONFLICT）。 */
function blindReviewConflict(
  code: string,
  message: string,
): ConflictError {
  const error = new ConflictError(`${code}: ${message}`);
  Object.defineProperty(error, "code", { value: code, configurable: true });
  return error;
}

/**
 * 独立判断请求体：0..5 的维度得分 + 至少 3 字的理由，与评价决定里的
 * independentScores / independentRationale 同口径。
 */
function parseIndependentJudgmentBody(body: unknown): {
  independentScores: Record<string, number>;
  independentRationale: string;
} {
  const record =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const scores: Record<string, number> = {};
  const rawScores = record.independentScores;
  if (rawScores !== undefined) {
    if (
      rawScores === null ||
      typeof rawScores !== "object" ||
      Array.isArray(rawScores)
    ) {
      throw new EvaluationDraftInputError(
        "independentScores must be an object of numbers between 0 and 5",
      );
    }
    for (const [dimension, value] of Object.entries(rawScores)) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 5
      ) {
        throw new EvaluationDraftInputError(
          `independentScores.${dimension} must be a number between 0 and 5`,
        );
      }
      scores[dimension] = value;
    }
  }
  const rationale =
    typeof record.independentRationale === "string"
      ? record.independentRationale.trim()
      : "";
  if (rationale.length < 3) {
    throw new EvaluationDraftInputError(
      "independentRationale must be at least 3 characters",
    );
  }
  return { independentScores: scores, independentRationale: rationale };
}

/**
 * 盲审掩码（NP-004）：`visible=false` 时服务端剥离 AI/SYSTEM 草案内容，只
 * 返回元数据并标记 contentHidden。人工（USER）草案与已离开 SUBMITTED 的
 * 草案不由这里判定，见 draftContentVisible。
 */
function maskDraftForBlindReview<
  T extends { generatedByType: string; status: string },
>(draft: T, visible: boolean): T & { contentHidden?: boolean } {
  if (visible) return draft;
  const masked = {
    ...draft,
    draftPayload: {},
    strengths: [],
    counterEvidence: [],
    missingInformation: [],
    uncertainty: {},
    contentHidden: true,
  } as T & { contentHidden?: boolean };
  return masked;
}

/**
 * 复核资格：与评价决定的角色门禁一致（manager；admin 一律放行）。
 *
 * finance 可以读草案列表（只读审计用途），但不是复核人，因而不能记录独立
 * 判断、也解锁不了 AI 建议。角色判断只读服务端 authContext。
 */
function isDraftReviewer(request: FastifyRequest): boolean {
  const roles = request.authContext?.roles ?? [];
  return roles.includes("admin") || roles.includes("manager");
}

/**
 * 复核人是否已提交独立判断（服务端事实，不信任前端声明）。
 *
 * 独立判断记录为 (kind=PERFORMANCE, subjectType=EVALUATION_DRAFT,
 * subjectId=draftId) 案件上的一条 HUMAN judgment：append-only、一人一判，
 * 因此「是否已经独立判断过」可以直接由存储层回答。
 */
async function hasDraftIndependentJudgment(
  platformStore: DecisionPort,
  tenantId: string,
  draftId: string,
  personId: string,
): Promise<boolean> {
  const decisionCase = await platformStore.findDecisionCaseBySubject(
    tenantId,
    EVALUATION_DRAFT_SUBJECT,
    draftId,
  );
  if (!decisionCase) return false;
  const detail = await platformStore.getDecisionCase(
    tenantId,
    decisionCase.id,
  );
  return detail.judgments.human.some(
    (judgment) => judgment.actorId === personId,
  );
}

/**
 * 逐条草案计算内容可见性。
 *
 * 判据全部来自服务端：草案生成者与状态、请求者的服务端角色、请求者是否
 * 就是被评价人、以及请求者是否已提交独立判断。非复核人（例如被评价人
 * 本人）在 SUBMITTED 状态永远拿不到 AGENT 内容。
 */
async function draftContentVisible(input: {
  platformStore: DecisionPort;
  request: FastifyRequest;
  draft: {
    id: string;
    personId: string;
    generatedByType: string;
    status: string;
  };
}): Promise<boolean> {
  const { platformStore, request, draft } = input;
  const generatedByUser = draft.generatedByType === "USER";
  const pendingIndependentJudgment =
    draft.status === BLIND_REVIEW_PENDING_STATUS;
  // 不需要查询的两种确定情形：人写的草案 / 已离开待判断状态。
  if (generatedByUser || !pendingIndependentJudgment) return true;
  const actorPersonId = ownPersonId(request);
  const isReviewer = isDraftReviewer(request);
  const isSubject =
    actorPersonId !== undefined && actorPersonId === draft.personId;
  const hasIndependentJudgment =
    isReviewer && !isSubject && actorPersonId !== undefined
      ? await hasDraftIndependentJudgment(
          platformStore,
          tenantOf(request),
          draft.id,
          actorPersonId,
        )
      : false;
  return decisionBlindReviewContentVisible({
    generatedByUser,
    pendingIndependentJudgment,
    isReviewer,
    hasIndependentJudgment,
    isSubject,
  });
}

export function registerEvaluationCycleRoutes(deps: {
  /** 评价端口 + JEV 决策端口（盲审独立判断落在 JEV 案件上）。 */
  platformStore: AssessmentPort & DecisionPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/evaluation-cycles/:id/advance", async (request) => {
    requireRoles(request, "manager", "admin");
    const body = parse(advanceCycleSchema, request.body);
    const store = storeFor(request);
    if (body.status === "HUMAN_REVIEW") {
      // 门禁：预审必须已产出 AGENT 草稿。
      const drafts = await store.listEvaluationDrafts({ cycleId: idOf(request) });
      if (!drafts.some((draft) => draft.generatedByType === "AGENT")) {
        throw new ConflictError(
          "PRE_REVIEW_REQUIRED: 先运行 pre-review 生成 AGENT 草稿",
        );
      }
    }
    if (body.status === "DECIDED") {
      // 门禁：所有草稿均已决策（无 DRAFT/SUBMITTED 残留）。
      const drafts = await store.listEvaluationDrafts({ cycleId: idOf(request) });
      const undecided = drafts.filter(
        (draft) => draft.status === "DRAFT" || draft.status === "SUBMITTED",
      );
      if (undecided.length > 0) {
        throw new ConflictError(
          `UNDECIDED_DRAFTS: ${undecided.length} 份草稿尚未决策`,
        );
      }
    }
    const cycle = await store.advanceEvaluationCycle(idOf(request), {
      status: body.status,
      reason: body.reason,
      actorPersonId: ownPersonId(request),
    });
    countEvent("evaluation_cycle_advanced");
    return data(cycle, request);
  });

  // CRM/ERP → 计算适配：把摄取的订单证据物化为影子计算批次。
  app.post("/api/v1/evaluation-cycles", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createEvaluationCycleSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createEvaluationCycle(body), request));
  });

  app.get("/api/v1/evaluation-cycles", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await storeFor(request).listEvaluationCycles(), request);
  });

  app.get("/api/v1/evaluation-cycles/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await storeFor(request).getEvaluationCycle(idOf(request)),
      request,
    );
  });

  app.post("/api/v1/rubrics", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createRubricSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createRubric(body), request));
  });

  app.get("/api/v1/rubrics", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await storeFor(request).listRubrics(), request);
  });

  app.post("/api/v1/evaluation-drafts", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createEvaluationDraftSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createEvaluationDraft(body), request));
  });

  app.get("/api/v1/evaluation-drafts", async (request) => {
    const query = request.query as { cycleId?: string; personId?: string };
    const person = personFilter(request);
    const drafts = await storeFor(request).listEvaluationDrafts({
      cycleId: query.cycleId,
      personId: person ?? query.personId,
    });
    // 逐条判定：非复核人（含被评价人本人）拿不到未独立判断的 AI 内容。
    const masked = await Promise.all(
      drafts.map(async (draft) =>
        maskDraftForBlindReview(
          draft,
          await draftContentVisible({ platformStore, request, draft }),
        ),
      ),
    );
    return data(masked, request);
  });

  app.get("/api/v1/evaluation-drafts/:id", async (request) => {
    const draft = await storeFor(request).getEvaluationDraft(idOf(request));
    const person = personFilter(request);
    if (person && draft.personId !== person) {
      throw new ForbiddenError("evaluation draft is not visible to this person");
    }
    return data(
      maskDraftForBlindReview(
        draft,
        await draftContentVisible({ platformStore, request, draft }),
      ),
      request,
    );
  });

  // ------------------------------------------------------------------
  // NP-004 盲审（服务端强制）：复核人先提交独立判断，服务端才揭示 AI 建议。
  //
  // 评价决定端点已经要求 independentScores / independentRationale，但那是
  // 「看完 AI 再决定」的同一笔写；要让复核人「先独立判断、再看 AI、再决定」
  // 真正成立，独立判断需要一个独立于决定、且不可改写的服务端落点。这里把
  // 它记录成 JEV 案件（subjectType=EVALUATION_DRAFT, subjectId=draftId）上的
  // 一条 HUMAN judgment：append-only、一人一判、不能代填；在它存在之前，
  // 草案的 AI 内容不会返回给任何非本人请求者。
  // ------------------------------------------------------------------
  app.post("/api/v1/evaluation-drafts/:id/independent-judgment", async (request, reply) => {
    requireRoles(request, "manager");
    const tenantId = tenantOf(request);
    const actorPersonId = requireActorRequired(
      request,
      ownPersonId(request),
      "recording an independent judgment",
    );
    const store = storeFor(request);
    const draft = await store.getEvaluationDraft(idOf(request));
    if (draft.personId === actorPersonId) {
      throw blindReviewForbidden(
        "SELF_REVIEW_FORBIDDEN",
        "the evaluated person cannot review their own draft",
      );
    }
    if (draft.status !== BLIND_REVIEW_PENDING_STATUS) {
      throw blindReviewConflict(
        "DRAFT_NOT_SUBMITTED",
        `independent judgment requires a SUBMITTED draft, got ${draft.status}`,
      );
    }
    const body = parseIndependentJudgmentBody(request.body);

    let decisionCase = await platformStore.findDecisionCaseBySubject(
      tenantId,
      EVALUATION_DRAFT_SUBJECT,
      draft.id,
    );
    let created = false;
    if (!decisionCase) {
      const requestedId = randomUUID();
      decisionCase = await platformStore.createDecisionCase({
        id: requestedId,
        tenantId,
        kind: "PERFORMANCE",
        subjectType: EVALUATION_DRAFT_SUBJECT,
        subjectId: draft.id,
        context: {
          flow: "EVALUATION_DRAFT_INDEPENDENT_JUDGMENT",
          cycleId: draft.cycleId,
          personId: draft.personId,
          generatedByType: draft.generatedByType,
          evidenceSnapshotHash: draft.evidenceSnapshotHash,
          // 独立判断发生在 AI 建议可见之前，这条案件本身不承载 AI 内容。
          draftStatusAtJudgment: draft.status,
        },
        createdBy: actorPersonId,
      });
      // 并发：另一个复核人先建案时，adapter 幂等返回它建好的案件。
      created = decisionCase.id === requestedId;
    }

    const detail = await platformStore.getDecisionCase(
      tenantId,
      decisionCase.id,
    );
    const existing = detail.judgments.human.find(
      (judgment) => judgment.actorId === actorPersonId,
    );
    if (existing) {
      // 幂等：一人一判，重复提交返回已记录的判断，绝不覆盖。
      return reply.status(200).send(
        data(
          {
            draft,
            judgment: existing,
            caseId: decisionCase.id,
            created: false,
            aiAdviceVisible: true,
          },
          request,
        ),
      );
    }
    let judgment: DecisionJudgment;
    try {
      judgment = await platformStore.submitDecisionJudgment({
        tenantId,
        caseId: decisionCase.id,
        actorType: "HUMAN",
        actorId: actorPersonId,
        independentScores: body.independentScores,
        independentRationale: body.independentRationale,
        dimensionStates: {
          source: "EVALUATION_DRAFT",
          draftId: draft.id,
          evidenceSnapshotHash: draft.evidenceSnapshotHash,
          // 这条判断产生于 AI 建议可见之前。
          aiAdviceViewed: false,
        },
      });
    } catch (error) {
      // 并发双提交：另一个请求先写入同一 actor 的判断（一人一判）。重新
      // 读取并返回已记录的那条，语义仍是幂等，而不是把 409 暴露给调用方。
      const raced = await platformStore.getDecisionCase(
        tenantId,
        decisionCase.id,
      );
      const recorded = raced.judgments.human.find(
        (entry) => entry.actorId === actorPersonId,
      );
      if (!recorded) throw error;
      return reply.status(200).send(
        data(
          {
            draft,
            judgment: recorded,
            caseId: decisionCase.id,
            created: false,
            aiAdviceVisible: true,
          },
          request,
        ),
      );
    }
    countEvent("evaluation_draft_independent_judgment");
    return reply.status(201).send(
      data(
        {
          draft,
          judgment,
          caseId: decisionCase.id,
          created,
          aiAdviceVisible: true,
        },
        request,
      ),
    );
  });

  app.post("/api/v1/evaluation-drafts/:id/submit", async (request) => {
    requireRoles(request, "manager");
    const store = storeFor(request);
    const draft = await store.submitEvaluationDraft(idOf(request));
    await notifyBestEffort(store, {
      audience: "MANAGER",
      title: "Evaluation draft submitted",
      body: `A draft for person ${draft.personId} is ready for review.`,
      sourceType: "EVALUATION_DRAFT",
      sourceId: draft.id,
    });
    return data(draft, request);
  });

  app.post("/api/v1/evaluation-drafts/:id/decision", async (request) => {
    requireRoles(request, "manager");
    const body = parse(decideEvaluationDraftSchema, request.body);
    const store = storeFor(request);
    // NP-003/AUD-005：复核人必须是会话身份（不可代他人签署评价决定）。
    const reviewerPersonId = requireActorRequired(
      request,
      body.reviewerPersonId,
      "deciding an evaluation draft",
    );
    const result = await store.decideEvaluationDraft(idOf(request), {
      ...body,
      reviewerPersonId,
      scores: body.scores ?? {},
    });
    await notifyBestEffort(store, {
      recipientPersonId: result.draft.personId,
      audience: "PERSON",
      title:
        result.draft.status === "APPROVED"
          ? "Evaluation approved"
          : "Evaluation draft rejected",
      body: result.decision
        ? `Evaluation decision v${result.decision.decisionVersion} approved.`
        : "Your evaluation draft was rejected; a new draft may be required.",
      sourceType: result.decision ? "EVALUATION_DECISION" : "EVALUATION_DRAFT",
      sourceId: result.decision?.id ?? result.draft.id,
    });
    return data(result, request);
  });

  app.get("/api/v1/evaluation-decisions", async (request) => {
    const query = request.query as { cycleId?: string; personId?: string };
    const person = personFilter(request);
    return data(
      await storeFor(request).listEvaluationDecisions({
        cycleId: query.cycleId,
        personId: person ?? query.personId,
      }),
      request,
    );
  });

  app.get("/api/v1/evaluation-decisions/:id", async (request) => {
    const decision = await storeFor(request).getEvaluationDecision(
      idOf(request),
    );
    const person = personFilter(request);
    if (person && decision.personId !== person) {
      throw new ForbiddenError(
        "evaluation decision is not visible to this person",
      );
    }
    return data(decision, request);
  });
  app.post("/api/v1/metric-definitions", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createMetricDefinitionSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createMetricDefinition({
          tenantId: tenantOf(request),
          code: body.code,
          version: body.version,
          name: body.name,
          description: body.description,
          dataType: body.dataType,
          unit: body.unit,
          aggregationMethod: body.aggregationMethod,
          sourceContract: body.sourceContract ?? {},
          effectiveFrom: body.effectiveFrom,
          effectiveTo: body.effectiveTo,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/metric-definitions", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { code?: string; active?: string };
    return data(
      await platformStore.listMetricDefinitions(tenantOf(request), {
        code: query.code,
        active:
          query.active === undefined ? undefined : query.active === "true",
      }),
      request,
    );
  });

  app.post("/api/v1/metric-definitions/:id/retire", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.retireMetricDefinition({
        tenantId: tenantOf(request),
        metricId: idOf(request),
      }),
      request,
    );
  });
  app.post("/api/v1/employee-confirmations", async (request, reply) => {
    const body = parse(recordConfirmationSchema, request.body);
    const person = personFilter(request);
    if (person && body.personId !== person) {
      throw new ForbiddenError("cannot record a confirmation for another person");
    }
    if (!isPrivileged(request) && !ownPersonId(request)) {
      throw new ForbiddenError("employee identity is required");
    }
    const store = storeFor(request);
    const confirmation = await store.recordConfirmation(body);
    if (body.decision === "OBJECTED") {
      await notifyBestEffort(store, {
        audience: "MANAGER",
        title: "Employee objection raised",
        body: `Person ${body.personId} objected to ${body.targetType} ${body.targetId}.`,
        sourceType: body.targetType,
        sourceId: body.targetId,
      });
    }
    return reply.status(201).send(data(confirmation, request));
  });

  app.get("/api/v1/employee-confirmations", async (request) => {
    const query = request.query as { personId?: string };
    const person = personFilter(request);
    if (!isPrivileged(request) && !ownPersonId(request)) {
      throw new ForbiddenError("employee identity is required");
    }
    if (person && query.personId && query.personId !== person) {
      throw new ForbiddenError("cannot read another person's confirmations");
    }
    return data(
      await storeFor(request).listConfirmations(person ?? query.personId),
      request,
    );
  });
  // ------------------------------------------------------------------
  // NPV2-017：指标计量快照——冻结评价所依据的原始指标（来源/观测时间/
  // 质量状态），contentHash 服务端计算、冻结后不可变；正式评价决定
  // 通过 link-decision 绑定快照，形成 决定 → 快照 → 来源记录 的追溯链。
  // ------------------------------------------------------------------
  app.post("/api/v1/metric-measurement-snapshots", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createMetricMeasurementSnapshotSchema, request.body);
    const actorPersonId = ownPersonId(request);
    if (!actorPersonId) {
      throw new ForbiddenError("freezing a metric snapshot requires an authenticated employee identity");
    }
    return reply.status(201).send(
      data(
        await storeFor(request).createMetricMeasurementSnapshot({
          ...body,
          frozenBy: actorPersonId,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/metric-measurement-snapshots", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const person = personFilter(request);
    return data(
      await storeFor(request).listMetricMeasurementSnapshots({
        cycleId: query.cycleId,
        personId: person ?? query.personId,
        status: query.status as never,
      }),
      request,
    );
  });

  app.get("/api/v1/metric-measurement-snapshots/:id", async (request) => {
    const snapshot = await storeFor(request).getMetricMeasurementSnapshot(idOf(request));
    const person = personFilter(request);
    if (person && snapshot.personId !== person) {
      throw new ForbiddenError("metric measurement snapshot is not visible to this person");
    }
    return data(snapshot, request);
  });

  app.get("/api/v1/metric-measurement-snapshots/:id/verify", async (request) => {
    const snapshot = await storeFor(request).getMetricMeasurementSnapshot(idOf(request));
    const person = personFilter(request);
    if (person && snapshot.personId !== person) {
      throw new ForbiddenError("metric measurement snapshot is not visible to this person");
    }
    return data(
      await storeFor(request).verifyMetricMeasurementSnapshot(idOf(request)),
      request,
    );
  });

  app.post("/api/v1/metric-measurement-snapshots/:id/link-decision", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(linkMetricMeasurementSnapshotSchema, request.body);
    const actorPersonId = ownPersonId(request);
    if (!actorPersonId) {
      throw new ForbiddenError("linking a metric snapshot requires an authenticated employee identity");
    }
    return data(
      await storeFor(request).linkMetricMeasurementSnapshotToDecision(
        idOf(request),
        { ...body, linkedBy: actorPersonId },
      ),
      request,
    );
  });

  };
}
