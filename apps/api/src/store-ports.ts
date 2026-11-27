/**
 * NPV2-012：PlatformStore 按领域拆分的 Repository Port。
 *
 * - 每个端口只声明该领域的能力，端口之间无依赖（无领域循环依赖）；
 * - PlatformStore 组合全部端口，MemoryPlatformStore / PgPlatformStore 实现不变；
 * - 路由模块按需依赖窄端口，不依赖 PG row 类型（NPV2-013 再拆 Adapter）。
 *
 * 方法签名与拆分前逐字一致（从原 interface 体平移）。
 */
import type {
  AccountingPeriod,
  AccountingPeriodApprover,
  AccountingPeriodApproverResolution,
  AccountingPeriodChangeRequest,
  CommercialOrder,
  Contract,
  Quote,
  Opportunity,
  Account,
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
  GlAccount,
  GlJournal,
  CalibrationSession,
  ManagerTrainingRecord,
  IntegrationConnection,
  IntegrationMapping,
  InboxMessage,
  MetricDefinition,
  MetricMeasurementSnapshot,
  ModelCanaryRun,
  ModelEvaluationDataset,
  ModelEvaluationRun,
  ModelRedTeamRun,
  ModelPrompt,
  ModelProviderPolicy,
  PolicyEngineRecord,
  IncentiveAwardBatch,
  IncentiveAwardBatchReconciliation,
  IncentiveAwardPayment,
  IncentiveAwardPaymentAudit,
  IncentiveAwardPaymentCreditAccount,
  IncentiveAwardPaymentStatus,
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
  ExternalObjectIdentity,
  QuarantineRecord,
  RawSourceRecord,
  WebhookRoutingKey,
  SyncCheckpoint,
  SyncResource,
  SyncSchedule,
  StrategicPoolCase,
  SyncRun,
  TrustSurveyQuestion,
  TrustSurveyReport,
  TrustSurveyResponse,
  TrustSurveyRun,
  WebhookInboxMessage,
  WorkflowRun,
  WorkItem,
  WorkItemContribution,
  WorkItemEvent,
  WorkItemFilter,
  WorkItemImportInput,
  WorkItemImportResult,
  AppendDecisionEvidenceInput,
  CreateDecisionCaseInput,
  DecideDecisionCaseInput,
  DecisionCase,
  DecisionCaseDetail,
  DecisionCaseLink,
  DecisionEvidence,
  DecisionJudgment,
  DecisionRecord,
  DecisionVerification,
  LinkDecisionCaseInput,
  RecordDecisionVerificationInput,
  SubmitDecisionJudgmentInput,
} from "@anari/domain";

/** 审批域端口：审批请求/决策/消费。 */
export interface ApprovalPort {
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
}

/** 评价与人文端口：评价周期/量规/指标定义/校准/信任调研/培训/公平承诺/试点。 */
export interface AssessmentPort {
  createRepresentation(input: {
    tenantId: string;
    bodyName: string;
    bodyType: RepresentationBodyType;
    jurisdiction: string;
  }): Promise<EmployeeRepresentation>;
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
}

