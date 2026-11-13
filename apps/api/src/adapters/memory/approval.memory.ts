/**
 * NPV2-013：审批 Adapter（ApprovalPort，方法体逐字平移）。
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
import type { ApprovalPort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryApprovalMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements ApprovalPort {
    
    async createApprovalRequest(input: {
      tenantId: string;
      actionType: string;
      targetType: string;
      targetId: string;
      targetVersion: number;
      requestedByType: "USER" | "AGENT" | "SYSTEM";
      requestedById?: string;
      riskTier: ApprovalRiskTier;
      requiredApprovals: number;
      expiresAt?: string;
      payloadHash: string;
      idempotencyKey: string;
    }): Promise<ApprovalRequest> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const existing = [...this.approvalRequests.values()].find(
        (request) =>
          request.tenantId === input.tenantId &&
          request.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        if (existing.payloadHash !== input.payloadHash) {
          throw new ConflictError(
            `idempotency key ${input.idempotencyKey} was reused with a different payload`,
          );
        }
        return existing;
      }
      const request: ApprovalRequest = {
        id: randomUUID(),
        tenantId: input.tenantId,
        actionType: input.actionType,
        targetType: input.targetType,
        targetId: input.targetId,
        targetVersion: input.targetVersion,
        requestedByType: input.requestedByType,
        requestedById: input.requestedById,
        riskTier: input.riskTier,
        status: "PENDING",
        requiredApprovals: input.requiredApprovals,
        approvedCount: 0,
        expiresAt: input.expiresAt,
        payloadHash: input.payloadHash,
        idempotencyKey: input.idempotencyKey,
        createdAt: now(),
      };
      this.approvalRequests.set(request.id, request);
      return request;
    }
    
    async listApprovalRequests(
      tenantId: string,
      filter?: {
        status?: ApprovalStatus;
        targetType?: string;
        targetId?: string;
      },
    ): Promise<ApprovalRequest[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.approvalRequests.values()]
        .filter(
          (request) =>
            request.tenantId === tenantId &&
            (!filter?.status || request.status === filter.status) &&
            (!filter?.targetType || request.targetType === filter.targetType) &&
            (!filter?.targetId || request.targetId === filter.targetId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async getApprovalRequest(
      tenantId: string,
      requestId: string,
    ): Promise<ApprovalRequest> {
      const request = this.approvalRequests.get(requestId);
      if (!request || request.tenantId !== tenantId) {
        notFound("ApprovalRequest", requestId);
      }
      return request;
    }
    
    async listApprovalDecisions(
      tenantId: string,
      requestId: string,
    ): Promise<ApprovalDecision[]> {
      await this.getApprovalRequest(tenantId, requestId);
      return [...this.approvalDecisions.values()]
        .filter((decision) => decision.requestId === requestId)
        .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
    }
    
    async decideApprovalRequest(input: {
      tenantId: string;
      requestId: string;
      decision: "APPROVE" | "REJECT";
      approverPersonId: string;
      payloadHash: string;
      reason?: string;
      authContext: Record<string, unknown>;
    }): Promise<ApprovalRequest> {
      const request = await this.getApprovalRequest(
        input.tenantId,
        input.requestId,
      );
      if (request.status !== "PENDING") {
        throw new ConflictError(
          `approval request ${request.id} is ${request.status}`,
        );
      }
      if (request.expiresAt && new Date(request.expiresAt) <= new Date()) {
        request.status = "EXPIRED";
        throw new ConflictError(`approval request ${request.id} has expired`);
      }
      if (input.payloadHash !== request.payloadHash) {
        throw new ConflictError(
          "PAYLOAD_HASH_MISMATCH: the approved payload differs from the request",
        );
      }
      if (
        request.requestedByType === "USER" &&
        request.requestedById === input.approverPersonId
      ) {
        throw new ConflictError(
          "SEPARATION_OF_DUTIES: the requester cannot approve their own request",
        );
      }
      const approver = this.persons.get(input.approverPersonId);
      if (!approver || approver.tenantId !== input.tenantId) {
        notFound("Person", input.approverPersonId);
      }
      const key = `${request.id}:${input.approverPersonId}`;
      if (this.approvalDecisions.has(key)) {
        throw new ConflictError(
          `approver ${input.approverPersonId} already decided this request`,
        );
      }
      const decision: ApprovalDecision = {
        id: randomUUID(),
        tenantId: input.tenantId,
        requestId: request.id,
        decision: input.decision,
        approverPersonId: input.approverPersonId,
        payloadHash: input.payloadHash,
        reason: input.reason,
        decidedAt: now(),
        authContext: input.authContext,
      };
      this.approvalDecisions.set(key, decision);
      if (input.decision === "REJECT") {
        request.status = "REJECTED";
      } else {
        request.approvedCount += 1;
        if (request.approvedCount >= request.requiredApprovals) {
          request.status = "APPROVED";
        }
      }
      return request;
    }
    
    async consumeApprovalRequest(input: {
      tenantId: string;
      requestId: string;
      consumedBy: string;
    }): Promise<ApprovalRequest> {
      const request = await this.getApprovalRequest(
        input.tenantId,
        input.requestId,
      );
      if (request.status !== "APPROVED") {
        throw new ConflictError(
          `approval request ${request.id} is ${request.status}`,
        );
      }
      if (request.consumedAt) {
        throw new ConflictError(
          `approval request ${request.id} was already consumed`,
        );
      }
      const consumer = this.persons.get(input.consumedBy);
      if (!consumer || consumer.tenantId !== input.tenantId) {
        notFound("Person", input.consumedBy);
      }
      request.consumedAt = now();
      request.consumedBy = input.consumedBy;
      return request;
    }
  };
}
