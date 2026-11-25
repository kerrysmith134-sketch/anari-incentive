/**
 * NPV2-013：激励运营 Adapter（IncentivePort，方法体逐字平移）。
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
import type { IncentivePort } from "../../store-ports.js";
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgIncentiveMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements IncentivePort {
    
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
      const { rows } = await this.tenantQuery(input.tenantId, 
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
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM strategic_pool_cases WHERE tenant_id=$1 ORDER BY created_at DESC",
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapStrategicPoolCase(row));
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
      const { rows } = await this.tenantQuery(input.tenantId, 
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
        const { rows } = await this.tenantQuery(input.tenantId, 
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
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapClawbackCase(row));
    }
    
    async approveClawbackCase(input: {
      tenantId: string;
      caseId: string;
      approvedBy: string;
    }): Promise<ClawbackCase> {
      return this.transactionFor(input.tenantId, async (client) => {
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
    
    async excludeLedgerFromSettlement(input: {
      tenantId: string;
      ledgerIds: string[];
      reason: string;
      actorPersonId: string;
    }): Promise<number> {
      if (input.ledgerIds.length === 0) return 0;
      const { rowCount } = await this.tenantQuery(input.tenantId, 
        `INSERT INTO ledger_exclusions (tenant_id, ledger_id, reason, created_by)
         SELECT $1, unnest($2::uuid[]), $3, $4
         ON CONFLICT (tenant_id, ledger_id) DO NOTHING`,
        [input.tenantId, input.ledgerIds, input.reason, input.actorPersonId],
      );
      return rowCount ?? 0;
    }
    
    async markClawbackRecoveryGenerated(input: {
      tenantId: string;
      caseId: string;
    }): Promise<ClawbackCase> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE clawback_cases
            SET status='RECOVERY_GENERATED', updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='APPROVED'
          RETURNING *`,
        [input.tenantId, input.caseId],
      );
      if (!rows[0]) {
        const current = await this.tenantQuery(input.tenantId, 
          "SELECT status FROM clawback_cases WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.caseId],
        );
        if (!current.rows[0]) notFound("ClawbackCase", input.caseId);
        throw new ConflictError(`clawback case is ${current.rows[0].status}`);
      }
      return this.mapClawbackCase(rows[0]);
    }
    
    async closeClawbackCase(input: {
      tenantId: string;
      caseId: string;
      action: "WAIVE" | "CANCEL";
      reason: string;
      actorPersonId: string;
    }): Promise<ClawbackCase> {
      const status = input.action === "WAIVE" ? "WAIVED" : "CANCELLED";
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE clawback_cases
            SET status=$3,
                waived_at=CASE WHEN $4 THEN now() ELSE waived_at END,
                waiver_reason=CASE WHEN $4 THEN $5 ELSE waiver_reason END,
                cancelled_at=CASE WHEN $4 THEN cancelled_at ELSE now() END,
                cancel_reason=CASE WHEN $4 THEN cancel_reason ELSE $5 END,
                updated_at=now()
          WHERE tenant_id=$1 AND id=$2
            AND status IN ('DRAFT','APPROVED','RECOVERY_GENERATED')
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
        const current = await this.tenantQuery(input.tenantId, 
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
        const { rows } = await this.tenantQuery(input.tenantId, 
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
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapEquityGrant(row));
    }
    
    async getEquityGrant(
      tenantId: string,
      grantId: string,
    ): Promise<EquityGrant> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM equity_grants WHERE tenant_id=$1 AND id=$2",
        [tenantId, grantId],
      );
      if (!rows[0]) notFound("EquityGrant", grantId);
      return this.mapEquityGrant(rows[0]);
    }
    
    async updateEquityGrant(input: {
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
    }): Promise<EquityGrant> {
      if (!input.reason.trim()) {
        throw new ConflictError("EQ_ADJUST_REASON_REQUIRED");
      }
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM equity_grants
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.grantId],
        );
        if (!rows[0]) notFound("EquityGrant", input.grantId);
        const grant = this.mapEquityGrant(rows[0]);
        if (grant.status !== "ACTIVE") {
          throw new ConflictError(
            `EQ_GRANT_NOT_EDITABLE: grant is ${grant.status}`,
          );
        }
        const { rows: exercised } = await client.query(
          `SELECT COALESCE(SUM(units),0) AS units FROM equity_exercises
            WHERE tenant_id=$1 AND grant_id=$2 AND status <> 'CANCELLED'`,
          [input.tenantId, input.grantId],
        );
        const activeUnits = parseDecimal(String(exercised[0].units));
        const nextTotal = input.patch.totalUnits
          ? parseDecimal(input.patch.totalUnits)
          : parseDecimal(grant.totalUnits);
        if (nextTotal <= 0n) {
          throw new ConflictError("EQ_TOTAL_UNITS_MUST_BE_POSITIVE");
        }
        if (nextTotal < activeUnits) {
          throw new ConflictError(
            `EQ_UNITS_BELOW_EXERCISED: ${formatDecimal(activeUnits)} units are already exercised or pending`,
          );
        }
        const nextStrike = input.patch.strikePrice
          ? parseDecimal(input.patch.strikePrice)
          : parseDecimal(grant.strikePrice);
        if (nextStrike < 0n) {
          throw new ConflictError("EQ_STRIKE_PRICE_MUST_BE_NON_NEGATIVE");
        }
        const nextCliff = input.patch.cliffMonths ?? grant.cliffMonths;
        const nextVesting = input.patch.vestingMonths ?? grant.vestingMonths;
        if (nextCliff > nextVesting) {
          throw new ConflictError("EQ_CLIFF_EXCEEDS_VESTING");
        }
        const { rows: updated } = await client.query(
          `UPDATE equity_grants
              SET total_units = COALESCE($3, total_units),
                  strike_price = COALESCE($4, strike_price),
                  grant_date = COALESCE($5, grant_date),
                  vesting_start = COALESCE($6, vesting_start),
                  cliff_months = COALESCE($7, cliff_months),
                  vesting_months = COALESCE($8, vesting_months),
                  version = version + 1,
                  updated_at = now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [
            input.tenantId,
            input.grantId,
            input.patch.totalUnits ?? null,
            input.patch.strikePrice ?? null,
            input.patch.grantDate ?? null,
            input.patch.vestingStart ?? null,
            input.patch.cliffMonths ?? null,
            input.patch.vestingMonths ?? null,
          ],
        );
        return this.mapEquityGrant(updated[0]);
      });
    }
    
    async getEquityVesting(
      tenantId: string,
      grantId: string,
      asOf = new Date().toISOString(),
    ): Promise<EquityVesting> {
      const grant = await this.getEquityGrant(tenantId, grantId);
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM equity_exercises WHERE tenant_id=$1 AND grant_id=$2",
        [tenantId, grantId],
      );
      return computeEquityVesting(
        grant,
        rows.map((row: QueryResultRow) => this.mapEquityExercise(row)),
        asOf,
      );
    }
    
    async createEquityExercise(input: {
      tenantId: string;
      grantId: string;
      units: string;
      requestedBy: string;
    }): Promise<EquityExercise> {
      return this.transactionFor(input.tenantId, async (client) => {
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
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapEquityExercise(row));
    }
    
    async approveEquityExercise(input: {
      tenantId: string;
      exerciseId: string;
      approvedBy: string;
    }): Promise<EquityExercise> {
      return this.transactionFor(input.tenantId, async (client) => {
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
      return this.transactionFor(input.tenantId, async (client) => {
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
        const { rows } = await this.tenantQuery(input.tenantId, 
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
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapBounty(row));
    }
    
    async getBounty(tenantId: string, bountyId: string): Promise<Bounty> {
      const { rows } = await this.tenantQuery(tenantId, 
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
      return this.transactionFor(input.tenantId, async (client) => {
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
      return this.transactionFor(input.tenantId, async (client) => {
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
      return this.transactionFor(input.tenantId, async (client) => {
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
      const { rows } = await this.tenantQuery(input.tenantId, 
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
    
    async createAdverseAction(input: {
      tenantId: string;
      personId: string;
      actionType: AdverseActionCase["actionType"];
      reason: string;
      performanceBasis: string;
      evidenceRefs: string[];
      requestedBy: string;
    }): Promise<AdverseActionCase> {
      const { rows } = await this.tenantQuery(input.tenantId, 
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
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapAdverseAction(row));
    }
    
    async getAdverseAction(
      tenantId: string,
      actionId: string,
    ): Promise<AdverseActionCase> {
      const { rows } = await this.tenantQuery(tenantId, 
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
      return this.transactionFor(input.tenantId, async (client) => {
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
      return this.transactionFor(input.tenantId, async (client) => {
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
      return this.transactionFor(input.tenantId, async (client) => {
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
      return this.transactionFor(input.tenantId, async (client) => {
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
      return this.transactionFor(input.tenantId, async (client) => {
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
        const { rows } = await this.tenantQuery(input.tenantId, 
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
      return this.transactionFor(input.tenantId, async (client) => {
        try {
          if (sourceRecordIds.length > 0) {
            const { rows: reserved } = await client.query(
              `INSERT INTO incentive_award_source_reservations
                 (tenant_id, source_record_id, batch_id)
               SELECT $1, unnest($2::text[]), $3
               ON CONFLICT (tenant_id, source_record_id) DO NOTHING
               RETURNING source_record_id`,
              [input.tenantId, sourceRecordIds, batchId],
            );
            if (reserved.length !== sourceRecordIds.length) {
              throw new ConflictError(
                `source record already used by another award batch (reserved ${reserved.length}/${sourceRecordIds.length})`,
              );
            }
          }
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
      const { rows } = await this.tenantQuery(tenantId, sql, params);
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
      const { rows } = await this.tenantQuery(tenantId, 
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
      const { rows } = await this.tenantQuery(input.tenantId, 
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
          WHERE tenant_id=$1 AND id=$2 AND status=$7
          RETURNING *`,
        [
          input.tenantId,
          input.batchId,
          expected[1],
          input.command,
          input.actorPersonId,
          input.paymentRef?.trim() ?? null,
          expected[0],
        ],
      );
      if (!rows[0]) {
        // A concurrent command won the transition; treat it like a stale state.
        throw new ConflictError(
          `incentive award batch ${input.batchId} changed concurrently; retry the command`,
        );
      }
      return this.loadIncentiveAwardBatch(this.pool, rows[0]);
    }
  };
}
