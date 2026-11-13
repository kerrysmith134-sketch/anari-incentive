/**
 * 不利行动域路由（AI 决策不利行动全生命周期）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { IncentivePort } from "../../store-ports.js";
import {
  activateAdverseActionSchema,
  approveAdverseActionSchema,
  cancelAdverseActionSchema,
  createAdverseActionSchema,
  reviewAdverseActionSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
} from "../../http-helpers.js";

export function registerAdverseActionRoutes(deps: {
  platformStore: IncentivePort;
  countEvent: (event: string) => void;
}): FastifyPluginAsync {
  const { platformStore, countEvent } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/adverse-actions", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createAdverseActionSchema, request.body);
    const action = await platformStore.createAdverseAction({
      tenantId: tenantOf(request),
      personId: body.personId,
      actionType: body.actionType,
      reason: body.reason,
      performanceBasis: body.performanceBasis,
      evidenceRefs: body.evidenceRefs ?? [],
      requestedBy: body.requestedBy,
    });
    countEvent("adverse_action_created");
    return reply.status(201).send(data(action, request));
  });

  app.get("/api/v1/adverse-actions", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { personId?: string };
    return data(
      await platformStore.listAdverseActions(
        tenantOf(request),
        query.personId,
      ),
      request,
    );
  });

  app.get("/api/v1/adverse-actions/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getAdverseAction(
        tenantOf(request),
        idOf(request),


      ),
      request,
    );
  });
  app.post("/api/v1/adverse-actions/:id/legal-review", async (request) => {
    requireRoles(request, "admin");
    const body = parse(reviewAdverseActionSchema, request.body);
    const action = await platformStore.reviewAdverseAction({
      tenantId: tenantOf(request),
      actionId: idOf(request),
      legalReviewerId: body.legalReviewerId,
      legalReviewRef: body.legalReviewRef,
      decision: body.decision,
      note: body.note,
    });
    countEvent("adverse_action_legal_reviewed");
    return data(action, request);
  });

  app.post("/api/v1/adverse-actions/:id/approve", async (request) => {
    requireRoles(request, "admin");
    const body = parse(approveAdverseActionSchema, request.body);
    const action = await platformStore.approveAdverseAction({
      tenantId: tenantOf(request),
      actionId: idOf(request),
      approvedBy: body.approvedBy,
    });
    countEvent("adverse_action_approved");
    return data(action, request);
  });

  app.post("/api/v1/adverse-actions/:id/activate", async (request) => {
    requireRoles(request, "admin");
    const body = parse(activateAdverseActionSchema, request.body);
    const action = await platformStore.activateAdverseAction({
      tenantId: tenantOf(request),
      actionId: idOf(request),
      effectiveFrom: body.effectiveFrom,
    });
    countEvent("adverse_action_activated");
    return data(action, request);
  });

  app.post("/api/v1/adverse-actions/:id/complete", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.completeAdverseAction({
        tenantId: tenantOf(request),
        actionId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/adverse-actions/:id/cancel", async (request) => {
    requireRoles(request, "admin");
    const body = parse(cancelAdverseActionSchema, request.body);
    return data(
      await platformStore.cancelAdverseAction({
        tenantId: tenantOf(request),
        actionId: idOf(request),
        reason: body.reason,
      }),
      request,
    );
  });
  };
}
