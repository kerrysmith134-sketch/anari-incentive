import type {
  AppealCaseStatus,
  AttributionDecisionStatus,
  CalculationRunStatus,
  ContributionClaimStatus,
  DataQualityIssueStatus,
  EvaluationDraftStatus,
  SettlementBatchStatus,
  WorkPackageStatus,
} from "./states.js";

export type UUID = string;
export type DecimalString = string;

export interface WorkPackageMember {
  personId: UUID;
  responsibilityCode: string;
  expectedOutput: string;
}

/**
 * Frozen at the moment a work package is committed. Later edits create a new
 * snapshot/version; they must not mutate this object.
 */
export interface CommitmentSnapshot {
  snapshotId: UUID;
  workPackageId: UUID;
  capturedAt: string;
  title: string;
  objective: string;
  ownerPersonId: UUID;
  members: WorkPackageMember[];
  acceptanceCriteria: string[];
  dueAt?: string;
  contentHash: string;
}

export interface WorkPackage {
  id: UUID;
  tenantId: UUID;
  title: string;
  objective: string;
  ownerPersonId: UUID;
  status: WorkPackageStatus;
  acceptanceCriteria: string[];
  members: WorkPackageMember[];
  dueAt?: string;
  commitmentSnapshot?: CommitmentSnapshot;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimedContribution {
  dimensions: string[];
  summary: string;
}

export interface ContributionClaim {
  id: UUID;
  tenantId: UUID;
  workPackageId: UUID;
  claimantPersonId: UUID;
  claimType: string;
  claimedContribution: ClaimedContribution;
  evidenceRefs: UUID[];
  rationale: string;
  status: ContributionClaimStatus;
  submittedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttributionDecision {
  id: UUID;
  tenantId: UUID;
  claimId: UUID;
  decisionVersion: number;
  status: AttributionDecisionStatus;
  adjudicatorPersonId: UUID;
  acceptedFacts: string[];
  rejectedFacts: string[];
  contributionDimensions: Record<string, number>;
  rationale: string;
  confidenceBand?: string;
  effectiveAt: string;
  supersedesId?: UUID;
  createdAt: string;
}

export type CalculationMode = "SHADOW" | "FORMAL";

/**
 * Product-level legal gate. The product records and enforces the evidence;
 * the tenant/legal counsel remains responsible for legal sufficiency.
 */
export interface LegalGate {
  democraticProcedureRef?: string;
  employeeNoticeRef?: string;
  dataProtectionAssessmentRef?: string;
  minimumWageChecked: boolean;
  policyApproved: boolean;
}

export interface OrderFact {
  id: string;
  grossProfit: DecimalString;
  currency: string;
  /** Optional policy inputs used by cash-weighted / retention packs. */
  contractAmount?: DecimalString;
  cashCollected?: DecimalString;
  retentionAmount?: DecimalString;
  projectType?: string;
  siteId?: string;
  safetyIncidents?: number;
  acceptanceStatus?: "ACCEPTED" | "PENDING" | "REJECTED";
  /** Optional sales/cash/reserve/channel inputs. */
  invoiceAmount?: DecimalString;
  creditApproved?: boolean;
  qualityHold?: boolean;
  channelPartnerId?: string;
  channelShare?: DecimalString;
}

export interface ParticipantInput {
  personId: UUID;
  workPackageId: UUID;
  /** Human-confirmed attribution weight, 0..1. Weights are normalised. */
  attributionWeight: DecimalString;
  /** Approved evaluation decision used to derive the multiplier, if any. */
  evaluationDecisionId?: UUID;
  /** Optional multiplier derived from an approved evaluation decision. */
  evaluationMultiplier?: DecimalString;
  role: string;
}

export interface CalculationInput {
  tenantId: UUID;
  cycleId: UUID;
  policyVersionId: UUID;
  mode: CalculationMode;
  order: OrderFact;
  participants: ParticipantInput[];
  legalGate?: LegalGate;
}

/**
 * Server-side legal-gate record. Callers cannot self-assert a gate on a
 * calculation request; the calculation reads this record by policy version.
 */
export interface LegalGateRecord extends LegalGate {
  id: UUID;
  tenantId: UUID;
  policyVersionId: UUID;
  recordedBy: UUID;
  recordedAt: string;
}

export type ConfirmationTargetType =
  | "EVALUATION"
  | "ATTRIBUTION"
  | "CALCULATION"
  | "LEDGER"
  | "SETTLEMENT";

export type ConfirmationDecision = "VIEWED" | "CONFIRMED" | "OBJECTED";

export interface EmployeeConfirmation {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  targetType: ConfirmationTargetType;
  targetId: UUID;
  decision: ConfirmationDecision;
  reason?: string;
  viewedAt?: string;
  confirmedAt?: string;
  objectedAt?: string;
  createdAt: string;
}

export type NoticeType =
  | "POLICY"
  | "PAY_PLAN"
  | "AI_USE"
  | "DATA_PROCESSING"
  | "OTHER";

/** A published employee notice (policy, pay plan, AI use, data processing). */
export interface EmployeeNotice {
  id: UUID;
  tenantId: UUID;
  policyVersionId?: UUID;
  noticeType: NoticeType;
  title: string;
  bodyRef: string;
  publishedAt: string;
  effectiveFrom: string;
  acknowledgementRequired: boolean;
  createdAt: string;
}

export interface PolicyAcknowledgement {
  id: UUID;
  tenantId: UUID;
  noticeId: UUID;
  personId: UUID;
  acknowledgedAt?: string;
  signatureRef?: string;
  declinedAt?: string;
  declineReason?: string;
  createdAt: string;
}

/**
 * Coverage of a notice across active persons in the tenant. A declined
 * acknowledgement is recorded but does not count as acknowledgement.
 */
export interface NoticeAcknowledgementSummary {
  noticeId: UUID;
  acknowledgementRequired: boolean;
  personCount: number;
  acknowledgedCount: number;
  declinedCount: number;
  pendingCount: number;
  complete: boolean;
}

export interface NoticeAcknowledgementOverview {
  summary: NoticeAcknowledgementSummary;
  acknowledgements: PolicyAcknowledgement[];
}

export type RepresentationBodyType =
  | "WORKS_COUNCIL"
  | "UNION"
  | "EMPLOYEE_REP"
  | "ALL_EMPLOYEES";

/** An employee representation body (works council, union, representative). */
export interface EmployeeRepresentation {
  id: UUID;
  tenantId: UUID;
  bodyName: string;
  bodyType: RepresentationBodyType;
  jurisdiction: string;
  active: boolean;
  createdAt: string;
}

export type ConsultationType =
  | "DISCUSSION"
  | "COMMENT_PERIOD"
  | "NEGOTIATION"
  | "INFORMATION";

export type ConsultationOutcome =
  | "PENDING"
  | "AGREED"
  | "NO_AGREEMENT"
  | "INFORMATION_ONLY"
  | "CLOSED";

/** A recorded democratic-procedure consultation for a policy version. */
export interface PolicyConsultation {
  id: UUID;
  tenantId: UUID;
  policyVersionId: UUID;
  representationId?: UUID;
  consultationType: ConsultationType;
  startedAt: string;
  endedAt?: string;
  minutesRef?: string;
  feedbackSummary?: string;
  outcome: ConsultationOutcome;
  createdAt: string;
}

export type DpiaAssessmentType = "DPIA" | "PIPIA";

export type DpiaStatus = "DRAFT" | "APPROVED" | "REJECTED";

/** Data-protection impact assessment (DPIA/PIPIA). */
export interface DpiaRecord {
  id: UUID;
  tenantId: UUID;
  assessmentType: DpiaAssessmentType;
  scope: string;
  status: DpiaStatus;
  riskSummary: Record<string, unknown>;
  mitigationSummary: Record<string, unknown>;
  approvedBy?: UUID;
  approvedAt?: string;
  createdAt: string;
}

export type DsarRequestType =
  | "ACCESS"
  | "CORRECTION"
  | "DELETION"
  | "EXPLANATION"
  | "OBJECTION";

export type DsarStatus = "OPEN" | "RESOLVED" | "REJECTED";

/** An employee data-subject access/correction/deletion request. */
export interface DsarRequest {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  requestType: DsarRequestType;
  status: DsarStatus;
  receivedAt: string;
  dueAt?: string;
  resolvedAt?: string;
  resolutionRef?: string;
  createdAt: string;
}

/** Tenant data-retention rule per data category. */
export interface RetentionPolicy {
  id: UUID;
  tenantId: UUID;
  dataCategory: string;
  retentionMonths: number;
  legalBasis: string;
  legalHold: boolean;
  createdAt: string;
}

export type ApprovalRiskTier = "T0" | "T1" | "T2" | "T3";

export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export interface ApprovalRequest {
  id: UUID;
  tenantId: UUID;
  actionType: string;
  targetType: string;
  targetId: UUID;
  targetVersion: number;
  requestedByType: "USER" | "AGENT" | "SYSTEM";
  requestedById?: UUID;
  riskTier: ApprovalRiskTier;
  status: ApprovalStatus;
  requiredApprovals: number;
  approvedCount: number;
  expiresAt?: string;
  payloadHash: string;
  idempotencyKey: string;
  consumedAt?: string;
  consumedBy?: UUID;
  createdAt: string;
}

export interface ApprovalDecision {
  id: UUID;
  tenantId: UUID;
  requestId: UUID;
  decision: "APPROVE" | "REJECT";
  approverPersonId: UUID;
  payloadHash: string;
  reason?: string;
  decidedAt: string;
  authContext: Record<string, unknown>;
}

export type BudgetPoolStatus = "DRAFT" | "APPROVED" | "CLOSED";

export interface BudgetPool {
  id: UUID;
  tenantId: UUID;
  cycleId: UUID;
  code: string;
  name: string;
  poolType: string;
  currency: string;
  approvedAmount: DecimalString;
  committedAmount: DecimalString;
  status: BudgetPoolStatus;
  approvedBy?: UUID;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  allocations?: BudgetAllocation[];
}

export type BudgetAllocationStatus = "RESERVED" | "RELEASED";

export interface BudgetAllocation {
  id: UUID;
  tenantId: UUID;
  budgetPoolId: UUID;
  targetType: string;
  targetId: UUID;
  amount: DecimalString;
  status: BudgetAllocationStatus;
  createdAt: string;
}

export interface CashGateInput {
  id: UUID;
  tenantId: UUID;
  cycleId: UUID;
  asOfDate: string;
  safetyReserveMonths: DecimalString;
  thirteenWeekForecastRef: string;
  passesGate: boolean;
  approvedBy: UUID;
  approvedAt: string;
  createdAt: string;
}

export interface FinancialFact {
  id: UUID;
  tenantId: UUID;
  sourceSystem: string;
  sourceRecordId: string;
  factType: string;
  periodStart?: string;
  periodEnd?: string;
  amount: DecimalString;
  currency: string;
  qualityStatus: EvidenceQualityStatus;
  sourceUpdatedAt?: string;
  ingestedAt: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type RuleChangeStatus = "DRAFT" | "APPROVED" | "PUBLICIZED" | "REJECTED";

export interface RuleChangeOrder {
  id: UUID;
  tenantId: UUID;
  policyCode: string;
  fromPolicyVersionId?: UUID;
  toPolicyVersionId: UUID;
  changeType: string;
  reason: string;
  impactSimulation: Record<string, unknown>;
  status: RuleChangeStatus;
  requestedBy: UUID;
  approvedBy?: UUID;
  approvedAt?: string;
  publicizedAt?: string;
  effectiveFrom: string;
  createdAt: string;
}

export type PolicyTestCaseCategory =
  | "NORMAL"
  | "BOUNDARY"
  | "EXCEPTION"
  | "HISTORICAL";

export type PolicyTestCaseStatus = "ACTIVE" | "RETIRED";

export interface PolicyTestCase {
  id: UUID;
  tenantId: UUID;
  policyVersionId: UUID;
  caseCode: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  category: PolicyTestCaseCategory;
  status: PolicyTestCaseStatus;
  lastRunAt?: string;
  lastRunPassed?: boolean;
  lastRunResultHash?: string;
  createdAt: string;
}

export interface PolicyTestCaseDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

export interface PolicyTestCaseRunResult {
  testCaseId: UUID;
  policyVersionId: UUID;
  caseCode: string;
  passed: boolean;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  differences: PolicyTestCaseDifference[];
  unsupportedExpectationKeys: string[];
  blockers: string[];
  resultHash?: string;
}

export interface PolicyTestSuiteResult {
  runId: UUID;
  runAt: string;
  policyVersionId: UUID;
  total: number;
  passedCount: number;
  failedCount: number;
  retiredCount: number;
  passed: boolean;
  results: PolicyTestCaseRunResult[];
}

export interface PolicyTestRun extends PolicyTestSuiteResult {
  id: UUID;
  tenantId: UUID;
  resultsHash: string;
}

export interface CycleReadinessReport {
  cycleId: UUID;
  generatedAt: string;
  readyForSettlement: boolean;
  calculations: {
    total: number;
    byStatus: Record<string, number>;
    formal: number;
    formalLocked: number;
    runs: Array<{
      runId: UUID;
      status: string;
      mode: CalculationMode;
      policyVersionId: UUID;
      blockers: string[];
    }>;
  };
  legalGates: Array<{
    policyVersionId: UUID;
    recorded: boolean;
    blockers: string[];
  }>;
  settlement: {
    total: number;
    byStatus: Record<string, number>;
    exported: number;
    acknowledged: number;
    batches: Array<{
      batchId: UUID;
      status: string;
      kind: "STANDARD" | "RECOVERY";
      exportedAt?: string;
      acknowledgedAt?: string;
    }>;
  };
  budgets: {
    pools: number;
    approved: number;
  };
  blockers: string[];
}

export interface PolicyReadinessReport {
  policyVersionId: UUID;
  code: string;
  version: number;
  generatedAt: string;
  ready: boolean;
  legalGate: {
    recorded: boolean;
    approved: boolean;
    blockers: string[];
  };
  tests: {
    active: number;
    passed: number;
    failed: number;
    notRun: number;
    suitePassed: boolean;
    cases: Array<{
      testCaseId: UUID;
      caseCode: string;
      passed?: boolean;
      lastRunAt?: string;
    }>;
  };
  notices: {
    linked: number;
    acknowledgementRequired: number;
    complete: number;
    incomplete: Array<{
      noticeId: UUID;
      acknowledgedCount: number;
      personCount: number;
      pendingCount: number;
      declinedCount: number;
    }>;
  };
  consultations: {
    total: number;
    concluded: number;
    latestOutcome?: ConsultationOutcome;
  };
  dpia: {
    referenced: boolean;
    status?: DpiaStatus;
    approved: boolean;
  };
  blockers: string[];
}

export interface OperationsCoverageReport {
  generatedAt: string;
  workPackages: {
    total: number;
    accepted: number;
    withEvidence: number;
    evidenceCoverageRate: number;
  };
  claims: {
    total: number;
    confirmed: number;
    pending: number;
    rejected: number;
  };
  evidence: {
    total: number;
    workPackage: number;
  };
  deliverables: {
    total: number;
    pendingAcceptance: number;
    accepted: number;
  };
  approvals: {
    total: number;
    pending: number;
    approved: number;
    consumed: number;
  };
  dataQuality: {
    total: number;
    open: number;
    overdue: number;
    escalated: number;
  };
  dsars: {
    total: number;
    open: number;
    resolved: number;
    rejected: number;
  };
}

export type EquityGrantType = "OPTION" | "RSU" | "SAR";
export type EquityGrantStatus =
  | "ACTIVE"
  | "CANCELLED"
  | "EXHAUSTED"
  | "EXPIRED";
export type EquityExerciseStatus =
  | "PENDING"
  | "APPROVED"
  | "SETTLED"
  | "CANCELLED";

export interface EquityGrant {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  grantCode: string;
  grantType: EquityGrantType;
  totalUnits: DecimalString;
  strikePrice: DecimalString;
  currency: string;
  grantDate: string;
  vestingStart: string;
  cliffMonths: number;
  vestingMonths: number;
  status: EquityGrantStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EquityExercise {
  id: UUID;
  tenantId: UUID;
  grantId: UUID;
  personId: UUID;
  units: DecimalString;
  strikePrice: DecimalString;
  totalCost: DecimalString;
  currency: string;
  status: EquityExerciseStatus;
  requestedBy: UUID;
  approvedBy?: UUID;
  approvedAt?: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EquityVesting {
  grantId: UUID;
  asOf: string;
  vestedUnits: DecimalString;
  unvestedUnits: DecimalString;
  exercisedUnits: DecimalString;
  availableUnits: DecimalString;
  nextVestAt?: string;
  fullyVested: boolean;
}

export type BountyStatus =
  | "OPEN"
  | "CLAIMED"
  | "SUBMITTED"
  | "ACCEPTED"
  | "CANCELLED";

export interface Bounty {
  id: UUID;
  tenantId: UUID;
  title: string;
  description: string;
  rewardAmount: DecimalString;
  currency: string;
  status: BountyStatus;
  createdBy: UUID;
  dueAt?: string;
  assigneePersonId?: UUID;
  claimedAt?: string;
  submissionRef?: string;
  submittedAt?: string;
  acceptedBy?: UUID;
  acceptedAt?: string;
  paymentRef?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PolicyNotice {
  id: UUID;
  tenantId: UUID;
  policyVersionId: UUID;
  noticeId: UUID;
  audience: Record<string, unknown>;
  createdAt: string;
}

export interface MetricDefinition {
  id: UUID;
  tenantId: UUID;
  code: string;
  version: number;
  name: string;
  description?: string;
  dataType: string;
  unit?: string;
  aggregationMethod?: string;
  sourceContract: Record<string, unknown>;
  active: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
}

export type DeliverableStatus = "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED";

export interface Deliverable {
  id: UUID;
  tenantId: UUID;
  workPackageId: UUID;
  title: string;
  deliverableType: string;
  ownerPersonId: UUID;
  dueAt?: string;
  status: DeliverableStatus;
  artifactRef?: string;
  contentHash?: string;
  submittedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type AcceptanceDecision = "ACCEPT" | "REJECT" | "ACCEPT_WITH_ISSUES";

export interface Acceptance {
  id: UUID;
  tenantId: UUID;
  deliverableId: UUID;
  decision: AcceptanceDecision;
  reviewerPersonId: UUID;
  criteriaResults: Record<string, unknown>;
  comments?: string;
  decidedAt: string;
  supersedesId?: UUID;
  createdAt: string;
}

export interface AiSuggestionLog {
  id: UUID;
  tenantId: UUID;
  agentTaskId: UUID;
  targetType: string;
  targetId?: UUID;
  suggestionType: string;
  modelProvider?: string;
  modelName?: string;
  modelPromptId?: UUID;
  promptVersion: string;
  inputHash: string;
  outputJson: Record<string, unknown>;
  validationStatus: string;
  acceptedBy?: UUID;
  acceptedAt?: string;
  createdAt: string;
}

export interface ModelEvaluationRun {
  id: UUID;
  tenantId: UUID;
  evaluationType: string;
  modelProvider: string;
  modelName: string;
  promptVersion: string;
  datasetRef: string;
  sampleSize: number;
  metrics: Record<string, unknown>;
  subgroupMetrics: Record<string, unknown>;
  passed: boolean;
  blockers: string[];
  evaluatedAt: string;
  createdAt: string;
}

export type ModelPromptStatus = "DRAFT" | "ACTIVE" | "RETIRED";

export interface ModelPrompt {
  id: UUID;
  tenantId: UUID;
  promptCode: string;
  version: number;
  purpose: string;
  modelProvider: string;
  modelName: string;
  template: string;
  templateHash: string;
  status: ModelPromptStatus;
  evaluationRunId?: UUID;
  activatedAt?: string;
  retiredAt?: string;
  createdAt: string;
}

export type AiScoreProposalStatus = "PENDING" | "ACCEPTED" | "REJECTED";

export interface AiScoreProposal {
  id: UUID;
  tenantId: UUID;
  cycleId: UUID;
  personId: UUID;
  evaluationRunId: UUID;
  modelPromptId?: UUID;
  modelProvider: string;
  modelName: string;
  promptVersion: string;
  dimensions: string[];
  scores: Record<string, number>;
  overallScore: number;
  confidence: number;
  rationale: string;
  evidenceRefs: string[];
  evidenceSnapshotHash: string;
  gateMetrics: Record<string, unknown>;
  status: AiScoreProposalStatus;
  requestedBy?: UUID;
  decidedBy?: UUID;
  decisionNote?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface WorkflowRun {
  id: UUID;
  tenantId: UUID;
  agentTaskId: UUID;
  workflowName: string;
  workflowVersion: string;
  status: string;
  currentStep?: string;
  state: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
}

export interface IntegrationConnection {
  id: UUID;
  tenantId: UUID;
  provider: string;
  connectionName: string;
  credentialRef: string;
  status: string;
  config: Record<string, unknown>;
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type IntegrationMappingType = "CSV" | "HTTP_JSON";
export type IntegrationMappingStatus = "ACTIVE" | "RETIRED";

export interface IntegrationMapping {
  id: UUID;
  tenantId: UUID;
  connectionId: UUID;
  name: string;
  mappingType: IntegrationMappingType;
  sourceSystem: string;
  targetType: string;
  fieldMap: Record<string, string>;
  config: Record<string, unknown>;
  version: number;
  status: IntegrationMappingStatus;
  createdAt: string;
  retiredAt?: string;
}

export interface SyncRun {
  id: UUID;
  tenantId: UUID;
  connectionId: UUID;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  cursorBefore?: Record<string, unknown>;
  cursorAfter?: Record<string, unknown>;
  recordsSeen: number;
  recordsUpserted: number;
  errorSummary?: string;
  createdAt: string;
}

export interface SyncSchedule {
  id: UUID;
  tenantId: UUID;
  connectionId: UUID;
  name: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalIdentity {
  id: UUID;
  tenantId: UUID;
  sourceSystem: string;
  externalId: string;
  personId?: UUID;
  objectType: string;
  createdAt: string;
}

export interface WebhookInboxMessage {
  id: UUID;
  tenantId: UUID;
  sourceSystem: string;
  messageId: string;
  payloadHash: string;
  receivedAt: string;
  processedAt?: string;
  status: string;
  errorCode?: string;
}

export interface AdjustmentRecord {
  id: UUID;
  tenantId: UUID;
  originalLedgerId: UUID;
  adjustmentLedgerId: UUID;
  reasonCode: string;
  explanation: string;
  approvedBy: UUID;
  approvedAt: string;
  createdAt: string;
}

export interface InboxMessage {
  id: UUID;
  tenantId: UUID;
  consumerName: string;
  messageId: string;
  receivedAt: string;
  processedAt?: string;
  status: string;
  errorCode?: string;
}

export interface CalculationLine {
  /** Deterministic key: person + work package + incentive type. */
  lineKey: string;
  personId: UUID;
  workPackageId: UUID;
  incentiveType: string;
  baseAmount: DecimalString;
  multiplier: DecimalString;
  rawAmount: DecimalString;
  roundedAmount: DecimalString;
  currency: string;
  trace: Record<string, unknown>;
}

export interface CalculationRun {
  id: UUID;
  tenantId: UUID;
  cycleId: UUID;
  mode: CalculationMode;
  policyVersionId: UUID;
  engineVersion: string;
  inputSnapshotHash: string;
  inputSnapshot: CalculationInput;
  status: CalculationRunStatus;
  lines: CalculationLine[];
  resultHash?: string;
  blockers: string[];
  warnings: string[];
  createdAt: string;
  calculatedAt?: string;
  lockedAt?: string;
}

export type LedgerEntryType =
  | "INCENTIVE"
  | "ADJUSTMENT"
  | "REVERSAL"
  | "RECOVERY";

export type LedgerStatus = "PROVISIONAL" | "APPROVED" | "LOCKED" | "REVERSED";

export interface AmountLedgerEntry {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  cycleId: UUID;
  calculationRunId: UUID;
  calculationLineId?: UUID;
  entryType: LedgerEntryType;
  amount: DecimalString;
  currency: string;
  status: LedgerStatus;
  sourceEntryId?: UUID;
  idempotencyKey: string;
  entryHash: string;
  prevHash: string;
  createdAt: string;
  lockedAt?: string;
}

export interface PolicyDefinition {
  code: string;
  version: number;
  currency: string;
  /** Pool = grossProfit * poolRate, capped at poolCap. */
  poolRate: DecimalString;
  poolCap: DecimalString;
  rounding: "HALF_UP" | "HALF_EVEN" | "DOWN";
  /** Charging-project policy: share of the pool exposed to cash collection. */
  cashCollectionWeight?: DecimalString;
  /** Cash-weighted retention pack: share held until warranty/retention expiry. */
  retentionHoldbackRate?: DecimalString;
  /** Cash-weighted retention pack: hard quality gates. */
  qualityGate?: {
    requireAcceptance: boolean;
    blockOnSafetyIncident: boolean;
  };
  /** Reserve/channel pack: share held for after-sales/returns. */
  afterSalesReserveRate?: DecimalString;
  /** Reserve/channel pack: credit/quality gates. */
  creditGate?: {
    requireCreditApproval: boolean;
    blockOnQualityHold: boolean;
  };
  /** Line item type emitted by the calculator; set by the pack, not the core. */
  incentiveType?: string;
  /** Generic calculator selected by the policy pack, not by industry code. */
  calculator?:
    | "SIMPLE_POOL"
    | "CASH_WEIGHTED_POOL"
    | "CASH_WEIGHTED_RETENTION_POOL"
    | "CASH_WEIGHTED_RESERVE_CHANNEL_POOL";
  /** Optional display guard; payroll compliance is still a separate gate. */
  minimumWage?: {
    monthlyMinimum: DecimalString;
    checked: boolean;
  };
  /**
   * Optional evaluation weighting. When present, every participant needs an
   * approved EvaluationDecision for the cycle; its scores are converted to a
   * multiplier applied to the attribution weight.
   */
  evaluation?: {
    dimensionWeights: Record<string, DecimalString>;
    floor: DecimalString;
    ceiling: DecimalString;
    /** Score scale maximum. Defaults to 5. */
    maxScore?: DecimalString;
  };
}

/** A policy version published through the governed policy control loop. */
export interface PlatformTenant {
  id: UUID;
  name: string;
  slug: string;
  status: string;
  defaultTimezone: string;
  defaultCurrency: string;
  /** Tenant-level settings, e.g. `{ requiredApprovals: [...] }`. */
  settings?: Record<string, unknown>;
  createdAt: string;
}

export interface PlatformUser {
  id: UUID;
  email?: string;
  displayName: string;
  authSubject: string;
  status: string;
  createdAt: string;
}

export interface PlatformPerson {
  id: UUID;
  tenantId: UUID;
  userId?: UUID;
  employeeCode: string;
  displayName: string;
  employmentStatus: string;
  managerPersonId?: UUID;
  createdAt: string;
}

export interface PlatformOrgNode {
  id: UUID;
  tenantId: UUID;
  parentId?: UUID;
  nodeType: string;
  name: string;
  path?: string;
  active: boolean;
  createdAt: string;
}

export interface PlatformOrgAssignment {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  orgNodeId: UUID;
  validFrom: string;
  validTo?: string;
  allocation?: DecimalString;
  createdAt: string;
}

export interface PlatformIdentity {
  userId: UUID;
  personId?: UUID;
  roles: string[];
}

export interface PlatformMembership {
  id: UUID;
  tenantId: UUID;
  userId: UUID;
  status: string;
  roleCodes: string[];
  joinedAt?: string;
  createdAt: string;
  userDisplayName?: string;
  userEmail?: string;
}

export interface PolicyVersionSummary {
  policyVersionId: UUID;
  code: string;
  version: number;
  status: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  contentHash?: string;
  publishedAt?: string;
}

export interface PolicyVersionDetail extends PolicyVersionSummary {
  policy: PolicyDefinition;
  scope: Record<string, unknown>;
}

export interface PublishedPolicy {
  policyVersionId: UUID;
  policy: PolicyDefinition;
  contentHash: string;
  effectiveFrom: string;
  publishedAt: string;
  approvedBy: UUID;
}

export interface PolicyRollbackResult extends PublishedPolicy {
  sourcePolicyVersionId: UUID;
}

export interface PublishPolicyInput {
  policy: PolicyDefinition;
  /** Optional caller-supplied id; otherwise the store generates one. */
  policyVersionId?: UUID;
  effectiveFrom: string;
  approvedBy: UUID;
  scope?: Record<string, unknown>;
}

export type EvidenceQualityStatus =
  | "VALID"
  | "MISSING"
  | "STALE"
  | "CONFLICTED"
  | "UNVERIFIED"
  | "INVALID";

export type EvidenceRelationType =
  | "SUPPORTS"
  | "CONTRADICTS"
  | "DEPENDS_ON"
  | "CORRECTS"
  | "CONTEXT";

export interface EvidenceNode {
  id: UUID;
  tenantId: UUID;
  evidenceType: string;
  subjectType: string;
  subjectId: UUID;
  sourceSystem: string;
  sourceUri?: string;
  observedAt: string;
  qualityStatus: EvidenceQualityStatus;
  normalizedPayload: Record<string, unknown>;
  payloadHash: string;
  supersedesId?: UUID;
  /** Person who submitted the evidence, when it came from an employee. */
  submittedBy?: UUID;
  createdAt: string;
}

export interface IngestionEvent {
  sourceRecordId: string;
  sourceEventVersion?: string;
  eventType: string;
  occurredAt?: string;
  subjectType: string;
  subjectId: string;
  evidenceType: string;
  payload: Record<string, unknown>;
  qualityStatus?: EvidenceQualityStatus;
  sourceUri?: string;
}

export interface IngestionBatch {
  sourceSystem: string;
  events: IngestionEvent[];
}

export interface IngestionResult {
  accepted: number;
  duplicates: number;
  evidenceIds: string[];
}

export interface EvidenceLink {
  id: UUID;
  tenantId: UUID;
  fromEvidenceId: UUID;
  toEvidenceId: UUID;
  relationType: EvidenceRelationType;
  rationale?: string;
  createdAt: string;
}

export interface AppealCase {
  id: UUID;
  tenantId: UUID;
  appellantPersonId: UUID;
  targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER" | "CALCULATION";
  targetId: UUID;
  reasonCode: string;
  statement: string;
  status: AppealCaseStatus;
  reviewerPersonId?: UUID;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

export type RecalculationTargetType =
  | "EVIDENCE"
  | "ATTRIBUTION"
  | "EVALUATION"
  | "LEDGER";

export type RecalculationStatus =
  | "OPEN"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED";

/** A request to recalculate after an evidence/attribution/evaluation fix. */
export interface RecalculationRequest {
  id: UUID;
  tenantId: UUID;
  targetType: RecalculationTargetType;
  targetId: UUID;
  reasonCode: string;
  explanation: string;
  requestedBy: UUID;
  status: RecalculationStatus;
  approvedBy?: UUID;
  approvedAt?: string;
  newCalculationRunId?: UUID;
  createdAt: string;
}

export interface SettlementLine {
  id: UUID;
  tenantId: UUID;
  batchId: UUID;
  ledgerId: UUID;
  personId: UUID;
  personCode?: string;
  personName?: string;
  amount: DecimalString;
  currency: string;
  status: string;
  active: boolean;
  createdAt: string;
}

export interface SettlementBatch {
  id: UUID;
  tenantId: UUID;
  cycleId: UUID;
  batchNo: string;
  status: SettlementBatchStatus;
  kind: "STANDARD" | "RECOVERY";
  currency: string;
  totalAmount: DecimalString;
  lineCount: number;
  approvedBy?: UUID;
  approvedAt?: string;
  lockedAt?: string;
  exportedAt?: string;
  acknowledgedAt?: string;
  externalReference?: string;
  createdAt: string;
  updatedAt: string;
  lines?: SettlementLine[];
}

export interface SettlementExport {
  id: UUID;
  tenantId: UUID;
  batchId: UUID;
  exportRef: string;
  exportHash: string;
  exportedBy: UUID;
  exportedAt: string;
  acknowledgedAt?: string;
  acknowledgementRef?: string;
  createdAt: string;
}

export interface SettlementAcknowledgement {
  id: UUID;
  tenantId: UUID;
  exportId: UUID;
  externalReference: string;
  acknowledgedAt: string;
  payloadHash: string;
  createdAt: string;
}

export type SettlementCommand =
  | "RECONCILE"
  | "SUBMIT"
  | "APPROVE"
  | "LOCK"
  | "EXPORT"
  | "ACKNOWLEDGE"
  | "REQUIRE_ADJUSTMENT"
  | "CANCEL";

export interface SettlementCommandInput {
  command: SettlementCommand;
  actorPersonId?: UUID;
  externalReference?: string;
  reason?: string;
}

export interface SettlementCommandResult {
  batch: SettlementBatch;
  csv?: string;
}

export interface Rubric {
  id: UUID;
  tenantId: UUID;
  code: string;
  name: string;
  dimensions: string[];
  scoringAnchors: Record<string, unknown>;
  scope: Record<string, unknown>;
  status: string;
  version: number;
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
}

export interface EvaluationCycle {
  id: UUID;
  tenantId: UUID;
  name: string;
  cycleType: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: string;
  policyVersionId?: UUID;
  rubricVersionId?: UUID;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationDraft {
  id: UUID;
  tenantId: UUID;
  cycleId: UUID;
  personId: UUID;
  generatedByType: "AGENT" | "USER" | "SYSTEM";
  generatedById?: UUID;
  modelProvider?: string;
  modelName?: string;
  promptVersion?: string;
  agentTaskId?: UUID;
  evidenceSnapshotHash: string;
  draftPayload: Record<string, unknown>;
  strengths: string[];
  counterEvidence: string[];
  missingInformation: string[];
  uncertainty: Record<string, unknown>;
  status: EvaluationDraftStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationDecision {
  id: UUID;
  tenantId: UUID;
  cycleId: UUID;
  personId: UUID;
  decisionVersion: number;
  status: "APPROVED" | "SUPERSEDED" | "WITHDRAWN";
  rubricVersionId: UUID;
  evidenceSnapshotHash: string;
  scores: Record<string, number>;
  rationale: string;
  reviewerPersonId: UUID;
  approvedAt?: string;
  supersedesId?: UUID;
  createdAt: string;
}

export type NotificationAudience =
  | "PERSON"
  | "MANAGER"
  | "FINANCE"
  | "ADMIN";

export interface InAppNotification {
  id: UUID;
  tenantId: UUID;
  recipientPersonId?: UUID;
  audience: NotificationAudience;
  title: string;
  body: string;
  sourceType?: string;
  sourceId?: UUID;
  status: "UNREAD" | "READ";
  createdAt: string;
  readAt?: string;
}

export interface AuditEvent {
  id: UUID;
  tenantId: UUID;
  sequence: number;
  actorType: "USER" | "AGENT" | "SYSTEM" | "INTEGRATION";
  actorId?: UUID;
  action: string;
  objectType: string;
  objectId?: UUID;
  beforeHash?: string;
  afterHash?: string;
  reason?: string;
  correlationId: UUID;
  occurredAt: string;
  prevHash: string;
  eventHash: string;
}

export interface DataQualityIssue {
  id: UUID;
  tenantId: UUID;
  objectType: string;
  objectId: UUID;
  issueCode: string;
  severity: "INFO" | "WARNING" | "BLOCKING";
  status: DataQualityIssueStatus;
  assignedTo?: UUID;
  details: Record<string, unknown>;
  dueAt?: string;
  escalatedAt?: string;
  escalationReason?: string;
  waiverReason?: string;
  waivedBy?: UUID;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}
