/**
 * NPV2-013：集成 Adapter（IntegrationPort，方法体逐字平移）。
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
  ExternalObjectIdentity,
  QuarantineRecord,
  SyncCheckpoint,
  WebhookRoutingKey,
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
import { formatInvoiceAmount, now, notFound, surveyAverage, aggregateSurveyReport, iso, isoDate, decimalText, addUtcMonths, computeEquityVesting, money } from "../shared.js";
import type { IntegrationPort } from "../../store-ports.js";
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgIntegrationMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements IntegrationPort {
    
    async createESignEnvelope(input: {
      tenantId: string;
      contractId: string;
      provider: string;
      envelopeRef: string;
      documentHash: string;
      signerPersonId: string;
    }): Promise<ESignEnvelope> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO esign_envelopes
            (id, tenant_id, contract_id, provider, envelope_ref, document_hash,
             signer_person_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.contractId,
            input.provider,
            input.envelopeRef,
            input.documentHash,
            input.signerPersonId,
          ],
        );
        return this.mapESignEnvelope(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError(
            "ESIGN_ENVELOPE_EXISTS: provider envelope reference already recorded",
          );
        }
        if (code === "23503") {
          throw new NotFoundError(
            `Tenant, contract or signer not found`,
          );
        }
        throw error;
      }
    }
    
    async listESignEnvelopes(
      tenantId: string,
      contractId?: string,
    ): Promise<ESignEnvelope[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM esign_envelopes WHERE tenant_id=$1";
      if (contractId) {
        params.push(contractId);
        sql += " AND contract_id=$2";
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapESignEnvelope(row));
    }
    
    async completeESignEnvelope(input: {
      tenantId: string;
      provider: string;
      envelopeRef: string;
      status: "SIGNED" | "DECLINED" | "VOID";
      signatureRef?: string;
      reason?: string;
    }): Promise<ESignEnvelope> {
      if (input.status === "SIGNED" && !input.signatureRef?.trim()) {
        throw new ConflictError("ESIGN_SIGNATURE_REF_REQUIRED");
      }
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM esign_envelopes
            WHERE tenant_id=$1 AND provider=$2 AND envelope_ref=$3
            FOR UPDATE`,
          [input.tenantId, input.provider, input.envelopeRef],
        );
        if (!rows[0]) notFound("ESignEnvelope", input.envelopeRef);
        const current = this.mapESignEnvelope(rows[0]);
        if (current.status !== "SENT") {
          throw new ConflictError(
            `e-sign envelope is ${current.status}`,
          );
        }
        const { rows: updated } = await client.query(
          `UPDATE esign_envelopes
              SET status=$4, completed_at=now(), decline_reason=$5,
                  updated_at=now()
            WHERE tenant_id=$1 AND provider=$2 AND envelope_ref=$3
            RETURNING *`,
          [
            input.tenantId,
            input.provider,
            input.envelopeRef,
            input.status,
            input.status === "SIGNED" ? null : input.reason ?? null,
          ],
        );
        if (input.status === "SIGNED") {
          await client.query(
            `UPDATE employment_contracts
                SET consent_signature_ref=$3, consent_signed_at=now(),
                    version=version+1, updated_at=now()
              WHERE tenant_id=$1 AND id=$2`,
            [input.tenantId, current.contractId, input.signatureRef],
          );
        }
        return this.mapESignEnvelope(updated[0]);
      });
    }
    
    async createIntegrationConnection(input: {
      tenantId: string;
      provider: string;
      connectionName: string;
      credentialRef: string;
      config: Record<string, unknown>;
    }): Promise<IntegrationConnection> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO integration_connections
            (id, tenant_id, provider, connection_name, credential_ref, config)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.provider,
            input.connectionName,
            input.credentialRef,
            input.config,
          ],
        );
        return this.mapIntegrationConnection(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
    }
    
    async listIntegrationConnections(
      tenantId: string,
    ): Promise<IntegrationConnection[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM integration_connections
          WHERE tenant_id=$1
          ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapIntegrationConnection(row));
    }
    
    async getIntegrationConnection(
      tenantId: string,
      connectionId: string,
    ): Promise<IntegrationConnection> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM integration_connections WHERE tenant_id=$1 AND id=$2",
        [tenantId, connectionId],
      );
      if (!rows[0]) notFound("IntegrationConnection", connectionId);
      return this.mapIntegrationConnection(rows[0]);
    }
    
    async setIntegrationConnectionStatus(input: {
      tenantId: string;
      connectionId: string;
      status: string;
    }): Promise<IntegrationConnection> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE integration_connections
            SET status=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.connectionId, input.status],
      );
      if (!rows[0]) notFound("IntegrationConnection", input.connectionId);
      return this.mapIntegrationConnection(rows[0]);
    }
    
    async createIntegrationMapping(input: {
      tenantId: string;
      connectionId: string;
      name: string;
      mappingType: IntegrationMapping["mappingType"];
      sourceSystem: string;
      targetType: string;
      fieldMap: Record<string, string>;
      config: Record<string, unknown>;
      version: number;
    }): Promise<IntegrationMapping> {
      await this.getIntegrationConnection(
        input.tenantId,
        input.connectionId,
      );
      const { rows: active } = await this.tenantQuery(input.tenantId, 
        `SELECT version FROM integration_mappings
          WHERE tenant_id=$1 AND connection_id=$2 AND name=$3
            AND status='ACTIVE'`,
        [input.tenantId, input.connectionId, input.name],
      );
      if (active[0]) {
        throw new ConflictError(
          `INTEGRATION_MAPPING_ALREADY_ACTIVE: ${input.name}:${active[0].version}`,
        );
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO integration_mappings
            (id, tenant_id, connection_id, name, mapping_type, source_system,
             target_type, field_map, config, version, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE')
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.connectionId,
            input.name,
            input.mappingType,
            input.sourceSystem,
            input.targetType,
            JSON.stringify(input.fieldMap),
            JSON.stringify(input.config),
            input.version,
          ],
        );
        return this.mapIntegrationMapping(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `Integration mapping ${input.name}:${input.version} already exists`,
          );
        }
        throw error;
      }
    }
    
    async listIntegrationMappings(
      tenantId: string,
      connectionId: string,
      status?: IntegrationMapping["status"],
    ): Promise<IntegrationMapping[]> {
      await this.getIntegrationConnection(tenantId, connectionId);
      const params: string[] = [tenantId, connectionId];
      let sql =
        "SELECT * FROM integration_mappings WHERE tenant_id=$1 AND connection_id=$2";
      if (status) {
        params.push(status);
        sql += ` AND status=$${params.length}`;
      }
      sql += " ORDER BY name, version DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapIntegrationMapping(row));
    }
    
    async getIntegrationMapping(
      tenantId: string,
      mappingId: string,
    ): Promise<IntegrationMapping> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM integration_mappings WHERE tenant_id=$1 AND id=$2",
        [tenantId, mappingId],
      );
      if (!rows[0]) notFound("IntegrationMapping", mappingId);
      return this.mapIntegrationMapping(rows[0]);
    }
    
    async retireIntegrationMapping(input: {
      tenantId: string;
      mappingId: string;
    }): Promise<IntegrationMapping> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE integration_mappings
            SET status='RETIRED', retired_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
          RETURNING *`,
        [input.tenantId, input.mappingId],
      );
      if (!rows[0]) {
        const mapping = await this.getIntegrationMapping(
          input.tenantId,
          input.mappingId,
        );
        throw new ConflictError(
          `integration mapping ${mapping.id} is ${mapping.status}`,
        );
      }
      return this.mapIntegrationMapping(rows[0]);
    }
    
    async createSyncSchedule(input: {
      tenantId: string;
      connectionId: string;
      name: string;
      intervalMinutes: number;
      startAt?: string;
    }): Promise<SyncSchedule> {
      await this.getIntegrationConnection(
        input.tenantId,
        input.connectionId,
      );
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO sync_schedules
            (id, tenant_id, connection_id, name, interval_minutes, enabled,
             next_run_at)
           VALUES ($1,$2,$3,$4,$5::int,true,
                   COALESCE($6::timestamptz,
                            now() + ($5::int * interval '1 minute')))
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.connectionId,
            input.name,
            input.intervalMinutes,
            input.startAt ?? null,
          ],
        );
        return this.mapSyncSchedule(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `Sync schedule ${input.name} already exists for this connection`,
          );
        }
        throw error;
      }
    }
    
    async listSyncSchedules(
      tenantId: string,
      connectionId?: string,
    ): Promise<SyncSchedule[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM sync_schedules WHERE tenant_id=$1";
      if (connectionId) {
        params.push(connectionId);
        sql += ` AND connection_id=$${params.length}`;
      }
      sql += " ORDER BY next_run_at";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapSyncSchedule(row));
    }
    
    async getSyncSchedule(
      tenantId: string,
      scheduleId: string,
    ): Promise<SyncSchedule> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM sync_schedules WHERE tenant_id=$1 AND id=$2",
        [tenantId, scheduleId],
      );
      if (!rows[0]) notFound("SyncSchedule", scheduleId);
      return this.mapSyncSchedule(rows[0]);
    }
    
    async setSyncScheduleEnabled(input: {
      tenantId: string;
      scheduleId: string;
      enabled: boolean;
    }): Promise<SyncSchedule> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE sync_schedules
            SET enabled=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.scheduleId, input.enabled],
      );
      if (!rows[0]) notFound("SyncSchedule", input.scheduleId);
      return this.mapSyncSchedule(rows[0]);
    }
    
    async claimDueSyncSchedules(input: {
      tenantId: string;
      limit: number;
      now?: string;
    }): Promise<SyncSchedule[]> {
      return this.transactionFor(input.tenantId, async (client) => {
        const now = input.now ?? new Date().toISOString();
        const { rows } = await client.query(
          `SELECT * FROM sync_schedules
            WHERE tenant_id=$1 AND enabled AND next_run_at <= $2
            ORDER BY next_run_at
            LIMIT $3
            FOR UPDATE SKIP LOCKED`,
          [input.tenantId, now, input.limit],
        );
        const claimed: SyncSchedule[] = [];
        for (const row of rows) {
          const { rows: updated } = await client.query(
            `UPDATE sync_schedules
                SET last_run_at=$3::timestamptz,
                    next_run_at=$3::timestamptz +
                      (interval_minutes * interval '1 minute'),
                    updated_at=now()
              WHERE tenant_id=$1 AND id=$2
              RETURNING *`,
            [input.tenantId, row.id, now],
          );
          claimed.push(this.mapSyncSchedule(updated[0]));
        }
        return claimed;
      });
    }
    
    async createSyncRun(input: {
      tenantId: string;
      connectionId: string;
      status: string;
      cursorBefore?: Record<string, unknown>;
    }): Promise<SyncRun> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO sync_runs
            (id, tenant_id, connection_id, status, started_at, cursor_before)
           VALUES ($1,$2,$3,$4,
                   CASE WHEN $4 = 'QUEUED' THEN NULL ELSE now() END, $5)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.connectionId,
            input.status,
            input.cursorBefore ?? null,
          ],
        );
        return this.mapSyncRun(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Integration connection ${input.connectionId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listSyncRuns(
      tenantId: string,
      connectionId?: string,
    ): Promise<SyncRun[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM sync_runs WHERE tenant_id=$1";
      if (connectionId) {
        params.push(connectionId);
        sql += " AND connection_id=$2";
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapSyncRun(row));
    }
    
    async finishSyncRun(input: {
      tenantId: string;
      syncRunId: string;
      status: string;
      recordsSeen: number;
      recordsUpserted: number;
      recordsFetched?: number;
      recordsQuarantined?: number;
      recordsFailed?: number;
      cursorAfter?: Record<string, unknown>;
      errorSummary?: string;
    }): Promise<SyncRun> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM sync_runs
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.syncRunId],
        );
        if (!rows[0]) notFound("SyncRun", input.syncRunId);
        const run = this.mapSyncRun(rows[0]);
        if (run.finishedAt) {
          throw new ConflictError(`sync run ${run.id} is already finished`);
        }
        const { rows: updated } = await client.query(
          `UPDATE sync_runs
              SET status=$3, records_seen=$4, records_upserted=$5,
                  records_fetched=$6, records_quarantined=$7, records_failed=$8,
                  cursor_after=COALESCE($9, cursor_after),
                  error_summary=$10, finished_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [
            input.tenantId,
            input.syncRunId,
            input.status,
            input.recordsSeen,
            input.recordsUpserted,
            input.recordsFetched ?? null,
            input.recordsQuarantined ?? null,
            input.recordsFailed ?? null,
            input.cursorAfter ?? null,
            input.errorSummary ?? null,
          ],
        );
        await client.query(
          `UPDATE integration_connections
              SET last_sync_at=now(), updated_at=now()
            WHERE tenant_id=$1 AND id=$2`,
          [input.tenantId, run.connectionId],
        );
        return this.mapSyncRun(updated[0]);
      });
    }
    
    // ------------------------------------------------------------------
    // NP-001（2026-11-21 审计 Wave 1）：资源流 / 检查点 / 隔离区。
    // ------------------------------------------------------------------
    async createSyncResource(input: {
      tenantId: string;
      connectionId: string;
      resourceKey: string;
      mappingId?: string;
      scheduleId?: string;
    }): Promise<SyncResource> {
      await this.getIntegrationConnection(input.tenantId, input.connectionId);
      const { rows: existing } = await this.tenantQuery(
        input.tenantId,
        `SELECT * FROM sync_resources
          WHERE tenant_id=$1 AND connection_id=$2 AND resource_key=$3`,
        [input.tenantId, input.connectionId, input.resourceKey],
      );
      if (existing[0]) {
        throw new ConflictError(
          `SYNC_RESOURCE_EXISTS: ${input.connectionId}/${input.resourceKey}`,
        );
      }
      const inserted = await this.tenantQuery(
        input.tenantId,
        `INSERT INTO sync_resources
           (tenant_id, connection_id, resource_key, mapping_id, schedule_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.tenantId,
          input.connectionId,
          input.resourceKey,
          input.mappingId ?? null,
          input.scheduleId ?? null,
        ],
      );
      return this.mapSyncResource(inserted.rows[0]);
    }

    async listSyncResources(
      tenantId: string,
      connectionId?: string,
    ): Promise<SyncResource[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM sync_resources WHERE tenant_id=$1";
      if (connectionId) {
        params.push(connectionId);
        sql += " AND connection_id=$2";
      }
      sql += " ORDER BY created_at ASC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapSyncResource(row));
    }

    async getSyncCheckpoint(
      tenantId: string,
      resourceId: string,
    ): Promise<SyncCheckpoint | null> {
      const { rows: resource } = await this.tenantQuery(
        tenantId,
        "SELECT * FROM sync_resources WHERE tenant_id=$1 AND id=$2",
        [tenantId, resourceId],
      );
      if (!resource[0]) notFound("SyncResource", resourceId);
      const { rows } = await this.tenantQuery(
        tenantId,
        "SELECT * FROM sync_checkpoints WHERE tenant_id=$1 AND resource_id=$2",
        [tenantId, resourceId],
      );
      return rows[0] ? this.mapSyncCheckpoint(rows[0]) : null;
    }

    async saveSyncCheckpoint(input: {
      tenantId: string;
      resourceId: string;
      cursor?: string | null;
      watermark?: string | null;
      lastRunId?: string | null;
    }): Promise<SyncCheckpoint> {
      const { rows } = await this.tenantQuery(
        input.tenantId,
        `INSERT INTO sync_checkpoints
           (tenant_id, resource_id, cursor, watermark, last_run_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, resource_id) DO UPDATE
           SET cursor = COALESCE($3, sync_checkpoints.cursor),
               watermark = COALESCE($4, sync_checkpoints.watermark),
               last_run_id = COALESCE($5, sync_checkpoints.last_run_id),
               updated_at = now()
         RETURNING *`,
        [
          input.tenantId,
          input.resourceId,
          input.cursor ?? null,
          input.watermark ?? null,
          input.lastRunId ?? null,
        ],
      );
      return this.mapSyncCheckpoint(rows[0]);
    }

    async recordQuarantineRecord(input: {
      tenantId: string;
      sourceSystem: string;
      externalRecordId?: string;
      reason: string;
      payload?: Record<string, unknown>;
      resolutionNote?: string;
    }): Promise<QuarantineRecord> {
      const { rows } = await this.tenantQuery(
        input.tenantId,
        `INSERT INTO ingestion_quarantine
           (tenant_id, source_system, external_record_id, reason, payload, resolution_note)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (tenant_id, source_system, external_record_id) DO UPDATE
           SET reason = EXCLUDED.reason,
               payload = EXCLUDED.payload,
               resolution_note = EXCLUDED.resolution_note,
               resolved_at = NULL,
               resolved_by = NULL
         RETURNING *`,
        [
          input.tenantId,
          input.sourceSystem,
          input.externalRecordId ?? null,
          input.reason,
          JSON.stringify(input.payload ?? {}),
          input.resolutionNote ?? null,
        ],
      );
      return this.mapQuarantineRecord(rows[0]);
    }

    async listQuarantineRecords(
      tenantId: string,
      filter?: { sourceSystem?: string; unresolvedOnly?: boolean },
    ): Promise<QuarantineRecord[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM ingestion_quarantine WHERE tenant_id=$1";
      if (filter?.sourceSystem) {
        params.push(filter.sourceSystem);
        sql += ` AND source_system=$${params.length}`;
      }
      if (filter?.unresolvedOnly) {
        sql += " AND resolved_at IS NULL";
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapQuarantineRecord(row));
    }

    // NP-008：外部对象身份（096 表 external_object_identities）。
    async upsertExternalObject(input: {
      tenantId: string;
      sourceSystem: string;
      externalObjectType: string;
      externalObjectId: string;
      internalObjectType: string;
      internalObjectId: string;
      matchRule?: string;
      confidence?: number;
      confirmedBy?: string;
    }): Promise<ExternalObjectIdentity> {
      const { rows } = await this.tenantQuery(
        input.tenantId,
        `INSERT INTO external_object_identities
           (tenant_id, source_system, external_object_type, external_object_id,
            internal_object_type, internal_object_id, match_rule, confidence, confirmed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, source_system, external_object_type, external_object_id)
         DO UPDATE SET internal_object_type = EXCLUDED.internal_object_type,
             internal_object_id = EXCLUDED.internal_object_id,
             match_rule = EXCLUDED.match_rule,
             confidence = EXCLUDED.confidence,
             confirmed_by = EXCLUDED.confirmed_by,
             valid_to = NULL
         RETURNING *`,
        [
          input.tenantId,
          input.sourceSystem,
          input.externalObjectType,
          input.externalObjectId,
          input.internalObjectType,
          input.internalObjectId,
          input.matchRule ?? "MANUAL",
          input.confidence ?? 1,
          input.confirmedBy ?? null,
        ],
      );
      return this.mapExternalObjectIdentity(rows[0]);
    }

    async resolveExternalObject(
      tenantId: string,
      sourceSystem: string,
      externalObjectType: string,
      externalObjectId: string,
    ): Promise<ExternalObjectIdentity | null> {
      const { rows } = await this.tenantQuery(
        tenantId,
        `SELECT * FROM external_object_identities
          WHERE tenant_id=$1 AND source_system=$2
            AND external_object_type=$3 AND external_object_id=$4
            AND valid_to IS NULL`,
        [tenantId, sourceSystem, externalObjectType, externalObjectId],
      );
      return rows[0] ? this.mapExternalObjectIdentity(rows[0]) : null;
    }

    async listExternalObjects(
      tenantId: string,
      filter?: { sourceSystem?: string; externalObjectType?: string },
    ): Promise<ExternalObjectIdentity[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM external_object_identities WHERE tenant_id=$1";
      if (filter?.sourceSystem) {
        params.push(filter.sourceSystem);
        sql += ` AND source_system=$${params.length}`;
      }
      if (filter?.externalObjectType) {
        params.push(filter.externalObjectType);
        sql += ` AND external_object_type=$${params.length}`;
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapExternalObjectIdentity(row));
    }

    // NP-009：不透明 webhook 路由键 + 原始载荷（加密）收件。
    async issueWebhookRoutingKey(input: {
      tenantId: string;
      connectionId: string;
    }): Promise<WebhookRoutingKey> {
      await this.getIntegrationConnection(input.tenantId, input.connectionId);
      const { rows: existing } = await this.tenantQuery(
        input.tenantId,
        "SELECT * FROM integration_webhook_endpoints WHERE tenant_id=$1 AND connection_id=$2",
        [input.tenantId, input.connectionId],
      );
      if (existing[0]) return this.mapWebhookRoutingKey(existing[0]);
      const routingKey = `${Date.now().toString(36)}${randomUUID().replace(/-/g, "")}`;
      const { rows } = await this.tenantQuery(
        input.tenantId,
        `INSERT INTO integration_webhook_endpoints (tenant_id, connection_id, routing_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, connection_id) DO UPDATE SET routing_key = EXCLUDED.routing_key
         RETURNING *`,
        [input.tenantId, input.connectionId, routingKey],
      );
      return this.mapWebhookRoutingKey(rows[0]);
    }

    async resolveWebhookRoutingKey(
      routingKey: string,
    ): Promise<{ tenantId: string; connectionId: string; provider: string } | null> {
      // 路由键查找跨租户（键本身即入口）——用平台查询。
      const { rows } = await this.platformQuery(
        `SELECT e.tenant_id, e.connection_id, c.provider
           FROM integration_webhook_endpoints e
           JOIN integration_connections c
             ON c.tenant_id = e.tenant_id AND c.id = e.connection_id
          WHERE e.routing_key=$1`,
        [routingKey],
      );
      if (!rows[0]) return null;
      return {
        tenantId: rows[0].tenant_id,
        connectionId: rows[0].connection_id,
        provider: rows[0].provider,
      };
    }

    async receiveIntegrationWebhook(input: {
      tenantId: string;
      sourceSystem: string;
      messageId: string;
      payloadHash: string;
      rawPayloadEncrypted: string;
    }): Promise<WebhookInboxMessage> {
      const { rows } = await this.tenantQuery(
        input.tenantId,
        `INSERT INTO webhook_inbox
           (tenant_id, source_system, message_id, payload_hash, status, raw_payload_encrypted)
         VALUES ($1, $2, $3, $4, 'RECEIVED', $5)
         ON CONFLICT (tenant_id, source_system, message_id) DO UPDATE
           SET raw_payload_encrypted = EXCLUDED.raw_payload_encrypted
         RETURNING *`,
        [
          input.tenantId,
          input.sourceSystem,
          input.messageId,
          input.payloadHash,
          input.rawPayloadEncrypted,
        ],
      );
      return this.mapWebhook(rows[0]);
    }

    async upsertExternalIdentity(input: {
      tenantId: string;
      sourceSystem: string;
      externalId: string;
      personId?: string;
      objectType: string;
    }): Promise<ExternalIdentity> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO external_identity_map
            (id, tenant_id, source_system, external_id, person_id, object_type)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id, source_system, external_id, object_type)
           DO UPDATE SET person_id=COALESCE(
             EXCLUDED.person_id, external_identity_map.person_id
           )
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.sourceSystem,
            input.externalId,
            input.personId ?? null,
            input.objectType,
          ],
        );
        return this.mapExternalIdentity(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError("tenant or person not found");
        }
        throw error;
      }
    }
    
    async listExternalIdentities(
      tenantId: string,
      filter?: { sourceSystem?: string; objectType?: string },
    ): Promise<ExternalIdentity[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM external_identity_map WHERE tenant_id=$1";
      if (filter?.sourceSystem) {
        params.push(filter.sourceSystem);
        sql += ` AND source_system=$${params.length}`;
      }
      if (filter?.objectType) {
        params.push(filter.objectType);
        sql += ` AND object_type=$${params.length}`;
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapExternalIdentity(row));
    }
    
    async receiveWebhook(input: {
      tenantId: string;
      sourceSystem: string;
      messageId: string;
      payloadHash: string;
    }): Promise<WebhookInboxMessage> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO webhook_inbox
            (id, tenant_id, source_system, message_id, payload_hash)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, source_system, message_id) DO NOTHING
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.sourceSystem,
            input.messageId,
            input.payloadHash,
          ],
        );
        if (rows[0]) return this.mapWebhook(rows[0]);
        const { rows: existing } = await this.tenantQuery(input.tenantId, 
          `SELECT * FROM webhook_inbox
            WHERE tenant_id=$1 AND source_system=$2 AND message_id=$3`,
          [input.tenantId, input.sourceSystem, input.messageId],
        );
        if (!existing[0]) {
          throw new ConflictError("webhook message could not be recorded");
        }
        return this.mapWebhook(existing[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
    }
    
    async listWebhooks(
      tenantId: string,
      filter?: { status?: string; sourceSystem?: string },
    ): Promise<WebhookInboxMessage[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM webhook_inbox WHERE tenant_id=$1";
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status=$${params.length}`;
      }
      if (filter?.sourceSystem) {
        params.push(filter.sourceSystem);
        sql += ` AND source_system=$${params.length}`;
      }
      sql += " ORDER BY received_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapWebhook(row));
    }
    
    async processWebhook(input: {
      tenantId: string;
      webhookId: string;
      status: "PROCESSED" | "FAILED";
      errorCode?: string;
    }): Promise<WebhookInboxMessage> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE webhook_inbox
            SET status=$3, error_code=$4, processed_at=now()
          WHERE tenant_id=$1 AND id=$2 AND processed_at IS NULL
          RETURNING *`,
        [
          input.tenantId,
          input.webhookId,
          input.status,
          input.errorCode ?? null,
        ],
      );
      if (!rows[0]) {
        const { rows: existing } = await this.tenantQuery(input.tenantId, 
          "SELECT * FROM webhook_inbox WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.webhookId],
        );
        if (!existing[0]) notFound("WebhookInboxMessage", input.webhookId);
        throw new ConflictError(
          `webhook ${input.webhookId} is already processed`,
        );
      }
      return this.mapWebhook(rows[0]);
    }
  };
}
