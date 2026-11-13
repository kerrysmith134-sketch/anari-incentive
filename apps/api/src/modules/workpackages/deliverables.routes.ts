/**
 * 交付物域路由（提交/验收/验收记录）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ForbiddenError } from "@anari/auth";
import {
  createDeliverableSchema,
  recordDeliverableAcceptanceSchema,
  submitDeliverableSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  ownPersonId,
  isPlatformAdmin,
} from "../../http-helpers.js";

export function registerDeliverableRoutes(deps: {
  platformStore: PlatformStore;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/work-packages/:id/deliverables", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createDeliverableSchema, request.body);
    await storeFor(request).getWorkPackage(idOf(request));
    return reply.status(201).send(
      data(
        await platformStore.createDeliverable({
          tenantId: tenantOf(request),
          workPackageId: idOf(request),
          title: body.title,
          deliverableType: body.deliverableType,
          ownerPersonId: body.ownerPersonId,
          dueAt: body.dueAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/work-packages/:id/deliverables", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listDeliverables(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/deliverables/:id/submit", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(submitDeliverableSchema, request.body ?? {});
    return data(
      await platformStore.submitDeliverable({
        tenantId: tenantOf(request),
        deliverableId: idOf(request),
        artifactRef: body.artifactRef,
        contentHash: body.contentHash,
      }),
      request,
    );
  });

  app.post("/api/v1/deliverables/:id/acceptance", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(recordDeliverableAcceptanceSchema, request.body);
    // NPV2-003：验收人必须是会话主体（平台管理员除外）。
    const acceptOwn = ownPersonId(request);
    if (acceptOwn && !isPlatformAdmin(request) && body.reviewerPersonId !== acceptOwn) {
      throw new ForbiddenError(
        "acceptance must use the authenticated identity",
      );
    }
    const acceptance = await platformStore.recordDeliverableAcceptance({
      tenantId: tenantOf(request),
      deliverableId: idOf(request),
      decision: body.decision,
      reviewerPersonId: body.reviewerPersonId,
      criteriaResults: body.criteriaResults ?? {},
      comments: body.comments,
    });
    countEvent(
      body.decision === "REJECT"
        ? "deliverable_rejected"
        : "deliverable_accepted",
    );
    return reply.status(201).send(data(acceptance, request));
  });

  app.get("/api/v1/deliverables/:id/acceptances", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listDeliverableAcceptances(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });
  };
}
