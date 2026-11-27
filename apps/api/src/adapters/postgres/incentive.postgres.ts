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
  IncentiveAwardBatchReconciliation,
  IncentiveAwardGlJournalRef,
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
  GL_ACCOUNT_CODES,
  GL_ACCOUNT_SEED,
  reconcileIncentiveAwardBatch,
} from "@anari/domain";
import { ConflictError, NotFoundError } from "../../store.js";
import type { PlatformStore } from "../../platform-store.js";
import { formatInvoiceAmount, now, notFound, surveyAverage, aggregateSurveyReport, iso, isoDate, decimalText, addUtcMonths, computeEquityVesting, money } from "../shared.js";
import type { IncentivePort } from "../../store-ports.js";
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

/** 复式记账入参（与 Budget mixin 的 createJournalEntry 保持一致）。 */
type AwardPaymentJournalInput = Parameters<
  PgPlatformStoreBaseShape["createJournalEntry"]
>[0];

/** 迁移 117：支付金额必须是可解析的正定点金额（1e6 标度）。 */
function awardPaymentAmount(value: string): bigint {
  try {
    const amount = parseDecimal(value);
    if (amount <= 0n) throw new Error("non-positive");
    return amount;
  } catch {
    throw new ConflictError(`AWARD_PAYMENT_AMOUNT_INVALID: ${value}`);
  }
}

/** 会计期间：显式值优先，否则取支付时间的 YYYY-MM（GL 表 CHECK 同规则）。 */
function awardPaymentAccountingPeriod(
  value: string | undefined,
  paidAt: string,
): string {
  const period = value?.trim() || paidAt.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new ConflictError(
      `AWARD_PAYMENT_ACCOUNTING_PERIOD_INVALID: ${period}`,
    );
  }
  return period;
}

function mapAwardPaymentRow(row: QueryResultRow): IncentiveAwardPayment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    batchId: row.batch_id,
    lineId: row.line_id,
    personId: row.person_id,
    amount: decimalText(String(row.amount)) ?? "0",
    currency: String(row.currency).trim(),
    paymentRef: row.payment_ref,
    status: row.status,
    paidAt: iso(row.paid_at),
    failureCode: row.failure_code ?? undefined,
    legalEntityId: row.legal_entity_id ?? "DEFAULT",
    accountingPeriod: row.accounting_period ?? undefined,
    creditAccount: (row.credit_account ?? GL_ACCOUNT_CODES.CASH) as IncentiveAwardPaymentCreditAccount,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
}

/** 迁移 119：幂等载荷的记账维度（显式值或服务端缺省）。 */
interface AwardPaymentLedgerDimensions {
  legalEntityId: string;
  accountingPeriod?: string;
  creditAccount: IncentiveAwardPaymentCreditAccount;
}

function awardPaymentDimensions(
  input: {
    legalEntityId?: string;
    accountingPeriod?: string;
    creditAccount?: IncentiveAwardPaymentCreditAccount;
  },
  fallbackPaidAt: string | undefined,
): AwardPaymentLedgerDimensions {
  const explicitPeriod = input.accountingPeriod?.trim();
  if (
    explicitPeriod &&
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(explicitPeriod)
  ) {
    throw new ConflictError(
      `AWARD_PAYMENT_ACCOUNTING_PERIOD_INVALID: ${explicitPeriod}`,
    );
  }
  return {
    legalEntityId: input.legalEntityId?.trim() || "DEFAULT",
    accountingPeriod:
      explicitPeriod ||
      (fallbackPaidAt
        ? awardPaymentAccountingPeriod(undefined, fallbackPaidAt.trim())
        : undefined),
    creditAccount: input.creditAccount ?? GL_ACCOUNT_CODES.CASH,
  };
}

/**
 * 幂等回执必须携带完全相同的载荷；同 ref 不同状态/金额/币种/记账维度
 * 说明调用方把两笔不同的银行流水塞进了同一个 ref，必须 409 让人工介入，
 * 不能静默取旧值。
 *
 * accountingPeriod 未显式给出时不比较：服务端缺省可能来自首次落库时间。
 */
