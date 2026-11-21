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
  ExternalObjectIdentity,
  QuarantineRecord,
  RawSourceRecord,
  SyncCheckpoint,
  WebhookRoutingKey,
  SyncResource,
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
import type { IntegrationPort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryIntegrationMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements IntegrationPort {
    
    async createESignEnvelope(input: {
      tenantId: string;
      contractId: string;
      provider: string;
      envelopeRef: string;
      documentHash: string;
      signerPersonId: string;
    }): Promise<ESignEnvelope> {
      const contract = this.employmentContracts.get(input.contractId);
      if (!contract || contract.tenantId !== input.tenantId) {
        notFound("EmploymentContract", input.contractId);
      }
      const signer = this.persons.get(input.signerPersonId);
      if (!signer || signer.tenantId !== input.tenantId) {
        notFound("Person", input.signerPersonId);
      }
      if (
        [...this.esignEnvelopes.values()].some(
          (envelope) =>
            envelope.tenantId === input.tenantId &&
            envelope.provider === input.provider &&
            envelope.envelopeRef === input.envelopeRef,
        )
      ) {
        throw new ConflictError(
          "ESIGN_ENVELOPE_EXISTS: provider envelope reference already recorded",
        );
      }
      const timestamp = now();
      const envelope: ESignEnvelope = {
        id: randomUUID(),
        tenantId: input.tenantId,
        contractId: input.contractId,
        provider: input.provider,
        envelopeRef: input.envelopeRef,
        documentHash: input.documentHash,
        signerPersonId: input.signerPersonId,
        status: "SENT",
        sentAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.esignEnvelopes.set(envelope.id, envelope);
      return envelope;
    }
    
    async listESignEnvelopes(
      tenantId: string,
      contractId?: string,
    ): Promise<ESignEnvelope[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.esignEnvelopes.values()]
        .filter(
          (envelope) =>
            envelope.tenantId === tenantId &&
            (!contractId || envelope.contractId === contractId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async completeESignEnvelope(input: {
      tenantId: string;
      provider: string;
      envelopeRef: string;
      status: "SIGNED" | "DECLINED" | "VOID";
      signatureRef?: string;
      reason?: string;
    }): Promise<ESignEnvelope> {
      const envelope = [...this.esignEnvelopes.values()].find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.provider === input.provider &&
          candidate.envelopeRef === input.envelopeRef,
      );
      if (!envelope) notFound("ESignEnvelope", input.envelopeRef);
      if (envelope.status !== "SENT") {
        throw new ConflictError(`e-sign envelope is ${envelope.status}`);
      }
      if (input.status === "SIGNED" && !input.signatureRef?.trim()) {
        throw new ConflictError("ESIGN_SIGNATURE_REF_REQUIRED");
      }
      envelope.status = input.status;
      envelope.completedAt = now();
      envelope.updatedAt = envelope.completedAt;
      envelope.declineReason =
        input.status === "SIGNED" ? undefined : input.reason;
      if (input.status === "SIGNED") {
        const contract = this.employmentContracts.get(envelope.contractId);
        if (contract && contract.tenantId === input.tenantId) {
          contract.consentSignatureRef = input.signatureRef!;
          contract.consentSignedAt = envelope.completedAt;
          contract.version += 1;
          contract.updatedAt = envelope.completedAt;
        }
      }
      return envelope;
    }
    
    async createIntegrationConnection(input: {
      tenantId: string;
      provider: string;
      connectionName: string;
      credentialRef: string;
      config: Record<string, unknown>;
    }): Promise<IntegrationConnection> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const timestamp = now();
      const connection: IntegrationConnection = {
        id: randomUUID(),
        tenantId: input.tenantId,
        provider: input.provider,
        connectionName: input.connectionName,
        credentialRef: input.credentialRef,
        status: "ACTIVE",
        config: input.config,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.integrationConnections.set(connection.id, connection);
      return connection;
    }
    
    async listIntegrationConnections(
      tenantId: string,
    ): Promise<IntegrationConnection[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.integrationConnections.values()]
        .filter((connection) => connection.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async getIntegrationConnection(
      tenantId: string,
      connectionId: string,
    ): Promise<IntegrationConnection> {
      const connection = this.integrationConnections.get(connectionId);
      if (!connection || connection.tenantId !== tenantId) {
        notFound("IntegrationConnection", connectionId);
      }
      return connection;
    }
    
    async setIntegrationConnectionStatus(input: {
      tenantId: string;
      connectionId: string;
      status: string;
    }): Promise<IntegrationConnection> {
      const connection = await this.getIntegrationConnection(
        input.tenantId,
        input.connectionId,
      );
      connection.status = input.status;
      connection.updatedAt = now();
      return connection;
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
      const duplicate = [...this.integrationMappings.values()].find(
        (mapping) =>
          mapping.tenantId === input.tenantId &&
          mapping.connectionId === input.connectionId &&
          mapping.name === input.name &&
          mapping.version === input.version,
      );
      if (duplicate) {
        throw new ConflictError(
          `Integration mapping ${input.name}:${input.version} already exists`,
        );
      }
      const active = [...this.integrationMappings.values()].find(
        (mapping) =>
          mapping.tenantId === input.tenantId &&
          mapping.connectionId === input.connectionId &&
          mapping.name === input.name &&
          mapping.status === "ACTIVE",
      );
      if (active) {
        throw new ConflictError(
          `INTEGRATION_MAPPING_ALREADY_ACTIVE: ${input.name}:${active.version}`,
        );
      }
      const mapping: IntegrationMapping = {
        id: randomUUID(),
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        name: input.name,
        mappingType: input.mappingType,
        sourceSystem: input.sourceSystem,
        targetType: input.targetType,
        fieldMap: { ...input.fieldMap },
        config: structuredClone(input.config),
        version: input.version,
        status: "ACTIVE",
        createdAt: now(),
      };
      this.integrationMappings.set(mapping.id, mapping);
      return mapping;
    }
    
    async listIntegrationMappings(
      tenantId: string,
      connectionId: string,
      status?: IntegrationMapping["status"],
    ): Promise<IntegrationMapping[]> {
      await this.getIntegrationConnection(tenantId, connectionId);
      return [...this.integrationMappings.values()]
        .filter(
          (mapping) =>
            mapping.tenantId === tenantId &&
            mapping.connectionId === connectionId &&
            (!status || mapping.status === status),
        )
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) || b.version - a.version,
        );
    }
    
    async getIntegrationMapping(
      tenantId: string,
      mappingId: string,
    ): Promise<IntegrationMapping> {
      const mapping = this.integrationMappings.get(mappingId);
      if (!mapping || mapping.tenantId !== tenantId) {
        notFound("IntegrationMapping", mappingId);
      }
      return mapping;
    }
    
    async retireIntegrationMapping(input: {
      tenantId: string;
      mappingId: string;
    }): Promise<IntegrationMapping> {
      const mapping = await this.getIntegrationMapping(
        input.tenantId,
        input.mappingId,
      );
      if (mapping.status !== "ACTIVE") {
        throw new ConflictError(
          `integration mapping ${mapping.id} is ${mapping.status}`,
        );
      }
      mapping.status = "RETIRED";
      mapping.retiredAt = now();
      return mapping;
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
      const duplicate = [...this.syncSchedules.values()].find(
        (schedule) =>
          schedule.tenantId === input.tenantId &&
          schedule.connectionId === input.connectionId &&
          schedule.name === input.name,
      );
      if (duplicate) {
        throw new ConflictError(
          `Sync schedule ${input.name} already exists for this connection`,
        );
      }
      const timestamp = now();
      const schedule: SyncSchedule = {
        id: randomUUID(),
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        name: input.name,
        intervalMinutes: input.intervalMinutes,
        enabled: true,
        nextRunAt:
          input.startAt ??
          new Date(
            Date.parse(timestamp) + input.intervalMinutes * 60_000,
          ).toISOString(),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.syncSchedules.set(schedule.id, schedule);
      return schedule;
    }
    
    async listSyncSchedules(
      tenantId: string,
      connectionId?: string,
    ): Promise<SyncSchedule[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.syncSchedules.values()]
        .filter(
          (schedule) =>
            schedule.tenantId === tenantId &&
            (!connectionId || schedule.connectionId === connectionId),
        )
        .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
    }
    
    async getSyncSchedule(
      tenantId: string,
      scheduleId: string,
    ): Promise<SyncSchedule> {
      const schedule = this.syncSchedules.get(scheduleId);
      if (!schedule || schedule.tenantId !== tenantId) {
        notFound("SyncSchedule", scheduleId);
      }
      return schedule;
    }
    
    async setSyncScheduleEnabled(input: {
      tenantId: string;
      scheduleId: string;
      enabled: boolean;
    }): Promise<SyncSchedule> {
      const schedule = await this.getSyncSchedule(
        input.tenantId,
        input.scheduleId,
      );
      schedule.enabled = input.enabled;
      schedule.updatedAt = now();
      return schedule;
    }
    
    async claimDueSyncSchedules(input: {
      tenantId: string;
      limit: number;
      now?: string;
    }): Promise<SyncSchedule[]> {
      if (!this.tenants.has(input.tenantId)) {
        notFound("Tenant", input.tenantId);
      }
      const current = new Date(input.now ?? new Date().toISOString());
      const due = [...this.syncSchedules.values()]
        .filter(
          (schedule) =>
            schedule.tenantId === input.tenantId &&
            schedule.enabled &&
            new Date(schedule.nextRunAt).getTime() <= current.getTime(),
        )
        .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))
        .slice(0, input.limit);
      for (const schedule of due) {
        schedule.lastRunAt = current.toISOString();
        schedule.nextRunAt = new Date(
          current.getTime() + schedule.intervalMinutes * 60_000,
        ).toISOString();
        schedule.updatedAt = current.toISOString();
      }
      return due.map((schedule) => ({ ...schedule }));
    }
    
    async createSyncRun(input: {
      tenantId: string;
      connectionId: string;
      status: string;
      cursorBefore?: Record<string, unknown>;
    }): Promise<SyncRun> {
      await this.getIntegrationConnection(input.tenantId, input.connectionId);
      const timestamp = now();
      const run: SyncRun = {
        id: randomUUID(),
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        status: input.status,
        startedAt: input.status === "QUEUED" ? undefined : timestamp,
        cursorBefore: input.cursorBefore,
        recordsSeen: 0,
        recordsUpserted: 0,
        createdAt: timestamp,
      };
      this.syncRuns.set(run.id, run);
      return run;
    }
    
    async listSyncRuns(
      tenantId: string,
      connectionId?: string,
    ): Promise<SyncRun[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.syncRuns.values()]
        .filter(
          (run) =>
            run.tenantId === tenantId &&
            (!connectionId || run.connectionId === connectionId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      const run = this.syncRuns.get(input.syncRunId);
      if (!run || run.tenantId !== input.tenantId) {
        notFound("SyncRun", input.syncRunId);
      }
      if (run.finishedAt) {
        throw new ConflictError(`sync run ${run.id} is already finished`);
      }
      const timestamp = now();
      run.status = input.status;
      run.recordsSeen = input.recordsSeen;
      run.recordsUpserted = input.recordsUpserted;
      run.recordsFetched = input.recordsFetched;
      run.recordsQuarantined = input.recordsQuarantined;
      run.recordsFailed = input.recordsFailed;
      run.cursorAfter = input.cursorAfter;
      run.errorSummary = input.errorSummary;
      run.finishedAt = timestamp;
      const connection = this.integrationConnections.get(run.connectionId);
      if (connection) {
        connection.lastSyncAt = timestamp;
        connection.updatedAt = timestamp;
      }
      return run;
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
      const duplicate = [...this.syncResources.values()].find(
        (resource) =>
          resource.tenantId === input.tenantId &&
          resource.connectionId === input.connectionId &&
          resource.resourceKey === input.resourceKey,
      );
      if (duplicate) {
        throw new ConflictError(
          `SYNC_RESOURCE_EXISTS: ${input.connectionId}/${input.resourceKey}`,
        );
      }
      const timestamp = now();
      const resource: SyncResource = {
        id: randomUUID(),
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        resourceKey: input.resourceKey,
        mappingId: input.mappingId,
        scheduleId: input.scheduleId,
        status: "ACTIVE",
        leaseOwner: null,
        leaseUntil: null,
        fencingToken: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.syncResources.set(resource.id, resource);
      return resource;
    }

    async listSyncResources(
      tenantId: string,
      connectionId?: string,
    ): Promise<SyncResource[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.syncResources.values()]
        .filter(
          (resource) =>
            resource.tenantId === tenantId &&
            (!connectionId || resource.connectionId === connectionId),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    async getSyncCheckpoint(
      tenantId: string,
      resourceId: string,
    ): Promise<SyncCheckpoint | null> {
      const resource = this.syncResources.get(resourceId);
      if (!resource || resource.tenantId !== tenantId) {
        notFound("SyncResource", resourceId);
      }
      return (
        [...this.syncCheckpoints.values()].find(
          (checkpoint) =>
            checkpoint.tenantId === tenantId &&
            checkpoint.resourceId === resourceId,
        ) ?? null
      );
    }

    async saveSyncCheckpoint(input: {
      tenantId: string;
      resourceId: string;
      cursor?: string | null;
      watermark?: string | null;
      lastRunId?: string | null;
    }): Promise<SyncCheckpoint> {
      const resource = this.syncResources.get(input.resourceId);
      if (!resource || resource.tenantId !== input.tenantId) {
        notFound("SyncResource", input.resourceId);
      }
      const timestamp = now();
      const existing = [...this.syncCheckpoints.values()].find(
        (checkpoint) =>
          checkpoint.tenantId === input.tenantId &&
          checkpoint.resourceId === input.resourceId,
      );
      if (existing) {
        existing.cursor = input.cursor ?? existing.cursor;
        existing.watermark = input.watermark ?? existing.watermark;
        existing.lastRunId = input.lastRunId ?? existing.lastRunId;
        existing.updatedAt = timestamp;
        return existing;
      }
      const checkpoint: SyncCheckpoint = {
        id: randomUUID(),
        tenantId: input.tenantId,
        resourceId: input.resourceId,
        cursor: input.cursor ?? null,
        watermark: input.watermark ?? null,
        overlapSeconds: 0,
        lastRunId: input.lastRunId ?? null,
        updatedAt: timestamp,
      };
      this.syncCheckpoints.set(checkpoint.id, checkpoint);
      return checkpoint;
    }

    async recordQuarantineRecord(input: {
      tenantId: string;
      sourceSystem: string;
      externalRecordId?: string;
      reason: string;
      payload?: Record<string, unknown>;
      resolutionNote?: string;
    }): Promise<QuarantineRecord> {
      const timestamp = now();
      const existing = [...this.quarantineRecords.values()].find(
        (record) =>
          record.tenantId === input.tenantId &&
          record.sourceSystem === input.sourceSystem &&
          record.externalRecordId !== null &&
          record.externalRecordId === input.externalRecordId,
      );
      if (existing) {
        existing.reason = input.reason;
        existing.payload = input.payload ?? existing.payload;
        existing.resolutionNote = input.resolutionNote ?? existing.resolutionNote;
        existing.resolvedAt = null;
        existing.resolvedBy = null;
        return existing;
      }
      const record: QuarantineRecord = {
        id: randomUUID(),
        tenantId: input.tenantId,
        sourceSystem: input.sourceSystem,
        externalRecordId: input.externalRecordId ?? null,
        reason: input.reason,
        payload: input.payload ?? {},
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: input.resolutionNote ?? null,
        createdAt: timestamp,
      };
      this.quarantineRecords.set(record.id, record);
      return record;
    }

    async listQuarantineRecords(
      tenantId: string,
      filter?: { sourceSystem?: string; unresolvedOnly?: boolean },
    ): Promise<QuarantineRecord[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.quarantineRecords.values()]
        .filter(
          (record) =>
            record.tenantId === tenantId &&
            (!filter?.sourceSystem || record.sourceSystem === filter.sourceSystem) &&
            (!filter?.unresolvedOnly || !record.resolvedAt),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const timestamp = now();
      const existing = [...this.externalObjects.values()].find(
        (identity) =>
          identity.tenantId === input.tenantId &&
          identity.sourceSystem === input.sourceSystem &&
          identity.externalObjectType === input.externalObjectType &&
          identity.externalObjectId === input.externalObjectId,
      );
      if (existing) {
        existing.internalObjectType = input.internalObjectType;
        existing.internalObjectId = input.internalObjectId;
        existing.matchRule = input.matchRule ?? existing.matchRule;
        existing.confidence = input.confidence ?? existing.confidence;
        existing.confirmedBy = input.confirmedBy ?? existing.confirmedBy;
        existing.validTo = null;
        return existing;
      }
      const identity: ExternalObjectIdentity = {
        id: randomUUID(),
        tenantId: input.tenantId,
        sourceSystem: input.sourceSystem,
        externalObjectType: input.externalObjectType,
        externalObjectId: input.externalObjectId,
        internalObjectType: input.internalObjectType,
        internalObjectId: input.internalObjectId,
        matchRule: input.matchRule ?? "MANUAL",
        confidence: input.confidence ?? 1,
        confirmedBy: input.confirmedBy,
        validFrom: timestamp,
        validTo: null,
        createdAt: timestamp,
      };
      this.externalObjects.set(identity.id, identity);
      return identity;
    }

    async resolveExternalObject(
      tenantId: string,
      sourceSystem: string,
      externalObjectType: string,
      externalObjectId: string,
    ): Promise<ExternalObjectIdentity | null> {
      return (
        [...this.externalObjects.values()].find(
          (identity) =>
            identity.tenantId === tenantId &&
            identity.sourceSystem === sourceSystem &&
            identity.externalObjectType === externalObjectType &&
            identity.externalObjectId === externalObjectId &&
            !identity.validTo,
        ) ?? null
      );
    }

    // NP-009：不透明 webhook 路由键 + 原始载荷（加密）收件。
    async issueWebhookRoutingKey(input: {
      tenantId: string;
      connectionId: string;
    }): Promise<WebhookRoutingKey> {
      await this.getIntegrationConnection(input.tenantId, input.connectionId);
      const timestamp = now();
      const existing = [...this.webhookRoutingKeys.values()].find(
        (entry) =>
          entry.tenantId === input.tenantId &&
          entry.connectionId === input.connectionId,
      );
      if (existing) return existing;
      const entry: WebhookRoutingKey = {
        id: randomUUID(),
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        routingKey: `${Date.now().toString(36)}${randomUUID().replace(/-/g, "")}`,
        createdAt: timestamp,
      };
      this.webhookRoutingKeys.set(entry.routingKey, entry);
      return entry;
    }

    async resolveWebhookRoutingKey(
      routingKey: string,
    ): Promise<{ tenantId: string; connectionId: string; provider: string } | null> {
      const entry = this.webhookRoutingKeys.get(routingKey);
      if (!entry) return null;
      const connection = this.integrationConnections.get(entry.connectionId);
      return {
        tenantId: entry.tenantId,
        connectionId: entry.connectionId,
        provider: connection?.provider ?? "generic",
      };
    }

    async receiveIntegrationWebhook(input: {
      tenantId: string;
      sourceSystem: string;
      messageId: string;
      payloadHash: string;
      rawPayloadEncrypted: string;
    }): Promise<WebhookInboxMessage> {
      const timestamp = now();
      const existing = [...this.webhooks.values()].find(
        (message) =>
          message.tenantId === input.tenantId &&
          message.sourceSystem === input.sourceSystem &&
          message.messageId === input.messageId,
      );
      if (existing) return existing;
      const message: WebhookInboxMessage = {
        id: randomUUID(),
        tenantId: input.tenantId,
        sourceSystem: input.sourceSystem,
        messageId: input.messageId,
        payloadHash: input.payloadHash,
        receivedAt: timestamp,
        status: "PENDING",
        rawPayloadEncrypted: input.rawPayloadEncrypted,
      };
      this.webhooks.set(message.id, message);
      return message;
    }

    // NP-020：原始落地（内存实现——Map 即不可变语义，密文原样存取）。
    async appendRawSourceRecord(input: {
      tenantId: string;
      sourceSystem: string;
      externalRecordId: string;
      payloadEncrypted: string;
      mappingVersion?: number;
      retentionClass?: "DEFAULT" | "PII" | "FINANCIAL";
    }): Promise<RawSourceRecord> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const timestamp = now();
      // 与 PG ON CONFLICT 对等：同 (tenant, system, recordId) 覆盖密文与
      // mapping 版本并重置重放标记（供应商更正后可再次重放）。
      const existing = [...this.rawSourceRecords.values()].find(
        (record) =>
          record.tenantId === input.tenantId &&
          record.sourceSystem === input.sourceSystem &&
          record.externalRecordId === input.externalRecordId,
      );
      if (existing) {
        existing.payloadEncrypted = input.payloadEncrypted;
        existing.mappingVersion = input.mappingVersion ?? existing.mappingVersion;
        existing.retentionClass = input.retentionClass ?? existing.retentionClass;
        existing.replayedAt = null;
        return existing;
      }
      const record: RawSourceRecord = {
        id: randomUUID(),
        tenantId: input.tenantId,
        sourceSystem: input.sourceSystem,
        externalRecordId: input.externalRecordId,
        payloadEncrypted: input.payloadEncrypted,
        mappingVersion: input.mappingVersion ?? 1,
        retentionClass: input.retentionClass ?? "DEFAULT",
        replayedAt: null,
        createdAt: timestamp,
      };
      this.rawSourceRecords.set(record.id, record);
      return record;
    }

    async listRawSourceRecords(
      tenantId: string,
      filter?: { sourceSystem?: string; replayedOnly?: boolean },
    ): Promise<RawSourceRecord[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.rawSourceRecords.values()]
        .filter(
          (record) =>
            record.tenantId === tenantId &&
            (!filter?.sourceSystem || record.sourceSystem === filter.sourceSystem) &&
            (!filter?.replayedOnly || record.replayedAt !== null),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    async getRawSourceRecord(tenantId: string, id: string): Promise<RawSourceRecord> {
      const record = this.rawSourceRecords.get(id);
      if (!record || record.tenantId !== tenantId) notFound("RawSourceRecord", id);
      return record;
    }

    async markRawSourceRecordReplayed(tenantId: string, id: string): Promise<RawSourceRecord> {
      const record = await this.getRawSourceRecord(tenantId, id);
      record.replayedAt = now();
      return record;
    }

    // NP-021：资源级租约。
    async claimResourceSyncLease(input: {
      tenantId: string;
      resourceId: string;
      leaseOwner: string;
      leaseSeconds: number;
    }): Promise<{ fencingToken: number; leaseUntil: string }> {
      const resource = this.syncResources.get(input.resourceId);
      if (!resource || resource.tenantId !== input.tenantId) {
        notFound("SyncResource", input.resourceId);
      }
      const current = Date.now();
      const heldUntil = resource.leaseUntil ? Date.parse(resource.leaseUntil) : 0;
      const heldByOther =
        resource.leaseOwner &&
        resource.leaseOwner !== input.leaseOwner &&
        heldUntil > current;
      if (heldByOther) {
        throw new ConflictError(
          `RESOURCE_LEASED: ${resource.id} is held by ${resource.leaseOwner} until ${resource.leaseUntil}`,
        );
      }
      const fencingToken = (resource.fencingToken ?? 0) + 1;
      resource.fencingToken = fencingToken;
      resource.leaseOwner = input.leaseOwner;
      resource.leaseUntil = new Date(current + input.leaseSeconds * 1000).toISOString();
      resource.updatedAt = now();
      return { fencingToken, leaseUntil: resource.leaseUntil! };
    }

    async releaseResourceSyncLease(input: {
      tenantId: string;
      resourceId: string;
      leaseOwner: string;
      fencingToken: number;
    }): Promise<void> {
      const resource = this.syncResources.get(input.resourceId);
      if (!resource || resource.tenantId !== input.tenantId) {
        notFound("SyncResource", input.resourceId);
      }
      // stale fencing：token 不匹配或持有者不同 → 拒绝（旧持有者写不过新持有者）。
      if (
        resource.leaseOwner !== input.leaseOwner ||
        (resource.fencingToken ?? 0) !== input.fencingToken
      ) {
        throw new ConflictError(
          `RESOURCE_LEASE_STALE: fencing token mismatch on ${resource.id}`,
        );
      }
      resource.leaseOwner = null;
      resource.leaseUntil = null;
      resource.updatedAt = now();
    }

    // NP-027：身份生命周期。
    async unlinkExternalObject(input: {
      tenantId: string;
      sourceSystem: string;
      externalObjectType: string;
      externalObjectId: string;
      reason: string;
      actorPersonId: string;
    }): Promise<ExternalObjectIdentity> {
      const identity = await this.resolveExternalObject(
        input.tenantId,
        input.sourceSystem,
        input.externalObjectType,
        input.externalObjectId,
      );
      if (!identity) {
        notFound(
          "ExternalObjectIdentity",
          `${input.sourceSystem}/${input.externalObjectType}/${input.externalObjectId}`,
        );
      }
      identity.validTo = now();
      identity.unlinkReason = input.reason;
      identity.unlinkedBy = input.actorPersonId;
      return identity;
    }

    async mergeExternalObjects(input: {
      tenantId: string;
      sourceSystem: string;
      externalObjectType: string;
      keepExternalObjectId: string;
      mergeExternalObjectIds: string[];
      actorPersonId: string;
    }): Promise<{ merged: number; internalObjectId: string }> {
      const keep = await this.resolveExternalObject(
        input.tenantId,
        input.sourceSystem,
        input.externalObjectType,
        input.keepExternalObjectId,
      );
      if (!keep) {
        notFound("ExternalObjectIdentity", input.keepExternalObjectId);
      }
      let merged = 0;
      for (const externalObjectId of input.mergeExternalObjectIds) {
        const identity = await this.resolveExternalObject(
          input.tenantId,
          input.sourceSystem,
          input.externalObjectType,
          externalObjectId,
        );
        if (!identity || identity.id === keep!.id) continue;
        identity.internalObjectType = keep!.internalObjectType;
        identity.internalObjectId = keep!.internalObjectId;
        // 被并入的旧内部对象关系终止留痕（NP-027：可审计可回溯）。
        identity.unlinkReason = "MERGED";
        identity.unlinkedBy = input.actorPersonId;
        merged += 1;
      }
      return { merged, internalObjectId: keep!.internalObjectId };
    }

    async listExternalObjects(
      tenantId: string,
      filter?: { sourceSystem?: string; externalObjectType?: string; includeUnlinked?: boolean },
    ): Promise<ExternalObjectIdentity[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.externalObjects.values()]
        .filter(
          (identity) =>
            identity.tenantId === tenantId &&
            (!filter?.sourceSystem || identity.sourceSystem === filter.sourceSystem) &&
            (!filter?.externalObjectType ||
              identity.externalObjectType === filter.externalObjectType) &&
            (filter?.includeUnlinked || !identity.validTo),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    async upsertExternalIdentity(input: {
      tenantId: string;
      sourceSystem: string;
      externalId: string;
      personId?: string;
      objectType: string;
    }): Promise<ExternalIdentity> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (input.personId) {
        const person = this.persons.get(input.personId);
        if (!person || person.tenantId !== input.tenantId) {
          notFound("Person", input.personId);
        }
      }
      const key = [
        input.tenantId,
        input.sourceSystem,
        input.externalId,
        input.objectType,
      ].join(":");
      const existing = this.externalIdentities.get(key);
      if (existing) {
        if (input.personId) existing.personId = input.personId;
        return existing;
      }
      const identity: ExternalIdentity = {
        id: randomUUID(),
        tenantId: input.tenantId,
        sourceSystem: input.sourceSystem,
        externalId: input.externalId,
        personId: input.personId,
        objectType: input.objectType,
        createdAt: now(),
      };
      this.externalIdentities.set(key, identity);
      return identity;
    }
    
    async listExternalIdentities(
      tenantId: string,
      filter?: { sourceSystem?: string; objectType?: string },
    ): Promise<ExternalIdentity[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.externalIdentities.values()]
        .filter(
          (identity) =>
            identity.tenantId === tenantId &&
            (!filter?.sourceSystem ||
              identity.sourceSystem === filter.sourceSystem) &&
            (!filter?.objectType ||
              identity.objectType === filter.objectType),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async receiveWebhook(input: {
      tenantId: string;
      sourceSystem: string;
      messageId: string;
      payloadHash: string;
    }): Promise<WebhookInboxMessage> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const key = [
        input.tenantId,
        input.sourceSystem,
        input.messageId,
      ].join(":");
      const existing = this.webhooks.get(key);
      if (existing) return existing;
      const message: WebhookInboxMessage = {
        id: randomUUID(),
        tenantId: input.tenantId,
        sourceSystem: input.sourceSystem,
        messageId: input.messageId,
        payloadHash: input.payloadHash,
        receivedAt: now(),
        status: "RECEIVED",
      };
      this.webhooks.set(key, message);
      return message;
    }
    
    async listWebhooks(
      tenantId: string,
      filter?: { status?: string; sourceSystem?: string },
    ): Promise<WebhookInboxMessage[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.webhooks.values()]
        .filter(
          (message) =>
            message.tenantId === tenantId &&
            (!filter?.status || message.status === filter.status) &&
            (!filter?.sourceSystem ||
              message.sourceSystem === filter.sourceSystem),
        )
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    }
    
    async processWebhook(input: {
      tenantId: string;
      webhookId: string;
      status: "PROCESSED" | "FAILED";
      errorCode?: string;
    }): Promise<WebhookInboxMessage> {
      const message = [...this.webhooks.values()].find(
        (candidate) =>
          candidate.id === input.webhookId &&
          candidate.tenantId === input.tenantId,
      );
      if (!message) notFound("WebhookInboxMessage", input.webhookId);
      if (message.processedAt) {
        throw new ConflictError(
          `webhook ${message.id} is already processed`,
        );
      }
      message.status = input.status;
      message.errorCode = input.errorCode;
      message.processedAt = now();
      return message;
    }
  };
}
