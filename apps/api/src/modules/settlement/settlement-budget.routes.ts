/**
 * 结算与预算池域路由（NPV2-011 第十片）：
 * 结算批次 CRUD/命令、预算池 CRUD/审批/分配。脱敏与审批消费由 deps 注入。
 * 行为与拆分前等价。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { createSettlementBatchSchema, settlementCommandSchema } from "@anari/contracts";
import {
  approveBudgetPoolSchema,
  createBudgetAllocationSchema,
  createBudgetPoolSchema,
} from "@anari/contracts";
import { ConflictError, NotFoundError } from "../../store.js";
import {
  data,
  idOf,
  ownPersonId,
  parse,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";

export interface SettlementDeps {
  platformStore: PlatformStore;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  notifyBestEffort: (
    store: IncentiveStore,
    input: {
      recipientPersonId?: string;
      audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
      title: string;
      body: string;
      sourceType?: string;
      sourceId?: string;
    },
  ) => Promise<void>;
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
  assertExportDlp: (
    request: FastifyRequest,
    csv: string,
    targetType: string,
    targetId: string,
    approvalRequestId?: string,
  ) => Promise<void>;
  fieldPoliciesFor: (
    request: FastifyRequest,
  ) => Promise<Record<string, unknown> | undefined>;
  fieldMatchContextFor: (
    request: FastifyRequest,
    policies: Record<string, unknown> | undefined,
  ) => Promise<unknown>;
  redactSettlementBatchFields: (
    batch: unknown,
    viewer: unknown,
  ) => unknown;
  assertExportAllowed: (request: FastifyRequest) => void;
}

export function registerSettlementRoutes(deps: SettlementDeps): FastifyPluginAsync {
  const {
    platformStore,
    storeFor,
    countEvent,
    notifyBestEffort,
    ensureApproval,
    consumeApprovalForAction,
    assertExportDlp,
    fieldPoliciesFor,
    fieldMatchContextFor,
    redactSettlementBatchFields,
    assertExportAllowed,
  } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/settlement-batches", async (request, reply) => {
      requireRoles(request, "finance");
      const body = parse(createSettlementBatchSchema, request.body);
      const store = storeFor(request);
      const batch = await store.createSettlementBatch(body);
      if (batch.kind === "RECOVERY") {
        const lines = await store.listSettlementLines(batch.id);
        const affected = [
          ...new Set(
            lines
              .filter((line) => Number(line.amount) < 0)
              .map((line) => line.personId),
          ),
        ];
        for (const personId of affected) {
          await notifyBestEffort(store, {
            recipientPersonId: personId,
            audience: "PERSON",
            title: "Recovery settlement requires confirmation",
            body: `Batch ${batch.batchNo} contains a negative adjustment; please review and confirm or object.`,
            sourceType: "SETTLEMENT_BATCH",
            sourceId: batch.id,
          });
        }
      }
      return reply.status(201).send(data(batch, request));
    });

    app.get("/api/v1/settlement-batches", async (request) => {
      requireRoles(request, "manager", "finance");
      const batches = await storeFor(request).listSettlementBatches();
      const roles = request.authContext?.roles ?? [];
      if (roles.includes("admin")) return data(batches, request);
      const policies = await fieldPoliciesFor(request);
      const matchContext = await fieldMatchContextFor(request, policies);
      const personId = ownPersonId(request);
      return data(
        batches.map((batch) =>
          redactSettlementBatchFields(batch, {
            personId,
            roles,
            policies,
            matchContext,
          }),
        ),
        request,
      );
    });

    app.get("/api/v1/settlement-batches/:id", async (request) => {
      requireRoles(request, "manager", "finance");
      const batch = await storeFor(request).getSettlementBatch(idOf(request));
      const roles = request.authContext?.roles ?? [];
      if (roles.includes("admin")) return data(batch, request);
      const policies = await fieldPoliciesFor(request);
      const matchContext = await fieldMatchContextFor(request, policies);
      return data(
        redactSettlementBatchFields(batch, {
          personId: ownPersonId(request),
          roles,
          policies,
          matchContext,
        }),
        request,
      );
    });

    app.post("/api/v1/settlement-batches/:id/commands", async (request) => {
      requireRoles(request, "finance");
      // A malformed id used to reach Postgres as a uuid literal and surface as a
      // 500; treat it as a missing batch instead.
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          idOf(request),
        )
      ) {
        throw new NotFoundError(`SettlementBatch ${idOf(request)} not found`);
      }
      const body = parse(settlementCommandSchema, request.body);
      if (body.command === "EXPORT") assertExportAllowed(request);
      const store = storeFor(request);
      if (body.command === "APPROVE" || body.command === "LOCK") {
        const actionType =
          body.command === "APPROVE"
            ? "SETTLEMENT_APPROVE"
            : "SETTLEMENT_LOCK";
        await ensureApproval(request, actionType, body.approvalRequestId);
        if (body.approvalRequestId) {
          await consumeApprovalForAction(request, {
            approvalRequestId: body.approvalRequestId,
            actionType,
            targetType: "SETTLEMENT_BATCH",
            targetId: idOf(request),
          });
        }
      } else if (body.approvalRequestId) {
        throw new ConflictError(
          "APPROVAL_NOT_APPLICABLE: only APPROVE and LOCK consume approvals",
        );
      }
      const result = await store.commandSettlementBatch(idOf(request), body);
      if (body.command === "EXPORT" && result.csv) {
        await assertExportDlp(
          request,
          result.csv,
          "SETTLEMENT_BATCH",
          idOf(request),
          body.approvalRequestId,
        );
      }
      countEvent(`settlement_${body.command.toLowerCase()}`);
      if (body.command === "REQUIRE_ADJUSTMENT") {
        await notifyBestEffort(store, {
          audience: "FINANCE",
          title: "Settlement adjustment required",
          body: body.reason ?? `Batch ${result.batch.batchNo} needs correction.`,
          sourceType: "SETTLEMENT_BATCH",
          sourceId: result.batch.id,
        });
      }
      return data(result, request);
    });





    app.post("/api/v1/budget-pools", async (request, reply) => {
      requireRoles(request, "finance");
      const body = parse(createBudgetPoolSchema, request.body);
      await storeFor(request).getEvaluationCycle(body.cycleId);
      return reply.status(201).send(
        data(
          await platformStore.createBudgetPool({
            tenantId: tenantOf(request),
            cycleId: body.cycleId,
            code: body.code,
            name: body.name,
            poolType: body.poolType,
            currency: body.currency,
            approvedAmount: body.approvedAmount,
          }),
          request,
        ),
      );
    });

    app.get("/api/v1/budget-pools", async (request) => {
      requireRoles(request, "manager", "finance");
      const query = request.query as { cycleId?: string };
      return data(
        await platformStore.listBudgetPools(
          tenantOf(request),
          query.cycleId,
        ),
        request,
      );
    });

    app.get("/api/v1/budget-pools/:id", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.getBudgetPool(tenantOf(request), idOf(request)),
        request,
      );
    });

    app.post("/api/v1/budget-pools/:id/approve", async (request) => {
      requireRoles(request, "finance");
      const body = parse(approveBudgetPoolSchema, request.body);
      return data(
        await platformStore.approveBudgetPool({
          tenantId: tenantOf(request),
          poolId: idOf(request),
          approvedBy: body.approvedBy,
        }),
        request,
      );
    });

    app.post("/api/v1/budget-pools/:id/allocations", async (request, reply) => {
      requireRoles(request, "finance");
      const body = parse(createBudgetAllocationSchema, request.body);
      const allocation = await platformStore.createBudgetAllocation({
        tenantId: tenantOf(request),
        poolId: idOf(request),
        targetType: body.targetType,
        targetId: body.targetId,
        amount: body.amount,
      });
      countEvent("budget_allocated");
      return reply.status(201).send(data(allocation, request));
    });

    app.get("/api/v1/budget-pools/:id/allocations", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.listBudgetAllocations(
          tenantOf(request),
          idOf(request),
        ),
        request,
      );
    });

  };
}
