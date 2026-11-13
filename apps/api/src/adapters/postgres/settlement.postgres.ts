/**
 * NPV2-013：结算薪酬 Adapter（SettlementPort，方法体逐字平移）。
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
import type { SettlementPort } from "../../store-ports.js";
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgSettlementMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements SettlementPort {
    
    async createCompensationTemplate(input: {
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
    }): Promise<CompensationTemplate> {
      const min = parseDecimal(input.fixedSalaryMin);
      const max = parseDecimal(input.fixedSalaryMax);
      if (min < 0n || max < min) {
        throw new ConflictError("COMPENSATION_TEMPLATE_SALARY_RANGE_INVALID");
      }
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO compensation_templates
            (id, tenant_id, code, name, role_code, employment_type, currency,
             fixed_salary_min, fixed_salary_max, deduction_cap_rate,
             variable_share_cap_rate, smoothing_threshold_rate,
             deduction_order, deduction_type_caps)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.code,
            input.name,
            input.roleCode,
            input.employmentType,
            input.currency,
            input.fixedSalaryMin,
            input.fixedSalaryMax,
            input.deductionCapRate,
            input.variableShareCapRate,
            input.smoothingThresholdRate,
            JSON.stringify(input.deductionOrder),
            JSON.stringify(input.deductionTypeCaps),
          ],
        );
        return this.mapCompensationTemplate(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError(
            `compensation template ${input.code} already exists`,
          );
        }
        if (code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
    }
    
    async listCompensationTemplates(
      tenantId: string,
    ): Promise<CompensationTemplate[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.pool.query(
        `SELECT * FROM compensation_templates
          WHERE tenant_id=$1
          ORDER BY code`,
        [tenantId],
      );
      return rows.map((row) => this.mapCompensationTemplate(row));
    }
    
    async getActiveCompensationTemplate(
      tenantId: string,
      code: string,
    ): Promise<CompensationTemplate | undefined> {
      const { rows } = await this.pool.query(
        `SELECT * FROM compensation_templates
          WHERE tenant_id=$1 AND code=$2 AND status='ACTIVE'
          LIMIT 1`,
        [tenantId, code],
      );
      return rows[0] ? this.mapCompensationTemplate(rows[0]) : undefined;
    }
    
    async retireCompensationTemplate(input: {
      tenantId: string;
      templateId: string;
    }): Promise<CompensationTemplate> {
      const { rows } = await this.pool.query(
        `UPDATE compensation_templates
            SET status='RETIRED', updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
          RETURNING *`,
        [input.tenantId, input.templateId],
      );
      if (!rows[0]) {
        const current = await this.pool.query(
          "SELECT status FROM compensation_templates WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.templateId],
        );
        if (!current.rows[0]) {
          notFound("CompensationTemplate", input.templateId);
        }
        throw new ConflictError(
          `compensation template ${input.templateId} is ${current.rows[0].status}`,
        );
      }
      return this.mapCompensationTemplate(rows[0]);
    }
    
    async createSettlementExport(input: {
      tenantId: string;
      batchId: string;
      exportRef: string;
      exportHash: string;
      exportedBy: string;
      exportedAt?: string;
    }): Promise<SettlementExport> {
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO settlement_exports
            (id, tenant_id, batch_id, export_ref, export_hash, exported_by,
             exported_at)
           VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.batchId,
            input.exportRef,
            input.exportHash,
            input.exportedBy,
            input.exportedAt ?? null,
          ],
        );
        return this.mapSettlementExport(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            "settlement batch or exporting person not found",
          );
        }
        throw error;
      }
    }
    
    async listSettlementExports(
      tenantId: string,
      batchId?: string,
    ): Promise<SettlementExport[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM settlement_exports WHERE tenant_id=$1";
      if (batchId) {
        params.push(batchId);
        sql += " AND batch_id=$2";
      }
      sql += " ORDER BY exported_at DESC";
      const { rows } = await this.pool.query(sql, params);
      return rows.map((row) => this.mapSettlementExport(row));
    }
    
    async getSettlementExport(
      tenantId: string,
      exportId: string,
    ): Promise<SettlementExport> {
      const { rows } = await this.pool.query(
        "SELECT * FROM settlement_exports WHERE tenant_id=$1 AND id=$2",
        [tenantId, exportId],
      );
      if (!rows[0]) notFound("SettlementExport", exportId);
      return this.mapSettlementExport(rows[0]);
    }
    
    async acknowledgeSettlementExport(input: {
      tenantId: string;
      exportId: string;
      externalReference: string;
      acknowledgedAt?: string;
    }): Promise<SettlementAcknowledgement> {
      return this.transaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM settlement_exports
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.exportId],
        );
        if (!rows[0]) notFound("SettlementExport", input.exportId);
        const record = this.mapSettlementExport(rows[0]);
        if (record.acknowledgedAt) {
          throw new ConflictError(
            `settlement export ${record.id} was already acknowledged`,
          );
        }
        try {
          const { rows: acknowledgements } = await client.query(
            `INSERT INTO settlement_acknowledgements
              (id, tenant_id, export_id, external_reference,
               acknowledged_at, payload_hash)
             VALUES ($1,$2,$3,$4,COALESCE($5, now()),$6)
             RETURNING *`,
            [
              randomUUID(),
              input.tenantId,
              record.id,
              input.externalReference,
              input.acknowledgedAt ?? null,
              record.exportHash,
            ],
          );
          const acknowledgement = this.mapSettlementAcknowledgement(
            acknowledgements[0],
          );
          await client.query(
            `UPDATE settlement_exports
                SET acknowledged_at=$3, acknowledgement_ref=$4
              WHERE tenant_id=$1 AND id=$2`,
            [
              input.tenantId,
              record.id,
              acknowledgement.acknowledgedAt,
              input.externalReference,
            ],
          );
          return acknowledgement;
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw new ConflictError(
              `settlement export ${record.id} was already acknowledged`,
            );
          }
          throw error;
        }
      });
    }
    
    async createEmploymentContract(input: {
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
    }): Promise<EmploymentContract> {
      if (parseDecimal(input.fixedMonthlySalary) < 0n) {
        throw new ConflictError("CONTRACT_FIXED_SALARY_NEGATIVE");
      }
      if (parseDecimal(input.minimumMonthlyWage) < 0n) {
        throw new ConflictError("CONTRACT_MINIMUM_WAGE_NEGATIVE");
      }
      if (
        parseDecimal(input.taxRate) < 0n ||
        parseDecimal(input.taxRate) > 1_000_000n
      ) {
        throw new ConflictError("CONTRACT_TAX_RATE_OUT_OF_RANGE");
      }
      if (
        parseDecimal(input.socialInsuranceRate) < 0n ||
        parseDecimal(input.socialInsuranceRate) > 1_000_000n
      ) {
        throw new ConflictError(
          "CONTRACT_SOCIAL_INSURANCE_RATE_OUT_OF_RANGE",
        );
      }
      if (
        parseDecimal(input.deductionCapRate) < 0n ||
        parseDecimal(input.deductionCapRate) > 1_000_000n
      ) {
        throw new ConflictError("CONTRACT_DEDUCTION_CAP_OUT_OF_RANGE");
      }
      if (
        parseDecimal(input.variableShareCapRate) < 0n ||
        parseDecimal(input.variableShareCapRate) > 1_000_000n
      ) {
        throw new ConflictError("CONTRACT_VARIABLE_SHARE_CAP_OUT_OF_RANGE");
      }
      if (
        input.endDate &&
        Date.parse(input.endDate) <= Date.parse(input.startDate)
      ) {
        throw new ConflictError("CONTRACT_END_BEFORE_START");
      }
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO employment_contracts
            (id, tenant_id, person_id, contract_code, employment_type,
             start_date, end_date, work_location, legal_entity, currency,
             fixed_monthly_salary, minimum_monthly_wage, tax_rate,
             social_insurance_rate, deduction_cap_rate, variable_share_cap_rate,
             deduction_order, deduction_type_caps, smoothing_threshold_rate,
             smoothing_mode, smoothing_window_periods, smoothing_max_step_rate,
             compensation_template_code, bank_account_ref, pay_plan_version,
             consent_signature_ref, consent_signed_at, status, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23,$24,1,$25,$26,'ACTIVE',1)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.personId,
            input.contractCode,
            input.employmentType,
            input.startDate,
            input.endDate ?? null,
            input.workLocation,
            input.legalEntity ?? null,
            input.currency,
            input.fixedMonthlySalary,
            input.minimumMonthlyWage,
            input.taxRate,
            input.socialInsuranceRate,
            input.deductionCapRate,
            input.variableShareCapRate,
            JSON.stringify(
              input.deductionOrder.length > 0
                ? input.deductionOrder
                : ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
            ),
            JSON.stringify(input.deductionTypeCaps),
            input.smoothingThresholdRate,
            input.smoothingMode ?? "BLOCK",
            input.smoothingWindowPeriods ?? 3,
            input.smoothingMaxStepRate ?? "0.5",
            input.compensationTemplateCode ?? null,
            input.bankAccountRef ?? null,
            input.consentSignatureRef,
            input.consentSignedAt ?? new Date().toISOString(),
          ],
        );
        return this.mapEmploymentContract(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `employment contract ${input.contractCode} already exists`,
          );
        }
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.personId} not found`);
        }
        throw error;
      }
    }
    
    async listEmploymentContractAmendments(
      tenantId: string,
      contractId: string,
    ): Promise<EmploymentContractAmendment[]> {
      const { rows } = await this.pool.query(
        `SELECT * FROM employment_contract_amendments
          WHERE tenant_id=$1 AND contract_id=$2
          ORDER BY created_at DESC`,
        [tenantId, contractId],
      );
      return rows.map((row) => this.mapEmploymentContractAmendment(row));
    }
    
    async applyDueContractAmendments(
      tenantId: string,
    ): Promise<EmploymentContractAmendment[]> {
      return this.transaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM employment_contract_amendments
            WHERE tenant_id=$1 AND status='SCHEDULED'
              AND effective_from <= now()
            ORDER BY effective_from
            FOR UPDATE`,
          [tenantId],
        );
        const applied: EmploymentContractAmendment[] = [];
        for (const row of rows) {
          const terms = row.after_terms as Record<string, unknown>;
          await client.query(
            `UPDATE employment_contracts
                SET fixed_monthly_salary=$3,
                    minimum_monthly_wage=$4,
                    tax_rate=$5,
                    social_insurance_rate=$6,
                    deduction_cap_rate=$7,
                    variable_share_cap_rate=$8,
                    deduction_order=$9::jsonb,
                    bank_account_ref=$10,
                    pay_plan_version=$11,
                    consent_signature_ref=$12,
                    consent_signed_at=$13,
                    smoothing_mode=$14,
                    smoothing_window_periods=$15,
                    smoothing_max_step_rate=$16,
                    version=version+1,
                    updated_at=now()
              WHERE tenant_id=$1 AND id=$2`,
            [
              tenantId,
              row.contract_id,
              String(terms.fixedMonthlySalary ?? "0"),
              String(terms.minimumMonthlyWage ?? "0"),
              String(terms.taxRate ?? "0"),
              String(terms.socialInsuranceRate ?? "0"),
              String(terms.deductionCapRate ?? "0"),
              String(terms.variableShareCapRate ?? "1"),
              JSON.stringify(terms.deductionOrder ?? []),
              typeof terms.bankAccountRef === "string"
                ? terms.bankAccountRef
                : null,
              Number(row.pay_plan_version),
              row.consent_signature_ref,
              row.effective_from,
              String(terms.smoothingMode ?? row.smoothing_mode ?? "BLOCK"),
              Number(terms.smoothingWindowPeriods ?? row.smoothing_window_periods ?? 3),
              String(terms.smoothingMaxStepRate ?? row.smoothing_max_step_rate ?? "0.5"),
            ],
          );
          const { rows: updated } = await client.query(
            `UPDATE employment_contract_amendments
                SET status='APPLIED', applied_at=now()
              WHERE tenant_id=$1 AND id=$2
              RETURNING *`,
            [tenantId, row.id],
          );
          applied.push(this.mapEmploymentContractAmendment(updated[0]));
        }
        return applied;
      });
    }
    
    async cancelContractAmendment(input: {
      tenantId: string;
      contractId: string;
      amendmentId: string;
      reason: string;
    }): Promise<EmploymentContractAmendment> {
      const { rows } = await this.pool.query(
        `UPDATE employment_contract_amendments
            SET status='CANCELLED', cancelled_at=now(), cancel_reason=$4
          WHERE tenant_id=$1 AND contract_id=$2 AND id=$3
            AND status='SCHEDULED'
          RETURNING *`,
        [
          input.tenantId,
          input.contractId,
          input.amendmentId,
          input.reason,
        ],
      );
      if (!rows[0]) {
        const current = await this.pool.query(
          `SELECT status FROM employment_contract_amendments
            WHERE tenant_id=$1 AND contract_id=$2 AND id=$3`,
          [input.tenantId, input.contractId, input.amendmentId],
        );
        if (!current.rows[0]) {
          notFound("EmploymentContractAmendment", input.amendmentId);
        }
        throw new ConflictError(
          `contract amendment is ${current.rows[0].status}`,
        );
      }
      return this.mapEmploymentContractAmendment(rows[0]);
    }
    
    async getEmploymentContract(
      tenantId: string,
      contractId: string,
    ): Promise<EmploymentContract> {
      const { rows } = await this.pool.query(
        "SELECT * FROM employment_contracts WHERE tenant_id=$1 AND id=$2",
        [tenantId, contractId],
      );
      if (!rows[0]) notFound("EmploymentContract", contractId);
      return this.mapEmploymentContract(rows[0]);
    }
    
    async createPayrollRun(input: {
      tenantId: string;
      cycleId: string;
      periodStart: string;
      periodEnd: string;
      currency: string;
      preparedBy: string;
    }): Promise<PayrollRun> {
      if (Date.parse(input.periodEnd) <= Date.parse(input.periodStart)) {
        throw new ConflictError("PAYROLL_PERIOD_INVALID");
      }
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO payroll_runs
            (id, tenant_id, cycle_id, period_start, period_end, currency,
             status, prepared_by)
           VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.cycleId,
            input.periodStart,
            input.periodEnd,
            input.currency,
            input.preparedBy,
          ],
        );
        return this.mapPayrollRun(rows[0], []);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.preparedBy} not found`);
        }
        throw error;
      }
    }
    
    async listPayrollRuns(
      tenantId: string,
      cycleId?: string,
    ): Promise<PayrollRun[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM payroll_runs WHERE tenant_id=$1";
      if (cycleId) {
        params.push(cycleId);
        sql += " AND cycle_id=$2";
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.pool.query(sql, params);
      const runs: PayrollRun[] = [];
      for (const row of rows) {
        const { rows: lines } = await this.pool.query(
          "SELECT * FROM payroll_lines WHERE tenant_id=$1 AND run_id=$2 ORDER BY person_id",
          [tenantId, row.id],
        );
        runs.push(
          this.mapPayrollRun(
            row,
            lines.map((line) => this.mapPayrollLine(line)),
          ),
        );
      }
      return runs;
    }
    
    async getPayrollRun(
      tenantId: string,
      runId: string,
    ): Promise<PayrollRun> {
      const { rows } = await this.pool.query(
        "SELECT * FROM payroll_runs WHERE tenant_id=$1 AND id=$2",
        [tenantId, runId],
      );
      if (!rows[0]) notFound("PayrollRun", runId);
      const { rows: lines } = await this.pool.query(
        "SELECT * FROM payroll_lines WHERE tenant_id=$1 AND run_id=$2 ORDER BY person_id",
        [tenantId, runId],
      );
      return this.mapPayrollRun(
        rows[0],
        lines.map((line) => this.mapPayrollLine(line)),
      );
    }
    
    async savePayrollCalculation(input: {
      tenantId: string;
      runId: string;
      lines: Array<Omit<PayrollLine, "id" | "tenantId" | "runId" | "createdAt">>;
      totalGross: string;
      totalDeductions: string;
      totalTax: string;
      totalSocialInsurance: string;
      totalNet: string;
      blockedCount: number;
    }): Promise<PayrollRun> {
      return this.transaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM payroll_runs
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.runId],
        );
        if (!rows[0]) notFound("PayrollRun", input.runId);
        if (!["DRAFT", "CALCULATED", "BLOCKED"].includes(rows[0].status)) {
          throw new ConflictError(`payroll run is ${rows[0].status}`);
        }
        await client.query(
          "DELETE FROM payroll_lines WHERE tenant_id=$1 AND run_id=$2",
          [input.tenantId, input.runId],
        );
        for (const line of input.lines) {
          await client.query(
            `INSERT INTO payroll_lines
              (id, tenant_id, run_id, person_id, contract_id, currency,
               fixed_amount, incentive_amount, gross_amount, deduction_amount,
               tax_amount, social_insurance_amount, net_amount,
               minimum_monthly_wage, minimum_wage_passed, deduction_cap_rate,
               deduction_cap_amount, deduction_cap_passed, variable_share_rate,
               variable_share_cap_rate, variable_share_cap_amount,
               variable_share_passed, deduction_breakdown,
               deduction_type_cap_passed, deduction_type_cap_breaches,
               prior_incentive_amount, incentive_change_rate,
               smoothing_threshold_rate, smoothing_passed, bank_account_ref,
               notice_acknowledgement_passed, notice_acknowledgement_missing,
               tax_calculation_mode, ytd_taxable_income, ytd_tax_withheld,
               iit_rate_percent, iit_quick_deduction,
               raw_incentive_amount, smoothed_incentive_amount,
               smoothing_delta, smoothing_mode,
               deduction_legal_basis_passed, deduction_legal_basis_missing)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25::jsonb,$26,$27,$28,$29,$30,$31,$32::jsonb,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43::text[])`,
            [
              randomUUID(),
              input.tenantId,
              input.runId,
              line.personId,
              line.contractId,
              line.currency,
              line.fixedAmount,
              line.incentiveAmount,
              line.grossAmount,
              line.deductionAmount,
              line.taxAmount,
              line.socialInsuranceAmount,
              line.netAmount,
              line.minimumMonthlyWage,
              line.minimumWagePassed,
              line.deductionCapRate,
              line.deductionCapAmount,
              line.deductionCapPassed,
              line.variableShareRate,
              line.variableShareCapRate,
              line.variableShareCapAmount,
              line.variableSharePassed,
              JSON.stringify(line.deductionBreakdown),
              line.deductionTypeCapPassed,
              JSON.stringify(line.deductionTypeCapBreaches),
              line.priorIncentiveAmount,
              line.incentiveChangeRate,
              line.smoothingThresholdRate,
              line.smoothingPassed,
              line.bankAccountRef ?? null,
              line.noticeAcknowledgementPassed,
              JSON.stringify(line.noticeAcknowledgementMissing),
              line.taxCalculationMode ?? null,
              line.ytdTaxableIncome ?? null,
              line.ytdTaxWithheld ?? null,
              line.iitRatePercent ?? null,
              line.iitQuickDeduction ?? null,
              line.rawIncentiveAmount ?? line.incentiveAmount,
              line.smoothedIncentiveAmount ?? line.incentiveAmount,
              line.smoothingDelta ?? "0",
              line.smoothingMode ?? "BLOCK",
              line.deductionLegalBasisPassed ?? true,
              line.deductionLegalBasisMissing ?? [],
            ],
          );
        }
        const status = input.blockedCount > 0 ? "BLOCKED" : "CALCULATED";
        const { rows: updated } = await client.query(
          `UPDATE payroll_runs
              SET status=$3, total_gross=$4, total_deductions=$5,
                  total_tax=$6, total_social_insurance=$7, total_net=$8,
                  line_count=$9, blocked_count=$10,
                  updated_at=now(), version=version+1
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [
            input.tenantId,
            input.runId,
            status,
            input.totalGross,
            input.totalDeductions,
            input.totalTax,
            input.totalSocialInsurance,
            input.totalNet,
            input.lines.length,
            input.blockedCount,
          ],
        );
        const { rows: lines } = await client.query(
          "SELECT * FROM payroll_lines WHERE tenant_id=$1 AND run_id=$2 ORDER BY person_id",
          [input.tenantId, input.runId],
        );
        return this.mapPayrollRun(
          updated[0],
          lines.map((line) => this.mapPayrollLine(line)),
        );
      });
    }
    
    async approvePayrollRun(input: {
      tenantId: string;
      runId: string;
      approvedBy: string;
    }): Promise<PayrollRun> {
      return this.transaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM payroll_runs
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.runId],
        );
        if (!rows[0]) notFound("PayrollRun", input.runId);
        const run = this.mapPayrollRun(rows[0], []);
        if (run.status !== "CALCULATED") {
          throw new ConflictError(`payroll run is ${run.status}`);
        }
        if (run.preparedBy === input.approvedBy) {
          throw new ConflictError(
            "PAYROLL_SELF_APPROVAL: the preparer cannot approve the run",
          );
        }
        const { rows: personRows } = await client.query(
          "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.approvedBy],
        );
        if (!personRows[0]) notFound("Person", input.approvedBy);
        const { rows: updated } = await client.query(
          `UPDATE payroll_runs
              SET status='APPROVED', approved_by=$3, approved_at=now(),
                  updated_at=now(), version=version+1
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.runId, input.approvedBy],
        );
        return this.mapPayrollRun(updated[0], []);
      });
    }
    
    async payPayrollRun(input: {
      tenantId: string;
      runId: string;
    }): Promise<PayrollRun> {
      const { rows } = await this.pool.query(
        `UPDATE payroll_runs
            SET status='PAID', paid_at=now(), updated_at=now(),
                version=version+1
          WHERE tenant_id=$1 AND id=$2 AND status='APPROVED'
          RETURNING *`,
        [input.tenantId, input.runId],
      );
      if (!rows[0]) {
        const run = await this.getPayrollRun(input.tenantId, input.runId);
        throw new ConflictError(`payroll run is ${run.status}`);
      }
      return this.mapPayrollRun(rows[0], []);
    }
    
    async reversePayrollRun(input: {
      tenantId: string;
      runId: string;
      reason: string;
      reversedBy: string;
    }): Promise<PayrollRun> {
      const { rows: personRows } = await this.pool.query(
        "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.reversedBy],
      );
      if (!personRows[0]) notFound("Person", input.reversedBy);
      const { rows } = await this.pool.query(
        `UPDATE payroll_runs
            SET status='REVERSED', reversed_at=now(), reversed_by=$3,
                reversal_reason=$4, updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2 AND status IN ('APPROVED','PAID')
          RETURNING *`,
        [
          input.tenantId,
          input.runId,
          input.reversedBy,
          input.reason,
        ],
      );
      if (!rows[0]) {
        const run = await this.getPayrollRun(input.tenantId, input.runId);
        throw new ConflictError(`payroll run is ${run.status}`);
      }
      return this.mapPayrollRun(rows[0], []);
    }
    
    async cancelPayrollRun(input: {
      tenantId: string;
      runId: string;
    }): Promise<PayrollRun> {
      const { rows } = await this.pool.query(
        `UPDATE payroll_runs
            SET status='CANCELLED', updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
            AND status NOT IN ('PAID','REVERSED','CANCELLED')
          RETURNING *`,
        [input.tenantId, input.runId],
      );
      if (!rows[0]) {
        const run = await this.getPayrollRun(input.tenantId, input.runId);
        throw new ConflictError(`payroll run is ${run.status}`);
      }
      return this.mapPayrollRun(rows[0], []);
    }
  };
}
