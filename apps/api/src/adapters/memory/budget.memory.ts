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
  GlAccount,
  GlJournal,
  GlJournalLine,
  AccountingPeriod,
  AccountingPeriodApprover,
  AccountingPeriodApproverResolution,
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
import {
  adverseActionTransitions,
  assertTransition,
  GL_ACCOUNT_SEED,
} from "@anari/domain";
import { ConflictError, NotFoundError } from "../../store.js";
import type { PlatformStore } from "../../platform-store.js";
import { formatInvoiceAmount, now, notFound, surveyAverage, aggregateSurveyReport, iso, isoDate, decimalText, addUtcMonths, computeEquityVesting, money } from "../shared.js";
import type { BudgetPort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryBudgetMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements BudgetPort {
    /** 迁移 112：复式记账内存账本（按租户隔离）。 */
    private readonly glAccounts = new Map<string, GlAccount[]>();
    private readonly glJournals = new Map<string, GlJournal>();
    /** 迁移 113：会计期间审批人目录，key = tenantId:personId。 */
    private readonly accountingPeriodApprovers = new Map<
      string,
      AccountingPeriodApprover
    >();

    private ensureGlAccounts(tenantId: string): GlAccount[] {
      let accounts = this.glAccounts.get(tenantId);
      if (!accounts) {
        const createdAt = now();
        accounts = GL_ACCOUNT_SEED.map((seed) => ({
          id: randomUUID(),
          tenantId,
          code: seed.code,
          name: seed.name,
          accountType: seed.accountType,
          normalBalance: seed.normalBalance,
          createdAt,
        }));
        this.glAccounts.set(tenantId, accounts);
      }
      return accounts;
    }

    async createJournalEntry(input: {
      tenantId: string;
      journalNo?: string;
      documentType: GlJournal["documentType"];
      documentId: string;
      legalEntityId: string;
      accountingPeriod: string;
      currency: string;
      description?: string;
      sourceFactId?: string;
      lines: Array<{ accountCode: string; debit?: string; credit?: string }>;
    }): Promise<GlJournal> {
      if (!this.tenants.has(input.tenantId)) {
        notFound("Tenant", input.tenantId);
      }
      const accounts = this.ensureGlAccounts(input.tenantId);
      const known = new Set(accounts.map((account) => account.code));
      const currency = input.currency.trim();
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new ConflictError(`INVALID_JOURNAL_CURRENCY: ${input.currency}`);
      }
      if (input.lines.length < 2) {
        throw new ConflictError(
          "JOURNAL_LINES_REQUIRED: a journal must have at least two lines",
        );
      }
      let totalDebit = 0n;
      let totalCredit = 0n;
      const normalized = input.lines.map((line, index) => {
        if (!known.has(line.accountCode)) {
          throw new ConflictError(
            `UNKNOWN_GL_ACCOUNT: ${line.accountCode}`,
          );
        }
        const debit = line.debit === undefined ? 0n : parseDecimal(line.debit);
        const credit =
          line.credit === undefined ? 0n : parseDecimal(line.credit);
        if (debit < 0n || credit < 0n) {
          throw new ConflictError(
            `INVALID_JOURNAL_AMOUNT: line ${index + 1} has a negative amount`,
          );
        }
        if ((debit > 0n) === (credit > 0n)) {
          throw new ConflictError(
            `INVALID_JOURNAL_LINE: line ${index + 1} must have exactly one of debit/credit greater than zero`,
          );
        }
        totalDebit += debit;
        totalCredit += credit;
        return {
          accountCode: line.accountCode,
          debit: formatDecimal(debit),
          credit: formatDecimal(credit),
        };
      });
      if (totalDebit !== totalCredit || totalDebit === 0n) {
        throw new ConflictError(
          `JOURNAL_NOT_BALANCED: debits ${formatDecimal(totalDebit)} != credits ${formatDecimal(totalCredit)}`,
        );
      }
      // 幂等：同一业务文档只有一张凭证（重复调用返回既有凭证）。
      const duplicate = [...this.glJournals.values()].find(
        (journal) =>
          journal.tenantId === input.tenantId &&
          journal.documentType === input.documentType &&
          journal.documentId === input.documentId,
      );
      if (duplicate) return duplicate;
      const createdAt = now();
      const journalId = randomUUID();
      const lines: GlJournalLine[] = normalized.map((line, index) => ({
        id: randomUUID(),
        tenantId: input.tenantId,
        journalId,
        lineNo: index + 1,
        accountCode: line.accountCode,
        debit: line.debit,
        credit: line.credit,
        currency,
        createdAt,
      }));
      const journal: GlJournal = {
        id: journalId,
        tenantId: input.tenantId,
        journalNo:
          input.journalNo ??
          `JE-${input.documentType}-${input.documentId}`,
        documentType: input.documentType,
        documentId: input.documentId,
        legalEntityId: input.legalEntityId,
        accountingPeriod: input.accountingPeriod,
        currency,
        description: input.description,
        sourceFactId: input.sourceFactId,
        totalDebit: formatDecimal(totalDebit),
        totalCredit: formatDecimal(totalCredit),
        lines,
        createdAt,
      };
      this.glJournals.set(journal.id, journal);
      return journal;
    }

    async listJournals(
      tenantId: string,
      filter?: {
        documentId?: string;
        documentType?: GlJournal["documentType"];
        legalEntityId?: string;
        accountingPeriod?: string;
        limit?: number;
      },
    ): Promise<GlJournal[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      const limit = filter?.limit ?? 200;
      return [...this.glJournals.values()]
        .filter(
          (journal) =>
            journal.tenantId === tenantId &&
            (!filter?.documentId ||
              journal.documentId === filter.documentId) &&
            (!filter?.documentType ||
              journal.documentType === filter.documentType) &&
            (!filter?.legalEntityId ||
              journal.legalEntityId === filter.legalEntityId) &&
            (!filter?.accountingPeriod ||
              journal.accountingPeriod === filter.accountingPeriod),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    }

    async listGlAccounts(tenantId: string): Promise<GlAccount[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return this.ensureGlAccounts(tenantId);
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
      taxRate?: string;
      taxAmount?: string;
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
      // 迁移 112：税额。taxAmount = amount × taxRate / 100，1e6 定点、
      // HALF_UP；客户端传入的 taxAmount 必须与服务端重算一致（否则 409）。
      const taxRate =
        input.taxRate === undefined
          ? undefined
          : formatDecimal(parseDecimal(input.taxRate));
      let taxAmount =
        input.taxAmount === undefined
          ? undefined
          : formatDecimal(parseDecimal(input.taxAmount));
      if (taxRate !== undefined) {
        const rate = parseDecimal(taxRate);
        if (rate < 0n || rate > 100_000_000n) {
          throw new ConflictError(`INVALID_TAX_RATE: ${input.taxRate}`);
        }
        const expectedTax = formatDecimal(
          divRound(
            parseDecimal(input.amount) * rate,
            100_000_000n,
            "HALF_UP",
          ),
        );
        if (taxAmount === undefined) {
          taxAmount = expectedTax;
        } else if (taxAmount !== expectedTax) {
          throw new ConflictError(
            `TAX_AMOUNT_INCONSISTENT: expected ${expectedTax} for amount ${input.amount} at taxRate ${taxRate}%, got ${input.taxAmount}`,
          );
        }
      }
      if (taxAmount !== undefined && parseDecimal(taxAmount) < 0n) {
        throw new ConflictError(`INVALID_TAX_AMOUNT: ${taxAmount}`);
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
          taxRate: existing.taxRate,
          taxAmount: existing.taxAmount,
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
      fact.taxRate = taxRate;
      fact.taxAmount = taxAmount;
      fact.totalAmount =
        taxAmount === undefined
          ? undefined
          : formatDecimal(parseDecimal(fact.amount) + parseDecimal(taxAmount));
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

    // 迁移 113：会计期间审批人目录（显式目录优先，空目录回退角色）。
    async listAccountingPeriodApprovers(
      tenantId: string,
    ): Promise<AccountingPeriodApprover[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.accountingPeriodApprovers.values()]
        .filter((row) => row.tenantId === tenantId)
        .sort(
          (a, b) =>
            Number(b.active) - Number(a.active) ||
            a.createdAt.localeCompare(b.createdAt) ||
            a.personId.localeCompare(b.personId),
        )
        .map((row) => {
          const person = this.persons.get(row.personId);
          return {
            ...row,
            displayName:
              person?.tenantId === tenantId
                ? person.displayName
                : undefined,
          };
        });
    }

    async replaceAccountingPeriodApprovers(input: {
      tenantId: string;
      personIds: string[];
      updatedBy?: string;
    }): Promise<AccountingPeriodApproverResolution> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const personIds = [...new Set(input.personIds)];
      if (personIds.length === 0) {
        throw new ConflictError("APPROVER_REQUIRED");
      }
      for (const personId of personIds) {
        const person = this.persons.get(personId);
        if (!person || person.tenantId !== input.tenantId) {
          throw new ConflictError(`APPROVER_NOT_IN_TENANT: ${personId}`);
        }
        if (person.employmentStatus !== "ACTIVE") {
          throw new ConflictError(`APPROVER_INACTIVE: ${personId}`);
        }
      }

      const selected = new Set(personIds);
      for (const [key, row] of this.accountingPeriodApprovers) {
        if (row.tenantId !== input.tenantId) continue;
        const active = selected.has(row.personId);
        if (row.active !== active) {
          this.accountingPeriodApprovers.set(key, { ...row, active });
        }
      }
      for (const personId of personIds) {
        const key = `${input.tenantId}:${personId}`;
        if (this.accountingPeriodApprovers.has(key)) continue;
        this.accountingPeriodApprovers.set(key, {
          tenantId: input.tenantId,
          personId,
          active: true,
          createdAt: now(),
        });
      }
      return this.listEffectiveAccountingPeriodApprovers(input.tenantId);
    }

    async listEffectiveAccountingPeriodApprovers(
      tenantId: string,
    ): Promise<AccountingPeriodApproverResolution> {
      const directory = (
        await this.listAccountingPeriodApprovers(tenantId)
      ).filter((row) => row.active);
      const activeDirectory = directory.filter((row) => {
        const person = this.persons.get(row.personId);
        return (
          person?.tenantId === tenantId &&
          person.employmentStatus === "ACTIVE"
        );
      });
      if (activeDirectory.length > 0) {
        return { approvers: activeDirectory, source: "DIRECTORY" };
      }

      // 回退：租户内持有 admin/finance 角色的人员（按成员角色字段）。
      const memberships = await this.listMemberships(tenantId);
      const privilegedUserIds = new Set(
        memberships
          .filter(
            (membership) =>
              membership.status === "ACTIVE" &&
              membership.roleCodes.some(
                (role) => role === "admin" || role === "finance",
              ),
          )
          .map((membership) => membership.userId),
      );
      const fallback = (await this.listPersons(tenantId))
        .filter(
          (person) =>
            person.employmentStatus === "ACTIVE" &&
            person.userId !== undefined &&
            privilegedUserIds.has(person.userId),
        )
        .map((person) => ({
          tenantId,
          personId: person.id,
          active: true,
          createdAt: person.createdAt,
          displayName: person.displayName,
        }));
      return { approvers: fallback, source: "ROLE_FALLBACK" };
    }
  };
}
