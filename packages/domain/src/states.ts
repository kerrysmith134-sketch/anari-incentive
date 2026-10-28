/**
 * Canonical state machines for N-Perform.
 *
 * This file is the single source of truth for state names and legal
 * transitions. API schemas, database CHECK constraints and tests must be
 * derived from or checked against these definitions.
 */

export const workPackageStatuses = [
  "DRAFT",
  "COMMITTED",
  "IN_PROGRESS",
  "BLOCKED",
  "SUBMITTED",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
  "REOPENED",
] as const;
export type WorkPackageStatus = (typeof workPackageStatuses)[number];

export const contributionClaimStatuses = [
  "DRAFT",
  "SUBMITTED",
  "NEEDS_EVIDENCE",
  "UNDER_REVIEW",
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "REJECTED",
  "APPEALED",
  "WITHDRAWN",
] as const;
export type ContributionClaimStatus =
  (typeof contributionClaimStatuses)[number];

export const attributionDecisionStatuses = [
  "DRAFT",
  "UNDER_REVIEW",
  "CONFIRMED",
  "PARTIALLY_CONFIRMED",
  "REJECTED",
  "APPEALED",
  "SUPERSEDED",
] as const;
export type AttributionDecisionStatus =
  (typeof attributionDecisionStatuses)[number];

export const evaluationDraftStatuses = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
] as const;
export type EvaluationDraftStatus =
  (typeof evaluationDraftStatuses)[number];

export const calculationRunStatuses = [
  "CREATED",
  "RUNNING",
  "CALCULATED",
  "BLOCKED",
  "NEEDS_REVIEW",
  "RECONCILIATION_REQUIRED",
  "APPROVED",
  "LOCKED",
  "REVERSED",
] as const;
export type CalculationRunStatus = (typeof calculationRunStatuses)[number];

export const settlementBatchStatuses = [
  "DRAFT",
  "RECONCILING",
  "PENDING_APPROVAL",
  "APPROVED",
  "LOCKED",
  "EXPORTED",
  "ACKNOWLEDGED",
  "CANCELLED",
  "ADJUSTMENT_REQUIRED",
] as const;
export type SettlementBatchStatus = (typeof settlementBatchStatuses)[number];

export const appealCaseStatuses = [
  "OPEN",
  "TRIAGED",
  "UNDER_REVIEW",
  "DECIDED",
  "RECALCULATION_REQUIRED",
  "CLOSED",
] as const;
export type AppealCaseStatus = (typeof appealCaseStatuses)[number];

export const dataQualityIssueStatuses = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "WAIVED_WITH_APPROVAL",
  "REOPENED",
] as const;
export type DataQualityIssueStatus =
  (typeof dataQualityIssueStatuses)[number];

export type TransitionMap<S extends string> = Record<S, readonly S[]>;

export const workPackageTransitions: TransitionMap<WorkPackageStatus> = {
  DRAFT: ["COMMITTED", "CANCELLED"],
  COMMITTED: ["IN_PROGRESS", "BLOCKED", "CANCELLED"],
  IN_PROGRESS: ["BLOCKED", "SUBMITTED", "CANCELLED"],
  BLOCKED: ["IN_PROGRESS", "CANCELLED"],
  SUBMITTED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: ["REOPENED"],
  CANCELLED: [],
  REOPENED: ["IN_PROGRESS", "SUBMITTED", "CANCELLED"],
};

export const contributionClaimTransitions: TransitionMap<ContributionClaimStatus> =
  {
    DRAFT: ["SUBMITTED", "WITHDRAWN"],
    SUBMITTED: ["UNDER_REVIEW", "NEEDS_EVIDENCE", "WITHDRAWN"],
    NEEDS_EVIDENCE: ["SUBMITTED", "WITHDRAWN"],
    UNDER_REVIEW: ["ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED"],
    ACCEPTED: ["APPEALED"],
    PARTIALLY_ACCEPTED: ["APPEALED"],
    REJECTED: ["APPEALED"],
    APPEALED: ["UNDER_REVIEW"],
    WITHDRAWN: [],
  };

export const attributionDecisionTransitions: TransitionMap<AttributionDecisionStatus> =
  {
    DRAFT: ["UNDER_REVIEW"],
    UNDER_REVIEW: ["CONFIRMED", "PARTIALLY_CONFIRMED", "REJECTED"],
    CONFIRMED: ["APPEALED", "SUPERSEDED"],
    PARTIALLY_CONFIRMED: ["APPEALED", "SUPERSEDED"],
    REJECTED: ["APPEALED", "SUPERSEDED"],
    APPEALED: ["UNDER_REVIEW", "SUPERSEDED"],
    SUPERSEDED: [],
  };

export const evaluationDraftTransitions: TransitionMap<EvaluationDraftStatus> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

export const calculationRunTransitions: TransitionMap<CalculationRunStatus> = {
  CREATED: ["RUNNING", "BLOCKED"],
  RUNNING: ["CALCULATED", "BLOCKED", "NEEDS_REVIEW"],
  BLOCKED: ["RUNNING", "NEEDS_REVIEW"],
  NEEDS_REVIEW: ["RUNNING", "BLOCKED"],
  CALCULATED: ["RECONCILIATION_REQUIRED", "APPROVED"],
  RECONCILIATION_REQUIRED: ["CALCULATED", "BLOCKED"],
  APPROVED: ["LOCKED"],
  LOCKED: ["REVERSED"],
  REVERSED: [],
};

export const settlementBatchTransitions: TransitionMap<SettlementBatchStatus> = {
  DRAFT: ["RECONCILING", "CANCELLED"],
  RECONCILING: ["PENDING_APPROVAL", "ADJUSTMENT_REQUIRED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["LOCKED"],
  LOCKED: ["EXPORTED"],
  EXPORTED: ["ACKNOWLEDGED", "ADJUSTMENT_REQUIRED"],
  ACKNOWLEDGED: [],
  CANCELLED: [],
  ADJUSTMENT_REQUIRED: ["RECONCILING"],
};

export const appealCaseTransitions: TransitionMap<AppealCaseStatus> = {
  OPEN: ["TRIAGED"],
  TRIAGED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["DECIDED"],
  DECIDED: ["RECALCULATION_REQUIRED", "CLOSED"],
  RECALCULATION_REQUIRED: ["CLOSED"],
  CLOSED: [],
};

export const dataQualityIssueTransitions: TransitionMap<DataQualityIssueStatus> =
  {
    OPEN: ["ASSIGNED", "RESOLVED", "WAIVED_WITH_APPROVAL"],
    ASSIGNED: ["IN_PROGRESS", "WAIVED_WITH_APPROVAL"],
    IN_PROGRESS: ["RESOLVED", "WAIVED_WITH_APPROVAL"],
    RESOLVED: ["REOPENED"],
    WAIVED_WITH_APPROVAL: ["REOPENED"],
    REOPENED: ["ASSIGNED", "IN_PROGRESS"],
  };

export class InvalidStateTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION";

  constructor(
    readonly objectType: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid ${objectType} transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

export function canTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
): boolean {
  return map[from].includes(to);
}

export function assertTransition<S extends string>(
  map: TransitionMap<S>,
  objectType: string,
  from: S,
  to: S,
): void {
  if (!canTransition(map, from, to)) {
    throw new InvalidStateTransitionError(objectType, from, to);
  }
}

export function isTerminal<S extends string>(
  map: TransitionMap<S>,
  state: S,
): boolean {
  return map[state].length === 0;
}
