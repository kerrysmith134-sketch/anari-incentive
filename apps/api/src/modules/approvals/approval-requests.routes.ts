/**
 * 审批请求域路由（NPV2-011 第七片）：
 * 审批请求生命周期（创建/列表/详情/决定/消费）。决策者与消费者绑定会话身份。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import {
  consumeApprovalRequestSchema,
  createApprovalRequestSchema,
  decideApprovalRequestSchema,
} from "@anari/contracts";
import { sha256 } from "@anari/policy-dsl";
import { ForbiddenError } from "@anari/auth";
import { NotFoundError } from "../../store.js";
import {
  data,
  idOf,
  isPlatformAdmin,
  ownPersonId,
  parse,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";

export function registerApprovalRoutes(deps: {
  platformStore: PlatformStore;
  countEvent: (event: string) => void;
}): FastifyPluginAsync {
  const { platformStore, countEvent } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/approval-requests", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const body = parse(createApprovalRequestSchema, request.body);
      // The requester identity comes from the session, not the body: otherwise a
      // caller can claim requestedByType=SYSTEM and then approve their own action.
      const requesterPersonId = ownPersonId(request);
      const approval = await platformStore.createApprovalRequest({
        tenantId: tenantOf(request),
        actionType: body.actionType,
        targetType: body.targetType,
        targetId: body.targetId,
        targetVersion: body.targetVersion ?? 1,
        requestedByType: requesterPersonId ? "USER" : body.requestedByType,
        requestedById: requesterPersonId ?? body.requestedById,
        riskTier: body.riskTier,
        requiredApprovals: body.requiredApprovals ?? 1,
        expiresAt: body.expiresAt,
        payloadHash: sha256(body.payload ?? {}),
        idempotencyKey: body.idempotencyKey,
      });
      countEvent("approval_created");
      return reply.status(201).send(data(approval, request));
    });

    app.get("/api/v1/approval-requests", async (request) => {
      requireRoles(request, "manager", "finance");
      const query = request.query as {
        status?: string;
        targetType?: string;
        targetId?: string;
      };
      return data(
        await platformStore.listApprovalRequests(tenantOf(request), {
          status: query.status as
            | "PENDING"
            | "APPROVED"
            | "REJECTED"
            | "EXPIRED"
            | "CANCELLED"
            | undefined,
          targetType: query.targetType,
          targetId: query.targetId,
        }),
        request,
      );
    });

    app.get("/api/v1/approval-requests/:id", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.getApprovalRequest(
          tenantOf(request),
          idOf(request),
        ),
        request,
      );
    });

    app.get("/api/v1/approval-requests/:id/decisions", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.listApprovalDecisions(
          tenantOf(request),
          idOf(request),
        ),
        request,
      );
    });

    app.post("/api/v1/approval-requests/:id/decide", async (request) => {
      requireRoles(request, "manager", "finance");
      const body = parse(decideApprovalRequestSchema, request.body);
      const person = ownPersonId(request);
      if (person && !isPlatformAdmin(request) && body.approverPersonId !== person) {
        throw new ForbiddenError(
          "approvals must be decided under your own identity",
        );
      }
      const persons = await platformStore.listPersons(tenantOf(request));
      if (!persons.some((candidate) => candidate.id === body.approverPersonId)) {
        throw new NotFoundError(`Person ${body.approverPersonId} not found`);
      }
      const decided = await platformStore.decideApprovalRequest({
        tenantId: tenantOf(request),
        requestId: idOf(request),
        decision: body.decision,
        approverPersonId: body.approverPersonId,
        payloadHash: body.payloadHash,
        reason: body.reason,
        authContext: body.authContext ?? {},
      });
      countEvent(
        body.decision === "APPROVE"
          ? "approval_approved"
          : "approval_rejected",
      );
      return data(decided, request);
    });

    app.post("/api/v1/approval-requests/:id/consume", async (request) => {
      requireRoles(request, "finance");
      const body = parse(consumeApprovalRequestSchema, request.body);
      const person = ownPersonId(request);
      if (person && !isPlatformAdmin(request) && body.consumedBy !== person) {
        throw new ForbiddenError("approvals must be consumed under your own identity");
      }
      const consumed = await platformStore.consumeApprovalRequest({
        tenantId: tenantOf(request),
        requestId: idOf(request),
        consumedBy: body.consumedBy,
      });
      countEvent("approval_consumed");
      return data(consumed, request);
    });

  };
}
