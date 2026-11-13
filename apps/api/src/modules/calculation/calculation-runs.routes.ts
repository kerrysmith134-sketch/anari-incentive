/**
 * 计算域路由（计算运行全生命周期/摄取直算/数据质量）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  approveCalculationRunSchema,
  createCalculationBatchSchema,
  createCalculationRunSchema,
  createDataQualityIssueSchema,
  dataQualityCommandSchema,
  lockCalculationRunSchema,
  runsFromIngestionSchema,
} from "@anari/contracts";
import type { CalculationRun } from "@anari/domain";
import type { FieldAccessPolicy } from "@anari/contracts";
import { CalculationBlockedError } from "../../store.js";
import type { CreateCalculationRunInput } from "@anari/contracts";
import { notifyBestEffort } from "../../notify.js";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  personFilter,
} from "../../http-helpers.js";

function redactRunForPerson(
  run: CalculationRun,
  person: string,
): CalculationRun {
  return {
    ...run,
    inputSnapshot: {
      ...run.inputSnapshot,
      order: {
        id: run.inputSnapshot.order.id,
        grossProfit: "REDACTED",
        currency: run.inputSnapshot.order.currency,
      },
      participants: run.inputSnapshot.participants.filter(
        (participant) => participant.personId === person,
      ),
    },
    lines: run.lines
      .filter((line) => line.personId === person)
      .map((line) => ({ ...line, trace: {} })),
  };
}

export function registerCalculationRoutes(deps: {
  platformStore: PlatformStore;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  ensureApproval: (
    request: FastifyRequest,
    actionType: string,
    approvalRequestId?: string,
  ) => Promise<void>;
  consumeApprovalForAction: (
    request: FastifyRequest,
    input: {
      approvalRequestId: string;
      actionType: string;
      targetType: string;
      targetId: string;
    },
  ) => Promise<void>;
  preflightBudget: (
    request: FastifyRequest,
    input: CreateCalculationRunInput,
  ) => Promise<void>;
  reserveRunBudget: (
    request: FastifyRequest,
    input: CreateCalculationRunInput,
    run: CalculationRun,
  ) => Promise<void>;
  enforceBudgetPools?: boolean;
  fieldPoliciesFor: (
    request: FastifyRequest,
  ) => Promise<Record<string, unknown> | undefined>;
  fieldMatchContextFor: (
    request: FastifyRequest,
    policies: Record<string, unknown> | undefined,
  ) => Promise<unknown>;
  redactCalculationRunFields: (
    run: unknown,
    viewer: {
      roles: string[];
      policies?: Record<string, unknown>;
      matchContext?: unknown;
    },
  ) => unknown;
  formalCoverageBlockers: (
    request: FastifyRequest,
    policyVersionId: string,
  ) => Promise<string[]>;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, ensureApproval, consumeApprovalForAction, preflightBudget, reserveRunBudget, enforceBudgetPools, fieldPoliciesFor, fieldMatchContextFor, redactCalculationRunFields, formalCoverageBlockers } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/data-quality-issues", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(createDataQualityIssueSchema, request.body);
    return reply
      .status(201)
      .send(data(await storeFor(request).createDataQualityIssue(body), request));
  });

  app.get("/api/v1/data-quality-issues", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { status?: string };
    return data(
      await storeFor(request).listDataQualityIssues({ status: query.status }),
      request,
    );
  });

  app.get("/api/v1/data-quality-issues/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await storeFor(request).getDataQualityIssue(idOf(request)),
      request,
    );
  });

  app.post("/api/v1/data-quality-issues/:id/commands", async (request) => {
    requireRoles(request, "manager");
    const body = parse(dataQualityCommandSchema, request.body);
    const store = storeFor(request);
    const issue = await store.commandDataQualityIssue(idOf(request), body);
    if (body.command === "ASSIGN" && body.assignedTo) {
      await notifyBestEffort(store, {
        recipientPersonId: body.assignedTo,
        audience: "PERSON",
        title: "Data-quality issue assigned",
        body: `${issue.issueCode} on ${issue.objectType} needs follow-up.`,
        sourceType: "DATA_QUALITY_ISSUE",
        sourceId: issue.id,
      });
    }
    return data(issue, request);
  });

  // AI-04 草稿生成 workflow：确定性证据覆盖预审。
  // AI 只产草稿（无分数）；决策必须人工作出（store 层强制）。

  // 周期推进状态机（AI_PRE_REVIEW→HUMAN_REVIEW 与 HUMAN_REVIEW→DECIDED 带门禁）。
  // 结算单 HTML（打印即 PDF，中文）。
  app.post("/api/v1/calculation-runs:from-ingestion", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(runsFromIngestionSchema, request.body);
    const store = storeFor(request);
    const cycle = await store.getEvaluationCycle(body.cycleId);
    const windowStart = Date.parse(cycle.startsAt);
    const windowEnd = Date.parse(cycle.endsAt);
    const evidence = (await store.listEvidence()).filter(
      (node) =>
        node.sourceSystem === body.sourceSystem &&
        node.evidenceType === body.evidenceType &&
        Date.parse(node.observedAt) >= windowStart &&
        Date.parse(node.observedAt) <= windowEnd &&
        // Parenthesised: UNVERIFIED evidence still has to match source, type
        // and observation window. The old precedence admitted every
        // UNVERIFIED node on the tenant.
        (node.qualityStatus === "VALID" ||
          node.qualityStatus === "UNVERIFIED"),
    );
    if (evidence.length === 0) {
      return data(
        {
          created: [],
          skipped: [],
          note: "窗口内没有该来源的有效订单证据",
        },
        request,
      );
    }
    const identities = await platformStore.listExternalIdentities(
      tenantOf(request),
      { sourceSystem: body.sourceSystem },
    );
    const identityByExternal = new Map(
      identities.map((row) => [row.externalId, row.personId]),
    );
    // 幂等：同一外部订单只物化一次（按 order.id 比对既有批次）。
    const existingRuns = await store.listRuns();
    const materializedOrderIds = new Set(
      existingRuns.map((run) => run.inputSnapshot?.order?.id),
    );
    const created: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];
    for (const node of evidence) {
      const payload = node.normalizedPayload as Record<string, unknown>;
      const grossProfit = payload.grossProfit ?? payload.amount;
      if (grossProfit === undefined || grossProfit === null) {
        skipped.push({ evidenceId: node.id, reason: "NO_GROSS_PROFIT" });
        continue;
      }
      const externalId = String(
        payload.dealId ?? payload.orderId ?? payload.sourceRecordId ?? node.id,
      );
      if (materializedOrderIds.has(externalId)) {
        skipped.push({ evidenceId: node.id, reason: "ALREADY_MATERIALIZED" });
        continue;
      }
      const personId =
        identityByExternal.get(externalId) ??
        (identityByExternal.get("*") ?? undefined);
      if (!personId) {
        skipped.push({
          evidenceId: node.id,
          reason: "NO_IDENTITY_MAPPING",
          externalId,
        });
        continue;
      }
      try {
        const run = await store.createCalculationRun({
          cycleId: body.cycleId,
          policyVersionId: body.policyVersionId,
          mode: body.mode ?? "SHADOW",
          order: {
            id: externalId,
            grossProfit: String(grossProfit),
            currency: String(payload.currency ?? "CNY"),
            invoiceAmount: payload.invoiceAmount
              ? String(payload.invoiceAmount)
              : undefined,
            cashCollected: payload.cashCollected
              ? String(payload.cashCollected)
              : undefined,
            creditApproved: Boolean(payload.creditApproved ?? true),
            qualityHold: Boolean(payload.qualityHold ?? false),
            projectType: payload.projectType
              ? String(payload.projectType)
              : undefined,
          },
          participants: [
            {
              personId,
              workPackageId: node.subjectId,
              attributionWeight: String(payload.attributionWeight ?? "1"),
              role: "OWNER",
            },
          ],
        } as never);
        materializedOrderIds.add(externalId);
        created.push({
          runId: run.id,
          evidenceId: node.id,
          personId,
          resultHash: run.resultHash,
        });
      } catch (error) {
        skipped.push({
          evidenceId: node.id,
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    countEvent("runs_from_ingestion");
    return data({ created, skipped }, request);
  });
  app.post("/api/v1/calculation-runs", async (request, reply) => {
    const body = parse(createCalculationRunSchema, request.body);
    requireRoles(
      request,
      ...(body.mode === "FORMAL" ? ["finance"] : ["manager", "finance"]),
    );
    if (body.mode === "FORMAL") {
      const blockers = await formalCoverageBlockers(
        request,
        body.policyVersionId,
      );
      if (blockers.length > 0) {
        throw new CalculationBlockedError(blockers);
      }
    }
    await preflightBudget(request, body);
    const run = await storeFor(request).createCalculationRun(body);
    await reserveRunBudget(request, body, run);
    countEvent("calculation_created");
    return reply.status(201).send(data(run, request));
  });

  app.post("/api/v1/calculation-runs:batch", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(createCalculationBatchSchema, request.body);
    if (
      enforceBudgetPools &&
      body.runs.some((run) => run.mode === "FORMAL")
    ) {
      throw new ConflictError(
        "BUDGET_ENFORCEMENT_BATCH_UNSUPPORTED: create formal runs individually when budget enforcement is enabled",
      );
    }
    const blockers = new Set<string>();
    for (const run of body.runs) {
      if (run.mode !== "FORMAL") continue;
      for (const blocker of await formalCoverageBlockers(
        request,
        run.policyVersionId,
      )) {
        blockers.add(blocker);
      }
    }
    if (blockers.size > 0) {
      throw new CalculationBlockedError([...blockers]);
    }
    const runs = await storeFor(request).createCalculationRunsBatch(body.runs);
    countEvent("calculation_batch_created");
    return reply.status(201).send(data({ runs }, request));
  });

  app.get("/api/v1/calculation-runs", async (request) => {
    const runs = await storeFor(request).listRuns();
    const person = personFilter(request);
    if (person) {
      return data(
        runs
          .filter((run) =>
            run.lines.some((line) => line.personId === person),
          )
          .map((run) => redactRunForPerson(run, person)),
        request,
      );
    }
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) {
      return data(runs, request);
    }
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    return data(
      runs.map((run) =>
        redactCalculationRunFields(run, { roles, policies, matchContext }),
      ),
      request,
    );
  });

  app.get("/api/v1/calculation-runs/:id", async (request) => {
    const run = await storeFor(request).getRun(idOf(request));
    const person = personFilter(request);
    if (person) {
      if (!run.lines.some((line) => line.personId === person)) {
        throw new ForbiddenError(
          "calculation run is not visible to this person",
        );
      }
      return data(redactRunForPerson(run, person), request);
    }
    const roles = request.authContext?.roles ?? [];
    if (roles.includes("admin")) {
      return data(run, request);
    }
    const policies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, policies);
    return data(
      redactCalculationRunFields(run, { roles, policies, matchContext }),
      request,
    );
  });

  app.post("/api/v1/calculation-runs/:id/approve", async (request) => {
    requireRoles(request, "finance");
    const body = parse(approveCalculationRunSchema, request.body ?? {});
    await ensureApproval(request, "CALCULATION_APPROVE", body.approvalRequestId);
    if (body.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "CALCULATION_APPROVE",
        targetType: "CALCULATION_RUN",
        targetId: idOf(request),
      });
    }
    const approved = await storeFor(request).approveRun(idOf(request));
    countEvent("calculation_approved");
    return data(approved, request);
  });

  app.post("/api/v1/calculation-runs/:id/lock", async (request) => {
    requireRoles(request, "finance");
    const body = parse(lockCalculationRunSchema, request.body);
    await ensureApproval(request, "CALCULATION_LOCK", body.approvalRequestId);
    if (body.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "CALCULATION_LOCK",
        targetType: "CALCULATION_RUN",
        targetId: idOf(request),
      });
    }
    const locked = await storeFor(request).lockRun(idOf(request), body.confirmation);
    countEvent("calculation_locked");
    return data(locked, request);
  });
  };
}
