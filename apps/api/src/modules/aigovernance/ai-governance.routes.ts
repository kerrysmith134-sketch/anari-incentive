/**
 * AI 保障域路由（模型供应商策略/金标集/评测门禁/红队/评分提案/解释）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError, NotFoundError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  acceptAiSuggestionSchema,
  activateModelPromptSchema,
  assessEvidenceCoverageSchema,
  createAiScoreProposalSchema,
  createAiSuggestionLogSchema,
  createModelCanaryRunSchema,
  createModelEvaluationDatasetSchema,
  createModelEvaluationRunSchema,
  createModelPromptSchema,
  createModelProviderPolicySchema,
  createModelRedTeamRunSchema,
  decideAiScoreProposalSchema,
  goldSetImportSchema,
  modelSummarySchema,
  refreshModelEvaluationDatasetSchema,
  runModelEvaluationSchema,
  submitAiScoreAuditSchema,
} from "@anari/contracts";
import {
  DEFAULT_THRESHOLDS,
  HttpModelScoringProvider,
  ModelProviderError,
  evaluateGate,
  assessEvidenceCoverage,
  assessAiRisk,
  scoreEvidence,
  type EvaluationGate,
} from "@anari/ai-gate";
import { sha256 } from "@anari/policy-dsl";
import {
  data,
  errorBody,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  personFilter,
  isPrivileged,
  ownPersonId,
  isPlatformAdmin,
  policyBody,
  requireString,
  requireActor,
  requireActorRequired,
} from "../../http-helpers.js";

/** 与 app.ts 中的 BadRequestError 同语义（协议层 400）。 */
class BadRequestError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}


/** 评估结果必须由受门控的评测 harness 产出（ai-gate-v1）。 */
function assertHarnessEvaluation(evaluation: {
  metrics: Record<string, unknown>;
}): void {
  if (evaluation.metrics.harnessVersion !== "ai-gate-v1") {
    throw new ConflictError(
      "MODEL_EVALUATION_NOT_HARNESS_VERIFIED: evaluation must be produced by the gated evaluation harness",
    );
  }
}


/** 租户开启 requireRegisteredGoldSet 时，评测必须引用已登记的金标集。 */
async function assertRegisteredGoldSet(
  platformStore: PlatformStore,
  request: FastifyRequest,
  datasetRef: string,
): Promise<void> {
  const tenant = await platformStore.getTenant(tenantOf(request));
  const required = Boolean(
    (tenant.settings as { requireRegisteredGoldSet?: unknown })
      .requireRegisteredGoldSet,
  );
  if (!required) return;
  const dataset = await platformStore.getActiveModelEvaluationDataset(
    tenantOf(request),
    datasetRef,
  );
  if (!dataset) {
    throw new ConflictError(`GOLD_SET_NOT_REGISTERED: ${datasetRef}`);
  }
}


/** 租户开启 requireModelProviderPolicy 时，模型必须有生效的供应商策略。 */
async function assertModelProviderPolicy(
  platformStore: PlatformStore,
  request: FastifyRequest,
  provider: string,
): Promise<void> {
  const tenant = await platformStore.getTenant(tenantOf(request));
  const required = Boolean(
    (tenant.settings as { requireModelProviderPolicy?: unknown })
      .requireModelProviderPolicy,
  );
  if (!required) return;
  const policy = await platformStore.getActiveModelProviderPolicy(
    tenantOf(request),
    provider,
  );
  if (!policy) {
    throw new ConflictError(
      `MODEL_PROVIDER_POLICY_REQUIRED: no active policy for ${provider}`,
    );
  }
  if (!policy.zeroRetentionConfirmed || !policy.dpaRef) {
    throw new ConflictError(
      `MODEL_PROVIDER_POLICY_INCOMPLETE: zero retention and DPA are required for ${provider}`,
    );
  }
  if (policy.egressAllowlist.length === 0) {
    throw new ConflictError(
      `MODEL_PROVIDER_EGRESS_ALLOWLIST_REQUIRED: ${provider}`,
    );
  }
}


/** 租户开启 requireRedTeamRun 时，提示词版本必须先通过红队演练。 */
async function assertRedTeamEvidence(
  platformStore: PlatformStore,
  request: FastifyRequest,
  prompt: { modelProvider: string; modelName: string; version: number },
): Promise<void> {
  const tenant = await platformStore.getTenant(tenantOf(request));
  const required = Boolean(
    (tenant.settings as { requireRedTeamRun?: unknown }).requireRedTeamRun,
  );
  if (!required) return;
  const versions = [`v${prompt.version}`, String(prompt.version)];
  for (const version of versions) {
    const run = await platformStore.findPassedModelRedTeamRun(
      tenantOf(request),
      prompt.modelProvider,
      prompt.modelName,
      version,
    );
    if (run) return;
  }
  throw new ConflictError(
    `RED_TEAM_RUN_REQUIRED: no passed red-team run for ${prompt.modelProvider}/${prompt.modelName} v${prompt.version}`,
  );
}


