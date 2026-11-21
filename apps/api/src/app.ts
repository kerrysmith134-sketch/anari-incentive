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
import { scanExportDlp } from "./dlp.js";
import { DEFAULT_FIELD_ACCESS_POLICIES, DEFAULT_PAYROLL_FIELD_POLICIES } from "./field-access-defaults.js";
import { sanitizeAgentChatParams } from "./modules/agent/agent-tasks.routes.js";

export { scanExportDlp };
export { sanitizeAgentChatParams };
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
import { registerTenantModuleRoutes } from "./modules/platform/tenant-modules.routes.js";
import { registerAgentMetricsRoutes } from "./modules/agent/agent-metrics.routes.js";
import { registerEvaluationRoutes } from "./modules/evaluation/evaluation.routes.js";
import { registerNotificationRoutes } from "./modules/notifications/notifications.routes.js";
import { registerAiGovernanceRoutes } from "./modules/aigovernance/ai-governance.routes.js";
import { registerWorkflowRunRoutes } from "./modules/workflow/workflow-runs.routes.js";
import { registerIntegrationRoutes } from "./modules/integrations/integration.routes.js";
import { registerAdverseActionRoutes } from "./modules/adverse/adverse-actions.routes.js";
import { registerReportRoutes } from "./modules/reports/reports.routes.js";
import { registerEvaluationCycleRoutes } from "./modules/evaluation/evaluation-cycle.routes.js";
import { registerPeopleGovernanceRoutes } from "./modules/people/people-governance.routes.js";
import { registerPolicyAdminRoutes } from "./modules/policyadmin/policy-admin.routes.js";
import { registerAgentTaskRoutes } from "./modules/agent/agent-tasks.routes.js";
import { registerAuditPrivacyRoutes } from "./modules/audit/audit-privacy.routes.js";
import { registerLedgerRoutes } from "./modules/ledger/ledger.routes.js";
import { registerPayrollRunRoutes } from "./modules/settlement/payroll-runs.routes.js";
import { registerWebhookRoutes } from "./modules/integrations/webhooks.routes.js";
import { registerNoticeRoutes } from "./modules/notifications/notices.routes.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerPlatformAdminRoutes } from "./modules/platform/platform-admin.routes.js";
import { registerCalculationRoutes } from "./modules/calculation/calculation-runs.routes.js";
import { registerBudgetRoutes } from "./modules/budget/budget.routes.js";
import { registerSettlementExportRoutes } from "./modules/settlement/settlement-exports.routes.js";
import { registerEsignRoutes } from "./modules/esign/esign.routes.js";
import { registerWorkforceGovernanceRoutes } from "./modules/governance/workforce-governance.routes.js";
import { registerDeliverableRoutes } from "./modules/workpackages/deliverables.routes.js";
import { registerEvidencePackageRoutes } from "./modules/evidence/evidence-packages.routes.js";
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
  /** NP-010：provider 探针注入（测试用）；缺省为真实 fetch。 */
  integrationProbe?: import("./modules/integrations/integration.routes.js").IntegrationProviderProbe;
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
  /** NPV2-031：Agent 步骤/工具调用持久化仓库（按租户）。 */
  agentStepRepositoryFor?: (tenantId: string) => import("@anari/agent-persistence").AgentStepRepository;
  /** NPV2-033：可观测性探针（db pool / outbox 积压 / agent task 状态计数）。 */
  dbPoolProbe?: () => { total: number; idle: number; waiting: number } | undefined;
  outboxProbe?: () => Promise<{ backlog: number; oldestAgeMs: number | null }>;
  agentTaskProbe?: () => Promise<Record<string, number>>;
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
      // AUD-017/D-04：演示租户显式开启扩展域（与 db/seed/001_demo.sql 一致）；
      // 新租户默认 P0-only，由平台管理员按租户开启。
      modules: ["PAYROLL", "EQUITY", "STRATEGIC_POOL"],
      // D-07：演示租户已获结算 GO（与 db/seed 一致）。
      settlementGo: true,
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

  // NPV2-033：请求/响应关联——X-Request-Id 透传给客户端与日志。
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
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
  app.register(
    registerContributionRoutes({ platformStore, storeFor, countEvent, modelScoring: options.modelScoring }),
  );

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
  app.register(registerTenantModuleRoutes({ platformStore, storeFor }));
  app.register(registerAgentMetricsRoutes({ storeFor }));
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
  app.register(
    registerIntegrationRoutes({
      platformStore,
      countEvent,
      integrationProbe: options.integrationProbe,
      webhookSigningSecret: process.env.WEBHOOK_SIGNING_SECRET,
      webhookRawEncryptionKey: process.env.WEBHOOK_RAW_KEY,
    }),
  );
  app.register(registerAdverseActionRoutes({ platformStore, countEvent }));
  app.register(
    registerReportRoutes({
      platformStore,
      storeFor,
      fieldPoliciesFor: (request) => fieldPoliciesFor(request),
      fieldMatchContextFor: (request, policies) =>
        fieldMatchContextFor(
          request,
          policies as Record<string, FieldAccessPolicy> | undefined,
        ),
      countByStatus,
      redactSettlementBatchFields: (batch, viewer) =>
        redactSettlementBatchFields(
          batch as Parameters<typeof redactSettlementBatchFields>[0],
          viewer as Parameters<typeof redactSettlementBatchFields>[1],
        ),
      assertExportAllowed,
      assertExportDlp,
      auditExport,
      exportHeaders,
      runtimeFor,
      countEvent,
      ensureApproval,
      consumeApprovalForAction,
      assertNoRetroactiveAdjustment,
    }),
  );
  app.register(registerEvaluationCycleRoutes({ platformStore, storeFor, countEvent }));
  app.register(registerPeopleGovernanceRoutes({ platformStore }));
  app.register(
    registerPolicyAdminRoutes({
      platformStore,
      storeFor,
      countEvent,
      ensureApproval,
      consumeApprovalForAction,
      runPolicyTestSuiteFor,
      requirePolicyTestsBeforeApproval,
    }),
  );
  app.register(
    registerAgentTaskRoutes({
      platformStore,
      storeFor,
      countEvent,
      runtimeFor,
      agentChat: options.agentChat,
      stepRepositoryFor: options.agentStepRepositoryFor,
    }),
  );
  app.register(
    registerAuditPrivacyRoutes({
      platformStore,
      storeFor,
      countEvent,
      auditEventsForViewer,
      assertExportAllowed,
      assertExportDlp,
      auditExport,
      exportHeaders,
    }),
  );
  app.register(
    registerLedgerRoutes({
      platformStore,
      storeFor,
      countEvent,
      ensureApproval,
      consumeApprovalForAction,
      assertNoRetroactiveAdjustment,
      assertExportAllowed,
      assertExportDlp,
      auditExport,
      exportHeaders,
    }),
  );
  app.register(
    registerPayrollRunRoutes({
      platformStore,
      storeFor,
      countEvent,
      ensureApproval,
      consumeApprovalForAction,
      assertExportAllowed,
      assertExportDlp,
      auditExport,
      exportHeaders,
      payrollRunForViewer,
      assertPayrollExportable,
    }),
  );
  app.register(
    registerWebhookRoutes({
      platformStore,
      countEvent,
      webhookSecrets: options.webhookSecrets,
      webhookSchemes: options.webhookSchemes,
    }),
  );
  app.register(registerNoticeRoutes({ platformStore, storeFor, countEvent }));
  app.register(
    registerAuthRoutes({
      platformStore,
      countEvent,
      sessionSecretOption: options.sessionSecret,
      feishu: options.feishu,
      publicSignup: options.publicSignup,
    }),
  );
  app.register(
    registerPlatformAdminRoutes({
      platformStore,
      storeFor,
      countEvent,
      storeForTenant: (tenantId) =>
        typeof storeOrResolver === "function"
          ? storeOrResolver(tenantId)
          : storeOrResolver,
      feishu: options.feishu,
    }),
  );
  app.register(
    registerCalculationRoutes({
      platformStore,
      storeFor,
      countEvent,
      ensureApproval,
      consumeApprovalForAction,
      preflightBudget,
      reserveRunBudget,
      enforceBudgetPools: options.enforceBudgetPools,
      fieldPoliciesFor: (request) => fieldPoliciesFor(request),
      fieldMatchContextFor: (request, policies) =>
        fieldMatchContextFor(
          request,
          policies as Record<string, FieldAccessPolicy> | undefined,
        ),
      redactCalculationRunFields: (run, viewer) =>
        redactCalculationRunFields(
          run as Parameters<typeof redactCalculationRunFields>[0],
          viewer as Parameters<typeof redactCalculationRunFields>[1],
        ),
      formalCoverageBlockers,
    }),
  );
  app.register(registerBudgetRoutes({ platformStore, storeFor }));
  app.register(
    registerSettlementExportRoutes({
      platformStore,
      storeFor,
      assertExportAllowed,
      assertExportDlp,
      auditExport,
      exportHeaders,
    }),
  );
  app.register(registerEsignRoutes({
      platformStore,
      countEvent,
      esignWebhookSecrets: options.esignWebhookSecrets,
    }));
  app.register(
    registerWorkforceGovernanceRoutes({
      platformStore,
      storeFor,
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
  app.register(registerDeliverableRoutes({ platformStore, storeFor, countEvent }));
  app.register(
    registerEvidencePackageRoutes({
      platformStore,
      storeFor,
      assertExportAllowed,
      assertExportDlp,
      auditExport,
      auditEventsForViewer,
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
      redactCalculationRunFields: (run, viewer) =>
        redactCalculationRunFields(
          run as Parameters<typeof redactCalculationRunFields>[0],
          viewer as Parameters<typeof redactCalculationRunFields>[1],
        ),
      redactSettlementBatchFields: (batch, viewer) =>
        redactSettlementBatchFields(
          batch as Parameters<typeof redactSettlementBatchFields>[0],
          viewer as Parameters<typeof redactSettlementBatchFields>[1],
        ),
    }),
  );
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
      !request.url.startsWith("/api/v1/esign/webhooks/") &&
      // NP-009：供应商集成回调同样需要原始体做 HMAC 校验。
      !request.url.startsWith("/api/v1/integration-webhooks/")
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

  // AUD-017：认证从 preHandler 上移到 onRequest——子插件（扩展域路由）的
  // FeatureGuard preHandler 也需要 authContext；Fastify 对子插件钩子先于
  // 根作用域执行，onRequest 阶段完成认证才能保证守卫拿到正确租户。
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/v1")) return;
    // Unauthenticated marketing/onboarding surface; routes apply their own guards.
    if (request.url.startsWith("/api/v1/public/")) return;
    // NP-009：供应商签名回调——routing key 即租户入口，HMAC 校验在路由内。
    if (request.url.startsWith("/api/v1/integration-webhooks/")) return;
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

  app.get("/metrics", async (_request, reply) => {
    // NPV2-033：db pool / agent task / outbox 实时 gauge（探针由 composition
    // 注入；探针失败不阻塞 scrape）。
    try {
      if (options.dbPoolProbe) {
        const poolStats = options.dbPoolProbe();
        if (poolStats) {
          metrics.setGauge("n_perform_db_pool_total", poolStats.total);
          metrics.setGauge("n_perform_db_pool_idle", poolStats.idle);
          metrics.setGauge("n_perform_db_pool_waiting", poolStats.waiting);
        }
      }
      if (options.outboxProbe) {
        const outbox = await options.outboxProbe();
        metrics.setGauge("n_perform_outbox_backlog", outbox.backlog);
        if (outbox.oldestAgeMs !== null) {
          metrics.setGauge("n_perform_outbox_oldest_age_ms", outbox.oldestAgeMs);
        }
      }
      if (options.agentTaskProbe) {
        const byStatus = await options.agentTaskProbe();
        for (const [status, count] of Object.entries(byStatus)) {
          metrics.setGauge(
            `n_perform_agent_tasks{status="${status}"}`,
            count as number,
          );
        }
      }
    } catch {
      /* 指标探针失败不阻塞 scrape */
    }
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(metrics.render());
  });

  return app;
}
