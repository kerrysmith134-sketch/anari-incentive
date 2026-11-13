/**
 * NPV2-013：交付与跨域读 Adapter（DeliveryPort，方法体逐字平移）。
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
import type { DeliveryPort } from "../../store-ports.js";
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgDeliveryMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements DeliveryPort {
    
    async createAppealEvidenceDisclosure(input: {
      tenantId: string;
      appealId: string;
      disclosedBy: string;
      method: AppealEvidenceDisclosure["method"];
      evidenceRefs: string[];
      note?: string;
    }): Promise<AppealEvidenceDisclosure> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO appeal_evidence_disclosures
            (id, tenant_id, appeal_id, disclosed_by, method, evidence_refs,
             note)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.appealId,
            input.disclosedBy,
            input.method,
            JSON.stringify(input.evidenceRefs),
            input.note ?? null,
          ],
        );
        return this.mapAppealEvidenceDisclosure(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Appeal ${input.appealId} or discloser ${input.disclosedBy} not found`,
          );
        }
        throw error;
      }
    }
    
    async listAppealEvidenceDisclosures(
      tenantId: string,
      appealId: string,
    ): Promise<AppealEvidenceDisclosure[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM appeal_evidence_disclosures
          WHERE tenant_id=$1 AND appeal_id=$2
          ORDER BY disclosed_at DESC`,
        [tenantId, appealId],
      );
      return rows.map((row: QueryResultRow) => this.mapAppealEvidenceDisclosure(row));
    }
    
    async createDeliverable(input: {
      tenantId: string;
      workPackageId: string;
      title: string;
      deliverableType: string;
      ownerPersonId: string;
      dueAt?: string;
    }): Promise<Deliverable> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO deliverables
            (id, tenant_id, work_package_id, title, deliverable_type,
             owner_person_id, due_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.workPackageId,
            input.title,
            input.deliverableType,
            input.ownerPersonId,
            input.dueAt ?? null,
          ],
        );
        return this.mapDeliverable(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError("work package or owner not found");
        }
        throw error;
      }
    }
    
    async listDeliverables(
      tenantId: string,
      workPackageId?: string,
    ): Promise<Deliverable[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM deliverables WHERE tenant_id=$1";
      if (workPackageId) {
        params.push(workPackageId);
        sql += " AND work_package_id=$2";
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapDeliverable(row));
    }
    
    async getDeliverable(
      tenantId: string,
      deliverableId: string,
    ): Promise<Deliverable> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM deliverables WHERE tenant_id=$1 AND id=$2",
        [tenantId, deliverableId],
      );
      if (!rows[0]) notFound("Deliverable", deliverableId);
      return this.mapDeliverable(rows[0]);
    }
    
    async submitDeliverable(input: {
      tenantId: string;
      deliverableId: string;
      artifactRef?: string;
      contentHash?: string;
    }): Promise<Deliverable> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM deliverables
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.deliverableId],
        );
        if (!rows[0]) notFound("Deliverable", input.deliverableId);
        const deliverable = this.mapDeliverable(rows[0]);
        if (
          deliverable.status !== "DRAFT" &&
          deliverable.status !== "REJECTED"
        ) {
          throw new ConflictError(
            `deliverable ${deliverable.id} is ${deliverable.status}`,
          );
        }
        const version =
          deliverable.status === "REJECTED"
            ? deliverable.version + 1
            : deliverable.version;
        const { rows: updated } = await client.query(
          `UPDATE deliverables
              SET status='SUBMITTED', submitted_at=now(), version=$3,
                  artifact_ref=COALESCE($4, artifact_ref),
                  content_hash=COALESCE($5, content_hash),
                  updated_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [
            input.tenantId,
            input.deliverableId,
            version,
            input.artifactRef ?? null,
            input.contentHash ?? null,
          ],
        );
        return this.mapDeliverable(updated[0]);
      });
    }
    
    async recordDeliverableAcceptance(input: {
      tenantId: string;
      deliverableId: string;
      decision: Acceptance["decision"];
      reviewerPersonId: string;
      criteriaResults: Record<string, unknown>;
      comments?: string;
    }): Promise<Acceptance> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM deliverables
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.deliverableId],
        );
        if (!rows[0]) notFound("Deliverable", input.deliverableId);
        const deliverable = this.mapDeliverable(rows[0]);
        if (deliverable.status !== "SUBMITTED") {
          throw new ConflictError(
            `deliverable ${deliverable.id} is ${deliverable.status}`,
          );
        }
        if (input.reviewerPersonId === deliverable.ownerPersonId) {
          throw new ConflictError(
            "SEPARATION_OF_DUTIES: the deliverable owner cannot accept it",
          );
        }
        try {
          const { rows: acceptances } = await client.query(
            `INSERT INTO acceptances
              (id, tenant_id, deliverable_id, decision, reviewer_person_id,
               criteria_results, comments)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [
              randomUUID(),
              input.tenantId,
              deliverable.id,
              input.decision,
              input.reviewerPersonId,
              input.criteriaResults,
              input.comments ?? null,
            ],
          );
          await client.query(
            `UPDATE deliverables
                SET status=$3, updated_at=now()
              WHERE tenant_id=$1 AND id=$2`,
            [
              input.tenantId,
              deliverable.id,
              input.decision === "REJECT" ? "REJECTED" : "ACCEPTED",
            ],
          );
          return this.mapAcceptance(acceptances[0]);
        } catch (error) {
          if ((error as { code?: string }).code === "23503") {
            throw new NotFoundError(
              `Person ${input.reviewerPersonId} not found`,
            );
          }
          throw error;
        }
      });
    }
    
    async listDeliverableAcceptances(
      tenantId: string,
      deliverableId: string,
    ): Promise<Acceptance[]> {
      await this.getDeliverable(tenantId, deliverableId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM acceptances
          WHERE tenant_id=$1 AND deliverable_id=$2
          ORDER BY decided_at DESC`,
        [tenantId, deliverableId],
      );
      return rows.map((row: QueryResultRow) => this.mapAcceptance(row));
    }
  };
}
