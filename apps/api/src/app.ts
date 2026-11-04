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
  createCompensationTemplateSchema,
  createESignEnvelopeSchema,
  esignCallbackSchema,
  createPilotEnrollmentSchema,
  withdrawPilotEnrollmentSchema,
  createBreakGlassGrantSchema,
  createClawbackCaseSchema,
  generateClawbackRecoverySchema,
  createStrategicPoolCaseSchema,
  strategicPoolCostReviewSchema,
  strategicPoolFinanceApproveSchema,
  approveClawbackCaseSchema,
  closeClawbackCaseSchema,
  createDiscretionaryPoolReviewSchema,
  createModelProviderPolicySchema,
  createModelEvaluationDatasetSchema,
  refreshModelEvaluationDatasetSchema,
  createModelCanaryRunSchema,
  createAuditRedactionSchema,
  createModelRedTeamRunSchema,
  createOrgNodeSchema,
  approveAgentActionSchema,
  createEvidenceLinkSchema,
  createDataQualityIssueSchema,
  createEvaluationCycleSchema,
  createNotificationSchema,
  createNoticeSchema,
  createPlatformPersonSchema,
  updateTenantSettingsSchema,
  updateFieldAccessPoliciesSchema,
  createRepresentationSchema,
  createConsultationSchema,
  concludeConsultationSchema,
  createDpiaSchema,
  createDataSourceSchema,
  approveRetentionDisposalRequestSchema,
  createFlatRetentionDisposalRequestSchema,
  createRetentionDisposalRequestSchema,
  processRetentionDisposalsSchema,
  completeRetentionDisposalRequestSchema,
  cancelRetentionDisposalRequestSchema,
  recordWorkforceSubgroupAttributeSchema,
  withdrawWorkforceSubgroupAttributeSchema,
  workforceSubgroupDimensionSchema,
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
  modelSummarySchema,
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
  cancelContractAmendmentSchema,
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
  createSubscriptionPlanSchema,
  setTenantSubscriptionSchema,
  createTenantInvoiceSchema,
  setTenantInvoiceStatusSchema,
  publicSignupSchema,
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
  marginalSimulationSchema,
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
  createAppealEvidenceDisclosureSchema,
  reverseLedgerEntrySchema,
  setPersonManagerSchema,
  settlementCommandSchema,
  triageAppealSchema,
} from "@anari/contracts";
import type {
  CreateCalculationRunInput,
  FieldAccessMatch,
  FieldAccessPolicy,
} from "@anari/contracts";
import {
  InvalidStateTransitionError,
  InvariantViolationError,
  assertPolicyApplicability,
  confirmationBlockers,
  legalGateBlockers,
  type AuditEvent,
  type AuditRedaction,
  type CalculationRun,
  type CycleReadinessReport,
  type OperationsCoverageReport,
  type PayrollLine,
  type PayrollRun,
  type PolicyReadinessReport,
  type PolicyRollbackResult,
  type PolicyTestSuiteResult,
  type SettlementBatch,
  type StrategicPoolCase,
} from "@anari/domain";
import {
  AgentRuntimeError,
  summarizeAgentMetrics,
  type AgentRuntime,
} from "@anari/agent-runtime";
import {
  DEFAULT_THRESHOLDS,
  HttpModelScoringProvider,
  ModelProviderError,
  assessAiRisk,
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
  simulateMarginalChange,
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
  payrollTaxFilingCsv,
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
  /** HMAC secrets for provider e-signature callbacks, by provider. */
  esignWebhookSecrets?: Record<string, string>;
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
  /** Per-tenant/actor limit for CSV, bank-file and evidence-package exports. */
  exportRateLimit?: {
    limit: number;
    windowMs?: number;
    now?: () => number;
  };
  /** Maximum request body size in bytes. Defaults to 1 MiB. */
  bodyLimitBytes?: number;
  /** Enable POST /api/v1/public/signup. Defaults to true. */
  publicSignup?: boolean;
  /** OpenAI-compatible model provider for advisory evidence summaries. */
  modelScoring?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    fetchImpl?: typeof fetch;
  };
}

class TooManyRequestsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
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

/** Apply tenant redaction overlays without changing the hash-chained event. */
export function applyAuditRedactions(
  events: AuditEvent[],
  redactions: AuditRedaction[],
): AuditEvent[] {
  const byEvent = new Map(
    redactions.map((redaction) => [redaction.auditEventId, redaction]),
  );
  return events.map((event) => {
    const redaction = byEvent.get(event.id);
    if (!redaction) return event;
    return {
      ...event,
      reason: redaction.replacement,
      redacted: true,
      redactionId: redaction.id,
    };
  });
}

const DEFAULT_PAYROLL_FIELD_POLICIES: Record<string, string[]> = {
  "PAYROLL_LINE.bankAccountRef": ["finance", "admin"],
};

export const RETENTION_RECOMMENDATIONS = [
  {
    dataCategory: "PAYROLL_RECORDS",
    retentionMonths: 360,
    legalBasis:
      "PRC accounting-archive rules and payroll-ledger retention; ADR-008 system default",
  },
  {
    dataCategory: "ACCOUNTING_RECORDS",
    retentionMonths: 360,
    legalBasis: "PRC accounting-archive retention; ADR-008 system default",
  },
  {
    dataCategory: "MIGRANT_WORKER_WAGE_RECORDS",
    retentionMonths: 36,
    legalBasis:
      "PRC migrant-worker wage-payment record minimum; ADR-008 system default",
  },
  {
    dataCategory: "LABOR_CONTRACTS",
    retentionMonths: 24,
    legalBasis:
      "Labour Contract Law Art. 50 minimum after termination; ADR-008 system default",
  },
  {
    dataCategory: "RECRUITMENT_RECORDS",
    retentionMonths: 24,
    legalBasis: "Data-minimisation default; ADR-008 system default",
  },
  {
    dataCategory: "AI_EVALUATION_EVIDENCE",
    retentionMonths: 36,
    legalBasis:
      "Explanation, appeal and annual-review evidence window; ADR-008 system default",
  },
  {
    dataCategory: "AUDIT_EVENTS",
    retentionMonths: 120,
    legalBasis:
      "Investigation and audit-verification window; ADR-008 system default",
  },
] as const;

export const DEFAULT_FIELD_ACCESS_POLICIES: Record<string, FieldAccessPolicy> = {
  ...DEFAULT_PAYROLL_FIELD_POLICIES,
  "CALCULATION_LINE.baseAmount": ["finance", "admin"],
  "CALCULATION_LINE.rawAmount": ["finance", "admin"],
  "CALCULATION_LINE.roundedAmount": ["finance", "admin"],
  "CALCULATION_LINE.multiplier": ["finance", "admin"],
  "CALCULATION_LINE.trace": ["finance", "admin"],
  "EMPLOYMENT_CONTRACT.bankAccountRef": ["finance", "admin"],
  "EVIDENCE.normalizedPayload": ["manager", "finance", "admin"],
  "EVIDENCE.sourceUri": ["manager", "finance", "admin"],
  "SETTLEMENT_LINE.amount": ["manager", "finance", "admin"],
  "SETTLEMENT_LINE.personName": ["manager", "finance", "admin"],
  "SETTLEMENT_LINE.personCode": ["manager", "finance", "admin"],
  "AI_PROPOSAL.scores": ["manager", "finance", "admin"],
  "AI_PROPOSAL.rationale": ["manager", "finance", "admin"],
  "AI_PROPOSAL.gateMetrics": ["manager", "finance", "admin"],
};

const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

type DenialMode = "OMIT" | "ZERO" | "REDACT";

/** Server-derived facts used to evaluate object-policy predicates. */
export interface FieldAccessMatchContext {
  viewerPersonId?: string;
  managerByPerson: Map<string, string | undefined>;
  activePersons: Set<string>;
  orgNodesByPerson: Map<string, Set<string>>;
  legalEntityByPerson: Map<string, string | undefined>;
  /** Retention categories currently under legal hold. */
  heldCategories: Set<string>;
}

/**
 * Resources that map onto a retention data category. Unmapped resources make
 * the legalHoldActive predicate evaluate false (and therefore fail closed for
 * a `true` expectation).
 */
export const RETENTION_CATEGORIES_BY_RESOURCE: Record<string, string[]> = {
  EMPLOYMENT_CONTRACT: ["LABOR_CONTRACTS"],
  PAYROLL_LINE: ["PAYROLL_RECORDS"],
  CALCULATION_LINE: ["ACCOUNTING_RECORDS"],
  SETTLEMENT_LINE: ["ACCOUNTING_RECORDS"],
  EVIDENCE: ["AI_EVALUATION_EVIDENCE"],
  AI_PROPOSAL: ["AI_EVALUATION_EVIDENCE"],
};

interface NormalizedFieldPolicy {
  roles: string[];
  allowSelf: boolean;
  onDeny?: DenialMode;
  match?: FieldAccessMatch;
}

/** Accept both the legacy role array and the object form from ADR-009. */
export function normalizeFieldPolicy(
  value: unknown,
): NormalizedFieldPolicy | undefined {
  if (Array.isArray(value)) {
    return {
      roles: value.filter((role): role is string => typeof role === "string"),
      allowSelf: true,
    };
  }
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {
    allowRoles?: unknown;
    allowSelf?: unknown;
    onDeny?: unknown;
    match?: unknown;
  };
  const roles = Array.isArray(candidate.allowRoles)
    ? candidate.allowRoles.filter(
        (role): role is string => typeof role === "string",
      )
    : [];
  const allowSelf =
    typeof candidate.allowSelf === "boolean" ? candidate.allowSelf : true;
  const onDeny =
    candidate.onDeny === "OMIT" ||
    candidate.onDeny === "ZERO" ||
    candidate.onDeny === "REDACT"
      ? candidate.onDeny
      : undefined;
  const match =
    candidate.match && typeof candidate.match === "object"
      ? (candidate.match as FieldAccessMatch)
      : undefined;
  if (roles.length === 0 && candidate.allowSelf === undefined) {
    return undefined;
  }
  return { roles, allowSelf, onDeny, match };
}

export function fieldPolicyAllows(
  policy: NormalizedFieldPolicy,
  roles: string[],
  isSelf: boolean,
): boolean {
  if (roles.includes("admin")) return true;
  if (isSelf && policy.allowSelf) return true;
  return policy.roles.some((role) => roles.includes(role));
}

/**
 * Admin and self-access are unconditional grants; predicates only narrow the
 * role-based path. This keeps a manager's own record visible under a
 * subject-manager policy.
 */
export function fieldPolicyAllowsWithMatch(
  policy: NormalizedFieldPolicy,
  roles: string[],
  isSelf: boolean,
  context: FieldAccessMatchContext | undefined,
  subjectPersonId: string | undefined,
  resourceName: string,
): boolean {
  if (roles.includes("admin")) return true;
  if (isSelf && policy.allowSelf) return true;
  if (!policy.roles.some((role) => roles.includes(role))) return false;
  return fieldPolicyMatches(policy, context, subjectPersonId, resourceName);
}

function evaluateFieldPredicate(
  predicate: keyof FieldAccessMatch,
  context: FieldAccessMatchContext,
  subjectPersonId?: string,
  resourceName?: string,
): boolean {
  switch (predicate) {
    case "viewerEmploymentActive":
      return Boolean(
        context.viewerPersonId &&
          context.activePersons.has(context.viewerPersonId),
      );
    case "subjectEmploymentActive":
      return Boolean(
        subjectPersonId && context.activePersons.has(subjectPersonId),
      );
    case "legalHoldActive": {
      const categories = resourceName
        ? (RETENTION_CATEGORIES_BY_RESOURCE[resourceName] ?? [])
        : [];
      return categories.some((category) =>
        context.heldCategories.has(category),
      );
    }
    case "isSubjectManager":
      return Boolean(
        subjectPersonId &&
          context.viewerPersonId &&
          context.managerByPerson.get(subjectPersonId) ===
            context.viewerPersonId,
      );
    case "sameOrgNode": {
      if (!subjectPersonId || !context.viewerPersonId) return false;
      const viewerNodes = context.orgNodesByPerson.get(
        context.viewerPersonId,
      );
      const subjectNodes = context.orgNodesByPerson.get(subjectPersonId);
      if (!viewerNodes?.size || !subjectNodes?.size) return false;
      return [...viewerNodes].some((node) => subjectNodes.has(node));
    }
    case "sameLegalEntity": {
      if (!subjectPersonId || !context.viewerPersonId) return false;
      const viewerEntity = context.legalEntityByPerson.get(
        context.viewerPersonId,
      );
      const subjectEntity = context.legalEntityByPerson.get(subjectPersonId);
      return Boolean(
        viewerEntity && subjectEntity && viewerEntity === subjectEntity,
      );
    }
    default:
      return false;
  }
}

/**
 * Which server-derived predicates the effective matrix actually uses. The
 * context loader fetches only these sources instead of every tenant snapshot.
 */
export function requiredMatchPredicates(
  policies: Record<string, FieldAccessPolicy>,
): string[] {
  const predicates = new Set<string>();
  for (const value of Object.values(policies)) {
    const policy = normalizeFieldPolicy(value);
    if (!policy?.match) continue;
    for (const predicate of Object.keys(policy.match)) {
      predicates.add(predicate);
    }
  }
  return [...predicates].sort();
}

/**
 * Predicates only narrow access: a policy that matches roles still redacts
 * when a configured predicate is false. Without the server-derived context we
 * fail closed rather than returning the field.
 */
export function fieldPolicyMatches(
  policy: NormalizedFieldPolicy,
  context: FieldAccessMatchContext | undefined,
  subjectPersonId?: string,
  resourceName?: string,
): boolean {
  if (!policy.match) return true;
  if (!context) return false;
  for (const [predicate, expected] of Object.entries(policy.match)) {
    const actual = evaluateFieldPredicate(
      predicate as keyof FieldAccessMatch,
      context,
      subjectPersonId,
      resourceName,
    );
    if (actual !== expected) return false;
  }
  return true;
}

export function deniedFieldValue(
  field: string,
  current: unknown,
  onDeny?: DenialMode,
): unknown {
  if (onDeny === "OMIT") return undefined;
  if (onDeny === "ZERO") return "0";
  if (onDeny === "REDACT") return "[REDACTED]";
  // Legacy inference keeps existing array policies behaving as before.
  if (/Ref$/.test(field)) return undefined;
  if (typeof current === "string" && DECIMAL_STRING_PATTERN.test(current)) {
    return "0";
  }
  return "[REDACTED]";
}

/**
 * Apply the tenant field-access matrix to a single flat resource. This is the
 * generic path used by resources added after payroll and calculation lines;
 * identifier fields are removed, decimal strings are zeroed and other values
 * are replaced with a marker so no sensitive content leaks through.
 */
export function redactResourceFields<T extends object>(
  resource: T,
  resourceName: string,
  viewer: {
    personId?: string;
    recordPersonId?: string;
    roles: string[];
    policies?: Record<string, FieldAccessPolicy>;
    matchContext?: FieldAccessMatchContext;
    subjectPersonId?: string;
  },
): T & { redactedFields?: string[] } {
  const isSelf = Boolean(
    viewer.personId && viewer.personId === viewer.recordPersonId,
  );
  const policies = {
    ...DEFAULT_FIELD_ACCESS_POLICIES,
    ...(viewer.policies ?? {}),
  };
  const redacted: string[] = [];
  const next: Record<string, unknown> = {
    ...(resource as Record<string, unknown>),
  };
  for (const [key, rawPolicy] of Object.entries(policies)) {
    const policy = normalizeFieldPolicy(rawPolicy);
    if (!policy) continue;
    const [resourceKey, field] = key.split(".");
    if (resourceKey !== resourceName || !field || !(field in next)) continue;
    const subjectPersonId = viewer.subjectPersonId ?? viewer.recordPersonId;
    if (
      fieldPolicyAllowsWithMatch(
        policy,
        viewer.roles,
        isSelf,
        viewer.matchContext,
        subjectPersonId,
        resourceName,
      )
    ) {
      continue;
    }
    redacted.push(field);
    next[field] = deniedFieldValue(field, next[field], policy.onDeny);
  }
  return redacted.length === 0
    ? resource
    : ({ ...next, redactedFields: redacted } as unknown as T);
}

/**
 * Amendment history stores before/after term snapshots, including sensitive
 * contract fields. Apply the contract field policies to both snapshots so the
 * history cannot bypass the contract list rules.
 */
export function redactContractAmendmentTerms<
  T extends {
    beforeTerms: Record<string, unknown>;
    afterTerms: Record<string, unknown>;
  },
