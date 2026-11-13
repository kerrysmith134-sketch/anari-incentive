import { randomBytes, randomUUID } from "node:crypto";
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
  createIncentiveAwardBatchSchema,
  importIncentiveAwardBatchSchema,
  importEmploymentContractsSchema,
  adjustEquityGrantSchema,
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
  assessEvidenceCoverageSchema,
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
  feishuSyncSchema,
  passwordLoginSchema,
  goldSetImportSchema,
  advanceCycleSchema,
  runsFromIngestionSchema,
  preReviewSchema,
  setPasswordSchema,
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
  agentChatSchema,
  agentCommandSchema,
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
  dataGovernanceCoverage,
  legalGateBlockers,
  type AiMember,
  type AuditEvent,
  type AuditRedaction,
  type CalculationRun,
  type CycleReadinessReport,
  type EquityGrantCase,
  type OperationsCoverageReport,
  type PerformanceGoalCard,
  type PayrollLine,
  type PayrollRun,
  type PersonalTaskInventory,
  type PolicyReadinessReport,
  type PolicyRollbackResult,
  type PolicyTestSuiteResult,
  type SettlementBatch,
  type StrategicPoolCase,
  type TaskPod,
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
  assessEvidenceCoverage,
  type EvaluationGate,
} from "@anari/ai-gate";
import { calculateCumulativeIit } from "@anari/payroll-tax";
import {
  FIELD_MAPPING_PRESETS,
  parseCsv,
  verifyFeishuSignature,
  verifyHubSpotSignature,
  verifyWebhookSignature,
} from "@anari/connectors";
import {
  AuthError,
  DevHeaderAuthenticator,
  SessionJwt,
  ForbiddenError,
  type Authenticator,
} from "@anari/auth";
import {
  annualMetricTemplate,
  calculateAnnualProfitSharing,
  calculateAnnualScorecard,
  calculateBountySettlement,
  calculateBusinessUnitCommission,
  calculateCapTableSnapshot,
  calculateDbcp,
  calculateEquityGrant,
  calculateEquityTax,
  calculateExecutiveSupplement,
  calculateFunctionalQuarterlyBonus,
  calculateInternalSplit,
  calculateMonthlyPerformanceWage,
  calculateOptionStrikePrice,
  calculateOverseasSalesAward,
  calculateRepurchase,
  calculateTaskClosureRate,
  calculateTechCenterAward,
  calculateTechCenterPool,
  calculateVestingSchedule,
  diffPolicyDefinitions,
  div,
  evaluateMonthlyStar,
  formatDecimal,
  monthlyMetricTemplate,
  mul,
  parseDecimal,
  quarterlyMetricTemplate,
  scorePerformance,
  sha256,
  simulateMarginalChange,
  simulatePolicyChange,
  validatePerformanceMetricSet,
  validatePersonalTaskInventory,
  validateTaskPod,
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
import {
  seatsRemainingFor,
  syncFeishuDirectory,
} from "./feishu-sync.js";
import {
  extractJson,
  llmChatComplete,
  type LlmMessage,
} from "./llm.js";
import { hashPassword, verifyPassword } from "./password.js";
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

import {
  data,
  errorBody,
  idOf,
  parse,
  tenantOf,
  requireRoles,
  isPrivileged,
  ownPersonId,
  isPlatformAdmin,
  requirePlatformAdmin,
  requireTenantAdmin,
  personFilter,
  policyBody,
  requireString,
  runPolicyInput,
  paramOf,
  columnIndexFor,
} from "./http-helpers.js";
import {
  findActivityMetricKeys,
  findActivityMonitoringText,
} from "./modules/governance/activity-monitoring.js";
import { RETENTION_RECOMMENDATIONS } from "./modules/governance/retention-defaults.js";
import { registerDataGovernanceRoutes } from "./modules/governance/data-governance.routes.js";
import { registerEvidenceRoutes } from "./modules/evidence/evidence.routes.js";
import { registerAppealsRoutes } from "./modules/appeals/appeals.routes.js";
import { registerAttributionRoutes } from "./modules/attribution/attribution.routes.js";
import { notifyBestEffort } from "./notify.js";
import { registerContributionRoutes } from "./modules/contribution/contribution.routes.js";
import { registerPolicyEngineRoutes } from "./modules/policy/policy.routes.js";
import { registerClawbackRoutes } from "./modules/clawback/clawback.routes.js";
import { registerStrategicPoolRoutes } from "./modules/strategicpool/strategic-pool.routes.js";
import { registerEvaluationRoutes } from "./modules/evaluation/evaluation.routes.js";
import { registerNotificationRoutes } from "./modules/notifications/notifications.routes.js";
import { registerAiGovernanceRoutes } from "./modules/aigovernance/ai-governance.routes.js";
import { registerWorkflowRunRoutes } from "./modules/workflow/workflow-runs.routes.js";
import { registerIntegrationRoutes } from "./modules/integrations/integration.routes.js";
import { registerAdverseActionRoutes } from "./modules/adverse/adverse-actions.routes.js";
import { registerApprovalRoutes } from "./modules/approvals/approval-requests.routes.js";
import { registerPayrollRoutes } from "./modules/settlement/payroll.routes.js";
import { registerRewardsRoutes } from "./modules/rewards/rewards.routes.js";
import { registerSettlementRoutes } from "./modules/settlement/settlement-budget.routes.js";
import { registerWorkPackageRoutes } from "./modules/workpackages/work-packages.routes.js";

type IdParams = { id: string };

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
  /** HMAC secret for locally-issued console session tokens. */
  sessionSecret?: string;
  /** Feishu OAuth sign-in + session tokens for the console. */
  feishu?: {
    appId: string;
    appSecret: string;
    sessionSecret: string;
    /** Tenant that Feishu sign-ins belong to. */
    tenantId: string;
    /** Console origin for redirects (defaults to the request host). */
    consoleBaseUrl?: string;
    fetchImpl?: typeof fetch;
  };
  /** LLM 意图解析（OpenAI 兼容）；未配置时 /agent-chat 返回 501。 */
  agentChat?: {
    provider: string;
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

/** Reversed or cancelled runs must never produce a payable file. */
function assertPayrollExportable(run: PayrollRun): void {
  if (run.status === "REVERSED" || run.status === "CANCELLED") {
    throw new ConflictError(
      `PAYROLL_RUN_${run.status}: a closed payroll run cannot be exported`,
    );
  }
}

/** Platform operators only; a tenant `admin` is not a platform operator. */
/** Any signed-in member of the tenant may read its basic people directory. */
function requireTenantMember(request: FastifyRequest, tenantId: string): void {
  if (isPlatformAdmin(request)) return;
  if (tenantId !== tenantOf(request)) {
    throw new ForbiddenError("cannot read another tenant's directory");
  }
}

/** Owner, members and privileged staff may drive a work package forward. */
async function assertWorkPackageParticipant(
  request: FastifyRequest,
  store: IncentiveStore,
  workPackageId: string,
): Promise<void> {
  const person = ownPersonId(request);
  if (!person || isPrivileged(request)) return;
  const workPackage = await store.getWorkPackage(workPackageId);
  if (
    workPackage.ownerPersonId !== person &&
    !workPackage.members.some((member) => member.personId === person)
  ) {
    throw new ForbiddenError("work package is not visible to this person");
  }
}

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

const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

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

type DenialMode = "OMIT" | "ZERO" | "REDACT";

export interface FieldAccessMatchContext {
  viewerPersonId?: string;
  managerByPerson: Map<string, string | undefined>;
  activePersons: Set<string>;
  orgNodesByPerson: Map<string, Set<string>>;
  legalEntityByPerson: Map<string, string | undefined>;
  /** Retention categories currently under legal hold. */
  heldCategories: Set<string>;
}

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

/**
 * Explicit surveillance phrases in free text. Deliberately narrow: generic
 * words such as "monitoring" or "screenshot" alone are legitimate evidence
 * descriptions, so only unambiguous behaviour-surveillance phrasing blocks.
 */

/**
 * Detect activity-surveillance language in free-text payload values. This
 * complements the structured-key block for DATA-05; the match is intentionally
 * phrase-based so normal delivery or order text is unaffected.
 */

/** Detect common unmasked identifiers in an export payload. */
export function scanExportDlp(
  text: string,
  extraRules: Array<{ code: string; pattern: string; flags?: string }> = [],
): string[] {
  const patterns: Array<{ code: string; pattern: RegExp }> = [
    { code: "CHINESE_ID", pattern: /\b\d{17}[\dXx]\b/g },
    { code: "BANK_CARD", pattern: /\b\d{16,19}\b/g },
    { code: "PHONE", pattern: /\b1[3-9]\d{9}\b/g },
    { code: "EMAIL", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  ];
  for (const rule of extraRules) {
    try {
      patterns.push({
        code: rule.code || "CUSTOM",
        pattern: new RegExp(rule.pattern, rule.flags ?? "g"),
      });
    } catch {
      /* invalid tenant rule is ignored; management API validates on write */
    }
  }
  const findings = new Set<string>();
  for (const { code, pattern } of patterns) {
    if (pattern.test(text)) findings.add(code);
    pattern.lastIndex = 0;
  }
  return [...findings];
}

/** Parameters the model may pass per command; everything else is dropped. */
const AGENT_CHAT_PARAM_KEYS: Record<string, string[]> = {
  check_settlement_readiness: ["runId"],
  check_appeal_sla: [],
  propose_policy_change: [],
  scan_evidence_gaps: [],
  scan_contribution_anomalies: [],
  scan_data_quality: [],
  run_cycle_pre_review: [],
  draft_evaluations: [],
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The command name is already whitelisted; the payload must be too. Without
 * this the model could hand the POLICY_PROPOSAL skill an attacker-authored
 * policy body and samples.
 */
export function sanitizeAgentChatParams(
  command: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set([
    "idempotencyKey",
    ...(AGENT_CHAT_PARAM_KEYS[command] ?? []),
  ]);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!allowed.has(key)) continue;
    if (key === "runId" && (typeof value !== "string" || !UUID_PATTERN.test(value))) {
      continue;
    }
    if (key === "idempotencyKey" && typeof value !== "string") continue;
    clean[key] = value;
  }
  return clean;
}

const AGENT_COMMANDS: Record<
    string,
    { agentType: Parameters<AgentRuntime["enqueue"]>[0]["agentType"]; input?: (params: Record<string, unknown>) => Record<string, unknown> }
  > = {
    scan_evidence_gaps: { agentType: "EVIDENCE_GAP" },
    scan_contribution_anomalies: { agentType: "CONTRIBUTION_ANOMALY" },
    scan_data_quality: { agentType: "DATA_QUALITY" },
    check_settlement_readiness: {
      agentType: "SETTLEMENT_READINESS",
      input: (params) => params,
    },
    run_cycle_pre_review: { agentType: "CYCLE_PRE_REVIEW" },
    check_appeal_sla: {
      agentType: "APPEAL_SLA",
      input: (params) => params,
    },
    propose_policy_change: { agentType: "POLICY_PROPOSAL" },
    draft_evaluations: { agentType: "EVALUATION_DRAFT" },
  };

export function buildApp(
  storeOrResolver: IncentiveStore | StoreResolver = new Store(),
  agentRuntimeOrFactory?: AgentRuntime | AgentRuntimeFactory,
  authenticator: Authenticator = new DevHeaderAuthenticator({
    tenantId: "tenant-demo",
    userId: "dev-user",
    personId: "00000000-0000-4000-8000-000000000001",
    roles: ["admin", "platform_admin"],
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
    // Brand assets live at dist/brand and must be reachable at both
    // /console/brand/... (in-app references) and /brand/... (favicon).
    app.register(fastifyStatic, {
      root: `${consoleDist}/brand`,
      prefix: "/brand/",
      wildcard: false,
      decorateReply: false,
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
    let extraRules: Array<{ code: string; pattern: string; flags?: string }> = [];
    try {
      const tenant = await platformStore.getTenant(tenantOf(request));
      const configured = (tenant.settings as { exportDlpRules?: unknown })
        .exportDlpRules;
      if (Array.isArray(configured)) {
        extraRules = configured as Array<{
          code: string;
          pattern: string;
          flags?: string;
        }>;
      }
    } catch {
      extraRules = [];
    }
    const findings = scanExportDlp(text, extraRules);
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

  /** Who exported which sensitive artifact, for the immutable audit trail. */
  async function auditExport(
    request: FastifyRequest,
    action: string,
    objectType: string,
    objectId: string,
    detail?: string,
  ): Promise<void> {
    try {
      await storeFor(request).recordAuditEvent({
        actorType: "USER",
        actorId: ownPersonId(request) ?? request.authContext?.userId,
        action,
        objectType,
        objectId,
        reason: detail,
      });
    } catch {
      /* audit must not break the download */
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
    const consumed = await platformStore.consumeApprovalRequest({
      tenantId,
      requestId: approval.id,
      consumedBy,
    });
    // NPV2-008：消费即留痕——审计直接关联 command action、目标与审批请求，
    // 满足「审计能关联 command/request/ledger」的验收项。
    try {
      await storeFor(request).recordAuditEvent({
        actorType: "USER",
        actorId: consumedBy,
        action: `APPROVAL_CONSUMED_${input.actionType}`,
        objectType: input.targetType,
        objectId: input.targetId,
        reason: `approvalRequest=${approval.id} payloadHash=${approval.payloadHash}`,
      });
    } catch {
      /* audit is best-effort for legacy stores */
    }
    void consumed;
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

  // NPV2-011：证据/摄取域路由已拆分至 modules/evidence（行为等价迁移）。
  app.register(registerContributionRoutes({ platformStore, storeFor }));

  app.register(
    registerPolicyEngineRoutes({ platformStore, storeFor, countEvent }),
  );

  app.register(registerAttributionRoutes({
    storeFor,
    countEvent,
    assertNoAdjudicatorConflict,
  }));

  app.register(
    registerAppealsRoutes({
      platformStore,
      storeFor,
      countEvent,
      assertRecalculationTarget,
    }),
  );

  app.register(
    registerWorkPackageRoutes({
      storeFor,
      assertWorkPackageParticipant: (request, store, workPackageId) =>
        assertWorkPackageParticipant(request, store, workPackageId),
    }),
  );

  app.register(
    registerEvidenceRoutes({
      storeFor,
      countEvent,
      fieldPoliciesFor: (request) => fieldPoliciesFor(request),
      fieldMatchContextFor: (request, policies) =>
        fieldMatchContextFor(
          request,
          policies as Record<string, FieldAccessPolicy> | undefined,
        ),
      redactResourceFields: (record, resourceType, viewer) =>
        redactResourceFields(
          record as Parameters<typeof redactResourceFields>[0],
          resourceType as Parameters<typeof redactResourceFields>[1],
          viewer as Parameters<typeof redactResourceFields>[2],
        ),
    }),
  );

  app.register(registerApprovalRoutes({ platformStore, countEvent }));
  app.register(registerClawbackRoutes({ platformStore, storeFor, countEvent, notifyBestEffort }));
  app.register(registerEvaluationRoutes({ platformStore, storeFor, countEvent }));
  app.register(registerNotificationRoutes({ storeFor }));
  app.register(registerStrategicPoolRoutes({ platformStore, storeFor, countEvent }));
  app.register(
    registerAiGovernanceRoutes({
      platformStore,
      storeFor,
      countEvent,
      modelScoring: options.modelScoring,
      fieldPoliciesFor: (request) => fieldPoliciesFor(request),
      fieldMatchContextFor: (request, policies) =>
        fieldMatchContextFor(
          request,
          policies as Record<string, FieldAccessPolicy> | undefined,
        ),
      redactResourceFields: (record, resourceType, viewer) =>
        redactResourceFields(
          record as Parameters<typeof redactResourceFields>[0],
          resourceType as Parameters<typeof redactResourceFields>[1],
          viewer as Parameters<typeof redactResourceFields>[2],
        ),
    }),
  );
  app.register(registerWorkflowRunRoutes({ platformStore }));
  app.register(registerIntegrationRoutes({ platformStore, countEvent }));
  app.register(registerAdverseActionRoutes({ platformStore, countEvent }));
  app.register(registerRewardsRoutes({ platformStore, storeFor, countEvent }));
  app.register(
    registerSettlementRoutes({
      platformStore,
      storeFor,
      countEvent,
      notifyBestEffort,
      ensureApproval,
      consumeApprovalForAction,
      assertExportDlp,
      assertExportAllowed,
      fieldPoliciesFor: (request) => fieldPoliciesFor(request),
      fieldMatchContextFor: (request, policies) =>
        fieldMatchContextFor(
          request,
          policies as Record<string, FieldAccessPolicy> | undefined,
        ),
      redactSettlementBatchFields: (batch, viewer) =>
        redactSettlementBatchFields(
          batch as Parameters<typeof redactSettlementBatchFields>[0],
          viewer as Parameters<typeof redactSettlementBatchFields>[1],
        ),
    }),
  );
  app.register(
    registerPayrollRoutes({
      platformStore,
      storeFor,
      countEvent,
      ensureApproval,
      consumeApprovalForAction,
      assertExportAllowed,
      assertExportDlp: (request, text, targetType, targetId, approvalRequestId) =>
        assertExportDlp(request, text, targetType, targetId, approvalRequestId),
      exportHeaders,
      auditExport,
      fieldPoliciesFor: (request) => fieldPoliciesFor(request),
      fieldMatchContextFor: (request, policies) =>
        fieldMatchContextFor(
          request,
          policies as Record<string, FieldAccessPolicy> | undefined,
        ),
      redactResourceFields: (record, resourceType, viewer) =>
        redactResourceFields(
          record as Parameters<typeof redactResourceFields>[0],
          resourceType as Parameters<typeof redactResourceFields>[1],
          viewer as Parameters<typeof redactResourceFields>[2],
        ),
      payrollRunForViewer: (request, run) => payrollRunForViewer(request, run),
      redactContractAmendmentTerms,
    }),
  );

  // NPV2-011：数据治理域路由已拆分至 modules/governance（行为等价迁移）。
  app.register(
    registerDataGovernanceRoutes({
      platformStore,
      storeFor,
      countEvent,
      auditExport,
    }),
  );

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

  // Lenient JSON body parser: a POST with `content-type: application/json`
  // and an empty body (rate-limit, submit, command-style routes) is treated as
  // `{}` instead of failing with FST_ERR_CTP_EMPTY_JSON_BODY. Malformed JSON
  // still surfaces as 400 through the error handler.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      const text = typeof body === "string" ? body.trim() : "";
      if (text.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (error) {
        // 统一交给错误处理器的 FST_ERR_* 分支（映射为 400 VALIDATION_ERROR）
        const wrapped = new SyntaxError(
          error instanceof Error ? error.message : "invalid json",
        );
        (wrapped as { code?: string }).code = "FST_ERR_CTP_INVALID_JSON";
        (wrapped as { statusCode?: number }).statusCode = 400;
        done(wrapped, undefined);
      }
    },
  );

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
    // Browser OAuth redirects; the callback validates one-time state itself.
    if (request.url.startsWith("/api/v1/auth/")) return;
    try {
      // 反向代理（nginx basic-auth 等）会改写/吃掉 Authorization 头，
      // 因此同时接受 x-session-token，两者等价。真实 Bearer 优先；
      // Authorization 若是代理塞进来的 Basic 头，则回退到会话令牌。
      const sessionHeader = request.headers["x-session-token"];
      const authorization = request.headers.authorization;
      const bearer =
        authorization && authorization.startsWith("Bearer ")
          ? authorization
          : typeof sessionHeader === "string" && sessionHeader.length > 0
            ? `Bearer ${sessionHeader}`
            : authorization;
      request.authContext = await authenticator.authenticate({
        authorization: bearer,
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
    // node-postgres surfaces a malformed UUID as 22P02 before the store can
    // raise NotFoundError. Treat it as a missing resource, not a server fault.
    if ((error as { code?: string }).code === "22P02") {
      return reply.status(404).send({
        ...errorBody("NOT_FOUND", "malformed resource identifier"),
        meta: { correlation_id: request.id },
      });
    }
    // Fastify body-parser failures (invalid/empty JSON, unsupported media type)
    // carry FST_ERR_* codes; without this they fell through to 500.
    const parserCode = (error as { code?: string }).code;
    if (
      typeof parserCode === "string" &&
      parserCode.startsWith("FST_ERR_")
    ) {
      const status = parserCode.startsWith("FST_ERR_CTP_INVALID_JSON")
        ? 400
        : ((error as { statusCode?: number }).statusCode ?? 400);
      return reply.status(status).send({
        ...errorBody(
          status === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "VALIDATION_ERROR",
          "malformed or empty request body",
        ),
        meta: { correlation_id: request.id },
      });
    }
    // Domain errors that carry their own string code + 4xx statusCode keep
    // code/message intact (e.g. module-local BadRequestError INVALID_BODY).
    const domainCode = (error as { code?: unknown }).code;
    const domainStatus = (error as { statusCode?: unknown }).statusCode;
    if (
      typeof domainCode === "string" &&
      typeof domainStatus === "number" &&
      domainStatus >= 400 &&
      domainStatus < 500 &&
      !/^\d{5}$/.test(domainCode)
    ) {
      return reply.status(domainStatus).send({
        ...errorBody(domainCode, (error as Error).message),
        meta: { correlation_id: request.id },
      });
    }
    // Remaining PostgreSQL integrity errors must not surface as 500s.
    const pgCode = (error as { code?: string }).code;
    if (pgCode === "23503") {
      return reply.status(404).send({
        ...errorBody("NOT_FOUND", "referenced record does not exist"),
        meta: { correlation_id: request.id },
      });
    }
    if (pgCode === "23505") {
      return reply.status(409).send({
        ...errorBody("CONFLICT", "duplicate value violates a unique constraint"),
        meta: { correlation_id: request.id },
      });
    }
    if (pgCode === "23514" || pgCode === "23502" || pgCode === "22003") {
      return reply.status(400).send({
        ...errorBody(
          "VALIDATION_ERROR",
          pgCode === "22003"
            ? "numeric value is out of range"
            : "value violates a database constraint",
        ),
        meta: { correlation_id: request.id },
      });
    }
    if (pgCode === "22007" || pgCode === "22008") {
      return reply.status(400).send({
        ...errorBody("VALIDATION_ERROR", "invalid date value"),
        meta: { correlation_id: request.id },
      });
    }
    console.error(`[api] ${request.method} ${request.url} failed`, error);
    return reply.status(500).send({
      ...errorBody("INTERNAL_ERROR", "internal server error"),
      meta: { correlation_id: request.id },
    });
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

  // AI-04 草稿生成 workflow：确定性证据覆盖预审。
  // AI 只产草稿（无分数）；决策必须人工作出（store 层强制）。

  // 周期推进状态机（AI_PRE_REVIEW→HUMAN_REVIEW 与 HUMAN_REVIEW→DECIDED 带门禁）。
  // 结算单 HTML（打印即 PDF，中文）。
  app.get("/api/v1/settlement-batches/:id/report", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const store = storeFor(request);
    const storedBatch = await store.getSettlementBatch(idOf(request));
    // The printable report is an export: apply the same field matrix as the
    // JSON read routes instead of rendering raw salary/amount columns.
    const roles = request.authContext?.roles ?? [];
    let batch = storedBatch;
    if (!roles.includes("admin")) {
      const policies = await fieldPoliciesFor(request);
      const matchContext = await fieldMatchContextFor(request, policies);
      batch = redactSettlementBatchFields(storedBatch, {
        personId: ownPersonId(request),
        roles,
        policies,
        matchContext,
      });
    }
    const active = (batch.lines ?? []).filter((line) => line.active);
    const total = active.reduce((sum, line) => sum + Number(line.amount), 0);
    const esc = (v: unknown): string =>
      String(v ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[char]!);
    const rows = active
      .map(
        (line) => `<tr>
          <td>${esc(line.personName ?? line.personId)}</td>
          <td>${esc(line.personCode ?? "")}</td>
          <td style="text-align:right">${esc(line.amount)}</td>
          <td>${esc(line.currency)}</td>
        </tr>`,
      )
      .join("");
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>结算单 ${esc(batch.batchNo)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 720px; margin: 32px auto; color: #1a1a1a; }
  h1 { font-size: 20px; } table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: left; font-size: 13px; }
  .meta { color: #666; font-size: 12px; } .total { font-weight: 600; }
  @media print { .no-print { display: none; } }
</style></head><body>
<h1>激励结算单</h1>
<p class="meta">批次号 ${esc(batch.batchNo)} · 周期 ${esc(batch.cycleId)} · 状态 ${esc(batch.status)} · 币种 ${esc(batch.currency)}</p>
<table>
  <thead><tr><th>人员</th><th>工号</th><th style="text-align:right">金额</th><th>币种</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td class="total" colspan="2">合计</td><td class="total" style="text-align:right">${esc(batch.totalAmount)}</td><td></td></tr></tfoot>
</table>
<p class="meta no-print">使用浏览器打印（Ctrl/Cmd+P）另存为 PDF。本单由系统确定性引擎生成，哈希与审计链可验证。</p>
</body></html>`;
    await auditExport(
      request,
      "SETTLEMENT_REPORT_VIEWED",
      "SETTLEMENT_BATCH",
      batch.id,
    );
    return reply.type("text/html; charset=utf-8").send(html);
  });

  // 周期报告 HTML（中文，打印即 PDF）。
  app.get("/api/v1/reports/cycles/:id/report", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const cycle = await storeFor(request).getEvaluationCycle(idOf(request));
    const store = storeFor(request);
    const runs = (await store.listRuns()).filter(
      (run) => run.cycleId === idOf(request),
    );
    const formalLocked = runs.filter(
      (run) => run.mode === "FORMAL" && run.status === "LOCKED",
    ).length;
    const batchRows = (await store.listSettlementBatches()).filter(
      (batch) => batch.cycleId === idOf(request),
    );
    const confirmedCount = (await store.listConfirmations()).filter(
      (confirmation) =>
        confirmation.targetType === "CALCULATION" &&
        confirmation.decision === "CONFIRMED",
    ).length;
    const readiness = {
      readyForSettlement: formalLocked > 0 && batchRows.length > 0,
      blockers: [
        ...(formalLocked === 0 ? ["没有已锁定的正式计算批次"] : []),
        ...(batchRows.length === 0 ? ["尚未创建结算批次"] : []),
      ],
      formalLocked,
      batchCount: batchRows.length,
      confirmations: confirmedCount,
    };
    const esc = (v: unknown): string =>
      String(v ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[char]!);
    const blockers = readiness.blockers
      .map((blocker: string) => `<li>${esc(blocker)}</li>`)
      .join("");
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>周期报告 ${esc(cycle.name)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 720px; margin: 32px auto; color: #1a1a1a; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 24px; }
  .meta { color: #666; font-size: 12px; }
  ul { padding-left: 20px; } li { font-size: 13px; }
  @media print { .no-print { display: none; } }
</style></head><body>
<h1>考核周期报告</h1>
<p class="meta">${esc(cycle.name)} · ${esc(cycle.startsAt.slice(0, 10))} 至 ${esc(cycle.endsAt.slice(0, 10))} · 状态 ${esc(cycle.status)}</p>
<h2>就绪度</h2>
<p>结算就绪：<strong>${readiness.readyForSettlement ? "是" : "否"}</strong></p>
<h2>阻断项</h2>
${blockers ? `<ul>${blockers}</ul>` : "<p>无阻断项。</p>"}
<p class="meta no-print">使用浏览器打印（Ctrl/Cmd+P）另存为 PDF。生成时间 ${new Date().toISOString()}。</p>
</body></html>`;
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.post("/api/v1/evaluation-cycles/:id/advance", async (request) => {
    requireRoles(request, "manager", "admin");
    const body = parse(advanceCycleSchema, request.body);
    const store = storeFor(request);
    if (body.status === "HUMAN_REVIEW") {
      // 门禁：预审必须已产出 AGENT 草稿。
      const drafts = await store.listEvaluationDrafts({ cycleId: idOf(request) });
      if (!drafts.some((draft) => draft.generatedByType === "AGENT")) {
        throw new ConflictError(
          "PRE_REVIEW_REQUIRED: 先运行 pre-review 生成 AGENT 草稿",
        );
      }
    }
    if (body.status === "DECIDED") {
      // 门禁：所有草稿均已决策（无 DRAFT/SUBMITTED 残留）。
      const drafts = await store.listEvaluationDrafts({ cycleId: idOf(request) });
      const undecided = drafts.filter(
        (draft) => draft.status === "DRAFT" || draft.status === "SUBMITTED",
      );
      if (undecided.length > 0) {
        throw new ConflictError(
          `UNDECIDED_DRAFTS: ${undecided.length} 份草稿尚未决策`,
        );
      }
    }
    const cycle = await store.advanceEvaluationCycle(idOf(request), {
      status: body.status,
      reason: body.reason,
      actorPersonId: ownPersonId(request),
    });
    countEvent("evaluation_cycle_advanced");
    return data(cycle, request);
  });

  // CRM/ERP → 计算适配：把摄取的订单证据物化为影子计算批次。
  app.post("/api/v1/calculation-runs:from-ingestion", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(runsFromIngestionSchema, request.body);
    const store = storeFor(request);
    const cycle = await store.getEvaluationCycle(body.cycleId);
    const windowStart = Date.parse(cycle.startsAt);
    const windowEnd = Date.parse(cycle.endsAt);
    const evidence = (await store.listEvidence()).filter(
      (node) =>
        node.sourceSystem === body.sourceSystem &&
        node.evidenceType === body.evidenceType &&
        Date.parse(node.observedAt) >= windowStart &&
        Date.parse(node.observedAt) <= windowEnd &&
        // Parenthesised: UNVERIFIED evidence still has to match source, type
        // and observation window. The old precedence admitted every
        // UNVERIFIED node on the tenant.
        (node.qualityStatus === "VALID" ||
          node.qualityStatus === "UNVERIFIED"),
    );
    if (evidence.length === 0) {
      return data(
        {
          created: [],
          skipped: [],
          note: "窗口内没有该来源的有效订单证据",
        },
        request,
      );
    }
    const identities = await platformStore.listExternalIdentities(
      tenantOf(request),
      { sourceSystem: body.sourceSystem },
    );
    const identityByExternal = new Map(
      identities.map((row) => [row.externalId, row.personId]),
    );
    // 幂等：同一外部订单只物化一次（按 order.id 比对既有批次）。
    const existingRuns = await store.listRuns();
    const materializedOrderIds = new Set(
      existingRuns.map((run) => run.inputSnapshot?.order?.id),
    );
    const created: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];
    for (const node of evidence) {
      const payload = node.normalizedPayload as Record<string, unknown>;
      const grossProfit = payload.grossProfit ?? payload.amount;
      if (grossProfit === undefined || grossProfit === null) {
        skipped.push({ evidenceId: node.id, reason: "NO_GROSS_PROFIT" });
        continue;
      }
      const externalId = String(
        payload.dealId ?? payload.orderId ?? payload.sourceRecordId ?? node.id,
      );
      if (materializedOrderIds.has(externalId)) {
        skipped.push({ evidenceId: node.id, reason: "ALREADY_MATERIALIZED" });
        continue;
      }
      const personId =
        identityByExternal.get(externalId) ??
        (identityByExternal.get("*") ?? undefined);
      if (!personId) {
        skipped.push({
          evidenceId: node.id,
          reason: "NO_IDENTITY_MAPPING",
          externalId,
        });
        continue;
      }
      try {
        const run = await store.createCalculationRun({
          cycleId: body.cycleId,
          policyVersionId: body.policyVersionId,
          mode: body.mode ?? "SHADOW",
          order: {
            id: externalId,
            grossProfit: String(grossProfit),
            currency: String(payload.currency ?? "CNY"),
            invoiceAmount: payload.invoiceAmount
              ? String(payload.invoiceAmount)
              : undefined,
            cashCollected: payload.cashCollected
              ? String(payload.cashCollected)
              : undefined,
            creditApproved: Boolean(payload.creditApproved ?? true),
            qualityHold: Boolean(payload.qualityHold ?? false),
            projectType: payload.projectType
              ? String(payload.projectType)
              : undefined,
          },
          participants: [
            {
              personId,
              workPackageId: node.subjectId,
              attributionWeight: String(payload.attributionWeight ?? "1"),
              role: "OWNER",
            },
          ],
        } as never);
        materializedOrderIds.add(externalId);
        created.push({
          runId: run.id,
          evidenceId: node.id,
          personId,
          resultHash: run.resultHash,
        });
      } catch (error) {
        skipped.push({
          evidenceId: node.id,
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    countEvent("runs_from_ingestion");
    return data({ created, skipped }, request);
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
    // Signing up with an address that already has an account must never touch
    // that account: otherwise anyone could reset a stranger's password.
    const existingUser =
      (await platformStore.findUserByAuthSubject(body.adminEmail)) ??
      (await platformStore.getUserPasswordHashByEmail(body.adminEmail)
        ? { id: "existing" }
        : null);
    if (existingUser) {
      throw new ConflictError(
        "EMAIL_ALREADY_REGISTERED: this email already has an account; sign in and create a workspace from there",
      );
    }
    const tenant = await platformStore.createTenant({
      name: body.companyName,
      slug: body.slug ?? slugify(body.companyName),
    });
    const user = await platformStore.createUser({
      authSubject: body.adminEmail,
      displayName: body.adminDisplayName,
      email: body.adminEmail,
    });
    if (body.password) {
      await platformStore.setUserPassword(user.id, hashPassword(body.password));
    }
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

  // -------------------------------------------------------------------------
  // Feishu OAuth sign-in (browser flow; one-time state, human-readable errors)
  // -------------------------------------------------------------------------
  const feishuStates = new Map<
    string,
    { expiresAt: number; postLoginPath: string }
  >();

  const feishuRedirectBase = (request: FastifyRequest): string =>
    options.feishu?.consoleBaseUrl ??
    `${request.protocol}://${request.headers.host ?? "localhost:3000"}`;

  const sessionSecret = options.sessionSecret ?? options.feishu?.sessionSecret;
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();

  app.post("/api/v1/auth/password/login", async (request, reply) => {
    if (!sessionSecret) {
      return reply.status(501).send({
        ...errorBody(
          "PASSWORD_LOGIN_NOT_CONFIGURED",
          "账号登录未启用：需要配置 SESSION_SECRET（服务端环境变量）",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const body = parse(passwordLoginSchema, request.body);
    const key = request.ip;
    const nowMs = Date.now();
    const entry = loginAttempts.get(key);
    if (entry && entry.resetAt > nowMs && entry.count > 10) {
      return reply.status(429).send({
        ...errorBody("RATE_LIMITED", "尝试次数过多，请稍后再试"),
        meta: { correlation_id: request.id },
      });
    }
    // Only failed credentials count towards the limit. Counting every attempt
    // locked out offices behind one NAT after eleven successful sign-ins.
    const recordFailure = () => {
      const current = loginAttempts.get(key);
      const stamp = Date.now();
      const stillCounting = Boolean(current && current.resetAt > stamp);
      loginAttempts.set(key, {
        count: (stillCounting ? current!.count : 0) + 1,
        resetAt: stillCounting ? current!.resetAt : stamp + 900_000,
      });
    };
    const credential = await platformStore.getUserPasswordHashByEmail(
      body.email,
    );
    const stored = credential?.passwordHash;
    if (!credential || !stored || !verifyPassword(body.password, stored)) {
      recordFailure();
      // Uniform response: never reveal whether the account exists.
      return reply.status(401).send({
        ...errorBody("INVALID_CREDENTIALS", "邮箱或密码不正确"),
        meta: { correlation_id: request.id },
      });
    }
    loginAttempts.delete(key);
    const memberships = await platformStore.listMembershipsByUser(
      credential.userId,
    );
    const membership = body.tenantId
      ? memberships.find((candidate) => candidate.tenantId === body.tenantId)
      : memberships[0];
    if (!membership) {
      return reply.status(403).send({
        ...errorBody("NO_TENANT_MEMBERSHIP", "该账号尚未加入任何企业工作区，请联系管理员"),
        meta: { correlation_id: request.id },
      });
    }
    const jwt = new SessionJwt(sessionSecret);
    let personId: string | undefined;
    let roles = membership.roleCodes;
    try {
      const identity = await platformStore.resolveIdentity({
        tenantId: membership.tenantId,
        userId: credential.userId,
      });
      personId = identity.personId;
      roles = identity.roles.length > 0 ? identity.roles : roles;
    } catch {
      personId = undefined;
    }
    const token = await jwt.sign({
      tenantId: membership.tenantId,
      userId: credential.userId,
      personId,
      roles,
    });
    countEvent("password_login_completed");
    return data(
      {
        token,
        tenantId: membership.tenantId,
        userId: credential.userId,
        personId: personId ?? null,
        roles,
      },
      request,
    );
  });

  app.post("/api/v1/platform/users/set-password", async (request) => {
    if (!sessionSecret) {
      throw new ConflictError(
        "PASSWORD_LOGIN_NOT_CONFIGURED: set SESSION_SECRET to enable password login",
      );
    }
    const body = parse(setPasswordSchema, request.body);
    if (!isPlatformAdmin(request)) {
      // A tenant admin may only reset users who belong to their own tenant.
      requireTenantAdmin(request, tenantOf(request));
      const memberships = await platformStore.listMembershipsByUser(
        body.userId,
      );
      if (
        !memberships.some(
          (membership) => membership.tenantId === tenantOf(request),
        )
      ) {
        throw new ForbiddenError(
          "cannot set a password for a user outside this tenant",
        );
      }
    }
    await platformStore.setUserPassword(body.userId, hashPassword(body.password));
    countEvent("password_set");
    return data({ ok: true }, request);
  });

  app.get("/api/v1/auth/feishu/authorize", async (request, reply) => {
    if (!options.feishu) {
      return reply.status(501).send({
        ...errorBody(
          "FEISHU_NOT_CONFIGURED",
          "Feishu sign-in is not configured on this deployment (FEISHU_APP_ID/FEISHU_APP_SECRET/FEISHU_SESSION_SECRET). Contact the operator or sign in with a token.",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const query = request.query as { postLoginPath?: string };
    const postLoginPath =
      query.postLoginPath?.startsWith("/console") ? query.postLoginPath : "/console";
    const state = randomUUID();
    // One-time state with a 300s TTL (replay/binding protection).
    feishuStates.set(state, {
      expiresAt: Date.now() + 300_000,
      postLoginPath,
    });
    for (const [key, entry] of feishuStates) {
      if (entry.expiresAt <= Date.now()) feishuStates.delete(key);
    }
    const redirectUri = `${feishuRedirectBase(request)}/api/v1/auth/feishu/callback`;
    const authorizeUrl = new URL(
      "https://open.feishu.cn/open-apis/authen/v1/authorize",
    );
    authorizeUrl.searchParams.set("client_id", options.feishu.appId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    return reply.redirect(authorizeUrl.toString());
  });

  app.get("/api/v1/auth/feishu/callback", async (request, reply) => {
    const feishuLoginError = (reason: string) => {
      const base = feishuRedirectBase(request);
      return reply.redirect(
        `${base}/console/login?error=${encodeURIComponent(reason)}`,
      );
    };
    if (!options.feishu) return feishuLoginError("Feishu sign-in is not configured");
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };
    if (query.error) return feishuLoginError(`Feishu rejected the sign-in: ${query.error}`);
    if (!query.code || !query.state) {
      return feishuLoginError("The callback is missing code/state");
    }
    const stateEntry = feishuStates.get(query.state);
    feishuStates.delete(query.state);
    if (!stateEntry || stateEntry.expiresAt <= Date.now()) {
      return feishuLoginError(
        "The login state is invalid or expired; please start the sign-in again",
      );
    }
    const fetchImpl = options.feishu.fetchImpl ?? fetch;
    const redirectUri = `${feishuRedirectBase(request)}/api/v1/auth/feishu/callback`;
    try {
      // OAuth v2: flat client_id/secret, flat access_token response.
      const tokenResponse = await fetchImpl(
        "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: options.feishu.appId,
            client_secret: options.feishu.appSecret,
            code: query.code,
            redirect_uri: redirectUri,
          }),
        },
      );
      const tokenPayload = (await tokenResponse.json()) as {
        code?: number;
        msg?: string;
        data?: { access_token?: string };
      };
      const accessToken = tokenPayload.data?.access_token;
      if (!accessToken) {
        return feishuLoginError(
          `Could not exchange the Feishu code (${tokenPayload.code ?? tokenResponse.status}: ${tokenPayload.msg ?? "no access token"})`,
        );
      }
      // user_info MUST use the user token (tenant token returns the app itself).
      const userResponse = await fetchImpl(
        "https://open.feishu.cn/open-apis/authen/v1/user_info",
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      const userPayload = (await userResponse.json()) as {
        code?: number;
        msg?: string;
        data?: {
          open_id?: string;
          union_id?: string;
          name?: string;
          email?: string;
        };
      };
      const profile = userPayload.data;
      if (userPayload.code !== 0 || !profile?.open_id) {
        return feishuLoginError(
          `Could not read the Feishu profile (${userPayload.code ?? userResponse.status}: ${userPayload.msg ?? "no open_id"})`,
        );
      }

      // Resolve or provision the identity. First sign-in creates a basic
      // employee account only; elevated roles are always granted by an admin.
      const authSubject = `feishu:${profile.open_id}`;
      const tenantId = options.feishu.tenantId;
      const users = await platformStore.listUsers();
      let user = users.find((candidate) => candidate.authSubject === authSubject);
      if (!user) {
        user = await platformStore.createUser({
          authSubject,
          displayName: profile.name ?? profile.open_id,
          email: profile.email,
        });
        await platformStore.addMembership({
          tenantId,
          userId: user.id,
          roleCodes: ["employee"],
        });
      }
      const memberships = await platformStore.listMemberships(tenantId);
      const roles = memberships
        .filter((membership) => membership.userId === user.id)
        .flatMap((membership) => membership.roleCodes);
      let personId: string | undefined;
      try {
        const identity = await platformStore.resolveIdentity({
          tenantId,
          userId: user.id,
        });
        personId = identity.personId;
      } catch {
        personId = undefined;
      }
      if (!personId) {
        // 自动建号受订阅席位硬约束（与目录同步同一口径）。
        const seatsRemaining = await seatsRemainingFor(platformStore, tenantId);
        if (seatsRemaining !== null && seatsRemaining <= 0) {
          return feishuLoginError(
            "订阅席位已满：请联系管理员扩容或在平台管理中调整席位后再试",
          );
        }
        const person = await platformStore.createPerson({
          tenantId,
          employeeCode: `FS-${profile.open_id.replace(/-/g, "").slice(-8)}`,
          displayName: profile.name ?? profile.open_id,
          userId: user.id,
        });
        personId = person.id;
      }

      const jwt = new SessionJwt(options.feishu.sessionSecret);
      const token = await jwt.sign({ tenantId, userId: user.id, personId, roles });
      countEvent("feishu_login_completed");
      // 登录即同步：把本人的部门/汇报线落到组织树（best-effort，不阻塞登录）。
      // feishu-integration skill：组织事实只进目录字段，不碰角色/权限。
      if (process.env.FEISHU_LOGIN_SYNC !== "0") {
        void syncFeishuDirectory(platformStore, {
          tenantId,
          appId: options.feishu.appId,
          appSecret: options.feishu.appSecret,
          dryRun: false,
          allowCreate: true,
        }).catch((syncError) => {
          request.log.warn(
            { err: syncError },
            "post-login feishu directory sync failed",
          );
        });
      }
      const base = feishuRedirectBase(request);
      return reply.redirect(
        `${base}/console/login#feishu-token=${token}&postLoginPath=${encodeURIComponent(stateEntry.postLoginPath)}`,
      );
    } catch (error) {
      request.log.warn(
        { err: error },
        "feishu oauth callback failed",
      );
      return feishuLoginError(
        error instanceof Error
          ? `Sign-in failed: ${error.message}`
          : "Sign-in failed for an unknown reason",
      );
    }
  });

  app.get("/api/v1/public/plans", async (request) => {
    return data(await platformStore.listSubscriptionPlans(true), request);
  });

  app.post("/api/v1/platform/tenants", async (request, reply) => {
    requirePlatformAdmin(request);
    const body = parse(createPlatformTenantSchema, request.body);
    return reply
      .status(201)
      .send(data(await platformStore.createTenant(body), request));
  });

  app.get("/api/v1/platform/tenants", async (request) => {
    if (!isPlatformAdmin(request)) {
      // Tenant admins may see their own workspace only, never the portfolio.
      requireTenantAdmin(request, tenantOf(request));
      const own = await platformStore.getTenant(tenantOf(request));
      return data([own], request);
    }
    return data(await platformStore.listTenants(), request);
  });

  app.post("/api/v1/platform/tenants/:id/settings", async (request) => {
    const tenantId = idOf(request);
    requireTenantAdmin(request, tenantId);
    const body = parse(updateTenantSettingsSchema, request.body);
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
    requirePlatformAdmin(request);
    const body = parse(createPlatformUserSchema, request.body);
    return reply
      .status(201)
      .send(data(await platformStore.createUser(body), request));
  });

  app.get("/api/v1/platform/users", async (request) => {
    requirePlatformAdmin(request);
    return data(await platformStore.listUsers(), request);
  });

  app.post("/api/v1/platform/tenants/:id/memberships", async (request, reply) => {
      requireTenantAdmin(request, idOf(request));
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
    requireTenantAdmin(request, idOf(request));
    return data(
      await platformStore.listMemberships(idOf(request)),
      request,
    );
  });

  app.post("/api/v1/platform/tenants/:id/persons", async (request, reply) => {
    requireTenantAdmin(request, idOf(request));
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
    requireTenantMember(request, idOf(request));
    return data(await platformStore.listPersons(idOf(request)), request);
  });

  app.post("/api/v1/platform/feishu/sync-directory", async (request, reply) => {
    requirePlatformAdmin(request);
    if (!options.feishu) {
      return reply.status(501).send({
        ...errorBody(
          "FEISHU_NOT_CONFIGURED",
          "Feishu integration is not configured (FEISHU_APP_ID/FEISHU_APP_SECRET); directory sync is unavailable",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const body = parse(feishuSyncSchema, request.body);
    try {
      const result = await syncFeishuDirectory(platformStore, {
        tenantId: options.feishu.tenantId,
        appId: options.feishu.appId,
        appSecret: options.feishu.appSecret,
        dryRun: body.dryRun ?? true,
        allowCreate: body.allowCreate ?? false,
        fetchImpl: options.feishu.fetchImpl,
      });
      countEvent("feishu_directory_synced");
      return data(result, request);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "directory sync failed";
      return reply.status(502).send({
        ...errorBody("FEISHU_SYNC_FAILED", message),
        meta: { correlation_id: request.id },
      });
    }
  });

  app.post("/api/v1/platform/plans", async (request, reply) => {
    requirePlatformAdmin(request);
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
    requirePlatformAdmin(request);
    return data(await platformStore.listSubscriptionPlans(false), request);
  });

  app.get("/api/v1/platform/tenants/:id/subscription", async (request) => {
    requireTenantAdmin(request, idOf(request));
    const subscription = await platformStore.getTenantSubscription(
      idOf(request),
    );
    if (!subscription) throw new NotFoundError(`TenantSubscription ${idOf(request)} not found`);
    return data(subscription, request);
  });

  app.put("/api/v1/platform/tenants/:id/subscription", async (request) => {
    requireTenantAdmin(request, idOf(request));
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
    requireTenantAdmin(request, idOf(request));
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
    requireTenantAdmin(request, idOf(request));
    return data(await platformStore.listInvoices(idOf(request)), request);
  });

  app.post("/api/v1/platform/invoices/:id/status", async (request) => {
    requirePlatformAdmin(request);
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
    requireTenantAdmin(request, idOf(request));
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
    requireTenantMember(request, idOf(request));
    return data(await platformStore.listOrgNodes(idOf(request)), request);
  });

  app.post("/api/v1/platform/tenants/:id/persons/:personId/org-assignments", async (request, reply) => {
    requireTenantAdmin(request, idOf(request));
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
    requireTenantAdmin(request, idOf(request));
    return data(
      await platformStore.listOrgAssignments(
        idOf(request),
        paramOf(request, "personId"),
      ),
      request,
    );
  });

  app.post("/api/v1/platform/tenants/:id/persons/:personId/manager", async (request) => {
    requireTenantAdmin(request, idOf(request));
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
    requireTenantAdmin(request, idOf(request));
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
    const identity = await platformStore.resolveIdentity({
      tenantId: context.tenantId,
      userId: context.userId,
      personId: context.personId,
    });
    // Session tokens and the dev authenticator carry authoritative roles. When
    // membership lookup returns none, fall back to the authenticated roles so
    // the console does not treat a signed-in operator as role-less.
    const roles =
      identity.roles.length > 0 ? identity.roles : context.roles;
    return data(
      {
        ...identity,
        roles,
        // 前端会话只需 token；tenantId 由服务端回填，禁止客户端自报。
        tenantId: context.tenantId,
      },
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
    const query = request.query as { limit?: string };
    const requested = Number(query.limit ?? "200");
    // Newest first; cap the payload so a long-lived tenant does not ship
    // thousands of historical tasks to every console load.
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 500)
      : 200;
    const tasks = await runtimeFor(request).list();
    return data(tasks.slice(0, limit), request);
  });
  // 对话式入口（第二阶段）：LLM 只做意图选择与人话回复；
  // 命令必须命中 AGENT_COMMANDS 白名单才会执行，执行仍走任务状态机。
  const AGENT_CHAT_SYSTEM_PROMPT = [
    "你是 Anari N-Perform 绩效激励系统的 AI 助手。",
    "你只能从下面的命令目录中选择一个命令执行，或仅回答问题：",
    JSON.stringify(
      Object.entries(AGENT_COMMANDS).map(([command, definition]) => ({
        command,
        agentType: definition.agentType,
      })),
    ),
    "硬性规则（违反任何一条即为错误回复）：",
    "1. 你不能创造、修改或建议任何命令目录之外的命令；",
    "2. 你不能给出任何金额、绩效分数或系数——正式数值只由确定性引擎计算；",
    "3. 你不能批准任何动作——批准只能由人在任务卡上点击；",
    "4. 用户请求超出目录范围时，不要选择命令，用 reply 简短说明能做什么；",
    "5. 只输出严格 JSON：{\"command\": \"目录中的命令或空串\", \"params\": {}, \"reply\": \"不超过120字的人话回复\"}。",
  ].join("\n");

  app.get("/api/v1/agent-chat/status", async (request) => {
    return data(
      {
        enabled: Boolean(options.agentChat),
        provider: options.agentChat?.provider ?? null,
        model: options.agentChat?.model ?? null,
      },
      request,
    );
  });

  app.post("/api/v1/agent-chat", async (request, reply) => {
    requireRoles(request, "manager");
    if (!options.agentChat) {
      return reply.status(501).send({
        ...errorBody(
          "LLM_NOT_CONFIGURED",
          "对话意图解析未配置（LLM_PROVIDER/LLM_API_KEY）。请使用上方指令按钮，或联系管理员配置 DeepSeek/GLM/Kimi。",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const body = parse(agentChatSchema, request.body);
    const messages: LlmMessage[] = [
      { role: "system", content: AGENT_CHAT_SYSTEM_PROMPT },
      ...body.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];
    let parsed: Record<string, unknown> | null;
    try {
      const completion = await llmChatComplete(
        {
          provider: options.agentChat.provider as "deepseek" | "glm" | "kimi" | "custom",
          baseUrl: options.agentChat.baseUrl,
          apiKey: options.agentChat.apiKey,
          model: options.agentChat.model,
          fetchImpl: options.agentChat.fetchImpl,
        },
        messages,
        { temperature: 0.2, maxTokens: 500, timeoutMs: 25_000 },
      );
      parsed = extractJson(completion.content);
      if (!parsed) {
        return data(
          { reply: completion.content.slice(0, 600), task: null },
          request,
        );
      }
    } catch (error) {
      request.log.warn({ err: error }, "agent-chat llm call failed");
      throw new BadRequestError(
        "LLM_CALL_FAILED",
        error instanceof Error ? error.message : "LLM 调用失败",
      );
    }
    const replyText =
      typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim().slice(0, 600)
        : "已收到。";
    const commandName =
      typeof parsed.command === "string" ? parsed.command : "";
    const definition = AGENT_COMMANDS[commandName];
    if (!definition) {
      // 目录外的“命令”一律不执行——这是注入防护的最后闸门。
      return data({ reply: replyText, task: null }, request);
    }
    const tenantId = tenantOf(request);
    const runtime = runtimeFor(request);
    const params = sanitizeAgentChatParams(
      commandName,
      parsed.params && typeof parsed.params === "object"
        ? (parsed.params as Record<string, unknown>)
        : {},
    );
    const idempotencyKey =
      typeof params.idempotencyKey === "string" && params.idempotencyKey.trim()
        ? params.idempotencyKey
        : `chat:${commandName}:${Date.now()}`;
    const task = await runtime.enqueue({
      tenantId,
      agentType: definition.agentType,
      triggerType: "MANUAL",
      triggerRef: `chat:${commandName}`,
      input: definition.input ? definition.input(params) : params,
      idempotencyKey,
      actorRole: "ACTOR",
    });
    const executed = await runtime.run(task.id);
    countEvent("agent_chat_dispatched");
    return data({ reply: replyText, task: executed }, request);
  });

  // 智能指令台（无 LLM）：命令 → 现有 skill 任务；T0-T2 自动执行，
  // T3 一律等待人工批准（publish_policy），执行全部走既有状态机。

  app.post("/api/v1/agent-command", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(agentCommandSchema, request.body);
    const command = AGENT_COMMANDS[body.command];
    if (!command) {
      throw new BadRequestError(
        "UNKNOWN_AGENT_COMMAND",
        `未知指令 ${body.command}`,
      );
    }
    const tenantId = tenantOf(request);
    const runtime = runtimeFor(request);
    const params = body.params ?? {};
    const idempotencyKey =
      typeof params.idempotencyKey === "string" && params.idempotencyKey.trim()
        ? params.idempotencyKey
        : `${body.command}:${Date.now()}`;
    const task = await runtime.enqueue({
      tenantId,
      agentType: command.agentType,
      triggerType: "MANUAL",
      triggerRef: body.command,
      input: command.input ? command.input(params) : params,
      idempotencyKey,
      actorRole: "ACTOR",
    });
    const executed = await runtime.run(task.id);
    countEvent("agent_command_dispatched");
    return reply.status(201).send(data(executed, request));
  });

  // 统一审批收件箱：agent 待批动作 + 业务审批 + 评分提案 三源聚合。
  app.get("/api/v1/agent-inbox", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    const tenantId = tenantOf(request);
    const [tasks, approvals, proposals] = await Promise.all([
      runtimeFor(request).list(),
      platformStore.listApprovalRequests(tenantId),
      platformStore.listAiScoreProposals(tenantId),
    ]);
    const items = [
      ...tasks
        .filter((task) => task.status === "WAITING_APPROVAL")
        .map((task) => ({
          source: "AGENT_TASK" as const,
          id: task.id,
          title: task.agentType,
          status: task.status,
          riskTier: task.riskTier,
          createdAt: task.createdAt,
          href: "/console/agent-ops",
        })),
      ...approvals
        .filter((approval) => approval.status === "PENDING")
        .map((approval) => ({
          source: "APPROVAL_REQUEST" as const,
          id: approval.id,
          title: approval.actionType,
          status: approval.status,
          createdAt: approval.createdAt,
          href: "/console/approvals",
        })),
      ...proposals
        .filter((proposal) => proposal.status === "PENDING")
        .map((proposal) => ({
          source: "SCORE_PROPOSAL" as const,
          id: proposal.id,
          title: "AI 评分提案复核",
          status: proposal.status,
          createdAt: proposal.createdAt,
          href: "/console/ai",
        })),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return data({ items, total: items.length }, request);
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
    const toMs = Date.parse(to);
    // Validate `to` before deriving the default `from`: new Date(NaN)
    // .toISOString() throws a RangeError before the guard can run.
    if (!Number.isFinite(toMs)) {
      throw new BadRequestError(
        "INVALID_REPORT_WINDOW",
        "from/to must be valid ISO dates and from <= to",
      );
    }
    const from =
      query.from ??
      new Date(toMs - 365 * 24 * 60 * 60 * 1000).toISOString();
    const fromMs = Date.parse(from);
    if (!Number.isFinite(fromMs) || fromMs > toMs) {
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
        label: "证据覆盖率（≥70%）",
        value: Math.round(coverage * 10000) / 10000,
        unit: "RATIO",
        target: 0.7,
        comparator: "GTE",
        status: coverage >= 0.7 ? "PASS" : "FAIL",
        note: "Accepted work packages with at least one work-package evidence node.",
      },
      {
        id: "MANAGER_REVIEW_HOURS",
        label: "经理复核时间（≤2 小时）",
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
        label: "贡献争议率（<10%）",
        value: Math.round(disputeRate * 10000) / 10000,
        unit: "RATIO",
        target: 0.1,
        comparator: "LT",
        status: disputeRate < 0.1 ? "PASS" : "FAIL",
        note: "Appeals divided by claims; target is below 10%.",
      },
      {
        id: "RECONCILIATION_DIFFERENCES",
        label: "财务对账差异（=0）",
        value: reconciliationDifferences,
        unit: "COUNT",
        target: 0,
        comparator: "EQ",
        status: reconciliationDifferences === 0 ? "PASS" : "FAIL",
        note: "Settlement batches in ADJUSTMENT_REQUIRED plus calculation runs in RECONCILIATION_REQUIRED.",
      },
      {
        id: "EMPLOYEE_EVIDENCE_MINUTES",
        label: "员工补证时间（≤30 分钟）",
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
        label: "员工信任对比基线",
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

  app.get("/api/v1/me/data-package", async (request, reply) => {
    assertExportAllowed(request);
    const personId = ownPersonId(request);
    if (!personId) {
      throw new ForbiddenError("employee identity is required");
    }
    const payload = await buildPersonDataPackage(request, personId);
    const text = JSON.stringify(payload);
    const findings = scanExportDlp(text);
    return reply
      .headers(exportHeaders(request, text, "PERSONAL_DATA"))
      .header("x-export-dlp-findings", findings.join(","))
      .send(data(payload, request));
  });

  app.get("/api/v1/dsar-requests/:id/package", async (request, reply) => {
    requireRoles(request, "admin", "finance");
    assertExportAllowed(request);
    const dsar = await platformStore.getDsar(
      tenantOf(request),
      idOf(request),
    );
    const payload = await buildPersonDataPackage(request, dsar.personId);
    const text = JSON.stringify(payload);
    const query = request.query as { approvalRequestId?: string };
    await assertExportDlp(
      request,
      text,
      "DSAR_PACKAGE",
      idOf(request),
      query.approvalRequestId,
    );
    await auditExport(
      request,
      "DSAR_PACKAGE_EXPORTED",
      "DSAR_REQUEST",
      idOf(request),
    );
    return reply
      .headers(exportHeaders(request, text, "PERSONAL_DATA"))
      .send(data(payload, request));
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
    // NPV2-003：验收人必须是会话主体（平台管理员除外）。
    const acceptOwn = ownPersonId(request);
    if (acceptOwn && !isPlatformAdmin(request) && body.reviewerPersonId !== acceptOwn) {
      throw new ForbiddenError(
        "acceptance must use the authenticated identity",
      );
    }
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
    assertPayrollExportable(run);
    const csv = payrollCsv(run);
    await assertExportDlp(
      request,
      csv,
      "PAYROLL_RUN",
      run.id,
      query.dlpApprovalRequestId,
    );
    await auditExport(
      request,
      "PAYROLL_RUN_EXPORTED",
      "PAYROLL_RUN",
      run.id,
      `rows=${run.lineCount ?? ""}`,
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
    assertPayrollExportable(run);
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
    await auditExport(
      request,
      "PAYROLL_BANK_FILE_EXPORTED",
      "PAYROLL_RUN",
      run.id,
      `format=${format}`,
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
    assertPayrollExportable(run);
    const csv = payrollTaxFilingCsv(run);
    await assertExportDlp(
      request,
      csv,
      "PAYROLL_RUN",
      run.id,
      query.dlpApprovalRequestId,
    );
    countEvent("payroll_tax_filing_exported");
    await auditExport(
      request,
      "PAYROLL_TAX_FILING_EXPORTED",
      "PAYROLL_RUN",
      run.id,
    );
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
    const targetPersonId = paramOf(request, "personId");
    const own = ownPersonId(request);
    const roles = request.authContext?.roles ?? [];
    if (
      !roles.includes("admin") &&
      !roles.includes("finance") &&
      own !== targetPersonId
    ) {
      // Managers may print payslips for their direct reports only.
      const persons = await platformStore.listPersons(tenantOf(request));
      const target = persons.find((person) => person.id === targetPersonId);
      if (!target || !own || target.managerPersonId !== own) {
        throw new ForbiddenError(
          "managers may only view payslips of their direct reports",
        );
      }
    }
    const stored = await platformStore.getPayrollRun(
      tenantOf(request),
      idOf(request),
    );
    // Same field-policy redaction as the JSON payroll routes: a printable
    // payslip must not expose bank details the viewer cannot see elsewhere.
    const run = await payrollRunForViewer(request, stored);
    const line = (run.lines ?? []).find(
      (candidate) => candidate.personId === targetPersonId,
    );
    if (!line) {
      throw new NotFoundError(`PayrollLine ${targetPersonId} not found`);
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
    // One person must not be paid twice for the same period. Overlapping
    // ACTIVE contracts would each collect the same ledger entries.
    const periodStart = Date.parse(run.periodStart);
    const periodEnd = Date.parse(run.periodEnd);
    const activeByPerson = new Map<string, string>();
    for (const contract of contracts) {
      if (contract.status !== "ACTIVE") continue;
      if (contract.currency !== run.currency) continue;
      if (Date.parse(contract.startDate) > periodEnd) continue;
      if (contract.endDate && Date.parse(contract.endDate) < periodStart) {
        continue;
      }
      const key = `${contract.personId}:${contract.currency}`;
      const existing = activeByPerson.get(key);
      if (existing) {
        throw new ConflictError(
          `PAYROLL_DUPLICATE_ACTIVE_CONTRACT: person ${contract.personId} has contracts ${existing} and ${contract.id} covering this period`,
        );
      }
      activeByPerson.set(key, contract.id);
    }
    const allRuns = await platformStore.listPayrollRuns(tenantId);
    const priorRuns = allRuns
      .filter(
        (candidate) =>
          candidate.id !== run.id &&
          Date.parse(candidate.periodEnd) < Date.parse(run.periodStart) &&
          ["CALCULATED", "APPROVED", "PAID"].includes(candidate.status),
      )
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
      .slice(0, 12);
    // Oldest first so the last value per contract is the most recent period.
    const priorIncentiveHistory: Record<string, string[]> = {};
    for (const prior of [...priorRuns].reverse()) {
      const detail = await platformStore.getPayrollRun(tenantId, prior.id);
      for (const line of detail.lines ?? []) {
        (priorIncentiveHistory[line.contractId] ??= []).push(
          line.incentiveAmount,
        );
      }
    }
    const priorIncentives: Record<string, string> = {};
    for (const [contractId, values] of Object.entries(priorIncentiveHistory)) {
      const latest = values[values.length - 1];
      if (latest !== undefined) priorIncentives[contractId] = latest;
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
    const deductionLegalBases =
      tenantSettings.deductionLegalBases &&
      typeof tenantSettings.deductionLegalBases === "object"
        ? (tenantSettings.deductionLegalBases as Record<
            string,
            { courtOrderRef?: string; consentRef?: string }
          >)
        : undefined;
    const calculation = calculatePayroll({
      contracts,
      ledger,
      priorIncentives,
      priorIncentiveHistory,
      unacknowledgedNoticesByPerson,
      taxMode,
      statutoryDeductionTypes,
      deductionLegalBases,
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
    // NPV2-003：审批人必须是会话主体；body 中的 approvedBy 不再是执行者真相源。
    const own = ownPersonId(request);
    if (own && !isPlatformAdmin(request) && body.approvedBy !== own) {
      throw new ForbiddenError(
        "payroll approval must use the authenticated identity",
      );
    }
    const persons = await platformStore.listPersons(tenantOf(request));
    if (!persons.some((person) => person.id === body.approvedBy)) {
      throw new NotFoundError(`Person ${body.approvedBy} not found`);
    }
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

  app.post("/api/v1/incentive-award-batches", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createIncentiveAwardBatchSchema, request.body);
    const createdBy = body.createdBy ?? ownPersonId(request) ?? "system";
    const batch = await platformStore.createIncentiveAwardBatch({
      tenantId: tenantOf(request),
      batchNo: body.batchNo,
      awardType: body.awardType,
      period: body.period,
      cycleId: body.cycleId,
      currency: body.currency,
      createdBy,
      sourceRecordIds: body.sourceRecordIds,
      lines: body.lines,
    });
    try {
      await storeFor(request).recordAuditEvent({
        actorType: "USER",
        actorId: ownPersonId(request) ?? createdBy,
        action: "INCENTIVE_AWARD_BATCH_CREATED",
        objectType: "INCENTIVE_AWARD_BATCH",
        objectId: batch.id,
        reason: `${batch.awardType}:${batch.batchNo}`,
      });
    } catch {
      /* audit is best-effort for legacy stores */
    }
    return reply.status(201).send(data(batch, request));
  });

  // 批量导入：CSV（工号/人员ID + 金额）一次生成整个发放批次。
  app.post("/api/v1/incentive-award-batches:import", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(importIncentiveAwardBatchSchema, request.body);
    const rows = parseCsv(body.csv);
    if (rows.length < 2) {
      throw new BadRequestError(
        "CSV_NO_DATA_ROWS",
        "CSV 需要表头和至少一行数据",
      );
    }
    const header = rows[0]!;
    const col = {
      personId: columnIndexFor(header, ["person_id", "personid", "人员id"]),
      employeeCode: columnIndexFor(header, [
        "employee_code",
        "employeecode",
        "工号",
        "员工编号",
        "empno",
      ]),
      amount: columnIndexFor(header, ["amount", "金额", "奖金"]),
      note: columnIndexFor(header, ["note", "备注"]),
      sourceRecordId: columnIndexFor(header, [
        "source_record_id",
        "来源标识",
        "来源记录",
        "来源记录id",
      ]),
      sourceLineRef: columnIndexFor(header, [
        "source_line_ref",
        "来源行",
        "来源行标识",
      ]),
    };
    if (col.amount === -1 || (col.personId === -1 && col.employeeCode === -1)) {
      throw new BadRequestError(
        "CSV_COLUMNS_REQUIRED",
        "CSV 必须包含「金额」列，以及「工号/员工编号」或「人员ID」列",
      );
    }
    const persons = await platformStore.listPersons(tenantOf(request));
    const byCode = new Map(
      persons.map((person) => [person.employeeCode.toLowerCase(), person.id]),
    );
    const rowErrors: string[] = [];
    const lines: Array<{
      personId: string;
      amount: string;
      sourceRecordId?: string;
      sourceLineRef?: string;
      note?: string;
    }> = [];
    const seenLines = new Set<string>();
    rows.slice(1).forEach((cells, rowIndex) => {
      const lineNumber = rowIndex + 2;
      if (cells.every((cell) => !cell.trim())) return;
      const rawAmount = (col.amount >= 0 ? cells[col.amount] : "")?.trim() ?? "";
      if (!/^\d+(\.\d{1,6})?$/.test(rawAmount) || Number(rawAmount) <= 0) {
        rowErrors.push(`第 ${lineNumber} 行：金额「${rawAmount}」无效`);
        return;
      }
      let personId: string | undefined;
      if (col.personId >= 0 && cells[col.personId]?.trim()) {
        personId = cells[col.personId]!.trim();
        if (!persons.some((person) => person.id === personId)) {
          rowErrors.push(`第 ${lineNumber} 行：人员 ${personId} 不存在`);
          return;
        }
      } else if (col.employeeCode >= 0) {
        const code = cells[col.employeeCode]?.trim().toLowerCase() ?? "";
        personId = byCode.get(code);
        if (!personId) {
          rowErrors.push(`第 ${lineNumber} 行：工号「${code}」没有匹配的员工`);
          return;
        }
      } else {
        rowErrors.push(`第 ${lineNumber} 行：缺少人员标识`);
        return;
      }
      const sourceLineRef =
        col.sourceLineRef >= 0 ? cells[col.sourceLineRef]?.trim() : undefined;
      const sourceRecordId =
        col.sourceRecordId >= 0 ? cells[col.sourceRecordId]?.trim() : undefined;
      const dedupeKey = `${personId}:${sourceLineRef ?? ""}`;
      if (seenLines.has(dedupeKey)) {
        rowErrors.push(
          `第 ${lineNumber} 行：同一人员的来源行标识重复（${sourceLineRef ?? "空"}）`,
        );
        return;
      }
      seenLines.add(dedupeKey);
      lines.push({
        personId,
        amount: rawAmount,
        sourceRecordId: sourceRecordId || undefined,
        sourceLineRef: sourceLineRef || undefined,
        note: col.note >= 0 ? cells[col.note]?.trim() || undefined : undefined,
      });
    });
    if (rowErrors.length > 0 || lines.length === 0) {
      return reply.status(400).send({
        ...errorBody(
          "CSV_ROWS_INVALID",
          `CSV 校验失败：${rowErrors.length} 行有问题${rowErrors.length === 0 ? "（没有有效数据行）" : ""}`,
          rowErrors.slice(0, 50),
        ),
        meta: { correlation_id: request.id },
      });
    }
    const createdBy = body.createdBy ?? ownPersonId(request) ?? "system";
    const batch = await platformStore.createIncentiveAwardBatch({
      tenantId: tenantOf(request),
      batchNo: body.batchNo,
      awardType: body.awardType,
      period: body.period,
      cycleId: body.cycleId,
      currency: body.currency,
      createdBy,
      sourceRecordIds: lines
        .map((line) => line.sourceRecordId)
        .filter((value): value is string => Boolean(value)),
      lines,
    });
    try {
      await storeFor(request).recordAuditEvent({
        actorType: "USER",
        actorId: ownPersonId(request) ?? createdBy,
        action: "INCENTIVE_AWARD_BATCH_IMPORTED",
        objectType: "INCENTIVE_AWARD_BATCH",
        objectId: batch.id,
        reason: `${batch.awardType}:${batch.batchNo}:csv rows=${lines.length}`,
      });
    } catch {
      /* audit is best-effort for legacy stores */
    }
    countEvent("award_batch_csv_imported");
    return reply
      .status(201)
      .send(data({ batch, imported: lines.length }, request));
  });

  app.get("/api/v1/incentive-award-batches", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      awardType?: string;
      period?: string;
      status?: string;
    };
    return data(
      await platformStore.listIncentiveAwardBatches(tenantOf(request), query),
      request,
    );
  });

  app.get("/api/v1/incentive-award-batches/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getIncentiveAwardBatch(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/incentive-award-batches/:id/commands", async (request) => {
      requireRoles(request, "finance");
      const body = policyBody(request);
      const command = requireString(body, "command") as Parameters<
        typeof platformStore.commandIncentiveAwardBatch
      >[0]["command"];
      if (
        ![
          "SUBMIT",
          "APPROVE",
          "LOCK",
          "EXPORT",
          "ACKNOWLEDGE",
          "CANCEL",
        ].includes(command)
      ) {
        throw new BadRequestError("INVALID_COMMAND", `不支持的命令 ${command}`);
      }
      const batch = await platformStore.commandIncentiveAwardBatch({
        tenantId: tenantOf(request),
        batchId: idOf(request),
        command,
        actorPersonId: ownPersonId(request) ?? "system",
        paymentRef:
          typeof body.paymentRef === "string" ? body.paymentRef : undefined,
      });
      try {
        await storeFor(request).recordAuditEvent({
          actorType: "USER",
          actorId: ownPersonId(request),
          action: `INCENTIVE_AWARD_BATCH_${command}`,
          objectType: "INCENTIVE_AWARD_BATCH",
          objectId: batch.id,
          reason: `${batch.batchNo}:${batch.status}`,
        });
      } catch {
        /* audit is best-effort */
      }
      return data(batch, request);
    },
  );

  app.get("/api/v1/incentive-award-batches/:id/export", async (request, reply) => {
    requireRoles(request, "finance");
    const batch = await platformStore.getIncentiveAwardBatch(
      tenantOf(request),
      idOf(request),
    );
    if (!["EXPORTED", "ACKNOWLEDGED"].includes(batch.status)) {
      throw new ConflictError(
        `award batch must be EXPORTED before downloading (current ${batch.status})`,
      );
    }
    assertExportAllowed(request);
    const escape = (value: unknown): string => {
      const text = String(value ?? "");
      const guarded = /^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)
        ? `'${text}`
        : text;
      return `"${guarded.replace(/"/g, '""')}"`;
    };
    const rows = [
      ["批次号", "奖项类型", "周期", "币种", "人员ID", "金额", "来源记录", "来源行", "备注"],
      ...batch.lines.map((line) => [
        batch.batchNo,
        batch.awardType,
        batch.period,
        batch.currency,
        line.personId,
        line.amount,
        line.sourceRecordId ?? "",
        line.sourceLineRef ?? "",
        line.note ?? "",
      ]),
    ];
    const csv = `\uFEFF${rows
      .map((row) => row.map(escape).join(","))
      .join("\r\n")}\r\n`;
    const query = request.query as { approvalRequestId?: string };
    await assertExportDlp(
      request,
      csv,
      "INCENTIVE_AWARD_BATCH",
      batch.id,
      query.approvalRequestId,
    );
    await auditExport(
      request,
      "AWARD_BATCH_EXPORTED",
      "INCENTIVE_AWARD_BATCH",
      batch.id,
      `lines=${batch.lineCount}`,
    );
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${batch.batchNo}.csv"`)
      .headers(exportHeaders(request, csv, "CONFIDENTIAL_PAYROLL"))
      .send(csv);
  });

  app.get("/api/v1/statutory-deduction-types", async (request) => {
    requireRoles(request, "finance", "admin");
    const tenant = await platformStore.getTenant(tenantOf(request));
    const types = Array.isArray(tenant.settings?.statutoryDeductionTypes)
      ? tenant.settings.statutoryDeductionTypes
      : [];
    return data(types, request);
  });

  app.put("/api/v1/statutory-deduction-types", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = policyBody(request);
    if (!Array.isArray(body.types)) {
      throw new BadRequestError("INVALID_INPUT", "types 必须为数组");
    }
    for (const rule of body.types as Array<Record<string, unknown>>) {
      if (typeof rule.type !== "string" || !rule.type.trim()) {
        throw new BadRequestError("INVALID_INPUT", "扣款类型必须非空");
      }
      if (
        typeof rule.priority !== "number" ||
        !Number.isInteger(rule.priority) ||
        rule.priority < 0
      ) {
        throw new BadRequestError("INVALID_INPUT", "priority 必须为非负整数");
      }
      if (rule.capRate !== undefined) {
        const cap = parseDecimal(String(rule.capRate));
        if (cap < 0n || cap > parseDecimal("1")) {
          throw new BadRequestError("INVALID_INPUT", "capRate 必须在 0-1 之间");
        }
      }
    }
    const tenant = await platformStore.updateTenantSettings({
      tenantId: tenantOf(request),
      settings: { statutoryDeductionTypes: body.types },
    });
    return data(tenant.settings?.statutoryDeductionTypes ?? [], request);
  });

  app.get("/api/v1/deduction-legal-bases", async (request) => {
    requireRoles(request, "finance", "admin");
    const tenant = await platformStore.getTenant(tenantOf(request));
    return data(tenant.settings?.deductionLegalBases ?? {}, request);
  });

  app.put("/api/v1/deduction-legal-bases", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = policyBody(request);
    if (!body.bases || typeof body.bases !== "object") {
      throw new BadRequestError("INVALID_INPUT", "bases 必须为对象");
    }
    const tenant = await platformStore.updateTenantSettings({
      tenantId: tenantOf(request),
      settings: { deductionLegalBases: body.bases },
    });
    return data(tenant.settings?.deductionLegalBases ?? {}, request);
  });

  app.get("/api/v1/export-dlp-rules", async (request) => {
    requireRoles(request, "finance", "admin");
    const tenant = await platformStore.getTenant(tenantOf(request));
    return data(tenant.settings?.exportDlpRules ?? [], request);
  });

  app.put("/api/v1/export-dlp-rules", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = policyBody(request);
    if (!Array.isArray(body.rules)) {
      throw new BadRequestError("INVALID_INPUT", "rules 必须为数组");
    }
    for (const rule of body.rules as Array<Record<string, unknown>>) {
      if (typeof rule.code !== "string" || !rule.code.trim()) {
        throw new BadRequestError("INVALID_INPUT", "规则 code 必须非空");
      }
      if (typeof rule.pattern !== "string" || !rule.pattern) {
        throw new BadRequestError("INVALID_INPUT", "规则 pattern 必须非空");
      }
      try {
        new RegExp(rule.pattern, typeof rule.flags === "string" ? rule.flags : "g");
      } catch {
        throw new BadRequestError(
          "INVALID_INPUT",
          `规则 ${rule.code} 的正则无效`,
        );
      }
    }
    const tenant = await platformStore.updateTenantSettings({
      tenantId: tenantOf(request),
      settings: { exportDlpRules: body.rules },
    });
    return data(tenant.settings?.exportDlpRules ?? [], request);
  });

  app.post("/api/v1/reports/policy-review:finalize", async (request, reply) => {
    requireRoles(request, "finance");
    const body = policyBody(request);
    const from = requireString(body, "from");
    const to = requireString(body, "to");
    if (!body.report || typeof body.report !== "object") {
      throw new BadRequestError("INVALID_INPUT", "report 必须为对象");
    }
    const report = body.report as Record<string, unknown>;
    const reportHash = sha256(report);
    const signedOffBy =
      typeof body.signedOffBy === "string" ? body.signedOffBy : undefined;
    const record = await platformStore.savePolicyEngineRecord({
      tenantId: tenantOf(request),
      recordType: "POLICY_ANNUAL_REVIEW",
      period: `${from}..${to}`,
      status: signedOffBy ? "FINAL" : "DRAFT",
      payload: {
        from,
        to,
        report,
        reportHash,
        signedOffBy,
        signedAt: signedOffBy ? new Date().toISOString() : undefined,
      },
    });
    return reply.status(201).send(data(record, request));
  });

  app.get("/api/v1/reports/policy-review/snapshots", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    return data(
      await platformStore.listPolicyEngineRecords(tenantOf(request), {
        recordType: "POLICY_ANNUAL_REVIEW",
      }),
      request,
    );
  });

  app.get("/api/v1/reports/policy-review/snapshots/:id/export", async (request, reply) => {
      requireRoles(request, "manager", "finance", "admin");
      const record = await platformStore.getPolicyEngineRecord(
        tenantOf(request),
        idOf(request),
      );
      if (record.recordType !== "POLICY_ANNUAL_REVIEW") {
        throw new NotFoundError(`AnnualReview ${idOf(request)} 不存在`);
      }
      const payload = record.payload as {
        from?: string;
        to?: string;
        reportHash?: string;
        signedOffBy?: string;
        signedAt?: string;
        report?: Record<string, unknown>;
      };
      const escape = (value: unknown) =>
        String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>年度制度审查报告</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;line-height:1.7;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left}pre{white-space:pre-wrap;background:#f6f6f6;padding:12px}</style></head><body>
<h1>年度制度审查报告</h1>
<p>周期：${escape(payload.from)} 至 ${escape(payload.to)}</p>
<p>状态：${escape(record.status)} · 报告哈希：<code>${escape(payload.reportHash)}</code></p>
<p>签核人：${escape(payload.signedOffBy ?? "未签核")} · 签核时间：${escape(payload.signedAt ?? "—")}</p>
<h2>报告内容</h2><pre>${escape(JSON.stringify(payload.report, null, 2))}</pre>
</body></html>`;
      assertExportAllowed(request);
      await assertExportDlp(request, html, "POLICY_ANNUAL_REVIEW", record.id);
      return reply
        .header("content-type", "text/html; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="policy-review-${record.id}.html"`,
        )
        .headers(exportHeaders(request, html, "CONFIDENTIAL_GOVERNANCE"))
        .send(html);
    },
  );

  async function buildReviewerAgreementReport(request: FastifyRequest): Promise<{
    pairCount: number;
    exactAgreementRate: number | null;
    withinOneRate: number | null;
    cohenKappa: number | null;
    insufficient: boolean;
    pairs: Array<{
      personId: string;
      cycleId: string;
      reviewerA: string;
      reviewerB: string;
      exactAgreementRate: number;
      withinOneRate: number;
    }>;
  }> {
    const decisions = (
      await storeFor(request).listEvaluationDecisions()
    ).filter((decision) =>
      ["APPROVED", "SUPERSEDED"].includes(decision.status),
    );
    const groups = new Map<string, typeof decisions>();
    for (const decision of decisions) {
      const key = `${decision.cycleId}:${decision.personId}`;
      groups.set(key, [...(groups.get(key) ?? []), decision]);
    }
    const pairs: Array<{
      personId: string;
      cycleId: string;
      reviewerA: string;
      reviewerB: string;
      exactAgreementRate: number;
      withinOneRate: number;
    }> = [];
    let exactTotal = 0;
    let withinOneTotal = 0;
    let ratingCount = 0;
    const observedRatings: Array<[number, number]> = [];
    for (const group of groups.values()) {
      for (let left = 0; left < group.length; left += 1) {
        for (let right = left + 1; right < group.length; right += 1) {
          const a = group[left]!;
          const b = group[right]!;
          if (a.reviewerPersonId === b.reviewerPersonId) continue;
          const dimensions = [
            ...new Set([
              ...Object.keys(a.scores ?? {}),
              ...Object.keys(b.scores ?? {}),
            ]),
          ];
          if (dimensions.length === 0) continue;
          let exact = 0;
          let withinOne = 0;
          for (const dimension of dimensions) {
            const scoreA = a.scores[dimension];
            const scoreB = b.scores[dimension];
            if (scoreA === undefined || scoreB === undefined) continue;
            ratingCount += 1;
            observedRatings.push([scoreA, scoreB]);
            if (scoreA === scoreB) exact += 1;
            if (Math.abs(scoreA - scoreB) <= 1) withinOne += 1;
          }
          exactTotal += exact;
          withinOneTotal += withinOne;
          pairs.push({
            personId: a.personId,
            cycleId: a.cycleId,
            reviewerA: a.reviewerPersonId,
            reviewerB: b.reviewerPersonId,
            exactAgreementRate: ratio(exact, dimensions.length),
            withinOneRate: ratio(withinOne, dimensions.length),
          });
        }
      }
    }
    const exactAgreementRate = ratingCount === 0 ? null : ratio(exactTotal, ratingCount);
    const withinOneRate = ratingCount === 0 ? null : ratio(withinOneTotal, ratingCount);
    let cohenKappa: number | null = null;
    if (ratingCount > 0) {
      const categories = [
        ...new Set(observedRatings.flatMap(([a, b]) => [a, b])),
      ];
      let expected = 0;
      for (const category of categories) {
        const pA =
          observedRatings.filter(([a]) => a === category).length / ratingCount;
        const pB =
          observedRatings.filter(([, b]) => b === category).length / ratingCount;
        expected += pA * pB;
      }
      cohenKappa =
        expected === 1
          ? 1
          : Math.round(((exactAgreementRate! - expected) / (1 - expected)) * 10_000) /
            10_000;
    }
    return {
      pairCount: pairs.length,
      exactAgreementRate,
      withinOneRate,
      cohenKappa,
      insufficient: pairs.length === 0,
      pairs,
    };
  }

  app.get("/api/v1/reports/reviewer-agreement", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    return data(await buildReviewerAgreementReport(request), request);
  });

  app.post("/api/v1/reports/reviewer-agreement:snapshot", async (request, reply) => {
      requireRoles(request, "finance", "admin");
      const report = await buildReviewerAgreementReport(request);
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "REVIEWER_AGREEMENT_AUDIT",
        period: new Date().toISOString().slice(0, 10),
        status: report.insufficient ? "INSUFFICIENT" : "GENERATED",
        payload: report,
      });
      return reply.status(201).send(data(record, request));
    },
  );

  app.get("/api/v1/reports/reviewer-agreement/snapshots", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    return data(
      await platformStore.listPolicyEngineRecords(tenantOf(request), {
        recordType: "REVIEWER_AGREEMENT_AUDIT",
      }),
      request,
    );
  });

  return app;
}
