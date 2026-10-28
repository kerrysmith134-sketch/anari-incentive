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
  createEvaluationDraftSchema,
  createEvidenceSchema,
  createRubricSchema,
  createSettlementBatchSchema,
  decideEvaluationDraftSchema,
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
  type CalculationRun,
} from "@anari/domain";
import { AgentRuntimeError, type AgentRuntime } from "@anari/agent-runtime";
import {
  AuthError,
  DevHeaderAuthenticator,
  ForbiddenError,
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
import { ApiMetrics } from "./metrics.js";

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
export type AgentRuntimeFactory = (
  store: IncentiveStore,
  tenantId: string,
) => AgentRuntime;

function tenantOf(request: FastifyRequest): string {
  return request.authContext?.tenantId ?? "tenant-demo";
}

function requireRoles(request: FastifyRequest, ...allowed: string[]): void {
  const roles = request.authContext?.roles ?? [];
  if (roles.includes("admin") || roles.some((role) => allowed.includes(role))) {
    return;
  }
  throw new ForbiddenError(
    `requires one of: ${allowed.join(", ")} (or admin)`,
  );
}

function isPrivileged(request: FastifyRequest): boolean {
  const roles = request.authContext?.roles ?? [];
  return roles.some((role) =>
    ["admin", "manager", "finance"].includes(role),
  );
}

function ownPersonId(request: FastifyRequest): string | undefined {
  return request.authContext?.personId;
}

/** Employee view of a run: own lines only, no pool trace or order economics. */
function redactRunForPerson(
  run: CalculationRun,
  person: string,
): CalculationRun {
  return {
    ...run,
    inputSnapshot: {
      ...run.inputSnapshot,
      order: {
        id: run.inputSnapshot.order.id,
        grossProfit: "REDACTED",
        currency: run.inputSnapshot.order.currency,
      },
      participants: run.inputSnapshot.participants.filter(
        (participant) => participant.personId === person,
      ),
    },
    lines: run.lines
      .filter((line) => line.personId === person)
      .map((line) => ({ ...line, trace: {} })),
  };
}

/**
 * Employees may only see their own rows and must carry a person identity.
 * Privileged roles see the tenant and get no filter.
 */
function personFilter(request: FastifyRequest): string | undefined {
  if (isPrivileged(request)) return undefined;
  const person = ownPersonId(request);
  if (!person) {
    throw new ForbiddenError(
      "employee identity is required (person_id claim or X-Person-Id)",
    );
  }
  return person;
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
  const metrics = new ApiMetrics();
  const scopedStores = new Map<string, IncentiveStore>();
  const scopedRuntimes = new Map<string, AgentRuntime>();
  let readinessProbe: IncentiveStore | undefined;

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
        ? agentRuntimeOrFactory(storeFor(request), tenantId)
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
        personId: request.headers["x-person-id"] as string | undefined,
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

  app.addHook("onResponse", async (request, reply) => {
    metrics.observeRequest(
      request.method,
      request.routeOptions.url ?? request.url,
      reply.statusCode,
      reply.elapsedTime,
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        ...errorBody("VALIDATION_ERROR", "request validation failed", error.issues),
        meta: { correlation_id: request.id },
      });
    }
    if (error instanceof ForbiddenError) {
      return reply.status(403).send({
        ...errorBody(error.code, error.message),
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
    console.error(`[api] ${request.method} ${request.url} failed`, error);
    return reply.status(500).send({
      ...errorBody("INTERNAL_ERROR", "internal server error"),
      meta: { correlation_id: request.id },
    });
  });

  app.post("/api/v1/rubrics", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createRubricSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createRubric(body), request));
  });

  app.get("/api/v1/rubrics", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await storeFor(request).listRubrics(), request);
  });

  app.post("/api/v1/evaluation-drafts", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createEvaluationDraftSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createEvaluationDraft(body), request));
  });

  app.get("/api/v1/evaluation-drafts", async (request) => {
    const query = request.query as { cycleId?: string; personId?: string };
    const person = personFilter(request);
    return data(
      await storeFor(request).listEvaluationDrafts({
        cycleId: query.cycleId,
        personId: person ?? query.personId,
      }),
      request,
    );
  });

  app.get("/api/v1/evaluation-drafts/:id", async (request) => {
    const draft = await storeFor(request).getEvaluationDraft(idOf(request));
    const person = personFilter(request);
    if (person && draft.personId !== person) {
      throw new ForbiddenError("evaluation draft is not visible to this person");
    }
    return data(draft, request);
  });

  app.post("/api/v1/evaluation-drafts/:id/submit", async (request) => {
    requireRoles(request, "manager");
    return data(
      await storeFor(request).submitEvaluationDraft(idOf(request)),
      request,
    );
  });

  app.post("/api/v1/evaluation-drafts/:id/decision", async (request) => {
    requireRoles(request, "manager");
    const body = parse(decideEvaluationDraftSchema, request.body);
    return data(
      await storeFor(request).decideEvaluationDraft(idOf(request), {
        ...body,
        scores: body.scores ?? {},
      }),
      request,
    );
  });

  app.get("/api/v1/evaluation-decisions", async (request) => {
    const query = request.query as { cycleId?: string; personId?: string };
    const person = personFilter(request);
    return data(
      await storeFor(request).listEvaluationDecisions({
        cycleId: query.cycleId,
        personId: person ?? query.personId,
      }),
      request,
    );
  });

  app.get("/api/v1/evaluation-decisions/:id", async (request) => {
    const decision = await storeFor(request).getEvaluationDecision(
      idOf(request),
    );
    const person = personFilter(request);
    if (person && decision.personId !== person) {
      throw new ForbiddenError(
        "evaluation decision is not visible to this person",
      );
    }
    return data(decision, request);
  });

  app.get("/api/v1/policy-versions", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await storeFor(request).listPolicyVersions(), request);
  });

  app.post("/api/v1/policy-versions", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(publishPolicySchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).publishPolicy(body), request));
  });

  app.post("/api/v1/policy-simulations", async (request) => {
    requireRoles(request, "manager", "finance");
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
    requireRoles(request, "manager");
    const body = parse(scanAgentTasksSchema, request.body ?? {});
    const tenantId =
      request.authContext?.tenantId ??
      (request.headers["x-tenant-id"] as string | undefined) ??
      "tenant-demo";
    const batchKey = body.idempotencyKey ?? `scan-${Date.now()}`;
    const runs = await storeFor(request).listRuns();
    const runtime = runtimeFor(request);
    const tasks = [];

    for (const agentType of ["EVIDENCE_GAP", "CONTRIBUTION_ANOMALY"] as const) {
      const key =
        agentType === "EVIDENCE_GAP" ? "evidence-gap" : "contribution-anomaly";
      const task = await runtime.enqueue({
        tenantId,
        agentType,
        triggerType: "SCHEDULE",
        idempotencyKey: `${batchKey}:${key}`,
      });
      tasks.push(await runtime.run(task.id));
    }
    for (const run of runs.slice(0, 5)) {
      const task = await runtime.enqueue({
        tenantId,
        agentType: "SETTLEMENT_READINESS",
        triggerType: "SCHEDULE",
        input: { runId: run.id },
        idempotencyKey: `${batchKey}:settlement:${run.id}`,
      });
      tasks.push(await runtime.run(task.id));
    }
    return data(tasks, request);
  });

  app.post("/api/v1/agent-tasks", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(enqueueAgentTaskSchema, request.body);
    const tenantId =
      request.authContext?.tenantId ??
      (request.headers["x-tenant-id"] as string | undefined) ??
      "tenant-demo";
    return reply.status(201).send(
      data(
        await runtimeFor(request).enqueue({
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

  app.get("/api/v1/agent-tasks", async (request) => {
    requireRoles(request, "manager");
    return data(await runtimeFor(request).list(), request);
  });

  app.get("/api/v1/agent-tasks/:id", async (request) => {
    requireRoles(request, "manager");
    return data(await runtimeFor(request).get(idOf(request)), request);
  });

  app.post("/api/v1/agent-tasks/:id/run", async (request) => {
    requireRoles(request, "manager");
    return data(await runtimeFor(request).run(idOf(request)), request);
  });

  app.post("/api/v1/agent-tasks/:id/approve", async (request) => {
    const body = parse(approveAgentActionSchema, request.body);
    const runtime = runtimeFor(request);
    const task = await runtime.get(idOf(request));
    const action = task.actions.find(
      (candidate) => candidate.id === body.actionId,
    );
    requireRoles(
      request,
      ...(action?.tool === "publish_policy"
        ? ["admin"]
        : ["manager", "finance"]),
    );
    return data(
      await runtime.approve(
        idOf(request),
        body.actionId,
        body.approverPersonId,
      ),
      request,
    );
  });

  app.post("/api/v1/agent-tasks/:id/reject", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(rejectAgentActionSchema, request.body);
    return data(
      await runtimeFor(request).reject(
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

  app.get("/ready", async (request, reply) => {
    const store =
      typeof storeOrResolver === "function"
        ? (readinessProbe ??= storeOrResolver("tenant-demo"))
        : storeOrResolver;
    try {
      await store.ping?.();
      return data({ status: "ready" }, request);
    } catch {
      return reply
        .status(503)
        .send(errorBody("NOT_READY", "dependency check failed"));
    }
  });

  app.get("/metrics", async (_request, reply) =>
    reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(metrics.render()),
  );

  app.post("/api/v1/ingestion/events:batch", async (request) => {
    requireRoles(request, "integration");
    const body = parse(ingestionBatchSchema, request.body);
    return data(await storeFor(request).ingestEvents(body), request);
  });

  app.post("/api/v1/evidence", async (request, reply) => {
    const body = parse(createEvidenceSchema, request.body);
    return reply.status(201).send(data(await storeFor(request).createEvidence(body), request));
  });

  app.get("/api/v1/evidence", async (request) => {
    requireRoles(request, "manager", "finance");
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

  app.get("/api/v1/evidence/:id/links", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await storeFor(request).listEvidenceLinks(idOf(request)),
      request,
    );
  });

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
    requireRoles(request, "manager");
    const body = parse(acceptWorkPackageSchema, request.body);
    return data(
      await storeFor(request).acceptWorkPackage(idOf(request), body.reviewerPersonId),
      request,
    );
  });

  app.post("/api/v1/work-packages/:id/reject", async (request) => {
    requireRoles(request, "manager");
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
    const person = personFilter(request);
    if (person && body.claimantPersonId !== person) {
      throw new ForbiddenError("cannot file a claim for another person");
    }
    return reply.status(201).send(data(await storeFor(request).createClaim(body), request));
  });

  app.get("/api/v1/contribution-claims", async (request) => {
    const claims = await storeFor(request).listClaims();
    const person = personFilter(request);
    return data(
      person
        ? claims.filter((claim) => claim.claimantPersonId === person)
        : claims,
      request,
    );
  });

  app.get("/api/v1/contribution-claims/:id", async (request) => {
    const claim = await storeFor(request).getClaim(idOf(request));
    const person = personFilter(request);
    if (person && claim.claimantPersonId !== person) {
      throw new ForbiddenError("contribution claim is not visible to this person");
    }
    return data(claim, request);
  });

  app.post("/api/v1/contribution-claims/:id/submit", async (request) =>
    data(await storeFor(request).submitClaim(idOf(request)), request),
  );

  app.post("/api/v1/attribution-decisions", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createAttributionDecisionSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createAttributionDecision(body), request));
  });

  app.get("/api/v1/attribution-decisions", async (request) => {
    const query = request.query as { claimId?: string };
    const person = personFilter(request);
    if (person) {
      const claims = await storeFor(request).listClaims();
      const own = new Set(
        claims
          .filter((claim) => claim.claimantPersonId === person)
          .map((claim) => claim.id),
      );
      if (query.claimId && !own.has(query.claimId)) {
        throw new ForbiddenError("claim is not visible to this person");
      }
      return data(
        (await storeFor(request).listDecisions(query.claimId)).filter(
          (decision) => own.has(decision.claimId),
        ),
        request,
      );
    }
    return data(await storeFor(request).listDecisions(query.claimId), request);
  });

  app.post("/api/v1/policy-versions/:id/legal-gate", async (request) => {
    requireRoles(request, "admin");
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
    requireRoles(request, "manager", "finance");
    const gate = await storeFor(request).getLegalGate(idOf(request));
    if (!gate) {
      return data({ status: "MISSING", policyVersionId: idOf(request) }, request);
    }
    return data({ status: "RECORDED", gate }, request);
  });

  app.post("/api/v1/calculation-runs", async (request, reply) => {
    const body = parse(createCalculationRunSchema, request.body);
    requireRoles(
      request,
      ...(body.mode === "FORMAL" ? ["finance"] : ["manager", "finance"]),
    );
    return reply
      .status(201)
      .send(data(await storeFor(request).createCalculationRun(body), request));
  });

  app.get("/api/v1/calculation-runs", async (request) => {
    const runs = await storeFor(request).listRuns();
    const person = personFilter(request);
    if (!person) return data(runs, request);
    return data(
      runs
        .filter((run) => run.lines.some((line) => line.personId === person))
        .map((run) => redactRunForPerson(run, person)),
      request,
    );
  });

  app.get("/api/v1/calculation-runs/:id", async (request) => {
    const run = await storeFor(request).getRun(idOf(request));
    const person = personFilter(request);
    if (!person) return data(run, request);
    if (!run.lines.some((line) => line.personId === person)) {
      throw new ForbiddenError("calculation run is not visible to this person");
    }
    return data(redactRunForPerson(run, person), request);
  });

  app.post("/api/v1/calculation-runs/:id/approve", async (request) => {
    requireRoles(request, "finance");
    return data(await storeFor(request).approveRun(idOf(request)), request);
  });

  app.post("/api/v1/calculation-runs/:id/lock", async (request) => {
    requireRoles(request, "finance");
    const body = parse(lockCalculationRunSchema, request.body);
    return data(await storeFor(request).lockRun(idOf(request), body.confirmation), request);
  });

  app.post("/api/v1/employee-confirmations", async (request, reply) => {
    const body = parse(recordConfirmationSchema, request.body);
    const person = personFilter(request);
    if (person && body.personId !== person) {
      throw new ForbiddenError("cannot record a confirmation for another person");
    }
    if (!isPrivileged(request) && !ownPersonId(request)) {
      throw new ForbiddenError("employee identity is required");
    }
    return reply
      .status(201)
      .send(data(await storeFor(request).recordConfirmation(body), request));
  });

  app.get("/api/v1/employee-confirmations", async (request) => {
    const query = request.query as { personId?: string };
    const person = personFilter(request);
    if (!isPrivileged(request) && !ownPersonId(request)) {
      throw new ForbiddenError("employee identity is required");
    }
    if (person && query.personId && query.personId !== person) {
      throw new ForbiddenError("cannot read another person's confirmations");
    }
    return data(
      await storeFor(request).listConfirmations(person ?? query.personId),
      request,
    );
  });

  app.get("/api/v1/audit-events", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { limit?: string };
    const parsed = Number(query.limit ?? 100);
    const limit = Number.isFinite(parsed) ? parsed : 100;
    return data(await storeFor(request).listAuditEvents(limit), request);
  });

  app.get("/api/v1/ledger", async (request) => {
    const entries = await storeFor(request).listLedger();
    const person = personFilter(request);
    return data(
      person
        ? entries.filter((entry) => entry.personId === person)
        : entries,
      request,
    );
  });

  app.get("/api/v1/ledger/verify", async (request) => {
    requireRoles(request, "manager", "finance");
    return data({ valid: await storeFor(request).verifyLedger() }, request);
  });

  app.post("/api/v1/settlement-batches", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(createSettlementBatchSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createSettlementBatch(body), request));
  });

  app.get("/api/v1/settlement-batches", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await storeFor(request).listSettlementBatches(), request);
  });

  app.get("/api/v1/settlement-batches/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await storeFor(request).getSettlementBatch(idOf(request)), request);
  });

  app.post("/api/v1/settlement-batches/:id/commands", async (request) => {
    requireRoles(request, "finance");
    const body = parse(settlementCommandSchema, request.body);
    return data(
      await storeFor(request).commandSettlementBatch(idOf(request), body),
      request,
    );
  });

  app.post("/api/v1/appeals", async (request, reply) => {
    const body = parse(createAppealSchema, request.body);
    const person = personFilter(request);
    if (person && body.appellantPersonId !== person) {
      throw new ForbiddenError("cannot file an appeal for another person");
    }
    if (!isPrivileged(request) && !ownPersonId(request)) {
      throw new ForbiddenError("employee identity is required");
    }
    return reply
      .status(201)
      .send(data(await storeFor(request).createAppeal(body), request));
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

  app.post("/api/v1/appeals/:id/triage", async (request) => {
    requireRoles(request, "manager");
    const body = parse(triageAppealSchema, request.body);
    return data(
      await storeFor(request).triageAppeal(idOf(request), body.reviewerPersonId),
      request,
    );
  });

  app.post("/api/v1/appeals/:id/review", async (request) => {
    requireRoles(request, "manager");
    return data(await storeFor(request).reviewAppeal(idOf(request)), request);
  });

  app.post("/api/v1/appeals/:id/resolve", async (request) => {
    requireRoles(request, "manager");
    const body = parse(resolveAppealSchema, request.body);
    return data(await storeFor(request).resolveAppeal(idOf(request), body), request);
  });

  return app;
}
