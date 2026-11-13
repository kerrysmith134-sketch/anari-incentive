/**
 * 通知域路由（NPV2-011）。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { IncentiveStore } from "../../store-interface.js";
import { createNotificationSchema } from "@anari/contracts";
import { data, idOf, parse, personFilter, requireRoles } from "../../http-helpers.js";
import { ForbiddenError } from "@anari/auth";

export function registerNotificationRoutes(deps: {
  storeFor: (request: FastifyRequest) => IncentiveStore;
}): FastifyPluginAsync {
  const { storeFor } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/notifications", async (request, reply) => {
      requireRoles(request, "manager", "integration");
      const body = parse(createNotificationSchema, request.body);
      return reply
        .status(201)
        .send(data(await storeFor(request).createNotification(body), request));
    });

    app.get("/api/v1/notifications", async (request) => {
      const query = request.query as { status?: string; audience?: string };
      const person = personFilter(request);
      return data(
        await storeFor(request).listNotifications({
          recipientPersonId: person,
          audience: query.audience,
          status: query.status,
        }),
        request,
      );
    });

    app.post("/api/v1/notifications/read-all", async (request) => {
      const person = personFilter(request);
      const notifications = await storeFor(request).listNotifications(
        person ? { recipientPersonId: person } : {},
      );
      let marked = 0;
      for (const notification of notifications) {
        if (notification.status === "UNREAD") {
          await storeFor(request).markNotificationRead(notification.id);
          marked += 1;
        }
      }
      return data({ marked }, request);
    });

    app.post("/api/v1/notifications/:id/read", async (request) => {
      const person = personFilter(request);
      if (person) {
        const own = (
          await storeFor(request).listNotifications({
            recipientPersonId: person,
          })
        ).find((notification) => notification.id === idOf(request));
        if (!own) {
          throw new ForbiddenError(
            "notification is not visible to this person",
          );
        }
      }
      return data(
        await storeFor(request).markNotificationRead(idOf(request)),
        request,
      );
    });

  };
}