/** 预算与财务端口：预算池/分配/自由裁量评审/现金门禁/财务事实。 */
export interface BudgetPort {
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
    legalEntityId?: string;
    orderId?: string;
    contractRef?: string;
    instrumentType?: FinancialFact["instrumentType"];
    recognitionStatus?: FinancialFact["recognitionStatus"];
    accountingPeriod?: string;
    fxSnapshot?: FinancialFact["fxSnapshot"];
    sourceVersion?: string;
    reversalOf?: string;
    reopeningRef?: string;
    /** 财务子账（迁移 111）。 */
    documentType?: FinancialFact["documentType"];
    documentId?: string;
    relatedFactId?: string;
    fxRate?: string;
    functionalCurrency?: string;
    functionalAmount?: string;
    /** 税额（迁移 112）：taxAmount = amount × taxRate / 100。 */
    taxRate?: string;
    taxAmount?: string;
  }): Promise<FinancialFact>;
  getFinancialFact(
    tenantId: string,
    factId: string,
  ): Promise<FinancialFact>;
  listFinancialFacts(
    tenantId: string,
    filter?: {
      factType?: string;
      sourceSystem?: string;
      legalEntityId?: string;
      accountingPeriod?: string;
      recognitionStatus?: FinancialFact["recognitionStatus"];
      /** 财务子账回读维度（迁移 111）。 */
      orderId?: string;
      contractRef?: string;
      documentType?: FinancialFact["documentType"];
      documentId?: string;
      relatedFactId?: string;
    },
  ): Promise<FinancialFact[]>;
  // 迁移 112：复式记账（gl_accounts / gl_journals / gl_journal_lines）。
  /** 登记一张借贷平衡的凭证；不平衡 → ConflictError（HTTP 409）。 */
  createJournalEntry(input: {
    tenantId: string;
    journalNo?: string;
    documentType: GlJournal["documentType"];
    documentId: string;
    legalEntityId: string;
    accountingPeriod: string;
    currency: string;
    description?: string;
    sourceFactId?: string;
    lines: Array<{
      accountCode: string;
      debit?: string;
      credit?: string;
    }>;
  }): Promise<GlJournal>;
  listJournals(
    tenantId: string,
    filter?: {
      documentId?: string;
      documentType?: GlJournal["documentType"];
      legalEntityId?: string;
      accountingPeriod?: string;
      limit?: number;
    },
  ): Promise<GlJournal[]>;
  listGlAccounts(tenantId: string): Promise<GlAccount[]>;
  // 2026-11-21 审计 Sprint 5：会计期间关闭/重开（POSTED 事实前置门禁）。
  listAccountingPeriods(
    tenantId: string,
    filter?: { legalEntityId?: string; period?: string },
  ): Promise<AccountingPeriod[]>;
  getAccountingPeriod(
    tenantId: string,
    legalEntityId: string,
    period: string,
  ): Promise<AccountingPeriod | null>;
  createAccountingPeriodChangeRequest(input: {
    tenantId: string;
    legalEntityId: string;
    period: string;
    action: "CLOSE" | "REOPEN";
    requestedBy: string;
    reason?: string;
    reopeningRef?: string;
  }): Promise<AccountingPeriodChangeRequest>;
  listAccountingPeriodChangeRequests(
    tenantId: string,
    filter?: {
      legalEntityId?: string;
      period?: string;
      status?: AccountingPeriodChangeRequest["status"];
    },
  ): Promise<AccountingPeriodChangeRequest[]>;
  decideAccountingPeriodChange(input: {
    tenantId: string;
    requestId: string;
    approverPersonId: string;
    decision: "APPROVE" | "REJECT";
    note?: string;
  }): Promise<{
    request: AccountingPeriodChangeRequest;
    period?: AccountingPeriod;
  }>;
  closeAccountingPeriod(input: {
    tenantId: string;
    legalEntityId: string;
    period: string;
    actorPersonId: string;
    reason?: string;
  }): Promise<AccountingPeriod>;
  reopenAccountingPeriod(input: {
    tenantId: string;
    legalEntityId: string;
    period: string;
    actorPersonId: string;
    reopeningRef: string;
    reason: string;
  }): Promise<AccountingPeriod>;
  // 迁移 113：会计期间审批人目录（显式目录优先，空目录回退角色）。
  listAccountingPeriodApprovers(
    tenantId: string,
  ): Promise<AccountingPeriodApprover[]>;
  replaceAccountingPeriodApprovers(input: {
    tenantId: string;
    personIds: string[];
    updatedBy?: string;
  }): Promise<AccountingPeriodApproverResolution>;
  /** 创建期间变更请求时用于决定通知对象；目录为空/失效时回退角色。 */
  listEffectiveAccountingPeriodApprovers(
    tenantId: string,
  ): Promise<AccountingPeriodApproverResolution>;
}

