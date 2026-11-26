/**
 * 通用 JEV Decision Record 路由（118）。
 *
 * 五类决策（PERFORMANCE / CONTRIBUTION / APPEAL / INCENTIVE_ELIGIBILITY /
 * BUDGET）共用同一组端点；kind 只改变上下文快照，不改变不变量：
 *
 *   POST /api/v1/decision-cases               创建案件
 *   POST /api/v1/decision-cases/:id/evidence  追加证据（服务端重算 hash）
 *   POST /api/v1/decision-cases/:id/judgments 提交独立判断（人工 / AI 同表）
 *   POST /api/v1/decision-cases/:id/verify    记录校验（冲突/覆盖/规则）
 *   POST /api/v1/decision-cases/:id/decide    授权人最终决定
 *   GET  /api/v1/decision-cases/:id           案件详情（人工与 AI 判断分开）
 *
 * 安全口径：
 * - 人工判断的 actorId、校验人、决定人必须是会话身份（不可代他人裁决）；
 * - AI_MODEL 判断只作为建议记录，不能成为决定人，也不能作为最终依据；
 * - 自决（decided_by 出现在任何 HUMAN judgment）由存储层 409 拒绝。
 */
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import {
  appendDecisionEvidenceSchema,
  createDecisionCaseSchema,
  decideDecisionCaseSchema,
  recordDecisionVerificationSchema,
  submitDecisionJudgmentSchema,
} from "@anari/contracts";
import type { DecisionPort } from "../../store-ports.js";
import {
  data,
  idOf,
  ownPersonId,
  parse,
  requireActorRequired,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";

export function registerDecisionRoutes(deps: {
  platformStore: DecisionPort;
}): FastifyPluginAsync {
  const { platformStore } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/decision-cases", async (request, reply) => {
      const body = parse(createDecisionCaseSchema, request.body);
      // 创建人必须是会话身份；允许 body 省略并回落到会话 personId。
      const createdBy = requireActorRequired(
        request,
        body.createdBy ?? ownPersonId(request),
        "creating a decision case",
      );
      const decisionCase = await platformStore.createDecisionCase({
        tenantId: tenantOf(request),
        kind: body.kind,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        context: body.context,
        createdBy,
      });
      return reply.status(201).send(data(decisionCase, request));
    });

    app.post("/api/v1/decision-cases/:id/evidence", async (request, reply) => {
      const body = parse(appendDecisionEvidenceSchema, request.body);
      const evidence = await platformStore.appendDecisionEvidence({
        tenantId: tenantOf(request),
        caseId: idOf(request),
        sourceType: body.sourceType,
        sourceId: body.sourceId,
        content: body.content,
        contentHash: body.contentHash,
        supports: body.supports,
        weight: body.weight === undefined ? undefined : String(body.weight),
      });
      return reply.status(201).send(data(evidence, request));
    });

    app.post("/api/v1/decision-cases/:id/judgments", async (request, reply) => {
      const body = parse(submitDecisionJudgmentSchema, request.body);
      if (body.actorType === "HUMAN") {
        // 人工判断必须由本人提交；不能替别人“独立”判断。
        requireActorRequired(
          request,
          body.actorId,
          "submitting a human decision judgment",
        );
      }
      const judgment = await platformStore.submitDecisionJudgment({
        tenantId: tenantOf(request),
        caseId: idOf(request),
        actorType: body.actorType,
        actorId: body.actorId,
        modelRef: body.modelRef,
        independentScores: body.independentScores,
        independentRationale: body.independentRationale,
        dimensionStates: body.dimensionStates,
        confidence:
          body.confidence === undefined ? undefined : Number(body.confidence),
      });
      return reply.status(201).send(data(judgment, request));
    });

    app.post("/api/v1/decision-cases/:id/verify", async (request, reply) => {
      // 校验是治理动作：只允许管理/财务角色记录。
      requireRoles(request, "manager", "finance");
      const body = parse(recordDecisionVerificationSchema, request.body);
      const verifiedBy = requireActorRequired(
        request,
        body.verifiedBy ?? ownPersonId(request),
        "recording a decision verification",
      );
      const verification = await platformStore.recordDecisionVerification({
        tenantId: tenantOf(request),
        caseId: idOf(request),
        checks: body.checks,
        findings: body.findings,
        passed: body.passed,
        verifiedBy,
      });
      return reply.status(201).send(data(verification, request));
    });

    app.post("/api/v1/decision-cases/:id/decide", async (request, reply) => {
      // 授权人：管理/财务（admin 由 requireRoles 隐式放行）。
      requireRoles(request, "manager", "finance");
      const body = parse(decideDecisionCaseSchema, request.body);
      const decidedBy = requireActorRequired(
        request,
        body.decidedBy ?? ownPersonId(request),
        "deciding a decision case",
      );
      const record = await platformStore.decideDecisionCase({
        tenantId: tenantOf(request),
        caseId: idOf(request),
        finalJudgmentId: body.finalJudgmentId,
        decidedBy,
        rationale: body.rationale,
      });
      return reply.status(200).send(data(record, request));
    });

    app.get("/api/v1/decision-cases/:id", async (request) => {
      const detail = await platformStore.getDecisionCase(
        tenantOf(request),
        idOf(request),
      );
      return data(detail, request);
    });
  };
}