>(
  amendment: T,
  viewer: {
    personId?: string;
    recordPersonId?: string;
    roles: string[];
    policies?: Record<string, FieldAccessPolicy>;
    matchContext?: FieldAccessMatchContext;
  },
): T & { redactedFields?: string[] } {
  const before = redactResourceFields(
    amendment.beforeTerms,
    "EMPLOYMENT_CONTRACT",
    viewer,
  );
  const after = redactResourceFields(
    amendment.afterTerms,
    "EMPLOYMENT_CONTRACT",
    viewer,
  );
  const redactedFields = [
    ...new Set([...(before.redactedFields ?? []), ...(after.redactedFields ?? [])]),
  ];
  if (redactedFields.length === 0) return amendment;
  return {
    ...amendment,
    beforeTerms: before,
    afterTerms: after,
    redactedFields,
  };
}

/** Apply settlement-line field policies while leaving batch totals intact. */
export function redactSettlementBatchFields(
  batch: SettlementBatch,
  viewer: {
    personId?: string;
    roles: string[];
    policies?: Record<string, FieldAccessPolicy>;
    matchContext?: FieldAccessMatchContext;
  },
): SettlementBatch {
  if (!batch.lines?.length) return batch;
  return {
    ...batch,
    lines: batch.lines.map((line) =>
      redactResourceFields(line, "SETTLEMENT_LINE", {
        personId: viewer.personId,
        recordPersonId: line.personId,
        roles: viewer.roles,
        policies: viewer.policies,
      }),
    ),
  };
}

/**
 * Apply role-based field policies to a calculation run. This is deliberately
 * generic so the same matrix can protect other resources as they are added.
 */
export function redactCalculationRunFields(
  run: CalculationRun,
  viewer: {
    roles: string[];
    policies?: Record<string, FieldAccessPolicy>;
    matchContext?: FieldAccessMatchContext;
  },
): CalculationRun {
  const policies = {
    ...DEFAULT_FIELD_ACCESS_POLICIES,
    ...(viewer.policies ?? {}),
  };
  return {
    ...run,
    lines: run.lines.map((line) => {
      const redacted: string[] = [];
      const next: Record<string, unknown> = { ...line };
      for (const [key, rawPolicy] of Object.entries(policies)) {
        const policy = normalizeFieldPolicy(rawPolicy);
        if (!policy) continue;
        const [resource, field] = key.split(".");
        if (resource !== "CALCULATION_LINE" || !field) continue;
        if (
          fieldPolicyAllowsWithMatch(
            policy,
            viewer.roles,
            false,
            viewer.matchContext,
            line.personId,
            "CALCULATION_LINE",
          )
        ) {
          continue;
        }
        redacted.push(field);
        if (field === "trace" && !policy.onDeny) {
          next.trace = {};
        } else if (field in next) {
          next[field] = deniedFieldValue(field, next[field], policy.onDeny);
        }
      }
      return redacted.length === 0
        ? line
        : ({
            ...next,
            redactedFields: redacted,
          } as unknown as CalculationRun["lines"][number]);
    }),
  };
}

/** Apply tenant-configurable field access policies to payroll lines. */
export function redactPayrollFields(
  run: PayrollRun,
  viewer: {
    personId?: string;
    roles: string[];
    policies?: Record<string, FieldAccessPolicy>;
    breakGlass: boolean;
    matchContext?: FieldAccessMatchContext;
  },
): PayrollRun {
  const policies = {
    ...DEFAULT_PAYROLL_FIELD_POLICIES,
    ...(viewer.policies ?? {}),
  };
  return {
    ...run,
    lines: run.lines?.map((line) => {
      if (line.personId === viewer.personId) return line;
      const redacted: string[] = [];
      const next: PayrollLine = { ...line };
      for (const [key, rawPolicy] of Object.entries(policies)) {
        const policy = normalizeFieldPolicy(rawPolicy);
        if (!policy) continue;
        const [resource, field] = key.split(".");
        if (resource !== "PAYROLL_LINE" || !field) continue;
        if (field === "bankAccountRef" && viewer.breakGlass) continue;
        if (
          fieldPolicyAllowsWithMatch(
            policy,
            viewer.roles,
            false,
            viewer.matchContext,
            line.personId,
            "PAYROLL_LINE",
          )
        ) {
          continue;
        }
        redacted.push(field);
        if (field in next) {
          const current = (next as unknown as Record<string, unknown>)[field];
          (next as unknown as Record<string, unknown>)[field] =
            deniedFieldValue(field, current, policy.onDeny);
        }
      }
      return redacted.length === 0
        ? line
        : { ...next, redactedFields: redacted };
    }),
  };
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

const ACTIVITY_METRIC_KEYS = new Set(
  [
    "keystrokes",
    "keystrokeCount",
    "mouseMovements",
    "mouseClicks",
    "screenTime",
    "screenTimeMinutes",
    "idleTime",
    "activeWindow",
    "appUsage",
    "websiteUsage",
    "browsingHistory",
    "clipboard",
    "screenshot",
    "webcam",
    "microphone",
    "gps",
    "locationHistory",
    "activityVolume",
    "activityCount",
    "productivityScore",
  ].map((key) => key.replace(/[^a-z0-9]/gi, "").toLowerCase()),
);

function normalizeMetricKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/**
 * Reject activity-volume or surveillance fields. The product measures work
 * outcomes, not worker behaviour; this is a technical data-minimisation block
 * (PRD DATA-05), not just a policy statement.
 */
export function findActivityMetricKeys(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (ACTIVITY_METRIC_KEYS.has(normalizeMetricKey(key))) {
        found.add(key);
      }
      visit(child);
    }
  };
  visit(value);
  return [...found];
}

/**
 * Explicit surveillance phrases in free text. Deliberately narrow: generic
 * words such as "monitoring" or "screenshot" alone are legitimate evidence
 * descriptions, so only unambiguous behaviour-surveillance phrasing blocks.
 */
const ACTIVITY_MONITORING_PHRASES = [
  "keystroke logging",
  "keystroke logger",
  "keystroke monitoring",
  "mouse tracking",
  "mouse movement tracking",
  "screen recording software",
  "screen capture monitoring",
  "screen monitoring",
  "webcam monitoring",
  "camera monitoring",
  "webcam surveillance",
  "app usage tracking",
  "application usage monitoring",
  "website usage tracking",
  "browsing history tracking",
  "clipboard monitoring",
  "location tracking",
  "location history tracking",
  "gps tracking",
  "productivity monitoring",
  "employee monitoring software",
  "键盘记录",
  "键盘监控",
  "鼠标追踪",
  "屏幕监控",
  "摄像头监控",
  "剪贴板监控",
  "定位追踪",
  "位置追踪",
  "员工监控软件",
] as const;

/**
 * Detect activity-surveillance language in free-text payload values. This
 * complements the structured-key block for DATA-05; the match is intentionally
 * phrase-based so normal delivery or order text is unaffected.
 */
