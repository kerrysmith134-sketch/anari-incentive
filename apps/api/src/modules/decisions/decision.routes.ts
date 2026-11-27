/**
 * 通用 JEV Decision Record 路由（118 + 120）。
 *
 * 五类决策（PERFORMANCE / CONTRIBUTION / APPEAL / INCENTIVE_ELIGIBILITY /
 * BUDGET）共用同一组端点；kind 只改变上下文快照，不改变不变量：
 *
 *   POST /api/v1/decision-cases               创建案件
 *   POST /api/v1/decision-cases/:id/evidence  追加证据（服务端重算 hash）
 *   POST /api/v1/decision-cases/:id/judgments 提交独立判断（人工 / AI 同表）
 *   POST /api/v1/decision-cases/:id/verify    服务端 5 个 checker 校验 + 绑定
 *   POST /api/v1/decision-cases/:id/link      业务对象引用 caseId
 *   POST /api/v1/decision-cases/:id/decide    授权人最终决定（校验绑定必须新鲜）
 *   GET  /api/v1/decision-cases/:id           案件详情（人工与 AI 判断分开）
 *
 * 安全口径：
 * - 人工判断的 actorId、校验人、决定人必须是会话身份（不可代他人裁决）；
 * - AI_MODEL 判断只作为建议记录，不能成为决定人，也不能作为最终依据；
 * - AI_MODEL 判断写入需要 x-decision-ai-token（env DECISION_AI_TOKEN）或
 *   platform_admin，普通业务 token 403 AI_JUDGMENT_FORBIDDEN；
 * - 客户端提交的 passed/checks/findings 只做兼容接收，服务端一律忽略；
 * - 自决（decided_by 出现在任何 HUMAN judgment）由存储层 409 拒绝。
 */
import { timingSafeEqual } from "node:crypto";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import { ForbiddenError } from "@anari/auth";
import {
  appendDecisionEvidenceSchema,
  createDecisionCaseSchema,
  decideDecisionCaseSchema,
  linkDecisionCaseSchema,
  recordDecisionVerificationSchema,
  submitDecisionJudgmentSchema,
} from "@anari/contracts";
import type { DecisionPort } from "../../store-ports.js";
import {
  data,
  errorBody,
  idOf,
  isPlatformAdmin,
  ownPersonId,
  parse,
  requireActorRequired,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";

/** AI 建议写入的独立服务凭据；普通业务 token 不得伪造 AI_MODEL 判断。 */
const DECISION_AI_TOKEN_HEADER = "x-decision-ai-token";
const MIN_DECISION_AI_TOKEN_LENGTH = 32;

function throwDecisionForbidden(code: string, message: string): never {
  const error = new ForbiddenError(`${code}: ${message}`);
  // ForbiddenError 的 code 是 readonly "FORBIDDEN"；这里保留 403 语义，
  // 但把稳定机器码暴露给调用方（AI_JUDGMENT_FORBIDDEN）。
  Object.defineProperty(error, "code", { value: code, configurable: true });
  throw error;
}

/**
 * AI_MODEL judgment 的写入门禁：
 * - platform_admin 可直接写入（平台运维/审计场景）；
 * - 其他调用方必须携带 x-decision-ai-token，且与 env DECISION_AI_TOKEN
 *   （>=32 字符）常量时间相等；
 * - 普通业务 token 即使有写权限也 403 AI_JUDGMENT_FORBIDDEN。
 */
function requireAiJudgmentAuthority(request: FastifyRequest): void {
  if (isPlatformAdmin(request)) return;
  const configured = (process.env.DECISION_AI_TOKEN ?? "").trim();
  const headerValue = request.headers[DECISION_AI_TOKEN_HEADER];
  const provided = Array.isArray(headerValue)
    ? (headerValue[0] ?? "").trim()
    : typeof headerValue === "string"
      ? headerValue.trim()
      : "";
  const providedBytes = Buffer.from(provided);
  const configuredBytes = Buffer.from(configured);
  const valid =
    configured.length >= MIN_DECISION_AI_TOKEN_LENGTH &&
    providedBytes.length === configuredBytes.length &&
    providedBytes.length > 0 &&
    timingSafeEqual(providedBytes, configuredBytes);
  if (!valid) {
    throwDecisionForbidden(
      "AI_JUDGMENT_FORBIDDEN",
      "an AI_MODEL judgment requires x-decision-ai-token (env DECISION_AI_TOKEN) or platform_admin",
    );
  }
}

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
      } else {
        // AI 建议写入需要独立服务凭据；普通业务 token 一律 403。
        requireAiJudgmentAuthority(request);
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
      // checks / findings / passed 全部由服务端 5 个 checker 产出；
      // 存储层会落一条审计记录（passed=false 也留痕，供后续调查）。
      const verification = await platformStore.recordDecisionVerification({
        tenantId: tenantOf(request),
        caseId: idOf(request),
        decidedBy: body.decidedBy,
        verifiedBy,
      });
      if (!verification.passed) {
        // 失败不返回 201，也不产生“已通过”记录；checks/findings 随错误
        // details 返回，调用方可直接看到哪一个 checker 拦下了案件。
        return reply.status(409).send({
          ...errorBody(
            "DECISION_VERIFICATION_FAILED",
            "server-side decision verification failed",
            {
              verificationId: verification.id,
              passed: false,
              checks: verification.checks,
              findings: verification.findings,
            },
          ),
          meta: { correlation_id: request.id },
        });
      }
      return reply.status(201).send(data(verification, request));
    });

    app.post("/api/v1/decision-cases/:id/link", async (request, reply) => {
      // 业务对象引用 caseId：评价/贡献/申诉/资格/预算均可链接，不反向
      // 修改既有业务路由；引用关系 append-only，GET 详情回传。
      const body = parse(linkDecisionCaseSchema, request.body);
      const linkedBy = requireActorRequired(
        request,
        body.linkedBy ?? ownPersonId(request),
        "linking a decision case",
      );
      const link = await platformStore.linkDecisionCase({
        tenantId: tenantOf(request),
        caseId: idOf(request),
        resourceType: body.resourceType,
        resourceId: body.resourceId,
        note: body.note,
        linkedBy,
      });
      return reply.status(201).send(data(link, request));
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
