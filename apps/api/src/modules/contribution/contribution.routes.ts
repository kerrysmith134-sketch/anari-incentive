/**
 * 贡献申报与佐证域路由（NPV2-011 第三片）：
 * 贡献申报生命周期、佐证（attestation）登记/撤回。
 * 行为与拆分前等价。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { DirectoryPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import {
  contributionEventBatchSchema,
  contributionEventFilterSchema,
  createContributionAssessmentDraftSchema,
  createContributionAttestationSchema,
  createContributionClaimSchema,
  createContributionEventSchema,
  linkContributionAssessmentDecisionSchema,
  withdrawContributionAttestationSchema,
} from "@anari/contracts";
import { ConflictError, NotFoundError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  data,
  idOf,
  isPrivileged,
  ownPersonId,
  parse,
  personFilter,
  requireRoles,
  tenantOf,
  requireActor,
} from "../../http-helpers.js";

export function registerContributionRoutes(deps: {
  platformStore: DirectoryPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
}): FastifyPluginAsync {
  const { platformStore, storeFor } = deps;
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
    const body = parse(createContributionEventSchema, request.body);
    const person = personFilter(request);
    if (person && body.subjectPersonId !== person) {
      throw new ForbiddenError(
        "cannot record a contribution event for another person",
      );
    }
    const result = await storeFor(request).ingestContributionEvents([
      { ...body, evidenceRefs: body.evidenceRefs ?? [] },
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
  app.post("/api/v1/contribution-assessment-drafts", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createContributionAssessmentDraftSchema, request.body);
    // zod .default() 产生可选链；入 store 前归一为必填数组
    const input = {
      ...body,
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
