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
  bankAccountRef?: string;
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

export interface PolicyVersionSummary {
  policyVersionId: Uuid;
  code: string;
  version: number;
  status: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  contentHash?: string;
  publishedAt?: string;
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
  [key: string]: unknown;
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
  currency: string;
  amount: DecimalString;
  status: string;
  entryType?: string;
  createdAt: string;
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

export interface RetentionPolicy {
  id: Uuid;
  dataCategory: string;
  retentionMonths: number;
  legalBasis: string;
  legalHold: boolean;
  createdAt: string;
}