export function findActivityMonitoringText(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      const text = node.toLowerCase();
      for (const phrase of ACTIVITY_MONITORING_PHRASES) {
        if (text.includes(phrase)) found.add(phrase);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return [...found];
}

/** Detect common unmasked identifiers in an export payload. */
export function scanExportDlp(text: string): string[] {
  const patterns: Array<{ code: string; pattern: RegExp }> = [
    { code: "CHINESE_ID", pattern: /\b\d{17}[\dXx]\b/g },
    { code: "BANK_CARD", pattern: /\b\d{16,19}\b/g },
    { code: "PHONE", pattern: /\b1[3-9]\d{9}\b/g },
  ];
  const findings = new Set<string>();
  for (const { code, pattern } of patterns) {
    if (pattern.test(text)) findings.add(code);
    pattern.lastIndex = 0;
  }
  return [...findings];
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
  const exportLimiter = new FixedWindowRateLimiter(
    options.exportRateLimit?.limit ?? 30,
    options.exportRateLimit?.windowMs ?? 60_000,
    options.exportRateLimit?.now,
  );
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
  const fieldPolicyCache = new WeakMap<
    FastifyRequest,
    Record<string, FieldAccessPolicy> | null
  >();

  /** Resolve tenant field-access overrides once per request. */
  async function fieldPoliciesFor(
    request: FastifyRequest,
  ): Promise<Record<string, FieldAccessPolicy> | undefined> {
    if (fieldPolicyCache.has(request)) {
      return fieldPolicyCache.get(request) ?? undefined;
    }
    let policies: Record<string, FieldAccessPolicy> | null = null;
    try {
      const tenant = await platformStore.getTenant(tenantOf(request));
      const configured = (
        tenant.settings as { fieldAccessPolicies?: unknown }
      ).fieldAccessPolicies;
      if (configured && typeof configured === "object") {
        policies = configured as Record<string, FieldAccessPolicy>;
      }
    } catch {
      policies = null;
    }
    fieldPolicyCache.set(request, policies);
    return policies ?? undefined;
  }

  const fieldMatchCache = new WeakMap<
    FastifyRequest,
    FieldAccessMatchContext | null
  >();

  /**
   * Load predicate inputs only when an effective policy uses `match`. The
   * context is tenant-derived, never request-supplied, and cached per request.
   */
  async function fieldMatchContextFor(
    request: FastifyRequest,
    policies: Record<string, FieldAccessPolicy> | undefined,
  ): Promise<FieldAccessMatchContext | undefined> {
    if (fieldMatchCache.has(request)) {
      return fieldMatchCache.get(request) ?? undefined;
    }
    const effective = {
      ...DEFAULT_FIELD_ACCESS_POLICIES,
      ...(policies ?? {}),
    };
    const predicates = new Set(requiredMatchPredicates(effective));
    if (predicates.size === 0) {
      fieldMatchCache.set(request, null);
      return undefined;
    }
    const needsContracts =
      predicates.has("sameLegalEntity") ||
      predicates.has("subjectEmploymentActive") ||
      predicates.has("viewerEmploymentActive");
    const tenantId = tenantOf(request);
    const [persons, contracts, assignments, retentionPolicies] =
      await Promise.all([
        predicates.has("isSubjectManager")
          ? platformStore.listPersons(tenantId)
          : Promise.resolve([]),
        needsContracts
          ? platformStore.listEmploymentContracts(tenantId)
          : Promise.resolve([]),
        predicates.has("sameOrgNode")
          ? platformStore.listOrgAssignments(tenantId)
          : Promise.resolve([]),
        predicates.has("legalHoldActive")
          ? platformStore.listRetentionPolicies(tenantId)
          : Promise.resolve([]),
      ]);
    const orgNodesByPerson = new Map<string, Set<string>>();
    for (const assignment of assignments) {
      const nodes = orgNodesByPerson.get(assignment.personId) ?? new Set();
      nodes.add(assignment.orgNodeId);
      orgNodesByPerson.set(assignment.personId, nodes);
    }
    const legalEntityByPerson = new Map<string, string | undefined>();
    for (const contract of contracts) {
      if (contract.status !== "ACTIVE" || !contract.legalEntity) continue;
      if (!legalEntityByPerson.has(contract.personId)) {
        legalEntityByPerson.set(contract.personId, contract.legalEntity);
      }
    }
    const context: FieldAccessMatchContext = {
      viewerPersonId: ownPersonId(request),
      managerByPerson: new Map(
        persons.map((person) => [person.id, person.managerPersonId]),
      ),
      activePersons: new Set(
        contracts
          .filter((contract) => contract.status === "ACTIVE")
          .map((contract) => contract.personId),
      ),
      orgNodesByPerson,
      legalEntityByPerson,
      heldCategories: new Set(
        retentionPolicies
          .filter((policy) => policy.legalHold)
          .map((policy) => policy.dataCategory),
      ),
    };
    fieldMatchCache.set(request, context);
    return context;
  }

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

  async function assertRedTeamEvidence(
    request: FastifyRequest,
    prompt: { modelProvider: string; modelName: string; version: number },
  ): Promise<void> {
    const tenant = await platformStore.getTenant(tenantOf(request));
    const required = Boolean(
      (tenant.settings as { requireRedTeamRun?: unknown })
        .requireRedTeamRun,
    );
    if (!required) return;
    const versions = [`v${prompt.version}`, String(prompt.version)];
    for (const version of versions) {
      const run = await platformStore.findPassedModelRedTeamRun(
        tenantOf(request),
        prompt.modelProvider,
        prompt.modelName,
        version,
      );
      if (run) return;
    }
    throw new ConflictError(
      `RED_TEAM_RUN_REQUIRED: no passed red-team run for ${prompt.modelProvider}/${prompt.modelName} v${prompt.version}`,
    );
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

  async function auditEventsForViewer(
    request: FastifyRequest,
    events: AuditEvent[],
  ): Promise<AuditEvent[]> {
    const redactions = await platformStore.listAuditRedactions(
      tenantOf(request),
    );
    return applyAuditRedactions(events, redactions);
  }

  function assertExportAllowed(request: FastifyRequest): void {
    const context = request.authContext;
    const actor = context?.personId ?? context?.userId ?? request.ip;
    const decision = exportLimiter.check(
      `${context?.tenantId ?? "unknown"}:${actor}`,
    );
    if (!decision.allowed) {
      countEvent("export_rate_limited");
      throw new TooManyRequestsError(
        "EXPORT_RATE_LIMITED",
        "too many exports; retry after the current window",
        decision.retryAfterSeconds,
      );
    }
  }

  async function assertExportDlp(
    request: FastifyRequest,
    text: string,
    targetType: string,
    targetId: string,
    approvalRequestId?: string,
  ): Promise<void> {
    let enabled = true;
    try {
      const tenant = await platformStore.getTenant(tenantOf(request));
      const configured = (
        tenant.settings as { exportDlpEnabled?: unknown }
      ).exportDlpEnabled;
      enabled = configured !== false;
    } catch {
      enabled = true;
    }
    if (!enabled) return;
    const findings = scanExportDlp(text);
    if (findings.length === 0) return;
    if (!approvalRequestId) {
      throw new ConflictError(
        `EXPORT_DLP_REVIEW_REQUIRED:${findings.join(",")}`,
      );
    }
    await consumeApprovalForAction(request, {
      approvalRequestId,
      actionType: "SENSITIVE_EXPORT",
      targetType,
      targetId,
    });
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
    let legacyPolicies: Record<string, FieldAccessPolicy> | undefined;
    try {
      const tenant = await platformStore.getTenant(tenantOf(request));
      const configured = (
        tenant.settings as { payrollFieldPolicies?: unknown }
      ).payrollFieldPolicies;
      if (configured && typeof configured === "object") {
        legacyPolicies = configured as Record<string, FieldAccessPolicy>;
      }
    } catch {
      legacyPolicies = undefined;
    }
    // The cross-resource matrix is authoritative; the legacy payroll map is
    // kept underneath it so existing tenants keep working.
    const policies = {
      ...(legacyPolicies ?? {}),
      ...((await fieldPoliciesFor(request)) ?? {}),
    };
    const matchContext = await fieldMatchContextFor(request, policies);
    return redactPayrollFields(run, {
      personId,
      roles,
      policies,
      breakGlass,
      matchContext,
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

  /**
   * Governance data already linked to the policy version can hard-block a
   * formal run. Free-text gate references stay evidence-only; when a tenant
   * uses the notice/consultation registries, those records must be complete.
   */
  async function formalCoverageBlockers(
    request: FastifyRequest,
    policyVersionId: string,
  ): Promise<string[]> {
    const tenantId = tenantOf(request);
    const blockers: string[] = [];
    const links = await platformStore.listPolicyNotices(
      tenantId,
      policyVersionId,
    );
    if (links.length > 0) {
      const notices = await platformStore.listNotices(tenantId);
      const byId = new Map(notices.map((notice) => [notice.id, notice]));
      for (const link of links) {
        const notice = byId.get(link.noticeId);
        if (!notice?.acknowledgementRequired) continue;
        const coverage = await platformStore.listAcknowledgements(
          tenantId,
          notice.id,
        );
        if (!coverage.summary.complete) {
          blockers.push(`NOTICE_ACKNOWLEDGEMENTS_INCOMPLETE:${notice.id}`);
        }
      }
    }
    const consultations = await platformStore.listConsultations(
      tenantId,
      policyVersionId,
    );
    if (
      consultations.length > 0 &&
      !consultations.some(
        (consultation) =>
          Boolean(consultation.endedAt) &&
          consultation.outcome !== "PENDING",
      )
    ) {
      blockers.push("DEMOCRATIC_CONSULTATION_NOT_CONCLUDED");
    }
    return blockers;
  }

  async function preflightBudget(
    request: FastifyRequest,
    input: CreateCalculationRunInput,
  ): Promise<void> {    if (!options.enforceBudgetPools || input.mode !== "FORMAL") return;
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
    if (
      !request.url.startsWith("/api/v1/webhooks/") &&
      !request.url.startsWith("/api/v1/esign/webhooks/")
    ) {
      return payload;
    }
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
    // Unauthenticated marketing/onboarding surface; routes apply their own guards.
    if (request.url.startsWith("/api/v1/public/")) return;
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
    if (error instanceof TooManyRequestsError) {
      reply.header("retry-after", String(error.retryAfterSeconds));
      return reply.status(429).send({
        ...errorBody(error.code, error.message),
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

  app.get("/api/v1/policy-versions/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await storeFor(request).getPolicy(idOf(request)), request);
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

  const slugify = (input: string): string =>
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "tenant";

  const signupAttempts = new Map<string, { count: number; resetAt: number }>();
  const publicSignupLimiter = {
    check(ip: string): boolean {
      const nowMs = Date.now();
      const entry = signupAttempts.get(ip);
      if (!entry || entry.resetAt <= nowMs) {
        signupAttempts.set(ip, { count: 1, resetAt: nowMs + 60 * 60 * 1000 });
        return true;
      }
      entry.count += 1;
      return entry.count <= 10;
    },
  };

  app.post("/api/v1/public/signup", async (request, reply) => {
    if (options.publicSignup === false) {
      return reply.status(404).send({
        ...errorBody("NOT_FOUND", "self-service signup is disabled"),
        meta: { correlation_id: request.id },
      });
    }
    if (!publicSignupLimiter.check(request.ip)) {
      return reply.status(429).send({
        ...errorBody("RATE_LIMITED", "too many signup attempts"),
        meta: { correlation_id: request.id },
      });
    }
    const body = parse(publicSignupSchema, request.body);
    const tenant = await platformStore.createTenant({
      name: body.companyName,
      slug: body.slug ?? slugify(body.companyName),
    });
    const user = await platformStore.createUser({
      authSubject: body.adminEmail,
      displayName: body.adminDisplayName,
      email: body.adminEmail,
    });
    await platformStore.addMembership({
      tenantId: tenant.id,
      userId: user.id,
      roleCodes: ["admin"],
    });
    const person = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "ADMIN-001",
      displayName: body.adminDisplayName,
      userId: user.id,
    });
    let subscription = null;
    if (body.planCode) {
      const plans = await platformStore.listSubscriptionPlans(true);
      const plan = plans.find((candidate) => candidate.code === body.planCode);
      if (plan) {
        const startedAt = new Date();
        const periodEnd = new Date(
          startedAt.getTime() + plan.trialDays * 24 * 60 * 60 * 1000,
        );
        subscription = await platformStore.setTenantSubscription({
          tenantId: tenant.id,
          planCode: plan.code,
          status: plan.trialDays > 0 ? "TRIALING" : "ACTIVE",
          seats: plan.seatLimit > 0 ? plan.seatLimit : 1,
          currentPeriodStart: startedAt.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
          trialEndsAt:
            plan.trialDays > 0 ? periodEnd.toISOString() : undefined,
        });
      }
    }
    countEvent("tenant_signed_up");
    return reply.status(201).send(
      data(
        {
          tenantId: tenant.id,
          slug: tenant.slug,
          userId: user.id,
          personId: person.id,
          subscription,
          nextSteps:
            "Sign in with your identity provider using the admin email as the auth subject, then complete onboarding in the console.",
        },
        request,
      ),
    );
  });

  app.get("/api/v1/public/plans", async (request) => {
    return data(await platformStore.listSubscriptionPlans(true), request);
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
    const tenantId = idOf(request);
    const tenant = await platformStore.getTenant(tenantId);
    const before = (
      tenant.settings as { fieldAccessPolicies?: unknown }
    ).fieldAccessPolicies;
    const updated = await platformStore.updateTenantSettings({
      tenantId,
      settings: body,
    });
    if (body.fieldAccessPolicies) {
      const auditStore =
        tenantId === tenantOf(request)
          ? storeFor(request)
          : typeof storeOrResolver === "function"
            ? storeOrResolver(tenantId)
            : undefined;
      await auditStore?.recordAuditEvent({
        actorType: "USER",
        actorId:
          request.authContext?.userId ?? request.authContext?.personId,
        action: "FIELD_ACCESS_POLICIES_UPDATED",
        objectType: "TENANT_SETTINGS",
        objectId: tenantId,
        beforeHash: sha256(before ?? {}),
        afterHash: sha256(body.fieldAccessPolicies),
        reason: `overrides=${Object.keys(body.fieldAccessPolicies).length}`,
      });
    }
    return data(updated, request);
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
    const tenantId = idOf(request);
    const subscription =
      await platformStore.getTenantSubscription(tenantId);
    if (subscription && subscription.status !== "CANCELED") {
      const plans = await platformStore.listSubscriptionPlans();
      const plan = plans.find(
        (candidate) => candidate.code === subscription.planCode,
      );
      const consumesSeat = (body.employmentStatus ?? "ACTIVE") === "ACTIVE";
      if (plan && plan.seatLimit >= 0 && consumesSeat) {
        const activePeople = (await platformStore.listPersons(tenantId)).filter(
          (candidate) => candidate.employmentStatus === "ACTIVE",
        ).length;
        if (activePeople >= plan.seatLimit) {
          return reply.status(402).send({
            ...errorBody(
              "SEAT_LIMIT_REACHED",
              `plan ${plan.code} allows ${plan.seatLimit} active people; upgrade the subscription to onboard more`,
            ),
            meta: { correlation_id: request.id },
          });
        }
      }
    }
    return reply.status(201).send(
      data(
        await platformStore.createPerson({
          tenantId,
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

  app.post("/api/v1/platform/plans", async (request, reply) => {
    requireRoles(request, "platform_admin");
    const body = parse(createSubscriptionPlanSchema, request.body);
    return reply
      .status(201)
      .send(
        data(
          await platformStore.createSubscriptionPlan({
            ...body,
            features: body.features ?? [],
          }),
          request,
        ),
      );
  });

  app.get("/api/v1/platform/plans", async (request) => {
    requireRoles(request, "platform_admin");
    return data(await platformStore.listSubscriptionPlans(false), request);
  });

  app.get("/api/v1/platform/tenants/:id/subscription", async (request) => {
    requireRoles(request, "platform_admin");
    const subscription = await platformStore.getTenantSubscription(
      idOf(request),
    );
    if (!subscription) throw new NotFoundError(`TenantSubscription ${idOf(request)} not found`);
    return data(subscription, request);
  });

  app.put("/api/v1/platform/tenants/:id/subscription", async (request) => {
    requireRoles(request, "platform_admin");
    const body = parse(setTenantSubscriptionSchema, request.body);
    return data(
      await platformStore.setTenantSubscription({
        tenantId: idOf(request),
        ...body,
      }),
      request,
    );
  });

  app.post("/api/v1/platform/tenants/:id/invoices", async (request, reply) => {
    requireRoles(request, "platform_admin");
    const body = parse(createTenantInvoiceSchema, request.body);
    return reply
      .status(201)
      .send(
        data(
          await platformStore.createInvoice({
            tenantId: idOf(request),
            ...body,
          }),
          request,
        ),
      );
  });

  app.get("/api/v1/platform/tenants/:id/invoices", async (request) => {
    requireRoles(request, "platform_admin");
    return data(await platformStore.listInvoices(idOf(request)), request);
  });

  app.post("/api/v1/platform/invoices/:id/status", async (request) => {
    requireRoles(request, "platform_admin");
    const body = parse(setTenantInvoiceStatusSchema, request.body);
    return data(
      await platformStore.setInvoiceStatus({
        invoiceId: idOf(request),
        status: body.status,
      }),
      request,
    );
  });

  app.get("/api/v1/me/subscription", async (request, reply) => {
    const subscription = await platformStore.getTenantSubscription(
      tenantOf(request),
    );
    if (!subscription) {
      return reply.status(404).send({
        ...errorBody("NOT_FOUND", "no subscription for this tenant"),
        meta: { correlation_id: request.id },
      });
    }
    return data(subscription, request);
  });

  app.get("/api/v1/me/invoices", async (request) => {
    return data(await platformStore.listInvoices(tenantOf(request)), request);
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

  app.post("/api/v1/policy-simulations:marginal", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(marginalSimulationSchema, request.body);
    const policy = await storeFor(request).getPolicy(body.policyVersionId);
    const tenantId =
      request.authContext?.tenantId ??
      (request.headers["x-tenant-id"] as string | undefined) ??
      "tenant-demo";
    return data(
      simulateMarginalChange(policy, { ...body.sample, tenantId }, {
        participantIndex: body.participantIndex,
        field: body.field,
        from: body.from,
        to: body.to,
        step: body.step,
      }),
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
          actorRole: body.actorRole,
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
    reply.redirect("/console/platform"),
  );

  app.get("/admin/governance", async (_request, reply) =>
    reply.redirect("/console/governance"),
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
    const query = request.query as { managerPersonId?: string };
    const tenantId = tenantOf(request);
    const people = await platformStore.listPersons(tenantId);
    const own = ownPersonId(request);
    let managerPersonId = query.managerPersonId ?? own;
    if (!isPrivileged(request)) {
      const self = own
        ? people.find((person) => person.id === own)
        : undefined;
      if (!self?.managerPersonId) {
        throw new ForbiddenError(
          "MANAGER_REQUIRED_FOR_TEAM_AGGREGATE: no manager is linked to this person",
        );
      }
      if (
        query.managerPersonId &&
        query.managerPersonId !== self.managerPersonId
      ) {
        throw new ForbiddenError(
          "an employee can only view their own team aggregate",
        );
      }
      managerPersonId = self.managerPersonId;
    }
    if (!managerPersonId) {
      throw new BadRequestError(
        "MANAGER_REQUIRED",
        "managerPersonId is required when no person is linked to the caller",
      );
    }
    const [
      decisions,
      attributionDecisions,
      claims,
      appeals,
      workPackages,
    ] = await Promise.all([
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
      attributionDecisions,
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
      subgroupAttributes,
    ] = await Promise.all([
      store.listPolicyVersions(),
      platformStore.listNotices(tenantId),
      store.listAppeals(),
      store.listClaims(),
      store.listDecisions(),
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
      platformStore.listWorkforceSubgroupAttributes(tenantId),
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
    const latestDecisionByClaim = new Map<
      string,
      (typeof attributionDecisions)[number]
    >();
    const decisionCountByClaim = new Map<string, number>();
    const statusesByClaim = new Map<string, Set<string>>();
    for (const decision of attributionDecisions) {
      const current = latestDecisionByClaim.get(decision.claimId);
      if (
        !current ||
        decision.decisionVersion > current.decisionVersion
      ) {
        latestDecisionByClaim.set(decision.claimId, decision);
      }
      decisionCountByClaim.set(
        decision.claimId,
        (decisionCountByClaim.get(decision.claimId) ?? 0) + 1,
      );
      const statuses =
        statusesByClaim.get(decision.claimId) ?? new Set<string>();
      statuses.add(decision.status);
      statusesByClaim.set(decision.claimId, statuses);
    }
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    const reviewerStats = new Map<
      string,
      {
        decisions: number;
        confirmed: number;
        partiallyConfirmed: number;
        rejected: number;
        totalDays: number;
        timedDecisions: number;
      }
    >();
    for (const decision of latestDecisionByClaim.values()) {
      const stats = reviewerStats.get(decision.adjudicatorPersonId) ?? {
        decisions: 0,
        confirmed: 0,
        partiallyConfirmed: 0,
        rejected: 0,
        totalDays: 0,
        timedDecisions: 0,
      };
      stats.decisions += 1;
      if (decision.status === "CONFIRMED") stats.confirmed += 1;
      if (decision.status === "PARTIALLY_CONFIRMED") {
        stats.partiallyConfirmed += 1;
      }
      if (decision.status === "REJECTED") stats.rejected += 1;
      const submittedAt = claimById.get(decision.claimId)?.submittedAt;
      if (submittedAt) {
        const days =
          (Date.parse(decision.createdAt) - Date.parse(submittedAt)) /
          (24 * 60 * 60 * 1000);
        if (Number.isFinite(days) && days >= 0) {
          stats.totalDays += days;
          stats.timedDecisions += 1;
        }
      }
      reviewerStats.set(decision.adjudicatorPersonId, stats);
    }
    const repeatedClaims = [...decisionCountByClaim.values()].filter(
      (count) => count > 1,
    ).length;
    const changedOutcomeClaims = [...statusesByClaim.values()].filter(
      (statuses) => statuses.size > 1,
    ).length;
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
        reviewConsistency: {
          reviewers: [...reviewerStats.entries()].map(
            ([reviewerPersonId, stats]) => ({
              reviewerPersonId,
              decisions: stats.decisions,
              confirmedRate:
                stats.decisions === 0
                  ? 0
                  : stats.confirmed / stats.decisions,
              partiallyConfirmedRate:
                stats.decisions === 0
                  ? 0
                  : stats.partiallyConfirmed / stats.decisions,
              rejectedRate:
                stats.decisions === 0
                  ? 0
                  : stats.rejected / stats.decisions,
              averageDaysToDecision:
                stats.timedDecisions === 0
                  ? 0
                  : Math.round(
                      (stats.totalDays / stats.timedDecisions) * 10,
                    ) / 10,
            }),
          ),
          claimsDecided: latestDecisionByClaim.size,
          claimsWithMultipleDecisions: repeatedClaims,
          claimsWithChangedOutcome: changedOutcomeClaims,
          subgroupImpact: {
            available: subgroupAttributes.some(
              (attribute) =>
                !attribute.expiresAt ||
                Date.parse(attribute.expiresAt) > Date.now(),
            ),
            note:
              subgroupAttributes.length > 0
                ? "See GET /reports/subgroup-impact for suppressed aggregate metrics; protected labels are never used for individual decisions."
                : "No consent-backed subgroup labels are recorded; review by role/location remains available through stratified coverage.",
          },
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
          highRiskProposals: proposals.filter(
            (proposal) =>
              proposal.riskTier === "HIGH" ||
              proposal.riskTier === "CRITICAL",
          ).length,
          secondReviewSlaBreaches: proposals.filter(
            (proposal) => proposal.secondReviewSlaBreached,
          ).length,
          secondReviewOverdue: proposals.filter(
            (proposal) =>
              proposal.status === "PENDING" &&
              proposal.secondReviewRequired &&
              Boolean(proposal.secondReviewDueAt) &&
              Date.parse(proposal.secondReviewDueAt as string) < Date.now(),
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
          available: subgroupAttributes.some(
            (attribute) =>
              !attribute.expiresAt ||
              Date.parse(attribute.expiresAt) > Date.now(),
          ),
          note:
            subgroupAttributes.length > 0
              ? "See GET /reports/subgroup-impact for suppressed aggregate metrics; protected labels are never used for individual decisions."
              : "No consent-backed subgroup labels are recorded; review by role/location remains available through stratified coverage.",
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
      decisions,
      confirmations,
      payrollRuns,
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
      store.listDecisions(),
      store.listConfirmations(),
      platformStore.listPayrollRuns(tenantId),
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
    const packageTypeCoverage = new Map<
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
      const packageType = workPackage.packageType ?? "UNSPECIFIED";
      const currentPackage = packageTypeCoverage.get(packageType) ?? {
        total: 0,
        withEvidence: 0,
      };
      currentPackage.total += 1;
      if (hasEvidence) currentPackage.withEvidence += 1;
      packageTypeCoverage.set(packageType, currentPackage);
    }
    // Monthly trend uses acceptance time (updatedAt when ACCEPTED) as the
    // period bucket so the series can be compared across cycles over time.
    const coverageTrend = new Map<
      string,
      { total: number; withEvidence: number }
    >();
    const coverageTrendByPackageType = new Map<
      string,
      Map<string, { total: number; withEvidence: number }>
    >();
    for (const workPackage of acceptedPackages) {
      const acceptedAt = new Date(workPackage.updatedAt);
      if (Number.isNaN(acceptedAt.getTime())) continue;
      const period = acceptedAt.toISOString().slice(0, 7);
      const hasEvidence = evidenceSubjects.has(workPackage.id);
      const periodTotals = coverageTrend.get(period) ?? {
        total: 0,
        withEvidence: 0,
      };
      periodTotals.total += 1;
      if (hasEvidence) periodTotals.withEvidence += 1;
      coverageTrend.set(period, periodTotals);
      const packageType = workPackage.packageType ?? "UNSPECIFIED";
      const byPeriod =
        coverageTrendByPackageType.get(packageType) ??
        new Map<string, { total: number; withEvidence: number }>();
      const typeTotals = byPeriod.get(period) ?? {
        total: 0,
        withEvidence: 0,
      };
      typeTotals.total += 1;
      if (hasEvidence) typeTotals.withEvidence += 1;
      byPeriod.set(period, typeTotals);
      coverageTrendByPackageType.set(packageType, byPeriod);
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
    const acceptanceHours = acceptedPackages
      .map(
        (workPackage) =>
          (Date.parse(workPackage.updatedAt) -
            Date.parse(workPackage.createdAt)) /
          (60 * 60 * 1000),
      )
      .filter((value) => Number.isFinite(value) && value >= 0);
    const latestDecisionByClaim = new Map<
      string,
      (typeof decisions)[number]
    >();
    for (const decision of decisions) {
      const current = latestDecisionByClaim.get(decision.claimId);
      if (
        !current ||
        decision.decisionVersion > current.decisionVersion
      ) {
        latestDecisionByClaim.set(decision.claimId, decision);
      }
    }
    const workPackageById = new Map(
      workPackages.map((workPackage) => [workPackage.id, workPackage]),
    );
    const rolesByPerson = new Map<string, Set<string>>();
    const addPersonRole = (personId: string, role: string): void => {
      const roles = rolesByPerson.get(personId) ?? new Set<string>();
      roles.add(role);
      rolesByPerson.set(personId, roles);
    };
    for (const workPackage of workPackages) {
      for (const member of workPackage.members) {
        addPersonRole(member.personId, member.responsibilityCode);
      }
      addPersonRole(workPackage.ownerPersonId, "OWNER");
    }
    const rolesOfPerson = (personId: string): string[] => {
      const roles = rolesByPerson.get(personId);
      return roles && roles.size > 0 ? [...roles] : ["UNKNOWN"];
    };
    const acceptanceHoursByRole = new Map<string, number[]>();
    for (const workPackage of acceptedPackages) {
      const hours =
        (Date.parse(workPackage.updatedAt) -
          Date.parse(workPackage.createdAt)) /
        (60 * 60 * 1000);
      if (!Number.isFinite(hours) || hours < 0) continue;
      const roles = new Set(
        workPackage.members.map((member) => member.responsibilityCode),
      );
      if (roles.size === 0) roles.add("OWNER");
      for (const role of roles) {
        const values = acceptanceHoursByRole.get(role) ?? [];
        values.push(hours);
        acceptanceHoursByRole.set(role, values);
      }
    }
    const claimDecisionHoursByRole = new Map<string, number[]>();
    for (const claim of claims) {
      const decision = latestDecisionByClaim.get(claim.id);
      if (!decision) continue;
      const hours =
        (Date.parse(decision.createdAt) -
          Date.parse(claim.submittedAt ?? claim.createdAt)) /
        (60 * 60 * 1000);
      if (!Number.isFinite(hours) || hours < 0) continue;
      const workPackage = workPackageById.get(claim.workPackageId);
      const role =
        workPackage?.members.find(
          (member) => member.personId === claim.claimantPersonId,
        )?.responsibilityCode ??
        (workPackage?.ownerPersonId === claim.claimantPersonId
          ? "OWNER"
          : "UNKNOWN");
      const values = claimDecisionHoursByRole.get(role) ?? [];
      values.push(hours);
      claimDecisionHoursByRole.set(role, values);
    }
    const claimDecisionHours = claims
      .map((claim) => {
        const decision = latestDecisionByClaim.get(claim.id);
        if (!decision) return undefined;
        const from = Date.parse(claim.submittedAt ?? claim.createdAt);
        const to = Date.parse(decision.createdAt);
        return (to - from) / (60 * 60 * 1000);
      })
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0,
      );
    const runById = new Map(runs.map((run) => [run.id, run]));
    const confirmationHours = confirmations
      .map((confirmation) => {
        if (confirmation.targetType !== "CALCULATION") return undefined;
        const run = runById.get(confirmation.targetId);
        if (!run) return undefined;
        const from = Date.parse(run.calculatedAt ?? run.createdAt);
        const to = Date.parse(
          confirmation.confirmedAt ??
            confirmation.objectedAt ??
            confirmation.createdAt,
        );
        return (to - from) / (60 * 60 * 1000);
      })
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0,
      );
    const payrollApprovalHours = payrollRuns
      .filter((run) => Boolean(run.approvedAt))
      .map(
        (run) =>
          (Date.parse(run.approvedAt as string) -
            Date.parse(run.createdAt)) /
          (60 * 60 * 1000),
      )
      .filter((value) => Number.isFinite(value) && value >= 0);
    const appealResolutionHours = appeals
      .filter((appeal) => Boolean(appeal.resolvedAt))
      .map(
        (appeal) =>
          (Date.parse(appeal.resolvedAt as string) -
            Date.parse(appeal.createdAt)) /
          (60 * 60 * 1000),
      )
      .filter((value) => Number.isFinite(value) && value >= 0);
    const pushByRole = (
      target: Map<string, number[]>,
      roles: Iterable<string>,
      hours: number,
    ): void => {
      if (!Number.isFinite(hours) || hours < 0) return;
      for (const role of new Set(roles)) {
        const values = target.get(role) ?? [];
        values.push(hours);
        target.set(role, values);
      }
    };
    const confirmationHoursByRole = new Map<string, number[]>();
    for (const confirmation of confirmations) {
      if (confirmation.targetType !== "CALCULATION") continue;
      const run = runById.get(confirmation.targetId);
      if (!run) continue;
      pushByRole(
        confirmationHoursByRole,
        rolesOfPerson(confirmation.personId),
        (Date.parse(
          confirmation.confirmedAt ??
            confirmation.objectedAt ??
            confirmation.createdAt,
        ) -
          Date.parse(run.calculatedAt ?? run.createdAt)) /
          (60 * 60 * 1000),
      );
    }
    const payrollApprovalHoursByRole = new Map<string, number[]>();
    for (const run of payrollRuns) {
      if (!run.approvedAt) continue;
      const hours =
        (Date.parse(run.approvedAt) - Date.parse(run.createdAt)) /
        (60 * 60 * 1000);
      const roles = new Set<string>();
      for (const line of run.lines ?? []) {
        rolesOfPerson(line.personId).forEach((role) => roles.add(role));
      }
      pushByRole(payrollApprovalHoursByRole, roles, hours);
    }
    const appealResolutionHoursByRole = new Map<string, number[]>();
    for (const appeal of appeals) {
      if (!appeal.resolvedAt) continue;
      pushByRole(
        appealResolutionHoursByRole,
        rolesOfPerson(appeal.appellantPersonId),
        (Date.parse(appeal.resolvedAt) - Date.parse(appeal.createdAt)) /
          (60 * 60 * 1000),
      );
    }
    const average = (values: number[]): number =>
      values.length === 0
        ? 0
        : Math.round(
            (values.reduce((sum, value) => sum + value, 0) /
              values.length) *
              10,
          ) / 10;
    const responsibilityCycleRoles = new Set([
      ...acceptanceHoursByRole.keys(),
      ...claimDecisionHoursByRole.keys(),
      ...confirmationHoursByRole.keys(),
      ...payrollApprovalHoursByRole.keys(),
      ...appealResolutionHoursByRole.keys(),
    ]);
    const cycleTimesByResponsibility = [...responsibilityCycleRoles]
      .sort()
      .map((responsibilityCode) => {
        const acceptance = acceptanceHoursByRole.get(responsibilityCode) ?? [];
        const claimHours =
          claimDecisionHoursByRole.get(responsibilityCode) ?? [];
        const confirmationHoursForRole =
          confirmationHoursByRole.get(responsibilityCode) ?? [];
        const payrollHoursForRole =
          payrollApprovalHoursByRole.get(responsibilityCode) ?? [];
        const appealHoursForRole =
          appealResolutionHoursByRole.get(responsibilityCode) ?? [];
        return {
          responsibilityCode,
          workPackageAcceptanceHours: average(acceptance),
          workPackageSamples: acceptance.length,
          claimDecisionHours: average(claimHours),
          claimSamples: claimHours.length,
          confirmationHours: average(confirmationHoursForRole),
          confirmationSamples: confirmationHoursForRole.length,
          payrollApprovalHours: average(payrollHoursForRole),
          payrollSamples: payrollHoursForRole.length,
          appealResolutionHours: average(appealHoursForRole),
          appealSamples: appealHoursForRole.length,
        };
      });
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
        coverageByPackageType: [...packageTypeCoverage.entries()]
          .map(([packageType, value]) => ({
            packageType,
            total: value.total,
            withEvidence: value.withEvidence,
            coverageRate: ratio(value.withEvidence, value.total),
          }))
          .sort((a, b) => a.packageType.localeCompare(b.packageType)),
        coverageTrend: [...coverageTrend.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([period, value]) => ({
            period,
            total: value.total,
            withEvidence: value.withEvidence,
            coverageRate: ratio(value.withEvidence, value.total),
          })),
        coverageTrendByPackageType: [
          ...coverageTrendByPackageType.entries(),
        ]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([packageType, periods]) => ({
            packageType,
            periods: [...periods.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([period, value]) => ({
                period,
                total: value.total,
                withEvidence: value.withEvidence,
                coverageRate: ratio(value.withEvidence, value.total),
              })),
          })),
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
      cycleTimes: {
        workPackageAcceptanceHours: average(acceptanceHours),
        claimDecisionHours: average(claimDecisionHours),
        confirmationHours: average(confirmationHours),
        payrollApprovalHours: average(payrollApprovalHours),
        appealResolutionHours: average(appealResolutionHours),
        byResponsibility: cycleTimesByResponsibility,
      },
    };
    return data(report, request);
  });

  app.get("/api/v1/reports/success-metrics", async (request) => {
    requireRoles(request, "manager", "finance");
    const store = storeFor(request);
    const [
      workPackages,
      claims,
      evidence,
      appeals,
      decisions,
      runs,
      batches,
      dataQualityIssues,
      persons,
      trustSurveys,
    ] = await Promise.all([
      store.listWorkPackages(),
      store.listClaims(),
      store.listEvidence(),
      store.listAppeals(),
      store.listDecisions(),
      store.listRuns(),
      store.listSettlementBatches(),
      store.listDataQualityIssues(),
      platformStore.listPersons(tenantOf(request)),
      platformStore.listTrustSurveys(tenantOf(request)),
    ]);
    const accepted = workPackages.filter(
      (workPackage) => workPackage.status === "ACCEPTED",
    );
    const evidenceSubjects = new Set(
      evidence
        .filter((node) => node.subjectType === "WORK_PACKAGE")
        .map((node) => node.subjectId),
    );
    const withEvidence = accepted.filter((workPackage) =>
      evidenceSubjects.has(workPackage.id),
    ).length;
    const coverage =
      accepted.length === 0 ? 0 : withEvidence / accepted.length;
    const latestDecisionByClaim = new Map<
      string,
      (typeof decisions)[number]
    >();
    for (const decision of decisions) {
      const current = latestDecisionByClaim.get(decision.claimId);
      if (!current || decision.decisionVersion > current.decisionVersion) {
        latestDecisionByClaim.set(decision.claimId, decision);
      }
    }
    const decisionHours = claims
      .map((claim) => {
        const decision = latestDecisionByClaim.get(claim.id);
        if (!decision) return undefined;
        return (
          (Date.parse(decision.createdAt) -
            Date.parse(claim.submittedAt ?? claim.createdAt)) /
          (60 * 60 * 1000)
        );
      })
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0,
      );
    const managerIds = new Set(
      persons
        .map((person) => person.managerPersonId)
        .filter((value): value is string => Boolean(value)),
    );
    const managerDecisionHours = claims
      .map((claim) => {
        const decision = latestDecisionByClaim.get(claim.id);
        if (!decision || !managerIds.has(decision.adjudicatorPersonId)) {
          return undefined;
        }
        return (
          (Date.parse(decision.createdAt) -
            Date.parse(claim.submittedAt ?? claim.createdAt)) /
          (60 * 60 * 1000)
        );
      })
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0,
      );
    const managerReviewHours =
      managerDecisionHours.length === 0
        ? null
        : Math.round(
            (managerDecisionHours.reduce((sum, value) => sum + value, 0) /
              managerDecisionHours.length) *
              10,
          ) / 10;
    const evidenceSupplementMinutes = dataQualityIssues
      .filter(
        (issue) =>
          /EVIDENCE/i.test(issue.issueCode) && Boolean(issue.resolvedAt),
      )
      .map(
        (issue) =>
          (Date.parse(issue.resolvedAt as string) -
            Date.parse(issue.createdAt)) /
          (60 * 1000),
      )
      .filter((value) => Number.isFinite(value) && value >= 0);
    const evidenceSupplementAvg =
      evidenceSupplementMinutes.length === 0
        ? null
        : Math.round(
            (evidenceSupplementMinutes.reduce((sum, value) => sum + value, 0) /
              evidenceSupplementMinutes.length) *
              10,
          ) / 10;
    const latestClosedSurvey = trustSurveys
      .filter((survey) => survey.status === "CLOSED")
      .sort((a, b) =>
        (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt),
      )[0];
    const trustReport = latestClosedSurvey
      ? await platformStore.getTrustSurveyReport(
          tenantOf(request),
          latestClosedSurvey.id,
        )
      : undefined;
    const meanOf = (values: Record<string, number>): number | null => {
      const numbers = Object.values(values);
      if (numbers.length === 0) return null;
      return (
        Math.round(
          (numbers.reduce((sum, value) => sum + value, 0) / numbers.length) *
            100,
        ) / 100
      );
    };
    const trustCurrent = trustReport ? meanOf(trustReport.dimensions) : null;
    const trustBaseline = trustReport?.baseline
      ? meanOf(trustReport.baseline.dimensions)
      : null;
    const disputeRate =
      claims.length === 0 ? 0 : appeals.length / claims.length;
    const reconciliationDifferences =
      batches.filter((batch) => batch.status === "ADJUSTMENT_REQUIRED")
        .length +
      runs.filter((run) => run.status === "RECONCILIATION_REQUIRED")
        .length;
    const metrics = [
      {
        id: "EVIDENCE_COVERAGE",
        label: "Evidence coverage",
        value: Math.round(coverage * 10000) / 10000,
        unit: "RATIO",
        target: 0.7,
        comparator: "GTE",
        status: coverage >= 0.7 ? "PASS" : "FAIL",
        note: "Accepted work packages with at least one work-package evidence node.",
      },
      {
        id: "MANAGER_REVIEW_HOURS",
        label: "Manager review time",
        value: managerReviewHours,
        unit: "HOURS",
        target: 2,
        comparator: "LTE",
        status:
          managerReviewHours === null
            ? "UNAVAILABLE"
            : managerReviewHours <= 2
              ? "PASS"
              : "FAIL",
        note: "Claims whose latest decision was issued by a person with direct reports; submission to decision.",
      },
      {
        id: "CONTRIBUTION_DISPUTE_RATE",
        label: "Contribution dispute rate",
        value: Math.round(disputeRate * 10000) / 10000,
        unit: "RATIO",
        target: 0.1,
        comparator: "LT",
        status: disputeRate < 0.1 ? "PASS" : "FAIL",
        note: "Appeals divided by claims; target is below 10%.",
      },
      {
        id: "RECONCILIATION_DIFFERENCES",
        label: "Reconciliation differences",
        value: reconciliationDifferences,
        unit: "COUNT",
        target: 0,
        comparator: "EQ",
        status: reconciliationDifferences === 0 ? "PASS" : "FAIL",
        note: "Settlement batches in ADJUSTMENT_REQUIRED plus calculation runs in RECONCILIATION_REQUIRED.",
      },
      {
        id: "EMPLOYEE_EVIDENCE_MINUTES",
        label: "Employee evidence supplement time",
        value: evidenceSupplementAvg,
        unit: "MINUTES",
        target: 30,
        comparator: "LTE",
        status:
          evidenceSupplementAvg === null
            ? "UNAVAILABLE"
            : evidenceSupplementAvg <= 30
              ? "PASS"
              : "FAIL",
        note: "Proxy: resolved data-quality issues about evidence, from issue creation to resolution. No session or activity tracking is used.",
      },
      {
        id: "TRUST_VS_BASELINE",
        label: "Trust vs baseline",
        value: trustCurrent,
        unit: "RATIO",
        target: trustBaseline ?? 0,
        comparator: "GTE",
        status:
          trustCurrent === null || trustBaseline === null
            ? "UNAVAILABLE"
            : trustCurrent >= trustBaseline
              ? "PASS"
              : "FAIL",
        note: "Mean of the latest closed trust-survey dimensions versus the previous closed survey with the same code.",
      },
    ];
    return data(
      {
        generatedAt: new Date().toISOString(),
        overall: metrics.some((metric) => metric.status === "FAIL")
          ? "FAIL"
          : metrics.some((metric) => metric.status === "UNAVAILABLE")
            ? "PARTIAL"
            : "PASS",
        metrics,
      },
      request,
    );
  });

  app.get("/api/v1/reports/agent-metrics", async (request) => {
    requireRoles(request, "manager", "finance");
    const tasks = await runtimeFor(request).list();
    return data(summarizeAgentMetrics(tasks), request);
  });

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

  app.post("/api/v1/strategic-pool-cases", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createStrategicPoolCaseSchema, request.body);
    if (parseDecimal(body.poolAmount) > parseDecimal(body.capAmount)) {
      throw new ConflictError(
        "STRATEGIC_POOL_EXCEEDS_CAP: poolAmount must not exceed capAmount",
      );
    }
    if (body.budgetPoolId) {
      const pool = await platformStore.getBudgetPool(
        tenantOf(request),
        body.budgetPoolId,
      );
      if (pool.status !== "APPROVED") {
        throw new ConflictError(
          `BUDGET_POOL_NOT_APPROVED: pool is ${pool.status}`,
        );
      }
      const available =
        parseDecimal(pool.approvedAmount) - parseDecimal(pool.committedAmount);
      if (parseDecimal(body.poolAmount) > available) {
        throw new ConflictError(
          "STRATEGIC_POOL_EXCEEDS_BUDGET: poolAmount exceeds the budget pool's uncommitted amount",
        );
      }
    }
    return reply.status(201).send(
      data(
        await platformStore.createStrategicPoolCase({
          tenantId: tenantOf(request),
          ...body,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/strategic-pool-cases", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listStrategicPoolCases(tenantOf(request)),
      request,
    );
  });

  async function strategicPoolOf(
    request: FastifyRequest,
  ): Promise<{ record: StrategicPoolCase }> {
    const records = await platformStore.listStrategicPoolCases(
      tenantOf(request),
    );
    const record = records.find((candidate) => candidate.id === idOf(request));
    if (!record) {
      throw new NotFoundError(`StrategicPoolCase ${idOf(request)} not found`);
    }
    return { record };
  }

  app.post("/api/v1/strategic-pool-cases/:id/cost-review", async (request) => {
    requireRoles(request, "finance");
    const body = parse(strategicPoolCostReviewSchema, request.body);
    const { record } = await strategicPoolOf(request);
    if (record.status !== "DRAFT") {
      throw new ConflictError(
        `STRATEGIC_POOL_NOT_DRAFT: case is ${record.status}`,
      );
    }
    const total = parseDecimal(body.unitStandardCost) * BigInt(body.units);
    const updated = await platformStore.updateStrategicPoolCase({
      tenantId: tenantOf(request),
      caseId: record.id,
      patch: {
        units: body.units,
        unitStandardCost: body.unitStandardCost,
        totalStandardCost: formatDecimal(total),
        transferPricingRef: body.transferPricingRef,
        costReviewedBy: body.reviewedBy,
        costReviewedAt: new Date().toISOString(),
        status: "COST_REVIEWED",
      },
    });
    countEvent("strategic_pool_cost_reviewed");
    return data(updated, request);
  });

  app.post("/api/v1/strategic-pool-cases/:id/finance-approve", async (request) => {
    requireRoles(request, "admin", "finance");
    const body = parse(strategicPoolFinanceApproveSchema, request.body);
    const { record } = await strategicPoolOf(request);
    if (record.status !== "COST_REVIEWED") {
      throw new ConflictError(
        `STRATEGIC_POOL_NOT_COST_REVIEWED: case is ${record.status}`,
      );
    }
    if (body.approvedBy === record.requestedBy) {
      throw new ConflictError(
        "STRATEGIC_POOL_SELF_APPROVAL: finance approver must differ from the requester",
      );
    }
    if (parseDecimal(record.poolAmount) > parseDecimal(record.capAmount)) {
      throw new ConflictError("STRATEGIC_POOL_EXCEEDS_CAP");
    }
    const updated = await platformStore.updateStrategicPoolCase({
      tenantId: tenantOf(request),
      caseId: record.id,
      patch: {
        financeApprovedBy: body.approvedBy,
        financeApprovedAt: new Date().toISOString(),
        deferredInstallmentMonths: body.deferredInstallmentMonths,
        status: "FINANCE_APPROVED",
      },
    });
    countEvent("strategic_pool_finance_approved");
    return data(updated, request);
  });

  app.post("/api/v1/strategic-pool-cases/:id/activate", async (request) => {
    requireRoles(request, "admin", "finance");
    const { record } = await strategicPoolOf(request);
    if (record.status !== "FINANCE_APPROVED") {
      throw new ConflictError(
        `STRATEGIC_POOL_NOT_FINANCE_APPROVED: case is ${record.status}`,
      );
    }
    const updated = await platformStore.updateStrategicPoolCase({
      tenantId: tenantOf(request),
      caseId: record.id,
      patch: {
        status: "ACTIVE",
        activatedAt: new Date().toISOString(),
      },
    });
    countEvent("strategic_pool_activated");
    return data(updated, request);
  });

  app.post("/api/v1/strategic-pool-cases/:id/settle", async (request) => {
    requireRoles(request, "finance");
    const { record } = await strategicPoolOf(request);
    if (record.status !== "ACTIVE") {
      throw new ConflictError(
        `STRATEGIC_POOL_NOT_ACTIVE: case is ${record.status}`,
      );
    }
    const updated = await platformStore.updateStrategicPoolCase({
      tenantId: tenantOf(request),
      caseId: record.id,
      patch: {
        status: "SETTLED",
        settledAt: new Date().toISOString(),
      },
    });
    countEvent("strategic_pool_settled");
    return data(updated, request);
  });

  app.post("/api/v1/clawback-cases/:id/generate-recovery", async (request) => {
    requireRoles(request, "finance");
    const body = parse(generateClawbackRecoverySchema, request.body);
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const cases = await platformStore.listClawbackCases(tenantId);
    const clawback = cases.find((candidate) => candidate.id === idOf(request));
    if (!clawback) {
      throw new NotFoundError(`ClawbackCase ${idOf(request)} not found`);
    }
    if (clawback.status !== "APPROVED") {
      throw new ConflictError(
        `CLAWBACK_NOT_APPROVED: case is ${clawback.status}`,
      );
    }
    // Idempotency: one recovery adjustment per case, ever.
    const idempotencyKey = `clawback-recovery:${clawback.id}`;
    const duplicate = (await store.listLedger()).some(
      (entry) => entry.idempotencyKey === idempotencyKey,
    );
    if (duplicate) {
      throw new ConflictError(
        "CLAWBACK_RECOVERY_ALREADY_GENERATED: this case already has a recovery adjustment",
      );
    }
    const { entry, record } = await store.adjustLedgerEntry(
      body.ledgerEntryId,
      {
        amount: `-${clawback.amount}`,
        reasonCode: "CLAWBACK_RECOVERY",
        explanation: `Clawback case ${clawback.id}: ${clawback.reasonCode}`,
        approvedBy: clawback.approvedBy ?? request.authContext!.userId,
        idempotencyKey,
      },
    );
    let batch = null;
    if (body.createBatch !== false) {
      batch = await store.createSettlementBatch({
        cycleId: body.cycleId,
        kind: "RECOVERY",
      });
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
          title: "Clawback recovery requires confirmation",
          body: `Batch ${batch.batchNo} carries a clawback recovery for case ${clawback.id}; please review and confirm or object.`,
          sourceType: "SETTLEMENT_BATCH",
          sourceId: batch.id,
        });
      }
    }
    countEvent("clawback_recovery_generated");
    return data(
      {
        caseId: clawback.id,
        adjustmentRecordId: record.id,
        ledgerEntryId: entry.id,
        recoveryBatch: batch,
      },
      request,
    );
  });

  app.get("/api/v1/clawback-cases/:id/schedule", async (request) => {
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const cases = await platformStore.listClawbackCases(tenantId);
    const clawback = cases.find((candidate) => candidate.id === idOf(request));
    if (!clawback) {
      throw new NotFoundError(`ClawbackCase ${idOf(request)} not found`);
    }
    const contracts = await platformStore.listEmploymentContracts(
      tenantId,
      clawback.personId,
    );
    const contract = contracts.find(
      (candidate) =>
        candidate.status === "ACTIVE" &&
        candidate.currency === clawback.currency &&
        Date.parse(candidate.startDate) <= Date.now() &&
        (!candidate.endDate ||
          Date.parse(candidate.endDate) >= Date.now()),
    );
    if (!contract) {
      return data(
        {
          caseId: clawback.id,
          caseStatus: clawback.status,
          available: false,
          reason: "NO_ACTIVE_CONTRACT_FOR_CURRENCY",
          installments: [],
        },
        request,
      );
    }
    const fixed = parseDecimal(contract.fixedMonthlySalary);
    const minimum = parseDecimal(contract.minimumMonthlyWage);
    const capRate = parseDecimal(contract.deductionCapRate || "0.2");
    const capByRate = (fixed * capRate) / 1_000_000n;
    const capByMinimum = fixed - minimum;
    const capCandidate = capByRate < capByMinimum ? capByRate : capByMinimum;
    const capAmount = capCandidate > 0n ? capCandidate : 0n;
    const total = parseDecimal(clawback.amount);
    const months = BigInt(clawback.installmentMonths);
    const base = total / months;
    const anchor = new Date(clawback.approvedAt ?? clawback.createdAt);
    let allocated = 0n;
    let blockedCount = 0;
    const installments = Array.from(
      { length: clawback.installmentMonths },
      (_, index) => {
        const amount =
          index === clawback.installmentMonths - 1
            ? total - allocated
            : base;
        allocated += amount;
        const remainingWage = fixed - amount;
        const minimumWagePassed = remainingWage >= minimum;
        const deductionCapPassed = amount <= capAmount;
        if (!minimumWagePassed || !deductionCapPassed) blockedCount += 1;
        const dueDate = new Date(anchor);
        dueDate.setUTCMonth(dueDate.getUTCMonth() + index);
        return {
          sequence: index + 1,
          dueDate: dueDate.toISOString().slice(0, 10),
          amount: formatDecimal(amount),
          remainingWage: formatDecimal(remainingWage),
          deductionCapAmount: formatDecimal(capAmount),
          minimumWagePassed,
          deductionCapPassed,
        };
      },
    );
    return data(
      {
        caseId: clawback.id,
        caseStatus: clawback.status,
        available: true,
        contractId: contract.id,
        currency: clawback.currency,
        totalAmount: formatDecimal(total),
        installmentMonths: clawback.installmentMonths,
        fixedMonthlySalary: contract.fixedMonthlySalary,
        minimumMonthlyWage: contract.minimumMonthlyWage,
        deductionCapRate: formatDecimal(capRate),
        deductionCapAmount: formatDecimal(capAmount),
        minimumWagePassed: installments.every(
          (installment) => installment.minimumWagePassed,
        ),
        deductionCapPassed: installments.every(
          (installment) => installment.deductionCapPassed,
        ),
        blockedCount,
        scheduleHash: sha256({
          caseId: clawback.id,
          contractId: contract.id,
          total: formatDecimal(total),
          months: clawback.installmentMonths,
          installments,
        }),
        installments,
      },
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

  app.get("/api/v1/model-evaluation-datasets/refresh-due", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { withinDays?: string };
    const withinDays = Number(query.withinDays ?? 30);
    const cutoff =
      Date.now() +
      (Number.isFinite(withinDays) ? withinDays : 30) *
        24 *
        60 *
        60 *
        1000;
    const datasets = await platformStore.listModelEvaluationDatasets(
      tenantOf(request),
    );
    return data(
      datasets.filter(
        (dataset) =>
          dataset.status === "ACTIVE" &&
          Boolean(dataset.nextRefreshDueAt) &&
          Date.parse(dataset.nextRefreshDueAt as string) <= cutoff,
      ),
      request,
    );
  });

  app.post("/api/v1/model-evaluation-datasets/:id/refresh", async (request) => {
    requireRoles(request, "manager");
    const body = parse(refreshModelEvaluationDatasetSchema, request.body);
    const tenantId = tenantOf(request);
    const datasets = await platformStore.listModelEvaluationDatasets(tenantId);
    const current = datasets.find(
      (dataset) => dataset.id === idOf(request),
    );
    if (!current) {
      throw new NotFoundError(
        `ModelEvaluationDataset ${idOf(request)} not found`,
      );
    }
    if (current.status !== "ACTIVE") {
      throw new ConflictError(
        `model evaluation dataset is ${current.status}`,
      );
    }
    const sameCode = datasets.filter(
      (dataset) => dataset.code === current.code,
    );
    const version =
      body.version ??
      Math.max(...sameCode.map((dataset) => dataset.version)) + 1;
    const sampleSize = body.sampleSize ?? current.sampleSize;
    const holdoutSize = body.holdoutSize ?? current.holdoutSize;
    if (holdoutSize >= sampleSize) {
      throw new ConflictError(
        "GOLD_SET_HOLDOUT_TOO_LARGE: holdout must be smaller than sample",
      );
    }
    const refreshed = await platformStore.createModelEvaluationDataset({
      tenantId,
      code: current.code,
      version,
      name: body.name ?? current.name,
      sampleSize,
      holdoutSize,
      labelSource: current.labelSource,
      ownerPersonId: body.ownerPersonId ?? current.ownerPersonId,
      refreshedAt: body.refreshedAt,
      nextRefreshDueAt: body.nextRefreshDueAt,
      contentHash: body.contentHash,
    });
    await platformStore.retireModelEvaluationDataset({
      tenantId,
      datasetId: current.id,
    });
    return data(refreshed, request);
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

  app.post("/api/v1/model-canary-runs", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createModelCanaryRunSchema, request.body);
    const tenantId = tenantOf(request);
    const [baseline, candidate] = await Promise.all([
      platformStore.getModelEvaluationRun(
        tenantId,
        body.baselineEvaluationRunId,
      ),
      platformStore.getModelEvaluationRun(
        tenantId,
        body.candidateEvaluationRunId,
      ),
    ]);
    assertHarnessEvaluation(baseline);
    assertHarnessEvaluation(candidate);
    if (
      baseline.datasetRef !== body.datasetRef ||
      candidate.datasetRef !== body.datasetRef
    ) {
      throw new ConflictError(
        "CANARY_DATASET_MISMATCH: both runs must use the requested dataset",
      );
    }
    const blockers: string[] = [];
    if (!baseline.passed) blockers.push("BASELINE_NOT_PASSED");
    if (!candidate.passed) blockers.push("CANDIDATE_NOT_PASSED");
    const metric = (
      run: typeof baseline,
      key: string,
    ): number | undefined =>
      typeof run.metrics[key] === "number"
        ? (run.metrics[key] as number)
        : undefined;
    const kappa = metric(candidate, "cohensKappa");
    const baselineKappa = metric(baseline, "cohensKappa");
    if (
      kappa !== undefined &&
      baselineKappa !== undefined &&
      kappa < baselineKappa - 0.05
    ) {
      blockers.push("CANARY_KAPPA_REGRESSION");
    }
    const gap = metric(candidate, "subgroupErrorGap");
    const baselineGap = metric(baseline, "subgroupErrorGap");
    if (
      gap !== undefined &&
      baselineGap !== undefined &&
      gap > baselineGap + 0.05
    ) {
      blockers.push("CANARY_SUBGROUP_GAP_REGRESSION");
    }
    const injection = metric(candidate, "promptInjectionPassRate");
    const baselineInjection = metric(
      baseline,
      "promptInjectionPassRate",
    );
    if (
      injection !== undefined &&
      baselineInjection !== undefined &&
      injection < baselineInjection
    ) {
      blockers.push("CANARY_PROMPT_INJECTION_REGRESSION");
    }
    const stability = metric(candidate, "counterfactualStability");
    const baselineStability = metric(
      baseline,
      "counterfactualStability",
    );
    if (
      stability !== undefined &&
      baselineStability !== undefined &&
      stability < baselineStability - 0.05
    ) {
      blockers.push("CANARY_STABILITY_REGRESSION");
    }
    const canary = await platformStore.createModelCanaryRun({
      tenantId,
      baselineEvaluationRunId: baseline.id,
      candidateEvaluationRunId: candidate.id,
      datasetRef: body.datasetRef,
      trafficPercent: body.trafficPercent,
      passed: blockers.length === 0,
      blockers,
      metrics: {
        baseline: baseline.metrics,
        candidate: candidate.metrics,
      },
    });
    countEvent(canary.passed ? "model_canary_passed" : "model_canary_blocked");
    return reply.status(201).send(data(canary, request));
  });

  app.get("/api/v1/model-canary-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listModelCanaryRuns(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/model-red-team-runs", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createModelRedTeamRunSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createModelRedTeamRun({
          tenantId: tenantOf(request),
          modelProvider: body.modelProvider,
          modelName: body.modelName,
          promptVersion: body.promptVersion,
          scope: body.scope,
          testsRun: body.testsRun,
          passed: body.passed,
          findings: body.findings ?? [],
          artifactRef: body.artifactRef,
          createdBy: body.createdBy,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/model-red-team-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listModelRedTeamRuns(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/esign-envelopes", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createESignEnvelopeSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createESignEnvelope({
          tenantId: tenantOf(request),
          contractId: body.contractId,
          provider: body.provider,
          envelopeRef: body.envelopeRef,
          documentHash: body.documentHash,
          signerPersonId: body.signerPersonId,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/esign-envelopes", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { contractId?: string };
    return data(
      await platformStore.listESignEnvelopes(
        tenantOf(request),
        query.contractId,
      ),
      request,
    );
  });

  app.post("/api/v1/esign/webhooks/:provider", async (request) => {
    requireRoles(request, "integration");
    const provider = paramOf(request, "provider");
    const secret = options.esignWebhookSecrets?.[provider];
    if (!secret) {
      throw new NotFoundError(
        `E-sign provider ${provider} is not configured`,
      );
    }
    const raw =
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody ??
      Buffer.alloc(0);
    const timestamp = request.headers["x-timestamp"] as string | undefined;
    const valid = verifyWebhookSignature({
      secret,
      payload: raw,
      signature: request.headers["x-signature-256"] as
        | string
        | undefined,
      timestamp,
      toleranceSeconds: timestamp ? 300 : undefined,
    });
    if (!valid) {
      throw new ConflictError("ESIGN_WEBHOOK_SIGNATURE_INVALID");
    }
    const body = parse(esignCallbackSchema, request.body);
    const envelope = await platformStore.completeESignEnvelope({
      tenantId: tenantOf(request),
      provider,
      envelopeRef: body.envelopeRef,
      status: body.status,
      signatureRef: body.signatureRef,
      reason: body.reason,
    });
    countEvent(
      body.status === "SIGNED"
        ? "esign_envelope_signed"
        : "esign_envelope_closed",
    );
    return data(envelope, request);
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

  async function buildPersonDataPackage(
    request: FastifyRequest,
    personId: string,
  ): Promise<Record<string, unknown>> {
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [people, contracts, workPackages, claims, evidence, confirmations, appeals, notifications, drafts, decisions, proposals, dsars, attributes, notices] =
      await Promise.all([
        platformStore.listPersons(tenantId),
        platformStore.listEmploymentContracts(tenantId, personId),
        store.listWorkPackages(),
        store.listClaims(),
        store.listEvidence(),
        store.listConfirmations(personId),
        store.listAppeals(),
        store.listNotifications({ recipientPersonId: personId }),
        store.listEvaluationDrafts({ personId }),
        store.listEvaluationDecisions({ personId }),
        platformStore.listAiScoreProposals(tenantId, { personId }),
        platformStore.listDsars(tenantId, personId),
        platformStore.listWorkforceSubgroupAttributes(tenantId, { personId }),
        platformStore.listNotices(tenantId),
      ]);
    const person = people.find((candidate) => candidate.id === personId);
    if (!person) throw new NotFoundError(`Person ${personId} not found`);
    const acknowledgements = (
      await Promise.all(
        notices.map(async (notice) => {
          const overview = await platformStore.listAcknowledgements(
            tenantId,
            notice.id,
          );
          return overview.acknowledgements
            .filter((row) => row.personId === personId)
            .map((row) => ({
              noticeId: notice.id,
              noticeType: notice.noticeType,
              title: notice.title,
              decision: row.acknowledgedAt
                ? "ACKNOWLEDGED"
                : row.declinedAt
                  ? "DECLINED"
                  : "PENDING",
              acknowledgedAt: row.acknowledgedAt,
              declinedAt: row.declinedAt,
            }));
        }),
      )
    ).flat();
    const ownWorkPackages = workPackages
      .filter(
        (workPackage) =>
          workPackage.ownerPersonId === personId ||
          workPackage.members.some((member) => member.personId === personId),
      )
      .map((workPackage) => {
        const membership = workPackage.members.find(
          (member) => member.personId === personId,
        );
        return {
          id: workPackage.id,
          title: workPackage.title,
          status: workPackage.status,
          packageType: workPackage.packageType,
          dueAt: workPackage.dueAt,
          myRole: membership?.responsibilityCode ??
            (workPackage.ownerPersonId === personId ? "OWNER" : "MEMBER"),
          myExpectedOutput: membership?.expectedOutput,
        };
      });
    const payload = {
      packageVersion: "v1",
      generatedAt: new Date().toISOString(),
      personId,
      profile: {
        id: person.id,
        employeeCode: person.employeeCode,
        displayName: person.displayName,
        employmentStatus: person.employmentStatus,
        managerPersonId: person.managerPersonId,
      },
      contracts,
      workPackages: ownWorkPackages,
      claims: claims.filter((claim) => claim.claimantPersonId === personId),
      evidence: evidence.filter((node) => node.submittedBy === personId),
      confirmations,
      appeals: appeals
        .filter((appeal) => appeal.appellantPersonId === personId)
        .map((appeal) => ({
          id: appeal.id,
          targetType: appeal.targetType,
          targetId: appeal.targetId,
          reasonCode: appeal.reasonCode,
          statement: appeal.statement,
          status: appeal.status,
          resolution: appeal.resolution,
          dueAt: appeal.dueAt,
          createdAt: appeal.createdAt,
          resolvedAt: appeal.resolvedAt,
        })),
      notifications,
      evaluationDrafts: drafts,
      evaluationDecisions: decisions,
      aiProposals: proposals,
      dsars,
      subgroupAttributes: attributes,
      acknowledgements,
    };
    return { ...payload, packageHash: sha256(payload) };
  }

  app.get("/api/v1/me/data-package", async (request) => {
    assertExportAllowed(request);
    const personId = ownPersonId(request);
    if (!personId) {
      throw new ForbiddenError("employee identity is required");
    }
    return data(await buildPersonDataPackage(request, personId), request);
  });

  app.get("/api/v1/dsar-requests/:id/package", async (request) => {
    requireRoles(request, "admin", "finance");
    assertExportAllowed(request);
    const dsar = await platformStore.getDsar(
      tenantOf(request),
      idOf(request),
    );
    return data(
      await buildPersonDataPackage(request, dsar.personId),
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

  app.get("/api/v1/retention-policies/recommended", async (request) => {
    requireRoles(request, "manager", "finance");
    const configured = await platformStore.listRetentionPolicies(
      tenantOf(request),
    );
    const configuredCategories = new Set(
      configured.map((policy) => policy.dataCategory),
    );
    return data(
      {
        note: "Conservative system defaults from ADR-008. Legal hold always wins; a tenant must confirm local law before adopting a value.",
        recommendations: RETENTION_RECOMMENDATIONS.map((recommendation) => ({
          ...recommendation,
          configured: configuredCategories.has(recommendation.dataCategory),
        })),
      },
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
    const activityFields = findActivityMetricKeys(
      Object.fromEntries(
        body.fields.map((field) => [field.fieldName, true]),
      ),
    );
    if (activityFields.length > 0) {
      throw new ConflictError(
        `DATA_MINIMIZATION_ACTIVITY_BLOCKED:${activityFields.join(",")}`,
      );
    }
    const activityText = findActivityMonitoringText({
      name: body.name,
      fields: body.fields,
    });
    if (activityText.length > 0) {
      throw new ConflictError(
        `DATA_MINIMIZATION_ACTIVITY_TEXT_BLOCKED:${activityText.join(",")}`,
      );
    }
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
    const allFields = mapped.flatMap((source) => source.fields);
    const personalFields = allFields.filter(
      (field) =>
        field.classification === "PERSONAL" ||
        field.classification === "SENSITIVE",
    );
    const personalFieldsWithRetention = personalFields.filter(
      (field) => typeof field.retentionMonths === "number",
    ).length;
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
          fields: allFields.length,
          classifications,
          categories,
          minimization: {
            fieldsWithPurpose: allFields.filter((field) => field.purpose).length,
            personalFields: personalFields.length,
            personalFieldsWithRetention,
            personalFieldsWithoutRetention:
              personalFields.length - personalFieldsWithRetention,
          },
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

  app.post("/api/v1/retention-policies/:id/disposal-requests", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createRetentionDisposalRequestSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createRetentionDisposalRequest({
          tenantId: tenantOf(request),
          retentionPolicyId: idOf(request),
          requestedBy: body.requestedBy,
          reason: body.reason,
          scheduledFor: body.scheduledFor,
        }),
        request,
      ),
    );
  });

  app.post("/api/v1/retention-disposal-requests", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createFlatRetentionDisposalRequestSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createRetentionDisposalRequest({
          tenantId: tenantOf(request),
          retentionPolicyId: body.retentionPolicyId,
          requestedBy: body.requestedBy,
          reason: body.reason,
          scheduledFor: body.scheduledFor,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/retention-disposal-requests", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listRetentionDisposalRequests(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/retention-disposal-requests:process", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(processRetentionDisposalsSchema, request.body);
    const tenantId = tenantOf(request);
    const pending = (await platformStore.listRetentionDisposalRequests(tenantId))
      .filter(
        (candidate) =>
          candidate.status === "APPROVED" &&
          Date.now() >= Date.parse(candidate.scheduledFor),
      );
    const completed: string[] = [];
    const skipped: Array<{ requestId: string; reason: string }> = [];
    const policies = await platformStore.listRetentionPolicies(tenantId);
    const policyById = new Map(policies.map((policy) => [policy.id, policy]));
    for (const candidate of pending) {
      const policy = policyById.get(candidate.retentionPolicyId);
      if (policy?.legalHold) {
        skipped.push({
          requestId: candidate.id,
          reason: "RETENTION_LEGAL_HOLD",
        });
        continue;
      }
      try {
        const processed = await platformStore.completeRetentionDisposalRequest({
          tenantId,
          requestId: candidate.id,
          actorPersonId: body.actorPersonId,
        });
        completed.push(processed.id);
      } catch (caught) {
        skipped.push({
          requestId: candidate.id,
          reason: caught instanceof Error ? caught.message : "unknown",
        });
      }
    }
    countEvent("retention_disposals_processed");
    return data(
      {
        processedCount: completed.length,
        completed,
        skipped,
        checkedAt: new Date().toISOString(),
      },
      request,
    );
  });

  app.post("/api/v1/retention-disposal-requests/:id/approve", async (request) => {
    requireRoles(request, "admin");
    const body = parse(approveRetentionDisposalRequestSchema, request.body);
    return data(
      await platformStore.approveRetentionDisposalRequest({
        tenantId: tenantOf(request),
        requestId: idOf(request),
        approvedBy: body.approvedBy,
      }),
      request,
    );
  });

  app.post("/api/v1/retention-disposal-requests/:id/complete", async (request) => {
    requireRoles(request, "admin");
    const body = parse(completeRetentionDisposalRequestSchema, request.body);
    return data(
      await platformStore.completeRetentionDisposalRequest({
        tenantId: tenantOf(request),
        requestId: idOf(request),
        actorPersonId: body.actorPersonId,
      }),
      request,
    );
  });

  app.post("/api/v1/retention-disposal-requests/:id/cancel", async (request) => {
    requireRoles(request, "admin");
    const body = parse(cancelRetentionDisposalRequestSchema, request.body);
    return data(
      await platformStore.cancelRetentionDisposalRequest({
        tenantId: tenantOf(request),
        requestId: idOf(request),
        actorPersonId: body.actorPersonId,
        reason: body.reason,
      }),
      request,
    );
  });

  app.post("/api/v1/workforce-subgroup-attributes", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(recordWorkforceSubgroupAttributeSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.recordWorkforceSubgroupAttribute({
          tenantId: tenantOf(request),
          personId: body.personId,
          dimension: body.dimension,
          value: body.value,
          consentRef: body.consentRef,
          consentedAt: body.consentedAt,
          expiresAt: body.expiresAt,
          recordedBy: body.recordedBy,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/field-access-policies", async (request) => {
    requireRoles(request, "admin", "manager", "finance");
    const tenant = await platformStore.getTenant(tenantOf(request));
    const configured = (
      tenant.settings as { fieldAccessPolicies?: unknown }
    ).fieldAccessPolicies;
    const policies: Record<string, FieldAccessPolicy> =
      configured && typeof configured === "object"
        ? (configured as Record<string, FieldAccessPolicy>)
        : {};
    return data(
      {
        defaults: DEFAULT_FIELD_ACCESS_POLICIES,
        configured: policies,
        effective: { ...DEFAULT_FIELD_ACCESS_POLICIES, ...policies },
      },
      request,
    );
  });

  app.put("/api/v1/field-access-policies", async (request) => {
    requireRoles(request, "admin");
    const body = parse(updateFieldAccessPoliciesSchema, request.body);
    const tenantId = tenantOf(request);
    const tenant = await platformStore.getTenant(tenantId);
    const before = (
      tenant.settings as { fieldAccessPolicies?: unknown }
    ).fieldAccessPolicies;
    await platformStore.updateTenantSettings({
      tenantId,
      settings: { fieldAccessPolicies: body.policies },
    });
    await storeFor(request).recordAuditEvent({
      actorType: "USER",
      actorId:
        request.authContext?.userId ?? request.authContext?.personId,
      action: "FIELD_ACCESS_POLICIES_UPDATED",
      objectType: "TENANT_SETTINGS",
      objectId: tenantId,
      beforeHash: sha256(before ?? {}),
      afterHash: sha256(body.policies),
      reason: `overrides=${Object.keys(body.policies).length}`,
    });
    return data(
      {
        defaults: DEFAULT_FIELD_ACCESS_POLICIES,
        configured: body.policies,
        effective: { ...DEFAULT_FIELD_ACCESS_POLICIES, ...body.policies },
      },
      request,
    );
  });

  app.get("/api/v1/workforce-subgroup-attributes", async (request) => {
    requireRoles(request, "admin");
    const query = request.query as {
      personId?: string;
      dimension?: string;
    };
    const dimension = query.dimension
      ? workforceSubgroupDimensionSchema.safeParse(query.dimension)
      : undefined;
    if (dimension && !dimension.success) {
      throw new BadRequestError(
        "INVALID_SUBGROUP_DIMENSION",
        `Unknown subgroup dimension ${query.dimension}`,
      );
    }
    return data(
      await platformStore.listWorkforceSubgroupAttributes(
        tenantOf(request),
        {
          personId: query.personId,
          dimension: dimension?.data,
        },
      ),
      request,
    );
  });

  app.post("/api/v1/workforce-subgroup-attributes/withdraw", async (request) => {
    requireRoles(request, "admin");
    const body = parse(withdrawWorkforceSubgroupAttributeSchema, request.body);
    return data(
      await platformStore.withdrawWorkforceSubgroupAttribute({
        tenantId: tenantOf(request),
        personId: body.personId,
        dimension: body.dimension,
      }),
      request,
    );
  });

  app.get("/api/v1/reports/subgroup-impact", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      cycleId?: string;
      dimension?: string;
    };
    const dimension = query.dimension
      ? workforceSubgroupDimensionSchema.safeParse(query.dimension)
      : undefined;
    if (dimension && !dimension.success) {
      throw new BadRequestError(
        "INVALID_SUBGROUP_DIMENSION",
        `Unknown subgroup dimension ${query.dimension}`,
      );
    }
    const tenantId = tenantOf(request);
    const allRuns = await storeFor(request).listRuns();
    const selectedCycleId =
      query.cycleId ??
      [...allRuns].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0]?.cycleId;
    const attributes = (
      await platformStore.listWorkforceSubgroupAttributes(tenantId, {
        dimension: dimension?.data,
      })
    ).filter(
      (attribute) =>
        !attribute.expiresAt || Date.parse(attribute.expiresAt) > Date.now(),
    );
    if (!selectedCycleId || attributes.length === 0) {
      return data(
        {
          generatedAt: new Date().toISOString(),
          cycleId: selectedCycleId,
          available: false,
          thresholds: {
            minimumQuantitativeGroupSize: 30,
            minimumReportableGroupSize: 10,
            adverseImpactRatioThreshold: 0.8,
          },
          note:
            attributes.length === 0
              ? "No consent-backed subgroup labels are recorded; no protected-attribute analysis is produced."
              : "A cycle with calculation or evaluation outcomes is required.",
          dimensions: {},
        },
        request,
      );
    }
    const cycleRuns = allRuns
      .filter((run) => run.cycleId === selectedCycleId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latestRun = cycleRuns[0];
    const proposals = await platformStore.listAiScoreProposals(tenantId, {
      cycleId: selectedCycleId,
    });
    const incentives = new Map<string, number>();
    for (const line of latestRun?.lines ?? []) {
      const amount = Number(line.roundedAmount);
      if (Number.isFinite(amount)) {
        incentives.set(
          line.personId,
          (incentives.get(line.personId) ?? 0) + amount,
        );
      }
    }
    const proposalScores = new Map<string, number[]>();
    for (const proposal of proposals) {
      const scores = proposalScores.get(proposal.personId) ?? [];
      scores.push(proposal.overallScore);
      proposalScores.set(proposal.personId, scores);
    }
    const attributesByDimension = new Map<
      string,
      Map<string, typeof attributes>
    >();
    for (const attribute of attributes) {
      const groups =
        attributesByDimension.get(attribute.dimension) ??
        new Map<string, typeof attributes>();
      const group = groups.get(attribute.value) ?? [];
      group.push(attribute);
      groups.set(attribute.value, group);
      attributesByDimension.set(attribute.dimension, groups);
    }
    const dimensions: Record<string, unknown> = {};
    for (const [dimensionKey, groups] of attributesByDimension) {
      let suppressedGroups = 0;
      const reported = [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([value, members]) => {
          if (members.length < 10) {
            suppressedGroups += 1;
            return undefined;
          }
          if (members.length < 30) {
            return {
              value,
              headcount: members.length,
              quantitative: false,
              qualitativeReviewRequired: true,
              metrics: null,
              flags: ["SMALL_SAMPLE_QUALITATIVE"],
            };
          }
          if (!latestRun) {
            return {
              value,
              headcount: members.length,
              quantitative: true,
              qualitativeReviewRequired: false,
              metrics: null,
              flags: ["OUTCOMES_UNAVAILABLE"],
            };
          }
          const scores = members.flatMap(
            (member) => proposalScores.get(member.personId) ?? [],
          );
          const payouts = members.map(
            (member) => incentives.get(member.personId) ?? 0,
          );
          const positive = payouts.filter((amount) => amount > 0).length;
          return {
            value,
            headcount: members.length,
            quantitative: true,
            qualitativeReviewRequired: false,
            metrics: {
              meanAiScore:
                scores.length === 0
                  ? null
                  : Math.round(
                      (scores.reduce((sum, score) => sum + score, 0) /
                        scores.length) *
                        100,
                    ) / 100,
              meanIncentiveAmount:
                Math.round(
                  (payouts.reduce((sum, amount) => sum + amount, 0) /
                    payouts.length) *
                    100,
                ) / 100,
              positivePayoutRate:
                Math.round((positive / payouts.length) * 10000) / 10000,
              adverseImpactRatio: null as number | null,
            },
            flags: [] as string[],
          };
        })
        .filter(
          (
            group,
          ): group is {
            value: string;
            headcount: number;
            quantitative: boolean;
            qualitativeReviewRequired: boolean;
            metrics: {
              meanAiScore: number | null;
              meanIncentiveAmount: number;
              positivePayoutRate: number;
              adverseImpactRatio: number | null;
            } | null;
            flags: string[];
          } => Boolean(group),
        );
      const quantitative = reported.filter(
        (group) => group.quantitative && group.metrics,
      );
      const highestRate = Math.max(
        0,
        ...quantitative.map(
          (group) => group.metrics?.positivePayoutRate ?? 0,
        ),
      );
      for (const group of quantitative) {
        if (!group.metrics) continue;
        const ratio =
          highestRate === 0
            ? 1
            : group.metrics.positivePayoutRate / highestRate;
        group.metrics.adverseImpactRatio =
          Math.round(ratio * 10000) / 10000;
        if (ratio < 0.8) {
          group.flags.push("ADVERSE_IMPACT_BELOW_FOUR_FIFTHS");
        }
      }
      dimensions[dimensionKey] = {
        reportedGroups: reported.length,
        suppressedGroups,
        outcomesAvailable: Boolean(latestRun),
        groups: reported,
      };
    }
    return data(
      {
        generatedAt: new Date().toISOString(),
        cycleId: selectedCycleId,
        available: true,
        thresholds: {
          minimumQuantitativeGroupSize: 30,
          minimumReportableGroupSize: 10,
          adverseImpactRatioThreshold: 0.8,
        },
        note:
          "Aggregate-only analysis. Cells below 10 are suppressed; groups of 10-29 are qualitative. Protected attributes are never used for individual decisions.",
        dimensions,
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

  app.post("/api/v1/ai/model-summary", async (request, reply) => {
    requireRoles(request, "manager");
    if (!options.modelScoring) {
      return reply.status(501).send({
        ...errorBody(
          "MODEL_PROVIDER_NOT_CONFIGURED",
          "set modelScoring options (MODEL_SCORING_BASE_URL/MODEL_SCORING_API_KEY/MODEL_SCORING_MODEL) to enable model-backed summaries",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const body = parse(modelSummarySchema, request.body);
    const evidence = await storeFor(request).listEvidence();
    const selected = body.evidenceRefs
      .map((ref) => evidence.find((node) => node.id === ref))
      .filter((node): node is NonNullable<typeof node> => Boolean(node));
    const missing = body.evidenceRefs.filter(
      (ref) => !selected.some((node) => node.id === ref),
    );
    if (missing.length > 0) {
      return reply.status(404).send({
        ...errorBody(
          "NOT_FOUND",
          `evidence not found: ${missing.join(", ")}`,
        ),
        meta: { correlation_id: request.id },
      });
    }
    const provider = new HttpModelScoringProvider({
      baseUrl: options.modelScoring.baseUrl,
      apiKey: options.modelScoring.apiKey,
      model: options.modelScoring.model,
      fetchImpl: options.modelScoring.fetchImpl,
    });
    let summary;
    try {
      summary = await provider.summarise({
        dimensions: body.dimensions,
        rubric: body.rubric,
        context: body.context,
        evidence: selected.map((node) => ({
          ref: node.id,
          text: JSON.stringify(node.normalizedPayload),
          qualityStatus: node.qualityStatus,
        })),
      });
    } catch (caught) {
      const code =
        caught instanceof ModelProviderError ? caught.code : "MODEL_PROVIDER_HTTP_ERROR";
      return reply.status(502).send({
        ...errorBody(code, (caught as Error).message),
        meta: { correlation_id: request.id },
      });
    }
    const log = await platformStore.createAiSuggestion({
      tenantId: tenantOf(request),
      agentTaskId: "manual-model-summary",
      targetType: "EVIDENCE_SUMMARY",
      suggestionType: "MODEL_EVIDENCE_SUMMARY",
      modelProvider: summary.provider,
      modelName: summary.model,
      promptVersion: "model-summary-v1",
      inputHash: sha256(body),
      outputJson: summary as unknown as Record<string, unknown>,
      validationStatus: "VALIDATED",
    });
    countEvent("model_summary_generated");
    return data({ suggestionLogId: log.id, summary }, request);
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
    await assertRedTeamEvidence(request, existingPrompt);
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
    const zeroDimensions = Object.entries(scored.scores)
      .filter(([, value]) => value === 0)
      .map(([dimension]) => dimension);
    if (zeroDimensions.length > 0 && !body.zeroScoreRationale?.trim()) {
      throw new ConflictError(
        `AI_ZERO_SCORE_RATIONALE_REQUIRED:${zeroDimensions.join(",")}; unpriced or unobserved work must not be silently defaulted to zero`,
      );
    }
    const risk = assessAiRisk({
      overallScore: scored.overallScore,
      confidence: scored.confidence,
      evidenceCount: scored.evidenceCount,
      hasZeroScore: zeroDimensions.length > 0,
      requestedTier: body.riskTier,
    });
    const riskAssessedAt = new Date();
    const secondReviewDueAt = risk.secondReviewSlaHours
      ? new Date(
          riskAssessedAt.getTime() +
            risk.secondReviewSlaHours * 60 * 60 * 1000,
        ).toISOString()
      : undefined;
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
      riskTier: risk.riskTier,
      riskReasons: risk.riskReasons,
      riskAssessedAt: riskAssessedAt.toISOString(),
      secondReviewDueAt,
      zeroScoreRationale: body.zeroScoreRationale,
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
        highRiskCount: proposals.filter(
          (proposal) =>
            proposal.riskTier === "HIGH" ||
            proposal.riskTier === "CRITICAL",
        ).length,
        highRiskPending: proposals.filter(
          (proposal) =>
            proposal.status === "PENDING" &&
            (proposal.riskTier === "HIGH" ||
              proposal.riskTier === "CRITICAL"),
        ).length,
        secondReviewOverdue: proposals.filter(
          (proposal) =>
            proposal.status === "PENDING" &&
            proposal.secondReviewRequired &&
            Boolean(proposal.secondReviewDueAt) &&
            Date.parse(proposal.secondReviewDueAt as string) < Date.now(),
        ).length,
        secondReviewSlaBreaches: proposals.filter(
          (proposal) => proposal.secondReviewSlaBreached,
        ).length,
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
    const proposals = await platformStore.listAiScoreProposals(
      tenantOf(request),
      {
        personId: query.personId,
        cycleId: query.cycleId,
        status: query.status,
      },
    );
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) return data(proposals, request);
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    const personId = ownPersonId(request);
    return data(
      proposals.map((proposal) =>
        redactResourceFields(proposal, "AI_PROPOSAL", {
          personId,
          recordPersonId: proposal.personId,
          roles,
          policies,
          matchContext,
        }),
      ),
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
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) return data(filtered, request);
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    const personId = ownPersonId(request);
    return data(
      filtered.map((proposal) =>
        redactResourceFields(proposal, "AI_PROPOSAL", {
          personId,
          recordPersonId: proposal.personId,
          roles,
          policies,
          matchContext,
        }),
      ),
      request,
    );
  });

  app.get("/api/v1/ai-score-proposals/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    const proposal = await platformStore.getAiScoreProposal(
      tenantOf(request),
      idOf(request),
    );
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) return data(proposal, request);
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    return data(
      redactResourceFields(proposal, "AI_PROPOSAL", {
        personId: ownPersonId(request),
        recordPersonId: proposal.personId,
        roles,
        policies,
        matchContext,
      }),
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
    let secondReviewerPersonId: string | undefined;
    let secondIndependentScores: Record<string, number> | undefined;
    let secondIndependentRationale: string | undefined;
    let secondReviewStartedAt: string | undefined;
    let secondEvidenceOpened: number | undefined;
    let secondReviewOutcome: "AGREE" | "DISAGREE" | undefined;
    let secondReviewAgreementRate: number | undefined;
    if (existing.secondReviewRequired) {
      if (
        !body.secondReviewerPersonId ||
        !body.secondIndependentScores ||
        !body.secondIndependentRationale?.trim() ||
        !body.secondReviewStartedAt
      ) {
        throw new ConflictError(
          "AI_SECOND_REVIEW_REQUIRED: high-risk proposals need a second independent review",
        );
      }
      if (!persons.some((person) => person.id === body.secondReviewerPersonId)) {
        throw new NotFoundError(
          `Person ${body.secondReviewerPersonId} not found`,
        );
      }
      if (
        body.secondReviewerPersonId === body.decidedBy ||
        body.secondReviewerPersonId === existing.requestedBy
      ) {
        throw new ConflictError(
          "AI_SECOND_REVIEWER_CONFLICT: second reviewer must differ from requester and first reviewer",
        );
      }
      for (const dimension of existing.dimensions) {
        if (
          typeof body.secondIndependentScores[dimension] !== "number"
        ) {
          throw new ConflictError(
            `AI_SECOND_REVIEW_SCORES_REQUIRED: missing ${dimension}`,
          );
        }
      }
      const secondStartedMs = Date.parse(body.secondReviewStartedAt);
      if (
        !Number.isFinite(secondStartedMs) ||
        secondStartedMs > Date.now()
      ) {
        throw new ConflictError("AI_SECOND_REVIEW_STARTED_AT_INVALID");
      }
      const matched = existing.dimensions.filter(
        (dimension) =>
          Math.abs(
            (body.secondIndependentScores?.[dimension] ?? 0) -
              (existing.scores[dimension] ?? 0),
          ) <= 0.05,
      ).length;
      const secondDecision =
        matched === existing.dimensions.length ? "ACCEPTED" : "REJECTED";
      if (
        secondDecision !==
        (body.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED")
      ) {
        throw new ConflictError(
          "AI_SECOND_REVIEW_DISAGREES: the second reviewer reached a different decision",
        );
      }
      secondReviewerPersonId = body.secondReviewerPersonId;
      secondIndependentScores = body.secondIndependentScores;
      secondIndependentRationale = body.secondIndependentRationale;
      secondReviewStartedAt = body.secondReviewStartedAt;
      secondEvidenceOpened = body.secondEvidenceOpened ?? 0;
      secondReviewOutcome = "AGREE";
      secondReviewAgreementRate =
        matched / existing.dimensions.length;
    }
    const tenant = await platformStore.getTenant(tenantId);
    const configuredRate = Number(
      (tenant.settings as { aiAuditSampleRate?: unknown })
        .aiAuditSampleRate ?? 0.1,
    );
    const auditSampleRate = Number.isFinite(configuredRate)
      ? Math.min(1, Math.max(0, configuredRate))
      : 0.1;
    const auditSample = existing.secondReviewRequired
      ? false
      : override || Math.random() < auditSampleRate;
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
      secondReviewerPersonId,
      secondIndependentScores,
      secondIndependentRationale,
      secondReviewStartedAt,
      secondEvidenceOpened,
      secondReviewOutcome,
      secondReviewAgreementRate,
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
    requireRoles(request, "manager", "finance", "integration");
    return data(
      await platformStore.listIntegrationConnections(tenantOf(request)),
      request,
    );
  });

  app.get("/api/v1/integration-connections/:id", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
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

  app.post("/api/v1/compensation-templates", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createCompensationTemplateSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createCompensationTemplate({
          tenantId: tenantOf(request),
          code: body.code,
          name: body.name,
          roleCode: body.roleCode,
          employmentType: body.employmentType,
          currency: body.currency,
          fixedSalaryMin: body.fixedSalaryMin,
          fixedSalaryMax: body.fixedSalaryMax,
          deductionCapRate: body.deductionCapRate ?? "0.2",
          variableShareCapRate: body.variableShareCapRate ?? "1",
          smoothingThresholdRate: body.smoothingThresholdRate ?? "1",
          deductionOrder: body.deductionOrder ?? [
            "RECOVERY",
            "REVERSAL",
            "ADJUSTMENT",
            "OTHER",
          ],
          deductionTypeCaps: body.deductionTypeCaps ?? {},
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/compensation-templates", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listCompensationTemplates(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/compensation-templates/:id/retire", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.retireCompensationTemplate({
        tenantId: tenantOf(request),
        templateId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/employment-contracts/apply-due", async (request) => {
    requireRoles(request, "manager");
    return data(
      await platformStore.applyDueContractAmendments(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/employment-contracts", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createEmploymentContractSchema, request.body);
    if (body.compensationTemplateCode) {
      const template = await platformStore.getActiveCompensationTemplate(
        tenantOf(request),
        body.compensationTemplateCode,
      );
      if (!template) {
        throw new NotFoundError(
          `CompensationTemplate ${body.compensationTemplateCode} not found`,
        );
      }
      if (
        template.employmentType !== body.employmentType ||
        template.currency !== body.currency
      ) {
        throw new ConflictError(
          "COMPENSATION_TEMPLATE_TYPE_OR_CURRENCY_MISMATCH",
        );
      }
      const salary = parseDecimal(body.fixedMonthlySalary);
      if (
        salary < parseDecimal(template.fixedSalaryMin) ||
        salary > parseDecimal(template.fixedSalaryMax)
      ) {
        throw new ConflictError(
          "COMPENSATION_TEMPLATE_SALARY_OUT_OF_RANGE",
        );
      }
    }
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
          legalEntity: body.legalEntity,
          currency: body.currency,
          fixedMonthlySalary: body.fixedMonthlySalary,
          minimumMonthlyWage: body.minimumMonthlyWage,
          taxRate: body.taxRate ?? "0",
          socialInsuranceRate: body.socialInsuranceRate ?? "0",
          deductionCapRate: body.deductionCapRate ?? "0.2",
          variableShareCapRate: body.variableShareCapRate ?? "1",
          deductionOrder: body.deductionOrder ?? [
            "RECOVERY",
            "REVERSAL",
            "ADJUSTMENT",
            "OTHER",
          ],
          deductionTypeCaps: body.deductionTypeCaps ?? {},
          smoothingThresholdRate: body.smoothingThresholdRate ?? "1",
          compensationTemplateCode: body.compensationTemplateCode,
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
        deductionOrder: body.deductionOrder ?? [],
        deductionTypeCaps: body.deductionTypeCaps ?? {},
        smoothingThresholdRate: body.smoothingThresholdRate ?? "1",
        compensationTemplateCode: body.compensationTemplateCode,
        bankAccountRef: body.bankAccountRef,
        effectiveFrom: body.effectiveFrom,
        consentSignatureRef: body.consentSignatureRef,
        approvedBy: body.approvedBy,
      }),
      request,
    );
  });

  app.post("/api/v1/employment-contracts/:id/amendments/:amendmentId/cancel", async (request) => {
    requireRoles(request, "manager");
    const body = parse(cancelContractAmendmentSchema, request.body);
    return data(
      await platformStore.cancelContractAmendment({
        tenantId: tenantOf(request),
        contractId: idOf(request),
        amendmentId: paramOf(request, "amendmentId"),
        reason: body.reason,
      }),
      request,
    );
  });

  app.get("/api/v1/employment-contracts/:id/amendments", async (request) => {
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const contractId = idOf(request);
    const amendments = await platformStore.listEmploymentContractAmendments(
      tenantId,
      contractId,
    );
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) return data(amendments, request);
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    let contractPersonId: string | undefined;
    try {
      contractPersonId = (
        await platformStore.getEmploymentContract(tenantId, contractId)
      ).personId;
    } catch {
      contractPersonId = undefined;
    }
    const personId = ownPersonId(request);
    return data(
      amendments.map((amendment) =>
        redactContractAmendmentTerms(amendment, {
          personId,
          recordPersonId: contractPersonId,
          roles,
          policies,
          matchContext,
        }),
      ),
      request,
    );
  });

  app.get("/api/v1/employment-contracts", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { personId?: string };
    const contracts = await platformStore.listEmploymentContracts(
      tenantOf(request),
      query.personId,
    );
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) return data(contracts, request);
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    const personId = ownPersonId(request);
    return data(
      contracts.map((contract) =>
        redactResourceFields(contract, "EMPLOYMENT_CONTRACT", {
          personId,
          recordPersonId: contract.personId,
          roles,
          policies,
          matchContext,
        }),
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
    assertExportAllowed(request);
    const query = request.query as {
      approvalRequestId?: string;
      dlpApprovalRequestId?: string;
    };
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
    await assertExportDlp(
      request,
      csv,
      "PAYROLL_RUN",
      run.id,
      query.dlpApprovalRequestId,
    );
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
    assertExportAllowed(request);
    const query = request.query as {
      approvalRequestId?: string;
      dlpApprovalRequestId?: string;
    };
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
    const format = (
      (request.query as { format?: string }).format ?? "GENERIC"
    ).toUpperCase();
    if (!["GENERIC", "ICBC", "CMB"].includes(format)) {
      return reply.status(400).send({
        ...errorBody(
          "VALIDATION_ERROR",
          "format must be one of GENERIC, ICBC, CMB",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const csv = payrollBankFileCsv(
      run,
      format as "GENERIC" | "ICBC" | "CMB",
    );
    await assertExportDlp(
      request,
      csv,
      "PAYROLL_RUN",
      run.id,
      query.dlpApprovalRequestId,
    );
    return reply
      .type("text/csv; charset=utf-8")
      .headers(exportHeaders(request, csv, "RESTRICTED"))
      .header(
        "content-disposition",
        `attachment; filename="payroll-bank-${run.id}-${format.toLowerCase()}.csv"`,
      )
      .send(csv);
  });

  app.get("/api/v1/payroll-runs/:id/tax-filing", async (request, reply) => {
    requireRoles(request, "finance");
    assertExportAllowed(request);
    const query = request.query as {
      approvalRequestId?: string;
      dlpApprovalRequestId?: string;
    };
    await ensureApproval(
      request,
      "PAYROLL_TAX_FILING",
      query.approvalRequestId,
    );
    if (query.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: query.approvalRequestId,
        actionType: "PAYROLL_TAX_FILING",
        targetType: "PAYROLL_RUN",
        targetId: idOf(request),
      });
    }
    const run = await platformStore.getPayrollRun(
      tenantOf(request),
      idOf(request),
    );
    const csv = payrollTaxFilingCsv(run);
    await assertExportDlp(
      request,
      csv,
      "PAYROLL_RUN",
      run.id,
      query.dlpApprovalRequestId,
    );
    countEvent("payroll_tax_filing_exported");
    return reply
      .type("text/csv; charset=utf-8")
      .headers(exportHeaders(request, csv, "RESTRICTED"))
      .header(
        "content-disposition",
        `attachment; filename="payroll-tax-filing-${run.id}.csv"`,
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
    await platformStore.applyDueContractAmendments(tenantId);
    const contracts = await platformStore.listEmploymentContracts(
      tenantId,
    );
    const allRuns = await platformStore.listPayrollRuns(tenantId);
    const priorRun = allRuns
      .filter(
        (candidate) =>
          candidate.id !== run.id &&
          Date.parse(candidate.periodEnd) < Date.parse(run.periodStart) &&
          ["CALCULATED", "APPROVED", "PAID"].includes(candidate.status),
      )
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
    const priorIncentives: Record<string, string> = {};
    if (priorRun) {
      const detail = await platformStore.getPayrollRun(tenantId, priorRun.id);
      for (const line of detail.lines ?? []) {
        priorIncentives[line.contractId] = line.incentiveAmount;
      }
    }
    const ledger = await storeFor(request).listLedger();
    const unacknowledgedNoticesByPerson: Record<string, string[]> = {};
    let cycle: Awaited<
      ReturnType<ReturnType<typeof storeFor>["getEvaluationCycle"]>
    > | undefined;
    try {
      cycle = await storeFor(request).getEvaluationCycle(run.cycleId);
    } catch {
      cycle = undefined;
    }
    if (cycle?.policyVersionId) {
      const links = await platformStore.listPolicyNotices(
        tenantId,
        cycle.policyVersionId,
      );
      if (links.length > 0) {
        const notices = await platformStore.listNotices(tenantId);
        const noticeById = new Map(
          notices.map((notice) => [notice.id, notice]),
        );
        for (const link of links) {
          const notice = noticeById.get(link.noticeId);
          if (!notice?.acknowledgementRequired) continue;
          const coverage = await platformStore.listAcknowledgements(
            tenantId,
            notice.id,
          );
          const acknowledged = new Set(
            coverage.acknowledgements
              .filter((acknowledgement) =>
                Boolean(acknowledgement.acknowledgedAt),
              )
              .map((acknowledgement) => acknowledgement.personId),
          );
          for (const contract of contracts) {
            if (!acknowledged.has(contract.personId)) {
              const missing =
                unacknowledgedNoticesByPerson[contract.personId] ?? [];
              missing.push(notice.id);
              unacknowledgedNoticesByPerson[contract.personId] = missing;
            }
          }
        }
      }
    }
    const tenantSettings =
      (await platformStore.getTenant(tenantId)).settings ?? {};
    const taxMode =
      tenantSettings.payrollTaxMode === "STATUTORY_CN"
        ? ("STATUTORY_CN" as const)
        : ("DECLARED" as const);
    const priorYtd: Record<
      string,
      { taxableIncome: string; taxWithheld: string }
    > = {};
    if (taxMode === "STATUTORY_CN") {
      // Year-to-date totals from PAID runs in the same calendar year as this
      // run's period start (cumulative withholding method).
      const year = run.periodStart.slice(0, 4);
      const paidRuns = allRuns.filter(
        (candidate) =>
          candidate.id !== run.id &&
          candidate.status === "PAID" &&
          candidate.periodStart.slice(0, 4) === year,
      );
      for (const paidRun of paidRuns) {
        const detail = await platformStore.getPayrollRun(
          tenantId,
          paidRun.id,
        );
        for (const line of detail.lines ?? []) {
          const social = parseDecimal(line.socialInsuranceAmount);
          const gross = parseDecimal(line.grossAmount);
          const taxable = gross - social - 5_000_000n;
          const entry = priorYtd[line.personId] ?? {
            taxableIncome: "0",
            taxWithheld: "0",
          };
          priorYtd[line.personId] = {
            taxableIncome: formatDecimal(
              parseDecimal(entry.taxableIncome) +
                (taxable > 0n ? taxable : 0n),
            ),
            taxWithheld: formatDecimal(
              parseDecimal(entry.taxWithheld) + parseDecimal(line.taxAmount),
            ),
          };
        }
      }
    }
    const statutoryDeductionTypes = Array.isArray(
      tenantSettings.statutoryDeductionTypes,
    )
      ? (tenantSettings.statutoryDeductionTypes as {
          type: string;
          priority: number;
          requiresCourtOrder?: boolean;
          requiresConsent?: boolean;
          capRate?: string;
        }[])
      : undefined;
    const calculation = calculatePayroll({
      contracts,
      ledger,
      priorIncentives,
      unacknowledgedNoticesByPerson,
      taxMode,
      statutoryDeductionTypes,
      priorYtd: taxMode === "STATUTORY_CN" ? priorYtd : undefined,
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
    requireRoles(request, "manager", "finance", "integration");
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
    requireRoles(request, "manager", "finance", "integration");
    return data(
      await platformStore.listSyncRuns(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/sync-runs/:id/finish", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
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
    if (body.mode === "FORMAL") {
      const blockers = await formalCoverageBlockers(
        request,
        body.policyVersionId,
      );
      if (blockers.length > 0) {
        throw new CalculationBlockedError(blockers);
      }
    }
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
    const blockers = new Set<string>();
    for (const run of body.runs) {
      if (run.mode !== "FORMAL") continue;
      for (const blocker of await formalCoverageBlockers(
        request,
        run.policyVersionId,
      )) {
        blockers.add(blocker);
      }
    }
    if (blockers.size > 0) {
      throw new CalculationBlockedError([...blockers]);
    }
    const runs = await storeFor(request).createCalculationRunsBatch(body.runs);
    countEvent("calculation_batch_created");
    return reply.status(201).send(data({ runs }, request));
  });

  app.get("/api/v1/calculation-runs", async (request) => {
    const runs = await storeFor(request).listRuns();
    const person = personFilter(request);
    if (person) {
      return data(
        runs
          .filter((run) =>
            run.lines.some((line) => line.personId === person),
          )
          .map((run) => redactRunForPerson(run, person)),
        request,
      );
    }
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) {
      return data(runs, request);
    }
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    return data(
      runs.map((run) =>
        redactCalculationRunFields(run, { roles, policies, matchContext }),
      ),
      request,
    );
  });

  app.get("/api/v1/calculation-runs/:id", async (request) => {
    const run = await storeFor(request).getRun(idOf(request));
    const person = personFilter(request);
    if (person) {
      if (!run.lines.some((line) => line.personId === person)) {
        throw new ForbiddenError(
          "calculation run is not visible to this person",
        );
      }
      return data(redactRunForPerson(run, person), request);
    }
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) {
      return data(run, request);
    }
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    return data(
      redactCalculationRunFields(run, { roles, policies, matchContext }),
      request,
    );
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
    assertExportAllowed(request);
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const cycleId = paramOf(request, "cycleId");
    const exportQuery = request.query as {
      legalEntity?: string;
      jurisdiction?: string;
      dlpApprovalRequestId?: string;
    };
    const legalEntity = exportQuery.legalEntity?.trim();
    const jurisdiction = exportQuery.jurisdiction?.trim();
    const scoped = Boolean(legalEntity || jurisdiction);
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

    const scopedPolicies = policyVersions.filter((policy) => {
      if (!scoped) return true;
      if (legalEntity && policy.applicability?.legalEntity !== legalEntity) {
        return false;
      }
      if (
        jurisdiction &&
        !policy.applicability?.jurisdictions?.includes(jurisdiction)
      ) {
        return false;
      }
      return true;
    });
    const scopedPolicyIds = new Set(
      scopedPolicies.map((policy) => policy.policyVersionId),
    );
    const runs = allRuns.filter(
      (run) =>
        run.cycleId === cycleId &&
        (!scoped || scopedPolicyIds.has(run.policyVersionId)),
    );
    if (scoped && runs.length === 0) {
      throw new ConflictError(
        "EVIDENCE_PACKAGE_SCOPE_EMPTY: no calculation run matches the requested legal entity/jurisdiction",
      );
    }
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
    const auditEvents = await auditEventsForViewer(
      request,
      allAuditEvents.filter(
        (event) => event.objectId && knownIds.has(event.objectId),
      ),
    );
    const [auditChainValid, ledgerValid] = await Promise.all([
      store.verifyAuditChain(),
      store.verifyLedger(),
    ]);
    const packageBody = {
      schemaVersion: "n-perform.evidence-package/v1",
      generatedAt: new Date().toISOString(),
      tenantId,
      scope: {
        legalEntity: legalEntity ?? null,
        jurisdiction: jurisdiction ?? null,
      },
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
    const packageHash = sha256(packageBody);
    const viewerRoles = request.authContext?.roles ?? [];
    const fieldPolicies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, fieldPolicies);
    const viewerPersonId = ownPersonId(request);
    // The hash identifies the canonical package; the response body is filtered
    // through the field matrix so an export cannot bypass read redaction.
    const viewerBody = {
      ...packageBody,
      evidence: {
        ...packageBody.evidence,
        nodes: packageBody.evidence.nodes.map((node) =>
          redactResourceFields(node, "EVIDENCE", {
            personId: viewerPersonId,
            recordPersonId: node.submittedBy,
            roles: viewerRoles,
            policies: fieldPolicies,
            matchContext,
          }),
        ),
      },
      calculations: packageBody.calculations.map((run) =>
        redactCalculationRunFields(run, {
          roles: viewerRoles,
          policies: fieldPolicies,
          matchContext,
        }),
      ),
      settlements: {
        ...packageBody.settlements,
        batches: packageBody.settlements.batches.map((batch) =>
          redactSettlementBatchFields(batch, {
            personId: viewerPersonId,
            roles: viewerRoles,
            policies: fieldPolicies,
            matchContext,
          }),
        ),
      },
    };
    await assertExportDlp(
      request,
      JSON.stringify(viewerBody),
      "EVIDENCE_PACKAGE",
      packageBody.cycle.id,
      exportQuery.dlpApprovalRequestId,
    );
    return data({ ...viewerBody, packageHash }, request);
  });

  app.post("/api/v1/audit-events/:id/redactions", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createAuditRedactionSchema, request.body);
    const redaction = await platformStore.createAuditRedaction({
      tenantId: tenantOf(request),
      auditEventId: idOf(request),
      replacement: body.replacement ?? "[REDACTED]",
      reason: body.reason,
      requestedBy: body.requestedBy,
      approvedBy: body.approvedBy,
    });
    countEvent("audit_redaction_created");
    return reply.status(201).send(data(redaction, request));
  });

  app.get("/api/v1/audit-redactions", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.listAuditRedactions(tenantOf(request)),
      request,
    );
  });

  app.get("/api/v1/audit-events", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { limit?: string };
    const parsed = Number(query.limit ?? 100);
    const limit = Number.isFinite(parsed) ? parsed : 100;
    return data(
      await auditEventsForViewer(
        request,
        await storeFor(request).listAuditEvents(limit),
      ),
      request,
    );
  });

  app.get("/api/v1/audit-events/durability", async (request) => {
    requireRoles(request, "admin", "finance");
    const wormConfigured = Boolean(process.env.AUDIT_WORM_URI);
    const mirrorConfigured = Boolean(process.env.AUDIT_MIRROR_URI);
    const tsaConfigured = Boolean(process.env.AUDIT_TSA_URL);
    const drillAt = process.env.AUDIT_RESTORE_DRILL_AT;
    const drillTime = drillAt ? Date.parse(drillAt) : Number.NaN;
    const restoreDrillRecent =
      Number.isFinite(drillTime) &&
      Date.now() - drillTime <= 90 * 24 * 60 * 60 * 1000;
    const ready =
      wormConfigured &&
      mirrorConfigured &&
      tsaConfigured &&
      restoreDrillRecent;
    return data(
      {
        generatedAt: new Date().toISOString(),
        ready,
        checks: {
          wormConfigured,
          mirrorConfigured,
          tsaConfigured,
          restoreDrillRecent,
          restoreDrillAt: Number.isFinite(drillTime)
            ? new Date(drillTime).toISOString()
            : null,
        },
        note: ready
          ? "Deployment reports WORM, dual-copy, TSA and a recent restore drill. Keep bucket policies and TSA receipts in the evidence pack."
          : "Durability is not fully configured. This reports configuration presence only; it does not prove the controls work. Complete the MON-07 runbook and attach evidence.",
      },
      request,
    );
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
    const batches = await storeFor(request).listSettlementBatches();
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) return data(batches, request);
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    const personId = ownPersonId(request);
    return data(
      batches.map((batch) =>
        redactSettlementBatchFields(batch, {
          personId,
          roles,
          policies,
          matchContext,
        }),
      ),
      request,
    );
  });

  app.get("/api/v1/settlement-batches/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    const batch = await storeFor(request).getSettlementBatch(idOf(request));
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) return data(batch, request);
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    return data(
      redactSettlementBatchFields(batch, {
        personId: ownPersonId(request),
        roles,
        policies,
        matchContext,
      }),
      request,
    );
  });

  app.post("/api/v1/settlement-batches/:id/commands", async (request) => {
    requireRoles(request, "finance");
    const body = parse(settlementCommandSchema, request.body);
    if (body.command === "EXPORT") assertExportAllowed(request);
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
