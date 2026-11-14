/**
 * 申诉与重算域路由（NPV2-011 第五片）：
 * 申诉生命周期、证据披露、重算请求。通知为 best-effort。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { DeliveryPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  createAppealEvidenceDisclosureSchema,
  createAppealSchema,
  completeRecalculationRequestSchema,
  createRecalculationRequestSchema,
  resolveAppealSchema,
  reviewRecalculationRequestSchema,
  triageAppealSchema,
} from "@anari/contracts";
import {
  data,
  idOf,
  isPrivileged,
  ownPersonId,
  parse,
  personFilter,
  requireRoles,
  tenantOf,
  requireActor,
  requireActorRequired,
} from "../../http-helpers.js";
import { notifyBestEffort } from "../../notify.js";

export function registerAppealsRoutes(deps: {
  platformStore: DeliveryPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  assertRecalculationTarget: (
    store: IncentiveStore,
    targetType: "EVIDENCE" | "ATTRIBUTION" | "EVALUATION" | "LEDGER",
    targetId: string,
  ) => Promise<void>;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, assertRecalculationTarget } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/appeals", async (request, reply) => {
      const body = parse(createAppealSchema, request.body);
      const person = personFilter(request);
      if (person && body.appellantPersonId !== person) {
        throw new ForbiddenError("cannot file an appeal for another person");
      }
      if (!isPrivileged(request) && !ownPersonId(request)) {
        throw new ForbiddenError("employee identity is required");
      }
      const dueAt =
        body.dueAt ??
        new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      return reply
        .status(201)
        .send(
          data(
            await storeFor(request).createAppeal({ ...body, dueAt }),
            request,
          ),
        );
    });

    app.get("/api/v1/appeals", async (request) => {
      const appeals = await storeFor(request).listAppeals();
      const person = personFilter(request);
      return data(
        person
          ? appeals.filter((appeal) => appeal.appellantPersonId === person)
          : appeals,
        request,
      );
    });

    app.get("/api/v1/appeals/:id", async (request) => {
      const appeal = await storeFor(request).getAppeal(idOf(request));
      const person = personFilter(request);
      if (person && appeal.appellantPersonId !== person) {
        throw new ForbiddenError("appeal is not visible to this person");
      }
      return data(appeal, request);
    });

    app.post("/api/v1/appeals/:id/evidence-disclosures", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const body = parse(createAppealEvidenceDisclosureSchema, request.body);
      const appeal = await storeFor(request).getAppeal(idOf(request));
      if (body.disclosedBy === appeal.appellantPersonId) {
        throw new ConflictError(
          "APPEAL_DISCLOSER_IS_APPELLANT: another person must make the disclosure",
        );
      }
      const allowed = new Set(appeal.evidenceRefs ?? []);
      if (body.evidenceRefs.some((reference) => !allowed.has(reference))) {
        throw new ConflictError(
          "APPEAL_DISCLOSURE_EVIDENCE_NOT_ON_APPEAL",
        );
      }
      const disclosure = await platformStore.createAppealEvidenceDisclosure({
        tenantId: tenantOf(request),
        appealId: appeal.id,
        disclosedBy: body.disclosedBy,
        method: body.method,
        evidenceRefs: body.evidenceRefs,
        note: body.note,
      });
      await notifyBestEffort(storeFor(request), {
        recipientPersonId: appeal.appellantPersonId,
        audience: "PERSON",
        title: "Appeal evidence disclosed",
        body: "The evidence considered in your appeal is now available.",
        sourceType: "APPEAL",
        sourceId: appeal.id,
      });
      return reply.status(201).send(data(disclosure, request));
    });

    app.get("/api/v1/appeals/:id/evidence-disclosures", async (request) => {
      const appeal = await storeFor(request).getAppeal(idOf(request));
      const person = personFilter(request);
      if (person && appeal.appellantPersonId !== person) {
        throw new ForbiddenError("appeal is not visible to this person");
      }
      return data(
        await platformStore.listAppealEvidenceDisclosures(
          tenantOf(request),
          appeal.id,
        ),
        request,
      );
    });

    app.post("/api/v1/appeals/:id/triage", async (request) => {
      requireRoles(request, "manager");
      const body = parse(triageAppealSchema, request.body);
      const store = storeFor(request);
      const appeal = await store.triageAppeal(
        idOf(request),
        body.reviewerPersonId,
      );
      await notifyBestEffort(store, {
        recipientPersonId: appeal.appellantPersonId,
        audience: "PERSON",
        title: "Appeal triaged",
        body: `Your appeal is now ${appeal.status}.`,
        sourceType: "APPEAL",
        sourceId: appeal.id,
      });
      return data(appeal, request);
    });

    app.post("/api/v1/appeals/:id/review", async (request) => {
      requireRoles(request, "manager");
      const store = storeFor(request);
      const appeal = await store.reviewAppeal(idOf(request));
      await notifyBestEffort(store, {
        recipientPersonId: appeal.appellantPersonId,
        audience: "PERSON",
        title: "Appeal under review",
        body: "A reviewer is examining your appeal.",
        sourceType: "APPEAL",
        sourceId: appeal.id,
      });
      return data(appeal, request);
    });

    app.post("/api/v1/appeals/:id/resolve", async (request) => {
      requireRoles(request, "manager");
      const body = parse(resolveAppealSchema, request.body);
      const store = storeFor(request);
      const existing = await store.getAppeal(idOf(request));
      if ((existing.evidenceRefs?.length ?? 0) > 0) {
        const disclosures =
          await platformStore.listAppealEvidenceDisclosures(
            tenantOf(request),
            existing.id,
          );
        if (disclosures.length === 0) {
          throw new ConflictError(
            "APPEAL_EVIDENCE_DISCLOSURE_REQUIRED: disclose the evidence before resolving",
          );
        }
      }
      const appeal = await store.resolveAppeal(idOf(request), body);
      await notifyBestEffort(store, {
        recipientPersonId: appeal.appellantPersonId,
        audience: "PERSON",
        title: "Appeal resolved",
        body: appeal.resolution ?? `Appeal status: ${appeal.status}`,
        sourceType: "APPEAL",
        sourceId: appeal.id,
      });
      return data(appeal, request);
    });

    app.post("/api/v1/recalculation-requests", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const body = parse(createRecalculationRequestSchema, request.body);
      const store = storeFor(request);
      await assertRecalculationTarget(
        store,
        body.targetType,
        body.targetId,
      );
      const recalculation = await store.createRecalculationRequest(body);
      countEvent("recalculation_created");
      return reply.status(201).send(data(recalculation, request));
    });

    app.get("/api/v1/recalculation-requests", async (request) => {
      requireRoles(request, "manager", "finance");
      const query = request.query as {
        status?: string;
        targetType?: string;
      };
      return data(
        await storeFor(request).listRecalculationRequests({
          status: query.status as
            | "OPEN"
            | "APPROVED"
            | "REJECTED"
            | "COMPLETED"
            | undefined,
          targetType: query.targetType as
            | "EVIDENCE"
            | "ATTRIBUTION"
            | "EVALUATION"
            | "LEDGER"
            | undefined,
        }),
        request,
      );
    });

    app.get("/api/v1/recalculation-requests/:id", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await storeFor(request).getRecalculationRequest(idOf(request)),
        request,
      );
    });

    app.post("/api/v1/recalculation-requests/:id/approve", async (request) => {
      requireRoles(request, "finance");
      const body = parse(reviewRecalculationRequestSchema, request.body);
      const approved = await storeFor(request).approveRecalculationRequest(
        idOf(request),
        requireActorRequired(request, body.approvedBy, "approve"),
      );
      countEvent("recalculation_approved");
      return data(approved, request);
    });

    app.post("/api/v1/recalculation-requests/:id/reject", async (request) => {
      requireRoles(request, "finance");
      const body = parse(reviewRecalculationRequestSchema, request.body);
      const rejected = await storeFor(request).rejectRecalculationRequest(
        idOf(request),
        requireActorRequired(request, body.approvedBy, "approve"),
      );
      countEvent("recalculation_rejected");
      return data(rejected, request);
    });

    app.post("/api/v1/recalculation-requests/:id/complete", async (request) => {
      requireRoles(request, "finance");
      const body = parse(completeRecalculationRequestSchema, request.body);
      const store = storeFor(request);
      await store.getRun(body.newCalculationRunId);
      const completed = await store.completeRecalculationRequest(
        idOf(request),
        body.newCalculationRunId,
      );
      countEvent("recalculation_completed");
      return data(completed, request);
    });

  };
}
