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
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryDirectoryMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements DirectoryPort {
    
    async createPerson(input: {
      tenantId: string;
      employeeCode: string;
      displayName: string;
      employmentStatus?: string;
      userId?: string;
    }): Promise<PlatformPerson> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (input.userId && !this.users.has(input.userId)) {
        notFound("User", input.userId);
      }
      if (
        [...this.persons.values()].some(
          (person) =>
            person.tenantId === input.tenantId &&
            person.employeeCode === input.employeeCode,
        )
      ) {
        throw new ConflictError(
          `employee code ${input.employeeCode} already exists in tenant`,
        );
      }
      if (input.userId) this.assertUserNotLinked(input.tenantId, input.userId);
      const person: PlatformPerson = {
        id: randomUUID(),
        tenantId: input.tenantId,
        userId: input.userId,
        employeeCode: input.employeeCode,
        displayName: input.displayName,
        employmentStatus: input.employmentStatus ?? "ACTIVE",
        createdAt: now(),
      };
      this.persons.set(person.id, person);
      return person;
    }
    
    async listPersons(tenantId: string): Promise<PlatformPerson[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.persons.values()]
        .filter((person) => person.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async listOrgAssignments(
      tenantId: string,
      personId?: string,
    ): Promise<PlatformOrgAssignment[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.orgAssignments.values()]
        .filter(
          (assignment) =>
            assignment.tenantId === tenantId &&
            (!personId || assignment.personId === personId),
        )
        .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
    }
    
    async listEmploymentContracts(
      tenantId: string,
      personId?: string,
    ): Promise<EmploymentContract[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.employmentContracts.values()]
        .filter(
          (contract) =>
            contract.tenantId === tenantId &&
            (!personId || contract.personId === personId),
        )
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
    }
  };
}
