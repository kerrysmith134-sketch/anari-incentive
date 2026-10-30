export type Uuid = string;
export type DecimalString = string;

export interface EvaluationCycle {
  id: Uuid;
  name: string;
  cycleType: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: string;
  policyVersionId?: Uuid;
  rubricVersionId?: Uuid;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: Uuid;
  actionType: string;
  targetType: string;
  targetId: Uuid;
  targetVersion: number;
  requestedByType: "USER" | "AGENT" | "SYSTEM";
  requestedById?: Uuid;
  riskTier: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
  requiredApprovals: number;
  approvedCount: number;
  expiresAt?: string;
  payloadHash: string;
  idempotencyKey: string;
  consumedAt?: string;
  consumedBy?: Uuid;
  createdAt: string;
}

export interface ApprovalDecision {
  id: Uuid;
  requestId: Uuid;
  decision: "APPROVE" | "REJECT";
  approverPersonId: Uuid;
  reason?: string;
  decidedAt: string;
}

export interface PayrollLine {
  id: Uuid;
  runId: Uuid;
  personId: Uuid;
  contractId: Uuid;
  currency: string;
  fixedAmount: DecimalString;
  incentiveAmount: DecimalString;
  grossAmount: DecimalString;
  deductionAmount: DecimalString;
  taxAmount: DecimalString;
  socialInsuranceAmount: DecimalString;
  netAmount: DecimalString;
  minimumMonthlyWage: DecimalString;
  minimumWagePassed: boolean;
  deductionCapRate: DecimalString;
  deductionCapAmount: DecimalString;
  deductionCapPassed: boolean;
  variableShareRate: DecimalString;
  variableShareCapRate: DecimalString;
  variableShareCapAmount: DecimalString;
  variableSharePassed: boolean;
  bankAccountRef?: string;
  createdAt: string;
}

export interface PayrollRun {
  id: Uuid;
  cycleId: Uuid;
  periodStart: string;
  periodEnd: string;
  currency: string;
  status:
    | "DRAFT"
    | "CALCULATED"
    | "BLOCKED"
    | "APPROVED"
    | "PAID"
    | "REVERSED"
    | "CANCELLED";
  preparedBy: Uuid;
  approvedBy?: Uuid;
  paidAt?: string;
  totalGross: DecimalString;
  totalDeductions: DecimalString;
  totalTax: DecimalString;
  totalSocialInsurance: DecimalString;
  totalNet: DecimalString;
  blockedCount: number;
  reversedBy?: Uuid;
  reversalReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  lines?: PayrollLine[];
}

