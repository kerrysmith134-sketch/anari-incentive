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
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgCommsMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
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
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO employee_notices
            (id, tenant_id, policy_version_id, notice_type, title, body_ref,
             published_at, effective_from, acknowledgement_required)
           VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()),$8,$9)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.policyVersionId ?? null,
            input.noticeType,
            input.title,
            input.bodyRef,
            input.publishedAt ?? null,
            input.effectiveFrom,
            input.acknowledgementRequired,
          ],
        );
        return this.mapNotice(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError("tenant or policy version not found");
        }
        throw error;
      }
    }
    
    async listNotices(tenantId: string): Promise<EmployeeNotice[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM employee_notices
          WHERE tenant_id=$1
          ORDER BY published_at DESC, created_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapNotice(row));
    }
    
    async getNotice(
      tenantId: string,
      noticeId: string,
    ): Promise<EmployeeNotice> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM employee_notices WHERE tenant_id=$1 AND id=$2",
        [tenantId, noticeId],
      );
      if (!rows[0]) notFound("Notice", noticeId);
      return this.mapNotice(rows[0]);
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
      const { rows: personRows } = await this.tenantQuery(input.tenantId, 
        "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.personId],
      );
      if (!personRows[0]) notFound("Person", input.personId);
      const acknowledge = input.decision === "ACKNOWLEDGE";
      const { rows } = await this.tenantQuery(input.tenantId, 
        `INSERT INTO policy_acknowledgements
          (id, tenant_id, notice_id, person_id, acknowledged_at, signature_ref,
           declined_at, decline_reason)
         VALUES ($1,$2,$3,$4,
                 CASE WHEN $5 THEN now() ELSE NULL END,
                 $6,
                 CASE WHEN $5 THEN NULL ELSE now() END,
                 $7)
         ON CONFLICT (tenant_id, notice_id, person_id)
         DO UPDATE SET acknowledged_at = EXCLUDED.acknowledged_at,
                       signature_ref = EXCLUDED.signature_ref,
                       declined_at = EXCLUDED.declined_at,
                       decline_reason = EXCLUDED.decline_reason
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          notice.id,
          input.personId,
          acknowledge,
          acknowledge ? (input.signatureRef ?? null) : null,
          acknowledge ? null : (input.declineReason ?? null),
        ],
      );
      return this.mapAcknowledgement(rows[0]);
    }
    
    async listAcknowledgements(
      tenantId: string,
      noticeId: string,
    ): Promise<NoticeAcknowledgementOverview> {
      const notice = await this.getNotice(tenantId, noticeId);
      const [{ rows: acknowledgementRows }, { rows: personRows }] =
        await Promise.all([
          this.tenantQuery(tenantId, 
            `SELECT pa.*, p.employment_status AS person_employment_status
               FROM policy_acknowledgements pa
               JOIN people p
                 ON p.tenant_id = pa.tenant_id AND p.id = pa.person_id
              WHERE pa.tenant_id=$1 AND pa.notice_id=$2
              ORDER BY pa.created_at DESC`,
            [tenantId, noticeId],
          ),
          this.tenantQuery(tenantId, 
            `SELECT count(*)::int AS count FROM people
              WHERE tenant_id=$1 AND employment_status='ACTIVE'`,
            [tenantId],
          ),
        ]);
      const acknowledgements = acknowledgementRows.map((row) =>
        this.mapAcknowledgement(row),
      );
      const activePersons = Number(personRows[0]?.count ?? 0);
      const activeAcknowledgements = acknowledgementRows.filter(
        (row) => row.person_employment_status === "ACTIVE",
      );
      const acknowledgedCount = activeAcknowledgements.filter(
        (row) => row.acknowledged_at,
      ).length;
      const declinedCount = activeAcknowledgements.filter(
        (row) => row.declined_at,
      ).length;
      return {
        summary: {
          noticeId: notice.id,
          acknowledgementRequired: notice.acknowledgementRequired,
          personCount: activePersons,
          acknowledgedCount,
          declinedCount,
          pendingCount: Math.max(
            activePersons - acknowledgedCount - declinedCount,
            0,
          ),
          complete:
            !notice.acknowledgementRequired ||
            (activePersons > 0 && acknowledgedCount >= activePersons),
        },
        acknowledgements,
      };
    }
    
    async receiveInboxMessage(input: {
      tenantId: string;
      consumerName: string;
      messageId: string;
    }): Promise<InboxMessage> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO inbox_messages (id, tenant_id, consumer_name, message_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, consumer_name, message_id) DO NOTHING
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.consumerName,
            input.messageId,
          ],
        );
        if (rows[0]) return this.mapInboxMessage(rows[0]);
        const { rows: existing } = await this.tenantQuery(input.tenantId, 
          `SELECT * FROM inbox_messages
            WHERE tenant_id=$1 AND consumer_name=$2 AND message_id=$3`,
          [input.tenantId, input.consumerName, input.messageId],
        );
        if (!existing[0]) {
          throw new ConflictError("inbox message could not be recorded");
        }
        return this.mapInboxMessage(existing[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
    }
    
    async listInboxMessages(
      tenantId: string,
      filter?: { consumerName?: string; status?: string },
    ): Promise<InboxMessage[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM inbox_messages WHERE tenant_id=$1";
      if (filter?.consumerName) {
        params.push(filter.consumerName);
        sql += ` AND consumer_name=$${params.length}`;
      }
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status=$${params.length}`;
      }
      sql += " ORDER BY received_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapInboxMessage(row));
    }
    
    async processInboxMessage(input: {
      tenantId: string;
      inboxMessageId: string;
      status: "PROCESSED" | "FAILED" | "IGNORED";
      errorCode?: string;
    }): Promise<InboxMessage> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE inbox_messages
            SET status=$3, error_code=$4, processed_at=now()
          WHERE tenant_id=$1 AND id=$2 AND processed_at IS NULL
          RETURNING *`,
        [
          input.tenantId,
          input.inboxMessageId,
          input.status,
          input.errorCode ?? null,
        ],
      );
      if (!rows[0]) {
        const { rows: existing } = await this.tenantQuery(input.tenantId, 
          "SELECT * FROM inbox_messages WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.inboxMessageId],
        );
        if (!existing[0]) notFound("InboxMessage", input.inboxMessageId);
        throw new ConflictError(
          `inbox message ${input.inboxMessageId} is already processed`,
        );
      }
      return this.mapInboxMessage(rows[0]);
    }
  };
}
