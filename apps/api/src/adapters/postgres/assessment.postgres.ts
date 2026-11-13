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
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgAssessmentMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements AssessmentPort {
    
    async createRepresentation(input: {
      tenantId: string;
      bodyName: string;
      bodyType: RepresentationBodyType;
      jurisdiction: string;
    }): Promise<EmployeeRepresentation> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO employee_representations
            (id, tenant_id, body_name, body_type, jurisdiction)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.bodyName,
            input.bodyType,
            input.jurisdiction,
          ],
        );
        return this.mapRepresentation(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
    }
    
    async createConflictDeclaration(input: {
      tenantId: string;
      personId: string;
      relatedPersonId: string;
      relationshipType: string;
      description: string;
    }): Promise<ConflictDeclaration> {
      if (input.personId === input.relatedPersonId) {
        throw new ConflictError(
          "CONFLICT_SELF_DECLARATION: related person must differ",
        );
      }
      const existing = await this.findConflictDeclaration(
        input.tenantId,
        input.personId,
        input.relatedPersonId,
      );
      if (existing) {
        throw new ConflictError(
          "CONFLICT_DECLARATION_EXISTS: an active declaration already covers this pair",
        );
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO conflict_declarations
            (id, tenant_id, person_id, related_person_id, relationship_type,
             description)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.personId,
            input.relatedPersonId,
            input.relationshipType,
            input.description,
          ],
        );
        return this.mapConflictDeclaration(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Tenant, person ${input.personId} or related person ${input.relatedPersonId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listConflictDeclarations(
      tenantId: string,
      personId?: string,
    ): Promise<ConflictDeclaration[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM conflict_declarations WHERE tenant_id=$1";
      if (personId) {
        params.push(personId);
        sql += " AND (person_id=$2 OR related_person_id=$2)";
      }
      sql += " ORDER BY declared_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapConflictDeclaration(row));
    }
    
    async revokeConflictDeclaration(input: {
      tenantId: string;
      declarationId: string;
      reason: string;
    }): Promise<ConflictDeclaration> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE conflict_declarations
            SET status='REVOKED', revoked_at=now(), revocation_reason=$3,
                updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.declarationId, input.reason],
      );
      if (!rows[0]) notFound("ConflictDeclaration", input.declarationId);
      return this.mapConflictDeclaration(rows[0]);
    }
    
    async findConflictDeclaration(
      tenantId: string,
      personA: string,
      personB: string,
    ): Promise<ConflictDeclaration | undefined> {
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM conflict_declarations
          WHERE tenant_id=$1 AND status='ACTIVE'
            AND ((person_id=$2 AND related_person_id=$3)
              OR (person_id=$3 AND related_person_id=$2))
          LIMIT 1`,
        [tenantId, personA, personB],
      );
      return rows[0] ? this.mapConflictDeclaration(rows[0]) : undefined;
    }
    
    async createTrustSurvey(input: {
      tenantId: string;
      code: string;
      period: string;
      title: string;
      questions: TrustSurveyQuestion[];
    }): Promise<TrustSurveyRun> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO trust_survey_runs
            (id, tenant_id, code, period, title, questions)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.code,
            input.period,
            input.title,
            JSON.stringify(input.questions),
          ],
        );
        return this.mapTrustSurvey(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError(
            `trust survey ${input.code}/${input.period} already exists`,
          );
        }
        if (code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
    }
    
    async listTrustSurveys(tenantId: string): Promise<TrustSurveyRun[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM trust_survey_runs
          WHERE tenant_id=$1
          ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapTrustSurvey(row));
    }
    
    async getTrustSurvey(
      tenantId: string,
      surveyId: string,
    ): Promise<TrustSurveyRun> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM trust_survey_runs WHERE tenant_id=$1 AND id=$2",
        [tenantId, surveyId],
      );
      if (!rows[0]) notFound("TrustSurvey", surveyId);
      return this.mapTrustSurvey(rows[0]);
    }
    
    async openTrustSurvey(input: {
      tenantId: string;
      surveyId: string;
    }): Promise<TrustSurveyRun> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE trust_survey_runs
            SET status='OPEN', opened_at=now(), updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='DRAFT'
          RETURNING *`,
        [input.tenantId, input.surveyId],
      );
      if (!rows[0]) {
        const survey = await this.getTrustSurvey(
          input.tenantId,
          input.surveyId,
        );
        throw new ConflictError(`trust survey is ${survey.status}`);
      }
      return this.mapTrustSurvey(rows[0]);
    }
    
    async closeTrustSurvey(input: {
      tenantId: string;
      surveyId: string;
    }): Promise<TrustSurveyRun> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE trust_survey_runs
            SET status='CLOSED', closed_at=now(), updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='OPEN'
          RETURNING *`,
        [input.tenantId, input.surveyId],
      );
      if (!rows[0]) {
        const survey = await this.getTrustSurvey(
          input.tenantId,
          input.surveyId,
        );
        throw new ConflictError(`trust survey is ${survey.status}`);
      }
      return this.mapTrustSurvey(rows[0]);
    }
    
    async submitTrustSurveyResponse(input: {
      tenantId: string;
      surveyId: string;
      personId: string;
      scores: Record<string, number>;
    }): Promise<TrustSurveyResponse> {
      const survey = await this.getTrustSurvey(
        input.tenantId,
        input.surveyId,
      );
      if (survey.status !== "OPEN") {
        throw new ConflictError(`trust survey is ${survey.status}`);
      }
      const person = await this.tenantQuery(input.tenantId, 
        "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.personId],
      );
      if (!person.rows[0]) notFound("Person", input.personId);
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
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO trust_survey_responses
            (id, tenant_id, survey_id, respondent_hash, scores)
           VALUES ($1,$2,$3,$4,$5::jsonb)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.surveyId,
            respondentHash,
            JSON.stringify(input.scores),
          ],
        );
        return this.mapTrustSurveyResponse(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            "TRUST_SURVEY_ALREADY_SUBMITTED: this person already responded",
          );
        }
        throw error;
      }
    }
    
    async getTrustSurveyReport(
      tenantId: string,
      surveyId: string,
    ): Promise<TrustSurveyReport> {
      const survey = await this.getTrustSurvey(tenantId, surveyId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM trust_survey_responses
          WHERE tenant_id=$1 AND survey_id=$2
          ORDER BY submitted_at`,
        [tenantId, surveyId],
      );
      const responses = rows.map((row: QueryResultRow) => this.mapTrustSurveyResponse(row));
      const baselineQuery = await this.tenantQuery(tenantId, 
        `SELECT * FROM trust_survey_runs
          WHERE tenant_id=$1 AND code=$2 AND id<>$3 AND status='CLOSED'
          ORDER BY COALESCE(closed_at, updated_at) DESC
          LIMIT 1`,
        [tenantId, survey.code, surveyId],
      );
      if (!baselineQuery.rows[0]) {
        return aggregateSurveyReport(survey, responses);
      }
      const baselineSurvey = this.mapTrustSurvey(baselineQuery.rows[0]);
      const baselineResponses = await this.tenantQuery(tenantId, 
        `SELECT * FROM trust_survey_responses
          WHERE tenant_id=$1 AND survey_id=$2
          ORDER BY submitted_at`,
        [tenantId, baselineSurvey.id],
      );
      return aggregateSurveyReport(survey, responses, {
        survey: baselineSurvey,
        responses: baselineResponses.rows.map((row) =>
          this.mapTrustSurveyResponse(row),
        ),
      });
    }
    
    async createFairnessCommitment(input: {
      tenantId: string;
      statement: string;
      ownerPersonId: string;
      channels: string[];
    }): Promise<FairnessCommitment> {
      return this.transactionFor(input.tenantId, async (client) => {
        await client.query(
          `UPDATE fairness_commitments
              SET status='SUPERSEDED'
            WHERE tenant_id=$1 AND status='ACTIVE'`,
          [input.tenantId],
        );
        const versionResult = await client.query(
          `SELECT COALESCE(MAX(version),0)+1 AS version
             FROM fairness_commitments
            WHERE tenant_id=$1`,
          [input.tenantId],
        );
        const version = Number(versionResult.rows[0]?.version ?? 1);
        try {
          const { rows } = await client.query(
            `INSERT INTO fairness_commitments
              (id, tenant_id, version, statement, owner_person_id, channels)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb)
             RETURNING *`,
            [
              randomUUID(),
              input.tenantId,
              version,
              input.statement,
              input.ownerPersonId,
              JSON.stringify(input.channels),
            ],
          );
          return this.mapFairnessCommitment(rows[0]);
        } catch (error) {
          if ((error as { code?: string }).code === "23503") {
            throw new NotFoundError(
              `Tenant ${input.tenantId} or owner ${input.ownerPersonId} not found`,
            );
          }
          throw error;
        }
      });
    }
    
    async listFairnessCommitments(
      tenantId: string,
    ): Promise<FairnessCommitment[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM fairness_commitments
          WHERE tenant_id=$1
          ORDER BY version DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapFairnessCommitment(row));
    }
    
    async getActiveFairnessCommitment(
      tenantId: string,
    ): Promise<FairnessCommitment | undefined> {
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM fairness_commitments
          WHERE tenant_id=$1 AND status='ACTIVE'
          ORDER BY version DESC
          LIMIT 1`,
        [tenantId],
      );
      return rows[0] ? this.mapFairnessCommitment(rows[0]) : undefined;
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
      if (
        input.expiresAt &&
        Date.parse(input.expiresAt) <= Date.parse(input.completedAt)
      ) {
        throw new ConflictError("TRAINING_EXPIRY_BEFORE_COMPLETION");
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO manager_training_records
            (id, tenant_id, person_id, training_code, title, completed_at,
             expires_at, evidence_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.personId,
            input.trainingCode,
            input.title,
            input.completedAt,
            input.expiresAt ?? null,
            input.evidenceRef ?? null,
          ],
        );
        return this.mapManagerTrainingRecord(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Tenant ${input.tenantId} or person ${input.personId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listManagerTrainingRecords(
      tenantId: string,
      personId?: string,
    ): Promise<ManagerTrainingRecord[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM manager_training_records WHERE tenant_id=$1";
      if (personId) {
        params.push(personId);
        sql += " AND person_id=$2";
      }
      sql += " ORDER BY completed_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapManagerTrainingRecord(row));
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
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO calibration_sessions
            (id, tenant_id, code, title, held_at, facilitator_person_id,
             attendee_person_ids, policy_version_id, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.code,
            input.title,
            input.heldAt,
            input.facilitatorPersonId,
            JSON.stringify(input.attendeePersonIds),
            input.policyVersionId ?? null,
            input.notes ?? null,
          ],
        );
        return this.mapCalibrationSession(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Tenant ${input.tenantId} or facilitator ${input.facilitatorPersonId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listCalibrationSessions(
      tenantId: string,
    ): Promise<CalibrationSession[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM calibration_sessions
          WHERE tenant_id=$1
          ORDER BY held_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapCalibrationSession(row));
    }
    
    async createPilotEnrollment(input: {
      tenantId: string;
      personId: string;
      pilotCode: string;
      scope: string;
      consentSignatureRef: string;
      consentSignedAt?: string;
    }): Promise<PilotEnrollment> {
      if (!input.consentSignatureRef.trim()) {
        throw new ConflictError("PILOT_CONSENT_SIGNATURE_REQUIRED");
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO pilot_enrollments
            (id, tenant_id, person_id, pilot_code, scope,
             consent_signature_ref, consent_signed_at)
           VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.personId,
            input.pilotCode,
            input.scope,
            input.consentSignatureRef,
            input.consentSignedAt ?? null,
          ],
        );
        return this.mapPilotEnrollment(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError(
            "PILOT_ENROLLMENT_EXISTS: this person is already enrolled",
          );
        }
        if (code === "23503") {
          throw new NotFoundError(
            `Tenant ${input.tenantId} or person ${input.personId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listPilotEnrollments(
      tenantId: string,
      personId?: string,
    ): Promise<PilotEnrollment[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM pilot_enrollments WHERE tenant_id=$1";
      if (personId) {
        params.push(personId);
        sql += " AND person_id=$2";
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapPilotEnrollment(row));
    }
    
    async withdrawPilotEnrollment(input: {
      tenantId: string;
      enrollmentId: string;
      reason?: string;
    }): Promise<PilotEnrollment> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE pilot_enrollments
            SET status='WITHDRAWN', withdrawn_at=now(),
                withdrawal_reason=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
          RETURNING *`,
        [input.tenantId, input.enrollmentId, input.reason ?? null],
      );
      if (!rows[0]) {
        const current = await this.tenantQuery(input.tenantId, 
          "SELECT status FROM pilot_enrollments WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.enrollmentId],
        );
        if (!current.rows[0]) {
          notFound("PilotEnrollment", input.enrollmentId);
        }
        throw new ConflictError(
          `pilot enrollment ${input.enrollmentId} is ${current.rows[0].status}`,
        );
      }
      return this.mapPilotEnrollment(rows[0]);
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
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO metric_definitions
            (id, tenant_id, code, version, name, description, data_type,
             unit, aggregation_method, source_contract, effective_from,
             effective_to)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.code,
            input.version,
            input.name,
            input.description ?? null,
            input.dataType,
            input.unit ?? null,
            input.aggregationMethod ?? null,
            input.sourceContract,
            input.effectiveFrom,
            input.effectiveTo ?? null,
          ],
        );
        return this.mapMetricDefinition(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError(
            `metric ${input.code} v${input.version} already exists`,
          );
        }
        if (code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        if (code === "23514") {
          throw new ConflictError(
            "effectiveTo must not be before effectiveFrom",
          );
        }
        throw error;
      }
    }
    
    async listMetricDefinitions(
      tenantId: string,
      filter?: { code?: string; active?: boolean },
    ): Promise<MetricDefinition[]> {
      await this.assertTenant(tenantId);
      const params: Array<string | boolean> = [tenantId];
      let sql = "SELECT * FROM metric_definitions WHERE tenant_id=$1";
      if (filter?.code) {
        params.push(filter.code);
        sql += ` AND code=$${params.length}`;
      }
      if (filter?.active !== undefined) {
        params.push(filter.active);
        sql += ` AND active=$${params.length}`;
      }
      sql += " ORDER BY code, version DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapMetricDefinition(row));
    }
    
    async retireMetricDefinition(input: {
      tenantId: string;
      metricId: string;
    }): Promise<MetricDefinition> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE metric_definitions SET active=false
          WHERE tenant_id=$1 AND id=$2 AND active=true
          RETURNING *`,
        [input.tenantId, input.metricId],
      );
      if (!rows[0]) {
        const { rows: existing } = await this.tenantQuery(input.tenantId, 
          "SELECT * FROM metric_definitions WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.metricId],
        );
        if (!existing[0]) notFound("MetricDefinition", input.metricId);
        throw new ConflictError(
          `metric ${input.metricId} is already retired`,
        );
      }
      return this.mapMetricDefinition(rows[0]);
    }
  };
}
