/**
 * 评估周期域路由（NPV2-011）：
 * 周期管理、预审、草稿、决定。行为与拆分前等价。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ModelgovPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import { randomUUID } from "node:crypto";
import { sha256 } from "@anari/policy-dsl";
import { preReviewSchema } from "@anari/contracts";
import { data, idOf, parse, requireRoles, tenantOf } from "../../http-helpers.js";

export function registerEvaluationRoutes(deps: {
  platformStore: ModelgovPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/evaluation-cycles/:id/pre-review", async (request) => {
      requireRoles(request, "manager", "admin");
      const body = parse(preReviewSchema, request.body);
      const store = storeFor(request);
      const cycle = await store.getEvaluationCycle(idOf(request));
      const windowStart = Date.parse(cycle.startsAt);
      const windowEnd = Date.parse(cycle.endsAt);

      // 参与人：周期窗口内提交过申报的人（或显式指定）。
      const claims = await store.listClaims();
      const claimByPerson = new Map<string, number>();
      for (const claim of claims) {
        const at = Date.parse(claim.createdAt);
        if (at < windowStart || at > windowEnd) continue;
        claimByPerson.set(
          claim.claimantPersonId,
          (claimByPerson.get(claim.claimantPersonId) ?? 0) + 1,
        );
      }
      const personIds =
        body.personIds && body.personIds.length > 0
          ? body.personIds
          : [...claimByPerson.keys()];
      if (personIds.length === 0) {
        return data(
          { created: [], skipped: [], note: "周期窗口内没有申报人，无可预审对象" },
          request,
        );
      }

      // 幂等：同一周期同一人只生成一次 AGENT 草稿。
      const existingDrafts = await store.listEvaluationDrafts({ cycleId: cycle.id });
      const alreadyDone = new Set(
        existingDrafts
          .filter((draft) => draft.generatedByType === "AGENT")
          .map((draft) => draft.personId),
      );

      const evidence = await store.listEvidence();
      const created: Array<Record<string, unknown>> = [];
      const skipped: Array<{ personId: string; reason: string }> = [];
      const timestamp = new Date().toISOString();
      for (const personId of personIds) {
        if (alreadyDone.has(personId)) {
          skipped.push({ personId, reason: "ALREADY_PRE_REVIEWED" });
          continue;
        }
        // 证据：主体为本人，或主体为其参与的工作包。
        const ownEvidence = evidence.filter(
          (node) =>
            (node.subjectType === "PERSON" && node.subjectId === personId) ||
            (node.subjectType === "WORK_PACKAGE" &&
              claimByPerson.has(personId) === true &&
              node.normalizedPayload?.workPackageId === personId),
        );
        const verifiedCount = ownEvidence.filter(
          (node) => node.qualityStatus === "VALID",
        ).length;
        const dimensions = ["QUALITY", "TIMELINESS", "COLLABORATION"];
        const strengths = verifiedCount >= 2
          ? ["已验收交付并附有效证据", "贡献链路完整可追溯"]
          : [];
        const missingInformation =
          verifiedCount === 0
            ? ["缺少已验证证据：所有维度需人工核定"]
            : dimensions.filter(
                (_, index) => index >= Math.min(verifiedCount, dimensions.length),
              ).map((dimension) => `${dimension} 维度证据不足`);
        const snapshot = {
          personId,
          cycleId: cycle.id,
          claims: claimByPerson.get(personId) ?? 0,
          evidenceCount: ownEvidence.length,
          verifiedCount,
          generatedAt: timestamp,
        };
        const snapshotHash = sha256(snapshot);
        const draft = await store.createEvaluationDraft({
          cycleId: cycle.id,
          personId,
          generatedByType: "AGENT",
          modelProvider: "builtin",
          modelName: "evidence-coverage-v1",
          promptVersion: "pre-review-v1",
          evidenceSnapshotHash: snapshotHash,
          draftPayload: snapshot,
          strengths,
          counterEvidence: [],
          missingInformation,
          uncertainty: {
            confidence: verifiedCount >= 2 ? 0.8 : 0.3,
            basis: "evidence-coverage",
          },
        });
        await platformStore.createAiSuggestion({
          tenantId: tenantOf(request),
          agentTaskId: randomUUID(),
          targetType: "EVALUATION_DRAFT",
          targetId: draft.id,
          suggestionType: "PRE_REVIEW_DRAFT",
          modelProvider: "builtin",
          modelName: "evidence-coverage-v1",
          promptVersion: "pre-review-v1",
          inputHash: snapshotHash,
          outputJson: {
            draftId: draft.id,
            personId,
            evidenceCount: ownEvidence.length,
            verifiedCount,
          },
          validationStatus: "VALIDATED",
        });
        countEvent("pre_review_draft_generated");
        created.push({
          draftId: draft.id,
          personId,
          evidenceCount: ownEvidence.length,
          verifiedCount,
          strengths,
          missingInformation,
        });
      }
      return data({ created, skipped }, request);
    });

  };
}
