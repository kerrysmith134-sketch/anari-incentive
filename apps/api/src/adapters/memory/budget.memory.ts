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
      // 旧值进修订账本（append-only 语义：Memory 用数组模拟 101/105 表）。
      if (existing) {
        const revisions = this.financialFactRevisions.get(existing.id) ?? [];
        revisions.push({
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
        });
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
      this.financialFacts.set(key, fact);
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
              fact.recognitionStatus === filter.recognitionStatus),
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
