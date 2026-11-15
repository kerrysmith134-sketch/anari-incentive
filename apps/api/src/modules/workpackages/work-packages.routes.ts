/**
 * 工作包域路由（NPV2-011 第四片）：
 * 工作包生命周期（创建/提交/开始/验收/批量验收/驳回）、版本历史。
 * 行为与拆分前等价；参与者守卫与验收人分离保持不变。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { IncentiveStore } from "../../store-interface.js";
import {
  acceptWorkPackageSchema,
  acceptWorkPackagesBatchSchema,
  commitWorkPackageSchema,
  createWorkPackageSchema,
  rejectWorkPackageSchema,
  workPackageCommandSchema,
} from "@anari/contracts";
import { ForbiddenError } from "@anari/auth";
import {
  data,
  idOf,
  parse,
  personFilter,
  requireRoles,
  requireActorRequired,
} from "../../http-helpers.js";

export function registerWorkPackageRoutes(deps: {
  storeFor: (request: FastifyRequest) => IncentiveStore;
  assertWorkPackageParticipant: (
    request: FastifyRequest,
    store: IncentiveStore,
    workPackageId: string,
  ) => Promise<void>;
}): FastifyPluginAsync {
  const { storeFor, assertWorkPackageParticipant } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/work-packages", async (request, reply) => {
      const body = parse(createWorkPackageSchema, request.body);
      const person = personFilter(request);
      if (person && body.ownerPersonId !== person) {
        throw new ForbiddenError("cannot create a package owned by another person");
      }
      return reply.status(201).send(data(await storeFor(request).createWorkPackage(body), request));
    });

    app.get("/api/v1/work-packages", async (request) => {
      const packages = await storeFor(request).listWorkPackages();
      const person = personFilter(request);
      return data(
        person
          ? packages.filter(
              (wp) =>
                wp.ownerPersonId === person ||
                wp.members.some((member) => member.personId === person),
            )
          : packages,
        request,
      );
    });

    app.get("/api/v1/work-packages/:id", async (request) => {
      const wp = await storeFor(request).getWorkPackage(idOf(request));
      const person = personFilter(request);
      if (
        person &&
        wp.ownerPersonId !== person &&
        !wp.members.some((member) => member.personId === person)
      ) {
        throw new ForbiddenError("work package is not visible to this person");
      }
      return data(wp, request);
    });

    app.get("/api/v1/work-packages/:id/versions", async (request) => {
      const wp = await storeFor(request).getWorkPackage(idOf(request));
      const person = personFilter(request);
      if (
        person &&
        wp.ownerPersonId !== person &&
        !wp.members.some((member) => member.personId === person)
      ) {
        throw new ForbiddenError("work package is not visible to this person");
      }
      return data(
        await storeFor(request).listWorkPackageVersions(idOf(request)),
        request,
      );
    });

    app.post("/api/v1/work-packages/:id/commit", async (request) => {
      const body = parse(commitWorkPackageSchema, request.body);
      const store = storeFor(request);
      await assertWorkPackageParticipant(request, store, idOf(request));
      return data(
        await store.commitWorkPackage(idOf(request), body.expectedVersion),
        request,
      );
    });

    app.post("/api/v1/work-packages/:id/start", async (request) => {
      const body = parse(workPackageCommandSchema, request.body ?? {});
      const store = storeFor(request);
      await assertWorkPackageParticipant(request, store, idOf(request));
      return data(
        await store.startWorkPackage(idOf(request), body.expectedVersion),
        request,
      );
    });

    app.post("/api/v1/work-packages/:id/submit", async (request) => {
      const body = parse(workPackageCommandSchema, request.body ?? {});
      const store = storeFor(request);
      await assertWorkPackageParticipant(request, store, idOf(request));
      return data(
        await store.submitWorkPackage(idOf(request), body.expectedVersion),
        request,
      );
    });

    app.post("/api/v1/work-packages/:id/accept", async (request) => {
      requireRoles(request, "manager");
      const body = parse(acceptWorkPackageSchema, request.body);
      // NPV2-003/AUD-005：验收人必须是会话身份（不可代他人验收）。
      const reviewer = requireActorRequired(
        request,
        body.reviewerPersonId,
        "accepting a work package",
      );
      return data(
        await storeFor(request).acceptWorkPackage(
          idOf(request),
          reviewer,
          body.expectedVersion,
        ),
        request,
      );
    });

    app.post("/api/v1/work-packages:accept-batch", async (request, reply) => {
      requireRoles(request, "manager");
      const body = parse(acceptWorkPackagesBatchSchema, request.body);
      // 每个条目逐一做 actor 收口（批量也不例外）。
      const items = body.items.map((item) => ({
        ...item,
        reviewerPersonId: requireActorRequired(
          request,
          item.reviewerPersonId,
          "accepting work packages",
        ),
      }));
      return reply
        .status(200)
        .send(
          data(
            {
              workPackages: await storeFor(request).acceptWorkPackagesBatch(items),
            },
            request,
          ),
        );
    });

    app.post("/api/v1/work-packages/:id/reject", async (request) => {
      requireRoles(request, "manager");
      const body = parse(rejectWorkPackageSchema, request.body);
      const reviewer = requireActorRequired(
        request,
        body.reviewerPersonId,
        "rejecting a work package",
      );
      return data(
        await storeFor(request).rejectWorkPackage(
          idOf(request),
          reviewer,
          body.reason,
          body.expectedVersion,
        ),
        request,
      );
    });

  };
}