function assertIdempotentAwardPayment(
  existing: IncentiveAwardPayment,
  expected: {
    status: IncentiveAwardPaymentStatus;
    amount: bigint;
    currency: string;
    dimensions: AwardPaymentLedgerDimensions;
    explicitAccountingPeriod?: string;
  },
): void {
  const sameDimensions =
    existing.legalEntityId === expected.dimensions.legalEntityId &&
    existing.creditAccount === expected.dimensions.creditAccount &&
    (!expected.explicitAccountingPeriod ||
      existing.accountingPeriod === expected.explicitAccountingPeriod);
  if (
    existing.status !== expected.status ||
    awardPaymentAmount(existing.amount) !== expected.amount ||
    existing.currency.trim().toUpperCase() !== expected.currency ||
    !sameDimensions
  ) {
    throw new ConflictError(
      `AWARD_PAYMENT_IDEMPOTENCY_CONFLICT: ref ${existing.paymentRef} already recorded with a different payload`,
    );
  }
}

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
      return this.transactionFor(tenantId, async (client) => {
        const { rows: tenants } = await client.query(
          "SELECT 1 FROM tenants WHERE id=$1",
          [tenantId],
        );
        if (!tenants[0]) notFound("Tenant", tenantId);

        const params: string[] = [tenantId];
        let sql = "SELECT * FROM incentive_award_batches WHERE tenant_id=$1";
        if (filter?.awardType) {
          params.push(filter.awardType);
          sql += ` AND award_type=${params.length}`;
        }
        if (filter?.period) {
          params.push(filter.period);
          sql += ` AND period=${params.length}`;
        }
        if (filter?.status) {
          params.push(filter.status);
          sql += ` AND status=${params.length}`;
        }
        sql += " ORDER BY created_at DESC";
        const { rows } = await client.query(sql, params);
        const batches: IncentiveAwardBatch[] = [];
        for (const row of rows) {
          batches.push(await this.loadIncentiveAwardBatch(client, row));
        }
        return batches;
      });
    }

    async getIncentiveAwardBatch(
      tenantId: string,
      batchId: string,
    ): Promise<IncentiveAwardBatch> {
      return this.transactionFor(tenantId, async (client) => {
        const { rows: tenants } = await client.query(
          "SELECT 1 FROM tenants WHERE id=$1",
          [tenantId],
        );
        if (!tenants[0]) notFound("Tenant", tenantId);

        const { rows } = await client.query(
          "SELECT * FROM incentive_award_batches WHERE tenant_id=$1 AND id=$2",
          [tenantId, batchId],
        );
        if (!rows[0]) notFound("IncentiveAwardBatch", batchId);
        return this.loadIncentiveAwardBatch(client, rows[0]!);
      });
    }

    /**
     * 迁移 119：在调用方的事务 client 上锁批次行。付款与 ACK 都必须先拿到
     * 这把行锁，随后读支付/GL/对账才不会被并发写入穿插。
     */
    private async lockIncentiveAwardBatch(
      client: PoolClient,
      tenantId: string,
      batchId: string,
    ): Promise<IncentiveAwardBatch> {
      const { rows } = await client.query(
        `SELECT * FROM incentive_award_batches
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [tenantId, batchId],
      );
      if (!rows[0]) notFound("IncentiveAwardBatch", batchId);
      return this.loadIncentiveAwardBatch(client, rows[0]);
    }

    private async ensureAwardPaymentGlAccounts(
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

    /**
     * 迁移 119：PAID 回执的 GL 凭证写入。
     *
     * 不能复用 Budget mixin 的 createJournalEntry：该方法自己开
     * transactionFor(新连接)，会把凭证提交到支付事务之外，GL 写失败时
     * 支付也回滚不了。这里必须使用**同一个 client**，与支付、审计同生共死。
     */
    protected async postAwardPaymentJournal(
      client: PoolClient,
      input: AwardPaymentJournalInput,
    ): Promise<void> {
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
          throw new ConflictError(`INVALID_GL_ACCOUNT: ${line.accountCode}`);
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
      await this.ensureAwardPaymentGlAccounts(client, input.tenantId);
      const journalNo =
        input.journalNo ?? `JE-${input.documentType}-${input.documentId}`;
      let journal: QueryResultRow | undefined;
      try {
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
        journal = rows[0];
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
      if (!journal) {
        // 幂等：同一业务文档已生成凭证（补记/重放不重复出凭证）。
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
        return;
      }
      for (const [index, line] of normalized.entries()) {
        await client.query(
          `INSERT INTO gl_journal_lines
             (tenant_id, journal_id, line_no, account_code,
              debit, credit, currency)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            input.tenantId,
            journal.id,
            index + 1,
            line.accountCode,
            line.debit,
            line.credit,
            currency,
          ],
        );
      }
    }

    /**
     * 迁移 119：支付审计与支付同事务写入 audit_events。审计链的 sequence /
     * prev_hash / event_hash 由 003 的触发器在同一事务内补齐；这里绝不
     * try/catch 吞错——审计写不进去，支付也必须回滚。
     */
    protected async appendAwardPaymentAudit(
      client: PoolClient,
      entry: {
        tenantId: string;
        batchId: string;
        paymentId: string;
        actorPersonId: string;
        reason: string;
      },
    ): Promise<void> {
      // audit_events.actor_id 是 uuid：服务账号的 "system" 不能直接落库。
      const actorId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        entry.actorPersonId,
      )
        ? entry.actorPersonId
        : null;
      await client.query(
        `INSERT INTO audit_events
          (tenant_id, sequence, actor_type, actor_id, action, object_type,
           object_id, before_hash, after_hash, reason, correlation_id,
           prev_hash, event_hash)
         VALUES ($1,0,$2,$3,'INCENTIVE_AWARD_PAYMENT_RECORDED',
                 'INCENTIVE_AWARD_PAYMENT',$4,NULL,NULL,$5,$6,'','')`,
        [
          entry.tenantId,
          actorId ? "USER" : "SYSTEM",
          actorId,
          entry.paymentId,
          entry.reason,
          randomUUID(),
        ],
      );
    }

    /** 迁移 119：在同一事务 client 上读支付 + PAYMENT 凭证并做对账。 */
    private async reconcileAwardBatchWithClient(
      client: PoolClient,
      batch: IncentiveAwardBatch,
    ): Promise<IncentiveAwardBatchReconciliation> {
      const { rows: paymentRows } = await client.query(
        `SELECT * FROM incentive_award_payments
          WHERE tenant_id=$1 AND batch_id=$2
          ORDER BY created_at, id`,
        [batch.tenantId, batch.id],
      );
      const payments = paymentRows.map((row: QueryResultRow) =>
        mapAwardPaymentRow(row),
      );
      const paidPaymentIds = payments
        .filter((payment) => payment.status === "PAID")
        .map((payment) => payment.id);
      let journals: IncentiveAwardGlJournalRef[] = [];
      if (paidPaymentIds.length > 0) {
        const { rows: journalRows } = await client.query(
          `SELECT document_id, total_debit, total_credit
             FROM gl_journals
            WHERE tenant_id=$1 AND document_type='PAYMENT'
              AND document_id = ANY($2::text[])`,
          [batch.tenantId, paidPaymentIds],
        );
        journals = journalRows.map((row: QueryResultRow) => ({
          documentId: row.document_id,
          totalDebit: decimalText(String(row.total_debit)) ?? "0",
          totalCredit: decimalText(String(row.total_credit)) ?? "0",
        }));
      }
      return reconcileIncentiveAwardBatch({
        batchId: batch.id,
        batchNo: batch.batchNo,
        batchStatus: batch.status,
        currency: batch.currency,
        totalAmount: batch.totalAmount,
        lines: batch.lines.map((line) => ({
          id: line.id,
          personId: line.personId,
          amount: line.amount,
          currency: line.currency,
        })),
        payments: payments.map((payment) => ({
          id: payment.id,
          lineId: payment.lineId,
          personId: payment.personId,
          amount: payment.amount,
          currency: payment.currency,
          paymentRef: payment.paymentRef,
          status: payment.status,
          paidAt: payment.paidAt,
          legalEntityId: payment.legalEntityId,
          accountingPeriod: payment.accountingPeriod,
          creditAccount: payment.creditAccount,
          failureCode: payment.failureCode,
          createdAt: payment.createdAt,
        })),
        journals,
      });
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
      // 迁移 119：命令在同一事务内锁批次行 → 读支付/GL/对账 → 更新状态。
      // 两个并发 ACK 会串行在 FOR UPDATE 上，后到者看到已 ACKNOWLEDGED
      // 后以 409 失败，只有第一个成功。
      return this.transactionFor(input.tenantId, async (client) => {
        const batch = await this.lockIncentiveAwardBatch(
          client,
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
          throw new ConflictError(
            "payment reference is required to acknowledge",
          );
        }
        if (input.command === "ACKNOWLEDGE") {
          const reconciliation = await this.reconcileAwardBatchWithClient(
            client,
            batch,
          );
          if (!reconciliation.glComplete) {
            throw new ConflictError(
              `AWARD_GL_MISSING: paid lines ${reconciliation.missingJournalLineIds.join(",")} ` +
                "have no balanced PAYMENT journal",
            );
          }
          if (reconciliation.status !== "RECONCILED") {
            throw new ConflictError(
              `AWARD_BATCH_NOT_RECONCILED: paid ${reconciliation.paidAmount}/${reconciliation.totalAmount} ` +
                `(status ${reconciliation.status}, unpaid ${reconciliation.unpaidAmount})`,
            );
          }
        }
        const { rows } = await client.query(
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
          throw new ConflictError(
            `incentive award batch ${input.batchId} changed concurrently; retry the command`,
          );
        }
        return this.loadIncentiveAwardBatch(client, rows[0]);
      });
    }

    async getIncentiveAwardBatchReconciliation(
      tenantId: string,
      batchId: string,
    ): Promise<IncentiveAwardBatchReconciliation> {
      return this.transactionFor(tenantId, async (client) => {
        const batch = await this.lockIncentiveAwardBatch(
          client,
          tenantId,
          batchId,
        );
        return this.reconcileAwardBatchWithClient(client, batch);
      });
    }

    async listIncentiveAwardPaymentAudits(
      tenantId: string,
      batchId: string,
    ): Promise<IncentiveAwardPaymentAudit[]> {
      return this.transactionFor(tenantId, async (client) => {
        const { rows: batches } = await client.query(
          "SELECT 1 FROM incentive_award_batches WHERE tenant_id=$1 AND id=$2",
          [tenantId, batchId],
        );
        if (!batches[0]) notFound("IncentiveAwardBatch", batchId);
        const { rows } = await client.query(
          `SELECT audit.*
             FROM audit_events audit
             JOIN incentive_award_payments payment
               ON payment.tenant_id = audit.tenant_id
              AND payment.id = audit.object_id
            WHERE audit.tenant_id=$1
              AND audit.object_type='INCENTIVE_AWARD_PAYMENT'
              AND payment.batch_id=$2
            ORDER BY audit.occurred_at, audit.sequence`,
          [tenantId, batchId],
        );
        return rows.map((row: QueryResultRow) => ({
          id: row.id,
          tenantId: row.tenant_id,
          batchId,
          paymentId: row.object_id,
          action: row.action,
          actorType: row.actor_type,
          actorId: row.actor_id ?? undefined,
          reason: row.reason ?? undefined,
          occurredAt: iso(row.occurred_at) ?? new Date().toISOString(),
        }));
      });
    }

    async recordIncentiveAwardPayments(input: {
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
      createdPaymentIds: string[];
    }> {
      // 迁移 119：支付、GL 凭证、审计事件全部在同一个事务里。先锁批次行，
      // 再读/写支付；任一步失败由 transactionFor 整体 ROLLBACK。
      return this.transactionFor(input.tenantId, async (client) => {
        const batch = await this.lockIncentiveAwardBatch(
          client,
          input.tenantId,
          input.batchId,
        );
        const acknowledged = batch.status === "ACKNOWLEDGED";
        if (acknowledged) {
          const illegal = input.payments.find(
            (payment) => payment.status !== "RETURNED",
          );
          if (illegal) {
            throw new ConflictError(
              `AWARD_BATCH_ALREADY_ACKNOWLEDGED: batch ${batch.batchNo} is ACKNOWLEDGED; ` +
                "only RETURNED receipts may be recorded after acknowledgement",
            );
          }
        } else if (!["LOCKED", "EXPORTED"].includes(batch.status)) {
          throw new ConflictError(
            `AWARD_BATCH_NOT_PAYABLE: batch ${batch.batchNo} is ${batch.status}; ` +
              "payments are accepted only after LOCK/EXPORT",
          );
        }

        const lineById = new Map(batch.lines.map((line) => [line.id, line]));
        const batchCurrency = batch.currency.trim().toUpperCase();
        const results: IncentiveAwardPayment[] = [];
        const createdPaymentIds: string[] = [];
        const seenInRequest = new Map<
          string,
          { payment: IncentiveAwardPayment }
        >();
        const plannedInRequest = new Map<
          string,
          {
            payment: IncentiveAwardPayment;
            journal?: AwardPaymentJournalInput;
          }
        >();
        type Slot =
          | { kind: "existing"; payment: IncentiveAwardPayment }
          | {
              kind: "planned";
              payment: IncentiveAwardPayment;
              journal?: AwardPaymentJournalInput;
            };
        const slots: Slot[] = [];

        // 第一段：纯校验 + 幂等解析（同一事务内的读），不写任何状态。
        for (const raw of input.payments) {
          const paymentRef = raw.paymentRef.trim();
          if (!paymentRef) {
            throw new ConflictError("AWARD_PAYMENT_REF_REQUIRED");
          }
          const line = lineById.get(raw.lineId);
          if (!line) {
            throw new ConflictError(
              `AWARD_PAYMENT_LINE_NOT_IN_BATCH: line ${raw.lineId} is not part of batch ${batch.batchNo}`,
            );
          }
          const amount = awardPaymentAmount(raw.amount);
          const lineAmount = awardPaymentAmount(line.amount);
          if (amount !== lineAmount) {
            throw new ConflictError(
              `AWARD_PAYMENT_AMOUNT_MISMATCH: ${formatDecimal(amount)} != line amount ${formatDecimal(lineAmount)} (${line.id})`,
            );
          }
          const currency = raw.currency.trim().toUpperCase();
          if (
            currency !== line.currency.trim().toUpperCase() ||
            currency !== batchCurrency
          ) {
            throw new ConflictError(
              `AWARD_PAYMENT_CURRENCY_MISMATCH: ${currency} != ${line.currency}`,
            );
          }
          const paidAt =
            raw.status === "PAID" ? (raw.paidAt ?? now()) : raw.paidAt;
          if (paidAt && Number.isNaN(Date.parse(paidAt))) {
            throw new ConflictError(`AWARD_PAYMENT_PAID_AT_INVALID: ${paidAt}`);
          }
          const dimensions = awardPaymentDimensions(raw, paidAt);
          const expectedPayload = {
            status: raw.status,
            amount,
            currency,
            dimensions,
            explicitAccountingPeriod: raw.accountingPeriod?.trim() || undefined,
          };
          const idempotencyKey = `${line.id}:${paymentRef}`;
          let payment = seenInRequest.get(idempotencyKey)?.payment;
          if (!payment) {
            payment = plannedInRequest.get(idempotencyKey)?.payment;
          }
          if (!payment) {
            const { rows: existingRows } = await client.query(
              `SELECT * FROM incentive_award_payments
                WHERE tenant_id=$1 AND batch_id=$2 AND line_id=$3
                  AND payment_ref=$4`,
              [input.tenantId, input.batchId, line.id, paymentRef],
            );
            if (existingRows[0]) {
              payment = mapAwardPaymentRow(existingRows[0]);
            }
          }
          if (payment) {
            assertIdempotentAwardPayment(payment, expectedPayload);
            seenInRequest.set(idempotencyKey, { payment });
            slots.push({ kind: "existing", payment });
            continue;
          }

          const timestamp = now();
          const created: IncentiveAwardPayment = {
            id: randomUUID(),
            tenantId: input.tenantId,
            batchId: input.batchId,
            lineId: line.id,
            personId: line.personId,
            amount: formatDecimal(amount),
            currency,
            paymentRef,
            status: raw.status,
            paidAt: paidAt || undefined,
            failureCode: raw.failureCode?.trim() || undefined,
            legalEntityId: dimensions.legalEntityId,
            accountingPeriod: dimensions.accountingPeriod,
            creditAccount: dimensions.creditAccount,
            createdAt: timestamp,
          };
          const journal: AwardPaymentJournalInput | undefined =
            created.status === "PAID"
              ? {
                  tenantId: input.tenantId,
                  documentType: "PAYMENT",
                  documentId: created.id,
                  legalEntityId: dimensions.legalEntityId,
                  accountingPeriod:
                    dimensions.accountingPeriod ??
                    awardPaymentAccountingPeriod(
                      undefined,
                      created.paidAt ?? timestamp,
                    ),
                  currency,
                  description: `Incentive award payment ${batch.batchNo} line ${line.id} ref ${paymentRef}`,
                  lines: [
                    {
                      accountCode: GL_ACCOUNT_CODES.INCENTIVE_EXPENSE,
                      debit: created.amount,
                    },
                    {
                      accountCode: dimensions.creditAccount,
                      credit: created.amount,
                    },
                  ],
                }
              : undefined;
          plannedInRequest.set(idempotencyKey, { payment: created, journal });
          slots.push({ kind: "planned", payment: created, journal });
        }

        // 第二段：写入。支付 → GL → 审计，全部使用同一个 client。
        for (const slot of slots) {
          if (slot.kind === "existing") {
            results.push(slot.payment);
            continue;
          }
          const { rows } = await client.query(
            `INSERT INTO incentive_award_payments
               (id, tenant_id, batch_id, line_id, person_id, amount, currency,
                payment_ref, status, paid_at, failure_code,
                legal_entity_id, accounting_period, credit_account)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (tenant_id, batch_id, line_id, payment_ref)
             DO NOTHING
             RETURNING *`,
            [
              slot.payment.id,
              input.tenantId,
              input.batchId,
              slot.payment.lineId,
              slot.payment.personId,
              slot.payment.amount,
              slot.payment.currency,
              slot.payment.paymentRef,
              slot.payment.status,
              slot.payment.paidAt ?? null,
              slot.payment.failureCode ?? null,
              slot.payment.legalEntityId,
              slot.payment.accountingPeriod ?? null,
              slot.payment.creditAccount,
            ],
          );
          let payment = rows[0] ? mapAwardPaymentRow(rows[0]) : undefined;
          if (!payment) {
            // 行锁下不应发生；若发生则按幂等重放处理。
            const { rows: raced } = await client.query(
              `SELECT * FROM incentive_award_payments
                WHERE tenant_id=$1 AND batch_id=$2 AND line_id=$3
                  AND payment_ref=$4`,
              [
                input.tenantId,
                input.batchId,
                slot.payment.lineId,
                slot.payment.paymentRef,
              ],
            );
            if (!raced[0]) {
              throw new ConflictError(
                `AWARD_PAYMENT_CONFLICT: ${slot.payment.paymentRef} could not be recorded`,
              );
            }
            payment = mapAwardPaymentRow(raced[0]);
            results.push(payment);
            continue;
          }
          if (slot.journal) {
            await this.postAwardPaymentJournal(client, slot.journal);
          }
          await this.appendAwardPaymentAudit(client, {
            tenantId: input.tenantId,
            batchId: input.batchId,
            paymentId: payment.id,
            actorPersonId: input.actorPersonId,
            reason:
              `${payment.status} ref=${payment.paymentRef} ` +
              `amount=${payment.amount} ${payment.currency} ` +
              `line=${payment.lineId}`,
          });
          results.push(payment);
          createdPaymentIds.push(payment.id);
        }

        return {
          payments: results,
          reconciliation: await this.reconcileAwardBatchWithClient(
            client,
            batch,
          ),
          createdPaymentIds,
        };
      });
    }
  };
}
