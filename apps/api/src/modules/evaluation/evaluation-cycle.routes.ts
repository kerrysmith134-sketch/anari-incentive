/**
 * 评价周期域路由（周期/量规/草案/决议/指标定义/员工确认）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { notifyBestEffort } from "../../notify.js";
import type { AssessmentPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
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
} from "../../http-helpers.js";

export function registerEvaluationCycleRoutes(deps: {
  platformStore: AssessmentPort;
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
    return data(
      await storeFor(request).listEvaluationDrafts({
        cycleId: query.cycleId,
        personId: person ?? query.personId,
      }),
      request,
    );
  });

  app.get("/api/v1/evaluation-drafts/:id", async (request) => {
    const draft = await storeFor(request).getEvaluationDraft(idOf(request));
    const person = personFilter(request);
    if (person && draft.personId !== person) {
      throw new ForbiddenError("evaluation draft is not visible to this person");
    }
    return data(draft, request);
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
    const result = await store.decideEvaluationDraft(idOf(request), {
      ...body,
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
