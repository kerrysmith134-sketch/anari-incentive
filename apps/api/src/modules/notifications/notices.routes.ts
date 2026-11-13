/**
 * 通知与公告域路由（公告/确认回执/收件消息）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { CommsPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ForbiddenError } from "@anari/auth";
import {
  createNoticeSchema,
  processInboxMessageSchema,
  receiveInboxMessageSchema,
  recordAcknowledgementSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  isPrivileged,
  ownPersonId,
} from "../../http-helpers.js";

export function registerNoticeRoutes(deps: {
  platformStore: CommsPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/notices", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createNoticeSchema, request.body);
    if (body.policyVersionId) {
      await storeFor(request).getPolicy(body.policyVersionId);
    }
    return reply
      .status(201)
      .send(
        data(
          await platformStore.createNotice({
            tenantId: tenantOf(request),
            noticeType: body.noticeType,
            title: body.title,
            bodyRef: body.bodyRef,
            policyVersionId: body.policyVersionId,
            publishedAt: body.publishedAt,
            effectiveFrom: body.effectiveFrom,
            acknowledgementRequired: body.acknowledgementRequired ?? true,
          }),
          request,
        ),
      );
  });

  app.get("/api/v1/notices", async (request) => {
    return data(await platformStore.listNotices(tenantOf(request)), request);
  });

  app.get("/api/v1/notices/:id/acknowledgements", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listAcknowledgements(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/notices/:id/acknowledgements", async (request) => {
    const body = parse(recordAcknowledgementSchema, request.body);
    if (!isPrivileged(request)) {
      const own = ownPersonId(request);
      if (!own) {
        throw new ForbiddenError(
          "employee identity is required (person_id claim or X-Person-Id)",
        );
      }
      if (own !== body.personId) {
        throw new ForbiddenError(
          "an employee cannot acknowledge a notice for another person",
        );
      }
    }
    const acknowledgement = await platformStore.recordAcknowledgement({
      tenantId: tenantOf(request),
      noticeId: idOf(request),
      personId: body.personId,
      decision: body.decision,
      signatureRef: body.signatureRef,
      declineReason: body.declineReason,
    });
    countEvent(
      body.decision === "ACKNOWLEDGE"
        ? "notice_acknowledged"
        : "notice_declined",
    );
    return data(acknowledgement, request);
  });

  app.get("/api/v1/notices/:id", async (request) => {
    return data(
      await platformStore.getNotice(tenantOf(request), idOf(request)),
      request,
    );
  });
  app.post("/api/v1/inbox-messages", async (request, reply) => {
    requireRoles(request, "integration");
    const body = parse(receiveInboxMessageSchema, request.body);
    const inboxMessage = await platformStore.receiveInboxMessage({
      tenantId: tenantOf(request),
      consumerName: body.consumerName,
      messageId: body.messageId,
    });
    countEvent("inbox_received");
    return reply.status(201).send(data(inboxMessage, request));
  });

  app.get("/api/v1/inbox-messages", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      consumerName?: string;
      status?: string;
    };
    return data(
      await platformStore.listInboxMessages(tenantOf(request), {
        consumerName: query.consumerName,
        status: query.status,
      }),
      request,
    );
  });

  app.post("/api/v1/inbox-messages/:id/process", async (request) => {
    requireRoles(request, "integration");
    const body = parse(processInboxMessageSchema, request.body);
    const processed = await platformStore.processInboxMessage({
      tenantId: tenantOf(request),
      inboxMessageId: idOf(request),
      status: body.status,
      errorCode: body.errorCode,
    });
    countEvent(
      body.status === "PROCESSED"
        ? "inbox_processed"
        : "inbox_failed",
    );
    return data(processed, request);
  });
  };
}
