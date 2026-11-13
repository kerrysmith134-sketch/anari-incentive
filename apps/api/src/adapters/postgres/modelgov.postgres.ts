/**
 * NPV2-013：模型治理 Adapter（ModelgovPort，方法体逐字平移）。
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
import type { ModelgovPort } from "../../store-ports.js";
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

export function PgModelgovMixin(Base: abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape) {
  return class extends Base implements ModelgovPort {
    
    async createModelProviderPolicy(input: {
      tenantId: string;
      provider: string;
      zeroRetentionConfirmed: boolean;
      dpaRef: string;
      inferenceRegion: string;
      egressAllowlist: string[];
      approvedBy: string;
    }): Promise<ModelProviderPolicy> {
      if (!input.egressAllowlist.length) {
        throw new ConflictError("MODEL_PROVIDER_EGRESS_ALLOWLIST_REQUIRED");
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO model_provider_policies
            (id, tenant_id, provider, zero_retention_confirmed, dpa_ref,
             inference_region, egress_allowlist, approved_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
           ON CONFLICT (tenant_id, provider) DO UPDATE SET
             zero_retention_confirmed=EXCLUDED.zero_retention_confirmed,
             dpa_ref=EXCLUDED.dpa_ref,
             inference_region=EXCLUDED.inference_region,
             egress_allowlist=EXCLUDED.egress_allowlist,
             approved_by=EXCLUDED.approved_by,
             approved_at=now(),
             status='ACTIVE',
             retired_at=NULL,
             updated_at=now()
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.provider,
            input.zeroRetentionConfirmed,
            input.dpaRef,
            input.inferenceRegion,
            JSON.stringify(input.egressAllowlist),
            input.approvedBy,
          ],
        );
        return this.mapModelProviderPolicy(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Tenant ${input.tenantId} or approver ${input.approvedBy} not found`,
          );
        }
        throw error;
      }
    }
    
    async listModelProviderPolicies(
      tenantId: string,
    ): Promise<ModelProviderPolicy[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM model_provider_policies
          WHERE tenant_id=$1
          ORDER BY provider`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapModelProviderPolicy(row));
    }
    
    async getActiveModelProviderPolicy(
      tenantId: string,
      provider: string,
    ): Promise<ModelProviderPolicy | undefined> {
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM model_provider_policies
          WHERE tenant_id=$1 AND provider=$2 AND status='ACTIVE'
          LIMIT 1`,
        [tenantId, provider],
      );
      return rows[0] ? this.mapModelProviderPolicy(rows[0]) : undefined;
    }
    
    async retireModelProviderPolicy(input: {
      tenantId: string;
      policyId: string;
    }): Promise<ModelProviderPolicy> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE model_provider_policies
            SET status='RETIRED', retired_at=now(), updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
          RETURNING *`,
        [input.tenantId, input.policyId],
      );
      if (!rows[0]) {
        const current = await this.tenantQuery(input.tenantId, 
          "SELECT status FROM model_provider_policies WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.policyId],
        );
        if (!current.rows[0]) {
          notFound("ModelProviderPolicy", input.policyId);
        }
        throw new ConflictError(
          `model provider policy ${input.policyId} is ${current.rows[0].status}`,
        );
      }
      return this.mapModelProviderPolicy(rows[0]);
    }
    
    async createModelEvaluationDataset(input: {
      tenantId: string;
      code: string;
      version: number;
      name: string;
      sampleSize: number;
      holdoutSize: number;
      labelSource: string;
      ownerPersonId: string;
      refreshedAt?: string;
      nextRefreshDueAt?: string;
      contentHash?: string;
      samples?: ModelEvaluationDataset["samples"];
    }): Promise<ModelEvaluationDataset> {
      if (input.holdoutSize >= input.sampleSize) {
        throw new ConflictError(
          "GOLD_SET_HOLDOUT_TOO_LARGE: holdout must be smaller than sample",
        );
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO model_evaluation_datasets
            (id, tenant_id, code, version, name, sample_size, holdout_size,
             label_source, owner_person_id, refreshed_at,
             next_refresh_due_at, content_hash, samples)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, now()),$11,$12,$13::jsonb)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.code,
            input.version,
            input.name,
            input.sampleSize,
            input.holdoutSize,
            input.labelSource,
            input.ownerPersonId,
            input.refreshedAt ?? null,
            input.nextRefreshDueAt ?? null,
            input.contentHash ?? null,
            JSON.stringify(input.samples ?? []),
          ],
        );
        return this.mapModelEvaluationDataset(rows[0]);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new ConflictError(
            `gold set ${input.code}@v${input.version} already exists`,
          );
        }
        if (code === "23503") {
          throw new NotFoundError(
            `Tenant ${input.tenantId} or owner ${input.ownerPersonId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listModelEvaluationDatasets(
      tenantId: string,
    ): Promise<ModelEvaluationDataset[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM model_evaluation_datasets
          WHERE tenant_id=$1
          ORDER BY refreshed_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapModelEvaluationDataset(row));
    }
    
    async getActiveModelEvaluationDataset(
      tenantId: string,
      code: string,
    ): Promise<ModelEvaluationDataset | undefined> {
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM model_evaluation_datasets
          WHERE tenant_id=$1 AND code=$2 AND status='ACTIVE'
          ORDER BY version DESC
          LIMIT 1`,
        [tenantId, code],
      );
      return rows[0] ? this.mapModelEvaluationDataset(rows[0]) : undefined;
    }
    
    async retireModelEvaluationDataset(input: {
      tenantId: string;
      datasetId: string;
    }): Promise<ModelEvaluationDataset> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE model_evaluation_datasets
            SET status='RETIRED', retired_at=now(), updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
          RETURNING *`,
        [input.tenantId, input.datasetId],
      );
      if (!rows[0]) {
        const current = await this.tenantQuery(input.tenantId, 
          "SELECT status FROM model_evaluation_datasets WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.datasetId],
        );
        if (!current.rows[0]) {
          notFound("ModelEvaluationDataset", input.datasetId);
        }
        throw new ConflictError(
          `model evaluation dataset ${input.datasetId} is ${current.rows[0].status}`,
        );
      }
      return this.mapModelEvaluationDataset(rows[0]);
    }
    
    async createModelCanaryRun(input: {
      tenantId: string;
      baselineEvaluationRunId: string;
      candidateEvaluationRunId: string;
      datasetRef: string;
      trafficPercent: number;
      passed: boolean;
      blockers: string[];
      metrics: Record<string, unknown>;
    }): Promise<ModelCanaryRun> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO model_canary_runs
            (id, tenant_id, baseline_evaluation_run_id,
             candidate_evaluation_run_id, dataset_ref, traffic_percent,
             passed, blockers, metrics)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.baselineEvaluationRunId,
            input.candidateEvaluationRunId,
            input.datasetRef,
            input.trafficPercent,
            input.passed,
            JSON.stringify(input.blockers),
            JSON.stringify(input.metrics),
          ],
        );
        return this.mapModelCanaryRun(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Tenant or evaluation run not found`,
          );
        }
        throw error;
      }
    }
    
    async listModelCanaryRuns(tenantId: string): Promise<ModelCanaryRun[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM model_canary_runs
          WHERE tenant_id=$1
          ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapModelCanaryRun(row));
    }
    
    async createModelRedTeamRun(input: {
      tenantId: string;
      modelProvider: string;
      modelName: string;
      promptVersion: string;
      scope: string;
      testsRun: number;
      passed: boolean;
      findings: string[];
      artifactRef?: string;
      createdBy: string;
    }): Promise<ModelRedTeamRun> {
      if (!input.passed && input.findings.length === 0) {
        throw new ConflictError(
          "RED_TEAM_FINDINGS_REQUIRED: a failed run must list findings",
        );
      }
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO model_red_team_runs
            (id, tenant_id, model_provider, model_name, prompt_version,
             scope, tests_run, passed, findings, artifact_ref, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.modelProvider,
            input.modelName,
            input.promptVersion,
            input.scope,
            input.testsRun,
            input.passed,
            JSON.stringify(input.findings),
            input.artifactRef ?? null,
            input.createdBy,
          ],
        );
        return this.mapModelRedTeamRun(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Tenant ${input.tenantId} or creator ${input.createdBy} not found`,
          );
        }
        throw error;
      }
    }
    
    async listModelRedTeamRuns(
      tenantId: string,
    ): Promise<ModelRedTeamRun[]> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM model_red_team_runs
          WHERE tenant_id=$1
          ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapModelRedTeamRun(row));
    }
    
    async findPassedModelRedTeamRun(
      tenantId: string,
      modelProvider: string,
      modelName: string,
      promptVersion: string,
    ): Promise<ModelRedTeamRun | undefined> {
      const { rows } = await this.tenantQuery(tenantId, 
        `SELECT * FROM model_red_team_runs
          WHERE tenant_id=$1 AND model_provider=$2 AND model_name=$3
            AND prompt_version=$4 AND passed=true
          ORDER BY created_at DESC
          LIMIT 1`,
        [tenantId, modelProvider, modelName, promptVersion],
      );
      return rows[0] ? this.mapModelRedTeamRun(rows[0]) : undefined;
    }
    
    async createAiSuggestion(input: {
      tenantId: string;
      agentTaskId: string;
      targetType: string;
      targetId?: string;
      suggestionType: string;
      modelProvider?: string;
      modelName?: string;
      modelPromptId?: string;
      promptVersion: string;
      inputHash: string;
      outputJson: Record<string, unknown>;
      validationStatus: string;
    }): Promise<AiSuggestionLog> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO ai_suggestion_logs
            (id, tenant_id, agent_task_id, target_type, target_id,
             suggestion_type, model_provider, model_name, model_prompt_id,
             prompt_version, input_hash, output_json, validation_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.agentTaskId,
            input.targetType,
            input.targetId ?? null,
            input.suggestionType,
            input.modelProvider ?? null,
            input.modelName ?? null,
            input.modelPromptId ?? null,
            input.promptVersion,
            input.inputHash,
            input.outputJson,
            input.validationStatus,
          ],
        );
        return this.mapAiSuggestion(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Agent task ${input.agentTaskId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listAiSuggestions(
      tenantId: string,
      filter?: { agentTaskId?: string; targetType?: string },
    ): Promise<AiSuggestionLog[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM ai_suggestion_logs WHERE tenant_id=$1";
      if (filter?.agentTaskId) {
        params.push(filter.agentTaskId);
        sql += ` AND agent_task_id=$${params.length}`;
      }
      if (filter?.targetType) {
        params.push(filter.targetType);
        sql += ` AND target_type=$${params.length}`;
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapAiSuggestion(row));
    }
    
    async acceptAiSuggestion(input: {
      tenantId: string;
      suggestionId: string;
      acceptedBy: string;
    }): Promise<AiSuggestionLog> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `UPDATE ai_suggestion_logs
              SET accepted_by=$3, accepted_at=now()
            WHERE tenant_id=$1 AND id=$2 AND accepted_at IS NULL
            RETURNING *`,
          [input.tenantId, input.suggestionId, input.acceptedBy],
        );
        if (!rows[0]) {
          const { rows: existing } = await this.tenantQuery(input.tenantId, 
            "SELECT * FROM ai_suggestion_logs WHERE tenant_id=$1 AND id=$2",
            [input.tenantId, input.suggestionId],
          );
          if (!existing[0]) notFound("AiSuggestionLog", input.suggestionId);
          throw new ConflictError(
            `AI suggestion ${input.suggestionId} was already accepted`,
          );
        }
        return this.mapAiSuggestion(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Person ${input.acceptedBy} not found`);
        }
        throw error;
      }
    }
    
    async createModelEvaluationRun(input: {
      tenantId: string;
      evaluationType: string;
      modelProvider: string;
      modelName: string;
      promptVersion: string;
      datasetRef: string;
      sampleSize: number;
      metrics: Record<string, unknown>;
      subgroupMetrics: Record<string, unknown>;
      passed: boolean;
      blockers: string[];
    }): Promise<ModelEvaluationRun> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO model_evaluation_runs
            (id, tenant_id, evaluation_type, model_provider, model_name,
             prompt_version, dataset_ref, sample_size, metrics,
             subgroup_metrics, passed, blockers)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.evaluationType,
            input.modelProvider,
            input.modelName,
            input.promptVersion,
            input.datasetRef,
            input.sampleSize,
            input.metrics,
            input.subgroupMetrics,
            input.passed,
            input.blockers,
          ],
        );
        return this.mapModelEvaluationRun(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(`Tenant ${input.tenantId} not found`);
        }
        throw error;
      }
    }
    
    async listModelEvaluationRuns(
      tenantId: string,
      filter?: { evaluationType?: string; passed?: boolean },
    ): Promise<ModelEvaluationRun[]> {
      await this.assertTenant(tenantId);
      const params: Array<string | boolean> = [tenantId];
      let sql = "SELECT * FROM model_evaluation_runs WHERE tenant_id=$1";
      if (filter?.evaluationType) {
        params.push(filter.evaluationType);
        sql += ` AND evaluation_type=$${params.length}`;
      }
      if (filter?.passed !== undefined) {
        params.push(filter.passed);
        sql += ` AND passed=$${params.length}`;
      }
      sql += " ORDER BY evaluated_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapModelEvaluationRun(row));
    }
    
    async getModelEvaluationRun(
      tenantId: string,
      runId: string,
    ): Promise<ModelEvaluationRun> {
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM model_evaluation_runs WHERE tenant_id=$1 AND id=$2",
        [tenantId, runId],
      );
      if (!rows[0]) notFound("ModelEvaluationRun", runId);
      return this.mapModelEvaluationRun(rows[0]);
    }
    
    async createModelPrompt(input: {
      tenantId: string;
      promptCode: string;
      version: number;
      purpose: string;
      modelProvider: string;
      modelName: string;
      template: string;
    }): Promise<ModelPrompt> {
      await this.assertTenant(input.tenantId);
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO model_prompts
            (id, tenant_id, prompt_code, version, purpose, model_provider,
             model_name, template, template_hash, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT')
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.promptCode,
            input.version,
            input.purpose,
            input.modelProvider,
            input.modelName,
            input.template,
            sha256({ template: input.template }),
          ],
        );
        return this.mapModelPrompt(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `Model prompt ${input.promptCode}:${input.version} already exists`,
          );
        }
        throw error;
      }
    }
    
    async listModelPrompts(
      tenantId: string,
      filter?: { promptCode?: string; status?: ModelPrompt["status"] },
    ): Promise<ModelPrompt[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM model_prompts WHERE tenant_id=$1";
      if (filter?.promptCode) {
        params.push(filter.promptCode);
        sql += ` AND prompt_code=$${params.length}`;
      }
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status=$${params.length}`;
      }
      sql += " ORDER BY prompt_code, version DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapModelPrompt(row));
    }
    
    async getModelPrompt(
      tenantId: string,
      promptId: string,
    ): Promise<ModelPrompt> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM model_prompts WHERE tenant_id=$1 AND id=$2",
        [tenantId, promptId],
      );
      if (!rows[0]) notFound("ModelPrompt", promptId);
      return this.mapModelPrompt(rows[0]);
    }
    
    async activateModelPrompt(input: {
      tenantId: string;
      promptId: string;
      evaluationRunId: string;
    }): Promise<ModelPrompt> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM model_prompts
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.promptId],
        );
        if (!rows[0]) notFound("ModelPrompt", input.promptId);
        const prompt = this.mapModelPrompt(rows[0]);
        if (prompt.status !== "DRAFT") {
          throw new ConflictError(
            `model prompt ${prompt.id} is ${prompt.status}`,
          );
        }
        const { rows: evaluations } = await client.query(
          `SELECT id, passed, model_provider, model_name
             FROM model_evaluation_runs
            WHERE tenant_id=$1 AND id=$2`,
          [input.tenantId, input.evaluationRunId],
        );
        if (!evaluations[0]) {
          notFound("ModelEvaluationRun", input.evaluationRunId);
        }
        if (!evaluations[0].passed) {
          throw new ConflictError(
            `MODEL_EVALUATION_NOT_PASSED: ${input.evaluationRunId}`,
          );
        }
        if (
          evaluations[0].model_provider !== prompt.modelProvider ||
          evaluations[0].model_name !== prompt.modelName
        ) {
          throw new ConflictError(
            `MODEL_EVALUATION_MODEL_MISMATCH: ${input.evaluationRunId}`,
          );
        }
        const { rows: active } = await client.query(
          `SELECT id, version FROM model_prompts
            WHERE tenant_id=$1 AND prompt_code=$2 AND status='ACTIVE'
              AND id<>$3`,
          [input.tenantId, prompt.promptCode, prompt.id],
        );
        if (active[0]) {
          throw new ConflictError(
            `MODEL_PROMPT_ALREADY_ACTIVE: ${prompt.promptCode}:${active[0].version}`,
          );
        }
        const { rows: updated } = await client.query(
          `UPDATE model_prompts
              SET status='ACTIVE', evaluation_run_id=$3, activated_at=now()
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [input.tenantId, input.promptId, input.evaluationRunId],
        );
        return this.mapModelPrompt(updated[0]);
      });
    }
    
    async retireModelPrompt(input: {
      tenantId: string;
      promptId: string;
    }): Promise<ModelPrompt> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE model_prompts
            SET status='RETIRED', retired_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'
          RETURNING *`,
        [input.tenantId, input.promptId],
      );
      if (!rows[0]) {
        const prompt = await this.getModelPrompt(
          input.tenantId,
          input.promptId,
        );
        throw new ConflictError(
          `model prompt ${prompt.id} is ${prompt.status}`,
        );
      }
      return this.mapModelPrompt(rows[0]);
    }
    
    async createAiScoreProposal(input: {
      tenantId: string;
      cycleId: string;
      personId: string;
      evaluationRunId: string;
      modelPromptId?: string;
      modelProvider: string;
      modelName: string;
      promptVersion: string;
      dimensions: string[];
      scores: Record<string, number>;
      overallScore: number;
      confidence: number;
      rationale: string;
      evidenceRefs: string[];
      evidenceSnapshotHash: string;
      gateMetrics: Record<string, unknown>;
      riskTier?: AiScoreProposal["riskTier"];
      riskReasons?: string[];
      riskAssessedAt?: string;
      secondReviewDueAt?: string;
      zeroScoreRationale?: string;
      requestedBy?: string;
    }): Promise<AiScoreProposal> {
      await this.assertTenant(input.tenantId);
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO ai_score_proposals
            (id, tenant_id, cycle_id, person_id, evaluation_run_id,
             model_prompt_id, model_provider, model_name, prompt_version,
             dimensions, scores, overall_score, confidence, rationale,
             evidence_refs, evidence_snapshot_hash, gate_metrics, risk_tier,
             risk_reasons, risk_assessed_at, second_review_required,
             second_review_due_at, second_review_sla_breached,
             zero_score_rationale, status, requested_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                   $18,$19::jsonb,$20,$21,$22,false,$23,'PENDING',$24)
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.cycleId,
            input.personId,
            input.evaluationRunId,
            input.modelPromptId ?? null,
            input.modelProvider,
            input.modelName,
            input.promptVersion,
            JSON.stringify(input.dimensions),
            JSON.stringify(input.scores),
            input.overallScore,
            input.confidence,
            input.rationale,
            JSON.stringify(input.evidenceRefs),
            input.evidenceSnapshotHash,
            JSON.stringify(input.gateMetrics),
            input.riskTier ?? "MEDIUM",
            JSON.stringify(input.riskReasons ?? []),
            input.riskAssessedAt ?? null,
            input.riskTier === "HIGH" || input.riskTier === "CRITICAL",
            input.secondReviewDueAt ?? null,
            input.zeroScoreRationale ?? null,
            input.requestedBy ?? null,
          ],
        );
        return this.mapAiScoreProposal(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Person ${input.personId} or evaluation run ${input.evaluationRunId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listAiScoreProposals(
      tenantId: string,
      filter?: {
        personId?: string;
        cycleId?: string;
        status?: AiScoreProposal["status"];
      },
    ): Promise<AiScoreProposal[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM ai_score_proposals WHERE tenant_id=$1";
      if (filter?.personId) {
        params.push(filter.personId);
        sql += ` AND person_id=$${params.length}`;
      }
      if (filter?.cycleId) {
        params.push(filter.cycleId);
        sql += ` AND cycle_id=$${params.length}`;
      }
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND status=$${params.length}`;
      }
      sql += " ORDER BY created_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapAiScoreProposal(row));
    }
    
    async getAiScoreProposal(
      tenantId: string,
      proposalId: string,
    ): Promise<AiScoreProposal> {
      await this.assertTenant(tenantId);
      const { rows } = await this.tenantQuery(tenantId, 
        "SELECT * FROM ai_score_proposals WHERE tenant_id=$1 AND id=$2",
        [tenantId, proposalId],
      );
      if (!rows[0]) notFound("AiScoreProposal", proposalId);
      return this.mapAiScoreProposal(rows[0]);
    }
    
    async decideAiScoreProposal(input: {
      tenantId: string;
      proposalId: string;
      decision: "ACCEPT" | "REJECT";
      decidedBy: string;
      note?: string;
      independentScores: Record<string, number>;
      independentRationale?: string;
      reviewStartedAt: string;
      reviewDurationSeconds: number;
      evidenceOpened: number;
      override: boolean;
      overrideReason?: string;
      blindReview: boolean;
      auditSample: boolean;
      secondReviewerPersonId?: string;
      secondIndependentScores?: Record<string, number>;
      secondIndependentRationale?: string;
      secondReviewStartedAt?: string;
      secondEvidenceOpened?: number;
      secondReviewOutcome?: "AGREE" | "DISAGREE";
      secondReviewAgreementRate?: number;
    }): Promise<AiScoreProposal> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM ai_score_proposals
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.proposalId],
        );
        if (!rows[0]) notFound("AiScoreProposal", input.proposalId);
        const proposal = this.mapAiScoreProposal(rows[0]);
        if (proposal.status !== "PENDING") {
          throw new ConflictError(
            `AI score proposal ${proposal.id} is ${proposal.status}`,
          );
        }
        if (proposal.requestedBy === input.decidedBy) {
          throw new ConflictError(
            "AI_SCORE_SELF_REVIEW: the requester cannot decide the proposal",
          );
        }
        const { rows: updated } = await client.query(
          `UPDATE ai_score_proposals
              SET status=$3, decided_by=$4, decision_note=$5, decided_at=now(),
                  independent_scores=$6::jsonb, independent_rationale=$7,
                  review_started_at=$8, review_duration_seconds=$9,
                  evidence_opened=$10, override=$11, override_reason=$12,
                  blind_review=$13, audit_sample=$14,
                  audit_sampled_at=CASE WHEN $14 THEN now() ELSE audit_sampled_at END,
                  second_reviewer_person_id=$15::uuid,
                  second_independent_scores=$16::jsonb,
                  second_independent_rationale=$17,
                  second_review_started_at=$18,
                  second_review_evidence_opened=$19,
                  second_review_outcome=$20,
                  second_review_agreement_rate=$21,
                  second_review_completed_at=CASE WHEN $15::uuid IS NOT NULL
                    THEN now() ELSE second_review_completed_at END,
                  second_review_sla_breached=CASE
                    WHEN $15::uuid IS NOT NULL
                     AND second_review_due_at IS NOT NULL
                     AND now() > second_review_due_at
                    THEN true ELSE second_review_sla_breached END
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [
            input.tenantId,
            input.proposalId,
            input.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED",
            input.decidedBy,
            input.note ?? null,
            JSON.stringify(input.independentScores),
            input.independentRationale ?? null,
            input.reviewStartedAt,
            input.reviewDurationSeconds,
            input.evidenceOpened,
            input.override,
            input.overrideReason ?? null,
            input.blindReview,
            input.auditSample,
            input.secondReviewerPersonId ?? null,
            input.secondIndependentScores
              ? JSON.stringify(input.secondIndependentScores)
              : null,
            input.secondIndependentRationale ?? null,
            input.secondReviewStartedAt ?? null,
            input.secondEvidenceOpened ?? null,
            input.secondReviewOutcome ?? null,
            input.secondReviewAgreementRate ?? null,
          ],
        );
        return this.mapAiScoreProposal(updated[0]);
      });
    }
    
    async recordAiScoreAuditReview(input: {
      tenantId: string;
      proposalId: string;
      reviewerPersonId: string;
      scores: Record<string, number>;
      rationale: string;
      reviewStartedAt: string;
      reviewDurationSeconds: number;
      evidenceOpened: number;
      outcome: "AGREE" | "DISAGREE";
      agreementRate: number;
    }): Promise<AiScoreProposal> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM ai_score_proposals
            WHERE tenant_id=$1 AND id=$2
            FOR UPDATE`,
          [input.tenantId, input.proposalId],
        );
        if (!rows[0]) notFound("AiScoreProposal", input.proposalId);
        const proposal = this.mapAiScoreProposal(rows[0]);
        if (proposal.status === "PENDING") {
          throw new ConflictError(
            "AI_AUDIT_REQUIRES_DECIDED_PROPOSAL: decide the proposal first",
          );
        }
        if (!proposal.auditSample) {
          throw new ConflictError(
            "AI_AUDIT_NOT_SAMPLED: this proposal is not in the audit sample",
          );
        }
        if (proposal.secondReviewCompletedAt) {
          throw new ConflictError(
            "AI_AUDIT_ALREADY_COMPLETED: second review already recorded",
          );
        }
        if (
          input.reviewerPersonId === proposal.decidedBy ||
          input.reviewerPersonId === proposal.requestedBy
        ) {
          throw new ConflictError(
            "AI_AUDIT_REVIEWER_CONFLICT: reviewer must differ from requester and first reviewer",
          );
        }
        const { rows: updated } = await client.query(
          `UPDATE ai_score_proposals
              SET second_reviewer_person_id=$3,
                  second_independent_scores=$4::jsonb,
                  second_independent_rationale=$5,
                  second_review_started_at=$6,
                  second_review_completed_at=now(),
                  second_review_duration_seconds=$7,
                  second_review_evidence_opened=$8,
                  second_review_outcome=$9,
                  second_review_agreement_rate=$10
            WHERE tenant_id=$1 AND id=$2
            RETURNING *`,
          [
            input.tenantId,
            input.proposalId,
            input.reviewerPersonId,
            JSON.stringify(input.scores),
            input.rationale,
            input.reviewStartedAt,
            input.reviewDurationSeconds,
            input.evidenceOpened,
            input.outcome,
            input.agreementRate,
          ],
        );
        return this.mapAiScoreProposal(updated[0]);
      });
    }
    
    async createWorkflowRun(input: {
      tenantId: string;
      agentTaskId: string;
      workflowName: string;
      workflowVersion: string;
      status: string;
      currentStep?: string;
      state: Record<string, unknown>;
      startedAt?: string;
    }): Promise<WorkflowRun> {
      try {
        const { rows } = await this.tenantQuery(input.tenantId, 
          `INSERT INTO workflow_runs
            (id, tenant_id, agent_task_id, workflow_name, workflow_version,
             status, current_step, state, started_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, now()))
           RETURNING *`,
          [
            randomUUID(),
            input.tenantId,
            input.agentTaskId,
            input.workflowName,
            input.workflowVersion,
            input.status,
            input.currentStep ?? null,
            input.state,
            input.startedAt ?? null,
          ],
        );
        return this.mapWorkflowRun(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new NotFoundError(
            `Agent task ${input.agentTaskId} not found`,
          );
        }
        throw error;
      }
    }
    
    async listWorkflowRuns(
      tenantId: string,
      agentTaskId?: string,
    ): Promise<WorkflowRun[]> {
      await this.assertTenant(tenantId);
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM workflow_runs WHERE tenant_id=$1";
      if (agentTaskId) {
        params.push(agentTaskId);
        sql += " AND agent_task_id=$2";
      }
      sql += " ORDER BY started_at DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapWorkflowRun(row));
    }
    
    async finishWorkflowRun(input: {
      tenantId: string;
      workflowRunId: string;
      status: string;
      currentStep?: string;
    }): Promise<WorkflowRun> {
      const { rows } = await this.tenantQuery(input.tenantId, 
        `UPDATE workflow_runs
            SET status=$3, current_step=COALESCE($4, current_step),
                finished_at=now()
          WHERE tenant_id=$1 AND id=$2 AND finished_at IS NULL
          RETURNING *`,
        [
          input.tenantId,
          input.workflowRunId,
          input.status,
          input.currentStep ?? null,
        ],
      );
      if (!rows[0]) {
        const { rows: existing } = await this.tenantQuery(input.tenantId, 
          "SELECT * FROM workflow_runs WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.workflowRunId],
        );
        if (!existing[0]) notFound("WorkflowRun", input.workflowRunId);
        throw new ConflictError(
          `workflow run ${input.workflowRunId} is already finished`,
        );
      }
      return this.mapWorkflowRun(rows[0]);
    }
  };
}