export function registerAiGovernanceRoutes(deps: {
  platformStore: PlatformStore;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  modelScoring?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    fetchImpl?: typeof fetch;
  };
  fieldPoliciesFor: (
    request: FastifyRequest,
  ) => Promise<Record<string, unknown> | undefined>;
  fieldMatchContextFor: (
    request: FastifyRequest,
    policies: Record<string, unknown> | undefined,
  ) => Promise<unknown>;
  redactResourceFields: (
    record: unknown,
    resourceType: string,
    viewer: {
      personId?: string;
      recordPersonId?: string;
      roles: string[];
      policies?: Record<string, unknown>;
      matchContext?: unknown;
    },
  ) => unknown;
}): FastifyPluginAsync {
  const {
    platformStore,
    storeFor,
    countEvent,
    modelScoring,
    fieldPoliciesFor,
    fieldMatchContextFor,
    redactResourceFields,
  } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/model-provider-policies", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createModelProviderPolicySchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createModelProviderPolicy({
          tenantId: tenantOf(request),
          provider: body.provider,
          zeroRetentionConfirmed: body.zeroRetentionConfirmed,
          dpaRef: body.dpaRef,
          inferenceRegion: body.inferenceRegion,
          egressAllowlist: body.egressAllowlist,
          approvedBy: requireActorRequired(request, body.approvedBy, "approve"),
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/model-provider-policies", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listModelProviderPolicies(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/model-provider-policies/:id/retire", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.retireModelProviderPolicy({
        tenantId: tenantOf(request),
        policyId: idOf(request),
      }),
      request,
    );
  });

  // AI-02：金标集批量导入——从标注导出（JSON）登记数据集并计算留出集与内容哈希。
  app.post("/api/v1/model-evaluation-datasets:import", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(goldSetImportSchema, request.body);
    const sampleSize = body.samples.length;
    const holdoutCount = body.samples.filter((sample) => sample.holdout).length;
    const holdoutSize =
      holdoutCount > 0
        ? holdoutCount
        : Math.max(1, Math.round(sampleSize * (body.holdoutRatio ?? 0.2)));
    // 内容哈希只绑定样本内容（按 sampleId 排序），不绑定提交顺序或 code；
    // 相同样本集在导入/刷新间哈希一致，便于审计比对。
    const contentHash = sha256({
      samples: [...body.samples].sort((a, b) =>
        a.sampleId.localeCompare(b.sampleId),
      ),
    });
    const dataset = await platformStore.createModelEvaluationDataset({
      tenantId: tenantOf(request),
      code: body.code,
      version: 1,
      name: body.name,
      sampleSize,
      holdoutSize,
      labelSource: body.labelSource,
      ownerPersonId: body.ownerPersonId,
      refreshedAt: body.refreshedAt,
      nextRefreshDueAt: body.nextRefreshDueAt,
      contentHash,
      samples: body.samples.map((sample) => ({
        ...sample,
        counterfactualScores: sample.counterfactualScores ?? [],
        holdout: sample.holdout ?? false,
        labelSource: body.labelSource,
      })),
    });
    countEvent("gold_set_imported");
    return reply.status(201).send(
      data(
        {
          dataset,
          samples: body.samples,
          stats: {
            sampleSize,
            holdoutSize,
            subgroups: [...new Set(body.samples.map((sample) => sample.subgroup))],
          },
        },
        request,
      ),
    );
  });

  app.post("/api/v1/model-evaluation-datasets", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createModelEvaluationDatasetSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createModelEvaluationDataset({
          tenantId: tenantOf(request),
          code: body.code,
          version: body.version ?? 1,
          name: body.name,
          sampleSize: body.sampleSize,
          holdoutSize: body.holdoutSize,
          labelSource: body.labelSource,
          ownerPersonId: body.ownerPersonId,
          refreshedAt: body.refreshedAt,
          nextRefreshDueAt: body.nextRefreshDueAt,
          contentHash: body.contentHash,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/model-evaluation-datasets/refresh-due", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { withinDays?: string };
    const withinDays = Number(query.withinDays ?? 30);
    const cutoff =
      Date.now() +
      (Number.isFinite(withinDays) ? withinDays : 30) *
        24 *
        60 *
        60 *
        1000;
    const datasets = await platformStore.listModelEvaluationDatasets(
      tenantOf(request),
    );
    return data(
      datasets.filter(
        (dataset) =>
          dataset.status === "ACTIVE" &&
          Boolean(dataset.nextRefreshDueAt) &&
          Date.parse(dataset.nextRefreshDueAt as string) <= cutoff,
      ),
      request,
    );
  });

  app.post("/api/v1/model-evaluation-datasets/:id/refresh", async (request) => {
    requireRoles(request, "manager");
    const body = parse(refreshModelEvaluationDatasetSchema, request.body);
    const tenantId = tenantOf(request);
    const datasets = await platformStore.listModelEvaluationDatasets(tenantId);
    const current = datasets.find(
      (dataset) => dataset.id === idOf(request),
    );
    if (!current) {
      throw new NotFoundError(
        `ModelEvaluationDataset ${idOf(request)} not found`,
      );
    }
    if (current.status !== "ACTIVE") {
      throw new ConflictError(
        `model evaluation dataset is ${current.status}`,
      );
    }
    const sameCode = datasets.filter(
      (dataset) => dataset.code === current.code,
    );
    const version =
      body.version ??
      Math.max(...sameCode.map((dataset) => dataset.version)) + 1;
    const sampleSize = body.sampleSize ?? current.sampleSize;
    const holdoutSize = body.holdoutSize ?? current.holdoutSize;
    if (holdoutSize >= sampleSize) {
      throw new ConflictError(
        "GOLD_SET_HOLDOUT_TOO_LARGE: holdout must be smaller than sample",
      );
    }
    const refreshed = await platformStore.createModelEvaluationDataset({
      tenantId,
      code: current.code,
      version,
      name: body.name ?? current.name,
      sampleSize,
      holdoutSize,
      labelSource: current.labelSource,
      ownerPersonId: body.ownerPersonId ?? current.ownerPersonId,
      refreshedAt: body.refreshedAt,
      nextRefreshDueAt: body.nextRefreshDueAt,
      contentHash: body.contentHash,
      samples: current.samples,
    });
    await platformStore.retireModelEvaluationDataset({
      tenantId,
      datasetId: current.id,
    });
    return data(refreshed, request);
  });

  app.get("/api/v1/model-evaluation-datasets/:id/samples", async (request) => {
    requireRoles(request, "manager", "finance");
    const datasets = await platformStore.listModelEvaluationDatasets(
      tenantOf(request),
    );
    const dataset = datasets.find((candidate) => candidate.id === idOf(request));
    if (!dataset) {
      throw new NotFoundError(
        `ModelEvaluationDataset ${idOf(request)} not found`,
      );
    }
    return data(
      { datasetId: dataset.id, code: dataset.code, samples: dataset.samples ?? [] },
      request,
    );
  });

  app.get("/api/v1/model-evaluation-datasets", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listModelEvaluationDatasets(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/model-evaluation-datasets/:id/retire", async (request) => {
    requireRoles(request, "manager");
    return data(
      await platformStore.retireModelEvaluationDataset({
        tenantId: tenantOf(request),
        datasetId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/model-canary-runs", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createModelCanaryRunSchema, request.body);
    const tenantId = tenantOf(request);
    const [baseline, candidate] = await Promise.all([
      platformStore.getModelEvaluationRun(
        tenantId,
        body.baselineEvaluationRunId,
      ),
      platformStore.getModelEvaluationRun(
        tenantId,
        body.candidateEvaluationRunId,
      ),
    ]);
    assertHarnessEvaluation(baseline);
    assertHarnessEvaluation(candidate);
    if (
      baseline.datasetRef !== body.datasetRef ||
      candidate.datasetRef !== body.datasetRef
    ) {
      throw new ConflictError(
        "CANARY_DATASET_MISMATCH: both runs must use the requested dataset",
      );
    }
    const blockers: string[] = [];
    if (!baseline.passed) blockers.push("BASELINE_NOT_PASSED");
    if (!candidate.passed) blockers.push("CANDIDATE_NOT_PASSED");
    const metric = (
      run: typeof baseline,
      key: string,
    ): number | undefined =>
      typeof run.metrics[key] === "number"
        ? (run.metrics[key] as number)
        : undefined;
    const kappa = metric(candidate, "cohensKappa");
    const baselineKappa = metric(baseline, "cohensKappa");
    if (
      kappa !== undefined &&
      baselineKappa !== undefined &&
      kappa < baselineKappa - 0.05
    ) {
      blockers.push("CANARY_KAPPA_REGRESSION");
    }
    const gap = metric(candidate, "subgroupErrorGap");
    const baselineGap = metric(baseline, "subgroupErrorGap");
    if (
      gap !== undefined &&
      baselineGap !== undefined &&
      gap > baselineGap + 0.05
    ) {
      blockers.push("CANARY_SUBGROUP_GAP_REGRESSION");
    }
    const injection = metric(candidate, "promptInjectionPassRate");
    const baselineInjection = metric(
      baseline,
      "promptInjectionPassRate",
    );
    if (
      injection !== undefined &&
      baselineInjection !== undefined &&
      injection < baselineInjection
    ) {
      blockers.push("CANARY_PROMPT_INJECTION_REGRESSION");
    }
    const stability = metric(candidate, "counterfactualStability");
    const baselineStability = metric(
      baseline,
      "counterfactualStability",
    );
    if (
      stability !== undefined &&
      baselineStability !== undefined &&
      stability < baselineStability - 0.05
    ) {
      blockers.push("CANARY_STABILITY_REGRESSION");
    }
    const canary = await platformStore.createModelCanaryRun({
      tenantId,
      baselineEvaluationRunId: baseline.id,
      candidateEvaluationRunId: candidate.id,
      datasetRef: body.datasetRef,
      trafficPercent: body.trafficPercent,
      passed: blockers.length === 0,
      blockers,
      metrics: {
        baseline: baseline.metrics,
        candidate: candidate.metrics,
      },
    });
    countEvent(canary.passed ? "model_canary_passed" : "model_canary_blocked");
    return reply.status(201).send(data(canary, request));
  });

  app.get("/api/v1/model-canary-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listModelCanaryRuns(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/model-red-team-runs", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createModelRedTeamRunSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createModelRedTeamRun({
          tenantId: tenantOf(request),
          modelProvider: body.modelProvider,
          modelName: body.modelName,
          promptVersion: body.promptVersion,
          scope: body.scope,
          testsRun: body.testsRun,
          passed: body.passed,
          findings: body.findings ?? [],
          artifactRef: body.artifactRef,
          createdBy: requireActorRequired(request, body.createdBy, "create"),
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/model-red-team-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listModelRedTeamRuns(tenantOf(request)),
      request,
    );
  });


  app.post("/api/v1/ai-score-proposals", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createAiScoreProposalSchema, request.body);
    const tenantId = tenantOf(request);
    const persons = await platformStore.listPersons(tenantId);
    if (!persons.some((person) => person.id === body.personId)) {
      throw new NotFoundError(`Person ${body.personId} not found`);
    }
    const evaluation = await platformStore.getModelEvaluationRun(
      tenantId,
      body.evaluationRunId,
    );
    assertHarnessEvaluation(evaluation);
    await assertModelProviderPolicy(platformStore, request, evaluation.modelProvider);
    if (!evaluation.passed) {
      throw new ConflictError(
        `AI_EVALUATION_GATE_NOT_PASSED: ${
          evaluation.blockers.join(", ") || "evaluation did not pass"
        }`,
      );
    }
    let prompt;
    if (body.modelPromptId) {
      prompt = await platformStore.getModelPrompt(
        tenantId,
        body.modelPromptId,
      );
      if (prompt.status !== "ACTIVE") {
        throw new ConflictError(
          `MODEL_PROMPT_NOT_ACTIVE: ${prompt.id} is ${prompt.status}`,
        );
      }
      if (
        prompt.modelProvider !== evaluation.modelProvider ||
        prompt.modelName !== evaluation.modelName
      ) {
        throw new ConflictError(
          `MODEL_PROMPT_EVALUATION_MODEL_MISMATCH: ${prompt.id}`,
        );
      }
    }
    // NPV2-006：numeric 提案默认关闭。租户必须显式开启
    // aiNumericScoringEnabled，并已通过上方评测门禁；未开启时一律走
    // /ai-evidence-coverage 的确定性覆盖评估。
    const tenantSettings = (
      (await platformStore.getTenant(tenantId)).settings ?? {}
    ) as { aiNumericScoringEnabled?: unknown };
    if (tenantSettings.aiNumericScoringEnabled !== true) {
      throw new ConflictError(
        "AI_NUMERIC_SCORING_DISABLED: numeric AI score proposals are gated off (PRD V4.2 D-02); use POST /api/v1/ai-evidence-coverage for deterministic evidence coverage assessment",
      );
    }
    const gate: EvaluationGate = {
      passed: evaluation.passed,
      sampleSize: evaluation.sampleSize,
      metrics: {},
      blockers: evaluation.blockers,
    };
    const scored = scoreEvidence(
      {
        dimensions: body.dimensions,
        evidence: body.evidence,
      },
      gate,
    );
    // NPV2-005：零分只能出现在 ASSESSED 维度；非 ASSESSED 维度禁止数字分。
    const states = body.dimensionStates ?? {};
    const nonAssessedWithScore = Object.entries(scored.scores).filter(
      ([dimension, value]) =>
        value === 0 &&
        states[dimension] !== undefined &&
        states[dimension] !== "ASSESSED",
    );
    if (nonAssessedWithScore.length > 0) {
      throw new ConflictError(
        `AI_ZERO_SCORE_REQUIRES_ASSESSED:${nonAssessedWithScore
          .map(([dimension]) => dimension)
          .join(",")}; zero is only valid when the dimension state is ASSESSED`,
      );
    }
    const tenant = await platformStore.getTenant(tenantId);
    const evidenceRule =
      (tenant.settings as { evidenceDefaultRule?: unknown })
        .evidenceDefaultRule === "ZERO"
        ? "ZERO"
        : "BLOCK";
    if (scored.insufficientEvidence.length > 0 && evidenceRule === "BLOCK") {
      throw new ConflictError(
        `AI_EVIDENCE_INSUFFICIENT:${scored.insufficientEvidence.join(",")}; add evidence or set evidenceDefaultRule=ZERO`,
      );
    }
    const zeroDimensions = Object.entries(scored.scores)
      .filter(([, value]) => value === 0)
      .map(([dimension]) => dimension);
    if (zeroDimensions.length > 0 && !body.zeroScoreRationale?.trim()) {
      throw new ConflictError(
        `AI_ZERO_SCORE_RATIONALE_REQUIRED:${zeroDimensions.join(",")}; unpriced or unobserved work must not be silently defaulted to zero`,
      );
    }
    const risk = assessAiRisk({
      overallScore: scored.overallScore,
      confidence: scored.confidence,
      evidenceCount: scored.evidenceCount,
      hasZeroScore: zeroDimensions.length > 0,
      requestedTier: body.riskTier,
    });
    const riskAssessedAt = new Date();
    const secondReviewDueAt = risk.secondReviewSlaHours
      ? new Date(
          riskAssessedAt.getTime() +
            risk.secondReviewSlaHours * 60 * 60 * 1000,
        ).toISOString()
      : undefined;
    const proposal = await platformStore.createAiScoreProposal({
      tenantId,
      cycleId: body.cycleId,
      personId: body.personId,
      evaluationRunId: evaluation.id,
      modelPromptId: prompt?.id,
      modelProvider: prompt?.modelProvider ?? evaluation.modelProvider,
      modelName: prompt?.modelName ?? evaluation.modelName,
      promptVersion: evaluation.promptVersion,
      dimensions: body.dimensions,
      scores: scored.scores,
      overallScore: scored.overallScore,
      confidence: scored.confidence,
      rationale: scored.rationale,
      evidenceRefs: scored.citations,
      evidenceSnapshotHash: sha256(body.evidence),
      gateMetrics: evaluation.metrics,
      riskTier: risk.riskTier,
      riskReasons: risk.riskReasons,
      riskAssessedAt: riskAssessedAt.toISOString(),
      secondReviewDueAt,
      zeroScoreRationale: body.zeroScoreRationale,
      requestedBy: requireActorRequired(request, body.requestedBy, "request"),
    });
    countEvent("ai_score_proposal_created");
    return reply.status(201).send(data(proposal, request));
  });

  app.get("/api/v1/me/ai-explanations", async (request) => {
    const query = request.query as { personId?: string };
    const own = personFilter(request);
    const personId = own ?? (isPrivileged(request) ? query.personId : undefined);
    if (!personId) {
      throw new ForbiddenError("a person identity is required");
    }
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [drafts, decisions, proposals, notices] = await Promise.all([
      store.listEvaluationDrafts({ personId }),
      store.listEvaluationDecisions({ personId }),
      platformStore.listAiScoreProposals(tenantId, { personId }),
      platformStore.listNotices(tenantId),
    ]);
    const aiNotices = notices.filter((notice) => notice.noticeType === "AI_USE");
    const noticeRecords = await Promise.all(
      aiNotices.map(async (notice) => {
        const overview = await platformStore.listAcknowledgements(
          tenantId,
          notice.id,
        );
        return {
          notice,
          myAcknowledgement:
            overview.acknowledgements.find(
              (acknowledgement) =>
                acknowledgement.personId === personId,
            ) ?? null,
        };
      }),
    );
    const models = new Set<string>();
    for (const draft of drafts) {
      if (draft.modelName) {
        models.add(`${draft.modelProvider ?? "unknown"}/${draft.modelName}`);
      }
    }
    for (const proposal of proposals) {
      models.add(`${proposal.modelProvider}/${proposal.modelName}`);
    }
    return data(
      {
        personId,
        generatedAt: new Date().toISOString(),
        aiUsed: drafts.length > 0 || proposals.length > 0,
        models: [...models],
        notices: noticeRecords,
        evaluationDrafts: drafts,
        evaluationDecisions: decisions,
        aiScoreProposals: proposals,
        explanation: {
          summary:
            "AI output is advisory. A human reviewer records the formal evaluation or attribution decision, and you can appeal it.",
          humanReviewRequired: true,
          autonomousDecision: false,
          appealTargetType: "EVALUATION",
          appealTargets: decisions.map((decision) => decision.id),
        },
      },
      request,
    );
  });

  app.get("/api/v1/ai-review-metrics", async (request) => {
    requireRoles(request, "manager", "finance");
    const proposals = await platformStore.listAiScoreProposals(
      tenantOf(request),
    );
    const decided = proposals.filter(
      (proposal) => proposal.status !== "PENDING",
    );
    const accepted = decided.filter(
      (proposal) => proposal.status === "ACCEPTED",
    ).length;
    const overridden = decided.filter(
      (proposal) => proposal.override,
    ).length;
    const blind = decided.filter((proposal) => proposal.blindReview).length;
    const durations = decided
      .map((proposal) => proposal.reviewDurationSeconds)
      .filter((value): value is number => typeof value === "number");
    const evidenceOpened = decided.reduce(
      (total, proposal) => total + (proposal.evidenceOpened ?? 0),
      0,
    );
    const acceptanceRate =
      decided.length === 0 ? 0 : accepted / decided.length;
    const auditSampled = decided.filter((proposal) => proposal.auditSample);
    const auditCompleted = auditSampled.filter(
      (proposal) => proposal.secondReviewCompletedAt,
    );
    const auditAgreed = auditCompleted.filter(
      (proposal) => proposal.secondReviewOutcome === "AGREE",
    ).length;
    return data(
      {
        total: proposals.length,
        pending: proposals.length - decided.length,
        decided: decided.length,
        accepted,
        rejected: decided.length - accepted,
        acceptanceRate,
        overrideCount: overridden,
        overrideRate: decided.length === 0 ? 0 : overridden / decided.length,
        blindReviewCount: blind,
        averageReviewDurationSeconds:
          durations.length === 0
            ? 0
            : Math.round(
                durations.reduce((sum, value) => sum + value, 0) /
                  durations.length,
              ),
        averageEvidenceOpened:
          decided.length === 0
            ? 0
            : Math.round((evidenceOpened / decided.length) * 10) / 10,
        rubberStampAlert:
          decided.length >= 20 && acceptanceRate > 0.95,
        auditSampledCount: auditSampled.length,
        auditReviewedCount: auditCompleted.length,
        auditPendingCount: auditSampled.length - auditCompleted.length,
        auditAgreementRate:
          auditCompleted.length === 0
            ? 0
            : auditAgreed / auditCompleted.length,
        highRiskCount: proposals.filter(
          (proposal) =>
            proposal.riskTier === "HIGH" ||
            proposal.riskTier === "CRITICAL",
        ).length,
        highRiskPending: proposals.filter(
          (proposal) =>
            proposal.status === "PENDING" &&
            (proposal.riskTier === "HIGH" ||
              proposal.riskTier === "CRITICAL"),
        ).length,
        secondReviewOverdue: proposals.filter(
          (proposal) =>
            proposal.status === "PENDING" &&
            proposal.secondReviewRequired &&
            Boolean(proposal.secondReviewDueAt) &&
            Date.parse(proposal.secondReviewDueAt as string) < Date.now(),
        ).length,
        secondReviewSlaBreaches: proposals.filter(
          (proposal) => proposal.secondReviewSlaBreached,
        ).length,
      },
      request,
    );
  });

  app.get("/api/v1/ai-score-proposals", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      personId?: string;
      cycleId?: string;
      status?: "PENDING" | "ACCEPTED" | "REJECTED";
    };
    const proposals = await platformStore.listAiScoreProposals(
      tenantOf(request),
      {
        personId: query.personId,
        cycleId: query.cycleId,
        status: query.status,
      },
    );
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) return data(proposals, request);
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    const personId = ownPersonId(request);
    return data(
      proposals.map((proposal) =>
        redactResourceFields(proposal, "AI_PROPOSAL", {
          personId,
          recordPersonId: proposal.personId,
          roles,
          policies,
          matchContext,
        }),
      ),
      request,
    );
  });

  app.get("/api/v1/ai-score-proposals/audit-queue", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      status?: "pending" | "completed" | "all";
    };
    const proposals = await platformStore.listAiScoreProposals(
      tenantOf(request),
    );
    const sampled = proposals.filter(
      (proposal) =>
        proposal.auditSample && proposal.status !== "PENDING",
    );
    const filtered =
      query.status === "completed"
        ? sampled.filter((proposal) => proposal.secondReviewCompletedAt)
        : query.status === "all"
          ? sampled
          : sampled.filter((proposal) => !proposal.secondReviewCompletedAt);
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) return data(filtered, request);
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    const personId = ownPersonId(request);
    return data(
      filtered.map((proposal) =>
        redactResourceFields(proposal, "AI_PROPOSAL", {
          personId,
          recordPersonId: proposal.personId,
          roles,
          policies,
          matchContext,
        }),
      ),
      request,
    );
  });

  app.get("/api/v1/ai-score-proposals/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    const proposal = await platformStore.getAiScoreProposal(
      tenantOf(request),
      idOf(request),
    );
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) return data(proposal, request);
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    return data(
      redactResourceFields(proposal, "AI_PROPOSAL", {
        personId: ownPersonId(request),
        recordPersonId: proposal.personId,
        roles,
        policies,
        matchContext,
      }),
      request,
    );
  });

  app.post("/api/v1/ai-score-proposals/:id/decide", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(decideAiScoreProposalSchema, request.body);
    const tenantId = tenantOf(request);
    // NPV2-003：裁决人必须是会话主体（平台管理员除外）。
    const deciderOwn = ownPersonId(request);
    if (deciderOwn && !isPlatformAdmin(request) && requireActor(request, body.decidedBy, "decide") !== deciderOwn) {
      throw new ForbiddenError(
        "AI proposal decisions must use the authenticated identity",
      );
    }
    const persons = await platformStore.listPersons(tenantId);
    if (!persons.some((person) => person.id === requireActor(request, body.decidedBy, "decide"))) {
      throw new NotFoundError(`Person ${requireActor(request, body.decidedBy, "decide")} not found`);
    }
    const existing = await platformStore.getAiScoreProposal(
      tenantId,
      idOf(request),
    );
    for (const dimension of existing.dimensions) {
      if (typeof body.independentScores[dimension] !== "number") {
        throw new ConflictError(
          `AI_INDEPENDENT_SCORES_REQUIRED: missing ${dimension}`,
        );
      }
    }
    const override = existing.dimensions.some(
      (dimension) =>
        Math.abs(
          (body.independentScores[dimension] ?? 0) -
            (existing.scores[dimension] ?? 0),
        ) > 0.05,
    );
    if (override && !body.overrideReason?.trim()) {
      throw new ConflictError("AI_OVERRIDE_REASON_REQUIRED");
    }
    const reviewStartedMs = Date.parse(body.reviewStartedAt);
    if (
      !Number.isFinite(reviewStartedMs) ||
      reviewStartedMs > Date.now()
    ) {
      throw new ConflictError("AI_REVIEW_STARTED_AT_INVALID");
    }
    const reviewDurationSeconds = Math.max(
      0,
      Math.round((Date.now() - reviewStartedMs) / 1000),
    );
    let secondReviewerPersonId: string | undefined;
    let secondIndependentScores: Record<string, number> | undefined;
    let secondIndependentRationale: string | undefined;
    let secondReviewStartedAt: string | undefined;
    let secondEvidenceOpened: number | undefined;
    let secondReviewOutcome: "AGREE" | "DISAGREE" | undefined;
    let secondReviewAgreementRate: number | undefined;
    if (existing.secondReviewRequired) {
      if (
        !body.secondReviewerPersonId ||
        !body.secondIndependentScores ||
        !body.secondIndependentRationale?.trim() ||
        !body.secondReviewStartedAt
      ) {
        throw new ConflictError(
          "AI_SECOND_REVIEW_REQUIRED: high-risk proposals need a second independent review",
        );
      }
      if (!persons.some((person) => person.id === body.secondReviewerPersonId)) {
        throw new NotFoundError(
          `Person ${body.secondReviewerPersonId} not found`,
        );
      }
      if (
        body.secondReviewerPersonId === requireActor(request, body.decidedBy, "decide") ||
        body.secondReviewerPersonId === existing.requestedBy
      ) {
        throw new ConflictError(
          "AI_SECOND_REVIEWER_CONFLICT: second reviewer must differ from requester and first reviewer",
        );
      }
      for (const dimension of existing.dimensions) {
        if (
          typeof body.secondIndependentScores[dimension] !== "number"
        ) {
          throw new ConflictError(
            `AI_SECOND_REVIEW_SCORES_REQUIRED: missing ${dimension}`,
          );
        }
      }
      const secondStartedMs = Date.parse(body.secondReviewStartedAt);
      if (
        !Number.isFinite(secondStartedMs) ||
        secondStartedMs > Date.now()
      ) {
        throw new ConflictError("AI_SECOND_REVIEW_STARTED_AT_INVALID");
      }
      const matched = existing.dimensions.filter(
        (dimension) =>
          Math.abs(
            (body.secondIndependentScores?.[dimension] ?? 0) -
              (existing.scores[dimension] ?? 0),
          ) <= 0.05,
      ).length;
      const secondDecision =
        matched === existing.dimensions.length ? "ACCEPTED" : "REJECTED";
      if (
        secondDecision !==
        (body.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED")
      ) {
        throw new ConflictError(
          "AI_SECOND_REVIEW_DISAGREES: the second reviewer reached a different decision",
        );
      }
      secondReviewerPersonId = body.secondReviewerPersonId;
      secondIndependentScores = body.secondIndependentScores;
      secondIndependentRationale = body.secondIndependentRationale;
      secondReviewStartedAt = body.secondReviewStartedAt;
      secondEvidenceOpened = body.secondEvidenceOpened ?? 0;
      secondReviewOutcome = "AGREE";
      secondReviewAgreementRate =
        matched / existing.dimensions.length;
    }
    const tenant = await platformStore.getTenant(tenantId);
    const configuredRate = Number(
      (tenant.settings as { aiAuditSampleRate?: unknown })
        .aiAuditSampleRate ?? 0.1,
    );
    const auditSampleRate = Number.isFinite(configuredRate)
      ? Math.min(1, Math.max(0, configuredRate))
      : 0.1;
    const auditSample = existing.secondReviewRequired
      ? false
      : override || Math.random() < auditSampleRate;
    const proposal = await platformStore.decideAiScoreProposal({
      tenantId,
      proposalId: idOf(request),
      decision: body.decision,
      decidedBy: requireActorRequired(request, body.decidedBy, "decide"),
      note: body.note,
      independentScores: body.independentScores,
      independentRationale: body.independentRationale,
      reviewStartedAt: body.reviewStartedAt,
      reviewDurationSeconds,
      evidenceOpened: body.evidenceOpened ?? 0,
      override,
      overrideReason: body.overrideReason,
      blindReview: body.blindReview ?? false,
      auditSample,
      secondReviewerPersonId,
      secondIndependentScores,
      secondIndependentRationale,
      secondReviewStartedAt,
      secondEvidenceOpened,
      secondReviewOutcome,
      secondReviewAgreementRate,
    });
    countEvent(
      proposal.status === "ACCEPTED"
        ? "ai_score_proposal_accepted"
        : "ai_score_proposal_rejected",
    );
    return data(proposal, request);
  });

  app.post("/api/v1/ai-score-proposals/:id/audit-review", async (request) => {
      requireRoles(request, "manager", "finance");
      const body = parse(submitAiScoreAuditSchema, request.body);
      const tenantId = tenantOf(request);
      // NPV2-003：复核人必须是会话主体（平台管理员除外）。
      const auditOwn = ownPersonId(request);
      if (auditOwn && !isPlatformAdmin(request) && body.reviewerPersonId !== auditOwn) {
        throw new ForbiddenError(
          "audit review must use the authenticated identity",
        );
      }
      const persons = await platformStore.listPersons(tenantId);
      if (!persons.some((person) => person.id === body.reviewerPersonId)) {
        throw new NotFoundError(
          `Person ${body.reviewerPersonId} not found`,
        );
      }
      const proposal = await platformStore.getAiScoreProposal(
        tenantId,
        idOf(request),
      );
      for (const dimension of proposal.dimensions) {
        if (typeof body.scores[dimension] !== "number") {
          throw new ConflictError(
            `AI_AUDIT_SCORES_REQUIRED: missing ${dimension}`,
          );
        }
      }
      const reviewStartedMs = Date.parse(body.reviewStartedAt);
      if (
        !Number.isFinite(reviewStartedMs) ||
        reviewStartedMs > Date.now()
      ) {
        throw new ConflictError("AI_AUDIT_STARTED_AT_INVALID");
      }
      const matched = proposal.dimensions.filter(
        (dimension) =>
          Math.abs(
            (body.scores[dimension] ?? 0) -
              (proposal.scores[dimension] ?? 0),
          ) <= 0.05,
      ).length;
      const agreementRate = matched / proposal.dimensions.length;
      const secondDecision =
        matched === proposal.dimensions.length ? "ACCEPTED" : "REJECTED";
      const outcome =
        proposal.status === secondDecision ? "AGREE" : "DISAGREE";
      const reviewed = await platformStore.recordAiScoreAuditReview({
        tenantId,
        proposalId: idOf(request),
        reviewerPersonId: body.reviewerPersonId,
        scores: body.scores,
        rationale: body.rationale,
        reviewStartedAt: body.reviewStartedAt,
        reviewDurationSeconds: Math.max(
          0,
          Math.round((Date.now() - reviewStartedMs) / 1000),
        ),
        evidenceOpened: body.evidenceOpened ?? 0,
        outcome,
        agreementRate,
      });
      countEvent("ai_score_audit_reviewed");
      return data(reviewed, request);
  });
  app.post("/api/v1/ai/model-summary", async (request, reply) => {
    requireRoles(request, "manager");
    if (!modelScoring) {
      return reply.status(501).send({
        ...errorBody(
          "MODEL_PROVIDER_NOT_CONFIGURED",
          "set modelScoring options (MODEL_SCORING_BASE_URL/MODEL_SCORING_API_KEY/MODEL_SCORING_MODEL) to enable model-backed summaries",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const body = parse(modelSummarySchema, request.body);
    const evidence = await storeFor(request).listEvidence();
    const selected = body.evidenceRefs
      .map((ref) => evidence.find((node) => node.id === ref))
      .filter((node): node is NonNullable<typeof node> => Boolean(node));
    const missing = body.evidenceRefs.filter(
      (ref) => !selected.some((node) => node.id === ref),
    );
    if (missing.length > 0) {
      return reply.status(404).send({
        ...errorBody(
          "NOT_FOUND",
          `evidence not found: ${missing.join(", ")}`,
        ),
        meta: { correlation_id: request.id },
      });
    }
    const provider = new HttpModelScoringProvider({
      baseUrl: modelScoring.baseUrl,
      apiKey: modelScoring.apiKey,
      model: modelScoring.model,
      fetchImpl: modelScoring.fetchImpl,
    });
    let summary;
    try {
      summary = await provider.summarise({
        dimensions: body.dimensions,
        rubric: body.rubric,
        context: body.context,
        evidence: selected.map((node) => ({
          ref: node.id,
          text: JSON.stringify(node.normalizedPayload),
          qualityStatus: node.qualityStatus,
        })),
      });
    } catch (caught) {
      const code =
        caught instanceof ModelProviderError ? caught.code : "MODEL_PROVIDER_HTTP_ERROR";
      return reply.status(502).send({
        ...errorBody(code, (caught as Error).message),
        meta: { correlation_id: request.id },
      });
    }
    const log = await platformStore.createAiSuggestion({
      tenantId: tenantOf(request),
      agentTaskId: "manual-model-summary",
      targetType: "EVIDENCE_SUMMARY",
      suggestionType: "MODEL_EVIDENCE_SUMMARY",
      modelProvider: summary.provider,
      modelName: summary.model,
      promptVersion: "model-summary-v1",
      inputHash: sha256(body),
      outputJson: summary as unknown as Record<string, unknown>,
      validationStatus: "VALIDATED",
    });
    countEvent("model_summary_generated");
    return data({ suggestionLogId: log.id, summary }, request);
  });

  app.post("/api/v1/ai-suggestion-logs", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createAiSuggestionLogSchema, request.body);
    let modelProvider = body.modelProvider;
    let modelName = body.modelName;
    if (body.modelPromptId) {
      const prompt = await platformStore.getModelPrompt(
        tenantOf(request),
        body.modelPromptId,
      );
      if (prompt.status !== "ACTIVE") {
        throw new ConflictError(
          `MODEL_PROMPT_NOT_ACTIVE: ${prompt.id} is ${prompt.status}`,
        );
      }
      if (
        (modelProvider && modelProvider !== prompt.modelProvider) ||
        (modelName && modelName !== prompt.modelName)
      ) {
        throw new ConflictError(
          `MODEL_PROMPT_MODEL_MISMATCH: ${prompt.id}`,
        );
      }
      modelProvider = prompt.modelProvider;
      modelName = prompt.modelName;
    }
    return reply.status(201).send(
      data(
        await platformStore.createAiSuggestion({
          tenantId: tenantOf(request),
          agentTaskId: body.agentTaskId,
          targetType: body.targetType,
          targetId: body.targetId,
          suggestionType: body.suggestionType,
          modelProvider,
          modelName,
          modelPromptId: body.modelPromptId,
          promptVersion: body.promptVersion,
          inputHash: body.inputHash,
          outputJson: body.outputJson,
          validationStatus: body.validationStatus,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/ai-suggestion-logs", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      agentTaskId?: string;
      targetType?: string;
    };
    return data(
      await platformStore.listAiSuggestions(tenantOf(request), {
        agentTaskId: query.agentTaskId,
        targetType: query.targetType,
      }),
      request,
    );
  });

  app.post("/api/v1/ai-suggestion-logs/:id/accept", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(acceptAiSuggestionSchema, request.body);
    // NPV2-003：接受人必须是会话主体（平台管理员除外）。
    const own = ownPersonId(request);
    if (own && !isPlatformAdmin(request) && body.acceptedBy !== own) {
      throw new ForbiddenError(
        "AI suggestion acceptance must use the authenticated identity",
      );
    }
    return data(
      await platformStore.acceptAiSuggestion({
        tenantId: tenantOf(request),
        suggestionId: idOf(request),
        acceptedBy: body.acceptedBy,
      }),
      request,
    );
  });

  app.post("/api/v1/model-evaluation-runs:evaluate", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(runModelEvaluationSchema, request.body);
    await assertRegisteredGoldSet(platformStore, request, body.datasetRef);
    let samples: NonNullable<typeof body.samples> = body.samples ?? [];
    if (samples.length === 0) {
      const registered = await platformStore.getActiveModelEvaluationDataset(
        tenantOf(request),
        body.datasetRef,
      );
      samples = registered?.samples ?? [];
    }
    if (samples.length === 0) {
      throw new BadRequestError(
        "GOLD_SET_SAMPLES_REQUIRED",
        "datasetRef 未登记样本，必须上传 samples",
      );
    }
    const thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...(body.thresholds ?? {}),
    };
    const gate = evaluateGate(samples, thresholds);
    const evaluation = await platformStore.createModelEvaluationRun({
      tenantId: tenantOf(request),
      evaluationType: body.evaluationType,
      modelProvider: body.modelProvider,
      modelName: body.modelName,
      promptVersion: body.promptVersion,
      datasetRef: body.datasetRef,
      sampleSize: gate.sampleSize,
      metrics: {
        ...gate.metrics,
        harnessVersion: "ai-gate-v1",
        thresholds,
      },
      subgroupMetrics: {},
      passed: gate.passed,
      blockers: gate.blockers,
    });
    countEvent("model_evaluation_harness_run");
    if (!gate.passed) countEvent("model_evaluation_harness_blocked");
    return reply.status(201).send(data(evaluation, request));
  });

  app.post("/api/v1/model-evaluation-runs", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createModelEvaluationRunSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createModelEvaluationRun({
          tenantId: tenantOf(request),
          evaluationType: body.evaluationType,
          modelProvider: body.modelProvider,
          modelName: body.modelName,
          promptVersion: body.promptVersion,
          datasetRef: body.datasetRef,
          sampleSize: body.sampleSize,
          metrics: body.metrics ?? {},
          subgroupMetrics: body.subgroupMetrics ?? {},
          passed: body.passed,
          blockers: body.blockers ?? [],
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/model-evaluation-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      evaluationType?: string;
      passed?: string;
    };
    return data(
      await platformStore.listModelEvaluationRuns(tenantOf(request), {
        evaluationType: query.evaluationType,
        passed:
          query.passed === undefined ? undefined : query.passed === "true",
      }),
      request,
    );
  });

  app.get("/api/v1/model-evaluation-runs/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getModelEvaluationRun(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/model-prompts", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createModelPromptSchema, request.body);
    const prompt = await platformStore.createModelPrompt({
      tenantId: tenantOf(request),
      promptCode: body.promptCode,
      version: body.version,
      purpose: body.purpose,
      modelProvider: body.modelProvider,
      modelName: body.modelName,
      template: body.template,
    });
    countEvent("model_prompt_created");
    return reply.status(201).send(data(prompt, request));
  });

  app.get("/api/v1/model-prompts", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      promptCode?: string;
      status?: "DRAFT" | "ACTIVE" | "RETIRED";
    };
    return data(
      await platformStore.listModelPrompts(tenantOf(request), {
        promptCode: query.promptCode,
        status: query.status,
      }),
      request,
    );
  });

  app.post("/api/v1/model-prompts/:id/activate", async (request) => {
    requireRoles(request, "admin");
    const body = parse(activateModelPromptSchema, request.body);
    const evaluation = await platformStore.getModelEvaluationRun(
      tenantOf(request),
      body.evaluationRunId,
    );
    assertHarnessEvaluation(evaluation);
    const existingPrompt = await platformStore.getModelPrompt(
      tenantOf(request),
      idOf(request),
    );
    await assertModelProviderPolicy(platformStore, request, existingPrompt.modelProvider);
    await assertRedTeamEvidence(platformStore, request, existingPrompt);
    const prompt = await platformStore.activateModelPrompt({
      tenantId: tenantOf(request),
      promptId: idOf(request),
      evaluationRunId: body.evaluationRunId,
    });
    countEvent("model_prompt_activated");
    return data(prompt, request);
  });

  app.post("/api/v1/model-prompts/:id/retire", async (request) => {
    requireRoles(request, "admin");
    const prompt = await platformStore.retireModelPrompt({
      tenantId: tenantOf(request),
      promptId: idOf(request),
    });
    countEvent("model_prompt_retired");
    return data(prompt, request);
  });

  // NPV2-004：确定性证据覆盖评估——无数字评分、无模型调用、结果可复算。
  app.post("/api/v1/ai-evidence-coverage", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(assessEvidenceCoverageSchema, request.body);
    const tenantId = tenantOf(request);
    const persons = await platformStore.listPersons(tenantId);
    if (
      body.subjectType === "PERSON" &&
      !persons.some((person) => person.id === body.subjectId)
    ) {
      throw new NotFoundError(`Person ${body.subjectId} not found`);
    }
    const assessment = assessEvidenceCoverage({
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      cycleId: body.cycleId,
      dimensions: body.dimensions,
      evidence: body.evidence,
      requirements: body.requirements,
    });
    try {
      await storeFor(request).recordAuditEvent({
        actorType: "USER",
        actorId: ownPersonId(request) ?? request.authContext?.userId,
        action: "AI_EVIDENCE_COVERAGE_ASSESSED",
        objectType: body.subjectType,
        objectId: body.subjectId,
        reason: `cycle=${body.cycleId} band=${assessment.coverageBand} snapshot=${assessment.evidenceSnapshotHash}`,
      });
    } catch {
      /* audit is best-effort for legacy stores */
    }
    countEvent("ai_evidence_coverage_assessed");
    return reply.status(200).send(data(assessment, request));
  });
  app.post("/api/v1/gold-label-tasks", async (request, reply) => {
    requireRoles(request, "manager");
    const body = policyBody(request);
    if (!Array.isArray(body.sampleIds) || body.sampleIds.length === 0) {
      throw new BadRequestError("INVALID_INPUT", "sampleIds 必须为非空数组");
    }
    const record = await platformStore.savePolicyEngineRecord({
      tenantId: tenantOf(request),
      recordType: "GOLD_LABEL_TASK",
      personId: typeof body.assigneePersonId === "string"
        ? body.assigneePersonId
        : undefined,
      status: "OPEN",
      payload: {
        datasetId: requireString(body, "datasetId"),
        sampleIds: body.sampleIds,
        assigneePersonId: requireString(body, "assigneePersonId"),
        dueAt: typeof body.dueAt === "string" ? body.dueAt : undefined,
        createdAt: new Date().toISOString(),
      },
    });
    return reply.status(201).send(data(record, request));
  });

  app.get("/api/v1/gold-label-tasks", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    const query = request.query as { status?: string };
    return data(
      await platformStore.listPolicyEngineRecords(tenantOf(request), {
        recordType: "GOLD_LABEL_TASK",
        status: query.status,
      }),
      request,
    );
  });

  app.post("/api/v1/gold-label-tasks/:id/complete", async (request) => {
    requireRoles(request, "manager");
    const record = await platformStore.getPolicyEngineRecord(
      tenantOf(request),
      idOf(request),
    );
    if (record.recordType !== "GOLD_LABEL_TASK") {
      throw new NotFoundError(`GoldLabelTask ${idOf(request)} 不存在`);
    }
    const body = policyBody(request);
    return data(
      await platformStore.updatePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordId: record.id,
        status: "COMPLETED",
        payload: {
          ...record.payload,
          completedBy: requireActor(
            request,
            typeof body.completedBy === "string" ? body.completedBy : undefined,
            "complete",
          ),
          completedAt: new Date().toISOString(),
          adjudicatedBy:
            typeof body.adjudicatedBy === "string"
              ? body.adjudicatedBy
              : undefined,
          scores: body.scores ?? {},
        },
      }),
      request,
    );
  });

  app.post("/api/v1/model-training-runs", async (request, reply) => {
    requireRoles(request, "manager");
    const body = policyBody(request);
    const record = await platformStore.savePolicyEngineRecord({
      tenantId: tenantOf(request),
      recordType: "MODEL_TRAINING_RUN",
      status: "RUNNING",
      payload: {
        datasetId: requireString(body, "datasetId"),
        baseModel: requireString(body, "baseModel"),
        promptVersion: requireString(body, "promptVersion"),
        externalRunId:
          typeof body.externalRunId === "string" ? body.externalRunId : undefined,
        startedAt: new Date().toISOString(),
      },
    });
    return reply.status(201).send(data(record, request));
  });

  app.get("/api/v1/model-training-runs", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    return data(
      await platformStore.listPolicyEngineRecords(tenantOf(request), {
        recordType: "MODEL_TRAINING_RUN",
      }),
      request,
    );
  });

  app.post("/api/v1/model-training-runs/:id/callback", async (request) => {
    requireRoles(request, "manager");
    const record = await platformStore.getPolicyEngineRecord(
      tenantOf(request),
      idOf(request),
    );
    if (record.recordType !== "MODEL_TRAINING_RUN") {
      throw new NotFoundError(`ModelTrainingRun ${idOf(request)} 不存在`);
    }
    const body = policyBody(request);
    const status = requireString(body, "status");
    if (!["SUCCEEDED", "FAILED"].includes(status)) {
      throw new BadRequestError("INVALID_STATUS", `不支持的训练状态 ${status}`);
    }
    return data(
      await platformStore.updatePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordId: record.id,
        status,
        payload: {
          ...record.payload,
          status,
          metrics: body.metrics ?? {},
          artifactRef:
            typeof body.artifactRef === "string" ? body.artifactRef : undefined,
          finishedAt: new Date().toISOString(),
        },
      }),
      request,
    );
  });

  };
}
