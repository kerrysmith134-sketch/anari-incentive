import { readFileSync } from "node:fs";
import Fastify, {
  type FastifyInstance,
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
  approveAgentActionSchema,
  createEvidenceLinkSchema,
  createEvidenceSchema,
  createSettlementBatchSchema,
  createWorkPackageSchema,
  enqueueAgentTaskSchema,
  ingestionBatchSchema,
  policySimulationSchema,
  publishPolicySchema,
  rejectAgentActionSchema,
  scanAgentTasksSchema,
  lockCalculationRunSchema,
  recordConfirmationSchema,
  recordLegalGateSchema,
  rejectWorkPackageSchema,
  resolveAppealSchema,
  settlementCommandSchema,
  triageAppealSchema,
} from "@anari/contracts";
import {
  InvalidStateTransitionError,
  InvariantViolationError,
} from "@anari/domain";
import { AgentRuntimeError, type AgentRuntime } from "@anari/agent-runtime";
import {
  AuthError,
  DevHeaderAuthenticator,
  type Authenticator,
} from "@anari/auth";
import { simulatePolicyChange } from "@anari/policy-dsl";
import { LedgerError } from "@anari/ledger";
import {
  CalculationBlockedError,
  ConflictError,
  NotFoundError,
  Store,
} from "./store.js";
import type { IncentiveStore } from "./store-interface.js";
import { createAgentRuntime } from "./agent.js";

type IdParams = { id: string };

function data(data: unknown, request: FastifyRequest) {
  return { data, meta: { correlation_id: request.id } };
}

function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details }, meta: {} };
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

function idOf(request: FastifyRequest): string {
  return (request.params as IdParams).id;
}

const employeeUi = readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);

const adminUi = readFileSync(
  new URL("../public/admin.html", import.meta.url),
  "utf8",
);

export type StoreResolver = (tenantId: string) => IncentiveStore;
export type AgentRuntimeFactory = (store: IncentiveStore) => AgentRuntime;

function tenantOf(request: FastifyRequest): string {
  return request.authContext?.tenantId ?? "tenant-demo";
}

