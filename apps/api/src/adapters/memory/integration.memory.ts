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
