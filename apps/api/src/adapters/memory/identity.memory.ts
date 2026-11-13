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
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryIdentityMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements IdentityPort {
    
    async createUser(input: {
      authSubject: string;
      displayName: string;
      email?: string;
    }): Promise<PlatformUser> {
      if (
        [...this.users.values()].some(
          (user) => user.authSubject === input.authSubject,
        )
      ) {
        throw new ConflictError(`auth subject ${input.authSubject} exists`);
      }
      const user: PlatformUser = {
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        authSubject: input.authSubject,
        status: "ACTIVE",
        createdAt: now(),
      };
      this.users.set(user.id, user);
      return user;
    }
    
    async listUsers(): Promise<PlatformUser[]> {
      return [...this.users.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    }
    
    async addMembership(input: {
      tenantId: string;
      userId: string;
      roleCodes: string[];
    }): Promise<PlatformMembership> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (!this.users.has(input.userId)) notFound("User", input.userId);
      const key = `${input.tenantId}:${input.userId}`;
      const existing = [...this.memberships.values()].find(
        (membership) =>
          membership.tenantId === input.tenantId &&
          membership.userId === input.userId,
      );
      const membership: PlatformMembership = existing ?? {
        id: randomUUID(),
        tenantId: input.tenantId,
        userId: input.userId,
        status: "ACTIVE",
        roleCodes: input.roleCodes,
        joinedAt: now(),
        createdAt: now(),
      };
      membership.roleCodes = input.roleCodes;
      membership.status = "ACTIVE";
      membership.joinedAt = membership.joinedAt ?? now();
      this.memberships.set(key, membership);
      return membership;
    }
    
    async listMemberships(tenantId: string): Promise<PlatformMembership[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.memberships.values()]
        .filter((membership) => membership.tenantId === tenantId)
        .map((membership) => {
          const user = this.users.get(membership.userId);
          return {
            ...membership,
            userDisplayName: user?.displayName,
            userEmail: user?.email,
          };
        });
    }
    
    async findUserByAuthSubject(authSubject: string): Promise<PlatformUser | null> {
      return (
        [...this.users.values()].find(
          (user) => user.authSubject === authSubject,
        ) ?? null
      );
    }
    
    async listMembershipsByUser(userId: string): Promise<PlatformMembership[]> {
      return [...this.memberships.values()]
        .filter((membership) => membership.userId === userId)
        .sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? ""));
    }
    
    async setUserPassword(userId: string, passwordHash: string): Promise<void> {
      const user = this.users.get(userId);
      if (!user) notFound("User", userId);
      this.userPasswordHashes.set(userId, passwordHash);
    }
    
    async getUserPasswordHash(userId: string): Promise<string | null> {
      return this.userPasswordHashes.get(userId) ?? null;
    }
    
    async getUserPasswordHashByEmail(
      email: string,
    ): Promise<{ userId: string; passwordHash: string | null } | null> {
      const normalized = email.trim().toLowerCase();
      const user = [...this.users.values()].find(
        (candidate) =>
          (candidate.email ?? "").toLowerCase() === normalized ||
          candidate.authSubject.toLowerCase() === normalized,
      );
      if (!user) return null;
      return {
        userId: user.id,
        passwordHash: this.userPasswordHashes.get(user.id) ?? null,
      };
    }
    
    async resolveIdentity(input: {
      tenantId: string;
      userId: string;
      personId?: string;
    }): Promise<PlatformIdentity> {
      const person =
        [...this.persons.values()].find(
          (candidate) =>
            candidate.tenantId === input.tenantId &&
            (input.personId
              ? candidate.id === input.personId
              : candidate.userId === input.userId),
        ) ??
        [...this.persons.values()].find(
          (candidate) =>
            candidate.tenantId === input.tenantId &&
            candidate.userId === input.userId,
        );
      const membership = [...this.memberships.values()].find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.userId === input.userId,
      );
      const user = this.users.get(input.userId);
      const tenant = this.tenants.get(input.tenantId);
      return {
        userId: input.userId,
        personId: person?.id,
        roles: membership?.roleCodes ?? [],
        displayName: person?.displayName ?? user?.displayName ?? user?.email,
        tenantName: tenant?.name,
      };
    }
  };
}
