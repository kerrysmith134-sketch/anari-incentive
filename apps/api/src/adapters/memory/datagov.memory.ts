/**
 * NPV2-013：数据治理 Adapter（DatagovPort，方法体逐字平移）。
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
import type { DatagovPort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryDatagovMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements DatagovPort {
    
    async createDpia(input: {
      tenantId: string;
      assessmentType: DpiaAssessmentType;
      scope: string;
      riskSummary?: Record<string, unknown>;
      mitigationSummary?: Record<string, unknown>;
    }): Promise<DpiaRecord> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const dpia: DpiaRecord = {
        id: randomUUID(),
        tenantId: input.tenantId,
        assessmentType: input.assessmentType,
        scope: input.scope,
        status: "DRAFT",
        riskSummary: input.riskSummary ?? {},
        mitigationSummary: input.mitigationSummary ?? {},
        createdAt: now(),
      };
      this.dpias.set(dpia.id, dpia);
      return dpia;
    }
    
    async listDpias(tenantId: string): Promise<DpiaRecord[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.dpias.values()]
        .filter((dpia) => dpia.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async getDpia(tenantId: string, dpiaId: string): Promise<DpiaRecord> {
      const dpia = this.dpias.get(dpiaId);
      if (!dpia || dpia.tenantId !== tenantId) notFound("DpiaRecord", dpiaId);
      return dpia;
    }
    
    async approveDpia(input: {
      tenantId: string;
      dpiaId: string;
      approvedBy: string;
    }): Promise<DpiaRecord> {
      const dpia = await this.getDpia(input.tenantId, input.dpiaId);
      if (dpia.status === "APPROVED") {
        throw new ConflictError(`DPIA ${dpia.id} is already approved`);
      }
      const approver = this.persons.get(input.approvedBy);
      if (!approver || approver.tenantId !== input.tenantId) {
        notFound("Person", input.approvedBy);
      }
      dpia.status = "APPROVED";
      dpia.approvedBy = input.approvedBy;
      dpia.approvedAt = now();
      return dpia;
    }
    
    async createDsar(input: {
      tenantId: string;
      personId: string;
      requestType: DsarRequestType;
      dueAt?: string;
    }): Promise<DsarRequest> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      const timestamp = now();
      const dsar: DsarRequest = {
        id: randomUUID(),
        tenantId: input.tenantId,
        personId: input.personId,
        requestType: input.requestType,
        status: "OPEN",
        receivedAt: timestamp,
        dueAt: input.dueAt,
        createdAt: timestamp,
      };
      this.dsars.set(dsar.id, dsar);
      return dsar;
    }
    
    async listDsars(
      tenantId: string,
      personId?: string,
    ): Promise<DsarRequest[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.dsars.values()]
        .filter(
          (dsar) =>
            dsar.tenantId === tenantId &&
            (!personId || dsar.personId === personId),
        )
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    }
    
    async getDsar(tenantId: string, dsarId: string): Promise<DsarRequest> {
      const dsar = this.dsars.get(dsarId);
      if (!dsar || dsar.tenantId !== tenantId) notFound("DsarRequest", dsarId);
      return dsar;
    }
    
    async resolveDsar(input: {
      tenantId: string;
      dsarId: string;
      resolution: "RESOLVED" | "REJECTED";
      resolutionRef: string;
    }): Promise<DsarRequest> {
      const dsar = await this.getDsar(input.tenantId, input.dsarId);
      if (dsar.status !== "OPEN") {
        throw new ConflictError(`DSAR ${dsar.id} is already ${dsar.status}`);
      }
      dsar.status = input.resolution;
      dsar.resolutionRef = input.resolutionRef;
      dsar.resolvedAt = now();
      return dsar;
    }
    
    async createRetentionPolicy(input: {
      tenantId: string;
      dataCategory: string;
      retentionMonths: number;
      legalBasis: string;
      legalHold: boolean;
    }): Promise<RetentionPolicy> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (
        [...this.retentionPolicies.values()].some(
          (policy) =>
            policy.tenantId === input.tenantId &&
            policy.dataCategory === input.dataCategory,
        )
      ) {
        throw new ConflictError(
          `retention policy for ${input.dataCategory} already exists`,
        );
      }
      const policy: RetentionPolicy = {
        id: randomUUID(),
        tenantId: input.tenantId,
        dataCategory: input.dataCategory,
        retentionMonths: input.retentionMonths,
        legalBasis: input.legalBasis,
        legalHold: input.legalHold,
        createdAt: now(),
      };
      this.retentionPolicies.set(policy.id, policy);
      return policy;
    }
    
    async listRetentionPolicies(tenantId: string): Promise<RetentionPolicy[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.retentionPolicies.values()]
        .filter((policy) => policy.tenantId === tenantId)
        .sort((a, b) => a.dataCategory.localeCompare(b.dataCategory));
    }
    
    async setRetentionLegalHold(input: {
      tenantId: string;
      retentionPolicyId: string;
      legalHold: boolean;
    }): Promise<RetentionPolicy> {
      const policy = this.retentionPolicies.get(input.retentionPolicyId);
      if (!policy || policy.tenantId !== input.tenantId) {
        notFound("RetentionPolicy", input.retentionPolicyId);
      }
      policy.legalHold = input.legalHold;
      return policy;
    }
    
    async createRetentionDisposalRequest(input: {
      tenantId: string;
      retentionPolicyId: string;
      requestedBy: string;
      reason: string;
      scheduledFor?: string;
    }): Promise<RetentionDisposalRequest> {
      const policy = this.retentionPolicies.get(input.retentionPolicyId);
      if (!policy || policy.tenantId !== input.tenantId) {
        notFound("RetentionPolicy", input.retentionPolicyId);
      }
      if (policy.legalHold) {
        throw new ConflictError(
          "RETENTION_LEGAL_HOLD: disposal is blocked while legal hold is active",
        );
      }
      const requester = this.persons.get(input.requestedBy);
      if (!requester || requester.tenantId !== input.tenantId) {
        notFound("Person", input.requestedBy);
      }
      const scheduledFor =
        input.scheduledFor ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      if (Date.parse(scheduledFor) <= Date.now()) {
        throw new ConflictError(
          "RETENTION_GRACE_PERIOD_REQUIRED: scheduledFor must be in the future",
        );
      }
      const request: RetentionDisposalRequest = {
        id: randomUUID(),
        tenantId: input.tenantId,
        retentionPolicyId: policy.id,
        dataCategory: policy.dataCategory,
        requestedBy: input.requestedBy,
        status: "REQUESTED",
        reason: input.reason,
        requestedAt: now(),
        scheduledFor,
      };
      this.retentionDisposals.set(request.id, request);
      return request;
    }
    
    async listRetentionDisposalRequests(
      tenantId: string,
    ): Promise<RetentionDisposalRequest[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.retentionDisposals.values()]
        .filter((request) => request.tenantId === tenantId)
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    }
    
    async approveRetentionDisposalRequest(input: {
      tenantId: string;
      requestId: string;
      approvedBy: string;
    }): Promise<RetentionDisposalRequest> {
      const request = this.retentionDisposals.get(input.requestId);
      if (!request || request.tenantId !== input.tenantId) {
        notFound("RetentionDisposalRequest", input.requestId);
      }
      if (request.status !== "REQUESTED") {
        throw new ConflictError(`retention disposal is ${request.status}`);
      }
      if (request.requestedBy === input.approvedBy) {
        throw new ConflictError("RETENTION_SECOND_PERSON_REQUIRED");
      }
      const approver = this.persons.get(input.approvedBy);
      if (!approver || approver.tenantId !== input.tenantId) {
        notFound("Person", input.approvedBy);
      }
      request.status = "APPROVED";
      request.approvedBy = input.approvedBy;
      request.approvedAt = now();
      return request;
    }
    
    async completeRetentionDisposalRequest(input: {
      tenantId: string;
      requestId: string;
      actorPersonId: string;
    }): Promise<RetentionDisposalRequest> {
      const request = this.retentionDisposals.get(input.requestId);
      if (!request || request.tenantId !== input.tenantId) {
        notFound("RetentionDisposalRequest", input.requestId);
      }
      if (request.status !== "APPROVED") {
        throw new ConflictError(`retention disposal is ${request.status}`);
      }
      if (Date.now() < Date.parse(request.scheduledFor)) {
        throw new ConflictError("RETENTION_GRACE_PERIOD_ACTIVE");
      }
      const policy = this.retentionPolicies.get(request.retentionPolicyId);
      if (policy?.legalHold) {
        throw new ConflictError(
          "RETENTION_LEGAL_HOLD: disposal is blocked while legal hold is active",
        );
      }
      const actor = this.persons.get(input.actorPersonId);
      if (!actor || actor.tenantId !== input.tenantId) {
        notFound("Person", input.actorPersonId);
      }
      request.status = "COMPLETED";
      request.completedAt = now();
      return request;
    }
    
    async cancelRetentionDisposalRequest(input: {
      tenantId: string;
      requestId: string;
      actorPersonId: string;
      reason: string;
    }): Promise<RetentionDisposalRequest> {
      const request = this.retentionDisposals.get(input.requestId);
      if (!request || request.tenantId !== input.tenantId) {
        notFound("RetentionDisposalRequest", input.requestId);
      }
      if (!["REQUESTED", "APPROVED"].includes(request.status)) {
        throw new ConflictError(`retention disposal is ${request.status}`);
      }
      request.status = "CANCELLED";
      request.cancelledAt = now();
      request.cancelReason = input.reason;
      return request;
    }
    
    async recordWorkforceSubgroupAttribute(input: {
      tenantId: string;
      personId: string;
      dimension: WorkforceSubgroupDimension;
      value: string;
      consentRef: string;
      consentedAt: string;
      expiresAt?: string;
      recordedBy?: string;
    }): Promise<WorkforceSubgroupAttribute> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
        throw new ConflictError("SUBGROUP_CONSENT_EXPIRED");
      }
      const existing = [...this.workforceSubgroupAttributes.values()].find(
        (attribute) =>
          attribute.tenantId === input.tenantId &&
          attribute.personId === input.personId &&
          attribute.dimension === input.dimension,
      );
      const timestamp = now();
      if (existing) {
        existing.value = input.value.trim();
        existing.consentRef = input.consentRef;
        existing.consentedAt = input.consentedAt;
        existing.expiresAt = input.expiresAt;
        existing.recordedBy = input.recordedBy;
        existing.updatedAt = timestamp;
        return existing;
      }
      const attribute: WorkforceSubgroupAttribute = {
        id: randomUUID(),
        tenantId: input.tenantId,
        personId: input.personId,
        dimension: input.dimension,
        value: input.value.trim(),
        consentRef: input.consentRef,
        consentedAt: input.consentedAt,
        expiresAt: input.expiresAt,
        recordedBy: input.recordedBy,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.workforceSubgroupAttributes.set(attribute.id, attribute);
      return attribute;
    }
    
    async listWorkforceSubgroupAttributes(
      tenantId: string,
      filter?: {
        personId?: string;
        dimension?: WorkforceSubgroupDimension;
      },
    ): Promise<WorkforceSubgroupAttribute[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.workforceSubgroupAttributes.values()]
        .filter(
          (attribute) =>
            attribute.tenantId === tenantId &&
            (!filter?.personId || attribute.personId === filter.personId) &&
            (!filter?.dimension ||
              attribute.dimension === filter.dimension),
        )
        .sort((a, b) =>
          `${a.dimension}:${a.personId}`.localeCompare(
            `${b.dimension}:${b.personId}`,
          ),
        );
    }
    
    async withdrawWorkforceSubgroupAttribute(input: {
      tenantId: string;
      personId: string;
      dimension: WorkforceSubgroupDimension;
    }): Promise<WorkforceSubgroupAttribute> {
      const attribute = [...this.workforceSubgroupAttributes.values()].find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.personId === input.personId &&
          candidate.dimension === input.dimension,
      );
      if (!attribute) {
        notFound(
          "WorkforceSubgroupAttribute",
          `${input.personId}:${input.dimension}`,
        );
      }
      this.workforceSubgroupAttributes.delete(attribute.id);
      return attribute;
    }
    
    async createDataSource(input: {
      tenantId: string;
      code: string;
      name: string;
      category: string;
      ownerPersonId: string;
      backupOwnerPersonId?: string;
      slaHours: number;
      criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      containsPersonalData: boolean;
      storageRegion: string;
      crossBorderTransfers: boolean;
      processorRefs: string[];
      fields: DataSourceField[];
      lastReviewedAt?: string;
    }): Promise<DataSource> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (
        [...this.dataSources.values()].some(
          (source) =>
            source.tenantId === input.tenantId && source.code === input.code,
        )
      ) {
        throw new ConflictError(`data source code ${input.code} already exists`);
      }
      const timestamp = now();
      const source: DataSource = {
        id: randomUUID(),
        tenantId: input.tenantId,
        code: input.code,
        name: input.name,
        category: input.category,
        ownerPersonId: input.ownerPersonId,
        backupOwnerPersonId: input.backupOwnerPersonId,
        slaHours: input.slaHours,
        criticality: input.criticality,
        containsPersonalData: input.containsPersonalData,
        storageRegion: input.storageRegion,
        crossBorderTransfers: input.crossBorderTransfers,
        processorRefs: [...input.processorRefs],
        fields: input.fields.map((field) => ({ ...field })),
        status: "ACTIVE",
        lastReviewedAt: input.lastReviewedAt,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      this.dataSources.set(source.id, source);
      return source;
    }
    
    async listDataSources(tenantId: string): Promise<DataSource[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.dataSources.values()]
        .filter((source) => source.tenantId === tenantId)
        .sort((a, b) => a.code.localeCompare(b.code));
    }
    
    async getDataSource(
      tenantId: string,
      dataSourceId: string,
    ): Promise<DataSource> {
      const source = this.dataSources.get(dataSourceId);
      if (!source || source.tenantId !== tenantId) {
        notFound("DataSource", dataSourceId);
      }
      return source;
    }
    
    async retireDataSource(input: {
      tenantId: string;
      dataSourceId: string;
    }): Promise<DataSource> {
      const source = await this.getDataSource(
        input.tenantId,
        input.dataSourceId,
      );
      if (source.status === "RETIRED") {
        throw new ConflictError(`data source ${source.id} is already retired`);
      }
      source.status = "RETIRED";
      source.updatedAt = now();
      source.version += 1;
      return source;
    }
    
    async createBreakGlassGrant(input: {
      tenantId: string;
      scope: BreakGlassGrant["scope"];
      granteePersonId: string;
      reason: string;
      grantedBy: string;
      expiresAt: string;
    }): Promise<BreakGlassGrant> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      for (const personId of [input.granteePersonId, input.grantedBy]) {
        const person = this.persons.get(personId);
        if (!person || person.tenantId !== input.tenantId) {
          notFound("Person", personId);
        }
      }
      if (input.granteePersonId === input.grantedBy) {
        throw new ConflictError(
          "BREAK_GLASS_SELF_GRANT: a grant must be approved by another person",
        );
      }
      const expiresAt = Date.parse(input.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new ConflictError("BREAK_GLASS_EXPIRY_REQUIRED");
      }
      if (expiresAt > Date.now() + 24 * 60 * 60 * 1000) {
        throw new ConflictError("BREAK_GLASS_MAX_24_HOURS");
      }
      const grant: BreakGlassGrant = {
        id: randomUUID(),
        tenantId: input.tenantId,
        scope: input.scope,
        granteePersonId: input.granteePersonId,
        reason: input.reason,
        grantedBy: input.grantedBy,
        expiresAt: input.expiresAt,
        status: "ACTIVE",
        createdAt: now(),
      };
      this.breakGlassGrants.set(grant.id, grant);
      return grant;
    }
    
    async listBreakGlassGrants(tenantId: string): Promise<BreakGlassGrant[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.breakGlassGrants.values()]
        .filter((grant) => grant.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async revokeBreakGlassGrant(input: {
      tenantId: string;
      grantId: string;
    }): Promise<BreakGlassGrant> {
      const grant = this.breakGlassGrants.get(input.grantId);
      if (!grant || grant.tenantId !== input.tenantId) {
        notFound("BreakGlassGrant", input.grantId);
      }
      if (grant.status === "REVOKED") {
        throw new ConflictError(`break-glass grant ${grant.id} is already revoked`);
      }
      grant.status = "REVOKED";
      grant.revokedAt = now();
      return grant;
    }
    
    async findActiveBreakGlassGrant(
      tenantId: string,
      granteePersonId: string,
      scope: BreakGlassGrant["scope"],
    ): Promise<BreakGlassGrant | undefined> {
      return [...this.breakGlassGrants.values()].find(
        (grant) =>
          grant.tenantId === tenantId &&
          grant.granteePersonId === granteePersonId &&
          grant.scope === scope &&
          grant.status === "ACTIVE" &&
          Date.parse(grant.expiresAt) > Date.now(),
      );
    }
    
    async createAuditRedaction(input: {
      tenantId: string;
      auditEventId: string;
      replacement: string;
      reason: string;
      requestedBy: string;
      approvedBy: string;
    }): Promise<AuditRedaction> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      for (const personId of [input.requestedBy, input.approvedBy]) {
        const person = this.persons.get(personId);
        if (!person || person.tenantId !== input.tenantId) {
          notFound("Person", personId);
        }
      }
      if (input.requestedBy === input.approvedBy) {
        throw new ConflictError(
          "AUDIT_REDACTION_SECOND_PERSON_REQUIRED",
        );
      }
      if (
        [...this.auditRedactions.values()].some(
          (redaction) =>
            redaction.tenantId === input.tenantId &&
            redaction.auditEventId === input.auditEventId,
        )
      ) {
        throw new ConflictError("AUDIT_REDACTION_ALREADY_EXISTS");
      }
      const redaction: AuditRedaction = {
        id: randomUUID(),
        tenantId: input.tenantId,
        auditEventId: input.auditEventId,
        replacement: input.replacement,
        reason: input.reason,
        requestedBy: input.requestedBy,
        approvedBy: input.approvedBy,
        createdAt: now(),
      };
      this.auditRedactions.set(redaction.id, redaction);
      return redaction;
    }
    
    async listAuditRedactions(tenantId: string): Promise<AuditRedaction[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.auditRedactions.values()]
        .filter((redaction) => redaction.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  };
}