export function buildApp(
  storeOrResolver: IncentiveStore | StoreResolver = new Store(),
  agentRuntimeOrFactory?: AgentRuntime | AgentRuntimeFactory,
  authenticator: Authenticator = new DevHeaderAuthenticator({
    tenantId: "tenant-demo",
    userId: "dev-user",
    roles: ["admin"],
  }),
): FastifyInstance {
  const app = Fastify({ logger: false });
  const scopedStores = new Map<string, IncentiveStore>();
  const scopedRuntimes = new Map<string, AgentRuntime>();

  function storeFor(request: FastifyRequest): IncentiveStore {
    if (typeof storeOrResolver !== "function") return storeOrResolver;
    const tenantId = tenantOf(request);
    let scoped = scopedStores.get(tenantId);
    if (!scoped) {
      scoped = storeOrResolver(tenantId);
      scopedStores.set(tenantId, scoped);
    }
    return scoped;
  }

  function runtimeFor(request: FastifyRequest): AgentRuntime {
    if (agentRuntimeOrFactory && typeof agentRuntimeOrFactory !== "function") {
      return agentRuntimeOrFactory;
    }
    const tenantId = tenantOf(request);
    let runtime = scopedRuntimes.get(tenantId);
    if (!runtime) {
      runtime = agentRuntimeOrFactory
        ? agentRuntimeOrFactory(storeFor(request))
        : createAgentRuntime(storeFor(request));
      scopedRuntimes.set(tenantId, runtime);
    }
    return runtime;
  }

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/v1")) return;
    try {
      request.authContext = await authenticator.authenticate({
        authorization: request.headers.authorization,
        tenantId: request.headers["x-tenant-id"] as string | undefined,
        userId: request.headers["x-user-id"] as string | undefined,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.status(401).send({
          ...errorBody(error.code, error.message),
          meta: { correlation_id: request.id },
        });
      }
      throw error;
    }
  });

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
    if (error instanceof AgentRuntimeError) {
      const status = error.code === "AGENT_TASK_NOT_FOUND" ? 404 : 409;
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

  app.post("/api/v1/policy-versions", async (request, reply) => {
    const body = parse(publishPolicySchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).publishPolicy(body), request));
  });

  app.post("/api/v1/policy-simulations", async (request) => {
    const body = parse(policySimulationSchema, request.body);
    const currentPolicy = await storeFor(request).getPolicy(body.currentPolicyVersionId);
    const tenantId =
      request.authContext?.tenantId ??
      (request.headers["x-tenant-id"] as string | undefined) ??
      "tenant-demo";
    const samples = body.samples.map((sample) => ({
      personId: sample.personId,
      input: { ...sample.input, tenantId },
    }));
    return data(
      simulatePolicyChange(currentPolicy, body.proposedPolicy, samples),
      request,
    );
  });

  app.post("/api/v1/agent-tasks/scan", async (request) => {
    const body = parse(scanAgentTasksSchema, request.body ?? {});
    const tenantId =
      request.authContext?.tenantId ??
      (request.headers["x-tenant-id"] as string | undefined) ??
      "tenant-demo";
    const batchKey = body.idempotencyKey ?? `scan-${Date.now()}`;
    const runs = await storeFor(request).listRuns();
    const tasks = [];

    tasks.push(
      await runtimeFor(request).run(
        runtimeFor(request).enqueue({
          tenantId,
          agentType: "EVIDENCE_GAP",
          triggerType: "SCHEDULE",
          idempotencyKey: `${batchKey}:evidence-gap`,
        }).id,
      ),
    );
    tasks.push(
      await runtimeFor(request).run(
        runtimeFor(request).enqueue({
          tenantId,
          agentType: "CONTRIBUTION_ANOMALY",
          triggerType: "SCHEDULE",
          idempotencyKey: `${batchKey}:contribution-anomaly`,
        }).id,
      ),
    );
    for (const run of runs.slice(0, 5)) {
      tasks.push(
        await runtimeFor(request).run(
          runtimeFor(request).enqueue({
            tenantId,
            agentType: "SETTLEMENT_READINESS",
            triggerType: "SCHEDULE",
            input: { runId: run.id },
            idempotencyKey: `${batchKey}:settlement:${run.id}`,
          }).id,
        ),
      );
    }
    return data(tasks, request);
  });

  app.post("/api/v1/agent-tasks", async (request, reply) => {
    const body = parse(enqueueAgentTaskSchema, request.body);
    const tenantId =
      request.authContext?.tenantId ??
      (request.headers["x-tenant-id"] as string | undefined) ??
      "tenant-demo";
    return reply.status(201).send(
      data(
        runtimeFor(request).enqueue({
          tenantId,
          agentType: body.agentType,
          triggerType: body.triggerType,
          triggerRef: body.triggerRef,
          input: body.input,
          idempotencyKey: body.idempotencyKey,
          riskTier: body.riskTier,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/agent-tasks", async (request) =>
    data(runtimeFor(request).list(), request),
  );

  app.get("/api/v1/agent-tasks/:id", async (request) =>
    data(runtimeFor(request).get(idOf(request)), request),
  );

  app.post("/api/v1/agent-tasks/:id/run", async (request) =>
    data(await runtimeFor(request).run(idOf(request)), request),
  );

  app.post("/api/v1/agent-tasks/:id/approve", async (request) => {
    const body = parse(approveAgentActionSchema, request.body);
    return data(
      await runtimeFor(request).approve(
        idOf(request),
        body.actionId,
        body.approverPersonId,
      ),
      request,
    );
  });

  app.post("/api/v1/agent-tasks/:id/reject", async (request) => {
    const body = parse(rejectAgentActionSchema, request.body);
    return data(
      runtimeFor(request).reject(
        idOf(request),
        body.actionId,
        body.approverPersonId,
        body.reason,
      ),
      request,
    );
  });

  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(employeeUi),
  );

  app.get("/admin", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(adminUi),
  );

  app.get("/health", async (request) => data({ status: "ok" }, request));

  app.post("/api/v1/ingestion/events:batch", async (request) => {
    const body = parse(ingestionBatchSchema, request.body);
    return data(await storeFor(request).ingestEvents(body), request);
  });

  app.post("/api/v1/evidence", async (request, reply) => {
    const body = parse(createEvidenceSchema, request.body);
    return reply.status(201).send(data(await storeFor(request).createEvidence(body), request));
  });

  app.get("/api/v1/evidence", async (request) => {
    const query = request.query as {
      subjectType?: string;
      subjectId?: string;
    };
    return data(
      await storeFor(request).listEvidence(query.subjectType, query.subjectId),
      request,
    );
  });

  app.post("/api/v1/evidence/:id/links", async (request, reply) => {
    const body = parse(createEvidenceLinkSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).linkEvidence(idOf(request), body), request));
  });

  app.get("/api/v1/evidence/:id/links", async (request) =>
    data(await storeFor(request).listEvidenceLinks(idOf(request)), request),
  );

  app.post("/api/v1/work-packages", async (request, reply) => {
    const body = parse(createWorkPackageSchema, request.body);
    return reply.status(201).send(data(await storeFor(request).createWorkPackage(body), request));
  });

  app.get("/api/v1/work-packages", async (request) =>
    data(await storeFor(request).listWorkPackages(), request),
  );

  app.get("/api/v1/work-packages/:id", async (request) =>
    data(await storeFor(request).getWorkPackage(idOf(request)), request),
  );

  app.post("/api/v1/work-packages/:id/commit", async (request) => {
    const body = parse(commitWorkPackageSchema, request.body);
    return data(
      await storeFor(request).commitWorkPackage(idOf(request), body.expectedVersion),
      request,
    );
  });

  app.post("/api/v1/work-packages/:id/start", async (request) =>
    data(await storeFor(request).startWorkPackage(idOf(request)), request),
  );

  app.post("/api/v1/work-packages/:id/submit", async (request) =>
    data(await storeFor(request).submitWorkPackage(idOf(request)), request),
  );

  app.post("/api/v1/work-packages/:id/accept", async (request) => {
    const body = parse(acceptWorkPackageSchema, request.body);
    return data(
      await storeFor(request).acceptWorkPackage(idOf(request), body.reviewerPersonId),
      request,
    );
  });

  app.post("/api/v1/work-packages/:id/reject", async (request) => {
    const body = parse(rejectWorkPackageSchema, request.body);
    return data(
      await storeFor(request).rejectWorkPackage(
        idOf(request),
        body.reviewerPersonId,
        body.reason,
      ),
      request,
    );
  });

  app.post("/api/v1/contribution-claims", async (request, reply) => {
    const body = parse(createContributionClaimSchema, request.body);
    return reply.status(201).send(data(await storeFor(request).createClaim(body), request));
  });

  app.get("/api/v1/contribution-claims", async (request) =>
    data(await storeFor(request).listClaims(), request),
  );

  app.get("/api/v1/contribution-claims/:id", async (request) =>
    data(await storeFor(request).getClaim(idOf(request)), request),
  );

  app.post("/api/v1/contribution-claims/:id/submit", async (request) =>
    data(await storeFor(request).submitClaim(idOf(request)), request),
  );

  app.post("/api/v1/attribution-decisions", async (request, reply) => {
    const body = parse(createAttributionDecisionSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createAttributionDecision(body), request));
  });

  app.get("/api/v1/attribution-decisions", async (request) => {
    const query = request.query as { claimId?: string };
    return data(await storeFor(request).listDecisions(query.claimId), request);
  });

  app.post("/api/v1/policy-versions/:id/legal-gate", async (request) => {
    const body = parse(recordLegalGateSchema, request.body);
    return data(
      await storeFor(request).recordLegalGate({
        policyVersionId: idOf(request),
        ...body,
      }),
      request,
    );
  });

  app.get("/api/v1/policy-versions/:id/legal-gate", async (request) => {
    const gate = await storeFor(request).getLegalGate(idOf(request));
    if (!gate) {
      return data({ status: "MISSING", policyVersionId: idOf(request) }, request);
    }
    return data({ status: "RECORDED", gate }, request);
  });

  app.post("/api/v1/calculation-runs", async (request, reply) => {
    const body = parse(createCalculationRunSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createCalculationRun(body), request));
  });

  app.get("/api/v1/calculation-runs", async (request) =>
    data(await storeFor(request).listRuns(), request),
  );

  app.get("/api/v1/calculation-runs/:id", async (request) =>
    data(await storeFor(request).getRun(idOf(request)), request),
  );

  app.post("/api/v1/calculation-runs/:id/approve", async (request) =>
    data(await storeFor(request).approveRun(idOf(request)), request),
  );

  app.post("/api/v1/calculation-runs/:id/lock", async (request) => {
    const body = parse(lockCalculationRunSchema, request.body);
    return data(await storeFor(request).lockRun(idOf(request), body.confirmation), request);
  });

  app.post("/api/v1/employee-confirmations", async (request, reply) => {
    const body = parse(recordConfirmationSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).recordConfirmation(body), request));
  });

  app.get("/api/v1/employee-confirmations", async (request) => {
    const query = request.query as { personId?: string };
    return data(await storeFor(request).listConfirmations(query.personId), request);
  });

  app.get("/api/v1/ledger", async (request) =>
    data(await storeFor(request).listLedger(), request),
  );

  app.get("/api/v1/ledger/verify", async (request) =>
    data({ valid: await storeFor(request).verifyLedger() }, request),
  );

  app.post("/api/v1/settlement-batches", async (request, reply) => {
    const body = parse(createSettlementBatchSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createSettlementBatch(body), request));
  });

  app.get("/api/v1/settlement-batches", async (request) =>
    data(await storeFor(request).listSettlementBatches(), request),
  );

  app.get("/api/v1/settlement-batches/:id", async (request) =>
    data(await storeFor(request).getSettlementBatch(idOf(request)), request),
  );

  app.post("/api/v1/settlement-batches/:id/commands", async (request) => {
    const body = parse(settlementCommandSchema, request.body);
    return data(
      await storeFor(request).commandSettlementBatch(idOf(request), body),
      request,
    );
  });

  app.post("/api/v1/appeals", async (request, reply) => {
    const body = parse(createAppealSchema, request.body);
    return reply.status(201).send(data(await storeFor(request).createAppeal(body), request));
  });

  app.get("/api/v1/appeals", async (request) =>
    data(await storeFor(request).listAppeals(), request),
  );

  app.get("/api/v1/appeals/:id", async (request) =>
    data(await storeFor(request).getAppeal(idOf(request)), request),
  );

  app.post("/api/v1/appeals/:id/triage", async (request) => {
    const body = parse(triageAppealSchema, request.body);
    return data(
      await storeFor(request).triageAppeal(idOf(request), body.reviewerPersonId),
      request,
    );
  });

  app.post("/api/v1/appeals/:id/review", async (request) =>
    data(await storeFor(request).reviewAppeal(idOf(request)), request),
  );

  app.post("/api/v1/appeals/:id/resolve", async (request) => {
    const body = parse(resolveAppealSchema, request.body);
    return data(await storeFor(request).resolveAppeal(idOf(request), body), request);
  });

  return app;
}
