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
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryDeliveryMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements DeliveryPort {
    
    async createAppealEvidenceDisclosure(input: {
      tenantId: string;
      appealId: string;
      disclosedBy: string;
      method: AppealEvidenceDisclosure["method"];
      evidenceRefs: string[];
      note?: string;
    }): Promise<AppealEvidenceDisclosure> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const discloser = this.persons.get(input.disclosedBy);
      if (!discloser || discloser.tenantId !== input.tenantId) {
        notFound("Person", input.disclosedBy);
      }
      const disclosure: AppealEvidenceDisclosure = {
        id: randomUUID(),
        tenantId: input.tenantId,
        appealId: input.appealId,
        disclosedBy: input.disclosedBy,
        method: input.method,
        evidenceRefs: [...input.evidenceRefs],
        note: input.note,
        disclosedAt: now(),
        createdAt: now(),
      };
      this.appealEvidenceDisclosures.set(disclosure.id, disclosure);
      return disclosure;
    }
    
    async listAppealEvidenceDisclosures(
      tenantId: string,
      appealId: string,
    ): Promise<AppealEvidenceDisclosure[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.appealEvidenceDisclosures.values()]
        .filter(
          (disclosure) =>
            disclosure.tenantId === tenantId &&
            disclosure.appealId === appealId,
        )
        .sort((a, b) => b.disclosedAt.localeCompare(a.disclosedAt));
    }
    
    async createDeliverable(input: {
      tenantId: string;
      workPackageId: string;
      title: string;
      deliverableType: string;
      ownerPersonId: string;
      dueAt?: string;
    }): Promise<Deliverable> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const owner = this.persons.get(input.ownerPersonId);
      if (!owner || owner.tenantId !== input.tenantId) {
        notFound("Person", input.ownerPersonId);
      }
      const timestamp = now();
      const deliverable: Deliverable = {
        id: randomUUID(),
        tenantId: input.tenantId,
        workPackageId: input.workPackageId,
        title: input.title,
        deliverableType: input.deliverableType,
        ownerPersonId: input.ownerPersonId,
        dueAt: input.dueAt,
        status: "DRAFT",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.deliverables.set(deliverable.id, deliverable);
      return deliverable;
    }
    
    async listDeliverables(
      tenantId: string,
      workPackageId?: string,
    ): Promise<Deliverable[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.deliverables.values()]
        .filter(
          (deliverable) =>
            deliverable.tenantId === tenantId &&
            (!workPackageId ||
              deliverable.workPackageId === workPackageId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async getDeliverable(
      tenantId: string,
      deliverableId: string,
    ): Promise<Deliverable> {
      const deliverable = this.deliverables.get(deliverableId);
      if (!deliverable || deliverable.tenantId !== tenantId) {
        notFound("Deliverable", deliverableId);
      }
      return deliverable;
    }
    
    async submitDeliverable(input: {
      tenantId: string;
      deliverableId: string;
      artifactRef?: string;
      contentHash?: string;
    }): Promise<Deliverable> {
      const deliverable = await this.getDeliverable(
        input.tenantId,
        input.deliverableId,
      );
      if (
        deliverable.status !== "DRAFT" &&
        deliverable.status !== "REJECTED"
      ) {
        throw new ConflictError(
          `deliverable ${deliverable.id} is ${deliverable.status}`,
        );
      }
      if (deliverable.status === "REJECTED") deliverable.version += 1;
      deliverable.status = "SUBMITTED";
      deliverable.submittedAt = now();
      deliverable.updatedAt = deliverable.submittedAt;
      if (input.artifactRef) deliverable.artifactRef = input.artifactRef;
      if (input.contentHash) deliverable.contentHash = input.contentHash;
      return deliverable;
    }
    
    async recordDeliverableAcceptance(input: {
      tenantId: string;
      deliverableId: string;
      decision: Acceptance["decision"];
      reviewerPersonId: string;
      criteriaResults: Record<string, unknown>;
      comments?: string;
    }): Promise<Acceptance> {
      const deliverable = await this.getDeliverable(
        input.tenantId,
        input.deliverableId,
      );
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
      const reviewer = this.persons.get(input.reviewerPersonId);
      if (!reviewer || reviewer.tenantId !== input.tenantId) {
        notFound("Person", input.reviewerPersonId);
      }
      const timestamp = now();
      const acceptance: Acceptance = {
        id: randomUUID(),
        tenantId: input.tenantId,
        deliverableId: deliverable.id,
        decision: input.decision,
        reviewerPersonId: input.reviewerPersonId,
        criteriaResults: input.criteriaResults,
        comments: input.comments,
        decidedAt: timestamp,
        createdAt: timestamp,
      };
      this.acceptances.set(acceptance.id, acceptance);
      deliverable.status =
        input.decision === "REJECT" ? "REJECTED" : "ACCEPTED";
      deliverable.updatedAt = timestamp;
      return acceptance;
    }
    
    async listDeliverableAcceptances(
      tenantId: string,
      deliverableId: string,
    ): Promise<Acceptance[]> {
      await this.getDeliverable(tenantId, deliverableId);
      return [...this.acceptances.values()]
        .filter((acceptance) => acceptance.deliverableId === deliverableId)
        .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
    }
  };
}