/** Commercial 域端口（Sprint 3）：Account→Opportunity→Quote→Contract→Order。 */
export interface CommercialPort {
  createAccount(input: {
    tenantId: string;
    externalAccountId?: string;
    name: string;
    ownerPersonId?: string;
  }): Promise<Account>;
  listAccounts(tenantId: string): Promise<Account[]>;
  createOpportunity(input: {
    tenantId: string;
    accountId: string;
    externalOpportunityId?: string;
    name: string;
    stage?: Opportunity["stage"];
    estimatedAmount?: string;
    currency: string;
    ownerPersonId?: string;
  }): Promise<Opportunity>;
  listOpportunities(
    tenantId: string,
    accountId?: string,
  ): Promise<Opportunity[]>;
  upsertCommercialAccount(input: {
    tenantId: string;
    sourceSystem: string;
    externalAccountId: string;
    name: string;
    ownerPersonId?: string;
  }): Promise<{ account: Account; created: boolean }>;
  upsertCommercialOpportunity(input: {
    tenantId: string;
    sourceSystem: string;
    externalAccountId: string;
    accountName: string;
    externalOpportunityId: string;
    name: string;
    stage?: Opportunity["stage"];
    estimatedAmount?: string;
    currency: string;
    ownerPersonId?: string;
  }): Promise<{
    account: Account;
    opportunity: Opportunity;
    created: boolean;
  }>;
  createQuote(input: {
    tenantId: string;
    opportunityId: string;
    currency: string;
    amount: string;
    issuedAt?: string;
    supersedesQuoteId?: string;
  }): Promise<Quote>;
  listQuotes(tenantId: string, opportunityId?: string): Promise<Quote[]>;
  acceptQuote(tenantId: string, quoteId: string): Promise<Quote>;
  voidQuote(tenantId: string, quoteId: string): Promise<Quote>;
  upsertCommercialQuote(input: {
    tenantId: string;
    sourceSystem: string;
    externalOpportunityId: string;
    externalQuoteId: string;
    currency: string;
    amount: string;
    status?: Quote["status"];
    issuedAt?: string;
    acceptedAt?: string;
  }): Promise<{ quote: Quote; created: boolean }>;
  createContract(input: {
    tenantId: string;
    accountId: string;
    opportunityId: string;
    quoteId: string;
    contractRef: string;
    currency: string;
    amount: string;
  }): Promise<Contract>;
  signContract(tenantId: string, contractId: string): Promise<Contract>;
  terminateContract(tenantId: string, contractId: string): Promise<Contract>;
  listContracts(tenantId: string, accountId?: string): Promise<Contract[]>;
  upsertCommercialContract(input: {
    tenantId: string;
    sourceSystem: string;
    externalContractId: string;
    externalQuoteId: string;
    contractRef: string;
    currency: string;
    amount: string;
    status?: Contract["status"];
    signedAt?: string;
  }): Promise<{ contract: Contract; created: boolean }>;
  createOrder(input: {
    tenantId: string;
    accountId: string;
    contractId: string;
    orderNumber: string;
    currency: string;
    lines: Array<{
      kind: CommercialOrder["lines"][number]["kind"];
      description: string;
      quantity: string;
      unitPrice: string;
      amount: string;
      currency: string;
    }>;
  }): Promise<CommercialOrder>;
  confirmOrder(tenantId: string, orderId: string): Promise<CommercialOrder>;
  cancelOrder(tenantId: string, orderId: string): Promise<CommercialOrder>;
  listOrders(tenantId: string, accountId?: string): Promise<CommercialOrder[]>;
  upsertCommercialOrder(input: {
    tenantId: string;
    sourceSystem: string;
    externalOrderId: string;
    externalContractId: string;
    orderNumber: string;
    currency: string;
    status?: CommercialOrder["status"];
    lines: Array<{
      kind: CommercialOrder["lines"][number]["kind"];
      description: string;
      quantity: string;
      unitPrice: string;
      amount: string;
      currency: string;
    }>;
  }): Promise<{ order: CommercialOrder; created: boolean }>;
}

