/**
 * NPV2-013：租户与计费 Adapter（TenantPort，方法体逐字平移）。
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
import type { TenantPort } from "../../store-ports.js";
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgTenantMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements TenantPort {
    
    async createTenant(input: {
      name: string;
      slug: string;
      defaultTimezone?: string;
      defaultCurrency?: string;
    }): Promise<PlatformTenant> {
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO tenants
            (id, name, slug, default_timezone, default_currency)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            randomUUID(),
            input.name,
            input.slug,
            input.defaultTimezone ?? "UTC",
            input.defaultCurrency ?? "CNY",
          ],
        );
        return this.mapTenant(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(`tenant slug ${input.slug} already exists`);
        }
        throw error;
      }
    }
    
    async listTenants(): Promise<PlatformTenant[]> {
      const { rows } = await this.pool.query(
        "SELECT * FROM tenants ORDER BY created_at DESC",
      );
      return rows.map((row: QueryResultRow) => this.mapTenant(row));
    }
    
    async getTenant(tenantId: string): Promise<PlatformTenant> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM tenants WHERE id=$1",
        [tenantId],
      );
      if (!rows[0]) notFound("Tenant", tenantId);
      return this.mapTenant(rows[0]);
    }
    
    async updateTenantSettings(input: {
      tenantId: string;
      settings: Record<string, unknown>;
    }): Promise<PlatformTenant> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE tenants
            SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
                updated_at=now()
          WHERE id=$1
          RETURNING *`,
        [input.tenantId, input.settings],
      );
      if (!rows[0]) notFound("Tenant", input.tenantId);
      return this.mapTenant(rows[0]);
    }
    
    async createSubscriptionPlan(input: {
      code: string;
      name: string;
      description?: string;
      monthlyPrice: string;
      currency: string;
      seatLimit: number;
      trialDays: number;
      features: string[];
      active?: boolean;
    }): Promise<SubscriptionPlan> {
      const { rows } = await this.pool.query(
        `INSERT INTO subscription_plans
           (code, name, description, monthly_price, currency, seat_limit,
            trial_days, features, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           monthly_price = EXCLUDED.monthly_price,
           currency = EXCLUDED.currency,
           seat_limit = EXCLUDED.seat_limit,
           trial_days = EXCLUDED.trial_days,
           features = EXCLUDED.features,
           active = EXCLUDED.active
         RETURNING *`,
        [
          input.code,
          input.name,
          input.description ?? null,
          input.monthlyPrice,
          input.currency,
          input.seatLimit,
          input.trialDays,
          JSON.stringify(input.features),
          input.active ?? true,
        ],
      );
      return this.mapSubscriptionPlan(rows[0]);
    }
    
    async listSubscriptionPlans(
      activeOnly = false,
    ): Promise<SubscriptionPlan[]> {
      const { rows } = await this.pool.query(
        activeOnly
          ? "SELECT * FROM subscription_plans WHERE active ORDER BY created_at"
          : "SELECT * FROM subscription_plans ORDER BY created_at",
      );
      return rows.map((row: QueryResultRow) => this.mapSubscriptionPlan(row));
    }
    
    async setTenantSubscription(input: {
      tenantId: string;
      planCode: string;
      status: TenantSubscriptionStatus;
      seats: number;
      currentPeriodStart: string;
      currentPeriodEnd: string;
      trialEndsAt?: string;
      cancelReason?: string;
    }): Promise<TenantSubscription> {
      await this.assertTenant(input.tenantId);
      const plan = await this.tenantQuery(input.tenantId, 
        "SELECT * FROM subscription_plans WHERE code=$1",
        [input.planCode],
      );
      if (plan.rows.length === 0) notFound("SubscriptionPlan", input.planCode);
      const { rows } = await this.tenantQuery(input.tenantId, 
        `INSERT INTO tenant_subscriptions
           (tenant_id, plan_id, status, seats, current_period_start,
            current_period_end, trial_ends_at, canceled_at, cancel_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,
                 CASE WHEN $3 = 'CANCELED' THEN now() END,
                 $8)
         ON CONFLICT (tenant_id) DO UPDATE SET
           plan_id = EXCLUDED.plan_id,
           status = EXCLUDED.status,
           seats = EXCLUDED.seats,
           current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end,
           trial_ends_at = EXCLUDED.trial_ends_at,
           canceled_at =
             CASE WHEN EXCLUDED.status = 'CANCELED'
                  THEN COALESCE(tenant_subscriptions.canceled_at, now())
                  ELSE NULL END,
           cancel_reason = EXCLUDED.cancel_reason,
           updated_at = now()
         RETURNING *`,
        [
          input.tenantId,
          plan.rows[0].id,
          input.status,
          input.seats,
          input.currentPeriodStart,
          input.currentPeriodEnd,
          input.trialEndsAt ?? null,
          input.cancelReason ?? null,
        ],
      );
      return this.mapTenantSubscription(rows[0], plan.rows[0]);
    }
    
    async getTenantSubscription(
      tenantId: string,
    ): Promise<TenantSubscription | null> {
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT s.*, p.code AS plan_code, p.name AS plan_name
           FROM tenant_subscriptions s
           JOIN subscription_plans p ON p.id = s.plan_id
          WHERE s.tenant_id = $1`,
        [tenantId],
      );
      if (rows.length === 0) return null;
      return this.mapTenantSubscription(rows[0]);
    }
    
    async createInvoice(input: {
      tenantId: string;
      lineItems: TenantInvoiceLineItem[];
      periodStart?: string;
      periodEnd?: string;
      dueDate?: string;
    }): Promise<TenantInvoice> {
      const subscription = await this.getTenantSubscription(input.tenantId);
      if (!subscription) notFound("TenantSubscription", input.tenantId);
      const plan = await this.tenantQuery(input.tenantId, 
        "SELECT * FROM subscription_plans WHERE id=$1",
        [subscription.planId],
      );
      const total = input.lineItems.reduce(
        (sum, item) => sum + parseDecimal(item.amount),
        0n,
      );
      const { rows } = await this.tenantQuery(input.tenantId, 
        `INSERT INTO invoices
           (tenant_id, subscription_id, number, currency, line_items,
            total_amount, period_start, period_end, due_date)
         VALUES ($1,$2,
                 'INV-' || to_char(now(),'YYYYMM') || '-' ||
                 lpad((SELECT count(*)::text FROM invoices WHERE tenant_id=$1) + 1, 4, '0'),
                 $3, $4::jsonb, $5, $6, $7, $8)
         RETURNING *`,
        [
          input.tenantId,
          subscription.id,
          plan.rows[0]?.currency ?? "CNY",
          JSON.stringify(input.lineItems),
          formatInvoiceAmount(total),
          input.periodStart ?? null,
          input.periodEnd ?? null,
          input.dueDate ?? null,
        ],
      );
      return this.mapInvoice(rows[0]);
    }
    
    async listInvoices(tenantId: string): Promise<TenantInvoice[]> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC",
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapInvoice(row));
    }
    
    async setInvoiceStatus(input: {
      invoiceId: string;
      status: TenantInvoiceStatus;
    }): Promise<TenantInvoice> {
      const { rows } = await this.platformQuery(
        `UPDATE invoices SET
           status = $2,
           issued_at = CASE WHEN $2 = 'ISSUED'
                            THEN COALESCE(issued_at, now()) ELSE issued_at END,
           paid_at = CASE WHEN $2 = 'PAID'
                          THEN COALESCE(paid_at, now()) ELSE paid_at END
         WHERE id = $1
         RETURNING *`,
        [input.invoiceId, input.status],
      );
      if (rows.length === 0) notFound("Invoice", input.invoiceId);
      return this.mapInvoice(rows[0]);
    }
    
    async linkPersonUser(input: {
      tenantId: string;
      personId: string;
      userId: string;
    }): Promise<PlatformPerson> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `UPDATE people SET user_id=$3, updated_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.personId, input.userId],
        );
        if (!rows[0]) notFound("Person", input.personId);
        return this.mapPerson(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        const constraint = (error as { constraint?: string }).constraint;
        if (code === "23505" && constraint === "uq_people_tenant_user") {
          throw new ConflictError(
            `user ${input.userId} is already linked to a person in this tenant`,
          );
        }
        if (code === "23503") {
          throw new NotFoundError(`User ${input.userId} not found`);
        }
        throw error;
      }
    }
    
    async createOrgNode(input: {
      tenantId: string;
      name: string;
      nodeType: string;
      parentId?: string;
      externalId?: string;
    }): Promise<PlatformOrgNode> {
      let parentPath: string | undefined;
      if (input.parentId) {
        const { rows } = await this.tenantQuery(input.tenantId, 
          "SELECT path FROM org_nodes WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.parentId],
        );
        if (!rows[0]) notFound("OrgNode", input.parentId);
        parentPath = rows[0].path ?? undefined;
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO org_nodes
            (id, tenant_id, parent_id, node_type, name, path, external_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.parentId ?? null,
            input.nodeType,
            input.name,
            parentPath ? `${parentPath}/${input.name}` : `/${input.name}`,
            input.externalId ?? null,
          ],
        );
        return this.mapOrgNode(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError("tenant or parent org node not found");
        }
        throw error;
      }
    }
    
    async listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM org_nodes
          WHERE tenant_id=$1
          ORDER BY COALESCE(path, name), name`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapOrgNode(row));
    }
    
    async assignPersonOrg(input: {
      tenantId: string;
      personId: string;
      orgNodeId: string;
      validFrom: string;
      validTo?: string;
      allocation?: string;
    }): Promise<PlatformOrgAssignment> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO person_org_assignments
            (id, tenant_id, person_id, org_node_id, valid_from, valid_to,
             allocation)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.personId,
            input.orgNodeId,
            input.validFrom,
            input.validTo ?? null,
            input.allocation ?? null,
          ],
        );
        return this.mapOrgAssignment(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23503") {
          throw new NotFoundError("person or org node not found");
        }
        if (code === "23514") {
          throw new ConflictError(
            "assignment violates date or allocation constraints",
          );
        }
        throw error;
      }
    }
    
    async setPersonManager(input: {
      tenantId: string;
      personId: string;
      managerPersonId: string | null;
    }): Promise<PlatformPerson> {
      const { rows: personRows } = await this.tenantQuery(input.tenantId, 
        "SELECT id FROM people WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.personId],
      );
      if (!personRows[0]) notFound("Person", input.personId);
  
      if (input.managerPersonId === null) {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `UPDATE people SET manager_person_id=NULL, updated_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.personId],
        );
        return this.mapPerson(rows[0]);
      }
  
      if (input.managerPersonId === input.personId) {
        throw new ConflictError("a person cannot be their own manager");
      }
      const { rows: managerRows } = await this.tenantQuery(input.tenantId, 
        "SELECT id FROM people WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.managerPersonId],
      );
      if (!managerRows[0]) notFound("Person", input.managerPersonId);
  
      const { rows: cycleRows } = await this.tenantQuery(input.tenantId, 
        `WITH RECURSIVE chain AS (
           SELECT id, manager_person_id
             FROM people
            WHERE tenant_id=$1 AND id=$2
           UNION ALL
           SELECT p.id, p.manager_person_id
             FROM people p
             JOIN chain c
               ON p.id = c.manager_person_id AND p.tenant_id=$1
         )
         SELECT 1 FROM chain WHERE id=$3 LIMIT 1`,
        [input.tenantId, input.managerPersonId, input.personId],
      );
      if (cycleRows[0]) {
        throw new ConflictError("manager assignment would create a cycle");
      }
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE people SET manager_person_id=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.personId, input.managerPersonId],
      );
      return this.mapPerson(rows[0]);
    }
  };
}
