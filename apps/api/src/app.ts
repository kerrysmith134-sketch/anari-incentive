import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import { ZodError, type ZodType } from "zod";
import {
  acceptWorkPackageSchema,
  acceptWorkPackagesBatchSchema,
  addMembershipSchema,
  assignPersonOrgSchema,
  commitWorkPackageSchema,
  createAppealSchema,
  createAttributionDecisionSchema,
  createAttributionDecisionsBatchSchema,
  createCalculationBatchSchema,
  createCalculationRunSchema,
  createContributionClaimSchema,
  createOrgNodeSchema,
  approveAgentActionSchema,
  createEvidenceLinkSchema,
  createDataQualityIssueSchema,
  createEvaluationCycleSchema,
  createNotificationSchema,
  createNoticeSchema,
  createPlatformPersonSchema,
  createRepresentationSchema,
  createConsultationSchema,
  concludeConsultationSchema,
  createDpiaSchema,
  approveDpiaSchema,
  createDsarSchema,
  resolveDsarSchema,
  createRecalculationRequestSchema,
  reviewRecalculationRequestSchema,
  completeRecalculationRequestSchema,
  createRetentionPolicySchema,
  setRetentionLegalHoldSchema,
  createApprovalRequestSchema,
  decideApprovalRequestSchema,
  consumeApprovalRequestSchema,
  recordSettlementExportSchema,
  acknowledgeSettlementExportSchema,
  createBudgetPoolSchema,
  approveBudgetPoolSchema,
  createBudgetAllocationSchema,
  createCashGateInputSchema,
  createFinancialFactSchema,
  createRuleChangeOrderSchema,
  reviewRuleChangeOrderSchema,
  createPolicyTestCaseSchema,
  createPolicyNoticeSchema,
  createMetricDefinitionSchema,
  createDeliverableSchema,
  submitDeliverableSchema,
  recordDeliverableAcceptanceSchema,
  createAiSuggestionLogSchema,
  acceptAiSuggestionSchema,
  createModelEvaluationRunSchema,
  createWorkflowRunSchema,
  finishWorkflowRunSchema,
  createIntegrationConnectionSchema,
  setIntegrationConnectionStatusSchema,
  createSyncRunSchema,
  finishSyncRunSchema,
  upsertExternalIdentitySchema,
  receiveWebhookSchema,
  processWebhookSchema,
  adjustLedgerEntrySchema,
  receiveInboxMessageSchema,
  processInboxMessageSchema,
  createPlatformTenantSchema,
  createPlatformUserSchema,
  createEvaluationDraftSchema,
  dataQualityCommandSchema,
  createEvidenceSchema,
  createRubricSchema,
  createSettlementBatchSchema,
  decideEvaluationDraftSchema,
  createWorkPackageSchema,
  enqueueAgentTaskSchema,
  ingestionBatchSchema,
  linkPersonUserSchema,
  policySimulationSchema,
  publishPolicySchema,
  rejectAgentActionSchema,
  scanAgentTasksSchema,
  lockCalculationRunSchema,
  approveCalculationRunSchema,
  recordAcknowledgementSchema,
  recordConfirmationSchema,
  recordLegalGateSchema,
  rejectWorkPackageSchema,
  resolveAppealSchema,
  reverseLedgerEntrySchema,
  setPersonManagerSchema,
  settlementCommandSchema,
  triageAppealSchema,
} from "@anari/contracts";
import type { CreateCalculationRunInput } from "@anari/contracts";
import {
  InvalidStateTransitionError,
  InvariantViolationError,
  type CalculationRun,
} from "@anari/domain";
import { AgentRuntimeError, type AgentRuntime } from "@anari/agent-runtime";
import { verifyWebhookSignature } from "@anari/connectors";
import {
  AuthError,
  DevHeaderAuthenticator,
  ForbiddenError,
  type Authenticator,
} from "@anari/auth";
import {
  diffPolicyDefinitions,
  formatDecimal,
  parseDecimal,
  sha256,
  simulatePolicyChange,
} from "@anari/policy-dsl";
import { LedgerError } from "@anari/ledger";
import {
  CalculationBlockedError,
  ConflictError,
  NotFoundError,
  Store,
  settlementCsv,
} from "./store.js";
import type { IncentiveStore } from "./store-interface.js";
import { createAgentRuntime } from "./agent.js";
import { ApiMetrics } from "./metrics.js";
import {
  MemoryPlatformStore,
  type PlatformStore,
} from "./platform-store.js";

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

function paramOf(request: FastifyRequest, name: string): string {
  return (request.params as Record<string, string>)[name] ?? "";
}

const employeeUi = readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);

const adminUi = readFileSync(
  new URL("../public/admin.html", import.meta.url),
  "utf8",
);

const governanceUi = readFileSync(
  new URL("../public/governance.html", import.meta.url),
  "utf8",
);

export type StoreResolver = (tenantId: string) => IncentiveStore;
export type AgentRuntimeFactory = (
  store: IncentiveStore,
  tenantId: string,
) => AgentRuntime;

export interface BuildAppOptions {
  /** Action types that must carry a matching approvalRequestId. */
  requiredApprovals?: string[];
  /** HMAC secrets by webhook source name for POST /api/v1/webhooks/:source. */
  webhookSecrets?: Record<string, string>;
  /** Require and reserve an approved budget pool for FORMAL calculations. */
  enforceBudgetPools?: boolean;
}

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

