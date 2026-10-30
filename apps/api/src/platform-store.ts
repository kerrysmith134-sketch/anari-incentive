import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { formatDecimal, parseDecimal, sha256 } from "@anari/policy-dsl";
import type {
  Acceptance,
  AiScoreProposal,
  AiSuggestionLog,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRiskTier,
  ApprovalStatus,
  BudgetAllocation,
  BudgetPool,
  CashGateInput,
  ConsultationOutcome,
  ConsultationType,
  Deliverable,
  DpiaAssessmentType,
  DpiaRecord,
  DsarRequest,
  DsarRequestType,
  EmployeeNotice,
  EmployeeRepresentation,
  ExternalIdentity,
  FinancialFact,
  IntegrationConnection,
  IntegrationMapping,
  InboxMessage,
  MetricDefinition,
  ModelEvaluationRun,
  ModelPrompt,
  NoticeAcknowledgementOverview,
  NoticeType,
  PlatformIdentity,
  PlatformMembership,
  PlatformOrgAssignment,
  PlatformOrgNode,
  PlatformPerson,
  PlatformTenant,
  PlatformUser,
  PolicyAcknowledgement,
  PolicyConsultation,
  PolicyNotice,
  PolicyTestCase,
  PolicyTestRun,
  RepresentationBodyType,
  RetentionPolicy,
  RuleChangeOrder,
  SettlementAcknowledgement,
  SettlementExport,
  SyncSchedule,
  SyncRun,
  WebhookInboxMessage,
  WorkflowRun,
} from "@anari/domain";
import { ConflictError, NotFoundError } from "./store.js";

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
  linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson>;
  /** Resolve the person and tenant roles behind a platform user. */
  resolveIdentity(input: {
    tenantId: string;
    userId: string;
  }): Promise<PlatformIdentity>;
  createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
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
  private readonly syncRuns = new Map<string, SyncRun>();
  private readonly externalIdentities = new Map<string, ExternalIdentity>();
  private readonly webhooks = new Map<string, WebhookInboxMessage>();
  private readonly inboxMessages = new Map<string, InboxMessage>();

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
    tenant.settings = input.settings;
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
  }): Promise<PlatformIdentity> {
    const person = [...this.persons.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.userId === input.userId,
    );
    const membership = [...this.memberships.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.userId === input.userId,
    );
    return {
      userId: input.userId,
      personId: person?.id,
      roles: membership?.roleCodes ?? [],
    };
  }

  async createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
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
      status: "PENDING",
      requestedBy: input.requestedBy,
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
      `UPDATE tenants SET settings=$2, updated_at=now()
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
  }): Promise<PlatformIdentity> {
    const [{ rows: personRows }, { rows: membershipRows }] = await Promise.all([
      this.pool.query(
        `SELECT id FROM people
          WHERE tenant_id=$1 AND user_id=$2
          ORDER BY created_at
          LIMIT 1`,
        [input.tenantId, input.userId],
      ),
      this.pool.query(
        `SELECT role_codes FROM memberships
          WHERE tenant_id=$1 AND user_id=$2`,
        [input.tenantId, input.userId],
      ),
    ]);
    return {
      userId: input.userId,
      personId: personRows[0]?.id ?? undefined,
      roles: membershipRows[0]?.role_codes ?? [],
    };
  }

  async createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
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
          (id, tenant_id, parent_id, node_type, name, path)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.parentId ?? null,
          input.nodeType,
          input.name,
          parentPath ? `${parentPath}/${input.name}` : `/${input.name}`,
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
    requestedBy?: string;
  }): Promise<AiScoreProposal> {
    await this.assertTenant(input.tenantId);
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO ai_score_proposals
          (id, tenant_id, cycle_id, person_id, evaluation_run_id,
           model_prompt_id, model_provider, model_name, prompt_version,
           dimensions, scores, overall_score, confidence, rationale,
           evidence_refs, evidence_snapshot_hash, gate_metrics, status,
           requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 'PENDING',$18)
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
            SET status=$3, decided_by=$4, decision_note=$5, decided_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.proposalId,
          input.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED",
          input.decidedBy,
          input.note ?? null,
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
      status: row.status,
      requestedBy: row.requested_by ?? undefined,
      decidedBy: row.decided_by ?? undefined,
      decisionNote: row.decision_note ?? undefined,
      decidedAt: iso(row.decided_at),
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
