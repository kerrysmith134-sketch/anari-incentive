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
                  source_version, reversal_of, reopening_ref)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                       $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20)`,
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
               source_version, reversal_of, reopening_ref)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,
                    $13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22)
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
                          reopening_ref=EXCLUDED.reopening_ref
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
            ],
          );
          return this.mapFinancialFact(rows[0]);
        });
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
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
      sql += " ORDER BY ingested_at DESC, created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapFinancialFact(row));
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
  };
}
