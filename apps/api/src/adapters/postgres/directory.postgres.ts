/**
 * NPV2-013：人员目录 Adapter（DirectoryPort，方法体逐字平移）。
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
import type { DirectoryPort } from "../../store-ports.js";
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgDirectoryMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements DirectoryPort {
    
    async createPerson(input: {
      tenantId: string;
      employeeCode: string;
      displayName: string;
      employmentStatus?: string;
      userId?: string;
    }): Promise<PlatformPerson> {
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO people
            (id, tenant_id, user_id, employee_code, display_name,
             employment_status)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.userId ?? null,
            input.employeeCode,
            input.displayName,
            input.employmentStatus ?? "ACTIVE",
          ],
        );
        return this.mapPerson(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        const constraint = (error as { constraint?: string }).constraint;
        if (code === "23505") {
          if (constraint === "uq_people_tenant_user") {
            throw new ConflictError(
              `user ${input.userId} is already linked to a person in this tenant`,
            );
          }
          throw new ConflictError(
            `employee code ${input.employeeCode} already exists in tenant`,
          );
        }
        if (code === "23503") {
          throw new NotFoundError("tenant or user not found");
        }
        throw error;
      }
    }
    
    async listPersons(tenantId: string): Promise<PlatformPerson[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.pool.query(
        "SELECT * FROM people WHERE tenant_id=$1 ORDER BY created_at DESC",
        [tenantId],
      );
      return rows.map((row) => this.mapPerson(row));
    }
    
    async listOrgAssignments(
      tenantId: string,
      personId?: string,
    ): Promise<PlatformOrgAssignment[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql =
        "SELECT * FROM person_org_assignments WHERE tenant_id=$1";
      if (personId) {
        params.push(personId);
        sql += " AND person_id=$2";
      }
      sql += " ORDER BY valid_from DESC, created_at DESC";
      const { rows } = await this.pool.query(sql, params);
      return rows.map((row) => this.mapOrgAssignment(row));
    }
    
    async listEmploymentContracts(
      tenantId: string,
      personId?: string,
    ): Promise<EmploymentContract[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM employment_contracts WHERE tenant_id=$1";
      if (personId) {
        params.push(personId);
        sql += " AND person_id=$2";
      }
      sql += " ORDER BY start_date DESC";
      const { rows } = await this.pool.query(sql, params);
      return rows.map((row) => this.mapEmploymentContract(row));
    }
  };
}