/** 告知域端口：公告/确认回执/入站消息。 */
export interface CommsPort {
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

/** 数据治理端口：留存/处置/数据源/DSAR/DPIA/审计红线/断路授权/导出 DLP/子群属性。 */
export interface DatagovPort {
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
  createAuditRedaction(input: {
    tenantId: string;
    auditEventId: string;
    replacement: string;
    reason: string;
    requestedBy: string;
    approvedBy: string;
  }): Promise<AuditRedaction>;
  listAuditRedactions(tenantId: string): Promise<AuditRedaction[]>;
}

/** 交付与跨域读端口：交付物/申诉佐证披露（报表等跨域只读）。 */
export interface DeliveryPort {
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
}

/** 人员目录端口：人员/组织架构/劳动合同。 */
export interface DirectoryPort {
  createPerson(input: {
    tenantId: string;
    employeeCode: string;
    displayName: string;
    employmentStatus?: string;
    userId?: string;
  }): Promise<PlatformPerson>;
  listPersons(tenantId: string): Promise<PlatformPerson[]>;
  listOrgAssignments(
    tenantId: string,
    personId?: string,
  ): Promise<PlatformOrgAssignment[]>;
  listEmploymentContracts(
    tenantId: string,
    personId?: string,
  ): Promise<EmploymentContract[]>;
}

/** 身份域端口：用户/密码凭证/会话主体/身份解析。 */
export interface IdentityPort {
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
  /** Resolve the person and tenant roles behind a platform user. */
  resolveIdentity(input: {
    tenantId: string;
    userId: string;
    personId?: string;
  }): Promise<PlatformIdentity>;
}

/** 激励运营端口：股权/悬赏/追回/不利行动/奖励批次/战略池/台账排除。 */
export interface IncentivePort {
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
  markClawbackRecoveryGenerated(input: {
    tenantId: string;
    caseId: string;
  }): Promise<ClawbackCase>;
  excludeLedgerFromSettlement(input: {
    tenantId: string;
    ledgerIds: string[];
    reason: string;
    actorPersonId: string;
  }): Promise<number>;
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
  /** 人工修正台账入口：只允许在 ACTIVE 状态调整数量/价格/归属参数。 */
  updateEquityGrant(input: {
    tenantId: string;
    grantId: string;
    patch: {
      totalUnits?: string;
      strikePrice?: string;
      grantDate?: string;
      vestingStart?: string;
      cliffMonths?: number;
      vestingMonths?: number;
    };
    reason: string;
    actorPersonId?: string;
  }): Promise<EquityGrant>;
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

  /**
   * 迁移 117/119：记录奖励批次单行支付回执（`payments` 可批量）。
   *
   * 原子性契约（迁移 119）：
   * - PG 在**同一个 DB 事务**内锁批次行（SELECT ... FOR UPDATE）、写支付、
   *   写 PAID 的 GL 凭证、写审计事件；任一步失败整体回滚，Memory 同样
   *   全有或全无；
   * - 批次必须存在且属于该租户（跨租户 → NotFoundError/404）；
   * - ACK 前批次状态必须 LOCKED/EXPORTED；ACKNOWLEDGED 后只接受独立的
   *   RETURNED（退款/退票）记录，普通支付 → ConflictError/409
   *   AWARD_BATCH_ALREADY_ACKNOWLEDGED；
   * - 行必须属于该批次、金额 = 行金额、币种一致，否则 ConflictError/409；
   * - (lineId, paymentRef) 重复提交幂等：返回原回执，不重复累计；
   *   同一 ref 的 status/amount/currency/legalEntityId/accountingPeriod/
   *   creditAccount 任一不同 → ConflictError/409（幂等冲突）；
   * - 每笔 PAID 在支付同一事务内生成借贷平衡的 GL 凭证
   *   （借 INCENTIVE_EXPENSE / 贷 CASH 或 PAYABLE）；FAILED/RETURNED 不生成；
   * - 支付审计事件与支付同事务写入，不允许 best-effort 吞掉。
   */
  recordIncentiveAwardPayments(input: {
    tenantId: string;
    batchId: string;
    actorPersonId: string;
    payments: Array<{
      lineId: string;
      paymentRef: string;
      status: IncentiveAwardPaymentStatus;
      amount: string;
      currency: string;
      paidAt?: string;
      failureCode?: string;
      legalEntityId?: string;
      accountingPeriod?: string;
      creditAccount?: IncentiveAwardPaymentCreditAccount;
    }>;
  }): Promise<{
    payments: IncentiveAwardPayment[];
    reconciliation: IncentiveAwardBatchReconciliation;
    /** 本次真正新落库的支付回执 id（幂等重放时为空）。 */
    createdPaymentIds: string[];
  }>;

