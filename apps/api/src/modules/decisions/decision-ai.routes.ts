/**
 * vLLM decision AI 建议路由（decision-ai）。
 *
 *   POST /api/v1/decision-cases/:id/ai-suggestion
 *
 * 流程：加载案件与证据 → 调 vLLM（OpenAI-compatible /v1/chat/completions）
 * → 严格校验 JSON/证据引用 → 以 AI_MODEL 身份写一条普通 judgment 作为建议。
 *
 * 不变量：
 * - 只有 admin/manager 能触发；AI_MODEL 写入仍需既有服务凭据
 *   （x-decision-ai-token = env DECISION_AI_TOKEN，或 platform_admin）；
 * - 模型只产出建议：本路由不调用 decide，不写 decision record，也绝不把
 *   建议标成最终依据；
 * - 非 JSON / 字段不符 / 引用了不存在的证据 → 502 VLLM_DECISION_FAILED，
 *   不落任何 judgment（失败即无副作用）；
 * - 日志只记录 modelRef / case ref / inputHash / 维度 / 耗时，不记录 prompt
 *   或证据正文。
 */
import { timingSafeEqual } from "node:crypto";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import { ForbiddenError } from "@anari/auth";
import { decisionAiSuggestionSchema } from "@anari/contracts";
import type { DecisionPort } from "../../store-ports.js";
import {
  data,
  errorBody,
  idOf,
  isPlatformAdmin,
  parse,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";
import {
  DecisionAiConfigError,
  DecisionAiError,
  VllmDecisionClient,
  decisionAiInputHash,
  defaultDimensionsFor,
  resolveVllmDecisionConfig,
  type DecisionAiCaseKind,
  type DecisionAiEvidenceInput,
  type DecisionAiSuggestion,
  type DecisionAiSuggestionInput,
  type VllmDecisionConfig,
} from "../../../../../packages/decision-ai/src/index.js";

/** 与 decision.routes.ts 保持一致：AI judgment 需要独立机器凭据。 */
const DECISION_AI_TOKEN_HEADER = "x-decision-ai-token";
const MIN_DECISION_AI_TOKEN_LENGTH = 32;

function throwDecisionForbidden(code: string, message: string): never {
  const error = new ForbiddenError(`${code}: ${message}`);
  Object.defineProperty(error, "code", { value: code, configurable: true });
  throw error;
}

/**
 * AI_MODEL judgment 的写入门禁（复用 118 既有机制）：
 * platform_admin，或 x-decision-ai-token 与 env DECISION_AI_TOKEN
 * （>=32 字符）常量时间相等。管理员会话本身不足以伪造 AI 建议。
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

export function registerDecisionAiRoutes(deps: {
  platformStore: DecisionPort;
}): FastifyPluginAsync {
  const { platformStore } = deps;
  return async (app: FastifyInstance) => {
    app.post(
      "/api/v1/decision-cases/:id/ai-suggestion",
      async (request, reply) => {
        // 触发者：管理角色（admin 由 requireRoles 隐式放行）。
        requireRoles(request, "manager");
        // AI_MODEL 写入凭据：与人工 judgment 路由使用同一套服务 token 机制。
        requireAiJudgmentAuthority(request);

        let config: VllmDecisionConfig;
        try {
          config = resolveVllmDecisionConfig();
        } catch (error) {
          if (error instanceof DecisionAiConfigError) {
            return reply.status(501).send({
              ...errorBody(error.code, error.message),
              meta: { correlation_id: request.id },
            });
          }
          throw error;
        }

        const body = parse(decisionAiSuggestionSchema, request.body ?? {});
        const tenantId = tenantOf(request);
        const caseId = idOf(request);
        // 证据正文不在详情接口外泄（DecisionEvidence.content 仅服务端复核），
        // 因此模型只看到案件上下文 + 证据元数据/承诺；AI 只能在授权边界内
        // 使用已登记的证据引用。
        const detail = await platformStore.getDecisionCase(tenantId, caseId);
        const dimensions =
          body.dimensions && body.dimensions.length > 0
            ? [...body.dimensions]
            : defaultDimensionsFor(detail.case.kind as DecisionAiCaseKind);
        const evidence: DecisionAiEvidenceInput[] = detail.evidence.map(
          (entry) => ({
            ref: entry.id,
            sourceType: entry.sourceType,
            sourceId: entry.sourceId,
            contentHash: entry.contentHash,
            supports: entry.supports,
            weight: entry.weight,
          }),
        );
        const input: DecisionAiSuggestionInput = {
          caseId,
          kind: detail.case.kind as DecisionAiCaseKind,
          subjectType: detail.case.subjectType,
          subjectId: detail.case.subjectId,
          caseContext: detail.case.context,
          dimensions,
          evidence,
        };
        const inputHash = decisionAiInputHash(input);
        const startedAt = Date.now();
        const client = new VllmDecisionClient({
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: config.apiKey,
          timeoutMs: config.timeoutMs,
        });

        let suggestion: DecisionAiSuggestion;
        try {
          suggestion = await client.suggest(input);
        } catch (error) {
          const failure =
            error instanceof DecisionAiError
              ? error
              : new DecisionAiError(
                  "HTTP_ERROR",
                  "decision AI suggestion failed",
                  false,
                );
          // 只记录可对账的元数据；不记录 prompt / 证据正文 / 模型原文。
          request.log.warn(
            {
              event: "decision.ai_suggestion",
              outcome: "FAILED",
              reason: failure.reason,
              modelRef: config.modelRef,
              caseId,
              caseVersion: detail.case.version,
              inputHash,
              dimensions,
              evidenceCount: evidence.length,
              durationMs: Date.now() - startedAt,
            },
            "decision AI suggestion failed",
          );
          return reply.status(502).send({
            ...errorBody(
              "VLLM_DECISION_FAILED",
              `decision AI suggestion failed: ${failure.reason}`,
              {
                reason: failure.reason,
                retryable: failure.retryable,
                ...(failure.details ?? {}),
              },
            ),
            meta: { correlation_id: request.id },
          });
        }

        // AI 只作为建议记录：actorType=AI_MODEL，不产生 decision record，
        // 也不设置任何 finalDecision 标记。
        const judgment = await platformStore.submitDecisionJudgment({
          tenantId,
          caseId,
          actorType: "AI_MODEL",
          actorId: config.modelRef,
          modelRef: config.modelRef,
          independentScores: {
            overallConfidence: suggestion.overallConfidence,
            states: Object.fromEntries(
              suggestion.dimensions.map((entry) => [
                entry.dimension,
                entry.state,
              ]),
            ),
          },
          independentRationale: suggestion.summary,
          dimensionStates: {
            advisoryOnly: true,
            source: "vllm",
            inputHash,
            overallConfidence: suggestion.overallConfidence,
            dimensions: suggestion.dimensions,
          },
          confidence: suggestion.overallConfidence,
        });
        request.log.info(
          {
            event: "decision.ai_suggestion",
            outcome: "SUCCEEDED",
            modelRef: config.modelRef,
            caseId,
            caseVersion: detail.case.version,
            judgmentId: judgment.id,
            inputHash,
            dimensions,
            evidenceCount: evidence.length,
            durationMs: Date.now() - startedAt,
          },
          "decision AI suggestion recorded as an advisory AI_MODEL judgment",
        );
        return reply.status(201).send(
          data(
            {
              judgmentId: judgment.id,
              modelRef: config.modelRef,
              inputHash,
              suggestion,
            },
            request,
          ),
        );
      },
    );
  };
}
