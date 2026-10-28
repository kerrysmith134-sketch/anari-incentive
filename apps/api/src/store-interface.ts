import type {
  AmountLedgerEntry,
  AppealCase,
  AuditEvent,
  AttributionDecision,
  CalculationRun,
  CommitmentSnapshot,
  ConfirmationDecision,
  ConfirmationTargetType,
  ContributionClaim,
  DataQualityIssue,
  EmployeeConfirmation,
  EvidenceLink,
  EvaluationCycle,
  EvaluationDecision,
  EvaluationDraft,
  EvidenceNode,
  InAppNotification,
  IngestionBatch,
  IngestionResult,
  LegalGateRecord,
  PolicyDefinition,
  PolicyVersionSummary,
  PublishPolicyInput,
  PublishedPolicy,
  Rubric,
  SettlementBatch,
  SettlementCommandInput,
  SettlementCommandResult,
  SettlementLine,
  WorkPackage,
} from "@anari/domain";
import type {
  CreateAttributionDecisionInput,
  CreateCalculationRunInput,
  CreateContributionClaimInput,
  CreateEvidenceInput,
  CreateEvidenceLinkInput,
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
  /** Optional dependency check used by /ready. */
  ping?(): Promise<void>;
  getPolicy(policyVersionId: string): Promise<PolicyDefinition>;
  listPolicyVersions(): Promise<PolicyVersionSummary[]>;
  publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy>;

  createWorkPackage(input: CreateWorkPackageInput): Promise<WorkPackage>;
  getWorkPackage(id: string): Promise<WorkPackage>;
  listWorkPackages(): Promise<WorkPackage[]>;
  commitWorkPackage(id: string, expectedVersion: number): Promise<WorkPackage>;
  listWorkPackageVersions(id: string): Promise<CommitmentSnapshot[]>;
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
  listClaims(): Promise<ContributionClaim[]>;
  submitClaim(id: string): Promise<ContributionClaim>;
  createAttributionDecision(
    input: CreateAttributionDecisionInput,
  ): Promise<AttributionDecision>;
  listDecisions(claimId?: string): Promise<AttributionDecision[]>;

  recordLegalGate(input: RecordLegalGateInput): Promise<LegalGateRecord>;
  getLegalGate(policyVersionId: string): Promise<LegalGateRecord | undefined>;

  createEvidence(input: CreateEvidenceInput): Promise<EvidenceNode>;
  listEvidence(subjectType?: string, subjectId?: string): Promise<EvidenceNode[]>;
  linkEvidence(
    fromEvidenceId: string,
    input: CreateEvidenceLinkInput,
  ): Promise<EvidenceLink>;
  listEvidenceLinks(evidenceId: string): Promise<EvidenceLink[]>;
  ingestEvents(batch: IngestionBatch): Promise<IngestionResult>;

  createCalculationRun(
    input: CreateCalculationRunInput,
  ): Promise<CalculationRun>;
  createCalculationRunsBatch(
    inputs: CreateCalculationRunInput[],
  ): Promise<CalculationRun[]>;
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
    targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER" | "CALCULATION";
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
  reverseLedgerEntry(
    id: string,
    input: {
      idempotencyKey: string;
      reason: string;
      approvedBy: string;
    },
  ): Promise<AmountLedgerEntry>;
  listAuditEvents(limit?: number): Promise<AuditEvent[]>;
  verifyAuditChain(): Promise<boolean>;

  createEvaluationCycle(input: {
    name: string;
    cycleType: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    policyVersionId?: string;
    rubricVersionId?: string;
  }): Promise<EvaluationCycle>;
  getEvaluationCycle(id: string): Promise<EvaluationCycle>;
  listEvaluationCycles(): Promise<EvaluationCycle[]>;
  createRubric(input: {
    code: string;
    name: string;
    dimensions: string[];
    scoringAnchors: Record<string, unknown>;
    scope?: Record<string, unknown>;
    effectiveFrom: string;
  }): Promise<Rubric>;
  listRubrics(): Promise<Rubric[]>;
  createNotification(input: {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
  }): Promise<InAppNotification>;
  listNotifications(filter?: {
    recipientPersonId?: string;
    status?: string;
  }): Promise<InAppNotification[]>;
  markNotificationRead(id: string): Promise<InAppNotification>;

  createEvaluationDraft(input: {
    cycleId: string;
    personId: string;
    generatedByType: "AGENT" | "USER" | "SYSTEM";
    generatedById?: string;
    modelProvider?: string;
    modelName?: string;
    promptVersion?: string;
    agentTaskId?: string;
    evidenceSnapshotHash: string;
    draftPayload: Record<string, unknown>;
    strengths?: string[];
    counterEvidence?: string[];
    missingInformation?: string[];
    uncertainty?: Record<string, unknown>;
  }): Promise<EvaluationDraft>;
  getEvaluationDraft(id: string): Promise<EvaluationDraft>;
  listEvaluationDrafts(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<EvaluationDraft[]>;
  submitEvaluationDraft(id: string): Promise<EvaluationDraft>;
  decideEvaluationDraft(
    id: string,
    input: {
      reviewerPersonId: string;
      rubricVersionId: string;
      decision: "APPROVE" | "REJECT";
      scores: Record<string, number>;
      rationale: string;
    },
  ): Promise<{ draft: EvaluationDraft; decision?: EvaluationDecision }>;
  listEvaluationDecisions(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<EvaluationDecision[]>;
  getEvaluationDecision(id: string): Promise<EvaluationDecision>;

  createDataQualityIssue(input: {
    objectType: string;
    objectId: string;
    issueCode: string;
    severity: "INFO" | "WARNING" | "BLOCKING";
    details?: Record<string, unknown>;
    assignedTo?: string;
  }): Promise<DataQualityIssue>;
  getDataQualityIssue(id: string): Promise<DataQualityIssue>;
  listDataQualityIssues(filter?: {
    status?: string;
  }): Promise<DataQualityIssue[]>;
  commandDataQualityIssue(
    id: string,
    input: {
      command: "ASSIGN" | "START" | "RESOLVE" | "WAIVE" | "REOPEN";
      assignedTo?: string;
      actorPersonId?: string;
      reason?: string;
    },
  ): Promise<DataQualityIssue>;

  createSettlementBatch(input: {
    cycleId: string;
    currency?: string;
    batchNo?: string;
  }): Promise<SettlementBatch>;
  getSettlementBatch(id: string): Promise<SettlementBatch>;
  listSettlementBatches(): Promise<SettlementBatch[]>;
  listSettlementLines(batchId: string): Promise<SettlementLine[]>;
  commandSettlementBatch(
    id: string,
    input: SettlementCommandInput,
  ): Promise<SettlementCommandResult>;
}
