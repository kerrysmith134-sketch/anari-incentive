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
  | "LEDGER";

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

export interface PublishedPolicy {
  policyVersionId: UUID;
  policy: PolicyDefinition;
  contentHash: string;
  effectiveFrom: string;
  publishedAt: string;
  approvedBy: UUID;
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

export interface SettlementLine {
  id: UUID;
  tenantId: UUID;
  batchId: UUID;
  ledgerId: UUID;
  personId: UUID;
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
  waiverReason?: string;
  waivedBy?: UUID;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}
