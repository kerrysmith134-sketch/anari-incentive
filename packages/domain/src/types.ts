import type {
  AppealCaseStatus,
  AttributionDecisionStatus,
  CalculationRunStatus,
  ContributionClaimStatus,
  DataQualityIssueStatus,
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
}

export interface ParticipantInput {
  personId: UUID;
  workPackageId: UUID;
  /** Human-confirmed attribution weight, 0..1. Weights are normalised. */
  attributionWeight: DecimalString;
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
  /** Optional display guard; payroll compliance is still a separate gate. */
  minimumWage?: {
    monthlyMinimum: DecimalString;
    checked: boolean;
  };
}

export interface AppealCase {
  id: UUID;
  tenantId: UUID;
  appellantPersonId: UUID;
  targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER";
  targetId: UUID;
  reasonCode: string;
  statement: string;
  status: AppealCaseStatus;
  reviewerPersonId?: UUID;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface SettlementBatch {
  id: UUID;
  tenantId: UUID;
  cycleId: UUID;
  status: SettlementBatchStatus;
  currency: string;
  totalAmount: DecimalString;
  lineCount: number;
  approvedBy?: UUID;
  approvedAt?: string;
  lockedAt?: string;
  exportedAt?: string;
  acknowledgedAt?: string;
  createdAt: string;
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
  createdAt: string;
  resolvedAt?: string;
}
