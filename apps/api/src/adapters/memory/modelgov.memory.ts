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
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryModelgovMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
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
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const approver = this.persons.get(input.approvedBy);
      if (!approver || approver.tenantId !== input.tenantId) {
        notFound("Person", input.approvedBy);
      }
      if (!input.egressAllowlist.length) {
        throw new ConflictError("MODEL_PROVIDER_EGRESS_ALLOWLIST_REQUIRED");
      }
      const timestamp = now();
      const existing = [...this.modelProviderPolicies.values()].find(
        (policy) =>
          policy.tenantId === input.tenantId &&
          policy.provider === input.provider,
      );
      if (existing) {
        existing.zeroRetentionConfirmed = input.zeroRetentionConfirmed;
        existing.dpaRef = input.dpaRef;
        existing.inferenceRegion = input.inferenceRegion;
        existing.egressAllowlist = [...input.egressAllowlist];
        existing.approvedBy = input.approvedBy;
        existing.approvedAt = timestamp;
        existing.status = "ACTIVE";
        existing.retiredAt = undefined;
        existing.updatedAt = timestamp;
        return existing;
      }
      const policy: ModelProviderPolicy = {
        id: randomUUID(),
        tenantId: input.tenantId,
        provider: input.provider,
        zeroRetentionConfirmed: input.zeroRetentionConfirmed,
        dpaRef: input.dpaRef,
        inferenceRegion: input.inferenceRegion,
        egressAllowlist: [...input.egressAllowlist],
        approvedBy: input.approvedBy,
        approvedAt: timestamp,
        status: "ACTIVE",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.modelProviderPolicies.set(policy.id, policy);
      return policy;
    }
    
    async listModelProviderPolicies(
      tenantId: string,
    ): Promise<ModelProviderPolicy[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.modelProviderPolicies.values()]
        .filter((policy) => policy.tenantId === tenantId)
        .sort((a, b) => a.provider.localeCompare(b.provider));
    }
    
    async getActiveModelProviderPolicy(
      tenantId: string,
      provider: string,
    ): Promise<ModelProviderPolicy | undefined> {
      return [...this.modelProviderPolicies.values()].find(
        (policy) =>
          policy.tenantId === tenantId &&
          policy.provider === provider &&
          policy.status === "ACTIVE",
      );
    }
    
    async retireModelProviderPolicy(input: {
      tenantId: string;
      policyId: string;
    }): Promise<ModelProviderPolicy> {
      const policy = this.modelProviderPolicies.get(input.policyId);
      if (!policy || policy.tenantId !== input.tenantId) {
        notFound("ModelProviderPolicy", input.policyId);
      }
      if (policy.status === "RETIRED") {
        throw new ConflictError(
          `model provider policy ${policy.id} is already retired`,
        );
      }
      policy.status = "RETIRED";
      policy.retiredAt = now();
      policy.updatedAt = policy.retiredAt;
      return policy;
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
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const owner = this.persons.get(input.ownerPersonId);
      if (!owner || owner.tenantId !== input.tenantId) {
        notFound("Person", input.ownerPersonId);
      }
      if (input.holdoutSize >= input.sampleSize) {
        throw new ConflictError(
          "GOLD_SET_HOLDOUT_TOO_LARGE: holdout must be smaller than sample",
        );
      }
      if (
        [...this.modelEvaluationDatasets.values()].some(
          (dataset) =>
            dataset.tenantId === input.tenantId &&
            dataset.code === input.code &&
            dataset.version === input.version,
        )
      ) {
        throw new ConflictError(
          `gold set ${input.code}@v${input.version} already exists`,
        );
      }
      const timestamp = now();
      const dataset: ModelEvaluationDataset = {
        id: randomUUID(),
        tenantId: input.tenantId,
        code: input.code,
        version: input.version,
        name: input.name,
        sampleSize: input.sampleSize,
        holdoutSize: input.holdoutSize,
        labelSource: input.labelSource,
        ownerPersonId: input.ownerPersonId,
        status: "ACTIVE",
        refreshedAt: input.refreshedAt ?? timestamp,
        nextRefreshDueAt: input.nextRefreshDueAt,
        contentHash: input.contentHash,
        samples: input.samples,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.modelEvaluationDatasets.set(dataset.id, dataset);
      return dataset;
    }
    
    async listModelEvaluationDatasets(
      tenantId: string,
    ): Promise<ModelEvaluationDataset[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.modelEvaluationDatasets.values()]
        .filter((dataset) => dataset.tenantId === tenantId)
        .sort((a, b) => b.refreshedAt.localeCompare(a.refreshedAt));
    }
    
    async getActiveModelEvaluationDataset(
      tenantId: string,
      code: string,
    ): Promise<ModelEvaluationDataset | undefined> {
      return [...this.modelEvaluationDatasets.values()]
        .filter(
          (dataset) =>
            dataset.tenantId === tenantId &&
            dataset.code === code &&
            dataset.status === "ACTIVE",
        )
        .sort((a, b) => b.version - a.version)[0];
    }
    
    async retireModelEvaluationDataset(input: {
      tenantId: string;
      datasetId: string;
    }): Promise<ModelEvaluationDataset> {
      const dataset = this.modelEvaluationDatasets.get(input.datasetId);
      if (!dataset || dataset.tenantId !== input.tenantId) {
        notFound("ModelEvaluationDataset", input.datasetId);
      }
      if (dataset.status === "RETIRED") {
        throw new ConflictError(
          `model evaluation dataset ${dataset.id} is already retired`,
        );
      }
      dataset.status = "RETIRED";
      dataset.retiredAt = now();
      dataset.updatedAt = dataset.retiredAt;
      return dataset;
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
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const canary: ModelCanaryRun = {
        id: randomUUID(),
        tenantId: input.tenantId,
        baselineEvaluationRunId: input.baselineEvaluationRunId,
        candidateEvaluationRunId: input.candidateEvaluationRunId,
        datasetRef: input.datasetRef,
        trafficPercent: input.trafficPercent,
        passed: input.passed,
        blockers: [...input.blockers],
        metrics: structuredClone(input.metrics),
        createdAt: now(),
      };
      this.modelCanaryRuns.set(canary.id, canary);
      return canary;
    }
    
    async listModelCanaryRuns(tenantId: string): Promise<ModelCanaryRun[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.modelCanaryRuns.values()]
        .filter((canary) => canary.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const creator = this.persons.get(input.createdBy);
      if (!creator || creator.tenantId !== input.tenantId) {
        notFound("Person", input.createdBy);
      }
      if (!input.passed && input.findings.length === 0) {
        throw new ConflictError(
          "RED_TEAM_FINDINGS_REQUIRED: a failed run must list findings",
        );
      }
      const run: ModelRedTeamRun = {
        id: randomUUID(),
        tenantId: input.tenantId,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        promptVersion: input.promptVersion,
        scope: input.scope,
        testsRun: input.testsRun,
        passed: input.passed,
        findings: [...input.findings],
        artifactRef: input.artifactRef,
        createdBy: input.createdBy,
        createdAt: now(),
      };
      this.modelRedTeamRuns.set(run.id, run);
      return run;
    }
    
    async listModelRedTeamRuns(tenantId: string): Promise<ModelRedTeamRun[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.modelRedTeamRuns.values()]
        .filter((run) => run.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async findPassedModelRedTeamRun(
      tenantId: string,
      modelProvider: string,
      modelName: string,
      promptVersion: string,
    ): Promise<ModelRedTeamRun | undefined> {
      return [...this.modelRedTeamRuns.values()].find(
        (run) =>
          run.tenantId === tenantId &&
          run.modelProvider === modelProvider &&
          run.modelName === modelName &&
          run.promptVersion === promptVersion &&
          run.passed,
      );
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
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const suggestion: AiSuggestionLog = {
        id: randomUUID(),
        tenantId: input.tenantId,
        agentTaskId: input.agentTaskId,
        targetType: input.targetType,
        targetId: input.targetId,
        suggestionType: input.suggestionType,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        modelPromptId: input.modelPromptId,
        promptVersion: input.promptVersion,
        inputHash: input.inputHash,
        outputJson: input.outputJson,
        validationStatus: input.validationStatus,
        createdAt: now(),
      };
      this.aiSuggestions.set(suggestion.id, suggestion);
      return suggestion;
    }
    
    async listAiSuggestions(
      tenantId: string,
      filter?: { agentTaskId?: string; targetType?: string },
    ): Promise<AiSuggestionLog[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.aiSuggestions.values()]
        .filter(
          (suggestion) =>
            suggestion.tenantId === tenantId &&
            (!filter?.agentTaskId ||
              suggestion.agentTaskId === filter.agentTaskId) &&
            (!filter?.targetType ||
              suggestion.targetType === filter.targetType),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async acceptAiSuggestion(input: {
      tenantId: string;
      suggestionId: string;
      acceptedBy: string;
    }): Promise<AiSuggestionLog> {
      const suggestion = this.aiSuggestions.get(input.suggestionId);
      if (!suggestion || suggestion.tenantId !== input.tenantId) {
        notFound("AiSuggestionLog", input.suggestionId);
      }
      if (suggestion.acceptedAt) {
        throw new ConflictError(
          `AI suggestion ${suggestion.id} was already accepted`,
        );
      }
      const person = this.persons.get(input.acceptedBy);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.acceptedBy);
      }
      suggestion.acceptedBy = input.acceptedBy;
      suggestion.acceptedAt = now();
      return suggestion;
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
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const timestamp = now();
      const run: ModelEvaluationRun = {
        id: randomUUID(),
        tenantId: input.tenantId,
        evaluationType: input.evaluationType,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        promptVersion: input.promptVersion,
        datasetRef: input.datasetRef,
        sampleSize: input.sampleSize,
        metrics: input.metrics,
        subgroupMetrics: input.subgroupMetrics,
        passed: input.passed,
        blockers: input.blockers,
        evaluatedAt: timestamp,
        createdAt: timestamp,
      };
      this.modelEvaluationRuns.set(run.id, run);
      return run;
    }
    
    async listModelEvaluationRuns(
      tenantId: string,
      filter?: { evaluationType?: string; passed?: boolean },
    ): Promise<ModelEvaluationRun[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.modelEvaluationRuns.values()]
        .filter(
          (run) =>
            run.tenantId === tenantId &&
            (!filter?.evaluationType ||
              run.evaluationType === filter.evaluationType) &&
            (filter?.passed === undefined || run.passed === filter.passed),
        )
        .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt));
    }
    
    async getModelEvaluationRun(
      tenantId: string,
      runId: string,
    ): Promise<ModelEvaluationRun> {
      const run = this.modelEvaluationRuns.get(runId);
      if (!run || run.tenantId !== tenantId) {
        notFound("ModelEvaluationRun", runId);
      }
      return run;
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
      if (!this.tenants.has(input.tenantId)) {
        notFound("Tenant", input.tenantId);
      }
      const existing = [...this.modelPrompts.values()].find(
        (prompt) =>
          prompt.tenantId === input.tenantId &&
          prompt.promptCode === input.promptCode &&
          prompt.version === input.version,
      );
      if (existing) {
        throw new ConflictError(
          `Model prompt ${input.promptCode}:${input.version} already exists`,
        );
      }
      const prompt: ModelPrompt = {
        id: randomUUID(),
        tenantId: input.tenantId,
        promptCode: input.promptCode,
        version: input.version,
        purpose: input.purpose,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        template: input.template,
        templateHash: sha256({ template: input.template }),
        status: "DRAFT",
        createdAt: now(),
      };
      this.modelPrompts.set(prompt.id, prompt);
      return prompt;
    }
    
    async listModelPrompts(
      tenantId: string,
      filter?: { promptCode?: string; status?: ModelPrompt["status"] },
    ): Promise<ModelPrompt[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.modelPrompts.values()]
        .filter(
          (prompt) =>
            prompt.tenantId === tenantId &&
            (!filter?.promptCode ||
              prompt.promptCode === filter.promptCode) &&
            (!filter?.status || prompt.status === filter.status),
        )
        .sort(
          (a, b) =>
            a.promptCode.localeCompare(b.promptCode) || b.version - a.version,
        );
    }
    
    async getModelPrompt(
      tenantId: string,
      promptId: string,
    ): Promise<ModelPrompt> {
      const prompt = this.modelPrompts.get(promptId);
      if (!prompt || prompt.tenantId !== tenantId) {
        notFound("ModelPrompt", promptId);
      }
      return prompt;
    }
    
    async activateModelPrompt(input: {
      tenantId: string;
      promptId: string;
      evaluationRunId: string;
    }): Promise<ModelPrompt> {
      const prompt = await this.getModelPrompt(input.tenantId, input.promptId);
      if (prompt.status !== "DRAFT") {
        throw new ConflictError(
          `model prompt ${prompt.id} is ${prompt.status}`,
        );
      }
      const evaluation = await this.getModelEvaluationRun(
        input.tenantId,
        input.evaluationRunId,
      );
      if (!evaluation.passed) {
        throw new ConflictError(
          `MODEL_EVALUATION_NOT_PASSED: ${evaluation.id}`,
        );
      }
      if (
        evaluation.modelProvider !== prompt.modelProvider ||
        evaluation.modelName !== prompt.modelName
      ) {
        throw new ConflictError(
          `MODEL_EVALUATION_MODEL_MISMATCH: ${evaluation.id}`,
        );
      }
      const active = [...this.modelPrompts.values()].find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.promptCode === prompt.promptCode &&
          candidate.status === "ACTIVE" &&
          candidate.id !== prompt.id,
      );
      if (active) {
        throw new ConflictError(
          `MODEL_PROMPT_ALREADY_ACTIVE: ${active.promptCode}:${active.version}`,
        );
      }
      prompt.status = "ACTIVE";
      prompt.evaluationRunId = evaluation.id;
      prompt.activatedAt = now();
      return prompt;
    }
    
    async retireModelPrompt(input: {
      tenantId: string;
      promptId: string;
    }): Promise<ModelPrompt> {
      const prompt = await this.getModelPrompt(input.tenantId, input.promptId);
      if (prompt.status !== "ACTIVE") {
        throw new ConflictError(
          `model prompt ${prompt.id} is ${prompt.status}`,
        );
      }
      prompt.status = "RETIRED";
      prompt.retiredAt = now();
      return prompt;
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
      if (!this.tenants.has(input.tenantId)) {
        notFound("Tenant", input.tenantId);
      }
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      const proposal: AiScoreProposal = {
        id: randomUUID(),
        tenantId: input.tenantId,
        cycleId: input.cycleId,
        personId: input.personId,
        evaluationRunId: input.evaluationRunId,
        modelPromptId: input.modelPromptId,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        promptVersion: input.promptVersion,
        dimensions: [...input.dimensions],
        scores: { ...input.scores },
        overallScore: input.overallScore,
        confidence: input.confidence,
        rationale: input.rationale,
        evidenceRefs: [...input.evidenceRefs],
        evidenceSnapshotHash: input.evidenceSnapshotHash,
        gateMetrics: structuredClone(input.gateMetrics),
        riskTier: input.riskTier ?? "MEDIUM",
        riskReasons: input.riskReasons ? [...input.riskReasons] : undefined,
        riskAssessedAt: input.riskAssessedAt,
        secondReviewRequired:
          input.riskTier === "HIGH" || input.riskTier === "CRITICAL",
        secondReviewDueAt: input.secondReviewDueAt,
        secondReviewSlaBreached: false,
        zeroScoreRationale: input.zeroScoreRationale,
        status: "PENDING",
        requestedBy: input.requestedBy,
        auditSample: false,
        createdAt: now(),
      };
      this.aiScoreProposals.set(proposal.id, proposal);
      return proposal;
    }
    
    async listAiScoreProposals(
      tenantId: string,
      filter?: {
        personId?: string;
        cycleId?: string;
        status?: AiScoreProposal["status"];
      },
    ): Promise<AiScoreProposal[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.aiScoreProposals.values()]
        .filter(
          (proposal) =>
            proposal.tenantId === tenantId &&
            (!filter?.personId || proposal.personId === filter.personId) &&
            (!filter?.cycleId || proposal.cycleId === filter.cycleId) &&
            (!filter?.status || proposal.status === filter.status),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async getAiScoreProposal(
      tenantId: string,
      proposalId: string,
    ): Promise<AiScoreProposal> {
      const proposal = this.aiScoreProposals.get(proposalId);
      if (!proposal || proposal.tenantId !== tenantId) {
        notFound("AiScoreProposal", proposalId);
      }
      return proposal;
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
      const proposal = await this.getAiScoreProposal(
        input.tenantId,
        input.proposalId,
      );
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
      proposal.status =
        input.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED";
      proposal.decidedBy = input.decidedBy;
      proposal.decidedAt = now();
      proposal.decisionNote = input.note;
      proposal.independentScores = input.independentScores;
      proposal.independentRationale = input.independentRationale;
      proposal.reviewStartedAt = input.reviewStartedAt;
      proposal.reviewDurationSeconds = input.reviewDurationSeconds;
      proposal.evidenceOpened = input.evidenceOpened;
      proposal.override = input.override;
      proposal.overrideReason = input.overrideReason;
      proposal.blindReview = input.blindReview;
      if (input.secondReviewerPersonId) {
        proposal.secondReviewerPersonId = input.secondReviewerPersonId;
        proposal.secondIndependentScores = input.secondIndependentScores;
        proposal.secondIndependentRationale =
          input.secondIndependentRationale;
        proposal.secondReviewStartedAt = input.secondReviewStartedAt;
        proposal.secondReviewCompletedAt = now();
        proposal.secondReviewEvidenceOpened = input.secondEvidenceOpened ?? 0;
        proposal.secondReviewOutcome = input.secondReviewOutcome;
        proposal.secondReviewAgreementRate =
          input.secondReviewAgreementRate;
        proposal.secondReviewSlaBreached = Boolean(
          proposal.secondReviewDueAt &&
            Date.parse(proposal.secondReviewDueAt) < Date.now(),
        );
      }
      proposal.auditSample = input.auditSample;
      proposal.auditSampledAt = input.auditSample ? now() : undefined;
      return proposal;
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
      const proposal = await this.getAiScoreProposal(
        input.tenantId,
        input.proposalId,
      );
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
      proposal.secondReviewerPersonId = input.reviewerPersonId;
      proposal.secondIndependentScores = { ...input.scores };
      proposal.secondIndependentRationale = input.rationale;
      proposal.secondReviewStartedAt = input.reviewStartedAt;
      proposal.secondReviewCompletedAt = now();
      proposal.secondReviewDurationSeconds = input.reviewDurationSeconds;
      proposal.secondReviewEvidenceOpened = input.evidenceOpened;
      proposal.secondReviewOutcome = input.outcome;
      proposal.secondReviewAgreementRate = input.agreementRate;
      return proposal;
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
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      const timestamp = now();
      const run: WorkflowRun = {
        id: randomUUID(),
        tenantId: input.tenantId,
        agentTaskId: input.agentTaskId,
        workflowName: input.workflowName,
        workflowVersion: input.workflowVersion,
        status: input.status,
        currentStep: input.currentStep,
        state: input.state,
        startedAt: input.startedAt ?? timestamp,
        createdAt: timestamp,
      };
      this.workflowRuns.set(run.id, run);
      return run;
    }
    
    async listWorkflowRuns(
      tenantId: string,
      agentTaskId?: string,
    ): Promise<WorkflowRun[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.workflowRuns.values()]
        .filter(
          (run) =>
            run.tenantId === tenantId &&
            (!agentTaskId || run.agentTaskId === agentTaskId),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }
    
    async finishWorkflowRun(input: {
      tenantId: string;
      workflowRunId: string;
      status: string;
      currentStep?: string;
    }): Promise<WorkflowRun> {
      const run = this.workflowRuns.get(input.workflowRunId);
      if (!run || run.tenantId !== input.tenantId) {
        notFound("WorkflowRun", input.workflowRunId);
      }
      if (run.finishedAt) {
        throw new ConflictError(`workflow run ${run.id} is already finished`);
      }
      run.status = input.status;
      run.currentStep = input.currentStep ?? run.currentStep;
      run.finishedAt = now();
      return run;
    }
  };
}
