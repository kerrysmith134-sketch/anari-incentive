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
    }): Promise<FinancialFact> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
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
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapFinancialFact(row));
    }
  };
}
