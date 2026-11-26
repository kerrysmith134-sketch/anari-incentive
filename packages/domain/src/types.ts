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

export type FinancialInstrumentType =
  | "INVOICE"
  | "CREDIT_NOTE"
  | "PAYMENT"
  | "COST"
  | "REFUND";

export type FinancialRecognitionStatus = "DRAFT" | "POSTED";

/**
 * 财务子账业务文档类型（迁移 111）。
 *
 * - INVOICE：应收发票；
 * - PAYMENT / REFUND：收款 / 退款（退款金额为负）；
 * - FX_REVALUATION：汇率重估，金额 = 原币金额 × (新汇率 - 原汇率)；
 * - REVERSAL：冲销，金额为原事实取反；
 * - CREDIT_NOTE：预留贷项通知单；
 * - BAD_DEBT_PROVISION / BAD_DEBT_WRITE_OFF：坏账计提 / 核销（迁移 112）。
 */
export type FinancialDocumentType =
  | "INVOICE"
  | "PAYMENT"
  | "REFUND"
  | "FX_REVALUATION"
  | "REVERSAL"
  | "CREDIT_NOTE"
  | "BAD_DEBT_PROVISION"
  | "BAD_DEBT_WRITE_OFF";

/** 应收账款账龄桶（迁移 112）。CURRENT = 0 天，90+ = 超过 90 天。 */
export type FinancialAgingBucket =
  | "CURRENT"
  | "1-30"
  | "31-60"
  | "61-90"
  | "90+";

export const FINANCIAL_AGING_BUCKETS: readonly FinancialAgingBucket[] = [
  "CURRENT",
  "1-30",
  "31-60",
  "61-90",
  "90+",
];

/**
 * 迁移 115：多税种发票的单一税种明细。
 *
 * 明细不新增列，持久化在 `financial_facts.payload.taxBreakdown`（JSON 数组，
 * 1-5 条、code 1-32 字符且同一发票内唯一）；汇总税额写入既有列
 * `financial_facts.tax_amount`，因此账龄、AR 借方与 GL 的 TAX_PAYABLE
 * 全部继续读同一列。
 *
 * 计算口径（全部 1e6 定点 BigInt，客户端传入值只用于比对）：
 *   taxAmount = base × rate / 100，**逐税种 HALF_UP 取整后再求和**；
 *   base = 发票 amount；rate 为百分比（0-100，最多 6 位小数）。
 */
export interface FinancialTaxBreakdownLine {
  /** 税种代码（1-32 字符；同一张发票内唯一）。 */
  code: string;
  /** 税率百分比（0-100，6 位小数定点）。 */
  rate: DecimalString;
  /** 计税基数 = 发票金额（原币）。 */
  base: DecimalString;
  /** 该税种税额 = base × rate / 100（逐条 HALF_UP）。 */
  taxAmount: DecimalString;
}

