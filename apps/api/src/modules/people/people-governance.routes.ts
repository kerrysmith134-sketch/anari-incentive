/**
 * 人与治理域路由（利益冲突/公平承诺/校准/信任调研/试点/员工代表）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { AssessmentPort, PolicygovPort } from "../../store-ports.js";
import { NotFoundError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  createCalibrationSessionSchema,
  createConflictDeclarationSchema,
  createFairnessCommitmentSchema,
  createManagerTrainingRecordSchema,
  createPilotEnrollmentSchema,
  createRepresentationSchema,
  createTrustSurveySchema,
  revokeConflictDeclarationSchema,
  submitTrustSurveyResponseSchema,
  withdrawPilotEnrollmentSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  personFilter,
  isPrivileged,
  ownPersonId,
} from "../../http-helpers.js";

export function registerPeopleGovernanceRoutes(deps: {
  platformStore: AssessmentPort & PolicygovPort;
}): FastifyPluginAsync {
  const { platformStore } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/conflict-declarations", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createConflictDeclarationSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createConflictDeclaration({
          tenantId: tenantOf(request),
          personId: body.personId,
          relatedPersonId: body.relatedPersonId,
          relationshipType: body.relationshipType,
          description: body.description,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/conflict-declarations", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { personId?: string };
    return data(
      await platformStore.listConflictDeclarations(
        tenantOf(request),
        query.personId,
      ),
      request,
    );
  });

  app.post("/api/v1/conflict-declarations/:id/revoke", async (request) => {
      requireRoles(request, "manager");
      const body = parse(revokeConflictDeclarationSchema, request.body);
      return data(
        await platformStore.revokeConflictDeclaration({
          tenantId: tenantOf(request),
          declarationId: idOf(request),
          reason: body.reason,
        }),
        request,
      );
  });

  app.post("/api/v1/fairness-commitments", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createFairnessCommitmentSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createFairnessCommitment({
          tenantId: tenantOf(request),
          statement: body.statement,
          ownerPersonId: body.ownerPersonId,
          channels: body.channels ?? [],
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/fairness-commitments", async (request) => {
    return data(
      await platformStore.listFairnessCommitments(tenantOf(request)),
      request,
    );
  });
  app.post("/api/v1/manager-training-records", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createManagerTrainingRecordSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createManagerTrainingRecord({
          tenantId: tenantOf(request),
          personId: body.personId,
          trainingCode: body.trainingCode,
          title: body.title,
          completedAt: body.completedAt,
          expiresAt: body.expiresAt,
          evidenceRef: body.evidenceRef,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/manager-training-records", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { personId?: string };
    return data(
      await platformStore.listManagerTrainingRecords(
        tenantOf(request),
        query.personId,
      ),
      request,
    );
  });

  app.post("/api/v1/calibration-sessions", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createCalibrationSessionSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createCalibrationSession({
          tenantId: tenantOf(request),
          code: body.code,
          title: body.title,
          heldAt: body.heldAt,
          facilitatorPersonId: body.facilitatorPersonId,
          attendeePersonIds: body.attendeePersonIds,
          policyVersionId: body.policyVersionId,
          notes: body.notes,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/calibration-sessions", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listCalibrationSessions(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/pilot-enrollments", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createPilotEnrollmentSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createPilotEnrollment({
          tenantId: tenantOf(request),
          personId: body.personId,
          pilotCode: body.pilotCode,
          scope: body.scope,
          consentSignatureRef: body.consentSignatureRef,
          consentSignedAt: body.consentSignedAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/pilot-enrollments", async (request) => {
    const person = personFilter(request);
    return data(
      await platformStore.listPilotEnrollments(
        tenantOf(request),
        person,
      ),
      request,
    );
  });

  app.post("/api/v1/pilot-enrollments/:id/withdraw", async (request) => {
    const body = parse(withdrawPilotEnrollmentSchema, request.body);
    const own = ownPersonId(request);
    const tenantId = tenantOf(request);
    const enrollment = (
      await platformStore.listPilotEnrollments(tenantId)
    ).find((candidate) => candidate.id === idOf(request));
    if (!enrollment) {
      throw new NotFoundError(`PilotEnrollment ${idOf(request)} not found`);
    }
    const requester = own ?? body.personId;
    if (!requester) {
      throw new ForbiddenError(
        "participant identity is required to withdraw",
      );
    }
    if (
      enrollment.personId !== requester &&
      !isPrivileged(request)
    ) {
      throw new ForbiddenError("cannot withdraw another person's enrollment");
    }
    return data(
      await platformStore.withdrawPilotEnrollment({
        tenantId,
        enrollmentId: idOf(request),
        reason: body.reason,
      }),
      request,
    );
  });
  app.post("/api/v1/trust-surveys", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createTrustSurveySchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createTrustSurvey({
          tenantId: tenantOf(request),
          code: body.code,
          period: body.period,
          title: body.title,
          questions: body.questions,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/trust-surveys", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listTrustSurveys(tenantOf(request)),
      request,
    );
  });

  app.get("/api/v1/trust-surveys/:id/report", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getTrustSurveyReport(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.get("/api/v1/trust-surveys/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getTrustSurvey(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/trust-surveys/:id/open", async (request) => {
    requireRoles(request, "manager");
    return data(
      await platformStore.openTrustSurvey({
        tenantId: tenantOf(request),
        surveyId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/trust-surveys/:id/close", async (request) => {
    requireRoles(request, "manager");
    return data(
      await platformStore.closeTrustSurvey({
        tenantId: tenantOf(request),
        surveyId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/trust-surveys/:id/responses", async (request, reply) => {
    const body = parse(submitTrustSurveyResponseSchema, request.body);
    const own = ownPersonId(request);
    const personId = own ?? body.personId;
    if (!personId) {
      throw new ForbiddenError(
        "employee identity is required to submit a trust survey",
      );
    }
    if (own && body.personId && body.personId !== own && !isPrivileged(request)) {
      throw new ForbiddenError("cannot submit for another person");
    }
    return reply.status(201).send(
      data(
        await platformStore.submitTrustSurveyResponse({
          tenantId: tenantOf(request),
          surveyId: idOf(request),
          personId,
          scores: body.scores,
        }),
        request,
      ),
    );
  });
  app.post("/api/v1/employee-representations", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createRepresentationSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createRepresentation({
          tenantId: tenantOf(request),
          ...body,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/employee-representations", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listRepresentations(tenantOf(request)),
      request,
    );
  });
  };
}
