import type {
  AdverseActionStatus,
  AppealCaseStatus,
  AttributionDecisionStatus,
  CalculationRunStatus,
  ContributionClaimStatus,
  DataQualityIssueStatus,
  EvaluationDraftStatus,
  SettlementBatchStatus,
  WorkPackageStatus,
} from "./states.js";
import type {
  AmountLedgerEntryPersisted,
  AuditEventPersisted,
  CalculationLinePersisted,
  CalculationRunPersisted,
  EmploymentContractPersisted,
  PayrollLinePersisted,
  PayrollRunPersisted,
  SettlementBatchPersisted,
  SettlementLinePersisted,
} from "./entity-types.generated.js";

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
  /** Configured task/package type used for evidence-coverage stratification. */
  packageType: string;
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

export type ContributionAttestationType = "PEER" | "MANAGER";

/** Peer or manager statement supporting a person's work-package contribution. */
export interface ContributionAttestation {
  id: UUID;
  tenantId: UUID;
  workPackageId: UUID;
  subjectPersonId: UUID;
  attesterPersonId: UUID;
  attestationType: ContributionAttestationType;
  statement: string;
  evidenceRefs: UUID[];
  status: "SUBMITTED" | "WITHDRAWN";
  withdrawnAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContributionClaim {
  id: UUID;
  tenantId: UUID;
  workPackageId: UUID;
  claimantPersonId: UUID;
  claimType: string;
  claimMode: "STANDARD" | "EXCEPTION" | "BACKFILL";
  exceptionReason?: string;
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
export type RetentionDisposalStatus =
  | "REQUESTED"
  | "APPROVED"
  | "COMPLETED"
  | "CANCELLED";

export type WorkforceSubgroupDimension =
  | "GENDER"
  | "AGE_BAND"
  | "REGION"
  | "TENURE_BAND"
  | "EMPLOYMENT_TYPE";

/**
 * Voluntary, consent-backed segment label used only for aggregate fairness
 * monitoring. Values are bands/categories, never dates of birth or identifiers.
 */
export interface WorkforceSubgroupAttribute {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  dimension: WorkforceSubgroupDimension;
  value: string;
  consentRef: string;
  consentedAt: string;
  expiresAt?: string;
  recordedBy?: UUID;
  createdAt: string;
  updatedAt: string;
}

export interface RetentionDisposalRequest {
  id: UUID;
  tenantId: UUID;
  retentionPolicyId: UUID;
  dataCategory: string;
  requestedBy: UUID;
  approvedBy?: UUID;
  status: RetentionDisposalStatus;
  reason: string;
  requestedAt: string;
  scheduledFor: string;
  approvedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export interface RetentionPolicy {
  id: UUID;
  tenantId: UUID;
  dataCategory: string;
  retentionMonths: number;
  legalBasis: string;
  legalHold: boolean;
  createdAt: string;
}

export interface AuditRedaction {
  id: UUID;
  tenantId: UUID;
  auditEventId: UUID;
  replacement: string;
  reason: string;
  requestedBy: UUID;
  approvedBy: UUID;
  createdAt: string;
}

export interface ModelRedTeamRun {
  id: UUID;
  tenantId: UUID;
  modelProvider: string;
  modelName: string;
  promptVersion: string;
  scope: string;
  testsRun: number;
  passed: boolean;
  findings: string[];
  artifactRef?: string;
  createdBy: UUID;
  createdAt: string;
}

export interface ModelCanaryRun {
  id: UUID;
  tenantId: UUID;
  baselineEvaluationRunId: UUID;
  candidateEvaluationRunId: UUID;
  datasetRef: string;
  trafficPercent: number;
  passed: boolean;
  blockers: string[];
  metrics: Record<string, unknown>;
  createdAt: string;
}

export interface ModelEvaluationSampleRecord {
  sampleId: string;
  subgroup: string;
  humanScoreA: number;
  humanScoreB: number;
  aiScore: number;
  counterfactualScores: number[];
  promptInjectionPassed: boolean;
  holdout: boolean;
  labelSource?: string;
  labelerIds?: string[];
}

export interface ModelEvaluationDataset {
  id: UUID;
  tenantId: UUID;
  code: string;
  version: number;
  name: string;
  sampleSize: number;
  holdoutSize: number;
  labelSource: string;
  ownerPersonId: UUID;
  status: "ACTIVE" | "RETIRED";
  refreshedAt: string;
  nextRefreshDueAt?: string;
  contentHash?: string;
  samples?: ModelEvaluationSampleRecord[];
  retiredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelProviderPolicy {
  id: UUID;
  tenantId: UUID;
  provider: string;
  zeroRetentionConfirmed: boolean;
  dpaRef: string;
  inferenceRegion: string;
  egressAllowlist: string[];
  approvedBy: UUID;
  approvedAt: string;
  status: "ACTIVE" | "RETIRED";
  retiredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiscretionaryPoolReview {
  id: UUID;
  tenantId: UUID;
  poolId: UUID;
  committeePersonIds: UUID[];
  employeeObserverPersonId?: UUID;
  selectionCriteria: string;
  decisionNotes: string;
  reviewedBy: UUID;
  reviewedAt: string;
  createdAt: string;
}

export type ClawbackStatus =
  | "DRAFT"
  | "APPROVED"
  | "RECOVERY_GENERATED"
  | "WAIVED"
  | "CANCELLED";

/** Recorded clawback terms and consent; execution remains a settlement-recovery action. */
export interface ClawbackCase {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  amount: DecimalString;
  currency: string;
  reasonCode: string;
  explanation: string;
  consentSignatureRef: string;
  installmentMonths: number;
  hardshipWaiver: boolean;
  hardshipReason?: string;
  status: ClawbackStatus;
  requestedBy: UUID;
  approvedBy?: UUID;
  approvedAt?: string;
  waivedAt?: string;
  waiverReason?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
  /** Reviewer view: where the generated recovery currently sits. */
  recovery?: {
    ledgerEntryId: string;
    amount: string;
    batchId: string | null;
    batchNo: string | null;
    batchStatus: string | null;
    waivedReversalEntryId: string | null;
  } | null;
}

export type BreakGlassScope = "PAYROLL_BANK_ACCOUNT";

/**
 * Strategic / A-class pool case (INC-09): profit-share pool that requires
 * standard-cost accounting, a transfer-pricing audit reference, a total cap,
 * explicit finance sign-off and optional deferred payment before activation.
 */
export type StrategicPoolStatus =
  | "DRAFT"
  | "COST_REVIEWED"
  | "FINANCE_APPROVED"
  | "ACTIVE"
  | "SETTLED"
  | "REJECTED";

export interface StrategicPoolCase {
  id: UUID;
  tenantId: UUID;
  cycleId: UUID;
  poolAmount: DecimalString;
  capAmount: DecimalString;
  currency: string;
  budgetPoolId?: UUID;
  rationale: string;
  requestedBy: string;
  units?: number;
  unitStandardCost?: DecimalString;
  totalStandardCost?: DecimalString;
  transferPricingRef?: string;
  costReviewedBy?: string;
  costReviewedAt?: string;
  financeApprovedBy?: string;
  financeApprovedAt?: string;
  deferredInstallmentMonths: number;
  status: StrategicPoolStatus;
  rejectedReason?: string;
  activatedAt?: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BreakGlassGrant {
  id: UUID;
  tenantId: UUID;
  scope: BreakGlassScope;
  granteePersonId: UUID;
  reason: string;
  grantedBy: UUID;
  expiresAt: string;
  status: "ACTIVE" | "REVOKED";
  revokedAt?: string;
  createdAt: string;
}

export interface PilotEnrollment {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  pilotCode: string;
  scope: string;
  consentSignatureRef: string;
  consentSignedAt: string;
  status: "ACTIVE" | "WITHDRAWN";
  withdrawnAt?: string;
  withdrawalReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type ESignEnvelopeStatus = "SENT" | "SIGNED" | "DECLINED" | "VOID";

export interface ESignEnvelope {
  id: UUID;
  tenantId: UUID;
  contractId: UUID;
  provider: string;
  envelopeRef: string;
  documentHash: string;
  signerPersonId: UUID;
  status: ESignEnvelopeStatus;
  sentAt: string;
  completedAt?: string;
  declineReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompensationTemplate {
  id: UUID;
  tenantId: UUID;
  code: string;
  name: string;
  roleCode: string;
  employmentType: EmploymentType;
  currency: string;
  fixedSalaryMin: DecimalString;
  fixedSalaryMax: DecimalString;
  deductionCapRate: DecimalString;
  variableShareCapRate: DecimalString;
  smoothingThresholdRate: DecimalString;
  deductionOrder: string[];
  deductionTypeCaps: Record<string, DecimalString>;
  status: "ACTIVE" | "RETIRED";
  createdAt: string;
  updatedAt: string;
}

export interface ManagerTrainingRecord {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  trainingCode: string;
  title: string;
  completedAt: string;
  expiresAt?: string;
  evidenceRef?: string;
  createdAt: string;
}

export interface CalibrationSession {
  id: UUID;
  tenantId: UUID;
  code: string;
  title: string;
  heldAt: string;
  facilitatorPersonId: UUID;
  attendeePersonIds: UUID[];
  policyVersionId?: UUID;
  notes?: string;
  createdAt: string;
}

export interface FairnessCommitment {
  id: UUID;
  tenantId: UUID;
  version: number;
  statement: string;
  ownerPersonId: UUID;
  channels: string[];
  status: "ACTIVE" | "SUPERSEDED";
  publishedAt: string;
  createdAt: string;
}

export interface TrustSurveyQuestion {
  code: string;
  prompt: string;
  dimension: string;
}

export interface TrustSurveyRun {
  id: UUID;
  tenantId: UUID;
  code: string;
  period: string;
  title: string;
  status: "DRAFT" | "OPEN" | "CLOSED";
  anonymous: boolean;
  questions: TrustSurveyQuestion[];
  openedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Pseudonymous response; the person id is never stored on the response. */
export interface TrustSurveyResponse {
  id: UUID;
  tenantId: UUID;
  surveyId: UUID;
  respondentHash: string;
  scores: Record<string, number>;
  submittedAt: string;
}

export interface TrustSurveyReport {
  survey: TrustSurveyRun;
  responseCount: number;
  averages: Record<string, number>;
  dimensions: Record<string, number>;
  distribution: Record<string, Record<string, number>>;
  baseline?: {
    surveyId: UUID;
    period: string;
    responseCount: number;
    dimensions: Record<string, number>;
  };
}

export interface ConflictDeclaration {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  relatedPersonId: UUID;
  relationshipType: string;
  description: string;
  status: "ACTIVE" | "REVOKED";
  declaredAt: string;
  revokedAt?: string;
  revocationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type DataClassification =
  | "PUBLIC"
  | "INTERNAL"
  | "CONFIDENTIAL"
  | "PERSONAL"
  | "SENSITIVE";

export type DataSourceCriticality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** A field-level entry in the tenant data map (PRD DATA-04/DATA-05). */
export interface DataSourceField {
  fieldName: string;
  classification: DataClassification;
  purpose: string;
  retentionMonths?: number;
}

/**
 * Registry entry for a system or dataset that supplies incentive evidence.
 * Owner and response-time SLA are mandatory; fields capture the minimum data
 * map needed to prove data minimisation and cross-border processing.
 */
export interface DataSource {
  id: UUID;
  tenantId: UUID;
  code: string;
  name: string;
  category: string;
  ownerPersonId: UUID;
  backupOwnerPersonId?: UUID;
  slaHours: number;
  criticality: DataSourceCriticality;
  containsPersonalData: boolean;
  storageRegion: string;
  crossBorderTransfers: boolean;
  processorRefs: string[];
  fields: DataSourceField[];
  status: "ACTIVE" | "RETIRED";
  lastReviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
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
    coverageByResponsibility: Array<{
      responsibilityCode: string;
      total: number;
      withEvidence: number;
      coverageRate: number;
    }>;
    coverageByOrderType: Array<{
      orderType: string;
      total: number;
      withEvidence: number;
      coverageRate: number;
    }>;
    coverageByPackageType: Array<{
      packageType: string;
      total: number;
      withEvidence: number;
      coverageRate: number;
    }>;
    /** Evidence coverage per calendar month (YYYY-MM) of acceptance. */
    coverageTrend: Array<{
      period: string;
      total: number;
      withEvidence: number;
      coverageRate: number;
    }>;
    /** Evidence coverage per calendar month split by package/task type. */
    coverageTrendByPackageType: Array<{
      packageType: string;
      periods: Array<{
        period: string;
        total: number;
        withEvidence: number;
        coverageRate: number;
      }>;
    }>;
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
  appeals: {
    total: number;
    open: number;
    overdue: number;
    closed: number;
    appealRate: number;
  };
  cycleTimes?: {
    workPackageAcceptanceHours: number;
    claimDecisionHours: number;
    confirmationHours?: number;
    payrollApprovalHours?: number;
    appealResolutionHours?: number;
    byResponsibility?: Array<{
      responsibilityCode: string;
      workPackageAcceptanceHours: number;
      workPackageSamples: number;
      claimDecisionHours: number;
      claimSamples: number;
      /** Confirmation elapsed time for confirmations by people in this role. */
      confirmationHours: number;
      confirmationSamples: number;
      /** Approval elapsed time for payroll runs containing this role. */
      payrollApprovalHours: number;
      payrollSamples: number;
      /** Resolution elapsed time for appeals raised by people in this role. */
      appealResolutionHours: number;
      appealSamples: number;
    }>;
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

export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACTOR";
export type EmploymentContractStatus = "ACTIVE" | "ENDED";

export interface EmploymentContract extends EmploymentContractPersisted {
  /** Present when tenant field-access policies hid fields from this viewer. */
  redactedFields?: string[];
}

export interface EmploymentContractAmendment {
  id: UUID;
  tenantId: UUID;
  contractId: UUID;
  payPlanVersion: number;
  beforeTerms: Record<string, unknown>;
  afterTerms: Record<string, unknown>;
  effectiveFrom: string;
  consentSignatureRef: string;
  approvedBy: UUID;
  status: "APPLIED" | "SCHEDULED" | "CANCELLED";
  appliedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** Present when field policies hid sensitive term fields from this viewer. */
  redactedFields?: string[];
  createdAt: string;
}

export type PayrollRunStatus =
  | "DRAFT"
  | "CALCULATED"
  | "BLOCKED"
  | "APPROVED"
  | "PAID"
  | "REVERSED"
  | "CANCELLED";

export interface PayrollLine extends PayrollLinePersisted {
  /** Present when tenant field-access policies hid fields from this viewer. */
  redactedFields?: string[];
}

export interface PayrollRun extends PayrollRunPersisted {
  lines?: PayrollLine[];
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

/**
 * NPV2-005：评估维度状态语义。零分只能是 ASSESSED 下有依据的人工认定；
 * 缺证据、不适用、未观测、争议都不是零分，必须显式区分（PRD V4.2 D-03）。
 */
export type AssessmentDimensionStatus =
  | "ASSESSED"
  | "INSUFFICIENT_EVIDENCE"
  | "NOT_OBSERVED"
  | "NOT_APPLICABLE"
  | "DISPUTED"
  | "PENDING_REVIEW";

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
  riskTier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskReasons?: string[];
  riskAssessedAt?: string;
  secondReviewRequired: boolean;
  secondReviewDueAt?: string;
  secondReviewSlaBreached?: boolean;
  zeroScoreRationale?: string;
  status: AiScoreProposalStatus;
  requestedBy?: UUID;
  decidedBy?: UUID;
  decisionNote?: string;
  decidedAt?: string;
  independentScores?: Record<string, number>;
  independentRationale?: string;
  reviewStartedAt?: string;
  reviewDurationSeconds?: number;
  evidenceOpened?: number;
  override?: boolean;
  overrideReason?: string;
  blindReview?: boolean;
  auditSample: boolean;
  auditSampledAt?: string;
  secondReviewerPersonId?: UUID;
  secondIndependentScores?: Record<string, number>;
  secondIndependentRationale?: string;
  secondReviewStartedAt?: string;
  secondReviewCompletedAt?: string;
  secondReviewDurationSeconds?: number;
  secondReviewEvidenceOpened?: number;
  secondReviewOutcome?: "AGREE" | "DISAGREE";
  secondReviewAgreementRate?: number;
  /** Present when tenant field policies hid fields from this viewer. */
  redactedFields?: string[];
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

export interface CalculationLine extends CalculationLinePersisted {}

export interface CalculationRun extends CalculationRunPersisted {
  lines: CalculationLine[];
}

export type LedgerEntryType =
  | "INCENTIVE"
  | "ADJUSTMENT"
  | "REVERSAL"
  | "RECOVERY";

export type LedgerStatus = "PROVISIONAL" | "APPROVED" | "LOCKED" | "REVERSED";

export interface AmountLedgerEntry extends AmountLedgerEntryPersisted {}

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
  /** 阶梯提成：按毛利区间累进计提；upTo 为区间上界（null = 无上限）。 */
  tiers?: Array<{
    upTo: DecimalString | null;
    ratePercent: DecimalString;
  }>;
  /** 团队池：按角色的激励系数（乘在申报权重上），缺省 1。 */
  roleWeights?: Record<string, DecimalString>;
  /** Generic calculator selected by the policy pack, not by industry code. */
  calculator?:
    | "SIMPLE_POOL"
    | "TIERED"
    | "TEAM_POOL"
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

/** Catalog entry describing what a tenant can buy and use. */
export interface SubscriptionPlan {
  id: UUID;
  code: string;
  name: string;
  description?: string;
  /** Monthly list price as a decimal string, e.g. "1999.00". */
  monthlyPrice: string;
  currency: string;
  /** Maximum active people; -1 means unlimited. */
  seatLimit: number;
  trialDays: number;
  features: string[];
  active: boolean;
  createdAt: string;
}

export type TenantSubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED";

export interface TenantSubscription {
  id: UUID;
  tenantId: UUID;
  planId: UUID;
  planCode: string;
  planName: string;
  status: TenantSubscriptionStatus;
  seats: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt?: string;
  canceledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type TenantInvoiceStatus = "DRAFT" | "ISSUED" | "PAID" | "VOID";

export interface TenantInvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: string;
  amount: string;
}

export interface TenantInvoice {
  id: UUID;
  tenantId: UUID;
  subscriptionId: UUID;
  number: string;
  status: TenantInvoiceStatus;
  currency: string;
  lineItems: TenantInvoiceLineItem[];
  totalAmount: string;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  issuedAt?: string;
  paidAt?: string;
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
  /** External identity (e.g. Feishu open_department_id) for idempotent sync. */
  externalId?: string;
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
  /** 展示名（用户或人员姓名），用于界面而非鉴权。 */
  displayName?: string;
  tenantName?: string;
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

/** Required legal/operational applicability of a published policy. */
export interface PolicyApplicability {
  legalEntity: string;
  jurisdictions: string[];
  workLocations: string[];
  employeeCategories: string[];
  workTimeTypes: string[];
}

export function assertPolicyApplicability(
  value: unknown,
): asserts value is PolicyApplicability {
  if (!value || typeof value !== "object") {
    throw new Error("POLICY_APPLICABILITY_REQUIRED");
  }
  const candidate = value as Partial<Record<keyof PolicyApplicability, unknown>>;
  if (
    typeof candidate.legalEntity !== "string" ||
    candidate.legalEntity.trim().length === 0
  ) {
    throw new Error("POLICY_APPLICABILITY_LEGAL_ENTITY_REQUIRED");
  }
  for (const key of [
    "jurisdictions",
    "workLocations",
    "employeeCategories",
    "workTimeTypes",
  ] as const) {
    const list = candidate[key];
    if (
      !Array.isArray(list) ||
      list.length === 0 ||
      list.some((item) => typeof item !== "string" || item.trim().length === 0)
    ) {
      throw new Error(`POLICY_APPLICABILITY_${key.toUpperCase()}_REQUIRED`);
    }
  }
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
  applicability?: PolicyApplicability;
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
  applicability: PolicyApplicability;
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
  applicability: PolicyApplicability;
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
  /** Present when tenant field policies hid fields from this viewer. */
  redactedFields?: string[];
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
  evidenceRefs?: UUID[];
  status: AppealCaseStatus;
  reviewerPersonId?: UUID;
  resolution?: string;
  dueAt?: string;
  createdAt: string;
  resolvedAt?: string;
}

export type AppealDisclosureMethod =
  | "PORTAL"
  | "EMAIL"
  | "IN_PERSON"
  | "OTHER";

/** Evidence shown to an appellant so the review is not a black box. */
export interface AppealEvidenceDisclosure {
  id: UUID;
  tenantId: UUID;
  appealId: UUID;
  disclosedBy: UUID;
  method: AppealDisclosureMethod;
  evidenceRefs: UUID[];
  note?: string;
  disclosedAt: string;
  createdAt: string;
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

export interface SettlementLine extends SettlementLinePersisted {
  personCode?: string;
  personName?: string;
  /** Present when tenant field access policies hid fields from this viewer. */
  redactedFields?: string[];
}

export interface SettlementBatch extends SettlementBatchPersisted {
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
  /** ATT-06：看 AI 草稿前的独立判断记录。 */
  independentScores: Record<string, number>;
  independentRationale: string;
  evidenceOpened?: number;
  reviewStartedAt?: string;
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

export interface AuditEvent extends AuditEventPersisted {
  redacted?: boolean;
  redactionId?: UUID;
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

export type AdverseActionType =
  | "PIP"
  | "TRAINING"
  | "REASSIGNMENT"
  | "DEMOTION"
  | "PAY_REDUCTION"
  | "TERMINATION";

/**
 * A human-only PIP / adverse-action record. Evaluation scores never create or
 * advance this object; it exists so the separate HR/legal process is visible,
 * separated and auditable.
 */
export interface AdverseActionCase {
  id: UUID;
  tenantId: UUID;
  personId: UUID;
  actionType: AdverseActionType;
  status: AdverseActionStatus;
  reason: string;
  performanceBasis: string;
  evidenceRefs: UUID[];
  requestedBy: UUID;
  legalReviewerId?: UUID;
  legalReviewRef?: string;
  legalReviewedAt?: string;
  approvedBy?: UUID;
  approvedAt?: string;
  effectiveFrom?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * NPV2-015：贡献事件——**事实记录**（发生了什么），不是贡献认定。
 *
 * 三条红线：
 * 1. ACTIVITY 类事件只承载活动量（commits/工时/调用次数等），**不得**
 *    作为贡献权重或归属依据——贡献认定只能引用 CONTRIBUTION 事件；
 * 2. 幂等键 (tenant, source, external_id) 保证连接器重复推送不重复入库；
 * 3. correction_of 形成更正链，原事件不删除（append-only 语义）。
 */
export type ContributionEventKind = "CONTRIBUTION" | "ACTIVITY" | "CONTEXT";

export interface ContributionEventOutcome {
  /** 结果摘要（一句话事实描述）。 */
  summary: string;
  /** 量化事实（活动量字段在此；不得用作贡献权重）。 */
  metrics?: Record<string, number | string>;
}

export interface ContributionEvent {
  id: UUID;
  tenantId: UUID;
  /** 事件执行者；系统/连接器自动事件可为空。 */
  actorPersonId?: UUID;
  /** 贡献主体（事件归属的成员）。 */
  subjectPersonId: UUID;
  /** 动作（做了什么）。 */
  action: string;
  /** 动作对象。 */
  targetType: string;
  targetId: string;
  /** 事件发生时间（业务时间，非录入时间）。 */
  occurredAt: string;
  /** 事实来源：连接器名（如 "git"）或 "MANUAL"。 */
  source: string;
  /** 来源系统内唯一键——幂等去重键。 */
  externalId?: string;
  kind: ContributionEventKind;
  outcome: ContributionEventOutcome;
  evidenceRefs: string[];
  /** 本事件是对哪个既有事件的更正（更正链）。 */
  correctionOfEventId?: UUID;
  createdAt: string;
}

export interface CreateContributionEventInput {
  actorPersonId?: UUID;
  subjectPersonId: UUID;
  action: string;
  targetType: string;
  targetId: string;
  occurredAt: string;
  source: string;
  externalId?: string;
  kind: ContributionEventKind;
  outcome: ContributionEventOutcome;
  evidenceRefs: string[];
  correctionOfEventId?: UUID;
}

export interface ContributionEventIngestResult {
  inserted: ContributionEvent[];
  /** 重复推送命中的既有事件（幂等返回，不重复入库）。 */
  duplicates: ContributionEvent[];
}

export interface ContributionEventFilter {
  subjectPersonId?: UUID;
  kind?: ContributionEventKind;
  source?: string;
  occurredFrom?: string;
  occurredTo?: string;
}

/**
 * NPV2-016：贡献认定草案（Contribution Assessment Draft）。
 *
 * 与 EvaluationDraft（绩效评价草案）不同，本对象评估的是**一笔贡献申报**：
 * 消费 NPV2-015 的 ContributionEvent，输出支持/反证/缺失信息/替代解释/
 * 不确定性。四条硬规则：
 * 1. 每条断言（支持/反证/替代解释）必须携带 evidence refs；
 * 2. 不默认百分比——不确定性用定性 band（LOW/MEDIUM/HIGH）；
 * 3. 引用的事件中不得包含 ACTIVITY 事件（活动量事实不作贡献依据，
 *    NPV2-015 消费侧强制，存储层 409 拒绝）；
 * 4. 未经人工决策不得进入正式 AttributionDecision——草案只能在
 *    SUBMITTED 后链接一笔已存在的人工归属决定，才转为 DECIDED。
 */
export interface AssessmentAssertion {
  statement: string;
  evidenceRefs: string[];
  /** 断言依据：贡献事件 / 申报内容 / 复核人判断。 */
  basis: "EVENT" | "CLAIM" | "REVIEWER";
  relatedEventId?: UUID;
}

export type AssessmentUncertaintyBand = "LOW" | "MEDIUM" | "HIGH";

export interface ContributionAssessmentDraft {
  id: UUID;
  tenantId: UUID;
  claimId: UUID;
  subjectPersonId: UUID;
  generatedByType: "AGENT" | "USER" | "SYSTEM";
  generatedById?: UUID;
  modelProvider?: string;
  modelName?: string;
  promptVersion?: string;
  supporting: AssessmentAssertion[];
  counter: AssessmentAssertion[];
  missingInformation: string[];
  alternativeExplanations: AssessmentAssertion[];
  uncertainty: {
    band: AssessmentUncertaintyBand;
    reasons: string[];
  };
  /** 草稿依据的贡献事件（不得含 ACTIVITY 事件）。 */
  basedOnEventIds: UUID[];
  activityEventsExcluded: boolean;
  status: "DRAFT" | "SUBMITTED" | "DECIDED" | "DISCARDED";
  /** 链接的人工归属决定（SUBMITTED→DECIDED 时写入）。 */
  attributionDecisionId?: UUID;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContributionAssessmentDraftInput {
  claimId: UUID;
  generatedByType: "AGENT" | "USER" | "SYSTEM";
  generatedById?: UUID;
  modelProvider?: string;
  modelName?: string;
  promptVersion?: string;
  supporting: AssessmentAssertion[];
  counter: AssessmentAssertion[];
  missingInformation: string[];
  alternativeExplanations: AssessmentAssertion[];
  uncertainty: {
    band: AssessmentUncertaintyBand;
    reasons: string[];
  };
  basedOnEventIds: UUID[];
}

export interface ContributionAssessmentDraftFilter {
  claimId?: UUID;
  subjectPersonId?: UUID;
  status?: ContributionAssessmentDraft["status"];
}
