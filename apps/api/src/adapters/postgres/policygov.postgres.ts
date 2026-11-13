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
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgPolicygovMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements PolicygovPort {
    
    async listRepresentations(
      tenantId: string,
    ): Promise<EmployeeRepresentation[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM employee_representations
          WHERE tenant_id=$1
          ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapRepresentation(row));
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
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO policy_consultations
            (id, tenant_id, policy_version_id, representation_id,
             consultation_type, started_at, ended_at, minutes_ref,
             feedback_summary, outcome)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.policyVersionId,
            input.representationId ?? null,
            input.consultationType,
            input.startedAt,
            input.endedAt ?? null,
            input.minutesRef ?? null,
            input.feedbackSummary ?? null,
            input.outcome,
          ],
        );
        return this.mapConsultation(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            "policy version or employee representation not found",
          );
        }
        throw error;
      }
    }
    
    async listConsultations(
      tenantId: string,
      policyVersionId?: string,
    ): Promise<PolicyConsultation[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM policy_consultations WHERE tenant_id=$1";
      if (policyVersionId) {
        params.push(policyVersionId);
        sql += " AND policy_version_id=$2";
      }
      sql += " ORDER BY started_at DESC, created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapConsultation(row));
    }
    
    async getConsultation(
      tenantId: string,
      consultationId: string,
    ): Promise<PolicyConsultation> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM policy_consultations WHERE tenant_id=$1 AND id=$2",
        [tenantId, consultationId],
      );
      if (!rows[0]) notFound("PolicyConsultation", consultationId);
      return this.mapConsultation(rows[0]);
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
      if (
        Date.parse(input.endedAt) < Date.parse(consultation.startedAt)
      ) {
        throw new ConflictError("endedAt must not be before startedAt");
      }
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE policy_consultations
            SET ended_at=$3,
                outcome=$4,
                minutes_ref=COALESCE($5, minutes_ref),
                feedback_summary=COALESCE($6, feedback_summary)
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.consultationId,
          input.endedAt,
          input.outcome,
          input.minutesRef ?? null,
          input.feedbackSummary ?? null,
        ],
      );
      return this.mapConsultation(rows[0]);
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
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO rule_change_orders
            (id, tenant_id, policy_code, from_policy_version_id,
             to_policy_version_id, change_type, reason, impact_simulation,
             effective_from, requested_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.policyCode,
            input.fromPolicyVersionId ?? null,
            input.toPolicyVersionId,
            input.changeType,
            input.reason,
            input.impactSimulation,
            input.effectiveFrom,
            input.requestedBy,
          ],
        );
        return this.mapRuleChangeOrder(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError("policy version or requester not found");
        }
        throw error;
      }
    }
    
    async listRuleChangeOrders(
      tenantId: string,
      filter?: { policyCode?: string; status?: RuleChangeOrder["status"] },
    ): Promise<RuleChangeOrder[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM rule_change_orders WHERE tenant_id=$1";
      if (filter?.policyCode) {
        params.push(filter.policyCode);
        sql += ` AND policy_code=$${params.length}`;
      }
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status=$${params.length}`;
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapRuleChangeOrder(row));
    }
    
    async getRuleChangeOrder(
      tenantId: string,
      orderId: string,
    ): Promise<RuleChangeOrder> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM rule_change_orders WHERE tenant_id=$1 AND id=$2",
        [tenantId, orderId],
      );
      if (!rows[0]) notFound("RuleChangeOrder", orderId);
      return this.mapRuleChangeOrder(rows[0]);
    }
    
    async approveRuleChangeOrder(input: {
      tenantId: string;
      orderId: string;
      approvedBy: string;
    }): Promise<RuleChangeOrder> {
      return this.decideRuleChangeOrder(input, "APPROVED");
    }
    
    async rejectRuleChangeOrder(input: {
      tenantId: string;
      orderId: string;
      approvedBy: string;
    }): Promise<RuleChangeOrder> {
      return this.decideRuleChangeOrder(input, "REJECTED");
    }
    
    async publicizeRuleChangeOrder(input: {
      tenantId: string;
      orderId: string;
    }): Promise<RuleChangeOrder> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM rule_change_orders
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.orderId],
        );
        if (!rows[0]) notFound("RuleChangeOrder", input.orderId);
        const order = this.mapRuleChangeOrder(rows[0]);
        if (order.status !== "APPROVED") {
          throw new ConflictError(
            `rule change order ${order.id} is ${order.status}`,
          );
        }
        const { rows: updated } = await client.query(
          `UPDATE rule_change_orders
              SET status='PUBLICIZED', publicized_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.orderId],
        );
        return this.mapRuleChangeOrder(updated[0]);
      });
    }
    
    async createPolicyTestCase(input: {
      tenantId: string;
      policyVersionId: string;
      caseCode: string;
      input: Record<string, unknown>;
      expectedOutput: Record<string, unknown>;
      category: PolicyTestCase["category"];
    }): Promise<PolicyTestCase> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO policy_test_cases
            (id, tenant_id, policy_version_id, case_code, input,
             expected_output, category)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.policyVersionId,
            input.caseCode,
            input.input,
            input.expectedOutput,
            input.category,
          ],
        );
        return this.mapPolicyTestCase(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `test case ${input.caseCode} already exists for the policy version`,
          );
        }
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Policy version ${input.policyVersionId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listPolicyTestCases(
      tenantId: string,
      policyVersionId?: string,
    ): Promise<PolicyTestCase[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM policy_test_cases WHERE tenant_id=$1";
      if (policyVersionId) {
        params.push(policyVersionId);
        sql += " AND policy_version_id=$2";
      }
      sql += " ORDER BY case_code";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapPolicyTestCase(row));
    }
    
    async getPolicyTestCase(
      tenantId: string,
      testCaseId: string,
    ): Promise<PolicyTestCase> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM policy_test_cases WHERE tenant_id=$1 AND id=$2`,
        [tenantId, testCaseId],
      );
      if (!rows[0]) notFound("PolicyTestCase", testCaseId);
      return this.mapPolicyTestCase(rows[0]);
    }
    
    async recordPolicyTestCaseRun(input: {
      tenantId: string;
      testCaseId: string;
      passed: boolean;
      resultHash?: string;
      runAt?: string;
    }): Promise<PolicyTestCase> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE policy_test_cases
            SET last_run_at=$3, last_run_passed=$4, last_run_result_hash=$5
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.testCaseId,
          input.runAt ?? new Date().toISOString(),
          input.passed,
          input.resultHash ?? null,
        ],
      );
      if (!rows[0]) notFound("PolicyTestCase", input.testCaseId);
      return this.mapPolicyTestCase(rows[0]);
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
      await this.assertTenant(input.tenantId);
      const { rows } = await this.tenantQuery(input.tenantId, 
        `INSERT INTO policy_test_runs
          (id, tenant_id, policy_version_id, run_at, total, passed_count,
           failed_count, retired_count, passed, results_hash, results)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.policyVersionId,
          input.runAt ?? new Date().toISOString(),
          input.total,
          input.passedCount,
          input.failedCount,
          input.retiredCount,
          input.passed,
          input.resultsHash,
          JSON.stringify(input.results),
        ],
      );
      return this.mapPolicyTestRun(rows[0]);
    }
    
    async listPolicyTestRuns(
      tenantId: string,
      policyVersionId?: string,
      limit = 20,
    ): Promise<PolicyTestRun[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM policy_test_runs
          WHERE tenant_id=$1
            AND ($2::uuid IS NULL OR policy_version_id=$2)
          ORDER BY run_at DESC
          LIMIT $3`,
        [tenantId, policyVersionId ?? null, limit],
      );
      return rows.map((row: QueryResultRow) => this.mapPolicyTestRun(row));
    }
    
    async retirePolicyTestCase(input: {
      tenantId: string;
      testCaseId: string;
    }): Promise<PolicyTestCase> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE policy_test_cases SET status='RETIRED'
          WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
          RETURNING *`,
        [input.tenantId, input.testCaseId],
      );
      if (!rows[0]) {
        const { rows: existing } = await this.tenantQuery(input.tenantId, 
          "SELECT * FROM policy_test_cases WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.testCaseId],
        );
        if (!existing[0]) notFound("PolicyTestCase", input.testCaseId);
        throw new ConflictError(
          `policy test case ${input.testCaseId} is ${existing[0].status}`,
        );
      }
      return this.mapPolicyTestCase(rows[0]);
    }
    
    async createPolicyNotice(input: {
      tenantId: string;
      policyVersionId: string;
      noticeId: string;
      audience: Record<string, unknown>;
    }): Promise<PolicyNotice> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO policy_notices
            (id, tenant_id, policy_version_id, notice_id, audience)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.policyVersionId,
            input.noticeId,
            input.audience,
          ],
        );
        return this.mapPolicyNotice(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            "policy notice link already exists for this policy version",
          );
        }
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError("policy version or notice not found");
        }
        throw error;
      }
    }
    
    async listPolicyNotices(
      tenantId: string,
      policyVersionId?: string,
    ): Promise<PolicyNotice[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM policy_notices WHERE tenant_id=$1";
      if (policyVersionId) {
        params.push(policyVersionId);
        sql += " AND policy_version_id=$2";
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapPolicyNotice(row));
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
      await this.assertTenant(input.tenantId);
      if (input.recordId) {
        const existing = await this.getPolicyEngineRecord(
          input.tenantId,
          input.recordId,
        );
        return this.updatePolicyEngineRecord({
          tenantId: input.tenantId,
          recordId: existing.id,
          payload: input.payload,
          status: input.status,
        });
      }
      const { rows } = await this.tenantQuery(input.tenantId, 
        `INSERT INTO policy_engine_records
          (id, tenant_id, record_type, person_id, period, status, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.recordType,
          input.personId ?? null,
          input.period ?? null,
          input.status ?? "RECORDED",
          input.payload,
        ],
      );
      return this.mapPolicyEngineRecord(rows[0]!);
    }
    
    async getPolicyEngineRecord(
      tenantId: string,
      recordId: string,
    ): Promise<PolicyEngineRecord> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM policy_engine_records WHERE tenant_id=$1 AND id=$2",
        [tenantId, recordId],
      );
      if (!rows[0]) notFound("PolicyEngineRecord", recordId);
      return this.mapPolicyEngineRecord(rows[0]!);
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
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM policy_engine_records WHERE tenant_id=$1";
      if (filter?.recordType) {
        params.push(filter.recordType);
        sql += ` AND record_type=$${params.length}`;
      }
      if (filter?.personId) {
        params.push(filter.personId);
        sql += ` AND person_id=$${params.length}`;
      }
      if (filter?.period) {
        params.push(filter.period);
        sql += ` AND period=$${params.length}`;
      }
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status=$${params.length}`;
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapPolicyEngineRecord(row));
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
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE policy_engine_records
            SET payload = COALESCE($3, payload),
                status = COALESCE($4, status),
                version = version + 1,
                updated_at = now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [
          input.tenantId,
          input.recordId,
          input.payload ?? null,
          input.status ?? null,
        ],
      );
      return this.mapPolicyEngineRecord(rows[0]!);
    }
  };
}