/** 会计期间（按法人隔离；CLOSED 期间拒绝新的 POSTED 事实）。 */
export interface AccountingPeriod {
  id: UUID;
  tenantId: UUID;
  legalEntityId: string;
  /** YYYY-MM */
  period: string;
  status: "OPEN" | "CLOSED";
  closedAt?: string;
  closedBy?: UUID | null;
  closeReason?: string | null;
  reopenedAt?: string;
  reopenedBy?: UUID | null;
  reopeningRef?: string | null;
  reopenReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 会计期间变更请求（双人审批；请求人/审批人不得同一人）。 */
export interface AccountingPeriodChangeRequest {
  id: UUID;
  tenantId: UUID;
  legalEntityId: string;
  /** YYYY-MM */
  period: string;
  action: "CLOSE" | "REOPEN";
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedBy: UUID;
  requestedAt: string;
  reason?: string | null;
  reopeningRef?: string | null;
  decidedBy?: UUID | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 会计期间审批人目录（迁移 113）。
 *
 * 目录按租户维护；PUT 全量替换时被移除的人保留行并置 active=false，
 * 便于审计追溯历史审批人。目录为空（或全部失效）时，服务层回退到
 * 租户内 admin/finance 角色人员，不阻断期间变更请求。
 */
export interface AccountingPeriodApprover {
  tenantId: UUID;
  personId: UUID;
  active: boolean;
  createdAt: string;
  /** 读时从人员目录补齐的展示名，不落库。 */
  displayName?: string;
}

export type AccountingPeriodApproverSource =
  | "DIRECTORY"
  | "ROLE_FALLBACK";

/** 有效审批人解析结果：显式目录优先，否则回退到角色人员。 */
export interface AccountingPeriodApproverResolution {
  approvers: AccountingPeriodApprover[];
  source: AccountingPeriodApproverSource;
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
  /** 会计语义（2026-11-21 审计）：POSTED 时必填。 */
  legalEntityId?: string;
  orderId?: string;
  contractRef?: string;
  instrumentType?: FinancialInstrumentType;
  recognitionStatus: FinancialRecognitionStatus;
  /** YYYY-MM */
  accountingPeriod?: string;
  fxSnapshot?: {
    rate: DecimalString;
    quoteCurrency: string;
    source: string;
    asOf: string;
  };
  sourceVersion?: string;
  reversalOf?: string;
  reopeningRef?: string;
  /**
   * 财务子账（迁移 111）：业务文档身份、关联事实与功能币金额。
   * 全部可选，既有事实保持原样。
   */
  documentType?: FinancialDocumentType;
  documentId?: string;
  /** 收款/退款指向发票；重估/冲销指向被调整事实。 */
  relatedFactId?: string;
  /** 原币 → 功能币汇率，6 位小数定点（1.000000 表示同币种）。 */
  fxRate?: DecimalString;
  /** ISO 4217 功能币种。 */
  functionalCurrency?: string;
  /** 功能币金额，应用层用 1e6 BigInt 计算并校验。 */
  functionalAmount?: DecimalString;
  /**
   * 迁移 112 / 115：税额。
   * - 单一税率发票：taxRate 为百分比（0-100，最多 6 位小数），
   *   taxAmount = amount × taxRate / 100；
   * - 多税种发票（迁移 115）：taxRate 为空，逐税种明细保存在
   *   `payload.taxBreakdown`（FinancialTaxBreakdownLine[]），taxAmount 为
   *   各条 taxAmount 之和。
   * 两种形态都由服务端用 1e6 定点 BigInt 计算并校验客户端传入值。
   */
  taxRate?: DecimalString;
  taxAmount?: DecimalString;
  /** 派生字段：amount + taxAmount（仅当存在税额时返回）。 */
  totalAmount?: DecimalString;
}

// ----------------------------------------------------------------------
// 复式记账（迁移 112）：会计科目 / 日记账 / 分录。
// 金额统一 1e6 定点 DecimalString；每张凭证借贷必须相等。
// ----------------------------------------------------------------------

export type GlAccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "REVENUE"
  | "EXPENSE";

export type GlNormalBalance = "DEBIT" | "CREDIT";

export interface GlAccount {
  id: UUID;
  tenantId: UUID;
  code: string;
  name: string;
  accountType: GlAccountType;
  normalBalance: GlNormalBalance;
  createdAt: string;
}

export interface GlJournalLine {
  id: UUID;
  tenantId: UUID;
  journalId: UUID;
  lineNo: number;
  accountCode: string;
  debit: DecimalString;
  credit: DecimalString;
  currency: string;
  createdAt: string;
}

export interface GlJournal {
  id: UUID;
  tenantId: UUID;
  journalNo: string;
  documentType: FinancialDocumentType;
  documentId: string;
  legalEntityId: string;
  /** YYYY-MM */
  accountingPeriod: string;
  currency: string;
  description?: string;
  sourceFactId?: string;
  totalDebit: DecimalString;
  totalCredit: DecimalString;
  lines: GlJournalLine[];
  createdAt: string;
}

/** 最小会计科目表（迁移 112 种子 + Memory adapter 初始化）。 */
export const GL_ACCOUNT_SEED: ReadonlyArray<{
  code: string;
  name: string;
  accountType: GlAccountType;
  normalBalance: GlNormalBalance;
}> = [
  { code: "AR", name: "Accounts Receivable", accountType: "ASSET", normalBalance: "DEBIT" },
  { code: "REVENUE", name: "Revenue", accountType: "REVENUE", normalBalance: "CREDIT" },
  { code: "TAX_PAYABLE", name: "Tax Payable", accountType: "LIABILITY", normalBalance: "CREDIT" },
  { code: "CASH", name: "Cash", accountType: "ASSET", normalBalance: "DEBIT" },
  { code: "FX_GAIN_LOSS", name: "FX Gain/Loss", accountType: "REVENUE", normalBalance: "CREDIT" },
  { code: "BAD_DEBT_EXPENSE", name: "Bad Debt Expense", accountType: "EXPENSE", normalBalance: "DEBIT" },
  { code: "ALLOWANCE", name: "Allowance for Doubtful Accounts", accountType: "ASSET", normalBalance: "CREDIT" },
  // 迁移 117：奖励批次支付回执记账（借 INCENTIVE_EXPENSE / 贷 CASH|PAYABLE）。
  // 既有租户由各 adapter 的 ensureGlAccounts 在首次记账时补齐，无需回填历史。
  { code: "INCENTIVE_EXPENSE", name: "Incentive Expense", accountType: "EXPENSE", normalBalance: "DEBIT" },
  { code: "PAYABLE", name: "Accounts Payable", accountType: "LIABILITY", normalBalance: "CREDIT" },
];

export const GL_ACCOUNT_CODES = {
  AR: "AR",
  REVENUE: "REVENUE",
  TAX_PAYABLE: "TAX_PAYABLE",
  CASH: "CASH",
  FX_GAIN_LOSS: "FX_GAIN_LOSS",
  BAD_DEBT_EXPENSE: "BAD_DEBT_EXPENSE",
  ALLOWANCE: "ALLOWANCE",
  INCENTIVE_EXPENSE: "INCENTIVE_EXPENSE",
  PAYABLE: "PAYABLE",
} as const;

// ----------------------------------------------------------------------
// 奖励批次支付回执与对账（迁移 117）。
//
// 一笔支付回执只覆盖批次的一行；唯一键 (batch, line, payment_ref) 是幂等键。
// 金额仍是 1e6 定点 DecimalString，对账投影用 BigInt 加减，绝不使用浮点。
// 只有 PAID 计入“已付”并生成 GL 凭证；FAILED/RETURNED 只留痕。
// ----------------------------------------------------------------------

export type IncentiveAwardPaymentStatus = "PAID" | "FAILED" | "RETURNED";

/** 单行支付回执（银行流水/内部转账凭证的一行）。 */
export interface IncentiveAwardPayment {
  id: UUID;
  tenantId: UUID;
  batchId: UUID;
  lineId: UUID;
  personId: UUID;
  amount: DecimalString;
  currency: string;
  paymentRef: string;
  status: IncentiveAwardPaymentStatus;
  /** 仅在 PAID 时必填（服务端缺省为记录时间）。 */
  paidAt?: string;
  failureCode?: string;
  createdAt: string;
}

/** 行级对账状态：PAID=足额，PARTIAL=部分，UNPAID=未付，OVERPAID=超出。 */
export type IncentiveAwardLineReconciliationStatus =
  | "PAID"
  | "PARTIAL"
  | "UNPAID"
  | "OVERPAID";

export interface IncentiveAwardReconciliationLine {
  lineId: UUID;
  personId: UUID;
  currency: string;
  /** 批次行应付金额。 */
  amount: DecimalString;
  /** 该行 PAID 回执累计已付金额。 */
  paidAmount: DecimalString;
  /** 未付金额 = max(0, amount - paidAmount)。 */
  unpaidAmount: DecimalString;
  /** 差异 = paidAmount - amount（负数=少付，正数=多付）。 */
  variance: DecimalString;
  status: IncentiveAwardLineReconciliationStatus;
  /** 计入已付的银行流水号（PAID only）。 */
  paymentRefs: string[];
}

export type IncentiveAwardBatchReconciliationStatus =
  | "RECONCILED"
  | "PARTIAL"
  | "VARIANCE";

export interface IncentiveAwardBatchReconciliation {
  batchId: UUID;
  batchNo: string;
  /** 批次状态（IncentiveAwardBatchStatus，此处用 string 避免与 policy-types 循环依赖）。 */
  batchStatus: string;
  currency: string;
  /** 批次应付合计（incentive_award_batches.total_amount）。 */
  totalAmount: DecimalString;
  paidAmount: DecimalString;
  unpaidAmount: DecimalString;
  /** 差异 = paidAmount - totalAmount。 */
  variance: DecimalString;
  totalLines: number;
  paidLines: number;
  unpaidLines: number;
  partialLines: number;
  overpaidLines: number;
  status: IncentiveAwardBatchReconciliationStatus;
  lines: IncentiveAwardReconciliationLine[];
}

const AWARD_AMOUNT_SCALE = 1_000_000n;

/** 1e6 定点解析：只接受非负、最多 6 位小数的十进制字符串。 */
function awardAmountToMicros(value: DecimalString): bigint {
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) {
    throw new Error(`INVALID_AWARD_AMOUNT: ${value}`);
  }
  return BigInt(match[1]!) * AWARD_AMOUNT_SCALE +
    BigInt((match[2] ?? "").padEnd(6, "0") || "0");
}

function awardMicrosToAmount(value: bigint): DecimalString {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const integer = absolute / AWARD_AMOUNT_SCALE;
  const fraction = (absolute % AWARD_AMOUNT_SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

/**
 * 奖励批次对账投影（纯函数，Memory 与 PG adapter 共用，保证两条存储路径
 * 给出完全相同的已付/未付/差异与状态）。
 *
 * 状态判定：
 * - RECONCILED：每行差异为 0，且已付合计 = 批次 total_amount；
 * - VARIANCE：存在多付行，或已付合计 > total_amount，或合计相等但行级错配；
 * - PARTIAL：其余（少付，含完全未付）。
 */
export function reconcileIncentiveAwardBatch(input: {
  batchId: string;
  batchNo: string;
  batchStatus: string;
  currency: string;
  totalAmount: DecimalString;
  lines: ReadonlyArray<{
    id: string;
    personId: string;
    amount: DecimalString;
    currency: string;
  }>;
  payments: ReadonlyArray<{
    id: string;
    lineId: string;
    amount: DecimalString;
    paymentRef: string;
    status: string;
  }>;
}): IncentiveAwardBatchReconciliation {
  const paidByLine = new Map<string, bigint>();
  const refsByLine = new Map<string, string[]>();
  for (const payment of input.payments) {
    if (payment.status !== "PAID") continue;
    const micros = awardAmountToMicros(payment.amount);
    paidByLine.set(payment.lineId, (paidByLine.get(payment.lineId) ?? 0n) + micros);
    const refs = refsByLine.get(payment.lineId) ?? [];
    refs.push(payment.paymentRef);
    refsByLine.set(payment.lineId, refs);
  }

  let paidTotal = 0n;
  let unpaidTotal = 0n;
  let paidLines = 0;
  let unpaidLines = 0;
  let partialLines = 0;
  let overpaidLines = 0;
  let allLinesExact = true;

  const lines: IncentiveAwardReconciliationLine[] = input.lines.map((line) => {
    const amount = awardAmountToMicros(line.amount);
    const paid = paidByLine.get(line.id) ?? 0n;
    const outstanding = amount - paid;
    paidTotal += paid;

    let status: IncentiveAwardLineReconciliationStatus;
    if (paid === 0n) {
      status = "UNPAID";
      unpaidLines += 1;
    } else if (outstanding === 0n) {
      status = "PAID";
      paidLines += 1;
    } else if (outstanding > 0n) {
      status = "PARTIAL";
      partialLines += 1;
    } else {
      status = "OVERPAID";
      overpaidLines += 1;
    }
    if (outstanding !== 0n) allLinesExact = false;
    if (outstanding > 0n) unpaidTotal += outstanding;

    return {
      lineId: line.id,
      personId: line.personId,
      currency: line.currency,
      amount: awardMicrosToAmount(amount),
      paidAmount: awardMicrosToAmount(paid),
      unpaidAmount: awardMicrosToAmount(outstanding > 0n ? outstanding : 0n),
      variance: awardMicrosToAmount(paid - amount),
      status,
      paymentRefs: refsByLine.get(line.id) ?? [],
    };
  });

  const totalAmount = awardAmountToMicros(input.totalAmount);
  const variance = paidTotal - totalAmount;
  let status: IncentiveAwardBatchReconciliationStatus;
  if (allLinesExact && variance === 0n) {
    status = "RECONCILED";
  } else if (variance > 0n || overpaidLines > 0) {
    status = "VARIANCE";
  } else if (variance < 0n) {
    status = "PARTIAL";
  } else {
    // 合计相等但行级仍有差异（一行多付、另一行少付）→ 不是可回执的对账。
    status = "VARIANCE";
  }

  return {
    batchId: input.batchId,
    batchNo: input.batchNo,
    batchStatus: input.batchStatus,
    currency: input.currency,
    totalAmount: awardMicrosToAmount(totalAmount),
    paidAmount: awardMicrosToAmount(paidTotal),
    unpaidAmount: awardMicrosToAmount(unpaidTotal),
    variance: awardMicrosToAmount(variance),
    totalLines: lines.length,
    paidLines,
    unpaidLines,
    partialLines,
    overpaidLines,
    status,
    lines,
  };
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
  /**
   * Present (true) when the run currency is not CNY, so China IIT/social
   * insurance were intentionally not applied. This is derived from the line
   * currency at calculation/read time; it is not a persisted column because
   * the persisted `currency` already carries the truth.
   */
  statutoryCurrencyUnsupported?: boolean;
  /** Present when tenant field-access policies hid fields from this viewer. */
  redactedFields?: string[];
}

export interface PayrollRun extends PayrollRunPersisted {
  /** Derived marker for non-CNY runs whose statutory CN deductions are off. */
  statutoryCurrencyUnsupported?: boolean;
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
  /** NP-016 / INT-211：精确计数——拉取/原始落地/新增/更新/重复/隔离/失败对账。 */
  recordsFetched?: number;
  recordsRawPersisted?: number;
  recordsCreated?: number;
  recordsUpdated?: number;
  recordsDuplicate?: number;
  recordsInvalid?: number;
  recordsQuarantined?: number;
  recordsFailed?: number;
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

/** NP-001（2026-11-21 审计）：连接下的独立资源流（每 mapping 一条）。 */
export interface SyncResource {
  id: UUID;
  tenantId: UUID;
  connectionId: UUID;
  resourceKey: string;
  mappingId?: UUID;
  scheduleId?: UUID;
  status: "ACTIVE" | "PAUSED" | "RETIRED";
  /** INT-212：资源级最小调度间隔（分钟）；缺省沿用连接级排期。 */
  intervalMinutes?: number | null;
  /** NP-021：资源级租约（一个资源同一时刻只有一个 worker 持有）。 */
  leaseOwner?: string | null;
  leaseUntil?: string | null;
  /** NP-021：fencing token 单调递增——旧持有者过期后写不过新持有者。 */
  fencingToken: number;
  createdAt: string;
  updatedAt: string;
}

/** 资源级游标（断点续跑）：只在目标写入成功后推进。 */
export interface SyncCheckpoint {
  id: UUID;
  tenantId: UUID;
  resourceId: UUID;
  cursor?: string | null;
  watermark?: string | null;
  overlapSeconds: number;
  lastRunId?: UUID | null;
  updatedAt: string;
}

/** NP-008（2026-11-21 审计）：外部对象 → 内部对象的身份映射（opaque ID 解析）。 */
export interface ExternalObjectIdentity {
  id: UUID;
  tenantId: UUID;
  sourceSystem: string;
  externalObjectType: string;
  externalObjectId: string;
  internalObjectType: string;
  internalObjectId: UUID;
  matchRule: string;
  confidence: number;
  confirmedBy?: UUID;
  validFrom: string;
  validTo?: string | null;
  /** NP-027：终止原因（WRONG_MAPPING/MERGED/MANUAL…）与操作人。 */
  unlinkReason?: string | null;
  unlinkedBy?: UUID | null;
  createdAt: string;
}

/** NP-020（2026-11-21 审计）+ INT-202（Sprint 2.1）：不可变原始落地记录（版本化，payload 密文）。 */
export interface RawSourceRecord {
  id: UUID;
  tenantId: UUID;
  sourceSystem: string;
  externalRecordId: string;
  payloadEncrypted: string;
  /** 稳定内容哈希（投影幂等判定 + 篡改检测）。 */
  payloadHash: string;
  /** 来源版本（来源事件版本或内容哈希）；同记录多版本并存。 */
  sourceVersion: string;
  mappingVersion: number;
  retentionClass: "DEFAULT" | "PII" | "FINANCIAL";
  resourceId?: UUID;
  fetchedAt: string;
  sourceUpdatedAt?: string | null;
  replayedAt?: string | null;
  createdAt: string;
}

/** 隔离区记录（无法路由/校验失败的数据，待人工处置）。 */
export interface QuarantineRecord {
  id: UUID;
  tenantId: UUID;
  sourceSystem: string;
  externalRecordId?: string | null;
  reason: string;
  payload: Record<string, unknown>;
  resolvedAt?: string | null;
  resolvedBy?: UUID | null;
  resolutionNote?: string | null;
  createdAt: string;
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
  /** NP-009：AES-256-GCM 加密的原始载荷（仅 process 端点解密回读）。 */
  rawPayloadEncrypted?: string;
}

/** NP-009：不透明 webhook 路由端点（routing key → 连接）。 */
export interface WebhookRoutingKey {
  id: UUID;
  tenantId: UUID;
  connectionId: UUID;
  routingKey: string;
  createdAt: string;
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
  /** 来源系统最后更新时间（增量水位依据；与业务发生时间分离）。 */
  sourceUpdatedAt?: string;
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
  /** NP-004：盲审掩码——内容被服务端剥离（AI 草案在独立判断完成前）。 */
  contentHidden?: boolean;
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
  /** D-03：维度认定状态（零分必须 ASSESSED 且有理由）。 */
  dimensionStates?: Record<
    string,
    "ASSESSED" | "NOT_APPLICABLE" | "INSUFFICIENT_EVIDENCE"
  >;
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

/** AUD-023：人工对 Agent 结果的标注（误报/确认/升级），指标从这些事实计算。 */
export type AgentFeedbackLabelKind =
  | "CONFIRMED_POSITIVE"
  | "FALSE_POSITIVE"
  | "ESCALATED";

export interface AgentFeedbackLabel {
  id: UUID;
  tenantId: UUID;
  taskId?: UUID;
  findingRef?: string;
  label: AgentFeedbackLabelKind;
  labeledBy: UUID;
  model?: string;
  promptVersion?: string;
  comment?: string;
  createdAt: string;
}

/** AUD-023：按 租户|provider|model 累计的模型调用持久化事实。 */
export interface AgentModelUsage {
  tenantId: UUID;
  provider: string;
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  updatedAt: string;
}

/** AUD-023：AI-off 对照组基线（持久化，不冒充实时的静态输入）。 */
export interface AgentAiOffBaseline {
  id: UUID;
  tenantId: UUID;
  windowStart: string;
  windowEnd: string;
  /** 0-1（DecimalString）。 */
  completionRate: string;
  sampleSize: number;
  recordedBy: UUID;
  createdAt: string;
}

export interface InAppNotification {
  id: UUID;
  tenantId: UUID;
  recipientPersonId?: UUID;
  audience: NotificationAudience;
  title: string;
  body: string;
  sourceType?: string;
  sourceId?: UUID;
  /** AUD-011：稳定幂等键——同租户同键只产生一条通知。 */
  idempotencyKey?: string;
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

/**
 * NPV2-017：指标计量快照（Metric Measurement Snapshot）。
 *
 * 冻结一次评价所依据的原始指标数据：每条 measurement 记录指标、取值、
 * 来源与来源记录引用；contentHash 由服务端对排序后的 measurements 计算，
 * 冻结后不可变。正式 Evaluation Decision 通过 link-decision 绑定快照，
 * 实现追溯链：决定 → 快照（contentHash + measurements）→ 来源记录，
 * 以及决定已有的 rubricVersionId。
 */
export interface MetricMeasurementRecord {
  metricId: string;
  name: string;
  /** 1e6 十进制字符串。 */
  value: string;
  unit?: string;
  /** 数据来源（连接器名 / MANUAL / EVIDENCE）。 */
  source: string;
  /** 来源记录引用（贡献事件/证据/摄取批次 id）。 */
  sourceRef?: string;
  observedAt: string;
  qualityStatus: "VALID" | "MISSING" | "STALE" | "CONFLICTED";
}

export interface MetricMeasurementSnapshot {
  id: UUID;
  tenantId: UUID;
  cycleId: UUID;
  personId: UUID;
  rubricVersionId: UUID;
  measurements: MetricMeasurementRecord[];
  /** sha256(按 metricId+observedAt 排序后的 measurements)，冻结凭证。 */
  contentHash: string;
  frozenAt: string;
  frozenBy: UUID;
  status: "FROZEN" | "CONSUMED";
  /** 链接的正式评价决定（FROZEN→CONSUMED 时写入）。 */
  evaluationDecisionId?: UUID;
  /** 执行快照绑定的认证人员；与 decisionId 在同一原子状态转换中写入。 */
  linkedByPersonId?: UUID;
  /** 历史记录在绑定操作时未留存 actor；不得伪造，需明确显示为未知。 */
  legacyLinkedActorUnknown?: boolean;
  createdAt: string;
}

export interface CreateMetricMeasurementSnapshotInput {
  cycleId: UUID;
  personId: UUID;
  rubricVersionId: UUID;
  measurements: MetricMeasurementRecord[];
  frozenBy: UUID;
}

export interface MetricMeasurementSnapshotFilter {
  cycleId?: UUID;
  personId?: UUID;
  status?: MetricMeasurementSnapshot["status"];
}

/**
 * NPV2-020：Agent 待办（Todo / Follow-up Task）。
 *
 * Agent 创建的待办是持久业务对象（不是聊天记录）：有责任人、dueAt、
 * 关联对象、幂等键与来源（来源 agent 任务/发现）。业务 UI 可查、可处理、
 * 可验证；同 (tenant, idempotencyKey) 重复创建不重复入库。
 */
export interface AgentTodo {
  id: UUID;
  tenantId: UUID;
  title: string;
  detail?: string;
  /** 责任人。 */
  assigneePersonId: UUID;
  dueAt?: string;
  /** 关联业务对象。 */
  targetType?: string;
  targetId?: string;
  /** 来源：AGENT_TASK / AGENT_FINDING / MANUAL 等。 */
  sourceType: string;
  /** 来源记录 id（如 agent task id）。 */
  sourceId: string;
  /** 幂等键：同 (tenant, key) 只创建一次。 */
  idempotencyKey: string;
  createdByAgentTaskId?: UUID;
  status: "OPEN" | "DONE" | "CANCELLED";
  completedByPersonId?: UUID;
  completedAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAgentTodoInput {
  title: string;
  detail?: string;
  assigneePersonId: UUID;
  dueAt?: string;
  targetType?: string;
  targetId?: string;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  createdByAgentTaskId?: UUID;
}

export interface AgentTodoFilter {
  assigneePersonId?: UUID;
  status?: AgentTodo["status"];
  sourceType?: string;
}

/**
 * Ticketing Canonical Work Item（114 迁移）：经 types.ts 聚合导出到 @anari/domain。
 * 独立模块保证规范模型 + 纯解析函数不散落在适配层。
 */
export * from "./work-item.js";

/**
 * JEV Decision Record（118 迁移）：通用决策模型 + hash/状态纯函数。
 * 与 work-item 一样经 types.ts 聚合导出，保持 `@anari/domain` 单一包面。
 */
export * from "./decision.js";
