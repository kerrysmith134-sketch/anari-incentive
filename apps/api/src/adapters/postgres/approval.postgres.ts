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
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgApprovalMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
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
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO approval_requests
            (id, tenant_id, action_type, target_type, target_id,
             target_version, requested_by_type, requested_by_id, risk_tier,
             required_approvals, expires_at, payload_hash, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.actionType,
            input.targetType,
            input.targetId,
            input.targetVersion,
            input.requestedByType,
            input.requestedById ?? null,
            input.riskTier,
            input.requiredApprovals,
            input.expiresAt ?? null,
            input.payloadHash,
            input.idempotencyKey,
          ],
        );
        return this.mapApprovalRequest(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          const { rows } = await this.pool.query(
            `SELECT * FROM approval_requests
              WHERE tenant_id=$1 AND idempotency_key=$2`,
            [input.tenantId, input.idempotencyKey],
          );
          if (rows[0] && rows[0].payload_hash === input.payloadHash) {
            return this.mapApprovalRequest(rows[0]);
          }
          throw new ConflictError(
            `idempotency key ${input.idempotencyKey} was reused with a different payload`,
          );
        }
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
    }
    
    async listApprovalRequests(
      tenantId: string,
      filter?: {
        status?: ApprovalStatus;
        targetType?: string;
        targetId?: string;
      },
    ): Promise<ApprovalRequest[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM approval_requests WHERE tenant_id=$1";
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status=$${params.length}`;
      }
      if (filter?.targetType) {
        params.push(filter.targetType);
        sql += ` AND target_type=$${params.length}`;
      }
      if (filter?.targetId) {
        params.push(filter.targetId);
        sql += ` AND target_id=$${params.length}`;
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.pool.query(sql, params);
      return rows.map((row) => this.mapApprovalRequest(row));
    }
    
    async getApprovalRequest(
      tenantId: string,
      requestId: string,
    ): Promise<ApprovalRequest> {
      const { rows } = await this.pool.query(
        "SELECT * FROM approval_requests WHERE tenant_id=$1 AND id=$2",
        [tenantId, requestId],
      );
      if (!rows[0]) notFound("ApprovalRequest", requestId);
      return this.mapApprovalRequest(rows[0]);
    }
    
    async listApprovalDecisions(
      tenantId: string,
      requestId: string,
    ): Promise<ApprovalDecision[]> {
      await this.getApprovalRequest(tenantId, requestId);
      const { rows } = await this.pool.query(
        `SELECT * FROM approval_decisions
          WHERE tenant_id=$1 AND request_id=$2
          ORDER BY decided_at`,
        [tenantId, requestId],
      );
      return rows.map((row) => this.mapApprovalDecision(row));
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
      return this.transaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM approval_requests
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.requestId],
        );
        if (!rows[0]) notFound("ApprovalRequest", input.requestId);
        const request = this.mapApprovalRequest(rows[0]);
        if (request.status !== "PENDING") {
          throw new ConflictError(
            `approval request ${request.id} is ${request.status}`,
          );
        }
        if (request.expiresAt && new Date(request.expiresAt) <= new Date()) {
          await client.query(
            `UPDATE approval_requests SET status='EXPIRED'
              WHERE tenant_id=$1 AND id=$2`,
            [input.tenantId, input.requestId],
          );
          throw new ConflictError(
            `approval request ${request.id} has expired`,
          );
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
        try {
          await client.query(
            `INSERT INTO approval_decisions
              (id, tenant_id, request_id, decision, approver_person_id,
               payload_hash, reason, auth_context)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              randomUUID(),
              input.tenantId,
              input.requestId,
              input.decision,
              input.approverPersonId,
              input.payloadHash,
              input.reason ?? null,
              input.authContext,
            ],
          );
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === "23505") {
            throw new ConflictError(
              `approver ${input.approverPersonId} already decided this request`,
            );
          }
          if (code === "23503") {
            throw new NotFoundError(
              `Person ${input.approverPersonId} not found`,
            );
          }
          throw error;
        }
        const approvedCount =
          input.decision === "APPROVE"
            ? request.approvedCount + 1
            : request.approvedCount;
        const status: ApprovalStatus =
          input.decision === "REJECT"
            ? "REJECTED"
            : approvedCount >= request.requiredApprovals
              ? "APPROVED"
              : "PENDING";
        const { rows: updated } = await client.query(
          `UPDATE approval_requests
              SET approved_count=$3, status=$4
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.requestId, approvedCount, status],
        );
        return this.mapApprovalRequest(updated[0]);
      });
    }
    
    async consumeApprovalRequest(input: {
      tenantId: string;
      requestId: string;
      consumedBy: string;
    }): Promise<ApprovalRequest> {
      return this.transaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM approval_requests
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.requestId],
        );
        if (!rows[0]) notFound("ApprovalRequest", input.requestId);
        const request = this.mapApprovalRequest(rows[0]);
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
        try {
          const { rows: updated } = await client.query(
            `UPDATE approval_requests
                SET consumed_at=now(), consumed_by=$3
              WHERE tenant_id=$1 AND id=$2
              RETURNING *`,
            [input.tenantId, input.requestId, input.consumedBy],
          );
          return this.mapApprovalRequest(updated[0]);
        } catch (error) {
          if ((error as { code?: string }).code === "23503") {
            throw new NotFoundError(`Person ${input.consumedBy} not found`);
          }
          throw error;
        }
      });
    }
  };
}
