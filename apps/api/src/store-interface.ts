import type {
  AmountLedgerEntry,
  AppealCase,
  AttributionDecision,
  CalculationRun,
  ConfirmationDecision,
  ConfirmationTargetType,
  ContributionClaim,
  EmployeeConfirmation,
  LegalGateRecord,
  PolicyDefinition,
  WorkPackage,
} from "@anari/domain";
import type {
  CreateAttributionDecisionInput,
  CreateCalculationRunInput,
  CreateContributionClaimInput,
  CreateWorkPackageInput,
} from "@anari/contracts";

export interface RecordLegalGateInput {
  policyVersionId: string;
  democraticProcedureRef?: string;
  employeeNoticeRef?: string;
  dataProtectionAssessmentRef?: string;
  minimumWageChecked: boolean;
  policyApproved: boolean;
  recordedBy: string;
}

export interface RecordConfirmationInput {
  personId: string;
  targetType: ConfirmationTargetType;
  targetId: string;
  decision: ConfirmationDecision;
  reason?: string;
}

export interface ResolveAppealInput {
  reviewerPersonId: string;
  resolution: "UPHOLD" | "CHANGE" | "REJECT";
  rationale: string;
}

export interface IncentiveStore {
  getPolicy(policyVersionId: string): Promise<PolicyDefinition>;

  createWorkPackage(input: CreateWorkPackageInput): Promise<WorkPackage>;
  getWorkPackage(id: string): Promise<WorkPackage>;
  listWorkPackages(): Promise<WorkPackage[]>;
  commitWorkPackage(id: string, expectedVersion: number): Promise<WorkPackage>;
  startWorkPackage(id: string): Promise<WorkPackage>;
  submitWorkPackage(id: string): Promise<WorkPackage>;
  acceptWorkPackage(id: string, reviewerPersonId: string): Promise<WorkPackage>;
  rejectWorkPackage(
    id: string,
    reviewerPersonId: string,
    reason: string,
  ): Promise<WorkPackage>;

  createClaim(input: CreateContributionClaimInput): Promise<ContributionClaim>;
  getClaim(id: string): Promise<ContributionClaim>;
  submitClaim(id: string): Promise<ContributionClaim>;
  createAttributionDecision(
    input: CreateAttributionDecisionInput,
  ): Promise<AttributionDecision>;
  listDecisions(claimId?: string): Promise<AttributionDecision[]>;

  recordLegalGate(input: RecordLegalGateInput): Promise<LegalGateRecord>;
  getLegalGate(policyVersionId: string): Promise<LegalGateRecord | undefined>;

  createCalculationRun(
    input: CreateCalculationRunInput,
  ): Promise<CalculationRun>;
  getRun(id: string): Promise<CalculationRun>;
  listRuns(): Promise<CalculationRun[]>;
  approveRun(id: string): Promise<CalculationRun>;
  lockRun(id: string, confirmation: string): Promise<CalculationRun>;

  recordConfirmation(
    input: RecordConfirmationInput,
  ): Promise<EmployeeConfirmation>;
  listConfirmations(personId?: string): Promise<EmployeeConfirmation[]>;

  createAppeal(input: {
    appellantPersonId: string;
    targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER";
    targetId: string;
    reasonCode: string;
    statement: string;
  }): Promise<AppealCase>;
  getAppeal(id: string): Promise<AppealCase>;
  listAppeals(): Promise<AppealCase[]>;
  triageAppeal(id: string, reviewerPersonId: string): Promise<AppealCase>;
  reviewAppeal(id: string): Promise<AppealCase>;
  resolveAppeal(id: string, input: ResolveAppealInput): Promise<AppealCase>;

  listLedger(tenantId?: string): Promise<AmountLedgerEntry[]>;
  verifyLedger(tenantId?: string): Promise<boolean>;
}
