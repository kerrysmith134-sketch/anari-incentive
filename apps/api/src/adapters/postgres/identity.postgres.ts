/**
 * NPV2-013：身份域（用户/密码/身份解析） Adapter（IdentityPort，方法体逐字平移）。
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
import type { IdentityPort } from "../../store-ports.js";
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgIdentityMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements IdentityPort {
    
    async createUser(input: {
      authSubject: string;
      displayName: string;
      email?: string;
    }): Promise<PlatformUser> {
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO users (id, email, display_name, auth_subject)
           VALUES ($1,$2,$3,$4)
           RETURNING *`,
          [randomUUID(), input.email ?? null, input.displayName, input.authSubject],
        );
        return this.mapUser(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `auth subject ${input.authSubject} already exists`,
          );
        }
        throw error;
      }
    }
    
    async findUserByAuthSubject(authSubject: string): Promise<PlatformUser | null> {
      const { rows } = await this.pool.query(
        "SELECT * FROM users WHERE auth_subject=$1",
        [authSubject],
      );
      return rows[0] ? this.mapUser(rows[0]) : null;
    }
    
    async listMembershipsByUser(userId: string): Promise<PlatformMembership[]> {
      const { rows } = await this.pool.query(
        "SELECT * FROM memberships WHERE user_id=$1 AND status='ACTIVE' ORDER BY joined_at",
        [userId],
      );
      return rows.map((row: QueryResultRow) => this.mapMembership(row));
    }
    
    async setUserPassword(userId: string, passwordHash: string): Promise<void> {
      const { rowCount } = await this.pool.query(
        "UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1",
        [userId, passwordHash],
      );
      if (!rowCount) notFound("User", userId);
    }
    
    async getUserPasswordHash(userId: string): Promise<string | null> {
      const { rows } = await this.pool.query(
        "SELECT password_hash FROM users WHERE id=$1",
        [userId],
      );
      return rows[0]?.password_hash ?? null;
    }
    
    async getUserPasswordHashByEmail(
      email: string,
    ): Promise<{ userId: string; passwordHash: string | null } | null> {
      const { rows } = await this.pool.query(
        `SELECT id, password_hash FROM users
          WHERE lower(email) = lower($1) OR lower(auth_subject) = lower($1)
          ORDER BY created_at LIMIT 1`,
        [email.trim()],
      );
      if (!rows[0]) return null;
      return { userId: rows[0].id, passwordHash: rows[0].password_hash ?? null };
    }
    
    async listUsers(): Promise<PlatformUser[]> {
      const { rows } = await this.pool.query(
        "SELECT * FROM users ORDER BY created_at DESC",
      );
      return rows.map((row: QueryResultRow) => this.mapUser(row));
    }
    
    async addMembership(input: {
      tenantId: string;
      userId: string;
      roleCodes: string[];
    }): Promise<PlatformMembership> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO memberships
            (id, tenant_id, user_id, status, role_codes, joined_at)
           VALUES ($1,$2,$3,'ACTIVE',$4,now())
           ON CONFLICT (tenant_id, user_id)
           DO UPDATE SET status='ACTIVE', role_codes=EXCLUDED.role_codes,
                         joined_at=COALESCE(memberships.joined_at, now()),
                         updated_at=now()
           RETURNING *`,
          [randomUUID(), input.tenantId, input.userId, input.roleCodes],
        );
        return this.mapMembership(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError("tenant or user not found");
        }
        throw error;
      }
    }
    
    async listMemberships(tenantId: string): Promise<PlatformMembership[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT m.*, u.display_name AS user_display_name,
                u.email AS user_email
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = $1
          ORDER BY m.created_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapMembership(row));
    }
    
    async resolveIdentity(input: {
      tenantId: string;
      userId: string;
      personId?: string;
    }): Promise<PlatformIdentity> {
      const [{ rows: personRows }, { rows: membershipRows }, { rows: nameRows }] =
        await Promise.all([
          this.tenantQuery(input.tenantId, 
            `SELECT id FROM people
              WHERE tenant_id=$1
                AND ($3::uuid IS NOT NULL AND id = $3
                     OR user_id = $2)
              ORDER BY (id = $3) DESC NULLS LAST, created_at
              LIMIT 1`,
            [input.tenantId, input.userId, input.personId ?? null],
          ),
          this.tenantQuery(input.tenantId, 
            `SELECT role_codes FROM memberships
              WHERE tenant_id=$1 AND user_id=$2`,
            [input.tenantId, input.userId],
          ),
          this.tenantQuery(input.tenantId, 
            `SELECT COALESCE(p.display_name, u.display_name, u.email) AS display_name,
                    t.name AS tenant_name
               FROM users u
               JOIN tenants t ON t.id = $2
              LEFT JOIN people p ON p.tenant_id = $2 AND p.user_id = u.id
              WHERE u.id = $1`,
            [input.userId, input.tenantId],
          ),
        ]);
      return {
        userId: input.userId,
        personId: personRows[0]?.id ?? undefined,
        roles: membershipRows[0]?.role_codes ?? [],
        displayName: nameRows[0]?.display_name ?? undefined,
        tenantName: nameRows[0]?.tenant_name ?? undefined,
      };
    }
  };
}
