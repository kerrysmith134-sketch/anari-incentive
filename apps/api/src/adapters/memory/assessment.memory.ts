/**
 * NPV2-013：评价与人文 Adapter（AssessmentPort，方法体逐字平移）。
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
import type { AssessmentPort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryAssessmentMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements AssessmentPort {
    
    async createRepresentation(input: {
      tenantId: string;
      bodyName: string;
      bodyType: RepresentationBodyType;
      jurisdiction: string;
    }): Promise<EmployeeRepresentation> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const representation: EmployeeRepresentation = {
        id: randomUUID(),
        tenantId: input.tenantId,
        bodyName: input.bodyName,
        bodyType: input.bodyType,
        jurisdiction: input.jurisdiction,
        active: true,
        createdAt: now(),
      };
      this.representations.set(representation.id, representation);
      return representation;
    }
    
    async createConflictDeclaration(input: {
      tenantId: string;
      personId: string;
      relatedPersonId: string;
      relationshipType: string;
      description: string;
    }): Promise<ConflictDeclaration> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (input.personId === input.relatedPersonId) {
        throw new ConflictError(
          "CONFLICT_SELF_DECLARATION: related person must differ",
        );
      }
      for (const personId of [input.personId, input.relatedPersonId]) {
        const person = this.persons.get(personId);
        if (!person || person.tenantId !== input.tenantId) {
          notFound("Person", personId);
        }
      }
      if (
        [...this.conflictDeclarations.values()].some(
          (declaration) =>
            declaration.tenantId === input.tenantId &&
            declaration.status === "ACTIVE" &&
            ((declaration.personId === input.personId &&
              declaration.relatedPersonId === input.relatedPersonId) ||
              (declaration.personId === input.relatedPersonId &&
                declaration.relatedPersonId === input.personId)),
        )
      ) {
        throw new ConflictError(
          "CONFLICT_DECLARATION_EXISTS: an active declaration already covers this pair",
        );
      }
      const timestamp = now();
      const declaration: ConflictDeclaration = {
        id: randomUUID(),
        tenantId: input.tenantId,
        personId: input.personId,
        relatedPersonId: input.relatedPersonId,
        relationshipType: input.relationshipType,
        description: input.description,
        status: "ACTIVE",
        declaredAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.conflictDeclarations.set(declaration.id, declaration);
      return declaration;
    }
    
    async listConflictDeclarations(
      tenantId: string,
      personId?: string,
    ): Promise<ConflictDeclaration[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.conflictDeclarations.values()]
        .filter(
          (declaration) =>
            declaration.tenantId === tenantId &&
            (!personId ||
              declaration.personId === personId ||
              declaration.relatedPersonId === personId),
        )
        .sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));
    }
    
    async revokeConflictDeclaration(input: {
      tenantId: string;
      declarationId: string;
      reason: string;
    }): Promise<ConflictDeclaration> {
      const declaration = this.conflictDeclarations.get(input.declarationId);
      if (!declaration || declaration.tenantId !== input.tenantId) {
        notFound("ConflictDeclaration", input.declarationId);
      }
      if (declaration.status === "REVOKED") {
        throw new ConflictError(
          `conflict declaration ${declaration.id} is already revoked`,
        );
      }
      declaration.status = "REVOKED";
      declaration.revokedAt = now();
      declaration.revocationReason = input.reason;
      declaration.updatedAt = declaration.revokedAt;
      return declaration;
    }
    
    async findConflictDeclaration(
      tenantId: string,
      personA: string,
      personB: string,
    ): Promise<ConflictDeclaration | undefined> {
      return [...this.conflictDeclarations.values()].find(
        (declaration) =>
          declaration.tenantId === tenantId &&
          declaration.status === "ACTIVE" &&
          ((declaration.personId === personA &&
            declaration.relatedPersonId === personB) ||
            (declaration.personId === personB &&
              declaration.relatedPersonId === personA)),
      );
    }
    
    async createTrustSurvey(input: {
      tenantId: string;
      code: string;
      period: string;
      title: string;
      questions: TrustSurveyQuestion[];
    }): Promise<TrustSurveyRun> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (
        [...this.trustSurveys.values()].some(
          (survey) =>
            survey.tenantId === input.tenantId &&
            survey.code === input.code &&
            survey.period === input.period,
        )
      ) {
        throw new ConflictError(
          `trust survey ${input.code}/${input.period} already exists`,
        );
      }
      const timestamp = now();
      const survey: TrustSurveyRun = {
        id: randomUUID(),
        tenantId: input.tenantId,
        code: input.code,
        period: input.period,
        title: input.title,
        status: "DRAFT",
        anonymous: true,
        questions: input.questions.map((question) => ({ ...question })),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.trustSurveys.set(survey.id, survey);
      return survey;
    }
    
    async listTrustSurveys(tenantId: string): Promise<TrustSurveyRun[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.trustSurveys.values()]
        .filter((survey) => survey.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async getTrustSurvey(
      tenantId: string,
      surveyId: string,
    ): Promise<TrustSurveyRun> {
      const survey = this.trustSurveys.get(surveyId);
      if (!survey || survey.tenantId !== tenantId) {
        notFound("TrustSurvey", surveyId);
      }
      return survey;
    }
    
    async openTrustSurvey(input: {
      tenantId: string;
      surveyId: string;
    }): Promise<TrustSurveyRun> {
      const survey = await this.getTrustSurvey(input.tenantId, input.surveyId);
      if (survey.status !== "DRAFT") {
        throw new ConflictError(`trust survey is ${survey.status}`);
      }
      survey.status = "OPEN";
      survey.openedAt = now();
      survey.updatedAt = survey.openedAt;
      return survey;
    }
    
    async closeTrustSurvey(input: {
      tenantId: string;
      surveyId: string;
    }): Promise<TrustSurveyRun> {
      const survey = await this.getTrustSurvey(input.tenantId, input.surveyId);
      if (survey.status !== "OPEN") {
        throw new ConflictError(`trust survey is ${survey.status}`);
      }
      survey.status = "CLOSED";
      survey.closedAt = now();
      survey.updatedAt = survey.closedAt;
      return survey;
    }
    
    async submitTrustSurveyResponse(input: {
      tenantId: string;
      surveyId: string;
      personId: string;
      scores: Record<string, number>;
    }): Promise<TrustSurveyResponse> {
      const survey = await this.getTrustSurvey(input.tenantId, input.surveyId);
      if (survey.status !== "OPEN") {
        throw new ConflictError(`trust survey is ${survey.status}`);
      }
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      for (const question of survey.questions) {
        const value = input.scores[question.code];
        if (typeof value !== "number" || value < 1 || value > 5) {
          throw new ConflictError(
            `TRUST_SURVEY_SCORE_REQUIRED:${question.code}`,
          );
        }
      }
      const respondentHash = sha256(
        `${input.tenantId}:${input.surveyId}:${input.personId}`,
      );
      if (
        [...this.trustSurveyResponses.values()].some(
          (response) =>
            response.tenantId === input.tenantId &&
            response.surveyId === input.surveyId &&
            response.respondentHash === respondentHash,
        )
      ) {
        throw new ConflictError(
          "TRUST_SURVEY_ALREADY_SUBMITTED: this person already responded",
        );
      }
      const response: TrustSurveyResponse = {
        id: randomUUID(),
        tenantId: input.tenantId,
        surveyId: input.surveyId,
        respondentHash,
        scores: { ...input.scores },
        submittedAt: now(),
      };
      this.trustSurveyResponses.set(response.id, response);
      return response;
    }
    
    async getTrustSurveyReport(
      tenantId: string,
      surveyId: string,
    ): Promise<TrustSurveyReport> {
      const survey = await this.getTrustSurvey(tenantId, surveyId);
      const responses = [...this.trustSurveyResponses.values()].filter(
        (response) =>
          response.tenantId === tenantId && response.surveyId === surveyId,
      );
      const baselineSurvey = [...this.trustSurveys.values()]
        .filter(
          (candidate) =>
            candidate.tenantId === tenantId &&
            candidate.code === survey.code &&
            candidate.id !== survey.id &&
            candidate.status === "CLOSED",
        )
        .sort((a, b) =>
          (b.closedAt ?? b.updatedAt).localeCompare(
            a.closedAt ?? a.updatedAt,
          ),
        )[0];
      if (!baselineSurvey) {
        return aggregateSurveyReport(survey, responses);
      }
      return aggregateSurveyReport(survey, responses, {
        survey: baselineSurvey,
        responses: [...this.trustSurveyResponses.values()].filter(
          (response) =>
            response.tenantId === tenantId &&
            response.surveyId === baselineSurvey.id,
        ),
      });
    }
    
    async createFairnessCommitment(input: {
      tenantId: string;
      statement: string;
      ownerPersonId: string;
      channels: string[];
    }): Promise<FairnessCommitment> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const owner = this.persons.get(input.ownerPersonId);
      if (!owner || owner.tenantId !== input.tenantId) {
        notFound("Person", input.ownerPersonId);
      }
      const existing = [...this.fairnessCommitments.values()].filter(
        (commitment) => commitment.tenantId === input.tenantId,
      );
      for (const commitment of existing) {
        if (commitment.status === "ACTIVE") commitment.status = "SUPERSEDED";
      }
      const version =
        existing.reduce(
          (highest, commitment) => Math.max(highest, commitment.version),
          0,
        ) + 1;
      const commitment: FairnessCommitment = {
        id: randomUUID(),
        tenantId: input.tenantId,
        version,
        statement: input.statement,
        ownerPersonId: input.ownerPersonId,
        channels: [...input.channels],
        status: "ACTIVE",
        publishedAt: now(),
        createdAt: now(),
      };
      this.fairnessCommitments.set(commitment.id, commitment);
      return commitment;
    }
    
    async listFairnessCommitments(
      tenantId: string,
    ): Promise<FairnessCommitment[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.fairnessCommitments.values()]
        .filter((commitment) => commitment.tenantId === tenantId)
        .sort((a, b) => b.version - a.version);
    }
    
    async getActiveFairnessCommitment(
      tenantId: string,
    ): Promise<FairnessCommitment | undefined> {
      return [...this.fairnessCommitments.values()].find(
        (commitment) =>
          commitment.tenantId === tenantId &&
          commitment.status === "ACTIVE",
      );
    }
    
    async createManagerTrainingRecord(input: {
      tenantId: string;
      personId: string;
      trainingCode: string;
      title: string;
      completedAt: string;
      expiresAt?: string;
      evidenceRef?: string;
    }): Promise<ManagerTrainingRecord> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      if (
        input.expiresAt &&
        Date.parse(input.expiresAt) <= Date.parse(input.completedAt)
      ) {
        throw new ConflictError("TRAINING_EXPIRY_BEFORE_COMPLETION");
      }
      const record: ManagerTrainingRecord = {
        id: randomUUID(),
        tenantId: input.tenantId,
        personId: input.personId,
        trainingCode: input.trainingCode,
        title: input.title,
        completedAt: input.completedAt,
        expiresAt: input.expiresAt,
        evidenceRef: input.evidenceRef,
        createdAt: now(),
      };
      this.managerTrainingRecords.set(record.id, record);
      return record;
    }
    
    async listManagerTrainingRecords(
      tenantId: string,
      personId?: string,
    ): Promise<ManagerTrainingRecord[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.managerTrainingRecords.values()]
        .filter(
          (record) =>
            record.tenantId === tenantId &&
            (!personId || record.personId === personId),
        )
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    }
    
    async createCalibrationSession(input: {
      tenantId: string;
      code: string;
      title: string;
      heldAt: string;
      facilitatorPersonId: string;
      attendeePersonIds: string[];
      policyVersionId?: string;
      notes?: string;
    }): Promise<CalibrationSession> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const facilitator = this.persons.get(input.facilitatorPersonId);
      if (!facilitator || facilitator.tenantId !== input.tenantId) {
        notFound("Person", input.facilitatorPersonId);
      }
      for (const attendeeId of input.attendeePersonIds) {
        const attendee = this.persons.get(attendeeId);
        if (!attendee || attendee.tenantId !== input.tenantId) {
          notFound("Person", attendeeId);
        }
      }
      const session: CalibrationSession = {
        id: randomUUID(),
        tenantId: input.tenantId,
        code: input.code,
        title: input.title,
        heldAt: input.heldAt,
        facilitatorPersonId: input.facilitatorPersonId,
        attendeePersonIds: [...input.attendeePersonIds],
        policyVersionId: input.policyVersionId,
        notes: input.notes,
        createdAt: now(),
      };
      this.calibrationSessions.set(session.id, session);
      return session;
    }
    
    async listCalibrationSessions(
      tenantId: string,
    ): Promise<CalibrationSession[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.calibrationSessions.values()]
        .filter((session) => session.tenantId === tenantId)
        .sort((a, b) => b.heldAt.localeCompare(a.heldAt));
    }
    
    async createPilotEnrollment(input: {
      tenantId: string;
      personId: string;
      pilotCode: string;
      scope: string;
      consentSignatureRef: string;
      consentSignedAt?: string;
    }): Promise<PilotEnrollment> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      if (!input.consentSignatureRef.trim()) {
        throw new ConflictError("PILOT_CONSENT_SIGNATURE_REQUIRED");
      }
      if (
        [...this.pilotEnrollments.values()].some(
          (enrollment) =>
            enrollment.tenantId === input.tenantId &&
            enrollment.personId === input.personId &&
            enrollment.pilotCode === input.pilotCode &&
            enrollment.status === "ACTIVE",
        )
      ) {
        throw new ConflictError(
          "PILOT_ENROLLMENT_EXISTS: this person is already enrolled",
        );
      }
      const timestamp = now();
      const enrollment: PilotEnrollment = {
        id: randomUUID(),
        tenantId: input.tenantId,
        personId: input.personId,
        pilotCode: input.pilotCode,
        scope: input.scope,
        consentSignatureRef: input.consentSignatureRef,
        consentSignedAt: input.consentSignedAt ?? timestamp,
        status: "ACTIVE",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.pilotEnrollments.set(enrollment.id, enrollment);
      return enrollment;
    }
    
    async listPilotEnrollments(
      tenantId: string,
      personId?: string,
    ): Promise<PilotEnrollment[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.pilotEnrollments.values()]
        .filter(
          (enrollment) =>
            enrollment.tenantId === tenantId &&
            (!personId || enrollment.personId === personId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async withdrawPilotEnrollment(input: {
      tenantId: string;
      enrollmentId: string;
      reason?: string;
    }): Promise<PilotEnrollment> {
      const enrollment = this.pilotEnrollments.get(input.enrollmentId);
      if (!enrollment || enrollment.tenantId !== input.tenantId) {
        notFound("PilotEnrollment", input.enrollmentId);
      }
      if (enrollment.status === "WITHDRAWN") {
        throw new ConflictError(
          `pilot enrollment ${enrollment.id} is already withdrawn`,
        );
      }
      enrollment.status = "WITHDRAWN";
      enrollment.withdrawnAt = now();
      enrollment.withdrawalReason = input.reason;
      enrollment.updatedAt = enrollment.withdrawnAt;
      return enrollment;
    }
    
    async createMetricDefinition(input: {
      tenantId: string;
      code: string;
      version: number;
      name: string;
      description?: string;
      dataType: string;
      unit?: string;
      aggregationMethod?: string;
      sourceContract: Record<string, unknown>;
      effectiveFrom: string;
      effectiveTo?: string;
    }): Promise<MetricDefinition> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (
        [...this.metricDefinitions.values()].some(
          (metric) =>
            metric.tenantId === input.tenantId &&
            metric.code === input.code &&
            metric.version === input.version,
        )
      ) {
        throw new ConflictError(
          `metric ${input.code} v${input.version} already exists`,
        );
      }
      if (
        input.effectiveTo &&
        input.effectiveTo < input.effectiveFrom
      ) {
        throw new ConflictError(
          "effectiveTo must not be before effectiveFrom",
        );
      }
      const metric: MetricDefinition = {
        id: randomUUID(),
        tenantId: input.tenantId,
        code: input.code,
        version: input.version,
        name: input.name,
        description: input.description,
        dataType: input.dataType,
        unit: input.unit,
        aggregationMethod: input.aggregationMethod,
        sourceContract: input.sourceContract,
        active: true,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        createdAt: now(),
      };
      this.metricDefinitions.set(metric.id, metric);
      return metric;
    }
    
    async listMetricDefinitions(
      tenantId: string,
      filter?: { code?: string; active?: boolean },
    ): Promise<MetricDefinition[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.metricDefinitions.values()]
        .filter(
          (metric) =>
            metric.tenantId === tenantId &&
            (!filter?.code || metric.code === filter.code) &&
            (filter?.active === undefined ||
              metric.active === filter.active),
        )
        .sort(
          (a, b) =>
            a.code.localeCompare(b.code) || b.version - a.version,
        );
    }
    
    async retireMetricDefinition(input: {
      tenantId: string;
      metricId: string;
    }): Promise<MetricDefinition> {
      const metric = this.metricDefinitions.get(input.metricId);
      if (!metric || metric.tenantId !== input.tenantId) {
        notFound("MetricDefinition", input.metricId);
      }
      if (!metric.active) {
        throw new ConflictError(`metric ${metric.id} is already retired`);
      }
      metric.active = false;
      return metric;
    }
  };
}