  /**
   * 行级已付/未付/差异、GL 完整性与批次对账状态
   * （RECONCILED/PARTIAL/VARIANCE/GL_INCOMPLETE）。
   */
  getIncentiveAwardBatchReconciliation(
    tenantId: string,
    batchId: string,
  ): Promise<IncentiveAwardBatchReconciliation>;

  /** 迁移 119：该批次的支付审计事件（与支付同事务写入，按时间正序）。 */
  listIncentiveAwardPaymentAudits(
    tenantId: string,
    batchId: string,
  ): Promise<IncentiveAwardPaymentAudit[]>;

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
}

/** 集成域端口：连接器/映射/同步排期/外部身份/入站收件箱/电子签署。 */
export interface IntegrationPort {
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
  getSyncRun(tenantId: string, syncRunId: string): Promise<SyncRun>;
  finishSyncRun(input: {
    tenantId: string;
    syncRunId: string;
    status: string;
    recordsSeen: number;
    recordsUpserted: number;
    /** NP-016 / INT-211：精确计数（可选——旧 runner 不传时保持 undefined）。 */
    recordsFetched?: number;
    recordsRawPersisted?: number;
    recordsCreated?: number;
    recordsUpdated?: number;
    recordsDuplicate?: number;
    recordsInvalid?: number;
    recordsQuarantined?: number;
    recordsFailed?: number;
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
  // NP-001（2026-11-21 审计 Wave 1）：资源流 / 检查点 / 隔离区。
  createSyncResource(input: {
    tenantId: string;
    connectionId: string;
    resourceKey: string;
    mappingId?: string;
    scheduleId?: string;
    intervalMinutes?: number;
  }): Promise<SyncResource>;
  listSyncResources(
    tenantId: string,
    connectionId?: string,
  ): Promise<SyncResource[]>;
  getSyncResource(
    tenantId: string,
    resourceId: string,
  ): Promise<SyncResource>;
  getSyncCheckpoint(
    tenantId: string,
    resourceId: string,
  ): Promise<SyncCheckpoint | null>;
  saveSyncCheckpoint(input: {
    tenantId: string;
    resourceId: string;
    /** 缺省 = 保留旧值；null = 清空；字符串 = 更新。 */
    cursor?: string | null;
    watermark?: string | null;
    lastRunId?: string | null;
    /** INT-206：边界防丢重叠窗口（秒）。 */
    overlapSeconds?: number;
    /** INT-205/210：只有当前租约持有人可以推进游标（fencing）。 */
    leaseOwner: string;
    fencingToken: number;
  }): Promise<SyncCheckpoint>;
  recordQuarantineRecord(input: {
    tenantId: string;
    sourceSystem: string;
    externalRecordId?: string;
    reason: string;
    payload?: Record<string, unknown>;
    resolutionNote?: string;
  }): Promise<QuarantineRecord>;
  listQuarantineRecords(
    tenantId: string,
    filter?: { sourceSystem?: string; unresolvedOnly?: boolean },
  ): Promise<QuarantineRecord[]>;
  // INT-209（Sprint 2.1）：隔离区人工处置闭环（resolve + 审计）。
  resolveQuarantineRecord(input: {
    tenantId: string;
    quarantineId: string;
    resolutionNote: string;
    actorPersonId: string;
  }): Promise<QuarantineRecord>;
  // NP-008：外部对象身份解析（opaque 外部 ID → 内部 UUID）。
  upsertExternalObject(input: {
    tenantId: string;
    sourceSystem: string;
    externalObjectType: string;
    externalObjectId: string;
    internalObjectType: string;
    internalObjectId: string;
    matchRule?: string;
    confidence?: number;
    confirmedBy?: string;
  }): Promise<ExternalObjectIdentity>;
  resolveExternalObject(
    tenantId: string,
    sourceSystem: string,
    externalObjectType: string,
    externalObjectId: string,
  ): Promise<ExternalObjectIdentity | null>;
  listExternalObjects(
    tenantId: string,
    filter?: { sourceSystem?: string; externalObjectType?: string },
  ): Promise<ExternalObjectIdentity[]>;
  // NP-009：不透明 webhook 路由键（供应商回调入口，routing key 即租户入口）。
  issueWebhookRoutingKey(input: {
    tenantId: string;
    connectionId: string;
  }): Promise<WebhookRoutingKey>;
  resolveWebhookRoutingKey(
    routingKey: string,
  ): Promise<{ tenantId: string; connectionId: string; provider: string } | null>;
  receiveIntegrationWebhook(input: {
    tenantId: string;
    sourceSystem: string;
    messageId: string;
    payloadHash: string;
    rawPayloadEncrypted: string;
  }): Promise<WebhookInboxMessage>;
  // NP-020：原始落地（append-only；payload 密文）。
  appendRawSourceRecord(input: {
    tenantId: string;
    sourceSystem: string;
    externalRecordId: string;
    payloadEncrypted: string;
    payloadHash?: string;
    sourceVersion?: string;
    mappingVersion?: number;
    retentionClass?: "DEFAULT" | "PII" | "FINANCIAL";
    resourceId?: string;
    sourceUpdatedAt?: string;
  }): Promise<RawSourceRecord>;
  listRawSourceRecords(
    tenantId: string,
    filter?: { sourceSystem?: string; replayedOnly?: boolean },
  ): Promise<RawSourceRecord[]>;
  getRawSourceRecord(
    tenantId: string,
    id: string,
  ): Promise<RawSourceRecord>;
  markRawSourceRecordReplayed(
    tenantId: string,
    id: string,
  ): Promise<RawSourceRecord>;
  // NP-021：资源级租约（fencing token 递增；持有期内他人 409）。
  claimResourceSyncLease(input: {
    tenantId: string;
    resourceId: string;
    leaseOwner: string;
    leaseSeconds: number;
  }): Promise<{ fencingToken: number; leaseUntil: string }>;
  releaseResourceSyncLease(input: {
    tenantId: string;
    resourceId: string;
    leaseOwner: string;
    fencingToken: number;
  }): Promise<void>;
  /** INT-205：心跳续约——owner+token 匹配且未过期时延长租期，不递增 token。 */
  renewResourceSyncLease(input: {
    tenantId: string;
    resourceId: string;
    leaseOwner: string;
    fencingToken: number;
    leaseSeconds: number;
  }): Promise<{ fencingToken: number; leaseUntil: string }>;
  // NP-027：身份生命周期。
  unlinkExternalObject(input: {
    tenantId: string;
    sourceSystem: string;
    externalObjectType: string;
    externalObjectId: string;
    reason: string;
    actorPersonId: string;
  }): Promise<ExternalObjectIdentity>;
  mergeExternalObjects(input: {
    tenantId: string;
    sourceSystem: string;
    externalObjectType: string;
    keepExternalObjectId: string;
    mergeExternalObjectIds: string[];
    actorPersonId: string;
  }): Promise<{ merged: number; internalObjectId: string }>;
  listExternalObjects(
    tenantId: string,
    filter?: { sourceSystem?: string; externalObjectType?: string; includeUnlinked?: boolean },
  ): Promise<ExternalObjectIdentity[]>;
}

/** 模型治理端口：供应商策略/金标集/评测门禁/提示词/红队/AI 提案/受限工作流。 */
export interface ModelgovPort {
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
}

/** 制度治理端口：制度版本/公告/咨询/测试用例/规则变更单/策略引擎记录。 */
export interface PolicygovPort {
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
}

/**
 * 绩效评分快照消费端口（IncentiveStore 侧能力，policy 路由按需收窄）。
 *
 * 评分把「事实」从可复用快照变成一次性凭证：同一存储方法内完成
 * FROZEN → CONSUMED 的状态校验与写入，并记录消费它的评分记录 id。
 * 记录落库失败时由路由调用 release 回滚，保证「记录没写成，快照就不算消费」。
 */
export type ConsumedMetricMeasurementSnapshot = MetricMeasurementSnapshot & {
  /** 消费该快照的 PERFORMANCE_SCORE 记录 id（物理列 consumed_by_record_id）。 */
  consumedByRecordId?: string;
  /** 执行消费的认证人员。 */
  consumedByPersonId?: string;
  /** 消费时间（ISO 8601）。 */
  consumedAt?: string;
};

export interface MetricSnapshotConsumptionPort {
  consumeMetricMeasurementSnapshotForScore(input: {
    snapshotId: string;
    consumedByRecordId: string;
    consumedByPersonId: string;
  }): Promise<ConsumedMetricMeasurementSnapshot>;
  releaseMetricMeasurementSnapshotConsumption(input: {
    snapshotId: string;
    consumedByRecordId: string;
  }): Promise<ConsumedMetricMeasurementSnapshot>;
}

/** 结算薪酬端口：工资单/薪酬模板/法定扣款/结算导出。 */
export interface SettlementPort {
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
}

/** 租户与计费端口：租户/设置/计划/订阅/发票/席位/成员关系。 */
export interface TenantPort {
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
  linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson>;
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
  setPersonManager(input: {
    tenantId: string;
    personId: string;
    managerPersonId: string | null;
  }): Promise<PlatformPerson>;
}

/**
 * Ticketing 工作项端口（114）：投递（PingCode/通用 Ticketing）→ 规范工作项。
 *
 * - 导入按 (tenant, source, externalId) 幂等；状态变化才追加 append-only 事件；
 * - 贡献是多人分摊（person + role），重复导入更新而不是新增；
 * - 读取按项目过滤，personId 匹配负责人或任一贡献人（贡献归集视图）；
 * - 导入缺省的可选字段表示“本次来源未提供”，保留既有值而不是清空。
 */
export interface WorkItemPort {
  importWorkItem(input: WorkItemImportInput): Promise<WorkItemImportResult>;
  listWorkItems(tenantId: string, filter?: WorkItemFilter): Promise<WorkItem[]>;
  getWorkItem(
    tenantId: string,
    workItemId: string,
  ): Promise<{
    workItem: WorkItem;
    events: WorkItemEvent[];
    contributions: WorkItemContribution[];
  }>;
}

/**
 * 通用 JEV Decision Record 端口（118）：五类决策（绩效/贡献/申诉/激励资格/
 * 预算）共用一条链路，kind 只改变上下文，不改变不变量。
 *
 * - 证据 append-only，contentHash 由服务端重算校验；
 * - 判断 append-only，同一 (case, actorType, actorId) 一人一判；
 * - 校验记录 append-only，只有最新一次 passed=true 才允许决定；
 * - record 一案一条，不可改；重复决定必须失败。
 */
export interface DecisionPort {
  createDecisionCase(input: CreateDecisionCaseInput): Promise<DecisionCase>;
  appendDecisionEvidence(
    input: AppendDecisionEvidenceInput,
  ): Promise<DecisionEvidence>;
  submitDecisionJudgment(
    input: SubmitDecisionJudgmentInput,
  ): Promise<DecisionJudgment>;
  recordDecisionVerification(
    input: RecordDecisionVerificationInput,
  ): Promise<DecisionVerification>;
  /** 业务对象（评价/贡献/申诉/资格/预算）引用 caseId；GET 详情回传 links。 */
  linkDecisionCase(input: LinkDecisionCaseInput): Promise<DecisionCaseLink>;
  decideDecisionCase(input: DecideDecisionCaseInput): Promise<DecisionRecord>;
  getDecisionCase(
    tenantId: string,
    caseId: string,
  ): Promise<DecisionCaseDetail>;
}
