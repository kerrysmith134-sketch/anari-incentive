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
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryTenantMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements TenantPort {
    
    async createTenant(input: {
      name: string;
      slug: string;
      defaultTimezone?: string;
      defaultCurrency?: string;
    }): Promise<PlatformTenant> {
      if ([...this.tenants.values()].some((tenant) => tenant.slug === input.slug)) {
        throw new ConflictError(`tenant slug ${input.slug} already exists`);
      }
      const tenant: PlatformTenant = {
        id: randomUUID(),
        name: input.name,
        slug: input.slug,
        status: "ACTIVE",
        defaultTimezone: input.defaultTimezone ?? "UTC",
        defaultCurrency: input.defaultCurrency ?? "CNY",
        settings: {},
        createdAt: now(),
      };
      this.tenants.set(tenant.id, tenant);
      return tenant;
    }
    
    async listTenants(): Promise<PlatformTenant[]> {
      return [...this.tenants.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    }
    
    async getTenant(tenantId: string): Promise<PlatformTenant> {
      const tenant = this.tenants.get(tenantId);
      if (!tenant) notFound("Tenant", tenantId);
      return tenant;
    }
    
    async updateTenantSettings(input: {
      tenantId: string;
      settings: Record<string, unknown>;
    }): Promise<PlatformTenant> {
      const tenant = await this.getTenant(input.tenantId);
      tenant.settings = {
        ...(tenant.settings ?? {}),
        ...input.settings,
      };
      return tenant;
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
      if (
        [...this.subscriptionPlans.values()].some(
          (plan) => plan.code === input.code,
        )
      ) {
        throw new ConflictError(`plan code ${input.code} already exists`);
      }
      const plan: SubscriptionPlan = {
        id: randomUUID(),
        code: input.code,
        name: input.name,
        description: input.description,
        monthlyPrice: input.monthlyPrice,
        currency: input.currency,
        seatLimit: input.seatLimit,
        trialDays: input.trialDays,
        features: input.features,
        active: input.active ?? true,
        createdAt: now(),
      };
      this.subscriptionPlans.set(plan.id, plan);
      return plan;
    }
    
    async listSubscriptionPlans(
      activeOnly = false,
    ): Promise<SubscriptionPlan[]> {
      return [...this.subscriptionPlans.values()]
        .filter((plan) => (activeOnly ? plan.active : true))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
      const plan = [...this.subscriptionPlans.values()].find(
        (candidate) => candidate.code === input.planCode,
      );
      if (!plan) notFound("SubscriptionPlan", input.planCode);
      await this.getTenant(input.tenantId);
      const existing = [...this.tenantSubscriptions.values()].find(
        (subscription) => subscription.tenantId === input.tenantId,
      );
      const timestamp = now();
      const record: TenantSubscription = {
        id: existing?.id ?? randomUUID(),
        tenantId: input.tenantId,
        planId: plan.id,
        planCode: plan.code,
        planName: plan.name,
        status: input.status,
        seats: input.seats,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        trialEndsAt: input.trialEndsAt,
        canceledAt:
          input.status === "CANCELED" ? existing?.canceledAt ?? timestamp : undefined,
        cancelReason: input.cancelReason,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      this.tenantSubscriptions.set(record.id, record);
      return record;
    }
    
    async getTenantSubscription(
      tenantId: string,
    ): Promise<TenantSubscription | null> {
      return (
        [...this.tenantSubscriptions.values()].find(
          (subscription) => subscription.tenantId === tenantId,
        ) ?? null
      );
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
      const plan = this.subscriptionPlans.get(subscription.planId);
      const total = input.lineItems.reduce(
        (sum, item) => sum + parseDecimal(item.amount),
        0n,
      );
      const invoice: TenantInvoice = {
        id: randomUUID(),
        tenantId: input.tenantId,
        subscriptionId: subscription.id,
        number: this.nextInvoiceNumber(input.tenantId),
        status: "DRAFT",
        currency: plan?.currency ?? "CNY",
        lineItems: input.lineItems,
        totalAmount: formatInvoiceAmount(total),
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        dueDate: input.dueDate,
        createdAt: now(),
      };
      this.invoices.set(invoice.id, invoice);
      return invoice;
    }
    
    async listInvoices(tenantId: string): Promise<TenantInvoice[]> {
      return [...this.invoices.values()]
        .filter((invoice) => invoice.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async setInvoiceStatus(input: {
      invoiceId: string;
      status: TenantInvoiceStatus;
    }): Promise<TenantInvoice> {
      const invoice = this.invoices.get(input.invoiceId);
      if (!invoice) notFound("Invoice", input.invoiceId);
      const timestamp = now();
      const updated: TenantInvoice = {
        ...invoice,
        status: input.status,
        issuedAt:
          input.status === "ISSUED" ? invoice.issuedAt ?? timestamp : invoice.issuedAt,
        paidAt:
          input.status === "PAID" ? invoice.paidAt ?? timestamp : invoice.paidAt,
      };
      this.invoices.set(invoice.id, updated);
      return updated;
    }
    
    async linkPersonUser(input: {
      tenantId: string;
      personId: string;
      userId: string;
    }): Promise<PlatformPerson> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      if (!this.users.has(input.userId)) notFound("User", input.userId);
      this.assertUserNotLinked(input.tenantId, input.userId, person.id);
      person.userId = input.userId;
      return person;
    }
    
    async createOrgNode(input: {
      tenantId: string;
      name: string;
      nodeType: string;
      parentId?: string;
      externalId?: string;
    }): Promise<PlatformOrgNode> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const parent = input.parentId
        ? this.orgNodes.get(input.parentId)
        : undefined;
      if (input.parentId && (!parent || parent.tenantId !== input.tenantId)) {
        notFound("OrgNode", input.parentId);
      }
      const node: PlatformOrgNode = {
        id: randomUUID(),
        tenantId: input.tenantId,
        parentId: input.parentId,
        nodeType: input.nodeType,
        name: input.name,
        path: parent?.path ? `${parent.path}/${input.name}` : `/${input.name}`,
        active: true,
        externalId: input.externalId,
        createdAt: now(),
      };
      this.orgNodes.set(node.id, node);
      return node;
    }
    
    async listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.orgNodes.values()]
        .filter((node) => node.tenantId === tenantId)
        .sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name));
    }
    
    async assignPersonOrg(input: {
      tenantId: string;
      personId: string;
      orgNodeId: string;
      validFrom: string;
      validTo?: string;
      allocation?: string;
    }): Promise<PlatformOrgAssignment> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      const node = this.orgNodes.get(input.orgNodeId);
      if (!node || node.tenantId !== input.tenantId) {
        notFound("OrgNode", input.orgNodeId);
      }
      if (input.validTo && input.validTo < input.validFrom) {
        throw new ConflictError("validTo must not be before validFrom");
      }
      if (input.allocation !== undefined) {
        const allocation = Number(input.allocation);
        if (!Number.isFinite(allocation) || allocation < 0 || allocation > 1) {
          throw new ConflictError("allocation must be between 0 and 1");
        }
      }
      const assignment: PlatformOrgAssignment = {
        id: randomUUID(),
        tenantId: input.tenantId,
        personId: input.personId,
        orgNodeId: input.orgNodeId,
        validFrom: input.validFrom,
        validTo: input.validTo,
        allocation: input.allocation,
        createdAt: now(),
      };
      this.orgAssignments.set(assignment.id, assignment);
      return assignment;
    }
    
    async setPersonManager(input: {
      tenantId: string;
      personId: string;
      managerPersonId: string | null;
    }): Promise<PlatformPerson> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      if (input.managerPersonId === null) {
        person.managerPersonId = undefined;
        return person;
      }
      if (input.managerPersonId === input.personId) {
        throw new ConflictError("a person cannot be their own manager");
      }
      const manager = this.persons.get(input.managerPersonId);
      if (!manager || manager.tenantId !== input.tenantId) {
        notFound("Person", input.managerPersonId);
      }
      let current: PlatformPerson | undefined = manager;
      while (current?.managerPersonId) {
        if (current.managerPersonId === input.personId) {
          throw new ConflictError("manager assignment would create a cycle");
        }
        current = this.persons.get(current.managerPersonId);
      }
      person.managerPersonId = input.managerPersonId;
      return person;
    }
  };
}
