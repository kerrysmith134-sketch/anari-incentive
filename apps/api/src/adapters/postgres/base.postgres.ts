/**
 * NPV2-013：PgPlatformStore 共享基类（字段 + 跨端口助手；方法体逐字平移，可见性放宽为 protected）。
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
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
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
  ExternalObjectIdentity,
  QuarantineRecord,
  RawSourceRecord,
  WebhookRoutingKey,
  SyncCheckpoint,
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
import { formatInvoiceAmount, now, notFound, surveyAverage, aggregateSurveyReport, iso, isoDate, optionalCount, decimalText, addUtcMonths, computeEquityVesting, money } from "../shared.js";

export class PgPlatformStoreBase {


    constructor(protected readonly pool: Pool) {}
  
  protected async decideRuleChangeOrder(
    this: PgPlatformStoreBaseShape,
    input: { tenantId: string; orderId: string; approvedBy: string },
    status: "APPROVED" | "REJECTED",
  ): Promise<RuleChangeOrder> {
    return this.transactionFor(input.tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM rule_change_orders
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.orderId],
      );
      if (!rows[0]) notFound("RuleChangeOrder", input.orderId);
      const order = this.mapRuleChangeOrder(rows[0]);
      if (order.status !== "DRAFT") {
        throw new ConflictError(
          `rule change order ${order.id} is ${order.status}`,
        );
      }
      if (order.requestedBy === input.approvedBy) {
        throw new ConflictError(
          "SEPARATION_OF_DUTIES: the requester cannot decide their own change",
        );
      }
      try {
        const { rows: updated } = await client.query(
          `UPDATE rule_change_orders
              SET status=$3, approved_by=$4, approved_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.orderId, status, input.approvedBy],
        );
        return this.mapRuleChangeOrder(updated[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.approvedBy} not found`);
        }
        throw error;
      }
    });
  }
  
  async amendEmploymentContract(
    this: PgPlatformStoreBaseShape,input: {
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
    if (future) {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `SELECT * FROM employment_contracts
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, input.contractId],
      );
      if (!rows[0]) notFound("EmploymentContract", input.contractId);
      const row = rows[0];
      if (row.status !== "ACTIVE") {
        throw new ConflictError(`employment contract is ${row.status}`);
      }
      const versionResult = await this.tenantQuery(input.tenantId, 
        `SELECT GREATEST(
           $3::int,
           COALESCE(MAX(pay_plan_version), 0)
         ) + 1 AS version
         FROM employment_contract_amendments
         WHERE tenant_id=$1 AND contract_id=$2
           AND status <> 'CANCELLED'`,
        [input.tenantId, input.contractId, Number(row.pay_plan_version ?? 1)],
      );
      const payPlanVersion = Number(versionResult.rows[0]?.version ?? 1);
      const beforeTerms = {
        fixedMonthlySalary: decimalText(String(row.fixed_monthly_salary)),
        minimumMonthlyWage: decimalText(String(row.minimum_monthly_wage)),
        taxRate: decimalText(String(row.tax_rate)),
        socialInsuranceRate: decimalText(String(row.social_insurance_rate)),
        deductionCapRate: decimalText(String(row.deduction_cap_rate)),
        variableShareCapRate: decimalText(
          String(row.variable_share_cap_rate),
        ),
        deductionOrder: (row.deduction_order as string[] | null) ?? [],
        bankAccountRef: row.bank_account_ref ?? undefined,
        payPlanVersion: Number(row.pay_plan_version ?? 1),
      };
      const afterTerms = {
        fixedMonthlySalary: input.fixedMonthlySalary,
        minimumMonthlyWage: input.minimumMonthlyWage,
        taxRate: input.taxRate,
        socialInsuranceRate: input.socialInsuranceRate,
        deductionCapRate: input.deductionCapRate,
        variableShareCapRate: input.variableShareCapRate,
        deductionOrder:
          input.deductionOrder.length > 0
            ? input.deductionOrder
            : ((row.deduction_order as string[] | null) ?? []),
        bankAccountRef: input.bankAccountRef,
        payPlanVersion,
      };
      await this.tenantQuery(input.tenantId, 
        `INSERT INTO employment_contract_amendments
          (tenant_id, contract_id, pay_plan_version, before_terms,
           after_terms, effective_from, consent_signature_ref, approved_by,
           status)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,'SCHEDULED')`,
        [
          input.tenantId,
          input.contractId,
          payPlanVersion,
          JSON.stringify(beforeTerms),
          JSON.stringify(afterTerms),
          input.effectiveFrom,
          input.consentSignatureRef,
          input.approvedBy,
        ],
      );
      return this.mapEmploymentContract(row);
    }
    return this.transactionFor(input.tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM employment_contracts
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [input.tenantId, input.contractId],
      );
      if (!rows[0]) notFound("EmploymentContract", input.contractId);
      const row = rows[0];
      if (row.status !== "ACTIVE") {
        throw new ConflictError(`employment contract is ${row.status}`);
      }
      const beforeTerms = {
        fixedMonthlySalary: decimalText(String(row.fixed_monthly_salary)),
        minimumMonthlyWage: decimalText(String(row.minimum_monthly_wage)),
        taxRate: decimalText(String(row.tax_rate)),
        socialInsuranceRate: decimalText(String(row.social_insurance_rate)),
        deductionCapRate: decimalText(String(row.deduction_cap_rate)),
        variableShareCapRate: decimalText(
          String(row.variable_share_cap_rate),
        ),
        deductionOrder:
          (row.deduction_order as string[] | null) ?? [],
        deductionTypeCaps:
          (row.deduction_type_caps as Record<string, string> | null) ?? {},
        smoothingThresholdRate: decimalText(
          String(row.smoothing_threshold_rate),
        ),
        smoothingMode: (row.smoothing_mode as string | null) ?? "BLOCK",
        smoothingWindowPeriods: Number(row.smoothing_window_periods ?? 3),
        smoothingMaxStepRate: decimalText(
          String(row.smoothing_max_step_rate ?? "0.5"),
        ),
        compensationTemplateCode: row.compensation_template_code ?? undefined,
        bankAccountRef: row.bank_account_ref ?? undefined,
        payPlanVersion: Number(row.pay_plan_version ?? 1),
      };
      const versionResult = await client.query(
        `SELECT GREATEST(
           $3::int,
           COALESCE(MAX(pay_plan_version), 0)
         ) + 1 AS version
         FROM employment_contract_amendments
         WHERE tenant_id=$1 AND contract_id=$2
           AND status <> 'CANCELLED'`,
        [input.tenantId, input.contractId, Number(row.pay_plan_version ?? 1)],
      );
      const payPlanVersion = Number(versionResult.rows[0]?.version ?? 1);
      const { rows: updated } = await client.query(
        `UPDATE employment_contracts
            SET fixed_monthly_salary=$3, minimum_monthly_wage=$4,
                tax_rate=$5, social_insurance_rate=$6, deduction_cap_rate=$7,
                variable_share_cap_rate=$8, deduction_order=$9::jsonb,
                deduction_type_caps=$10::jsonb,
                smoothing_threshold_rate=$11,
                smoothing_mode=$17, smoothing_window_periods=$18,
                smoothing_max_step_rate=$19,
                compensation_template_code=$12, bank_account_ref=$13,
                pay_plan_version=$14, consent_signature_ref=$15,
                consent_signed_at=$16, version=version+1, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.contractId,
          input.fixedMonthlySalary,
          input.minimumMonthlyWage,
          input.taxRate,
          input.socialInsuranceRate,
          input.deductionCapRate,
          input.variableShareCapRate,
          JSON.stringify(
            input.deductionOrder.length > 0
              ? input.deductionOrder
              : ((row.deduction_order as string[] | null) ?? []),
          ),
          JSON.stringify(
            Object.keys(input.deductionTypeCaps).length > 0
              ? input.deductionTypeCaps
              : ((row.deduction_type_caps as Record<string, string> | null) ??
                {}),
          ),
          input.smoothingThresholdRate,
          input.compensationTemplateCode ??
            (row.compensation_template_code as string | null),
          input.bankAccountRef ?? null,
          payPlanVersion,
          input.consentSignatureRef,
          input.effectiveFrom,
          input.smoothingMode ??
            ((row.smoothing_mode as string | null) ?? "BLOCK"),
          input.smoothingWindowPeriods ??
            Number(row.smoothing_window_periods ?? 3),
          input.smoothingMaxStepRate ??
            String(row.smoothing_max_step_rate ?? "0.5"),
        ],
      );
      const afterTerms = {
        fixedMonthlySalary: decimalText(
          String(updated[0]?.fixed_monthly_salary),
        ),
        minimumMonthlyWage: decimalText(
          String(updated[0]?.minimum_monthly_wage),
        ),
        taxRate: decimalText(String(updated[0]?.tax_rate)),
        socialInsuranceRate: decimalText(
          String(updated[0]?.social_insurance_rate),
        ),
        deductionCapRate: decimalText(
          String(updated[0]?.deduction_cap_rate),
        ),
        variableShareCapRate: decimalText(
          String(updated[0]?.variable_share_cap_rate),
        ),
        deductionOrder:
          (updated[0]?.deduction_order as string[] | null) ?? [],
        deductionTypeCaps:
          (updated[0]?.deduction_type_caps as Record<string, string> | null) ??
          {},
        smoothingThresholdRate: decimalText(
          String(updated[0]?.smoothing_threshold_rate),
        ),
        smoothingMode: (updated[0]?.smoothing_mode as string | null) ?? "BLOCK",
        smoothingWindowPeriods: Number(updated[0]?.smoothing_window_periods ?? 3),
        smoothingMaxStepRate: decimalText(
          String(updated[0]?.smoothing_max_step_rate ?? "0.5"),
        ),
        compensationTemplateCode:
          updated[0]?.compensation_template_code ?? undefined,
        bankAccountRef: updated[0]?.bank_account_ref ?? undefined,
        payPlanVersion,
      };
      await client.query(
        `INSERT INTO employment_contract_amendments
          (tenant_id, contract_id, pay_plan_version, before_terms,
           after_terms, effective_from, consent_signature_ref, approved_by,
           status, applied_at)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,'APPLIED',now())`,
        [
          input.tenantId,
          input.contractId,
          payPlanVersion,
          JSON.stringify(beforeTerms),
          JSON.stringify(afterTerms),
          input.effectiveFrom,
          input.consentSignatureRef,
          input.approvedBy,
        ],
      );
      return this.mapEmploymentContract(updated[0]);
    });
  }
  
  /**
   * NPV2-002：平台管理提升路径——**显式、事务本地、短时**。
   * BEGIN 内 set_config(..., true) 仅在本事务生效，提交/回滚即失效；
   * 不会像旧的连接级 options 那样把整池会话变成 platform_admin。
   * 仅限确需跨租户的平台操作；单租户操作一律走 transactionFor。
   */
  protected async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.platform_admin', 'on', true)",
      );
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * NPV2-002：普通租户事务（默认路径）——BEGIN 内设置 app.tenant_id，
   * RLS 按租户隔离生效，无需任何管理员提升。
   */
  protected async transactionFor<T>(
    tenantId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenantId,
      ]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** 单条租户上下文只读（NPV2-002：替代无上下文的直读）。返回 QueryResult。 */
  protected async tenantQuery(
    tenantId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<any>> {
    return this.transactionFor(tenantId, async (client) =>
      client.query(sql, params),
    );
  }

  /** 单条跨租户平台只读（NPV2-002：显式提升，事务本地）。返回 QueryResult。 */
  protected async platformQuery(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<any>> {
    return this.transaction(async (client) => client.query(sql, params));
  }
  
  protected async assertTenant(
    this: PgPlatformStoreBaseShape,tenantId: string): Promise<void> {
    const { rowCount } = await this.tenantQuery(tenantId, 
      "SELECT 1 FROM tenants WHERE id=$1",
      [tenantId],
    );
    if (!rowCount) notFound("Tenant", tenantId);
  }
  
  protected mapTenant(row: QueryResultRow): PlatformTenant {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      defaultTimezone: row.default_timezone,
      defaultCurrency: String(row.default_currency).trim(),
      settings: row.settings ?? {},
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapUser(row: QueryResultRow): PlatformUser {
    return {
      id: row.id,
      email: row.email ?? undefined,
      displayName: row.display_name,
      authSubject: row.auth_subject,
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapMembership(row: QueryResultRow): PlatformMembership {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      status: row.status,
      roleCodes: row.role_codes ?? [],
      joinedAt: iso(row.joined_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      userDisplayName: row.user_display_name ?? undefined,
      userEmail: row.user_email ?? undefined,
    };
  }
  
  protected mapSubscriptionPlan(row: QueryResultRow): SubscriptionPlan {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description ?? undefined,
      monthlyPrice: String(row.monthly_price),
      currency: row.currency,
      seatLimit: row.seat_limit,
      trialDays: row.trial_days,
      features: Array.isArray(row.features) ? row.features : [],
      active: row.active,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapTenantSubscription(
    row: QueryResultRow,
    plan?: QueryResultRow,
  ): TenantSubscription {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      planId: row.plan_id,
      planCode: plan?.code ?? row.plan_code,
      planName: plan?.name ?? row.plan_name,
      status: row.status,
      seats: row.seats,
      currentPeriodStart: iso(row.current_period_start) ?? "",
      currentPeriodEnd: iso(row.current_period_end) ?? "",
      trialEndsAt: iso(row.trial_ends_at) ?? undefined,
      canceledAt: iso(row.canceled_at) ?? undefined,
      cancelReason: row.cancel_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapStrategicPoolCase(row: QueryResultRow): StrategicPoolCase {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      poolAmount: String(row.pool_amount),
      capAmount: String(row.cap_amount),
      currency: row.currency,
      budgetPoolId: row.budget_pool_id ?? undefined,
      rationale: row.rationale,
      requestedBy: row.requested_by,
      units: row.units ?? undefined,
      unitStandardCost:
        row.unit_standard_cost === null
          ? undefined
          : String(row.unit_standard_cost),
      totalStandardCost:
        row.total_standard_cost === null
          ? undefined
          : String(row.total_standard_cost),
      transferPricingRef: row.transfer_pricing_ref ?? undefined,
      costReviewedBy: row.cost_reviewed_by ?? undefined,
      costReviewedAt: iso(row.cost_reviewed_at) ?? undefined,
      financeApprovedBy: row.finance_approved_by ?? undefined,
      financeApprovedAt: iso(row.finance_approved_at) ?? undefined,
      deferredInstallmentMonths: row.deferred_installment_months,
      status: row.status,
      rejectedReason: row.rejected_reason ?? undefined,
      activatedAt: iso(row.activated_at) ?? undefined,
      settledAt: iso(row.settled_at) ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapInvoice(row: QueryResultRow): TenantInvoice {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      subscriptionId: row.subscription_id,
      number: row.number,
      status: row.status,
      currency: row.currency,
      lineItems: Array.isArray(row.line_items) ? row.line_items : [],
      totalAmount: String(row.total_amount),
      periodStart: iso(row.period_start) ?? undefined,
      periodEnd: iso(row.period_end) ?? undefined,
      dueDate: iso(row.due_date) ?? undefined,
      issuedAt: iso(row.issued_at) ?? undefined,
      paidAt: iso(row.paid_at) ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapPerson(row: QueryResultRow): PlatformPerson {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id ?? undefined,
      employeeCode: row.employee_code,
      displayName: row.display_name,
      employmentStatus: row.employment_status,
      managerPersonId: row.manager_person_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapOrgNode(row: QueryResultRow): PlatformOrgNode {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      parentId: row.parent_id ?? undefined,
      nodeType: row.node_type,
      name: row.name,
      path: row.path ?? undefined,
      active: row.active,
      externalId: row.external_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapOrgAssignment(row: QueryResultRow): PlatformOrgAssignment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      orgNodeId: row.org_node_id,
      validFrom: isoDate(row.valid_from) ?? "",
      validTo: isoDate(row.valid_to),
      allocation: decimalText(row.allocation),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapNotice(row: QueryResultRow): EmployeeNotice {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id ?? undefined,
      noticeType: row.notice_type,
      title: row.title,
      bodyRef: row.body_ref,
      publishedAt: iso(row.published_at) ?? new Date().toISOString(),
      effectiveFrom: iso(row.effective_from) ?? new Date().toISOString(),
      acknowledgementRequired: row.acknowledgement_required,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapAcknowledgement(row: QueryResultRow): PolicyAcknowledgement {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      noticeId: row.notice_id,
      personId: row.person_id,
      acknowledgedAt: iso(row.acknowledged_at),
      signatureRef: row.signature_ref ?? undefined,
      declinedAt: iso(row.declined_at),
      declineReason: row.decline_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapRepresentation(row: QueryResultRow): EmployeeRepresentation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      bodyName: row.body_name,
      bodyType: row.body_type,
      jurisdiction: row.jurisdiction,
      active: row.active,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapConsultation(row: QueryResultRow): PolicyConsultation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id,
      representationId: row.representation_id ?? undefined,
      consultationType: row.consultation_type,
      startedAt: iso(row.started_at) ?? new Date().toISOString(),
      endedAt: iso(row.ended_at),
      minutesRef: row.minutes_ref ?? undefined,
      feedbackSummary: row.feedback_summary ?? undefined,
      outcome: row.outcome,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapDpia(row: QueryResultRow): DpiaRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      assessmentType: row.assessment_type,
      scope: row.scope,
      status: row.status,
      riskSummary: row.risk_summary ?? {},
      mitigationSummary: row.mitigation_summary ?? {},
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapDsar(row: QueryResultRow): DsarRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      requestType: row.request_type,
      status: row.status,
      receivedAt: iso(row.received_at) ?? new Date().toISOString(),
      dueAt: iso(row.due_at),
      resolvedAt: iso(row.resolved_at),
      resolutionRef: row.resolution_ref ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapRetentionDisposalRequest(
    row: QueryResultRow,
  ): RetentionDisposalRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      retentionPolicyId: row.retention_policy_id,
      dataCategory: row.data_category,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by ?? undefined,
      status: row.status,
      reason: row.reason,
      requestedAt: iso(row.requested_at) ?? new Date().toISOString(),
      scheduledFor:
        iso(row.scheduled_for) ?? new Date().toISOString(),
      approvedAt: iso(row.approved_at),
      completedAt: iso(row.completed_at),
      cancelledAt: iso(row.cancelled_at),
      cancelReason: row.cancel_reason ?? undefined,
    };
  }
  
  protected mapAppealEvidenceDisclosure(
    row: QueryResultRow,
  ): AppealEvidenceDisclosure {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      appealId: row.appeal_id,
      disclosedBy: row.disclosed_by,
      method: row.method,
      evidenceRefs: (row.evidence_refs ?? []) as string[],
      note: row.note ?? undefined,
      disclosedAt: iso(row.disclosed_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapWorkforceSubgroupAttribute(
    row: QueryResultRow,
  ): WorkforceSubgroupAttribute {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      dimension: row.dimension,
      value: row.value,
      consentRef: row.consent_ref,
      consentedAt: iso(row.consented_at) ?? new Date().toISOString(),
      expiresAt: iso(row.expires_at),
      recordedBy: row.recorded_by ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapRetentionPolicy(row: QueryResultRow): RetentionPolicy {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      dataCategory: row.data_category,
      retentionMonths: Number(row.retention_months),
      legalBasis: row.legal_basis,
      legalHold: row.legal_hold,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapDataSource(row: QueryResultRow): DataSource {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      category: row.category,
      ownerPersonId: row.owner_person_id,
      backupOwnerPersonId: row.backup_owner_person_id ?? undefined,
      slaHours: Number(row.sla_hours),
      criticality: row.criticality,
      containsPersonalData: row.contains_personal_data,
      storageRegion: row.storage_region,
      crossBorderTransfers: row.cross_border_transfers,
      processorRefs: (row.processor_refs as string[] | null) ?? [],
      fields: (row.fields as DataSourceField[] | null) ?? [],
      status: row.status,
      lastReviewedAt: iso(row.last_reviewed_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }
  
  protected mapESignEnvelope(row: QueryResultRow): ESignEnvelope {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      contractId: row.contract_id,
      provider: row.provider,
      envelopeRef: row.envelope_ref,
      documentHash: row.document_hash,
      signerPersonId: row.signer_person_id,
      status: row.status,
      sentAt: iso(row.sent_at) ?? new Date().toISOString(),
      completedAt: iso(row.completed_at),
      declineReason: row.decline_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapCompensationTemplate(
    row: QueryResultRow,
  ): CompensationTemplate {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      roleCode: row.role_code,
      employmentType: row.employment_type,
      currency: String(row.currency).trim(),
      fixedSalaryMin:
        decimalText(String(row.fixed_salary_min)) ?? "0",
      fixedSalaryMax:
        decimalText(String(row.fixed_salary_max)) ?? "0",
      deductionCapRate:
        decimalText(String(row.deduction_cap_rate)) ?? "0.2",
      variableShareCapRate:
        decimalText(String(row.variable_share_cap_rate)) ?? "1",
      smoothingThresholdRate:
        decimalText(String(row.smoothing_threshold_rate)) ?? "1",
      deductionOrder:
        (row.deduction_order as string[] | null) ?? [],
      deductionTypeCaps:
        (row.deduction_type_caps as Record<string, string> | null) ?? {},
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapModelRedTeamRun(row: QueryResultRow): ModelRedTeamRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      promptVersion: row.prompt_version,
      scope: row.scope,
      testsRun: Number(row.tests_run),
      passed: row.passed,
      findings: (row.findings as string[] | null) ?? [],
      artifactRef: row.artifact_ref ?? undefined,
      createdBy: row.created_by,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapAuditRedaction(row: QueryResultRow): AuditRedaction {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      auditEventId: row.audit_event_id,
      replacement: row.replacement,
      reason: row.reason,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapModelCanaryRun(row: QueryResultRow): ModelCanaryRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      baselineEvaluationRunId: row.baseline_evaluation_run_id,
      candidateEvaluationRunId: row.candidate_evaluation_run_id,
      datasetRef: row.dataset_ref,
      trafficPercent: Number(row.traffic_percent),
      passed: row.passed,
      blockers: (row.blockers as string[] | null) ?? [],
      metrics: (row.metrics as Record<string, unknown> | null) ?? {},
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapModelEvaluationDataset(
    row: QueryResultRow,
  ): ModelEvaluationDataset {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      version: Number(row.version),
      name: row.name,
      sampleSize: Number(row.sample_size),
      holdoutSize: Number(row.holdout_size),
      labelSource: row.label_source,
      ownerPersonId: row.owner_person_id,
      status: row.status,
      refreshedAt: iso(row.refreshed_at) ?? new Date().toISOString(),
      nextRefreshDueAt: iso(row.next_refresh_due_at),
      contentHash: row.content_hash ?? undefined,
      samples: (row.samples as ModelEvaluationDataset["samples"] | null) ?? [],
      retiredAt: iso(row.retired_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapModelProviderPolicy(
    row: QueryResultRow,
  ): ModelProviderPolicy {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      provider: row.provider,
      zeroRetentionConfirmed: Boolean(row.zero_retention_confirmed),
      dpaRef: row.dpa_ref,
      inferenceRegion: row.inference_region,
      egressAllowlist: (row.egress_allowlist as string[] | null) ?? [],
      approvedBy: row.approved_by,
      approvedAt: iso(row.approved_at) ?? new Date().toISOString(),
      status: row.status,
      retiredAt: iso(row.retired_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapDiscretionaryPoolReview(
    row: QueryResultRow,
  ): DiscretionaryPoolReview {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      poolId: row.pool_id,
      committeePersonIds:
        (row.committee_person_ids as string[] | null) ?? [],
      employeeObserverPersonId:
        row.employee_observer_person_id ?? undefined,
      selectionCriteria: row.selection_criteria,
      decisionNotes: row.decision_notes,
      reviewedBy: row.reviewed_by,
      reviewedAt: iso(row.reviewed_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapClawbackCase(row: QueryResultRow): ClawbackCase {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      amount: decimalText(String(row.amount)) ?? "0",
      currency: String(row.currency).trim(),
      reasonCode: row.reason_code,
      explanation: row.explanation,
      consentSignatureRef: row.consent_signature_ref,
      installmentMonths: Number(row.installment_months),
      hardshipWaiver: Boolean(row.hardship_waiver),
      hardshipReason: row.hardship_reason ?? undefined,
      status: row.status,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      waivedAt: iso(row.waived_at),
      waiverReason: row.waiver_reason ?? undefined,
      cancelledAt: iso(row.cancelled_at),
      cancelReason: row.cancel_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapBreakGlassGrant(row: QueryResultRow): BreakGlassGrant {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      scope: row.scope,
      granteePersonId: row.grantee_person_id,
      reason: row.reason,
      grantedBy: row.granted_by,
      expiresAt: iso(row.expires_at) ?? new Date().toISOString(),
      status: row.status,
      revokedAt: iso(row.revoked_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapPilotEnrollment(row: QueryResultRow): PilotEnrollment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      pilotCode: row.pilot_code,
      scope: row.scope,
      consentSignatureRef: row.consent_signature_ref,
      consentSignedAt:
        iso(row.consent_signed_at) ?? new Date().toISOString(),
      status: row.status,
      withdrawnAt: iso(row.withdrawn_at),
      withdrawalReason: row.withdrawal_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapManagerTrainingRecord(
    row: QueryResultRow,
  ): ManagerTrainingRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      trainingCode: row.training_code,
      title: row.title,
      completedAt: iso(row.completed_at) ?? new Date().toISOString(),
      expiresAt: iso(row.expires_at),
      evidenceRef: row.evidence_ref ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapCalibrationSession(row: QueryResultRow): CalibrationSession {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      title: row.title,
      heldAt: iso(row.held_at) ?? new Date().toISOString(),
      facilitatorPersonId: row.facilitator_person_id,
      attendeePersonIds:
        (row.attendee_person_ids as string[] | null) ?? [],
      policyVersionId: row.policy_version_id ?? undefined,
      notes: row.notes ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapFairnessCommitment(row: QueryResultRow): FairnessCommitment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      version: Number(row.version),
      statement: row.statement,
      ownerPersonId: row.owner_person_id,
      channels: (row.channels as string[] | null) ?? [],
      status: row.status,
      publishedAt: iso(row.published_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapTrustSurvey(row: QueryResultRow): TrustSurveyRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      period: row.period,
      title: row.title,
      status: row.status,
      anonymous: Boolean(row.anonymous),
      questions: (row.questions as TrustSurveyQuestion[] | null) ?? [],
      openedAt: iso(row.opened_at),
      closedAt: iso(row.closed_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapTrustSurveyResponse(row: QueryResultRow): TrustSurveyResponse {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      surveyId: row.survey_id,
      respondentHash: row.respondent_hash,
      scores: (row.scores as Record<string, number> | null) ?? {},
      submittedAt: iso(row.submitted_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapConflictDeclaration(row: QueryResultRow): ConflictDeclaration {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      relatedPersonId: row.related_person_id,
      relationshipType: row.relationship_type,
      description: row.description,
      status: row.status,
      declaredAt: iso(row.declared_at) ?? new Date().toISOString(),
      revokedAt: iso(row.revoked_at),
      revocationReason: row.revocation_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapApprovalRequest(row: QueryResultRow): ApprovalRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      actionType: row.action_type,
      targetType: row.target_type,
      targetId: row.target_id,
      targetVersion: Number(row.target_version),
      requestedByType: row.requested_by_type,
      requestedById: row.requested_by_id ?? undefined,
      riskTier: row.risk_tier,
      status: row.status,
      requiredApprovals: Number(row.required_approvals),
      approvedCount: Number(row.approved_count),
      expiresAt: iso(row.expires_at),
      payloadHash: row.payload_hash,
      idempotencyKey: row.idempotency_key,
      consumedAt: iso(row.consumed_at),
      consumedBy: row.consumed_by ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapApprovalDecision(row: QueryResultRow): ApprovalDecision {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      requestId: row.request_id,
      decision: row.decision,
      approverPersonId: row.approver_person_id,
      payloadHash: row.payload_hash,
      reason: row.reason ?? undefined,
      decidedAt: iso(row.decided_at) ?? new Date().toISOString(),
      authContext: row.auth_context ?? {},
    };
  }
  
  protected mapSettlementExport(row: QueryResultRow): SettlementExport {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      batchId: row.batch_id,
      exportRef: row.export_ref,
      exportHash: row.export_hash,
      exportedBy: row.exported_by,
      exportedAt: iso(row.exported_at) ?? new Date().toISOString(),
      acknowledgedAt: iso(row.acknowledged_at),
      acknowledgementRef: row.acknowledgement_ref ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapSettlementAcknowledgement(
    row: QueryResultRow,
  ): SettlementAcknowledgement {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      exportId: row.export_id,
      externalReference: row.external_reference,
      acknowledgedAt:
        iso(row.acknowledged_at) ?? new Date().toISOString(),
      payloadHash: row.payload_hash,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapBudgetPool(row: QueryResultRow): BudgetPool {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      code: row.code,
      name: row.name,
      poolType: row.pool_type,
      currency: String(row.currency).trim(),
      approvedAmount: decimalText(String(row.approved_amount)) ?? "0",
      committedAmount:
        decimalText(String(row.committed_amount)) ?? "0",
      status: row.status,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapBudgetAllocation(row: QueryResultRow): BudgetAllocation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      budgetPoolId: row.budget_pool_id,
      targetType: row.target_type,
      targetId: row.target_id,
      amount: decimalText(String(row.amount)) ?? "0",
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapCashGateInput(row: QueryResultRow): CashGateInput {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      asOfDate: isoDate(row.as_of_date) ?? "",
      safetyReserveMonths:
        decimalText(String(row.safety_reserve_months)) ?? "0",
      thirteenWeekForecastRef: row.thirteen_week_forecast_ref,
      passesGate: row.passes_gate,
      approvedBy: row.approved_by,
      approvedAt: iso(row.approved_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapFinancialFact(row: QueryResultRow): FinancialFact {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      sourceSystem: row.source_system,
      sourceRecordId: row.source_record_id,
      factType: row.fact_type,
      periodStart: isoDate(row.period_start),
      periodEnd: isoDate(row.period_end),
      amount: decimalText(String(row.amount)) ?? "0",
      currency: String(row.currency).trim(),
      qualityStatus: row.quality_status,
      sourceUpdatedAt: iso(row.source_updated_at),
      ingestedAt: iso(row.ingested_at) ?? new Date().toISOString(),
      payload: row.payload ?? {},
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      legalEntityId: row.legal_entity_id ?? undefined,
      orderId: row.order_id ?? undefined,
      contractRef: row.contract_ref ?? undefined,
      instrumentType: row.instrument_type ?? undefined,
      recognitionStatus: row.recognition_status ?? "DRAFT",
      accountingPeriod: row.accounting_period ?? undefined,
      fxSnapshot: row.fx_snapshot ?? undefined,
      sourceVersion: row.source_version ?? undefined,
      reversalOf: row.reversal_of ?? undefined,
      reopeningRef: row.reopening_ref ?? undefined,
    };
  }

  protected mapAccountingPeriod(row: QueryResultRow): AccountingPeriod {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      legalEntityId: row.legal_entity_id,
      period: row.period,
      status: row.status,
      closedAt: iso(row.closed_at),
      closedBy: row.closed_by ?? null,
      closeReason: row.close_reason ?? null,
      reopenedAt: iso(row.reopened_at),
      reopenedBy: row.reopened_by ?? null,
      reopeningRef: row.reopening_ref ?? null,
      reopenReason: row.reopen_reason ?? null,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapAccountingPeriodChangeRequest(
    row: QueryResultRow,
  ): AccountingPeriodChangeRequest {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      legalEntityId: row.legal_entity_id,
      period: row.period,
      action: row.action,
      status: row.status,
      requestedBy: row.requested_by,
      requestedAt: iso(row.requested_at) ?? new Date().toISOString(),
      reason: row.reason ?? null,
      reopeningRef: row.reopening_ref ?? null,
      decidedBy: row.decided_by ?? null,
      decidedAt: iso(row.decided_at),
      decisionNote: row.decision_note ?? null,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  protected mapRuleChangeOrder(row: QueryResultRow): RuleChangeOrder {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyCode: row.policy_code,
      fromPolicyVersionId: row.from_policy_version_id ?? undefined,
      toPolicyVersionId: row.to_policy_version_id,
      changeType: row.change_type,
      reason: row.reason,
      impactSimulation: row.impact_simulation ?? {},
      status: row.status,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      publicizedAt: iso(row.publicized_at),
      effectiveFrom: iso(row.effective_from) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapPolicyTestCase(row: QueryResultRow): PolicyTestCase {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id,
      caseCode: row.case_code,
      input: row.input ?? {},
      expectedOutput: row.expected_output ?? {},
      category: row.category,
      status: row.status,
      lastRunAt: iso(row.last_run_at),
      lastRunPassed:
        row.last_run_passed === null ? undefined : row.last_run_passed,
      lastRunResultHash: row.last_run_result_hash ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapPolicyTestRun(row: QueryResultRow): PolicyTestRun {
    return {
      id: row.id,
      runId: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id,
      runAt: iso(row.run_at) ?? new Date().toISOString(),
      total: Number(row.total),
      passedCount: Number(row.passed_count),
      failedCount: Number(row.failed_count),
      retiredCount: Number(row.retired_count),
      passed: row.passed,
      resultsHash: row.results_hash,
      results: row.results ?? [],
    };
  }
  
  protected mapPolicyNotice(row: QueryResultRow): PolicyNotice {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id,
      noticeId: row.notice_id,
      audience: row.audience ?? {},
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapMetricDefinition(row: QueryResultRow): MetricDefinition {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      version: Number(row.version),
      name: row.name,
      description: row.description ?? undefined,
      dataType: row.data_type,
      unit: row.unit ?? undefined,
      aggregationMethod: row.aggregation_method ?? undefined,
      sourceContract: row.source_contract ?? {},
      active: row.active,
      effectiveFrom: isoDate(row.effective_from) ?? "",
      effectiveTo: isoDate(row.effective_to),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapDeliverable(row: QueryResultRow): Deliverable {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workPackageId: row.work_package_id,
      title: row.title,
      deliverableType: row.deliverable_type,
      ownerPersonId: row.owner_person_id,
      dueAt: iso(row.due_at),
      status: row.status,
      artifactRef: row.artifact_ref ?? undefined,
      contentHash: row.content_hash ?? undefined,
      submittedAt: iso(row.submitted_at),
      version: Number(row.version),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapAcceptance(row: QueryResultRow): Acceptance {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      deliverableId: row.deliverable_id,
      decision: row.decision,
      reviewerPersonId: row.reviewer_person_id,
      criteriaResults: row.criteria_results ?? {},
      comments: row.comments ?? undefined,
      decidedAt: iso(row.decided_at) ?? new Date().toISOString(),
      supersedesId: row.supersedes_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapAiSuggestion(row: QueryResultRow): AiSuggestionLog {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      agentTaskId: row.agent_task_id,
      targetType: row.target_type,
      targetId: row.target_id ?? undefined,
      suggestionType: row.suggestion_type,
      modelProvider: row.model_provider ?? undefined,
      modelName: row.model_name ?? undefined,
      modelPromptId: row.model_prompt_id ?? undefined,
      promptVersion: row.prompt_version,
      inputHash: row.input_hash,
      outputJson: row.output_json ?? {},
      validationStatus: row.validation_status,
      acceptedBy: row.accepted_by ?? undefined,
      acceptedAt: iso(row.accepted_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapModelEvaluationRun(row: QueryResultRow): ModelEvaluationRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      evaluationType: row.evaluation_type,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      promptVersion: row.prompt_version,
      datasetRef: row.dataset_ref,
      sampleSize: Number(row.sample_size),
      metrics: row.metrics ?? {},
      subgroupMetrics: row.subgroup_metrics ?? {},
      passed: row.passed,
      blockers: row.blockers ?? [],
      evaluatedAt: iso(row.evaluated_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapModelPrompt(row: QueryResultRow): ModelPrompt {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      promptCode: row.prompt_code,
      version: Number(row.version),
      purpose: row.purpose,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      template: row.template,
      templateHash: row.template_hash,
      status: row.status,
      evaluationRunId: row.evaluation_run_id ?? undefined,
      activatedAt: iso(row.activated_at),
      retiredAt: iso(row.retired_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapAiScoreProposal(row: QueryResultRow): AiScoreProposal {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      personId: row.person_id,
      evaluationRunId: row.evaluation_run_id,
      modelPromptId: row.model_prompt_id ?? undefined,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      promptVersion: row.prompt_version,
      dimensions: row.dimensions ?? [],
      scores: row.scores ?? {},
      overallScore: Number(row.overall_score),
      confidence: Number(row.confidence),
      rationale: row.rationale,
      evidenceRefs: row.evidence_refs ?? [],
      evidenceSnapshotHash: row.evidence_snapshot_hash,
      gateMetrics: row.gate_metrics ?? {},
      riskTier: row.risk_tier ?? "MEDIUM",
      riskReasons: (row.risk_reasons ?? []) as string[],
      riskAssessedAt: iso(row.risk_assessed_at),
      secondReviewRequired: Boolean(row.second_review_required),
      secondReviewDueAt: iso(row.second_review_due_at),
      secondReviewSlaBreached: Boolean(row.second_review_sla_breached),
      zeroScoreRationale: row.zero_score_rationale ?? undefined,
      status: row.status,
      requestedBy: row.requested_by ?? undefined,
      decidedBy: row.decided_by ?? undefined,
      decisionNote: row.decision_note ?? undefined,
      decidedAt: iso(row.decided_at),
      independentScores: (row.independent_scores ?? {}) as Record<string, number>,
      independentRationale: row.independent_rationale ?? undefined,
      reviewStartedAt: iso(row.review_started_at),
      reviewDurationSeconds:
        row.review_duration_seconds === null ||
        row.review_duration_seconds === undefined
          ? undefined
          : Number(row.review_duration_seconds),
      evidenceOpened: Number(row.evidence_opened ?? 0),
      override: Boolean(row.override),
      overrideReason: row.override_reason ?? undefined,
      blindReview: Boolean(row.blind_review),
      auditSample: Boolean(row.audit_sample),
      auditSampledAt: iso(row.audit_sampled_at),
      secondReviewerPersonId: row.second_reviewer_person_id ?? undefined,
      secondIndependentScores:
        (row.second_independent_scores as Record<string, number> | null) ??
        undefined,
      secondIndependentRationale:
        row.second_independent_rationale ?? undefined,
      secondReviewStartedAt: iso(row.second_review_started_at),
      secondReviewCompletedAt: iso(row.second_review_completed_at),
      secondReviewDurationSeconds:
        row.second_review_duration_seconds === null ||
        row.second_review_duration_seconds === undefined
          ? undefined
          : Number(row.second_review_duration_seconds),
      secondReviewEvidenceOpened:
        row.second_review_evidence_opened === null ||
        row.second_review_evidence_opened === undefined
          ? undefined
          : Number(row.second_review_evidence_opened),
      secondReviewOutcome: row.second_review_outcome ?? undefined,
      secondReviewAgreementRate:
        row.second_review_agreement_rate === null ||
        row.second_review_agreement_rate === undefined
          ? undefined
          : Number(row.second_review_agreement_rate),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapWorkflowRun(row: QueryResultRow): WorkflowRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      agentTaskId: row.agent_task_id,
      workflowName: row.workflow_name,
      workflowVersion: row.workflow_version,
      status: row.status,
      currentStep: row.current_step ?? undefined,
      state: row.state ?? {},
      startedAt: iso(row.started_at) ?? new Date().toISOString(),
      finishedAt: iso(row.finished_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapIntegrationConnection(
    row: QueryResultRow,
  ): IntegrationConnection {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      provider: row.provider,
      connectionName: row.connection_name,
      credentialRef: row.credential_ref,
      status: row.status,
      config: row.config ?? {},
      lastSyncAt: iso(row.last_sync_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapIntegrationMapping(row: QueryResultRow): IntegrationMapping {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      name: row.name,
      mappingType: row.mapping_type,
      sourceSystem: row.source_system,
      targetType: row.target_type,
      fieldMap: row.field_map ?? {},
      config: row.config ?? {},
      version: Number(row.version),
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      retiredAt: iso(row.retired_at),
    };
  }
  
  protected mapSyncSchedule(row: QueryResultRow): SyncSchedule {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      name: row.name,
      intervalMinutes: Number(row.interval_minutes),
      enabled: row.enabled,
      nextRunAt: iso(row.next_run_at) ?? new Date().toISOString(),
      lastRunAt: iso(row.last_run_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapEquityGrant(row: QueryResultRow): EquityGrant {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      grantCode: row.grant_code,
      grantType: row.grant_type,
      totalUnits: decimalText(String(row.total_units)) ?? "0",
      strikePrice: decimalText(String(row.strike_price)) ?? "0",
      currency: String(row.currency).trim(),
      grantDate: iso(row.grant_date) ?? new Date().toISOString(),
      vestingStart: iso(row.vesting_start) ?? new Date().toISOString(),
      cliffMonths: Number(row.cliff_months),
      vestingMonths: Number(row.vesting_months),
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }
  
  protected mapEquityExercise(row: QueryResultRow): EquityExercise {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      grantId: row.grant_id,
      personId: row.person_id,
      units: decimalText(String(row.units)) ?? "0",
      strikePrice: decimalText(String(row.strike_price)) ?? "0",
      totalCost: decimalText(String(row.total_cost)) ?? "0",
      currency: String(row.currency).trim(),
      status: row.status,
      requestedBy: row.requested_by,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      settledAt: iso(row.settled_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }
  
  protected mapBounty(row: QueryResultRow): Bounty {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      description: row.description,
      rewardAmount: decimalText(String(row.reward_amount)) ?? "0",
      currency: String(row.currency).trim(),
      status: row.status,
      createdBy: row.created_by,
      dueAt: iso(row.due_at),
      assigneePersonId: row.assignee_person_id ?? undefined,
      claimedAt: iso(row.claimed_at),
      submissionRef: row.submission_ref ?? undefined,
      submittedAt: iso(row.submitted_at),
      acceptedBy: row.accepted_by ?? undefined,
      acceptedAt: iso(row.accepted_at),
      paymentRef: row.payment_ref ?? undefined,
      cancelledAt: iso(row.cancelled_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }
  
  protected mapAdverseAction(row: QueryResultRow): AdverseActionCase {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      actionType: row.action_type,
      status: row.status,
      reason: row.reason,
      performanceBasis: row.performance_basis,
      evidenceRefs: (row.evidence_refs ?? []) as string[],
      requestedBy: row.requested_by,
      legalReviewerId: row.legal_reviewer_id ?? undefined,
      legalReviewRef: row.legal_review_ref ?? undefined,
      legalReviewedAt: iso(row.legal_reviewed_at),
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      effectiveFrom: iso(row.effective_from),
      completedAt: iso(row.completed_at),
      cancelledAt: iso(row.cancelled_at),
      cancelReason: row.cancel_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }
  
  protected mapEmploymentContract(row: QueryResultRow): EmploymentContract {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      contractCode: row.contract_code,
      employmentType: row.employment_type,
      startDate: iso(row.start_date) ?? new Date().toISOString(),
      endDate: iso(row.end_date),
      workLocation: row.work_location,
      legalEntity: row.legal_entity ?? undefined,
      currency: String(row.currency).trim(),
      fixedMonthlySalary:
        decimalText(String(row.fixed_monthly_salary)) ?? "0",
      minimumMonthlyWage:
        decimalText(String(row.minimum_monthly_wage)) ?? "0",
      taxRate: decimalText(String(row.tax_rate)) ?? "0",
      socialInsuranceRate:
        decimalText(String(row.social_insurance_rate)) ?? "0",
      deductionCapRate:
        decimalText(String(row.deduction_cap_rate)) ?? "0.2",
      variableShareCapRate:
        decimalText(String(row.variable_share_cap_rate)) ?? "1",
      deductionOrder:
        (row.deduction_order as string[] | null) ?? [
          "RECOVERY",
          "REVERSAL",
          "ADJUSTMENT",
          "OTHER",
        ],
      deductionTypeCaps:
        (row.deduction_type_caps as Record<string, string> | null) ?? {},
      smoothingThresholdRate:
        decimalText(String(row.smoothing_threshold_rate)) ?? "1",
      smoothingMode: (row.smoothing_mode as string | null) ?? "BLOCK",
      smoothingWindowPeriods: Number(row.smoothing_window_periods ?? 3),
      smoothingMaxStepRate:
        decimalText(String(row.smoothing_max_step_rate ?? "0.5")) ?? "0.5",
      compensationTemplateCode: row.compensation_template_code ?? undefined,
      bankAccountRef: row.bank_account_ref ?? undefined,
      payPlanVersion: Number(row.pay_plan_version ?? 1),
      consentSignatureRef: row.consent_signature_ref,
      consentSignedAt:
        iso(row.consent_signed_at) ?? new Date().toISOString(),
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }
  
  protected mapEmploymentContractAmendment(
    row: QueryResultRow,
  ): EmploymentContractAmendment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      contractId: row.contract_id,
      payPlanVersion: Number(row.pay_plan_version),
      beforeTerms: (row.before_terms ?? {}) as Record<string, unknown>,
      afterTerms: (row.after_terms ?? {}) as Record<string, unknown>,
      effectiveFrom: iso(row.effective_from) ?? new Date().toISOString(),
      consentSignatureRef: row.consent_signature_ref,
      approvedBy: row.approved_by,
      status: row.status,
      appliedAt: iso(row.applied_at),
      cancelledAt: iso(row.cancelled_at),
      cancelReason: row.cancel_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapPayrollLine(row: QueryResultRow): PayrollLine {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      runId: row.run_id,
      personId: row.person_id,
      contractId: row.contract_id,
      currency: String(row.currency).trim(),
      fixedAmount: decimalText(String(row.fixed_amount)) ?? "0",
      incentiveAmount: decimalText(String(row.incentive_amount)) ?? "0",
      grossAmount: decimalText(String(row.gross_amount)) ?? "0",
      deductionAmount: decimalText(String(row.deduction_amount)) ?? "0",
      taxAmount: decimalText(String(row.tax_amount)) ?? "0",
      socialInsuranceAmount:
        decimalText(String(row.social_insurance_amount)) ?? "0",
      netAmount: decimalText(String(row.net_amount)) ?? "0",
      minimumMonthlyWage:
        decimalText(String(row.minimum_monthly_wage)) ?? "0",
      minimumWagePassed: row.minimum_wage_passed,
      deductionCapRate:
        decimalText(String(row.deduction_cap_rate)) ?? "0.2",
      deductionCapAmount:
        decimalText(String(row.deduction_cap_amount)) ?? "0",
      deductionCapPassed: row.deduction_cap_passed,
      variableShareRate:
        decimalText(String(row.variable_share_rate)) ?? "0",
      variableShareCapRate:
        decimalText(String(row.variable_share_cap_rate)) ?? "1",
      variableShareCapAmount:
        decimalText(String(row.variable_share_cap_amount)) ?? "0",
      variableSharePassed: row.variable_share_passed,
      deductionBreakdown:
        (row.deduction_breakdown as PayrollLine["deductionBreakdown"] | null) ??
        [],
      deductionTypeCapPassed: row.deduction_type_cap_passed,
      deductionTypeCapBreaches:
        (row.deduction_type_cap_breaches as string[] | null) ?? [],
      deductionLegalBasisPassed:
        row.deduction_legal_basis_passed ?? true,
      deductionLegalBasisMissing:
        (row.deduction_legal_basis_missing as string[] | null) ?? [],
      priorIncentiveAmount:
        decimalText(String(row.prior_incentive_amount)) ?? "0",
      incentiveChangeRate:
        decimalText(String(row.incentive_change_rate)) ?? "0",
      smoothingThresholdRate:
        decimalText(String(row.smoothing_threshold_rate)) ?? "1",
      smoothingPassed: row.smoothing_passed,
      rawIncentiveAmount:
        decimalText(String(row.raw_incentive_amount ?? row.incentive_amount)) ??
        "0",
      smoothedIncentiveAmount:
        decimalText(
          String(row.smoothed_incentive_amount ?? row.incentive_amount),
        ) ?? "0",
      smoothingDelta: decimalText(String(row.smoothing_delta ?? "0")) ?? "0",
      smoothingMode: (row.smoothing_mode as string | null) ?? "BLOCK",
      noticeAcknowledgementPassed:
        row.notice_acknowledgement_passed ?? true,
      noticeAcknowledgementMissing:
        (row.notice_acknowledgement_missing as string[] | null) ?? [],
      bankAccountRef: row.bank_account_ref ?? undefined,
      taxCalculationMode:
        (row.tax_calculation_mode as PayrollLine["taxCalculationMode"]) ??
        undefined,
      ytdTaxableIncome:
        row.ytd_taxable_income === null || row.ytd_taxable_income === undefined
          ? undefined
          : decimalText(String(row.ytd_taxable_income)) ?? "0",
      ytdTaxWithheld:
        row.ytd_tax_withheld === null || row.ytd_tax_withheld === undefined
          ? undefined
          : decimalText(String(row.ytd_tax_withheld)) ?? "0",
      iitRatePercent: row.iit_rate_percent ?? undefined,
      iitQuickDeduction:
        row.iit_quick_deduction === null || row.iit_quick_deduction === undefined
          ? undefined
          : decimalText(String(row.iit_quick_deduction)) ?? "0",
      ...(String(row.currency).trim() !== "CNY"
        ? { statutoryCurrencyUnsupported: true }
        : {}),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapPayrollRun(
    row: QueryResultRow,
    lines: PayrollLine[],
  ): PayrollRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      periodStart: iso(row.period_start) ?? new Date().toISOString(),
      periodEnd: iso(row.period_end) ?? new Date().toISOString(),
      currency: String(row.currency).trim(),
      ...(String(row.currency).trim() !== "CNY"
        ? { statutoryCurrencyUnsupported: true }
        : {}),
      status: row.status,
      preparedBy: row.prepared_by,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      paidAt: iso(row.paid_at),
      reversedAt: iso(row.reversed_at),
      reversedBy: row.reversed_by ?? undefined,
      reversalReason: row.reversal_reason ?? undefined,
      totalGross: decimalText(String(row.total_gross)) ?? "0",
      totalDeductions: decimalText(String(row.total_deductions)) ?? "0",
      totalTax: decimalText(String(row.total_tax)) ?? "0",
      totalSocialInsurance:
        decimalText(String(row.total_social_insurance)) ?? "0",
      totalNet: decimalText(String(row.total_net)) ?? "0",
      lineCount: Number(row.line_count),
      blockedCount: Number(row.blocked_count),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
      lines,
    };
  }
  
  protected mapSyncRun(row: QueryResultRow): SyncRun {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      status: row.status,
      startedAt: iso(row.started_at),
      finishedAt: iso(row.finished_at),
      cursorBefore: row.cursor_before ?? undefined,
      cursorAfter: row.cursor_after ?? undefined,
      recordsSeen: Number(row.records_seen),
      recordsUpserted: Number(row.records_upserted),
      recordsFetched: optionalCount(row.records_fetched),
      recordsRawPersisted: optionalCount(row.records_raw_persisted),
      recordsCreated: optionalCount(row.records_created),
      recordsUpdated: optionalCount(row.records_updated),
      recordsDuplicate: optionalCount(row.records_duplicate),
      recordsInvalid: optionalCount(row.records_invalid),
      recordsQuarantined: optionalCount(row.records_quarantined),
      recordsFailed: optionalCount(row.records_failed),
      errorSummary: row.error_summary ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // NP-001（2026-11-21 审计 Wave 1）：资源流 / 检查点 / 隔离区行映射。
  // ------------------------------------------------------------------
  protected mapSyncResource(row: QueryResultRow): SyncResource {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      resourceKey: row.resource_key,
      mappingId: row.mapping_id ?? undefined,
      scheduleId: row.schedule_id ?? undefined,
      status: row.status,
      intervalMinutes:
        row.interval_minutes === null || row.interval_minutes === undefined
          ? null
          : Number(row.interval_minutes),
      leaseOwner: row.lease_owner ?? null,
      leaseUntil: iso(row.lease_until),
      fencingToken: Number(row.fencing_token ?? 0),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  protected mapRawSourceRecord(row: QueryResultRow): RawSourceRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      sourceSystem: row.source_system,
      externalRecordId: row.external_record_id,
      payloadEncrypted: row.payload_encrypted,
      payloadHash: row.payload_hash ?? "",
      sourceVersion: row.source_version ?? "1",
      mappingVersion: Number(row.mapping_version ?? 1),
      retentionClass: row.retention_class ?? "DEFAULT",
      resourceId: row.resource_id ?? undefined,
      fetchedAt: iso(row.fetched_at) ?? new Date().toISOString(),
      sourceUpdatedAt: iso(row.source_updated_at),
      replayedAt: iso(row.replayed_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  protected mapSyncCheckpoint(row: QueryResultRow): SyncCheckpoint {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      resourceId: row.resource_id,
      cursor: row.cursor ?? null,
      watermark: row.watermark ?? null,
      overlapSeconds: Number(row.overlap_seconds ?? 0),
      lastRunId: row.last_run_id ?? null,
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  protected mapExternalObjectIdentity(row: QueryResultRow): ExternalObjectIdentity {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      sourceSystem: row.source_system,
      externalObjectType: row.external_object_type,
      externalObjectId: row.external_object_id,
      internalObjectType: row.internal_object_type,
      internalObjectId: row.internal_object_id,
      matchRule: row.match_rule ?? "MANUAL",
      confidence: Number(row.confidence ?? 1),
      confirmedBy: row.confirmed_by ?? undefined,
      validFrom: iso(row.valid_from) ?? new Date().toISOString(),
      validTo: iso(row.valid_to),
      unlinkReason: row.unlink_reason ?? null,
      unlinkedBy: row.unlinked_by ?? null,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  protected mapWebhookRoutingKey(row: QueryResultRow): WebhookRoutingKey {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      connectionId: row.connection_id,
      routingKey: row.routing_key,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  protected mapQuarantineRecord(row: QueryResultRow): QuarantineRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      sourceSystem: row.source_system,
      externalRecordId: row.external_record_id ?? null,
      reason: row.reason,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      resolvedAt: iso(row.resolved_at),
      resolvedBy: row.resolved_by ?? null,
      resolutionNote: row.resolution_note ?? null,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapExternalIdentity(row: QueryResultRow): ExternalIdentity {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      sourceSystem: row.source_system,
      externalId: row.external_id,
      personId: row.person_id ?? undefined,
      objectType: row.object_type,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
  
  protected mapWebhook(row: QueryResultRow): WebhookInboxMessage {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      sourceSystem: row.source_system,
      messageId: row.message_id,
      payloadHash: row.payload_hash,
      receivedAt: iso(row.received_at) ?? new Date().toISOString(),
      processedAt: iso(row.processed_at),
      status: row.status,
      errorCode: row.error_code ?? undefined,
      rawPayloadEncrypted: row.raw_payload_encrypted ?? undefined,
    };
  }
  
  protected async loadIncentiveAwardBatch(
    queryable: Pool | PoolClient,
    row: QueryResultRow,
  ): Promise<IncentiveAwardBatch> {
    const { rows: lines } = await queryable.query(
      `SELECT * FROM incentive_award_lines
        WHERE tenant_id=$1 AND batch_id=$2
        ORDER BY created_at, id`,
      [row.tenant_id, row.id],
    );
    return {
      id: row.id,
      tenantId: row.tenant_id,
      batchNo: row.batch_no,
      awardType: row.award_type,
      period: row.period,
      cycleId: row.cycle_id ?? undefined,
      currency: row.currency,
      status: row.status,
      totalAmount: decimalText(String(row.total_amount)) ?? "0",
      lineCount: Number(row.line_count),
      sourceRecordIds: (row.source_record_ids ?? []) as string[],
      createdBy: row.created_by,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      lockedAt: iso(row.locked_at),
      exportedAt: iso(row.exported_at),
      acknowledgedAt: iso(row.acknowledged_at),
      paymentRef: row.payment_ref ?? undefined,
      lines: lines.map((line) => ({
        id: line.id,
        batchId: line.batch_id,
        personId: line.person_id,
        amount: decimalText(String(line.amount)) ?? "0",
        currency: line.currency,
        sourceRecordId: line.source_record_id ?? undefined,
        sourceLineRef: line.source_line_ref ?? undefined,
        note: line.note ?? undefined,
      })),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }
  
  protected mapPolicyEngineRecord(row: QueryResultRow): PolicyEngineRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      recordType: row.record_type,
      personId: row.person_id ?? undefined,
      period: row.period ?? undefined,
      status: row.status ?? undefined,
      payload: row.payload as Record<string, unknown>,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
      version: Number(row.version),
    };
  }
  
  protected mapInboxMessage(row: QueryResultRow): InboxMessage {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      consumerName: row.consumer_name,
      messageId: row.message_id,
      receivedAt: iso(row.received_at) ?? new Date().toISOString(),
      processedAt: iso(row.processed_at),
      status: row.status,
      errorCode: row.error_code ?? undefined,
    };
  }
}

/** 基类形状：字段 + 全部端口方法（供 mixin 内 this 类型检查）。 */
export type PgPlatformStoreBaseShape = PgPlatformStoreBase & PlatformStore;
