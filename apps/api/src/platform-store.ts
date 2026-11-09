import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  divRound,
  formatDecimal,
  parseDecimal,
  sha256,
} from "@anari/policy-dsl";
import type {
  Acceptance,
  AdverseActionCase,
  AiScoreProposal,
  AiSuggestionLog,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRiskTier,
  ApprovalStatus,
  AuditRedaction,
  BudgetAllocation,
  BudgetPool,
  Bounty,
  BreakGlassGrant,
  CashGateInput,
  ClawbackCase,
  CompensationTemplate,
  ConsultationOutcome,
  ConflictDeclaration,
  ConsultationType,
  DataSource,
  DataSourceField,
  Deliverable,
  DpiaAssessmentType,
  DiscretionaryPoolReview,
  DpiaRecord,
  DsarRequest,
  DsarRequestType,
  EmployeeNotice,
  EmployeeRepresentation,
  EmploymentContract,
  ESignEnvelope,
  EmploymentContractAmendment,
  EquityExercise,
  EquityGrant,
  EquityVesting,
  ExternalIdentity,
  FairnessCommitment,
  FinancialFact,
  CalibrationSession,
  ManagerTrainingRecord,
  IntegrationConnection,
  IntegrationMapping,
  InboxMessage,
  MetricDefinition,
  ModelCanaryRun,
  ModelEvaluationDataset,
  ModelEvaluationRun,
  ModelRedTeamRun,
  ModelPrompt,
  ModelProviderPolicy,
  PolicyEngineRecord,
  IncentiveAwardBatch,
  IncentiveAwardType,
  NoticeAcknowledgementOverview,
  NoticeType,
  PlatformIdentity,
  PlatformMembership,
  PlatformOrgAssignment,
  PlatformOrgNode,
  PlatformPerson,
  PlatformTenant,
  PlatformUser,
  SubscriptionPlan,
  TenantInvoice,
  TenantInvoiceLineItem,
  TenantInvoiceStatus,
  TenantSubscription,
  TenantSubscriptionStatus,
  PayrollLine,
  PayrollRun,
  PilotEnrollment,
  PolicyAcknowledgement,
  PolicyConsultation,
  PolicyNotice,
  PolicyTestCase,
  PolicyTestRun,
  RepresentationBodyType,
  AppealEvidenceDisclosure,
  RetentionDisposalRequest,
  RetentionPolicy,
  WorkforceSubgroupAttribute,
  WorkforceSubgroupDimension,
  RuleChangeOrder,
  SettlementAcknowledgement,
  SettlementExport,
  SyncSchedule,
  StrategicPoolCase,
  SyncRun,
  TrustSurveyQuestion,
  TrustSurveyReport,
  TrustSurveyResponse,
  TrustSurveyRun,
  WebhookInboxMessage,
  WorkflowRun,
} from "@anari/domain";
import { adverseActionTransitions, assertTransition } from "@anari/domain";
import { ConflictError, NotFoundError } from "./store.js";

/** Format a 1e6-scaled decimal as a fixed 2-decimal money string. */
const formatInvoiceAmount = (value: bigint): string => {
  const rounded = divRound(value, 10_000n);
  const negative = rounded < 0n;
  const abs = (negative ? -rounded : rounded).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`;
};

export interface PlatformStore {
  createTenant(input: {
    name: string;
    slug: string;
    defaultTimezone?: string;
    defaultCurrency?: string;
  }): Promise<PlatformTenant>;
  listTenants(): Promise<PlatformTenant[]>;
  getTenant(tenantId: string): Promise<PlatformTenant>;
  updateTenantSettings(input: {
    tenantId: string;
    settings: Record<string, unknown>;
  }): Promise<PlatformTenant>;
  createUser(input: {
    authSubject: string;
    displayName: string;
    email?: string;
  }): Promise<PlatformUser>;
  findUserByAuthSubject(authSubject: string): Promise<PlatformUser | null>;
  listMembershipsByUser(userId: string): Promise<PlatformMembership[]>;
  setUserPassword(userId: string, passwordHash: string): Promise<void>;
  getUserPasswordHash(userId: string): Promise<string | null>;
  getUserPasswordHashByEmail(email: string): Promise<
    { userId: string; passwordHash: string | null } | null
  >;
  listUsers(): Promise<PlatformUser[]>;
  addMembership(input: {
    tenantId: string;
    userId: string;
    roleCodes: string[];
  }): Promise<PlatformMembership>;
  listMemberships(tenantId: string): Promise<PlatformMembership[]>;
  createPerson(input: {
    tenantId: string;
    employeeCode: string;
    displayName: string;
    employmentStatus?: string;
    userId?: string;
  }): Promise<PlatformPerson>;
  listPersons(tenantId: string): Promise<PlatformPerson[]>;
  createSubscriptionPlan(input: {
    code: string;
    name: string;
    description?: string;
    monthlyPrice: string;
    currency: string;
    seatLimit: number;
    trialDays: number;
    features: string[];
    active?: boolean;
  }): Promise<SubscriptionPlan>;
  listSubscriptionPlans(activeOnly?: boolean): Promise<SubscriptionPlan[]>;
  setTenantSubscription(input: {
    tenantId: string;
    planCode: string;
    status: TenantSubscriptionStatus;
    seats: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    trialEndsAt?: string;
    cancelReason?: string;
  }): Promise<TenantSubscription>;
  getTenantSubscription(
    tenantId: string,
  ): Promise<TenantSubscription | null>;
  createInvoice(input: {
    tenantId: string;
    lineItems: TenantInvoiceLineItem[];
    periodStart?: string;
    periodEnd?: string;
    dueDate?: string;
  }): Promise<TenantInvoice>;
  listInvoices(tenantId: string): Promise<TenantInvoice[]>;
  setInvoiceStatus(input: {
    invoiceId: string;
    status: TenantInvoiceStatus;
  }): Promise<TenantInvoice>;
  createStrategicPoolCase(input: {
    tenantId: string;
    cycleId: string;
    poolAmount: string;
    capAmount: string;
    currency: string;
    budgetPoolId?: string;
    rationale: string;
    requestedBy: string;
  }): Promise<StrategicPoolCase>;
  listStrategicPoolCases(tenantId: string): Promise<StrategicPoolCase[]>;
  updateStrategicPoolCase(input: {
    tenantId: string;
    caseId: string;
    patch: Partial<Omit<StrategicPoolCase, "id" | "tenantId">>;
  }): Promise<StrategicPoolCase>;
  linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson>;
  /** Resolve the person and tenant roles behind a platform user. */
  resolveIdentity(input: {
    tenantId: string;
    userId: string;
    personId?: string;
  }): Promise<PlatformIdentity>;
  createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
    externalId?: string;
  }): Promise<PlatformOrgNode>;
  listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]>;
  assignPersonOrg(input: {
    tenantId: string;
    personId: string;
    orgNodeId: string;
    validFrom: string;
    validTo?: string;
    allocation?: string;
  }): Promise<PlatformOrgAssignment>;
  listOrgAssignments(
    tenantId: string,
    personId?: string,
  ): Promise<PlatformOrgAssignment[]>;
  setPersonManager(input: {
    tenantId: string;
    personId: string;
    managerPersonId: string | null;
  }): Promise<PlatformPerson>;
  createNotice(input: {
    tenantId: string;
    noticeType: NoticeType;
    title: string;
    bodyRef: string;
    policyVersionId?: string;
    publishedAt?: string;
    effectiveFrom: string;
    acknowledgementRequired: boolean;
  }): Promise<EmployeeNotice>;
  listNotices(tenantId: string): Promise<EmployeeNotice[]>;
  getNotice(tenantId: string, noticeId: string): Promise<EmployeeNotice>;
  recordAcknowledgement(input: {
    tenantId: string;
    noticeId: string;
    personId: string;
    decision: "ACKNOWLEDGE" | "DECLINE";
    signatureRef?: string;
    declineReason?: string;
  }): Promise<PolicyAcknowledgement>;
  listAcknowledgements(
    tenantId: string,
    noticeId: string,
  ): Promise<NoticeAcknowledgementOverview>;
  createRepresentation(input: {
    tenantId: string;
    bodyName: string;
    bodyType: RepresentationBodyType;
    jurisdiction: string;
  }): Promise<EmployeeRepresentation>;
  listRepresentations(tenantId: string): Promise<EmployeeRepresentation[]>;
  createConsultation(input: {
    tenantId: string;
    policyVersionId: string;
    representationId?: string;
    consultationType: ConsultationType;
    startedAt: string;
    endedAt?: string;
    minutesRef?: string;
    feedbackSummary?: string;
    outcome: ConsultationOutcome;
  }): Promise<PolicyConsultation>;
  listConsultations(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyConsultation[]>;
  getConsultation(
    tenantId: string,
    consultationId: string,
  ): Promise<PolicyConsultation>;
  concludeConsultation(input: {
    tenantId: string;
    consultationId: string;
    endedAt: string;
    outcome: ConsultationOutcome;
    minutesRef?: string;
    feedbackSummary?: string;
  }): Promise<PolicyConsultation>;
  createDpia(input: {
    tenantId: string;
    assessmentType: DpiaAssessmentType;
    scope: string;
    riskSummary?: Record<string, unknown>;
    mitigationSummary?: Record<string, unknown>;
  }): Promise<DpiaRecord>;
  listDpias(tenantId: string): Promise<DpiaRecord[]>;
  getDpia(tenantId: string, dpiaId: string): Promise<DpiaRecord>;
  approveDpia(input: {
    tenantId: string;
    dpiaId: string;
    approvedBy: string;
  }): Promise<DpiaRecord>;
  createDsar(input: {
    tenantId: string;
    personId: string;
    requestType: DsarRequestType;
    dueAt?: string;
  }): Promise<DsarRequest>;
  listDsars(tenantId: string, personId?: string): Promise<DsarRequest[]>;
  getDsar(tenantId: string, dsarId: string): Promise<DsarRequest>;
  resolveDsar(input: {
    tenantId: string;
    dsarId: string;
    resolution: "RESOLVED" | "REJECTED";
    resolutionRef: string;
  }): Promise<DsarRequest>;
  createRetentionPolicy(input: {
    tenantId: string;
    dataCategory: string;
    retentionMonths: number;
    legalBasis: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy>;
  listRetentionPolicies(tenantId: string): Promise<RetentionPolicy[]>;
  setRetentionLegalHold(input: {
    tenantId: string;
    retentionPolicyId: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy>;
  createRetentionDisposalRequest(input: {
    tenantId: string;
    retentionPolicyId: string;
    requestedBy: string;
    reason: string;
    scheduledFor?: string;
  }): Promise<RetentionDisposalRequest>;
  listRetentionDisposalRequests(
    tenantId: string,
  ): Promise<RetentionDisposalRequest[]>;
  approveRetentionDisposalRequest(input: {
    tenantId: string;
    requestId: string;
    approvedBy: string;
  }): Promise<RetentionDisposalRequest>;
  completeRetentionDisposalRequest(input: {
    tenantId: string;
    requestId: string;
    actorPersonId: string;
  }): Promise<RetentionDisposalRequest>;
  cancelRetentionDisposalRequest(input: {
    tenantId: string;
    requestId: string;
    actorPersonId: string;
    reason: string;
  }): Promise<RetentionDisposalRequest>;
  createAppealEvidenceDisclosure(input: {
    tenantId: string;
    appealId: string;
    disclosedBy: string;
    method: AppealEvidenceDisclosure["method"];
    evidenceRefs: string[];
    note?: string;
  }): Promise<AppealEvidenceDisclosure>;
  listAppealEvidenceDisclosures(
    tenantId: string,
    appealId: string,
  ): Promise<AppealEvidenceDisclosure[]>;
  recordWorkforceSubgroupAttribute(input: {
    tenantId: string;
    personId: string;
    dimension: WorkforceSubgroupDimension;
    value: string;
    consentRef: string;
    consentedAt: string;
    expiresAt?: string;
    recordedBy?: string;
  }): Promise<WorkforceSubgroupAttribute>;
  listWorkforceSubgroupAttributes(
    tenantId: string,
    filter?: {
      personId?: string;
      dimension?: WorkforceSubgroupDimension;
    },
  ): Promise<WorkforceSubgroupAttribute[]>;
  withdrawWorkforceSubgroupAttribute(input: {
    tenantId: string;
    personId: string;
    dimension: WorkforceSubgroupDimension;
  }): Promise<WorkforceSubgroupAttribute>;
  createDataSource(input: {
    tenantId: string;
    code: string;
    name: string;
    category: string;
    ownerPersonId: string;
    backupOwnerPersonId?: string;
    slaHours: number;
    criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    containsPersonalData: boolean;
    storageRegion: string;
    crossBorderTransfers: boolean;
    processorRefs: string[];
    fields: DataSourceField[];
    lastReviewedAt?: string;
  }): Promise<DataSource>;
  listDataSources(tenantId: string): Promise<DataSource[]>;
  getDataSource(tenantId: string, dataSourceId: string): Promise<DataSource>;
  retireDataSource(input: {
    tenantId: string;
    dataSourceId: string;
  }): Promise<DataSource>;
  createConflictDeclaration(input: {
    tenantId: string;
    personId: string;
    relatedPersonId: string;
    relationshipType: string;
    description: string;
  }): Promise<ConflictDeclaration>;
  listConflictDeclarations(
    tenantId: string,
    personId?: string,
  ): Promise<ConflictDeclaration[]>;
  revokeConflictDeclaration(input: {
    tenantId: string;
    declarationId: string;
    reason: string;
  }): Promise<ConflictDeclaration>;
  findConflictDeclaration(
    tenantId: string,
    personA: string,
    personB: string,
  ): Promise<ConflictDeclaration | undefined>;
  createTrustSurvey(input: {
    tenantId: string;
    code: string;
    period: string;
    title: string;
    questions: TrustSurveyQuestion[];
  }): Promise<TrustSurveyRun>;
  listTrustSurveys(tenantId: string): Promise<TrustSurveyRun[]>;
  getTrustSurvey(tenantId: string, surveyId: string): Promise<TrustSurveyRun>;
  openTrustSurvey(input: {
    tenantId: string;
    surveyId: string;
  }): Promise<TrustSurveyRun>;
  closeTrustSurvey(input: {
    tenantId: string;
    surveyId: string;
  }): Promise<TrustSurveyRun>;
  submitTrustSurveyResponse(input: {
    tenantId: string;
    surveyId: string;
    personId: string;
    scores: Record<string, number>;
  }): Promise<TrustSurveyResponse>;
  getTrustSurveyReport(
    tenantId: string,
    surveyId: string,
  ): Promise<TrustSurveyReport>;
  createFairnessCommitment(input: {
    tenantId: string;
    statement: string;
    ownerPersonId: string;
    channels: string[];
  }): Promise<FairnessCommitment>;
  listFairnessCommitments(tenantId: string): Promise<FairnessCommitment[]>;
  getActiveFairnessCommitment(
    tenantId: string,
  ): Promise<FairnessCommitment | undefined>;
  createManagerTrainingRecord(input: {
    tenantId: string;
    personId: string;
    trainingCode: string;
    title: string;
    completedAt: string;
    expiresAt?: string;
    evidenceRef?: string;
  }): Promise<ManagerTrainingRecord>;
  listManagerTrainingRecords(
    tenantId: string,
    personId?: string,
  ): Promise<ManagerTrainingRecord[]>;
  createCalibrationSession(input: {
    tenantId: string;
    code: string;
    title: string;
    heldAt: string;
    facilitatorPersonId: string;
    attendeePersonIds: string[];
    policyVersionId?: string;
    notes?: string;
  }): Promise<CalibrationSession>;
  listCalibrationSessions(tenantId: string): Promise<CalibrationSession[]>;
  createCompensationTemplate(input: {
    tenantId: string;
    code: string;
    name: string;
    roleCode: string;
    employmentType: CompensationTemplate["employmentType"];
    currency: string;
    fixedSalaryMin: string;
    fixedSalaryMax: string;
    deductionCapRate: string;
    variableShareCapRate: string;
    smoothingThresholdRate: string;
    deductionOrder: string[];
    deductionTypeCaps: Record<string, string>;
  }): Promise<CompensationTemplate>;
  listCompensationTemplates(
    tenantId: string,
  ): Promise<CompensationTemplate[]>;
  getActiveCompensationTemplate(
    tenantId: string,
    code: string,
  ): Promise<CompensationTemplate | undefined>;
  retireCompensationTemplate(input: {
    tenantId: string;
    templateId: string;
  }): Promise<CompensationTemplate>;
  createESignEnvelope(input: {
    tenantId: string;
    contractId: string;
    provider: string;
    envelopeRef: string;
    documentHash: string;
    signerPersonId: string;
  }): Promise<ESignEnvelope>;
  listESignEnvelopes(
    tenantId: string,
    contractId?: string,
  ): Promise<ESignEnvelope[]>;
  completeESignEnvelope(input: {
    tenantId: string;
    provider: string;
    envelopeRef: string;
    status: "SIGNED" | "DECLINED" | "VOID";
    signatureRef?: string;
    reason?: string;
  }): Promise<ESignEnvelope>;
  createPilotEnrollment(input: {
    tenantId: string;
    personId: string;
    pilotCode: string;
    scope: string;
    consentSignatureRef: string;
    consentSignedAt?: string;
  }): Promise<PilotEnrollment>;
  listPilotEnrollments(
    tenantId: string,
    personId?: string,
  ): Promise<PilotEnrollment[]>;
  withdrawPilotEnrollment(input: {
    tenantId: string;
    enrollmentId: string;
    reason?: string;
  }): Promise<PilotEnrollment>;
  createBreakGlassGrant(input: {
    tenantId: string;
    scope: BreakGlassGrant["scope"];
    granteePersonId: string;
    reason: string;
    grantedBy: string;
    expiresAt: string;
  }): Promise<BreakGlassGrant>;
  listBreakGlassGrants(tenantId: string): Promise<BreakGlassGrant[]>;
  revokeBreakGlassGrant(input: {
    tenantId: string;
    grantId: string;
  }): Promise<BreakGlassGrant>;
  findActiveBreakGlassGrant(
    tenantId: string,
    granteePersonId: string,
    scope: BreakGlassGrant["scope"],
  ): Promise<BreakGlassGrant | undefined>;
  createClawbackCase(input: {
    tenantId: string;
    personId: string;
    amount: string;
    currency: string;
    reasonCode: string;
    explanation: string;
    consentSignatureRef: string;
    installmentMonths: number;
    hardshipWaiver: boolean;
    hardshipReason?: string;
    requestedBy: string;
  }): Promise<ClawbackCase>;
  listClawbackCases(
    tenantId: string,
    personId?: string,
  ): Promise<ClawbackCase[]>;
  approveClawbackCase(input: {
    tenantId: string;
    caseId: string;
    approvedBy: string;
  }): Promise<ClawbackCase>;
  closeClawbackCase(input: {
    tenantId: string;
    caseId: string;
    action: "WAIVE" | "CANCEL";
    reason: string;
    actorPersonId: string;
  }): Promise<ClawbackCase>;
  createDiscretionaryPoolReview(input: {
    tenantId: string;
    poolId: string;
    committeePersonIds: string[];
    employeeObserverPersonId?: string;
    selectionCriteria: string;
    decisionNotes: string;
    reviewedBy: string;
  }): Promise<DiscretionaryPoolReview>;
  listDiscretionaryPoolReviews(
    tenantId: string,
    poolId?: string,
  ): Promise<DiscretionaryPoolReview[]>;
  createModelProviderPolicy(input: {
    tenantId: string;
    provider: string;
    zeroRetentionConfirmed: boolean;
    dpaRef: string;
    inferenceRegion: string;
    egressAllowlist: string[];
    approvedBy: string;
  }): Promise<ModelProviderPolicy>;
  listModelProviderPolicies(
    tenantId: string,
  ): Promise<ModelProviderPolicy[]>;
  getActiveModelProviderPolicy(
    tenantId: string,
    provider: string,
  ): Promise<ModelProviderPolicy | undefined>;
  retireModelProviderPolicy(input: {
    tenantId: string;
    policyId: string;
  }): Promise<ModelProviderPolicy>;
  createModelEvaluationDataset(input: {
    tenantId: string;
    code: string;
    version: number;
    name: string;
    sampleSize: number;
    holdoutSize: number;
    labelSource: string;
    ownerPersonId: string;
    refreshedAt?: string;
    nextRefreshDueAt?: string;
    contentHash?: string;
    samples?: ModelEvaluationDataset["samples"];
  }): Promise<ModelEvaluationDataset>;
  listModelEvaluationDatasets(
    tenantId: string,
  ): Promise<ModelEvaluationDataset[]>;
  getActiveModelEvaluationDataset(
    tenantId: string,
    code: string,
  ): Promise<ModelEvaluationDataset | undefined>;
  retireModelEvaluationDataset(input: {
    tenantId: string;
    datasetId: string;
  }): Promise<ModelEvaluationDataset>;
  createModelCanaryRun(input: {
    tenantId: string;
    baselineEvaluationRunId: string;
    candidateEvaluationRunId: string;
    datasetRef: string;
    trafficPercent: number;
    passed: boolean;
    blockers: string[];
    metrics: Record<string, unknown>;
  }): Promise<ModelCanaryRun>;
  listModelCanaryRuns(tenantId: string): Promise<ModelCanaryRun[]>;
  createAuditRedaction(input: {
    tenantId: string;
    auditEventId: string;
    replacement: string;
    reason: string;
    requestedBy: string;
    approvedBy: string;
  }): Promise<AuditRedaction>;
  listAuditRedactions(tenantId: string): Promise<AuditRedaction[]>;
  createModelRedTeamRun(input: {
    tenantId: string;
    modelProvider: string;
    modelName: string;
    promptVersion: string;
    scope: string;
    testsRun: number;
    passed: boolean;
    findings: string[];
    artifactRef?: string;
    createdBy: string;
  }): Promise<ModelRedTeamRun>;
  listModelRedTeamRuns(tenantId: string): Promise<ModelRedTeamRun[]>;
  findPassedModelRedTeamRun(
    tenantId: string,
    modelProvider: string,
    modelName: string,
    promptVersion: string,
  ): Promise<ModelRedTeamRun | undefined>;
  createApprovalRequest(input: {
    tenantId: string;
    actionType: string;
    targetType: string;
    targetId: string;
    targetVersion: number;
    requestedByType: "USER" | "AGENT" | "SYSTEM";
    requestedById?: string;
    riskTier: ApprovalRiskTier;
    requiredApprovals: number;
    expiresAt?: string;
    payloadHash: string;
    idempotencyKey: string;
  }): Promise<ApprovalRequest>;
  listApprovalRequests(
    tenantId: string,
    filter?: {
      status?: ApprovalStatus;
      targetType?: string;
      targetId?: string;
    },
  ): Promise<ApprovalRequest[]>;
  getApprovalRequest(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalRequest>;
  listApprovalDecisions(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalDecision[]>;
  decideApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    decision: "APPROVE" | "REJECT";
    approverPersonId: string;
    payloadHash: string;
    reason?: string;
    authContext: Record<string, unknown>;
  }): Promise<ApprovalRequest>;
  consumeApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    consumedBy: string;
  }): Promise<ApprovalRequest>;
  createSettlementExport(input: {
    tenantId: string;
    batchId: string;
    exportRef: string;
    exportHash: string;
    exportedBy: string;
    exportedAt?: string;
  }): Promise<SettlementExport>;
  listSettlementExports(
    tenantId: string,
    batchId?: string,
  ): Promise<SettlementExport[]>;
  getSettlementExport(
    tenantId: string,
    exportId: string,
  ): Promise<SettlementExport>;
  acknowledgeSettlementExport(input: {
    tenantId: string;
    exportId: string;
    externalReference: string;
    acknowledgedAt?: string;
  }): Promise<SettlementAcknowledgement>;
  createBudgetPool(input: {
    tenantId: string;
    cycleId: string;
    code: string;
    name: string;
    poolType: string;
    currency: string;
    approvedAmount: string;
  }): Promise<BudgetPool>;
  listBudgetPools(tenantId: string, cycleId?: string): Promise<BudgetPool[]>;
  getBudgetPool(tenantId: string, poolId: string): Promise<BudgetPool>;
  approveBudgetPool(input: {
    tenantId: string;
    poolId: string;
    approvedBy: string;
  }): Promise<BudgetPool>;
  createBudgetAllocation(input: {
    tenantId: string;
    poolId: string;
    targetType: string;
    targetId: string;
    amount: string;
  }): Promise<BudgetAllocation>;
  listBudgetAllocations(
    tenantId: string,
    poolId: string,
  ): Promise<BudgetAllocation[]>;
  releaseBudgetAllocation(input: {
    tenantId: string;
    allocationId: string;
  }): Promise<BudgetAllocation>;
  createCashGateInput(input: {
    tenantId: string;
    cycleId: string;
    asOfDate: string;
    safetyReserveMonths: string;
    thirteenWeekForecastRef: string;
    passesGate: boolean;
    approvedBy: string;
    approvedAt?: string;
  }): Promise<CashGateInput>;
  listCashGateInputs(
    tenantId: string,
    cycleId?: string,
  ): Promise<CashGateInput[]>;
  createFinancialFact(input: {
    tenantId: string;
    sourceSystem: string;
    sourceRecordId: string;
    factType: string;
    periodStart?: string;
    periodEnd?: string;
    amount: string;
    currency: string;
    qualityStatus: FinancialFact["qualityStatus"];
    sourceUpdatedAt?: string;
    payload: Record<string, unknown>;
  }): Promise<FinancialFact>;
  listFinancialFacts(
    tenantId: string,
    filter?: { factType?: string; sourceSystem?: string },
  ): Promise<FinancialFact[]>;
  createRuleChangeOrder(input: {
    tenantId: string;
    policyCode: string;
    fromPolicyVersionId?: string;
    toPolicyVersionId: string;
    changeType: string;
    reason: string;
    impactSimulation: Record<string, unknown>;
    effectiveFrom: string;
    requestedBy: string;
  }): Promise<RuleChangeOrder>;
  listRuleChangeOrders(
    tenantId: string,
    filter?: { policyCode?: string; status?: RuleChangeOrder["status"] },
  ): Promise<RuleChangeOrder[]>;
  getRuleChangeOrder(
    tenantId: string,
    orderId: string,
  ): Promise<RuleChangeOrder>;
  approveRuleChangeOrder(input: {
    tenantId: string;
    orderId: string;
    approvedBy: string;
  }): Promise<RuleChangeOrder>;
  rejectRuleChangeOrder(input: {
    tenantId: string;
    orderId: string;
    approvedBy: string;
  }): Promise<RuleChangeOrder>;
  publicizeRuleChangeOrder(input: {
    tenantId: string;
    orderId: string;
  }): Promise<RuleChangeOrder>;
  createPolicyTestCase(input: {
    tenantId: string;
    policyVersionId: string;
    caseCode: string;
    input: Record<string, unknown>;
    expectedOutput: Record<string, unknown>;
    category: PolicyTestCase["category"];
  }): Promise<PolicyTestCase>;
  listPolicyTestCases(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyTestCase[]>;
  getPolicyTestCase(
    tenantId: string,
    testCaseId: string,
  ): Promise<PolicyTestCase>;
  recordPolicyTestCaseRun(input: {
    tenantId: string;
    testCaseId: string;
    passed: boolean;
    resultHash?: string;
    runAt?: string;
  }): Promise<PolicyTestCase>;
  recordPolicyTestRun(input: {
    tenantId: string;
    policyVersionId: string;
    runAt?: string;
    total: number;
    passedCount: number;
    failedCount: number;
    retiredCount: number;
    passed: boolean;
    resultsHash: string;
    results: PolicyTestRun["results"];
  }): Promise<PolicyTestRun>;
  listPolicyTestRuns(
    tenantId: string,
    policyVersionId?: string,
    limit?: number,
  ): Promise<PolicyTestRun[]>;
  retirePolicyTestCase(input: {
    tenantId: string;
    testCaseId: string;
  }): Promise<PolicyTestCase>;
  createPolicyNotice(input: {
    tenantId: string;
    policyVersionId: string;
    noticeId: string;
    audience: Record<string, unknown>;
  }): Promise<PolicyNotice>;
  listPolicyNotices(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyNotice[]>;
  createMetricDefinition(input: {
    tenantId: string;
    code: string;
    version: number;
    name: string;
    description?: string;
    dataType: string;
    unit?: string;
    aggregationMethod?: string;
    sourceContract: Record<string, unknown>;
    effectiveFrom: string;
    effectiveTo?: string;
  }): Promise<MetricDefinition>;
  listMetricDefinitions(
    tenantId: string,
    filter?: { code?: string; active?: boolean },
  ): Promise<MetricDefinition[]>;
  retireMetricDefinition(input: {
    tenantId: string;
    metricId: string;
  }): Promise<MetricDefinition>;
  createDeliverable(input: {
    tenantId: string;
    workPackageId: string;
    title: string;
    deliverableType: string;
    ownerPersonId: string;
    dueAt?: string;
  }): Promise<Deliverable>;
  listDeliverables(
    tenantId: string,
    workPackageId?: string,
  ): Promise<Deliverable[]>;
  getDeliverable(tenantId: string, deliverableId: string): Promise<Deliverable>;
  submitDeliverable(input: {
    tenantId: string;
    deliverableId: string;
    artifactRef?: string;
    contentHash?: string;
  }): Promise<Deliverable>;
  recordDeliverableAcceptance(input: {
    tenantId: string;
    deliverableId: string;
    decision: Acceptance["decision"];
    reviewerPersonId: string;
    criteriaResults: Record<string, unknown>;
    comments?: string;
  }): Promise<Acceptance>;
  listDeliverableAcceptances(
    tenantId: string,
    deliverableId: string,
  ): Promise<Acceptance[]>;
  createAiSuggestion(input: {
    tenantId: string;
    agentTaskId: string;
    targetType: string;
    targetId?: string;
    suggestionType: string;
    modelProvider?: string;
    modelName?: string;
    modelPromptId?: string;
    promptVersion: string;
    inputHash: string;
    outputJson: Record<string, unknown>;
    validationStatus: string;
  }): Promise<AiSuggestionLog>;
  listAiSuggestions(
    tenantId: string,
    filter?: { agentTaskId?: string; targetType?: string },
  ): Promise<AiSuggestionLog[]>;
  acceptAiSuggestion(input: {
    tenantId: string;
    suggestionId: string;
    acceptedBy: string;
  }): Promise<AiSuggestionLog>;
  createModelEvaluationRun(input: {
    tenantId: string;
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
  }): Promise<ModelEvaluationRun>;
  listModelEvaluationRuns(
    tenantId: string,
    filter?: { evaluationType?: string; passed?: boolean },
  ): Promise<ModelEvaluationRun[]>;
  getModelEvaluationRun(
    tenantId: string,
    runId: string,
  ): Promise<ModelEvaluationRun>;
  createModelPrompt(input: {
    tenantId: string;
    promptCode: string;
    version: number;
    purpose: string;
    modelProvider: string;
    modelName: string;
    template: string;
  }): Promise<ModelPrompt>;
  listModelPrompts(
    tenantId: string,
    filter?: { promptCode?: string; status?: ModelPrompt["status"] },
  ): Promise<ModelPrompt[]>;
  getModelPrompt(tenantId: string, promptId: string): Promise<ModelPrompt>;
  activateModelPrompt(input: {
    tenantId: string;
    promptId: string;
    evaluationRunId: string;
  }): Promise<ModelPrompt>;
  retireModelPrompt(input: {
    tenantId: string;
    promptId: string;
  }): Promise<ModelPrompt>;
  createAiScoreProposal(input: {
    tenantId: string;
    cycleId: string;
    personId: string;
    evaluationRunId: string;
    modelPromptId?: string;
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
    riskTier?: AiScoreProposal["riskTier"];
    riskReasons?: string[];
    riskAssessedAt?: string;
    secondReviewDueAt?: string;
    zeroScoreRationale?: string;
    requestedBy?: string;
  }): Promise<AiScoreProposal>;
  listAiScoreProposals(
    tenantId: string,
    filter?: {
      personId?: string;
      cycleId?: string;
      status?: AiScoreProposal["status"];
    },
  ): Promise<AiScoreProposal[]>;
  getAiScoreProposal(
    tenantId: string,
    proposalId: string,
  ): Promise<AiScoreProposal>;
  decideAiScoreProposal(input: {
    tenantId: string;
    proposalId: string;
    decision: "ACCEPT" | "REJECT";
    decidedBy: string;
    note?: string;
    independentScores: Record<string, number>;
    independentRationale?: string;
    reviewStartedAt: string;
    reviewDurationSeconds: number;
    evidenceOpened: number;
    override: boolean;
    overrideReason?: string;
    blindReview: boolean;
    auditSample: boolean;
    secondReviewerPersonId?: string;
    secondIndependentScores?: Record<string, number>;
    secondIndependentRationale?: string;
    secondReviewStartedAt?: string;
    secondEvidenceOpened?: number;
    secondReviewOutcome?: "AGREE" | "DISAGREE";
    secondReviewAgreementRate?: number;
  }): Promise<AiScoreProposal>;
  recordAiScoreAuditReview(input: {
    tenantId: string;
    proposalId: string;
    reviewerPersonId: string;
    scores: Record<string, number>;
    rationale: string;
    reviewStartedAt: string;
    reviewDurationSeconds: number;
    evidenceOpened: number;
    outcome: "AGREE" | "DISAGREE";
    agreementRate: number;
  }): Promise<AiScoreProposal>;
  createWorkflowRun(input: {
    tenantId: string;
    agentTaskId: string;
    workflowName: string;
    workflowVersion: string;
    status: string;
    currentStep?: string;
    state: Record<string, unknown>;
    startedAt?: string;
  }): Promise<WorkflowRun>;
  listWorkflowRuns(
    tenantId: string,
    agentTaskId?: string,
  ): Promise<WorkflowRun[]>;
  finishWorkflowRun(input: {
    tenantId: string;
    workflowRunId: string;
    status: string;
    currentStep?: string;
  }): Promise<WorkflowRun>;
  createIntegrationConnection(input: {
    tenantId: string;
    provider: string;
    connectionName: string;
    credentialRef: string;
    config: Record<string, unknown>;
  }): Promise<IntegrationConnection>;
  listIntegrationConnections(
    tenantId: string,
  ): Promise<IntegrationConnection[]>;
  getIntegrationConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<IntegrationConnection>;
  setIntegrationConnectionStatus(input: {
    tenantId: string;
    connectionId: string;
    status: string;
  }): Promise<IntegrationConnection>;
  createIntegrationMapping(input: {
    tenantId: string;
    connectionId: string;
    name: string;
    mappingType: IntegrationMapping["mappingType"];
    sourceSystem: string;
    targetType: string;
    fieldMap: Record<string, string>;
    config: Record<string, unknown>;
    version: number;
  }): Promise<IntegrationMapping>;
  listIntegrationMappings(
    tenantId: string,
    connectionId: string,
    status?: IntegrationMapping["status"],
  ): Promise<IntegrationMapping[]>;
  getIntegrationMapping(
    tenantId: string,
    mappingId: string,
  ): Promise<IntegrationMapping>;
  retireIntegrationMapping(input: {
    tenantId: string;
    mappingId: string;
  }): Promise<IntegrationMapping>;
  createSyncSchedule(input: {
    tenantId: string;
    connectionId: string;
    name: string;
    intervalMinutes: number;
    startAt?: string;
  }): Promise<SyncSchedule>;
  listSyncSchedules(
    tenantId: string,
    connectionId?: string,
  ): Promise<SyncSchedule[]>;
  getSyncSchedule(
    tenantId: string,
    scheduleId: string,
  ): Promise<SyncSchedule>;
  setSyncScheduleEnabled(input: {
    tenantId: string;
    scheduleId: string;
    enabled: boolean;
  }): Promise<SyncSchedule>;
  claimDueSyncSchedules(input: {
    tenantId: string;
    limit: number;
    now?: string;
  }): Promise<SyncSchedule[]>;
  createEquityGrant(input: {
    tenantId: string;
    personId: string;
    grantCode: string;
    grantType: EquityGrant["grantType"];
    totalUnits: string;
    strikePrice: string;
    currency: string;
    grantDate: string;
    vestingStart: string;
    cliffMonths: number;
    vestingMonths: number;
  }): Promise<EquityGrant>;
  listEquityGrants(
    tenantId: string,
    personId?: string,
  ): Promise<EquityGrant[]>;
  getEquityGrant(
    tenantId: string,
    grantId: string,
  ): Promise<EquityGrant>;
  getEquityVesting(
    tenantId: string,
    grantId: string,
    asOf?: string,
  ): Promise<EquityVesting>;
  createEquityExercise(input: {
    tenantId: string;
    grantId: string;
    units: string;
    requestedBy: string;
  }): Promise<EquityExercise>;
  listEquityExercises(
    tenantId: string,
    grantId?: string,
  ): Promise<EquityExercise[]>;
  approveEquityExercise(input: {
    tenantId: string;
    exerciseId: string;
    approvedBy: string;
  }): Promise<EquityExercise>;
  settleEquityExercise(input: {
    tenantId: string;
    exerciseId: string;
  }): Promise<EquityExercise>;
  createBounty(input: {
    tenantId: string;
    title: string;
    description: string;
    rewardAmount: string;
    currency: string;
    createdBy: string;
    dueAt?: string;
  }): Promise<Bounty>;
  listBounties(
    tenantId: string,
    status?: Bounty["status"],
  ): Promise<Bounty[]>;
  getBounty(tenantId: string, bountyId: string): Promise<Bounty>;
  claimBounty(input: {
    tenantId: string;
    bountyId: string;
    personId: string;
  }): Promise<Bounty>;
  submitBounty(input: {
    tenantId: string;
    bountyId: string;
    personId: string;
    submissionRef: string;
  }): Promise<Bounty>;
  acceptBounty(input: {
    tenantId: string;
    bountyId: string;
    reviewerPersonId: string;
    paymentRef?: string;
  }): Promise<Bounty>;
  cancelBounty(input: {
    tenantId: string;
    bountyId: string;
  }): Promise<Bounty>;
  savePolicyEngineRecord(input: {
    tenantId: string;
    recordType: string;
    payload: Record<string, unknown>;
    personId?: string;
    period?: string;
    status?: string;
    recordId?: string;
  }): Promise<PolicyEngineRecord>;
  getPolicyEngineRecord(
    tenantId: string,
    recordId: string,
  ): Promise<PolicyEngineRecord>;
  listPolicyEngineRecords(
    tenantId: string,
    filter?: {
      recordType?: string;
      personId?: string;
      period?: string;
      status?: string;
    },
  ): Promise<PolicyEngineRecord[]>;
  updatePolicyEngineRecord(input: {
    tenantId: string;
    recordId: string;
    payload?: Record<string, unknown>;
    status?: string;
    version?: number;
  }): Promise<PolicyEngineRecord>;
  createIncentiveAwardBatch(input: {
    tenantId: string;
    batchNo: string;
    awardType: IncentiveAwardType;
    period: string;
    cycleId?: string;
    currency: string;
    createdBy: string;
    sourceRecordIds?: string[];
    lines: Array<{
      personId: string;
      amount: string;
      sourceRecordId?: string;
      sourceLineRef?: string;
      note?: string;
    }>;
  }): Promise<IncentiveAwardBatch>;
  listIncentiveAwardBatches(
    tenantId: string,
    filter?: { awardType?: string; period?: string; status?: string },
  ): Promise<IncentiveAwardBatch[]>;
  getIncentiveAwardBatch(
    tenantId: string,
    batchId: string,
  ): Promise<IncentiveAwardBatch>;
  commandIncentiveAwardBatch(input: {
    tenantId: string;
    batchId: string;
    command:
      | "SUBMIT"
      | "APPROVE"
      | "LOCK"
      | "EXPORT"
      | "ACKNOWLEDGE"
      | "CANCEL";
    actorPersonId: string;
    paymentRef?: string;
  }): Promise<IncentiveAwardBatch>;
  createEmploymentContract(input: {
    tenantId: string;
    personId: string;
    contractCode: string;
    employmentType: EmploymentContract["employmentType"];
    startDate: string;
    endDate?: string;
    workLocation: string;
    legalEntity?: string;
    currency: string;
    fixedMonthlySalary: string;
    minimumMonthlyWage: string;
    taxRate: string;
    socialInsuranceRate: string;
    deductionCapRate: string;
    variableShareCapRate: string;
    deductionOrder: string[];
    deductionTypeCaps: Record<string, string>;
    smoothingThresholdRate: string;
    smoothingMode?: "NONE" | "BLOCK" | "MOVING_AVERAGE" | "RAMP";
    smoothingWindowPeriods?: number;
    smoothingMaxStepRate?: string;
    compensationTemplateCode?: string;
    bankAccountRef?: string;
    consentSignatureRef: string;
    consentSignedAt?: string;
  }): Promise<EmploymentContract>;
  listEmploymentContracts(
    tenantId: string,
    personId?: string,
  ): Promise<EmploymentContract[]>;
  getEmploymentContract(
    tenantId: string,
    contractId: string,
  ): Promise<EmploymentContract>;  amendEmploymentContract(input: {
    tenantId: string;
    contractId: string;
    fixedMonthlySalary: string;
    minimumMonthlyWage: string;
    taxRate: string;
    socialInsuranceRate: string;
    deductionCapRate: string;
    variableShareCapRate: string;
    deductionOrder: string[];
    deductionTypeCaps: Record<string, string>;
    smoothingThresholdRate: string;
    smoothingMode?: "NONE" | "BLOCK" | "MOVING_AVERAGE" | "RAMP";
    smoothingWindowPeriods?: number;
    smoothingMaxStepRate?: string;
    compensationTemplateCode?: string;
    bankAccountRef?: string;
    effectiveFrom: string;
    consentSignatureRef: string;
    approvedBy: string;
  }): Promise<EmploymentContract>;
  listEmploymentContractAmendments(
    tenantId: string,
    contractId: string,
  ): Promise<EmploymentContractAmendment[]>;
  applyDueContractAmendments(
    tenantId: string,
  ): Promise<EmploymentContractAmendment[]>;
  cancelContractAmendment(input: {
    tenantId: string;
    contractId: string;
    amendmentId: string;
    reason: string;
  }): Promise<EmploymentContractAmendment>;

  createAdverseAction(input: {
    tenantId: string;
    personId: string;
    actionType: AdverseActionCase["actionType"];
    reason: string;
    performanceBasis: string;
    evidenceRefs: string[];
    requestedBy: string;
  }): Promise<AdverseActionCase>;
  listAdverseActions(
    tenantId: string,
    personId?: string,
  ): Promise<AdverseActionCase[]>;
  getAdverseAction(
    tenantId: string,
    actionId: string,
  ): Promise<AdverseActionCase>;
  reviewAdverseAction(input: {
    tenantId: string;
    actionId: string;
    legalReviewerId: string;
    legalReviewRef: string;
    decision: "APPROVE" | "REJECT";
    note?: string;
  }): Promise<AdverseActionCase>;
  approveAdverseAction(input: {
    tenantId: string;
    actionId: string;
    approvedBy: string;
  }): Promise<AdverseActionCase>;
  activateAdverseAction(input: {
    tenantId: string;
    actionId: string;
    effectiveFrom: string;
  }): Promise<AdverseActionCase>;
  completeAdverseAction(input: {
    tenantId: string;
    actionId: string;
  }): Promise<AdverseActionCase>;
  cancelAdverseAction(input: {
    tenantId: string;
    actionId: string;
    reason: string;
  }): Promise<AdverseActionCase>;

  createPayrollRun(input: {
    tenantId: string;
    cycleId: string;
    periodStart: string;
    periodEnd: string;
    currency: string;
    preparedBy: string;
  }): Promise<PayrollRun>;
  listPayrollRuns(
    tenantId: string,
    cycleId?: string,
  ): Promise<PayrollRun[]>;
  getPayrollRun(
    tenantId: string,
    runId: string,
  ): Promise<PayrollRun>;
  savePayrollCalculation(input: {
    tenantId: string;
    runId: string;
    lines: Array<Omit<PayrollLine, "id" | "tenantId" | "runId" | "createdAt">>;
    totalGross: string;
    totalDeductions: string;
    totalTax: string;
    totalSocialInsurance: string;
    totalNet: string;
    blockedCount: number;
  }): Promise<PayrollRun>;
  approvePayrollRun(input: {
    tenantId: string;
    runId: string;
    approvedBy: string;
  }): Promise<PayrollRun>;
  payPayrollRun(input: {
    tenantId: string;
    runId: string;
  }): Promise<PayrollRun>;
  reversePayrollRun(input: {
    tenantId: string;
    runId: string;
    reason: string;
    reversedBy: string;
  }): Promise<PayrollRun>;
  cancelPayrollRun(input: {
    tenantId: string;
    runId: string;
  }): Promise<PayrollRun>;
  createSyncRun(input: {
    tenantId: string;
    connectionId: string;
    status: string;
    cursorBefore?: Record<string, unknown>;
  }): Promise<SyncRun>;
  listSyncRuns(
    tenantId: string,
    connectionId?: string,
  ): Promise<SyncRun[]>;
  finishSyncRun(input: {
    tenantId: string;
    syncRunId: string;
    status: string;
    recordsSeen: number;
    recordsUpserted: number;
    cursorAfter?: Record<string, unknown>;
    errorSummary?: string;
  }): Promise<SyncRun>;
  upsertExternalIdentity(input: {
    tenantId: string;
    sourceSystem: string;
    externalId: string;
    personId?: string;
    objectType: string;
  }): Promise<ExternalIdentity>;
  listExternalIdentities(
    tenantId: string,
    filter?: { sourceSystem?: string; objectType?: string },
  ): Promise<ExternalIdentity[]>;
  receiveWebhook(input: {
    tenantId: string;
    sourceSystem: string;
    messageId: string;
    payloadHash: string;
  }): Promise<WebhookInboxMessage>;
  listWebhooks(
    tenantId: string,
    filter?: { status?: string; sourceSystem?: string },
  ): Promise<WebhookInboxMessage[]>;
  processWebhook(input: {
    tenantId: string;
    webhookId: string;
    status: "PROCESSED" | "FAILED";
    errorCode?: string;
  }): Promise<WebhookInboxMessage>;
  receiveInboxMessage(input: {
    tenantId: string;
    consumerName: string;
    messageId: string;
  }): Promise<InboxMessage>;
  listInboxMessages(
    tenantId: string,
    filter?: { consumerName?: string; status?: string },
  ): Promise<InboxMessage[]>;
  processInboxMessage(input: {
    tenantId: string;
    inboxMessageId: string;
    status: "PROCESSED" | "FAILED" | "IGNORED";
    errorCode?: string;
  }): Promise<InboxMessage>;
}

function now(): string {
  return new Date().toISOString();
}

function notFound(kind: string, id: string): never {
  throw new NotFoundError(`${kind} ${id} not found`);
}

function surveyAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function aggregateSurveyReport(
  survey: TrustSurveyRun,
  responses: TrustSurveyResponse[],
  baseline?: {
    survey: TrustSurveyRun;
    responses: TrustSurveyResponse[];
  },
): TrustSurveyReport {
  const averages: Record<string, number> = {};
  const distribution: Record<string, Record<string, number>> = {};
  for (const question of survey.questions) {
    const values = responses
      .map((response) => response.scores[question.code])
      .filter((value): value is number => typeof value === "number");
    averages[question.code] = surveyAverage(values);
    const buckets: Record<string, number> = {};
    for (const value of [1, 2, 3, 4, 5]) {
      buckets[String(value)] = values.filter((candidate) => candidate === value).length;
    }
    distribution[question.code] = buckets;
  }
  const dimensionValues: Record<string, number[]> = {};
  for (const question of survey.questions) {
    const values = dimensionValues[question.dimension] ?? [];
    const average = averages[question.code];
    if (average !== undefined) values.push(average);
    dimensionValues[question.dimension] = values;
  }
  const dimensions = Object.fromEntries(
    Object.entries(dimensionValues).map(([dimension, values]) => [
      dimension,
      surveyAverage(values),
    ]),
  );
  let baselineSummary: TrustSurveyReport["baseline"];
  if (baseline) {
    const baselineDimensions = aggregateSurveyReport(
      baseline.survey,
      baseline.responses,
    ).dimensions;
    baselineSummary = {
      surveyId: baseline.survey.id,
      period: baseline.survey.period,
      responseCount: baseline.responses.length,
      dimensions: baselineDimensions,
    };
  }
  return {
    survey,
    responseCount: responses.length,
    averages,
    dimensions,
    distribution,
    baseline: baselineSummary,
  };
}

export class MemoryPlatformStore implements PlatformStore {
  private readonly tenants = new Map<string, PlatformTenant>();
  private readonly users = new Map<string, PlatformUser>();
  private readonly memberships = new Map<string, PlatformMembership>();
  private readonly persons = new Map<string, PlatformPerson>();
  private readonly orgNodes = new Map<string, PlatformOrgNode>();
  private readonly orgAssignments = new Map<string, PlatformOrgAssignment>();
  private readonly notices = new Map<string, EmployeeNotice>();
  private readonly acknowledgements = new Map<string, PolicyAcknowledgement>();
  private readonly representations = new Map<string, EmployeeRepresentation>();
  private readonly consultations = new Map<string, PolicyConsultation>();
  private readonly dpias = new Map<string, DpiaRecord>();
  private readonly dsars = new Map<string, DsarRequest>();
  private readonly retentionPolicies = new Map<string, RetentionPolicy>();
  private readonly retentionDisposals = new Map<
    string,
    RetentionDisposalRequest
  >();
  private readonly workforceSubgroupAttributes = new Map<
    string,
    WorkforceSubgroupAttribute
  >();
  private readonly appealEvidenceDisclosures = new Map<
    string,
    AppealEvidenceDisclosure
  >();
  private readonly dataSources = new Map<string, DataSource>();
  private readonly conflictDeclarations = new Map<
    string,
    ConflictDeclaration
  >();
  private readonly trustSurveys = new Map<string, TrustSurveyRun>();
  private readonly trustSurveyResponses = new Map<
    string,
    TrustSurveyResponse
  >();
  private readonly fairnessCommitments = new Map<
    string,
    FairnessCommitment
  >();
  private readonly managerTrainingRecords = new Map<
    string,
    ManagerTrainingRecord
  >();
  private readonly calibrationSessions = new Map<
    string,
    CalibrationSession
  >();
  private readonly pilotEnrollments = new Map<string, PilotEnrollment>();
  private readonly compensationTemplates = new Map<
    string,
    CompensationTemplate
  >();
  private readonly esignEnvelopes = new Map<string, ESignEnvelope>();
  private readonly breakGlassGrants = new Map<string, BreakGlassGrant>();
  private readonly clawbackCases = new Map<string, ClawbackCase>();
  private readonly discretionaryPoolReviews = new Map<
    string,
    DiscretionaryPoolReview
  >();
  private readonly modelProviderPolicies = new Map<
    string,
    ModelProviderPolicy
  >();
  private readonly modelEvaluationDatasets = new Map<
    string,
    ModelEvaluationDataset
  >();
  private readonly modelCanaryRuns = new Map<string, ModelCanaryRun>();
  private readonly auditRedactions = new Map<string, AuditRedaction>();
  private readonly modelRedTeamRuns = new Map<string, ModelRedTeamRun>();
  private readonly approvalRequests = new Map<string, ApprovalRequest>();
  private readonly approvalDecisions = new Map<string, ApprovalDecision>();
  private readonly settlementExports = new Map<string, SettlementExport>();
  private readonly settlementAcknowledgements = new Map<
    string,
    SettlementAcknowledgement
  >();
  private readonly budgetPools = new Map<string, BudgetPool>();
  private readonly budgetAllocations = new Map<string, BudgetAllocation>();
  private readonly cashGateInputs = new Map<string, CashGateInput>();
  private readonly financialFacts = new Map<string, FinancialFact>();
  private readonly ruleChangeOrders = new Map<string, RuleChangeOrder>();
  private readonly policyTestCases = new Map<string, PolicyTestCase>();
  private readonly policyTestRuns = new Map<string, PolicyTestRun>();
  private readonly policyNotices = new Map<string, PolicyNotice>();
  private readonly metricDefinitions = new Map<string, MetricDefinition>();
  private readonly deliverables = new Map<string, Deliverable>();
  private readonly acceptances = new Map<string, Acceptance>();
  private readonly aiSuggestions = new Map<string, AiSuggestionLog>();
  private readonly modelEvaluationRuns = new Map<string, ModelEvaluationRun>();
  private readonly modelPrompts = new Map<string, ModelPrompt>();
  private readonly aiScoreProposals = new Map<string, AiScoreProposal>();
  private readonly workflowRuns = new Map<string, WorkflowRun>();
  private readonly integrationConnections = new Map<
    string,
    IntegrationConnection
  >();
  private readonly integrationMappings = new Map<
    string,
    IntegrationMapping
  >();
  private readonly syncSchedules = new Map<string, SyncSchedule>();
  private readonly equityGrants = new Map<string, EquityGrant>();
  private readonly equityExercises = new Map<string, EquityExercise>();
  private readonly bounties = new Map<string, Bounty>();
  private readonly policyEngineRecords = new Map<string, PolicyEngineRecord>();
  private readonly incentiveAwardBatches = new Map<string, IncentiveAwardBatch>();
  private readonly employmentContracts = new Map<
    string,
    EmploymentContract
  >();
  private readonly adverseActions = new Map<string, AdverseActionCase>();
  private readonly contractAmendments = new Map<
    string,
    EmploymentContractAmendment[]
  >();
  private readonly payrollRuns = new Map<string, PayrollRun>();
  private readonly payrollLines = new Map<string, PayrollLine[]>();
  private readonly syncRuns = new Map<string, SyncRun>();
  private readonly externalIdentities = new Map<string, ExternalIdentity>();
  private readonly webhooks = new Map<string, WebhookInboxMessage>();
  private readonly inboxMessages = new Map<string, InboxMessage>();
  private readonly subscriptionPlans = new Map<string, SubscriptionPlan>();
  private readonly tenantSubscriptions = new Map<string, TenantSubscription>();
  private readonly invoices = new Map<string, TenantInvoice>();
  private readonly strategicPoolCases = new Map<string, StrategicPoolCase>();
  private readonly userPasswordHashes = new Map<string, string>();

  constructor(
    options: {
      /** Seed a demo tenant (and optional people) for memory-mode demos. */
      demoTenant?: {
        id: string;
        name: string;
        slug: string;
        persons?: Array<{
          id: string;
          employeeCode: string;
          displayName: string;
        }>;
      };
    } = {},
  ) {
    const demo = options.demoTenant;
    if (!demo) return;
    const createdAt = now();
    this.tenants.set(demo.id, {
      id: demo.id,
      name: demo.name,
      slug: demo.slug,
      status: "ACTIVE",
      defaultTimezone: "UTC",
      defaultCurrency: "CNY",
      settings: {},
      createdAt,
    });
    for (const person of demo.persons ?? []) {
      this.persons.set(person.id, {
        id: person.id,
        tenantId: demo.id,
        employeeCode: person.employeeCode,
        displayName: person.displayName,
        employmentStatus: "ACTIVE",
        createdAt,
      });
    }
  }

  async createTenant(input: {
    name: string;
    slug: string;
    defaultTimezone?: string;
    defaultCurrency?: string;
  }): Promise<PlatformTenant> {
    if ([...this.tenants.values()].some((tenant) => tenant.slug === input.slug)) {
      throw new ConflictError(`tenant slug ${input.slug} already exists`);
    }
    const tenant: PlatformTenant = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      status: "ACTIVE",
      defaultTimezone: input.defaultTimezone ?? "UTC",
      defaultCurrency: input.defaultCurrency ?? "CNY",
      settings: {},
      createdAt: now(),
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async listTenants(): Promise<PlatformTenant[]> {
    return [...this.tenants.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async getTenant(tenantId: string): Promise<PlatformTenant> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) notFound("Tenant", tenantId);
    return tenant;
  }

  async updateTenantSettings(input: {
    tenantId: string;
    settings: Record<string, unknown>;
  }): Promise<PlatformTenant> {
    const tenant = await this.getTenant(input.tenantId);
    tenant.settings = {
      ...(tenant.settings ?? {}),
      ...input.settings,
    };
    return tenant;
  }

  async createUser(input: {
    authSubject: string;
    displayName: string;
    email?: string;
  }): Promise<PlatformUser> {
    if (
      [...this.users.values()].some(
        (user) => user.authSubject === input.authSubject,
      )
    ) {
      throw new ConflictError(`auth subject ${input.authSubject} exists`);
    }
    const user: PlatformUser = {
      id: randomUUID(),
      email: input.email,
      displayName: input.displayName,
      authSubject: input.authSubject,
      status: "ACTIVE",
      createdAt: now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async listUsers(): Promise<PlatformUser[]> {
    return [...this.users.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async addMembership(input: {
    tenantId: string;
    userId: string;
    roleCodes: string[];
  }): Promise<PlatformMembership> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (!this.users.has(input.userId)) notFound("User", input.userId);
    const key = `${input.tenantId}:${input.userId}`;
    const existing = [...this.memberships.values()].find(
      (membership) =>
        membership.tenantId === input.tenantId &&
        membership.userId === input.userId,
    );
    const membership: PlatformMembership = existing ?? {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      status: "ACTIVE",
      roleCodes: input.roleCodes,
      joinedAt: now(),
      createdAt: now(),
    };
    membership.roleCodes = input.roleCodes;
    membership.status = "ACTIVE";
    membership.joinedAt = membership.joinedAt ?? now();
    this.memberships.set(key, membership);
    return membership;
  }

  async listMemberships(tenantId: string): Promise<PlatformMembership[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.memberships.values()]
      .filter((membership) => membership.tenantId === tenantId)
      .map((membership) => {
        const user = this.users.get(membership.userId);
        return {
          ...membership,
          userDisplayName: user?.displayName,
          userEmail: user?.email,
        };
      });
  }

  async createPerson(input: {
    tenantId: string;
    employeeCode: string;
    displayName: string;
    employmentStatus?: string;
    userId?: string;
  }): Promise<PlatformPerson> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (input.userId && !this.users.has(input.userId)) {
      notFound("User", input.userId);
    }
    if (
      [...this.persons.values()].some(
        (person) =>
          person.tenantId === input.tenantId &&
          person.employeeCode === input.employeeCode,
      )
    ) {
      throw new ConflictError(
        `employee code ${input.employeeCode} already exists in tenant`,
      );
    }
    if (input.userId) this.assertUserNotLinked(input.tenantId, input.userId);
    const person: PlatformPerson = {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      employeeCode: input.employeeCode,
      displayName: input.displayName,
      employmentStatus: input.employmentStatus ?? "ACTIVE",
      createdAt: now(),
    };
    this.persons.set(person.id, person);
    return person;
  }

  async listPersons(tenantId: string): Promise<PlatformPerson[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.persons.values()]
      .filter((person) => person.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findUserByAuthSubject(authSubject: string): Promise<PlatformUser | null> {
    return (
      [...this.users.values()].find(
        (user) => user.authSubject === authSubject,
      ) ?? null
    );
  }

  async listMembershipsByUser(userId: string): Promise<PlatformMembership[]> {
    return [...this.memberships.values()]
      .filter((membership) => membership.userId === userId)
      .sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? ""));
  }

  async setUserPassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.users.get(userId);
    if (!user) notFound("User", userId);
    this.userPasswordHashes.set(userId, passwordHash);
  }

  async getUserPasswordHash(userId: string): Promise<string | null> {
    return this.userPasswordHashes.get(userId) ?? null;
  }

  async getUserPasswordHashByEmail(
    email: string,
  ): Promise<{ userId: string; passwordHash: string | null } | null> {
    const normalized = email.trim().toLowerCase();
    const user = [...this.users.values()].find(
      (candidate) =>
        (candidate.email ?? "").toLowerCase() === normalized ||
        candidate.authSubject.toLowerCase() === normalized,
    );
    if (!user) return null;
    return {
      userId: user.id,
      passwordHash: this.userPasswordHashes.get(user.id) ?? null,
    };
  }

  async createSubscriptionPlan(input: {
    code: string;
    name: string;
    description?: string;
    monthlyPrice: string;
    currency: string;
    seatLimit: number;
    trialDays: number;
    features: string[];
    active?: boolean;
  }): Promise<SubscriptionPlan> {
    if (
      [...this.subscriptionPlans.values()].some(
        (plan) => plan.code === input.code,
      )
    ) {
      throw new ConflictError(`plan code ${input.code} already exists`);
    }
    const plan: SubscriptionPlan = {
      id: randomUUID(),
      code: input.code,
      name: input.name,
      description: input.description,
      monthlyPrice: input.monthlyPrice,
      currency: input.currency,
      seatLimit: input.seatLimit,
      trialDays: input.trialDays,
      features: input.features,
      active: input.active ?? true,
      createdAt: now(),
    };
    this.subscriptionPlans.set(plan.id, plan);
    return plan;
  }

  async listSubscriptionPlans(
    activeOnly = false,
  ): Promise<SubscriptionPlan[]> {
    return [...this.subscriptionPlans.values()]
      .filter((plan) => (activeOnly ? plan.active : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async setTenantSubscription(input: {
    tenantId: string;
    planCode: string;
    status: TenantSubscriptionStatus;
    seats: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    trialEndsAt?: string;
    cancelReason?: string;
  }): Promise<TenantSubscription> {
    const plan = [...this.subscriptionPlans.values()].find(
      (candidate) => candidate.code === input.planCode,
    );
    if (!plan) notFound("SubscriptionPlan", input.planCode);
    await this.getTenant(input.tenantId);
    const existing = [...this.tenantSubscriptions.values()].find(
      (subscription) => subscription.tenantId === input.tenantId,
    );
    const timestamp = now();
    const record: TenantSubscription = {
      id: existing?.id ?? randomUUID(),
      tenantId: input.tenantId,
      planId: plan.id,
      planCode: plan.code,
      planName: plan.name,
      status: input.status,
      seats: input.seats,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      trialEndsAt: input.trialEndsAt,
      canceledAt:
        input.status === "CANCELED" ? existing?.canceledAt ?? timestamp : undefined,
      cancelReason: input.cancelReason,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.tenantSubscriptions.set(record.id, record);
    return record;
  }

  async getTenantSubscription(
    tenantId: string,
  ): Promise<TenantSubscription | null> {
    return (
      [...this.tenantSubscriptions.values()].find(
        (subscription) => subscription.tenantId === tenantId,
      ) ?? null
    );
  }

  async createInvoice(input: {
    tenantId: string;
    lineItems: TenantInvoiceLineItem[];
    periodStart?: string;
    periodEnd?: string;
    dueDate?: string;
  }): Promise<TenantInvoice> {
    const subscription = await this.getTenantSubscription(input.tenantId);
    if (!subscription) notFound("TenantSubscription", input.tenantId);
    const plan = this.subscriptionPlans.get(subscription.planId);
    const total = input.lineItems.reduce(
      (sum, item) => sum + parseDecimal(item.amount),
      0n,
    );
    const invoice: TenantInvoice = {
      id: randomUUID(),
      tenantId: input.tenantId,
      subscriptionId: subscription.id,
      number: this.nextInvoiceNumber(input.tenantId),
      status: "DRAFT",
      currency: plan?.currency ?? "CNY",
      lineItems: input.lineItems,
      totalAmount: formatInvoiceAmount(total),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueDate: input.dueDate,
      createdAt: now(),
    };
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  async listInvoices(tenantId: string): Promise<TenantInvoice[]> {
    return [...this.invoices.values()]
      .filter((invoice) => invoice.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setInvoiceStatus(input: {
    invoiceId: string;
    status: TenantInvoiceStatus;
  }): Promise<TenantInvoice> {
    const invoice = this.invoices.get(input.invoiceId);
    if (!invoice) notFound("Invoice", input.invoiceId);
    const timestamp = now();
    const updated: TenantInvoice = {
      ...invoice,
      status: input.status,
      issuedAt:
        input.status === "ISSUED" ? invoice.issuedAt ?? timestamp : invoice.issuedAt,
      paidAt:
        input.status === "PAID" ? invoice.paidAt ?? timestamp : invoice.paidAt,
    };
    this.invoices.set(invoice.id, updated);
    return updated;
  }

  async createStrategicPoolCase(input: {
    tenantId: string;
    cycleId: string;
    poolAmount: string;
    capAmount: string;
    currency: string;
    budgetPoolId?: string;
    rationale: string;
    requestedBy: string;
  }): Promise<StrategicPoolCase> {
    const record: StrategicPoolCase = {
      id: randomUUID(),
      tenantId: input.tenantId,
      cycleId: input.cycleId,
      poolAmount: input.poolAmount,
      capAmount: input.capAmount,
      currency: input.currency,
      budgetPoolId: input.budgetPoolId,
      rationale: input.rationale,
      requestedBy: input.requestedBy,
      deferredInstallmentMonths: 0,
      status: "DRAFT",
      createdAt: now(),
      updatedAt: now(),
    };
    this.strategicPoolCases.set(record.id, record);
    return record;
  }

  async listStrategicPoolCases(
    tenantId: string,
  ): Promise<StrategicPoolCase[]> {
    return [...this.strategicPoolCases.values()]
      .filter((record) => record.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateStrategicPoolCase(input: {
    tenantId: string;
    caseId: string;
    patch: Partial<Omit<StrategicPoolCase, "id" | "tenantId">>;
  }): Promise<StrategicPoolCase> {
    const record = this.strategicPoolCases.get(input.caseId);
    if (!record || record.tenantId !== input.tenantId) {
      notFound("StrategicPoolCase", input.caseId);
    }
    const updated: StrategicPoolCase = {
      ...record,
      ...input.patch,
      updatedAt: now(),
    };
    this.strategicPoolCases.set(record.id, updated);
    return updated;
  }

  private nextInvoiceNumber(tenantId: string): string {
    const yearMonth = new Date().toISOString().slice(0, 7).replace("-", "");
    const count =
      [...this.invoices.values()].filter(
        (invoice) => invoice.tenantId === tenantId,
      ).length + 1;
    return `INV-${yearMonth}-${String(count).padStart(4, "0")}`;
  }

  async linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (!this.users.has(input.userId)) notFound("User", input.userId);
    this.assertUserNotLinked(input.tenantId, input.userId, person.id);
    person.userId = input.userId;
    return person;
  }

  async resolveIdentity(input: {
    tenantId: string;
    userId: string;
    personId?: string;
  }): Promise<PlatformIdentity> {
    const person =
      [...this.persons.values()].find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          (input.personId
            ? candidate.id === input.personId
            : candidate.userId === input.userId),
      ) ??
      [...this.persons.values()].find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.userId === input.userId,
      );
    const membership = [...this.memberships.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.userId === input.userId,
    );
    const user = this.users.get(input.userId);
    const tenant = this.tenants.get(input.tenantId);
    return {
      userId: input.userId,
      personId: person?.id,
      roles: membership?.roleCodes ?? [],
      displayName: person?.displayName ?? user?.displayName ?? user?.email,
      tenantName: tenant?.name,
    };
  }

  async createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
    externalId?: string;
  }): Promise<PlatformOrgNode> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const parent = input.parentId
      ? this.orgNodes.get(input.parentId)
      : undefined;
    if (input.parentId && (!parent || parent.tenantId !== input.tenantId)) {
      notFound("OrgNode", input.parentId);
    }
    const node: PlatformOrgNode = {
      id: randomUUID(),
      tenantId: input.tenantId,
      parentId: input.parentId,
      nodeType: input.nodeType,
      name: input.name,
      path: parent?.path ? `${parent.path}/${input.name}` : `/${input.name}`,
      active: true,
      externalId: input.externalId,
      createdAt: now(),
    };
    this.orgNodes.set(node.id, node);
    return node;
  }

  async listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.orgNodes.values()]
      .filter((node) => node.tenantId === tenantId)
      .sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name));
  }

  async assignPersonOrg(input: {
    tenantId: string;
    personId: string;
    orgNodeId: string;
    validFrom: string;
    validTo?: string;
    allocation?: string;
  }): Promise<PlatformOrgAssignment> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    const node = this.orgNodes.get(input.orgNodeId);
    if (!node || node.tenantId !== input.tenantId) {
      notFound("OrgNode", input.orgNodeId);
    }
    if (input.validTo && input.validTo < input.validFrom) {
      throw new ConflictError("validTo must not be before validFrom");
    }
    if (input.allocation !== undefined) {
      const allocation = Number(input.allocation);
      if (!Number.isFinite(allocation) || allocation < 0 || allocation > 1) {
        throw new ConflictError("allocation must be between 0 and 1");
      }
    }
    const assignment: PlatformOrgAssignment = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      orgNodeId: input.orgNodeId,
      validFrom: input.validFrom,
      validTo: input.validTo,
      allocation: input.allocation,
      createdAt: now(),
    };
    this.orgAssignments.set(assignment.id, assignment);
    return assignment;
  }

  async listOrgAssignments(
    tenantId: string,
    personId?: string,
  ): Promise<PlatformOrgAssignment[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.orgAssignments.values()]
      .filter(
        (assignment) =>
          assignment.tenantId === tenantId &&
          (!personId || assignment.personId === personId),
      )
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  }

  async setPersonManager(input: {
    tenantId: string;
    personId: string;
    managerPersonId: string | null;
  }): Promise<PlatformPerson> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (input.managerPersonId === null) {
      person.managerPersonId = undefined;
      return person;
    }
    if (input.managerPersonId === input.personId) {
      throw new ConflictError("a person cannot be their own manager");
    }
    const manager = this.persons.get(input.managerPersonId);
    if (!manager || manager.tenantId !== input.tenantId) {
      notFound("Person", input.managerPersonId);
    }
    let current: PlatformPerson | undefined = manager;
    while (current?.managerPersonId) {
      if (current.managerPersonId === input.personId) {
        throw new ConflictError("manager assignment would create a cycle");
      }
      current = this.persons.get(current.managerPersonId);
    }
    person.managerPersonId = input.managerPersonId;
    return person;
  }

  async createNotice(input: {
    tenantId: string;
    noticeType: NoticeType;
    title: string;
    bodyRef: string;
    policyVersionId?: string;
    publishedAt?: string;
    effectiveFrom: string;
    acknowledgementRequired: boolean;
  }): Promise<EmployeeNotice> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const timestamp = now();
    const notice: EmployeeNotice = {
      id: randomUUID(),
      tenantId: input.tenantId,
      policyVersionId: input.policyVersionId,
      noticeType: input.noticeType,
      title: input.title,
      bodyRef: input.bodyRef,
      publishedAt: input.publishedAt ?? timestamp,
      effectiveFrom: input.effectiveFrom,
      acknowledgementRequired: input.acknowledgementRequired,
      createdAt: timestamp,
    };
    this.notices.set(notice.id, notice);
    return notice;
  }

  async listNotices(tenantId: string): Promise<EmployeeNotice[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.notices.values()]
      .filter((notice) => notice.tenantId === tenantId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  async getNotice(
    tenantId: string,
    noticeId: string,
  ): Promise<EmployeeNotice> {
    const notice = this.notices.get(noticeId);
    if (!notice || notice.tenantId !== tenantId) {
      notFound("Notice", noticeId);
    }
    return notice;
  }

  async recordAcknowledgement(input: {
    tenantId: string;
    noticeId: string;
    personId: string;
    decision: "ACKNOWLEDGE" | "DECLINE";
    signatureRef?: string;
    declineReason?: string;
  }): Promise<PolicyAcknowledgement> {
    const notice = await this.getNotice(input.tenantId, input.noticeId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    const key = `${notice.id}:${input.personId}`;
    const existing = this.acknowledgements.get(key);
    const timestamp = now();
    const acknowledgement: PolicyAcknowledgement = existing ?? {
      id: randomUUID(),
      tenantId: input.tenantId,
      noticeId: notice.id,
      personId: input.personId,
      createdAt: timestamp,
    };
    if (input.decision === "ACKNOWLEDGE") {
      acknowledgement.acknowledgedAt = timestamp;
      acknowledgement.signatureRef = input.signatureRef;
      acknowledgement.declinedAt = undefined;
      acknowledgement.declineReason = undefined;
    } else {
      acknowledgement.declinedAt = timestamp;
      acknowledgement.declineReason = input.declineReason;
      acknowledgement.acknowledgedAt = undefined;
      acknowledgement.signatureRef = undefined;
    }
    this.acknowledgements.set(key, acknowledgement);
    return acknowledgement;
  }

  async listAcknowledgements(
    tenantId: string,
    noticeId: string,
  ): Promise<NoticeAcknowledgementOverview> {
    const notice = await this.getNotice(tenantId, noticeId);
    const acknowledgements = [...this.acknowledgements.values()]
      .filter((candidate) => candidate.noticeId === notice.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const activePersonIds = new Set(
      [...this.persons.values()]
        .filter(
          (person) =>
            person.tenantId === tenantId &&
            person.employmentStatus === "ACTIVE",
        )
        .map((person) => person.id),
    );
    const activeAcknowledgements = acknowledgements.filter((candidate) =>
      activePersonIds.has(candidate.personId),
    );
    const acknowledgedCount = activeAcknowledgements.filter(
      (candidate) => candidate.acknowledgedAt,
    ).length;
    const declinedCount = activeAcknowledgements.filter(
      (candidate) => candidate.declinedAt,
    ).length;
    return {
      summary: {
        noticeId: notice.id,
        acknowledgementRequired: notice.acknowledgementRequired,
        personCount: activePersonIds.size,
        acknowledgedCount,
        declinedCount,
        pendingCount: Math.max(
          activePersonIds.size - acknowledgedCount - declinedCount,
          0,
        ),
        complete:
          !notice.acknowledgementRequired ||
          (activePersonIds.size > 0 &&
            acknowledgedCount >= activePersonIds.size),
      },
      acknowledgements,
    };
  }

  async createRepresentation(input: {
    tenantId: string;
    bodyName: string;
    bodyType: RepresentationBodyType;
    jurisdiction: string;
  }): Promise<EmployeeRepresentation> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const representation: EmployeeRepresentation = {
      id: randomUUID(),
      tenantId: input.tenantId,
      bodyName: input.bodyName,
      bodyType: input.bodyType,
      jurisdiction: input.jurisdiction,
      active: true,
      createdAt: now(),
    };
    this.representations.set(representation.id, representation);
    return representation;
  }

  async listRepresentations(
    tenantId: string,
  ): Promise<EmployeeRepresentation[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.representations.values()]
      .filter((representation) => representation.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createConsultation(input: {
    tenantId: string;
    policyVersionId: string;
    representationId?: string;
    consultationType: ConsultationType;
    startedAt: string;
    endedAt?: string;
    minutesRef?: string;
    feedbackSummary?: string;
    outcome: ConsultationOutcome;
  }): Promise<PolicyConsultation> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (input.representationId) {
      const representation = this.representations.get(input.representationId);
      if (
        !representation ||
        representation.tenantId !== input.tenantId
      ) {
        notFound("EmployeeRepresentation", input.representationId);
      }
    }
    if (input.endedAt && input.endedAt < input.startedAt) {
      throw new ConflictError("endedAt must not be before startedAt");
    }
    const consultation: PolicyConsultation = {
      id: randomUUID(),
      tenantId: input.tenantId,
      policyVersionId: input.policyVersionId,
      representationId: input.representationId,
      consultationType: input.consultationType,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      minutesRef: input.minutesRef,
      feedbackSummary: input.feedbackSummary,
      outcome: input.outcome,
      createdAt: now(),
    };
    this.consultations.set(consultation.id, consultation);
    return consultation;
  }

  async listConsultations(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyConsultation[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.consultations.values()]
      .filter(
        (consultation) =>
          consultation.tenantId === tenantId &&
          (!policyVersionId ||
            consultation.policyVersionId === policyVersionId),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getConsultation(
    tenantId: string,
    consultationId: string,
  ): Promise<PolicyConsultation> {
    const consultation = this.consultations.get(consultationId);
    if (!consultation || consultation.tenantId !== tenantId) {
      notFound("PolicyConsultation", consultationId);
    }
    return consultation;
  }

  async concludeConsultation(input: {
    tenantId: string;
    consultationId: string;
    endedAt: string;
    outcome: ConsultationOutcome;
    minutesRef?: string;
    feedbackSummary?: string;
  }): Promise<PolicyConsultation> {
    const consultation = await this.getConsultation(
      input.tenantId,
      input.consultationId,
    );
    if (consultation.outcome !== "PENDING") {
      throw new ConflictError(
        `consultation ${consultation.id} is already concluded`,
      );
    }
    if (input.endedAt < consultation.startedAt) {
      throw new ConflictError("endedAt must not be before startedAt");
    }
    consultation.endedAt = input.endedAt;
    consultation.outcome = input.outcome;
    consultation.minutesRef = input.minutesRef ?? consultation.minutesRef;
    consultation.feedbackSummary =
      input.feedbackSummary ?? consultation.feedbackSummary;
    return consultation;
  }

  async createDpia(input: {
    tenantId: string;
    assessmentType: DpiaAssessmentType;
    scope: string;
    riskSummary?: Record<string, unknown>;
    mitigationSummary?: Record<string, unknown>;
  }): Promise<DpiaRecord> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const dpia: DpiaRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      assessmentType: input.assessmentType,
      scope: input.scope,
      status: "DRAFT",
      riskSummary: input.riskSummary ?? {},
      mitigationSummary: input.mitigationSummary ?? {},
      createdAt: now(),
    };
    this.dpias.set(dpia.id, dpia);
    return dpia;
  }

  async listDpias(tenantId: string): Promise<DpiaRecord[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.dpias.values()]
      .filter((dpia) => dpia.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getDpia(tenantId: string, dpiaId: string): Promise<DpiaRecord> {
    const dpia = this.dpias.get(dpiaId);
    if (!dpia || dpia.tenantId !== tenantId) notFound("DpiaRecord", dpiaId);
    return dpia;
  }

  async approveDpia(input: {
    tenantId: string;
    dpiaId: string;
    approvedBy: string;
  }): Promise<DpiaRecord> {
    const dpia = await this.getDpia(input.tenantId, input.dpiaId);
    if (dpia.status === "APPROVED") {
      throw new ConflictError(`DPIA ${dpia.id} is already approved`);
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    dpia.status = "APPROVED";
    dpia.approvedBy = input.approvedBy;
    dpia.approvedAt = now();
    return dpia;
  }

  async createDsar(input: {
    tenantId: string;
    personId: string;
    requestType: DsarRequestType;
    dueAt?: string;
  }): Promise<DsarRequest> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    const timestamp = now();
    const dsar: DsarRequest = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      requestType: input.requestType,
      status: "OPEN",
      receivedAt: timestamp,
      dueAt: input.dueAt,
      createdAt: timestamp,
    };
    this.dsars.set(dsar.id, dsar);
    return dsar;
  }

  async listDsars(
    tenantId: string,
    personId?: string,
  ): Promise<DsarRequest[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.dsars.values()]
      .filter(
        (dsar) =>
          dsar.tenantId === tenantId &&
          (!personId || dsar.personId === personId),
      )
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async getDsar(tenantId: string, dsarId: string): Promise<DsarRequest> {
    const dsar = this.dsars.get(dsarId);
    if (!dsar || dsar.tenantId !== tenantId) notFound("DsarRequest", dsarId);
    return dsar;
  }

  async resolveDsar(input: {
    tenantId: string;
    dsarId: string;
    resolution: "RESOLVED" | "REJECTED";
    resolutionRef: string;
  }): Promise<DsarRequest> {
    const dsar = await this.getDsar(input.tenantId, input.dsarId);
    if (dsar.status !== "OPEN") {
      throw new ConflictError(`DSAR ${dsar.id} is already ${dsar.status}`);
    }
    dsar.status = input.resolution;
    dsar.resolutionRef = input.resolutionRef;
    dsar.resolvedAt = now();
    return dsar;
  }

  async createRetentionPolicy(input: {
    tenantId: string;
    dataCategory: string;
    retentionMonths: number;
    legalBasis: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.retentionPolicies.values()].some(
        (policy) =>
          policy.tenantId === input.tenantId &&
          policy.dataCategory === input.dataCategory,
      )
    ) {
      throw new ConflictError(
        `retention policy for ${input.dataCategory} already exists`,
      );
    }
    const policy: RetentionPolicy = {
      id: randomUUID(),
      tenantId: input.tenantId,
      dataCategory: input.dataCategory,
      retentionMonths: input.retentionMonths,
      legalBasis: input.legalBasis,
      legalHold: input.legalHold,
      createdAt: now(),
    };
    this.retentionPolicies.set(policy.id, policy);
    return policy;
  }

  async listRetentionPolicies(tenantId: string): Promise<RetentionPolicy[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.retentionPolicies.values()]
      .filter((policy) => policy.tenantId === tenantId)
      .sort((a, b) => a.dataCategory.localeCompare(b.dataCategory));
  }

  async setRetentionLegalHold(input: {
    tenantId: string;
    retentionPolicyId: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy> {
    const policy = this.retentionPolicies.get(input.retentionPolicyId);
    if (!policy || policy.tenantId !== input.tenantId) {
      notFound("RetentionPolicy", input.retentionPolicyId);
    }
    policy.legalHold = input.legalHold;
    return policy;
  }

  async createRetentionDisposalRequest(input: {
    tenantId: string;
    retentionPolicyId: string;
    requestedBy: string;
    reason: string;
    scheduledFor?: string;
  }): Promise<RetentionDisposalRequest> {
    const policy = this.retentionPolicies.get(input.retentionPolicyId);
    if (!policy || policy.tenantId !== input.tenantId) {
      notFound("RetentionPolicy", input.retentionPolicyId);
    }
    if (policy.legalHold) {
      throw new ConflictError(
        "RETENTION_LEGAL_HOLD: disposal is blocked while legal hold is active",
      );
    }
    const requester = this.persons.get(input.requestedBy);
    if (!requester || requester.tenantId !== input.tenantId) {
      notFound("Person", input.requestedBy);
    }
    const scheduledFor =
      input.scheduledFor ??
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    if (Date.parse(scheduledFor) <= Date.now()) {
      throw new ConflictError(
        "RETENTION_GRACE_PERIOD_REQUIRED: scheduledFor must be in the future",
      );
    }
    const request: RetentionDisposalRequest = {
      id: randomUUID(),
      tenantId: input.tenantId,
      retentionPolicyId: policy.id,
      dataCategory: policy.dataCategory,
      requestedBy: input.requestedBy,
      status: "REQUESTED",
      reason: input.reason,
      requestedAt: now(),
      scheduledFor,
    };
    this.retentionDisposals.set(request.id, request);
    return request;
  }

  async listRetentionDisposalRequests(
    tenantId: string,
  ): Promise<RetentionDisposalRequest[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.retentionDisposals.values()]
      .filter((request) => request.tenantId === tenantId)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  async approveRetentionDisposalRequest(input: {
    tenantId: string;
    requestId: string;
    approvedBy: string;
  }): Promise<RetentionDisposalRequest> {
    const request = this.retentionDisposals.get(input.requestId);
    if (!request || request.tenantId !== input.tenantId) {
      notFound("RetentionDisposalRequest", input.requestId);
    }
    if (request.status !== "REQUESTED") {
      throw new ConflictError(`retention disposal is ${request.status}`);
    }
    if (request.requestedBy === input.approvedBy) {
      throw new ConflictError("RETENTION_SECOND_PERSON_REQUIRED");
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    request.status = "APPROVED";
    request.approvedBy = input.approvedBy;
    request.approvedAt = now();
    return request;
  }

  async completeRetentionDisposalRequest(input: {
    tenantId: string;
    requestId: string;
    actorPersonId: string;
  }): Promise<RetentionDisposalRequest> {
    const request = this.retentionDisposals.get(input.requestId);
    if (!request || request.tenantId !== input.tenantId) {
      notFound("RetentionDisposalRequest", input.requestId);
    }
    if (request.status !== "APPROVED") {
      throw new ConflictError(`retention disposal is ${request.status}`);
    }
    if (Date.now() < Date.parse(request.scheduledFor)) {
      throw new ConflictError("RETENTION_GRACE_PERIOD_ACTIVE");
    }
    const policy = this.retentionPolicies.get(request.retentionPolicyId);
    if (policy?.legalHold) {
      throw new ConflictError(
        "RETENTION_LEGAL_HOLD: disposal is blocked while legal hold is active",
      );
    }
    const actor = this.persons.get(input.actorPersonId);
    if (!actor || actor.tenantId !== input.tenantId) {
      notFound("Person", input.actorPersonId);
    }
    request.status = "COMPLETED";
    request.completedAt = now();
    return request;
  }

  async cancelRetentionDisposalRequest(input: {
    tenantId: string;
    requestId: string;
    actorPersonId: string;
    reason: string;
  }): Promise<RetentionDisposalRequest> {
    const request = this.retentionDisposals.get(input.requestId);
    if (!request || request.tenantId !== input.tenantId) {
      notFound("RetentionDisposalRequest", input.requestId);
    }
    if (!["REQUESTED", "APPROVED"].includes(request.status)) {
      throw new ConflictError(`retention disposal is ${request.status}`);
    }
    request.status = "CANCELLED";
    request.cancelledAt = now();
    request.cancelReason = input.reason;
    return request;
  }

  async createAppealEvidenceDisclosure(input: {
    tenantId: string;
    appealId: string;
    disclosedBy: string;
    method: AppealEvidenceDisclosure["method"];
    evidenceRefs: string[];
    note?: string;
  }): Promise<AppealEvidenceDisclosure> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const discloser = this.persons.get(input.disclosedBy);
    if (!discloser || discloser.tenantId !== input.tenantId) {
      notFound("Person", input.disclosedBy);
    }
    const disclosure: AppealEvidenceDisclosure = {
      id: randomUUID(),
      tenantId: input.tenantId,
      appealId: input.appealId,
      disclosedBy: input.disclosedBy,
      method: input.method,
      evidenceRefs: [...input.evidenceRefs],
      note: input.note,
      disclosedAt: now(),
      createdAt: now(),
    };
    this.appealEvidenceDisclosures.set(disclosure.id, disclosure);
    return disclosure;
  }

  async listAppealEvidenceDisclosures(
    tenantId: string,
    appealId: string,
  ): Promise<AppealEvidenceDisclosure[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.appealEvidenceDisclosures.values()]
      .filter(
        (disclosure) =>
          disclosure.tenantId === tenantId &&
          disclosure.appealId === appealId,
      )
      .sort((a, b) => b.disclosedAt.localeCompare(a.disclosedAt));
  }

  async recordWorkforceSubgroupAttribute(input: {
    tenantId: string;
    personId: string;
    dimension: WorkforceSubgroupDimension;
    value: string;
    consentRef: string;
    consentedAt: string;
    expiresAt?: string;
    recordedBy?: string;
  }): Promise<WorkforceSubgroupAttribute> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
      throw new ConflictError("SUBGROUP_CONSENT_EXPIRED");
    }
    const existing = [...this.workforceSubgroupAttributes.values()].find(
      (attribute) =>
        attribute.tenantId === input.tenantId &&
        attribute.personId === input.personId &&
        attribute.dimension === input.dimension,
    );
    const timestamp = now();
    if (existing) {
      existing.value = input.value.trim();
      existing.consentRef = input.consentRef;
      existing.consentedAt = input.consentedAt;
      existing.expiresAt = input.expiresAt;
      existing.recordedBy = input.recordedBy;
      existing.updatedAt = timestamp;
      return existing;
    }
    const attribute: WorkforceSubgroupAttribute = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      dimension: input.dimension,
      value: input.value.trim(),
      consentRef: input.consentRef,
      consentedAt: input.consentedAt,
      expiresAt: input.expiresAt,
      recordedBy: input.recordedBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.workforceSubgroupAttributes.set(attribute.id, attribute);
    return attribute;
  }

  async listWorkforceSubgroupAttributes(
    tenantId: string,
    filter?: {
      personId?: string;
      dimension?: WorkforceSubgroupDimension;
    },
  ): Promise<WorkforceSubgroupAttribute[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.workforceSubgroupAttributes.values()]
      .filter(
        (attribute) =>
          attribute.tenantId === tenantId &&
          (!filter?.personId || attribute.personId === filter.personId) &&
          (!filter?.dimension ||
            attribute.dimension === filter.dimension),
      )
      .sort((a, b) =>
        `${a.dimension}:${a.personId}`.localeCompare(
          `${b.dimension}:${b.personId}`,
        ),
      );
  }

  async withdrawWorkforceSubgroupAttribute(input: {
    tenantId: string;
    personId: string;
    dimension: WorkforceSubgroupDimension;
  }): Promise<WorkforceSubgroupAttribute> {
    const attribute = [...this.workforceSubgroupAttributes.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.personId === input.personId &&
        candidate.dimension === input.dimension,
    );
    if (!attribute) {
      notFound(
        "WorkforceSubgroupAttribute",
        `${input.personId}:${input.dimension}`,
      );
    }
    this.workforceSubgroupAttributes.delete(attribute.id);
    return attribute;
  }

  async createDataSource(input: {
    tenantId: string;
    code: string;
    name: string;
    category: string;
    ownerPersonId: string;
    backupOwnerPersonId?: string;
    slaHours: number;
    criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    containsPersonalData: boolean;
    storageRegion: string;
    crossBorderTransfers: boolean;
    processorRefs: string[];
    fields: DataSourceField[];
    lastReviewedAt?: string;
  }): Promise<DataSource> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.dataSources.values()].some(
        (source) =>
          source.tenantId === input.tenantId && source.code === input.code,
      )
    ) {
      throw new ConflictError(`data source code ${input.code} already exists`);
    }
    const timestamp = now();
    const source: DataSource = {
      id: randomUUID(),
      tenantId: input.tenantId,
      code: input.code,
      name: input.name,
      category: input.category,
      ownerPersonId: input.ownerPersonId,
      backupOwnerPersonId: input.backupOwnerPersonId,
      slaHours: input.slaHours,
      criticality: input.criticality,
      containsPersonalData: input.containsPersonalData,
      storageRegion: input.storageRegion,
      crossBorderTransfers: input.crossBorderTransfers,
      processorRefs: [...input.processorRefs],
      fields: input.fields.map((field) => ({ ...field })),
      status: "ACTIVE",
      lastReviewedAt: input.lastReviewedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.dataSources.set(source.id, source);
    return source;
  }

  async listDataSources(tenantId: string): Promise<DataSource[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.dataSources.values()]
      .filter((source) => source.tenantId === tenantId)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async getDataSource(
    tenantId: string,
    dataSourceId: string,
  ): Promise<DataSource> {
    const source = this.dataSources.get(dataSourceId);
    if (!source || source.tenantId !== tenantId) {
      notFound("DataSource", dataSourceId);
    }
    return source;
  }

  async retireDataSource(input: {
    tenantId: string;
    dataSourceId: string;
  }): Promise<DataSource> {
    const source = await this.getDataSource(
      input.tenantId,
      input.dataSourceId,
    );
    if (source.status === "RETIRED") {
      throw new ConflictError(`data source ${source.id} is already retired`);
    }
    source.status = "RETIRED";
    source.updatedAt = now();
    source.version += 1;
    return source;
  }

  async createConflictDeclaration(input: {
    tenantId: string;
    personId: string;
    relatedPersonId: string;
    relationshipType: string;
    description: string;
  }): Promise<ConflictDeclaration> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (input.personId === input.relatedPersonId) {
      throw new ConflictError(
        "CONFLICT_SELF_DECLARATION: related person must differ",
      );
    }
    for (const personId of [input.personId, input.relatedPersonId]) {
      const person = this.persons.get(personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", personId);
      }
    }
    if (
      [...this.conflictDeclarations.values()].some(
        (declaration) =>
          declaration.tenantId === input.tenantId &&
          declaration.status === "ACTIVE" &&
          ((declaration.personId === input.personId &&
            declaration.relatedPersonId === input.relatedPersonId) ||
            (declaration.personId === input.relatedPersonId &&
              declaration.relatedPersonId === input.personId)),
      )
    ) {
      throw new ConflictError(
        "CONFLICT_DECLARATION_EXISTS: an active declaration already covers this pair",
      );
    }
    const timestamp = now();
    const declaration: ConflictDeclaration = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      relatedPersonId: input.relatedPersonId,
      relationshipType: input.relationshipType,
      description: input.description,
      status: "ACTIVE",
      declaredAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.conflictDeclarations.set(declaration.id, declaration);
    return declaration;
  }

  async listConflictDeclarations(
    tenantId: string,
    personId?: string,
  ): Promise<ConflictDeclaration[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.conflictDeclarations.values()]
      .filter(
        (declaration) =>
          declaration.tenantId === tenantId &&
          (!personId ||
            declaration.personId === personId ||
            declaration.relatedPersonId === personId),
      )
      .sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));
  }

  async revokeConflictDeclaration(input: {
    tenantId: string;
    declarationId: string;
    reason: string;
  }): Promise<ConflictDeclaration> {
    const declaration = this.conflictDeclarations.get(input.declarationId);
    if (!declaration || declaration.tenantId !== input.tenantId) {
      notFound("ConflictDeclaration", input.declarationId);
    }
    if (declaration.status === "REVOKED") {
      throw new ConflictError(
        `conflict declaration ${declaration.id} is already revoked`,
      );
    }
    declaration.status = "REVOKED";
    declaration.revokedAt = now();
    declaration.revocationReason = input.reason;
    declaration.updatedAt = declaration.revokedAt;
    return declaration;
  }

  async findConflictDeclaration(
    tenantId: string,
    personA: string,
    personB: string,
  ): Promise<ConflictDeclaration | undefined> {
    return [...this.conflictDeclarations.values()].find(
      (declaration) =>
        declaration.tenantId === tenantId &&
        declaration.status === "ACTIVE" &&
        ((declaration.personId === personA &&
          declaration.relatedPersonId === personB) ||
          (declaration.personId === personB &&
            declaration.relatedPersonId === personA)),
    );
  }

  async createTrustSurvey(input: {
    tenantId: string;
    code: string;
    period: string;
    title: string;
    questions: TrustSurveyQuestion[];
  }): Promise<TrustSurveyRun> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.trustSurveys.values()].some(
        (survey) =>
          survey.tenantId === input.tenantId &&
          survey.code === input.code &&
          survey.period === input.period,
      )
    ) {
      throw new ConflictError(
        `trust survey ${input.code}/${input.period} already exists`,
      );
    }
    const timestamp = now();
    const survey: TrustSurveyRun = {
      id: randomUUID(),
      tenantId: input.tenantId,
      code: input.code,
      period: input.period,
      title: input.title,
      status: "DRAFT",
      anonymous: true,
      questions: input.questions.map((question) => ({ ...question })),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.trustSurveys.set(survey.id, survey);
    return survey;
  }

  async listTrustSurveys(tenantId: string): Promise<TrustSurveyRun[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.trustSurveys.values()]
      .filter((survey) => survey.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getTrustSurvey(
    tenantId: string,
    surveyId: string,
  ): Promise<TrustSurveyRun> {
    const survey = this.trustSurveys.get(surveyId);
    if (!survey || survey.tenantId !== tenantId) {
      notFound("TrustSurvey", surveyId);
    }
    return survey;
  }

  async openTrustSurvey(input: {
    tenantId: string;
    surveyId: string;
  }): Promise<TrustSurveyRun> {
    const survey = await this.getTrustSurvey(input.tenantId, input.surveyId);
    if (survey.status !== "DRAFT") {
      throw new ConflictError(`trust survey is ${survey.status}`);
    }
    survey.status = "OPEN";
    survey.openedAt = now();
    survey.updatedAt = survey.openedAt;
    return survey;
  }

  async closeTrustSurvey(input: {
    tenantId: string;
    surveyId: string;
  }): Promise<TrustSurveyRun> {
    const survey = await this.getTrustSurvey(input.tenantId, input.surveyId);
    if (survey.status !== "OPEN") {
      throw new ConflictError(`trust survey is ${survey.status}`);
    }
    survey.status = "CLOSED";
    survey.closedAt = now();
    survey.updatedAt = survey.closedAt;
    return survey;
  }

  async submitTrustSurveyResponse(input: {
    tenantId: string;
    surveyId: string;
    personId: string;
    scores: Record<string, number>;
  }): Promise<TrustSurveyResponse> {
    const survey = await this.getTrustSurvey(input.tenantId, input.surveyId);
    if (survey.status !== "OPEN") {
      throw new ConflictError(`trust survey is ${survey.status}`);
    }
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    for (const question of survey.questions) {
      const value = input.scores[question.code];
      if (typeof value !== "number" || value < 1 || value > 5) {
        throw new ConflictError(
          `TRUST_SURVEY_SCORE_REQUIRED:${question.code}`,
        );
      }
    }
    const respondentHash = sha256(
      `${input.tenantId}:${input.surveyId}:${input.personId}`,
    );
    if (
      [...this.trustSurveyResponses.values()].some(
        (response) =>
          response.tenantId === input.tenantId &&
          response.surveyId === input.surveyId &&
          response.respondentHash === respondentHash,
      )
    ) {
      throw new ConflictError(
        "TRUST_SURVEY_ALREADY_SUBMITTED: this person already responded",
      );
    }
    const response: TrustSurveyResponse = {
      id: randomUUID(),
      tenantId: input.tenantId,
      surveyId: input.surveyId,
      respondentHash,
      scores: { ...input.scores },
      submittedAt: now(),
    };
    this.trustSurveyResponses.set(response.id, response);
    return response;
  }

  async getTrustSurveyReport(
    tenantId: string,
    surveyId: string,
  ): Promise<TrustSurveyReport> {
    const survey = await this.getTrustSurvey(tenantId, surveyId);
    const responses = [...this.trustSurveyResponses.values()].filter(
      (response) =>
        response.tenantId === tenantId && response.surveyId === surveyId,
    );
    const baselineSurvey = [...this.trustSurveys.values()]
      .filter(
        (candidate) =>
          candidate.tenantId === tenantId &&
          candidate.code === survey.code &&
          candidate.id !== survey.id &&
          candidate.status === "CLOSED",
      )
      .sort((a, b) =>
        (b.closedAt ?? b.updatedAt).localeCompare(
          a.closedAt ?? a.updatedAt,
        ),
      )[0];
    if (!baselineSurvey) {
      return aggregateSurveyReport(survey, responses);
    }
    return aggregateSurveyReport(survey, responses, {
      survey: baselineSurvey,
      responses: [...this.trustSurveyResponses.values()].filter(
        (response) =>
          response.tenantId === tenantId &&
          response.surveyId === baselineSurvey.id,
      ),
    });
  }

  async createFairnessCommitment(input: {
    tenantId: string;
    statement: string;
    ownerPersonId: string;
    channels: string[];
  }): Promise<FairnessCommitment> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const owner = this.persons.get(input.ownerPersonId);
    if (!owner || owner.tenantId !== input.tenantId) {
      notFound("Person", input.ownerPersonId);
    }
    const existing = [...this.fairnessCommitments.values()].filter(
      (commitment) => commitment.tenantId === input.tenantId,
    );
    for (const commitment of existing) {
      if (commitment.status === "ACTIVE") commitment.status = "SUPERSEDED";
    }
    const version =
      existing.reduce(
        (highest, commitment) => Math.max(highest, commitment.version),
        0,
      ) + 1;
    const commitment: FairnessCommitment = {
      id: randomUUID(),
      tenantId: input.tenantId,
      version,
      statement: input.statement,
      ownerPersonId: input.ownerPersonId,
      channels: [...input.channels],
      status: "ACTIVE",
      publishedAt: now(),
      createdAt: now(),
    };
    this.fairnessCommitments.set(commitment.id, commitment);
    return commitment;
  }

  async listFairnessCommitments(
    tenantId: string,
  ): Promise<FairnessCommitment[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.fairnessCommitments.values()]
      .filter((commitment) => commitment.tenantId === tenantId)
      .sort((a, b) => b.version - a.version);
  }

  async getActiveFairnessCommitment(
    tenantId: string,
  ): Promise<FairnessCommitment | undefined> {
    return [...this.fairnessCommitments.values()].find(
      (commitment) =>
        commitment.tenantId === tenantId &&
        commitment.status === "ACTIVE",
    );
  }

  async createManagerTrainingRecord(input: {
    tenantId: string;
    personId: string;
    trainingCode: string;
    title: string;
    completedAt: string;
    expiresAt?: string;
    evidenceRef?: string;
  }): Promise<ManagerTrainingRecord> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (
      input.expiresAt &&
      Date.parse(input.expiresAt) <= Date.parse(input.completedAt)
    ) {
      throw new ConflictError("TRAINING_EXPIRY_BEFORE_COMPLETION");
    }
    const record: ManagerTrainingRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      trainingCode: input.trainingCode,
      title: input.title,
      completedAt: input.completedAt,
      expiresAt: input.expiresAt,
      evidenceRef: input.evidenceRef,
      createdAt: now(),
    };
    this.managerTrainingRecords.set(record.id, record);
    return record;
  }

  async listManagerTrainingRecords(
    tenantId: string,
    personId?: string,
  ): Promise<ManagerTrainingRecord[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.managerTrainingRecords.values()]
      .filter(
        (record) =>
          record.tenantId === tenantId &&
          (!personId || record.personId === personId),
      )
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  }

  async createCalibrationSession(input: {
    tenantId: string;
    code: string;
    title: string;
    heldAt: string;
    facilitatorPersonId: string;
    attendeePersonIds: string[];
    policyVersionId?: string;
    notes?: string;
  }): Promise<CalibrationSession> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const facilitator = this.persons.get(input.facilitatorPersonId);
    if (!facilitator || facilitator.tenantId !== input.tenantId) {
      notFound("Person", input.facilitatorPersonId);
    }
    for (const attendeeId of input.attendeePersonIds) {
      const attendee = this.persons.get(attendeeId);
      if (!attendee || attendee.tenantId !== input.tenantId) {
        notFound("Person", attendeeId);
      }
    }
    const session: CalibrationSession = {
      id: randomUUID(),
      tenantId: input.tenantId,
      code: input.code,
      title: input.title,
      heldAt: input.heldAt,
      facilitatorPersonId: input.facilitatorPersonId,
      attendeePersonIds: [...input.attendeePersonIds],
      policyVersionId: input.policyVersionId,
      notes: input.notes,
      createdAt: now(),
    };
    this.calibrationSessions.set(session.id, session);
    return session;
  }

  async listCalibrationSessions(
    tenantId: string,
  ): Promise<CalibrationSession[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.calibrationSessions.values()]
      .filter((session) => session.tenantId === tenantId)
      .sort((a, b) => b.heldAt.localeCompare(a.heldAt));
  }

  async createPilotEnrollment(input: {
    tenantId: string;
    personId: string;
    pilotCode: string;
    scope: string;
    consentSignatureRef: string;
    consentSignedAt?: string;
  }): Promise<PilotEnrollment> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (!input.consentSignatureRef.trim()) {
      throw new ConflictError("PILOT_CONSENT_SIGNATURE_REQUIRED");
    }
    if (
      [...this.pilotEnrollments.values()].some(
        (enrollment) =>
          enrollment.tenantId === input.tenantId &&
          enrollment.personId === input.personId &&
          enrollment.pilotCode === input.pilotCode &&
          enrollment.status === "ACTIVE",
      )
    ) {
      throw new ConflictError(
        "PILOT_ENROLLMENT_EXISTS: this person is already enrolled",
      );
    }
    const timestamp = now();
    const enrollment: PilotEnrollment = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      pilotCode: input.pilotCode,
      scope: input.scope,
      consentSignatureRef: input.consentSignatureRef,
      consentSignedAt: input.consentSignedAt ?? timestamp,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.pilotEnrollments.set(enrollment.id, enrollment);
    return enrollment;
  }

  async listPilotEnrollments(
    tenantId: string,
    personId?: string,
  ): Promise<PilotEnrollment[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.pilotEnrollments.values()]
      .filter(
        (enrollment) =>
          enrollment.tenantId === tenantId &&
          (!personId || enrollment.personId === personId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async withdrawPilotEnrollment(input: {
    tenantId: string;
    enrollmentId: string;
    reason?: string;
  }): Promise<PilotEnrollment> {
    const enrollment = this.pilotEnrollments.get(input.enrollmentId);
    if (!enrollment || enrollment.tenantId !== input.tenantId) {
      notFound("PilotEnrollment", input.enrollmentId);
    }
    if (enrollment.status === "WITHDRAWN") {
      throw new ConflictError(
        `pilot enrollment ${enrollment.id} is already withdrawn`,
      );
    }
    enrollment.status = "WITHDRAWN";
    enrollment.withdrawnAt = now();
    enrollment.withdrawalReason = input.reason;
    enrollment.updatedAt = enrollment.withdrawnAt;
    return enrollment;
  }

  async createBreakGlassGrant(input: {
    tenantId: string;
    scope: BreakGlassGrant["scope"];
    granteePersonId: string;
    reason: string;
    grantedBy: string;
    expiresAt: string;
  }): Promise<BreakGlassGrant> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    for (const personId of [input.granteePersonId, input.grantedBy]) {
      const person = this.persons.get(personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", personId);
      }
    }
    if (input.granteePersonId === input.grantedBy) {
      throw new ConflictError(
        "BREAK_GLASS_SELF_GRANT: a grant must be approved by another person",
      );
    }
    const expiresAt = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new ConflictError("BREAK_GLASS_EXPIRY_REQUIRED");
    }
    if (expiresAt > Date.now() + 24 * 60 * 60 * 1000) {
      throw new ConflictError("BREAK_GLASS_MAX_24_HOURS");
    }
    const grant: BreakGlassGrant = {
      id: randomUUID(),
      tenantId: input.tenantId,
      scope: input.scope,
      granteePersonId: input.granteePersonId,
      reason: input.reason,
      grantedBy: input.grantedBy,
      expiresAt: input.expiresAt,
      status: "ACTIVE",
      createdAt: now(),
    };
    this.breakGlassGrants.set(grant.id, grant);
    return grant;
  }

  async listBreakGlassGrants(tenantId: string): Promise<BreakGlassGrant[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.breakGlassGrants.values()]
      .filter((grant) => grant.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revokeBreakGlassGrant(input: {
    tenantId: string;
    grantId: string;
  }): Promise<BreakGlassGrant> {
    const grant = this.breakGlassGrants.get(input.grantId);
    if (!grant || grant.tenantId !== input.tenantId) {
      notFound("BreakGlassGrant", input.grantId);
    }
    if (grant.status === "REVOKED") {
      throw new ConflictError(`break-glass grant ${grant.id} is already revoked`);
    }
    grant.status = "REVOKED";
    grant.revokedAt = now();
    return grant;
  }

  async findActiveBreakGlassGrant(
    tenantId: string,
    granteePersonId: string,
    scope: BreakGlassGrant["scope"],
  ): Promise<BreakGlassGrant | undefined> {
    return [...this.breakGlassGrants.values()].find(
      (grant) =>
        grant.tenantId === tenantId &&
        grant.granteePersonId === granteePersonId &&
        grant.scope === scope &&
        grant.status === "ACTIVE" &&
        Date.parse(grant.expiresAt) > Date.now(),
    );
  }

  async createClawbackCase(input: {
    tenantId: string;
    personId: string;
    amount: string;
    currency: string;
    reasonCode: string;
    explanation: string;
    consentSignatureRef: string;
    installmentMonths: number;
    hardshipWaiver: boolean;
    hardshipReason?: string;
    requestedBy: string;
  }): Promise<ClawbackCase> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    for (const personId of [input.personId, input.requestedBy]) {
      const person = this.persons.get(personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", personId);
      }
    }
    if (parseDecimal(input.amount) <= 0n) {
      throw new ConflictError("CLAWBACK_AMOUNT_MUST_BE_POSITIVE");
    }
    if (!input.consentSignatureRef.trim()) {
      throw new ConflictError("CLAWBACK_CONSENT_REQUIRED");
    }
    if (input.installmentMonths < 1 || input.installmentMonths > 12) {
      throw new ConflictError("CLAWBACK_INSTALLMENTS_OUT_OF_RANGE");
    }
    if (input.hardshipWaiver && !input.hardshipReason?.trim()) {
      throw new ConflictError("CLAWBACK_HARDSHIP_REASON_REQUIRED");
    }
    const timestamp = now();
    const clawback: ClawbackCase = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      amount: formatDecimal(parseDecimal(input.amount)),
      currency: input.currency,
      reasonCode: input.reasonCode,
      explanation: input.explanation,
      consentSignatureRef: input.consentSignatureRef,
      installmentMonths: input.installmentMonths,
      hardshipWaiver: input.hardshipWaiver,
      hardshipReason: input.hardshipReason,
      status: "DRAFT",
      requestedBy: input.requestedBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.clawbackCases.set(clawback.id, clawback);
    return clawback;
  }

  async listClawbackCases(
    tenantId: string,
    personId?: string,
  ): Promise<ClawbackCase[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.clawbackCases.values()]
      .filter(
        (clawback) =>
          clawback.tenantId === tenantId &&
          (!personId || clawback.personId === personId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async approveClawbackCase(input: {
    tenantId: string;
    caseId: string;
    approvedBy: string;
  }): Promise<ClawbackCase> {
    const clawback = this.clawbackCases.get(input.caseId);
    if (!clawback || clawback.tenantId !== input.tenantId) {
      notFound("ClawbackCase", input.caseId);
    }
    if (clawback.status !== "DRAFT") {
      throw new ConflictError(`clawback case is ${clawback.status}`);
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    if (input.approvedBy === clawback.requestedBy) {
      throw new ConflictError(
        "CLAWBACK_SELF_APPROVAL: requester cannot approve the case",
      );
    }
    clawback.status = "APPROVED";
    clawback.approvedBy = input.approvedBy;
    clawback.approvedAt = now();
    clawback.updatedAt = clawback.approvedAt;
    return clawback;
  }

  async closeClawbackCase(input: {
    tenantId: string;
    caseId: string;
    action: "WAIVE" | "CANCEL";
    reason: string;
    actorPersonId: string;
  }): Promise<ClawbackCase> {
    const clawback = this.clawbackCases.get(input.caseId);
    if (!clawback || clawback.tenantId !== input.tenantId) {
      notFound("ClawbackCase", input.caseId);
    }
    if (!["DRAFT", "APPROVED"].includes(clawback.status)) {
      throw new ConflictError(`clawback case is ${clawback.status}`);
    }
    const actor = this.persons.get(input.actorPersonId);
    if (!actor || actor.tenantId !== input.tenantId) {
      notFound("Person", input.actorPersonId);
    }
    if (input.action === "WAIVE") {
      clawback.status = "WAIVED";
      clawback.waivedAt = now();
      clawback.waiverReason = input.reason;
      clawback.updatedAt = clawback.waivedAt;
    } else {
      clawback.status = "CANCELLED";
      clawback.cancelledAt = now();
      clawback.cancelReason = input.reason;
      clawback.updatedAt = clawback.cancelledAt;
    }
    return clawback;
  }

  async createDiscretionaryPoolReview(input: {
    tenantId: string;
    poolId: string;
    committeePersonIds: string[];
    employeeObserverPersonId?: string;
    selectionCriteria: string;
    decisionNotes: string;
    reviewedBy: string;
  }): Promise<DiscretionaryPoolReview> {
    const pool = await this.getBudgetPool(input.tenantId, input.poolId);
    if (input.committeePersonIds.length < 2) {
      throw new ConflictError("DISCRETIONARY_COMMITTEE_MIN_TWO");
    }
    if (
      input.employeeObserverPersonId &&
      input.committeePersonIds.includes(input.employeeObserverPersonId)
    ) {
      throw new ConflictError(
        "DISCRETIONARY_OBSERVER_MUST_BE_INDEPENDENT",
      );
    }
    for (const personId of [
      ...input.committeePersonIds,
      ...(input.employeeObserverPersonId
        ? [input.employeeObserverPersonId]
        : []),
      input.reviewedBy,
    ]) {
      const person = this.persons.get(personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", personId);
      }
    }
    const review: DiscretionaryPoolReview = {
      id: randomUUID(),
      tenantId: input.tenantId,
      poolId: pool.id,
      committeePersonIds: [...input.committeePersonIds],
      employeeObserverPersonId: input.employeeObserverPersonId,
      selectionCriteria: input.selectionCriteria,
      decisionNotes: input.decisionNotes,
      reviewedBy: input.reviewedBy,
      reviewedAt: now(),
      createdAt: now(),
    };
    this.discretionaryPoolReviews.set(review.id, review);
    return review;
  }

  async listDiscretionaryPoolReviews(
    tenantId: string,
    poolId?: string,
  ): Promise<DiscretionaryPoolReview[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.discretionaryPoolReviews.values()]
      .filter(
        (review) =>
          review.tenantId === tenantId &&
          (!poolId || review.poolId === poolId),
      )
      .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
  }

  async createModelProviderPolicy(input: {
    tenantId: string;
    provider: string;
    zeroRetentionConfirmed: boolean;
    dpaRef: string;
    inferenceRegion: string;
    egressAllowlist: string[];
    approvedBy: string;
  }): Promise<ModelProviderPolicy> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    if (!input.egressAllowlist.length) {
      throw new ConflictError("MODEL_PROVIDER_EGRESS_ALLOWLIST_REQUIRED");
    }
    const timestamp = now();
    const existing = [...this.modelProviderPolicies.values()].find(
      (policy) =>
        policy.tenantId === input.tenantId &&
        policy.provider === input.provider,
    );
    if (existing) {
      existing.zeroRetentionConfirmed = input.zeroRetentionConfirmed;
      existing.dpaRef = input.dpaRef;
      existing.inferenceRegion = input.inferenceRegion;
      existing.egressAllowlist = [...input.egressAllowlist];
      existing.approvedBy = input.approvedBy;
      existing.approvedAt = timestamp;
      existing.status = "ACTIVE";
      existing.retiredAt = undefined;
      existing.updatedAt = timestamp;
      return existing;
    }
    const policy: ModelProviderPolicy = {
      id: randomUUID(),
      tenantId: input.tenantId,
      provider: input.provider,
      zeroRetentionConfirmed: input.zeroRetentionConfirmed,
      dpaRef: input.dpaRef,
      inferenceRegion: input.inferenceRegion,
      egressAllowlist: [...input.egressAllowlist],
      approvedBy: input.approvedBy,
      approvedAt: timestamp,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.modelProviderPolicies.set(policy.id, policy);
    return policy;
  }

  async listModelProviderPolicies(
    tenantId: string,
  ): Promise<ModelProviderPolicy[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.modelProviderPolicies.values()]
      .filter((policy) => policy.tenantId === tenantId)
      .sort((a, b) => a.provider.localeCompare(b.provider));
  }

  async getActiveModelProviderPolicy(
    tenantId: string,
    provider: string,
  ): Promise<ModelProviderPolicy | undefined> {
    return [...this.modelProviderPolicies.values()].find(
      (policy) =>
        policy.tenantId === tenantId &&
        policy.provider === provider &&
        policy.status === "ACTIVE",
    );
  }

  async retireModelProviderPolicy(input: {
    tenantId: string;
    policyId: string;
  }): Promise<ModelProviderPolicy> {
    const policy = this.modelProviderPolicies.get(input.policyId);
    if (!policy || policy.tenantId !== input.tenantId) {
      notFound("ModelProviderPolicy", input.policyId);
    }
    if (policy.status === "RETIRED") {
      throw new ConflictError(
        `model provider policy ${policy.id} is already retired`,
      );
    }
    policy.status = "RETIRED";
    policy.retiredAt = now();
    policy.updatedAt = policy.retiredAt;
    return policy;
  }

  async createModelEvaluationDataset(input: {
    tenantId: string;
    code: string;
    version: number;
    name: string;
    sampleSize: number;
    holdoutSize: number;
    labelSource: string;
    ownerPersonId: string;
    refreshedAt?: string;
    nextRefreshDueAt?: string;
    contentHash?: string;
    samples?: ModelEvaluationDataset["samples"];
  }): Promise<ModelEvaluationDataset> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const owner = this.persons.get(input.ownerPersonId);
    if (!owner || owner.tenantId !== input.tenantId) {
      notFound("Person", input.ownerPersonId);
    }
    if (input.holdoutSize >= input.sampleSize) {
      throw new ConflictError(
        "GOLD_SET_HOLDOUT_TOO_LARGE: holdout must be smaller than sample",
      );
    }
    if (
      [...this.modelEvaluationDatasets.values()].some(
        (dataset) =>
          dataset.tenantId === input.tenantId &&
          dataset.code === input.code &&
          dataset.version === input.version,
      )
    ) {
      throw new ConflictError(
        `gold set ${input.code}@v${input.version} already exists`,
      );
    }
    const timestamp = now();
    const dataset: ModelEvaluationDataset = {
      id: randomUUID(),
      tenantId: input.tenantId,
      code: input.code,
      version: input.version,
      name: input.name,
      sampleSize: input.sampleSize,
      holdoutSize: input.holdoutSize,
      labelSource: input.labelSource,
      ownerPersonId: input.ownerPersonId,
      status: "ACTIVE",
      refreshedAt: input.refreshedAt ?? timestamp,
      nextRefreshDueAt: input.nextRefreshDueAt,
      contentHash: input.contentHash,
      samples: input.samples,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.modelEvaluationDatasets.set(dataset.id, dataset);
    return dataset;
  }

  async listModelEvaluationDatasets(
    tenantId: string,
  ): Promise<ModelEvaluationDataset[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.modelEvaluationDatasets.values()]
      .filter((dataset) => dataset.tenantId === tenantId)
      .sort((a, b) => b.refreshedAt.localeCompare(a.refreshedAt));
  }

  async getActiveModelEvaluationDataset(
    tenantId: string,
    code: string,
  ): Promise<ModelEvaluationDataset | undefined> {
    return [...this.modelEvaluationDatasets.values()]
      .filter(
        (dataset) =>
          dataset.tenantId === tenantId &&
          dataset.code === code &&
          dataset.status === "ACTIVE",
      )
      .sort((a, b) => b.version - a.version)[0];
  }

  async retireModelEvaluationDataset(input: {
    tenantId: string;
    datasetId: string;
  }): Promise<ModelEvaluationDataset> {
    const dataset = this.modelEvaluationDatasets.get(input.datasetId);
    if (!dataset || dataset.tenantId !== input.tenantId) {
      notFound("ModelEvaluationDataset", input.datasetId);
    }
    if (dataset.status === "RETIRED") {
      throw new ConflictError(
        `model evaluation dataset ${dataset.id} is already retired`,
      );
    }
    dataset.status = "RETIRED";
    dataset.retiredAt = now();
    dataset.updatedAt = dataset.retiredAt;
    return dataset;
  }

  async createModelCanaryRun(input: {
    tenantId: string;
    baselineEvaluationRunId: string;
    candidateEvaluationRunId: string;
    datasetRef: string;
    trafficPercent: number;
    passed: boolean;
    blockers: string[];
    metrics: Record<string, unknown>;
  }): Promise<ModelCanaryRun> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const canary: ModelCanaryRun = {
      id: randomUUID(),
      tenantId: input.tenantId,
      baselineEvaluationRunId: input.baselineEvaluationRunId,
      candidateEvaluationRunId: input.candidateEvaluationRunId,
      datasetRef: input.datasetRef,
      trafficPercent: input.trafficPercent,
      passed: input.passed,
      blockers: [...input.blockers],
      metrics: structuredClone(input.metrics),
      createdAt: now(),
    };
    this.modelCanaryRuns.set(canary.id, canary);
    return canary;
  }

  async listModelCanaryRuns(tenantId: string): Promise<ModelCanaryRun[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.modelCanaryRuns.values()]
      .filter((canary) => canary.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createAuditRedaction(input: {
    tenantId: string;
    auditEventId: string;
    replacement: string;
    reason: string;
    requestedBy: string;
    approvedBy: string;
  }): Promise<AuditRedaction> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    for (const personId of [input.requestedBy, input.approvedBy]) {
      const person = this.persons.get(personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", personId);
      }
    }
    if (input.requestedBy === input.approvedBy) {
      throw new ConflictError(
        "AUDIT_REDACTION_SECOND_PERSON_REQUIRED",
      );
    }
    if (
      [...this.auditRedactions.values()].some(
        (redaction) =>
          redaction.tenantId === input.tenantId &&
          redaction.auditEventId === input.auditEventId,
      )
    ) {
      throw new ConflictError("AUDIT_REDACTION_ALREADY_EXISTS");
    }
    const redaction: AuditRedaction = {
      id: randomUUID(),
      tenantId: input.tenantId,
      auditEventId: input.auditEventId,
      replacement: input.replacement,
      reason: input.reason,
      requestedBy: input.requestedBy,
      approvedBy: input.approvedBy,
      createdAt: now(),
    };
    this.auditRedactions.set(redaction.id, redaction);
    return redaction;
  }

  async listAuditRedactions(tenantId: string): Promise<AuditRedaction[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.auditRedactions.values()]
      .filter((redaction) => redaction.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createModelRedTeamRun(input: {
    tenantId: string;
    modelProvider: string;
    modelName: string;
    promptVersion: string;
    scope: string;
    testsRun: number;
    passed: boolean;
    findings: string[];
    artifactRef?: string;
    createdBy: string;
  }): Promise<ModelRedTeamRun> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const creator = this.persons.get(input.createdBy);
    if (!creator || creator.tenantId !== input.tenantId) {
      notFound("Person", input.createdBy);
    }
    if (!input.passed && input.findings.length === 0) {
      throw new ConflictError(
        "RED_TEAM_FINDINGS_REQUIRED: a failed run must list findings",
      );
    }
    const run: ModelRedTeamRun = {
      id: randomUUID(),
      tenantId: input.tenantId,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      promptVersion: input.promptVersion,
      scope: input.scope,
      testsRun: input.testsRun,
      passed: input.passed,
      findings: [...input.findings],
      artifactRef: input.artifactRef,
      createdBy: input.createdBy,
      createdAt: now(),
    };
    this.modelRedTeamRuns.set(run.id, run);
    return run;
  }

  async listModelRedTeamRuns(tenantId: string): Promise<ModelRedTeamRun[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.modelRedTeamRuns.values()]
      .filter((run) => run.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findPassedModelRedTeamRun(
    tenantId: string,
    modelProvider: string,
    modelName: string,
    promptVersion: string,
  ): Promise<ModelRedTeamRun | undefined> {
    return [...this.modelRedTeamRuns.values()].find(
      (run) =>
        run.tenantId === tenantId &&
        run.modelProvider === modelProvider &&
        run.modelName === modelName &&
        run.promptVersion === promptVersion &&
        run.passed,
    );
  }

  async createCompensationTemplate(input: {
    tenantId: string;
    code: string;
    name: string;
    roleCode: string;
    employmentType: CompensationTemplate["employmentType"];
    currency: string;
    fixedSalaryMin: string;
    fixedSalaryMax: string;
    deductionCapRate: string;
    variableShareCapRate: string;
    smoothingThresholdRate: string;
    deductionOrder: string[];
    deductionTypeCaps: Record<string, string>;
  }): Promise<CompensationTemplate> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const min = parseDecimal(input.fixedSalaryMin);
    const max = parseDecimal(input.fixedSalaryMax);
    if (min < 0n || max < min) {
      throw new ConflictError("COMPENSATION_TEMPLATE_SALARY_RANGE_INVALID");
    }
    if (
      [...this.compensationTemplates.values()].some(
        (template) =>
          template.tenantId === input.tenantId &&
          template.code === input.code,
      )
    ) {
      throw new ConflictError(
        `compensation template ${input.code} already exists`,
      );
    }
    const timestamp = now();
    const template: CompensationTemplate = {
      id: randomUUID(),
      tenantId: input.tenantId,
      code: input.code,
      name: input.name,
      roleCode: input.roleCode,
      employmentType: input.employmentType,
      currency: input.currency,
      fixedSalaryMin: formatDecimal(min),
      fixedSalaryMax: formatDecimal(max),
      deductionCapRate: formatDecimal(parseDecimal(input.deductionCapRate)),
      variableShareCapRate: formatDecimal(
        parseDecimal(input.variableShareCapRate),
      ),
      smoothingThresholdRate: formatDecimal(
        parseDecimal(input.smoothingThresholdRate),
      ),
      deductionOrder: [...input.deductionOrder],
      deductionTypeCaps: { ...input.deductionTypeCaps },
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.compensationTemplates.set(template.id, template);
    return template;
  }

  async listCompensationTemplates(
    tenantId: string,
  ): Promise<CompensationTemplate[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.compensationTemplates.values()]
      .filter((template) => template.tenantId === tenantId)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async getActiveCompensationTemplate(
    tenantId: string,
    code: string,
  ): Promise<CompensationTemplate | undefined> {
    return [...this.compensationTemplates.values()].find(
      (template) =>
        template.tenantId === tenantId &&
        template.code === code &&
        template.status === "ACTIVE",
    );
  }

  async retireCompensationTemplate(input: {
    tenantId: string;
    templateId: string;
  }): Promise<CompensationTemplate> {
    const template = this.compensationTemplates.get(input.templateId);
    if (!template || template.tenantId !== input.tenantId) {
      notFound("CompensationTemplate", input.templateId);
    }
    if (template.status === "RETIRED") {
      throw new ConflictError(
        `compensation template ${template.id} is already retired`,
      );
    }
    template.status = "RETIRED";
    template.updatedAt = now();
    return template;
  }

  async createESignEnvelope(input: {
    tenantId: string;
    contractId: string;
    provider: string;
    envelopeRef: string;
    documentHash: string;
    signerPersonId: string;
  }): Promise<ESignEnvelope> {
    const contract = this.employmentContracts.get(input.contractId);
    if (!contract || contract.tenantId !== input.tenantId) {
      notFound("EmploymentContract", input.contractId);
    }
    const signer = this.persons.get(input.signerPersonId);
    if (!signer || signer.tenantId !== input.tenantId) {
      notFound("Person", input.signerPersonId);
    }
    if (
      [...this.esignEnvelopes.values()].some(
        (envelope) =>
          envelope.tenantId === input.tenantId &&
          envelope.provider === input.provider &&
          envelope.envelopeRef === input.envelopeRef,
      )
    ) {
      throw new ConflictError(
        "ESIGN_ENVELOPE_EXISTS: provider envelope reference already recorded",
      );
    }
    const timestamp = now();
    const envelope: ESignEnvelope = {
      id: randomUUID(),
      tenantId: input.tenantId,
      contractId: input.contractId,
      provider: input.provider,
      envelopeRef: input.envelopeRef,
      documentHash: input.documentHash,
      signerPersonId: input.signerPersonId,
      status: "SENT",
      sentAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.esignEnvelopes.set(envelope.id, envelope);
    return envelope;
  }

  async listESignEnvelopes(
    tenantId: string,
    contractId?: string,
  ): Promise<ESignEnvelope[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.esignEnvelopes.values()]
      .filter(
        (envelope) =>
          envelope.tenantId === tenantId &&
          (!contractId || envelope.contractId === contractId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async completeESignEnvelope(input: {
    tenantId: string;
    provider: string;
    envelopeRef: string;
    status: "SIGNED" | "DECLINED" | "VOID";
    signatureRef?: string;
    reason?: string;
  }): Promise<ESignEnvelope> {
    const envelope = [...this.esignEnvelopes.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.provider === input.provider &&
        candidate.envelopeRef === input.envelopeRef,
    );
    if (!envelope) notFound("ESignEnvelope", input.envelopeRef);
    if (envelope.status !== "SENT") {
      throw new ConflictError(`e-sign envelope is ${envelope.status}`);
    }
    if (input.status === "SIGNED" && !input.signatureRef?.trim()) {
      throw new ConflictError("ESIGN_SIGNATURE_REF_REQUIRED");
    }
    envelope.status = input.status;
    envelope.completedAt = now();
    envelope.updatedAt = envelope.completedAt;
    envelope.declineReason =
      input.status === "SIGNED" ? undefined : input.reason;
    if (input.status === "SIGNED") {
      const contract = this.employmentContracts.get(envelope.contractId);
      if (contract && contract.tenantId === input.tenantId) {
        contract.consentSignatureRef = input.signatureRef!;
        contract.consentSignedAt = envelope.completedAt;
        contract.version += 1;
        contract.updatedAt = envelope.completedAt;
      }
    }
    return envelope;
  }

  async createApprovalRequest(input: {
    tenantId: string;
    actionType: string;
    targetType: string;
    targetId: string;
    targetVersion: number;
    requestedByType: "USER" | "AGENT" | "SYSTEM";
    requestedById?: string;
    riskTier: ApprovalRiskTier;
    requiredApprovals: number;
    expiresAt?: string;
    payloadHash: string;
    idempotencyKey: string;
  }): Promise<ApprovalRequest> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const existing = [...this.approvalRequests.values()].find(
      (request) =>
        request.tenantId === input.tenantId &&
        request.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (existing.payloadHash !== input.payloadHash) {
        throw new ConflictError(
          `idempotency key ${input.idempotencyKey} was reused with a different payload`,
        );
      }
      return existing;
    }
    const request: ApprovalRequest = {
      id: randomUUID(),
      tenantId: input.tenantId,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      targetVersion: input.targetVersion,
      requestedByType: input.requestedByType,
      requestedById: input.requestedById,
      riskTier: input.riskTier,
      status: "PENDING",
      requiredApprovals: input.requiredApprovals,
      approvedCount: 0,
      expiresAt: input.expiresAt,
      payloadHash: input.payloadHash,
      idempotencyKey: input.idempotencyKey,
      createdAt: now(),
    };
    this.approvalRequests.set(request.id, request);
    return request;
  }

  async listApprovalRequests(
    tenantId: string,
    filter?: {
      status?: ApprovalStatus;
      targetType?: string;
      targetId?: string;
    },
  ): Promise<ApprovalRequest[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.approvalRequests.values()]
      .filter(
        (request) =>
          request.tenantId === tenantId &&
          (!filter?.status || request.status === filter.status) &&
          (!filter?.targetType || request.targetType === filter.targetType) &&
          (!filter?.targetId || request.targetId === filter.targetId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getApprovalRequest(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalRequest> {
    const request = this.approvalRequests.get(requestId);
    if (!request || request.tenantId !== tenantId) {
      notFound("ApprovalRequest", requestId);
    }
    return request;
  }

  async listApprovalDecisions(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalDecision[]> {
    await this.getApprovalRequest(tenantId, requestId);
    return [...this.approvalDecisions.values()]
      .filter((decision) => decision.requestId === requestId)
      .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  }

  async decideApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    decision: "APPROVE" | "REJECT";
    approverPersonId: string;
    payloadHash: string;
    reason?: string;
    authContext: Record<string, unknown>;
  }): Promise<ApprovalRequest> {
    const request = await this.getApprovalRequest(
      input.tenantId,
      input.requestId,
    );
    if (request.status !== "PENDING") {
      throw new ConflictError(
        `approval request ${request.id} is ${request.status}`,
      );
    }
    if (request.expiresAt && new Date(request.expiresAt) <= new Date()) {
      request.status = "EXPIRED";
      throw new ConflictError(`approval request ${request.id} has expired`);
    }
    if (input.payloadHash !== request.payloadHash) {
      throw new ConflictError(
        "PAYLOAD_HASH_MISMATCH: the approved payload differs from the request",
      );
    }
    if (
      request.requestedByType === "USER" &&
      request.requestedById === input.approverPersonId
    ) {
      throw new ConflictError(
        "SEPARATION_OF_DUTIES: the requester cannot approve their own request",
      );
    }
    const approver = this.persons.get(input.approverPersonId);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approverPersonId);
    }
    const key = `${request.id}:${input.approverPersonId}`;
    if (this.approvalDecisions.has(key)) {
      throw new ConflictError(
        `approver ${input.approverPersonId} already decided this request`,
      );
    }
    const decision: ApprovalDecision = {
      id: randomUUID(),
      tenantId: input.tenantId,
      requestId: request.id,
      decision: input.decision,
      approverPersonId: input.approverPersonId,
      payloadHash: input.payloadHash,
      reason: input.reason,
      decidedAt: now(),
      authContext: input.authContext,
    };
    this.approvalDecisions.set(key, decision);
    if (input.decision === "REJECT") {
      request.status = "REJECTED";
    } else {
      request.approvedCount += 1;
      if (request.approvedCount >= request.requiredApprovals) {
        request.status = "APPROVED";
      }
    }
    return request;
  }

  async consumeApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    consumedBy: string;
  }): Promise<ApprovalRequest> {
    const request = await this.getApprovalRequest(
      input.tenantId,
      input.requestId,
    );
    if (request.status !== "APPROVED") {
      throw new ConflictError(
        `approval request ${request.id} is ${request.status}`,
      );
    }
    if (request.consumedAt) {
      throw new ConflictError(
        `approval request ${request.id} was already consumed`,
      );
    }
    const consumer = this.persons.get(input.consumedBy);
    if (!consumer || consumer.tenantId !== input.tenantId) {
      notFound("Person", input.consumedBy);
    }
    request.consumedAt = now();
    request.consumedBy = input.consumedBy;
    return request;
  }

  async createSettlementExport(input: {
    tenantId: string;
    batchId: string;
    exportRef: string;
    exportHash: string;
    exportedBy: string;
    exportedAt?: string;
  }): Promise<SettlementExport> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const exporter = this.persons.get(input.exportedBy);
    if (!exporter || exporter.tenantId !== input.tenantId) {
      notFound("Person", input.exportedBy);
    }
    const timestamp = now();
    const record: SettlementExport = {
      id: randomUUID(),
      tenantId: input.tenantId,
      batchId: input.batchId,
      exportRef: input.exportRef,
      exportHash: input.exportHash,
      exportedBy: input.exportedBy,
      exportedAt: input.exportedAt ?? timestamp,
      createdAt: timestamp,
    };
    this.settlementExports.set(record.id, record);
    return record;
  }

  async listSettlementExports(
    tenantId: string,
    batchId?: string,
  ): Promise<SettlementExport[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.settlementExports.values()]
      .filter(
        (record) =>
          record.tenantId === tenantId &&
          (!batchId || record.batchId === batchId),
      )
      .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
  }

  async getSettlementExport(
    tenantId: string,
    exportId: string,
  ): Promise<SettlementExport> {
    const record = this.settlementExports.get(exportId);
    if (!record || record.tenantId !== tenantId) {
      notFound("SettlementExport", exportId);
    }
    return record;
  }

  async acknowledgeSettlementExport(input: {
    tenantId: string;
    exportId: string;
    externalReference: string;
    acknowledgedAt?: string;
  }): Promise<SettlementAcknowledgement> {
    const record = await this.getSettlementExport(
      input.tenantId,
      input.exportId,
    );
    if (record.acknowledgedAt) {
      throw new ConflictError(
        `settlement export ${record.id} was already acknowledged`,
      );
    }
    const timestamp = input.acknowledgedAt ?? now();
    const acknowledgement: SettlementAcknowledgement = {
      id: randomUUID(),
      tenantId: input.tenantId,
      exportId: record.id,
      externalReference: input.externalReference,
      acknowledgedAt: timestamp,
      payloadHash: record.exportHash,
      createdAt: now(),
    };
    this.settlementAcknowledgements.set(
      acknowledgement.id,
      acknowledgement,
    );
    record.acknowledgedAt = timestamp;
    record.acknowledgementRef = input.externalReference;
    return acknowledgement;
  }

  async createBudgetPool(input: {
    tenantId: string;
    cycleId: string;
    code: string;
    name: string;
    poolType: string;
    currency: string;
    approvedAmount: string;
  }): Promise<BudgetPool> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.budgetPools.values()].some(
        (pool) =>
          pool.tenantId === input.tenantId &&
          pool.cycleId === input.cycleId &&
          pool.code === input.code,
      )
    ) {
      throw new ConflictError(
        `budget pool ${input.code} already exists for the cycle`,
      );
    }
    const approved = money(input.approvedAmount);
    if (approved < 0n) {
      throw new ConflictError("approvedAmount must not be negative");
    }
    const timestamp = now();
    const pool: BudgetPool = {
      id: randomUUID(),
      tenantId: input.tenantId,
      cycleId: input.cycleId,
      code: input.code,
      name: input.name,
      poolType: input.poolType,
      currency: input.currency,
      approvedAmount: formatDecimal(approved),
      committedAmount: "0",
      status: "DRAFT",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.budgetPools.set(pool.id, pool);
    return pool;
  }

  async listBudgetPools(
    tenantId: string,
    cycleId?: string,
  ): Promise<BudgetPool[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.budgetPools.values()]
      .filter(
        (pool) =>
          pool.tenantId === tenantId &&
          (!cycleId || pool.cycleId === cycleId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBudgetPool(tenantId: string, poolId: string): Promise<BudgetPool> {
    const pool = this.budgetPools.get(poolId);
    if (!pool || pool.tenantId !== tenantId) {
      notFound("BudgetPool", poolId);
    }
    return {
      ...pool,
      allocations: [...this.budgetAllocations.values()].filter(
        (allocation) => allocation.budgetPoolId === pool.id,
      ),
    };
  }

  async approveBudgetPool(input: {
    tenantId: string;
    poolId: string;
    approvedBy: string;
  }): Promise<BudgetPool> {
    const pool = this.budgetPools.get(input.poolId);
    if (!pool || pool.tenantId !== input.tenantId) {
      notFound("BudgetPool", input.poolId);
    }
    if (pool.status !== "DRAFT") {
      throw new ConflictError(`budget pool ${pool.id} is ${pool.status}`);
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    pool.status = "APPROVED";
    pool.approvedBy = input.approvedBy;
    pool.approvedAt = now();
    pool.updatedAt = pool.approvedAt;
    return pool;
  }

  async createBudgetAllocation(input: {
    tenantId: string;
    poolId: string;
    targetType: string;
    targetId: string;
    amount: string;
  }): Promise<BudgetAllocation> {
    const pool = this.budgetPools.get(input.poolId);
    if (!pool || pool.tenantId !== input.tenantId) {
      notFound("BudgetPool", input.poolId);
    }
    if (pool.status !== "APPROVED") {
      throw new ConflictError(`budget pool ${pool.id} is ${pool.status}`);
    }
    const amount = money(input.amount);
    if (amount <= 0n) {
      throw new ConflictError("allocation amount must be positive");
    }
    const committed = money(pool.committedAmount);
    const approved = money(pool.approvedAmount);
    if (committed + amount > approved) {
      throw new ConflictError(
        `BUDGET_EXCEEDED: committed ${formatDecimal(committed)} + ${formatDecimal(amount)} > ${pool.approvedAmount}`,
      );
    }
    const allocation: BudgetAllocation = {
      id: randomUUID(),
      tenantId: input.tenantId,
      budgetPoolId: pool.id,
      targetType: input.targetType,
      targetId: input.targetId,
      amount: formatDecimal(amount),
      status: "RESERVED",
      createdAt: now(),
    };
    this.budgetAllocations.set(allocation.id, allocation);
    pool.committedAmount = formatDecimal(committed + amount);
    pool.updatedAt = now();
    return allocation;
  }

  async listBudgetAllocations(
    tenantId: string,
    poolId: string,
  ): Promise<BudgetAllocation[]> {
    const pool = this.budgetPools.get(poolId);
    if (!pool || pool.tenantId !== tenantId) {
      notFound("BudgetPool", poolId);
    }
    return [...this.budgetAllocations.values()]
      .filter((allocation) => allocation.budgetPoolId === pool.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async releaseBudgetAllocation(input: {
    tenantId: string;
    allocationId: string;
  }): Promise<BudgetAllocation> {
    const allocation = this.budgetAllocations.get(input.allocationId);
    if (!allocation || allocation.tenantId !== input.tenantId) {
      notFound("BudgetAllocation", input.allocationId);
    }
    if (allocation.status !== "RESERVED") {
      throw new ConflictError(
        `budget allocation ${allocation.id} is ${allocation.status}`,
      );
    }
    const pool = this.budgetPools.get(allocation.budgetPoolId);
    if (!pool) notFound("BudgetPool", allocation.budgetPoolId);
    const committed = money(pool.committedAmount);
    const amount = money(allocation.amount);
    if (committed < amount) {
      throw new ConflictError("BUDGET_LEDGER_INCONSISTENT");
    }
    allocation.status = "RELEASED";
    pool.committedAmount = formatDecimal(committed - amount);
    pool.updatedAt = now();
    return allocation;
  }

  async createCashGateInput(input: {
    tenantId: string;
    cycleId: string;
    asOfDate: string;
    safetyReserveMonths: string;
    thirteenWeekForecastRef: string;
    passesGate: boolean;
    approvedBy: string;
    approvedAt?: string;
  }): Promise<CashGateInput> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.cashGateInputs.values()].some(
        (gate) =>
          gate.tenantId === input.tenantId &&
          gate.cycleId === input.cycleId &&
          gate.asOfDate === input.asOfDate,
      )
    ) {
      throw new ConflictError(
        `cash gate for ${input.asOfDate} already exists for the cycle`,
      );
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    const gate: CashGateInput = {
      id: randomUUID(),
      tenantId: input.tenantId,
      cycleId: input.cycleId,
      asOfDate: input.asOfDate,
      safetyReserveMonths: formatDecimal(
        money(input.safetyReserveMonths),
      ),
      thirteenWeekForecastRef: input.thirteenWeekForecastRef,
      passesGate: input.passesGate,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt ?? now(),
      createdAt: now(),
    };
    this.cashGateInputs.set(gate.id, gate);
    return gate;
  }

  async listCashGateInputs(
    tenantId: string,
    cycleId?: string,
  ): Promise<CashGateInput[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.cashGateInputs.values()]
      .filter(
        (gate) =>
          gate.tenantId === tenantId &&
          (!cycleId || gate.cycleId === cycleId),
      )
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
  }

  async createFinancialFact(input: {
    tenantId: string;
    sourceSystem: string;
    sourceRecordId: string;
    factType: string;
    periodStart?: string;
    periodEnd?: string;
    amount: string;
    currency: string;
    qualityStatus: FinancialFact["qualityStatus"];
    sourceUpdatedAt?: string;
    payload: Record<string, unknown>;
  }): Promise<FinancialFact> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const key = [
      input.tenantId,
      input.sourceSystem,
      input.sourceRecordId,
      input.factType,
    ].join(":");
    const existing = this.financialFacts.get(key);
    const timestamp = now();
    const fact: FinancialFact = existing ?? {
      id: randomUUID(),
      tenantId: input.tenantId,
      sourceSystem: input.sourceSystem,
      sourceRecordId: input.sourceRecordId,
      factType: input.factType,
      amount: formatDecimal(money(input.amount)),
      currency: input.currency,
      qualityStatus: input.qualityStatus,
      ingestedAt: timestamp,
      payload: input.payload,
      createdAt: timestamp,
    };
    fact.periodStart = input.periodStart;
    fact.periodEnd = input.periodEnd;
    fact.amount = formatDecimal(money(input.amount));
    fact.currency = input.currency;
    fact.qualityStatus = input.qualityStatus;
    fact.sourceUpdatedAt = input.sourceUpdatedAt;
    fact.ingestedAt = timestamp;
    fact.payload = input.payload;
    this.financialFacts.set(key, fact);
    return fact;
  }

  async listFinancialFacts(
    tenantId: string,
    filter?: { factType?: string; sourceSystem?: string },
  ): Promise<FinancialFact[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.financialFacts.values()]
      .filter(
        (fact) =>
          fact.tenantId === tenantId &&
          (!filter?.factType || fact.factType === filter.factType) &&
          (!filter?.sourceSystem ||
            fact.sourceSystem === filter.sourceSystem),
      )
      .sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt));
  }

  async createRuleChangeOrder(input: {
    tenantId: string;
    policyCode: string;
    fromPolicyVersionId?: string;
    toPolicyVersionId: string;
    changeType: string;
    reason: string;
    impactSimulation: Record<string, unknown>;
    effectiveFrom: string;
    requestedBy: string;
  }): Promise<RuleChangeOrder> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const requester = this.persons.get(input.requestedBy);
    if (!requester || requester.tenantId !== input.tenantId) {
      notFound("Person", input.requestedBy);
    }
    const order: RuleChangeOrder = {
      id: randomUUID(),
      tenantId: input.tenantId,
      policyCode: input.policyCode,
      fromPolicyVersionId: input.fromPolicyVersionId,
      toPolicyVersionId: input.toPolicyVersionId,
      changeType: input.changeType,
      reason: input.reason,
      impactSimulation: input.impactSimulation,
      status: "DRAFT",
      requestedBy: input.requestedBy,
      effectiveFrom: input.effectiveFrom,
      createdAt: now(),
    };
    this.ruleChangeOrders.set(order.id, order);
    return order;
  }

  async listRuleChangeOrders(
    tenantId: string,
    filter?: { policyCode?: string; status?: RuleChangeOrder["status"] },
  ): Promise<RuleChangeOrder[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.ruleChangeOrders.values()]
      .filter(
        (order) =>
          order.tenantId === tenantId &&
          (!filter?.policyCode || order.policyCode === filter.policyCode) &&
          (!filter?.status || order.status === filter.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getRuleChangeOrder(
    tenantId: string,
    orderId: string,
  ): Promise<RuleChangeOrder> {
    const order = this.ruleChangeOrders.get(orderId);
    if (!order || order.tenantId !== tenantId) {
      notFound("RuleChangeOrder", orderId);
    }
    return order;
  }

  async approveRuleChangeOrder(input: {
    tenantId: string;
    orderId: string;
    approvedBy: string;
  }): Promise<RuleChangeOrder> {
    const order = await this.getRuleChangeOrder(
      input.tenantId,
      input.orderId,
    );
    if (order.status !== "DRAFT") {
      throw new ConflictError(`rule change order ${order.id} is ${order.status}`);
    }
    if (order.requestedBy === input.approvedBy) {
      throw new ConflictError(
        "SEPARATION_OF_DUTIES: the requester cannot approve their own change",
      );
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    order.status = "APPROVED";
    order.approvedBy = input.approvedBy;
    order.approvedAt = now();
    return order;
  }

  async rejectRuleChangeOrder(input: {
    tenantId: string;
    orderId: string;
    approvedBy: string;
  }): Promise<RuleChangeOrder> {
    const order = await this.getRuleChangeOrder(
      input.tenantId,
      input.orderId,
    );
    if (order.status !== "DRAFT") {
      throw new ConflictError(`rule change order ${order.id} is ${order.status}`);
    }
    if (order.requestedBy === input.approvedBy) {
      throw new ConflictError(
        "SEPARATION_OF_DUTIES: the requester cannot reject their own change",
      );
    }
    order.status = "REJECTED";
    order.approvedBy = input.approvedBy;
    order.approvedAt = now();
    return order;
  }

  async publicizeRuleChangeOrder(input: {
    tenantId: string;
    orderId: string;
  }): Promise<RuleChangeOrder> {
    const order = await this.getRuleChangeOrder(
      input.tenantId,
      input.orderId,
    );
    if (order.status !== "APPROVED") {
      throw new ConflictError(`rule change order ${order.id} is ${order.status}`);
    }
    order.status = "PUBLICIZED";
    order.publicizedAt = now();
    return order;
  }

  async createPolicyTestCase(input: {
    tenantId: string;
    policyVersionId: string;
    caseCode: string;
    input: Record<string, unknown>;
    expectedOutput: Record<string, unknown>;
    category: PolicyTestCase["category"];
  }): Promise<PolicyTestCase> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.policyTestCases.values()].some(
        (testCase) =>
          testCase.tenantId === input.tenantId &&
          testCase.policyVersionId === input.policyVersionId &&
          testCase.caseCode === input.caseCode,
      )
    ) {
      throw new ConflictError(
        `test case ${input.caseCode} already exists for the policy version`,
      );
    }
    const testCase: PolicyTestCase = {
      id: randomUUID(),
      tenantId: input.tenantId,
      policyVersionId: input.policyVersionId,
      caseCode: input.caseCode,
      input: input.input,
      expectedOutput: input.expectedOutput,
      category: input.category,
      status: "ACTIVE",
      createdAt: now(),
    };
    this.policyTestCases.set(testCase.id, testCase);
    return testCase;
  }

  async listPolicyTestCases(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyTestCase[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.policyTestCases.values()]
      .filter(
        (testCase) =>
          testCase.tenantId === tenantId &&
          (!policyVersionId ||
            testCase.policyVersionId === policyVersionId),
      )
      .sort((a, b) => a.caseCode.localeCompare(b.caseCode));
  }

  async getPolicyTestCase(
    tenantId: string,
    testCaseId: string,
  ): Promise<PolicyTestCase> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    const testCase = this.policyTestCases.get(testCaseId);
    if (!testCase || testCase.tenantId !== tenantId) {
      notFound("PolicyTestCase", testCaseId);
    }
    return testCase;
  }

  async recordPolicyTestCaseRun(input: {
    tenantId: string;
    testCaseId: string;
    passed: boolean;
    resultHash?: string;
    runAt?: string;
  }): Promise<PolicyTestCase> {
    const testCase = await this.getPolicyTestCase(
      input.tenantId,
      input.testCaseId,
    );
    testCase.lastRunAt = input.runAt ?? new Date().toISOString();
    testCase.lastRunPassed = input.passed;
    testCase.lastRunResultHash = input.resultHash;
    return testCase;
  }

  async recordPolicyTestRun(input: {
    tenantId: string;
    policyVersionId: string;
    runAt?: string;
    total: number;
    passedCount: number;
    failedCount: number;
    retiredCount: number;
    passed: boolean;
    resultsHash: string;
    results: PolicyTestRun["results"];
  }): Promise<PolicyTestRun> {
    if (!this.tenants.has(input.tenantId)) {
      notFound("Tenant", input.tenantId);
    }
    const id = randomUUID();
    const run: PolicyTestRun = {
      id,
      runId: id,
      tenantId: input.tenantId,
      policyVersionId: input.policyVersionId,
      runAt: input.runAt ?? new Date().toISOString(),
      total: input.total,
      passedCount: input.passedCount,
      failedCount: input.failedCount,
      retiredCount: input.retiredCount,
      passed: input.passed,
      resultsHash: input.resultsHash,
      results: structuredClone(input.results),
    };
    this.policyTestRuns.set(run.id, run);
    return run;
  }

  async listPolicyTestRuns(
    tenantId: string,
    policyVersionId?: string,
    limit = 20,
  ): Promise<PolicyTestRun[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.policyTestRuns.values()]
      .filter(
        (run) =>
          run.tenantId === tenantId &&
          (!policyVersionId ||
            run.policyVersionId === policyVersionId),
      )
      .sort((a, b) => b.runAt.localeCompare(a.runAt))
      .slice(0, limit);
  }

  async retirePolicyTestCase(input: {
    tenantId: string;
    testCaseId: string;
  }): Promise<PolicyTestCase> {
    const testCase = this.policyTestCases.get(input.testCaseId);
    if (!testCase || testCase.tenantId !== input.tenantId) {
      notFound("PolicyTestCase", input.testCaseId);
    }
    if (testCase.status !== "ACTIVE") {
      throw new ConflictError(
        `policy test case ${testCase.id} is ${testCase.status}`,
      );
    }
    testCase.status = "RETIRED";
    return testCase;
  }

  async createPolicyNotice(input: {
    tenantId: string;
    policyVersionId: string;
    noticeId: string;
    audience: Record<string, unknown>;
  }): Promise<PolicyNotice> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.policyNotices.values()].some(
        (link) =>
          link.tenantId === input.tenantId &&
          link.policyVersionId === input.policyVersionId &&
          link.noticeId === input.noticeId,
      )
    ) {
      throw new ConflictError(
        "policy notice link already exists for this policy version",
      );
    }
    const link: PolicyNotice = {
      id: randomUUID(),
      tenantId: input.tenantId,
      policyVersionId: input.policyVersionId,
      noticeId: input.noticeId,
      audience: input.audience,
      createdAt: now(),
    };
    this.policyNotices.set(link.id, link);
    return link;
  }

  async listPolicyNotices(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyNotice[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.policyNotices.values()]
      .filter(
        (link) =>
          link.tenantId === tenantId &&
          (!policyVersionId ||
            link.policyVersionId === policyVersionId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createMetricDefinition(input: {
    tenantId: string;
    code: string;
    version: number;
    name: string;
    description?: string;
    dataType: string;
    unit?: string;
    aggregationMethod?: string;
    sourceContract: Record<string, unknown>;
    effectiveFrom: string;
    effectiveTo?: string;
  }): Promise<MetricDefinition> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (
      [...this.metricDefinitions.values()].some(
        (metric) =>
          metric.tenantId === input.tenantId &&
          metric.code === input.code &&
          metric.version === input.version,
      )
    ) {
      throw new ConflictError(
        `metric ${input.code} v${input.version} already exists`,
      );
    }
    if (
      input.effectiveTo &&
      input.effectiveTo < input.effectiveFrom
    ) {
      throw new ConflictError(
        "effectiveTo must not be before effectiveFrom",
      );
    }
    const metric: MetricDefinition = {
      id: randomUUID(),
      tenantId: input.tenantId,
      code: input.code,
      version: input.version,
      name: input.name,
      description: input.description,
      dataType: input.dataType,
      unit: input.unit,
      aggregationMethod: input.aggregationMethod,
      sourceContract: input.sourceContract,
      active: true,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      createdAt: now(),
    };
    this.metricDefinitions.set(metric.id, metric);
    return metric;
  }

  async listMetricDefinitions(
    tenantId: string,
    filter?: { code?: string; active?: boolean },
  ): Promise<MetricDefinition[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.metricDefinitions.values()]
      .filter(
        (metric) =>
          metric.tenantId === tenantId &&
          (!filter?.code || metric.code === filter.code) &&
          (filter?.active === undefined ||
            metric.active === filter.active),
      )
      .sort(
        (a, b) =>
          a.code.localeCompare(b.code) || b.version - a.version,
      );
  }

  async retireMetricDefinition(input: {
    tenantId: string;
    metricId: string;
  }): Promise<MetricDefinition> {
    const metric = this.metricDefinitions.get(input.metricId);
    if (!metric || metric.tenantId !== input.tenantId) {
      notFound("MetricDefinition", input.metricId);
    }
    if (!metric.active) {
      throw new ConflictError(`metric ${metric.id} is already retired`);
    }
    metric.active = false;
    return metric;
  }

  async createDeliverable(input: {
    tenantId: string;
    workPackageId: string;
    title: string;
    deliverableType: string;
    ownerPersonId: string;
    dueAt?: string;
  }): Promise<Deliverable> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const owner = this.persons.get(input.ownerPersonId);
    if (!owner || owner.tenantId !== input.tenantId) {
      notFound("Person", input.ownerPersonId);
    }
    const timestamp = now();
    const deliverable: Deliverable = {
      id: randomUUID(),
      tenantId: input.tenantId,
      workPackageId: input.workPackageId,
      title: input.title,
      deliverableType: input.deliverableType,
      ownerPersonId: input.ownerPersonId,
      dueAt: input.dueAt,
      status: "DRAFT",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.deliverables.set(deliverable.id, deliverable);
    return deliverable;
  }

  async listDeliverables(
    tenantId: string,
    workPackageId?: string,
  ): Promise<Deliverable[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.deliverables.values()]
      .filter(
        (deliverable) =>
          deliverable.tenantId === tenantId &&
          (!workPackageId ||
            deliverable.workPackageId === workPackageId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getDeliverable(
    tenantId: string,
    deliverableId: string,
  ): Promise<Deliverable> {
    const deliverable = this.deliverables.get(deliverableId);
    if (!deliverable || deliverable.tenantId !== tenantId) {
      notFound("Deliverable", deliverableId);
    }
    return deliverable;
  }

  async submitDeliverable(input: {
    tenantId: string;
    deliverableId: string;
    artifactRef?: string;
    contentHash?: string;
  }): Promise<Deliverable> {
    const deliverable = await this.getDeliverable(
      input.tenantId,
      input.deliverableId,
    );
    if (
      deliverable.status !== "DRAFT" &&
      deliverable.status !== "REJECTED"
    ) {
      throw new ConflictError(
        `deliverable ${deliverable.id} is ${deliverable.status}`,
      );
    }
    if (deliverable.status === "REJECTED") deliverable.version += 1;
    deliverable.status = "SUBMITTED";
    deliverable.submittedAt = now();
    deliverable.updatedAt = deliverable.submittedAt;
    if (input.artifactRef) deliverable.artifactRef = input.artifactRef;
    if (input.contentHash) deliverable.contentHash = input.contentHash;
    return deliverable;
  }

  async recordDeliverableAcceptance(input: {
    tenantId: string;
    deliverableId: string;
    decision: Acceptance["decision"];
    reviewerPersonId: string;
    criteriaResults: Record<string, unknown>;
    comments?: string;
  }): Promise<Acceptance> {
    const deliverable = await this.getDeliverable(
      input.tenantId,
      input.deliverableId,
    );
    if (deliverable.status !== "SUBMITTED") {
      throw new ConflictError(
        `deliverable ${deliverable.id} is ${deliverable.status}`,
      );
    }
    if (input.reviewerPersonId === deliverable.ownerPersonId) {
      throw new ConflictError(
        "SEPARATION_OF_DUTIES: the deliverable owner cannot accept it",
      );
    }
    const reviewer = this.persons.get(input.reviewerPersonId);
    if (!reviewer || reviewer.tenantId !== input.tenantId) {
      notFound("Person", input.reviewerPersonId);
    }
    const timestamp = now();
    const acceptance: Acceptance = {
      id: randomUUID(),
      tenantId: input.tenantId,
      deliverableId: deliverable.id,
      decision: input.decision,
      reviewerPersonId: input.reviewerPersonId,
      criteriaResults: input.criteriaResults,
      comments: input.comments,
      decidedAt: timestamp,
      createdAt: timestamp,
    };
    this.acceptances.set(acceptance.id, acceptance);
    deliverable.status =
      input.decision === "REJECT" ? "REJECTED" : "ACCEPTED";
    deliverable.updatedAt = timestamp;
    return acceptance;
  }

  async listDeliverableAcceptances(
    tenantId: string,
    deliverableId: string,
  ): Promise<Acceptance[]> {
    await this.getDeliverable(tenantId, deliverableId);
    return [...this.acceptances.values()]
      .filter((acceptance) => acceptance.deliverableId === deliverableId)
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  }

  async createAiSuggestion(input: {
    tenantId: string;
    agentTaskId: string;
    targetType: string;
    targetId?: string;
    suggestionType: string;
    modelProvider?: string;
    modelName?: string;
    modelPromptId?: string;
    promptVersion: string;
    inputHash: string;
    outputJson: Record<string, unknown>;
    validationStatus: string;
  }): Promise<AiSuggestionLog> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const suggestion: AiSuggestionLog = {
      id: randomUUID(),
      tenantId: input.tenantId,
      agentTaskId: input.agentTaskId,
      targetType: input.targetType,
      targetId: input.targetId,
      suggestionType: input.suggestionType,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      modelPromptId: input.modelPromptId,
      promptVersion: input.promptVersion,
      inputHash: input.inputHash,
      outputJson: input.outputJson,
      validationStatus: input.validationStatus,
      createdAt: now(),
    };
    this.aiSuggestions.set(suggestion.id, suggestion);
    return suggestion;
  }

  async listAiSuggestions(
    tenantId: string,
    filter?: { agentTaskId?: string; targetType?: string },
  ): Promise<AiSuggestionLog[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.aiSuggestions.values()]
      .filter(
        (suggestion) =>
          suggestion.tenantId === tenantId &&
          (!filter?.agentTaskId ||
            suggestion.agentTaskId === filter.agentTaskId) &&
          (!filter?.targetType ||
            suggestion.targetType === filter.targetType),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async acceptAiSuggestion(input: {
    tenantId: string;
    suggestionId: string;
    acceptedBy: string;
  }): Promise<AiSuggestionLog> {
    const suggestion = this.aiSuggestions.get(input.suggestionId);
    if (!suggestion || suggestion.tenantId !== input.tenantId) {
      notFound("AiSuggestionLog", input.suggestionId);
    }
    if (suggestion.acceptedAt) {
      throw new ConflictError(
        `AI suggestion ${suggestion.id} was already accepted`,
      );
    }
    const person = this.persons.get(input.acceptedBy);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.acceptedBy);
    }
    suggestion.acceptedBy = input.acceptedBy;
    suggestion.acceptedAt = now();
    return suggestion;
  }

  async createModelEvaluationRun(input: {
    tenantId: string;
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
  }): Promise<ModelEvaluationRun> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const timestamp = now();
    const run: ModelEvaluationRun = {
      id: randomUUID(),
      tenantId: input.tenantId,
      evaluationType: input.evaluationType,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      promptVersion: input.promptVersion,
      datasetRef: input.datasetRef,
      sampleSize: input.sampleSize,
      metrics: input.metrics,
      subgroupMetrics: input.subgroupMetrics,
      passed: input.passed,
      blockers: input.blockers,
      evaluatedAt: timestamp,
      createdAt: timestamp,
    };
    this.modelEvaluationRuns.set(run.id, run);
    return run;
  }

  async listModelEvaluationRuns(
    tenantId: string,
    filter?: { evaluationType?: string; passed?: boolean },
  ): Promise<ModelEvaluationRun[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.modelEvaluationRuns.values()]
      .filter(
        (run) =>
          run.tenantId === tenantId &&
          (!filter?.evaluationType ||
            run.evaluationType === filter.evaluationType) &&
          (filter?.passed === undefined || run.passed === filter.passed),
      )
      .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt));
  }

  async getModelEvaluationRun(
    tenantId: string,
    runId: string,
  ): Promise<ModelEvaluationRun> {
    const run = this.modelEvaluationRuns.get(runId);
    if (!run || run.tenantId !== tenantId) {
      notFound("ModelEvaluationRun", runId);
    }
    return run;
  }

  async createModelPrompt(input: {
    tenantId: string;
    promptCode: string;
    version: number;
    purpose: string;
    modelProvider: string;
    modelName: string;
    template: string;
  }): Promise<ModelPrompt> {
    if (!this.tenants.has(input.tenantId)) {
      notFound("Tenant", input.tenantId);
    }
    const existing = [...this.modelPrompts.values()].find(
      (prompt) =>
        prompt.tenantId === input.tenantId &&
        prompt.promptCode === input.promptCode &&
        prompt.version === input.version,
    );
    if (existing) {
      throw new ConflictError(
        `Model prompt ${input.promptCode}:${input.version} already exists`,
      );
    }
    const prompt: ModelPrompt = {
      id: randomUUID(),
      tenantId: input.tenantId,
      promptCode: input.promptCode,
      version: input.version,
      purpose: input.purpose,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      template: input.template,
      templateHash: sha256({ template: input.template }),
      status: "DRAFT",
      createdAt: now(),
    };
    this.modelPrompts.set(prompt.id, prompt);
    return prompt;
  }

  async listModelPrompts(
    tenantId: string,
    filter?: { promptCode?: string; status?: ModelPrompt["status"] },
  ): Promise<ModelPrompt[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.modelPrompts.values()]
      .filter(
        (prompt) =>
          prompt.tenantId === tenantId &&
          (!filter?.promptCode ||
            prompt.promptCode === filter.promptCode) &&
          (!filter?.status || prompt.status === filter.status),
      )
      .sort(
        (a, b) =>
          a.promptCode.localeCompare(b.promptCode) || b.version - a.version,
      );
  }

  async getModelPrompt(
    tenantId: string,
    promptId: string,
  ): Promise<ModelPrompt> {
    const prompt = this.modelPrompts.get(promptId);
    if (!prompt || prompt.tenantId !== tenantId) {
      notFound("ModelPrompt", promptId);
    }
    return prompt;
  }

  async activateModelPrompt(input: {
    tenantId: string;
    promptId: string;
    evaluationRunId: string;
  }): Promise<ModelPrompt> {
    const prompt = await this.getModelPrompt(input.tenantId, input.promptId);
    if (prompt.status !== "DRAFT") {
      throw new ConflictError(
        `model prompt ${prompt.id} is ${prompt.status}`,
      );
    }
    const evaluation = await this.getModelEvaluationRun(
      input.tenantId,
      input.evaluationRunId,
    );
    if (!evaluation.passed) {
      throw new ConflictError(
        `MODEL_EVALUATION_NOT_PASSED: ${evaluation.id}`,
      );
    }
    if (
      evaluation.modelProvider !== prompt.modelProvider ||
      evaluation.modelName !== prompt.modelName
    ) {
      throw new ConflictError(
        `MODEL_EVALUATION_MODEL_MISMATCH: ${evaluation.id}`,
      );
    }
    const active = [...this.modelPrompts.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.promptCode === prompt.promptCode &&
        candidate.status === "ACTIVE" &&
        candidate.id !== prompt.id,
    );
    if (active) {
      throw new ConflictError(
        `MODEL_PROMPT_ALREADY_ACTIVE: ${active.promptCode}:${active.version}`,
      );
    }
    prompt.status = "ACTIVE";
    prompt.evaluationRunId = evaluation.id;
    prompt.activatedAt = now();
    return prompt;
  }

  async retireModelPrompt(input: {
    tenantId: string;
    promptId: string;
  }): Promise<ModelPrompt> {
    const prompt = await this.getModelPrompt(input.tenantId, input.promptId);
    if (prompt.status !== "ACTIVE") {
      throw new ConflictError(
        `model prompt ${prompt.id} is ${prompt.status}`,
      );
    }
    prompt.status = "RETIRED";
    prompt.retiredAt = now();
    return prompt;
  }

  async createAiScoreProposal(input: {
    tenantId: string;
    cycleId: string;
    personId: string;
    evaluationRunId: string;
    modelPromptId?: string;
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
    riskTier?: AiScoreProposal["riskTier"];
    riskReasons?: string[];
    riskAssessedAt?: string;
    secondReviewDueAt?: string;
    zeroScoreRationale?: string;
    requestedBy?: string;
  }): Promise<AiScoreProposal> {
    if (!this.tenants.has(input.tenantId)) {
      notFound("Tenant", input.tenantId);
    }
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    const proposal: AiScoreProposal = {
      id: randomUUID(),
      tenantId: input.tenantId,
      cycleId: input.cycleId,
      personId: input.personId,
      evaluationRunId: input.evaluationRunId,
      modelPromptId: input.modelPromptId,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      promptVersion: input.promptVersion,
      dimensions: [...input.dimensions],
      scores: { ...input.scores },
      overallScore: input.overallScore,
      confidence: input.confidence,
      rationale: input.rationale,
      evidenceRefs: [...input.evidenceRefs],
      evidenceSnapshotHash: input.evidenceSnapshotHash,
      gateMetrics: structuredClone(input.gateMetrics),
      riskTier: input.riskTier ?? "MEDIUM",
      riskReasons: input.riskReasons ? [...input.riskReasons] : undefined,
      riskAssessedAt: input.riskAssessedAt,
      secondReviewRequired:
        input.riskTier === "HIGH" || input.riskTier === "CRITICAL",
      secondReviewDueAt: input.secondReviewDueAt,
      secondReviewSlaBreached: false,
      zeroScoreRationale: input.zeroScoreRationale,
      status: "PENDING",
      requestedBy: input.requestedBy,
      auditSample: false,
      createdAt: now(),
    };
    this.aiScoreProposals.set(proposal.id, proposal);
    return proposal;
  }

  async listAiScoreProposals(
    tenantId: string,
    filter?: {
      personId?: string;
      cycleId?: string;
      status?: AiScoreProposal["status"];
    },
  ): Promise<AiScoreProposal[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.aiScoreProposals.values()]
      .filter(
        (proposal) =>
          proposal.tenantId === tenantId &&
          (!filter?.personId || proposal.personId === filter.personId) &&
          (!filter?.cycleId || proposal.cycleId === filter.cycleId) &&
          (!filter?.status || proposal.status === filter.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getAiScoreProposal(
    tenantId: string,
    proposalId: string,
  ): Promise<AiScoreProposal> {
    const proposal = this.aiScoreProposals.get(proposalId);
    if (!proposal || proposal.tenantId !== tenantId) {
      notFound("AiScoreProposal", proposalId);
    }
    return proposal;
  }

  async decideAiScoreProposal(input: {
    tenantId: string;
    proposalId: string;
    decision: "ACCEPT" | "REJECT";
    decidedBy: string;
    note?: string;
    independentScores: Record<string, number>;
    independentRationale?: string;
    reviewStartedAt: string;
    reviewDurationSeconds: number;
    evidenceOpened: number;
    override: boolean;
    overrideReason?: string;
    blindReview: boolean;
    auditSample: boolean;
    secondReviewerPersonId?: string;
    secondIndependentScores?: Record<string, number>;
    secondIndependentRationale?: string;
    secondReviewStartedAt?: string;
    secondEvidenceOpened?: number;
    secondReviewOutcome?: "AGREE" | "DISAGREE";
    secondReviewAgreementRate?: number;
  }): Promise<AiScoreProposal> {
    const proposal = await this.getAiScoreProposal(
      input.tenantId,
      input.proposalId,
    );
    if (proposal.status !== "PENDING") {
      throw new ConflictError(
        `AI score proposal ${proposal.id} is ${proposal.status}`,
      );
    }
    if (proposal.requestedBy === input.decidedBy) {
      throw new ConflictError(
        "AI_SCORE_SELF_REVIEW: the requester cannot decide the proposal",
      );
    }
    proposal.status =
      input.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED";
    proposal.decidedBy = input.decidedBy;
    proposal.decidedAt = now();
    proposal.decisionNote = input.note;
    proposal.independentScores = input.independentScores;
    proposal.independentRationale = input.independentRationale;
    proposal.reviewStartedAt = input.reviewStartedAt;
    proposal.reviewDurationSeconds = input.reviewDurationSeconds;
    proposal.evidenceOpened = input.evidenceOpened;
    proposal.override = input.override;
    proposal.overrideReason = input.overrideReason;
    proposal.blindReview = input.blindReview;
    if (input.secondReviewerPersonId) {
      proposal.secondReviewerPersonId = input.secondReviewerPersonId;
      proposal.secondIndependentScores = input.secondIndependentScores;
      proposal.secondIndependentRationale =
        input.secondIndependentRationale;
      proposal.secondReviewStartedAt = input.secondReviewStartedAt;
      proposal.secondReviewCompletedAt = now();
      proposal.secondReviewEvidenceOpened = input.secondEvidenceOpened ?? 0;
      proposal.secondReviewOutcome = input.secondReviewOutcome;
      proposal.secondReviewAgreementRate =
        input.secondReviewAgreementRate;
      proposal.secondReviewSlaBreached = Boolean(
        proposal.secondReviewDueAt &&
          Date.parse(proposal.secondReviewDueAt) < Date.now(),
      );
    }
    proposal.auditSample = input.auditSample;
    proposal.auditSampledAt = input.auditSample ? now() : undefined;
    return proposal;
  }

  async recordAiScoreAuditReview(input: {
    tenantId: string;
    proposalId: string;
    reviewerPersonId: string;
    scores: Record<string, number>;
    rationale: string;
    reviewStartedAt: string;
    reviewDurationSeconds: number;
    evidenceOpened: number;
    outcome: "AGREE" | "DISAGREE";
    agreementRate: number;
  }): Promise<AiScoreProposal> {
    const proposal = await this.getAiScoreProposal(
      input.tenantId,
      input.proposalId,
    );
    if (proposal.status === "PENDING") {
      throw new ConflictError(
        "AI_AUDIT_REQUIRES_DECIDED_PROPOSAL: decide the proposal first",
      );
    }
    if (!proposal.auditSample) {
      throw new ConflictError(
        "AI_AUDIT_NOT_SAMPLED: this proposal is not in the audit sample",
      );
    }
    if (proposal.secondReviewCompletedAt) {
      throw new ConflictError(
        "AI_AUDIT_ALREADY_COMPLETED: second review already recorded",
      );
    }
    if (
      input.reviewerPersonId === proposal.decidedBy ||
      input.reviewerPersonId === proposal.requestedBy
    ) {
      throw new ConflictError(
        "AI_AUDIT_REVIEWER_CONFLICT: reviewer must differ from requester and first reviewer",
      );
    }
    proposal.secondReviewerPersonId = input.reviewerPersonId;
    proposal.secondIndependentScores = { ...input.scores };
    proposal.secondIndependentRationale = input.rationale;
    proposal.secondReviewStartedAt = input.reviewStartedAt;
    proposal.secondReviewCompletedAt = now();
    proposal.secondReviewDurationSeconds = input.reviewDurationSeconds;
    proposal.secondReviewEvidenceOpened = input.evidenceOpened;
    proposal.secondReviewOutcome = input.outcome;
    proposal.secondReviewAgreementRate = input.agreementRate;
    return proposal;
  }

  async createWorkflowRun(input: {
    tenantId: string;
    agentTaskId: string;
    workflowName: string;
    workflowVersion: string;
    status: string;
    currentStep?: string;
    state: Record<string, unknown>;
    startedAt?: string;
  }): Promise<WorkflowRun> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const timestamp = now();
    const run: WorkflowRun = {
      id: randomUUID(),
      tenantId: input.tenantId,
      agentTaskId: input.agentTaskId,
      workflowName: input.workflowName,
      workflowVersion: input.workflowVersion,
      status: input.status,
      currentStep: input.currentStep,
      state: input.state,
      startedAt: input.startedAt ?? timestamp,
      createdAt: timestamp,
    };
    this.workflowRuns.set(run.id, run);
    return run;
  }

  async listWorkflowRuns(
    tenantId: string,
    agentTaskId?: string,
  ): Promise<WorkflowRun[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.workflowRuns.values()]
      .filter(
        (run) =>
          run.tenantId === tenantId &&
          (!agentTaskId || run.agentTaskId === agentTaskId),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async finishWorkflowRun(input: {
    tenantId: string;
    workflowRunId: string;
    status: string;
    currentStep?: string;
  }): Promise<WorkflowRun> {
    const run = this.workflowRuns.get(input.workflowRunId);
    if (!run || run.tenantId !== input.tenantId) {
      notFound("WorkflowRun", input.workflowRunId);
    }
    if (run.finishedAt) {
      throw new ConflictError(`workflow run ${run.id} is already finished`);
    }
    run.status = input.status;
    run.currentStep = input.currentStep ?? run.currentStep;
    run.finishedAt = now();
    return run;
  }

  async createIntegrationConnection(input: {
    tenantId: string;
    provider: string;
    connectionName: string;
    credentialRef: string;
    config: Record<string, unknown>;
  }): Promise<IntegrationConnection> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const timestamp = now();
    const connection: IntegrationConnection = {
      id: randomUUID(),
      tenantId: input.tenantId,
      provider: input.provider,
      connectionName: input.connectionName,
      credentialRef: input.credentialRef,
      status: "ACTIVE",
      config: input.config,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.integrationConnections.set(connection.id, connection);
    return connection;
  }

  async listIntegrationConnections(
    tenantId: string,
  ): Promise<IntegrationConnection[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.integrationConnections.values()]
      .filter((connection) => connection.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getIntegrationConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<IntegrationConnection> {
    const connection = this.integrationConnections.get(connectionId);
    if (!connection || connection.tenantId !== tenantId) {
      notFound("IntegrationConnection", connectionId);
    }
    return connection;
  }

  async setIntegrationConnectionStatus(input: {
    tenantId: string;
    connectionId: string;
    status: string;
  }): Promise<IntegrationConnection> {
    const connection = await this.getIntegrationConnection(
      input.tenantId,
      input.connectionId,
    );
    connection.status = input.status;
    connection.updatedAt = now();
    return connection;
  }

  async createIntegrationMapping(input: {
    tenantId: string;
    connectionId: string;
    name: string;
    mappingType: IntegrationMapping["mappingType"];
    sourceSystem: string;
    targetType: string;
    fieldMap: Record<string, string>;
    config: Record<string, unknown>;
    version: number;
  }): Promise<IntegrationMapping> {
    await this.getIntegrationConnection(
      input.tenantId,
      input.connectionId,
    );
    const duplicate = [...this.integrationMappings.values()].find(
      (mapping) =>
        mapping.tenantId === input.tenantId &&
        mapping.connectionId === input.connectionId &&
        mapping.name === input.name &&
        mapping.version === input.version,
    );
    if (duplicate) {
      throw new ConflictError(
        `Integration mapping ${input.name}:${input.version} already exists`,
      );
    }
    const active = [...this.integrationMappings.values()].find(
      (mapping) =>
        mapping.tenantId === input.tenantId &&
        mapping.connectionId === input.connectionId &&
        mapping.name === input.name &&
        mapping.status === "ACTIVE",
    );
    if (active) {
      throw new ConflictError(
        `INTEGRATION_MAPPING_ALREADY_ACTIVE: ${input.name}:${active.version}`,
      );
    }
    const mapping: IntegrationMapping = {
      id: randomUUID(),
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      name: input.name,
      mappingType: input.mappingType,
      sourceSystem: input.sourceSystem,
      targetType: input.targetType,
      fieldMap: { ...input.fieldMap },
      config: structuredClone(input.config),
      version: input.version,
      status: "ACTIVE",
      createdAt: now(),
    };
    this.integrationMappings.set(mapping.id, mapping);
    return mapping;
  }

  async listIntegrationMappings(
    tenantId: string,
    connectionId: string,
    status?: IntegrationMapping["status"],
  ): Promise<IntegrationMapping[]> {
    await this.getIntegrationConnection(tenantId, connectionId);
    return [...this.integrationMappings.values()]
      .filter(
        (mapping) =>
          mapping.tenantId === tenantId &&
          mapping.connectionId === connectionId &&
          (!status || mapping.status === status),
      )
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) || b.version - a.version,
      );
  }

  async getIntegrationMapping(
    tenantId: string,
    mappingId: string,
  ): Promise<IntegrationMapping> {
    const mapping = this.integrationMappings.get(mappingId);
    if (!mapping || mapping.tenantId !== tenantId) {
      notFound("IntegrationMapping", mappingId);
    }
    return mapping;
  }

  async retireIntegrationMapping(input: {
    tenantId: string;
    mappingId: string;
  }): Promise<IntegrationMapping> {
    const mapping = await this.getIntegrationMapping(
      input.tenantId,
      input.mappingId,
    );
    if (mapping.status !== "ACTIVE") {
      throw new ConflictError(
        `integration mapping ${mapping.id} is ${mapping.status}`,
      );
    }
    mapping.status = "RETIRED";
    mapping.retiredAt = now();
    return mapping;
  }

  async createSyncSchedule(input: {
    tenantId: string;
    connectionId: string;
    name: string;
    intervalMinutes: number;
    startAt?: string;
  }): Promise<SyncSchedule> {
    await this.getIntegrationConnection(
      input.tenantId,
      input.connectionId,
    );
    const duplicate = [...this.syncSchedules.values()].find(
      (schedule) =>
        schedule.tenantId === input.tenantId &&
        schedule.connectionId === input.connectionId &&
        schedule.name === input.name,
    );
    if (duplicate) {
      throw new ConflictError(
        `Sync schedule ${input.name} already exists for this connection`,
      );
    }
    const timestamp = now();
    const schedule: SyncSchedule = {
      id: randomUUID(),
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      name: input.name,
      intervalMinutes: input.intervalMinutes,
      enabled: true,
      nextRunAt:
        input.startAt ??
        new Date(
          Date.parse(timestamp) + input.intervalMinutes * 60_000,
        ).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.syncSchedules.set(schedule.id, schedule);
    return schedule;
  }

  async listSyncSchedules(
    tenantId: string,
    connectionId?: string,
  ): Promise<SyncSchedule[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.syncSchedules.values()]
      .filter(
        (schedule) =>
          schedule.tenantId === tenantId &&
          (!connectionId || schedule.connectionId === connectionId),
      )
      .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
  }

  async getSyncSchedule(
    tenantId: string,
    scheduleId: string,
  ): Promise<SyncSchedule> {
    const schedule = this.syncSchedules.get(scheduleId);
    if (!schedule || schedule.tenantId !== tenantId) {
      notFound("SyncSchedule", scheduleId);
    }
    return schedule;
  }

  async setSyncScheduleEnabled(input: {
    tenantId: string;
    scheduleId: string;
    enabled: boolean;
  }): Promise<SyncSchedule> {
    const schedule = await this.getSyncSchedule(
      input.tenantId,
      input.scheduleId,
    );
    schedule.enabled = input.enabled;
    schedule.updatedAt = now();
    return schedule;
  }

  async claimDueSyncSchedules(input: {
    tenantId: string;
    limit: number;
    now?: string;
  }): Promise<SyncSchedule[]> {
    if (!this.tenants.has(input.tenantId)) {
      notFound("Tenant", input.tenantId);
    }
    const current = new Date(input.now ?? new Date().toISOString());
    const due = [...this.syncSchedules.values()]
      .filter(
        (schedule) =>
          schedule.tenantId === input.tenantId &&
          schedule.enabled &&
          new Date(schedule.nextRunAt).getTime() <= current.getTime(),
      )
      .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))
      .slice(0, input.limit);
    for (const schedule of due) {
      schedule.lastRunAt = current.toISOString();
      schedule.nextRunAt = new Date(
        current.getTime() + schedule.intervalMinutes * 60_000,
      ).toISOString();
      schedule.updatedAt = current.toISOString();
    }
    return due.map((schedule) => ({ ...schedule }));
  }

  async createEquityGrant(input: {
    tenantId: string;
    personId: string;
    grantCode: string;
    grantType: EquityGrant["grantType"];
    totalUnits: string;
    strikePrice: string;
    currency: string;
    grantDate: string;
    vestingStart: string;
    cliffMonths: number;
    vestingMonths: number;
  }): Promise<EquityGrant> {
    if (!this.tenants.has(input.tenantId)) {
      notFound("Tenant", input.tenantId);
    }
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (
      [...this.equityGrants.values()].some(
        (grant) =>
          grant.tenantId === input.tenantId &&
          grant.grantCode === input.grantCode,
      )
    ) {
      throw new ConflictError(
        `equity grant ${input.grantCode} already exists`,
      );
    }
    if (parseDecimal(input.totalUnits) <= 0n) {
      throw new ConflictError("EQ_TOTAL_UNITS_MUST_BE_POSITIVE");
    }
    if (parseDecimal(input.strikePrice) < 0n) {
      throw new ConflictError("EQ_STRIKE_PRICE_MUST_BE_NON_NEGATIVE");
    }
    if (input.cliffMonths > input.vestingMonths) {
      throw new ConflictError("EQ_CLIFF_EXCEEDS_VESTING");
    }
    const timestamp = now();
    const grant: EquityGrant = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      grantCode: input.grantCode,
      grantType: input.grantType,
      totalUnits: formatDecimal(parseDecimal(input.totalUnits)),
      strikePrice: formatDecimal(parseDecimal(input.strikePrice)),
      currency: input.currency,
      grantDate: input.grantDate,
      vestingStart: input.vestingStart,
      cliffMonths: input.cliffMonths,
      vestingMonths: input.vestingMonths,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.equityGrants.set(grant.id, grant);
    return grant;
  }

  async listEquityGrants(
    tenantId: string,
    personId?: string,
  ): Promise<EquityGrant[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.equityGrants.values()]
      .filter(
        (grant) =>
          grant.tenantId === tenantId &&
          (!personId || grant.personId === personId),
      )
      .sort((a, b) => b.grantDate.localeCompare(a.grantDate));
  }

  async getEquityGrant(
    tenantId: string,
    grantId: string,
  ): Promise<EquityGrant> {
    const grant = this.equityGrants.get(grantId);
    if (!grant || grant.tenantId !== tenantId) {
      notFound("EquityGrant", grantId);
    }
    return grant;
  }

  async getEquityVesting(
    tenantId: string,
    grantId: string,
    asOf = new Date().toISOString(),
  ): Promise<EquityVesting> {
    const grant = await this.getEquityGrant(tenantId, grantId);
    const exercises = [...this.equityExercises.values()].filter(
      (exercise) =>
        exercise.tenantId === tenantId &&
        exercise.grantId === grant.id,
    );
    return computeEquityVesting(grant, exercises, asOf);
  }

  async createEquityExercise(input: {
    tenantId: string;
    grantId: string;
    units: string;
    requestedBy: string;
  }): Promise<EquityExercise> {
    const grant = await this.getEquityGrant(
      input.tenantId,
      input.grantId,
    );
    if (grant.status !== "ACTIVE") {
      throw new ConflictError(`equity grant is ${grant.status}`);
    }
    const requester = this.persons.get(input.requestedBy);
    if (!requester || requester.tenantId !== input.tenantId) {
      notFound("Person", input.requestedBy);
    }
    const units = parseDecimal(input.units);
    if (units <= 0n) {
      throw new ConflictError("EQ_UNITS_MUST_BE_POSITIVE");
    }
    const vesting = await this.getEquityVesting(
      input.tenantId,
      grant.id,
    );
    if (units > parseDecimal(vesting.availableUnits)) {
      throw new ConflictError(
        `EQ_UNITS_EXCEED_AVAILABLE: ${vesting.availableUnits}`,
      );
    }
    const totalCost = (units * parseDecimal(grant.strikePrice)) / 1_000_000n;
    const timestamp = now();
    const exercise: EquityExercise = {
      id: randomUUID(),
      tenantId: input.tenantId,
      grantId: grant.id,
      personId: grant.personId,
      units: formatDecimal(units),
      strikePrice: grant.strikePrice,
      totalCost: formatDecimal(totalCost),
      currency: grant.currency,
      status: "PENDING",
      requestedBy: input.requestedBy,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.equityExercises.set(exercise.id, exercise);
    return exercise;
  }

  async listEquityExercises(
    tenantId: string,
    grantId?: string,
  ): Promise<EquityExercise[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.equityExercises.values()]
      .filter(
        (exercise) =>
          exercise.tenantId === tenantId &&
          (!grantId || exercise.grantId === grantId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async approveEquityExercise(input: {
    tenantId: string;
    exerciseId: string;
    approvedBy: string;
  }): Promise<EquityExercise> {
    const exercise = this.equityExercises.get(input.exerciseId);
    if (!exercise || exercise.tenantId !== input.tenantId) {
      notFound("EquityExercise", input.exerciseId);
    }
    if (exercise.status !== "PENDING") {
      throw new ConflictError(
        `equity exercise is ${exercise.status}`,
      );
    }
    if (exercise.requestedBy === input.approvedBy) {
      throw new ConflictError(
        "EQ_SELF_APPROVAL: the requester cannot approve the exercise",
      );
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    exercise.status = "APPROVED";
    exercise.approvedBy = input.approvedBy;
    exercise.approvedAt = now();
    exercise.updatedAt = exercise.approvedAt;
    exercise.version += 1;
    return exercise;
  }

  async settleEquityExercise(input: {
    tenantId: string;
    exerciseId: string;
  }): Promise<EquityExercise> {
    const exercise = this.equityExercises.get(input.exerciseId);
    if (!exercise || exercise.tenantId !== input.tenantId) {
      notFound("EquityExercise", input.exerciseId);
    }
    if (exercise.status !== "APPROVED") {
      throw new ConflictError(
        `equity exercise is ${exercise.status}`,
      );
    }
    exercise.status = "SETTLED";
    exercise.settledAt = now();
    exercise.updatedAt = exercise.settledAt;
    exercise.version += 1;
    const grant = await this.getEquityGrant(
      input.tenantId,
      exercise.grantId,
    );
    const settled = [...this.equityExercises.values()]
      .filter(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.grantId === grant.id &&
          candidate.status !== "CANCELLED",
      )
      .reduce((sum, candidate) => sum + parseDecimal(candidate.units), 0n);
    if (settled >= parseDecimal(grant.totalUnits)) {
      grant.status = "EXHAUSTED";
      grant.updatedAt = now();
      grant.version += 1;
    }
    return exercise;
  }

  async createBounty(input: {
    tenantId: string;
    title: string;
    description: string;
    rewardAmount: string;
    currency: string;
    createdBy: string;
    dueAt?: string;
  }): Promise<Bounty> {
    if (!this.tenants.has(input.tenantId)) {
      notFound("Tenant", input.tenantId);
    }
    const creator = this.persons.get(input.createdBy);
    if (!creator || creator.tenantId !== input.tenantId) {
      notFound("Person", input.createdBy);
    }
    if (parseDecimal(input.rewardAmount) <= 0n) {
      throw new ConflictError("BOUNTY_REWARD_MUST_BE_POSITIVE");
    }
    const timestamp = now();
    const bounty: Bounty = {
      id: randomUUID(),
      tenantId: input.tenantId,
      title: input.title,
      description: input.description,
      rewardAmount: formatDecimal(parseDecimal(input.rewardAmount)),
      currency: input.currency,
      status: "OPEN",
      createdBy: input.createdBy,
      dueAt: input.dueAt,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.bounties.set(bounty.id, bounty);
    return bounty;
  }

  async listBounties(
    tenantId: string,
    status?: Bounty["status"],
  ): Promise<Bounty[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.bounties.values()]
      .filter(
        (bounty) =>
          bounty.tenantId === tenantId &&
          (!status || bounty.status === status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBounty(tenantId: string, bountyId: string): Promise<Bounty> {
    const bounty = this.bounties.get(bountyId);
    if (!bounty || bounty.tenantId !== tenantId) {
      notFound("Bounty", bountyId);
    }
    return bounty;
  }

  async claimBounty(input: {
    tenantId: string;
    bountyId: string;
    personId: string;
  }): Promise<Bounty> {
    const bounty = await this.getBounty(input.tenantId, input.bountyId);
    if (bounty.status !== "OPEN") {
      throw new ConflictError(`bounty is ${bounty.status}`);
    }
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    bounty.status = "CLAIMED";
    bounty.assigneePersonId = input.personId;
    bounty.claimedAt = now();
    bounty.updatedAt = bounty.claimedAt;
    bounty.version += 1;
    return bounty;
  }

  async submitBounty(input: {
    tenantId: string;
    bountyId: string;
    personId: string;
    submissionRef: string;
  }): Promise<Bounty> {
    const bounty = await this.getBounty(input.tenantId, input.bountyId);
    if (bounty.status !== "CLAIMED") {
      throw new ConflictError(`bounty is ${bounty.status}`);
    }
    if (bounty.assigneePersonId !== input.personId) {
      throw new ConflictError("BOUNTY_ONLY_ASSIGNEE_CAN_SUBMIT");
    }
    bounty.status = "SUBMITTED";
    bounty.submissionRef = input.submissionRef;
    bounty.submittedAt = now();
    bounty.updatedAt = bounty.submittedAt;
    bounty.version += 1;
    return bounty;
  }

  async acceptBounty(input: {
    tenantId: string;
    bountyId: string;
    reviewerPersonId: string;
    paymentRef?: string;
  }): Promise<Bounty> {
    const bounty = await this.getBounty(input.tenantId, input.bountyId);
    if (bounty.status !== "SUBMITTED") {
      throw new ConflictError(`bounty is ${bounty.status}`);
    }
    if (bounty.assigneePersonId === input.reviewerPersonId) {
      throw new ConflictError(
        "BOUNTY_SELF_ACCEPTANCE: the assignee cannot accept the bounty",
      );
    }
    const reviewer = this.persons.get(input.reviewerPersonId);
    if (!reviewer || reviewer.tenantId !== input.tenantId) {
      notFound("Person", input.reviewerPersonId);
    }
    bounty.status = "ACCEPTED";
    bounty.acceptedBy = input.reviewerPersonId;
    bounty.acceptedAt = now();
    bounty.paymentRef = input.paymentRef;
    bounty.updatedAt = bounty.acceptedAt;
    bounty.version += 1;
    return bounty;
  }

  async cancelBounty(input: {
    tenantId: string;
    bountyId: string;
  }): Promise<Bounty> {
    const bounty = await this.getBounty(input.tenantId, input.bountyId);
    if (bounty.status === "ACCEPTED" || bounty.status === "CANCELLED") {
      throw new ConflictError(`bounty is ${bounty.status}`);
    }
    bounty.status = "CANCELLED";
    bounty.cancelledAt = now();
    bounty.updatedAt = bounty.cancelledAt;
    bounty.version += 1;
    return bounty;
  }

  async savePolicyEngineRecord(input: {
    tenantId: string;
    recordType: string;
    payload: Record<string, unknown>;
    personId?: string;
    period?: string;
    status?: string;
    recordId?: string;
  }): Promise<PolicyEngineRecord> {
    const timestamp = now();
    const existing = input.recordId
      ? this.policyEngineRecords.get(input.recordId)
      : undefined;
    const record: PolicyEngineRecord = existing
      ? {
          ...existing,
          payload: input.payload,
          status: input.status ?? existing.status,
          personId: input.personId ?? existing.personId,
          period: input.period ?? existing.period,
          updatedAt: timestamp,
          version: existing.version + 1,
        }
      : {
          id: input.recordId ?? randomUUID(),
          tenantId: input.tenantId,
          recordType: input.recordType,
          personId: input.personId,
          period: input.period,
          status: input.status ?? "RECORDED",
          payload: input.payload,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
        };
    this.policyEngineRecords.set(record.id, record);
    return record;
  }

  async getPolicyEngineRecord(
    tenantId: string,
    recordId: string,
  ): Promise<PolicyEngineRecord> {
    const record = this.policyEngineRecords.get(recordId);
    if (!record || record.tenantId !== tenantId) {
      notFound("PolicyEngineRecord", recordId);
    }
    return record;
  }

  async listPolicyEngineRecords(
    tenantId: string,
    filter?: {
      recordType?: string;
      personId?: string;
      period?: string;
      status?: string;
    },
  ): Promise<PolicyEngineRecord[]> {
    return [...this.policyEngineRecords.values()]
      .filter((record) => record.tenantId === tenantId)
      .filter(
        (record) =>
          (!filter?.recordType || record.recordType === filter.recordType) &&
          (!filter?.personId || record.personId === filter.personId) &&
          (!filter?.period || record.period === filter.period) &&
          (!filter?.status || record.status === filter.status),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async updatePolicyEngineRecord(input: {
    tenantId: string;
    recordId: string;
    payload?: Record<string, unknown>;
    status?: string;
    version?: number;
  }): Promise<PolicyEngineRecord> {
    const record = await this.getPolicyEngineRecord(
      input.tenantId,
      input.recordId,
    );
    if (input.version !== undefined && input.version !== record.version) {
      throw new ConflictError(
        `policy record version mismatch: expected ${record.version}`,
      );
    }
    const updated: PolicyEngineRecord = {
      ...record,
      payload: input.payload ?? record.payload,
      status: input.status ?? record.status,
      updatedAt: now(),
      version: record.version + 1,
    };
    this.policyEngineRecords.set(updated.id, updated);
    return updated;
  }

  async createIncentiveAwardBatch(input: {
    tenantId: string;
    batchNo: string;
    awardType: IncentiveAwardType;
    period: string;
    cycleId?: string;
    currency: string;
    createdBy: string;
    sourceRecordIds?: string[];
    lines: Array<{
      personId: string;
      amount: string;
      sourceRecordId?: string;
      sourceLineRef?: string;
      note?: string;
    }>;
  }): Promise<IncentiveAwardBatch> {
    if (
      [...this.incentiveAwardBatches.values()].some(
        (batch) =>
          batch.tenantId === input.tenantId && batch.batchNo === input.batchNo,
      )
    ) {
      throw new ConflictError(
        `incentive award batch ${input.batchNo} already exists`,
      );
    }
    if (input.lines.length === 0) {
      throw new ConflictError("incentive award batch requires at least one line");
    }
    const sourceRecordIds = [
      ...new Set([
        ...(input.sourceRecordIds ?? []),
        ...input.lines
          .map((line) => line.sourceRecordId)
          .filter((value): value is string => Boolean(value)),
      ]),
    ];
    const usedSource = [...this.incentiveAwardBatches.values()].find(
      (batch) =>
        batch.tenantId === input.tenantId &&
        batch.status !== "CANCELLED" &&
        batch.sourceRecordIds.some((id) => sourceRecordIds.includes(id)),
    );
    if (usedSource) {
      throw new ConflictError(
        `source record already used by award batch ${usedSource.batchNo}`,
      );
    }
    const seenLines = new Set<string>();
    let total = 0n;
    const batchId = randomUUID();
    const lines = input.lines.map((line) => {
      const key = `${line.personId}:${line.sourceLineRef ?? ""}`;
      if (seenLines.has(key)) {
        throw new ConflictError(`duplicate award line ${key}`);
      }
      seenLines.add(key);
      const amount = parseDecimal(line.amount);
      if (amount <= 0n) {
        throw new ConflictError("incentive award line amount must be positive");
      }
      total += amount;
      return {
        id: randomUUID(),
        batchId,
        personId: line.personId,
        amount: formatDecimal(amount),
        currency: input.currency.toUpperCase(),
        sourceRecordId: line.sourceRecordId,
        sourceLineRef: line.sourceLineRef,
        note: line.note,
      };
    });
    const timestamp = now();
    const batch: IncentiveAwardBatch = {
      id: batchId,
      tenantId: input.tenantId,
      batchNo: input.batchNo,
      awardType: input.awardType,
      period: input.period,
      cycleId: input.cycleId,
      currency: input.currency.toUpperCase(),
      status: "DRAFT",
      totalAmount: formatDecimal(total),
      lineCount: lines.length,
      sourceRecordIds,
      createdBy: input.createdBy,
      lines,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.incentiveAwardBatches.set(batch.id, batch);
    return batch;
  }

  async listIncentiveAwardBatches(
    tenantId: string,
    filter?: { awardType?: string; period?: string; status?: string },
  ): Promise<IncentiveAwardBatch[]> {
    return [...this.incentiveAwardBatches.values()]
      .filter((batch) => batch.tenantId === tenantId)
      .filter(
        (batch) =>
          (!filter?.awardType || batch.awardType === filter.awardType) &&
          (!filter?.period || batch.period === filter.period) &&
          (!filter?.status || batch.status === filter.status),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getIncentiveAwardBatch(
    tenantId: string,
    batchId: string,
  ): Promise<IncentiveAwardBatch> {
    const batch = this.incentiveAwardBatches.get(batchId);
    if (!batch || batch.tenantId !== tenantId) {
      notFound("IncentiveAwardBatch", batchId);
    }
    return batch;
  }

  async commandIncentiveAwardBatch(input: {
    tenantId: string;
    batchId: string;
    command:
      | "SUBMIT"
      | "APPROVE"
      | "LOCK"
      | "EXPORT"
      | "ACKNOWLEDGE"
      | "CANCEL";
    actorPersonId: string;
    paymentRef?: string;
  }): Promise<IncentiveAwardBatch> {
    const batch = await this.getIncentiveAwardBatch(
      input.tenantId,
      input.batchId,
    );
    const timestamp = now();
    const transition: Record<string, [string, string]> = {
      SUBMIT: ["DRAFT", "PENDING_APPROVAL"],
      APPROVE: ["PENDING_APPROVAL", "APPROVED"],
      LOCK: ["APPROVED", "LOCKED"],
      EXPORT: ["LOCKED", "EXPORTED"],
      ACKNOWLEDGE: ["EXPORTED", "ACKNOWLEDGED"],
      CANCEL: [batch.status, "CANCELLED"],
    };
    const expected = transition[input.command];
    if (!expected || batch.status !== expected[0]) {
      throw new ConflictError(
        `cannot ${input.command} incentive award batch in status ${batch.status}`,
      );
    }
    if (
      input.command === "APPROVE" &&
      input.actorPersonId === batch.createdBy
    ) {
      throw new ConflictError(
        "AWARD_BATCH_SELF_APPROVAL: creator cannot approve the batch",
      );
    }
    if (input.command === "ACKNOWLEDGE" && !input.paymentRef?.trim()) {
      throw new ConflictError("payment reference is required to acknowledge");
    }
    const updated: IncentiveAwardBatch = {
      ...batch,
      status: expected[1] as IncentiveAwardBatch["status"],
      approvedBy:
        input.command === "APPROVE" ? input.actorPersonId : batch.approvedBy,
      approvedAt:
        input.command === "APPROVE" ? timestamp : batch.approvedAt,
      lockedAt: input.command === "LOCK" ? timestamp : batch.lockedAt,
      exportedAt: input.command === "EXPORT" ? timestamp : batch.exportedAt,
      acknowledgedAt:
        input.command === "ACKNOWLEDGE" ? timestamp : batch.acknowledgedAt,
      paymentRef:
        input.command === "ACKNOWLEDGE"
          ? input.paymentRef?.trim()
          : batch.paymentRef,
      updatedAt: timestamp,
      version: batch.version + 1,
    };
    this.incentiveAwardBatches.set(updated.id, updated);
    return updated;
  }

  async createEmploymentContract(input: {
    tenantId: string;
    personId: string;
    contractCode: string;
    employmentType: EmploymentContract["employmentType"];
    startDate: string;
    endDate?: string;
    workLocation: string;
    legalEntity?: string;
    currency: string;
    fixedMonthlySalary: string;
    minimumMonthlyWage: string;
    taxRate: string;
    socialInsuranceRate: string;
    deductionCapRate: string;
    variableShareCapRate: string;
    deductionOrder: string[];
    deductionTypeCaps: Record<string, string>;
    smoothingThresholdRate: string;
    smoothingMode?: "NONE" | "BLOCK" | "MOVING_AVERAGE" | "RAMP";
    smoothingWindowPeriods?: number;
    smoothingMaxStepRate?: string;
    compensationTemplateCode?: string;
    bankAccountRef?: string;
    consentSignatureRef: string;
    consentSignedAt?: string;
  }): Promise<EmploymentContract> {
    if (!this.tenants.has(input.tenantId)) {
      notFound("Tenant", input.tenantId);
    }
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (
      [...this.employmentContracts.values()].some(
        (contract) =>
          contract.tenantId === input.tenantId &&
          contract.contractCode === input.contractCode,
      )
    ) {
      throw new ConflictError(
        `employment contract ${input.contractCode} already exists`,
      );
    }
    if (parseDecimal(input.fixedMonthlySalary) < 0n) {
      throw new ConflictError("CONTRACT_FIXED_SALARY_NEGATIVE");
    }
    if (parseDecimal(input.minimumMonthlyWage) < 0n) {
      throw new ConflictError("CONTRACT_MINIMUM_WAGE_NEGATIVE");
    }
    if (
      parseDecimal(input.taxRate) < 0n ||
      parseDecimal(input.taxRate) > 1_000_000n
    ) {
      throw new ConflictError("CONTRACT_TAX_RATE_OUT_OF_RANGE");
    }
    if (
      parseDecimal(input.socialInsuranceRate) < 0n ||
      parseDecimal(input.socialInsuranceRate) > 1_000_000n
    ) {
      throw new ConflictError(
        "CONTRACT_SOCIAL_INSURANCE_RATE_OUT_OF_RANGE",
      );
    }
    if (
      parseDecimal(input.deductionCapRate) < 0n ||
      parseDecimal(input.deductionCapRate) > 1_000_000n
    ) {
      throw new ConflictError("CONTRACT_DEDUCTION_CAP_OUT_OF_RANGE");
    }
    if (
      parseDecimal(input.variableShareCapRate) < 0n ||
      parseDecimal(input.variableShareCapRate) > 1_000_000n
    ) {
      throw new ConflictError("CONTRACT_VARIABLE_SHARE_CAP_OUT_OF_RANGE");
    }
    const deductionOrder =
      input.deductionOrder.length > 0
        ? [...input.deductionOrder]
        : ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"];
    for (const [type, rate] of Object.entries(input.deductionTypeCaps)) {
      const parsed = parseDecimal(rate);
      if (parsed < 0n || parsed > 1_000_000n) {
        throw new ConflictError(
          `CONTRACT_DEDUCTION_TYPE_CAP_OUT_OF_RANGE:${type}`,
        );
      }
    }
    const smoothingRate = parseDecimal(input.smoothingThresholdRate);
    if (smoothingRate < 0n || smoothingRate > 10_000_000n) {
      throw new ConflictError("CONTRACT_SMOOTHING_THRESHOLD_OUT_OF_RANGE");
    }
    if (
      input.endDate &&
      Date.parse(input.endDate) <= Date.parse(input.startDate)
    ) {
      throw new ConflictError("CONTRACT_END_BEFORE_START");
    }
    const timestamp = now();
    const contract: EmploymentContract = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      contractCode: input.contractCode,
      employmentType: input.employmentType,
      startDate: input.startDate,
      endDate: input.endDate,
      workLocation: input.workLocation,
      legalEntity: input.legalEntity,
      currency: input.currency,
      fixedMonthlySalary: formatDecimal(
        parseDecimal(input.fixedMonthlySalary),
      ),
      minimumMonthlyWage: formatDecimal(
        parseDecimal(input.minimumMonthlyWage),
      ),
      taxRate: formatDecimal(parseDecimal(input.taxRate)),
      socialInsuranceRate: formatDecimal(
        parseDecimal(input.socialInsuranceRate),
      ),
      deductionCapRate: formatDecimal(
        parseDecimal(input.deductionCapRate),
      ),
      variableShareCapRate: formatDecimal(
        parseDecimal(input.variableShareCapRate),
      ),
      deductionOrder,
      deductionTypeCaps: Object.fromEntries(
        Object.entries(input.deductionTypeCaps).map(([type, rate]) => [
          type,
          formatDecimal(parseDecimal(rate)),
        ]),
      ),
      smoothingThresholdRate: formatDecimal(smoothingRate),
      smoothingMode: input.smoothingMode ?? "BLOCK",
      smoothingWindowPeriods: input.smoothingWindowPeriods ?? 3,
      smoothingMaxStepRate: formatDecimal(
        parseDecimal(input.smoothingMaxStepRate ?? "0.5"),
      ),
      compensationTemplateCode: input.compensationTemplateCode,
      bankAccountRef: input.bankAccountRef,
      payPlanVersion: 1,
      consentSignatureRef: input.consentSignatureRef,
      consentSignedAt: input.consentSignedAt ?? timestamp,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.employmentContracts.set(contract.id, contract);
    return contract;
  }

  async amendEmploymentContract(input: {
    tenantId: string;
    contractId: string;
    fixedMonthlySalary: string;
    minimumMonthlyWage: string;
    taxRate: string;
    socialInsuranceRate: string;
    deductionCapRate: string;
    variableShareCapRate: string;
    deductionOrder: string[];
    deductionTypeCaps: Record<string, string>;
    smoothingThresholdRate: string;
    smoothingMode?: "NONE" | "BLOCK" | "MOVING_AVERAGE" | "RAMP";
    smoothingWindowPeriods?: number;
    smoothingMaxStepRate?: string;
    compensationTemplateCode?: string;
    bankAccountRef?: string;
    effectiveFrom: string;
    consentSignatureRef: string;
    approvedBy: string;
  }): Promise<EmploymentContract> {
    const contract = this.employmentContracts.get(input.contractId);
    if (!contract || contract.tenantId !== input.tenantId) {
      notFound("EmploymentContract", input.contractId);
    }
    if (contract.status !== "ACTIVE") {
      throw new ConflictError(`employment contract is ${contract.status}`);
    }
    const effectiveMs = Date.parse(input.effectiveFrom);
    const future = effectiveMs > Date.now();
    if (future && effectiveMs > Date.now() + 180 * 24 * 60 * 60 * 1000) {
      throw new ConflictError(
        "CONTRACT_AMENDMENT_TOO_FAR_IN_FUTURE: maximum 180 days",
      );
    }
    if (!input.consentSignatureRef.trim()) {
      throw new ConflictError("CONTRACT_CONSENT_SIGNATURE_REQUIRED");
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    if (parseDecimal(input.fixedMonthlySalary) < 0n) {
      throw new ConflictError("CONTRACT_FIXED_SALARY_NEGATIVE");
    }
    if (parseDecimal(input.minimumMonthlyWage) < 0n) {
      throw new ConflictError("CONTRACT_MINIMUM_WAGE_NEGATIVE");
    }
    for (const [field, value] of [
      ["taxRate", input.taxRate],
      ["socialInsuranceRate", input.socialInsuranceRate],
      ["deductionCapRate", input.deductionCapRate],
      ["variableShareCapRate", input.variableShareCapRate],
    ] as const) {
      const parsed = parseDecimal(value);
      if (parsed < 0n || parsed > 1_000_000n) {
        throw new ConflictError(`CONTRACT_${field}_OUT_OF_RANGE`);
      }
    }
    const beforeTerms = {
      fixedMonthlySalary: contract.fixedMonthlySalary,
      minimumMonthlyWage: contract.minimumMonthlyWage,
      taxRate: contract.taxRate,
      socialInsuranceRate: contract.socialInsuranceRate,
      deductionCapRate: contract.deductionCapRate,
      variableShareCapRate: contract.variableShareCapRate,
      deductionOrder: [...contract.deductionOrder],
      deductionTypeCaps: { ...contract.deductionTypeCaps },
      smoothingThresholdRate: contract.smoothingThresholdRate,
      smoothingMode: contract.smoothingMode,
      smoothingWindowPeriods: contract.smoothingWindowPeriods,
      smoothingMaxStepRate: contract.smoothingMaxStepRate,
      compensationTemplateCode: contract.compensationTemplateCode,
      bankAccountRef: contract.bankAccountRef,
      payPlanVersion: contract.payPlanVersion,
    };
    if (future) {
      const amendments = this.contractAmendments.get(contract.id) ?? [];
      const payPlanVersion =
        Math.max(
          contract.payPlanVersion,
          ...amendments
            .filter((amendment) => amendment.status !== "CANCELLED")
            .map((amendment) => amendment.payPlanVersion),
        ) + 1;
      const scheduledTerms = {
        fixedMonthlySalary: formatDecimal(
          parseDecimal(input.fixedMonthlySalary),
        ),
        minimumMonthlyWage: formatDecimal(
          parseDecimal(input.minimumMonthlyWage),
        ),
        taxRate: formatDecimal(parseDecimal(input.taxRate)),
        socialInsuranceRate: formatDecimal(
          parseDecimal(input.socialInsuranceRate),
        ),
        deductionCapRate: formatDecimal(
          parseDecimal(input.deductionCapRate),
        ),
        variableShareCapRate: formatDecimal(
          parseDecimal(input.variableShareCapRate),
        ),
        deductionOrder:
          input.deductionOrder.length > 0
            ? [...input.deductionOrder]
            : [...contract.deductionOrder],
        bankAccountRef: input.bankAccountRef,
        payPlanVersion,
      };
      amendments.push({
        id: randomUUID(),
        tenantId: input.tenantId,
        contractId: contract.id,
        payPlanVersion,
        beforeTerms,
        afterTerms: scheduledTerms,
        effectiveFrom: input.effectiveFrom,
        consentSignatureRef: input.consentSignatureRef,
        approvedBy: input.approvedBy,
        status: "SCHEDULED",
        createdAt: now(),
      });
      this.contractAmendments.set(contract.id, amendments);
      return contract;
    }
    contract.fixedMonthlySalary = formatDecimal(
      parseDecimal(input.fixedMonthlySalary),
    );
    contract.minimumMonthlyWage = formatDecimal(
      parseDecimal(input.minimumMonthlyWage),
    );
    contract.taxRate = formatDecimal(parseDecimal(input.taxRate));
    contract.socialInsuranceRate = formatDecimal(
      parseDecimal(input.socialInsuranceRate),
    );
    contract.deductionCapRate = formatDecimal(
      parseDecimal(input.deductionCapRate),
    );
    contract.variableShareCapRate = formatDecimal(
      parseDecimal(input.variableShareCapRate),
    );
    if (input.deductionOrder.length > 0) {
      contract.deductionOrder = [...input.deductionOrder];
    }
    if (Object.keys(input.deductionTypeCaps).length > 0) {
      contract.deductionTypeCaps = Object.fromEntries(
        Object.entries(input.deductionTypeCaps).map(([type, rate]) => [
          type,
          formatDecimal(parseDecimal(rate)),
        ]),
      );
    }
    contract.smoothingThresholdRate = formatDecimal(
      parseDecimal(input.smoothingThresholdRate),
    );
    contract.smoothingMode = input.smoothingMode ?? contract.smoothingMode;
    contract.smoothingWindowPeriods =
      input.smoothingWindowPeriods ?? contract.smoothingWindowPeriods;
    contract.smoothingMaxStepRate = formatDecimal(
      parseDecimal(
        input.smoothingMaxStepRate ?? contract.smoothingMaxStepRate ?? "0.5",
      ),
    );
    if (input.compensationTemplateCode !== undefined) {
      contract.compensationTemplateCode = input.compensationTemplateCode;
    }
    contract.bankAccountRef = input.bankAccountRef;
    const existingAmendments =
      this.contractAmendments.get(contract.id) ?? [];
    contract.payPlanVersion =
      Math.max(
        contract.payPlanVersion,
        ...existingAmendments
          .filter((amendment) => amendment.status !== "CANCELLED")
          .map((amendment) => amendment.payPlanVersion),
      ) + 1;
    contract.consentSignatureRef = input.consentSignatureRef;
    contract.consentSignedAt = input.effectiveFrom;
    contract.version += 1;
    contract.updatedAt = now();
    const afterTerms = {
      fixedMonthlySalary: contract.fixedMonthlySalary,
      minimumMonthlyWage: contract.minimumMonthlyWage,
      taxRate: contract.taxRate,
      socialInsuranceRate: contract.socialInsuranceRate,
      deductionCapRate: contract.deductionCapRate,
      variableShareCapRate: contract.variableShareCapRate,
      deductionOrder: [...contract.deductionOrder],
      deductionTypeCaps: { ...contract.deductionTypeCaps },
      smoothingThresholdRate: contract.smoothingThresholdRate,
      smoothingMode: contract.smoothingMode,
      smoothingWindowPeriods: contract.smoothingWindowPeriods,
      smoothingMaxStepRate: contract.smoothingMaxStepRate,
      compensationTemplateCode: contract.compensationTemplateCode,
      bankAccountRef: contract.bankAccountRef,
      payPlanVersion: contract.payPlanVersion,
    };
    const amendment: EmploymentContractAmendment = {
      id: randomUUID(),
      tenantId: input.tenantId,
      contractId: contract.id,
      payPlanVersion: contract.payPlanVersion,
      beforeTerms,
      afterTerms,
      effectiveFrom: input.effectiveFrom,
      consentSignatureRef: input.consentSignatureRef,
      approvedBy: input.approvedBy,
      status: "APPLIED",
      appliedAt: now(),
      createdAt: now(),
    };
    const existing = this.contractAmendments.get(contract.id) ?? [];
    existing.push(amendment);
    this.contractAmendments.set(contract.id, existing);
    return contract;
  }

  async listEmploymentContractAmendments(
    tenantId: string,
    contractId: string,
  ): Promise<EmploymentContractAmendment[]> {
    const contract = this.employmentContracts.get(contractId);
    if (!contract || contract.tenantId !== tenantId) {
      notFound("EmploymentContract", contractId);
    }
    return [...(this.contractAmendments.get(contractId) ?? [])].map(
      (amendment) => structuredClone(amendment),
    );
  }

  async applyDueContractAmendments(
    tenantId: string,
  ): Promise<EmploymentContractAmendment[]> {
    const applied: EmploymentContractAmendment[] = [];
    for (const contract of this.employmentContracts.values()) {
      if (contract.tenantId !== tenantId) continue;
      const amendments = this.contractAmendments.get(contract.id) ?? [];
      const due = amendments
        .filter(
          (amendment) =>
            amendment.status === "SCHEDULED" &&
            Date.parse(amendment.effectiveFrom) <= Date.now(),
        )
        .sort((a, b) =>
          a.effectiveFrom.localeCompare(b.effectiveFrom),
        );
      for (const amendment of due) {
        const terms = amendment.afterTerms as Record<string, unknown>;
        contract.fixedMonthlySalary = String(
          terms.fixedMonthlySalary ?? contract.fixedMonthlySalary,
        );
        contract.minimumMonthlyWage = String(
          terms.minimumMonthlyWage ?? contract.minimumMonthlyWage,
        );
        contract.taxRate = String(terms.taxRate ?? contract.taxRate);
        contract.socialInsuranceRate = String(
          terms.socialInsuranceRate ?? contract.socialInsuranceRate,
        );
        contract.deductionCapRate = String(
          terms.deductionCapRate ?? contract.deductionCapRate,
        );
        contract.variableShareCapRate = String(
          terms.variableShareCapRate ?? contract.variableShareCapRate,
        );
        if (Array.isArray(terms.deductionOrder)) {
          contract.deductionOrder = terms.deductionOrder as string[];
        }
        contract.bankAccountRef =
          typeof terms.bankAccountRef === "string"
            ? terms.bankAccountRef
            : undefined;
        contract.payPlanVersion = amendment.payPlanVersion;
        contract.consentSignatureRef = amendment.consentSignatureRef;
        contract.consentSignedAt = amendment.effectiveFrom;
        contract.version += 1;
        contract.updatedAt = now();
        amendment.status = "APPLIED";
        amendment.appliedAt = now();
        applied.push(structuredClone(amendment));
      }
    }
    return applied;
  }

  async cancelContractAmendment(input: {
    tenantId: string;
    contractId: string;
    amendmentId: string;
    reason: string;
  }): Promise<EmploymentContractAmendment> {
    const amendments = this.contractAmendments.get(input.contractId) ?? [];
    const amendment = amendments.find(
      (candidate) =>
        candidate.id === input.amendmentId &&
        candidate.tenantId === input.tenantId,
    );
    if (!amendment) notFound("EmploymentContractAmendment", input.amendmentId);
    if (amendment.status !== "SCHEDULED") {
      throw new ConflictError(
        `contract amendment is ${amendment.status}`,
      );
    }
    amendment.status = "CANCELLED";
    amendment.cancelledAt = now();
    amendment.cancelReason = input.reason;
    return structuredClone(amendment);
  }

  async createAdverseAction(input: {
    tenantId: string;
    personId: string;
    actionType: AdverseActionCase["actionType"];
    reason: string;
    performanceBasis: string;
    evidenceRefs: string[];
    requestedBy: string;
  }): Promise<AdverseActionCase> {
    if (!this.tenants.has(input.tenantId)) {
      notFound("Tenant", input.tenantId);
    }
    for (const personId of [input.personId, input.requestedBy]) {
      const person = this.persons.get(personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", personId);
      }
    }
    const timestamp = now();
    const action: AdverseActionCase = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      actionType: input.actionType,
      status: "DRAFT",
      reason: input.reason,
      performanceBasis: input.performanceBasis,
      evidenceRefs: [...input.evidenceRefs],
      requestedBy: input.requestedBy,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.adverseActions.set(action.id, action);
    return action;
  }

  async listAdverseActions(
    tenantId: string,
    personId?: string,
  ): Promise<AdverseActionCase[]> {
    return [...this.adverseActions.values()]
      .filter(
        (action) =>
          action.tenantId === tenantId &&
          (!personId || action.personId === personId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getAdverseAction(
    tenantId: string,
    actionId: string,
  ): Promise<AdverseActionCase> {
    const action = this.adverseActions.get(actionId);
    if (!action || action.tenantId !== tenantId) {
      notFound("AdverseActionCase", actionId);
    }
    return action;
  }

  async reviewAdverseAction(input: {
    tenantId: string;
    actionId: string;
    legalReviewerId: string;
    legalReviewRef: string;
    decision: "APPROVE" | "REJECT";
    note?: string;
  }): Promise<AdverseActionCase> {
    const action = await this.getAdverseAction(
      input.tenantId,
      input.actionId,
    );
    assertTransition(
      adverseActionTransitions,
      "AdverseActionCase",
      action.status,
      "LEGAL_REVIEW",
    );
    if (action.requestedBy === input.legalReviewerId) {
      throw new ConflictError(
        "ADVERSE_ACTION_SELF_REVIEW: the requester cannot perform legal review",
      );
    }
    const reviewer = this.persons.get(input.legalReviewerId);
    if (!reviewer || reviewer.tenantId !== input.tenantId) {
      notFound("Person", input.legalReviewerId);
    }
    action.status = "LEGAL_REVIEW";
    action.legalReviewerId = input.legalReviewerId;
    action.legalReviewRef = input.legalReviewRef;
    action.legalReviewedAt = now();
    action.updatedAt = action.legalReviewedAt;
    action.version += 1;
    if (input.decision === "REJECT") {
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        action.status,
        "REJECTED",
      );
      action.status = "REJECTED";
    }
    return action;
  }

  async approveAdverseAction(input: {
    tenantId: string;
    actionId: string;
    approvedBy: string;
  }): Promise<AdverseActionCase> {
    const action = await this.getAdverseAction(
      input.tenantId,
      input.actionId,
    );
    assertTransition(
      adverseActionTransitions,
      "AdverseActionCase",
      action.status,
      "APPROVED",
    );
    if (
      action.requestedBy === input.approvedBy ||
      action.legalReviewerId === input.approvedBy
    ) {
      throw new ConflictError(
        "ADVERSE_ACTION_SEPARATION_REQUIRED: requester and legal reviewer cannot approve",
      );
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    action.status = "APPROVED";
    action.approvedBy = input.approvedBy;
    action.approvedAt = now();
    action.updatedAt = action.approvedAt;
    action.version += 1;
    return action;
  }

  async activateAdverseAction(input: {
    tenantId: string;
    actionId: string;
    effectiveFrom: string;
  }): Promise<AdverseActionCase> {
    const action = await this.getAdverseAction(
      input.tenantId,
      input.actionId,
    );
    assertTransition(
      adverseActionTransitions,
      "AdverseActionCase",
      action.status,
      "ACTIVE",
    );
    action.status = "ACTIVE";
    action.effectiveFrom = input.effectiveFrom;
    action.updatedAt = now();
    action.version += 1;
    return action;
  }

  async completeAdverseAction(input: {
    tenantId: string;
    actionId: string;
  }): Promise<AdverseActionCase> {
    const action = await this.getAdverseAction(
      input.tenantId,
      input.actionId,
    );
    assertTransition(
      adverseActionTransitions,
      "AdverseActionCase",
      action.status,
      "COMPLETED",
    );
    action.status = "COMPLETED";
    action.completedAt = now();
    action.updatedAt = action.completedAt;
    action.version += 1;
    return action;
  }

  async cancelAdverseAction(input: {
    tenantId: string;
    actionId: string;
    reason: string;
  }): Promise<AdverseActionCase> {
    const action = await this.getAdverseAction(
      input.tenantId,
      input.actionId,
    );
    assertTransition(
      adverseActionTransitions,
      "AdverseActionCase",
      action.status,
      "CANCELLED",
    );
    action.status = "CANCELLED";
    action.cancelledAt = now();
    action.cancelReason = input.reason;
    action.updatedAt = action.cancelledAt;
    action.version += 1;
    return action;
  }

  async listEmploymentContracts(
    tenantId: string,
    personId?: string,
  ): Promise<EmploymentContract[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.employmentContracts.values()]
      .filter(
        (contract) =>
          contract.tenantId === tenantId &&
          (!personId || contract.personId === personId),
      )
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  async getEmploymentContract(
    tenantId: string,
    contractId: string,
  ): Promise<EmploymentContract> {
    const contract = this.employmentContracts.get(contractId);
    if (!contract || contract.tenantId !== tenantId) {
      notFound("EmploymentContract", contractId);
    }
    return contract;
  }

  async createPayrollRun(input: {
    tenantId: string;
    cycleId: string;
    periodStart: string;
    periodEnd: string;
    currency: string;
    preparedBy: string;
  }): Promise<PayrollRun> {
    const preparer = this.persons.get(input.preparedBy);
    if (!preparer || preparer.tenantId !== input.tenantId) {
      notFound("Person", input.preparedBy);
    }
    if (Date.parse(input.periodEnd) <= Date.parse(input.periodStart)) {
      throw new ConflictError("PAYROLL_PERIOD_INVALID");
    }
    const timestamp = now();
    const run: PayrollRun = {
      id: randomUUID(),
      tenantId: input.tenantId,
      cycleId: input.cycleId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      currency: input.currency,
      status: "DRAFT",
      preparedBy: input.preparedBy,
      totalGross: "0",
      totalDeductions: "0",
      totalTax: "0",
      totalSocialInsurance: "0",
      totalNet: "0",
      lineCount: 0,
      blockedCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.payrollRuns.set(run.id, run);
    return { ...run, lines: [] };
  }

  async listPayrollRuns(
    tenantId: string,
    cycleId?: string,
  ): Promise<PayrollRun[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.payrollRuns.values()]
      .filter(
        (run) =>
          run.tenantId === tenantId &&
          (!cycleId || run.cycleId === cycleId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((run) => ({
        ...run,
        lines: (this.payrollLines.get(run.id) ?? []).map((line) => ({
          ...line,
        })),
      }));
  }

  async getPayrollRun(
    tenantId: string,
    runId: string,
  ): Promise<PayrollRun> {
    const run = this.payrollRuns.get(runId);
    if (!run || run.tenantId !== tenantId) {
      notFound("PayrollRun", runId);
    }
    return {
      ...run,
      lines: (this.payrollLines.get(run.id) ?? []).map((line) => ({
        ...line,
      })),
    };
  }

  async savePayrollCalculation(input: {
    tenantId: string;
    runId: string;
    lines: Array<Omit<PayrollLine, "id" | "tenantId" | "runId" | "createdAt">>;
    totalGross: string;
    totalDeductions: string;
    totalTax: string;
    totalSocialInsurance: string;
    totalNet: string;
    blockedCount: number;
  }): Promise<PayrollRun> {
    const run = this.payrollRuns.get(input.runId);
    if (!run || run.tenantId !== input.tenantId) {
      notFound("PayrollRun", input.runId);
    }
    if (
      run.status !== "DRAFT" &&
      run.status !== "CALCULATED" &&
      run.status !== "BLOCKED"
    ) {
      throw new ConflictError(`payroll run is ${run.status}`);
    }
    const timestamp = now();
    const lines: PayrollLine[] = input.lines.map((line) => ({
      ...line,
      id: randomUUID(),
      tenantId: input.tenantId,
      runId: input.runId,
      createdAt: timestamp,
    }));
    this.payrollLines.set(input.runId, lines);
    run.status = input.blockedCount > 0 ? "BLOCKED" : "CALCULATED";
    run.totalGross = formatDecimal(parseDecimal(input.totalGross));
    run.totalDeductions = formatDecimal(
      parseDecimal(input.totalDeductions),
    );
    run.totalTax = formatDecimal(parseDecimal(input.totalTax));
    run.totalSocialInsurance = formatDecimal(
      parseDecimal(input.totalSocialInsurance),
    );
    run.totalNet = formatDecimal(parseDecimal(input.totalNet));
    run.lineCount = lines.length;
    run.blockedCount = input.blockedCount;
    run.updatedAt = timestamp;
    run.version += 1;
    return { ...run, lines: lines.map((line) => ({ ...line })) };
  }

  async approvePayrollRun(input: {
    tenantId: string;
    runId: string;
    approvedBy: string;
  }): Promise<PayrollRun> {
    const run = this.payrollRuns.get(input.runId);
    if (!run || run.tenantId !== input.tenantId) {
      notFound("PayrollRun", input.runId);
    }
    if (run.status !== "CALCULATED") {
      throw new ConflictError(`payroll run is ${run.status}`);
    }
    if (run.preparedBy === input.approvedBy) {
      throw new ConflictError(
        "PAYROLL_SELF_APPROVAL: the preparer cannot approve the run",
      );
    }
    const approver = this.persons.get(input.approvedBy);
    if (!approver || approver.tenantId !== input.tenantId) {
      notFound("Person", input.approvedBy);
    }
    run.status = "APPROVED";
    run.approvedBy = input.approvedBy;
    run.approvedAt = now();
    run.updatedAt = run.approvedAt;
    run.version += 1;
    return run;
  }

  async payPayrollRun(input: {
    tenantId: string;
    runId: string;
  }): Promise<PayrollRun> {
    const run = this.payrollRuns.get(input.runId);
    if (!run || run.tenantId !== input.tenantId) {
      notFound("PayrollRun", input.runId);
    }
    if (run.status !== "APPROVED") {
      throw new ConflictError(`payroll run is ${run.status}`);
    }
    run.status = "PAID";
    run.paidAt = now();
    run.updatedAt = run.paidAt;
    run.version += 1;
    return run;
  }

  async reversePayrollRun(input: {
    tenantId: string;
    runId: string;
    reason: string;
    reversedBy: string;
  }): Promise<PayrollRun> {
    const run = this.payrollRuns.get(input.runId);
    if (!run || run.tenantId !== input.tenantId) {
      notFound("PayrollRun", input.runId);
    }
    if (run.status !== "APPROVED" && run.status !== "PAID") {
      throw new ConflictError(`payroll run is ${run.status}`);
    }
    const person = this.persons.get(input.reversedBy);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.reversedBy);
    }
    run.status = "REVERSED";
    run.reversedAt = now();
    run.reversedBy = input.reversedBy;
    run.reversalReason = input.reason;
    run.updatedAt = run.reversedAt;
    run.version += 1;
    return run;
  }

  async cancelPayrollRun(input: {
    tenantId: string;
    runId: string;
  }): Promise<PayrollRun> {
    const run = this.payrollRuns.get(input.runId);
    if (!run || run.tenantId !== input.tenantId) {
      notFound("PayrollRun", input.runId);
    }
    if (
      run.status === "PAID" ||
      run.status === "REVERSED" ||
      run.status === "CANCELLED"
    ) {
      throw new ConflictError(`payroll run is ${run.status}`);
    }
    run.status = "CANCELLED";
    run.updatedAt = now();
    run.version += 1;
    return run;
  }

  async createSyncRun(input: {
    tenantId: string;
    connectionId: string;
    status: string;
    cursorBefore?: Record<string, unknown>;
  }): Promise<SyncRun> {
    await this.getIntegrationConnection(input.tenantId, input.connectionId);
    const timestamp = now();
    const run: SyncRun = {
      id: randomUUID(),
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      status: input.status,
      startedAt: input.status === "QUEUED" ? undefined : timestamp,
      cursorBefore: input.cursorBefore,
      recordsSeen: 0,
      recordsUpserted: 0,
      createdAt: timestamp,
    };
    this.syncRuns.set(run.id, run);
    return run;
  }

  async listSyncRuns(
    tenantId: string,
    connectionId?: string,
  ): Promise<SyncRun[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.syncRuns.values()]
      .filter(
        (run) =>
          run.tenantId === tenantId &&
          (!connectionId || run.connectionId === connectionId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async finishSyncRun(input: {
    tenantId: string;
    syncRunId: string;
    status: string;
    recordsSeen: number;
    recordsUpserted: number;
    cursorAfter?: Record<string, unknown>;
    errorSummary?: string;
  }): Promise<SyncRun> {
    const run = this.syncRuns.get(input.syncRunId);
    if (!run || run.tenantId !== input.tenantId) {
      notFound("SyncRun", input.syncRunId);
    }
    if (run.finishedAt) {
      throw new ConflictError(`sync run ${run.id} is already finished`);
    }
    const timestamp = now();
    run.status = input.status;
    run.recordsSeen = input.recordsSeen;
    run.recordsUpserted = input.recordsUpserted;
    run.cursorAfter = input.cursorAfter;
    run.errorSummary = input.errorSummary;
    run.finishedAt = timestamp;
    const connection = this.integrationConnections.get(run.connectionId);
    if (connection) {
      connection.lastSyncAt = timestamp;
      connection.updatedAt = timestamp;
    }
    return run;
  }

  async upsertExternalIdentity(input: {
    tenantId: string;
    sourceSystem: string;
    externalId: string;
    personId?: string;
    objectType: string;
  }): Promise<ExternalIdentity> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (input.personId) {
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
    }
    const key = [
      input.tenantId,
      input.sourceSystem,
      input.externalId,
      input.objectType,
    ].join(":");
    const existing = this.externalIdentities.get(key);
    if (existing) {
      if (input.personId) existing.personId = input.personId;
      return existing;
    }
    const identity: ExternalIdentity = {
      id: randomUUID(),
      tenantId: input.tenantId,
      sourceSystem: input.sourceSystem,
      externalId: input.externalId,
      personId: input.personId,
      objectType: input.objectType,
      createdAt: now(),
    };
    this.externalIdentities.set(key, identity);
    return identity;
  }

  async listExternalIdentities(
    tenantId: string,
    filter?: { sourceSystem?: string; objectType?: string },
  ): Promise<ExternalIdentity[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.externalIdentities.values()]
      .filter(
        (identity) =>
          identity.tenantId === tenantId &&
          (!filter?.sourceSystem ||
            identity.sourceSystem === filter.sourceSystem) &&
          (!filter?.objectType ||
            identity.objectType === filter.objectType),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async receiveWebhook(input: {
    tenantId: string;
    sourceSystem: string;
    messageId: string;
    payloadHash: string;
  }): Promise<WebhookInboxMessage> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const key = [
      input.tenantId,
      input.sourceSystem,
      input.messageId,
    ].join(":");
    const existing = this.webhooks.get(key);
    if (existing) return existing;
    const message: WebhookInboxMessage = {
      id: randomUUID(),
      tenantId: input.tenantId,
      sourceSystem: input.sourceSystem,
      messageId: input.messageId,
      payloadHash: input.payloadHash,
      receivedAt: now(),
      status: "RECEIVED",
    };
    this.webhooks.set(key, message);
    return message;
  }

  async listWebhooks(
    tenantId: string,
    filter?: { status?: string; sourceSystem?: string },
  ): Promise<WebhookInboxMessage[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.webhooks.values()]
      .filter(
        (message) =>
          message.tenantId === tenantId &&
          (!filter?.status || message.status === filter.status) &&
          (!filter?.sourceSystem ||
            message.sourceSystem === filter.sourceSystem),
      )
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async processWebhook(input: {
    tenantId: string;
    webhookId: string;
    status: "PROCESSED" | "FAILED";
    errorCode?: string;
  }): Promise<WebhookInboxMessage> {
    const message = [...this.webhooks.values()].find(
      (candidate) =>
        candidate.id === input.webhookId &&
        candidate.tenantId === input.tenantId,
    );
    if (!message) notFound("WebhookInboxMessage", input.webhookId);
    if (message.processedAt) {
      throw new ConflictError(
        `webhook ${message.id} is already processed`,
      );
    }
    message.status = input.status;
    message.errorCode = input.errorCode;
    message.processedAt = now();
    return message;
  }

  async receiveInboxMessage(input: {
    tenantId: string;
    consumerName: string;
    messageId: string;
  }): Promise<InboxMessage> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const key = [
      input.tenantId,
      input.consumerName,
      input.messageId,
    ].join(":");
    const existing = this.inboxMessages.get(key);
    if (existing) return existing;
    const message: InboxMessage = {
      id: randomUUID(),
      tenantId: input.tenantId,
      consumerName: input.consumerName,
      messageId: input.messageId,
      receivedAt: now(),
      status: "RECEIVED",
    };
    this.inboxMessages.set(key, message);
    return message;
  }

  async listInboxMessages(
    tenantId: string,
    filter?: { consumerName?: string; status?: string },
  ): Promise<InboxMessage[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.inboxMessages.values()]
      .filter(
        (message) =>
          message.tenantId === tenantId &&
          (!filter?.consumerName ||
            message.consumerName === filter.consumerName) &&
          (!filter?.status || message.status === filter.status),
      )
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async processInboxMessage(input: {
    tenantId: string;
    inboxMessageId: string;
    status: "PROCESSED" | "FAILED" | "IGNORED";
    errorCode?: string;
  }): Promise<InboxMessage> {
    const message = [...this.inboxMessages.values()].find(
      (candidate) =>
        candidate.id === input.inboxMessageId &&
        candidate.tenantId === input.tenantId,
    );
    if (!message) notFound("InboxMessage", input.inboxMessageId);
    if (message.processedAt) {
      throw new ConflictError(
        `inbox message ${message.id} is already processed`,
      );
    }
    message.status = input.status;
    message.errorCode = input.errorCode;
    message.processedAt = now();
    return message;
  }

  private assertUserNotLinked(
    tenantId: string,
    userId: string,
    exceptPersonId?: string,
  ): void {
    const linked = [...this.persons.values()].find(
      (person) =>
        person.tenantId === tenantId &&
        person.userId === userId &&
        person.id !== exceptPersonId,
    );
    if (linked) {
      throw new ConflictError(
        `user ${userId} is already linked to person ${linked.id}`,
      );
    }
  }
}

function iso(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoDate(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function decimalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const text = String(value).trim();
  return text.includes(".")
    ? text.replace(/0+$/, "").replace(/\.$/, "")
    : text;
}

function addUtcMonths(value: Date, months: number): string {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth() + months,
      value.getUTCDate(),
    ),
  ).toISOString();
}

function computeEquityVesting(
  grant: EquityGrant,
  exercises: EquityExercise[],
  asOf: string,
): EquityVesting {
  const total = parseDecimal(grant.totalUnits);
  const asOfDate = new Date(asOf);
  const start = new Date(grant.vestingStart);
  let elapsedMonths =
    (asOfDate.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (asOfDate.getUTCMonth() - start.getUTCMonth());
  if (asOfDate.getUTCDate() < start.getUTCDate()) elapsedMonths -= 1;
  elapsedMonths = Math.max(0, elapsedMonths);
  const vestedMonths =
    elapsedMonths < grant.cliffMonths
      ? 0
      : Math.min(grant.vestingMonths, elapsedMonths);
  const vested =
    grant.vestingMonths === 0
      ? 0n
      : (total * BigInt(vestedMonths)) / BigInt(grant.vestingMonths);
  const exercised = exercises
    .filter((exercise) => exercise.status !== "CANCELLED")
    .reduce((sum, exercise) => sum + parseDecimal(exercise.units), 0n);
  const available = vested > exercised ? vested - exercised : 0n;
  let nextVestAt: string | undefined;
  if (vestedMonths < grant.vestingMonths) {
    nextVestAt =
      vestedMonths === 0 && grant.cliffMonths > 0
        ? addUtcMonths(start, grant.cliffMonths)
        : addUtcMonths(start, vestedMonths + 1);
  }
  return {
    grantId: grant.id,
    asOf: asOfDate.toISOString(),
    vestedUnits: formatDecimal(vested),
    unvestedUnits: formatDecimal(total > vested ? total - vested : 0n),
    exercisedUnits: formatDecimal(exercised),
    availableUnits: formatDecimal(available),
    nextVestAt,
    fullyVested: vested === total,
  };
}

function money(value: string): bigint {
  try {
    return parseDecimal(value);
  } catch {
    throw new ConflictError(`invalid amount ${value}`);
  }
}

export class PgPlatformStore implements PlatformStore {
  constructor(private readonly pool: Pool) {}

  async createTenant(input: {
    name: string;
    slug: string;
    defaultTimezone?: string;
    defaultCurrency?: string;
  }): Promise<PlatformTenant> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO tenants
          (id, name, slug, default_timezone, default_currency)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          randomUUID(),
          input.name,
          input.slug,
          input.defaultTimezone ?? "UTC",
          input.defaultCurrency ?? "CNY",
        ],
      );
      return this.mapTenant(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(`tenant slug ${input.slug} already exists`);
      }
      throw error;
    }
  }

  async listTenants(): Promise<PlatformTenant[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM tenants ORDER BY created_at DESC",
    );
    return rows.map((row) => this.mapTenant(row));
  }

  async getTenant(tenantId: string): Promise<PlatformTenant> {
    const { rows } = await this.pool.query(
      "SELECT * FROM tenants WHERE id=$1",
      [tenantId],
    );
    if (!rows[0]) notFound("Tenant", tenantId);
    return this.mapTenant(rows[0]);
  }

  async updateTenantSettings(input: {
    tenantId: string;
    settings: Record<string, unknown>;
  }): Promise<PlatformTenant> {
    const { rows } = await this.pool.query(
      `UPDATE tenants
          SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
              updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [input.tenantId, input.settings],
    );
    if (!rows[0]) notFound("Tenant", input.tenantId);
    return this.mapTenant(rows[0]);
  }

  async createUser(input: {
    authSubject: string;
    displayName: string;
    email?: string;
  }): Promise<PlatformUser> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (id, email, display_name, auth_subject)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [randomUUID(), input.email ?? null, input.displayName, input.authSubject],
      );
      return this.mapUser(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          `auth subject ${input.authSubject} already exists`,
        );
      }
      throw error;
    }
  }

  async findUserByAuthSubject(authSubject: string): Promise<PlatformUser | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM users WHERE auth_subject=$1",
      [authSubject],
    );
    return rows[0] ? this.mapUser(rows[0]) : null;
  }

  async listMembershipsByUser(userId: string): Promise<PlatformMembership[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM memberships WHERE user_id=$1 AND status='ACTIVE' ORDER BY joined_at",
      [userId],
    );
    return rows.map((row) => this.mapMembership(row));
  }

  async setUserPassword(userId: string, passwordHash: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      "UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1",
      [userId, passwordHash],
    );
    if (!rowCount) notFound("User", userId);
  }

  async getUserPasswordHash(userId: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      "SELECT password_hash FROM users WHERE id=$1",
      [userId],
    );
    return rows[0]?.password_hash ?? null;
  }

  async getUserPasswordHashByEmail(
    email: string,
  ): Promise<{ userId: string; passwordHash: string | null } | null> {
    const { rows } = await this.pool.query(
      `SELECT id, password_hash FROM users
        WHERE lower(email) = lower($1) OR lower(auth_subject) = lower($1)
        ORDER BY created_at LIMIT 1`,
      [email.trim()],
    );
    if (!rows[0]) return null;
    return { userId: rows[0].id, passwordHash: rows[0].password_hash ?? null };
  }

  async listUsers(): Promise<PlatformUser[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM users ORDER BY created_at DESC",
    );
    return rows.map((row) => this.mapUser(row));
  }

  async addMembership(input: {
    tenantId: string;
    userId: string;
    roleCodes: string[];
  }): Promise<PlatformMembership> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO memberships
          (id, tenant_id, user_id, status, role_codes, joined_at)
         VALUES ($1,$2,$3,'ACTIVE',$4,now())
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET status='ACTIVE', role_codes=EXCLUDED.role_codes,
                       joined_at=COALESCE(memberships.joined_at, now()),
                       updated_at=now()
         RETURNING *`,
        [randomUUID(), input.tenantId, input.userId, input.roleCodes],
      );
      return this.mapMembership(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or user not found");
      }
      throw error;
    }
  }

  async listMemberships(tenantId: string): Promise<PlatformMembership[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT m.*, u.display_name AS user_display_name,
              u.email AS user_email
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1
        ORDER BY m.created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapMembership(row));
  }

  async createPerson(input: {
    tenantId: string;
    employeeCode: string;
    displayName: string;
    employmentStatus?: string;
    userId?: string;
  }): Promise<PlatformPerson> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO people
          (id, tenant_id, user_id, employee_code, display_name,
           employment_status)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.userId ?? null,
          input.employeeCode,
          input.displayName,
          input.employmentStatus ?? "ACTIVE",
        ],
      );
      return this.mapPerson(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const constraint = (error as { constraint?: string }).constraint;
      if (code === "23505") {
        if (constraint === "uq_people_tenant_user") {
          throw new ConflictError(
            `user ${input.userId} is already linked to a person in this tenant`,
          );
        }
        throw new ConflictError(
          `employee code ${input.employeeCode} already exists in tenant`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError("tenant or user not found");
      }
      throw error;
    }
  }

  async listPersons(tenantId: string): Promise<PlatformPerson[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      "SELECT * FROM people WHERE tenant_id=$1 ORDER BY created_at DESC",
      [tenantId],
    );
    return rows.map((row) => this.mapPerson(row));
  }

  async createSubscriptionPlan(input: {
    code: string;
    name: string;
    description?: string;
    monthlyPrice: string;
    currency: string;
    seatLimit: number;
    trialDays: number;
    features: string[];
    active?: boolean;
  }): Promise<SubscriptionPlan> {
    const { rows } = await this.pool.query(
      `INSERT INTO subscription_plans
         (code, name, description, monthly_price, currency, seat_limit,
          trial_days, features, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         monthly_price = EXCLUDED.monthly_price,
         currency = EXCLUDED.currency,
         seat_limit = EXCLUDED.seat_limit,
         trial_days = EXCLUDED.trial_days,
         features = EXCLUDED.features,
         active = EXCLUDED.active
       RETURNING *`,
      [
        input.code,
        input.name,
        input.description ?? null,
        input.monthlyPrice,
        input.currency,
        input.seatLimit,
        input.trialDays,
        JSON.stringify(input.features),
        input.active ?? true,
      ],
    );
    return this.mapSubscriptionPlan(rows[0]);
  }

  async listSubscriptionPlans(
    activeOnly = false,
  ): Promise<SubscriptionPlan[]> {
    const { rows } = await this.pool.query(
      activeOnly
        ? "SELECT * FROM subscription_plans WHERE active ORDER BY created_at"
        : "SELECT * FROM subscription_plans ORDER BY created_at",
    );
    return rows.map((row) => this.mapSubscriptionPlan(row));
  }

  async setTenantSubscription(input: {
    tenantId: string;
    planCode: string;
    status: TenantSubscriptionStatus;
    seats: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    trialEndsAt?: string;
    cancelReason?: string;
  }): Promise<TenantSubscription> {
    await this.assertTenant(input.tenantId);
    const plan = await this.pool.query(
      "SELECT * FROM subscription_plans WHERE code=$1",
      [input.planCode],
    );
    if (plan.rows.length === 0) notFound("SubscriptionPlan", input.planCode);
    const { rows } = await this.pool.query(
      `INSERT INTO tenant_subscriptions
         (tenant_id, plan_id, status, seats, current_period_start,
          current_period_end, trial_ends_at, canceled_at, cancel_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,
               CASE WHEN $3 = 'CANCELED' THEN now() END,
               $8)
       ON CONFLICT (tenant_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         status = EXCLUDED.status,
         seats = EXCLUDED.seats,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         trial_ends_at = EXCLUDED.trial_ends_at,
         canceled_at =
           CASE WHEN EXCLUDED.status = 'CANCELED'
                THEN COALESCE(tenant_subscriptions.canceled_at, now())
                ELSE NULL END,
         cancel_reason = EXCLUDED.cancel_reason,
         updated_at = now()
       RETURNING *`,
      [
        input.tenantId,
        plan.rows[0].id,
        input.status,
        input.seats,
        input.currentPeriodStart,
        input.currentPeriodEnd,
        input.trialEndsAt ?? null,
        input.cancelReason ?? null,
      ],
    );
    return this.mapTenantSubscription(rows[0], plan.rows[0]);
  }

  async getTenantSubscription(
    tenantId: string,
  ): Promise<TenantSubscription | null> {
    const { rows } = await this.pool.query(
      `SELECT s.*, p.code AS plan_code, p.name AS plan_name
         FROM tenant_subscriptions s
         JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.tenant_id = $1`,
      [tenantId],
    );
    if (rows.length === 0) return null;
    return this.mapTenantSubscription(rows[0]);
  }

  async createInvoice(input: {
    tenantId: string;
    lineItems: TenantInvoiceLineItem[];
    periodStart?: string;
    periodEnd?: string;
    dueDate?: string;
  }): Promise<TenantInvoice> {
    const subscription = await this.getTenantSubscription(input.tenantId);
    if (!subscription) notFound("TenantSubscription", input.tenantId);
    const plan = await this.pool.query(
      "SELECT * FROM subscription_plans WHERE id=$1",
      [subscription.planId],
    );
    const total = input.lineItems.reduce(
      (sum, item) => sum + parseDecimal(item.amount),
      0n,
    );
    const { rows } = await this.pool.query(
      `INSERT INTO invoices
         (tenant_id, subscription_id, number, currency, line_items,
          total_amount, period_start, period_end, due_date)
       VALUES ($1,$2,
               'INV-' || to_char(now(),'YYYYMM') || '-' ||
               lpad((SELECT count(*)::text FROM invoices WHERE tenant_id=$1) + 1, 4, '0'),
               $3, $4::jsonb, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.tenantId,
        subscription.id,
        plan.rows[0]?.currency ?? "CNY",
        JSON.stringify(input.lineItems),
        formatInvoiceAmount(total),
        input.periodStart ?? null,
        input.periodEnd ?? null,
        input.dueDate ?? null,
      ],
    );
    return this.mapInvoice(rows[0]);
  }

  async listInvoices(tenantId: string): Promise<TenantInvoice[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC",
      [tenantId],
    );
    return rows.map((row) => this.mapInvoice(row));
  }

  async setInvoiceStatus(input: {
    invoiceId: string;
    status: TenantInvoiceStatus;
  }): Promise<TenantInvoice> {
    const { rows } = await this.pool.query(
      `UPDATE invoices SET
         status = $2,
         issued_at = CASE WHEN $2 = 'ISSUED'
                          THEN COALESCE(issued_at, now()) ELSE issued_at END,
         paid_at = CASE WHEN $2 = 'PAID'
                        THEN COALESCE(paid_at, now()) ELSE paid_at END
       WHERE id = $1
       RETURNING *`,
      [input.invoiceId, input.status],
    );
    if (rows.length === 0) notFound("Invoice", input.invoiceId);
    return this.mapInvoice(rows[0]);
  }

  async createStrategicPoolCase(input: {
    tenantId: string;
    cycleId: string;
    poolAmount: string;
    capAmount: string;
    currency: string;
    budgetPoolId?: string;
    rationale: string;
    requestedBy: string;
  }): Promise<StrategicPoolCase> {
    const { rows } = await this.pool.query(
      `INSERT INTO strategic_pool_cases
         (tenant_id, cycle_id, pool_amount, cap_amount, currency,
          budget_pool_id, rationale, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        input.tenantId,
        input.cycleId,
        input.poolAmount,
        input.capAmount,
        input.currency,
        input.budgetPoolId ?? null,
        input.rationale,
        input.requestedBy,
      ],
    );
    return this.mapStrategicPoolCase(rows[0]);
  }

  async listStrategicPoolCases(
    tenantId: string,
  ): Promise<StrategicPoolCase[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM strategic_pool_cases WHERE tenant_id=$1 ORDER BY created_at DESC",
      [tenantId],
    );
    return rows.map((row) => this.mapStrategicPoolCase(row));
  }

  async updateStrategicPoolCase(input: {
    tenantId: string;
    caseId: string;
    patch: Partial<Omit<StrategicPoolCase, "id" | "tenantId">>;
  }): Promise<StrategicPoolCase> {
    const record = await this.listStrategicPoolCases(input.tenantId);
    const current = record.find((candidate) => candidate.id === input.caseId);
    if (!current) notFound("StrategicPoolCase", input.caseId);
    const next = { ...current, ...input.patch };
    const { rows } = await this.pool.query(
      `UPDATE strategic_pool_cases SET
         units=$3, unit_standard_cost=$4, total_standard_cost=$5,
         transfer_pricing_ref=$6, cost_reviewed_by=$7, cost_reviewed_at=$8,
         finance_approved_by=$9, finance_approved_at=$10,
         deferred_installment_months=$11, status=$12,
         rejected_reason=$13, activated_at=$14, settled_at=$15,
         pool_amount=$16, cap_amount=$17, updated_at=now()
       WHERE tenant_id=$1 AND id=$2
       RETURNING *`,
      [
        input.tenantId,
        input.caseId,
        next.units ?? null,
        next.unitStandardCost ?? null,
        next.totalStandardCost ?? null,
        next.transferPricingRef ?? null,
        next.costReviewedBy ?? null,
        next.costReviewedAt ?? null,
        next.financeApprovedBy ?? null,
        next.financeApprovedAt ?? null,
        next.deferredInstallmentMonths,
        next.status,
        next.rejectedReason ?? null,
        next.activatedAt ?? null,
        next.settledAt ?? null,
        next.poolAmount,
        next.capAmount,
      ],
    );
    return this.mapStrategicPoolCase(rows[0]);
  }

  async linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson> {
    try {
      const { rows } = await this.pool.query(
        `UPDATE people SET user_id=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.personId, input.userId],
      );
      if (!rows[0]) notFound("Person", input.personId);
      return this.mapPerson(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const constraint = (error as { constraint?: string }).constraint;
      if (code === "23505" && constraint === "uq_people_tenant_user") {
        throw new ConflictError(
          `user ${input.userId} is already linked to a person in this tenant`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(`User ${input.userId} not found`);
      }
      throw error;
    }
  }

  async resolveIdentity(input: {
    tenantId: string;
    userId: string;
    personId?: string;
  }): Promise<PlatformIdentity> {
    const [{ rows: personRows }, { rows: membershipRows }, { rows: nameRows }] =
      await Promise.all([
        this.pool.query(
          `SELECT id FROM people
            WHERE tenant_id=$1
              AND ($3::uuid IS NOT NULL AND id = $3
                   OR user_id = $2)
            ORDER BY (id = $3) DESC NULLS LAST, created_at
            LIMIT 1`,
          [input.tenantId, input.userId, input.personId ?? null],
        ),
        this.pool.query(
          `SELECT role_codes FROM memberships
            WHERE tenant_id=$1 AND user_id=$2`,
          [input.tenantId, input.userId],
        ),
        this.pool.query(
          `SELECT COALESCE(p.display_name, u.display_name, u.email) AS display_name,
                  t.name AS tenant_name
             FROM users u
             JOIN tenants t ON t.id = $2
            LEFT JOIN people p ON p.tenant_id = $2 AND p.user_id = u.id
            WHERE u.id = $1`,
          [input.userId, input.tenantId],
        ),
      ]);
    return {
      userId: input.userId,
      personId: personRows[0]?.id ?? undefined,
      roles: membershipRows[0]?.role_codes ?? [],
      displayName: nameRows[0]?.display_name ?? undefined,
      tenantName: nameRows[0]?.tenant_name ?? undefined,
    };
  }

  async createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
    externalId?: string;
  }): Promise<PlatformOrgNode> {
    let parentPath: string | undefined;
    if (input.parentId) {
      const { rows } = await this.pool.query(
        "SELECT path FROM org_nodes WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.parentId],
      );
      if (!rows[0]) notFound("OrgNode", input.parentId);
      parentPath = rows[0].path ?? undefined;
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO org_nodes
          (id, tenant_id, parent_id, node_type, name, path, external_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.parentId ?? null,
          input.nodeType,
          input.name,
          parentPath ? `${parentPath}/${input.name}` : `/${input.name}`,
          input.externalId ?? null,
        ],
      );
      return this.mapOrgNode(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or parent org node not found");
      }
      throw error;
    }
  }

  async listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM org_nodes
        WHERE tenant_id=$1
        ORDER BY COALESCE(path, name), name`,
      [tenantId],
    );
    return rows.map((row) => this.mapOrgNode(row));
  }

  async assignPersonOrg(input: {
    tenantId: string;
    personId: string;
    orgNodeId: string;
    validFrom: string;
    validTo?: string;
    allocation?: string;
  }): Promise<PlatformOrgAssignment> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO person_org_assignments
          (id, tenant_id, person_id, org_node_id, valid_from, valid_to,
           allocation)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.orgNodeId,
          input.validFrom,
          input.validTo ?? null,
          input.allocation ?? null,
        ],
      );
      return this.mapOrgAssignment(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23503") {
        throw new NotFoundError("person or org node not found");
      }
      if (code === "23514") {
        throw new ConflictError(
          "assignment violates date or allocation constraints",
        );
      }
      throw error;
    }
  }

  async listOrgAssignments(
    tenantId: string,
    personId?: string,
  ): Promise<PlatformOrgAssignment[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql =
      "SELECT * FROM person_org_assignments WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY valid_from DESC, created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapOrgAssignment(row));
  }

  async setPersonManager(input: {
    tenantId: string;
    personId: string;
    managerPersonId: string | null;
  }): Promise<PlatformPerson> {
    const { rows: personRows } = await this.pool.query(
      "SELECT id FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.personId],
    );
    if (!personRows[0]) notFound("Person", input.personId);

    if (input.managerPersonId === null) {
      const { rows } = await this.pool.query(
        `UPDATE people SET manager_person_id=NULL, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.personId],
      );
      return this.mapPerson(rows[0]);
    }

    if (input.managerPersonId === input.personId) {
      throw new ConflictError("a person cannot be their own manager");
    }
    const { rows: managerRows } = await this.pool.query(
      "SELECT id FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.managerPersonId],
    );
    if (!managerRows[0]) notFound("Person", input.managerPersonId);

    const { rows: cycleRows } = await this.pool.query(
      `WITH RECURSIVE chain AS (
         SELECT id, manager_person_id
           FROM people
          WHERE tenant_id=$1 AND id=$2
         UNION ALL
         SELECT p.id, p.manager_person_id
           FROM people p
           JOIN chain c
             ON p.id = c.manager_person_id AND p.tenant_id=$1
       )
       SELECT 1 FROM chain WHERE id=$3 LIMIT 1`,
      [input.tenantId, input.managerPersonId, input.personId],
    );
    if (cycleRows[0]) {
      throw new ConflictError("manager assignment would create a cycle");
    }
    const { rows } = await this.pool.query(
      `UPDATE people SET manager_person_id=$3, updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [input.tenantId, input.personId, input.managerPersonId],
    );
    return this.mapPerson(rows[0]);
  }

  async createNotice(input: {
    tenantId: string;
    noticeType: NoticeType;
    title: string;
    bodyRef: string;
    policyVersionId?: string;
    publishedAt?: string;
    effectiveFrom: string;
    acknowledgementRequired: boolean;
  }): Promise<EmployeeNotice> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO employee_notices
          (id, tenant_id, policy_version_id, notice_type, title, body_ref,
           published_at, effective_from, acknowledgement_required)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()),$8,$9)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.policyVersionId ?? null,
          input.noticeType,
          input.title,
          input.bodyRef,
          input.publishedAt ?? null,
          input.effectiveFrom,
          input.acknowledgementRequired,
        ],
      );
      return this.mapNotice(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or policy version not found");
      }
      throw error;
    }
  }

  async listNotices(tenantId: string): Promise<EmployeeNotice[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM employee_notices
        WHERE tenant_id=$1
        ORDER BY published_at DESC, created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapNotice(row));
  }

  async getNotice(
    tenantId: string,
    noticeId: string,
  ): Promise<EmployeeNotice> {
    const { rows } = await this.pool.query(
      "SELECT * FROM employee_notices WHERE tenant_id=$1 AND id=$2",
      [tenantId, noticeId],
    );
    if (!rows[0]) notFound("Notice", noticeId);
    return this.mapNotice(rows[0]);
  }

  async recordAcknowledgement(input: {
    tenantId: string;
    noticeId: string;
    personId: string;
    decision: "ACKNOWLEDGE" | "DECLINE";
    signatureRef?: string;
    declineReason?: string;
  }): Promise<PolicyAcknowledgement> {
    const notice = await this.getNotice(input.tenantId, input.noticeId);
    const { rows: personRows } = await this.pool.query(
      "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.personId],
    );
    if (!personRows[0]) notFound("Person", input.personId);
    const acknowledge = input.decision === "ACKNOWLEDGE";
    const { rows } = await this.pool.query(
      `INSERT INTO policy_acknowledgements
        (id, tenant_id, notice_id, person_id, acknowledged_at, signature_ref,
         declined_at, decline_reason)
       VALUES ($1,$2,$3,$4,
               CASE WHEN $5 THEN now() ELSE NULL END,
               $6,
               CASE WHEN $5 THEN NULL ELSE now() END,
               $7)
       ON CONFLICT (tenant_id, notice_id, person_id)
       DO UPDATE SET acknowledged_at = EXCLUDED.acknowledged_at,
                     signature_ref = EXCLUDED.signature_ref,
                     declined_at = EXCLUDED.declined_at,
                     decline_reason = EXCLUDED.decline_reason
       RETURNING *`,
      [
        randomUUID(),
        input.tenantId,
        notice.id,
        input.personId,
        acknowledge,
        acknowledge ? (input.signatureRef ?? null) : null,
        acknowledge ? null : (input.declineReason ?? null),
      ],
    );
    return this.mapAcknowledgement(rows[0]);
  }

  async listAcknowledgements(
    tenantId: string,
    noticeId: string,
  ): Promise<NoticeAcknowledgementOverview> {
    const notice = await this.getNotice(tenantId, noticeId);
    const [{ rows: acknowledgementRows }, { rows: personRows }] =
      await Promise.all([
        this.pool.query(
          `SELECT pa.*, p.employment_status AS person_employment_status
             FROM policy_acknowledgements pa
             JOIN people p
               ON p.tenant_id = pa.tenant_id AND p.id = pa.person_id
            WHERE pa.tenant_id=$1 AND pa.notice_id=$2
            ORDER BY pa.created_at DESC`,
          [tenantId, noticeId],
        ),
        this.pool.query(
          `SELECT count(*)::int AS count FROM people
            WHERE tenant_id=$1 AND employment_status='ACTIVE'`,
          [tenantId],
        ),
      ]);
    const acknowledgements = acknowledgementRows.map((row) =>
      this.mapAcknowledgement(row),
    );
    const activePersons = Number(personRows[0]?.count ?? 0);
    const activeAcknowledgements = acknowledgementRows.filter(
      (row) => row.person_employment_status === "ACTIVE",
    );
    const acknowledgedCount = activeAcknowledgements.filter(
      (row) => row.acknowledged_at,
    ).length;
    const declinedCount = activeAcknowledgements.filter(
      (row) => row.declined_at,
    ).length;
    return {
      summary: {
        noticeId: notice.id,
        acknowledgementRequired: notice.acknowledgementRequired,
        personCount: activePersons,
        acknowledgedCount,
        declinedCount,
        pendingCount: Math.max(
          activePersons - acknowledgedCount - declinedCount,
          0,
        ),
        complete:
          !notice.acknowledgementRequired ||
          (activePersons > 0 && acknowledgedCount >= activePersons),
      },
      acknowledgements,
    };
  }

  async createRepresentation(input: {
    tenantId: string;
    bodyName: string;
    bodyType: RepresentationBodyType;
    jurisdiction: string;
  }): Promise<EmployeeRepresentation> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO employee_representations
          (id, tenant_id, body_name, body_type, jurisdiction)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.bodyName,
          input.bodyType,
          input.jurisdiction,
        ],
      );
      return this.mapRepresentation(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listRepresentations(
    tenantId: string,
  ): Promise<EmployeeRepresentation[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM employee_representations
        WHERE tenant_id=$1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapRepresentation(row));
  }

  async createConsultation(input: {
    tenantId: string;
    policyVersionId: string;
    representationId?: string;
    consultationType: ConsultationType;
    startedAt: string;
    endedAt?: string;
    minutesRef?: string;
    feedbackSummary?: string;
    outcome: ConsultationOutcome;
  }): Promise<PolicyConsultation> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO policy_consultations
          (id, tenant_id, policy_version_id, representation_id,
           consultation_type, started_at, ended_at, minutes_ref,
           feedback_summary, outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.policyVersionId,
          input.representationId ?? null,
          input.consultationType,
          input.startedAt,
          input.endedAt ?? null,
          input.minutesRef ?? null,
          input.feedbackSummary ?? null,
          input.outcome,
        ],
      );
      return this.mapConsultation(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          "policy version or employee representation not found",
        );
      }
      throw error;
    }
  }

  async listConsultations(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyConsultation[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM policy_consultations WHERE tenant_id=$1";
    if (policyVersionId) {
      params.push(policyVersionId);
      sql += " AND policy_version_id=$2";
    }
    sql += " ORDER BY started_at DESC, created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapConsultation(row));
  }

  async getConsultation(
    tenantId: string,
    consultationId: string,
  ): Promise<PolicyConsultation> {
    const { rows } = await this.pool.query(
      "SELECT * FROM policy_consultations WHERE tenant_id=$1 AND id=$2",
      [tenantId, consultationId],
    );
    if (!rows[0]) notFound("PolicyConsultation", consultationId);
    return this.mapConsultation(rows[0]);
  }

  async concludeConsultation(input: {
    tenantId: string;
    consultationId: string;
    endedAt: string;
    outcome: ConsultationOutcome;
    minutesRef?: string;
    feedbackSummary?: string;
  }): Promise<PolicyConsultation> {
    const consultation = await this.getConsultation(
      input.tenantId,
      input.consultationId,
    );
    if (consultation.outcome !== "PENDING") {
      throw new ConflictError(
        `consultation ${consultation.id} is already concluded`,
      );
    }
    if (
      Date.parse(input.endedAt) < Date.parse(consultation.startedAt)
    ) {
      throw new ConflictError("endedAt must not be before startedAt");
    }
    const { rows } = await this.pool.query(
      `UPDATE policy_consultations
          SET ended_at=$3,
              outcome=$4,
              minutes_ref=COALESCE($5, minutes_ref),
              feedback_summary=COALESCE($6, feedback_summary)
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [
        input.tenantId,
        input.consultationId,
        input.endedAt,
        input.outcome,
        input.minutesRef ?? null,
        input.feedbackSummary ?? null,
      ],
    );
    return this.mapConsultation(rows[0]);
  }

  async createDpia(input: {
    tenantId: string;
    assessmentType: DpiaAssessmentType;
    scope: string;
    riskSummary?: Record<string, unknown>;
    mitigationSummary?: Record<string, unknown>;
  }): Promise<DpiaRecord> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO dpia_records
          (id, tenant_id, assessment_type, scope, risk_summary,
           mitigation_summary)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.assessmentType,
          input.scope,
          input.riskSummary ?? {},
          input.mitigationSummary ?? {},
        ],
      );
      return this.mapDpia(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listDpias(tenantId: string): Promise<DpiaRecord[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM dpia_records
        WHERE tenant_id=$1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapDpia(row));
  }

  async getDpia(tenantId: string, dpiaId: string): Promise<DpiaRecord> {
    const { rows } = await this.pool.query(
      "SELECT * FROM dpia_records WHERE tenant_id=$1 AND id=$2",
      [tenantId, dpiaId],
    );
    if (!rows[0]) notFound("DpiaRecord", dpiaId);
    return this.mapDpia(rows[0]);
  }

  async approveDpia(input: {
    tenantId: string;
    dpiaId: string;
    approvedBy: string;
  }): Promise<DpiaRecord> {
    const dpia = await this.getDpia(input.tenantId, input.dpiaId);
    if (dpia.status === "APPROVED") {
      throw new ConflictError(`DPIA ${dpia.id} is already approved`);
    }
    try {
      const { rows } = await this.pool.query(
        `UPDATE dpia_records
            SET status='APPROVED', approved_by=$3, approved_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.dpiaId, input.approvedBy],
      );
      return this.mapDpia(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Person ${input.approvedBy} not found`);
      }
      throw error;
    }
  }

  async createDsar(input: {
    tenantId: string;
    personId: string;
    requestType: DsarRequestType;
    dueAt?: string;
  }): Promise<DsarRequest> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO dsar_requests
          (id, tenant_id, person_id, request_type, due_at)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.requestType,
          input.dueAt ?? null,
        ],
      );
      return this.mapDsar(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or person not found");
      }
      throw error;
    }
  }

  async listDsars(
    tenantId: string,
    personId?: string,
  ): Promise<DsarRequest[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM dsar_requests WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY received_at DESC, created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapDsar(row));
  }

  async getDsar(tenantId: string, dsarId: string): Promise<DsarRequest> {
    const { rows } = await this.pool.query(
      "SELECT * FROM dsar_requests WHERE tenant_id=$1 AND id=$2",
      [tenantId, dsarId],
    );
    if (!rows[0]) notFound("DsarRequest", dsarId);
    return this.mapDsar(rows[0]);
  }

  async resolveDsar(input: {
    tenantId: string;
    dsarId: string;
    resolution: "RESOLVED" | "REJECTED";
    resolutionRef: string;
  }): Promise<DsarRequest> {
    const dsar = await this.getDsar(input.tenantId, input.dsarId);
    if (dsar.status !== "OPEN") {
      throw new ConflictError(`DSAR ${dsar.id} is already ${dsar.status}`);
    }
    const { rows } = await this.pool.query(
      `UPDATE dsar_requests
          SET status=$3, resolution_ref=$4, resolved_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [
        input.tenantId,
        input.dsarId,
        input.resolution,
        input.resolutionRef,
      ],
    );
    return this.mapDsar(rows[0]);
  }

  async createRetentionPolicy(input: {
    tenantId: string;
    dataCategory: string;
    retentionMonths: number;
    legalBasis: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO retention_policies
          (id, tenant_id, data_category, retention_months, legal_basis,
           legal_hold)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.dataCategory,
          input.retentionMonths,
          input.legalBasis,
          input.legalHold,
        ],
      );
      return this.mapRetentionPolicy(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          `retention policy for ${input.dataCategory} already exists`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listRetentionPolicies(tenantId: string): Promise<RetentionPolicy[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM retention_policies
        WHERE tenant_id=$1
        ORDER BY data_category`,
      [tenantId],
    );
    return rows.map((row) => this.mapRetentionPolicy(row));
  }

  async setRetentionLegalHold(input: {
    tenantId: string;
    retentionPolicyId: string;
    legalHold: boolean;
  }): Promise<RetentionPolicy> {
    const { rows } = await this.pool.query(
      `UPDATE retention_policies
          SET legal_hold=$3
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [input.tenantId, input.retentionPolicyId, input.legalHold],
    );
    if (!rows[0]) notFound("RetentionPolicy", input.retentionPolicyId);
    return this.mapRetentionPolicy(rows[0]);
  }

  async createRetentionDisposalRequest(input: {
    tenantId: string;
    retentionPolicyId: string;
    requestedBy: string;
    reason: string;
    scheduledFor?: string;
  }): Promise<RetentionDisposalRequest> {
    const policy = await this.pool.query(
      `SELECT * FROM retention_policies WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, input.retentionPolicyId],
    );
    if (!policy.rows[0]) {
      notFound("RetentionPolicy", input.retentionPolicyId);
    }
    if (policy.rows[0].legal_hold) {
      throw new ConflictError(
        "RETENTION_LEGAL_HOLD: disposal is blocked while legal hold is active",
      );
    }
    const scheduledFor =
      input.scheduledFor ??
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    if (Date.parse(scheduledFor) <= Date.now()) {
      throw new ConflictError(
        "RETENTION_GRACE_PERIOD_REQUIRED: scheduledFor must be in the future",
      );
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO retention_disposal_requests
          (id, tenant_id, retention_policy_id, data_category, requested_by,
           reason, scheduled_for)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          policy.rows[0].id,
          policy.rows[0].data_category,
          input.requestedBy,
          input.reason,
          scheduledFor,
        ],
      );
      return this.mapRetentionDisposalRequest(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Requester ${input.requestedBy} not found`,
        );
      }
      throw error;
    }
  }

  async listRetentionDisposalRequests(
    tenantId: string,
  ): Promise<RetentionDisposalRequest[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM retention_disposal_requests
        WHERE tenant_id=$1
        ORDER BY requested_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapRetentionDisposalRequest(row));
  }

  async approveRetentionDisposalRequest(input: {
    tenantId: string;
    requestId: string;
    approvedBy: string;
  }): Promise<RetentionDisposalRequest> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM retention_disposal_requests
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.requestId],
      );
      if (!rows[0]) {
        notFound("RetentionDisposalRequest", input.requestId);
      }
      const request = this.mapRetentionDisposalRequest(rows[0]);
      if (request.status !== "REQUESTED") {
        throw new ConflictError(
          `retention disposal is ${request.status}`,
        );
      }
      if (request.requestedBy === input.approvedBy) {
        throw new ConflictError("RETENTION_SECOND_PERSON_REQUIRED");
      }
      const { rows: updated } = await client.query(
        `UPDATE retention_disposal_requests
            SET status='APPROVED', approved_by=$3, approved_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.requestId, input.approvedBy],
      );
      return this.mapRetentionDisposalRequest(updated[0]);
    });
  }

  async completeRetentionDisposalRequest(input: {
    tenantId: string;
    requestId: string;
    actorPersonId: string;
  }): Promise<RetentionDisposalRequest> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM retention_disposal_requests
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.requestId],
      );
      if (!rows[0]) {
        notFound("RetentionDisposalRequest", input.requestId);
      }
      const request = this.mapRetentionDisposalRequest(rows[0]);
      if (request.status !== "APPROVED") {
        throw new ConflictError(
          `retention disposal is ${request.status}`,
        );
      }
      if (Date.now() < Date.parse(request.scheduledFor)) {
        throw new ConflictError("RETENTION_GRACE_PERIOD_ACTIVE");
      }
      const policy = await client.query(
        `SELECT legal_hold FROM retention_policies
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, request.retentionPolicyId],
      );
      if (policy.rows[0]?.legal_hold) {
        throw new ConflictError(
          "RETENTION_LEGAL_HOLD: disposal is blocked while legal hold is active",
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE retention_disposal_requests
            SET status='COMPLETED', completed_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.requestId],
      );
      return this.mapRetentionDisposalRequest(updated[0]);
    });
  }

  async cancelRetentionDisposalRequest(input: {
    tenantId: string;
    requestId: string;
    actorPersonId: string;
    reason: string;
  }): Promise<RetentionDisposalRequest> {
    const { rows } = await this.pool.query(
      `UPDATE retention_disposal_requests
          SET status='CANCELLED', cancelled_at=now(), cancel_reason=$3
        WHERE tenant_id=$1 AND id=$2
          AND status IN ('REQUESTED','APPROVED')
        RETURNING *`,
      [input.tenantId, input.requestId, input.reason],
    );
    if (!rows[0]) {
      const current = await this.pool.query(
        `SELECT status FROM retention_disposal_requests
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, input.requestId],
      );
      if (!current.rows[0]) {
        notFound("RetentionDisposalRequest", input.requestId);
      }
      throw new ConflictError(
        `retention disposal is ${current.rows[0].status}`,
      );
    }
    return this.mapRetentionDisposalRequest(rows[0]);
  }

  async createAppealEvidenceDisclosure(input: {
    tenantId: string;
    appealId: string;
    disclosedBy: string;
    method: AppealEvidenceDisclosure["method"];
    evidenceRefs: string[];
    note?: string;
  }): Promise<AppealEvidenceDisclosure> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO appeal_evidence_disclosures
          (id, tenant_id, appeal_id, disclosed_by, method, evidence_refs,
           note)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.appealId,
          input.disclosedBy,
          input.method,
          JSON.stringify(input.evidenceRefs),
          input.note ?? null,
        ],
      );
      return this.mapAppealEvidenceDisclosure(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Appeal ${input.appealId} or discloser ${input.disclosedBy} not found`,
        );
      }
      throw error;
    }
  }

  async listAppealEvidenceDisclosures(
    tenantId: string,
    appealId: string,
  ): Promise<AppealEvidenceDisclosure[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM appeal_evidence_disclosures
        WHERE tenant_id=$1 AND appeal_id=$2
        ORDER BY disclosed_at DESC`,
      [tenantId, appealId],
    );
    return rows.map((row) => this.mapAppealEvidenceDisclosure(row));
  }

  async recordWorkforceSubgroupAttribute(input: {
    tenantId: string;
    personId: string;
    dimension: WorkforceSubgroupDimension;
    value: string;
    consentRef: string;
    consentedAt: string;
    expiresAt?: string;
    recordedBy?: string;
  }): Promise<WorkforceSubgroupAttribute> {
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
      throw new ConflictError("SUBGROUP_CONSENT_EXPIRED");
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO workforce_subgroup_attributes
          (id, tenant_id, person_id, dimension, value, consent_ref,
           consented_at, expires_at, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, person_id, dimension)
         DO UPDATE SET
           value=EXCLUDED.value,
           consent_ref=EXCLUDED.consent_ref,
           consented_at=EXCLUDED.consented_at,
           expires_at=EXCLUDED.expires_at,
           recorded_by=EXCLUDED.recorded_by,
           updated_at=now()
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.dimension,
          input.value.trim(),
          input.consentRef,
          input.consentedAt,
          input.expiresAt ?? null,
          input.recordedBy ?? null,
        ],
      );
      return this.mapWorkforceSubgroupAttribute(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Person ${input.personId} not found`,
        );
      }
      throw error;
    }
  }

  async listWorkforceSubgroupAttributes(
    tenantId: string,
    filter?: {
      personId?: string;
      dimension?: WorkforceSubgroupDimension;
    },
  ): Promise<WorkforceSubgroupAttribute[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql =
      "SELECT * FROM workforce_subgroup_attributes WHERE tenant_id=$1";
    if (filter?.personId) {
      params.push(filter.personId);
      sql += ` AND person_id=$${params.length}`;
    }
    if (filter?.dimension) {
      params.push(filter.dimension);
      sql += ` AND dimension=$${params.length}`;
    }
    sql += " ORDER BY dimension, person_id";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapWorkforceSubgroupAttribute(row));
  }

  async withdrawWorkforceSubgroupAttribute(input: {
    tenantId: string;
    personId: string;
    dimension: WorkforceSubgroupDimension;
  }): Promise<WorkforceSubgroupAttribute> {
    const { rows } = await this.pool.query(
      `DELETE FROM workforce_subgroup_attributes
        WHERE tenant_id=$1 AND person_id=$2 AND dimension=$3
        RETURNING *`,
      [input.tenantId, input.personId, input.dimension],
    );
    if (!rows[0]) {
      notFound(
        "WorkforceSubgroupAttribute",
        `${input.personId}:${input.dimension}`,
      );
    }
    return this.mapWorkforceSubgroupAttribute(rows[0]);
  }

  async createDataSource(input: {
    tenantId: string;
    code: string;
    name: string;
    category: string;
    ownerPersonId: string;
    backupOwnerPersonId?: string;
    slaHours: number;
    criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    containsPersonalData: boolean;
    storageRegion: string;
    crossBorderTransfers: boolean;
    processorRefs: string[];
    fields: DataSourceField[];
    lastReviewedAt?: string;
  }): Promise<DataSource> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO data_sources
          (id, tenant_id, code, name, category, owner_person_id,
           backup_owner_person_id, sla_hours, criticality,
           contains_personal_data, storage_region, cross_border_transfers,
           processor_refs, fields, last_reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.code,
          input.name,
          input.category,
          input.ownerPersonId,
          input.backupOwnerPersonId ?? null,
          input.slaHours,
          input.criticality,
          input.containsPersonalData,
          input.storageRegion,
          input.crossBorderTransfers,
          JSON.stringify(input.processorRefs),
          JSON.stringify(input.fields),
          input.lastReviewedAt ?? null,
        ],
      );
      return this.mapDataSource(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(`data source code ${input.code} already exists`);
      }
      if (code === "23503") {
        throw new NotFoundError(
          `Tenant, owner or backup owner for ${input.code} not found`,
        );
      }
      throw error;
    }
  }

  async listDataSources(tenantId: string): Promise<DataSource[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM data_sources
        WHERE tenant_id=$1
        ORDER BY code`,
      [tenantId],
    );
    return rows.map((row) => this.mapDataSource(row));
  }

  async getDataSource(
    tenantId: string,
    dataSourceId: string,
  ): Promise<DataSource> {
    const { rows } = await this.pool.query(
      "SELECT * FROM data_sources WHERE tenant_id=$1 AND id=$2",
      [tenantId, dataSourceId],
    );
    if (!rows[0]) notFound("DataSource", dataSourceId);
    return this.mapDataSource(rows[0]);
  }

  async retireDataSource(input: {
    tenantId: string;
    dataSourceId: string;
  }): Promise<DataSource> {
    const { rows } = await this.pool.query(
      `UPDATE data_sources
          SET status='RETIRED', updated_at=now(), version=version+1
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [input.tenantId, input.dataSourceId],
    );
    if (!rows[0]) notFound("DataSource", input.dataSourceId);
    return this.mapDataSource(rows[0]);
  }

  async createConflictDeclaration(input: {
    tenantId: string;
    personId: string;
    relatedPersonId: string;
    relationshipType: string;
    description: string;
  }): Promise<ConflictDeclaration> {
    if (input.personId === input.relatedPersonId) {
      throw new ConflictError(
        "CONFLICT_SELF_DECLARATION: related person must differ",
      );
    }
    const existing = await this.findConflictDeclaration(
      input.tenantId,
      input.personId,
      input.relatedPersonId,
    );
    if (existing) {
      throw new ConflictError(
        "CONFLICT_DECLARATION_EXISTS: an active declaration already covers this pair",
      );
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO conflict_declarations
          (id, tenant_id, person_id, related_person_id, relationship_type,
           description)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.relatedPersonId,
          input.relationshipType,
          input.description,
        ],
      );
      return this.mapConflictDeclaration(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Tenant, person ${input.personId} or related person ${input.relatedPersonId} not found`,
        );
      }
      throw error;
    }
  }

  async listConflictDeclarations(
    tenantId: string,
    personId?: string,
  ): Promise<ConflictDeclaration[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM conflict_declarations WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND (person_id=$2 OR related_person_id=$2)";
    }
    sql += " ORDER BY declared_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapConflictDeclaration(row));
  }

  async revokeConflictDeclaration(input: {
    tenantId: string;
    declarationId: string;
    reason: string;
  }): Promise<ConflictDeclaration> {
    const { rows } = await this.pool.query(
      `UPDATE conflict_declarations
          SET status='REVOKED', revoked_at=now(), revocation_reason=$3,
              updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [input.tenantId, input.declarationId, input.reason],
    );
    if (!rows[0]) notFound("ConflictDeclaration", input.declarationId);
    return this.mapConflictDeclaration(rows[0]);
  }

  async findConflictDeclaration(
    tenantId: string,
    personA: string,
    personB: string,
  ): Promise<ConflictDeclaration | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM conflict_declarations
        WHERE tenant_id=$1 AND status='ACTIVE'
          AND ((person_id=$2 AND related_person_id=$3)
            OR (person_id=$3 AND related_person_id=$2))
        LIMIT 1`,
      [tenantId, personA, personB],
    );
    return rows[0] ? this.mapConflictDeclaration(rows[0]) : undefined;
  }

  async createTrustSurvey(input: {
    tenantId: string;
    code: string;
    period: string;
    title: string;
    questions: TrustSurveyQuestion[];
  }): Promise<TrustSurveyRun> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO trust_survey_runs
          (id, tenant_id, code, period, title, questions)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.code,
          input.period,
          input.title,
          JSON.stringify(input.questions),
        ],
      );
      return this.mapTrustSurvey(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          `trust survey ${input.code}/${input.period} already exists`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listTrustSurveys(tenantId: string): Promise<TrustSurveyRun[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM trust_survey_runs
        WHERE tenant_id=$1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapTrustSurvey(row));
  }

  async getTrustSurvey(
    tenantId: string,
    surveyId: string,
  ): Promise<TrustSurveyRun> {
    const { rows } = await this.pool.query(
      "SELECT * FROM trust_survey_runs WHERE tenant_id=$1 AND id=$2",
      [tenantId, surveyId],
    );
    if (!rows[0]) notFound("TrustSurvey", surveyId);
    return this.mapTrustSurvey(rows[0]);
  }

  async openTrustSurvey(input: {
    tenantId: string;
    surveyId: string;
  }): Promise<TrustSurveyRun> {
    const { rows } = await this.pool.query(
      `UPDATE trust_survey_runs
          SET status='OPEN', opened_at=now(), updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='DRAFT'
        RETURNING *`,
      [input.tenantId, input.surveyId],
    );
    if (!rows[0]) {
      const survey = await this.getTrustSurvey(
        input.tenantId,
        input.surveyId,
      );
      throw new ConflictError(`trust survey is ${survey.status}`);
    }
    return this.mapTrustSurvey(rows[0]);
  }

  async closeTrustSurvey(input: {
    tenantId: string;
    surveyId: string;
  }): Promise<TrustSurveyRun> {
    const { rows } = await this.pool.query(
      `UPDATE trust_survey_runs
          SET status='CLOSED', closed_at=now(), updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='OPEN'
        RETURNING *`,
      [input.tenantId, input.surveyId],
    );
    if (!rows[0]) {
      const survey = await this.getTrustSurvey(
        input.tenantId,
        input.surveyId,
      );
      throw new ConflictError(`trust survey is ${survey.status}`);
    }
    return this.mapTrustSurvey(rows[0]);
  }

  async submitTrustSurveyResponse(input: {
    tenantId: string;
    surveyId: string;
    personId: string;
    scores: Record<string, number>;
  }): Promise<TrustSurveyResponse> {
    const survey = await this.getTrustSurvey(
      input.tenantId,
      input.surveyId,
    );
    if (survey.status !== "OPEN") {
      throw new ConflictError(`trust survey is ${survey.status}`);
    }
    const person = await this.pool.query(
      "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.personId],
    );
    if (!person.rows[0]) notFound("Person", input.personId);
    for (const question of survey.questions) {
      const value = input.scores[question.code];
      if (typeof value !== "number" || value < 1 || value > 5) {
        throw new ConflictError(
          `TRUST_SURVEY_SCORE_REQUIRED:${question.code}`,
        );
      }
    }
    const respondentHash = sha256(
      `${input.tenantId}:${input.surveyId}:${input.personId}`,
    );
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO trust_survey_responses
          (id, tenant_id, survey_id, respondent_hash, scores)
         VALUES ($1,$2,$3,$4,$5::jsonb)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.surveyId,
          respondentHash,
          JSON.stringify(input.scores),
        ],
      );
      return this.mapTrustSurveyResponse(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          "TRUST_SURVEY_ALREADY_SUBMITTED: this person already responded",
        );
      }
      throw error;
    }
  }

  async getTrustSurveyReport(
    tenantId: string,
    surveyId: string,
  ): Promise<TrustSurveyReport> {
    const survey = await this.getTrustSurvey(tenantId, surveyId);
    const { rows } = await this.pool.query(
      `SELECT * FROM trust_survey_responses
        WHERE tenant_id=$1 AND survey_id=$2
        ORDER BY submitted_at`,
      [tenantId, surveyId],
    );
    const responses = rows.map((row) => this.mapTrustSurveyResponse(row));
    const baselineQuery = await this.pool.query(
      `SELECT * FROM trust_survey_runs
        WHERE tenant_id=$1 AND code=$2 AND id<>$3 AND status='CLOSED'
        ORDER BY COALESCE(closed_at, updated_at) DESC
        LIMIT 1`,
      [tenantId, survey.code, surveyId],
    );
    if (!baselineQuery.rows[0]) {
      return aggregateSurveyReport(survey, responses);
    }
    const baselineSurvey = this.mapTrustSurvey(baselineQuery.rows[0]);
    const baselineResponses = await this.pool.query(
      `SELECT * FROM trust_survey_responses
        WHERE tenant_id=$1 AND survey_id=$2
        ORDER BY submitted_at`,
      [tenantId, baselineSurvey.id],
    );
    return aggregateSurveyReport(survey, responses, {
      survey: baselineSurvey,
      responses: baselineResponses.rows.map((row) =>
        this.mapTrustSurveyResponse(row),
      ),
    });
  }

  async createFairnessCommitment(input: {
    tenantId: string;
    statement: string;
    ownerPersonId: string;
    channels: string[];
  }): Promise<FairnessCommitment> {
    return this.transaction(async (client) => {
      await client.query(
        `UPDATE fairness_commitments
            SET status='SUPERSEDED'
          WHERE tenant_id=$1 AND status='ACTIVE'`,
        [input.tenantId],
      );
      const versionResult = await client.query(
        `SELECT COALESCE(MAX(version),0)+1 AS version
           FROM fairness_commitments
          WHERE tenant_id=$1`,
        [input.tenantId],
      );
      const version = Number(versionResult.rows[0]?.version ?? 1);
      try {
        const { rows } = await client.query(
          `INSERT INTO fairness_commitments
            (id, tenant_id, version, statement, owner_person_id, channels)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            version,
            input.statement,
            input.ownerPersonId,
            JSON.stringify(input.channels),
          ],
        );
        return this.mapFairnessCommitment(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Tenant ${input.tenantId} or owner ${input.ownerPersonId} not found`,
          );
        }
        throw error;
      }
    });
  }

  async listFairnessCommitments(
    tenantId: string,
  ): Promise<FairnessCommitment[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM fairness_commitments
        WHERE tenant_id=$1
        ORDER BY version DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapFairnessCommitment(row));
  }

  async getActiveFairnessCommitment(
    tenantId: string,
  ): Promise<FairnessCommitment | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fairness_commitments
        WHERE tenant_id=$1 AND status='ACTIVE'
        ORDER BY version DESC
        LIMIT 1`,
      [tenantId],
    );
    return rows[0] ? this.mapFairnessCommitment(rows[0]) : undefined;
  }

  async createManagerTrainingRecord(input: {
    tenantId: string;
    personId: string;
    trainingCode: string;
    title: string;
    completedAt: string;
    expiresAt?: string;
    evidenceRef?: string;
  }): Promise<ManagerTrainingRecord> {
    if (
      input.expiresAt &&
      Date.parse(input.expiresAt) <= Date.parse(input.completedAt)
    ) {
      throw new ConflictError("TRAINING_EXPIRY_BEFORE_COMPLETION");
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO manager_training_records
          (id, tenant_id, person_id, training_code, title, completed_at,
           expires_at, evidence_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.trainingCode,
          input.title,
          input.completedAt,
          input.expiresAt ?? null,
          input.evidenceRef ?? null,
        ],
      );
      return this.mapManagerTrainingRecord(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Tenant ${input.tenantId} or person ${input.personId} not found`,
        );
      }
      throw error;
    }
  }

  async listManagerTrainingRecords(
    tenantId: string,
    personId?: string,
  ): Promise<ManagerTrainingRecord[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM manager_training_records WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY completed_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapManagerTrainingRecord(row));
  }

  async createCalibrationSession(input: {
    tenantId: string;
    code: string;
    title: string;
    heldAt: string;
    facilitatorPersonId: string;
    attendeePersonIds: string[];
    policyVersionId?: string;
    notes?: string;
  }): Promise<CalibrationSession> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO calibration_sessions
          (id, tenant_id, code, title, held_at, facilitator_person_id,
           attendee_person_ids, policy_version_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.code,
          input.title,
          input.heldAt,
          input.facilitatorPersonId,
          JSON.stringify(input.attendeePersonIds),
          input.policyVersionId ?? null,
          input.notes ?? null,
        ],
      );
      return this.mapCalibrationSession(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Tenant ${input.tenantId} or facilitator ${input.facilitatorPersonId} not found`,
        );
      }
      throw error;
    }
  }

  async listCalibrationSessions(
    tenantId: string,
  ): Promise<CalibrationSession[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM calibration_sessions
        WHERE tenant_id=$1
        ORDER BY held_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapCalibrationSession(row));
  }

  async createPilotEnrollment(input: {
    tenantId: string;
    personId: string;
    pilotCode: string;
    scope: string;
    consentSignatureRef: string;
    consentSignedAt?: string;
  }): Promise<PilotEnrollment> {
    if (!input.consentSignatureRef.trim()) {
      throw new ConflictError("PILOT_CONSENT_SIGNATURE_REQUIRED");
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO pilot_enrollments
          (id, tenant_id, person_id, pilot_code, scope,
           consent_signature_ref, consent_signed_at)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.pilotCode,
          input.scope,
          input.consentSignatureRef,
          input.consentSignedAt ?? null,
        ],
      );
      return this.mapPilotEnrollment(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          "PILOT_ENROLLMENT_EXISTS: this person is already enrolled",
        );
      }
      if (code === "23503") {
        throw new NotFoundError(
          `Tenant ${input.tenantId} or person ${input.personId} not found`,
        );
      }
      throw error;
    }
  }

  async listPilotEnrollments(
    tenantId: string,
    personId?: string,
  ): Promise<PilotEnrollment[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM pilot_enrollments WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapPilotEnrollment(row));
  }

  async withdrawPilotEnrollment(input: {
    tenantId: string;
    enrollmentId: string;
    reason?: string;
  }): Promise<PilotEnrollment> {
    const { rows } = await this.pool.query(
      `UPDATE pilot_enrollments
          SET status='WITHDRAWN', withdrawn_at=now(),
              withdrawal_reason=$3, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
        RETURNING *`,
      [input.tenantId, input.enrollmentId, input.reason ?? null],
    );
    if (!rows[0]) {
      const current = await this.pool.query(
        "SELECT status FROM pilot_enrollments WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.enrollmentId],
      );
      if (!current.rows[0]) {
        notFound("PilotEnrollment", input.enrollmentId);
      }
      throw new ConflictError(
        `pilot enrollment ${input.enrollmentId} is ${current.rows[0].status}`,
      );
    }
    return this.mapPilotEnrollment(rows[0]);
  }

  async createBreakGlassGrant(input: {
    tenantId: string;
    scope: BreakGlassGrant["scope"];
    granteePersonId: string;
    reason: string;
    grantedBy: string;
    expiresAt: string;
  }): Promise<BreakGlassGrant> {
    if (input.granteePersonId === input.grantedBy) {
      throw new ConflictError(
        "BREAK_GLASS_SELF_GRANT: a grant must be approved by another person",
      );
    }
    const expiresAt = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new ConflictError("BREAK_GLASS_EXPIRY_REQUIRED");
    }
    if (expiresAt > Date.now() + 24 * 60 * 60 * 1000) {
      throw new ConflictError("BREAK_GLASS_MAX_24_HOURS");
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO break_glass_grants
          (id, tenant_id, scope, grantee_person_id, reason, granted_by,
           expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.scope,
          input.granteePersonId,
          input.reason,
          input.grantedBy,
          input.expiresAt,
        ],
      );
      return this.mapBreakGlassGrant(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Tenant, grantee or granting person not found`,
        );
      }
      throw error;
    }
  }

  async listBreakGlassGrants(tenantId: string): Promise<BreakGlassGrant[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM break_glass_grants
        WHERE tenant_id=$1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapBreakGlassGrant(row));
  }

  async revokeBreakGlassGrant(input: {
    tenantId: string;
    grantId: string;
  }): Promise<BreakGlassGrant> {
    const { rows } = await this.pool.query(
      `UPDATE break_glass_grants
          SET status='REVOKED', revoked_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
        RETURNING *`,
      [input.tenantId, input.grantId],
    );
    if (!rows[0]) {
      const current = await this.pool.query(
        "SELECT 1 FROM break_glass_grants WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.grantId],
      );
      if (!current.rows[0]) {
        notFound("BreakGlassGrant", input.grantId);
      }
      throw new ConflictError(
        `break-glass grant ${input.grantId} is already revoked`,
      );
    }
    return this.mapBreakGlassGrant(rows[0]);
  }

  async findActiveBreakGlassGrant(
    tenantId: string,
    granteePersonId: string,
    scope: BreakGlassGrant["scope"],
  ): Promise<BreakGlassGrant | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM break_glass_grants
        WHERE tenant_id=$1 AND grantee_person_id=$2 AND scope=$3
          AND status='ACTIVE' AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, granteePersonId, scope],
    );
    return rows[0] ? this.mapBreakGlassGrant(rows[0]) : undefined;
  }

  async createClawbackCase(input: {
    tenantId: string;
    personId: string;
    amount: string;
    currency: string;
    reasonCode: string;
    explanation: string;
    consentSignatureRef: string;
    installmentMonths: number;
    hardshipWaiver: boolean;
    hardshipReason?: string;
    requestedBy: string;
  }): Promise<ClawbackCase> {
    if (parseDecimal(input.amount) <= 0n) {
      throw new ConflictError("CLAWBACK_AMOUNT_MUST_BE_POSITIVE");
    }
    if (!input.consentSignatureRef.trim()) {
      throw new ConflictError("CLAWBACK_CONSENT_REQUIRED");
    }
    if (input.installmentMonths < 1 || input.installmentMonths > 12) {
      throw new ConflictError("CLAWBACK_INSTALLMENTS_OUT_OF_RANGE");
    }
    if (input.hardshipWaiver && !input.hardshipReason?.trim()) {
      throw new ConflictError("CLAWBACK_HARDSHIP_REASON_REQUIRED");
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO clawback_cases
          (id, tenant_id, person_id, amount, currency, reason_code,
           explanation, consent_signature_ref, installment_months,
           hardship_waiver, hardship_reason, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          formatDecimal(parseDecimal(input.amount)),
          input.currency,
          input.reasonCode,
          input.explanation,
          input.consentSignatureRef,
          input.installmentMonths,
          input.hardshipWaiver,
          input.hardshipReason ?? null,
          input.requestedBy,
        ],
      );
      return this.mapClawbackCase(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Tenant, person or requester not found`,
        );
      }
      throw error;
    }
  }

  async listClawbackCases(
    tenantId: string,
    personId?: string,
  ): Promise<ClawbackCase[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM clawback_cases WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapClawbackCase(row));
  }

  async approveClawbackCase(input: {
    tenantId: string;
    caseId: string;
    approvedBy: string;
  }): Promise<ClawbackCase> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM clawback_cases
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.caseId],
      );
      if (!rows[0]) notFound("ClawbackCase", input.caseId);
      const clawback = this.mapClawbackCase(rows[0]);
      if (clawback.status !== "DRAFT") {
        throw new ConflictError(`clawback case is ${clawback.status}`);
      }
      if (input.approvedBy === clawback.requestedBy) {
        throw new ConflictError(
          "CLAWBACK_SELF_APPROVAL: requester cannot approve the case",
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE clawback_cases
            SET status='APPROVED', approved_by=$3, approved_at=now(),
                updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.caseId, input.approvedBy],
      );
      return this.mapClawbackCase(updated[0]);
    });
  }

  async closeClawbackCase(input: {
    tenantId: string;
    caseId: string;
    action: "WAIVE" | "CANCEL";
    reason: string;
    actorPersonId: string;
  }): Promise<ClawbackCase> {
    const status = input.action === "WAIVE" ? "WAIVED" : "CANCELLED";
    const { rows } = await this.pool.query(
      `UPDATE clawback_cases
          SET status=$3,
              waived_at=CASE WHEN $4 THEN now() ELSE waived_at END,
              waiver_reason=CASE WHEN $4 THEN $5 ELSE waiver_reason END,
              cancelled_at=CASE WHEN $4 THEN cancelled_at ELSE now() END,
              cancel_reason=CASE WHEN $4 THEN cancel_reason ELSE $5 END,
              updated_at=now()
        WHERE tenant_id=$1 AND id=$2
          AND status IN ('DRAFT','APPROVED')
        RETURNING *`,
      [
        input.tenantId,
        input.caseId,
        status,
        input.action === "WAIVE",
        input.reason,
      ],
    );
    if (!rows[0]) {
      const current = await this.pool.query(
        "SELECT status FROM clawback_cases WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.caseId],
      );
      if (!current.rows[0]) notFound("ClawbackCase", input.caseId);
      throw new ConflictError(
        `clawback case is ${current.rows[0].status}`,
      );
    }
    return this.mapClawbackCase(rows[0]);
  }

  async createDiscretionaryPoolReview(input: {
    tenantId: string;
    poolId: string;
    committeePersonIds: string[];
    employeeObserverPersonId?: string;
    selectionCriteria: string;
    decisionNotes: string;
    reviewedBy: string;
  }): Promise<DiscretionaryPoolReview> {
    const pool = await this.getBudgetPool(input.tenantId, input.poolId);
    if (input.committeePersonIds.length < 2) {
      throw new ConflictError("DISCRETIONARY_COMMITTEE_MIN_TWO");
    }
    if (
      input.employeeObserverPersonId &&
      input.committeePersonIds.includes(input.employeeObserverPersonId)
    ) {
      throw new ConflictError(
        "DISCRETIONARY_OBSERVER_MUST_BE_INDEPENDENT",
      );
    }
    const personIds = [
      ...new Set([
        ...input.committeePersonIds,
        ...(input.employeeObserverPersonId
          ? [input.employeeObserverPersonId]
          : []),
        input.reviewedBy,
      ]),
    ];
    const persons = await this.pool.query(
      `SELECT id FROM people WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
      [input.tenantId, personIds],
    );
    if (persons.rows.length !== personIds.length) {
      throw new NotFoundError(
        `One or more committee, observer or reviewer people not found`,
      );
    }
    const { rows } = await this.pool.query(
      `INSERT INTO discretionary_pool_reviews
        (id, tenant_id, pool_id, committee_person_ids,
         employee_observer_person_id, selection_criteria, decision_notes,
         reviewed_by)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
       RETURNING *`,
      [
        randomUUID(),
        input.tenantId,
        pool.id,
        JSON.stringify(input.committeePersonIds),
        input.employeeObserverPersonId ?? null,
        input.selectionCriteria,
        input.decisionNotes,
        input.reviewedBy,
      ],
    );
    return this.mapDiscretionaryPoolReview(rows[0]);
  }

  async listDiscretionaryPoolReviews(
    tenantId: string,
    poolId?: string,
  ): Promise<DiscretionaryPoolReview[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql =
      "SELECT * FROM discretionary_pool_reviews WHERE tenant_id=$1";
    if (poolId) {
      params.push(poolId);
      sql += " AND pool_id=$2";
    }
    sql += " ORDER BY reviewed_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapDiscretionaryPoolReview(row));
  }

  async createModelProviderPolicy(input: {
    tenantId: string;
    provider: string;
    zeroRetentionConfirmed: boolean;
    dpaRef: string;
    inferenceRegion: string;
    egressAllowlist: string[];
    approvedBy: string;
  }): Promise<ModelProviderPolicy> {
    if (!input.egressAllowlist.length) {
      throw new ConflictError("MODEL_PROVIDER_EGRESS_ALLOWLIST_REQUIRED");
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO model_provider_policies
          (id, tenant_id, provider, zero_retention_confirmed, dpa_ref,
           inference_region, egress_allowlist, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
         ON CONFLICT (tenant_id, provider) DO UPDATE SET
           zero_retention_confirmed=EXCLUDED.zero_retention_confirmed,
           dpa_ref=EXCLUDED.dpa_ref,
           inference_region=EXCLUDED.inference_region,
           egress_allowlist=EXCLUDED.egress_allowlist,
           approved_by=EXCLUDED.approved_by,
           approved_at=now(),
           status='ACTIVE',
           retired_at=NULL,
           updated_at=now()
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.provider,
          input.zeroRetentionConfirmed,
          input.dpaRef,
          input.inferenceRegion,
          JSON.stringify(input.egressAllowlist),
          input.approvedBy,
        ],
      );
      return this.mapModelProviderPolicy(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Tenant ${input.tenantId} or approver ${input.approvedBy} not found`,
        );
      }
      throw error;
    }
  }

  async listModelProviderPolicies(
    tenantId: string,
  ): Promise<ModelProviderPolicy[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM model_provider_policies
        WHERE tenant_id=$1
        ORDER BY provider`,
      [tenantId],
    );
    return rows.map((row) => this.mapModelProviderPolicy(row));
  }

  async getActiveModelProviderPolicy(
    tenantId: string,
    provider: string,
  ): Promise<ModelProviderPolicy | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM model_provider_policies
        WHERE tenant_id=$1 AND provider=$2 AND status='ACTIVE'
        LIMIT 1`,
      [tenantId, provider],
    );
    return rows[0] ? this.mapModelProviderPolicy(rows[0]) : undefined;
  }

  async retireModelProviderPolicy(input: {
    tenantId: string;
    policyId: string;
  }): Promise<ModelProviderPolicy> {
    const { rows } = await this.pool.query(
      `UPDATE model_provider_policies
          SET status='RETIRED', retired_at=now(), updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
        RETURNING *`,
      [input.tenantId, input.policyId],
    );
    if (!rows[0]) {
      const current = await this.pool.query(
        "SELECT status FROM model_provider_policies WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.policyId],
      );
      if (!current.rows[0]) {
        notFound("ModelProviderPolicy", input.policyId);
      }
      throw new ConflictError(
        `model provider policy ${input.policyId} is ${current.rows[0].status}`,
      );
    }
    return this.mapModelProviderPolicy(rows[0]);
  }

  async createModelEvaluationDataset(input: {
    tenantId: string;
    code: string;
    version: number;
    name: string;
    sampleSize: number;
    holdoutSize: number;
    labelSource: string;
    ownerPersonId: string;
    refreshedAt?: string;
    nextRefreshDueAt?: string;
    contentHash?: string;
    samples?: ModelEvaluationDataset["samples"];
  }): Promise<ModelEvaluationDataset> {
    if (input.holdoutSize >= input.sampleSize) {
      throw new ConflictError(
        "GOLD_SET_HOLDOUT_TOO_LARGE: holdout must be smaller than sample",
      );
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO model_evaluation_datasets
          (id, tenant_id, code, version, name, sample_size, holdout_size,
           label_source, owner_person_id, refreshed_at,
           next_refresh_due_at, content_hash, samples)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, now()),$11,$12,$13::jsonb)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.code,
          input.version,
          input.name,
          input.sampleSize,
          input.holdoutSize,
          input.labelSource,
          input.ownerPersonId,
          input.refreshedAt ?? null,
          input.nextRefreshDueAt ?? null,
          input.contentHash ?? null,
          JSON.stringify(input.samples ?? []),
        ],
      );
      return this.mapModelEvaluationDataset(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          `gold set ${input.code}@v${input.version} already exists`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(
          `Tenant ${input.tenantId} or owner ${input.ownerPersonId} not found`,
        );
      }
      throw error;
    }
  }

  async listModelEvaluationDatasets(
    tenantId: string,
  ): Promise<ModelEvaluationDataset[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM model_evaluation_datasets
        WHERE tenant_id=$1
        ORDER BY refreshed_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapModelEvaluationDataset(row));
  }

  async getActiveModelEvaluationDataset(
    tenantId: string,
    code: string,
  ): Promise<ModelEvaluationDataset | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM model_evaluation_datasets
        WHERE tenant_id=$1 AND code=$2 AND status='ACTIVE'
        ORDER BY version DESC
        LIMIT 1`,
      [tenantId, code],
    );
    return rows[0] ? this.mapModelEvaluationDataset(rows[0]) : undefined;
  }

  async retireModelEvaluationDataset(input: {
    tenantId: string;
    datasetId: string;
  }): Promise<ModelEvaluationDataset> {
    const { rows } = await this.pool.query(
      `UPDATE model_evaluation_datasets
          SET status='RETIRED', retired_at=now(), updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
        RETURNING *`,
      [input.tenantId, input.datasetId],
    );
    if (!rows[0]) {
      const current = await this.pool.query(
        "SELECT status FROM model_evaluation_datasets WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.datasetId],
      );
      if (!current.rows[0]) {
        notFound("ModelEvaluationDataset", input.datasetId);
      }
      throw new ConflictError(
        `model evaluation dataset ${input.datasetId} is ${current.rows[0].status}`,
      );
    }
    return this.mapModelEvaluationDataset(rows[0]);
  }

  async createModelCanaryRun(input: {
    tenantId: string;
    baselineEvaluationRunId: string;
    candidateEvaluationRunId: string;
    datasetRef: string;
    trafficPercent: number;
    passed: boolean;
    blockers: string[];
    metrics: Record<string, unknown>;
  }): Promise<ModelCanaryRun> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO model_canary_runs
          (id, tenant_id, baseline_evaluation_run_id,
           candidate_evaluation_run_id, dataset_ref, traffic_percent,
           passed, blockers, metrics)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.baselineEvaluationRunId,
          input.candidateEvaluationRunId,
          input.datasetRef,
          input.trafficPercent,
          input.passed,
          JSON.stringify(input.blockers),
          JSON.stringify(input.metrics),
        ],
      );
      return this.mapModelCanaryRun(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Tenant or evaluation run not found`,
        );
      }
      throw error;
    }
  }

  async listModelCanaryRuns(tenantId: string): Promise<ModelCanaryRun[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM model_canary_runs
        WHERE tenant_id=$1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapModelCanaryRun(row));
  }

  async createAuditRedaction(input: {
    tenantId: string;
    auditEventId: string;
    replacement: string;
    reason: string;
    requestedBy: string;
    approvedBy: string;
  }): Promise<AuditRedaction> {
    if (input.requestedBy === input.approvedBy) {
      throw new ConflictError(
        "AUDIT_REDACTION_SECOND_PERSON_REQUIRED",
      );
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO audit_redactions
          (id, tenant_id, audit_event_id, replacement, reason,
           requested_by, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.auditEventId,
          input.replacement,
          input.reason,
          input.requestedBy,
          input.approvedBy,
        ],
      );
      return this.mapAuditRedaction(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError("AUDIT_REDACTION_ALREADY_EXISTS");
      }
      if (code === "23503") {
        throw new NotFoundError(
          `Audit event or redaction person not found`,
        );
      }
      throw error;
    }
  }

  async listAuditRedactions(tenantId: string): Promise<AuditRedaction[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM audit_redactions
        WHERE tenant_id=$1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapAuditRedaction(row));
  }

  async createModelRedTeamRun(input: {
    tenantId: string;
    modelProvider: string;
    modelName: string;
    promptVersion: string;
    scope: string;
    testsRun: number;
    passed: boolean;
    findings: string[];
    artifactRef?: string;
    createdBy: string;
  }): Promise<ModelRedTeamRun> {
    if (!input.passed && input.findings.length === 0) {
      throw new ConflictError(
        "RED_TEAM_FINDINGS_REQUIRED: a failed run must list findings",
      );
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO model_red_team_runs
          (id, tenant_id, model_provider, model_name, prompt_version,
           scope, tests_run, passed, findings, artifact_ref, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.modelProvider,
          input.modelName,
          input.promptVersion,
          input.scope,
          input.testsRun,
          input.passed,
          JSON.stringify(input.findings),
          input.artifactRef ?? null,
          input.createdBy,
        ],
      );
      return this.mapModelRedTeamRun(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Tenant ${input.tenantId} or creator ${input.createdBy} not found`,
        );
      }
      throw error;
    }
  }

  async listModelRedTeamRuns(
    tenantId: string,
  ): Promise<ModelRedTeamRun[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM model_red_team_runs
        WHERE tenant_id=$1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapModelRedTeamRun(row));
  }

  async findPassedModelRedTeamRun(
    tenantId: string,
    modelProvider: string,
    modelName: string,
    promptVersion: string,
  ): Promise<ModelRedTeamRun | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM model_red_team_runs
        WHERE tenant_id=$1 AND model_provider=$2 AND model_name=$3
          AND prompt_version=$4 AND passed=true
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, modelProvider, modelName, promptVersion],
    );
    return rows[0] ? this.mapModelRedTeamRun(rows[0]) : undefined;
  }

  async createCompensationTemplate(input: {
    tenantId: string;
    code: string;
    name: string;
    roleCode: string;
    employmentType: CompensationTemplate["employmentType"];
    currency: string;
    fixedSalaryMin: string;
    fixedSalaryMax: string;
    deductionCapRate: string;
    variableShareCapRate: string;
    smoothingThresholdRate: string;
    deductionOrder: string[];
    deductionTypeCaps: Record<string, string>;
  }): Promise<CompensationTemplate> {
    const min = parseDecimal(input.fixedSalaryMin);
    const max = parseDecimal(input.fixedSalaryMax);
    if (min < 0n || max < min) {
      throw new ConflictError("COMPENSATION_TEMPLATE_SALARY_RANGE_INVALID");
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO compensation_templates
          (id, tenant_id, code, name, role_code, employment_type, currency,
           fixed_salary_min, fixed_salary_max, deduction_cap_rate,
           variable_share_cap_rate, smoothing_threshold_rate,
           deduction_order, deduction_type_caps)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.code,
          input.name,
          input.roleCode,
          input.employmentType,
          input.currency,
          input.fixedSalaryMin,
          input.fixedSalaryMax,
          input.deductionCapRate,
          input.variableShareCapRate,
          input.smoothingThresholdRate,
          JSON.stringify(input.deductionOrder),
          JSON.stringify(input.deductionTypeCaps),
        ],
      );
      return this.mapCompensationTemplate(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          `compensation template ${input.code} already exists`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listCompensationTemplates(
    tenantId: string,
  ): Promise<CompensationTemplate[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM compensation_templates
        WHERE tenant_id=$1
        ORDER BY code`,
      [tenantId],
    );
    return rows.map((row) => this.mapCompensationTemplate(row));
  }

  async getActiveCompensationTemplate(
    tenantId: string,
    code: string,
  ): Promise<CompensationTemplate | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM compensation_templates
        WHERE tenant_id=$1 AND code=$2 AND status='ACTIVE'
        LIMIT 1`,
      [tenantId, code],
    );
    return rows[0] ? this.mapCompensationTemplate(rows[0]) : undefined;
  }

  async retireCompensationTemplate(input: {
    tenantId: string;
    templateId: string;
  }): Promise<CompensationTemplate> {
    const { rows } = await this.pool.query(
      `UPDATE compensation_templates
          SET status='RETIRED', updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
        RETURNING *`,
      [input.tenantId, input.templateId],
    );
    if (!rows[0]) {
      const current = await this.pool.query(
        "SELECT status FROM compensation_templates WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.templateId],
      );
      if (!current.rows[0]) {
        notFound("CompensationTemplate", input.templateId);
      }
      throw new ConflictError(
        `compensation template ${input.templateId} is ${current.rows[0].status}`,
      );
    }
    return this.mapCompensationTemplate(rows[0]);
  }

  async createESignEnvelope(input: {
    tenantId: string;
    contractId: string;
    provider: string;
    envelopeRef: string;
    documentHash: string;
    signerPersonId: string;
  }): Promise<ESignEnvelope> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO esign_envelopes
          (id, tenant_id, contract_id, provider, envelope_ref, document_hash,
           signer_person_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.contractId,
          input.provider,
          input.envelopeRef,
          input.documentHash,
          input.signerPersonId,
        ],
      );
      return this.mapESignEnvelope(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          "ESIGN_ENVELOPE_EXISTS: provider envelope reference already recorded",
        );
      }
      if (code === "23503") {
        throw new NotFoundError(
          `Tenant, contract or signer not found`,
        );
      }
      throw error;
    }
  }

  async listESignEnvelopes(
    tenantId: string,
    contractId?: string,
  ): Promise<ESignEnvelope[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM esign_envelopes WHERE tenant_id=$1";
    if (contractId) {
      params.push(contractId);
      sql += " AND contract_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapESignEnvelope(row));
  }

  async completeESignEnvelope(input: {
    tenantId: string;
    provider: string;
    envelopeRef: string;
    status: "SIGNED" | "DECLINED" | "VOID";
    signatureRef?: string;
    reason?: string;
  }): Promise<ESignEnvelope> {
    if (input.status === "SIGNED" && !input.signatureRef?.trim()) {
      throw new ConflictError("ESIGN_SIGNATURE_REF_REQUIRED");
    }
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM esign_envelopes
          WHERE tenant_id=$1 AND provider=$2 AND envelope_ref=$3
          FOR UPDATE`,
        [input.tenantId, input.provider, input.envelopeRef],
      );
      if (!rows[0]) notFound("ESignEnvelope", input.envelopeRef);
      const current = this.mapESignEnvelope(rows[0]);
      if (current.status !== "SENT") {
        throw new ConflictError(
          `e-sign envelope is ${current.status}`,
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE esign_envelopes
            SET status=$4, completed_at=now(), decline_reason=$5,
                updated_at=now()
          WHERE tenant_id=$1 AND provider=$2 AND envelope_ref=$3
          RETURNING *`,
        [
          input.tenantId,
          input.provider,
          input.envelopeRef,
          input.status,
          input.status === "SIGNED" ? null : input.reason ?? null,
        ],
      );
      if (input.status === "SIGNED") {
        await client.query(
          `UPDATE employment_contracts
              SET consent_signature_ref=$3, consent_signed_at=now(),
                  version=version+1, updated_at=now()
            WHERE tenant_id=$1 AND id=$2`,
          [input.tenantId, current.contractId, input.signatureRef],
        );
      }
      return this.mapESignEnvelope(updated[0]);
    });
  }

  async createApprovalRequest(input: {
    tenantId: string;
    actionType: string;
    targetType: string;
    targetId: string;
    targetVersion: number;
    requestedByType: "USER" | "AGENT" | "SYSTEM";
    requestedById?: string;
    riskTier: ApprovalRiskTier;
    requiredApprovals: number;
    expiresAt?: string;
    payloadHash: string;
    idempotencyKey: string;
  }): Promise<ApprovalRequest> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO approval_requests
          (id, tenant_id, action_type, target_type, target_id,
           target_version, requested_by_type, requested_by_id, risk_tier,
           required_approvals, expires_at, payload_hash, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.actionType,
          input.targetType,
          input.targetId,
          input.targetVersion,
          input.requestedByType,
          input.requestedById ?? null,
          input.riskTier,
          input.requiredApprovals,
          input.expiresAt ?? null,
          input.payloadHash,
          input.idempotencyKey,
        ],
      );
      return this.mapApprovalRequest(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        const { rows } = await this.pool.query(
          `SELECT * FROM approval_requests
            WHERE tenant_id=$1 AND idempotency_key=$2`,
          [input.tenantId, input.idempotencyKey],
        );
        if (rows[0] && rows[0].payload_hash === input.payloadHash) {
          return this.mapApprovalRequest(rows[0]);
        }
        throw new ConflictError(
          `idempotency key ${input.idempotencyKey} was reused with a different payload`,
        );
      }
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listApprovalRequests(
    tenantId: string,
    filter?: {
      status?: ApprovalStatus;
      targetType?: string;
      targetId?: string;
    },
  ): Promise<ApprovalRequest[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM approval_requests WHERE tenant_id=$1";
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status=$${params.length}`;
    }
    if (filter?.targetType) {
      params.push(filter.targetType);
      sql += ` AND target_type=$${params.length}`;
    }
    if (filter?.targetId) {
      params.push(filter.targetId);
      sql += ` AND target_id=$${params.length}`;
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapApprovalRequest(row));
  }

  async getApprovalRequest(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalRequest> {
    const { rows } = await this.pool.query(
      "SELECT * FROM approval_requests WHERE tenant_id=$1 AND id=$2",
      [tenantId, requestId],
    );
    if (!rows[0]) notFound("ApprovalRequest", requestId);
    return this.mapApprovalRequest(rows[0]);
  }

  async listApprovalDecisions(
    tenantId: string,
    requestId: string,
  ): Promise<ApprovalDecision[]> {
    await this.getApprovalRequest(tenantId, requestId);
    const { rows } = await this.pool.query(
      `SELECT * FROM approval_decisions
        WHERE tenant_id=$1 AND request_id=$2
        ORDER BY decided_at`,
      [tenantId, requestId],
    );
    return rows.map((row) => this.mapApprovalDecision(row));
  }

  async decideApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    decision: "APPROVE" | "REJECT";
    approverPersonId: string;
    payloadHash: string;
    reason?: string;
    authContext: Record<string, unknown>;
  }): Promise<ApprovalRequest> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM approval_requests
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.requestId],
      );
      if (!rows[0]) notFound("ApprovalRequest", input.requestId);
      const request = this.mapApprovalRequest(rows[0]);
      if (request.status !== "PENDING") {
        throw new ConflictError(
          `approval request ${request.id} is ${request.status}`,
        );
      }
      if (request.expiresAt && new Date(request.expiresAt) <= new Date()) {
        await client.query(
          `UPDATE approval_requests SET status='EXPIRED'
            WHERE tenant_id=$1 AND id=$2`,
          [input.tenantId, input.requestId],
        );
        throw new ConflictError(
          `approval request ${request.id} has expired`,
        );
      }
      if (input.payloadHash !== request.payloadHash) {
        throw new ConflictError(
          "PAYLOAD_HASH_MISMATCH: the approved payload differs from the request",
        );
      }
      if (
        request.requestedByType === "USER" &&
        request.requestedById === input.approverPersonId
      ) {
        throw new ConflictError(
          "SEPARATION_OF_DUTIES: the requester cannot approve their own request",
        );
      }
      try {
        await client.query(
          `INSERT INTO approval_decisions
            (id, tenant_id, request_id, decision, approver_person_id,
             payload_hash, reason, auth_context)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            randomUUID(),
            input.tenantId,
            input.requestId,
            input.decision,
            input.approverPersonId,
            input.payloadHash,
            input.reason ?? null,
            input.authContext,
          ],
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError(
            `approver ${input.approverPersonId} already decided this request`,
          );
        }
        if (code === "23503") {
          throw new NotFoundError(
            `Person ${input.approverPersonId} not found`,
          );
        }
        throw error;
      }
      const approvedCount =
        input.decision === "APPROVE"
          ? request.approvedCount + 1
          : request.approvedCount;
      const status: ApprovalStatus =
        input.decision === "REJECT"
          ? "REJECTED"
          : approvedCount >= request.requiredApprovals
            ? "APPROVED"
            : "PENDING";
      const { rows: updated } = await client.query(
        `UPDATE approval_requests
            SET approved_count=$3, status=$4
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.requestId, approvedCount, status],
      );
      return this.mapApprovalRequest(updated[0]);
    });
  }

  async consumeApprovalRequest(input: {
    tenantId: string;
    requestId: string;
    consumedBy: string;
  }): Promise<ApprovalRequest> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM approval_requests
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.requestId],
      );
      if (!rows[0]) notFound("ApprovalRequest", input.requestId);
      const request = this.mapApprovalRequest(rows[0]);
      if (request.status !== "APPROVED") {
        throw new ConflictError(
          `approval request ${request.id} is ${request.status}`,
        );
      }
      if (request.consumedAt) {
        throw new ConflictError(
          `approval request ${request.id} was already consumed`,
        );
      }
      try {
        const { rows: updated } = await client.query(
          `UPDATE approval_requests
              SET consumed_at=now(), consumed_by=$3
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.requestId, input.consumedBy],
        );
        return this.mapApprovalRequest(updated[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.consumedBy} not found`);
        }
        throw error;
      }
    });
  }

  async createSettlementExport(input: {
    tenantId: string;
    batchId: string;
    exportRef: string;
    exportHash: string;
    exportedBy: string;
    exportedAt?: string;
  }): Promise<SettlementExport> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO settlement_exports
          (id, tenant_id, batch_id, export_ref, export_hash, exported_by,
           exported_at)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.batchId,
          input.exportRef,
          input.exportHash,
          input.exportedBy,
          input.exportedAt ?? null,
        ],
      );
      return this.mapSettlementExport(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          "settlement batch or exporting person not found",
        );
      }
      throw error;
    }
  }

  async listSettlementExports(
    tenantId: string,
    batchId?: string,
  ): Promise<SettlementExport[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM settlement_exports WHERE tenant_id=$1";
    if (batchId) {
      params.push(batchId);
      sql += " AND batch_id=$2";
    }
    sql += " ORDER BY exported_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapSettlementExport(row));
  }

  async getSettlementExport(
    tenantId: string,
    exportId: string,
  ): Promise<SettlementExport> {
    const { rows } = await this.pool.query(
      "SELECT * FROM settlement_exports WHERE tenant_id=$1 AND id=$2",
      [tenantId, exportId],
    );
    if (!rows[0]) notFound("SettlementExport", exportId);
    return this.mapSettlementExport(rows[0]);
  }

  async acknowledgeSettlementExport(input: {
    tenantId: string;
    exportId: string;
    externalReference: string;
    acknowledgedAt?: string;
  }): Promise<SettlementAcknowledgement> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM settlement_exports
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.exportId],
      );
      if (!rows[0]) notFound("SettlementExport", input.exportId);
      const record = this.mapSettlementExport(rows[0]);
      if (record.acknowledgedAt) {
        throw new ConflictError(
          `settlement export ${record.id} was already acknowledged`,
        );
      }
      try {
        const { rows: acknowledgements } = await client.query(
          `INSERT INTO settlement_acknowledgements
            (id, tenant_id, export_id, external_reference,
             acknowledged_at, payload_hash)
           VALUES ($1,$2,$3,$4,COALESCE($5, now()),$6)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            record.id,
            input.externalReference,
            input.acknowledgedAt ?? null,
            record.exportHash,
          ],
        );
        const acknowledgement = this.mapSettlementAcknowledgement(
          acknowledgements[0],
        );
        await client.query(
          `UPDATE settlement_exports
              SET acknowledged_at=$3, acknowledgement_ref=$4
            WHERE tenant_id=$1 AND id=$2`,
          [
            input.tenantId,
            record.id,
            acknowledgement.acknowledgedAt,
            input.externalReference,
          ],
        );
        return acknowledgement;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `settlement export ${record.id} was already acknowledged`,
          );
        }
        throw error;
      }
    });
  }

  async createBudgetPool(input: {
    tenantId: string;
    cycleId: string;
    code: string;
    name: string;
    poolType: string;
    currency: string;
    approvedAmount: string;
  }): Promise<BudgetPool> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO budget_pools
          (id, tenant_id, cycle_id, code, name, pool_type, currency,
           approved_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.cycleId,
          input.code,
          input.name,
          input.poolType,
          input.currency,
          input.approvedAmount,
        ],
      );
      return this.mapBudgetPool(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          `budget pool ${input.code} already exists for the cycle`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(`Cycle ${input.cycleId} not found`);
      }
      if (code === "23514") {
        throw new ConflictError("approvedAmount must not be negative");
      }
      throw error;
    }
  }

  async listBudgetPools(
    tenantId: string,
    cycleId?: string,
  ): Promise<BudgetPool[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM budget_pools WHERE tenant_id=$1";
    if (cycleId) {
      params.push(cycleId);
      sql += " AND cycle_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapBudgetPool(row));
  }

  async getBudgetPool(tenantId: string, poolId: string): Promise<BudgetPool> {
    const { rows } = await this.pool.query(
      "SELECT * FROM budget_pools WHERE tenant_id=$1 AND id=$2",
      [tenantId, poolId],
    );
    if (!rows[0]) notFound("BudgetPool", poolId);
    return {
      ...this.mapBudgetPool(rows[0]),
      allocations: await this.listBudgetAllocations(tenantId, poolId),
    };
  }

  async approveBudgetPool(input: {
    tenantId: string;
    poolId: string;
    approvedBy: string;
  }): Promise<BudgetPool> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM budget_pools
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.poolId],
      );
      if (!rows[0]) notFound("BudgetPool", input.poolId);
      const pool = this.mapBudgetPool(rows[0]);
      if (pool.status !== "DRAFT") {
        throw new ConflictError(`budget pool ${pool.id} is ${pool.status}`);
      }
      try {
        const { rows: updated } = await client.query(
          `UPDATE budget_pools
              SET status='APPROVED', approved_by=$3, approved_at=now(),
                  updated_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.poolId, input.approvedBy],
        );
        return this.mapBudgetPool(updated[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.approvedBy} not found`);
        }
        throw error;
      }
    });
  }

  async createBudgetAllocation(input: {
    tenantId: string;
    poolId: string;
    targetType: string;
    targetId: string;
    amount: string;
  }): Promise<BudgetAllocation> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM budget_pools
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.poolId],
      );
      if (!rows[0]) notFound("BudgetPool", input.poolId);
      const pool = this.mapBudgetPool(rows[0]);
      if (pool.status !== "APPROVED") {
        throw new ConflictError(`budget pool ${pool.id} is ${pool.status}`);
      }
      const amount = money(input.amount);
      if (amount <= 0n) {
        throw new ConflictError("allocation amount must be positive");
      }
      const committed = money(pool.committedAmount);
      if (committed + amount > money(pool.approvedAmount)) {
        throw new ConflictError(
          `BUDGET_EXCEEDED: committed ${formatDecimal(committed)} + ${formatDecimal(amount)} > ${pool.approvedAmount}`,
        );
      }
      const { rows: allocations } = await client.query(
        `INSERT INTO budget_allocations
          (id, tenant_id, budget_pool_id, target_type, target_id, amount)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          pool.id,
          input.targetType,
          input.targetId,
          formatDecimal(amount),
        ],
      );
      await client.query(
        `UPDATE budget_pools
            SET committed_amount=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, pool.id, formatDecimal(committed + amount)],
      );
      return this.mapBudgetAllocation(allocations[0]);
    });
  }

  async listBudgetAllocations(
    tenantId: string,
    poolId: string,
  ): Promise<BudgetAllocation[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM budget_allocations
        WHERE tenant_id=$1 AND budget_pool_id=$2
        ORDER BY created_at DESC`,
      [tenantId, poolId],
    );
    return rows.map((row) => this.mapBudgetAllocation(row));
  }

  async releaseBudgetAllocation(input: {
    tenantId: string;
    allocationId: string;
  }): Promise<BudgetAllocation> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM budget_allocations
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.allocationId],
      );
      if (!rows[0]) notFound("BudgetAllocation", input.allocationId);
      const allocation = this.mapBudgetAllocation(rows[0]);
      if (allocation.status !== "RESERVED") {
        throw new ConflictError(
          `budget allocation ${allocation.id} is ${allocation.status}`,
        );
      }
      const { rows: pools } = await client.query(
        `SELECT * FROM budget_pools
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, allocation.budgetPoolId],
      );
      if (!pools[0]) notFound("BudgetPool", allocation.budgetPoolId);
      const pool = this.mapBudgetPool(pools[0]);
      const committed = money(pool.committedAmount);
      const amount = money(allocation.amount);
      if (committed < amount) {
        throw new ConflictError("BUDGET_LEDGER_INCONSISTENT");
      }
      await client.query(
        `UPDATE budget_allocations SET status='RELEASED'
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, allocation.id],
      );
      await client.query(
        `UPDATE budget_pools
            SET committed_amount=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, pool.id, formatDecimal(committed - amount)],
      );
      return { ...allocation, status: "RELEASED" };
    });
  }

  async createCashGateInput(input: {
    tenantId: string;
    cycleId: string;
    asOfDate: string;
    safetyReserveMonths: string;
    thirteenWeekForecastRef: string;
    passesGate: boolean;
    approvedBy: string;
    approvedAt?: string;
  }): Promise<CashGateInput> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO cash_gate_inputs
          (id, tenant_id, cycle_id, as_of_date, safety_reserve_months,
           thirteen_week_forecast_ref, passes_gate, approved_by, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, now()))
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.cycleId,
          input.asOfDate,
          input.safetyReserveMonths,
          input.thirteenWeekForecastRef,
          input.passesGate,
          input.approvedBy,
          input.approvedAt ?? null,
        ],
      );
      return this.mapCashGateInput(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          `cash gate for ${input.asOfDate} already exists for the cycle`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError("cycle or approving person not found");
      }
      throw error;
    }
  }

  async listCashGateInputs(
    tenantId: string,
    cycleId?: string,
  ): Promise<CashGateInput[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM cash_gate_inputs WHERE tenant_id=$1";
    if (cycleId) {
      params.push(cycleId);
      sql += " AND cycle_id=$2";
    }
    sql += " ORDER BY as_of_date DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapCashGateInput(row));
  }

  async createFinancialFact(input: {
    tenantId: string;
    sourceSystem: string;
    sourceRecordId: string;
    factType: string;
    periodStart?: string;
    periodEnd?: string;
    amount: string;
    currency: string;
    qualityStatus: FinancialFact["qualityStatus"];
    sourceUpdatedAt?: string;
    payload: Record<string, unknown>;
  }): Promise<FinancialFact> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO financial_facts
          (id, tenant_id, source_system, source_record_id, fact_type,
           period_start, period_end, amount, currency, quality_status,
           source_updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id, source_system, source_record_id, fact_type)
         DO UPDATE SET period_start=EXCLUDED.period_start,
                       period_end=EXCLUDED.period_end,
                       amount=EXCLUDED.amount,
                       currency=EXCLUDED.currency,
                       quality_status=EXCLUDED.quality_status,
                       source_updated_at=EXCLUDED.source_updated_at,
                       ingested_at=now(),
                       payload=EXCLUDED.payload
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.sourceSystem,
          input.sourceRecordId,
          input.factType,
          input.periodStart ?? null,
          input.periodEnd ?? null,
          input.amount,
          input.currency,
          input.qualityStatus,
          input.sourceUpdatedAt ?? null,
          input.payload,
        ],
      );
      return this.mapFinancialFact(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listFinancialFacts(
    tenantId: string,
    filter?: { factType?: string; sourceSystem?: string },
  ): Promise<FinancialFact[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM financial_facts WHERE tenant_id=$1";
    if (filter?.factType) {
      params.push(filter.factType);
      sql += ` AND fact_type=$${params.length}`;
    }
    if (filter?.sourceSystem) {
      params.push(filter.sourceSystem);
      sql += ` AND source_system=$${params.length}`;
    }
    sql += " ORDER BY ingested_at DESC, created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapFinancialFact(row));
  }

  async createRuleChangeOrder(input: {
    tenantId: string;
    policyCode: string;
    fromPolicyVersionId?: string;
    toPolicyVersionId: string;
    changeType: string;
    reason: string;
    impactSimulation: Record<string, unknown>;
    effectiveFrom: string;
    requestedBy: string;
  }): Promise<RuleChangeOrder> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO rule_change_orders
          (id, tenant_id, policy_code, from_policy_version_id,
           to_policy_version_id, change_type, reason, impact_simulation,
           effective_from, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.policyCode,
          input.fromPolicyVersionId ?? null,
          input.toPolicyVersionId,
          input.changeType,
          input.reason,
          input.impactSimulation,
          input.effectiveFrom,
          input.requestedBy,
        ],
      );
      return this.mapRuleChangeOrder(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("policy version or requester not found");
      }
      throw error;
    }
  }

  async listRuleChangeOrders(
    tenantId: string,
    filter?: { policyCode?: string; status?: RuleChangeOrder["status"] },
  ): Promise<RuleChangeOrder[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM rule_change_orders WHERE tenant_id=$1";
    if (filter?.policyCode) {
      params.push(filter.policyCode);
      sql += ` AND policy_code=$${params.length}`;
    }
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status=$${params.length}`;
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapRuleChangeOrder(row));
  }

  async getRuleChangeOrder(
    tenantId: string,
    orderId: string,
  ): Promise<RuleChangeOrder> {
    const { rows } = await this.pool.query(
      "SELECT * FROM rule_change_orders WHERE tenant_id=$1 AND id=$2",
      [tenantId, orderId],
    );
    if (!rows[0]) notFound("RuleChangeOrder", orderId);
    return this.mapRuleChangeOrder(rows[0]);
  }

  async approveRuleChangeOrder(input: {
    tenantId: string;
    orderId: string;
    approvedBy: string;
  }): Promise<RuleChangeOrder> {
    return this.decideRuleChangeOrder(input, "APPROVED");
  }

  async rejectRuleChangeOrder(input: {
    tenantId: string;
    orderId: string;
    approvedBy: string;
  }): Promise<RuleChangeOrder> {
    return this.decideRuleChangeOrder(input, "REJECTED");
  }

  async publicizeRuleChangeOrder(input: {
    tenantId: string;
    orderId: string;
  }): Promise<RuleChangeOrder> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM rule_change_orders
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.orderId],
      );
      if (!rows[0]) notFound("RuleChangeOrder", input.orderId);
      const order = this.mapRuleChangeOrder(rows[0]);
      if (order.status !== "APPROVED") {
        throw new ConflictError(
          `rule change order ${order.id} is ${order.status}`,
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE rule_change_orders
            SET status='PUBLICIZED', publicized_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.orderId],
      );
      return this.mapRuleChangeOrder(updated[0]);
    });
  }

  async createPolicyTestCase(input: {
    tenantId: string;
    policyVersionId: string;
    caseCode: string;
    input: Record<string, unknown>;
    expectedOutput: Record<string, unknown>;
    category: PolicyTestCase["category"];
  }): Promise<PolicyTestCase> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO policy_test_cases
          (id, tenant_id, policy_version_id, case_code, input,
           expected_output, category)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.policyVersionId,
          input.caseCode,
          input.input,
          input.expectedOutput,
          input.category,
        ],
      );
      return this.mapPolicyTestCase(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          `test case ${input.caseCode} already exists for the policy version`,
        );
      }
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Policy version ${input.policyVersionId} not found`,
        );
      }
      throw error;
    }
  }

  async listPolicyTestCases(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyTestCase[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM policy_test_cases WHERE tenant_id=$1";
    if (policyVersionId) {
      params.push(policyVersionId);
      sql += " AND policy_version_id=$2";
    }
    sql += " ORDER BY case_code";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapPolicyTestCase(row));
  }

  async getPolicyTestCase(
    tenantId: string,
    testCaseId: string,
  ): Promise<PolicyTestCase> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM policy_test_cases WHERE tenant_id=$1 AND id=$2`,
      [tenantId, testCaseId],
    );
    if (!rows[0]) notFound("PolicyTestCase", testCaseId);
    return this.mapPolicyTestCase(rows[0]);
  }

  async recordPolicyTestCaseRun(input: {
    tenantId: string;
    testCaseId: string;
    passed: boolean;
    resultHash?: string;
    runAt?: string;
  }): Promise<PolicyTestCase> {
    const { rows } = await this.pool.query(
      `UPDATE policy_test_cases
          SET last_run_at=$3, last_run_passed=$4, last_run_result_hash=$5
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [
        input.tenantId,
        input.testCaseId,
        input.runAt ?? new Date().toISOString(),
        input.passed,
        input.resultHash ?? null,
      ],
    );
    if (!rows[0]) notFound("PolicyTestCase", input.testCaseId);
    return this.mapPolicyTestCase(rows[0]);
  }

  async recordPolicyTestRun(input: {
    tenantId: string;
    policyVersionId: string;
    runAt?: string;
    total: number;
    passedCount: number;
    failedCount: number;
    retiredCount: number;
    passed: boolean;
    resultsHash: string;
    results: PolicyTestRun["results"];
  }): Promise<PolicyTestRun> {
    await this.assertTenant(input.tenantId);
    const { rows } = await this.pool.query(
      `INSERT INTO policy_test_runs
        (id, tenant_id, policy_version_id, run_at, total, passed_count,
         failed_count, retired_count, passed, results_hash, results)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        randomUUID(),
        input.tenantId,
        input.policyVersionId,
        input.runAt ?? new Date().toISOString(),
        input.total,
        input.passedCount,
        input.failedCount,
        input.retiredCount,
        input.passed,
        input.resultsHash,
        JSON.stringify(input.results),
      ],
    );
    return this.mapPolicyTestRun(rows[0]);
  }

  async listPolicyTestRuns(
    tenantId: string,
    policyVersionId?: string,
    limit = 20,
  ): Promise<PolicyTestRun[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM policy_test_runs
        WHERE tenant_id=$1
          AND ($2::uuid IS NULL OR policy_version_id=$2)
        ORDER BY run_at DESC
        LIMIT $3`,
      [tenantId, policyVersionId ?? null, limit],
    );
    return rows.map((row) => this.mapPolicyTestRun(row));
  }

  async retirePolicyTestCase(input: {
    tenantId: string;
    testCaseId: string;
  }): Promise<PolicyTestCase> {
    const { rows } = await this.pool.query(
      `UPDATE policy_test_cases SET status='RETIRED'
        WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
        RETURNING *`,
      [input.tenantId, input.testCaseId],
    );
    if (!rows[0]) {
      const { rows: existing } = await this.pool.query(
        "SELECT * FROM policy_test_cases WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.testCaseId],
      );
      if (!existing[0]) notFound("PolicyTestCase", input.testCaseId);
      throw new ConflictError(
        `policy test case ${input.testCaseId} is ${existing[0].status}`,
      );
    }
    return this.mapPolicyTestCase(rows[0]);
  }

  async createPolicyNotice(input: {
    tenantId: string;
    policyVersionId: string;
    noticeId: string;
    audience: Record<string, unknown>;
  }): Promise<PolicyNotice> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO policy_notices
          (id, tenant_id, policy_version_id, notice_id, audience)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.policyVersionId,
          input.noticeId,
          input.audience,
        ],
      );
      return this.mapPolicyNotice(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          "policy notice link already exists for this policy version",
        );
      }
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("policy version or notice not found");
      }
      throw error;
    }
  }

  async listPolicyNotices(
    tenantId: string,
    policyVersionId?: string,
  ): Promise<PolicyNotice[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM policy_notices WHERE tenant_id=$1";
    if (policyVersionId) {
      params.push(policyVersionId);
      sql += " AND policy_version_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapPolicyNotice(row));
  }

  private async decideRuleChangeOrder(
    input: { tenantId: string; orderId: string; approvedBy: string },
    status: "APPROVED" | "REJECTED",
  ): Promise<RuleChangeOrder> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM rule_change_orders
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.orderId],
      );
      if (!rows[0]) notFound("RuleChangeOrder", input.orderId);
      const order = this.mapRuleChangeOrder(rows[0]);
      if (order.status !== "DRAFT") {
        throw new ConflictError(
          `rule change order ${order.id} is ${order.status}`,
        );
      }
      if (order.requestedBy === input.approvedBy) {
        throw new ConflictError(
          "SEPARATION_OF_DUTIES: the requester cannot decide their own change",
        );
      }
      try {
        const { rows: updated } = await client.query(
          `UPDATE rule_change_orders
              SET status=$3, approved_by=$4, approved_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.orderId, status, input.approvedBy],
        );
        return this.mapRuleChangeOrder(updated[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.approvedBy} not found`);
        }
        throw error;
      }
    });
  }

  async createMetricDefinition(input: {
    tenantId: string;
    code: string;
    version: number;
    name: string;
    description?: string;
    dataType: string;
    unit?: string;
    aggregationMethod?: string;
    sourceContract: Record<string, unknown>;
    effectiveFrom: string;
    effectiveTo?: string;
  }): Promise<MetricDefinition> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO metric_definitions
          (id, tenant_id, code, version, name, description, data_type,
           unit, aggregation_method, source_contract, effective_from,
           effective_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.code,
          input.version,
          input.name,
          input.description ?? null,
          input.dataType,
          input.unit ?? null,
          input.aggregationMethod ?? null,
          input.sourceContract,
          input.effectiveFrom,
          input.effectiveTo ?? null,
        ],
      );
      return this.mapMetricDefinition(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        throw new ConflictError(
          `metric ${input.code} v${input.version} already exists`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      if (code === "23514") {
        throw new ConflictError(
          "effectiveTo must not be before effectiveFrom",
        );
      }
      throw error;
    }
  }

  async listMetricDefinitions(
    tenantId: string,
    filter?: { code?: string; active?: boolean },
  ): Promise<MetricDefinition[]> {
    await this.assertTenant(tenantId);
    const params: Array<string | boolean> = [tenantId];
    let sql = "SELECT * FROM metric_definitions WHERE tenant_id=$1";
    if (filter?.code) {
      params.push(filter.code);
      sql += ` AND code=$${params.length}`;
    }
    if (filter?.active !== undefined) {
      params.push(filter.active);
      sql += ` AND active=$${params.length}`;
    }
    sql += " ORDER BY code, version DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapMetricDefinition(row));
  }

  async retireMetricDefinition(input: {
    tenantId: string;
    metricId: string;
  }): Promise<MetricDefinition> {
    const { rows } = await this.pool.query(
      `UPDATE metric_definitions SET active=false
        WHERE tenant_id=$1 AND id=$2 AND active=true
        RETURNING *`,
      [input.tenantId, input.metricId],
    );
    if (!rows[0]) {
      const { rows: existing } = await this.pool.query(
        "SELECT * FROM metric_definitions WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.metricId],
      );
      if (!existing[0]) notFound("MetricDefinition", input.metricId);
      throw new ConflictError(
        `metric ${input.metricId} is already retired`,
      );
    }
    return this.mapMetricDefinition(rows[0]);
  }

  async createDeliverable(input: {
    tenantId: string;
    workPackageId: string;
    title: string;
    deliverableType: string;
    ownerPersonId: string;
    dueAt?: string;
  }): Promise<Deliverable> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO deliverables
          (id, tenant_id, work_package_id, title, deliverable_type,
           owner_person_id, due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.workPackageId,
          input.title,
          input.deliverableType,
          input.ownerPersonId,
          input.dueAt ?? null,
        ],
      );
      return this.mapDeliverable(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("work package or owner not found");
      }
      throw error;
    }
  }

  async listDeliverables(
    tenantId: string,
    workPackageId?: string,
  ): Promise<Deliverable[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM deliverables WHERE tenant_id=$1";
    if (workPackageId) {
      params.push(workPackageId);
      sql += " AND work_package_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapDeliverable(row));
  }

  async getDeliverable(
    tenantId: string,
    deliverableId: string,
  ): Promise<Deliverable> {
    const { rows } = await this.pool.query(
      "SELECT * FROM deliverables WHERE tenant_id=$1 AND id=$2",
      [tenantId, deliverableId],
    );
    if (!rows[0]) notFound("Deliverable", deliverableId);
    return this.mapDeliverable(rows[0]);
  }

  async submitDeliverable(input: {
    tenantId: string;
    deliverableId: string;
    artifactRef?: string;
    contentHash?: string;
  }): Promise<Deliverable> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM deliverables
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.deliverableId],
      );
      if (!rows[0]) notFound("Deliverable", input.deliverableId);
      const deliverable = this.mapDeliverable(rows[0]);
      if (
        deliverable.status !== "DRAFT" &&
        deliverable.status !== "REJECTED"
      ) {
        throw new ConflictError(
          `deliverable ${deliverable.id} is ${deliverable.status}`,
        );
      }
      const version =
        deliverable.status === "REJECTED"
          ? deliverable.version + 1
          : deliverable.version;
      const { rows: updated } = await client.query(
        `UPDATE deliverables
            SET status='SUBMITTED', submitted_at=now(), version=$3,
                artifact_ref=COALESCE($4, artifact_ref),
                content_hash=COALESCE($5, content_hash),
                updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.deliverableId,
          version,
          input.artifactRef ?? null,
          input.contentHash ?? null,
        ],
      );
      return this.mapDeliverable(updated[0]);
    });
  }

  async recordDeliverableAcceptance(input: {
    tenantId: string;
    deliverableId: string;
    decision: Acceptance["decision"];
    reviewerPersonId: string;
    criteriaResults: Record<string, unknown>;
    comments?: string;
  }): Promise<Acceptance> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM deliverables
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.deliverableId],
      );
      if (!rows[0]) notFound("Deliverable", input.deliverableId);
      const deliverable = this.mapDeliverable(rows[0]);
      if (deliverable.status !== "SUBMITTED") {
        throw new ConflictError(
          `deliverable ${deliverable.id} is ${deliverable.status}`,
        );
      }
      if (input.reviewerPersonId === deliverable.ownerPersonId) {
        throw new ConflictError(
          "SEPARATION_OF_DUTIES: the deliverable owner cannot accept it",
        );
      }
      try {
        const { rows: acceptances } = await client.query(
          `INSERT INTO acceptances
            (id, tenant_id, deliverable_id, decision, reviewer_person_id,
             criteria_results, comments)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            deliverable.id,
            input.decision,
            input.reviewerPersonId,
            input.criteriaResults,
            input.comments ?? null,
          ],
        );
        await client.query(
          `UPDATE deliverables
              SET status=$3, updated_at=now()
            WHERE tenant_id=$1 AND id=$2`,
          [
            input.tenantId,
            deliverable.id,
            input.decision === "REJECT" ? "REJECTED" : "ACCEPTED",
          ],
        );
        return this.mapAcceptance(acceptances[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Person ${input.reviewerPersonId} not found`,
          );
        }
        throw error;
      }
    });
  }

  async listDeliverableAcceptances(
    tenantId: string,
    deliverableId: string,
  ): Promise<Acceptance[]> {
    await this.getDeliverable(tenantId, deliverableId);
    const { rows } = await this.pool.query(
      `SELECT * FROM acceptances
        WHERE tenant_id=$1 AND deliverable_id=$2
        ORDER BY decided_at DESC`,
      [tenantId, deliverableId],
    );
    return rows.map((row) => this.mapAcceptance(row));
  }

  async createAiSuggestion(input: {
    tenantId: string;
    agentTaskId: string;
    targetType: string;
    targetId?: string;
    suggestionType: string;
    modelProvider?: string;
    modelName?: string;
    modelPromptId?: string;
    promptVersion: string;
    inputHash: string;
    outputJson: Record<string, unknown>;
    validationStatus: string;
  }): Promise<AiSuggestionLog> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO ai_suggestion_logs
          (id, tenant_id, agent_task_id, target_type, target_id,
           suggestion_type, model_provider, model_name, model_prompt_id,
           prompt_version, input_hash, output_json, validation_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.agentTaskId,
          input.targetType,
          input.targetId ?? null,
          input.suggestionType,
          input.modelProvider ?? null,
          input.modelName ?? null,
          input.modelPromptId ?? null,
          input.promptVersion,
          input.inputHash,
          input.outputJson,
          input.validationStatus,
        ],
      );
      return this.mapAiSuggestion(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Agent task ${input.agentTaskId} not found`,
        );
      }
      throw error;
    }
  }

  async listAiSuggestions(
    tenantId: string,
    filter?: { agentTaskId?: string; targetType?: string },
  ): Promise<AiSuggestionLog[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM ai_suggestion_logs WHERE tenant_id=$1";
    if (filter?.agentTaskId) {
      params.push(filter.agentTaskId);
      sql += ` AND agent_task_id=$${params.length}`;
    }
    if (filter?.targetType) {
      params.push(filter.targetType);
      sql += ` AND target_type=$${params.length}`;
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapAiSuggestion(row));
  }

  async acceptAiSuggestion(input: {
    tenantId: string;
    suggestionId: string;
    acceptedBy: string;
  }): Promise<AiSuggestionLog> {
    try {
      const { rows } = await this.pool.query(
        `UPDATE ai_suggestion_logs
            SET accepted_by=$3, accepted_at=now()
          WHERE tenant_id=$1 AND id=$2 AND accepted_at IS NULL
          RETURNING *`,
        [input.tenantId, input.suggestionId, input.acceptedBy],
      );
      if (!rows[0]) {
        const { rows: existing } = await this.pool.query(
          "SELECT * FROM ai_suggestion_logs WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.suggestionId],
        );
        if (!existing[0]) notFound("AiSuggestionLog", input.suggestionId);
        throw new ConflictError(
          `AI suggestion ${input.suggestionId} was already accepted`,
        );
      }
      return this.mapAiSuggestion(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Person ${input.acceptedBy} not found`);
      }
      throw error;
    }
  }

  async createModelEvaluationRun(input: {
    tenantId: string;
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
  }): Promise<ModelEvaluationRun> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO model_evaluation_runs
          (id, tenant_id, evaluation_type, model_provider, model_name,
           prompt_version, dataset_ref, sample_size, metrics,
           subgroup_metrics, passed, blockers)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.evaluationType,
          input.modelProvider,
          input.modelName,
          input.promptVersion,
          input.datasetRef,
          input.sampleSize,
          input.metrics,
          input.subgroupMetrics,
          input.passed,
          input.blockers,
        ],
      );
      return this.mapModelEvaluationRun(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listModelEvaluationRuns(
    tenantId: string,
    filter?: { evaluationType?: string; passed?: boolean },
  ): Promise<ModelEvaluationRun[]> {
    await this.assertTenant(tenantId);
    const params: Array<string | boolean> = [tenantId];
    let sql = "SELECT * FROM model_evaluation_runs WHERE tenant_id=$1";
    if (filter?.evaluationType) {
      params.push(filter.evaluationType);
      sql += ` AND evaluation_type=$${params.length}`;
    }
    if (filter?.passed !== undefined) {
      params.push(filter.passed);
      sql += ` AND passed=$${params.length}`;
    }
    sql += " ORDER BY evaluated_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapModelEvaluationRun(row));
  }

  async getModelEvaluationRun(
    tenantId: string,
    runId: string,
  ): Promise<ModelEvaluationRun> {
    const { rows } = await this.pool.query(
      "SELECT * FROM model_evaluation_runs WHERE tenant_id=$1 AND id=$2",
      [tenantId, runId],
    );
    if (!rows[0]) notFound("ModelEvaluationRun", runId);
    return this.mapModelEvaluationRun(rows[0]);
  }

  async createModelPrompt(input: {
    tenantId: string;
    promptCode: string;
    version: number;
    purpose: string;
    modelProvider: string;
    modelName: string;
    template: string;
  }): Promise<ModelPrompt> {
    await this.assertTenant(input.tenantId);
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO model_prompts
          (id, tenant_id, prompt_code, version, purpose, model_provider,
           model_name, template, template_hash, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT')
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.promptCode,
          input.version,
          input.purpose,
          input.modelProvider,
          input.modelName,
          input.template,
          sha256({ template: input.template }),
        ],
      );
      return this.mapModelPrompt(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          `Model prompt ${input.promptCode}:${input.version} already exists`,
        );
      }
      throw error;
    }
  }

  async listModelPrompts(
    tenantId: string,
    filter?: { promptCode?: string; status?: ModelPrompt["status"] },
  ): Promise<ModelPrompt[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM model_prompts WHERE tenant_id=$1";
    if (filter?.promptCode) {
      params.push(filter.promptCode);
      sql += ` AND prompt_code=$${params.length}`;
    }
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status=$${params.length}`;
    }
    sql += " ORDER BY prompt_code, version DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapModelPrompt(row));
  }

  async getModelPrompt(
    tenantId: string,
    promptId: string,
  ): Promise<ModelPrompt> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      "SELECT * FROM model_prompts WHERE tenant_id=$1 AND id=$2",
      [tenantId, promptId],
    );
    if (!rows[0]) notFound("ModelPrompt", promptId);
    return this.mapModelPrompt(rows[0]);
  }

  async activateModelPrompt(input: {
    tenantId: string;
    promptId: string;
    evaluationRunId: string;
  }): Promise<ModelPrompt> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM model_prompts
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.promptId],
      );
      if (!rows[0]) notFound("ModelPrompt", input.promptId);
      const prompt = this.mapModelPrompt(rows[0]);
      if (prompt.status !== "DRAFT") {
        throw new ConflictError(
          `model prompt ${prompt.id} is ${prompt.status}`,
        );
      }
      const { rows: evaluations } = await client.query(
        `SELECT id, passed, model_provider, model_name
           FROM model_evaluation_runs
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, input.evaluationRunId],
      );
      if (!evaluations[0]) {
        notFound("ModelEvaluationRun", input.evaluationRunId);
      }
      if (!evaluations[0].passed) {
        throw new ConflictError(
          `MODEL_EVALUATION_NOT_PASSED: ${input.evaluationRunId}`,
        );
      }
      if (
        evaluations[0].model_provider !== prompt.modelProvider ||
        evaluations[0].model_name !== prompt.modelName
      ) {
        throw new ConflictError(
          `MODEL_EVALUATION_MODEL_MISMATCH: ${input.evaluationRunId}`,
        );
      }
      const { rows: active } = await client.query(
        `SELECT id, version FROM model_prompts
          WHERE tenant_id=$1 AND prompt_code=$2 AND status='ACTIVE'
            AND id<>$3`,
        [input.tenantId, prompt.promptCode, prompt.id],
      );
      if (active[0]) {
        throw new ConflictError(
          `MODEL_PROMPT_ALREADY_ACTIVE: ${prompt.promptCode}:${active[0].version}`,
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE model_prompts
            SET status='ACTIVE', evaluation_run_id=$3, activated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.promptId, input.evaluationRunId],
      );
      return this.mapModelPrompt(updated[0]);
    });
  }

  async retireModelPrompt(input: {
    tenantId: string;
    promptId: string;
  }): Promise<ModelPrompt> {
    const { rows } = await this.pool.query(
      `UPDATE model_prompts
          SET status='RETIRED', retired_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
        RETURNING *`,
      [input.tenantId, input.promptId],
    );
    if (!rows[0]) {
      const prompt = await this.getModelPrompt(
        input.tenantId,
        input.promptId,
      );
      throw new ConflictError(
        `model prompt ${prompt.id} is ${prompt.status}`,
      );
    }
    return this.mapModelPrompt(rows[0]);
  }

  async createAiScoreProposal(input: {
    tenantId: string;
    cycleId: string;
    personId: string;
    evaluationRunId: string;
    modelPromptId?: string;
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
    riskTier?: AiScoreProposal["riskTier"];
    riskReasons?: string[];
    riskAssessedAt?: string;
    secondReviewDueAt?: string;
    zeroScoreRationale?: string;
    requestedBy?: string;
  }): Promise<AiScoreProposal> {
    await this.assertTenant(input.tenantId);
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO ai_score_proposals
          (id, tenant_id, cycle_id, person_id, evaluation_run_id,
           model_prompt_id, model_provider, model_name, prompt_version,
           dimensions, scores, overall_score, confidence, rationale,
           evidence_refs, evidence_snapshot_hash, gate_metrics, risk_tier,
           risk_reasons, risk_assessed_at, second_review_required,
           second_review_due_at, second_review_sla_breached,
           zero_score_rationale, status, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 $18,$19::jsonb,$20,$21,$22,false,$23,'PENDING',$24)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.cycleId,
          input.personId,
          input.evaluationRunId,
          input.modelPromptId ?? null,
          input.modelProvider,
          input.modelName,
          input.promptVersion,
          JSON.stringify(input.dimensions),
          JSON.stringify(input.scores),
          input.overallScore,
          input.confidence,
          input.rationale,
          JSON.stringify(input.evidenceRefs),
          input.evidenceSnapshotHash,
          JSON.stringify(input.gateMetrics),
          input.riskTier ?? "MEDIUM",
          JSON.stringify(input.riskReasons ?? []),
          input.riskAssessedAt ?? null,
          input.riskTier === "HIGH" || input.riskTier === "CRITICAL",
          input.secondReviewDueAt ?? null,
          input.zeroScoreRationale ?? null,
          input.requestedBy ?? null,
        ],
      );
      return this.mapAiScoreProposal(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Person ${input.personId} or evaluation run ${input.evaluationRunId} not found`,
        );
      }
      throw error;
    }
  }

  async listAiScoreProposals(
    tenantId: string,
    filter?: {
      personId?: string;
      cycleId?: string;
      status?: AiScoreProposal["status"];
    },
  ): Promise<AiScoreProposal[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM ai_score_proposals WHERE tenant_id=$1";
    if (filter?.personId) {
      params.push(filter.personId);
      sql += ` AND person_id=$${params.length}`;
    }
    if (filter?.cycleId) {
      params.push(filter.cycleId);
      sql += ` AND cycle_id=$${params.length}`;
    }
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status=$${params.length}`;
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapAiScoreProposal(row));
  }

  async getAiScoreProposal(
    tenantId: string,
    proposalId: string,
  ): Promise<AiScoreProposal> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      "SELECT * FROM ai_score_proposals WHERE tenant_id=$1 AND id=$2",
      [tenantId, proposalId],
    );
    if (!rows[0]) notFound("AiScoreProposal", proposalId);
    return this.mapAiScoreProposal(rows[0]);
  }

  async decideAiScoreProposal(input: {
    tenantId: string;
    proposalId: string;
    decision: "ACCEPT" | "REJECT";
    decidedBy: string;
    note?: string;
    independentScores: Record<string, number>;
    independentRationale?: string;
    reviewStartedAt: string;
    reviewDurationSeconds: number;
    evidenceOpened: number;
    override: boolean;
    overrideReason?: string;
    blindReview: boolean;
    auditSample: boolean;
    secondReviewerPersonId?: string;
    secondIndependentScores?: Record<string, number>;
    secondIndependentRationale?: string;
    secondReviewStartedAt?: string;
    secondEvidenceOpened?: number;
    secondReviewOutcome?: "AGREE" | "DISAGREE";
    secondReviewAgreementRate?: number;
  }): Promise<AiScoreProposal> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM ai_score_proposals
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.proposalId],
      );
      if (!rows[0]) notFound("AiScoreProposal", input.proposalId);
      const proposal = this.mapAiScoreProposal(rows[0]);
      if (proposal.status !== "PENDING") {
        throw new ConflictError(
          `AI score proposal ${proposal.id} is ${proposal.status}`,
        );
      }
      if (proposal.requestedBy === input.decidedBy) {
        throw new ConflictError(
          "AI_SCORE_SELF_REVIEW: the requester cannot decide the proposal",
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE ai_score_proposals
            SET status=$3, decided_by=$4, decision_note=$5, decided_at=now(),
                independent_scores=$6::jsonb, independent_rationale=$7,
                review_started_at=$8, review_duration_seconds=$9,
                evidence_opened=$10, override=$11, override_reason=$12,
                blind_review=$13, audit_sample=$14,
                audit_sampled_at=CASE WHEN $14 THEN now() ELSE audit_sampled_at END,
                second_reviewer_person_id=$15::uuid,
                second_independent_scores=$16::jsonb,
                second_independent_rationale=$17,
                second_review_started_at=$18,
                second_review_evidence_opened=$19,
                second_review_outcome=$20,
                second_review_agreement_rate=$21,
                second_review_completed_at=CASE WHEN $15::uuid IS NOT NULL
                  THEN now() ELSE second_review_completed_at END,
                second_review_sla_breached=CASE
                  WHEN $15::uuid IS NOT NULL
                   AND second_review_due_at IS NOT NULL
                   AND now() > second_review_due_at
                  THEN true ELSE second_review_sla_breached END
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.proposalId,
          input.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED",
          input.decidedBy,
          input.note ?? null,
          JSON.stringify(input.independentScores),
          input.independentRationale ?? null,
          input.reviewStartedAt,
          input.reviewDurationSeconds,
          input.evidenceOpened,
          input.override,
          input.overrideReason ?? null,
          input.blindReview,
          input.auditSample,
          input.secondReviewerPersonId ?? null,
          input.secondIndependentScores
            ? JSON.stringify(input.secondIndependentScores)
            : null,
          input.secondIndependentRationale ?? null,
          input.secondReviewStartedAt ?? null,
          input.secondEvidenceOpened ?? null,
          input.secondReviewOutcome ?? null,
          input.secondReviewAgreementRate ?? null,
        ],
      );
      return this.mapAiScoreProposal(updated[0]);
    });
  }

  async recordAiScoreAuditReview(input: {
    tenantId: string;
    proposalId: string;
    reviewerPersonId: string;
    scores: Record<string, number>;
    rationale: string;
    reviewStartedAt: string;
    reviewDurationSeconds: number;
    evidenceOpened: number;
    outcome: "AGREE" | "DISAGREE";
    agreementRate: number;
  }): Promise<AiScoreProposal> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM ai_score_proposals
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.proposalId],
      );
      if (!rows[0]) notFound("AiScoreProposal", input.proposalId);
      const proposal = this.mapAiScoreProposal(rows[0]);
      if (proposal.status === "PENDING") {
        throw new ConflictError(
          "AI_AUDIT_REQUIRES_DECIDED_PROPOSAL: decide the proposal first",
        );
      }
      if (!proposal.auditSample) {
        throw new ConflictError(
          "AI_AUDIT_NOT_SAMPLED: this proposal is not in the audit sample",
        );
      }
      if (proposal.secondReviewCompletedAt) {
        throw new ConflictError(
          "AI_AUDIT_ALREADY_COMPLETED: second review already recorded",
        );
      }
      if (
        input.reviewerPersonId === proposal.decidedBy ||
        input.reviewerPersonId === proposal.requestedBy
      ) {
        throw new ConflictError(
          "AI_AUDIT_REVIEWER_CONFLICT: reviewer must differ from requester and first reviewer",
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE ai_score_proposals
            SET second_reviewer_person_id=$3,
                second_independent_scores=$4::jsonb,
                second_independent_rationale=$5,
                second_review_started_at=$6,
                second_review_completed_at=now(),
                second_review_duration_seconds=$7,
                second_review_evidence_opened=$8,
                second_review_outcome=$9,
                second_review_agreement_rate=$10
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.proposalId,
          input.reviewerPersonId,
          JSON.stringify(input.scores),
          input.rationale,
          input.reviewStartedAt,
          input.reviewDurationSeconds,
          input.evidenceOpened,
          input.outcome,
          input.agreementRate,
        ],
      );
      return this.mapAiScoreProposal(updated[0]);
    });
  }

  async createWorkflowRun(input: {
    tenantId: string;
    agentTaskId: string;
    workflowName: string;
    workflowVersion: string;
    status: string;
    currentStep?: string;
    state: Record<string, unknown>;
    startedAt?: string;
  }): Promise<WorkflowRun> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO workflow_runs
          (id, tenant_id, agent_task_id, workflow_name, workflow_version,
           status, current_step, state, started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, now()))
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.agentTaskId,
          input.workflowName,
          input.workflowVersion,
          input.status,
          input.currentStep ?? null,
          input.state,
          input.startedAt ?? null,
        ],
      );
      return this.mapWorkflowRun(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Agent task ${input.agentTaskId} not found`,
        );
      }
      throw error;
    }
  }

  async listWorkflowRuns(
    tenantId: string,
    agentTaskId?: string,
  ): Promise<WorkflowRun[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM workflow_runs WHERE tenant_id=$1";
    if (agentTaskId) {
      params.push(agentTaskId);
      sql += " AND agent_task_id=$2";
    }
    sql += " ORDER BY started_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapWorkflowRun(row));
  }

  async finishWorkflowRun(input: {
    tenantId: string;
    workflowRunId: string;
    status: string;
    currentStep?: string;
  }): Promise<WorkflowRun> {
    const { rows } = await this.pool.query(
      `UPDATE workflow_runs
          SET status=$3, current_step=COALESCE($4, current_step),
              finished_at=now()
        WHERE tenant_id=$1 AND id=$2 AND finished_at IS NULL
        RETURNING *`,
      [
        input.tenantId,
        input.workflowRunId,
        input.status,
        input.currentStep ?? null,
      ],
    );
    if (!rows[0]) {
      const { rows: existing } = await this.pool.query(
        "SELECT * FROM workflow_runs WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.workflowRunId],
      );
      if (!existing[0]) notFound("WorkflowRun", input.workflowRunId);
      throw new ConflictError(
        `workflow run ${input.workflowRunId} is already finished`,
      );
    }
    return this.mapWorkflowRun(rows[0]);
  }

  async createIntegrationConnection(input: {
    tenantId: string;
    provider: string;
    connectionName: string;
    credentialRef: string;
    config: Record<string, unknown>;
  }): Promise<IntegrationConnection> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO integration_connections
          (id, tenant_id, provider, connection_name, credential_ref, config)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.provider,
          input.connectionName,
          input.credentialRef,
          input.config,
        ],
      );
      return this.mapIntegrationConnection(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listIntegrationConnections(
    tenantId: string,
  ): Promise<IntegrationConnection[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM integration_connections
        WHERE tenant_id=$1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapIntegrationConnection(row));
  }

  async getIntegrationConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<IntegrationConnection> {
    const { rows } = await this.pool.query(
      "SELECT * FROM integration_connections WHERE tenant_id=$1 AND id=$2",
      [tenantId, connectionId],
    );
    if (!rows[0]) notFound("IntegrationConnection", connectionId);
    return this.mapIntegrationConnection(rows[0]);
  }

  async setIntegrationConnectionStatus(input: {
    tenantId: string;
    connectionId: string;
    status: string;
  }): Promise<IntegrationConnection> {
    const { rows } = await this.pool.query(
      `UPDATE integration_connections
          SET status=$3, updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [input.tenantId, input.connectionId, input.status],
    );
    if (!rows[0]) notFound("IntegrationConnection", input.connectionId);
    return this.mapIntegrationConnection(rows[0]);
  }

  async createIntegrationMapping(input: {
    tenantId: string;
    connectionId: string;
    name: string;
    mappingType: IntegrationMapping["mappingType"];
    sourceSystem: string;
    targetType: string;
    fieldMap: Record<string, string>;
    config: Record<string, unknown>;
    version: number;
  }): Promise<IntegrationMapping> {
    await this.getIntegrationConnection(
      input.tenantId,
      input.connectionId,
    );
    const { rows: active } = await this.pool.query(
      `SELECT version FROM integration_mappings
        WHERE tenant_id=$1 AND connection_id=$2 AND name=$3
          AND status='ACTIVE'`,
      [input.tenantId, input.connectionId, input.name],
    );
    if (active[0]) {
      throw new ConflictError(
        `INTEGRATION_MAPPING_ALREADY_ACTIVE: ${input.name}:${active[0].version}`,
      );
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO integration_mappings
          (id, tenant_id, connection_id, name, mapping_type, source_system,
           target_type, field_map, config, version, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE')
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.connectionId,
          input.name,
          input.mappingType,
          input.sourceSystem,
          input.targetType,
          JSON.stringify(input.fieldMap),
          JSON.stringify(input.config),
          input.version,
        ],
      );
      return this.mapIntegrationMapping(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          `Integration mapping ${input.name}:${input.version} already exists`,
        );
      }
      throw error;
    }
  }

  async listIntegrationMappings(
    tenantId: string,
    connectionId: string,
    status?: IntegrationMapping["status"],
  ): Promise<IntegrationMapping[]> {
    await this.getIntegrationConnection(tenantId, connectionId);
    const params: string[] = [tenantId, connectionId];
    let sql =
      "SELECT * FROM integration_mappings WHERE tenant_id=$1 AND connection_id=$2";
    if (status) {
      params.push(status);
      sql += ` AND status=$${params.length}`;
    }
    sql += " ORDER BY name, version DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapIntegrationMapping(row));
  }

  async getIntegrationMapping(
    tenantId: string,
    mappingId: string,
  ): Promise<IntegrationMapping> {
    const { rows } = await this.pool.query(
      "SELECT * FROM integration_mappings WHERE tenant_id=$1 AND id=$2",
      [tenantId, mappingId],
    );
    if (!rows[0]) notFound("IntegrationMapping", mappingId);
    return this.mapIntegrationMapping(rows[0]);
  }

  async retireIntegrationMapping(input: {
    tenantId: string;
    mappingId: string;
  }): Promise<IntegrationMapping> {
    const { rows } = await this.pool.query(
      `UPDATE integration_mappings
          SET status='RETIRED', retired_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
        RETURNING *`,
      [input.tenantId, input.mappingId],
    );
    if (!rows[0]) {
      const mapping = await this.getIntegrationMapping(
        input.tenantId,
        input.mappingId,
      );
      throw new ConflictError(
        `integration mapping ${mapping.id} is ${mapping.status}`,
      );
    }
    return this.mapIntegrationMapping(rows[0]);
  }

  async createSyncSchedule(input: {
    tenantId: string;
    connectionId: string;
    name: string;
    intervalMinutes: number;
    startAt?: string;
  }): Promise<SyncSchedule> {
    await this.getIntegrationConnection(
      input.tenantId,
      input.connectionId,
    );
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO sync_schedules
          (id, tenant_id, connection_id, name, interval_minutes, enabled,
           next_run_at)
         VALUES ($1,$2,$3,$4,$5::int,true,
                 COALESCE($6::timestamptz,
                          now() + ($5::int * interval '1 minute')))
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.connectionId,
          input.name,
          input.intervalMinutes,
          input.startAt ?? null,
        ],
      );
      return this.mapSyncSchedule(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          `Sync schedule ${input.name} already exists for this connection`,
        );
      }
      throw error;
    }
  }

  async listSyncSchedules(
    tenantId: string,
    connectionId?: string,
  ): Promise<SyncSchedule[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM sync_schedules WHERE tenant_id=$1";
    if (connectionId) {
      params.push(connectionId);
      sql += ` AND connection_id=$${params.length}`;
    }
    sql += " ORDER BY next_run_at";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapSyncSchedule(row));
  }

  async getSyncSchedule(
    tenantId: string,
    scheduleId: string,
  ): Promise<SyncSchedule> {
    const { rows } = await this.pool.query(
      "SELECT * FROM sync_schedules WHERE tenant_id=$1 AND id=$2",
      [tenantId, scheduleId],
    );
    if (!rows[0]) notFound("SyncSchedule", scheduleId);
    return this.mapSyncSchedule(rows[0]);
  }

  async setSyncScheduleEnabled(input: {
    tenantId: string;
    scheduleId: string;
    enabled: boolean;
  }): Promise<SyncSchedule> {
    const { rows } = await this.pool.query(
      `UPDATE sync_schedules
          SET enabled=$3, updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [input.tenantId, input.scheduleId, input.enabled],
    );
    if (!rows[0]) notFound("SyncSchedule", input.scheduleId);
    return this.mapSyncSchedule(rows[0]);
  }

  async claimDueSyncSchedules(input: {
    tenantId: string;
    limit: number;
    now?: string;
  }): Promise<SyncSchedule[]> {
    return this.transaction(async (client) => {
      const now = input.now ?? new Date().toISOString();
      const { rows } = await client.query(
        `SELECT * FROM sync_schedules
          WHERE tenant_id=$1 AND enabled AND next_run_at <= $2
          ORDER BY next_run_at
          LIMIT $3
          FOR UPDATE SKIP LOCKED`,
        [input.tenantId, now, input.limit],
      );
      const claimed: SyncSchedule[] = [];
      for (const row of rows) {
        const { rows: updated } = await client.query(
          `UPDATE sync_schedules
              SET last_run_at=$3::timestamptz,
                  next_run_at=$3::timestamptz +
                    (interval_minutes * interval '1 minute'),
                  updated_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, row.id, now],
        );
        claimed.push(this.mapSyncSchedule(updated[0]));
      }
      return claimed;
    });
  }

  async createEquityGrant(input: {
    tenantId: string;
    personId: string;
    grantCode: string;
    grantType: EquityGrant["grantType"];
    totalUnits: string;
    strikePrice: string;
    currency: string;
    grantDate: string;
    vestingStart: string;
    cliffMonths: number;
    vestingMonths: number;
  }): Promise<EquityGrant> {
    if (parseDecimal(input.totalUnits) <= 0n) {
      throw new ConflictError("EQ_TOTAL_UNITS_MUST_BE_POSITIVE");
    }
    if (parseDecimal(input.strikePrice) < 0n) {
      throw new ConflictError("EQ_STRIKE_PRICE_MUST_BE_NON_NEGATIVE");
    }
    if (input.cliffMonths > input.vestingMonths) {
      throw new ConflictError("EQ_CLIFF_EXCEEDS_VESTING");
    }
    await this.assertTenant(input.tenantId);
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO equity_grants
          (id, tenant_id, person_id, grant_code, grant_type, total_units,
           strike_price, currency, grant_date, vesting_start, cliff_months,
           vesting_months, status, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ACTIVE',1)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.grantCode,
          input.grantType,
          input.totalUnits,
          input.strikePrice,
          input.currency,
          input.grantDate,
          input.vestingStart,
          input.cliffMonths,
          input.vestingMonths,
        ],
      );
      return this.mapEquityGrant(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          `equity grant ${input.grantCode} already exists`,
        );
      }
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Person ${input.personId} not found`);
      }
      throw error;
    }
  }

  async listEquityGrants(
    tenantId: string,
    personId?: string,
  ): Promise<EquityGrant[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM equity_grants WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY grant_date DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapEquityGrant(row));
  }

  async getEquityGrant(
    tenantId: string,
    grantId: string,
  ): Promise<EquityGrant> {
    const { rows } = await this.pool.query(
      "SELECT * FROM equity_grants WHERE tenant_id=$1 AND id=$2",
      [tenantId, grantId],
    );
    if (!rows[0]) notFound("EquityGrant", grantId);
    return this.mapEquityGrant(rows[0]);
  }

  async getEquityVesting(
    tenantId: string,
    grantId: string,
    asOf = new Date().toISOString(),
  ): Promise<EquityVesting> {
    const grant = await this.getEquityGrant(tenantId, grantId);
    const { rows } = await this.pool.query(
      "SELECT * FROM equity_exercises WHERE tenant_id=$1 AND grant_id=$2",
      [tenantId, grantId],
    );
    return computeEquityVesting(
      grant,
      rows.map((row) => this.mapEquityExercise(row)),
      asOf,
    );
  }

  async createEquityExercise(input: {
    tenantId: string;
    grantId: string;
    units: string;
    requestedBy: string;
  }): Promise<EquityExercise> {
    return this.transaction(async (client) => {
      const { rows: grantRows } = await client.query(
        `SELECT * FROM equity_grants
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.grantId],
      );
      if (!grantRows[0]) notFound("EquityGrant", input.grantId);
      const grant = this.mapEquityGrant(grantRows[0]);
      if (grant.status !== "ACTIVE") {
        throw new ConflictError(`equity grant is ${grant.status}`);
      }
      const { rows: personRows } = await client.query(
        "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.requestedBy],
      );
      if (!personRows[0]) {
        notFound("Person", input.requestedBy);
      }
      const { rows: exerciseRows } = await client.query(
        "SELECT * FROM equity_exercises WHERE tenant_id=$1 AND grant_id=$2",
        [input.tenantId, input.grantId],
      );
      const exercises = exerciseRows.map((row) =>
        this.mapEquityExercise(row),
      );
      const units = parseDecimal(input.units);
      if (units <= 0n) {
        throw new ConflictError("EQ_UNITS_MUST_BE_POSITIVE");
      }
      const vesting = computeEquityVesting(grant, exercises, now());
      if (units > parseDecimal(vesting.availableUnits)) {
        throw new ConflictError(
          `EQ_UNITS_EXCEED_AVAILABLE: ${vesting.availableUnits}`,
        );
      }
      const totalCost =
        (units * parseDecimal(grant.strikePrice)) / 1_000_000n;
      const { rows } = await client.query(
        `INSERT INTO equity_exercises
          (id, tenant_id, grant_id, person_id, units, strike_price,
           total_cost, currency, status, requested_by, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,1)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          grant.id,
          grant.personId,
          formatDecimal(units),
          grant.strikePrice,
          formatDecimal(totalCost),
          grant.currency,
          input.requestedBy,
        ],
      );
      return this.mapEquityExercise(rows[0]);
    });
  }

  async listEquityExercises(
    tenantId: string,
    grantId?: string,
  ): Promise<EquityExercise[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM equity_exercises WHERE tenant_id=$1";
    if (grantId) {
      params.push(grantId);
      sql += " AND grant_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapEquityExercise(row));
  }

  async approveEquityExercise(input: {
    tenantId: string;
    exerciseId: string;
    approvedBy: string;
  }): Promise<EquityExercise> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM equity_exercises
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.exerciseId],
      );
      if (!rows[0]) notFound("EquityExercise", input.exerciseId);
      const exercise = this.mapEquityExercise(rows[0]);
      if (exercise.status !== "PENDING") {
        throw new ConflictError(
          `equity exercise is ${exercise.status}`,
        );
      }
      if (exercise.requestedBy === input.approvedBy) {
        throw new ConflictError(
          "EQ_SELF_APPROVAL: the requester cannot approve the exercise",
        );
      }
      const { rows: personRows } = await client.query(
        "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.approvedBy],
      );
      if (!personRows[0]) {
        notFound("Person", input.approvedBy);
      }
      const { rows: updated } = await client.query(
        `UPDATE equity_exercises
            SET status='APPROVED', approved_by=$3, approved_at=now(),
                updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.exerciseId, input.approvedBy],
      );
      return this.mapEquityExercise(updated[0]);
    });
  }

  async settleEquityExercise(input: {
    tenantId: string;
    exerciseId: string;
  }): Promise<EquityExercise> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM equity_exercises
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.exerciseId],
      );
      if (!rows[0]) notFound("EquityExercise", input.exerciseId);
      const exercise = this.mapEquityExercise(rows[0]);
      if (exercise.status !== "APPROVED") {
        throw new ConflictError(
          `equity exercise is ${exercise.status}`,
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE equity_exercises
            SET status='SETTLED', settled_at=now(), updated_at=now(),
                version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.exerciseId],
      );
      const { rows: grants } = await client.query(
        `SELECT * FROM equity_grants
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, exercise.grantId],
      );
      const grant = this.mapEquityGrant(grants[0]);
      const { rows: exerciseRows } = await client.query(
        "SELECT units FROM equity_exercises WHERE tenant_id=$1 AND grant_id=$2 AND status<>'CANCELLED'",
        [input.tenantId, exercise.grantId],
      );
      const settled = exerciseRows.reduce(
        (sum, row) => sum + parseDecimal(row.units),
        0n,
      );
      if (settled >= parseDecimal(grant.totalUnits)) {
        await client.query(
          `UPDATE equity_grants
              SET status='EXHAUSTED', updated_at=now(), version=version+1
            WHERE tenant_id=$1 AND id=$2`,
          [input.tenantId, exercise.grantId],
        );
      }
      return this.mapEquityExercise(updated[0]);
    });
  }

  async createBounty(input: {
    tenantId: string;
    title: string;
    description: string;
    rewardAmount: string;
    currency: string;
    createdBy: string;
    dueAt?: string;
  }): Promise<Bounty> {
    if (parseDecimal(input.rewardAmount) <= 0n) {
      throw new ConflictError("BOUNTY_REWARD_MUST_BE_POSITIVE");
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO bounties
          (id, tenant_id, title, description, reward_amount, currency,
           status, created_by, due_at, version)
         VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,1)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.title,
          input.description,
          input.rewardAmount,
          input.currency,
          input.createdBy,
          input.dueAt ?? null,
        ],
      );
      return this.mapBounty(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Person ${input.createdBy} not found`);
      }
      throw error;
    }
  }

  async listBounties(
    tenantId: string,
    status?: Bounty["status"],
  ): Promise<Bounty[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM bounties WHERE tenant_id=$1";
    if (status) {
      params.push(status);
      sql += " AND status=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapBounty(row));
  }

  async getBounty(tenantId: string, bountyId: string): Promise<Bounty> {
    const { rows } = await this.pool.query(
      "SELECT * FROM bounties WHERE tenant_id=$1 AND id=$2",
      [tenantId, bountyId],
    );
    if (!rows[0]) notFound("Bounty", bountyId);
    return this.mapBounty(rows[0]);
  }

  async claimBounty(input: {
    tenantId: string;
    bountyId: string;
    personId: string;
  }): Promise<Bounty> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM bounties
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.bountyId],
      );
      if (!rows[0]) notFound("Bounty", input.bountyId);
      const bounty = this.mapBounty(rows[0]);
      if (bounty.status !== "OPEN") {
        throw new ConflictError(`bounty is ${bounty.status}`);
      }
      const { rows: personRows } = await client.query(
        "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.personId],
      );
      if (!personRows[0]) notFound("Person", input.personId);
      const { rows: updated } = await client.query(
        `UPDATE bounties
            SET status='CLAIMED', assignee_person_id=$3, claimed_at=now(),
                updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.bountyId, input.personId],
      );
      return this.mapBounty(updated[0]);
    });
  }

  async submitBounty(input: {
    tenantId: string;
    bountyId: string;
    personId: string;
    submissionRef: string;
  }): Promise<Bounty> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM bounties
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.bountyId],
      );
      if (!rows[0]) notFound("Bounty", input.bountyId);
      const bounty = this.mapBounty(rows[0]);
      if (bounty.status !== "CLAIMED") {
        throw new ConflictError(`bounty is ${bounty.status}`);
      }
      if (bounty.assigneePersonId !== input.personId) {
        throw new ConflictError("BOUNTY_ONLY_ASSIGNEE_CAN_SUBMIT");
      }
      const { rows: updated } = await client.query(
        `UPDATE bounties
            SET status='SUBMITTED', submission_ref=$3, submitted_at=now(),
                updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.bountyId, input.submissionRef],
      );
      return this.mapBounty(updated[0]);
    });
  }

  async acceptBounty(input: {
    tenantId: string;
    bountyId: string;
    reviewerPersonId: string;
    paymentRef?: string;
  }): Promise<Bounty> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM bounties
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.bountyId],
      );
      if (!rows[0]) notFound("Bounty", input.bountyId);
      const bounty = this.mapBounty(rows[0]);
      if (bounty.status !== "SUBMITTED") {
        throw new ConflictError(`bounty is ${bounty.status}`);
      }
      if (bounty.assigneePersonId === input.reviewerPersonId) {
        throw new ConflictError(
          "BOUNTY_SELF_ACCEPTANCE: the assignee cannot accept the bounty",
        );
      }
      const { rows: personRows } = await client.query(
        "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.reviewerPersonId],
      );
      if (!personRows[0]) notFound("Person", input.reviewerPersonId);
      const { rows: updated } = await client.query(
        `UPDATE bounties
            SET status='ACCEPTED', accepted_by=$3, accepted_at=now(),
                payment_ref=$4, updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.bountyId,
          input.reviewerPersonId,
          input.paymentRef ?? null,
        ],
      );
      return this.mapBounty(updated[0]);
    });
  }

  async cancelBounty(input: {
    tenantId: string;
    bountyId: string;
  }): Promise<Bounty> {
    const { rows } = await this.pool.query(
      `UPDATE bounties
          SET status='CANCELLED', cancelled_at=now(), updated_at=now(),
              version=version+1
        WHERE tenant_id=$1 AND id=$2
          AND status NOT IN ('ACCEPTED','CANCELLED')
        RETURNING *`,
      [input.tenantId, input.bountyId],
    );
    if (!rows[0]) {
      const bounty = await this.getBounty(input.tenantId, input.bountyId);
      throw new ConflictError(`bounty is ${bounty.status}`);
    }
    return this.mapBounty(rows[0]);
  }

  async createEmploymentContract(input: {
    tenantId: string;
    personId: string;
    contractCode: string;
    employmentType: EmploymentContract["employmentType"];
    startDate: string;
    endDate?: string;
    workLocation: string;
    legalEntity?: string;
    currency: string;
    fixedMonthlySalary: string;
    minimumMonthlyWage: string;
    taxRate: string;
    socialInsuranceRate: string;
    deductionCapRate: string;
    variableShareCapRate: string;
    deductionOrder: string[];
    deductionTypeCaps: Record<string, string>;
    smoothingThresholdRate: string;
    smoothingMode?: "NONE" | "BLOCK" | "MOVING_AVERAGE" | "RAMP";
    smoothingWindowPeriods?: number;
    smoothingMaxStepRate?: string;
    compensationTemplateCode?: string;
    bankAccountRef?: string;
    consentSignatureRef: string;
    consentSignedAt?: string;
  }): Promise<EmploymentContract> {
    if (parseDecimal(input.fixedMonthlySalary) < 0n) {
      throw new ConflictError("CONTRACT_FIXED_SALARY_NEGATIVE");
    }
    if (parseDecimal(input.minimumMonthlyWage) < 0n) {
      throw new ConflictError("CONTRACT_MINIMUM_WAGE_NEGATIVE");
    }
    if (
      parseDecimal(input.taxRate) < 0n ||
      parseDecimal(input.taxRate) > 1_000_000n
    ) {
      throw new ConflictError("CONTRACT_TAX_RATE_OUT_OF_RANGE");
    }
    if (
      parseDecimal(input.socialInsuranceRate) < 0n ||
      parseDecimal(input.socialInsuranceRate) > 1_000_000n
    ) {
      throw new ConflictError(
        "CONTRACT_SOCIAL_INSURANCE_RATE_OUT_OF_RANGE",
      );
    }
    if (
      parseDecimal(input.deductionCapRate) < 0n ||
      parseDecimal(input.deductionCapRate) > 1_000_000n
    ) {
      throw new ConflictError("CONTRACT_DEDUCTION_CAP_OUT_OF_RANGE");
    }
    if (
      parseDecimal(input.variableShareCapRate) < 0n ||
      parseDecimal(input.variableShareCapRate) > 1_000_000n
    ) {
      throw new ConflictError("CONTRACT_VARIABLE_SHARE_CAP_OUT_OF_RANGE");
    }
    if (
      input.endDate &&
      Date.parse(input.endDate) <= Date.parse(input.startDate)
    ) {
      throw new ConflictError("CONTRACT_END_BEFORE_START");
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO employment_contracts
          (id, tenant_id, person_id, contract_code, employment_type,
           start_date, end_date, work_location, legal_entity, currency,
           fixed_monthly_salary, minimum_monthly_wage, tax_rate,
           social_insurance_rate, deduction_cap_rate, variable_share_cap_rate,
           deduction_order, deduction_type_caps, smoothing_threshold_rate,
           smoothing_mode, smoothing_window_periods, smoothing_max_step_rate,
           compensation_template_code, bank_account_ref, pay_plan_version,
           consent_signature_ref, consent_signed_at, status, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23,$24,1,$25,$26,'ACTIVE',1)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.contractCode,
          input.employmentType,
          input.startDate,
          input.endDate ?? null,
          input.workLocation,
          input.legalEntity ?? null,
          input.currency,
          input.fixedMonthlySalary,
          input.minimumMonthlyWage,
          input.taxRate,
          input.socialInsuranceRate,
          input.deductionCapRate,
          input.variableShareCapRate,
          JSON.stringify(
            input.deductionOrder.length > 0
              ? input.deductionOrder
              : ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
          ),
          JSON.stringify(input.deductionTypeCaps),
          input.smoothingThresholdRate,
          input.smoothingMode ?? "BLOCK",
          input.smoothingWindowPeriods ?? 3,
          input.smoothingMaxStepRate ?? "0.5",
          input.compensationTemplateCode ?? null,
          input.bankAccountRef ?? null,
          input.consentSignatureRef,
          input.consentSignedAt ?? new Date().toISOString(),
        ],
      );
      return this.mapEmploymentContract(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          `employment contract ${input.contractCode} already exists`,
        );
      }
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Person ${input.personId} not found`);
      }
      throw error;
    }
  }

  async amendEmploymentContract(input: {
    tenantId: string;
    contractId: string;
    fixedMonthlySalary: string;
    minimumMonthlyWage: string;
    taxRate: string;
    socialInsuranceRate: string;
    deductionCapRate: string;
    variableShareCapRate: string;
    deductionOrder: string[];
    deductionTypeCaps: Record<string, string>;
    smoothingThresholdRate: string;
    smoothingMode?: "NONE" | "BLOCK" | "MOVING_AVERAGE" | "RAMP";
    smoothingWindowPeriods?: number;
    smoothingMaxStepRate?: string;
    compensationTemplateCode?: string;
    bankAccountRef?: string;
    effectiveFrom: string;
    consentSignatureRef: string;
    approvedBy: string;
  }): Promise<EmploymentContract> {
    const effectiveMs = Date.parse(input.effectiveFrom);
    const future = effectiveMs > Date.now();
    if (future && effectiveMs > Date.now() + 180 * 24 * 60 * 60 * 1000) {
      throw new ConflictError(
        "CONTRACT_AMENDMENT_TOO_FAR_IN_FUTURE: maximum 180 days",
      );
    }
    if (!input.consentSignatureRef.trim()) {
      throw new ConflictError("CONTRACT_CONSENT_SIGNATURE_REQUIRED");
    }
    if (parseDecimal(input.fixedMonthlySalary) < 0n) {
      throw new ConflictError("CONTRACT_FIXED_SALARY_NEGATIVE");
    }
    if (parseDecimal(input.minimumMonthlyWage) < 0n) {
      throw new ConflictError("CONTRACT_MINIMUM_WAGE_NEGATIVE");
    }
    for (const [field, value] of [
      ["taxRate", input.taxRate],
      ["socialInsuranceRate", input.socialInsuranceRate],
      ["deductionCapRate", input.deductionCapRate],
      ["variableShareCapRate", input.variableShareCapRate],
    ] as const) {
      const parsed = parseDecimal(value);
      if (parsed < 0n || parsed > 1_000_000n) {
        throw new ConflictError(`CONTRACT_${field}_OUT_OF_RANGE`);
      }
    }
    if (future) {
      const { rows } = await this.pool.query(
        `SELECT * FROM employment_contracts
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, input.contractId],
      );
      if (!rows[0]) notFound("EmploymentContract", input.contractId);
      const row = rows[0];
      if (row.status !== "ACTIVE") {
        throw new ConflictError(`employment contract is ${row.status}`);
      }
      const versionResult = await this.pool.query(
        `SELECT GREATEST(
           $3::int,
           COALESCE(MAX(pay_plan_version), 0)
         ) + 1 AS version
         FROM employment_contract_amendments
         WHERE tenant_id=$1 AND contract_id=$2
           AND status <> 'CANCELLED'`,
        [input.tenantId, input.contractId, Number(row.pay_plan_version ?? 1)],
      );
      const payPlanVersion = Number(versionResult.rows[0]?.version ?? 1);
      const beforeTerms = {
        fixedMonthlySalary: decimalText(String(row.fixed_monthly_salary)),
        minimumMonthlyWage: decimalText(String(row.minimum_monthly_wage)),
        taxRate: decimalText(String(row.tax_rate)),
        socialInsuranceRate: decimalText(String(row.social_insurance_rate)),
        deductionCapRate: decimalText(String(row.deduction_cap_rate)),
        variableShareCapRate: decimalText(
          String(row.variable_share_cap_rate),
        ),
        deductionOrder: (row.deduction_order as string[] | null) ?? [],
        bankAccountRef: row.bank_account_ref ?? undefined,
        payPlanVersion: Number(row.pay_plan_version ?? 1),
      };
      const afterTerms = {
        fixedMonthlySalary: input.fixedMonthlySalary,
        minimumMonthlyWage: input.minimumMonthlyWage,
        taxRate: input.taxRate,
        socialInsuranceRate: input.socialInsuranceRate,
        deductionCapRate: input.deductionCapRate,
        variableShareCapRate: input.variableShareCapRate,
        deductionOrder:
          input.deductionOrder.length > 0
            ? input.deductionOrder
            : ((row.deduction_order as string[] | null) ?? []),
        bankAccountRef: input.bankAccountRef,
        payPlanVersion,
      };
      await this.pool.query(
        `INSERT INTO employment_contract_amendments
          (tenant_id, contract_id, pay_plan_version, before_terms,
           after_terms, effective_from, consent_signature_ref, approved_by,
           status)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,'SCHEDULED')`,
        [
          input.tenantId,
          input.contractId,
          payPlanVersion,
          JSON.stringify(beforeTerms),
          JSON.stringify(afterTerms),
          input.effectiveFrom,
          input.consentSignatureRef,
          input.approvedBy,
        ],
      );
      return this.mapEmploymentContract(row);
    }
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM employment_contracts
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.contractId],
      );
      if (!rows[0]) notFound("EmploymentContract", input.contractId);
      const row = rows[0];
      if (row.status !== "ACTIVE") {
        throw new ConflictError(`employment contract is ${row.status}`);
      }
      const beforeTerms = {
        fixedMonthlySalary: decimalText(String(row.fixed_monthly_salary)),
        minimumMonthlyWage: decimalText(String(row.minimum_monthly_wage)),
        taxRate: decimalText(String(row.tax_rate)),
        socialInsuranceRate: decimalText(String(row.social_insurance_rate)),
        deductionCapRate: decimalText(String(row.deduction_cap_rate)),
        variableShareCapRate: decimalText(
          String(row.variable_share_cap_rate),
        ),
        deductionOrder:
          (row.deduction_order as string[] | null) ?? [],
        deductionTypeCaps:
          (row.deduction_type_caps as Record<string, string> | null) ?? {},
        smoothingThresholdRate: decimalText(
          String(row.smoothing_threshold_rate),
        ),
        smoothingMode: (row.smoothing_mode as string | null) ?? "BLOCK",
        smoothingWindowPeriods: Number(row.smoothing_window_periods ?? 3),
        smoothingMaxStepRate: decimalText(
          String(row.smoothing_max_step_rate ?? "0.5"),
        ),
        compensationTemplateCode: row.compensation_template_code ?? undefined,
        bankAccountRef: row.bank_account_ref ?? undefined,
        payPlanVersion: Number(row.pay_plan_version ?? 1),
      };
      const versionResult = await client.query(
        `SELECT GREATEST(
           $3::int,
           COALESCE(MAX(pay_plan_version), 0)
         ) + 1 AS version
         FROM employment_contract_amendments
         WHERE tenant_id=$1 AND contract_id=$2
           AND status <> 'CANCELLED'`,
        [input.tenantId, input.contractId, Number(row.pay_plan_version ?? 1)],
      );
      const payPlanVersion = Number(versionResult.rows[0]?.version ?? 1);
      const { rows: updated } = await client.query(
        `UPDATE employment_contracts
            SET fixed_monthly_salary=$3, minimum_monthly_wage=$4,
                tax_rate=$5, social_insurance_rate=$6, deduction_cap_rate=$7,
                variable_share_cap_rate=$8, deduction_order=$9::jsonb,
                deduction_type_caps=$10::jsonb,
                smoothing_threshold_rate=$11,
                smoothing_mode=$17, smoothing_window_periods=$18,
                smoothing_max_step_rate=$19,
                compensation_template_code=$12, bank_account_ref=$13,
                pay_plan_version=$14, consent_signature_ref=$15,
                consent_signed_at=$16, version=version+1, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.contractId,
          input.fixedMonthlySalary,
          input.minimumMonthlyWage,
          input.taxRate,
          input.socialInsuranceRate,
          input.deductionCapRate,
          input.variableShareCapRate,
          JSON.stringify(
            input.deductionOrder.length > 0
              ? input.deductionOrder
              : ((row.deduction_order as string[] | null) ?? []),
          ),
          JSON.stringify(
            Object.keys(input.deductionTypeCaps).length > 0
              ? input.deductionTypeCaps
              : ((row.deduction_type_caps as Record<string, string> | null) ??
                {}),
          ),
          input.smoothingThresholdRate,
          input.compensationTemplateCode ??
            (row.compensation_template_code as string | null),
          input.bankAccountRef ?? null,
          payPlanVersion,
          input.consentSignatureRef,
          input.effectiveFrom,
          input.smoothingMode ??
            ((row.smoothing_mode as string | null) ?? "BLOCK"),
          input.smoothingWindowPeriods ??
            Number(row.smoothing_window_periods ?? 3),
          input.smoothingMaxStepRate ??
            String(row.smoothing_max_step_rate ?? "0.5"),
        ],
      );
      const afterTerms = {
        fixedMonthlySalary: decimalText(
          String(updated[0]?.fixed_monthly_salary),
        ),
        minimumMonthlyWage: decimalText(
          String(updated[0]?.minimum_monthly_wage),
        ),
        taxRate: decimalText(String(updated[0]?.tax_rate)),
        socialInsuranceRate: decimalText(
          String(updated[0]?.social_insurance_rate),
        ),
        deductionCapRate: decimalText(
          String(updated[0]?.deduction_cap_rate),
        ),
        variableShareCapRate: decimalText(
          String(updated[0]?.variable_share_cap_rate),
        ),
        deductionOrder:
          (updated[0]?.deduction_order as string[] | null) ?? [],
        deductionTypeCaps:
          (updated[0]?.deduction_type_caps as Record<string, string> | null) ??
          {},
        smoothingThresholdRate: decimalText(
          String(updated[0]?.smoothing_threshold_rate),
        ),
        smoothingMode: (updated[0]?.smoothing_mode as string | null) ?? "BLOCK",
        smoothingWindowPeriods: Number(updated[0]?.smoothing_window_periods ?? 3),
        smoothingMaxStepRate: decimalText(
          String(updated[0]?.smoothing_max_step_rate ?? "0.5"),
        ),
        compensationTemplateCode:
          updated[0]?.compensation_template_code ?? undefined,
        bankAccountRef: updated[0]?.bank_account_ref ?? undefined,
        payPlanVersion,
      };
      await client.query(
        `INSERT INTO employment_contract_amendments
          (tenant_id, contract_id, pay_plan_version, before_terms,
           after_terms, effective_from, consent_signature_ref, approved_by,
           status, applied_at)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,'APPLIED',now())`,
        [
          input.tenantId,
          input.contractId,
          payPlanVersion,
          JSON.stringify(beforeTerms),
          JSON.stringify(afterTerms),
          input.effectiveFrom,
          input.consentSignatureRef,
          input.approvedBy,
        ],
      );
      return this.mapEmploymentContract(updated[0]);
    });
  }

  async listEmploymentContractAmendments(
    tenantId: string,
    contractId: string,
  ): Promise<EmploymentContractAmendment[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM employment_contract_amendments
        WHERE tenant_id=$1 AND contract_id=$2
        ORDER BY created_at DESC`,
      [tenantId, contractId],
    );
    return rows.map((row) => this.mapEmploymentContractAmendment(row));
  }

  async applyDueContractAmendments(
    tenantId: string,
  ): Promise<EmploymentContractAmendment[]> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM employment_contract_amendments
          WHERE tenant_id=$1 AND status='SCHEDULED'
            AND effective_from <= now()
          ORDER BY effective_from
          FOR UPDATE`,
        [tenantId],
      );
      const applied: EmploymentContractAmendment[] = [];
      for (const row of rows) {
        const terms = row.after_terms as Record<string, unknown>;
        await client.query(
          `UPDATE employment_contracts
              SET fixed_monthly_salary=$3,
                  minimum_monthly_wage=$4,
                  tax_rate=$5,
                  social_insurance_rate=$6,
                  deduction_cap_rate=$7,
                  variable_share_cap_rate=$8,
                  deduction_order=$9::jsonb,
                  bank_account_ref=$10,
                  pay_plan_version=$11,
                  consent_signature_ref=$12,
                  consent_signed_at=$13,
                  smoothing_mode=$14,
                  smoothing_window_periods=$15,
                  smoothing_max_step_rate=$16,
                  version=version+1,
                  updated_at=now()
            WHERE tenant_id=$1 AND id=$2`,
          [
            tenantId,
            row.contract_id,
            String(terms.fixedMonthlySalary ?? "0"),
            String(terms.minimumMonthlyWage ?? "0"),
            String(terms.taxRate ?? "0"),
            String(terms.socialInsuranceRate ?? "0"),
            String(terms.deductionCapRate ?? "0"),
            String(terms.variableShareCapRate ?? "1"),
            JSON.stringify(terms.deductionOrder ?? []),
            typeof terms.bankAccountRef === "string"
              ? terms.bankAccountRef
              : null,
            Number(row.pay_plan_version),
            row.consent_signature_ref,
            row.effective_from,
            String(terms.smoothingMode ?? row.smoothing_mode ?? "BLOCK"),
            Number(terms.smoothingWindowPeriods ?? row.smoothing_window_periods ?? 3),
            String(terms.smoothingMaxStepRate ?? row.smoothing_max_step_rate ?? "0.5"),
          ],
        );
        const { rows: updated } = await client.query(
          `UPDATE employment_contract_amendments
              SET status='APPLIED', applied_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [tenantId, row.id],
        );
        applied.push(this.mapEmploymentContractAmendment(updated[0]));
      }
      return applied;
    });
  }

  async cancelContractAmendment(input: {
    tenantId: string;
    contractId: string;
    amendmentId: string;
    reason: string;
  }): Promise<EmploymentContractAmendment> {
    const { rows } = await this.pool.query(
      `UPDATE employment_contract_amendments
          SET status='CANCELLED', cancelled_at=now(), cancel_reason=$4
        WHERE tenant_id=$1 AND contract_id=$2 AND id=$3
          AND status='SCHEDULED'
        RETURNING *`,
      [
        input.tenantId,
        input.contractId,
        input.amendmentId,
        input.reason,
      ],
    );
    if (!rows[0]) {
      const current = await this.pool.query(
        `SELECT status FROM employment_contract_amendments
          WHERE tenant_id=$1 AND contract_id=$2 AND id=$3`,
        [input.tenantId, input.contractId, input.amendmentId],
      );
      if (!current.rows[0]) {
        notFound("EmploymentContractAmendment", input.amendmentId);
      }
      throw new ConflictError(
        `contract amendment is ${current.rows[0].status}`,
      );
    }
    return this.mapEmploymentContractAmendment(rows[0]);
  }

  async createAdverseAction(input: {
    tenantId: string;
    personId: string;
    actionType: AdverseActionCase["actionType"];
    reason: string;
    performanceBasis: string;
    evidenceRefs: string[];
    requestedBy: string;
  }): Promise<AdverseActionCase> {
    const { rows } = await this.pool.query(
      `INSERT INTO adverse_action_cases
        (tenant_id, person_id, action_type, status, reason, performance_basis,
         evidence_refs, requested_by)
       VALUES ($1,$2,$3,'DRAFT',$4,$5,$6::jsonb,$7)
       RETURNING *`,
      [
        input.tenantId,
        input.personId,
        input.actionType,
        input.reason,
        input.performanceBasis,
        JSON.stringify(input.evidenceRefs),
        input.requestedBy,
      ],
    );
    return this.mapAdverseAction(rows[0]);
  }

  async listAdverseActions(
    tenantId: string,
    personId?: string,
  ): Promise<AdverseActionCase[]> {
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM adverse_action_cases WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapAdverseAction(row));
  }

  async getAdverseAction(
    tenantId: string,
    actionId: string,
  ): Promise<AdverseActionCase> {
    const { rows } = await this.pool.query(
      "SELECT * FROM adverse_action_cases WHERE tenant_id=$1 AND id=$2",
      [tenantId, actionId],
    );
    if (!rows[0]) notFound("AdverseActionCase", actionId);
    return this.mapAdverseAction(rows[0]);
  }

  async reviewAdverseAction(input: {
    tenantId: string;
    actionId: string;
    legalReviewerId: string;
    legalReviewRef: string;
    decision: "APPROVE" | "REJECT";
    note?: string;
  }): Promise<AdverseActionCase> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM adverse_action_cases
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [input.tenantId, input.actionId],
      );
      if (!rows[0]) notFound("AdverseActionCase", input.actionId);
      const action = this.mapAdverseAction(rows[0]);
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        action.status,
        "LEGAL_REVIEW",
      );
      if (action.requestedBy === input.legalReviewerId) {
        throw new ConflictError(
          "ADVERSE_ACTION_SELF_REVIEW: the requester cannot perform legal review",
        );
      }
      const nextStatus =
        input.decision === "REJECT" ? "REJECTED" : "LEGAL_REVIEW";
      if (input.decision === "REJECT") {
        assertTransition(
          adverseActionTransitions,
          "AdverseActionCase",
          "LEGAL_REVIEW",
          "REJECTED",
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE adverse_action_cases
            SET status=$3, legal_reviewer_id=$4, legal_review_ref=$5,
                legal_reviewed_at=now(), updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.actionId,
          nextStatus,
          input.legalReviewerId,
          input.legalReviewRef,
        ],
      );
      return this.mapAdverseAction(updated[0]);
    });
  }

  async approveAdverseAction(input: {
    tenantId: string;
    actionId: string;
    approvedBy: string;
  }): Promise<AdverseActionCase> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM adverse_action_cases
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [input.tenantId, input.actionId],
      );
      if (!rows[0]) notFound("AdverseActionCase", input.actionId);
      const action = this.mapAdverseAction(rows[0]);
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        action.status,
        "APPROVED",
      );
      if (
        action.requestedBy === input.approvedBy ||
        action.legalReviewerId === input.approvedBy
      ) {
        throw new ConflictError(
          "ADVERSE_ACTION_SEPARATION_REQUIRED: requester and legal reviewer cannot approve",
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE adverse_action_cases
            SET status='APPROVED', approved_by=$3, approved_at=now(),
                updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.actionId, input.approvedBy],
      );
      return this.mapAdverseAction(updated[0]);
    });
  }

  async activateAdverseAction(input: {
    tenantId: string;
    actionId: string;
    effectiveFrom: string;
  }): Promise<AdverseActionCase> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM adverse_action_cases
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [input.tenantId, input.actionId],
      );
      if (!rows[0]) notFound("AdverseActionCase", input.actionId);
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        this.mapAdverseAction(rows[0]).status,
        "ACTIVE",
      );
      const { rows: updated } = await client.query(
        `UPDATE adverse_action_cases
            SET status='ACTIVE', effective_from=$3, updated_at=now(),
                version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.actionId, input.effectiveFrom],
      );
      return this.mapAdverseAction(updated[0]);
    });
  }

  async completeAdverseAction(input: {
    tenantId: string;
    actionId: string;
  }): Promise<AdverseActionCase> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM adverse_action_cases
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [input.tenantId, input.actionId],
      );
      if (!rows[0]) notFound("AdverseActionCase", input.actionId);
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        this.mapAdverseAction(rows[0]).status,
        "COMPLETED",
      );
      const { rows: updated } = await client.query(
        `UPDATE adverse_action_cases
            SET status='COMPLETED', completed_at=now(), updated_at=now(),
                version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.actionId],
      );
      return this.mapAdverseAction(updated[0]);
    });
  }

  async cancelAdverseAction(input: {
    tenantId: string;
    actionId: string;
    reason: string;
  }): Promise<AdverseActionCase> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM adverse_action_cases
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [input.tenantId, input.actionId],
      );
      if (!rows[0]) notFound("AdverseActionCase", input.actionId);
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        this.mapAdverseAction(rows[0]).status,
        "CANCELLED",
      );
      const { rows: updated } = await client.query(
        `UPDATE adverse_action_cases
            SET status='CANCELLED', cancelled_at=now(), cancel_reason=$3,
                updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.actionId, input.reason],
      );
      return this.mapAdverseAction(updated[0]);
    });
  }

  async listEmploymentContracts(
    tenantId: string,
    personId?: string,
  ): Promise<EmploymentContract[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM employment_contracts WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY start_date DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapEmploymentContract(row));
  }

  async getEmploymentContract(
    tenantId: string,
    contractId: string,
  ): Promise<EmploymentContract> {
    const { rows } = await this.pool.query(
      "SELECT * FROM employment_contracts WHERE tenant_id=$1 AND id=$2",
      [tenantId, contractId],
    );
    if (!rows[0]) notFound("EmploymentContract", contractId);
    return this.mapEmploymentContract(rows[0]);
  }

  async createPayrollRun(input: {
    tenantId: string;
    cycleId: string;
    periodStart: string;
    periodEnd: string;
    currency: string;
    preparedBy: string;
  }): Promise<PayrollRun> {
    if (Date.parse(input.periodEnd) <= Date.parse(input.periodStart)) {
      throw new ConflictError("PAYROLL_PERIOD_INVALID");
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO payroll_runs
          (id, tenant_id, cycle_id, period_start, period_end, currency,
           status, prepared_by)
         VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.cycleId,
          input.periodStart,
          input.periodEnd,
          input.currency,
          input.preparedBy,
        ],
      );
      return this.mapPayrollRun(rows[0], []);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Person ${input.preparedBy} not found`);
      }
      throw error;
    }
  }

  async listPayrollRuns(
    tenantId: string,
    cycleId?: string,
  ): Promise<PayrollRun[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM payroll_runs WHERE tenant_id=$1";
    if (cycleId) {
      params.push(cycleId);
      sql += " AND cycle_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    const runs: PayrollRun[] = [];
    for (const row of rows) {
      const { rows: lines } = await this.pool.query(
        "SELECT * FROM payroll_lines WHERE tenant_id=$1 AND run_id=$2 ORDER BY person_id",
        [tenantId, row.id],
      );
      runs.push(
        this.mapPayrollRun(
          row,
          lines.map((line) => this.mapPayrollLine(line)),
        ),
      );
    }
    return runs;
  }

  async getPayrollRun(
    tenantId: string,
    runId: string,
  ): Promise<PayrollRun> {
    const { rows } = await this.pool.query(
      "SELECT * FROM payroll_runs WHERE tenant_id=$1 AND id=$2",
      [tenantId, runId],
    );
    if (!rows[0]) notFound("PayrollRun", runId);
    const { rows: lines } = await this.pool.query(
      "SELECT * FROM payroll_lines WHERE tenant_id=$1 AND run_id=$2 ORDER BY person_id",
      [tenantId, runId],
    );
    return this.mapPayrollRun(
      rows[0],
      lines.map((line) => this.mapPayrollLine(line)),
    );
  }

  async savePayrollCalculation(input: {
    tenantId: string;
    runId: string;
    lines: Array<Omit<PayrollLine, "id" | "tenantId" | "runId" | "createdAt">>;
    totalGross: string;
    totalDeductions: string;
    totalTax: string;
    totalSocialInsurance: string;
    totalNet: string;
    blockedCount: number;
  }): Promise<PayrollRun> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM payroll_runs
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.runId],
      );
      if (!rows[0]) notFound("PayrollRun", input.runId);
      if (!["DRAFT", "CALCULATED", "BLOCKED"].includes(rows[0].status)) {
        throw new ConflictError(`payroll run is ${rows[0].status}`);
      }
      await client.query(
        "DELETE FROM payroll_lines WHERE tenant_id=$1 AND run_id=$2",
        [input.tenantId, input.runId],
      );
      for (const line of input.lines) {
        await client.query(
          `INSERT INTO payroll_lines
            (id, tenant_id, run_id, person_id, contract_id, currency,
             fixed_amount, incentive_amount, gross_amount, deduction_amount,
             tax_amount, social_insurance_amount, net_amount,
             minimum_monthly_wage, minimum_wage_passed, deduction_cap_rate,
             deduction_cap_amount, deduction_cap_passed, variable_share_rate,
             variable_share_cap_rate, variable_share_cap_amount,
             variable_share_passed, deduction_breakdown,
             deduction_type_cap_passed, deduction_type_cap_breaches,
             prior_incentive_amount, incentive_change_rate,
             smoothing_threshold_rate, smoothing_passed, bank_account_ref,
             notice_acknowledgement_passed, notice_acknowledgement_missing,
             tax_calculation_mode, ytd_taxable_income, ytd_tax_withheld,
             iit_rate_percent, iit_quick_deduction,
             raw_incentive_amount, smoothed_incentive_amount,
             smoothing_delta, smoothing_mode,
             deduction_legal_basis_passed, deduction_legal_basis_missing)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25::jsonb,$26,$27,$28,$29,$30,$31,$32::jsonb,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43::text[])`,
          [
            randomUUID(),
            input.tenantId,
            input.runId,
            line.personId,
            line.contractId,
            line.currency,
            line.fixedAmount,
            line.incentiveAmount,
            line.grossAmount,
            line.deductionAmount,
            line.taxAmount,
            line.socialInsuranceAmount,
            line.netAmount,
            line.minimumMonthlyWage,
            line.minimumWagePassed,
            line.deductionCapRate,
            line.deductionCapAmount,
            line.deductionCapPassed,
            line.variableShareRate,
            line.variableShareCapRate,
            line.variableShareCapAmount,
            line.variableSharePassed,
            JSON.stringify(line.deductionBreakdown),
            line.deductionTypeCapPassed,
            JSON.stringify(line.deductionTypeCapBreaches),
            line.priorIncentiveAmount,
            line.incentiveChangeRate,
            line.smoothingThresholdRate,
            line.smoothingPassed,
            line.bankAccountRef ?? null,
            line.noticeAcknowledgementPassed,
            JSON.stringify(line.noticeAcknowledgementMissing),
            line.taxCalculationMode ?? null,
            line.ytdTaxableIncome ?? null,
            line.ytdTaxWithheld ?? null,
            line.iitRatePercent ?? null,
            line.iitQuickDeduction ?? null,
            line.rawIncentiveAmount ?? line.incentiveAmount,
            line.smoothedIncentiveAmount ?? line.incentiveAmount,
            line.smoothingDelta ?? "0",
            line.smoothingMode ?? "BLOCK",
            line.deductionLegalBasisPassed ?? true,
            line.deductionLegalBasisMissing ?? [],
          ],
        );
      }
      const status = input.blockedCount > 0 ? "BLOCKED" : "CALCULATED";
      const { rows: updated } = await client.query(
        `UPDATE payroll_runs
            SET status=$3, total_gross=$4, total_deductions=$5,
                total_tax=$6, total_social_insurance=$7, total_net=$8,
                line_count=$9, blocked_count=$10,
                updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.runId,
          status,
          input.totalGross,
          input.totalDeductions,
          input.totalTax,
          input.totalSocialInsurance,
          input.totalNet,
          input.lines.length,
          input.blockedCount,
        ],
      );
      const { rows: lines } = await client.query(
        "SELECT * FROM payroll_lines WHERE tenant_id=$1 AND run_id=$2 ORDER BY person_id",
        [input.tenantId, input.runId],
      );
      return this.mapPayrollRun(
        updated[0],
        lines.map((line) => this.mapPayrollLine(line)),
      );
    });
  }

  async approvePayrollRun(input: {
    tenantId: string;
    runId: string;
    approvedBy: string;
  }): Promise<PayrollRun> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM payroll_runs
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.runId],
      );
      if (!rows[0]) notFound("PayrollRun", input.runId);
      const run = this.mapPayrollRun(rows[0], []);
      if (run.status !== "CALCULATED") {
        throw new ConflictError(`payroll run is ${run.status}`);
      }
      if (run.preparedBy === input.approvedBy) {
        throw new ConflictError(
          "PAYROLL_SELF_APPROVAL: the preparer cannot approve the run",
        );
      }
      const { rows: personRows } = await client.query(
        "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.approvedBy],
      );
      if (!personRows[0]) notFound("Person", input.approvedBy);
      const { rows: updated } = await client.query(
        `UPDATE payroll_runs
            SET status='APPROVED', approved_by=$3, approved_at=now(),
                updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.runId, input.approvedBy],
      );
      return this.mapPayrollRun(updated[0], []);
    });
  }

  async payPayrollRun(input: {
    tenantId: string;
    runId: string;
  }): Promise<PayrollRun> {
    const { rows } = await this.pool.query(
      `UPDATE payroll_runs
          SET status='PAID', paid_at=now(), updated_at=now(),
              version=version+1
        WHERE tenant_id=$1 AND id=$2 AND status='APPROVED'
        RETURNING *`,
      [input.tenantId, input.runId],
    );
    if (!rows[0]) {
      const run = await this.getPayrollRun(input.tenantId, input.runId);
      throw new ConflictError(`payroll run is ${run.status}`);
    }
    return this.mapPayrollRun(rows[0], []);
  }

  async reversePayrollRun(input: {
    tenantId: string;
    runId: string;
    reason: string;
    reversedBy: string;
  }): Promise<PayrollRun> {
    const { rows: personRows } = await this.pool.query(
      "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.reversedBy],
    );
    if (!personRows[0]) notFound("Person", input.reversedBy);
    const { rows } = await this.pool.query(
      `UPDATE payroll_runs
          SET status='REVERSED', reversed_at=now(), reversed_by=$3,
              reversal_reason=$4, updated_at=now(), version=version+1
        WHERE tenant_id=$1 AND id=$2 AND status IN ('APPROVED','PAID')
        RETURNING *`,
      [
        input.tenantId,
        input.runId,
        input.reversedBy,
        input.reason,
      ],
    );
    if (!rows[0]) {
      const run = await this.getPayrollRun(input.tenantId, input.runId);
      throw new ConflictError(`payroll run is ${run.status}`);
    }
    return this.mapPayrollRun(rows[0], []);
  }

  async cancelPayrollRun(input: {
    tenantId: string;
    runId: string;
  }): Promise<PayrollRun> {
    const { rows } = await this.pool.query(
      `UPDATE payroll_runs
          SET status='CANCELLED', updated_at=now(), version=version+1
        WHERE tenant_id=$1 AND id=$2
          AND status NOT IN ('PAID','REVERSED','CANCELLED')
        RETURNING *`,
      [input.tenantId, input.runId],
    );
    if (!rows[0]) {
      const run = await this.getPayrollRun(input.tenantId, input.runId);
      throw new ConflictError(`payroll run is ${run.status}`);
    }
    return this.mapPayrollRun(rows[0], []);
  }

  async createSyncRun(input: {
    tenantId: string;
    connectionId: string;
    status: string;
    cursorBefore?: Record<string, unknown>;
  }): Promise<SyncRun> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO sync_runs
          (id, tenant_id, connection_id, status, started_at, cursor_before)
         VALUES ($1,$2,$3,$4,
                 CASE WHEN $4 = 'QUEUED' THEN NULL ELSE now() END, $5)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.connectionId,
          input.status,
          input.cursorBefore ?? null,
        ],
      );
      return this.mapSyncRun(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(
          `Integration connection ${input.connectionId} not found`,
        );
      }
      throw error;
    }
  }

  async listSyncRuns(
    tenantId: string,
    connectionId?: string,
  ): Promise<SyncRun[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM sync_runs WHERE tenant_id=$1";
    if (connectionId) {
      params.push(connectionId);
      sql += " AND connection_id=$2";
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapSyncRun(row));
  }

  async finishSyncRun(input: {
    tenantId: string;
    syncRunId: string;
    status: string;
    recordsSeen: number;
    recordsUpserted: number;
    cursorAfter?: Record<string, unknown>;
    errorSummary?: string;
  }): Promise<SyncRun> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM sync_runs
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.syncRunId],
      );
      if (!rows[0]) notFound("SyncRun", input.syncRunId);
      const run = this.mapSyncRun(rows[0]);
      if (run.finishedAt) {
        throw new ConflictError(`sync run ${run.id} is already finished`);
      }
      const { rows: updated } = await client.query(
        `UPDATE sync_runs
            SET status=$3, records_seen=$4, records_upserted=$5,
                cursor_after=COALESCE($6, cursor_after),
                error_summary=$7, finished_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.syncRunId,
          input.status,
          input.recordsSeen,
          input.recordsUpserted,
          input.cursorAfter ?? null,
          input.errorSummary ?? null,
        ],
      );
      await client.query(
        `UPDATE integration_connections
            SET last_sync_at=now(), updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, run.connectionId],
      );
      return this.mapSyncRun(updated[0]);
    });
  }

  async upsertExternalIdentity(input: {
    tenantId: string;
    sourceSystem: string;
    externalId: string;
    personId?: string;
    objectType: string;
  }): Promise<ExternalIdentity> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO external_identity_map
          (id, tenant_id, source_system, external_id, person_id, object_type)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, source_system, external_id, object_type)
         DO UPDATE SET person_id=COALESCE(
           EXCLUDED.person_id, external_identity_map.person_id
         )
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.sourceSystem,
          input.externalId,
          input.personId ?? null,
          input.objectType,
        ],
      );
      return this.mapExternalIdentity(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or person not found");
      }
      throw error;
    }
  }

  async listExternalIdentities(
    tenantId: string,
    filter?: { sourceSystem?: string; objectType?: string },
  ): Promise<ExternalIdentity[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM external_identity_map WHERE tenant_id=$1";
    if (filter?.sourceSystem) {
      params.push(filter.sourceSystem);
      sql += ` AND source_system=$${params.length}`;
    }
    if (filter?.objectType) {
      params.push(filter.objectType);
      sql += ` AND object_type=$${params.length}`;
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapExternalIdentity(row));
  }

  async receiveWebhook(input: {
    tenantId: string;
    sourceSystem: string;
    messageId: string;
    payloadHash: string;
  }): Promise<WebhookInboxMessage> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO webhook_inbox
          (id, tenant_id, source_system, message_id, payload_hash)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, source_system, message_id) DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.sourceSystem,
          input.messageId,
          input.payloadHash,
        ],
      );
      if (rows[0]) return this.mapWebhook(rows[0]);
      const { rows: existing } = await this.pool.query(
        `SELECT * FROM webhook_inbox
          WHERE tenant_id=$1 AND source_system=$2 AND message_id=$3`,
        [input.tenantId, input.sourceSystem, input.messageId],
      );
      if (!existing[0]) {
        throw new ConflictError("webhook message could not be recorded");
      }
      return this.mapWebhook(existing[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listWebhooks(
    tenantId: string,
    filter?: { status?: string; sourceSystem?: string },
  ): Promise<WebhookInboxMessage[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM webhook_inbox WHERE tenant_id=$1";
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status=$${params.length}`;
    }
    if (filter?.sourceSystem) {
      params.push(filter.sourceSystem);
      sql += ` AND source_system=$${params.length}`;
    }
    sql += " ORDER BY received_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapWebhook(row));
  }

  async processWebhook(input: {
    tenantId: string;
    webhookId: string;
    status: "PROCESSED" | "FAILED";
    errorCode?: string;
  }): Promise<WebhookInboxMessage> {
    const { rows } = await this.pool.query(
      `UPDATE webhook_inbox
          SET status=$3, error_code=$4, processed_at=now()
        WHERE tenant_id=$1 AND id=$2 AND processed_at IS NULL
        RETURNING *`,
      [
        input.tenantId,
        input.webhookId,
        input.status,
        input.errorCode ?? null,
      ],
    );
    if (!rows[0]) {
      const { rows: existing } = await this.pool.query(
        "SELECT * FROM webhook_inbox WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.webhookId],
      );
      if (!existing[0]) notFound("WebhookInboxMessage", input.webhookId);
      throw new ConflictError(
        `webhook ${input.webhookId} is already processed`,
      );
    }
    return this.mapWebhook(rows[0]);
  }

  async receiveInboxMessage(input: {
    tenantId: string;
    consumerName: string;
    messageId: string;
  }): Promise<InboxMessage> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO inbox_messages (id, tenant_id, consumer_name, message_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, consumer_name, message_id) DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.consumerName,
          input.messageId,
        ],
      );
      if (rows[0]) return this.mapInboxMessage(rows[0]);
      const { rows: existing } = await this.pool.query(
        `SELECT * FROM inbox_messages
          WHERE tenant_id=$1 AND consumer_name=$2 AND message_id=$3`,
        [input.tenantId, input.consumerName, input.messageId],
      );
      if (!existing[0]) {
        throw new ConflictError("inbox message could not be recorded");
      }
      return this.mapInboxMessage(existing[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError(`Tenant ${input.tenantId} not found`);
      }
      throw error;
    }
  }

  async listInboxMessages(
    tenantId: string,
    filter?: { consumerName?: string; status?: string },
  ): Promise<InboxMessage[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM inbox_messages WHERE tenant_id=$1";
    if (filter?.consumerName) {
      params.push(filter.consumerName);
      sql += ` AND consumer_name=$${params.length}`;
    }
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status=$${params.length}`;
    }
    sql += " ORDER BY received_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapInboxMessage(row));
  }

  async processInboxMessage(input: {
    tenantId: string;
    inboxMessageId: string;
    status: "PROCESSED" | "FAILED" | "IGNORED";
    errorCode?: string;
  }): Promise<InboxMessage> {
    const { rows } = await this.pool.query(
      `UPDATE inbox_messages
          SET status=$3, error_code=$4, processed_at=now()
        WHERE tenant_id=$1 AND id=$2 AND processed_at IS NULL
        RETURNING *`,
      [
        input.tenantId,
        input.inboxMessageId,
        input.status,
        input.errorCode ?? null,
      ],
    );
    if (!rows[0]) {
      const { rows: existing } = await this.pool.query(
        "SELECT * FROM inbox_messages WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.inboxMessageId],
      );
      if (!existing[0]) notFound("InboxMessage", input.inboxMessageId);
      throw new ConflictError(
        `inbox message ${input.inboxMessageId} is already processed`,
      );
    }
    return this.mapInboxMessage(rows[0]);
  }

  private async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertTenant(tenantId: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      "SELECT 1 FROM tenants WHERE id=$1",
      [tenantId],
    );
    if (!rowCount) notFound("Tenant", tenantId);
  }

  private mapTenant(row: QueryResultRow): PlatformTenant {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      defaultTimezone: row.default_timezone,
      defaultCurrency: String(row.default_currency).trim(),
      settings: row.settings ?? {},
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapUser(row: QueryResultRow): PlatformUser {
    return {
      id: row.id,
      email: row.email ?? undefined,
      displayName: row.display_name,
      authSubject: row.auth_subject,
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapMembership(row: QueryResultRow): PlatformMembership {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      status: row.status,
      roleCodes: row.role_codes ?? [],
      joinedAt: iso(row.joined_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      userDisplayName: row.user_display_name ?? undefined,
      userEmail: row.user_email ?? undefined,
    };
  }

  private mapSubscriptionPlan(row: QueryResultRow): SubscriptionPlan {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description ?? undefined,
      monthlyPrice: String(row.monthly_price),
      currency: row.currency,
      seatLimit: row.seat_limit,
      trialDays: row.trial_days,
      features: Array.isArray(row.features) ? row.features : [],
      active: row.active,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapTenantSubscription(
    row: QueryResultRow,
    plan?: QueryResultRow,
  ): TenantSubscription {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      planId: row.plan_id,
      planCode: plan?.code ?? row.plan_code,
      planName: plan?.name ?? row.plan_name,
      status: row.status,
      seats: row.seats,
      currentPeriodStart: iso(row.current_period_start) ?? "",
      currentPeriodEnd: iso(row.current_period_end) ?? "",
      trialEndsAt: iso(row.trial_ends_at) ?? undefined,
      canceledAt: iso(row.canceled_at) ?? undefined,
      cancelReason: row.cancel_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapStrategicPoolCase(row: QueryResultRow): StrategicPoolCase {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      poolAmount: String(row.pool_amount),
      capAmount: String(row.cap_amount),
      currency: row.currency,
      budgetPoolId: row.budget_pool_id ?? undefined,
      rationale: row.rationale,
      requestedBy: row.requested_by,
      units: row.units ?? undefined,
      unitStandardCost:
        row.unit_standard_cost === null
          ? undefined
          : String(row.unit_standard_cost),
      totalStandardCost:
        row.total_standard_cost === null
          ? undefined
          : String(row.total_standard_cost),
      transferPricingRef: row.transfer_pricing_ref ?? undefined,
      costReviewedBy: row.cost_reviewed_by ?? undefined,
      costReviewedAt: iso(row.cost_reviewed_at) ?? undefined,
      financeApprovedBy: row.finance_approved_by ?? undefined,
      financeApprovedAt: iso(row.finance_approved_at) ?? undefined,
      deferredInstallmentMonths: row.deferred_installment_months,
      status: row.status,
      rejectedReason: row.rejected_reason ?? undefined,
      activatedAt: iso(row.activated_at) ?? undefined,
      settledAt: iso(row.settled_at) ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapInvoice(row: QueryResultRow): TenantInvoice {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      subscriptionId: row.subscription_id,
      number: row.number,
      status: row.status,
      currency: row.currency,
      lineItems: Array.isArray(row.line_items) ? row.line_items : [],
      totalAmount: String(row.total_amount),
      periodStart: iso(row.period_start) ?? undefined,
      periodEnd: iso(row.period_end) ?? undefined,
      dueDate: iso(row.due_date) ?? undefined,
      issuedAt: iso(row.issued_at) ?? undefined,
      paidAt: iso(row.paid_at) ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapPerson(row: QueryResultRow): PlatformPerson {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id ?? undefined,
      employeeCode: row.employee_code,
      displayName: row.display_name,
      employmentStatus: row.employment_status,
      managerPersonId: row.manager_person_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapOrgNode(row: QueryResultRow): PlatformOrgNode {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      parentId: row.parent_id ?? undefined,
      nodeType: row.node_type,
      name: row.name,
      path: row.path ?? undefined,
      active: row.active,
      externalId: row.external_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapOrgAssignment(row: QueryResultRow): PlatformOrgAssignment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      orgNodeId: row.org_node_id,
      validFrom: isoDate(row.valid_from) ?? "",
      validTo: isoDate(row.valid_to),
      allocation: decimalText(row.allocation),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapNotice(row: QueryResultRow): EmployeeNotice {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id ?? undefined,
      noticeType: row.notice_type,
      title: row.title,
      bodyRef: row.body_ref,
      publishedAt: iso(row.published_at) ?? new Date().toISOString(),
      effectiveFrom: iso(row.effective_from) ?? new Date().toISOString(),
      acknowledgementRequired: row.acknowledgement_required,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapAcknowledgement(row: QueryResultRow): PolicyAcknowledgement {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      noticeId: row.notice_id,
      personId: row.person_id,
      acknowledgedAt: iso(row.acknowledged_at),
      signatureRef: row.signature_ref ?? undefined,
      declinedAt: iso(row.declined_at),
      declineReason: row.decline_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapRepresentation(row: QueryResultRow): EmployeeRepresentation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      bodyName: row.body_name,
      bodyType: row.body_type,
      jurisdiction: row.jurisdiction,
      active: row.active,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapConsultation(row: QueryResultRow): PolicyConsultation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id,
      representationId: row.representation_id ?? undefined,
      consultationType: row.consultation_type,
      startedAt: iso(row.started_at) ?? new Date().toISOString(),
      endedAt: iso(row.ended_at),
      minutesRef: row.minutes_ref ?? undefined,
      feedbackSummary: row.feedback_summary ?? undefined,
      outcome: row.outcome,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapDpia(row: QueryResultRow): DpiaRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      assessmentType: row.assessment_type,
      scope: row.scope,
      status: row.status,
      riskSummary: row.risk_summary ?? {},
      mitigationSummary: row.mitigation_summary ?? {},
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapDsar(row: QueryResultRow): DsarRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      requestType: row.request_type,
      status: row.status,
      receivedAt: iso(row.received_at) ?? new Date().toISOString(),
      dueAt: iso(row.due_at),
      resolvedAt: iso(row.resolved_at),
      resolutionRef: row.resolution_ref ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapRetentionDisposalRequest(
    row: QueryResultRow,
  ): RetentionDisposalRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      retentionPolicyId: row.retention_policy_id,
      dataCategory: row.data_category,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by ?? undefined,
      status: row.status,
      reason: row.reason,
      requestedAt: iso(row.requested_at) ?? new Date().toISOString(),
      scheduledFor:
        iso(row.scheduled_for) ?? new Date().toISOString(),
      approvedAt: iso(row.approved_at),
      completedAt: iso(row.completed_at),
      cancelledAt: iso(row.cancelled_at),
      cancelReason: row.cancel_reason ?? undefined,
    };
  }

  private mapAppealEvidenceDisclosure(
    row: QueryResultRow,
  ): AppealEvidenceDisclosure {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      appealId: row.appeal_id,
      disclosedBy: row.disclosed_by,
      method: row.method,
      evidenceRefs: (row.evidence_refs ?? []) as string[],
      note: row.note ?? undefined,
      disclosedAt: iso(row.disclosed_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapWorkforceSubgroupAttribute(
    row: QueryResultRow,
  ): WorkforceSubgroupAttribute {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      dimension: row.dimension,
      value: row.value,
      consentRef: row.consent_ref,
      consentedAt: iso(row.consented_at) ?? new Date().toISOString(),
      expiresAt: iso(row.expires_at),
      recordedBy: row.recorded_by ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapRetentionPolicy(row: QueryResultRow): RetentionPolicy {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      dataCategory: row.data_category,
      retentionMonths: Number(row.retention_months),
      legalBasis: row.legal_basis,
      legalHold: row.legal_hold,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapDataSource(row: QueryResultRow): DataSource {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      category: row.category,
      ownerPersonId: row.owner_person_id,
      backupOwnerPersonId: row.backup_owner_person_id ?? undefined,
      slaHours: Number(row.sla_hours),
      criticality: row.criticality,
      containsPersonalData: row.contains_personal_data,
      storageRegion: row.storage_region,
      crossBorderTransfers: row.cross_border_transfers,
      processorRefs: (row.processor_refs as string[] | null) ?? [],
      fields: (row.fields as DataSourceField[] | null) ?? [],
      status: row.status,
      lastReviewedAt: iso(row.last_reviewed_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }

  private mapESignEnvelope(row: QueryResultRow): ESignEnvelope {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      contractId: row.contract_id,
      provider: row.provider,
      envelopeRef: row.envelope_ref,
      documentHash: row.document_hash,
      signerPersonId: row.signer_person_id,
      status: row.status,
      sentAt: iso(row.sent_at) ?? new Date().toISOString(),
      completedAt: iso(row.completed_at),
      declineReason: row.decline_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapCompensationTemplate(
    row: QueryResultRow,
  ): CompensationTemplate {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      roleCode: row.role_code,
      employmentType: row.employment_type,
      currency: String(row.currency).trim(),
      fixedSalaryMin:
        decimalText(String(row.fixed_salary_min)) ?? "0",
      fixedSalaryMax:
        decimalText(String(row.fixed_salary_max)) ?? "0",
      deductionCapRate:
        decimalText(String(row.deduction_cap_rate)) ?? "0.2",
      variableShareCapRate:
        decimalText(String(row.variable_share_cap_rate)) ?? "1",
      smoothingThresholdRate:
        decimalText(String(row.smoothing_threshold_rate)) ?? "1",
      deductionOrder:
        (row.deduction_order as string[] | null) ?? [],
      deductionTypeCaps:
        (row.deduction_type_caps as Record<string, string> | null) ?? {},
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapModelRedTeamRun(row: QueryResultRow): ModelRedTeamRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      promptVersion: row.prompt_version,
      scope: row.scope,
      testsRun: Number(row.tests_run),
      passed: row.passed,
      findings: (row.findings as string[] | null) ?? [],
      artifactRef: row.artifact_ref ?? undefined,
      createdBy: row.created_by,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapAuditRedaction(row: QueryResultRow): AuditRedaction {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      auditEventId: row.audit_event_id,
      replacement: row.replacement,
      reason: row.reason,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapModelCanaryRun(row: QueryResultRow): ModelCanaryRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      baselineEvaluationRunId: row.baseline_evaluation_run_id,
      candidateEvaluationRunId: row.candidate_evaluation_run_id,
      datasetRef: row.dataset_ref,
      trafficPercent: Number(row.traffic_percent),
      passed: row.passed,
      blockers: (row.blockers as string[] | null) ?? [],
      metrics: (row.metrics as Record<string, unknown> | null) ?? {},
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapModelEvaluationDataset(
    row: QueryResultRow,
  ): ModelEvaluationDataset {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      version: Number(row.version),
      name: row.name,
      sampleSize: Number(row.sample_size),
      holdoutSize: Number(row.holdout_size),
      labelSource: row.label_source,
      ownerPersonId: row.owner_person_id,
      status: row.status,
      refreshedAt: iso(row.refreshed_at) ?? new Date().toISOString(),
      nextRefreshDueAt: iso(row.next_refresh_due_at),
      contentHash: row.content_hash ?? undefined,
      samples: (row.samples as ModelEvaluationDataset["samples"] | null) ?? [],
      retiredAt: iso(row.retired_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapModelProviderPolicy(
    row: QueryResultRow,
  ): ModelProviderPolicy {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      provider: row.provider,
      zeroRetentionConfirmed: Boolean(row.zero_retention_confirmed),
      dpaRef: row.dpa_ref,
      inferenceRegion: row.inference_region,
      egressAllowlist: (row.egress_allowlist as string[] | null) ?? [],
      approvedBy: row.approved_by,
      approvedAt: iso(row.approved_at) ?? new Date().toISOString(),
      status: row.status,
      retiredAt: iso(row.retired_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapDiscretionaryPoolReview(
    row: QueryResultRow,
  ): DiscretionaryPoolReview {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      poolId: row.pool_id,
      committeePersonIds:
        (row.committee_person_ids as string[] | null) ?? [],
      employeeObserverPersonId:
        row.employee_observer_person_id ?? undefined,
      selectionCriteria: row.selection_criteria,
      decisionNotes: row.decision_notes,
      reviewedBy: row.reviewed_by,
      reviewedAt: iso(row.reviewed_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapClawbackCase(row: QueryResultRow): ClawbackCase {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      amount: decimalText(String(row.amount)) ?? "0",
      currency: String(row.currency).trim(),
      reasonCode: row.reason_code,
      explanation: row.explanation,
      consentSignatureRef: row.consent_signature_ref,
      installmentMonths: Number(row.installment_months),
      hardshipWaiver: Boolean(row.hardship_waiver),
      hardshipReason: row.hardship_reason ?? undefined,
      status: row.status,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      waivedAt: iso(row.waived_at),
      waiverReason: row.waiver_reason ?? undefined,
      cancelledAt: iso(row.cancelled_at),
      cancelReason: row.cancel_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapBreakGlassGrant(row: QueryResultRow): BreakGlassGrant {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      scope: row.scope,
      granteePersonId: row.grantee_person_id,
      reason: row.reason,
      grantedBy: row.granted_by,
      expiresAt: iso(row.expires_at) ?? new Date().toISOString(),
      status: row.status,
      revokedAt: iso(row.revoked_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapPilotEnrollment(row: QueryResultRow): PilotEnrollment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      pilotCode: row.pilot_code,
      scope: row.scope,
      consentSignatureRef: row.consent_signature_ref,
      consentSignedAt:
        iso(row.consent_signed_at) ?? new Date().toISOString(),
      status: row.status,
      withdrawnAt: iso(row.withdrawn_at),
      withdrawalReason: row.withdrawal_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapManagerTrainingRecord(
    row: QueryResultRow,
  ): ManagerTrainingRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      trainingCode: row.training_code,
      title: row.title,
      completedAt: iso(row.completed_at) ?? new Date().toISOString(),
      expiresAt: iso(row.expires_at),
      evidenceRef: row.evidence_ref ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapCalibrationSession(row: QueryResultRow): CalibrationSession {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      title: row.title,
      heldAt: iso(row.held_at) ?? new Date().toISOString(),
      facilitatorPersonId: row.facilitator_person_id,
      attendeePersonIds:
        (row.attendee_person_ids as string[] | null) ?? [],
      policyVersionId: row.policy_version_id ?? undefined,
      notes: row.notes ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapFairnessCommitment(row: QueryResultRow): FairnessCommitment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      version: Number(row.version),
      statement: row.statement,
      ownerPersonId: row.owner_person_id,
      channels: (row.channels as string[] | null) ?? [],
      status: row.status,
      publishedAt: iso(row.published_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapTrustSurvey(row: QueryResultRow): TrustSurveyRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      period: row.period,
      title: row.title,
      status: row.status,
      anonymous: Boolean(row.anonymous),
      questions: (row.questions as TrustSurveyQuestion[] | null) ?? [],
      openedAt: iso(row.opened_at),
      closedAt: iso(row.closed_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapTrustSurveyResponse(row: QueryResultRow): TrustSurveyResponse {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      surveyId: row.survey_id,
      respondentHash: row.respondent_hash,
      scores: (row.scores as Record<string, number> | null) ?? {},
      submittedAt: iso(row.submitted_at) ?? new Date().toISOString(),
    };
  }

  private mapConflictDeclaration(row: QueryResultRow): ConflictDeclaration {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      relatedPersonId: row.related_person_id,
      relationshipType: row.relationship_type,
      description: row.description,
      status: row.status,
      declaredAt: iso(row.declared_at) ?? new Date().toISOString(),
      revokedAt: iso(row.revoked_at),
      revocationReason: row.revocation_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapApprovalRequest(row: QueryResultRow): ApprovalRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      actionType: row.action_type,
      targetType: row.target_type,
      targetId: row.target_id,
      targetVersion: Number(row.target_version),
      requestedByType: row.requested_by_type,
      requestedById: row.requested_by_id ?? undefined,
      riskTier: row.risk_tier,
      status: row.status,
      requiredApprovals: Number(row.required_approvals),
      approvedCount: Number(row.approved_count),
      expiresAt: iso(row.expires_at),
      payloadHash: row.payload_hash,
      idempotencyKey: row.idempotency_key,
      consumedAt: iso(row.consumed_at),
      consumedBy: row.consumed_by ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapApprovalDecision(row: QueryResultRow): ApprovalDecision {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      requestId: row.request_id,
      decision: row.decision,
      approverPersonId: row.approver_person_id,
      payloadHash: row.payload_hash,
      reason: row.reason ?? undefined,
      decidedAt: iso(row.decided_at) ?? new Date().toISOString(),
      authContext: row.auth_context ?? {},
    };
  }

  private mapSettlementExport(row: QueryResultRow): SettlementExport {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      batchId: row.batch_id,
      exportRef: row.export_ref,
      exportHash: row.export_hash,
      exportedBy: row.exported_by,
      exportedAt: iso(row.exported_at) ?? new Date().toISOString(),
      acknowledgedAt: iso(row.acknowledged_at),
      acknowledgementRef: row.acknowledgement_ref ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapSettlementAcknowledgement(
    row: QueryResultRow,
  ): SettlementAcknowledgement {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      exportId: row.export_id,
      externalReference: row.external_reference,
      acknowledgedAt:
        iso(row.acknowledged_at) ?? new Date().toISOString(),
      payloadHash: row.payload_hash,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapBudgetPool(row: QueryResultRow): BudgetPool {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      code: row.code,
      name: row.name,
      poolType: row.pool_type,
      currency: String(row.currency).trim(),
      approvedAmount: decimalText(String(row.approved_amount)) ?? "0",
      committedAmount:
        decimalText(String(row.committed_amount)) ?? "0",
      status: row.status,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapBudgetAllocation(row: QueryResultRow): BudgetAllocation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      budgetPoolId: row.budget_pool_id,
      targetType: row.target_type,
      targetId: row.target_id,
      amount: decimalText(String(row.amount)) ?? "0",
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapCashGateInput(row: QueryResultRow): CashGateInput {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      asOfDate: isoDate(row.as_of_date) ?? "",
      safetyReserveMonths:
        decimalText(String(row.safety_reserve_months)) ?? "0",
      thirteenWeekForecastRef: row.thirteen_week_forecast_ref,
      passesGate: row.passes_gate,
      approvedBy: row.approved_by,
      approvedAt: iso(row.approved_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapFinancialFact(row: QueryResultRow): FinancialFact {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      sourceSystem: row.source_system,
      sourceRecordId: row.source_record_id,
      factType: row.fact_type,
      periodStart: isoDate(row.period_start),
      periodEnd: isoDate(row.period_end),
      amount: decimalText(String(row.amount)) ?? "0",
      currency: String(row.currency).trim(),
      qualityStatus: row.quality_status,
      sourceUpdatedAt: iso(row.source_updated_at),
      ingestedAt: iso(row.ingested_at) ?? new Date().toISOString(),
      payload: row.payload ?? {},
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapRuleChangeOrder(row: QueryResultRow): RuleChangeOrder {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyCode: row.policy_code,
      fromPolicyVersionId: row.from_policy_version_id ?? undefined,
      toPolicyVersionId: row.to_policy_version_id,
      changeType: row.change_type,
      reason: row.reason,
      impactSimulation: row.impact_simulation ?? {},
      status: row.status,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      publicizedAt: iso(row.publicized_at),
      effectiveFrom: iso(row.effective_from) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapPolicyTestCase(row: QueryResultRow): PolicyTestCase {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id,
      caseCode: row.case_code,
      input: row.input ?? {},
      expectedOutput: row.expected_output ?? {},
      category: row.category,
      status: row.status,
      lastRunAt: iso(row.last_run_at),
      lastRunPassed:
        row.last_run_passed === null ? undefined : row.last_run_passed,
      lastRunResultHash: row.last_run_result_hash ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapPolicyTestRun(row: QueryResultRow): PolicyTestRun {
    return {
      id: row.id,
      runId: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id,
      runAt: iso(row.run_at) ?? new Date().toISOString(),
      total: Number(row.total),
      passedCount: Number(row.passed_count),
      failedCount: Number(row.failed_count),
      retiredCount: Number(row.retired_count),
      passed: row.passed,
      resultsHash: row.results_hash,
      results: row.results ?? [],
    };
  }

  private mapPolicyNotice(row: QueryResultRow): PolicyNotice {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id,
      noticeId: row.notice_id,
      audience: row.audience ?? {},
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapMetricDefinition(row: QueryResultRow): MetricDefinition {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      version: Number(row.version),
      name: row.name,
      description: row.description ?? undefined,
      dataType: row.data_type,
      unit: row.unit ?? undefined,
      aggregationMethod: row.aggregation_method ?? undefined,
      sourceContract: row.source_contract ?? {},
      active: row.active,
      effectiveFrom: isoDate(row.effective_from) ?? "",
      effectiveTo: isoDate(row.effective_to),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapDeliverable(row: QueryResultRow): Deliverable {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workPackageId: row.work_package_id,
      title: row.title,
      deliverableType: row.deliverable_type,
      ownerPersonId: row.owner_person_id,
      dueAt: iso(row.due_at),
      status: row.status,
      artifactRef: row.artifact_ref ?? undefined,
      contentHash: row.content_hash ?? undefined,
      submittedAt: iso(row.submitted_at),
      version: Number(row.version),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapAcceptance(row: QueryResultRow): Acceptance {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      deliverableId: row.deliverable_id,
      decision: row.decision,
      reviewerPersonId: row.reviewer_person_id,
      criteriaResults: row.criteria_results ?? {},
      comments: row.comments ?? undefined,
      decidedAt: iso(row.decided_at) ?? new Date().toISOString(),
      supersedesId: row.supersedes_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapAiSuggestion(row: QueryResultRow): AiSuggestionLog {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      agentTaskId: row.agent_task_id,
      targetType: row.target_type,
      targetId: row.target_id ?? undefined,
      suggestionType: row.suggestion_type,
      modelProvider: row.model_provider ?? undefined,
      modelName: row.model_name ?? undefined,
      modelPromptId: row.model_prompt_id ?? undefined,
      promptVersion: row.prompt_version,
      inputHash: row.input_hash,
      outputJson: row.output_json ?? {},
      validationStatus: row.validation_status,
      acceptedBy: row.accepted_by ?? undefined,
      acceptedAt: iso(row.accepted_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapModelEvaluationRun(row: QueryResultRow): ModelEvaluationRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      evaluationType: row.evaluation_type,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      promptVersion: row.prompt_version,
      datasetRef: row.dataset_ref,
      sampleSize: Number(row.sample_size),
      metrics: row.metrics ?? {},
      subgroupMetrics: row.subgroup_metrics ?? {},
      passed: row.passed,
      blockers: row.blockers ?? [],
      evaluatedAt: iso(row.evaluated_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapModelPrompt(row: QueryResultRow): ModelPrompt {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      promptCode: row.prompt_code,
      version: Number(row.version),
      purpose: row.purpose,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      template: row.template,
      templateHash: row.template_hash,
      status: row.status,
      evaluationRunId: row.evaluation_run_id ?? undefined,
      activatedAt: iso(row.activated_at),
      retiredAt: iso(row.retired_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapAiScoreProposal(row: QueryResultRow): AiScoreProposal {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      personId: row.person_id,
      evaluationRunId: row.evaluation_run_id,
      modelPromptId: row.model_prompt_id ?? undefined,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      promptVersion: row.prompt_version,
      dimensions: row.dimensions ?? [],
      scores: row.scores ?? {},
      overallScore: Number(row.overall_score),
      confidence: Number(row.confidence),
      rationale: row.rationale,
      evidenceRefs: row.evidence_refs ?? [],
      evidenceSnapshotHash: row.evidence_snapshot_hash,
      gateMetrics: row.gate_metrics ?? {},
      riskTier: row.risk_tier ?? "MEDIUM",
      riskReasons: (row.risk_reasons ?? []) as string[],
      riskAssessedAt: iso(row.risk_assessed_at),
      secondReviewRequired: Boolean(row.second_review_required),
      secondReviewDueAt: iso(row.second_review_due_at),
      secondReviewSlaBreached: Boolean(row.second_review_sla_breached),
      zeroScoreRationale: row.zero_score_rationale ?? undefined,
      status: row.status,
      requestedBy: row.requested_by ?? undefined,
      decidedBy: row.decided_by ?? undefined,
      decisionNote: row.decision_note ?? undefined,
      decidedAt: iso(row.decided_at),
      independentScores: (row.independent_scores ?? {}) as Record<string, number>,
      independentRationale: row.independent_rationale ?? undefined,
      reviewStartedAt: iso(row.review_started_at),
      reviewDurationSeconds:
        row.review_duration_seconds === null ||
        row.review_duration_seconds === undefined
          ? undefined
          : Number(row.review_duration_seconds),
      evidenceOpened: Number(row.evidence_opened ?? 0),
      override: Boolean(row.override),
      overrideReason: row.override_reason ?? undefined,
      blindReview: Boolean(row.blind_review),
      auditSample: Boolean(row.audit_sample),
      auditSampledAt: iso(row.audit_sampled_at),
      secondReviewerPersonId: row.second_reviewer_person_id ?? undefined,
      secondIndependentScores:
        (row.second_independent_scores as Record<string, number> | null) ??
        undefined,
      secondIndependentRationale:
        row.second_independent_rationale ?? undefined,
      secondReviewStartedAt: iso(row.second_review_started_at),
      secondReviewCompletedAt: iso(row.second_review_completed_at),
      secondReviewDurationSeconds:
        row.second_review_duration_seconds === null ||
        row.second_review_duration_seconds === undefined
          ? undefined
          : Number(row.second_review_duration_seconds),
      secondReviewEvidenceOpened:
        row.second_review_evidence_opened === null ||
        row.second_review_evidence_opened === undefined
          ? undefined
          : Number(row.second_review_evidence_opened),
      secondReviewOutcome: row.second_review_outcome ?? undefined,
      secondReviewAgreementRate:
        row.second_review_agreement_rate === null ||
        row.second_review_agreement_rate === undefined
          ? undefined
          : Number(row.second_review_agreement_rate),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapWorkflowRun(row: QueryResultRow): WorkflowRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      agentTaskId: row.agent_task_id,
      workflowName: row.workflow_name,
      workflowVersion: row.workflow_version,
      status: row.status,
      currentStep: row.current_step ?? undefined,
      state: row.state ?? {},
      startedAt: iso(row.started_at) ?? new Date().toISOString(),
      finishedAt: iso(row.finished_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapIntegrationConnection(
    row: QueryResultRow,
  ): IntegrationConnection {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      provider: row.provider,
      connectionName: row.connection_name,
      credentialRef: row.credential_ref,
      status: row.status,
      config: row.config ?? {},
      lastSyncAt: iso(row.last_sync_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapIntegrationMapping(row: QueryResultRow): IntegrationMapping {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      name: row.name,
      mappingType: row.mapping_type,
      sourceSystem: row.source_system,
      targetType: row.target_type,
      fieldMap: row.field_map ?? {},
      config: row.config ?? {},
      version: Number(row.version),
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      retiredAt: iso(row.retired_at),
    };
  }

  private mapSyncSchedule(row: QueryResultRow): SyncSchedule {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      name: row.name,
      intervalMinutes: Number(row.interval_minutes),
      enabled: row.enabled,
      nextRunAt: iso(row.next_run_at) ?? new Date().toISOString(),
      lastRunAt: iso(row.last_run_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapEquityGrant(row: QueryResultRow): EquityGrant {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      grantCode: row.grant_code,
      grantType: row.grant_type,
      totalUnits: decimalText(String(row.total_units)) ?? "0",
      strikePrice: decimalText(String(row.strike_price)) ?? "0",
      currency: String(row.currency).trim(),
      grantDate: iso(row.grant_date) ?? new Date().toISOString(),
      vestingStart: iso(row.vesting_start) ?? new Date().toISOString(),
      cliffMonths: Number(row.cliff_months),
      vestingMonths: Number(row.vesting_months),
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }

  private mapEquityExercise(row: QueryResultRow): EquityExercise {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      grantId: row.grant_id,
      personId: row.person_id,
      units: decimalText(String(row.units)) ?? "0",
      strikePrice: decimalText(String(row.strike_price)) ?? "0",
      totalCost: decimalText(String(row.total_cost)) ?? "0",
      currency: String(row.currency).trim(),
      status: row.status,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      settledAt: iso(row.settled_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }

  private mapBounty(row: QueryResultRow): Bounty {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      description: row.description,
      rewardAmount: decimalText(String(row.reward_amount)) ?? "0",
      currency: String(row.currency).trim(),
      status: row.status,
      createdBy: row.created_by,
      dueAt: iso(row.due_at),
      assigneePersonId: row.assignee_person_id ?? undefined,
      claimedAt: iso(row.claimed_at),
      submissionRef: row.submission_ref ?? undefined,
      submittedAt: iso(row.submitted_at),
      acceptedBy: row.accepted_by ?? undefined,
      acceptedAt: iso(row.accepted_at),
      paymentRef: row.payment_ref ?? undefined,
      cancelledAt: iso(row.cancelled_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }

  private mapAdverseAction(row: QueryResultRow): AdverseActionCase {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      actionType: row.action_type,
      status: row.status,
      reason: row.reason,
      performanceBasis: row.performance_basis,
      evidenceRefs: (row.evidence_refs ?? []) as string[],
      requestedBy: row.requested_by,
      legalReviewerId: row.legal_reviewer_id ?? undefined,
      legalReviewRef: row.legal_review_ref ?? undefined,
      legalReviewedAt: iso(row.legal_reviewed_at),
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      effectiveFrom: iso(row.effective_from),
      completedAt: iso(row.completed_at),
      cancelledAt: iso(row.cancelled_at),
      cancelReason: row.cancel_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }

  private mapEmploymentContract(row: QueryResultRow): EmploymentContract {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      contractCode: row.contract_code,
      employmentType: row.employment_type,
      startDate: iso(row.start_date) ?? new Date().toISOString(),
      endDate: iso(row.end_date),
      workLocation: row.work_location,
      legalEntity: row.legal_entity ?? undefined,
      currency: String(row.currency).trim(),
      fixedMonthlySalary:
        decimalText(String(row.fixed_monthly_salary)) ?? "0",
      minimumMonthlyWage:
        decimalText(String(row.minimum_monthly_wage)) ?? "0",
      taxRate: decimalText(String(row.tax_rate)) ?? "0",
      socialInsuranceRate:
        decimalText(String(row.social_insurance_rate)) ?? "0",
      deductionCapRate:
        decimalText(String(row.deduction_cap_rate)) ?? "0.2",
      variableShareCapRate:
        decimalText(String(row.variable_share_cap_rate)) ?? "1",
      deductionOrder:
        (row.deduction_order as string[] | null) ?? [
          "RECOVERY",
          "REVERSAL",
          "ADJUSTMENT",
          "OTHER",
        ],
      deductionTypeCaps:
        (row.deduction_type_caps as Record<string, string> | null) ?? {},
      smoothingThresholdRate:
        decimalText(String(row.smoothing_threshold_rate)) ?? "1",
      smoothingMode: (row.smoothing_mode as string | null) ?? "BLOCK",
      smoothingWindowPeriods: Number(row.smoothing_window_periods ?? 3),
      smoothingMaxStepRate:
        decimalText(String(row.smoothing_max_step_rate ?? "0.5")) ?? "0.5",
      compensationTemplateCode: row.compensation_template_code ?? undefined,
      bankAccountRef: row.bank_account_ref ?? undefined,
      payPlanVersion: Number(row.pay_plan_version ?? 1),
      consentSignatureRef: row.consent_signature_ref,
      consentSignedAt:
        iso(row.consent_signed_at) ?? new Date().toISOString(),
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }

  private mapEmploymentContractAmendment(
    row: QueryResultRow,
  ): EmploymentContractAmendment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      contractId: row.contract_id,
      payPlanVersion: Number(row.pay_plan_version),
      beforeTerms: (row.before_terms ?? {}) as Record<string, unknown>,
      afterTerms: (row.after_terms ?? {}) as Record<string, unknown>,
      effectiveFrom: iso(row.effective_from) ?? new Date().toISOString(),
      consentSignatureRef: row.consent_signature_ref,
      approvedBy: row.approved_by,
      status: row.status,
      appliedAt: iso(row.applied_at),
      cancelledAt: iso(row.cancelled_at),
      cancelReason: row.cancel_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapPayrollLine(row: QueryResultRow): PayrollLine {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      runId: row.run_id,
      personId: row.person_id,
      contractId: row.contract_id,
      currency: String(row.currency).trim(),
      fixedAmount: decimalText(String(row.fixed_amount)) ?? "0",
      incentiveAmount: decimalText(String(row.incentive_amount)) ?? "0",
      grossAmount: decimalText(String(row.gross_amount)) ?? "0",
      deductionAmount: decimalText(String(row.deduction_amount)) ?? "0",
      taxAmount: decimalText(String(row.tax_amount)) ?? "0",
      socialInsuranceAmount:
        decimalText(String(row.social_insurance_amount)) ?? "0",
      netAmount: decimalText(String(row.net_amount)) ?? "0",
      minimumMonthlyWage:
        decimalText(String(row.minimum_monthly_wage)) ?? "0",
      minimumWagePassed: row.minimum_wage_passed,
      deductionCapRate:
        decimalText(String(row.deduction_cap_rate)) ?? "0.2",
      deductionCapAmount:
        decimalText(String(row.deduction_cap_amount)) ?? "0",
      deductionCapPassed: row.deduction_cap_passed,
      variableShareRate:
        decimalText(String(row.variable_share_rate)) ?? "0",
      variableShareCapRate:
        decimalText(String(row.variable_share_cap_rate)) ?? "1",
      variableShareCapAmount:
        decimalText(String(row.variable_share_cap_amount)) ?? "0",
      variableSharePassed: row.variable_share_passed,
      deductionBreakdown:
        (row.deduction_breakdown as PayrollLine["deductionBreakdown"] | null) ??
        [],
      deductionTypeCapPassed: row.deduction_type_cap_passed,
      deductionTypeCapBreaches:
        (row.deduction_type_cap_breaches as string[] | null) ?? [],
      deductionLegalBasisPassed:
        row.deduction_legal_basis_passed ?? true,
      deductionLegalBasisMissing:
        (row.deduction_legal_basis_missing as string[] | null) ?? [],
      priorIncentiveAmount:
        decimalText(String(row.prior_incentive_amount)) ?? "0",
      incentiveChangeRate:
        decimalText(String(row.incentive_change_rate)) ?? "0",
      smoothingThresholdRate:
        decimalText(String(row.smoothing_threshold_rate)) ?? "1",
      smoothingPassed: row.smoothing_passed,
      rawIncentiveAmount:
        decimalText(String(row.raw_incentive_amount ?? row.incentive_amount)) ??
        "0",
      smoothedIncentiveAmount:
        decimalText(
          String(row.smoothed_incentive_amount ?? row.incentive_amount),
        ) ?? "0",
      smoothingDelta: decimalText(String(row.smoothing_delta ?? "0")) ?? "0",
      smoothingMode: (row.smoothing_mode as string | null) ?? "BLOCK",
      noticeAcknowledgementPassed:
        row.notice_acknowledgement_passed ?? true,
      noticeAcknowledgementMissing:
        (row.notice_acknowledgement_missing as string[] | null) ?? [],
      bankAccountRef: row.bank_account_ref ?? undefined,
      taxCalculationMode:
        (row.tax_calculation_mode as PayrollLine["taxCalculationMode"]) ??
        undefined,
      ytdTaxableIncome:
        row.ytd_taxable_income === null || row.ytd_taxable_income === undefined
          ? undefined
          : decimalText(String(row.ytd_taxable_income)) ?? "0",
      ytdTaxWithheld:
        row.ytd_tax_withheld === null || row.ytd_tax_withheld === undefined
          ? undefined
          : decimalText(String(row.ytd_tax_withheld)) ?? "0",
      iitRatePercent: row.iit_rate_percent ?? undefined,
      iitQuickDeduction:
        row.iit_quick_deduction === null || row.iit_quick_deduction === undefined
          ? undefined
          : decimalText(String(row.iit_quick_deduction)) ?? "0",
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapPayrollRun(
    row: QueryResultRow,
    lines: PayrollLine[],
  ): PayrollRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      periodStart: iso(row.period_start) ?? new Date().toISOString(),
      periodEnd: iso(row.period_end) ?? new Date().toISOString(),
      currency: String(row.currency).trim(),
      status: row.status,
      preparedBy: row.prepared_by,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      paidAt: iso(row.paid_at),
      reversedAt: iso(row.reversed_at),
      reversedBy: row.reversed_by ?? undefined,
      reversalReason: row.reversal_reason ?? undefined,
      totalGross: decimalText(String(row.total_gross)) ?? "0",
      totalDeductions: decimalText(String(row.total_deductions)) ?? "0",
      totalTax: decimalText(String(row.total_tax)) ?? "0",
      totalSocialInsurance:
        decimalText(String(row.total_social_insurance)) ?? "0",
      totalNet: decimalText(String(row.total_net)) ?? "0",
      lineCount: Number(row.line_count),
      blockedCount: Number(row.blocked_count),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
      lines,
    };
  }

  private mapSyncRun(row: QueryResultRow): SyncRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      status: row.status,
      startedAt: iso(row.started_at),
      finishedAt: iso(row.finished_at),
      cursorBefore: row.cursor_before ?? undefined,
      cursorAfter: row.cursor_after ?? undefined,
      recordsSeen: Number(row.records_seen),
      recordsUpserted: Number(row.records_upserted),
      errorSummary: row.error_summary ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapExternalIdentity(row: QueryResultRow): ExternalIdentity {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      sourceSystem: row.source_system,
      externalId: row.external_id,
      personId: row.person_id ?? undefined,
      objectType: row.object_type,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapWebhook(row: QueryResultRow): WebhookInboxMessage {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      sourceSystem: row.source_system,
      messageId: row.message_id,
      payloadHash: row.payload_hash,
      receivedAt: iso(row.received_at) ?? new Date().toISOString(),
      processedAt: iso(row.processed_at),
      status: row.status,
      errorCode: row.error_code ?? undefined,
    };
  }

  async savePolicyEngineRecord(input: {
    tenantId: string;
    recordType: string;
    payload: Record<string, unknown>;
    personId?: string;
    period?: string;
    status?: string;
    recordId?: string;
  }): Promise<PolicyEngineRecord> {
    await this.assertTenant(input.tenantId);
    if (input.recordId) {
      const existing = await this.getPolicyEngineRecord(
        input.tenantId,
        input.recordId,
      );
      return this.updatePolicyEngineRecord({
        tenantId: input.tenantId,
        recordId: existing.id,
        payload: input.payload,
        status: input.status,
      });
    }
    const { rows } = await this.pool.query(
      `INSERT INTO policy_engine_records
        (id, tenant_id, record_type, person_id, period, status, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        randomUUID(),
        input.tenantId,
        input.recordType,
        input.personId ?? null,
        input.period ?? null,
        input.status ?? "RECORDED",
        input.payload,
      ],
    );
    return this.mapPolicyEngineRecord(rows[0]!);
  }

  async getPolicyEngineRecord(
    tenantId: string,
    recordId: string,
  ): Promise<PolicyEngineRecord> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      "SELECT * FROM policy_engine_records WHERE tenant_id=$1 AND id=$2",
      [tenantId, recordId],
    );
    if (!rows[0]) notFound("PolicyEngineRecord", recordId);
    return this.mapPolicyEngineRecord(rows[0]!);
  }

  async listPolicyEngineRecords(
    tenantId: string,
    filter?: {
      recordType?: string;
      personId?: string;
      period?: string;
      status?: string;
    },
  ): Promise<PolicyEngineRecord[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM policy_engine_records WHERE tenant_id=$1";
    if (filter?.recordType) {
      params.push(filter.recordType);
      sql += ` AND record_type=$${params.length}`;
    }
    if (filter?.personId) {
      params.push(filter.personId);
      sql += ` AND person_id=$${params.length}`;
    }
    if (filter?.period) {
      params.push(filter.period);
      sql += ` AND period=$${params.length}`;
    }
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status=$${params.length}`;
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapPolicyEngineRecord(row));
  }

  async updatePolicyEngineRecord(input: {
    tenantId: string;
    recordId: string;
    payload?: Record<string, unknown>;
    status?: string;
    version?: number;
  }): Promise<PolicyEngineRecord> {
    const record = await this.getPolicyEngineRecord(
      input.tenantId,
      input.recordId,
    );
    if (input.version !== undefined && input.version !== record.version) {
      throw new ConflictError(
        `policy record version mismatch: expected ${record.version}`,
      );
    }
    const { rows } = await this.pool.query(
      `UPDATE policy_engine_records
          SET payload = COALESCE($3, payload),
              status = COALESCE($4, status),
              version = version + 1,
              updated_at = now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [
        input.tenantId,
        input.recordId,
        input.payload ?? null,
        input.status ?? null,
      ],
    );
    return this.mapPolicyEngineRecord(rows[0]!);
  }

  async createIncentiveAwardBatch(input: {
    tenantId: string;
    batchNo: string;
    awardType: IncentiveAwardType;
    period: string;
    cycleId?: string;
    currency: string;
    createdBy: string;
    sourceRecordIds?: string[];
    lines: Array<{
      personId: string;
      amount: string;
      sourceRecordId?: string;
      sourceLineRef?: string;
      note?: string;
    }>;
  }): Promise<IncentiveAwardBatch> {
    await this.assertTenant(input.tenantId);
    if (input.lines.length === 0) {
      throw new ConflictError("incentive award batch requires at least one line");
    }
    const sourceRecordIds = [
      ...new Set([
        ...(input.sourceRecordIds ?? []),
        ...input.lines
          .map((line) => line.sourceRecordId)
          .filter((value): value is string => Boolean(value)),
      ]),
    ];
    if (sourceRecordIds.length > 0) {
      const { rows } = await this.pool.query(
        `SELECT batch_no FROM incentive_award_batches
          WHERE tenant_id=$1 AND status <> 'CANCELLED'
            AND source_record_ids ?| $2::text[]
          LIMIT 1`,
        [input.tenantId, sourceRecordIds],
      );
      if (rows[0]) {
        throw new ConflictError(
          `source record already used by award batch ${rows[0].batch_no}`,
        );
      }
    }
    const seen = new Set<string>();
    let total = 0n;
    for (const line of input.lines) {
      const key = `${line.personId}:${line.sourceLineRef ?? ""}`;
      if (seen.has(key)) throw new ConflictError(`duplicate award line ${key}`);
      seen.add(key);
      const amount = parseDecimal(line.amount);
      if (amount <= 0n) {
        throw new ConflictError("incentive award line amount must be positive");
      }
      total += amount;
    }
    const batchId = randomUUID();
    return this.transaction(async (client) => {
      try {
        const { rows } = await client.query(
          `INSERT INTO incentive_award_batches
            (id, tenant_id, batch_no, award_type, period, cycle_id, currency,
             status, total_amount, line_count, source_record_ids, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10::jsonb,$11)
           RETURNING *`,
          [
            batchId,
            input.tenantId,
            input.batchNo,
            input.awardType,
            input.period,
            input.cycleId ?? null,
            input.currency.toUpperCase(),
            formatDecimal(total),
            input.lines.length,
            JSON.stringify(sourceRecordIds),
            input.createdBy,
          ],
        );
        for (const line of input.lines) {
          await client.query(
            `INSERT INTO incentive_award_lines
              (id, tenant_id, batch_id, person_id, amount, currency,
               source_record_id, source_line_ref, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              randomUUID(),
              input.tenantId,
              batchId,
              line.personId,
              formatDecimal(parseDecimal(line.amount)),
              input.currency.toUpperCase(),
              line.sourceRecordId ?? null,
              line.sourceLineRef ?? null,
              line.note ?? null,
            ],
          );
        }
        return this.loadIncentiveAwardBatch(client, rows[0]!);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `incentive award batch ${input.batchNo} already exists or duplicate line`,
          );
        }
        throw error;
      }
    });
  }

  async listIncentiveAwardBatches(
    tenantId: string,
    filter?: { awardType?: string; period?: string; status?: string },
  ): Promise<IncentiveAwardBatch[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql = "SELECT * FROM incentive_award_batches WHERE tenant_id=$1";
    if (filter?.awardType) {
      params.push(filter.awardType);
      sql += ` AND award_type=$${params.length}`;
    }
    if (filter?.period) {
      params.push(filter.period);
      sql += ` AND period=$${params.length}`;
    }
    if (filter?.status) {
      params.push(filter.status);
      sql += ` AND status=$${params.length}`;
    }
    sql += " ORDER BY created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    const batches: IncentiveAwardBatch[] = [];
    for (const row of rows) {
      batches.push(await this.loadIncentiveAwardBatch(this.pool, row));
    }
    return batches;
  }

  async getIncentiveAwardBatch(
    tenantId: string,
    batchId: string,
  ): Promise<IncentiveAwardBatch> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      "SELECT * FROM incentive_award_batches WHERE tenant_id=$1 AND id=$2",
      [tenantId, batchId],
    );
    if (!rows[0]) notFound("IncentiveAwardBatch", batchId);
    return this.loadIncentiveAwardBatch(this.pool, rows[0]!);
  }

  async commandIncentiveAwardBatch(input: {
    tenantId: string;
    batchId: string;
    command:
      | "SUBMIT"
      | "APPROVE"
      | "LOCK"
      | "EXPORT"
      | "ACKNOWLEDGE"
      | "CANCEL";
    actorPersonId: string;
    paymentRef?: string;
  }): Promise<IncentiveAwardBatch> {
    const batch = await this.getIncentiveAwardBatch(
      input.tenantId,
      input.batchId,
    );
    const transition: Record<string, [string, string]> = {
      SUBMIT: ["DRAFT", "PENDING_APPROVAL"],
      APPROVE: ["PENDING_APPROVAL", "APPROVED"],
      LOCK: ["APPROVED", "LOCKED"],
      EXPORT: ["LOCKED", "EXPORTED"],
      ACKNOWLEDGE: ["EXPORTED", "ACKNOWLEDGED"],
      CANCEL: [batch.status, "CANCELLED"],
    };
    const expected = transition[input.command];
    if (!expected || batch.status !== expected[0]) {
      throw new ConflictError(
        `cannot ${input.command} incentive award batch in status ${batch.status}`,
      );
    }
    if (
      input.command === "APPROVE" &&
      input.actorPersonId === batch.createdBy
    ) {
      throw new ConflictError(
        "AWARD_BATCH_SELF_APPROVAL: creator cannot approve the batch",
      );
    }
    if (input.command === "ACKNOWLEDGE" && !input.paymentRef?.trim()) {
      throw new ConflictError("payment reference is required to acknowledge");
    }
    const { rows } = await this.pool.query(
      `UPDATE incentive_award_batches
          SET status=$3,
              approved_by = CASE WHEN $4='APPROVE' THEN $5 ELSE approved_by END,
              approved_at = CASE WHEN $4='APPROVE' THEN now() ELSE approved_at END,
              locked_at = CASE WHEN $4='LOCK' THEN now() ELSE locked_at END,
              exported_at = CASE WHEN $4='EXPORT' THEN now() ELSE exported_at END,
              acknowledged_at = CASE WHEN $4='ACKNOWLEDGE' THEN now() ELSE acknowledged_at END,
              payment_ref = CASE WHEN $4='ACKNOWLEDGE' THEN $6 ELSE payment_ref END,
              updated_at=now(),
              version=version+1
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [
        input.tenantId,
        input.batchId,
        expected[1],
        input.command,
        input.actorPersonId,
        input.paymentRef?.trim() ?? null,
      ],
    );
    return this.loadIncentiveAwardBatch(this.pool, rows[0]!);
  }

  private async loadIncentiveAwardBatch(
    queryable: Pool | PoolClient,
    row: QueryResultRow,
  ): Promise<IncentiveAwardBatch> {
    const { rows: lines } = await queryable.query(
      `SELECT * FROM incentive_award_lines
        WHERE tenant_id=$1 AND batch_id=$2
        ORDER BY created_at, id`,
      [row.tenant_id, row.id],
    );
    return {
      id: row.id,
      tenantId: row.tenant_id,
      batchNo: row.batch_no,
      awardType: row.award_type,
      period: row.period,
      cycleId: row.cycle_id ?? undefined,
      currency: row.currency,
      status: row.status,
      totalAmount: decimalText(String(row.total_amount)) ?? "0",
      lineCount: Number(row.line_count),
      sourceRecordIds: (row.source_record_ids ?? []) as string[],
      createdBy: row.created_by,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      lockedAt: iso(row.locked_at),
      exportedAt: iso(row.exported_at),
      acknowledgedAt: iso(row.acknowledged_at),
      paymentRef: row.payment_ref ?? undefined,
      lines: lines.map((line) => ({
        id: line.id,
        batchId: line.batch_id,
        personId: line.person_id,
        amount: decimalText(String(line.amount)) ?? "0",
        currency: line.currency,
        sourceRecordId: line.source_record_id ?? undefined,
        sourceLineRef: line.source_line_ref ?? undefined,
        note: line.note ?? undefined,
      })),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }

  private mapPolicyEngineRecord(row: QueryResultRow): PolicyEngineRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      recordType: row.record_type,
      personId: row.person_id ?? undefined,
      period: row.period ?? undefined,
      status: row.status ?? undefined,
      payload: row.payload as Record<string, unknown>,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }

  private mapInboxMessage(row: QueryResultRow): InboxMessage {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      consumerName: row.consumer_name,
      messageId: row.message_id,
      receivedAt: iso(row.received_at) ?? new Date().toISOString(),
      processedAt: iso(row.processed_at),
      status: row.status,
      errorCode: row.error_code ?? undefined,
    };
  }
}