async function notifyBestEffort(
  store: IncentiveStore,
  input: {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
  },
): Promise<void> {
  try {
    await store.createNotification(input);
  } catch (error) {
    console.error("[notification] failed", error);
  }
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

/** Recalculation targets must exist before a request can be recorded. */
async function assertRecalculationTarget(
  store: IncentiveStore,
  targetType: "EVIDENCE" | "ATTRIBUTION" | "EVALUATION" | "LEDGER",
  targetId: string,
): Promise<void> {
  if (targetType === "EVIDENCE") {
    const nodes = await store.listEvidence();
    if (!nodes.some((node) => node.id === targetId)) {
      throw new NotFoundError(`EvidenceNode ${targetId} not found`);
    }
    return;
  }
  if (targetType === "ATTRIBUTION") {
    const decisions = await store.listDecisions();
    if (!decisions.some((decision) => decision.id === targetId)) {
      throw new NotFoundError(`AttributionDecision ${targetId} not found`);
    }
    return;
  }
  if (targetType === "EVALUATION") {
    await store.getEvaluationDecision(targetId);
    return;
  }
  const entries = await store.listLedger();
  if (!entries.some((entry) => entry.id === targetId)) {
    throw new NotFoundError(`LedgerEntry ${targetId} not found`);
  }
}

export function buildApp(
  storeOrResolver: IncentiveStore | StoreResolver = new Store(),
  agentRuntimeOrFactory?: AgentRuntime | AgentRuntimeFactory,
  authenticator: Authenticator = new DevHeaderAuthenticator({
    tenantId: "tenant-demo",
    userId: "dev-user",
    roles: ["admin"],
  }),
  platformStore: PlatformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          employeeCode: "E001",
          displayName: "Sales Lead",
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          employeeCode: "E002",
          displayName: "Product Manager",
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          employeeCode: "E003",
          displayName: "Finance Reviewer",
        },
      ],
    },
  }),
  options: BuildAppOptions = {},
): FastifyInstance {
  const app = Fastify({
    logger: process.env.LOG_LEVEL
      ? { level: process.env.LOG_LEVEL }
      : false,
  });
  const metrics = new ApiMetrics();
  const requiredApprovals = new Set(options.requiredApprovals ?? []);
  const scopedStores = new Map<string, IncentiveStore>();
  const scopedRuntimes = new Map<string, AgentRuntime>();
  let readinessProbe: IncentiveStore | undefined;

  function ensureApproval(
    actionType: string,
    approvalRequestId?: string,
  ): void {
    if (requiredApprovals.has(actionType) && !approvalRequestId) {
      throw new ConflictError(`APPROVAL_REQUIRED: ${actionType}`);
    }
  }

  function countEvent(event: string): void {
    metrics.increment(event);
  }

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

  async function consumeApprovalForAction(
    request: FastifyRequest,
    input: {
      approvalRequestId: string;
      actionType: string;
      targetType: string;
      targetId: string;
    },
  ): Promise<void> {
    const tenantId = tenantOf(request);
    const approval = await platformStore.getApprovalRequest(
      tenantId,
      input.approvalRequestId,
    );
    if (approval.actionType !== input.actionType) {
      throw new ConflictError(
        `APPROVAL_ACTION_MISMATCH: expected ${input.actionType}, got ${approval.actionType}`,
      );
    }
    if (
      approval.targetType !== input.targetType ||
      approval.targetId !== input.targetId
    ) {
      throw new ConflictError(
        `APPROVAL_TARGET_MISMATCH: approval targets ${approval.targetType} ${approval.targetId}`,
      );
    }
    if (approval.status !== "APPROVED") {
      throw new ConflictError(
        `APPROVAL_NOT_READY: ${approval.status}`,
      );
    }
    const decisions = await platformStore.listApprovalDecisions(
      tenantId,
      approval.id,
    );
    const consumedBy = decisions.at(-1)?.approverPersonId;
    if (!consumedBy) {
      throw new ConflictError("APPROVAL_HAS_NO_APPROVER");
    }
    await platformStore.consumeApprovalRequest({
      tenantId,
      requestId: approval.id,
      consumedBy,
    });
  }

  async function preflightBudget(
    request: FastifyRequest,
    input: CreateCalculationRunInput,
  ): Promise<void> {
    if (!options.enforceBudgetPools || input.mode !== "FORMAL") return;
    if (!input.budgetPoolId) {
      throw new ConflictError(
        "BUDGET_POOL_REQUIRED: FORMAL calculations require budgetPoolId",
      );
    }
    const pool = await platformStore.getBudgetPool(
      tenantOf(request),
      input.budgetPoolId,
    );
    if (pool.cycleId !== input.cycleId) {
      throw new ConflictError(
        `BUDGET_POOL_CYCLE_MISMATCH: pool ${pool.id} belongs to ${pool.cycleId}`,
      );
    }
    if (pool.status !== "APPROVED") {
      throw new ConflictError(
        `BUDGET_POOL_NOT_APPROVED: ${pool.status}`,
      );
    }
    const policy = await storeFor(request).getPolicy(input.policyVersionId);
    const base = (parseDecimal(input.order.grossProfit) *
      parseDecimal(policy.poolRate) +
      999_999n) / 1_000_000n;
    const cap = parseDecimal(policy.poolCap);
    const upper = base < cap ? base : cap;
    const available =
      parseDecimal(pool.approvedAmount) -
      parseDecimal(pool.committedAmount);
    if (available < upper) {
      throw new ConflictError(
        `BUDGET_POOL_EXHAUSTED: available ${formatDecimal(
          available,
        )} < required upper bound ${formatDecimal(upper)}`,
      );
    }
  }

  async function reserveRunBudget(
    request: FastifyRequest,
    input: CreateCalculationRunInput,
    run: CalculationRun,
  ): Promise<void> {
    if (
      !options.enforceBudgetPools ||
      input.mode !== "FORMAL" ||
      !input.budgetPoolId
    ) {
      return;
    }
    const total = run.lines.reduce(
      (acc, line) => acc + parseDecimal(line.roundedAmount),
      0n,
    );
    if (total <= 0n) return;
    await platformStore.createBudgetAllocation({
      tenantId: tenantOf(request),
      poolId: input.budgetPoolId,
      targetType: "CALCULATION_RUN",
      targetId: run.id,
      amount: formatDecimal(total),
    });
  }

  app.addHook("preParsing", async (request, _reply, payload) => {
    if (!request.url.startsWith("/api/v1/webhooks/")) return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = raw;
    return Readable.from(raw);
  });

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

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
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

  app.post("/api/v1/data-quality-issues", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createDataQualityIssueSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createDataQualityIssue(body), request));
  });

  app.get("/api/v1/data-quality-issues", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { status?: string };
    return data(
      await storeFor(request).listDataQualityIssues({ status: query.status }),
      request,
    );
  });

  app.get("/api/v1/data-quality-issues/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await storeFor(request).getDataQualityIssue(idOf(request)),
      request,
    );
  });

  app.post("/api/v1/data-quality-issues/:id/commands", async (request) => {
    requireRoles(request, "manager");
    const body = parse(dataQualityCommandSchema, request.body);
    const store = storeFor(request);
    const issue = await store.commandDataQualityIssue(idOf(request), body);
    if (body.command === "ASSIGN" && body.assignedTo) {
      await notifyBestEffort(store, {
        recipientPersonId: body.assignedTo,
        audience: "PERSON",
        title: "Data-quality issue assigned",
        body: `${issue.issueCode} on ${issue.objectType} needs follow-up.`,
        sourceType: "DATA_QUALITY_ISSUE",
        sourceId: issue.id,
      });
    }
    return data(issue, request);
  });

  app.post("/api/v1/evaluation-cycles", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createEvaluationCycleSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createEvaluationCycle(body), request));
  });

  app.get("/api/v1/evaluation-cycles", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await storeFor(request).listEvaluationCycles(), request);
  });

  app.get("/api/v1/evaluation-cycles/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await storeFor(request).getEvaluationCycle(idOf(request)),
      request,
    );
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
    const store = storeFor(request);
    const draft = await store.submitEvaluationDraft(idOf(request));
    await notifyBestEffort(store, {
      audience: "MANAGER",
      title: "Evaluation draft submitted",
      body: `A draft for person ${draft.personId} is ready for review.`,
      sourceType: "EVALUATION_DRAFT",
      sourceId: draft.id,
    });
    return data(draft, request);
  });

  app.post("/api/v1/evaluation-drafts/:id/decision", async (request) => {
    requireRoles(request, "manager");
    const body = parse(decideEvaluationDraftSchema, request.body);
    const store = storeFor(request);
    const result = await store.decideEvaluationDraft(idOf(request), {
      ...body,
      scores: body.scores ?? {},
    });
    await notifyBestEffort(store, {
      recipientPersonId: result.draft.personId,
      audience: "PERSON",
      title:
        result.draft.status === "APPROVED"
          ? "Evaluation approved"
          : "Evaluation draft rejected",
      body: result.decision
        ? `Evaluation decision v${result.decision.decisionVersion} approved.`
        : "Your evaluation draft was rejected; a new draft may be required.",
      sourceType: result.decision ? "EVALUATION_DECISION" : "EVALUATION_DRAFT",
      sourceId: result.decision?.id ?? result.draft.id,
    });
    return data(result, request);
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

  app.get("/api/v1/policy-versions/:id/diff", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { against?: string };
    if (!query.against) {
      throw new ConflictError("DIFF_TARGET_REQUIRED: against query is required");
    }
    const store = storeFor(request);
    const base = await store.getPolicy(idOf(request));
    const target = await store.getPolicy(query.against);
    return data(
      {
        base: {
          policyVersionId: idOf(request),
          code: base.code,
          version: base.version,
        },
        target: {
          policyVersionId: query.against,
          code: target.code,
          version: target.version,
        },
        changes: diffPolicyDefinitions(base, target),
      },
      request,
    );
  });

  app.post("/api/v1/platform/tenants", async (request, reply) => {
    requireRoles(request, "platform_admin");
    const body = parse(createPlatformTenantSchema, request.body);
    return reply
      .status(201)
      .send(data(await platformStore.createTenant(body), request));
  });

  app.get("/api/v1/platform/tenants", async (request) => {
    requireRoles(request, "platform_admin");
    return data(await platformStore.listTenants(), request);
  });

  app.post("/api/v1/platform/users", async (request, reply) => {
    requireRoles(request, "platform_admin");
    const body = parse(createPlatformUserSchema, request.body);
    return reply
      .status(201)
      .send(data(await platformStore.createUser(body), request));
  });

  app.get("/api/v1/platform/users", async (request) => {
    requireRoles(request, "platform_admin");
    return data(await platformStore.listUsers(), request);
  });

  app.post("/api/v1/platform/tenants/:id/memberships", async (request, reply) => {
      requireRoles(request, "platform_admin");
      const body = parse(addMembershipSchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.addMembership({
            tenantId: idOf(request),
            userId: body.userId,
            roleCodes: body.roleCodes,
          }),
          request,
        ),
      );
  });

  app.get("/api/v1/platform/tenants/:id/memberships", async (request) => {
    requireRoles(request, "platform_admin");
    return data(
      await platformStore.listMemberships(idOf(request)),
      request,
    );
  });

  app.post("/api/v1/platform/tenants/:id/persons", async (request, reply) => {
    requireRoles(request, "platform_admin");
    const body = parse(createPlatformPersonSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createPerson({
          tenantId: idOf(request),
          employeeCode: body.employeeCode,
          displayName: body.displayName,
          employmentStatus: body.employmentStatus,
          userId: body.userId,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/platform/tenants/:id/persons", async (request) => {
    requireRoles(request, "platform_admin");
    return data(await platformStore.listPersons(idOf(request)), request);
  });

  app.post("/api/v1/platform/tenants/:id/org-nodes", async (request, reply) => {
    requireRoles(request, "platform_admin");
    const body = parse(createOrgNodeSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createOrgNode({
          tenantId: idOf(request),
          name: body.name,
          nodeType: body.nodeType,
          parentId: body.parentId,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/platform/tenants/:id/org-nodes", async (request) => {
    requireRoles(request, "platform_admin");
    return data(await platformStore.listOrgNodes(idOf(request)), request);
  });

  app.post("/api/v1/platform/tenants/:id/persons/:personId/org-assignments", async (request, reply) => {
    requireRoles(request, "platform_admin");
    const body = parse(assignPersonOrgSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.assignPersonOrg({
          tenantId: idOf(request),
          personId: paramOf(request, "personId"),
          orgNodeId: body.orgNodeId,
          validFrom: body.validFrom,
          validTo: body.validTo,
          allocation: body.allocation,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/platform/tenants/:id/persons/:personId/org-assignments", async (request) => {
    requireRoles(request, "platform_admin");
    return data(
      await platformStore.listOrgAssignments(
        idOf(request),
        paramOf(request, "personId"),
      ),
      request,
    );
  });

  app.post("/api/v1/platform/tenants/:id/persons/:personId/manager", async (request) => {
    requireRoles(request, "platform_admin");
    const body = parse(setPersonManagerSchema, request.body);
    return data(
      await platformStore.setPersonManager({
        tenantId: idOf(request),
        personId: paramOf(request, "personId"),
        managerPersonId: body.managerPersonId,
      }),
      request,
    );
  });

  app.post("/api/v1/platform/tenants/:id/persons/:personId/link-user", async (request) => {
    requireRoles(request, "platform_admin");
    const body = parse(linkPersonUserSchema, request.body);
    return data(
      await platformStore.linkPersonUser({
        tenantId: idOf(request),
        personId: paramOf(request, "personId"),
        userId: body.userId,
      }),
      request,
    );
  });

  app.get("/api/v1/platform/identity", async (request) => {
    const context = request.authContext;
    if (!context) {
      throw new ForbiddenError("authentication is required");
    }
    return data(
      await platformStore.resolveIdentity({
        tenantId: context.tenantId,
        userId: context.userId,
      }),
      request,
    );
  });

  app.post("/api/v1/policy-versions", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(publishPolicySchema, request.body);
    ensureApproval("POLICY_PUBLISH", body.approvalRequestId);
    if (body.approvalRequestId) {
      if (!body.policyVersionId) {
        throw new ConflictError(
          "POLICY_VERSION_ID_REQUIRED: an approval needs a planned policy version id",
        );
      }
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "POLICY_PUBLISH",
        targetType: "POLICY_VERSION",
        targetId: body.policyVersionId,
      });
    }
    const published = await storeFor(request).publishPolicy(body);
    countEvent("policy_published");
    return reply.status(201).send(data(published, request));
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

  app.get("/admin/governance", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(governanceUi),
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
    return data(
      person
        ? evidence.filter((node) => node.submittedBy === person)
        : evidence,
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

  app.get("/api/v1/work-packages/:id/versions", async (request) => {
    const wp = await storeFor(request).getWorkPackage(idOf(request));
    const person = personFilter(request);
    if (
      person &&
      wp.ownerPersonId !== person &&
      !wp.members.some((member) => member.personId === person)
    ) {
      throw new ForbiddenError("work package is not visible to this person");
    }
    return data(
      await storeFor(request).listWorkPackageVersions(idOf(request)),
      request,
    );
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

  app.post("/api/v1/work-packages:accept-batch", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(acceptWorkPackagesBatchSchema, request.body);
    return reply
      .status(200)
      .send(
        data(
          {
            workPackages: await storeFor(request).acceptWorkPackagesBatch(
              body.items,
            ),
          },
          request,
        ),
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

  app.post("/api/v1/attribution-decisions:batch", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createAttributionDecisionsBatchSchema, request.body);
    const decisions = await storeFor(request).createAttributionDecisionsBatch(
      body.items,
    );
    return reply.status(201).send(data({ decisions }, request));
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
    const policyVersionId = idOf(request);
    const tenantId = tenantOf(request);
    ensureApproval("LEGAL_GATE", body.approvalRequestId);
    if (body.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "LEGAL_GATE",
        targetType: "POLICY_VERSION",
        targetId: policyVersionId,
      });
    }
    let democraticProcedureRef = body.democraticProcedureRef;
    if (body.democraticProcedureId) {
      const consultation = await platformStore.getConsultation(
        tenantId,
        body.democraticProcedureId,
      );
      if (consultation.policyVersionId !== policyVersionId) {
        throw new ConflictError(
          `CONSULTATION_POLICY_MISMATCH: consultation ${consultation.id} belongs to policy ${consultation.policyVersionId}`,
        );
      }
      if (!consultation.endedAt || consultation.outcome === "PENDING") {
        throw new ConflictError(
          `CONSULTATION_NOT_CONCLUDED: consultation ${consultation.id} has no concluded outcome`,
        );
      }
      democraticProcedureRef = democraticProcedureRef ?? consultation.id;
    }
    let employeeNoticeRef = body.employeeNoticeRef;
    if (body.employeeNoticeId) {
      const notice = await platformStore.getNotice(
        tenantId,
        body.employeeNoticeId,
      );
      if (notice.policyVersionId && notice.policyVersionId !== policyVersionId) {
        throw new ConflictError(
          `NOTICE_POLICY_MISMATCH: notice ${notice.id} belongs to policy ${notice.policyVersionId}`,
        );
      }
      const coverage = await platformStore.listAcknowledgements(
        tenantId,
        notice.id,
      );
      if (notice.acknowledgementRequired && !coverage.summary.complete) {
        throw new ConflictError(
          `NOTICE_ACKNOWLEDGEMENTS_INCOMPLETE: ${coverage.summary.acknowledgedCount}/${coverage.summary.personCount} acknowledged, ${coverage.summary.declinedCount} declined`,
        );
      }
      employeeNoticeRef = employeeNoticeRef ?? notice.id;
    }
    let dataProtectionAssessmentRef = body.dataProtectionAssessmentRef;
    if (body.dataProtectionAssessmentId) {
      const dpia = await platformStore.getDpia(
        tenantId,
        body.dataProtectionAssessmentId,
      );
      if (dpia.status !== "APPROVED") {
        throw new ConflictError(
          `DPIA_NOT_APPROVED: DPIA ${dpia.id} is ${dpia.status}`,
        );
      }
      dataProtectionAssessmentRef =
        dataProtectionAssessmentRef ?? dpia.id;
    }
    const gate = await storeFor(request).recordLegalGate({
      policyVersionId,
      democraticProcedureRef,
      employeeNoticeRef,
      dataProtectionAssessmentRef,
      minimumWageChecked: body.minimumWageChecked,
      policyApproved: body.policyApproved,
      recordedBy: body.recordedBy,
    });
    countEvent("legal_gate_recorded");
    return data(gate, request);
  });

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

  app.post("/api/v1/policy-consultations", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createConsultationSchema, request.body);
    await storeFor(request).getPolicy(body.policyVersionId);
    return reply.status(201).send(
      data(
        await platformStore.createConsultation({
          tenantId: tenantOf(request),
          policyVersionId: body.policyVersionId,
          representationId: body.representationId,
          consultationType: body.consultationType,
          startedAt: body.startedAt,
          endedAt: body.endedAt,
          minutesRef: body.minutesRef,
          feedbackSummary: body.feedbackSummary,
          outcome: body.outcome ?? "PENDING",
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/policy-consultations", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { policyVersionId?: string };
    return data(
      await platformStore.listConsultations(
        tenantOf(request),
        query.policyVersionId,
      ),
      request,
    );
  });

  app.get("/api/v1/policy-consultations/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getConsultation(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/policy-consultations/:id/conclude", async (request) => {
    requireRoles(request, "admin");
    const body = parse(concludeConsultationSchema, request.body);
    return data(
      await platformStore.concludeConsultation({
        tenantId: tenantOf(request),
        consultationId: idOf(request),
        endedAt: body.endedAt,
        outcome: body.outcome,
        minutesRef: body.minutesRef,
        feedbackSummary: body.feedbackSummary,
      }),
      request,
    );
  });

  app.post("/api/v1/dpia-records", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createDpiaSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createDpia({
          tenantId: tenantOf(request),
          assessmentType: body.assessmentType,
          scope: body.scope,
          riskSummary: body.riskSummary,
          mitigationSummary: body.mitigationSummary,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/dpia-records", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await platformStore.listDpias(tenantOf(request)), request);
  });

  app.get("/api/v1/dpia-records/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getDpia(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/dpia-records/:id/approve", async (request) => {
    requireRoles(request, "admin");
    const body = parse(approveDpiaSchema, request.body);
    return data(
      await platformStore.approveDpia({
        tenantId: tenantOf(request),
        dpiaId: idOf(request),
        approvedBy: body.approvedBy,
      }),
      request,
    );
  });

  app.post("/api/v1/dsar-requests", async (request, reply) => {
    const body = parse(createDsarSchema, request.body);
    const own = ownPersonId(request);
    if (!isPrivileged(request)) {
      if (!own) {
        throw new ForbiddenError(
          "employee identity is required (person_id claim or X-Person-Id)",
        );
      }
      if (body.personId && body.personId !== own) {
        throw new ForbiddenError(
          "an employee cannot create a DSAR for another person",
        );
      }
    }
    const personId = body.personId ?? own;
    if (!personId) {
      throw new ForbiddenError(
        "person identity is required (person_id claim, X-Person-Id or personId)",
      );
    }
    const dsar = await platformStore.createDsar({
      tenantId: tenantOf(request),
      personId,
      requestType: body.requestType,
      dueAt: body.dueAt,
    });
    countEvent("dsar_created");
    return reply.status(201).send(data(dsar, request));
  });

  app.get("/api/v1/dsar-requests", async (request) => {
    const query = request.query as { personId?: string };
    let personId = query.personId;
    if (!isPrivileged(request)) {
      const own = ownPersonId(request);
      if (!own) {
        throw new ForbiddenError(
          "employee identity is required (person_id claim or X-Person-Id)",
        );
      }
      if (personId && personId !== own) {
        throw new ForbiddenError("an employee cannot list another person's DSARs");
      }
      personId = own;
    }
    return data(
      await platformStore.listDsars(tenantOf(request), personId),
      request,
    );
  });

  app.get("/api/v1/dsar-requests/:id", async (request) => {
    const dsar = await platformStore.getDsar(
      tenantOf(request),
      idOf(request),
    );
    if (!isPrivileged(request)) {
      const own = ownPersonId(request);
      if (!own || dsar.personId !== own) {
        throw new ForbiddenError("an employee can only read their own DSARs");
      }
    }
    return data(dsar, request);
  });

  app.post("/api/v1/dsar-requests/:id/resolve", async (request) => {
    requireRoles(request, "admin");
    const body = parse(resolveDsarSchema, request.body);
    const resolved = await platformStore.resolveDsar({
      tenantId: tenantOf(request),
      dsarId: idOf(request),
      resolution: body.resolution,
      resolutionRef: body.resolutionRef,
    });
    countEvent(
      body.resolution === "RESOLVED"
        ? "dsar_resolved"
        : "dsar_rejected",
    );
    return data(resolved, request);
  });

  app.post("/api/v1/retention-policies", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createRetentionPolicySchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createRetentionPolicy({
          tenantId: tenantOf(request),
          dataCategory: body.dataCategory,
          retentionMonths: body.retentionMonths,
          legalBasis: body.legalBasis,
          legalHold: body.legalHold ?? false,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/retention-policies", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listRetentionPolicies(tenantOf(request)),
      request,
    );
  });

  app.get("/api/v1/retention-policies/report", async (request) => {
    requireRoles(request, "manager", "finance");
    const policies = await platformStore.listRetentionPolicies(
      tenantOf(request),
    );
    const today = new Date();
    return data(
      {
        generatedAt: today.toISOString(),
        policies: policies.map((policy) => {
          const cutoff = new Date(today);
          cutoff.setUTCMonth(cutoff.getUTCMonth() - policy.retentionMonths);
          return {
            ...policy,
            cutoffDate: cutoff.toISOString().slice(0, 10),
            eligibleForDisposal: !policy.legalHold,
          };
        }),
      },
      request,
    );
  });

  app.post("/api/v1/retention-policies/:id/legal-hold", async (request) => {
    requireRoles(request, "admin");
    const body = parse(setRetentionLegalHoldSchema, request.body);
    return data(
      await platformStore.setRetentionLegalHold({
        tenantId: tenantOf(request),
        retentionPolicyId: idOf(request),
        legalHold: body.legalHold,
      }),
      request,
    );
  });

  app.post("/api/v1/approval-requests", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createApprovalRequestSchema, request.body);
    const approval = await platformStore.createApprovalRequest({
      tenantId: tenantOf(request),
      actionType: body.actionType,
      targetType: body.targetType,
      targetId: body.targetId,
      targetVersion: body.targetVersion ?? 1,
      requestedByType: body.requestedByType,
      requestedById: body.requestedById,
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
    const consumed = await platformStore.consumeApprovalRequest({
      tenantId: tenantOf(request),
      requestId: idOf(request),
      consumedBy: body.consumedBy,
    });
    countEvent("approval_consumed");
    return data(consumed, request);
  });

  app.post("/api/v1/settlement-batches/:id/exports", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(recordSettlementExportSchema, request.body);
    const batch = await storeFor(request).getSettlementBatch(idOf(request));
    if (
      !["EXPORTED", "ACKNOWLEDGED", "ADJUSTMENT_REQUIRED"].includes(
        batch.status,
      )
    ) {
      throw new ConflictError(
        `SETTLEMENT_BATCH_NOT_EXPORTED: ${batch.status}`,
      );
    }
    const csv = settlementCsv(batch, batch.lines ?? []);
    return reply.status(201).send(
      data(
        await platformStore.createSettlementExport({
          tenantId: tenantOf(request),
          batchId: batch.id,
          exportRef: body.exportRef ?? `EXPORT-${batch.batchNo}-${Date.now()}`,
          exportHash: sha256(csv),
          exportedBy: body.exportedBy,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/settlement-exports", async (request) => {
    requireRoles(request, "finance");
    const query = request.query as { batchId?: string };
    return data(
      await platformStore.listSettlementExports(
        tenantOf(request),
        query.batchId,
      ),
      request,
    );
  });

  app.get("/api/v1/settlement-exports/:id", async (request) => {
    requireRoles(request, "finance");
    return data(
      await platformStore.getSettlementExport(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/settlement-exports/:id/acknowledge", async (request) => {
    requireRoles(request, "finance");
    const body = parse(acknowledgeSettlementExportSchema, request.body);
    return data(
      await platformStore.acknowledgeSettlementExport({
        tenantId: tenantOf(request),
        exportId: idOf(request),
        externalReference: body.externalReference,
        acknowledgedAt: body.acknowledgedAt,
      }),
      request,
    );
  });

  app.post("/api/v1/budget-pools", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(createBudgetPoolSchema, request.body);
    await storeFor(request).getEvaluationCycle(body.cycleId);
    return reply.status(201).send(
      data(
        await platformStore.createBudgetPool({
          tenantId: tenantOf(request),
          cycleId: body.cycleId,
          code: body.code,
          name: body.name,
          poolType: body.poolType,
          currency: body.currency,
          approvedAmount: body.approvedAmount,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/budget-pools", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { cycleId?: string };
    return data(
      await platformStore.listBudgetPools(
        tenantOf(request),
        query.cycleId,
      ),
      request,
    );
  });

  app.get("/api/v1/budget-pools/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getBudgetPool(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/budget-pools/:id/approve", async (request) => {
    requireRoles(request, "finance");
    const body = parse(approveBudgetPoolSchema, request.body);
    return data(
      await platformStore.approveBudgetPool({
        tenantId: tenantOf(request),
        poolId: idOf(request),
        approvedBy: body.approvedBy,
      }),
      request,
    );
  });

  app.post("/api/v1/budget-pools/:id/allocations", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(createBudgetAllocationSchema, request.body);
    const allocation = await platformStore.createBudgetAllocation({
      tenantId: tenantOf(request),
      poolId: idOf(request),
      targetType: body.targetType,
      targetId: body.targetId,
      amount: body.amount,
    });
    countEvent("budget_allocated");
    return reply.status(201).send(data(allocation, request));
  });

  app.get("/api/v1/budget-pools/:id/allocations", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listBudgetAllocations(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/budget-allocations/:id/release", async (request) => {
    requireRoles(request, "finance");
    return data(
      await platformStore.releaseBudgetAllocation({
        tenantId: tenantOf(request),
        allocationId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/cash-gate-inputs", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(createCashGateInputSchema, request.body);
    await storeFor(request).getEvaluationCycle(body.cycleId);
    return reply.status(201).send(
      data(
        await platformStore.createCashGateInput({
          tenantId: tenantOf(request),
          cycleId: body.cycleId,
          asOfDate: body.asOfDate,
          safetyReserveMonths: body.safetyReserveMonths,
          thirteenWeekForecastRef: body.thirteenWeekForecastRef,
          passesGate: body.passesGate,
          approvedBy: body.approvedBy,
          approvedAt: body.approvedAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/cash-gate-inputs", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { cycleId?: string };
    return data(
      await platformStore.listCashGateInputs(
        tenantOf(request),
        query.cycleId,
      ),
      request,
    );
  });

  app.post("/api/v1/financial-facts", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(createFinancialFactSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createFinancialFact({
          tenantId: tenantOf(request),
          sourceSystem: body.sourceSystem,
          sourceRecordId: body.sourceRecordId,
          factType: body.factType,
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          amount: body.amount,
          currency: body.currency,
          qualityStatus: body.qualityStatus ?? "UNVERIFIED",
          sourceUpdatedAt: body.sourceUpdatedAt,
          payload: body.payload ?? {},
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/financial-facts", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      factType?: string;
      sourceSystem?: string;
    };
    return data(
      await platformStore.listFinancialFacts(tenantOf(request), {
        factType: query.factType,
        sourceSystem: query.sourceSystem,
      }),
      request,
    );
  });

  app.post("/api/v1/rule-change-orders", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createRuleChangeOrderSchema, request.body);
    const store = storeFor(request);
    await store.getPolicy(body.toPolicyVersionId);
    if (body.fromPolicyVersionId) {
      await store.getPolicy(body.fromPolicyVersionId);
    }
    return reply.status(201).send(
      data(
        await platformStore.createRuleChangeOrder({
          tenantId: tenantOf(request),
          policyCode: body.policyCode,
          fromPolicyVersionId: body.fromPolicyVersionId,
          toPolicyVersionId: body.toPolicyVersionId,
          changeType: body.changeType,
          reason: body.reason,
          impactSimulation: body.impactSimulation ?? {},
          effectiveFrom: body.effectiveFrom,
          requestedBy: body.requestedBy,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/rule-change-orders", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { policyCode?: string; status?: string };
    return data(
      await platformStore.listRuleChangeOrders(tenantOf(request), {
        policyCode: query.policyCode,
        status: query.status as
          | "DRAFT"
          | "APPROVED"
          | "PUBLICIZED"
          | "REJECTED"
          | undefined,
      }),
      request,
    );
  });

  app.get("/api/v1/rule-change-orders/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getRuleChangeOrder(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/rule-change-orders/:id/approve", async (request) => {
    requireRoles(request, "admin");
    const body = parse(reviewRuleChangeOrderSchema, request.body);
    return data(
      await platformStore.approveRuleChangeOrder({
        tenantId: tenantOf(request),
        orderId: idOf(request),
        approvedBy: body.approvedBy,
      }),
      request,
    );
  });

  app.post("/api/v1/rule-change-orders/:id/reject", async (request) => {
    requireRoles(request, "admin");
    const body = parse(reviewRuleChangeOrderSchema, request.body);
    return data(
      await platformStore.rejectRuleChangeOrder({
        tenantId: tenantOf(request),
        orderId: idOf(request),
        approvedBy: body.approvedBy,
      }),
      request,
    );
  });

  app.post("/api/v1/rule-change-orders/:id/publicize", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.publicizeRuleChangeOrder({
        tenantId: tenantOf(request),
        orderId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/policy-test-cases", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createPolicyTestCaseSchema, request.body);
    await storeFor(request).getPolicy(body.policyVersionId);
    return reply.status(201).send(
      data(
        await platformStore.createPolicyTestCase({
          tenantId: tenantOf(request),
          policyVersionId: body.policyVersionId,
          caseCode: body.caseCode,
          input: body.input,
          expectedOutput: body.expectedOutput,
          category: body.category,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/policy-test-cases", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { policyVersionId?: string };
    return data(
      await platformStore.listPolicyTestCases(
        tenantOf(request),
        query.policyVersionId,
      ),
      request,
    );
  });

  app.post("/api/v1/policy-test-cases/:id/retire", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.retirePolicyTestCase({
        tenantId: tenantOf(request),
        testCaseId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/policy-notices", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createPolicyNoticeSchema, request.body);
    await storeFor(request).getPolicy(body.policyVersionId);
    await platformStore.getNotice(tenantOf(request), body.noticeId);
    return reply.status(201).send(
      data(
        await platformStore.createPolicyNotice({
          tenantId: tenantOf(request),
          policyVersionId: body.policyVersionId,
          noticeId: body.noticeId,
          audience: body.audience ?? {},
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/policy-notices", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { policyVersionId?: string };
    return data(
      await platformStore.listPolicyNotices(
        tenantOf(request),
        query.policyVersionId,
      ),
      request,
    );
  });

  app.post("/api/v1/metric-definitions", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createMetricDefinitionSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createMetricDefinition({
          tenantId: tenantOf(request),
          code: body.code,
          version: body.version,
          name: body.name,
          description: body.description,
          dataType: body.dataType,
          unit: body.unit,
          aggregationMethod: body.aggregationMethod,
          sourceContract: body.sourceContract ?? {},
          effectiveFrom: body.effectiveFrom,
          effectiveTo: body.effectiveTo,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/metric-definitions", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { code?: string; active?: string };
    return data(
      await platformStore.listMetricDefinitions(tenantOf(request), {
        code: query.code,
        active:
          query.active === undefined ? undefined : query.active === "true",
      }),
      request,
    );
  });

  app.post("/api/v1/metric-definitions/:id/retire", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.retireMetricDefinition({
        tenantId: tenantOf(request),
        metricId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/work-packages/:id/deliverables", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createDeliverableSchema, request.body);
    await storeFor(request).getWorkPackage(idOf(request));
    return reply.status(201).send(
      data(
        await platformStore.createDeliverable({
          tenantId: tenantOf(request),
          workPackageId: idOf(request),
          title: body.title,
          deliverableType: body.deliverableType,
          ownerPersonId: body.ownerPersonId,
          dueAt: body.dueAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/work-packages/:id/deliverables", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listDeliverables(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/deliverables/:id/submit", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(submitDeliverableSchema, request.body ?? {});
    return data(
      await platformStore.submitDeliverable({
        tenantId: tenantOf(request),
        deliverableId: idOf(request),
        artifactRef: body.artifactRef,
        contentHash: body.contentHash,
      }),
      request,
    );
  });

  app.post("/api/v1/deliverables/:id/acceptance", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(recordDeliverableAcceptanceSchema, request.body);
    const acceptance = await platformStore.recordDeliverableAcceptance({
      tenantId: tenantOf(request),
      deliverableId: idOf(request),
      decision: body.decision,
      reviewerPersonId: body.reviewerPersonId,
      criteriaResults: body.criteriaResults ?? {},
      comments: body.comments,
    });
    countEvent(
      body.decision === "REJECT"
        ? "deliverable_rejected"
        : "deliverable_accepted",
    );
    return reply.status(201).send(data(acceptance, request));
  });

  app.get("/api/v1/deliverables/:id/acceptances", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listDeliverableAcceptances(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/ai-suggestion-logs", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createAiSuggestionLogSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createAiSuggestion({
          tenantId: tenantOf(request),
          agentTaskId: body.agentTaskId,
          targetType: body.targetType,
          targetId: body.targetId,
          suggestionType: body.suggestionType,
          modelProvider: body.modelProvider,
          modelName: body.modelName,
          promptVersion: body.promptVersion,
          inputHash: body.inputHash,
          outputJson: body.outputJson,
          validationStatus: body.validationStatus,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/ai-suggestion-logs", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      agentTaskId?: string;
      targetType?: string;
    };
    return data(
      await platformStore.listAiSuggestions(tenantOf(request), {
        agentTaskId: query.agentTaskId,
        targetType: query.targetType,
      }),
      request,
    );
  });

  app.post("/api/v1/ai-suggestion-logs/:id/accept", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(acceptAiSuggestionSchema, request.body);
    return data(
      await platformStore.acceptAiSuggestion({
        tenantId: tenantOf(request),
        suggestionId: idOf(request),
        acceptedBy: body.acceptedBy,
      }),
      request,
    );
  });

  app.post("/api/v1/model-evaluation-runs", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createModelEvaluationRunSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createModelEvaluationRun({
          tenantId: tenantOf(request),
          evaluationType: body.evaluationType,
          modelProvider: body.modelProvider,
          modelName: body.modelName,
          promptVersion: body.promptVersion,
          datasetRef: body.datasetRef,
          sampleSize: body.sampleSize,
          metrics: body.metrics ?? {},
          subgroupMetrics: body.subgroupMetrics ?? {},
          passed: body.passed,
          blockers: body.blockers ?? [],
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/model-evaluation-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      evaluationType?: string;
      passed?: string;
    };
    return data(
      await platformStore.listModelEvaluationRuns(tenantOf(request), {
        evaluationType: query.evaluationType,
        passed:
          query.passed === undefined ? undefined : query.passed === "true",
      }),
      request,
    );
  });

  app.get("/api/v1/model-evaluation-runs/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getModelEvaluationRun(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/workflow-runs", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createWorkflowRunSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createWorkflowRun({
          tenantId: tenantOf(request),
          agentTaskId: body.agentTaskId,
          workflowName: body.workflowName,
          workflowVersion: body.workflowVersion,
          status: body.status,
          currentStep: body.currentStep,
          state: body.state ?? {},
          startedAt: body.startedAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/workflow-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { agentTaskId?: string };
    return data(
      await platformStore.listWorkflowRuns(
        tenantOf(request),
        query.agentTaskId,
      ),
      request,
    );
  });

  app.post("/api/v1/workflow-runs/:id/finish", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(finishWorkflowRunSchema, request.body);
    return data(
      await platformStore.finishWorkflowRun({
        tenantId: tenantOf(request),
        workflowRunId: idOf(request),
        status: body.status,
        currentStep: body.currentStep,
      }),
      request,
    );
  });

  app.post("/api/v1/integration-connections", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createIntegrationConnectionSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createIntegrationConnection({
          tenantId: tenantOf(request),
          provider: body.provider,
          connectionName: body.connectionName,
          credentialRef: body.credentialRef,
          config: body.config ?? {},
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listIntegrationConnections(tenantOf(request)),
      request,
    );
  });

  app.get("/api/v1/integration-connections/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getIntegrationConnection(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/integration-connections/:id/status", async (request) => {
    requireRoles(request, "admin");
    const body = parse(setIntegrationConnectionStatusSchema, request.body);
    return data(
      await platformStore.setIntegrationConnectionStatus({
        tenantId: tenantOf(request),
        connectionId: idOf(request),
        status: body.status,
      }),
      request,
    );
  });

  app.post("/api/v1/integration-connections/:id/sync-runs", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createSyncRunSchema, request.body ?? {});
    return reply.status(201).send(
      data(
        await platformStore.createSyncRun({
          tenantId: tenantOf(request),
          connectionId: idOf(request),
          status: body.status ?? "QUEUED",
          cursorBefore: body.cursorBefore,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections/:id/sync-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listSyncRuns(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/sync-runs/:id/finish", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(finishSyncRunSchema, request.body);
    return data(
      await platformStore.finishSyncRun({
        tenantId: tenantOf(request),
        syncRunId: idOf(request),
        status: body.status,
        recordsSeen: body.recordsSeen ?? 0,
        recordsUpserted: body.recordsUpserted ?? 0,
        cursorAfter: body.cursorAfter,
        errorSummary: body.errorSummary,
      }),
      request,
    );
  });

  app.post("/api/v1/external-identities", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(upsertExternalIdentitySchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.upsertExternalIdentity({
          tenantId: tenantOf(request),
          sourceSystem: body.sourceSystem,
          externalId: body.externalId,
          personId: body.personId,
          objectType: body.objectType,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/external-identities", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      sourceSystem?: string;
      objectType?: string;
    };
    return data(
      await platformStore.listExternalIdentities(tenantOf(request), {
        sourceSystem: query.sourceSystem,
        objectType: query.objectType,
      }),
      request,
    );
  });

  app.post("/api/v1/webhook-inbox", async (request, reply) => {
    requireRoles(request, "integration");
    const body = parse(receiveWebhookSchema, request.body);
    const webhook = await platformStore.receiveWebhook({
      tenantId: tenantOf(request),
      sourceSystem: body.sourceSystem,
      messageId: body.messageId,
      payloadHash: body.payloadHash,
    });
    countEvent("webhook_received");
    return reply.status(201).send(data(webhook, request));
  });

  app.get("/api/v1/webhook-inbox", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      status?: string;
      sourceSystem?: string;
    };
    return data(
      await platformStore.listWebhooks(tenantOf(request), {
        status: query.status,
        sourceSystem: query.sourceSystem,
      }),
      request,
    );
  });

  app.post("/api/v1/webhook-inbox/:id/process", async (request) => {
    requireRoles(request, "integration");
    const body = parse(processWebhookSchema, request.body);
    const processed = await platformStore.processWebhook({
      tenantId: tenantOf(request),
      webhookId: idOf(request),
      status: body.status,
      errorCode: body.errorCode,
    });
    countEvent(
      body.status === "PROCESSED"
        ? "webhook_processed"
        : "webhook_failed",
    );
    return data(processed, request);
  });

  app.post("/api/v1/webhooks/:source", async (request, reply) => {
    requireRoles(request, "integration");
    const source = paramOf(request, "source");
    const secret = options.webhookSecrets?.[source];
    if (!secret) {
      throw new NotFoundError(`Webhook source ${source} is not configured`);
    }
    const raw =
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody ??
      Buffer.alloc(0);
    const timestamp = request.headers["x-timestamp"] as string | undefined;
    const valid = verifyWebhookSignature({
      secret,
      payload: raw,
      signature: request.headers["x-signature-256"] as string | undefined,
      timestamp,
      toleranceSeconds: timestamp ? 300 : undefined,
    });
    if (!valid) {
      throw new ConflictError("WEBHOOK_SIGNATURE_INVALID");
    }
    const payload = (request.body ?? {}) as { messageId?: string };
    const messageId =
      (request.headers["x-message-id"] as string | undefined) ??
      payload.messageId ??
      sha256(raw.toString("utf8"));
    const webhook = await platformStore.receiveWebhook({
      tenantId: tenantOf(request),
      sourceSystem: source,
      messageId,
      payloadHash: sha256(raw.toString("utf8")),
    });
    countEvent("webhook_received");
    return reply.status(202).send(data(webhook, request));
  });

  app.post("/api/v1/ledger/:id/adjustments", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(adjustLedgerEntrySchema, request.body);
    ensureApproval("LEDGER_ADJUSTMENT", body.approvalRequestId);
    if (body.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "LEDGER_ADJUSTMENT",
        targetType: "LEDGER_ENTRY",
        targetId: idOf(request),
      });
    }
    const adjustment = await storeFor(request).adjustLedgerEntry(
      idOf(request),
      {
        amount: body.amount,
        reasonCode: body.reasonCode,
        explanation: body.explanation,
        approvedBy: body.approvedBy,
        idempotencyKey: body.idempotencyKey,
      },
    );
    countEvent("ledger_adjustment");
    return reply.status(201).send(data(adjustment, request));
  });

  app.get("/api/v1/adjustment-records", async (request) => {
    requireRoles(request, "finance");
    return data(
      await storeFor(request).listAdjustmentRecords(),
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
    await preflightBudget(request, body);
    const run = await storeFor(request).createCalculationRun(body);
    await reserveRunBudget(request, body, run);
    countEvent("calculation_created");
    return reply.status(201).send(data(run, request));
  });

  app.post("/api/v1/calculation-runs:batch", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(createCalculationBatchSchema, request.body);
    if (
      options.enforceBudgetPools &&
      body.runs.some((run) => run.mode === "FORMAL")
    ) {
      throw new ConflictError(
        "BUDGET_ENFORCEMENT_BATCH_UNSUPPORTED: create formal runs individually when budget enforcement is enabled",
      );
    }
    const runs = await storeFor(request).createCalculationRunsBatch(body.runs);
    countEvent("calculation_batch_created");
    return reply.status(201).send(data({ runs }, request));
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
    const body = parse(approveCalculationRunSchema, request.body ?? {});
    ensureApproval("CALCULATION_APPROVE", body.approvalRequestId);
    if (body.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "CALCULATION_APPROVE",
        targetType: "CALCULATION_RUN",
        targetId: idOf(request),
      });
    }
    const approved = await storeFor(request).approveRun(idOf(request));
    countEvent("calculation_approved");
    return data(approved, request);
  });

  app.post("/api/v1/calculation-runs/:id/lock", async (request) => {
    requireRoles(request, "finance");
    const body = parse(lockCalculationRunSchema, request.body);
    ensureApproval("CALCULATION_LOCK", body.approvalRequestId);
    if (body.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "CALCULATION_LOCK",
        targetType: "CALCULATION_RUN",
        targetId: idOf(request),
      });
    }
    const locked = await storeFor(request).lockRun(idOf(request), body.confirmation);
    countEvent("calculation_locked");
    return data(locked, request);
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
    const store = storeFor(request);
    const confirmation = await store.recordConfirmation(body);
    if (body.decision === "OBJECTED") {
      await notifyBestEffort(store, {
        audience: "MANAGER",
        title: "Employee objection raised",
        body: `Person ${body.personId} objected to ${body.targetType} ${body.targetId}.`,
        sourceType: body.targetType,
        sourceId: body.targetId,
      });
    }
    return reply.status(201).send(data(confirmation, request));
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

  app.get("/api/v1/audit-events/verify", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      { valid: await storeFor(request).verifyAuditChain() },
      request,
    );
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

  app.post("/api/v1/ledger/:id/reverse", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(reverseLedgerEntrySchema, request.body);
    ensureApproval("LEDGER_REVERSAL", body.approvalRequestId);
    if (body.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "LEDGER_REVERSAL",
        targetType: "LEDGER_ENTRY",
        targetId: idOf(request),
      });
    }
    const reversal = await storeFor(request).reverseLedgerEntry(
      idOf(request),
      body,
    );
    countEvent("ledger_reversal");
    return reply.status(201).send(data(reversal, request));
  });

  app.get("/api/v1/ledger/verify", async (request) => {
    requireRoles(request, "manager", "finance");
    return data({ valid: await storeFor(request).verifyLedger() }, request);
  });

  app.post("/api/v1/settlement-batches", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(createSettlementBatchSchema, request.body);
    const store = storeFor(request);
    const batch = await store.createSettlementBatch(body);
    if (batch.kind === "RECOVERY") {
      const lines = await store.listSettlementLines(batch.id);
      const affected = [
        ...new Set(
          lines
            .filter((line) => Number(line.amount) < 0)
            .map((line) => line.personId),
        ),
      ];
      for (const personId of affected) {
        await notifyBestEffort(store, {
          recipientPersonId: personId,
          audience: "PERSON",
          title: "Recovery settlement requires confirmation",
          body: `Batch ${batch.batchNo} contains a negative adjustment; please review and confirm or object.`,
          sourceType: "SETTLEMENT_BATCH",
          sourceId: batch.id,
        });
      }
    }
    return reply.status(201).send(data(batch, request));
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
    const store = storeFor(request);
    if (body.command === "APPROVE" || body.command === "LOCK") {
      const actionType =
        body.command === "APPROVE"
          ? "SETTLEMENT_APPROVE"
          : "SETTLEMENT_LOCK";
      ensureApproval(actionType, body.approvalRequestId);
      if (body.approvalRequestId) {
        await consumeApprovalForAction(request, {
          approvalRequestId: body.approvalRequestId,
          actionType,
          targetType: "SETTLEMENT_BATCH",
          targetId: idOf(request),
        });
      }
    } else if (body.approvalRequestId) {
      throw new ConflictError(
        "APPROVAL_NOT_APPLICABLE: only APPROVE and LOCK consume approvals",
      );
    }
    const result = await store.commandSettlementBatch(idOf(request), body);
    countEvent(`settlement_${body.command.toLowerCase()}`);
    if (body.command === "REQUIRE_ADJUSTMENT") {
      await notifyBestEffort(store, {
        audience: "FINANCE",
        title: "Settlement adjustment required",
        body: body.reason ?? `Batch ${result.batch.batchNo} needs correction.`,
        sourceType: "SETTLEMENT_BATCH",
        sourceId: result.batch.id,
      });
    }
    return data(result, request);
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
      body.approvedBy,
    );
    countEvent("recalculation_approved");
    return data(approved, request);
  });

  app.post("/api/v1/recalculation-requests/:id/reject", async (request) => {
    requireRoles(request, "finance");
    const body = parse(reviewRecalculationRequestSchema, request.body);
    const rejected = await storeFor(request).rejectRecalculationRequest(
      idOf(request),
      body.approvedBy,
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

  return app;
}
