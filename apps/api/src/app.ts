import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { ZodError, type ZodType } from "zod";
import {
  acceptWorkPackageSchema,
  commitWorkPackageSchema,
  createAppealSchema,
  createAttributionDecisionSchema,
  createCalculationRunSchema,
  createContributionClaimSchema,
  createWorkPackageSchema,
  lockCalculationRunSchema,
  rejectWorkPackageSchema,
} from "@anari/contracts";
import {
  InvalidStateTransitionError,
  InvariantViolationError,
} from "@anari/domain";
import { LedgerError } from "@anari/ledger";
import {
  CalculationBlockedError,
  ConflictError,
  NotFoundError,
  Store,
} from "./store.js";

type IdParams = { id: string };

function data(data: unknown, request: FastifyRequest) {
  return { data, meta: { correlation_id: request.id } };
}

function errorBody(
  code: string,
  message: string,
  details?: unknown,
) {
  return { error: { code, message, details }, meta: {} };
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

function idOf(request: FastifyRequest): string {
  return (request.params as IdParams).id;
}

export function buildApp(store: Store = new Store()): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        ...errorBody("VALIDATION_ERROR", "request validation failed", error.issues),
        meta: { correlation_id: request.id },
      });
    }
    if (error instanceof NotFoundError) {
      return reply.status(404).send({
        ...errorBody(error.code, error.message),
        meta: { correlation_id: request.id },
      });
    }
    if (error instanceof InvalidStateTransitionError) {
      return reply.status(409).send({
        ...errorBody(error.code, error.message, {
          objectType: error.objectType,
          from: error.from,
          to: error.to,
        }),
        meta: { correlation_id: request.id },
      });
    }
    if (error instanceof CalculationBlockedError) {
      return reply.status(422).send({
        ...errorBody(error.code, error.message, { blockers: error.blockers }),
        meta: { correlation_id: request.id },
      });
    }
    if (error instanceof InvariantViolationError) {
      return reply.status(422).send({
        ...errorBody(error.code, error.message, {
          invariant: error.invariant,
        }),
        meta: { correlation_id: request.id },
      });
    }
    if (error instanceof LedgerError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "IDEMPOTENCY_KEY_REUSED" ||
              error.code === "DUPLICATE_CALCULATION_LINE"
            ? 409
            : 422;
      return reply.status(status).send({
        ...errorBody(error.code, error.message),
        meta: { correlation_id: request.id },
      });
    }
    if (error instanceof ConflictError) {
      return reply.status(409).send({
        ...errorBody(error.code, error.message),
        meta: { correlation_id: request.id },
      });
    }
    return reply.status(500).send({
      ...errorBody("INTERNAL_ERROR", "internal server error"),
      meta: { correlation_id: request.id },
    });
  });

  app.get("/health", async (request) => data({ status: "ok" }, request));

  app.post("/api/v1/work-packages", async (request, reply) => {
    const body = parse(createWorkPackageSchema, request.body);
    return reply.status(201).send(data(store.createWorkPackage(body), request));
  });

  app.get("/api/v1/work-packages", async (request) =>
    data(store.listWorkPackages(), request),
  );

  app.get("/api/v1/work-packages/:id", async (request) =>
    data(store.getWorkPackage(idOf(request)), request),
  );

  app.post("/api/v1/work-packages/:id/commit", async (request) => {
    const body = parse(commitWorkPackageSchema, request.body);
    return data(
      store.commitWorkPackage(idOf(request), body.expectedVersion),
      request,
    );
  });

  app.post("/api/v1/work-packages/:id/start", async (request) =>
    data(store.startWorkPackage(idOf(request)), request),
  );

  app.post("/api/v1/work-packages/:id/submit", async (request) =>
    data(store.submitWorkPackage(idOf(request)), request),
  );

  app.post("/api/v1/work-packages/:id/accept", async (request) => {
    const body = parse(acceptWorkPackageSchema, request.body);
    return data(
      store.acceptWorkPackage(idOf(request), body.reviewerPersonId),
      request,
    );
  });

  app.post("/api/v1/work-packages/:id/reject", async (request) => {
    const body = parse(rejectWorkPackageSchema, request.body);
    return data(
      store.rejectWorkPackage(
        idOf(request),
        body.reviewerPersonId,
        body.reason,
      ),
      request,
    );
  });

  app.post("/api/v1/contribution-claims", async (request, reply) => {
    const body = parse(createContributionClaimSchema, request.body);
    return reply.status(201).send(data(store.createClaim(body), request));
  });

  app.post("/api/v1/contribution-claims/:id/submit", async (request) =>
    data(store.submitClaim(idOf(request)), request),
  );

  app.post("/api/v1/attribution-decisions", async (request, reply) => {
    const body = parse(createAttributionDecisionSchema, request.body);
    return reply
      .status(201)
      .send(data(store.createAttributionDecision(body), request));
  });

  app.get("/api/v1/attribution-decisions", async (request) => {
    const query = request.query as { claimId?: string };
    return data(store.listDecisions(query.claimId), request);
  });

  app.post("/api/v1/calculation-runs", async (request, reply) => {
    const body = parse(createCalculationRunSchema, request.body);
    return reply
      .status(201)
      .send(data(store.createCalculationRun(body), request));
  });

  app.get("/api/v1/calculation-runs", async (request) =>
    data(store.listRuns(), request),
  );

  app.get("/api/v1/calculation-runs/:id", async (request) =>
    data(store.getRun(idOf(request)), request),
  );

  app.post("/api/v1/calculation-runs/:id/approve", async (request) =>
    data(store.approveRun(idOf(request)), request),
  );

  app.post("/api/v1/calculation-runs/:id/lock", async (request) => {
    const body = parse(lockCalculationRunSchema, request.body);
    return data(store.lockRun(idOf(request), body.confirmation), request);
  });

  app.get("/api/v1/ledger", async (request) =>
    data(store.listLedger(), request),
  );

  app.get("/api/v1/ledger/verify", async (request) =>
    data({ valid: store.verifyLedger() }, request),
  );

  app.post("/api/v1/appeals", async (request, reply) => {
    const body = parse(createAppealSchema, request.body);
    return reply.status(201).send(data(store.createAppeal(body), request));
  });

  app.get("/api/v1/appeals", async (request) =>
    data(store.listAppeals(), request),
  );

  return app;
}
