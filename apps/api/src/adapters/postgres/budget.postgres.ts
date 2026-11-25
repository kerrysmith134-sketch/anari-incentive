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
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgBudgetMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
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
      const personIds = [
        ...new Set([
          ...input.committeePersonIds,
          ...(input.employeeObserverPersonId
            ? [input.employeeObserverPersonId]
            : []),
          input.reviewedBy,
        ]),
      ];
      const persons = await this.tenantQuery(input.tenantId, 
        `SELECT id FROM people WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
        [input.tenantId, personIds],
      );
      if (persons.rows.length !== personIds.length) {
        throw new NotFoundError(
          `One or more committee, observer or reviewer people not found`,
        );
      }
      const { rows } = await this.tenantQuery(input.tenantId, 
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
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapDiscretionaryPoolReview(row));
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
        const { rows } = await this.tenantQuery(input.tenantId, 
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
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapBudgetPool(row));
    }
    
    async getBudgetPool(tenantId: string, poolId: string): Promise<BudgetPool> {
      const { rows } = await this.tenantQuery(tenantId, 
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
      return this.transactionFor(input.tenantId, async (client) => {
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
      return this.transactionFor(input.tenantId, async (client) => {
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
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM budget_allocations
          WHERE tenant_id=$1 AND budget_pool_id=$2
          ORDER BY created_at DESC`,
        [tenantId, poolId],
      );
      return rows.map((row: QueryResultRow) => this.mapBudgetAllocation(row));
    }
    
    async releaseBudgetAllocation(input: {
      tenantId: string;
      allocationId: string;
    }): Promise<BudgetAllocation> {
      return this.transactionFor(input.tenantId, async (client) => {
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
        const { rows } = await this.tenantQuery(input.tenantId, 
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
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapCashGateInput(row));
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
            throw new ConflictError(`INVALID_FX_RATE: ${input.fxRate}`);
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
          divRound(parseDecimal(input.amount) * rate, 100_000_000n, "HALF_UP"),
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
      try {
        return await this.transactionFor(input.tenantId, async (client) => {
          // Sprint 5：POSTED 事实必须落入一个未关闭的会计期间；关闭期间
          // 仅允许带有匹配 reopeningRef 的重开凭证写入。
          if (recognitionStatus === "POSTED") {
            if (!input.legalEntityId || !input.accountingPeriod) {
              throw new ConflictError(
                "PERIOD_REQUIRED: POSTED financial facts require legalEntityId and accountingPeriod",
              );
            }
            const { rows: periods } = await client.query(
              `SELECT * FROM accounting_periods
                WHERE tenant_id=$1 AND legal_entity_id=$2 AND period=$3
                FOR UPDATE`,
              [input.tenantId, input.legalEntityId, input.accountingPeriod],
            );
            let period = periods[0];
            if (!period) {
              // 首次入账自动开期（OPEN），之后由财务显式 close/reopen。
              const inserted = await client.query(
                `INSERT INTO accounting_periods
                   (tenant_id, legal_entity_id, period, status)
                 VALUES ($1,$2,$3,'OPEN')
                 ON CONFLICT (tenant_id, legal_entity_id, period) DO NOTHING
                 RETURNING *`,
                [input.tenantId, input.legalEntityId, input.accountingPeriod],
              );
              period = inserted.rows[0];
              if (!period) {
                const again = await client.query(
                  `SELECT * FROM accounting_periods
                    WHERE tenant_id=$1 AND legal_entity_id=$2 AND period=$3
                    FOR UPDATE`,
                  [input.tenantId, input.legalEntityId, input.accountingPeriod],
                );
                period = again.rows[0];
              }
            }
            if (period?.status === "CLOSED") {
              throw new ConflictError(
                `PERIOD_CLOSED: ${input.legalEntityId}/${input.accountingPeriod} is closed`,
              );
            }
            if (
              period?.reopening_ref &&
              input.reopeningRef !== period.reopening_ref
            ) {
              throw new ConflictError(
                `REOPENING_REF_REQUIRED: period ${input.legalEntityId}/${input.accountingPeriod} ` +
                  `was reopened as ${period.reopening_ref}; POSTED fact must carry the same reopeningRef`,
              );
            }
          } else if (input.reopeningRef) {
            throw new ConflictError(
              "REOPENING_REF_NOT_ALLOWED: reopeningRef is only valid for POSTED facts",
            );
          }

          // INT-208（Sprint 2.1 财务红线）：迟到旧快照不得覆盖新快照。
          const { rows: current } = await client.query(
            `SELECT * FROM financial_facts
              WHERE tenant_id=$1 AND source_system=$2
                AND source_record_id=$3 AND fact_type=$4
              FOR UPDATE`,
            [input.tenantId, input.sourceSystem, input.sourceRecordId, input.factType],
          );
          const existing = current[0];
          if (existing) {
            if (
              existing.recognition_status === "POSTED" &&
              recognitionStatus === "DRAFT"
            ) {
              throw new ConflictError(
                `RECOGNITION_STATUS_REGRESSION: ${input.sourceSystem}/${input.sourceRecordId}/${input.factType} is already POSTED; a DRAFT snapshot cannot un-post it`,
              );
            }
            if (
              existing.legal_entity_id &&
              input.legalEntityId &&
              existing.legal_entity_id !== input.legalEntityId
            ) {
              throw new ConflictError(
                `LEGAL_ENTITY_MISMATCH: ${input.sourceSystem}/${input.sourceRecordId}/${input.factType} belongs to ${existing.legal_entity_id}, not ${input.legalEntityId}`,
              );
            }
            if (
              existing.accounting_period &&
              input.accountingPeriod &&
              existing.accounting_period !== input.accountingPeriod
            ) {
              throw new ConflictError(
                `ACCOUNTING_PERIOD_MISMATCH: ${input.sourceSystem}/${input.sourceRecordId}/${input.factType} belongs to ${existing.accounting_period}, not ${input.accountingPeriod}`,
              );
            }
          }
          // 迁移 111：同一租户内 (document_type, document_id) 唯一。
          if (input.documentId) {
            const { rows: duplicate } = await client.query(
              `SELECT id FROM financial_facts
                WHERE tenant_id=$1 AND document_type=$2 AND document_id=$3
                LIMIT 1`,
              [input.tenantId, input.documentType, input.documentId],
            );
            if (duplicate[0] && duplicate[0].id !== existing?.id) {
              throw new ConflictError(
                `DUPLICATE_FINANCIAL_DOCUMENT: ${input.documentType ?? "DOCUMENT"}/${input.documentId} already exists`,
              );
            }
          }
          if (
            existing &&
            input.sourceUpdatedAt &&
            existing.source_updated_at &&
            input.sourceUpdatedAt < existing.source_updated_at
          ) {
            throw new ConflictError(
              `STALE_FINANCIAL_FACT: incoming snapshot (${input.sourceUpdatedAt}) is older than current (${existing.source_updated_at}) for ${input.sourceSystem}/${input.sourceRecordId}/${input.factType}`,
            );
          }
          if (existing) {
            // 旧值先写入 append-only 修订账本（迁移 101/105）。
            const { rows: revRows } = await client.query(
              `SELECT COALESCE(MAX(revision), 0) + 1 AS next
                 FROM financial_fact_revisions
                WHERE tenant_id=$1 AND fact_id=$2`,
              [input.tenantId, existing.id],
            );
            await client.query(
              `INSERT INTO financial_fact_revisions
                 (tenant_id, fact_id, revision, amount, currency,
                  period_start, period_end, quality_status,
                  source_updated_at, payload,
                  legal_entity_id, order_id, contract_ref, instrument_type,
                  recognition_status, accounting_period, fx_snapshot,
                  source_version, reversal_of, reopening_ref,
                  document_type, document_id, related_fact_id,
                  fx_rate, functional_currency, functional_amount,
                  tax_rate, tax_amount)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                       $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20,
                       $21, $22, $23, $24, $25, $26, $27, $28)`,
              [
                input.tenantId,
                existing.id,
                revRows[0].next,
                existing.amount,
                existing.currency,
                existing.period_start,
                existing.period_end,
                existing.quality_status,
                existing.source_updated_at,
                JSON.stringify(existing.payload ?? {}),
                existing.legal_entity_id ?? null,
                existing.order_id ?? null,
                existing.contract_ref ?? null,
                existing.instrument_type ?? null,
                existing.recognition_status ?? "DRAFT",
                existing.accounting_period ?? null,
                existing.fx_snapshot ? JSON.stringify(existing.fx_snapshot) : null,
                existing.source_version ?? null,
                existing.reversal_of ?? null,
                existing.reopening_ref ?? null,
                existing.document_type ?? null,
                existing.document_id ?? null,
                existing.related_fact_id ?? null,
                existing.fx_rate ?? null,
                existing.functional_currency ?? null,
                existing.functional_amount ?? null,
                existing.tax_rate ?? null,
                existing.tax_amount ?? null,
              ],
            );
          }
          const { rows } = await client.query(
            `INSERT INTO financial_facts
              (id, tenant_id, source_system, source_record_id, fact_type,
               period_start, period_end, amount, currency, quality_status,
               source_updated_at, payload,
               legal_entity_id, order_id, contract_ref, instrument_type,
               recognition_status, accounting_period, fx_snapshot,
               source_version, reversal_of, reopening_ref,
               document_type, document_id, related_fact_id,
               fx_rate, functional_currency, functional_amount,
               tax_rate, tax_amount)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,
                    $13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,
                    $23,$24,$25,$26,$27,$28,$29,$30)
            ON CONFLICT (tenant_id, source_system, source_record_id, fact_type)
            DO UPDATE SET period_start=EXCLUDED.period_start,
                          period_end=EXCLUDED.period_end,
                          amount=EXCLUDED.amount,
                          currency=EXCLUDED.currency,
                          quality_status=EXCLUDED.quality_status,
                          source_updated_at=EXCLUDED.source_updated_at,
                          ingested_at=now(),
                          payload=EXCLUDED.payload,
                          legal_entity_id=EXCLUDED.legal_entity_id,
                          order_id=EXCLUDED.order_id,
                          contract_ref=EXCLUDED.contract_ref,
                          instrument_type=EXCLUDED.instrument_type,
                          recognition_status=EXCLUDED.recognition_status,
                          accounting_period=EXCLUDED.accounting_period,
                          fx_snapshot=EXCLUDED.fx_snapshot,
                          source_version=EXCLUDED.source_version,
                          reversal_of=EXCLUDED.reversal_of,
                          reopening_ref=EXCLUDED.reopening_ref,
                          document_type=EXCLUDED.document_type,
                          document_id=EXCLUDED.document_id,
                          related_fact_id=EXCLUDED.related_fact_id,
                          fx_rate=EXCLUDED.fx_rate,
                          functional_currency=EXCLUDED.functional_currency,
                          functional_amount=EXCLUDED.functional_amount,
                          tax_rate=EXCLUDED.tax_rate,
                          tax_amount=EXCLUDED.tax_amount
            RETURNING *`,
            [
              existing?.id ?? randomUUID(),
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
              JSON.stringify(input.payload ?? {}),
              input.legalEntityId ?? null,
              input.orderId ?? null,
              input.contractRef ?? null,
              input.instrumentType ?? null,
              recognitionStatus,
              input.accountingPeriod ?? null,
              input.fxSnapshot ? JSON.stringify(input.fxSnapshot) : null,
              input.sourceVersion ?? null,
              input.reversalOf ?? null,
              input.reopeningRef ?? null,
              input.documentType ?? null,
              input.documentId ?? null,
              input.relatedFactId ?? null,
              input.fxRate ?? null,
              input.functionalCurrency?.trim() ?? null,
              input.functionalAmount ?? null,
              taxRate ?? null,
              taxAmount ?? null,
            ],
          );
          return this.mapSubledgerFact(rows[0]);
        });
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `DUPLICATE_FINANCIAL_DOCUMENT: ${input.documentType ?? "DOCUMENT"}/${input.documentId ?? input.sourceRecordId} already exists`,
          );
        }
        throw error;
      }
    }

    async getFinancialFact(
      tenantId: string,
      factId: string,
    ): Promise<FinancialFact> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(
        tenantId,
        `SELECT * FROM financial_facts WHERE tenant_id=$1 AND id=$2`,
        [tenantId, factId],
      );
      if (!rows[0]) notFound("FinancialFact", factId);
      return this.mapSubledgerFact(rows[0]);
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
      if (filter?.legalEntityId) {
        params.push(filter.legalEntityId);
        sql += ` AND legal_entity_id=$${params.length}`;
      }
      if (filter?.accountingPeriod) {
        params.push(filter.accountingPeriod);
        sql += ` AND accounting_period=$${params.length}`;
      }
      if (filter?.recognitionStatus) {
        params.push(filter.recognitionStatus);
        sql += ` AND recognition_status=$${params.length}`;
      }
      if (filter?.orderId) {
        params.push(filter.orderId);
        sql += ` AND order_id=$${params.length}`;
      }
      if (filter?.contractRef) {
        params.push(filter.contractRef);
        sql += ` AND contract_ref=$${params.length}`;
      }
      if (filter?.documentType) {
        params.push(filter.documentType);
        sql += ` AND document_type=$${params.length}`;
      }
      if (filter?.documentId) {
        params.push(filter.documentId);
        sql += ` AND document_id=$${params.length}`;
      }
      if (filter?.relatedFactId) {
        params.push(filter.relatedFactId);
        sql += ` AND related_fact_id=$${params.length}`;
      }
      sql += " ORDER BY ingested_at DESC, created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapSubledgerFact(row));
    }

    async listAccountingPeriods(
      tenantId: string,
      filter?: { legalEntityId?: string; period?: string },
    ): Promise<AccountingPeriod[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM accounting_periods WHERE tenant_id=$1";
      if (filter?.legalEntityId) {
        params.push(filter.legalEntityId);
        sql += ` AND legal_entity_id=$${params.length}`;
      }
      if (filter?.period) {
        params.push(filter.period);
        sql += ` AND period=$${params.length}`;
      }
      sql += " ORDER BY period DESC, legal_entity_id ASC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapAccountingPeriod(row));
    }

    async getAccountingPeriod(
      tenantId: string,
      legalEntityId: string,
      period: string,
    ): Promise<AccountingPeriod | null> {
      const { rows } = await this.tenantQuery(
        tenantId,
        `SELECT * FROM accounting_periods
          WHERE tenant_id=$1 AND legal_entity_id=$2 AND period=$3`,
        [tenantId, legalEntityId, period],
      );
      return rows[0] ? this.mapAccountingPeriod(rows[0]) : null;
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
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
        throw new ConflictError("INVALID_ACCOUNTING_PERIOD");
      }
      if (input.action === "REOPEN" && !input.reopeningRef) {
        throw new ConflictError("REOPENING_REF_REQUIRED");
      }
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: periods } = await client.query(
          `SELECT * FROM accounting_periods
            WHERE tenant_id=$1 AND legal_entity_id=$2 AND period=$3
            FOR UPDATE`,
          [input.tenantId, input.legalEntityId, input.period],
        );
        const current = periods[0];
        if (input.action === "CLOSE" && current?.status === "CLOSED") {
          throw new ConflictError("PERIOD_ALREADY_CLOSED");
        }
        if (input.action === "REOPEN" && current?.status !== "CLOSED") {
          throw new ConflictError("PERIOD_NOT_CLOSED");
        }
        const { rows: pending } = await client.query(
          `SELECT * FROM accounting_period_change_requests
            WHERE tenant_id=$1 AND legal_entity_id=$2 AND period=$3
              AND action=$4 AND status='PENDING'
            FOR UPDATE`,
          [input.tenantId, input.legalEntityId, input.period, input.action],
        );
        if (pending[0]) return this.mapAccountingPeriodChangeRequest(pending[0]);
        const { rows } = await client.query(
          `INSERT INTO accounting_period_change_requests
             (tenant_id, legal_entity_id, period, action, requested_by,
              reason, reopening_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            input.tenantId,
            input.legalEntityId,
            input.period,
            input.action,
            input.requestedBy,
            input.reason ?? null,
            input.reopeningRef ?? null,
          ],
        );
        return this.mapAccountingPeriodChangeRequest(rows[0]);
      });
    }

    async listAccountingPeriodChangeRequests(
      tenantId: string,
      filter?: {
        legalEntityId?: string;
        period?: string;
        status?: AccountingPeriodChangeRequest["status"];
      },
    ): Promise<AccountingPeriodChangeRequest[]> {
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM accounting_period_change_requests WHERE tenant_id=$1";
      if (filter?.legalEntityId) {
        params.push(filter.legalEntityId);
        sql += ` AND legal_entity_id=$${params.length}`;
      }
      if (filter?.period) {
        params.push(filter.period);
        sql += ` AND period=$${params.length}`;
      }
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status=$${params.length}`;
      }
      sql += " ORDER BY requested_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) =>
        this.mapAccountingPeriodChangeRequest(row),
      );
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
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM accounting_period_change_requests
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.requestId],
        );
        if (!rows[0]) notFound("AccountingPeriodChangeRequest", input.requestId);
        const row = rows[0];
        if (row.status !== "PENDING") {
          throw new ConflictError(`APPROVAL_NOT_PENDING: ${row.status}`);
        }
        if (row.requested_by === input.approverPersonId) {
          throw new ConflictError(
            "APPROVAL_SEPARATION_REQUIRED: requester and approver must be different people",
          );
        }
        let period: AccountingPeriod | undefined;
        if (input.decision === "APPROVE") {
          if (row.action === "CLOSE") {
            const { rows: updated } = await client.query(
              `UPDATE accounting_periods
                  SET status='CLOSED', closed_at=now(), closed_by=$4,
                      close_reason=$5, updated_at=now()
                WHERE tenant_id=$1 AND legal_entity_id=$2 AND period=$3
                  AND status='OPEN'
                RETURNING *`,
              [
                input.tenantId,
                row.legal_entity_id,
                row.period,
                input.approverPersonId,
                row.reason,
              ],
            );
            if (updated[0]) {
              period = this.mapAccountingPeriod(updated[0]);
            } else {
              const { rows: inserted } = await client.query(
                `INSERT INTO accounting_periods
                   (tenant_id, legal_entity_id, period, status,
                    closed_at, closed_by, close_reason)
                 VALUES ($1,$2,$3,'CLOSED',now(),$4,$5)
                 ON CONFLICT (tenant_id, legal_entity_id, period) DO NOTHING
                 RETURNING *`,
                [
                  input.tenantId,
                  row.legal_entity_id,
                  row.period,
                  input.approverPersonId,
                  row.reason,
                ],
              );
              if (!inserted[0]) throw new ConflictError("PERIOD_ALREADY_CLOSED");
              period = this.mapAccountingPeriod(inserted[0]);
            }
          } else {
            const { rows: updated } = await client.query(
              `UPDATE accounting_periods
                  SET status='OPEN', reopened_at=now(), reopened_by=$4,
                      reopening_ref=$5, reopen_reason=$6, updated_at=now()
                WHERE tenant_id=$1 AND legal_entity_id=$2 AND period=$3
                  AND status='CLOSED'
                RETURNING *`,
              [
                input.tenantId,
                row.legal_entity_id,
                row.period,
                input.approverPersonId,
                row.reopening_ref,
                row.reason,
              ],
            );
            if (!updated[0]) throw new ConflictError("PERIOD_NOT_CLOSED");
            period = this.mapAccountingPeriod(updated[0]);
          }
        }
        const { rows: decided } = await client.query(
          `UPDATE accounting_period_change_requests
              SET status=$3, decided_by=$4, decided_at=now(),
                  decision_note=$5, updated_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [
            input.tenantId,
            input.requestId,
            input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
            input.approverPersonId,
            input.note ?? null,
          ],
        );
        return {
          request: this.mapAccountingPeriodChangeRequest(decided[0]),
          period,
        };
      });
    }

    async closeAccountingPeriod(input: {
      tenantId: string;
      legalEntityId: string;
      period: string;
      actorPersonId: string;
      reason?: string;
    }): Promise<AccountingPeriod> {
      const { rows } = await this.tenantQuery(
        input.tenantId,
        `UPDATE accounting_periods
            SET status='CLOSED', closed_at=now(), closed_by=$4,
                close_reason=$5, updated_at=now()
          WHERE tenant_id=$1 AND legal_entity_id=$2 AND period=$3
            AND status='OPEN'
          RETURNING *`,
        [
          input.tenantId,
          input.legalEntityId,
          input.period,
          input.actorPersonId,
          input.reason ?? null,
        ],
      );
      if (rows[0]) return this.mapAccountingPeriod(rows[0]);
      // 空期间也允许关闭：不存在时直接落一条 CLOSED（已关闭则幂等冲突）。
      const { rows: inserted } = await this.tenantQuery(
        input.tenantId,
        `INSERT INTO accounting_periods
           (tenant_id, legal_entity_id, period, status,
            closed_at, closed_by, close_reason)
         VALUES ($1,$2,$3,'CLOSED',now(),$4,$5)
         ON CONFLICT (tenant_id, legal_entity_id, period) DO NOTHING
         RETURNING *`,
        [
          input.tenantId,
          input.legalEntityId,
          input.period,
          input.actorPersonId,
          input.reason ?? null,
        ],
      );
      if (!inserted[0]) {
        throw new ConflictError(
          `PERIOD_NOT_OPEN: ${input.legalEntityId}/${input.period} is already closed`,
        );
      }
      return this.mapAccountingPeriod(inserted[0]);
    }

    async reopenAccountingPeriod(input: {
      tenantId: string;
      legalEntityId: string;
      period: string;
      actorPersonId: string;
      reopeningRef: string;
      reason: string;
    }): Promise<AccountingPeriod> {
      const { rows } = await this.tenantQuery(
        input.tenantId,
        `UPDATE accounting_periods
            SET status='OPEN', reopened_at=now(), reopened_by=$4,
                reopening_ref=$5, reopen_reason=$6, updated_at=now()
          WHERE tenant_id=$1 AND legal_entity_id=$2 AND period=$3
            AND status='CLOSED'
          RETURNING *`,
        [
          input.tenantId,
          input.legalEntityId,
          input.period,
          input.actorPersonId,
          input.reopeningRef,
          input.reason,
        ],
      );
      if (!rows[0]) {
        throw new ConflictError(
          `PERIOD_NOT_CLOSED: ${input.legalEntityId}/${input.period} is missing or not closed`,
        );
      }
      return this.mapAccountingPeriod(rows[0]);
    }

    // ------------------------------------------------------------------
    // 迁移 112：复式记账（gl_accounts / gl_journals / gl_journal_lines）。
    // ------------------------------------------------------------------
    private async ensureGlAccounts(
      client: PoolClient,
      tenantId: string,
    ): Promise<void> {
      for (const seed of GL_ACCOUNT_SEED) {
        await client.query(
          `INSERT INTO gl_accounts
             (tenant_id, code, name, account_type, normal_balance)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, code) DO NOTHING`,
          [tenantId, seed.code, seed.name, seed.accountType, seed.normalBalance],
        );
      }
    }

    private mapGlJournal(row: QueryResultRow): GlJournal {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        journalNo: row.journal_no,
        documentType: row.document_type,
        documentId: row.document_id,
        legalEntityId: row.legal_entity_id,
        accountingPeriod: row.accounting_period,
        currency: String(row.currency).trim(),
        description: row.description ?? undefined,
        sourceFactId: row.source_fact_id ?? undefined,
        totalDebit: decimalText(String(row.total_debit)) ?? "0",
        totalCredit: decimalText(String(row.total_credit)) ?? "0",
        lines: [],
        createdAt: iso(row.created_at) ?? new Date().toISOString(),
      };
    }

    private mapGlJournalLine(row: QueryResultRow): GlJournalLine {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        journalId: row.journal_id,
        lineNo: Number(row.line_no),
        accountCode: row.account_code,
        debit: decimalText(String(row.debit)) ?? "0",
        credit: decimalText(String(row.credit)) ?? "0",
        currency: String(row.currency).trim(),
        createdAt: iso(row.created_at) ?? new Date().toISOString(),
      };
    }

    private async loadJournal(
      client: PoolClient,
      row: QueryResultRow,
    ): Promise<GlJournal> {
      const journal = this.mapGlJournal(row);
      const { rows: lines } = await client.query(
        `SELECT * FROM gl_journal_lines
          WHERE tenant_id=$1 AND journal_id=$2
          ORDER BY line_no ASC`,
        [journal.tenantId, journal.id],
      );
      journal.lines = lines.map((line: QueryResultRow) =>
        this.mapGlJournalLine(line),
      );
      return journal;
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
      const normalized: Array<{
        accountCode: string;
        debit: string;
        credit: string;
      }> = [];
      for (const [index, line] of input.lines.entries()) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(line.accountCode)) {
          throw new ConflictError(
            `INVALID_GL_ACCOUNT: ${line.accountCode}`,
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
        normalized.push({
          accountCode: line.accountCode,
          debit: formatDecimal(debit),
          credit: formatDecimal(credit),
        });
      }
      if (totalDebit !== totalCredit || totalDebit === 0n) {
        throw new ConflictError(
          `JOURNAL_NOT_BALANCED: debits ${formatDecimal(totalDebit)} != credits ${formatDecimal(totalCredit)}`,
        );
      }
      try {
        return await this.transactionFor(input.tenantId, async (client) => {
        await this.ensureGlAccounts(client, input.tenantId);
        const journalNo =
          input.journalNo ??
          `JE-${input.documentType}-${input.documentId}`;
        const { rows } = await client.query(
          `INSERT INTO gl_journals
             (tenant_id, journal_no, document_type, document_id,
              legal_entity_id, accounting_period, currency, description,
              source_fact_id, total_debit, total_credit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (tenant_id, document_type, document_id) DO NOTHING
           RETURNING *`,
          [
            input.tenantId,
            journalNo,
            input.documentType,
            input.documentId,
            input.legalEntityId,
            input.accountingPeriod,
            currency,
            input.description ?? null,
            input.sourceFactId ?? null,
            formatDecimal(totalDebit),
            formatDecimal(totalCredit),
          ],
        );
        if (!rows[0]) {
          // 幂等：同一业务文档已生成凭证，返回既有凭证。
          const { rows: existing } = await client.query(
            `SELECT * FROM gl_journals
              WHERE tenant_id=$1 AND document_type=$2 AND document_id=$3`,
            [input.tenantId, input.documentType, input.documentId],
          );
          if (!existing[0]) {
            throw new ConflictError(
              `JOURNAL_CONFLICT: ${input.documentType}/${input.documentId}`,
            );
          }
          return this.loadJournal(client, existing[0]);
        }
        for (const [index, line] of normalized.entries()) {
          await client.query(
            `INSERT INTO gl_journal_lines
               (tenant_id, journal_id, line_no, account_code,
                debit, credit, currency)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              input.tenantId,
              rows[0].id,
              index + 1,
              line.accountCode,
              line.debit,
              line.credit,
              currency,
            ],
          );
        }
        return this.loadJournal(client, rows[0]);
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23503") {
          throw new ConflictError(
            "UNKNOWN_GL_ACCOUNT: journal line references an account that is not seeded for this tenant",
          );
        }
        if (code === "23514") {
          throw new ConflictError(
            "JOURNAL_INVALID: journal failed database balance/amount checks",
          );
        }
        throw error;
      }
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
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM gl_journals WHERE tenant_id=$1";
      if (filter?.documentId) {
        params.push(filter.documentId);
        sql += ` AND document_id=$${params.length}`;
      }
      if (filter?.documentType) {
        params.push(filter.documentType);
        sql += ` AND document_type=$${params.length}`;
      }
      if (filter?.legalEntityId) {
        params.push(filter.legalEntityId);
        sql += ` AND legal_entity_id=$${params.length}`;
      }
      if (filter?.accountingPeriod) {
        params.push(filter.accountingPeriod);
        sql += ` AND accounting_period=$${params.length}`;
      }
      sql += ` ORDER BY created_at DESC, journal_no DESC LIMIT ${
        filter?.limit ?? 200
      }`;
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      if (rows.length === 0) return [];
      const journals = rows.map((row: QueryResultRow) =>
        this.mapGlJournal(row),
      );
      const { rows: lineRows } = await this.tenantQuery(
        tenantId,
        `SELECT * FROM gl_journal_lines
          WHERE tenant_id=$1 AND journal_id = ANY($2::uuid[])
          ORDER BY journal_id, line_no`,
        [tenantId, journals.map((journal) => journal.id)],
      );
      const byJournal = new Map<string, GlJournalLine[]>();
      for (const line of lineRows) {
        const mapped = this.mapGlJournalLine(line);
        const list = byJournal.get(mapped.journalId) ?? [];
        list.push(mapped);
        byJournal.set(mapped.journalId, list);
      }
      for (const journal of journals) {
        journal.lines = byJournal.get(journal.id) ?? [];
      }
      return journals;
    }

    async listGlAccounts(tenantId: string): Promise<GlAccount[]> {
      await this.assertTenant(tenantId);
      // 新租户在首次读取时补齐最小科目表（Migration 112 只给既有租户种子）。
      await this.transactionFor(tenantId, async (client) => {
        await this.ensureGlAccounts(client, tenantId);
      });
      const { rows } = await this.tenantQuery(
        tenantId,
        `SELECT * FROM gl_accounts WHERE tenant_id=$1 ORDER BY code ASC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => ({
        id: row.id,
        tenantId: row.tenant_id,
        code: row.code,
        name: row.name,
        accountType: row.account_type,
        normalBalance: row.normal_balance,
        createdAt: iso(row.created_at) ?? new Date().toISOString(),
      }));
    }

    /**
     * 迁移 111：base.mapFinancialFact 只认识 105 的列；子账新列在本 mixin
     * 内补映射，避免改动共享 base（行为保持）。
     */
    private mapSubledgerFact(row: QueryResultRow): FinancialFact {
      const fact = this.mapFinancialFact(row);
      const functionalCurrency = row.functional_currency
        ? String(row.functional_currency).trim()
        : undefined;
      const taxRate =
        row.tax_rate === null || row.tax_rate === undefined
          ? undefined
          : (decimalText(String(row.tax_rate)) ?? undefined);
      const taxAmount =
        row.tax_amount === null || row.tax_amount === undefined
          ? undefined
          : (decimalText(String(row.tax_amount)) ?? undefined);
      const totalAmount =
        taxAmount === undefined
          ? undefined
          : formatDecimal(parseDecimal(fact.amount) + parseDecimal(taxAmount));
      return {
        ...fact,
        documentType: row.document_type ?? undefined,
        documentId: row.document_id ?? undefined,
        relatedFactId: row.related_fact_id ?? undefined,
        fxRate:
          row.fx_rate === null || row.fx_rate === undefined
            ? undefined
            : (decimalText(String(row.fx_rate)) ?? undefined),
        functionalCurrency: functionalCurrency || undefined,
        functionalAmount:
          row.functional_amount === null || row.functional_amount === undefined
            ? undefined
            : (decimalText(String(row.functional_amount)) ?? undefined),
        taxRate,
        taxAmount,
        totalAmount,
      };
    }
  };
}
