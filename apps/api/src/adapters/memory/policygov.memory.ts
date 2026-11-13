/**
 * NPV2-013：制度治理 Adapter（PolicygovPort，方法体逐字平移）。
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
import type { PolicygovPort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryPolicygovMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements PolicygovPort {
    
    async listRepresentations(
      tenantId: string,
    ): Promise<EmployeeRepresentation[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.representations.values()]
        .filter((representation) => representation.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async createConsultation(input: {
      tenantId: string;
      policyVersionId: string;
      representationId?: string;
      consultationType: ConsultationType;
      startedAt: string;
      endedAt?: string;
      minutesRef?: string;
      feedbackSummary?: string;
      outcome: ConsultationOutcome;
    }): Promise<PolicyConsultation> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (input.representationId) {
        const representation = this.representations.get(input.representationId);
        if (
          !representation ||
          representation.tenantId !== input.tenantId
        ) {
          notFound("EmployeeRepresentation", input.representationId);
        }
      }
      if (input.endedAt && input.endedAt < input.startedAt) {
        throw new ConflictError("endedAt must not be before startedAt");
      }
      const consultation: PolicyConsultation = {
        id: randomUUID(),
        tenantId: input.tenantId,
        policyVersionId: input.policyVersionId,
        representationId: input.representationId,
        consultationType: input.consultationType,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        minutesRef: input.minutesRef,
        feedbackSummary: input.feedbackSummary,
        outcome: input.outcome,
        createdAt: now(),
      };
      this.consultations.set(consultation.id, consultation);
      return consultation;
    }
    
    async listConsultations(
      tenantId: string,
      policyVersionId?: string,
    ): Promise<PolicyConsultation[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.consultations.values()]
        .filter(
          (consultation) =>
            consultation.tenantId === tenantId &&
            (!policyVersionId ||
              consultation.policyVersionId === policyVersionId),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }
    
    async getConsultation(
      tenantId: string,
      consultationId: string,
    ): Promise<PolicyConsultation> {
      const consultation = this.consultations.get(consultationId);
      if (!consultation || consultation.tenantId !== tenantId) {
        notFound("PolicyConsultation", consultationId);
      }
      return consultation;
    }
    
    async concludeConsultation(input: {
      tenantId: string;
      consultationId: string;
      endedAt: string;
      outcome: ConsultationOutcome;
      minutesRef?: string;
      feedbackSummary?: string;
    }): Promise<PolicyConsultation> {
      const consultation = await this.getConsultation(
        input.tenantId,
        input.consultationId,
      );
      if (consultation.outcome !== "PENDING") {
        throw new ConflictError(
          `consultation ${consultation.id} is already concluded`,
        );
      }
      if (input.endedAt < consultation.startedAt) {
        throw new ConflictError("endedAt must not be before startedAt");
      }
      consultation.endedAt = input.endedAt;
      consultation.outcome = input.outcome;
      consultation.minutesRef = input.minutesRef ?? consultation.minutesRef;
      consultation.feedbackSummary =
        input.feedbackSummary ?? consultation.feedbackSummary;
      return consultation;
    }
    
    async createRuleChangeOrder(input: {
      tenantId: string;
      policyCode: string;
      fromPolicyVersionId?: string;
      toPolicyVersionId: string;
      changeType: string;
      reason: string;
      impactSimulation: Record<string, unknown>;
      effectiveFrom: string;
      requestedBy: string;
    }): Promise<RuleChangeOrder> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const requester = this.persons.get(input.requestedBy);
      if (!requester || requester.tenantId !== input.tenantId) {
        notFound("Person", input.requestedBy);
      }
      const order: RuleChangeOrder = {
        id: randomUUID(),
        tenantId: input.tenantId,
        policyCode: input.policyCode,
        fromPolicyVersionId: input.fromPolicyVersionId,
        toPolicyVersionId: input.toPolicyVersionId,
        changeType: input.changeType,
        reason: input.reason,
        impactSimulation: input.impactSimulation,
        status: "DRAFT",
        requestedBy: input.requestedBy,
        effectiveFrom: input.effectiveFrom,
        createdAt: now(),
      };
      this.ruleChangeOrders.set(order.id, order);
      return order;
    }
    
    async listRuleChangeOrders(
      tenantId: string,
      filter?: { policyCode?: string; status?: RuleChangeOrder["status"] },
    ): Promise<RuleChangeOrder[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.ruleChangeOrders.values()]
        .filter(
          (order) =>
            order.tenantId === tenantId &&
            (!filter?.policyCode || order.policyCode === filter.policyCode) &&
            (!filter?.status || order.status === filter.status),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async getRuleChangeOrder(
      tenantId: string,
      orderId: string,
    ): Promise<RuleChangeOrder> {
      const order = this.ruleChangeOrders.get(orderId);
      if (!order || order.tenantId !== tenantId) {
        notFound("RuleChangeOrder", orderId);
      }
      return order;
    }
    
    async approveRuleChangeOrder(input: {
      tenantId: string;
      orderId: string;
      approvedBy: string;
    }): Promise<RuleChangeOrder> {
      const order = await this.getRuleChangeOrder(
        input.tenantId,
        input.orderId,
      );
      if (order.status !== "DRAFT") {
        throw new ConflictError(`rule change order ${order.id} is ${order.status}`);
      }
      if (order.requestedBy === input.approvedBy) {
        throw new ConflictError(
          "SEPARATION_OF_DUTIES: the requester cannot approve their own change",
        );
      }
      const approver = this.persons.get(input.approvedBy);
      if (!approver || approver.tenantId !== input.tenantId) {
        notFound("Person", input.approvedBy);
      }
      order.status = "APPROVED";
      order.approvedBy = input.approvedBy;
      order.approvedAt = now();
      return order;
    }
    
    async rejectRuleChangeOrder(input: {
      tenantId: string;
      orderId: string;
      approvedBy: string;
    }): Promise<RuleChangeOrder> {
      const order = await this.getRuleChangeOrder(
        input.tenantId,
        input.orderId,
      );
      if (order.status !== "DRAFT") {
        throw new ConflictError(`rule change order ${order.id} is ${order.status}`);
      }
      if (order.requestedBy === input.approvedBy) {
        throw new ConflictError(
          "SEPARATION_OF_DUTIES: the requester cannot reject their own change",
        );
      }
      order.status = "REJECTED";
      order.approvedBy = input.approvedBy;
      order.approvedAt = now();
      return order;
    }
    
    async publicizeRuleChangeOrder(input: {
      tenantId: string;
      orderId: string;
    }): Promise<RuleChangeOrder> {
      const order = await this.getRuleChangeOrder(
        input.tenantId,
        input.orderId,
      );
      if (order.status !== "APPROVED") {
        throw new ConflictError(`rule change order ${order.id} is ${order.status}`);
      }
      order.status = "PUBLICIZED";
      order.publicizedAt = now();
      return order;
    }
    
    async createPolicyTestCase(input: {
      tenantId: string;
      policyVersionId: string;
      caseCode: string;
      input: Record<string, unknown>;
      expectedOutput: Record<string, unknown>;
      category: PolicyTestCase["category"];
    }): Promise<PolicyTestCase> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (
        [...this.policyTestCases.values()].some(
          (testCase) =>
            testCase.tenantId === input.tenantId &&
            testCase.policyVersionId === input.policyVersionId &&
            testCase.caseCode === input.caseCode,
        )
      ) {
        throw new ConflictError(
          `test case ${input.caseCode} already exists for the policy version`,
        );
      }
      const testCase: PolicyTestCase = {
        id: randomUUID(),
        tenantId: input.tenantId,
        policyVersionId: input.policyVersionId,
        caseCode: input.caseCode,
        input: input.input,
        expectedOutput: input.expectedOutput,
        category: input.category,
        status: "ACTIVE",
        createdAt: now(),
      };
      this.policyTestCases.set(testCase.id, testCase);
      return testCase;
    }
    
    async listPolicyTestCases(
      tenantId: string,
      policyVersionId?: string,
    ): Promise<PolicyTestCase[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.policyTestCases.values()]
        .filter(
          (testCase) =>
            testCase.tenantId === tenantId &&
            (!policyVersionId ||
              testCase.policyVersionId === policyVersionId),
        )
        .sort((a, b) => a.caseCode.localeCompare(b.caseCode));
    }
    
    async getPolicyTestCase(
      tenantId: string,
      testCaseId: string,
    ): Promise<PolicyTestCase> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      const testCase = this.policyTestCases.get(testCaseId);
      if (!testCase || testCase.tenantId !== tenantId) {
        notFound("PolicyTestCase", testCaseId);
      }
      return testCase;
    }
    
    async recordPolicyTestCaseRun(input: {
      tenantId: string;
      testCaseId: string;
      passed: boolean;
      resultHash?: string;
      runAt?: string;
    }): Promise<PolicyTestCase> {
      const testCase = await this.getPolicyTestCase(
        input.tenantId,
        input.testCaseId,
      );
      testCase.lastRunAt = input.runAt ?? new Date().toISOString();
      testCase.lastRunPassed = input.passed;
      testCase.lastRunResultHash = input.resultHash;
      return testCase;
    }
    
    async recordPolicyTestRun(input: {
      tenantId: string;
      policyVersionId: string;
      runAt?: string;
      total: number;
      passedCount: number;
      failedCount: number;
      retiredCount: number;
      passed: boolean;
      resultsHash: string;
      results: PolicyTestRun["results"];
    }): Promise<PolicyTestRun> {
      if (!this.tenants.has(input.tenantId)) {
        notFound("Tenant", input.tenantId);
      }
      const id = randomUUID();
      const run: PolicyTestRun = {
        id,
        runId: id,
        tenantId: input.tenantId,
        policyVersionId: input.policyVersionId,
        runAt: input.runAt ?? new Date().toISOString(),
        total: input.total,
        passedCount: input.passedCount,
        failedCount: input.failedCount,
        retiredCount: input.retiredCount,
        passed: input.passed,
        resultsHash: input.resultsHash,
        results: structuredClone(input.results),
      };
      this.policyTestRuns.set(run.id, run);
      return run;
    }
    
    async listPolicyTestRuns(
      tenantId: string,
      policyVersionId?: string,
      limit = 20,
    ): Promise<PolicyTestRun[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.policyTestRuns.values()]
        .filter(
          (run) =>
            run.tenantId === tenantId &&
            (!policyVersionId ||
              run.policyVersionId === policyVersionId),
        )
        .sort((a, b) => b.runAt.localeCompare(a.runAt))
        .slice(0, limit);
    }
    
    async retirePolicyTestCase(input: {
      tenantId: string;
      testCaseId: string;
    }): Promise<PolicyTestCase> {
      const testCase = this.policyTestCases.get(input.testCaseId);
      if (!testCase || testCase.tenantId !== input.tenantId) {
        notFound("PolicyTestCase", input.testCaseId);
      }
      if (testCase.status !== "ACTIVE") {
        throw new ConflictError(
          `policy test case ${testCase.id} is ${testCase.status}`,
        );
      }
      testCase.status = "RETIRED";
      return testCase;
    }
    
    async createPolicyNotice(input: {
      tenantId: string;
      policyVersionId: string;
      noticeId: string;
      audience: Record<string, unknown>;
    }): Promise<PolicyNotice> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (
        [...this.policyNotices.values()].some(
          (link) =>
            link.tenantId === input.tenantId &&
            link.policyVersionId === input.policyVersionId &&
            link.noticeId === input.noticeId,
        )
      ) {
        throw new ConflictError(
          "policy notice link already exists for this policy version",
        );
      }
      const link: PolicyNotice = {
        id: randomUUID(),
        tenantId: input.tenantId,
        policyVersionId: input.policyVersionId,
        noticeId: input.noticeId,
        audience: input.audience,
        createdAt: now(),
      };
      this.policyNotices.set(link.id, link);
      return link;
    }
    
    async listPolicyNotices(
      tenantId: string,
      policyVersionId?: string,
    ): Promise<PolicyNotice[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.policyNotices.values()]
        .filter(
          (link) =>
            link.tenantId === tenantId &&
            (!policyVersionId ||
              link.policyVersionId === policyVersionId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async savePolicyEngineRecord(input: {
      tenantId: string;
      recordType: string;
      payload: Record<string, unknown>;
      personId?: string;
      period?: string;
      status?: string;
      recordId?: string;
    }): Promise<PolicyEngineRecord> {
      const timestamp = now();
      const existing = input.recordId
        ? this.policyEngineRecords.get(input.recordId)
        : undefined;
      const record: PolicyEngineRecord = existing
        ? {
            ...existing,
            payload: input.payload,
            status: input.status ?? existing.status,
            personId: input.personId ?? existing.personId,
            period: input.period ?? existing.period,
            updatedAt: timestamp,
            version: existing.version + 1,
          }
        : {
            id: input.recordId ?? randomUUID(),
            tenantId: input.tenantId,
            recordType: input.recordType,
            personId: input.personId,
            period: input.period,
            status: input.status ?? "RECORDED",
            payload: input.payload,
            createdAt: timestamp,
            updatedAt: timestamp,
            version: 1,
          };
      this.policyEngineRecords.set(record.id, record);
      return record;
    }
    
    async getPolicyEngineRecord(
      tenantId: string,
      recordId: string,
    ): Promise<PolicyEngineRecord> {
      const record = this.policyEngineRecords.get(recordId);
      if (!record || record.tenantId !== tenantId) {
        notFound("PolicyEngineRecord", recordId);
      }
      return record;
    }
    
    async listPolicyEngineRecords(
      tenantId: string,
      filter?: {
        recordType?: string;
        personId?: string;
        period?: string;
        status?: string;
      },
    ): Promise<PolicyEngineRecord[]> {
      return [...this.policyEngineRecords.values()]
        .filter((record) => record.tenantId === tenantId)
        .filter(
          (record) =>
            (!filter?.recordType || record.recordType === filter.recordType) &&
            (!filter?.personId || record.personId === filter.personId) &&
            (!filter?.period || record.period === filter.period) &&
            (!filter?.status || record.status === filter.status),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }
    
    async updatePolicyEngineRecord(input: {
      tenantId: string;
      recordId: string;
      payload?: Record<string, unknown>;
      status?: string;
      version?: number;
    }): Promise<PolicyEngineRecord> {
      const record = await this.getPolicyEngineRecord(
        input.tenantId,
        input.recordId,
      );
      if (input.version !== undefined && input.version !== record.version) {
        throw new ConflictError(
          `policy record version mismatch: expected ${record.version}`,
        );
      }
      const updated: PolicyEngineRecord = {
        ...record,
        payload: input.payload ?? record.payload,
        status: input.status ?? record.status,
        updatedAt: now(),
        version: record.version + 1,
      };
      this.policyEngineRecords.set(updated.id, updated);
      return updated;
    }
  };
}
