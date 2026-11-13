/**
 * 贡献认定域路由（NPV2-011 第五片）：
 * attribution decisions（单条/批量/查询）。利益冲突检查保持不变。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { IncentiveStore } from "../../store-interface.js";
import {
  createAttributionDecisionSchema,
  createAttributionDecisionsBatchSchema,
} from "@anari/contracts";
import { ForbiddenError } from "@anari/auth";
import {
  data,
  parse,
  personFilter,
  requireRoles,
} from "../../http-helpers.js";

export function registerAttributionRoutes(deps: {
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  assertNoAdjudicatorConflict: (
    request: FastifyRequest,
    adjudicatorPersonId: string,
    claimantPersonId: string,
  ) => Promise<void>;
}): FastifyPluginAsync {
  const { storeFor, countEvent, assertNoAdjudicatorConflict } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/attribution-decisions", async (request, reply) => {
      requireRoles(request, "manager");
      const body = parse(createAttributionDecisionSchema, request.body);
      const claim = await storeFor(request).getClaim(body.claimId);
      await assertNoAdjudicatorConflict(
        request,
        body.adjudicatorPersonId,
        claim.claimantPersonId,
      );
      return reply
        .status(201)
        .send(data(await storeFor(request).createAttributionDecision(body), request));
    });
    app.post("/api/v1/attribution-decisions:batch", async (request, reply) => {
      requireRoles(request, "manager");
      const body = parse(createAttributionDecisionsBatchSchema, request.body);
      for (const item of body.items) {
        const claim = await storeFor(request).getClaim(item.claimId);
        await assertNoAdjudicatorConflict(
          request,
          item.adjudicatorPersonId,
          claim.claimantPersonId,
        );
      }
      const decisions = await storeFor(request).createAttributionDecisionsBatch(
        body.items,
      );
      return reply.status(201).send(data({ decisions }, request));
    });

    app.get("/api/v1/attribution-decisions", async (request) => {
      const query = request.query as { claimId?: string };
      const person = personFilter(request);
      if (person) {
        const claims = await storeFor(request).listClaims();
        const own = new Set(
          claims
            .filter((claim) => claim.claimantPersonId === person)
            .map((claim) => claim.id),
        );
        if (query.claimId && !own.has(query.claimId)) {
          throw new ForbiddenError("claim is not visible to this person");
        }
        return data(
          (await storeFor(request).listDecisions(query.claimId)).filter(
            (decision) => own.has(decision.claimId),
          ),
          request,
        );
      }
      return data(await storeFor(request).listDecisions(query.claimId), request);
    });

  };
}
