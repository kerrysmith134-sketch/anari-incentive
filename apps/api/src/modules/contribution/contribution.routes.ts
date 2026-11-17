/**
 * 贡献申报与佐证域路由（NPV2-011 第三片）：
 * 贡献申报生命周期、佐证（attestation）登记/撤回。
 * 行为与拆分前等价。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { DirectoryPort,
  TenantPort,
  ModelgovPort,
} from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import {
  contributionEventBatchSchema,
  contributionEventFilterSchema,
  createContributionAssessmentDraftSchema,
  createContributionAttestationSchema,
  createContributionClaimSchema,
  createContributionEventSchema,
  createManualContributionEventSchema,
  generateContributionAssessmentSchema,
  linkContributionAssessmentDecisionSchema,
  withdrawContributionAttestationSchema,
} from "@anari/contracts";
import { ConflictError, NotFoundError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  HttpModelScoringProvider,
  ModelProviderError,
  recordModelUsage,
} from "@anari/ai-gate";
import { assertModelProviderPolicy } from "../../model-policy.js";
import {
  data,
  idOf,
  isPrivileged,
  ownPersonId,
  parse,
  personFilter,
  requireActorRequired,
  requireRoles,
  tenantOf,
  requireActor,
  errorBody,
} from "../../http-helpers.js";

export function registerContributionRoutes(deps: {
  platformStore: DirectoryPort & TenantPort & ModelgovPort;
  countEvent: (event: string) => void;
  /** NP-020：贡献草案生成的模型配置（与模型摘要共用同一门禁链路）。 */
  modelScoring?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    fetchImpl?: typeof fetch;
  };
  storeFor: (request: FastifyRequest) => IncentiveStore;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/contribution-claims", async (request, reply) => {
      const body = parse(createContributionClaimSchema, request.body);
      const person = personFilter(request);
      if (person && body.claimantPersonId !== person) {
        throw new ForbiddenError("cannot file a claim for another person");
      }
      return reply.status(201).send(data(await storeFor(request).createClaim(body), request));
    });

    app.get("/api/v1/contribution-claims", async (request) => {
      const claims = await storeFor(request).listClaims();
      const person = personFilter(request);
      return data(
        person
          ? claims.filter((claim) => claim.claimantPersonId === person)
          : claims,
        request,
      );
    });

    app.get("/api/v1/contribution-claims/:id", async (request) => {
      const claim = await storeFor(request).getClaim(idOf(request));
      const person = personFilter(request);
      if (person && claim.claimantPersonId !== person) {
        throw new ForbiddenError("contribution claim is not visible to this person");
      }
      return data(claim, request);
    });

    app.post("/api/v1/contribution-claims/:id/submit", async (request) => {
      const store = storeFor(request);
      const claim = await store.getClaim(idOf(request));
      const person = personFilter(request);
      if (person && claim.claimantPersonId !== person) {
        throw new ForbiddenError("cannot submit another person's claim");
      }
      return data(await store.submitClaim(idOf(request)), request);
    });

    app.post("/api/v1/contribution-attestations", async (request, reply) => {
      const body = parse(createContributionAttestationSchema, request.body);
      const persons = await platformStore.listPersons(tenantOf(request));
      const subject = persons.find(
        (person) => person.id === body.subjectPersonId,
      );
      const attester = persons.find(
        (person) => person.id === body.attesterPersonId,
      );
      if (!subject) throw new NotFoundError(
        `Person ${body.subjectPersonId} not found`,
      );
      if (!attester) throw new NotFoundError(
        `Person ${body.attesterPersonId} not found`,
      );
      if (body.attestationType === "MANAGER") {
        if (subject.managerPersonId !== body.attesterPersonId) {
          throw new ConflictError(
            "ATTESTATION_MANAGER_RELATIONSHIP_REQUIRED: attester is not the subject's manager",
          );
        }
      }
      const own = ownPersonId(request);
      if (
        own &&
        body.attesterPersonId !== own &&
        !isPrivileged(request)
      ) {
        throw new ForbiddenError("cannot attest on behalf of another person");
      }
      return reply.status(201).send(
        data(
          await storeFor(request).createContributionAttestation({
            ...body,
            evidenceRefs: body.evidenceRefs ?? [],
          }),
          request,
        ),
      );
    });

    app.get("/api/v1/contribution-attestations", async (request) => {
      const query = request.query as {
        workPackageId?: string;
        subjectPersonId?: string;
      };
      const person = personFilter(request);
      const attestations = await storeFor(
        request,
      ).listContributionAttestations({
        workPackageId: query.workPackageId,
        subjectPersonId: query.subjectPersonId,
      });
      return data(
        person
          ? attestations.filter(
              (attestation) =>
                attestation.subjectPersonId === person ||
                attestation.attesterPersonId === person,
            )
          : attestations,
        request,
      );
    });

    app.post("/api/v1/contribution-attestations/:id/withdraw", async (request) => {
        const body = parse(withdrawContributionAttestationSchema, request.body);
        const own = ownPersonId(request);
        // 显式指定操作人优先；员工冒名由上方守卫阻断。
        const requester = body.personId ?? own;
        if (!requester) {
          throw new ForbiddenError(
            "attester identity is required to withdraw an attestation",
          );
        }
        if (own && body.personId && body.personId !== own && !isPrivileged(request)) {
          throw new ForbiddenError("cannot withdraw for another person");
        }
        return data(
          await storeFor(request).withdrawContributionAttestation(
            idOf(request),
            requester,
          ),
          request,
        );
    });

  // ------------------------------------------------------------------
  // NPV2-015：贡献事件——事实记录（actor/subject/action/target/time/
  // source/outcome/evidence/correction_of）。ACTIVITY 事件只承载活动量
  // 事实，不得作为贡献认定依据（认定只能引用 CONTRIBUTION 事件）。
  // ------------------------------------------------------------------
  app.post("/api/v1/contribution-events", async (request, reply) => {
    // Manual contribution facts are explicitly self-attributed observations.
    // Actor and source cannot be supplied by the client: actor comes from the
    // authenticated session and source is fixed to MANUAL.
    const body = parse(createManualContributionEventSchema, request.body);
    const actorPersonId = ownPersonId(request);
    if (!actorPersonId) {
      throw new ForbiddenError(
        "manual contribution event requires an authenticated employee identity; service integrations must use the integration ingestion endpoint",
      );
    }
    // A manual assertion is always self-attributed, including when submitted
    // by a manager/admin session. Third-party facts must arrive through a
    // trusted integration credential, never through this employee endpoint.
    if (body.subjectPersonId !== actorPersonId) {
      throw new ForbiddenError(
        "manual contribution events can only describe the authenticated actor; use a trusted integration ingestion flow for another person's facts",
      );
    }
    const store = storeFor(request);
    if ((body.evidenceRefs ?? []).length > 0) {
      const evidence = await store.listEvidence();
      const available = new Set(evidence.map((item) => item.id));
      const missing = (body.evidenceRefs ?? []).filter((ref) => !available.has(ref));
      if (missing.length > 0) {
        throw new NotFoundError(
          `contribution evidence reference(s) not found: ${missing.join(", ")}`,
        );
      }
    }
    if (body.correctionOfEventId) {
      const original = await store.getContributionEvent(body.correctionOfEventId);
      if (original.subjectPersonId !== actorPersonId || original.source !== "MANUAL") {
        throw new ForbiddenError(
          "manual corrections may only amend the authenticated person's prior manual event",
        );
      }
    }
    const result = await store.ingestContributionEvents([
      {
        ...body,
        actorPersonId,
        source: "MANUAL",
        evidenceRefs: body.evidenceRefs ?? [],
      },
    ]);
    return reply.status(201).send(data(result.inserted[0], request));
  });

  app.post("/api/v1/contribution-events:ingest", async (request, reply) => {
    requireRoles(request, "integration");
    const body = parse(contributionEventBatchSchema, request.body);
    const result = await storeFor(request).ingestContributionEvents(
      body.events.map((event) => ({
        ...event,
        evidenceRefs: event.evidenceRefs ?? [],
      })),
    );
    return reply.status(201).send(
      data(
        {
          insertedCount: result.inserted.length,
          duplicateCount: result.duplicates.length,
          insertedIds: result.inserted.map((event) => event.id),
          duplicateIds: result.duplicates.map((event) => event.id),
        },
        request,
      ),
    );
  });

  app.get("/api/v1/contribution-events", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const person = personFilter(request);
    const parsed = contributionEventFilterSchema.safeParse({
      subjectPersonId: query.subjectPersonId,
      kind: query.kind,
      source: query.source,
      occurredFrom: query.occurredFrom,
      occurredTo: query.occurredTo,
    });
    const filter = parsed.success ? parsed.data : undefined;
    if (person) {
      // 非特权成员只能看自己的事件（覆盖查询参数里的他人过滤）。
      const events = await storeFor(request).listContributionEvents({
        ...filter,
        subjectPersonId: person,
      });
      return data(events, request);
    }
    return data(await storeFor(request).listContributionEvents(filter), request);
  });

  app.get("/api/v1/contribution-events/:id", async (request) => {
    const event = await storeFor(request).getContributionEvent(idOf(request));
    const person = personFilter(request);
    if (person && event.subjectPersonId !== person) {
      throw new ForbiddenError(
        "contribution event is not visible to this person",
      );
    }
    return data(event, request);
  });

  // ------------------------------------------------------------------
  // NPV2-016：贡献认定草案——消费 NPV2-015 贡献事件，输出支持/反证/
  // 缺失/替代解释/定性不确定性。每条断言必须带 evidence refs（契约层
  // 强制）；依据事件含 ACTIVITY 时存储层 409；未经人工决策不得进入
  // 正式 AttributionDecision（link-decision 要求决定已存在）。
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // NP-020：贡献认定草案服务端生成链——证据由服务端按 claim 解析，
  // 模型只做定性综合（D-02：无数值分），策略门禁先行，生成结果带
  // 模型元数据与输入哈希，供人工复核（内容在独立判断前仍被盲审掩码）。
  // ------------------------------------------------------------------
  app.post(
    "/api/v1/contribution-claims/:id/generate-assessment-draft",
    async (request, reply) => {
      requireRoles(request, "manager", "finance");
      if (!deps.modelScoring) {
        return reply.status(501).send({
          ...errorBody(
            "LLM_NOT_CONFIGURED",
            "贡献草案生成未配置模型（modelScoring）。请联系管理员。",
          ),
          meta: { correlation_id: request.id },
        });
      }
      const body = parse(generateContributionAssessmentSchema, request.body);
      const store = storeFor(request);
      const claim = await store.getClaim(idOf(request));
      const triggeredBy = requireActorRequired(
        request,
        ownPersonId(request),
        "generating an assessment draft",
      );
      // 证据由服务端解析：claim.evidenceRefs 必须全部可解析。
      const allEvidence = await store.listEvidence();
      const evidenceNodes = claim.evidenceRefs.map((ref) => {
        const node = allEvidence.find((candidate) => candidate.id === ref);
        if (!node) {
          throw new NotFoundError(`EvidenceNode ${ref} not found`);
        }
        return node;
      });
      if (evidenceNodes.length === 0) {
        throw new ConflictError(
          "INSUFFICIENT_EVIDENCE_FOR_GENERATION: claim has no resolvable evidence",
        );
      }
      // 模型供应商数据策略门禁（NP-005 同款，先于任何出境调用）。
      await assertModelProviderPolicy(
        platformStore,
        request,
        "deepseek",
        deps.modelScoring.baseUrl,
      );
      const provider = new HttpModelScoringProvider({
        baseUrl: deps.modelScoring.baseUrl,
        apiKey: deps.modelScoring.apiKey,
        model: deps.modelScoring.model,
        fetchImpl: deps.modelScoring.fetchImpl,
      });
      // claimedContribution.dimensions 是数组——直接用其值作为请求维度。
      const dimensions = claim.claimedContribution?.dimensions ?? ["QUALITY"];
      let summary;
      try {
        summary = await provider.summarise({
          dimensions,
          context: body.context,
          evidence: evidenceNodes.map((node) => ({
            ref: node.id,
            text: JSON.stringify(node.normalizedPayload),
            qualityStatus: node.qualityStatus,
            sourceSystem: node.sourceSystem,
          })),
        });
      } catch (caught) {
        const code =
          caught instanceof ModelProviderError
            ? caught.code
            : "MODEL_PROVIDER_HTTP_ERROR";
        return reply.status(502).send({
          ...errorBody(code, (caught as Error).message),
          meta: { correlation_id: request.id },
        });
      }
      recordModelUsage(
        tenantOf(request),
        summary.provider,
        summary.model,
        summary.usage,
      );
      const supporting = summary.dimensionAssessments
        .filter((item) =>
          ["SUPPORTED", "PARTIALLY_SUPPORTED"].includes(item.status),
        )
        .map((item) => ({
          statement: item.rationale,
          evidenceRefs: item.supportingEvidenceRefs,
          basis: "CLAIM" as const,
        }));
      const counter = summary.dimensionAssessments
        .filter((item) => item.status === "CONTRADICTED")
        .map((item) => ({
          statement: item.rationale,
          evidenceRefs: item.counterEvidenceRefs,
          basis: "CLAIM" as const,
        }));
      const missingInformation = summary.dimensionAssessments.flatMap(
        (item) => item.missingInformation,
      );
      const draft = await store.createContributionAssessmentDraft({
        claimId: claim.id,
        generatedByType: "AGENT",
        generatedById: triggeredBy,
        modelProvider: summary.provider,
        modelName: summary.model,
        promptVersion: "contribution-assessment-v1",
        supporting: supporting.length > 0 ? supporting : [
          {
            statement: summary.summary,
            evidenceRefs: [evidenceNodes[0]!.id],
            basis: "CLAIM",
          },
        ],
        counter,
        missingInformation,
        alternativeExplanations: [],
        uncertainty: {
          band: summary.uncertainty.band,
          reasons: summary.uncertainty.reasons,
        },
        basedOnEventIds: [],
      });
      countEvent("contribution_assessment_draft_generated");
      return reply.status(201).send(data(draft, request));
    },
  );

  app.post("/api/v1/contribution-assessment-drafts", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createContributionAssessmentDraftSchema, request.body);
    // AUD-008：来源由执行上下文注入——person 会话只能提交 USER 草稿；
    // AGENT 草稿只能由服务主体（无 person 声明的机器调用）产生，
    // 且 provider/model 元数据不得由客户端自报为 AGENT 来源。
    const actorPersonId = ownPersonId(request);
    if (actorPersonId && body.generatedByType === "AGENT") {
      throw new ForbiddenError(
        "ASSESSMENT_AGENT_SOURCE_FORBIDDEN: AGENT-generated drafts are created by the service principal, not person sessions",
      );
    }
    const generatedByType = actorPersonId ? "USER" : body.generatedByType;
    // zod .default() 产生可选链；入 store 前归一为必填数组
    const input = {
      ...body,
      generatedByType,
      generatedById: actorPersonId ?? body.generatedById,
      modelProvider: actorPersonId ? undefined : body.modelProvider,
      modelName: actorPersonId ? undefined : body.modelName,
      supporting: body.supporting ?? [],
      counter: body.counter ?? [],
      missingInformation: body.missingInformation ?? [],
      alternativeExplanations: body.alternativeExplanations ?? [],
      basedOnEventIds: body.basedOnEventIds ?? [],
      uncertainty: {
        band: body.uncertainty.band,
        reasons: body.uncertainty.reasons ?? [],
      },
    };
    return reply.status(201).send(
      data(
        await storeFor(request).createContributionAssessmentDraft(input),
        request,
      ),
    );
  });

  app.get("/api/v1/contribution-assessment-drafts", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const person = personFilter(request);
    const drafts = await storeFor(request).listContributionAssessmentDrafts({
      claimId: query.claimId,
      subjectPersonId: person ?? query.subjectPersonId,
      status: query.status as never,
    });
    return data(drafts, request);
  });

  app.get("/api/v1/contribution-assessment-drafts/:id", async (request) => {
    const draft = await storeFor(request).getContributionAssessmentDraft(
      idOf(request),
    );
    const person = personFilter(request);
    if (person && draft.subjectPersonId !== person) {
      throw new ForbiddenError(
        "contribution assessment draft is not visible to this person",
      );
    }
    return data(draft, request);
  });

  app.post("/api/v1/contribution-assessment-drafts/:id/submit", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await storeFor(request).submitContributionAssessmentDraft(idOf(request)),
      request,
    );
  });

  app.post("/api/v1/contribution-assessment-drafts/:id/discard", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await storeFor(request).discardContributionAssessmentDraft(idOf(request)),
      request,
    );
  });

  app.post("/api/v1/contribution-assessment-drafts/:id/link-decision", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(linkContributionAssessmentDecisionSchema, request.body);
    // 会话身份绑定：链接人必须是会话主体（平台管理员除外）。
    const own = ownPersonId(request);
    if (own && !isPrivileged(request) && requireActor(request, body.linkedBy, "link") !== own) {
      throw new ForbiddenError(
        "assessment decision link must use the authenticated identity",
      );
    }
    return data(
      await storeFor(request).linkContributionAssessmentDecision(
        idOf(request),
        body,
      ),
      request,
    );
  });

  };
}