export interface EmploymentContract {
  id: Uuid;
  personId: Uuid;
  contractCode: string;
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACTOR";
  startDate: string;
  endDate?: string;
  workLocation: string;
  currency: string;
  fixedMonthlySalary: DecimalString;
  minimumMonthlyWage: DecimalString;
  taxRate: DecimalString;
  socialInsuranceRate: DecimalString;
  deductionCapRate: DecimalString;
  variableShareCapRate: DecimalString;
  bankAccountRef?: string;
  payPlanVersion: number;
  consentSignatureRef: string;
  consentSignedAt: string;
  status: "ACTIVE" | "ENDED";
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CnIitResult {
  cumulativeTaxableIncome: DecimalString;
  annualTaxDue: DecimalString;
  taxAlreadyWithheld: DecimalString;
  taxForPeriod: DecimalString;
  ratePercent: number;
  quickDeduction: DecimalString;
}

export interface EquityGrant {
  id: Uuid;
  personId: Uuid;
  grantCode: string;
  grantType: "OPTION" | "RSU" | "SAR";
  totalUnits: DecimalString;
  strikePrice: DecimalString;
  currency: string;
  grantDate: string;
  vestingStart: string;
  cliffMonths: number;
  vestingMonths: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EquityVesting {
  grantId: Uuid;
  asOf: string;
  vestedUnits: DecimalString;
  unvestedUnits: DecimalString;
  exercisedUnits: DecimalString;
  availableUnits: DecimalString;
  nextVestAt?: string;
  fullyVested: boolean;
}

export interface EquityExercise {
  id: Uuid;
  grantId: Uuid;
  personId: Uuid;
  units: DecimalString;
  strikePrice: DecimalString;
  totalCost: DecimalString;
  currency: string;
  status: string;
  requestedBy: Uuid;
  approvedBy?: Uuid;
  settledAt?: string;
  createdAt: string;
}

export interface Bounty {
  id: Uuid;
  title: string;
  description: string;
  rewardAmount: DecimalString;
  currency: string;
  status: "OPEN" | "CLAIMED" | "SUBMITTED" | "ACCEPTED" | "CANCELLED";
  createdBy: Uuid;
  dueAt?: string;
  assigneePersonId?: Uuid;
  claimedAt?: string;
  submissionRef?: string;
  submittedAt?: string;
  acceptedBy?: Uuid;
  acceptedAt?: string;
  paymentRef?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface IntegrationConnection {
  id: Uuid;
  provider: string;
  connectionName: string;
  credentialRef: string;
  status: string;
  config: Record<string, unknown>;
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationMapping {
  id: Uuid;
  connectionId: Uuid;
  name: string;
  mappingType: "CSV" | "HTTP_JSON";
  sourceSystem: string;
  targetType: string;
  fieldMap: Record<string, string>;
  config: Record<string, unknown>;
  version: number;
  status: "ACTIVE" | "RETIRED";
  createdAt: string;
  retiredAt?: string;
}

export interface SyncSchedule {
  id: Uuid;
  connectionId: Uuid;
  name: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRun {
  id: Uuid;
  connectionId: Uuid;
  status: string;
  cursorBefore?: Record<string, unknown>;
  cursorAfter?: Record<string, unknown>;
  recordsSeen: number;
  recordsUpserted: number;
  errorSummary?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface MappingPreset {
  code: string;
  name: string;
  provider?: string;
  mappingType?: "CSV" | "HTTP_JSON";
  sourceSystem?: string;
  targetType?: string;
  fieldMap: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface AiScoreProposal {
  id: Uuid;
  cycleId: Uuid;
  personId: Uuid;
  evaluationRunId: Uuid;
  modelPromptId?: Uuid;
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
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  requestedBy?: Uuid;
  decidedBy?: Uuid;
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
  createdAt: string;
}

export interface ModelPrompt {
  id: Uuid;
  promptCode: string;
  version: number;
  purpose: string;
  modelProvider: string;
  modelName: string;
  template: string;
  templateHash: string;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  evaluationRunId?: Uuid;
  activatedAt?: string;
  retiredAt?: string;
  createdAt: string;
}

export interface PolicyApplicability {
  legalEntity: string;
  jurisdictions: string[];
  workLocations: string[];
  employeeCategories: string[];
  workTimeTypes: string[];
}

export interface PolicyVersionSummary {
  policyVersionId: Uuid;
  code: string;
  version: number;
  status: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  contentHash?: string;
  publishedAt?: string;
  applicability?: PolicyApplicability;
}

export interface PolicyTestCase {
  id: Uuid;
  policyVersionId: Uuid;
  caseCode: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  category: "NORMAL" | "BOUNDARY" | "EXCEPTION" | "HISTORICAL";
  status: string;
  lastRunAt?: string;
  lastRunPassed?: boolean;
  lastRunResultHash?: string;
  createdAt: string;
}

export interface PolicyReadinessReport {
  policyVersionId: Uuid;
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
      testCaseId: Uuid;
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
      noticeId: Uuid;
      acknowledgedCount: number;
      personCount: number;
      pendingCount: number;
      declinedCount: number;
    }>;
  };
  consultations: {
    total: number;
    concluded: number;
    latestOutcome?: string;
  };
  dpia: {
    referenced: boolean;
    status?: string;
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
  };
  claims: {
    total: number;
    confirmed: number;
    pending: number;
    rejected: number;
  };
  evidence: { total: number; workPackage: number };
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
  dsars?: { total: number; open: number; overdue: number };
  appeals?: {
    total: number;
    open: number;
    overdue: number;
    closed: number;
    appealRate: number;
  };
  [key: string]: unknown;
}

export interface PolicyReviewReport {
  from: string;
  to: string;
  generatedAt: string;
  policies: { published: number; versionsInScope: number };
  notices: { total: number; complete: number; incomplete: number };
  appeals: {
    total: number;
    open: number;
    overdue: number;
    closed: number;
    outcomes: Record<string, number>;
  };
  claims: { total: number; decided: number };
  evaluations: { drafts: number; decisions: number };
  aiReview: {
    total: number;
    decided: number;
    accepted: number;
    acceptanceRate: number;
    overrides: number;
    blindReviews: number;
    harnessEvaluations: number;
  };
  dataQuality: {
    total: number;
    open: number;
    overdue: number;
    escalated: number;
  };
  privacy: {
    dsars: number;
    openDsars: number;
    dpias: number;
    approvedDpias: number;
  };
  trustSurvey: { available: boolean; note: string };
  subgroupImpact: { available: boolean; note: string };
}

export interface AuditEvent {
  id: Uuid;
  sequence: number;
  actorType: "USER" | "AGENT" | "SYSTEM" | "INTEGRATION";
  actorId?: Uuid;
  action: string;
  objectType: string;
  objectId?: Uuid;
  reason?: string;
  occurredAt: string;
  [key: string]: unknown;
}

export interface LedgerEntry {
  id: Uuid;
  personId: Uuid;
  cycleId: Uuid;
  calculationRunId: Uuid;
  calculationLineId?: Uuid;
  entryType: "INCENTIVE" | "ADJUSTMENT" | "REVERSAL" | "RECOVERY";
  currency: string;
  amount: DecimalString;
  status: "PROVISIONAL" | "APPROVED" | "LOCKED" | "REVERSED";
  sourceEntryId?: Uuid;
  idempotencyKey: string;
  entryHash: string;
  prevHash: string;
  createdAt: string;
  lockedAt?: string;
  [key: string]: unknown;
}

export interface PlatformPerson {
  id: Uuid;
  tenantId: Uuid;
  employeeCode: string;
  displayName: string;
  employmentStatus?: string;
  userId?: Uuid;
  managerPersonId?: Uuid;
  createdAt: string;
}

export interface PlatformIdentity {
  userId: Uuid;
  personId?: Uuid;
  roles: string[];
}

export interface DpiaRecord {
  id: Uuid;
  assessmentType: string;
  scope: string;
  status: string;
  approvedBy?: Uuid;
  approvedAt?: string;
  createdAt: string;
}

export interface DsarRequest {
  id: Uuid;
  personId: Uuid;
  requestType: string;
  status: string;
  receivedAt: string;
  dueAt?: string;
  resolvedAt?: string;
  createdAt: string;
}

export type DataClassification =
  | "PUBLIC"
  | "INTERNAL"
  | "CONFIDENTIAL"
  | "PERSONAL"
  | "SENSITIVE";

export interface DataSourceField {
  fieldName: string;
  classification: DataClassification;
  purpose: string;
  retentionMonths?: number;
}

export interface DataSource {
  id: Uuid;
  code: string;
  name: string;
  category: string;
  ownerPersonId: Uuid;
  backupOwnerPersonId?: Uuid;
  slaHours: number;
  criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
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

export interface DataMapReport {
  generatedAt: string;
  summary: {
    sources: number;
    activeSources: number;
    personalSources: number;
    crossBorderSources: number;
    processors: string[];
    fields: number;
    classifications: Record<string, number>;
    categories: Record<string, number>;
    overdueReviews: number;
    retentionPolicies: number;
    approvedDpias: number;
    openDataRequests: number;
  };
  sources: Array<DataSource & { reviewDueAt: string; reviewOverdue: boolean }>;
  retentionPolicies: RetentionPolicy[];
}

export interface RetentionPolicy {
  id: Uuid;
  dataCategory: string;
  retentionMonths: number;
  legalBasis: string;
  legalHold: boolean;
  createdAt: string;
}

export interface EvaluationDraft {
  id: Uuid;
  cycleId: Uuid;
  personId: Uuid;
  generatedByType: "AGENT" | "USER" | "SYSTEM";
  generatedById?: Uuid;
  modelProvider?: string;
  modelName?: string;
  promptVersion?: string;
  agentTaskId?: Uuid;
  evidenceSnapshotHash: string;
  draftPayload: Record<string, unknown>;
  strengths: string[];
  counterEvidence: string[];
  missingInformation: string[];
  uncertainty: Record<string, unknown>;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationDecision {
  id: Uuid;
  cycleId: Uuid;
  personId: Uuid;
  decisionVersion: number;
  status: "APPROVED" | "SUPERSEDED" | "WITHDRAWN";
  rubricVersionId: Uuid;
  evidenceSnapshotHash: string;
  scores: Record<string, number>;
  rationale: string;
  reviewerPersonId: Uuid;
  approvedAt?: string;
  supersedesId?: Uuid;
  createdAt: string;
}

export interface Rubric {
  id: Uuid;
  code: string;
  name: string;
  dimensions: string[];
  scoringAnchors: Record<string, unknown>;
  scope: Record<string, unknown>;
  status: string;
  version: number;
  effectiveFrom: string;
}

export interface CycleReadinessReport {
  cycleId: Uuid;
  generatedAt: string;
  readyForSettlement: boolean;
  calculations: {
    total: number;
    byStatus: Record<string, number>;
    formal: number;
    formalLocked: number;
    runs: Array<{
      runId: Uuid;
      status: string;
      mode: string;
      policyVersionId: Uuid;
      blockers: string[];
    }>;
  };
  legalGates: Array<{
    policyVersionId: Uuid;
    recorded: boolean;
    blockers: string[];
  }>;
  settlement: {
    total: number;
    byStatus: Record<string, number>;
    exported: number;
    acknowledged: number;
    batches: Array<{
      batchId: Uuid;
      status: string;
      kind: string;
      exportedAt?: string;
      acknowledgedAt?: string;
    }>;
  };
  budgets: { pools: number; approved: number };
  blockers: string[];
}

export interface WorkPackageMember {
  personId: Uuid;
  responsibilityCode: string;
  expectedOutput: string;
}

export interface WorkPackage {
  id: Uuid;
  title: string;
  objective: string;
  ownerPersonId: Uuid;
  status: string;
  acceptanceCriteria: string[];
  members: WorkPackageMember[];
  dueAt?: string;
  commitmentSnapshot?: {
    snapshotId: Uuid;
    capturedAt: string;
    contentHash: string;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContributionClaim {
  id: Uuid;
  workPackageId: Uuid;
  claimantPersonId: Uuid;
  claimType: string;
  claimedContribution: {
    dimensions: string[];
    summary: string;
  };
  evidenceRefs: Uuid[];
  rationale: string;
  status: string;
  submittedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttributionDecision {
  id: Uuid;
  claimId: Uuid;
  decisionVersion: number;
  status: string;
  adjudicatorPersonId: Uuid;
  acceptedFacts: string[];
  rejectedFacts: string[];
  contributionDimensions: Record<string, number>;
  rationale: string;
  confidenceBand?: string;
  effectiveAt: string;
  supersedesId?: Uuid;
  createdAt: string;
}

export interface SettlementLine {
  id: Uuid;
  batchId: Uuid;
  ledgerId: Uuid;
  personId: Uuid;
  personCode?: string;
  personName?: string;
  amount: DecimalString;
  currency: string;
  status: string;
  active: boolean;
  createdAt: string;
}

export interface SettlementBatch {
  id: Uuid;
  cycleId: Uuid;
  batchNo: string;
  status: string;
  kind: "STANDARD" | "RECOVERY";
  currency: string;
  totalAmount: DecimalString;
  lineCount: number;
  approvedBy?: Uuid;
  approvedAt?: string;
  lockedAt?: string;
  exportedAt?: string;
  acknowledgedAt?: string;
  externalReference?: string;
  createdAt: string;
  updatedAt: string;
  lines?: SettlementLine[];
}

export interface SettlementCommandResult {
  batch: SettlementBatch;
  csv?: string;
}

export interface BudgetPool {
  id: Uuid;
  cycleId: Uuid;
  code: string;
  name: string;
  poolType: string;
  currency: string;
  approvedAmount: DecimalString;
  committedAmount: DecimalString;
  status: string;
  approvedBy?: Uuid;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  allocations?: BudgetAllocation[];
}

export interface BudgetAllocation {
  id: Uuid;
  budgetPoolId: Uuid;
  targetType: string;
  targetId: Uuid;
  amount: DecimalString;
  status: string;
  createdAt: string;
}

export interface DataQualityIssue {
  id: Uuid;
  objectType: string;
  objectId: Uuid;
  issueCode: string;
  severity: "INFO" | "WARNING" | "BLOCKING";
  status: string;
  assignedTo?: Uuid;
  details: Record<string, unknown>;
  dueAt?: string;
  escalatedAt?: string;
  escalationReason?: string;
  waiverReason?: string;
  waivedBy?: Uuid;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface AppealCase {
  id: Uuid;
  appellantPersonId: Uuid;
  targetType: string;
  targetId: Uuid;
  reasonCode: string;
  statement: string;
  evidenceRefs?: Uuid[];
  status: string;
  reviewerPersonId?: Uuid;
  resolution?: string;
  dueAt?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ModelEvaluationRun {
  id: Uuid;
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

export interface AiReviewMetrics {
  total: number;
  pending: number;
  decided: number;
  accepted: number;
  rejected: number;
  acceptanceRate: number;
  overrideCount: number;
  overrideRate: number;
  blindReviewCount: number;
  averageReviewDurationSeconds: number;
  averageEvidenceOpened: number;
  rubberStampAlert: boolean;
}

export type AdverseActionType =
  | "PIP"
  | "TRAINING"
  | "REASSIGNMENT"
  | "DEMOTION"
  | "PAY_REDUCTION"
  | "TERMINATION";

export interface AdverseActionCase {
  id: Uuid;
  personId: Uuid;
  actionType: AdverseActionType;
  status: string;
  reason: string;
  performanceBasis: string;
  evidenceRefs: Uuid[];
  requestedBy: Uuid;
  legalReviewerId?: Uuid;
  legalReviewRef?: string;
  legalReviewedAt?: string;
  approvedBy?: Uuid;
  approvedAt?: string;
  effectiveFrom?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
