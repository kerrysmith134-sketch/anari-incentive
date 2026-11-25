/**
 * NPV2-013：预算与财务 Adapter（BudgetPort，方法体逐字平移）。
 */
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
  AccountingPeriod,
  AccountingPeriodChangeRequest,
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
import { ConflictError, NotFoundError } from "../../store.js";
import type { PlatformStore } from "../../platform-store.js";
import { formatInvoiceAmount, now, notFound, surveyAverage, aggregateSurveyReport, iso, isoDate, decimalText, addUtcMonths, computeEquityVesting, money } from "../shared.js";
import type { BudgetPort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryBudgetMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements BudgetPort {
    
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
      documentType?: FinancialFact["documentType"];
      documentId?: string;
      relatedFactId?: string;
      fxRate?: string;
      functionalCurrency?: string;
      functionalAmount?: string;
    }): Promise<FinancialFact> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const recognitionStatus = input.recognitionStatus ?? "DRAFT";
      if (
        recognitionStatus === "POSTED" &&
        (!input.legalEntityId ||
          !input.accountingPeriod ||
          !input.instrumentType ||
          !input.sourceVersion)
      ) {
        throw new ConflictError(
          "POSTED_FACT_REQUIRED_FIELDS: POSTED requires legalEntityId, accountingPeriod, instrumentType and sourceVersion",
        );
      }
      if (recognitionStatus === "POSTED" && !input.orderId && !input.contractRef) {
        throw new ConflictError(
          "FACT_NOT_TRACEABLE: POSTED facts require orderId or contractRef",
        );
      }
      if (input.documentId && !input.documentType) {
        throw new ConflictError(
          "DOCUMENT_TYPE_REQUIRED: documentId requires documentType",
        );
      }
      // 迁移 111：跨币种 POSTED 事实必须带汇率与功能币金额。服务端用
      // 1e6 定点 BigInt 重算功能币金额，客户端传入值不一致即拒绝。
      if (recognitionStatus === "POSTED" && input.functionalCurrency) {
        const functionalCurrency = input.functionalCurrency.trim();
        if (!/^[A-Z]{3}$/.test(functionalCurrency)) {
          throw new ConflictError(
            `INVALID_FUNCTIONAL_CURRENCY: ${input.functionalCurrency}`,
          );
        }
        if (input.currency !== functionalCurrency) {
          if (!input.fxRate || !input.functionalAmount) {
            throw new ConflictError(
              "FX_FIELDS_REQUIRED: POSTED facts whose currency differs from functionalCurrency require fxRate and functionalAmount",
            );
          }
          if (parseDecimal(input.fxRate) <= 0n) {
            throw new ConflictError(
              `INVALID_FX_RATE: ${input.fxRate}`,
            );
          }
          const expected = formatDecimal(
            divRound(
              parseDecimal(input.amount) * parseDecimal(input.fxRate),
              1_000_000n,
              "HALF_UP",
            ),
          );
          if (expected !== formatDecimal(parseDecimal(input.functionalAmount))) {
            throw new ConflictError(
              `FUNCTIONAL_AMOUNT_INCONSISTENT: expected ${expected} ${functionalCurrency} for ${input.amount} ${input.currency} @ ${input.fxRate}, got ${input.functionalAmount}`,
            );
          }
        } else if (
          input.functionalAmount !== undefined &&
          parseDecimal(input.functionalAmount) !== parseDecimal(input.amount)
        ) {
          throw new ConflictError(
            `FUNCTIONAL_AMOUNT_INCONSISTENT: same-currency fact must have functionalAmount equal to amount (${input.amount}), got ${input.functionalAmount}`,
          );
        }
      }
      if (recognitionStatus === "POSTED") {
        if (!input.legalEntityId || !input.accountingPeriod) {
          throw new ConflictError(
            "PERIOD_REQUIRED: POSTED financial facts require legalEntityId and accountingPeriod",
          );
        }
        const periodKey = [
          input.tenantId,
          input.legalEntityId,
          input.accountingPeriod,
        ].join(":");
        let period = this.accountingPeriods.get(periodKey);
        if (!period) {
          const timestamp = now();
          period = {
            id: randomUUID(),
            tenantId: input.tenantId,
            legalEntityId: input.legalEntityId,
            period: input.accountingPeriod,
            status: "OPEN",
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          this.accountingPeriods.set(periodKey, period);
        }
        if (period.status === "CLOSED") {
          throw new ConflictError(
            `PERIOD_CLOSED: ${input.legalEntityId}/${input.accountingPeriod} is closed`,
          );
        }
        if (period.reopeningRef && input.reopeningRef !== period.reopeningRef) {
          throw new ConflictError(
            `REOPENING_REF_REQUIRED: period ${input.legalEntityId}/${input.accountingPeriod} ` +
              `was reopened as ${period.reopeningRef}; POSTED fact must carry the same reopeningRef`,
          );
        }
      } else if (input.reopeningRef) {
        throw new ConflictError(
          "REOPENING_REF_NOT_ALLOWED: reopeningRef is only valid for POSTED facts",
        );
      }

      const key = [
        input.tenantId,
        input.sourceSystem,
        input.sourceRecordId,
        input.factType,
      ].join(":");
      const existing = this.financialFacts.get(key);
      if (existing) {
        if (
          existing.recognitionStatus === "POSTED" &&
          recognitionStatus === "DRAFT"
        ) {
          throw new ConflictError(
            `RECOGNITION_STATUS_REGRESSION: ${input.sourceSystem}/${input.sourceRecordId}/${input.factType} is already POSTED; a DRAFT snapshot cannot un-post it`,
          );
        }
        if (
          existing.legalEntityId &&
          input.legalEntityId &&
          existing.legalEntityId !== input.legalEntityId
        ) {
          throw new ConflictError(
            `LEGAL_ENTITY_MISMATCH: ${input.sourceSystem}/${input.sourceRecordId}/${input.factType} belongs to ${existing.legalEntityId}, not ${input.legalEntityId}`,
          );
        }
        if (
          existing.accountingPeriod &&
          input.accountingPeriod &&
          existing.accountingPeriod !== input.accountingPeriod
        ) {
          throw new ConflictError(
            `ACCOUNTING_PERIOD_MISMATCH: ${input.sourceSystem}/${input.sourceRecordId}/${input.factType} belongs to ${existing.accountingPeriod}, not ${input.accountingPeriod}`,
          );
        }
      }
      // 迁移 111：同一租户内 (document_type, document_id) 唯一。
      if (input.documentId) {
        const duplicate = [...this.financialFacts.values()].find(
          (fact) =>
            fact.tenantId === input.tenantId &&
            fact.documentType === input.documentType &&
            fact.documentId === input.documentId &&
            fact.id !== existing?.id,
        );
        if (duplicate) {
          throw new ConflictError(
            `DUPLICATE_FINANCIAL_DOCUMENT: ${input.documentType ?? "DOCUMENT"}/${input.documentId} already exists`,
          );
        }
      }
      // INT-208（Sprint 2.1 财务红线）：迟到的旧快照不得覆盖新快照——
      // 同键且两侧均携带 sourceUpdatedAt 时，旧时间戳 → 409 STALE_FINANCIAL_FACT。
      if (
        existing &&
        input.sourceUpdatedAt &&
        existing.sourceUpdatedAt &&
        input.sourceUpdatedAt < existing.sourceUpdatedAt
      ) {
        throw new ConflictError(
          `STALE_FINANCIAL_FACT: incoming snapshot (${input.sourceUpdatedAt}) is older than current (${existing.sourceUpdatedAt}) for ${input.sourceSystem}/${input.sourceRecordId}/${input.factType}`,
        );
      }
      // 旧值进修订账本（append-only 语义：Memory 用数组模拟 101/105/111 表）。
      if (existing) {
        const revisions = this.financialFactRevisions.get(existing.id) ?? [];
        // 用变量承载 111 新列，避免修改 base.memory 的修订账本类型。
        const revisionEntry = {
          revision: revisions.length + 1,
          amount: existing.amount,
          currency: existing.currency,
          periodStart: existing.periodStart,
          periodEnd: existing.periodEnd,
          qualityStatus: existing.qualityStatus,
          sourceUpdatedAt: existing.sourceUpdatedAt,
          payload: existing.payload,
          createdAt: now(),
          legalEntityId: existing.legalEntityId,
          orderId: existing.orderId,
          contractRef: existing.contractRef,
          instrumentType: existing.instrumentType,
          recognitionStatus: existing.recognitionStatus,
          accountingPeriod: existing.accountingPeriod,
          fxSnapshot: existing.fxSnapshot,
          sourceVersion: existing.sourceVersion,
          reversalOf: existing.reversalOf,
          reopeningRef: existing.reopeningRef,
          documentType: existing.documentType,
          documentId: existing.documentId,
          relatedFactId: existing.relatedFactId,
          fxRate: existing.fxRate,
          functionalCurrency: existing.functionalCurrency,
          functionalAmount: existing.functionalAmount,
        };
        revisions.push(revisionEntry);
        this.financialFactRevisions.set(existing.id, revisions);
      }
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
        recognitionStatus,
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
      fact.legalEntityId = input.legalEntityId;
      fact.orderId = input.orderId;
      fact.contractRef = input.contractRef;
      fact.instrumentType = input.instrumentType;
      fact.recognitionStatus = recognitionStatus;
      fact.accountingPeriod = input.accountingPeriod;
      fact.fxSnapshot = input.fxSnapshot;
      fact.sourceVersion = input.sourceVersion;
      fact.reversalOf = input.reversalOf;
      fact.reopeningRef = input.reopeningRef;
      fact.documentType = input.documentType;
      fact.documentId = input.documentId;
      fact.relatedFactId = input.relatedFactId;
      fact.fxRate = input.fxRate === undefined
        ? undefined
        : formatDecimal(parseDecimal(input.fxRate));
      fact.functionalCurrency = input.functionalCurrency?.trim();
      fact.functionalAmount = input.functionalAmount === undefined
        ? undefined
        : formatDecimal(parseDecimal(input.functionalAmount));
      this.financialFacts.set(key, fact);
      return fact;
    }

    async getFinancialFact(
      tenantId: string,
      factId: string,
    ): Promise<FinancialFact> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      const fact = [...this.financialFacts.values()].find(
        (candidate) =>
          candidate.tenantId === tenantId && candidate.id === factId,
      );
      if (!fact) notFound("FinancialFact", factId);
      return fact;
    }
    
    async listFinancialFacts(
      tenantId: string,
      filter?: {
        factType?: string;
        sourceSystem?: string;
        legalEntityId?: string;
        accountingPeriod?: string;
        recognitionStatus?: FinancialFact["recognitionStatus"];
        orderId?: string;
        contractRef?: string;
        documentType?: FinancialFact["documentType"];
        documentId?: string;
        relatedFactId?: string;
      },
    ): Promise<FinancialFact[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.financialFacts.values()]
        .filter(
          (fact) =>
            fact.tenantId === tenantId &&
            (!filter?.factType || fact.factType === filter.factType) &&
            (!filter?.sourceSystem ||
              fact.sourceSystem === filter.sourceSystem) &&
            (!filter?.legalEntityId ||
              fact.legalEntityId === filter.legalEntityId) &&
            (!filter?.accountingPeriod ||
              fact.accountingPeriod === filter.accountingPeriod) &&
            (!filter?.recognitionStatus ||
              fact.recognitionStatus === filter.recognitionStatus) &&
            (!filter?.orderId || fact.orderId === filter.orderId) &&
            (!filter?.contractRef ||
              fact.contractRef === filter.contractRef) &&
            (!filter?.documentType ||
              fact.documentType === filter.documentType) &&
            (!filter?.documentId || fact.documentId === filter.documentId) &&
            (!filter?.relatedFactId ||
              fact.relatedFactId === filter.relatedFactId),
        )
        .sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt));
    }

    async listAccountingPeriods(
      tenantId: string,
      filter?: { legalEntityId?: string; period?: string },
    ): Promise<AccountingPeriod[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.accountingPeriods.values()]
        .filter(
          (period) =>
            period.tenantId === tenantId &&
            (!filter?.legalEntityId ||
              period.legalEntityId === filter.legalEntityId) &&
            (!filter?.period || period.period === filter.period),
        )
        .sort(
          (a, b) =>
            b.period.localeCompare(a.period) ||
            a.legalEntityId.localeCompare(b.legalEntityId),
        );
    }

    async getAccountingPeriod(
      tenantId: string,
      legalEntityId: string,
      period: string,
    ): Promise<AccountingPeriod | null> {
      const key = [tenantId, legalEntityId, period].join(":");
      const found = this.accountingPeriods.get(key);
      return found && found.tenantId === tenantId ? found : null;
    }

    async createAccountingPeriodChangeRequest(input: {
      tenantId: string;
      legalEntityId: string;
      period: string;
      action: "CLOSE" | "REOPEN";
      requestedBy: string;
      reason?: string;
      reopeningRef?: string;
    }): Promise<AccountingPeriodChangeRequest> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
        throw new ConflictError("INVALID_ACCOUNTING_PERIOD");
      }
      if (input.action === "REOPEN" && !input.reopeningRef) {
        throw new ConflictError("REOPENING_REF_REQUIRED");
      }
      const key = [input.tenantId, input.legalEntityId, input.period].join(":");
      const current = this.accountingPeriods.get(key);
      if (input.action === "CLOSE" && current?.status === "CLOSED") {
        throw new ConflictError("PERIOD_ALREADY_CLOSED");
      }
      if (input.action === "REOPEN" && current?.status !== "CLOSED") {
        throw new ConflictError("PERIOD_NOT_CLOSED");
      }
      const duplicate = [...this.accountingPeriodChangeRequests.values()].find(
        (request) =>
          request.tenantId === input.tenantId &&
          request.legalEntityId === input.legalEntityId &&
          request.period === input.period &&
          request.action === input.action &&
          request.status === "PENDING",
      );
      if (duplicate) return duplicate;
      const timestamp = now();
      const request: AccountingPeriodChangeRequest = {
        id: randomUUID(),
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        period: input.period,
        action: input.action,
        status: "PENDING",
        requestedBy: input.requestedBy,
        requestedAt: timestamp,
        reason: input.reason ?? null,
        reopeningRef: input.reopeningRef ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.accountingPeriodChangeRequests.set(request.id, request);
      return request;
    }

    async listAccountingPeriodChangeRequests(
      tenantId: string,
      filter?: {
        legalEntityId?: string;
        period?: string;
        status?: AccountingPeriodChangeRequest["status"];
      },
    ): Promise<AccountingPeriodChangeRequest[]> {
      return [...this.accountingPeriodChangeRequests.values()]
        .filter(
          (request) =>
            request.tenantId === tenantId &&
            (!filter?.legalEntityId ||
              request.legalEntityId === filter.legalEntityId) &&
            (!filter?.period || request.period === filter.period) &&
            (!filter?.status || request.status === filter.status),
        )
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    }

    async decideAccountingPeriodChange(input: {
      tenantId: string;
      requestId: string;
      approverPersonId: string;
      decision: "APPROVE" | "REJECT";
      note?: string;
    }): Promise<{
      request: AccountingPeriodChangeRequest;
      period?: AccountingPeriod;
    }> {
      const request = this.accountingPeriodChangeRequests.get(input.requestId);
      if (!request || request.tenantId !== input.tenantId) {
        notFound("AccountingPeriodChangeRequest", input.requestId);
      }
      if (request.status !== "PENDING") {
        throw new ConflictError(`APPROVAL_NOT_PENDING: ${request.status}`);
      }
      if (request.requestedBy === input.approverPersonId) {
        throw new ConflictError(
          "APPROVAL_SEPARATION_REQUIRED: requester and approver must be different people",
        );
      }
      let period: AccountingPeriod | undefined;
      if (input.decision === "APPROVE") {
        period =
          request.action === "CLOSE"
            ? await this.closeAccountingPeriod({
                tenantId: request.tenantId,
                legalEntityId: request.legalEntityId,
                period: request.period,
                actorPersonId: input.approverPersonId,
                reason: request.reason ?? undefined,
              })
            : await this.reopenAccountingPeriod({
                tenantId: request.tenantId,
                legalEntityId: request.legalEntityId,
                period: request.period,
                actorPersonId: input.approverPersonId,
                reopeningRef: request.reopeningRef ?? "",
                reason: request.reason ?? "reopened",
              });
        request.status = "APPROVED";
      } else {
        request.status = "REJECTED";
      }
      request.decidedBy = input.approverPersonId;
      request.decidedAt = now();
      request.decisionNote = input.note ?? null;
      request.updatedAt = now();
      return { request, period };
    }

    async closeAccountingPeriod(input: {
      tenantId: string;
      legalEntityId: string;
      period: string;
      actorPersonId: string;
      reason?: string;
    }): Promise<AccountingPeriod> {
      const key = [input.tenantId, input.legalEntityId, input.period].join(":");
      let found = this.accountingPeriods.get(key);
      if (!found) {
        const timestamp = now();
        found = {
          id: randomUUID(),
          tenantId: input.tenantId,
          legalEntityId: input.legalEntityId,
          period: input.period,
          status: "CLOSED",
          closedAt: timestamp,
          closedBy: input.actorPersonId,
          closeReason: input.reason ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        this.accountingPeriods.set(key, found);
        return found;
      }
      if (found.status !== "OPEN") {
        throw new ConflictError(
          `PERIOD_NOT_OPEN: ${input.legalEntityId}/${input.period} is already closed`,
        );
      }
      found.status = "CLOSED";
      found.closedAt = now();
      found.closedBy = input.actorPersonId;
      found.closeReason = input.reason ?? null;
      found.updatedAt = now();
      return found;
    }

    async reopenAccountingPeriod(input: {
      tenantId: string;
      legalEntityId: string;
      period: string;
      actorPersonId: string;
      reopeningRef: string;
      reason: string;
    }): Promise<AccountingPeriod> {
      const key = [input.tenantId, input.legalEntityId, input.period].join(":");
      const found = this.accountingPeriods.get(key);
      if (!found || found.status !== "CLOSED") {
        throw new ConflictError(
          `PERIOD_NOT_CLOSED: ${input.legalEntityId}/${input.period} is missing or not closed`,
        );
      }
      found.status = "OPEN";
      found.reopenedAt = now();
      found.reopenedBy = input.actorPersonId;
      found.reopeningRef = input.reopeningRef;
      found.reopenReason = input.reason;
      found.updatedAt = now();
      return found;
    }
  };
}
