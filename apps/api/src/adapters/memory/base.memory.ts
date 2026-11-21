/**
 * NPV2-013：MemoryPlatformStore 共享基类（字段 + 跨端口助手；方法体逐字平移，可见性放宽为 protected）。
 */
import type {
    ApprovalPort,
  AssessmentPort,
  BudgetPort,
  CommsPort,
  DatagovPort,
  DeliveryPort,
  DirectoryPort,
  IdentityPort,
  IncentivePort,
  IntegrationPort,
  ModelgovPort,
  PolicygovPort,
  SettlementPort,
  TenantPort
} from "../../store-ports.js";
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
  ExternalObjectIdentity,
  QuarantineRecord,
  SyncCheckpoint,
  WebhookRoutingKey,
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
} from "@anari/domain";
import { adverseActionTransitions, assertTransition } from "@anari/domain";
import { ConflictError, NotFoundError } from "../../store.js";
import type { PlatformStore } from "../../platform-store.js";
import { formatInvoiceAmount, now, notFound, surveyAverage, aggregateSurveyReport, iso, isoDate, decimalText, addUtcMonths, computeEquityVesting, money } from "../shared.js";

export class MemoryPlatformStoreBase {
    protected readonly commandLocks = new Map<string, Promise<void>>();
    protected readonly tenants = new Map<string, PlatformTenant>();
    protected readonly users = new Map<string, PlatformUser>();
    protected readonly memberships = new Map<string, PlatformMembership>();
    protected readonly persons = new Map<string, PlatformPerson>();
    protected readonly orgNodes = new Map<string, PlatformOrgNode>();
    protected readonly orgAssignments = new Map<string, PlatformOrgAssignment>();
    protected readonly notices = new Map<string, EmployeeNotice>();
    protected readonly acknowledgements = new Map<string, PolicyAcknowledgement>();
    protected readonly representations = new Map<string, EmployeeRepresentation>();
    protected readonly consultations = new Map<string, PolicyConsultation>();
    protected readonly dpias = new Map<string, DpiaRecord>();
    protected readonly dsars = new Map<string, DsarRequest>();
    protected readonly retentionPolicies = new Map<string, RetentionPolicy>();
    protected readonly retentionDisposals = new Map<
    string,
    RetentionDisposalRequest
  >();
    protected readonly workforceSubgroupAttributes = new Map<
    string,
    WorkforceSubgroupAttribute
  >();
    protected readonly appealEvidenceDisclosures = new Map<
    string,
    AppealEvidenceDisclosure
  >();
    protected readonly dataSources = new Map<string, DataSource>();
    protected readonly conflictDeclarations = new Map<
    string,
    ConflictDeclaration
  >();
    protected readonly trustSurveys = new Map<string, TrustSurveyRun>();
    protected readonly trustSurveyResponses = new Map<
    string,
    TrustSurveyResponse
  >();
    protected readonly fairnessCommitments = new Map<
    string,
    FairnessCommitment
  >();
    protected readonly managerTrainingRecords = new Map<
    string,
    ManagerTrainingRecord
  >();
    protected readonly calibrationSessions = new Map<
    string,
    CalibrationSession
  >();
    protected readonly pilotEnrollments = new Map<string, PilotEnrollment>();
    protected readonly compensationTemplates = new Map<
    string,
    CompensationTemplate
  >();
    protected readonly esignEnvelopes = new Map<string, ESignEnvelope>();
    protected readonly breakGlassGrants = new Map<string, BreakGlassGrant>();
    protected readonly clawbackCases = new Map<string, ClawbackCase>();
    protected readonly discretionaryPoolReviews = new Map<
    string,
    DiscretionaryPoolReview
  >();
    protected readonly modelProviderPolicies = new Map<
    string,
    ModelProviderPolicy
  >();
    protected readonly modelEvaluationDatasets = new Map<
    string,
    ModelEvaluationDataset
  >();
    protected readonly modelCanaryRuns = new Map<string, ModelCanaryRun>();
    protected readonly auditRedactions = new Map<string, AuditRedaction>();
    protected readonly modelRedTeamRuns = new Map<string, ModelRedTeamRun>();
    protected readonly approvalRequests = new Map<string, ApprovalRequest>();
    protected readonly approvalDecisions = new Map<string, ApprovalDecision>();
    protected readonly settlementExports = new Map<string, SettlementExport>();
    protected readonly settlementAcknowledgements = new Map<
    string,
    SettlementAcknowledgement
  >();
    protected readonly budgetPools = new Map<string, BudgetPool>();
    protected readonly budgetAllocations = new Map<string, BudgetAllocation>();
    protected readonly cashGateInputs = new Map<string, CashGateInput>();
    protected readonly financialFacts = new Map<string, FinancialFact>();
    protected readonly ruleChangeOrders = new Map<string, RuleChangeOrder>();
    protected readonly policyTestCases = new Map<string, PolicyTestCase>();
    protected readonly policyTestRuns = new Map<string, PolicyTestRun>();
    protected readonly policyNotices = new Map<string, PolicyNotice>();
    protected readonly metricDefinitions = new Map<string, MetricDefinition>();
    protected readonly deliverables = new Map<string, Deliverable>();
    protected readonly acceptances = new Map<string, Acceptance>();
    protected readonly aiSuggestions = new Map<string, AiSuggestionLog>();
    protected readonly modelEvaluationRuns = new Map<string, ModelEvaluationRun>();
    protected readonly modelPrompts = new Map<string, ModelPrompt>();
    protected readonly aiScoreProposals = new Map<string, AiScoreProposal>();
    protected readonly workflowRuns = new Map<string, WorkflowRun>();
    protected readonly integrationConnections = new Map<
    string,
    IntegrationConnection
  >();
    protected readonly integrationMappings = new Map<
    string,
    IntegrationMapping
  >();
    protected readonly syncSchedules = new Map<string, SyncSchedule>();
    protected readonly equityGrants = new Map<string, EquityGrant>();
    protected readonly equityExercises = new Map<string, EquityExercise>();
    protected readonly bounties = new Map<string, Bounty>();
    protected readonly policyEngineRecords = new Map<string, PolicyEngineRecord>();
    protected readonly incentiveAwardBatches = new Map<string, IncentiveAwardBatch>();
    protected readonly employmentContracts = new Map<
    string,
    EmploymentContract
  >();
    protected readonly adverseActions = new Map<string, AdverseActionCase>();
    protected readonly contractAmendments = new Map<
    string,
    EmploymentContractAmendment[]
  >();
    protected readonly payrollRuns = new Map<string, PayrollRun>();
    protected readonly payrollLines = new Map<string, PayrollLine[]>();
    protected readonly syncRuns = new Map<string, SyncRun>();
    protected readonly syncResources = new Map<string, SyncResource>();
    protected readonly syncCheckpoints = new Map<string, SyncCheckpoint>();
    protected readonly quarantineRecords = new Map<string, QuarantineRecord>();
    protected readonly externalObjects = new Map<string, ExternalObjectIdentity>();
    protected readonly webhookRoutingKeys = new Map<string, WebhookRoutingKey>();
    protected readonly externalIdentities = new Map<string, ExternalIdentity>();
    protected readonly webhooks = new Map<string, WebhookInboxMessage>();
    protected readonly inboxMessages = new Map<string, InboxMessage>();
    protected readonly subscriptionPlans = new Map<string, SubscriptionPlan>();
    protected readonly tenantSubscriptions = new Map<string, TenantSubscription>();
    protected readonly invoices = new Map<string, TenantInvoice>();
    protected readonly strategicPoolCases = new Map<string, StrategicPoolCase>();
    protected readonly userPasswordHashes = new Map<string, string>();

  
  constructor(
    options: {
      /** Seed a demo tenant (and optional people) for memory-mode demos. */
      demoTenant?: {
        id: string;
        name: string;
        slug: string;
        /** AUD-017：扩展模块 capability（缺省 = P0-only）。 */
        modules?: string[];
        /** D-07：是否已获正式结算 GO（demo 缺省 true）。 */
        settlementGo?: boolean;
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
      // AUD-017：demo/pilot 租户缺省开启扩展域（与 db/seed/001_demo.sql 一致）；
      // 显式传 modules: [] 即 P0-only（新租户生产默认）。
      settings: {
        modules:
          demo.modules ?? ["PAYROLL", "EQUITY", "STRATEGIC_POOL"],
        // D-07：演示/试点租户已获结算 GO；新建租户默认只跑影子结算。
        settlementGo: demo.settlementGo ?? true,
      },
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
  
  protected nextInvoiceNumber(
    this: MemoryPlatformStoreBaseShape,tenantId: string): string {
    const yearMonth = new Date().toISOString().slice(0, 7).replace("-", "");
    const count =
      [...this.invoices.values()].filter(
        (invoice) => invoice.tenantId === tenantId,
      ).length + 1;
    return `INV-${yearMonth}-${String(count).padStart(4, "0")}`;
  }
  
  protected async withCommandLock<T>(
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = this.commandLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => gate);
    this.commandLocks.set(key, chained);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (this.commandLocks.get(key) === chained) {
        this.commandLocks.delete(key);
      }
    }
  }
  
  protected async commandIncentiveAwardBatchUnlocked(
    this: MemoryPlatformStoreBaseShape,input: {
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
      input.command === "CANCEL" &&
      !["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(batch.status)
    ) {
      throw new ConflictError(
        `cannot CANCEL incentive award batch after it is ${batch.status}`,
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
  
  async amendEmploymentContract(
    this: MemoryPlatformStoreBaseShape,input: {
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
  
  protected assertUserNotLinked(
    this: MemoryPlatformStoreBaseShape,
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

/** 基类形状：字段 + 全部端口方法（供 mixin 内 this 类型检查）。 */
export type MemoryPlatformStoreBaseShape = MemoryPlatformStoreBase & PlatformStore;
