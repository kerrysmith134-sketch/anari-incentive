import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import fastifyStatic from "@fastify/static";
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
  createContributionAttestationSchema,
  withdrawContributionAttestationSchema,
  createConflictDeclarationSchema,
  revokeConflictDeclarationSchema,
  createTrustSurveySchema,
  submitTrustSurveyResponseSchema,
  createFairnessCommitmentSchema,
  createManagerTrainingRecordSchema,
  createCalibrationSessionSchema,
  createPilotEnrollmentSchema,
  withdrawPilotEnrollmentSchema,
  createBreakGlassGrantSchema,
  createClawbackCaseSchema,
  approveClawbackCaseSchema,
  closeClawbackCaseSchema,
  createDiscretionaryPoolReviewSchema,
  createModelProviderPolicySchema,
  createModelEvaluationDatasetSchema,
  createOrgNodeSchema,
  approveAgentActionSchema,
  createEvidenceLinkSchema,
  createDataQualityIssueSchema,
  createEvaluationCycleSchema,
  createNotificationSchema,
  createNoticeSchema,
  createPlatformPersonSchema,
  updateTenantSettingsSchema,
  createRepresentationSchema,
  createConsultationSchema,
  concludeConsultationSchema,
  createDpiaSchema,
  createDataSourceSchema,
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
  createModelPromptSchema,
  activateModelPromptSchema,
  runModelEvaluationSchema,
  createAiScoreProposalSchema,
  decideAiScoreProposalSchema,
  submitAiScoreAuditSchema,
  createWorkflowRunSchema,
  finishWorkflowRunSchema,
  createIntegrationConnectionSchema,
  createIntegrationMappingSchema,
  setIntegrationConnectionStatusSchema,
  createSyncRunSchema,
  createSyncScheduleSchema,
  setSyncScheduleEnabledSchema,
  claimDueSyncSchedulesSchema,
  createEquityGrantSchema,
  createEquityExerciseSchema,
  approveEquityExerciseSchema,
  createBountySchema,
  claimBountySchema,
  submitBountySchema,
  acceptBountySchema,
  createEmploymentContractSchema,
  amendEmploymentContractSchema,
  createAdverseActionSchema,
  reviewAdverseActionSchema,
  approveAdverseActionSchema,
  activateAdverseActionSchema,
  cancelAdverseActionSchema,
  createPayrollRunSchema,
  approvePayrollRunSchema,
  reversePayrollRunSchema,
  calculateCnIitSchema,
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
  workPackageCommandSchema,
  enqueueAgentTaskSchema,
  ingestionBatchSchema,
  linkPersonUserSchema,
  policySimulationSchema,
  publishPolicySchema,
  rollbackPolicySchema,
  cycleReadinessQuerySchema,
  policyReadinessQuerySchema,
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
  assertPolicyApplicability,
  confirmationBlockers,
  legalGateBlockers,
  type CalculationRun,
  type CycleReadinessReport,
  type OperationsCoverageReport,
  type PayrollRun,
  type PolicyReadinessReport,
  type PolicyRollbackResult,
  type PolicyTestSuiteResult,
} from "@anari/domain";
import { AgentRuntimeError, type AgentRuntime } from "@anari/agent-runtime";
import {
  DEFAULT_THRESHOLDS,
  evaluateGate,
  scoreEvidence,
  type EvaluationGate,
} from "@anari/ai-gate";
import { calculateCumulativeIit } from "@anari/payroll-tax";
import {
  FIELD_MAPPING_PRESETS,
  verifyFeishuSignature,
  verifyHubSpotSignature,
  verifyWebhookSignature,
} from "@anari/connectors";
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
  calculatePayroll,
  payrollBankFileCsv,
  payrollCsv,
  payrollPayslipHtml,
} from "./payroll.js";
import { runPolicyTestCase } from "./policy-test-runner.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import type { SpanRecorder } from "./tracing.js";
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

