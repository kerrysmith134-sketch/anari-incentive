/**
 * NPV2-013：告知 Adapter（CommsPort，方法体逐字平移）。
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
import type { CommsPort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryCommsMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements CommsPort {
    
    async createNotice(input: {
      tenantId: string;
      noticeType: NoticeType;
      title: string;
      bodyRef: string;
      policyVersionId?: string;
      publishedAt?: string;
      effectiveFrom: string;
      acknowledgementRequired: boolean;
    }): Promise<EmployeeNotice> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const timestamp = now();
      const notice: EmployeeNotice = {
        id: randomUUID(),
        tenantId: input.tenantId,
        policyVersionId: input.policyVersionId,
        noticeType: input.noticeType,
        title: input.title,
        bodyRef: input.bodyRef,
        publishedAt: input.publishedAt ?? timestamp,
        effectiveFrom: input.effectiveFrom,
        acknowledgementRequired: input.acknowledgementRequired,
        createdAt: timestamp,
      };
      this.notices.set(notice.id, notice);
      return notice;
    }
    
    async listNotices(tenantId: string): Promise<EmployeeNotice[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.notices.values()]
        .filter((notice) => notice.tenantId === tenantId)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    }
    
    async getNotice(
      tenantId: string,
      noticeId: string,
    ): Promise<EmployeeNotice> {
      const notice = this.notices.get(noticeId);
      if (!notice || notice.tenantId !== tenantId) {
        notFound("Notice", noticeId);
      }
      return notice;
    }
    
    async recordAcknowledgement(input: {
      tenantId: string;
      noticeId: string;
      personId: string;
      decision: "ACKNOWLEDGE" | "DECLINE";
      signatureRef?: string;
      declineReason?: string;
    }): Promise<PolicyAcknowledgement> {
      const notice = await this.getNotice(input.tenantId, input.noticeId);
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      const key = `${notice.id}:${input.personId}`;
      const existing = this.acknowledgements.get(key);
      const timestamp = now();
      const acknowledgement: PolicyAcknowledgement = existing ?? {
        id: randomUUID(),
        tenantId: input.tenantId,
        noticeId: notice.id,
        personId: input.personId,
        createdAt: timestamp,
      };
      if (input.decision === "ACKNOWLEDGE") {
        acknowledgement.acknowledgedAt = timestamp;
        acknowledgement.signatureRef = input.signatureRef;
        acknowledgement.declinedAt = undefined;
        acknowledgement.declineReason = undefined;
      } else {
        acknowledgement.declinedAt = timestamp;
        acknowledgement.declineReason = input.declineReason;
        acknowledgement.acknowledgedAt = undefined;
        acknowledgement.signatureRef = undefined;
      }
      this.acknowledgements.set(key, acknowledgement);
      return acknowledgement;
    }
    
    async listAcknowledgements(
      tenantId: string,
      noticeId: string,
    ): Promise<NoticeAcknowledgementOverview> {
      const notice = await this.getNotice(tenantId, noticeId);
      const acknowledgements = [...this.acknowledgements.values()]
        .filter((candidate) => candidate.noticeId === notice.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const activePersonIds = new Set(
        [...this.persons.values()]
          .filter(
            (person) =>
              person.tenantId === tenantId &&
              person.employmentStatus === "ACTIVE",
          )
          .map((person) => person.id),
      );
      const activeAcknowledgements = acknowledgements.filter((candidate) =>
        activePersonIds.has(candidate.personId),
      );
      const acknowledgedCount = activeAcknowledgements.filter(
        (candidate) => candidate.acknowledgedAt,
      ).length;
      const declinedCount = activeAcknowledgements.filter(
        (candidate) => candidate.declinedAt,
      ).length;
      return {
        summary: {
          noticeId: notice.id,
          acknowledgementRequired: notice.acknowledgementRequired,
          personCount: activePersonIds.size,
          acknowledgedCount,
          declinedCount,
          pendingCount: Math.max(
            activePersonIds.size - acknowledgedCount - declinedCount,
            0,
          ),
          complete:
            !notice.acknowledgementRequired ||
            (activePersonIds.size > 0 &&
              acknowledgedCount >= activePersonIds.size),
        },
        acknowledgements,
      };
    }
    
    async receiveInboxMessage(input: {
      tenantId: string;
      consumerName: string;
      messageId: string;
    }): Promise<InboxMessage> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const key = [
        input.tenantId,
        input.consumerName,
        input.messageId,
      ].join(":");
      const existing = this.inboxMessages.get(key);
      if (existing) return existing;
      const message: InboxMessage = {
        id: randomUUID(),
        tenantId: input.tenantId,
        consumerName: input.consumerName,
        messageId: input.messageId,
        receivedAt: now(),
        status: "RECEIVED",
      };
      this.inboxMessages.set(key, message);
      return message;
    }
    
    async listInboxMessages(
      tenantId: string,
      filter?: { consumerName?: string; status?: string },
    ): Promise<InboxMessage[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.inboxMessages.values()]
        .filter(
          (message) =>
            message.tenantId === tenantId &&
            (!filter?.consumerName ||
              message.consumerName === filter.consumerName) &&
            (!filter?.status || message.status === filter.status),
        )
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    }
    
    async processInboxMessage(input: {
      tenantId: string;
      inboxMessageId: string;
      status: "PROCESSED" | "FAILED" | "IGNORED";
      errorCode?: string;
    }): Promise<InboxMessage> {
      const message = [...this.inboxMessages.values()].find(
        (candidate) =>
          candidate.id === input.inboxMessageId &&
          candidate.tenantId === input.tenantId,
      );
      if (!message) notFound("InboxMessage", input.inboxMessageId);
      if (message.processedAt) {
        throw new ConflictError(
          `inbox message ${message.id} is already processed`,
        );
      }
      message.status = input.status;
      message.errorCode = input.errorCode;
      message.processedAt = now();
      return message;
    }
  };
}
