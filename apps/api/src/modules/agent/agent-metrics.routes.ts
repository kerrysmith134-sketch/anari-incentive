/**
 * Agent 可观测性持久化端点（AUD-023）。
 *
 * - POST /api/v1/agent-feedback-labels：人工标注（误报/确认/升级），
 *   actor 收口（body 不可伪造 labeledBy）。
 * - POST /api/v1/agent-ai-off-baselines：AI-off 对照基线录入。
 * - GET /api/v1/reports/agent-metrics（在 reports 域）从这些持久化事实
 *   自动计算；缺事实的指标保持明确的 unavailable 原因，不以静态输入冒充。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { IncentiveStore } from "../../store-interface.js";
import { createAgentAiOffBaselineSchema, createAgentFeedbackLabelSchema } from "@anari/contracts";
import {
  data,
  ownPersonId,
  parse,
  requireActorRequired,
  requireRoles,
} from "../../http-helpers.js";
import { ForbiddenError } from "@anari/auth";

export function registerAgentMetricsRoutes(deps: {
  storeFor: (request: FastifyRequest) => IncentiveStore;
}): FastifyPluginAsync {
  const { storeFor } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/agent-feedback-labels", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const body = parse(createAgentFeedbackLabelSchema, request.body);
      const actorPersonId = ownPersonId(request);
      if (!actorPersonId) {
        throw new ForbiddenError(
          "labeling agent findings requires an authenticated employee identity",
        );
      }
      const label = await storeFor(request).recordAgentFeedbackLabel({
        ...body,
        labeledBy: requireActorRequired(request, actorPersonId, "labeling"),
      });
      return reply.status(201).send(data(label, request));
    });

    app.post("/api/v1/agent-ai-off-baselines", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const body = parse(createAgentAiOffBaselineSchema, request.body);
      const actorPersonId = ownPersonId(request);
      if (!actorPersonId) {
        throw new ForbiddenError(
          "recording an AI-off baseline requires an authenticated employee identity",
        );
      }
      const baseline = await storeFor(request).recordAgentAiOffBaseline({
        ...body,
        recordedBy: requireActorRequired(
          request,
          actorPersonId,
          "recording AI-off baseline",
        ),
      });
      return reply.status(201).send(data(baseline, request));
    });
  };
}
