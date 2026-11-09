import type {
  AdjustmentRecord,
  AmountLedgerEntry,
  AppealCase,
  AuditEvent,
  AttributionDecision,
  CalculationRun,
  CommitmentSnapshot,
  ConfirmationDecision,
  ConfirmationTargetType,
  ContributionAttestation,
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
  PolicyVersionDetail,
  PolicyVersionSummary,
  PublishPolicyInput,
  PublishedPolicy,
  RecalculationRequest,
  RecalculationStatus,
  RecalculationTargetType,
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
  CreateContributionAttestationBody,
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
  getPolicyVersion(policyVersionId: string): Promise<PolicyVersionDetail>;
  listPolicyVersions(): Promise<PolicyVersionSummary[]>;
  publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy>;

  createWorkPackage(input: CreateWorkPackageInput): Promise<WorkPackage>;
  getWorkPackage(id: string): Promise<WorkPackage>;
  listWorkPackages(): Promise<WorkPackage[]>;
  commitWorkPackage(id: string, expectedVersion: number): Promise<WorkPackage>;
  listWorkPackageVersions(id: string): Promise<CommitmentSnapshot[]>;
  startWorkPackage(id: string, expectedVersion?: number): Promise<WorkPackage>;
  submitWorkPackage(id: string, expectedVersion?: number): Promise<WorkPackage>;
  acceptWorkPackage(
    id: string,
    reviewerPersonId: string,
    expectedVersion?: number,
  ): Promise<WorkPackage>;
  acceptWorkPackagesBatch(
    items: Array<{ id: string; reviewerPersonId: string }>,
  ): Promise<WorkPackage[]>;
  rejectWorkPackage(
    id: string,
    reviewerPersonId: string,
    reason: string,
    expectedVersion?: number,
  ): Promise<WorkPackage>;

  createClaim(input: CreateContributionClaimInput): Promise<ContributionClaim>;
  getClaim(id: string): Promise<ContributionClaim>;
  listClaims(): Promise<ContributionClaim[]>;
  submitClaim(id: string): Promise<ContributionClaim>;
  createContributionAttestation(
    input: CreateContributionAttestationBody,
  ): Promise<ContributionAttestation>;
  listContributionAttestations(filter?: {
    workPackageId?: string;
    subjectPersonId?: string;
  }): Promise<ContributionAttestation[]>;
  withdrawContributionAttestation(
    id: string,
    requesterPersonId: string,
  ): Promise<ContributionAttestation>;
  createAttributionDecision(
    input: CreateAttributionDecisionInput,
  ): Promise<AttributionDecision>;
  createAttributionDecisionsBatch(
    inputs: CreateAttributionDecisionInput[],
  ): Promise<AttributionDecision[]>;
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
    evidenceRefs?: string[];
    dueAt?: string;
  }): Promise<AppealCase>;
  getAppeal(id: string): Promise<AppealCase>;
  listAppeals(): Promise<AppealCase[]>;
  triageAppeal(id: string, reviewerPersonId: string): Promise<AppealCase>;
  reviewAppeal(id: string): Promise<AppealCase>;
  resolveAppeal(id: string, input: ResolveAppealInput): Promise<AppealCase>;

  createRecalculationRequest(input: {
    targetType: RecalculationTargetType;
    targetId: string;
    reasonCode: string;
    explanation: string;
    requestedBy: string;
  }): Promise<RecalculationRequest>;
  getRecalculationRequest(id: string): Promise<RecalculationRequest>;
  listRecalculationRequests(filter?: {
    status?: RecalculationStatus;
    targetType?: RecalculationTargetType;
  }): Promise<RecalculationRequest[]>;
  approveRecalculationRequest(
    id: string,
    approvedBy: string,
  ): Promise<RecalculationRequest>;
  rejectRecalculationRequest(
    id: string,
    reviewedBy: string,
  ): Promise<RecalculationRequest>;
  completeRecalculationRequest(
    id: string,
    newCalculationRunId: string,
  ): Promise<RecalculationRequest>;

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
  adjustLedgerEntry(
    id: string,
    input: {
      amount: string;
      reasonCode: string;
      explanation: string;
      approvedBy: string;
      idempotencyKey: string;
      entryType?: "ADJUSTMENT" | "REVERSAL";
    },
  ): Promise<{ entry: AmountLedgerEntry; record: AdjustmentRecord }>;
  listAdjustmentRecords(): Promise<AdjustmentRecord[]>;
  listAuditEvents(limit?: number): Promise<AuditEvent[]>;
  verifyAuditChain(): Promise<boolean>;
  /** Append a governance/security audit event (settings and policy writes). */
  recordAuditEvent(input: {
    actorType: "USER" | "AGENT" | "SYSTEM" | "INTEGRATION";
    actorId?: string;
    action: string;
    objectType: string;
    objectId?: string;
    beforeHash?: string;
    afterHash?: string;
    reason?: string;
  }): Promise<void>;

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
    audience?: string;
    status?: string;
  }): Promise<InAppNotification[]>;
  markNotificationRead(id: string): Promise<InAppNotification>;

  advanceEvaluationCycle(
    id: string,
    input: { status: string; reason?: string; actorPersonId?: string },
  ): Promise<EvaluationCycle>;
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
      independentScores: Record<string, number>;
      independentRationale: string;
      evidenceOpened?: number;
      reviewStartedAt?: string;
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
    dueAt?: string;
  }): Promise<DataQualityIssue>;
  getDataQualityIssue(id: string): Promise<DataQualityIssue>;
  listDataQualityIssues(filter?: {
    status?: string;
  }): Promise<DataQualityIssue[]>;
  commandDataQualityIssue(
    id: string,
    input: {
      command:
        | "ASSIGN"
        | "START"
        | "RESOLVE"
        | "WAIVE"
        | "REOPEN"
        | "ESCALATE";
      assignedTo?: string;
      actorPersonId?: string;
      reason?: string;
    },
  ): Promise<DataQualityIssue>;

  createSettlementBatch(input: {
    cycleId: string;
    kind?: "STANDARD" | "RECOVERY";
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
