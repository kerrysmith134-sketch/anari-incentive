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
  createWorkPackageSchema,
  enqueueAgentTaskSchema,
  rejectAgentActionSchema,
  scanAgentTasksSchema,
  lockCalculationRunSchema,
  recordConfirmationSchema,
  recordLegalGateSchema,
  rejectWorkPackageSchema,
  resolveAppealSchema,
  triageAppealSchema,
} from "@anari/contracts";
import {
  InvalidStateTransitionError,
  InvariantViolationError,
} from "@anari/domain";
import { AgentRuntimeError, type AgentRuntime } from "@anari/agent-runtime";
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

export function buildApp(
  store: IncentiveStore = new Store(),
  agentRuntime: AgentRuntime = createAgentRuntime(store),
): FastifyInstance {
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

  app.post("/api/v1/agent-tasks/scan", async (request) => {
    const body = parse(scanAgentTasksSchema, request.body ?? {});
    const tenantId =
      (request.headers["x-tenant-id"] as string | undefined) ?? "tenant-demo";
    const batchKey = body.idempotencyKey ?? `scan-${Date.now()}`;
    const runs = await store.listRuns();
    const tasks = [];

    tasks.push(
      await agentRuntime.run(
        agentRuntime.enqueue({
          tenantId,
          agentType: "EVIDENCE_GAP",
          triggerType: "SCHEDULE",
          idempotencyKey: `${batchKey}:evidence-gap`,
        }).id,
      ),
    );
    tasks.push(
      await agentRuntime.run(
        agentRuntime.enqueue({
          tenantId,
          agentType: "CONTRIBUTION_ANOMALY",
          triggerType: "SCHEDULE",
          idempotencyKey: `${batchKey}:contribution-anomaly`,
        }).id,
      ),
    );
    for (const run of runs.slice(0, 5)) {
      tasks.push(
        await agentRuntime.run(
          agentRuntime.enqueue({
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
      (request.headers["x-tenant-id"] as string | undefined) ?? "tenant-demo";
    return reply.status(201).send(
      data(
        agentRuntime.enqueue({
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
    data(agentRuntime.list(), request),
  );

  app.get("/api/v1/agent-tasks/:id", async (request) =>
    data(agentRuntime.get(idOf(request)), request),
  );

  app.post("/api/v1/agent-tasks/:id/run", async (request) =>
    data(await agentRuntime.run(idOf(request)), request),
  );

  app.post("/api/v1/agent-tasks/:id/approve", async (request) => {
    const body = parse(approveAgentActionSchema, request.body);
    return data(
      await agentRuntime.approve(
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
      agentRuntime.reject(
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

  app.get("/health", async (request) => data({ status: "ok" }, request));

  app.post("/api/v1/evidence", async (request, reply) => {
    const body = parse(createEvidenceSchema, request.body);
    return reply.status(201).send(data(await store.createEvidence(body), request));
  });

  app.get("/api/v1/evidence", async (request) => {
    const query = request.query as {
      subjectType?: string;
      subjectId?: string;
    };
    return data(
      await store.listEvidence(query.subjectType, query.subjectId),
      request,
    );
  });

  app.post("/api/v1/evidence/:id/links", async (request, reply) => {
    const body = parse(createEvidenceLinkSchema, request.body);
    return reply
      .status(201)
      .send(data(await store.linkEvidence(idOf(request), body), request));
  });

  app.get("/api/v1/evidence/:id/links", async (request) =>
    data(await store.listEvidenceLinks(idOf(request)), request),
  );

  app.post("/api/v1/work-packages", async (request, reply) => {
    const body = parse(createWorkPackageSchema, request.body);
    return reply.status(201).send(data(await store.createWorkPackage(body), request));
  });

  app.get("/api/v1/work-packages", async (request) =>
    data(await store.listWorkPackages(), request),
  );

  app.get("/api/v1/work-packages/:id", async (request) =>
    data(await store.getWorkPackage(idOf(request)), request),
  );

  app.post("/api/v1/work-packages/:id/commit", async (request) => {
    const body = parse(commitWorkPackageSchema, request.body);
    return data(
      await store.commitWorkPackage(idOf(request), body.expectedVersion),
      request,
    );
  });

  app.post("/api/v1/work-packages/:id/start", async (request) =>
    data(await store.startWorkPackage(idOf(request)), request),
  );

  app.post("/api/v1/work-packages/:id/submit", async (request) =>
    data(await store.submitWorkPackage(idOf(request)), request),
  );

  app.post("/api/v1/work-packages/:id/accept", async (request) => {
    const body = parse(acceptWorkPackageSchema, request.body);
    return data(
      await store.acceptWorkPackage(idOf(request), body.reviewerPersonId),
      request,
    );
  });

  app.post("/api/v1/work-packages/:id/reject", async (request) => {
    const body = parse(rejectWorkPackageSchema, request.body);
    return data(
      await store.rejectWorkPackage(
        idOf(request),
        body.reviewerPersonId,
        body.reason,
      ),
      request,
    );
  });

  app.post("/api/v1/contribution-claims", async (request, reply) => {
    const body = parse(createContributionClaimSchema, request.body);
    return reply.status(201).send(data(await store.createClaim(body), request));
  });

  app.post("/api/v1/contribution-claims/:id/submit", async (request) =>
    data(await store.submitClaim(idOf(request)), request),
  );

  app.post("/api/v1/attribution-decisions", async (request, reply) => {
    const body = parse(createAttributionDecisionSchema, request.body);
    return reply
      .status(201)
      .send(data(await store.createAttributionDecision(body), request));
  });

  app.get("/api/v1/attribution-decisions", async (request) => {
    const query = request.query as { claimId?: string };
    return data(await store.listDecisions(query.claimId), request);
  });

  app.post("/api/v1/policy-versions/:id/legal-gate", async (request) => {
    const body = parse(recordLegalGateSchema, request.body);
    return data(
      await store.recordLegalGate({
        policyVersionId: idOf(request),
        ...body,
      }),
      request,
    );
  });

  app.get("/api/v1/policy-versions/:id/legal-gate", async (request) => {
    const gate = await store.getLegalGate(idOf(request));
    if (!gate) {
      return data({ status: "MISSING", policyVersionId: idOf(request) }, request);
    }
    return data({ status: "RECORDED", gate }, request);
  });

  app.post("/api/v1/calculation-runs", async (request, reply) => {
    const body = parse(createCalculationRunSchema, request.body);
    return reply
      .status(201)
      .send(data(await store.createCalculationRun(body), request));
  });

  app.get("/api/v1/calculation-runs", async (request) =>
    data(await store.listRuns(), request),
  );

  app.get("/api/v1/calculation-runs/:id", async (request) =>
    data(await store.getRun(idOf(request)), request),
  );

  app.post("/api/v1/calculation-runs/:id/approve", async (request) =>
    data(await store.approveRun(idOf(request)), request),
  );

  app.post("/api/v1/calculation-runs/:id/lock", async (request) => {
    const body = parse(lockCalculationRunSchema, request.body);
    return data(await store.lockRun(idOf(request), body.confirmation), request);
  });

  app.post("/api/v1/employee-confirmations", async (request, reply) => {
    const body = parse(recordConfirmationSchema, request.body);
    return reply
      .status(201)
      .send(data(await store.recordConfirmation(body), request));
  });

  app.get("/api/v1/employee-confirmations", async (request) => {
    const query = request.query as { personId?: string };
    return data(await store.listConfirmations(query.personId), request);
  });

  app.get("/api/v1/ledger", async (request) =>
    data(await store.listLedger(), request),
  );

  app.get("/api/v1/ledger/verify", async (request) =>
    data({ valid: await store.verifyLedger() }, request),
  );

  app.post("/api/v1/appeals", async (request, reply) => {
    const body = parse(createAppealSchema, request.body);
    return reply.status(201).send(data(await store.createAppeal(body), request));
  });

  app.get("/api/v1/appeals", async (request) =>
    data(await store.listAppeals(), request),
  );

  app.get("/api/v1/appeals/:id", async (request) =>
    data(await store.getAppeal(idOf(request)), request),
  );

  app.post("/api/v1/appeals/:id/triage", async (request) => {
    const body = parse(triageAppealSchema, request.body);
    return data(
      await store.triageAppeal(idOf(request), body.reviewerPersonId),
      request,
    );
  });

  app.post("/api/v1/appeals/:id/review", async (request) =>
    data(await store.reviewAppeal(idOf(request)), request),
  );

  app.post("/api/v1/appeals/:id/resolve", async (request) => {
    const body = parse(resolveAppealSchema, request.body);
    return data(await store.resolveAppeal(idOf(request), body), request);
  });

  return app;
}