function countByStatus(
  items: Array<{ status: string }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0
    ? 0
    : Math.round((numerator / denominator) * 10_000) / 10_000;
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

const consoleDist = fileURLToPath(
  new URL("../../web/dist/", import.meta.url),
);
const consoleIndexUrl = new URL(
  "../../web/dist/index.html",
  import.meta.url,
);
const consoleBuilt = existsSync(consoleIndexUrl);
const consoleIndex = consoleBuilt
  ? readFileSync(consoleIndexUrl, "utf8")
  : undefined;
const consoleBuildNotice = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>N-Perform Console</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:12vh auto;padding:0 24px;color:#141713;background:#f3f3ee;line-height:1.6}code{background:#eaeae2;padding:2px 6px;border-radius:5px}</style>
</head><body>
<h1>Console build not found</h1>
<p>The API is running, but <code>apps/web/dist</code> has not been built yet.</p>
<p>Run <code>npm run web:build</code> from the repository root, then reload <code>/console/</code>.</p>
<p>For live development, run <code>npm run web:dev</code> and open the Vite URL.</p>
</body></html>`;

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
  /** Signature scheme per webhook source. Defaults to generic HMAC. */
  webhookSchemes?: Record<string, "hmac" | "hubspot" | "feishu">;
  /** Require and reserve an approved budget pool for FORMAL calculations. */
  enforceBudgetPools?: boolean;
  /** Optional trace recorder; the server wires an OTLP exporter. */
  tracer?: SpanRecorder;
  /** Optional per-tenant/IP request limit for /api/v1 routes. */
  rateLimit?: {
    limit: number;
    windowMs?: number;
    now?: () => number;
  };
  /** Maximum request body size in bytes. Defaults to 1 MiB. */
  bodyLimitBytes?: number;
}

class BadRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
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

function assertHarnessEvaluation(evaluation: {
  metrics: Record<string, unknown>;
}): void {
  if (evaluation.metrics.harnessVersion !== "ai-gate-v1") {
    throw new ConflictError(
      "MODEL_EVALUATION_NOT_HARNESS_VERIFIED: evaluation must be produced by the gated evaluation harness",
    );
  }
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

/** Remove sensitive payroll fields for viewers without a finance/admin role. */
export function redactPayrollBankAccounts(
  run: PayrollRun,
  viewer: {
    personId?: string;
    canViewAll: boolean;
    breakGlass: boolean;
  },
): PayrollRun {
  if (viewer.canViewAll || viewer.breakGlass) return run;
  return {
    ...run,
    lines: run.lines?.map((line) =>
      line.personId === viewer.personId
        ? line
        : { ...line, bankAccountRef: undefined },
    ),
  };
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
    bodyLimit: options.bodyLimitBytes ?? 1_048_576,
  });
  if (consoleBuilt) {
    app.register(fastifyStatic, {
      root: consoleDist,
      prefix: "/console/",
      wildcard: false,
    });
  }
  const metrics = new ApiMetrics();
  const limiter = options.rateLimit
    ? new FixedWindowRateLimiter(
        options.rateLimit.limit,
        options.rateLimit.windowMs,
        options.rateLimit.now,
      )
    : undefined;
  const requiredApprovals = new Set(options.requiredApprovals ?? []);
  const scopedStores = new Map<string, IncentiveStore>();
  const scopedRuntimes = new Map<string, AgentRuntime>();
  let readinessProbe: IncentiveStore | undefined;

  async function ensureApproval(
    request: FastifyRequest,
    actionType: string,
    approvalRequestId?: string,
  ): Promise<void> {
    if (approvalRequestId) return;
    let required = requiredApprovals.has(actionType);
    if (!required) {
      try {
        const tenant = await platformStore.getTenant(tenantOf(request));
        const configured = tenant.settings?.requiredApprovals;
        required =
          Array.isArray(configured) && configured.includes(actionType);
      } catch {
        // A platform tenant may not exist in memory-only setups; the
        // environment-level configuration still applies.
      }
    }
    if (required) {
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

  async function assertNoAdjudicatorConflict(
    request: FastifyRequest,
    adjudicatorPersonId: string,
    claimantPersonId: string,
  ): Promise<void> {
    const conflict = await platformStore.findConflictDeclaration(
      tenantOf(request),
      adjudicatorPersonId,
      claimantPersonId,
    );
    if (conflict) {
      throw new ConflictError(
        `ADJUDICATOR_CONFLICT_OF_INTEREST:${conflict.relationshipType}:${conflict.id}`,
      );
    }
  }

  async function assertNoRetroactiveAdjustment(
    request: FastifyRequest,
    ledgerEntryId: string,
  ): Promise<void> {
    const store = storeFor(request);
    const [entries, batches] = await Promise.all([
      store.listLedger(),
      store.listSettlementBatches(),
    ]);
    const entry = entries.find((candidate) => candidate.id === ledgerEntryId);
    if (!entry) return;
    const acknowledged = batches.filter(
      (batch) =>
        batch.cycleId === entry.cycleId &&
        batch.status === "ACKNOWLEDGED",
    );
    if (acknowledged.length > 0) {
      throw new ConflictError(
        `RETROACTIVE_ADJUSTMENT_BLOCKED: cycle ${entry.cycleId} has an acknowledged settlement batch (${acknowledged[0]?.batchNo}); record a correction cycle instead`,
      );
    }
  }

  async function assertRegisteredGoldSet(
    request: FastifyRequest,
    datasetRef: string,
  ): Promise<void> {
    const tenant = await platformStore.getTenant(tenantOf(request));
    const required = Boolean(
      (tenant.settings as { requireRegisteredGoldSet?: unknown })
        .requireRegisteredGoldSet,
    );
    if (!required) return;
    const dataset = await platformStore.getActiveModelEvaluationDataset(
      tenantOf(request),
      datasetRef,
    );
    if (!dataset) {
      throw new ConflictError(
        `GOLD_SET_NOT_REGISTERED: ${datasetRef}`,
      );
    }
  }

  async function assertModelProviderPolicy(
    request: FastifyRequest,
    provider: string,
  ): Promise<void> {
    const tenant = await platformStore.getTenant(tenantOf(request));
    const required = Boolean(
      (tenant.settings as { requireModelProviderPolicy?: unknown })
        .requireModelProviderPolicy,
    );
    if (!required) return;
    const policy = await platformStore.getActiveModelProviderPolicy(
      tenantOf(request),
      provider,
    );
    if (!policy) {
      throw new ConflictError(
        `MODEL_PROVIDER_POLICY_REQUIRED: no active policy for ${provider}`,
      );
    }
    if (!policy.zeroRetentionConfirmed || !policy.dpaRef) {
      throw new ConflictError(
        `MODEL_PROVIDER_POLICY_INCOMPLETE: zero retention and DPA are required for ${provider}`,
      );
    }
    if (policy.egressAllowlist.length === 0) {
      throw new ConflictError(
        `MODEL_PROVIDER_EGRESS_ALLOWLIST_REQUIRED: ${provider}`,
      );
    }
  }

  function exportHeaders(
    request: FastifyRequest,
    csv: string,
    classification: string,
  ): Record<string, string> {
    return {
      "x-export-classification": classification,
      "x-export-watermark": `${tenantOf(request)}:${
        request.authContext?.userId ?? "unknown"
      }:${new Date().toISOString()}`,
      "x-export-hash": sha256(csv),
    };
  }

  async function payrollRunForViewer(
    request: FastifyRequest,
    run: PayrollRun,
  ): Promise<PayrollRun> {
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin") || roles.includes("finance")) return run;
    const personId = ownPersonId(request);
    const breakGlass = personId
      ? Boolean(
          await platformStore.findActiveBreakGlassGrant(
            tenantOf(request),
            personId,
            "PAYROLL_BANK_ACCOUNT",
          ),
        )
      : false;
    return redactPayrollBankAccounts(run, {
      personId,
      canViewAll: false,
      breakGlass,
    });
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

  async function runPolicyTestSuiteFor(
    request: FastifyRequest,
    policyVersionId: string,
  ): Promise<PolicyTestSuiteResult> {
    const policy = await storeFor(request).getPolicy(policyVersionId);
    const cases = await platformStore.listPolicyTestCases(
      tenantOf(request),
      policyVersionId,
    );
    const active = cases.filter(
      (testCase) => testCase.status === "ACTIVE",
    );
    const results = active.map((testCase) =>
      runPolicyTestCase(testCase, policy),
    );
    await Promise.all(
      results.map((result) =>
        platformStore.recordPolicyTestCaseRun({
          tenantId: tenantOf(request),
          testCaseId: result.testCaseId,
          passed: result.passed,
          resultHash: result.resultHash,
        }),
      ),
    );
    const passedCount = results.filter((result) => result.passed).length;
    const run = await platformStore.recordPolicyTestRun({
      tenantId: tenantOf(request),
      policyVersionId,
      runAt: new Date().toISOString(),
      total: active.length,
      passedCount,
      failedCount: active.length - passedCount,
      retiredCount: cases.length - active.length,
      passed: active.length > 0 && passedCount === active.length,
      resultsHash: sha256(results),
      results,
    });
    countEvent("policy_test_suite_run");
    countEvent(
      run.passed ? "policy_test_suite_passed" : "policy_test_suite_failed",
    );
    return {
      runId: run.id,
      runAt: run.runAt,
      policyVersionId: run.policyVersionId,
      total: run.total,
      passedCount: run.passedCount,
      failedCount: run.failedCount,
      retiredCount: run.retiredCount,
      passed: run.passed,
      results: run.results,
    };
  }

  async function requirePolicyTestsBeforeApproval(
    request: FastifyRequest,
    policyVersionId: string,
  ): Promise<void> {
    const tenant = await platformStore.getTenant(tenantOf(request));
    if (tenant.settings?.requirePolicyTestsBeforeApproval !== true) {
      return;
    }
    const suite = await runPolicyTestSuiteFor(request, policyVersionId);
    if (suite.total === 0) {
      throw new ConflictError(
        "POLICY_TESTS_REQUIRED: no ACTIVE test cases for the target policy version",
      );
    }
    if (!suite.passed) {
      const failed = suite.results
        .filter((result) => !result.passed)
        .map((result) => result.caseCode)
        .join(", ");
      throw new ConflictError(
        `POLICY_TESTS_FAILED: ${failed || "suite did not pass"}`,
      );
    }
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

  app.addHook("onRequest", async (request) => {
    if (!options.tracer) return;
    (
      request as FastifyRequest & {
        traceSpan?: { traceId: string; spanId: string; startedAt: number };
      }
    ).traceSpan = {
      traceId: randomBytes(16).toString("hex"),
      spanId: randomBytes(8).toString("hex"),
      startedAt: Date.now(),
    };
  });

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
    if (!limiter) return;
    const context = request.authContext;
    const actor = context?.personId ?? context?.userId ?? request.ip;
    const decision = limiter.check(
      `${context?.tenantId ?? "unknown"}:${actor}`,
    );
    reply.header("x-ratelimit-limit", String(options.rateLimit?.limit ?? 0));
    reply.header("x-ratelimit-remaining", String(decision.remaining));
    if (!decision.allowed) {
      countEvent("rate_limited");
      reply.header("retry-after", String(decision.retryAfterSeconds));
      return reply.status(429).send({
        ...errorBody("RATE_LIMITED", "too many requests"),
        meta: { correlation_id: request.id },
      });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );
    reply.header(
      "content-security-policy",
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; " +
        "object-src 'none'; form-action 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "script-src 'self' 'unsafe-inline'; connect-src 'self'; " +
        "img-src 'self' data:",
    );
    return payload;
  });

  app.addHook("onResponse", async (request, reply) => {
    metrics.observeRequest(
      request.method,
      request.routeOptions.url ?? request.url,
      reply.statusCode,
      reply.elapsedTime,
    );
    const trace = (
      request as FastifyRequest & {
        traceSpan?: { traceId: string; spanId: string; startedAt: number };
      }
    ).traceSpan;
    if (options.tracer && trace) {
      const route = request.routeOptions.url ?? request.url;
      const attributes: Record<string, string | number | boolean> = {
        "http.method": request.method,
        "http.route": route,
        "http.status_code": reply.statusCode,
        "request.id": request.id,
      };
      if (request.authContext?.tenantId) {
        attributes["tenant.id"] = request.authContext.tenantId;
      }
      if (request.authContext?.personId) {
        attributes["person.id"] = request.authContext.personId;
      }
      const body =
        request.body && typeof request.body === "object"
          ? (request.body as Record<string, unknown>)
          : undefined;
      const query =
        request.query && typeof request.query === "object"
          ? (request.query as Record<string, unknown>)
          : undefined;
      const cycleId =
        typeof body?.cycleId === "string"
          ? body.cycleId
          : typeof query?.cycleId === "string"
            ? query.cycleId
            : undefined;
      if (cycleId) attributes["cycle.id"] = cycleId;
      const policyVersionId =
        typeof body?.policyVersionId === "string"
          ? body.policyVersionId
          : typeof query?.policyVersionId === "string"
            ? query.policyVersionId
            : undefined;
      if (policyVersionId) {
        attributes["policy.version_id"] = policyVersionId;
      }
      options.tracer.record({
        traceId: trace.traceId,
        spanId: trace.spanId,
        name: `${request.method} ${route}`,
        startTimeUnixNano: (
          BigInt(trace.startedAt) * 1_000_000n
        ).toString(),
        endTimeUnixNano: (
          BigInt(Date.now()) * 1_000_000n
        ).toString(),
        attributes,
        statusCode: reply.statusCode >= 500 ? 2 : 1,
      });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if ((error as { statusCode?: number }).statusCode === 413) {
      return reply.status(413).send({
        ...errorBody(
          "PAYLOAD_TOO_LARGE",
          "request body exceeds the configured limit",
        ),
        meta: { correlation_id: request.id },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        ...errorBody("VALIDATION_ERROR", "request validation failed", error.issues),
        meta: { correlation_id: request.id },
      });
    }
    if (error instanceof BadRequestError) {
      return reply.status(400).send({
        ...errorBody(error.code, error.message),
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

  app.post("/api/v1/platform/tenants/:id/settings", async (request) => {
    requireRoles(request, "platform_admin");
    const body = parse(updateTenantSettingsSchema, request.body);
    return data(
      await platformStore.updateTenantSettings({
        tenantId: idOf(request),
        settings: body,
      }),
      request,
    );
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
    await ensureApproval(request, "POLICY_PUBLISH", body.approvalRequestId);
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

  app.post("/api/v1/policy-versions/:id/rollback", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(rollbackPolicySchema, request.body);
    await ensureApproval(request, "POLICY_PUBLISH", body.approvalRequestId);
    const store = storeFor(request);
    const source = await store.getPolicyVersion(idOf(request));
    if (body.approvalRequestId) {
      if (!body.newPolicyVersionId) {
        throw new ConflictError(
          "POLICY_VERSION_ID_REQUIRED: an approval needs a planned policy version id",
        );
      }
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "POLICY_PUBLISH",
        targetType: "POLICY_VERSION",
        targetId: body.newPolicyVersionId,
      });
    }
    const versions = await store.listPolicyVersions();
    const nextVersion =
      Math.max(
        0,
        ...versions
          .filter((version) => version.code === source.code)
          .map((version) => version.version),
      ) + 1;
    const applicability = source.applicability;
    assertPolicyApplicability(applicability);
    const published = await store.publishPolicy({
      policy: { ...source.policy, version: nextVersion },
      policyVersionId: body.newPolicyVersionId,
      effectiveFrom: body.effectiveFrom,
      approvedBy: body.approvedBy,
      scope: source.scope,
      applicability,
    });
    countEvent("policy_published");
    const result: PolicyRollbackResult = {
      ...published,
      sourcePolicyVersionId: source.policyVersionId,
    };
    return reply.status(201).send(data(result, request));
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

  app.get("/console", async (_request, reply) =>
    reply.redirect("/console/"),
  );

  if (!consoleBuilt || !consoleIndex) {
    app.get("/console/", async (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(consoleBuildNotice),
    );
    app.get("/console/*", async (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(consoleBuildNotice),
    );
  } else {
    app.get("/console/*", async (request, reply) => {
      if (request.url.startsWith("/console/assets/")) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "console asset not found" },
          meta: {},
        });
      }
      return reply.type("text/html; charset=utf-8").send(consoleIndex);
    });
  }

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

  app.get("/api/v1/reports/cycle-readiness", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = parse(cycleReadinessQuerySchema, request.query);
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [allRuns, confirmations, allBatches, pools] = await Promise.all([
      store.listRuns(),
      store.listConfirmations(),
      store.listSettlementBatches(),
      platformStore.listBudgetPools(tenantId, query.cycleId),
    ]);
    const runs = allRuns.filter(
      (run) => run.cycleId === query.cycleId,
    );
    const relevantRuns = runs.filter((run) => run.status !== "REVERSED");
    const batches = allBatches.filter(
      (batch) => batch.cycleId === query.cycleId,
    );
    const formalPolicyIds = [
      ...new Set(
        relevantRuns
          .filter((run) => run.mode === "FORMAL")
          .map((run) => run.policyVersionId),
      ),
    ];
    const legalGates = await Promise.all(
      formalPolicyIds.map(async (policyVersionId) => {
        const gate = await store.getLegalGate(policyVersionId);
        return {
          policyVersionId,
          recorded: Boolean(gate),
          blockers: legalGateBlockers("FORMAL", gate),
        };
      }),
    );
    const gateByPolicy = new Map(
      legalGates.map((gate) => [gate.policyVersionId, gate]),
    );
    const blockers: string[] = [];
    for (const gate of legalGates) {
      for (const blocker of gate.blockers) {
        blockers.push(`POLICY:${gate.policyVersionId}:${blocker}`);
      }
    }
    const runReports = runs.map((run) => {
      const runBlockers =
        run.status === "REVERSED" ? [] : [...run.blockers];
      if (run.status !== "REVERSED" && run.mode === "FORMAL") {
        runBlockers.push(...confirmationBlockers(run, confirmations));
        runBlockers.push(
          ...(gateByPolicy.get(run.policyVersionId)?.blockers ?? []),
        );
      }
      const unique = [...new Set(runBlockers)];
      for (const blocker of unique) {
        blockers.push(`RUN:${run.id}:${blocker}`);
      }
      return {
        runId: run.id,
        status: run.status,
        mode: run.mode,
        policyVersionId: run.policyVersionId,
        blockers: unique,
      };
    });
    const formalRuns = runs.filter((run) => run.mode === "FORMAL");
    const report: CycleReadinessReport = {
      cycleId: query.cycleId,
      generatedAt: new Date().toISOString(),
      readyForSettlement:
        relevantRuns.some((run) => run.mode === "FORMAL") &&
        blockers.length === 0,
      calculations: {
        total: runs.length,
        byStatus: countByStatus(runs),
        formal: formalRuns.length,
        formalLocked: formalRuns.filter(
          (run) => run.status === "LOCKED",
        ).length,
        runs: runReports,
      },
      legalGates,
      settlement: {
        total: batches.length,
        byStatus: countByStatus(batches),
        exported: batches.filter((batch) => Boolean(batch.exportedAt))
          .length,
        acknowledged: batches.filter((batch) =>
          Boolean(batch.acknowledgedAt),
        ).length,
        batches: batches.map((batch) => ({
          batchId: batch.id,
          status: batch.status,
          kind: batch.kind,
          exportedAt: batch.exportedAt,
          acknowledgedAt: batch.acknowledgedAt,
        })),
      },
      budgets: {
        pools: pools.length,
        approved: pools.filter((pool) => pool.status === "APPROVED")
          .length,
      },
      blockers: [...new Set(blockers)],
    };
    return data(report, request);
  });

  app.get("/api/v1/reports/policy-readiness", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = parse(policyReadinessQuerySchema, request.query);
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [policyVersion, gate, cases, links, consultations, dpias] =
      await Promise.all([
        store.getPolicyVersion(query.policyVersionId),
        store.getLegalGate(query.policyVersionId),
        platformStore.listPolicyTestCases(
          tenantId,
          query.policyVersionId,
        ),
        platformStore.listPolicyNotices(
          tenantId,
          query.policyVersionId,
        ),
        platformStore.listConsultations(
          tenantId,
          query.policyVersionId,
        ),
        platformStore.listDpias(tenantId),
      ]);
    const noticeRows = await Promise.all(
      links.map(async (link) => {
        const overview = await platformStore.listAcknowledgements(
          tenantId,
          link.noticeId,
        );
        return { noticeId: link.noticeId, summary: overview.summary };
      }),
    );
    const activeCases = cases.filter(
      (testCase) => testCase.status === "ACTIVE",
    );
    const passed = activeCases.filter(
      (testCase) => testCase.lastRunPassed === true,
    ).length;
    const failed = activeCases.filter(
      (testCase) => testCase.lastRunPassed === false,
    ).length;
    const notRun = activeCases.filter(
      (testCase) => testCase.lastRunAt === undefined,
    ).length;
    const legalBlockers = legalGateBlockers("FORMAL", gate);
    const blockers = [...legalBlockers];
    if (activeCases.length === 0) {
      blockers.push("NO_ACTIVE_POLICY_TEST_CASES");
    }
    for (const testCase of activeCases) {
      if (!testCase.lastRunAt) {
        blockers.push(`POLICY_TEST_CASE_NOT_RUN:${testCase.caseCode}`);
      } else if (testCase.lastRunPassed === false) {
        blockers.push(`POLICY_TEST_CASE_FAILED:${testCase.caseCode}`);
      }
    }
    const incomplete = noticeRows
      .filter(
        (notice) =>
          notice.summary.acknowledgementRequired &&
          !notice.summary.complete,
      )
      .map((notice) => ({
        noticeId: notice.noticeId,
        acknowledgedCount: notice.summary.acknowledgedCount,
        personCount: notice.summary.personCount,
        pendingCount: notice.summary.pendingCount,
        declinedCount: notice.summary.declinedCount,
      }));
    for (const notice of incomplete) {
      blockers.push(`NOTICE_ACKNOWLEDGEMENTS_INCOMPLETE:${notice.noticeId}`);
    }
    const dpiaRef = gate?.dataProtectionAssessmentRef;
    const dpiaRecord = dpiaRef
      ? dpias.find((dpia) => dpia.id === dpiaRef)
      : undefined;
    if (dpiaRecord && dpiaRecord.status !== "APPROVED") {
      blockers.push(`DPIA_NOT_APPROVED:${dpiaRecord.id}`);
    }
    const concluded = consultations.filter(
      (consultation) =>
        Boolean(consultation.endedAt) &&
        consultation.outcome !== "PENDING",
    );
    const latest = [...concluded].sort((a, b) =>
      (b.endedAt ?? "").localeCompare(a.endedAt ?? ""),
    )[0];
    const report: PolicyReadinessReport = {
      policyVersionId: query.policyVersionId,
      code: policyVersion.code,
      version: policyVersion.version,
      generatedAt: new Date().toISOString(),
      ready: blockers.length === 0,
      legalGate: {
        recorded: Boolean(gate),
        approved: Boolean(gate?.policyApproved),
        blockers: legalBlockers,
      },
      tests: {
        active: activeCases.length,
        passed,
        failed,
        notRun,
        suitePassed:
          activeCases.length > 0 && failed === 0 && notRun === 0,
        cases: activeCases.map((testCase) => ({
          testCaseId: testCase.id,
          caseCode: testCase.caseCode,
          passed: testCase.lastRunPassed,
          lastRunAt: testCase.lastRunAt,
        })),
      },
      notices: {
        linked: links.length,
        acknowledgementRequired: noticeRows.filter(
          (notice) => notice.summary.acknowledgementRequired,
        ).length,
        complete: noticeRows.filter((notice) => notice.summary.complete)
          .length,
        incomplete,
      },
      consultations: {
        total: consultations.length,
        concluded: concluded.length,
        latestOutcome: latest?.outcome,
      },
      dpia: {
        referenced: Boolean(dpiaRef),
        status: dpiaRecord?.status,
        approved: dpiaRecord?.status === "APPROVED",
      },
      blockers: [...new Set(blockers)],
    };
    return data(report, request);
  });

  app.get("/api/v1/reports/team-aggregate", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { managerPersonId?: string };
    const own = ownPersonId(request);
    const managerPersonId = query.managerPersonId ?? own;
    if (!managerPersonId) {
      throw new BadRequestError(
        "MANAGER_REQUIRED",
        "managerPersonId is required when no person is linked to the caller",
      );
    }
    if (!isPrivileged(request) && managerPersonId !== own) {
      throw new ForbiddenError(
        "a manager can only view their own team aggregate",
      );
    }
    const tenantId = tenantOf(request);
    const [
      people,
      decisions,
      attributionDecisions,
      claims,
      appeals,
      workPackages,
    ] = await Promise.all([
      platformStore.listPersons(tenantId),
      storeFor(request).listEvaluationDecisions(),
      storeFor(request).listDecisions(),
      storeFor(request).listClaims(),
      storeFor(request).listAppeals(),
      storeFor(request).listWorkPackages(),
    ]);
    const team = people.filter(
      (person) =>
        person.managerPersonId === managerPersonId &&
        person.id !== managerPersonId,
    );
    const teamIds = new Set(team.map((person) => person.id));
    const minimumGroupSize = 3;
    if (team.length < minimumGroupSize) {
      return data(
        {
          generatedAt: new Date().toISOString(),
          managerPersonId,
          teamSize: team.length,
          suppressed: true,
          minimumGroupSize,
          note: "Team aggregates are suppressed below the minimum group size.",
        },
        request,
      );
    }
    const latestDecisionByPerson = new Map<string, (typeof decisions)[number]>();
    for (const decision of decisions) {
      if (!teamIds.has(decision.personId)) continue;
      if (decision.status !== "APPROVED") continue;
      const current = latestDecisionByPerson.get(decision.personId);
      if (
        !current ||
        decision.decisionVersion > current.decisionVersion
      ) {
        latestDecisionByPerson.set(decision.personId, decision);
      }
    }
    const latestDecisions = [...latestDecisionByPerson.values()];
    const dimensionTotals: Record<string, { total: number; count: number }> = {};
    for (const decision of latestDecisions) {
      for (const [dimension, score] of Object.entries(decision.scores)) {
        dimensionTotals[dimension] ??= { total: 0, count: 0 };
        dimensionTotals[dimension].total += score;
        dimensionTotals[dimension].count += 1;
      }
    }
    const dimensions = Object.fromEntries(
      Object.entries(dimensionTotals).map(([dimension, total]) => [
        dimension,
        Math.round((total.total / total.count) * 100) / 100,
      ]),
    );
    const teamClaims = claims.filter((claim) =>
      teamIds.has(claim.claimantPersonId),
    );
    const claimIds = new Set(teamClaims.map((claim) => claim.id));
    const confirmedClaims = attributionDecisions.filter(
      (decision) =>
        claimIds.has(decision.claimId) &&
        decision.status === "CONFIRMED",
    ).length;
    const teamAppeals = appeals.filter((appeal) =>
      teamIds.has(appeal.appellantPersonId),
    );
    const teamPackages = workPackages.filter(
      (workPackage) =>
        teamIds.has(workPackage.ownerPersonId) ||
        workPackage.members.some((member) => teamIds.has(member.personId)),
    );
    return data(
      {
        generatedAt: new Date().toISOString(),
        managerPersonId,
        teamSize: team.length,
        suppressed: false,
        minimumGroupSize,
        evaluations: {
          evaluated: latestDecisions.length,
          coverage:
            team.length === 0 ? 0 : latestDecisions.length / team.length,
          dimensions,
        },
        claims: {
          total: teamClaims.length,
          confirmed: confirmedClaims,
        },
        appeals: {
          total: teamAppeals.length,
          open: teamAppeals.filter((appeal) => appeal.status !== "CLOSED")
            .length,
        },
        workPackages: {
          total: teamPackages.length,
          accepted: teamPackages.filter(
            (workPackage) => workPackage.status === "ACCEPTED",
          ).length,
        },
      },
      request,
    );
  });

  app.get("/api/v1/reports/policy-review", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { from?: string; to?: string };
    const to = query.to ?? new Date().toISOString();
    const from =
      query.from ??
      new Date(
        new Date(to).getTime() - 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (
      !Number.isFinite(fromMs) ||
      !Number.isFinite(toMs) ||
      fromMs > toMs
    ) {
      throw new BadRequestError(
        "INVALID_REPORT_WINDOW",
        "from/to must be valid ISO dates and from <= to",
      );
    }
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [
      versions,
      notices,
      appeals,
      claims,
      decisions,
      drafts,
      issues,
      dsars,
      dpias,
      proposals,
      modelRuns,
      trustSurveys,
      trainingRecords,
      calibrationSessions,
    ] = await Promise.all([
      store.listPolicyVersions(),
      platformStore.listNotices(tenantId),
      store.listAppeals(),
      store.listClaims(),
      store.listEvaluationDecisions(),
      store.listEvaluationDrafts(),
      store.listDataQualityIssues(),
      platformStore.listDsars(tenantId),
      platformStore.listDpias(tenantId),
      platformStore.listAiScoreProposals(tenantId),
      platformStore.listModelEvaluationRuns(tenantId),
      platformStore.listTrustSurveys(tenantId),
      platformStore.listManagerTrainingRecords(tenantId),
      platformStore.listCalibrationSessions(tenantId),
    ]);
    const noticeCoverage = await Promise.all(
      notices.map((notice) =>
        platformStore.listAcknowledgements(tenantId, notice.id),
      ),
    );
    const published = versions.filter((version) => {
      const timestamp = Date.parse(
        version.publishedAt ?? version.effectiveFrom ?? "",
      );
      return Number.isFinite(timestamp) && timestamp >= fromMs && timestamp <= toMs;
    });
    const inRange = (value: string | undefined): boolean => {
      if (!value) return false;
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) && timestamp >= fromMs && timestamp <= toMs;
    };
    const openAppeals = appeals.filter((appeal) => appeal.status !== "CLOSED");
    const openIssues = issues.filter(
      (issue) =>
        issue.status !== "RESOLVED" &&
        issue.status !== "WAIVED_WITH_APPROVAL",
    );
    const decidedProposals = proposals.filter(
      (proposal) => proposal.status !== "PENDING",
    );
    const latestTrustSurvey = trustSurveys
      .filter((survey) => survey.status === "CLOSED")
      .sort((a, b) =>
        (b.closedAt ?? b.updatedAt).localeCompare(
          a.closedAt ?? a.updatedAt,
        ),
      )[0];
    const trustReport = latestTrustSurvey
      ? await platformStore.getTrustSurveyReport(
          tenantId,
          latestTrustSurvey.id,
        )
      : undefined;
    const acceptedProposals = decidedProposals.filter(
      (proposal) => proposal.status === "ACCEPTED",
    ).length;
    return data(
      {
        from,
        to,
        generatedAt: new Date().toISOString(),
        policies: {
          published: published.length,
          versionsInScope: versions.length,
        },
        notices: {
          total: notices.length,
          complete: noticeCoverage.filter((coverage) => coverage.summary.complete)
            .length,
          incomplete: noticeCoverage.filter(
            (coverage) => !coverage.summary.complete,
          ).length,
        },
        appeals: {
          total: appeals.length,
          open: openAppeals.length,
          overdue: openAppeals.filter(
            (appeal) =>
              Boolean(appeal.dueAt) &&
              new Date(appeal.dueAt as string).getTime() < Date.now(),
          ).length,
          closed: appeals.filter((appeal) => appeal.status === "CLOSED").length,
          outcomes: appeals.reduce<Record<string, number>>((totals, appeal) => {
            if (appeal.resolution) {
              totals[appeal.resolution] = (totals[appeal.resolution] ?? 0) + 1;
            }
            return totals;
          }, {}),
        },
        claims: {
          total: claims.length,
          decided: decisions.filter((decision) => inRange(decision.createdAt))
            .length,
        },
        evaluations: {
          drafts: drafts.length,
          decisions: decisions.length,
        },
        aiReview: {
          total: proposals.length,
          decided: decidedProposals.length,
          accepted: acceptedProposals,
          acceptanceRate:
            decidedProposals.length === 0
              ? 0
              : acceptedProposals / decidedProposals.length,
          overrides: decidedProposals.filter(
            (proposal) => proposal.override,
          ).length,
          blindReviews: decidedProposals.filter(
            (proposal) => proposal.blindReview,
          ).length,
          harnessEvaluations: modelRuns.filter(
            (run) => run.metrics.harnessVersion === "ai-gate-v1",
          ).length,
        },
        dataQuality: {
          total: issues.length,
          open: openIssues.length,
          overdue: openIssues.filter(
            (issue) =>
              Boolean(issue.dueAt) &&
              new Date(issue.dueAt as string).getTime() < Date.now(),
          ).length,
          escalated: issues.filter((issue) => Boolean(issue.escalatedAt)).length,
        },
        privacy: {
          dsars: dsars.length,
          openDsars: dsars.filter((request) => request.status === "OPEN").length,
          dpias: dpias.length,
          approvedDpias: dpias.filter((record) => record.status === "APPROVED")
            .length,
        },
        managerEnablement: {
          trainingRecords: trainingRecords.length,
          calibrationSessions: calibrationSessions.length,
        },
        trustSurvey: trustReport
          ? {
              available: true,
              surveyId: trustReport.survey.id,
              period: trustReport.survey.period,
              responseCount: trustReport.responseCount,
              dimensions: trustReport.dimensions,
              baseline: trustReport.baseline,
            }
          : {
              available: false,
              note: "Employee trust/procedural-fairness survey is not captured yet.",
            },
        subgroupImpact: {
          available: false,
          note: "Contribution/evaluation subgroup impact is not aggregated yet.",
        },
      },
      request,
    );
  });

  app.get("/api/v1/reports/operations-coverage", async (request) => {
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [
      workPackages,
      claims,
      evidence,
      deliverables,
      approvals,
      dsars,
      dataQualityIssues,
      appeals,
      runs,
    ] = await Promise.all([
      store.listWorkPackages(),
      store.listClaims(),
      store.listEvidence(),
      platformStore.listDeliverables(tenantId),
      platformStore.listApprovalRequests(tenantId),
      platformStore.listDsars(tenantId),
      store.listDataQualityIssues(),
      store.listAppeals(),
      store.listRuns(),
    ]);
    const acceptedPackages = workPackages.filter(
      (workPackage) => workPackage.status === "ACCEPTED",
    );
    const workPackageEvidence = evidence.filter(
      (node) => node.subjectType === "WORK_PACKAGE",
    );
    const evidenceSubjects = new Set(
      workPackageEvidence.map((node) => node.subjectId),
    );
    const packagesWithEvidence = acceptedPackages.filter((workPackage) =>
      evidenceSubjects.has(workPackage.id),
    ).length;
    const orderTypeByPackage = new Map<string, string>();
    for (const run of runs) {
      for (const participant of run.inputSnapshot.participants) {
        if (!orderTypeByPackage.has(participant.workPackageId)) {
          orderTypeByPackage.set(
            participant.workPackageId,
            run.inputSnapshot.order.projectType ?? "UNSPECIFIED",
          );
        }
      }
    }
    const responsibilityCoverage = new Map<
      string,
      { total: number; withEvidence: number }
    >();
    const orderTypeCoverage = new Map<
      string,
      { total: number; withEvidence: number }
    >();
    for (const workPackage of acceptedPackages) {
      const hasEvidence = evidenceSubjects.has(workPackage.id);
      const roles = new Set(
        workPackage.members.map((member) => member.responsibilityCode),
      );
      for (const role of roles) {
        const current = responsibilityCoverage.get(role) ?? {
          total: 0,
          withEvidence: 0,
        };
        current.total += 1;
        if (hasEvidence) current.withEvidence += 1;
        responsibilityCoverage.set(role, current);
      }
      const orderType = orderTypeByPackage.get(workPackage.id) ?? "UNLINKED";
      const currentOrder = orderTypeCoverage.get(orderType) ?? {
        total: 0,
        withEvidence: 0,
      };
      currentOrder.total += 1;
      if (hasEvidence) currentOrder.withEvidence += 1;
      orderTypeCoverage.set(orderType, currentOrder);
    }
    const openAppeals = appeals.filter(
      (appeal) => appeal.status !== "CLOSED",
    );
    const overdueAppeals = openAppeals.filter(
      (appeal) =>
        Boolean(appeal.dueAt) &&
        new Date(appeal.dueAt as string).getTime() < Date.now(),
    ).length;
    const confirmedClaims = claims.filter(
      (claim) =>
        claim.status === "ACCEPTED" ||
        claim.status === "PARTIALLY_ACCEPTED",
    ).length;
    const rejectedClaims = claims.filter(
      (claim) => claim.status === "REJECTED",
    ).length;
    const pendingClaims = claims.filter(
      (claim) =>
        ![
          "ACCEPTED",
          "PARTIALLY_ACCEPTED",
          "REJECTED",
          "WITHDRAWN",
        ].includes(claim.status),
    ).length;
    const openDataQualityIssues = dataQualityIssues.filter(
      (issue) =>
        issue.status !== "RESOLVED" &&
        issue.status !== "WAIVED_WITH_APPROVAL",
    );
    const nowMs = Date.now();
    const overdueDataQualityIssues = openDataQualityIssues.filter(
      (issue) =>
        Boolean(issue.dueAt) &&
        new Date(issue.dueAt as string).getTime() < nowMs,
    ).length;
    const escalatedDataQualityIssues = dataQualityIssues.filter(
      (issue) => Boolean(issue.escalatedAt),
    ).length;
    const report: OperationsCoverageReport = {
      generatedAt: new Date().toISOString(),
      workPackages: {
        total: workPackages.length,
        accepted: acceptedPackages.length,
        withEvidence: packagesWithEvidence,
        evidenceCoverageRate: ratio(
          packagesWithEvidence,
          acceptedPackages.length,
        ),
        coverageByResponsibility: [...responsibilityCoverage.entries()]
          .map(([responsibilityCode, value]) => ({
            responsibilityCode,
            total: value.total,
            withEvidence: value.withEvidence,
            coverageRate: ratio(value.withEvidence, value.total),
          }))
          .sort((a, b) =>
            a.responsibilityCode.localeCompare(b.responsibilityCode),
          ),
        coverageByOrderType: [...orderTypeCoverage.entries()]
          .map(([orderType, value]) => ({
            orderType,
            total: value.total,
            withEvidence: value.withEvidence,
            coverageRate: ratio(value.withEvidence, value.total),
          }))
          .sort((a, b) => a.orderType.localeCompare(b.orderType)),
      },
      claims: {
        total: claims.length,
        confirmed: confirmedClaims,
        pending: pendingClaims,
        rejected: rejectedClaims,
      },
      evidence: {
        total: evidence.length,
        workPackage: workPackageEvidence.length,
      },
      deliverables: {
        total: deliverables.length,
        pendingAcceptance: deliverables.filter(
          (deliverable) => deliverable.status === "SUBMITTED",
        ).length,
        accepted: deliverables.filter(
          (deliverable) => deliverable.status === "ACCEPTED",
        ).length,
      },
      approvals: {
        total: approvals.length,
        pending: approvals.filter(
          (approval) => approval.status === "PENDING",
        ).length,
        approved: approvals.filter(
          (approval) => approval.status === "APPROVED",
        ).length,
        consumed: approvals.filter((approval) =>
          Boolean(approval.consumedAt),
        ).length,
      },
      dataQuality: {
        total: dataQualityIssues.length,
        open: openDataQualityIssues.length,
        overdue: overdueDataQualityIssues,
        escalated: escalatedDataQualityIssues,
      },
      dsars: {
        total: dsars.length,
        open: dsars.filter((request) => request.status === "OPEN").length,
        resolved: dsars.filter(
          (request) => request.status === "RESOLVED",
        ).length,
        rejected: dsars.filter(
          (request) => request.status === "REJECTED",
        ).length,
      },
      appeals: {
        total: appeals.length,
        open: openAppeals.length,
        overdue: overdueAppeals,
        closed: appeals.filter((appeal) => appeal.status === "CLOSED").length,
        appealRate: ratio(appeals.length, Math.max(claims.length, 1)),
      },
    };
    return data(report, request);
  });

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

  app.post("/api/v1/work-packages/:id/start", async (request) => {
    const body = parse(workPackageCommandSchema, request.body ?? {});
    return data(
      await storeFor(request).startWorkPackage(
        idOf(request),
        body.expectedVersion,
      ),
      request,
    );
  });

  app.post("/api/v1/work-packages/:id/submit", async (request) => {
    const body = parse(workPackageCommandSchema, request.body ?? {});
    return data(
      await storeFor(request).submitWorkPackage(
        idOf(request),
        body.expectedVersion,
      ),
      request,
    );
  });

  app.post("/api/v1/work-packages/:id/accept", async (request) => {
    requireRoles(request, "manager");
    const body = parse(acceptWorkPackageSchema, request.body);
    return data(
      await storeFor(request).acceptWorkPackage(
        idOf(request),
        body.reviewerPersonId,
        body.expectedVersion,
      ),
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
        body.expectedVersion,
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

  app.post("/api/v1/contribution-attestations", async (request, reply) => {
    const body = parse(createContributionAttestationSchema, request.body);
    const persons = await platformStore.listPersons(tenantOf(request));
    const subject = persons.find(
      (person) => person.id === body.subjectPersonId,
    );
    const attester = persons.find(
      (person) => person.id === body.attesterPersonId,
    );
    if (!subject) throw new NotFoundError(
      `Person ${body.subjectPersonId} not found`,
    );
    if (!attester) throw new NotFoundError(
      `Person ${body.attesterPersonId} not found`,
    );
    if (body.attestationType === "MANAGER") {
      if (subject.managerPersonId !== body.attesterPersonId) {
        throw new ConflictError(
          "ATTESTATION_MANAGER_RELATIONSHIP_REQUIRED: attester is not the subject's manager",
        );
      }
    }
    const own = ownPersonId(request);
    if (
      own &&
      body.attesterPersonId !== own &&
      !isPrivileged(request)
    ) {
      throw new ForbiddenError("cannot attest on behalf of another person");
    }
    return reply.status(201).send(
      data(
        await storeFor(request).createContributionAttestation({
          ...body,
          evidenceRefs: body.evidenceRefs ?? [],
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/contribution-attestations", async (request) => {
    const query = request.query as {
      workPackageId?: string;
      subjectPersonId?: string;
    };
    const person = personFilter(request);
    const attestations = await storeFor(
      request,
    ).listContributionAttestations({
      workPackageId: query.workPackageId,
      subjectPersonId: query.subjectPersonId,
    });
    return data(
      person
        ? attestations.filter(
            (attestation) =>
              attestation.subjectPersonId === person ||
              attestation.attesterPersonId === person,
          )
        : attestations,
      request,
    );
  });

  app.post("/api/v1/contribution-attestations/:id/withdraw", async (request) => {
      const body = parse(withdrawContributionAttestationSchema, request.body);
      const own = ownPersonId(request);
      const requester = own ?? body.personId;
      if (!requester) {
        throw new ForbiddenError(
          "attester identity is required to withdraw an attestation",
        );
      }
      if (own && body.personId && body.personId !== own && !isPrivileged(request)) {
        throw new ForbiddenError("cannot withdraw for another person");
      }
      return data(
        await storeFor(request).withdrawContributionAttestation(
          idOf(request),
          requester,
        ),
        request,
      );
  });

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

  app.get("/api/v1/reports/appeal-stats", async (request) => {
    const tenantId = tenantOf(request);
    const [appeals, claims, commitment] = await Promise.all([
      storeFor(request).listAppeals(),
      storeFor(request).listClaims(),
      platformStore.getActiveFairnessCommitment(tenantId),
    ]);
    const closed = appeals.filter((appeal) => appeal.status === "CLOSED");
    const durations = closed
      .map((appeal) => {
        if (!appeal.resolvedAt) return undefined;
        return (
          (Date.parse(appeal.resolvedAt) - Date.parse(appeal.createdAt)) /
          (24 * 60 * 60 * 1000)
        );
      })
      .filter((value): value is number => Number.isFinite(value));
    const resolutions = closed.reduce<Record<string, number>>(
      (totals, appeal) => {
        const key = appeal.resolution ?? "UNSPECIFIED";
        totals[key] = (totals[key] ?? 0) + 1;
        return totals;
      },
      {},
    );
    return data(
      {
        generatedAt: new Date().toISOString(),
        commitment: commitment
          ? {
              id: commitment.id,
              version: commitment.version,
              statement: commitment.statement,
              ownerPersonId: commitment.ownerPersonId,
              channels: commitment.channels,
              publishedAt: commitment.publishedAt,
            }
          : null,
        appeals: {
          total: appeals.length,
          open: appeals.filter((appeal) => appeal.status !== "CLOSED").length,
          closed: closed.length,
          overdue: appeals.filter(
            (appeal) =>
              appeal.status !== "CLOSED" &&
              Boolean(appeal.dueAt) &&
              new Date(appeal.dueAt as string).getTime() < Date.now(),
          ).length,
          resolutions,
          averageResolutionDays:
            durations.length === 0
              ? 0
              : Math.round(
                  (durations.reduce((sum, value) => sum + value, 0) /
                    durations.length) *
                    10,
                ) / 10,
          appealRate: claims.length === 0 ? 0 : appeals.length / claims.length,
        },
      },
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

  app.post("/api/v1/break-glass-grants", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createBreakGlassGrantSchema, request.body);
    const grant = await platformStore.createBreakGlassGrant({
      tenantId: tenantOf(request),
      scope: body.scope,
      granteePersonId: body.granteePersonId,
      reason: body.reason,
      grantedBy: body.grantedBy,
      expiresAt: body.expiresAt,
    });
    countEvent("break_glass_grant_created");
    return reply.status(201).send(data(grant, request));
  });

  app.get("/api/v1/break-glass-grants", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.listBreakGlassGrants(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/break-glass-grants/:id/revoke", async (request) => {
    requireRoles(request, "admin");
    const grant = await platformStore.revokeBreakGlassGrant({
      tenantId: tenantOf(request),
      grantId: idOf(request),
    });
    countEvent("break_glass_grant_revoked");
    return data(grant, request);
  });

  app.post("/api/v1/clawback-cases", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(createClawbackCaseSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createClawbackCase({
          tenantId: tenantOf(request),
          personId: body.personId,
          amount: body.amount,
          currency: body.currency,
          reasonCode: body.reasonCode,
          explanation: body.explanation,
          consentSignatureRef: body.consentSignatureRef,
          installmentMonths: body.installmentMonths ?? 1,
          hardshipWaiver: body.hardshipWaiver ?? false,
          hardshipReason: body.hardshipReason,
          requestedBy: body.requestedBy,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/clawback-cases", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { personId?: string };
    return data(
      await platformStore.listClawbackCases(
        tenantOf(request),
        query.personId,
      ),
      request,
    );
  });

  app.post("/api/v1/clawback-cases/:id/approve", async (request) => {
    requireRoles(request, "finance");
    const body = parse(approveClawbackCaseSchema, request.body);
    return data(
      await platformStore.approveClawbackCase({
        tenantId: tenantOf(request),
        caseId: idOf(request),
        approvedBy: body.approvedBy,
      }),
      request,
    );
  });

  app.post("/api/v1/clawback-cases/:id/waive", async (request) => {
    requireRoles(request, "finance");
    const body = parse(closeClawbackCaseSchema, request.body);
    return data(
      await platformStore.closeClawbackCase({
        tenantId: tenantOf(request),
        caseId: idOf(request),
        action: "WAIVE",
        reason: body.reason,
        actorPersonId: body.actorPersonId,
      }),
      request,
    );
  });

  app.post("/api/v1/clawback-cases/:id/cancel", async (request) => {
    requireRoles(request, "finance");
    const body = parse(closeClawbackCaseSchema, request.body);
    return data(
      await platformStore.closeClawbackCase({
        tenantId: tenantOf(request),
        caseId: idOf(request),
        action: "CANCEL",
        reason: body.reason,
        actorPersonId: body.actorPersonId,
      }),
      request,
    );
  });

  app.post("/api/v1/budget-pools/:id/discretionary-reviews", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const body = parse(
        createDiscretionaryPoolReviewSchema,
        request.body,
      );
      return reply.status(201).send(
        data(
          await platformStore.createDiscretionaryPoolReview({
            tenantId: tenantOf(request),
            poolId: idOf(request),
            committeePersonIds: body.committeePersonIds,
            employeeObserverPersonId: body.employeeObserverPersonId,
            selectionCriteria: body.selectionCriteria,
            decisionNotes: body.decisionNotes,
            reviewedBy: body.reviewedBy,
          }),
          request,
        ),
      );
  });

  app.get("/api/v1/budget-pools/:id/discretionary-reviews", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listDiscretionaryPoolReviews(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.get("/api/v1/discretionary-pool-reviews", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listDiscretionaryPoolReviews(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/model-provider-policies", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createModelProviderPolicySchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createModelProviderPolicy({
          tenantId: tenantOf(request),
          provider: body.provider,
          zeroRetentionConfirmed: body.zeroRetentionConfirmed,
          dpaRef: body.dpaRef,
          inferenceRegion: body.inferenceRegion,
          egressAllowlist: body.egressAllowlist,
          approvedBy: body.approvedBy,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/model-provider-policies", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listModelProviderPolicies(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/model-provider-policies/:id/retire", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.retireModelProviderPolicy({
        tenantId: tenantOf(request),
        policyId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/model-evaluation-datasets", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createModelEvaluationDatasetSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createModelEvaluationDataset({
          tenantId: tenantOf(request),
          code: body.code,
          version: body.version ?? 1,
          name: body.name,
          sampleSize: body.sampleSize,
          holdoutSize: body.holdoutSize,
          labelSource: body.labelSource,
          ownerPersonId: body.ownerPersonId,
          refreshedAt: body.refreshedAt,
          nextRefreshDueAt: body.nextRefreshDueAt,
          contentHash: body.contentHash,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/model-evaluation-datasets", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listModelEvaluationDatasets(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/model-evaluation-datasets/:id/retire", async (request) => {
    requireRoles(request, "manager");
    return data(
      await platformStore.retireModelEvaluationDataset({
        tenantId: tenantOf(request),
        datasetId: idOf(request),
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

  app.post("/api/v1/attribution-decisions", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createAttributionDecisionSchema, request.body);
    const claim = await storeFor(request).getClaim(body.claimId);
    await assertNoAdjudicatorConflict(
      request,
      body.adjudicatorPersonId,
      claim.claimantPersonId,
    );
    return reply
      .status(201)
      .send(data(await storeFor(request).createAttributionDecision(body), request));
  });

  app.post("/api/v1/attribution-decisions:batch", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createAttributionDecisionsBatchSchema, request.body);
    for (const item of body.items) {
      const claim = await storeFor(request).getClaim(item.claimId);
      await assertNoAdjudicatorConflict(
        request,
        item.adjudicatorPersonId,
        claim.claimantPersonId,
      );
    }
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
    await ensureApproval(request, "LEGAL_GATE", body.approvalRequestId);
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

  app.post("/api/v1/data-sources", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createDataSourceSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createDataSource({
          tenantId: tenantOf(request),
          code: body.code,
          name: body.name,
          category: body.category,
          ownerPersonId: body.ownerPersonId,
          backupOwnerPersonId: body.backupOwnerPersonId,
          slaHours: body.slaHours,
          criticality: body.criticality,
          containsPersonalData: body.containsPersonalData ?? true,
          storageRegion: body.storageRegion,
          crossBorderTransfers: body.crossBorderTransfers ?? false,
          processorRefs: body.processorRefs ?? [],
          fields: body.fields,
          lastReviewedAt: body.lastReviewedAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/data-sources", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listDataSources(tenantOf(request)),
      request,
    );
  });

  app.get("/api/v1/data-sources/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getDataSource(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/data-sources/:id/retire", async (request) => {
    requireRoles(request, "manager");
    return data(
      await platformStore.retireDataSource({
        tenantId: tenantOf(request),
        dataSourceId: idOf(request),
      }),
      request,
    );
  });

  app.get("/api/v1/data-map", async (request) => {
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const [sources, retention, dpias, dsars] = await Promise.all([
      platformStore.listDataSources(tenantId),
      platformStore.listRetentionPolicies(tenantId),
      platformStore.listDpias(tenantId),
      platformStore.listDsars(tenantId),
    ]);
    const reviewCutoff = 90 * 24 * 60 * 60 * 1000;
    const mapped = sources.map((source) => {
      const reviewedAt = Date.parse(
        source.lastReviewedAt ?? source.createdAt,
      );
      const reviewDueAt = new Date(reviewedAt + reviewCutoff).toISOString();
      return {
        ...source,
        reviewDueAt,
        reviewOverdue:
          source.status === "ACTIVE" && Date.parse(reviewDueAt) < Date.now(),
      };
    });
    const active = mapped.filter((source) => source.status === "ACTIVE");
    const classifications: Record<string, number> = {};
    for (const source of mapped) {
      for (const field of source.fields) {
        classifications[field.classification] =
          (classifications[field.classification] ?? 0) + 1;
      }
    }
    const categories: Record<string, number> = {};
    for (const source of active) {
      categories[source.category] = (categories[source.category] ?? 0) + 1;
    }
    return data(
      {
        generatedAt: new Date().toISOString(),
        summary: {
          sources: sources.length,
          activeSources: active.length,
          personalSources: active.filter(
            (source) => source.containsPersonalData,
          ).length,
          crossBorderSources: active.filter(
            (source) => source.crossBorderTransfers,
          ).length,
          processors: [
            ...new Set(active.flatMap((source) => source.processorRefs)),
          ],
          fields: mapped.reduce(
            (total, source) => total + source.fields.length,
            0,
          ),
          classifications,
          categories,
          overdueReviews: active.filter((source) => source.reviewOverdue)
            .length,
          retentionPolicies: retention.length,
          approvedDpias: dpias.filter((dpia) => dpia.status === "APPROVED")
            .length,
          openDataRequests: dsars.filter((dsar) => dsar.status === "OPEN")
            .length,
        },
        sources: mapped,
        retentionPolicies: retention,
      },
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
    const order = await platformStore.getRuleChangeOrder(
      tenantOf(request),
      idOf(request),
    );
    if (order.status === "DRAFT") {
      await requirePolicyTestsBeforeApproval(
        request,
        order.toPolicyVersionId,
      );
    }
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

  app.post("/api/v1/policy-test-cases/:id/run", async (request) => {
    requireRoles(request, "manager", "finance");
    const testCase = await platformStore.getPolicyTestCase(
      tenantOf(request),
      idOf(request),
    );
    const policy = await storeFor(request).getPolicy(
      testCase.policyVersionId,
    );
    const result = runPolicyTestCase(testCase, policy);
    await platformStore.recordPolicyTestCaseRun({
      tenantId: tenantOf(request),
      testCaseId: testCase.id,
      passed: result.passed,
      resultHash: result.resultHash,
    });
    countEvent("policy_test_case_run");
    if (!result.passed) countEvent("policy_test_case_failed");
    return data(result, request);
  });

  app.post("/api/v1/policy-versions/:id/test-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await runPolicyTestSuiteFor(request, idOf(request)),
      request,
    );
  });

  app.get("/api/v1/policy-versions/:id/test-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    const policyVersionId = idOf(request);
    await storeFor(request).getPolicyVersion(policyVersionId);
    return data(
      await platformStore.listPolicyTestRuns(
        tenantOf(request),
        policyVersionId,
      ),
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
    let modelProvider = body.modelProvider;
    let modelName = body.modelName;
    if (body.modelPromptId) {
      const prompt = await platformStore.getModelPrompt(
        tenantOf(request),
        body.modelPromptId,
      );
      if (prompt.status !== "ACTIVE") {
        throw new ConflictError(
          `MODEL_PROMPT_NOT_ACTIVE: ${prompt.id} is ${prompt.status}`,
        );
      }
      if (
        (modelProvider && modelProvider !== prompt.modelProvider) ||
        (modelName && modelName !== prompt.modelName)
      ) {
        throw new ConflictError(
          `MODEL_PROMPT_MODEL_MISMATCH: ${prompt.id}`,
        );
      }
      modelProvider = prompt.modelProvider;
      modelName = prompt.modelName;
    }
    return reply.status(201).send(
      data(
        await platformStore.createAiSuggestion({
          tenantId: tenantOf(request),
          agentTaskId: body.agentTaskId,
          targetType: body.targetType,
          targetId: body.targetId,
          suggestionType: body.suggestionType,
          modelProvider,
          modelName,
          modelPromptId: body.modelPromptId,
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

  app.post("/api/v1/model-evaluation-runs:evaluate", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(runModelEvaluationSchema, request.body);
    await assertRegisteredGoldSet(request, body.datasetRef);
    const thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...(body.thresholds ?? {}),
    };
    const gate = evaluateGate(body.samples, thresholds);
    const evaluation = await platformStore.createModelEvaluationRun({
      tenantId: tenantOf(request),
      evaluationType: body.evaluationType,
      modelProvider: body.modelProvider,
      modelName: body.modelName,
      promptVersion: body.promptVersion,
      datasetRef: body.datasetRef,
      sampleSize: gate.sampleSize,
      metrics: {
        ...gate.metrics,
        harnessVersion: "ai-gate-v1",
        thresholds,
      },
      subgroupMetrics: {},
      passed: gate.passed,
      blockers: gate.blockers,
    });
    countEvent("model_evaluation_harness_run");
    if (!gate.passed) countEvent("model_evaluation_harness_blocked");
    return reply.status(201).send(data(evaluation, request));
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

  app.post("/api/v1/model-prompts", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createModelPromptSchema, request.body);
    const prompt = await platformStore.createModelPrompt({
      tenantId: tenantOf(request),
      promptCode: body.promptCode,
      version: body.version,
      purpose: body.purpose,
      modelProvider: body.modelProvider,
      modelName: body.modelName,
      template: body.template,
    });
    countEvent("model_prompt_created");
    return reply.status(201).send(data(prompt, request));
  });

  app.get("/api/v1/model-prompts", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      promptCode?: string;
      status?: "DRAFT" | "ACTIVE" | "RETIRED";
    };
    return data(
      await platformStore.listModelPrompts(tenantOf(request), {
        promptCode: query.promptCode,
        status: query.status,
      }),
      request,
    );
  });

  app.post("/api/v1/model-prompts/:id/activate", async (request) => {
    requireRoles(request, "admin");
    const body = parse(activateModelPromptSchema, request.body);
    const evaluation = await platformStore.getModelEvaluationRun(
      tenantOf(request),
      body.evaluationRunId,
    );
    assertHarnessEvaluation(evaluation);
    const existingPrompt = await platformStore.getModelPrompt(
      tenantOf(request),
      idOf(request),
    );
    await assertModelProviderPolicy(request, existingPrompt.modelProvider);
    const prompt = await platformStore.activateModelPrompt({
      tenantId: tenantOf(request),
      promptId: idOf(request),
      evaluationRunId: body.evaluationRunId,
    });
    countEvent("model_prompt_activated");
    return data(prompt, request);
  });

  app.post("/api/v1/model-prompts/:id/retire", async (request) => {
    requireRoles(request, "admin");
    const prompt = await platformStore.retireModelPrompt({
      tenantId: tenantOf(request),
      promptId: idOf(request),
    });
    countEvent("model_prompt_retired");
    return data(prompt, request);
  });

  app.post("/api/v1/ai-score-proposals", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createAiScoreProposalSchema, request.body);
    const tenantId = tenantOf(request);
    const persons = await platformStore.listPersons(tenantId);
    if (!persons.some((person) => person.id === body.personId)) {
      throw new NotFoundError(`Person ${body.personId} not found`);
    }
    const evaluation = await platformStore.getModelEvaluationRun(
      tenantId,
      body.evaluationRunId,
    );
    assertHarnessEvaluation(evaluation);
    await assertModelProviderPolicy(request, evaluation.modelProvider);
    if (!evaluation.passed) {
      throw new ConflictError(
        `AI_EVALUATION_GATE_NOT_PASSED: ${
          evaluation.blockers.join(", ") || "evaluation did not pass"
        }`,
      );
    }
    let prompt;
    if (body.modelPromptId) {
      prompt = await platformStore.getModelPrompt(
        tenantId,
        body.modelPromptId,
      );
      if (prompt.status !== "ACTIVE") {
        throw new ConflictError(
          `MODEL_PROMPT_NOT_ACTIVE: ${prompt.id} is ${prompt.status}`,
        );
      }
      if (
        prompt.modelProvider !== evaluation.modelProvider ||
        prompt.modelName !== evaluation.modelName
      ) {
        throw new ConflictError(
          `MODEL_PROMPT_EVALUATION_MODEL_MISMATCH: ${prompt.id}`,
        );
      }
    }
    const gate: EvaluationGate = {
      passed: evaluation.passed,
      sampleSize: evaluation.sampleSize,
      metrics: {},
      blockers: evaluation.blockers,
    };
    const scored = scoreEvidence(
      {
        dimensions: body.dimensions,
        evidence: body.evidence,
      },
      gate,
    );
    const tenant = await platformStore.getTenant(tenantId);
    const evidenceRule =
      (tenant.settings as { evidenceDefaultRule?: unknown })
        .evidenceDefaultRule === "ZERO"
        ? "ZERO"
        : "BLOCK";
    if (scored.insufficientEvidence.length > 0 && evidenceRule === "BLOCK") {
      throw new ConflictError(
        `AI_EVIDENCE_INSUFFICIENT:${scored.insufficientEvidence.join(",")}; add evidence or set evidenceDefaultRule=ZERO`,
      );
    }
    const proposal = await platformStore.createAiScoreProposal({
      tenantId,
      cycleId: body.cycleId,
      personId: body.personId,
      evaluationRunId: evaluation.id,
      modelPromptId: prompt?.id,
      modelProvider: prompt?.modelProvider ?? evaluation.modelProvider,
      modelName: prompt?.modelName ?? evaluation.modelName,
      promptVersion: evaluation.promptVersion,
      dimensions: body.dimensions,
      scores: scored.scores,
      overallScore: scored.overallScore,
      confidence: scored.confidence,
      rationale: scored.rationale,
      evidenceRefs: scored.citations,
      evidenceSnapshotHash: sha256(body.evidence),
      gateMetrics: evaluation.metrics,
      requestedBy: body.requestedBy,
    });
    countEvent("ai_score_proposal_created");
    return reply.status(201).send(data(proposal, request));
  });

  app.get("/api/v1/me/ai-explanations", async (request) => {
    const query = request.query as { personId?: string };
    const own = personFilter(request);
    const personId = own ?? (isPrivileged(request) ? query.personId : undefined);
    if (!personId) {
      throw new ForbiddenError("a person identity is required");
    }
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [drafts, decisions, proposals, notices] = await Promise.all([
      store.listEvaluationDrafts({ personId }),
      store.listEvaluationDecisions({ personId }),
      platformStore.listAiScoreProposals(tenantId, { personId }),
      platformStore.listNotices(tenantId),
    ]);
    const aiNotices = notices.filter((notice) => notice.noticeType === "AI_USE");
    const noticeRecords = await Promise.all(
      aiNotices.map(async (notice) => {
        const overview = await platformStore.listAcknowledgements(
          tenantId,
          notice.id,
        );
        return {
          notice,
          myAcknowledgement:
            overview.acknowledgements.find(
              (acknowledgement) =>
                acknowledgement.personId === personId,
            ) ?? null,
        };
      }),
    );
    const models = new Set<string>();
    for (const draft of drafts) {
      if (draft.modelName) {
        models.add(`${draft.modelProvider ?? "unknown"}/${draft.modelName}`);
      }
    }
    for (const proposal of proposals) {
      models.add(`${proposal.modelProvider}/${proposal.modelName}`);
    }
    return data(
      {
        personId,
        generatedAt: new Date().toISOString(),
        aiUsed: drafts.length > 0 || proposals.length > 0,
        models: [...models],
        notices: noticeRecords,
        evaluationDrafts: drafts,
        evaluationDecisions: decisions,
        aiScoreProposals: proposals,
        explanation: {
          summary:
            "AI output is advisory. A human reviewer records the formal evaluation or attribution decision, and you can appeal it.",
          humanReviewRequired: true,
          autonomousDecision: false,
          appealTargetType: "EVALUATION",
          appealTargets: decisions.map((decision) => decision.id),
        },
      },
      request,
    );
  });

  app.get("/api/v1/ai-review-metrics", async (request) => {
    requireRoles(request, "manager", "finance");
    const proposals = await platformStore.listAiScoreProposals(
      tenantOf(request),
    );
    const decided = proposals.filter(
      (proposal) => proposal.status !== "PENDING",
    );
    const accepted = decided.filter(
      (proposal) => proposal.status === "ACCEPTED",
    ).length;
    const overridden = decided.filter(
      (proposal) => proposal.override,
    ).length;
    const blind = decided.filter((proposal) => proposal.blindReview).length;
    const durations = decided
      .map((proposal) => proposal.reviewDurationSeconds)
      .filter((value): value is number => typeof value === "number");
    const evidenceOpened = decided.reduce(
      (total, proposal) => total + (proposal.evidenceOpened ?? 0),
      0,
    );
    const acceptanceRate =
      decided.length === 0 ? 0 : accepted / decided.length;
    const auditSampled = decided.filter((proposal) => proposal.auditSample);
    const auditCompleted = auditSampled.filter(
      (proposal) => proposal.secondReviewCompletedAt,
    );
    const auditAgreed = auditCompleted.filter(
      (proposal) => proposal.secondReviewOutcome === "AGREE",
    ).length;
    return data(
      {
        total: proposals.length,
        pending: proposals.length - decided.length,
        decided: decided.length,
        accepted,
        rejected: decided.length - accepted,
        acceptanceRate,
        overrideCount: overridden,
        overrideRate: decided.length === 0 ? 0 : overridden / decided.length,
        blindReviewCount: blind,
        averageReviewDurationSeconds:
          durations.length === 0
            ? 0
            : Math.round(
                durations.reduce((sum, value) => sum + value, 0) /
                  durations.length,
              ),
        averageEvidenceOpened:
          decided.length === 0
            ? 0
            : Math.round((evidenceOpened / decided.length) * 10) / 10,
        rubberStampAlert:
          decided.length >= 20 && acceptanceRate > 0.95,
        auditSampledCount: auditSampled.length,
        auditReviewedCount: auditCompleted.length,
        auditPendingCount: auditSampled.length - auditCompleted.length,
        auditAgreementRate:
          auditCompleted.length === 0
            ? 0
            : auditAgreed / auditCompleted.length,
      },
      request,
    );
  });

  app.get("/api/v1/ai-score-proposals", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      personId?: string;
      cycleId?: string;
      status?: "PENDING" | "ACCEPTED" | "REJECTED";
    };
    return data(
      await platformStore.listAiScoreProposals(tenantOf(request), {
        personId: query.personId,
        cycleId: query.cycleId,
        status: query.status,
      }),
      request,
    );
  });

  app.get("/api/v1/ai-score-proposals/audit-queue", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      status?: "pending" | "completed" | "all";
    };
    const proposals = await platformStore.listAiScoreProposals(
      tenantOf(request),
    );
    const sampled = proposals.filter(
      (proposal) =>
        proposal.auditSample && proposal.status !== "PENDING",
    );
    const filtered =
      query.status === "completed"
        ? sampled.filter((proposal) => proposal.secondReviewCompletedAt)
        : query.status === "all"
          ? sampled
          : sampled.filter((proposal) => !proposal.secondReviewCompletedAt);
    return data(filtered, request);
  });

  app.get("/api/v1/ai-score-proposals/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getAiScoreProposal(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/ai-score-proposals/:id/decide", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(decideAiScoreProposalSchema, request.body);
    const tenantId = tenantOf(request);
    const persons = await platformStore.listPersons(tenantId);
    if (!persons.some((person) => person.id === body.decidedBy)) {
      throw new NotFoundError(`Person ${body.decidedBy} not found`);
    }
    const existing = await platformStore.getAiScoreProposal(
      tenantId,
      idOf(request),
    );
    for (const dimension of existing.dimensions) {
      if (typeof body.independentScores[dimension] !== "number") {
        throw new ConflictError(
          `AI_INDEPENDENT_SCORES_REQUIRED: missing ${dimension}`,
        );
      }
    }
    const override = existing.dimensions.some(
      (dimension) =>
        Math.abs(
          (body.independentScores[dimension] ?? 0) -
            (existing.scores[dimension] ?? 0),
        ) > 0.05,
    );
    if (override && !body.overrideReason?.trim()) {
      throw new ConflictError("AI_OVERRIDE_REASON_REQUIRED");
    }
    const reviewStartedMs = Date.parse(body.reviewStartedAt);
    if (
      !Number.isFinite(reviewStartedMs) ||
      reviewStartedMs > Date.now()
    ) {
      throw new ConflictError("AI_REVIEW_STARTED_AT_INVALID");
    }
    const reviewDurationSeconds = Math.max(
      0,
      Math.round((Date.now() - reviewStartedMs) / 1000),
    );
    const tenant = await platformStore.getTenant(tenantId);
    const configuredRate = Number(
      (tenant.settings as { aiAuditSampleRate?: unknown })
        .aiAuditSampleRate ?? 0.1,
    );
    const auditSampleRate = Number.isFinite(configuredRate)
      ? Math.min(1, Math.max(0, configuredRate))
      : 0.1;
    const auditSample = override || Math.random() < auditSampleRate;
    const proposal = await platformStore.decideAiScoreProposal({
      tenantId,
      proposalId: idOf(request),
      decision: body.decision,
      decidedBy: body.decidedBy,
      note: body.note,
      independentScores: body.independentScores,
      independentRationale: body.independentRationale,
      reviewStartedAt: body.reviewStartedAt,
      reviewDurationSeconds,
      evidenceOpened: body.evidenceOpened ?? 0,
      override,
      overrideReason: body.overrideReason,
      blindReview: body.blindReview ?? false,
      auditSample,
    });
    countEvent(
      proposal.status === "ACCEPTED"
        ? "ai_score_proposal_accepted"
        : "ai_score_proposal_rejected",
    );
    return data(proposal, request);
  });

  app.post("/api/v1/ai-score-proposals/:id/audit-review", async (request) => {
      requireRoles(request, "manager", "finance");
      const body = parse(submitAiScoreAuditSchema, request.body);
      const tenantId = tenantOf(request);
      const persons = await platformStore.listPersons(tenantId);
      if (!persons.some((person) => person.id === body.reviewerPersonId)) {
        throw new NotFoundError(
          `Person ${body.reviewerPersonId} not found`,
        );
      }
      const proposal = await platformStore.getAiScoreProposal(
        tenantId,
        idOf(request),
      );
      for (const dimension of proposal.dimensions) {
        if (typeof body.scores[dimension] !== "number") {
          throw new ConflictError(
            `AI_AUDIT_SCORES_REQUIRED: missing ${dimension}`,
          );
        }
      }
      const reviewStartedMs = Date.parse(body.reviewStartedAt);
      if (
        !Number.isFinite(reviewStartedMs) ||
        reviewStartedMs > Date.now()
      ) {
        throw new ConflictError("AI_AUDIT_STARTED_AT_INVALID");
      }
      const matched = proposal.dimensions.filter(
        (dimension) =>
          Math.abs(
            (body.scores[dimension] ?? 0) -
              (proposal.scores[dimension] ?? 0),
          ) <= 0.05,
      ).length;
      const agreementRate = matched / proposal.dimensions.length;
      const secondDecision =
        matched === proposal.dimensions.length ? "ACCEPTED" : "REJECTED";
      const outcome =
        proposal.status === secondDecision ? "AGREE" : "DISAGREE";
      const reviewed = await platformStore.recordAiScoreAuditReview({
        tenantId,
        proposalId: idOf(request),
        reviewerPersonId: body.reviewerPersonId,
        scores: body.scores,
        rationale: body.rationale,
        reviewStartedAt: body.reviewStartedAt,
        reviewDurationSeconds: Math.max(
          0,
          Math.round((Date.now() - reviewStartedMs) / 1000),
        ),
        evidenceOpened: body.evidenceOpened ?? 0,
        outcome,
        agreementRate,
      });
      countEvent("ai_score_audit_reviewed");
      return data(reviewed, request);
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

  app.post("/api/v1/integration-connections/:id/mappings", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createIntegrationMappingSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createIntegrationMapping({
          tenantId: tenantOf(request),
          connectionId: idOf(request),
          name: body.name,
          mappingType: body.mappingType,
          sourceSystem: body.sourceSystem,
          targetType: body.targetType,
          fieldMap: body.fieldMap,
          config: body.config ?? {},
          version: body.version ?? 1,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections/:id/mappings", async (request) => {
    requireRoles(request, "admin", "integration");
    const query = request.query as {
      status?: "ACTIVE" | "RETIRED";
    };
    return data(
      await platformStore.listIntegrationMappings(
        tenantOf(request),
        idOf(request),
        query.status,
      ),
      request,
    );
  });

  app.post("/api/v1/integration-mappings/:id/retire", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.retireIntegrationMapping({
        tenantId: tenantOf(request),
        mappingId: idOf(request),
      }),
      request,
    );
  });

  app.get("/api/v1/integration-mapping-presets", async (request) => {
    requireRoles(request, "admin", "integration", "manager", "finance");
    return data(FIELD_MAPPING_PRESETS, request);
  });

  app.post("/api/v1/integration-connections/:id/schedules", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createSyncScheduleSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createSyncSchedule({
          tenantId: tenantOf(request),
          connectionId: idOf(request),
          name: body.name,
          intervalMinutes: body.intervalMinutes,
          startAt: body.startAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections/:id/schedules", async (request) => {
    requireRoles(request, "admin", "integration");
    return data(
      await platformStore.listSyncSchedules(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.get("/api/v1/sync-schedules", async (request) => {
    requireRoles(request, "admin", "integration");
    const query = request.query as { connectionId?: string };
    return data(
      await platformStore.listSyncSchedules(
        tenantOf(request),
        query.connectionId,
      ),
      request,
    );
  });

  app.post("/api/v1/sync-schedules/claim-due", async (request) => {
    requireRoles(request, "integration");
    const body = parse(claimDueSyncSchedulesSchema, request.body ?? {});
    return data(
      await platformStore.claimDueSyncSchedules({
        tenantId: tenantOf(request),
        limit: body.limit ?? 10,
        now: body.now,
      }),
      request,
    );
  });

  app.post("/api/v1/sync-schedules/:id/status", async (request) => {
    requireRoles(request, "admin");
    const body = parse(setSyncScheduleEnabledSchema, request.body);
    return data(
      await platformStore.setSyncScheduleEnabled({
        tenantId: tenantOf(request),
        scheduleId: idOf(request),
        enabled: body.enabled,
      }),
      request,
    );
  });

  app.post("/api/v1/equity-grants", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createEquityGrantSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createEquityGrant({
          tenantId: tenantOf(request),
          personId: body.personId,
          grantCode: body.grantCode,
          grantType: body.grantType,
          totalUnits: body.totalUnits,
          strikePrice: body.strikePrice,
          currency: body.currency,
          grantDate: body.grantDate,
          vestingStart: body.vestingStart,
          cliffMonths: body.cliffMonths ?? 0,
          vestingMonths: body.vestingMonths,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/equity-grants", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { personId?: string };
    return data(
      await platformStore.listEquityGrants(
        tenantOf(request),
        query.personId,
      ),
      request,
    );
  });

  app.get("/api/v1/equity-grants/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getEquityGrant(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.get("/api/v1/equity-grants/:id/vesting", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { asOf?: string };
    return data(
      await platformStore.getEquityVesting(
        tenantOf(request),
        idOf(request),
        query.asOf,
      ),
      request,
    );
  });

  app.post("/api/v1/equity-grants/:id/exercises", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createEquityExerciseSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createEquityExercise({
          tenantId: tenantOf(request),
          grantId: idOf(request),
          units: body.units,
          requestedBy: body.requestedBy,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/equity-exercises", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { grantId?: string };
    return data(
      await platformStore.listEquityExercises(
        tenantOf(request),
        query.grantId,
      ),
      request,
    );
  });

  app.post("/api/v1/equity-exercises/:id/approve", async (request) => {
    requireRoles(request, "admin");
    const body = parse(approveEquityExerciseSchema, request.body);
    return data(
      await platformStore.approveEquityExercise({
        tenantId: tenantOf(request),
        exerciseId: idOf(request),
        approvedBy: body.approvedBy,
      }),
      request,
    );
  });

  app.post("/api/v1/equity-exercises/:id/settle", async (request) => {
    requireRoles(request, "finance");
    return data(
      await platformStore.settleEquityExercise({
        tenantId: tenantOf(request),
        exerciseId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/bounties", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createBountySchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createBounty({
          tenantId: tenantOf(request),
          title: body.title,
          description: body.description,
          rewardAmount: body.rewardAmount,
          currency: body.currency,
          createdBy: body.createdBy,
          dueAt: body.dueAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/bounties", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      status?: "OPEN" | "CLAIMED" | "SUBMITTED" | "ACCEPTED" | "CANCELLED";
    };
    return data(
      await platformStore.listBounties(tenantOf(request), query.status),
      request,
    );
  });

  app.get("/api/v1/bounties/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getBounty(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/bounties/:id/claim", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(claimBountySchema, request.body);
    return data(
      await platformStore.claimBounty({
        tenantId: tenantOf(request),
        bountyId: idOf(request),
        personId: body.personId,
      }),
      request,
    );
  });

  app.post("/api/v1/bounties/:id/submit", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(submitBountySchema, request.body);
    return data(
      await platformStore.submitBounty({
        tenantId: tenantOf(request),
        bountyId: idOf(request),
        personId: body.personId,
        submissionRef: body.submissionRef,
      }),
      request,
    );
  });

  app.post("/api/v1/bounties/:id/accept", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(acceptBountySchema, request.body);
    return data(
      await platformStore.acceptBounty({
        tenantId: tenantOf(request),
        bountyId: idOf(request),
        reviewerPersonId: body.reviewerPersonId,
        paymentRef: body.paymentRef,
      }),
      request,
    );
  });

  app.post("/api/v1/bounties/:id/cancel", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.cancelBounty({
        tenantId: tenantOf(request),
        bountyId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/adverse-actions", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createAdverseActionSchema, request.body);
    const action = await platformStore.createAdverseAction({
      tenantId: tenantOf(request),
      personId: body.personId,
      actionType: body.actionType,
      reason: body.reason,
      performanceBasis: body.performanceBasis,
      evidenceRefs: body.evidenceRefs ?? [],
      requestedBy: body.requestedBy,
    });
    countEvent("adverse_action_created");
    return reply.status(201).send(data(action, request));
  });

  app.get("/api/v1/adverse-actions", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { personId?: string };
    return data(
      await platformStore.listAdverseActions(
        tenantOf(request),
        query.personId,
      ),
      request,
    );
  });

  app.get("/api/v1/adverse-actions/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getAdverseAction(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/adverse-actions/:id/legal-review", async (request) => {
    requireRoles(request, "admin");
    const body = parse(reviewAdverseActionSchema, request.body);
    const action = await platformStore.reviewAdverseAction({
      tenantId: tenantOf(request),
      actionId: idOf(request),
      legalReviewerId: body.legalReviewerId,
      legalReviewRef: body.legalReviewRef,
      decision: body.decision,
      note: body.note,
    });
    countEvent("adverse_action_legal_reviewed");
    return data(action, request);
  });

  app.post("/api/v1/adverse-actions/:id/approve", async (request) => {
    requireRoles(request, "admin");
    const body = parse(approveAdverseActionSchema, request.body);
    const action = await platformStore.approveAdverseAction({
      tenantId: tenantOf(request),
      actionId: idOf(request),
      approvedBy: body.approvedBy,
    });
    countEvent("adverse_action_approved");
    return data(action, request);
  });

  app.post("/api/v1/adverse-actions/:id/activate", async (request) => {
    requireRoles(request, "admin");
    const body = parse(activateAdverseActionSchema, request.body);
    const action = await platformStore.activateAdverseAction({
      tenantId: tenantOf(request),
      actionId: idOf(request),
      effectiveFrom: body.effectiveFrom,
    });
    countEvent("adverse_action_activated");
    return data(action, request);
  });

  app.post("/api/v1/adverse-actions/:id/complete", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.completeAdverseAction({
        tenantId: tenantOf(request),
        actionId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/adverse-actions/:id/cancel", async (request) => {
    requireRoles(request, "admin");
    const body = parse(cancelAdverseActionSchema, request.body);
    return data(
      await platformStore.cancelAdverseAction({
        tenantId: tenantOf(request),
        actionId: idOf(request),
        reason: body.reason,
      }),
      request,
    );
  });

  app.post("/api/v1/employment-contracts", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createEmploymentContractSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createEmploymentContract({
          tenantId: tenantOf(request),
          personId: body.personId,
          contractCode: body.contractCode,
          employmentType: body.employmentType,
          startDate: body.startDate,
          endDate: body.endDate,
          workLocation: body.workLocation,
          currency: body.currency,
          fixedMonthlySalary: body.fixedMonthlySalary,
          minimumMonthlyWage: body.minimumMonthlyWage,
          taxRate: body.taxRate ?? "0",
          socialInsuranceRate: body.socialInsuranceRate ?? "0",
          deductionCapRate: body.deductionCapRate ?? "0.2",
          variableShareCapRate: body.variableShareCapRate ?? "1",
          bankAccountRef: body.bankAccountRef,
          consentSignatureRef: body.consentSignatureRef,
          consentSignedAt: body.consentSignedAt,
        }),
        request,
      ),
    );
  });

  app.post("/api/v1/employment-contracts/:id/amendments", async (request) => {
    requireRoles(request, "admin");
    const body = parse(amendEmploymentContractSchema, request.body);
    return data(
      await platformStore.amendEmploymentContract({
        tenantId: tenantOf(request),
        contractId: idOf(request),
        fixedMonthlySalary: body.fixedMonthlySalary,
        minimumMonthlyWage: body.minimumMonthlyWage,
        taxRate: body.taxRate,
        socialInsuranceRate: body.socialInsuranceRate,
        deductionCapRate: body.deductionCapRate,
        variableShareCapRate: body.variableShareCapRate,
        bankAccountRef: body.bankAccountRef,
        effectiveFrom: body.effectiveFrom,
        consentSignatureRef: body.consentSignatureRef,
        approvedBy: body.approvedBy,
      }),
      request,
    );
  });

  app.get("/api/v1/employment-contracts/:id/amendments", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listEmploymentContractAmendments(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.get("/api/v1/employment-contracts", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { personId?: string };
    return data(
      await platformStore.listEmploymentContracts(
        tenantOf(request),
        query.personId,
      ),
      request,
    );
  });

  app.post("/api/v1/tax/cn-iit/calculate", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(calculateCnIitSchema, request.body);
    return data(calculateCumulativeIit(body), request);
  });

  app.post("/api/v1/payroll-runs", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createPayrollRunSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createPayrollRun({
          tenantId: tenantOf(request),
          cycleId: body.cycleId,
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          currency: body.currency,
          preparedBy: body.preparedBy,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/payroll-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { cycleId?: string };
    const runs = await platformStore.listPayrollRuns(
      tenantOf(request),
      query.cycleId,
    );
    return data(
      await Promise.all(
        runs.map((run) => payrollRunForViewer(request, run)),
      ),
      request,
    );
  });

  app.get("/api/v1/payroll-runs/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await payrollRunForViewer(
        request,
        await platformStore.getPayrollRun(
          tenantOf(request),
          idOf(request),
        ),
      ),
      request,
    );
  });

  app.get("/api/v1/payroll-runs/:id/export", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { approvalRequestId?: string };
    await ensureApproval(
      request,
      "PAYROLL_EXPORT",
      query.approvalRequestId,
    );
    if (query.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: query.approvalRequestId,
        actionType: "PAYROLL_EXPORT",
        targetType: "PAYROLL_RUN",
        targetId: idOf(request),
      });
    }
    const run = await payrollRunForViewer(
      request,
      await platformStore.getPayrollRun(
        tenantOf(request),
        idOf(request),
      ),
    );
    const csv = payrollCsv(run);
    return reply
      .type("text/csv; charset=utf-8")
      .headers(exportHeaders(request, csv, "CONFIDENTIAL"))
      .header(
        "content-disposition",
        `attachment; filename="payroll-${run.id}.csv"`,
      )
      .send(csv);
  });

  app.get("/api/v1/payroll-runs/:id/bank-file", async (request, reply) => {
    requireRoles(request, "finance");
    const query = request.query as { approvalRequestId?: string };
    await ensureApproval(
      request,
      "PAYROLL_BANK_FILE",
      query.approvalRequestId,
    );
    if (query.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: query.approvalRequestId,
        actionType: "PAYROLL_BANK_FILE",
        targetType: "PAYROLL_RUN",
        targetId: idOf(request),
      });
    }
    const run = await platformStore.getPayrollRun(
      tenantOf(request),
      idOf(request),
    );
    const csv = payrollBankFileCsv(run);
    return reply
      .type("text/csv; charset=utf-8")
      .headers(exportHeaders(request, csv, "RESTRICTED"))
      .header(
        "content-disposition",
        `attachment; filename="payroll-bank-${run.id}.csv"`,
      )
      .send(csv);
  });

  app.get("/api/v1/payroll-runs/:id/payslips/:personId", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const run = await platformStore.getPayrollRun(
      tenantOf(request),
      idOf(request),
    );
    const line = (run.lines ?? []).find(
      (candidate) => candidate.personId === paramOf(request, "personId"),
    );
    if (!line) {
      throw new NotFoundError(
        `PayrollLine ${paramOf(request, "personId")} not found`,
      );
    }
    return reply.type("text/html; charset=utf-8").send(
      payrollPayslipHtml(run, line),
    );
  });

  app.post("/api/v1/payroll-runs/:id/calculate", async (request) => {
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const run = await platformStore.getPayrollRun(
      tenantId,
      idOf(request),
    );
    const contracts = await platformStore.listEmploymentContracts(
      tenantId,
    );
    const ledger = await storeFor(request).listLedger();
    const calculation = calculatePayroll({
      contracts,
      ledger,
      cycleId: run.cycleId,
      currency: run.currency,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
    });
    const saved = await platformStore.savePayrollCalculation({
      tenantId,
      runId: run.id,
      lines: calculation.lines,
      totalGross: calculation.totalGross,
      totalDeductions: calculation.totalDeductions,
      totalTax: calculation.totalTax,
      totalSocialInsurance: calculation.totalSocialInsurance,
      totalNet: calculation.totalNet,
      blockedCount: calculation.blockedCount,
    });
    countEvent("payroll_run_calculated");
    if (saved.blockedCount > 0) countEvent("payroll_run_blocked");
    return data(saved, request);
  });

  app.post("/api/v1/payroll-runs/:id/approve", async (request) => {
    requireRoles(request, "admin", "finance");
    const body = parse(approvePayrollRunSchema, request.body);
    const run = await platformStore.approvePayrollRun({
      tenantId: tenantOf(request),
      runId: idOf(request),
      approvedBy: body.approvedBy,
    });
    countEvent("payroll_run_approved");
    return data(run, request);
  });

  app.post("/api/v1/payroll-runs/:id/pay", async (request) => {
    requireRoles(request, "finance");
    const run = await platformStore.payPayrollRun({
      tenantId: tenantOf(request),
      runId: idOf(request),
    });
    countEvent("payroll_run_paid");
    return data(run, request);
  });

  app.post("/api/v1/payroll-runs/:id/reverse", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = parse(reversePayrollRunSchema, request.body);
    const run = await platformStore.reversePayrollRun({
      tenantId: tenantOf(request),
      runId: idOf(request),
      reason: body.reason,
      reversedBy: body.reversedBy,
    });
    countEvent("payroll_run_reversed");
    return data(run, request);
  });

  app.post("/api/v1/payroll-runs/:id/cancel", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.cancelPayrollRun({
        tenantId: tenantOf(request),
        runId: idOf(request),
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
    const rawText = raw.toString("utf8");
    const scheme = options.webhookSchemes?.[source] ?? "hmac";
    let valid = false;
    if (scheme === "hubspot") {
      valid = verifyHubSpotSignature({
        clientSecret: secret,
        method: request.method,
        uri: request.url,
        body: rawText,
        signatureV3: request.headers["x-hubspot-signature-v3"] as
          | string
          | undefined,
        signatureV1: request.headers["x-hubspot-signature"] as
          | string
          | undefined,
        timestamp: request.headers["x-hubspot-request-timestamp"] as
          | string
          | undefined,
      });
    } else if (scheme === "feishu") {
      valid = verifyFeishuSignature({
        encryptKey: secret,
        timestamp: request.headers["x-lark-request-timestamp"] as
          | string
          | undefined,
        nonce: request.headers["x-lark-request-nonce"] as
          | string
          | undefined,
        body: rawText,
        signature: request.headers["x-lark-signature"] as
          | string
          | undefined,
      });
    } else {
      const timestamp = request.headers["x-timestamp"] as
        | string
        | undefined;
      valid = verifyWebhookSignature({
        secret,
        payload: raw,
        signature: request.headers["x-signature-256"] as
          | string
          | undefined,
        timestamp,
        toleranceSeconds: timestamp ? 300 : undefined,
      });
    }
    if (!valid) {
      throw new ConflictError("WEBHOOK_SIGNATURE_INVALID");
    }
    const payload = (request.body ?? {}) as { messageId?: string };
    const messageId =
      (request.headers["x-message-id"] as string | undefined) ??
      payload.messageId ??
      sha256(rawText);
    const webhook = await platformStore.receiveWebhook({
      tenantId: tenantOf(request),
      sourceSystem: source,
      messageId,
      payloadHash: sha256(rawText),
    });
    countEvent("webhook_received");
    return reply.status(202).send(data(webhook, request));
  });

  app.post("/api/v1/ledger/:id/adjustments", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(adjustLedgerEntrySchema, request.body);
    await assertNoRetroactiveAdjustment(request, idOf(request));
    await ensureApproval(request, "LEDGER_ADJUSTMENT", body.approvalRequestId);
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
    await ensureApproval(request, "CALCULATION_APPROVE", body.approvalRequestId);
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
    await ensureApproval(request, "CALCULATION_LOCK", body.approvalRequestId);
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

  app.get("/api/v1/evidence-packages/:cycleId", async (request) => {
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const cycleId = paramOf(request, "cycleId");
    const store = storeFor(request);
    const cycle = await store.getEvaluationCycle(cycleId);
    const [
      allWorkPackages,
      allClaims,
      allAttributionDecisions,
      drafts,
      evaluationDecisions,
      allRuns,
      allConfirmations,
      allEvidence,
      allAuditEvents,
      allSettlements,
      allLedger,
      allAppeals,
      allApprovals,
      allNotices,
      allDpias,
      allDsars,
      allDataQualityIssues,
      retentionPolicies,
      representations,
      policyVersions,
    ] = await Promise.all([
      store.listWorkPackages(),
      store.listClaims(),
      store.listDecisions(),
      store.listEvaluationDrafts({ cycleId }),
      store.listEvaluationDecisions({ cycleId }),
      store.listRuns(),
      store.listConfirmations(),
      store.listEvidence(),
      store.listAuditEvents(1000),
      store.listSettlementBatches(),
      store.listLedger(),
      store.listAppeals(),
      platformStore.listApprovalRequests(tenantId),
      platformStore.listNotices(tenantId),
      platformStore.listDpias(tenantId),
      platformStore.listDsars(tenantId),
      store.listDataQualityIssues(),
      platformStore.listRetentionPolicies(tenantId),
      platformStore.listRepresentations(tenantId),
      store.listPolicyVersions(),
    ]);

    const runs = allRuns.filter((run) => run.cycleId === cycleId);
    const runIds = new Set(runs.map((run) => run.id));
    const workPackageIds = new Set(
      runs.flatMap((run) =>
        run.inputSnapshot.participants.map(
          (participant) => participant.workPackageId,
        ),
      ),
    );
    const workPackages = allWorkPackages.filter((workPackage) =>
      workPackageIds.has(workPackage.id),
    );
    const claims = allClaims.filter((claim) =>
      workPackageIds.has(claim.workPackageId),
    );
    const claimIds = new Set(claims.map((claim) => claim.id));
    const attributionDecisions = allAttributionDecisions.filter((decision) =>
      claimIds.has(decision.claimId),
    );
    const settlementBatches = allSettlements.filter(
      (batch) => batch.cycleId === cycleId,
    );
    const settlementDetails = await Promise.all(
      settlementBatches.map((batch) => store.getSettlementBatch(batch.id)),
    );
    const settlementIds = new Set(
      settlementBatches.map((batch) => batch.id),
    );
    const settlementExports = (
      await Promise.all(
        [...settlementIds].map((batchId) =>
          platformStore.listSettlementExports(tenantId, batchId),
        ),
      )
    ).flat();
    const ledgerEntries = allLedger.filter(
      (entry) => entry.cycleId === cycleId,
    );
    const ledgerIds = new Set(ledgerEntries.map((entry) => entry.id));
    const evidenceSubjects = new Set([
      ...workPackageIds,
      ...claimIds,
      ...runIds,
    ]);
    const evidenceNodes = allEvidence.filter((node) =>
      evidenceSubjects.has(node.subjectId),
    );
    const evidenceLinks = (
      await Promise.all(
        evidenceNodes.map((node) => store.listEvidenceLinks(node.id)),
      )
    ).flat();
    const confirmationTargets = new Set([
      ...runIds,
      ...settlementIds,
      ...ledgerIds,
      ...claimIds,
    ]);
    const confirmations = allConfirmations.filter((confirmation) =>
      confirmationTargets.has(confirmation.targetId),
    );
    const appeals = allAppeals.filter((appeal) =>
      confirmationTargets.has(appeal.targetId),
    );
    const policyVersionIds = new Set(
      [
        cycle.policyVersionId,
        ...runs.map((run) => run.policyVersionId),
      ].filter((value): value is string => Boolean(value)),
    );
    const policies = policyVersions.filter((policy) =>
      policyVersionIds.has(policy.policyVersionId),
    );
    const policyDetails = await Promise.all(
      policies.map(async (policy) => {
        const [legalGate, testCases, testRuns, policyNotices, consultations] =
          await Promise.all([
            store.getLegalGate(policy.policyVersionId),
            platformStore.listPolicyTestCases(tenantId, policy.policyVersionId),
            platformStore.listPolicyTestRuns(
              tenantId,
              policy.policyVersionId,
              100,
            ),
            platformStore.listPolicyNotices(tenantId, policy.policyVersionId),
            platformStore.listConsultations(tenantId, policy.policyVersionId),
          ]);
        return {
          ...policy,
          legalGate,
          testCases,
          testRuns,
          policyNotices,
          consultations,
        };
      }),
    );
    const notices = allNotices.filter(
      (notice) =>
        notice.policyVersionId &&
        policyVersionIds.has(notice.policyVersionId),
    );
    const noticesWithAcknowledgements = await Promise.all(
      notices.map(async (notice) => ({
        notice,
        acknowledgements: await platformStore.listAcknowledgements(
          tenantId,
          notice.id,
        ),
      })),
    );
    const knownTargetIds = new Set<string>([
      cycle.id,
      ...policyVersionIds,
      ...workPackageIds,
      ...claimIds,
      ...attributionDecisions.map((decision) => decision.id),
      ...drafts.map((draft) => draft.id),
      ...evaluationDecisions.map((decision) => decision.id),
      ...runIds,
      ...confirmationTargets,
      ...settlementIds,
      ...ledgerIds,
      ...appeals.map((appeal) => appeal.id),
      ...notices.map((notice) => notice.id),
    ]);
    const approvals = allApprovals.filter((approval) =>
      knownTargetIds.has(approval.targetId),
    );
    const knownIds = new Set<string>([
      ...knownTargetIds,
      ...approvals.map((approval) => approval.id),
    ]);
    const dataQualityIssues = allDataQualityIssues.filter((issue) =>
      knownTargetIds.has(issue.objectId),
    );
    const auditEvents = allAuditEvents.filter(
      (event) => event.objectId && knownIds.has(event.objectId),
    );
    const [auditChainValid, ledgerValid] = await Promise.all([
      store.verifyAuditChain(),
      store.verifyLedger(),
    ]);
    const packageBody = {
      schemaVersion: "n-perform.evidence-package/v1",
      generatedAt: new Date().toISOString(),
      tenantId,
      cycle,
      policies: policyDetails,
      workPackages,
      evidence: {
        nodes: evidenceNodes,
        links: evidenceLinks,
      },
      contributionClaims: claims,
      attributionDecisions,
      evaluation: {
        drafts,
        decisions: evaluationDecisions,
      },
      calculations: runs,
      employeeConfirmations: confirmations,
      appeals,
      settlements: {
        batches: settlementDetails,
        exports: settlementExports,
      },
      ledgerEntries,
      approvals,
      dataQualityIssues,
      notices: noticesWithAcknowledgements,
      representations,
      dataProtection: {
        dpias: allDpias,
        dsars: allDsars,
        retentionPolicies,
      },
      auditEvents,
      verification: {
        auditChainValid,
        ledgerValid,
      },
    };
    return data(
      { ...packageBody, packageHash: sha256(packageBody) },
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

  app.get("/api/v1/audit-events/anchor", async (request) => {
    requireRoles(request, "admin");
    const query = request.query as {
      fromSequence?: string;
      toSequence?: string;
    };
    const fromSequence = query.fromSequence
      ? Number(query.fromSequence)
      : undefined;
    const toSequence = query.toSequence
      ? Number(query.toSequence)
      : undefined;
    const events = (await storeFor(request).listAuditEvents(500))
      .filter(
        (event) =>
          (fromSequence === undefined ||
            event.sequence >= fromSequence) &&
          (toSequence === undefined || event.sequence <= toSequence),
      )
      .sort((a, b) => a.sequence - b.sequence);
    const eventHashes = events.map((event) => event.eventHash);
    return data(
      {
        tenantId: tenantOf(request),
        generatedAt: new Date().toISOString(),
        window: {
          fromSequence: events[0]?.sequence ?? null,
          toSequence: events.at(-1)?.sequence ?? null,
          eventCount: events.length,
        },
        rootHash: sha256(eventHashes.join("|")),
        firstEventHash: events[0]?.eventHash ?? null,
        lastEventHash: events.at(-1)?.eventHash ?? null,
        note: "Timestamp rootHash with an external TSA and store it with the WORM copies.",
      },
      request,
    );
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
    await assertNoRetroactiveAdjustment(request, idOf(request));
    await ensureApproval(request, "LEDGER_REVERSAL", body.approvalRequestId);
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
      await ensureApproval(request, actionType, body.approvalRequestId);
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
