/**
 * 证据与摄取域路由（NPV2-011 第二片）：
 * 摄取批次、证据登记/查询/关联。行为与拆分前等价。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { IncentiveStore } from "../../store-interface.js";
import {
  createEvidenceLinkSchema,
  createEvidenceSchema,
  ingestionBatchSchema,
} from "@anari/contracts";
import { ConflictError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  findActivityMetricKeys,
  findActivityMonitoringText,
} from "../governance/activity-monitoring.js";
import {
  data,
  idOf,
  ownPersonId,
  parse,
  personFilter,
  requireRoles,
} from "../../http-helpers.js";

export function registerEvidenceRoutes(deps: {
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  fieldPoliciesFor: (
    request: FastifyRequest,
  ) => Promise<Record<string, unknown> | undefined>;
  fieldMatchContextFor: (
    request: FastifyRequest,
    policies: Record<string, unknown> | undefined,
  ) => Promise<unknown>;
  redactResourceFields: (
    record: unknown,
    resourceType: string,
    viewer: {
      personId?: string;
      recordPersonId?: string;
      roles: string[];
      policies?: Record<string, unknown>;
      matchContext?: unknown;
    },
  ) => unknown;
}): FastifyPluginAsync {
  const {
    storeFor,
    countEvent,
    fieldPoliciesFor,
    fieldMatchContextFor,
    redactResourceFields,
  } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/ingestion/events:batch", async (request) => {
      requireRoles(request, "integration");
      const body = parse(ingestionBatchSchema, request.body);
      return data(await storeFor(request).ingestEvents(body), request);
    });

    app.post("/api/v1/evidence", async (request, reply) => {
      const body = parse(createEvidenceSchema, request.body);
      const activityFields = findActivityMetricKeys(body.normalizedPayload);
      if (activityFields.length > 0) {
        throw new ConflictError(
          `DATA_MINIMIZATION_ACTIVITY_BLOCKED:${activityFields.join(",")}`,
        );
      }
      const activityText = findActivityMonitoringText(body.normalizedPayload);
      if (activityText.length > 0) {
        throw new ConflictError(
          `DATA_MINIMIZATION_ACTIVITY_TEXT_BLOCKED:${activityText.join(",")}`,
        );
      }
      const person = personFilter(request);
      if (person && body.submittedBy && body.submittedBy !== person) {
        throw new ForbiddenError("cannot submit evidence as another person");
      }
      if (person) {
        const selfEvidence =
          body.subjectType === "PERSON" && body.subjectId === person;
        if (!selfEvidence) {
          if (body.subjectType !== "WORK_PACKAGE") {
            throw new ForbiddenError(
              "employees may only attach evidence to their own work packages or person",
            );
          }
          const wp = await storeFor(request).getWorkPackage(body.subjectId);
          if (
            wp.ownerPersonId !== person &&
            !wp.members.some((member) => member.personId === person)
          ) {
            throw new ForbiddenError(
              "work package is not visible to this person",
            );
          }
        }
      }
      const submittedBy = person ?? body.submittedBy;
      return reply.status(201).send(
        data(
          await storeFor(request).createEvidence({ ...body, submittedBy }),
          request,
        ),
      );
    });

    app.get("/api/v1/evidence", async (request) => {
      const person = personFilter(request);
      const query = request.query as {
        subjectType?: string;
        subjectId?: string;
      };
      const evidence = await storeFor(request).listEvidence(
        query.subjectType,
        query.subjectId,
      );
      if (person) {
        return data(
          evidence.filter((node) => node.submittedBy === person),
          request,
        );
      }
      const roles = request.authContext?.roles ?? [];
      if (roles.includes("admin")) return data(evidence, request);
      const policies = await fieldPoliciesFor(request);
      const matchContext = await fieldMatchContextFor(request, policies);
      const viewerPersonId = ownPersonId(request);
      return data(
        evidence.map((node) =>
          redactResourceFields(node, "EVIDENCE", {
            personId: viewerPersonId,
            recordPersonId: node.submittedBy,
            roles,
            policies,
            matchContext,
          }),
        ),
        request,
      );
    });

    app.post("/api/v1/evidence/:id/links", async (request, reply) => {
      const body = parse(createEvidenceLinkSchema, request.body);
      return reply
        .status(201)
        .send(data(await storeFor(request).linkEvidence(idOf(request), body), request));
    });

    app.get("/api/v1/evidence/:id/links", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await storeFor(request).listEvidenceLinks(idOf(request)),
        request,
      );
    });


  };
}
