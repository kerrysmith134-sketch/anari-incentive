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
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgDatagovMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements DatagovPort {
    
    async createDpia(input: {
      tenantId: string;
      assessmentType: DpiaAssessmentType;
      scope: string;
      riskSummary?: Record<string, unknown>;
      mitigationSummary?: Record<string, unknown>;
    }): Promise<DpiaRecord> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO dpia_records
            (id, tenant_id, assessment_type, scope, risk_summary,
             mitigation_summary)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.assessmentType,
            input.scope,
            input.riskSummary ?? {},
            input.mitigationSummary ?? {},
          ],
        );
        return this.mapDpia(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
    }
    
    async listDpias(tenantId: string): Promise<DpiaRecord[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM dpia_records
          WHERE tenant_id=$1
          ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapDpia(row));
    }
    
    async getDpia(tenantId: string, dpiaId: string): Promise<DpiaRecord> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM dpia_records WHERE tenant_id=$1 AND id=$2",
        [tenantId, dpiaId],
      );
      if (!rows[0]) notFound("DpiaRecord", dpiaId);
      return this.mapDpia(rows[0]);
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
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `UPDATE dpia_records
              SET status='APPROVED', approved_by=$3, approved_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.dpiaId, input.approvedBy],
        );
        return this.mapDpia(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.approvedBy} not found`);
        }
        throw error;
      }
    }
    
    async createDsar(input: {
      tenantId: string;
      personId: string;
      requestType: DsarRequestType;
      dueAt?: string;
    }): Promise<DsarRequest> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO dsar_requests
            (id, tenant_id, person_id, request_type, due_at)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.personId,
            input.requestType,
            input.dueAt ?? null,
          ],
        );
        return this.mapDsar(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError("tenant or person not found");
        }
        throw error;
      }
    }
    
    async listDsars(
      tenantId: string,
      personId?: string,
    ): Promise<DsarRequest[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM dsar_requests WHERE tenant_id=$1";
      if (personId) {
        params.push(personId);
        sql += " AND person_id=$2";
      }
      sql += " ORDER BY received_at DESC, created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapDsar(row));
    }
    
    async getDsar(tenantId: string, dsarId: string): Promise<DsarRequest> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM dsar_requests WHERE tenant_id=$1 AND id=$2",
        [tenantId, dsarId],
      );
      if (!rows[0]) notFound("DsarRequest", dsarId);
      return this.mapDsar(rows[0]);
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
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE dsar_requests
            SET status=$3, resolution_ref=$4, resolved_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.dsarId,
          input.resolution,
          input.resolutionRef,
        ],
      );
      return this.mapDsar(rows[0]);
    }
    
    async createRetentionPolicy(input: {
      tenantId: string;
      dataCategory: string;
      retentionMonths: number;
      legalBasis: string;
      legalHold: boolean;
    }): Promise<RetentionPolicy> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO retention_policies
            (id, tenant_id, data_category, retention_months, legal_basis,
             legal_hold)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.dataCategory,
            input.retentionMonths,
            input.legalBasis,
            input.legalHold,
          ],
        );
        return this.mapRetentionPolicy(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError(
            `retention policy for ${input.dataCategory} already exists`,
          );
        }
        if (code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
    }
    
    async listRetentionPolicies(tenantId: string): Promise<RetentionPolicy[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM retention_policies
          WHERE tenant_id=$1
          ORDER BY data_category`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapRetentionPolicy(row));
    }
    
    async setRetentionLegalHold(input: {
      tenantId: string;
      retentionPolicyId: string;
      legalHold: boolean;
    }): Promise<RetentionPolicy> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE retention_policies
            SET legal_hold=$3
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.retentionPolicyId, input.legalHold],
      );
      if (!rows[0]) notFound("RetentionPolicy", input.retentionPolicyId);
      return this.mapRetentionPolicy(rows[0]);
    }
    
    async createRetentionDisposalRequest(input: {
      tenantId: string;
      retentionPolicyId: string;
      requestedBy: string;
      reason: string;
      scheduledFor?: string;
    }): Promise<RetentionDisposalRequest> {
      const policy = await this.tenantQuery(input.tenantId, 
        `SELECT * FROM retention_policies WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, input.retentionPolicyId],
      );
      if (!policy.rows[0]) {
        notFound("RetentionPolicy", input.retentionPolicyId);
      }
      if (policy.rows[0].legal_hold) {
        throw new ConflictError(
          "RETENTION_LEGAL_HOLD: disposal is blocked while legal hold is active",
        );
      }
      const scheduledFor =
        input.scheduledFor ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      if (Date.parse(scheduledFor) <= Date.now()) {
        throw new ConflictError(
          "RETENTION_GRACE_PERIOD_REQUIRED: scheduledFor must be in the future",
        );
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO retention_disposal_requests
            (id, tenant_id, retention_policy_id, data_category, requested_by,
             reason, scheduled_for)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            policy.rows[0].id,
            policy.rows[0].data_category,
            input.requestedBy,
            input.reason,
            scheduledFor,
          ],
        );
        return this.mapRetentionDisposalRequest(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Requester ${input.requestedBy} not found`,
          );
        }
        throw error;
      }
    }
    
    async listRetentionDisposalRequests(
      tenantId: string,
    ): Promise<RetentionDisposalRequest[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM retention_disposal_requests
          WHERE tenant_id=$1
          ORDER BY requested_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapRetentionDisposalRequest(row));
    }
    
    async approveRetentionDisposalRequest(input: {
      tenantId: string;
      requestId: string;
      approvedBy: string;
    }): Promise<RetentionDisposalRequest> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM retention_disposal_requests
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.requestId],
        );
        if (!rows[0]) {
          notFound("RetentionDisposalRequest", input.requestId);
        }
        const request = this.mapRetentionDisposalRequest(rows[0]);
        if (request.status !== "REQUESTED") {
          throw new ConflictError(
            `retention disposal is ${request.status}`,
          );
        }
        if (request.requestedBy === input.approvedBy) {
          throw new ConflictError("RETENTION_SECOND_PERSON_REQUIRED");
        }
        const { rows: updated } = await client.query(
          `UPDATE retention_disposal_requests
              SET status='APPROVED', approved_by=$3, approved_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.requestId, input.approvedBy],
        );
        return this.mapRetentionDisposalRequest(updated[0]);
      });
    }
    
    async completeRetentionDisposalRequest(input: {
      tenantId: string;
      requestId: string;
      actorPersonId: string;
    }): Promise<RetentionDisposalRequest> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM retention_disposal_requests
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.requestId],
        );
        if (!rows[0]) {
          notFound("RetentionDisposalRequest", input.requestId);
        }
        const request = this.mapRetentionDisposalRequest(rows[0]);
        if (request.status !== "APPROVED") {
          throw new ConflictError(
            `retention disposal is ${request.status}`,
          );
        }
        if (Date.now() < Date.parse(request.scheduledFor)) {
          throw new ConflictError("RETENTION_GRACE_PERIOD_ACTIVE");
        }
        const policy = await client.query(
          `SELECT legal_hold FROM retention_policies
            WHERE tenant_id=$1 AND id=$2`,
          [input.tenantId, request.retentionPolicyId],
        );
        if (policy.rows[0]?.legal_hold) {
          throw new ConflictError(
            "RETENTION_LEGAL_HOLD: disposal is blocked while legal hold is active",
          );
        }
        const { rows: updated } = await client.query(
          `UPDATE retention_disposal_requests
              SET status='COMPLETED', completed_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.requestId],
        );
        return this.mapRetentionDisposalRequest(updated[0]);
      });
    }
    
    async cancelRetentionDisposalRequest(input: {
      tenantId: string;
      requestId: string;
      actorPersonId: string;
      reason: string;
    }): Promise<RetentionDisposalRequest> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE retention_disposal_requests
            SET status='CANCELLED', cancelled_at=now(), cancel_reason=$3
          WHERE tenant_id=$1 AND id=$2
            AND status IN ('REQUESTED','APPROVED')
          RETURNING *`,
        [input.tenantId, input.requestId, input.reason],
      );
      if (!rows[0]) {
        const current = await this.tenantQuery(input.tenantId, 
          `SELECT status FROM retention_disposal_requests
            WHERE tenant_id=$1 AND id=$2`,
          [input.tenantId, input.requestId],
        );
        if (!current.rows[0]) {
          notFound("RetentionDisposalRequest", input.requestId);
        }
        throw new ConflictError(
          `retention disposal is ${current.rows[0].status}`,
        );
      }
      return this.mapRetentionDisposalRequest(rows[0]);
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
      if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
        throw new ConflictError("SUBGROUP_CONSENT_EXPIRED");
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO workforce_subgroup_attributes
            (id, tenant_id, person_id, dimension, value, consent_ref,
             consented_at, expires_at, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, person_id, dimension)
           DO UPDATE SET
             value=EXCLUDED.value,
             consent_ref=EXCLUDED.consent_ref,
             consented_at=EXCLUDED.consented_at,
             expires_at=EXCLUDED.expires_at,
             recorded_by=EXCLUDED.recorded_by,
             updated_at=now()
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.personId,
            input.dimension,
            input.value.trim(),
            input.consentRef,
            input.consentedAt,
            input.expiresAt ?? null,
            input.recordedBy ?? null,
          ],
        );
        return this.mapWorkforceSubgroupAttribute(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Person ${input.personId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listWorkforceSubgroupAttributes(
      tenantId: string,
      filter?: {
        personId?: string;
        dimension?: WorkforceSubgroupDimension;
      },
    ): Promise<WorkforceSubgroupAttribute[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql =
        "SELECT * FROM workforce_subgroup_attributes WHERE tenant_id=$1";
      if (filter?.personId) {
        params.push(filter.personId);
        sql += ` AND person_id=$${params.length}`;
      }
      if (filter?.dimension) {
        params.push(filter.dimension);
        sql += ` AND dimension=$${params.length}`;
      }
      sql += " ORDER BY dimension, person_id";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapWorkforceSubgroupAttribute(row));
    }
    
    async withdrawWorkforceSubgroupAttribute(input: {
      tenantId: string;
      personId: string;
      dimension: WorkforceSubgroupDimension;
    }): Promise<WorkforceSubgroupAttribute> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `DELETE FROM workforce_subgroup_attributes
          WHERE tenant_id=$1 AND person_id=$2 AND dimension=$3
          RETURNING *`,
        [input.tenantId, input.personId, input.dimension],
      );
      if (!rows[0]) {
        notFound(
          "WorkforceSubgroupAttribute",
          `${input.personId}:${input.dimension}`,
        );
      }
      return this.mapWorkforceSubgroupAttribute(rows[0]);
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
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO data_sources
            (id, tenant_id, code, name, category, owner_person_id,
             backup_owner_person_id, sla_hours, criticality,
             contains_personal_data, storage_region, cross_border_transfers,
             processor_refs, fields, last_reviewed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.code,
            input.name,
            input.category,
            input.ownerPersonId,
            input.backupOwnerPersonId ?? null,
            input.slaHours,
            input.criticality,
            input.containsPersonalData,
            input.storageRegion,
            input.crossBorderTransfers,
            JSON.stringify(input.processorRefs),
            JSON.stringify(input.fields),
            input.lastReviewedAt ?? null,
          ],
        );
        return this.mapDataSource(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError(`data source code ${input.code} already exists`);
        }
        if (code === "23503") {
          throw new NotFoundError(
            `Tenant, owner or backup owner for ${input.code} not found`,
          );
        }
        throw error;
      }
    }
    
    async listDataSources(tenantId: string): Promise<DataSource[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM data_sources
          WHERE tenant_id=$1
          ORDER BY code`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapDataSource(row));
    }
    
    async getDataSource(
      tenantId: string,
      dataSourceId: string,
    ): Promise<DataSource> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM data_sources WHERE tenant_id=$1 AND id=$2",
        [tenantId, dataSourceId],
      );
      if (!rows[0]) notFound("DataSource", dataSourceId);
      return this.mapDataSource(rows[0]);
    }
    
    async retireDataSource(input: {
      tenantId: string;
      dataSourceId: string;
    }): Promise<DataSource> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE data_sources
            SET status='RETIRED', updated_at=now(), version=version+1
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.dataSourceId],
      );
      if (!rows[0]) notFound("DataSource", input.dataSourceId);
      return this.mapDataSource(rows[0]);
    }
    
    async createBreakGlassGrant(input: {
      tenantId: string;
      scope: BreakGlassGrant["scope"];
      granteePersonId: string;
      reason: string;
      grantedBy: string;
      expiresAt: string;
    }): Promise<BreakGlassGrant> {
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
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO break_glass_grants
            (id, tenant_id, scope, grantee_person_id, reason, granted_by,
             expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.scope,
            input.granteePersonId,
            input.reason,
            input.grantedBy,
            input.expiresAt,
          ],
        );
        return this.mapBreakGlassGrant(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Tenant, grantee or granting person not found`,
          );
        }
        throw error;
      }
    }
    
    async listBreakGlassGrants(tenantId: string): Promise<BreakGlassGrant[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM break_glass_grants
          WHERE tenant_id=$1
          ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapBreakGlassGrant(row));
    }
    
    async revokeBreakGlassGrant(input: {
      tenantId: string;
      grantId: string;
    }): Promise<BreakGlassGrant> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE break_glass_grants
            SET status='REVOKED', revoked_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
          RETURNING *`,
        [input.tenantId, input.grantId],
      );
      if (!rows[0]) {
        const current = await this.tenantQuery(input.tenantId, 
          "SELECT 1 FROM break_glass_grants WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.grantId],
        );
        if (!current.rows[0]) {
          notFound("BreakGlassGrant", input.grantId);
        }
        throw new ConflictError(
          `break-glass grant ${input.grantId} is already revoked`,
        );
      }
      return this.mapBreakGlassGrant(rows[0]);
    }
    
    async findActiveBreakGlassGrant(
      tenantId: string,
      granteePersonId: string,
      scope: BreakGlassGrant["scope"],
    ): Promise<BreakGlassGrant | undefined> {
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM break_glass_grants
          WHERE tenant_id=$1 AND grantee_person_id=$2 AND scope=$3
            AND status='ACTIVE' AND expires_at > now()
          ORDER BY created_at DESC
          LIMIT 1`,
        [tenantId, granteePersonId, scope],
      );
      return rows[0] ? this.mapBreakGlassGrant(rows[0]) : undefined;
    }
    
    async createAuditRedaction(input: {
      tenantId: string;
      auditEventId: string;
      replacement: string;
      reason: string;
      requestedBy: string;
      approvedBy: string;
    }): Promise<AuditRedaction> {
      if (input.requestedBy === input.approvedBy) {
        throw new ConflictError(
          "AUDIT_REDACTION_SECOND_PERSON_REQUIRED",
        );
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO audit_redactions
            (id, tenant_id, audit_event_id, replacement, reason,
             requested_by, approved_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.auditEventId,
            input.replacement,
            input.reason,
            input.requestedBy,
            input.approvedBy,
          ],
        );
        return this.mapAuditRedaction(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError("AUDIT_REDACTION_ALREADY_EXISTS");
        }
        if (code === "23503") {
          throw new NotFoundError(
            `Audit event or redaction person not found`,
          );
        }
        throw error;
      }
    }
    
    async listAuditRedactions(tenantId: string): Promise<AuditRedaction[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM audit_redactions
          WHERE tenant_id=$1
          ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapAuditRedaction(row));
    }
  };
}
