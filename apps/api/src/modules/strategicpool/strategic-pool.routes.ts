/**
 * 战略池域路由（NPV2-011）：
 * 战略池生命周期（创建/列表/成本评审/财务批准/激活/结算）。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { BudgetPort, IncentivePort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import type { StrategicPoolCase } from "@anari/domain";
import {
  createStrategicPoolCaseSchema,
  strategicPoolCostReviewSchema,
  strategicPoolFinanceApproveSchema,
} from "@anari/contracts";
import { formatDecimal, parseDecimal } from "@anari/policy-dsl";
import { ConflictError, NotFoundError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  data,
  idOf,
  isPlatformAdmin,
  ownPersonId,
  parse,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";

export function registerStrategicPoolRoutes(deps: {
  platformStore: BudgetPort & IncentivePort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent } = deps;
  const strategicPoolOf = async (request: FastifyRequest) => {
    const cases = await platformStore.listStrategicPoolCases(tenantOf(request));
    const record = cases.find((c) => c.id === idOf(request));
    if (!record) {
      throw new ConflictError(
        `STRATEGIC_POOL_NOT_FOUND: ${idOf(request)}`,
      );
    }
    return { record };
  };

  return async (app: FastifyInstance) => {
    app.post("/api/v1/strategic-pool-cases", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const body = parse(createStrategicPoolCaseSchema, request.body);
      if (parseDecimal(body.poolAmount) > parseDecimal(body.capAmount)) {
        throw new ConflictError(
          "STRATEGIC_POOL_EXCEEDS_CAP: poolAmount must not exceed capAmount",
        );
      }
      if (body.budgetPoolId) {
        const pool = await platformStore.getBudgetPool(
          tenantOf(request),
          body.budgetPoolId,
        );
        if (pool.status !== "APPROVED") {
          throw new ConflictError(
            `BUDGET_POOL_NOT_APPROVED: pool is ${pool.status}`,
          );
        }
        const available =
          parseDecimal(pool.approvedAmount) - parseDecimal(pool.committedAmount);
        if (parseDecimal(body.poolAmount) > available) {
          throw new ConflictError(
            "STRATEGIC_POOL_EXCEEDS_BUDGET: poolAmount exceeds the budget pool's uncommitted amount",
          );
        }
      }
      return reply.status(201).send(
        data(
          await platformStore.createStrategicPoolCase({
            tenantId: tenantOf(request),
            ...body,
          }),
          request,
        ),
      );
    });

    app.get("/api/v1/strategic-pool-cases", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.listStrategicPoolCases(tenantOf(request)),
        request,
      );
    });

    async function strategicPoolOf(
      request: FastifyRequest,
    ): Promise<{ record: StrategicPoolCase }> {
      const records = await platformStore.listStrategicPoolCases(
        tenantOf(request),
      );
      const record = records.find((candidate) => candidate.id === idOf(request));
      if (!record) {
        throw new NotFoundError(`StrategicPoolCase ${idOf(request)} not found`);
      }
      return { record };
    }

    app.post("/api/v1/strategic-pool-cases/:id/cost-review", async (request) => {
      requireRoles(request, "finance");
      const body = parse(strategicPoolCostReviewSchema, request.body);
      const { record } = await strategicPoolOf(request);
      if (record.status !== "DRAFT") {
        throw new ConflictError(
          `STRATEGIC_POOL_NOT_DRAFT: case is ${record.status}`,
        );
      }
      const total = parseDecimal(body.unitStandardCost) * BigInt(body.units);
      const updated = await platformStore.updateStrategicPoolCase({
        tenantId: tenantOf(request),
        caseId: record.id,
        patch: {
          units: body.units,
          unitStandardCost: body.unitStandardCost,
          totalStandardCost: formatDecimal(total),
          transferPricingRef: body.transferPricingRef,
          costReviewedBy: body.reviewedBy,
          costReviewedAt: new Date().toISOString(),
          status: "COST_REVIEWED",
        },
      });
      countEvent("strategic_pool_cost_reviewed");
      return data(updated, request);
    });

    app.post("/api/v1/strategic-pool-cases/:id/finance-approve", async (request) => {
      requireRoles(request, "admin", "finance");
      const body = parse(strategicPoolFinanceApproveSchema, request.body);
      // NPV2-003：财务批准人必须是会话主体（平台管理员除外）。
      const approverOwn = ownPersonId(request);
      if (approverOwn && !isPlatformAdmin(request) && body.approvedBy !== approverOwn) {
        throw new ForbiddenError(
          "strategic pool approval must use the authenticated identity",
        );
      }
      const { record } = await strategicPoolOf(request);
      if (record.status !== "COST_REVIEWED") {
        throw new ConflictError(
          `STRATEGIC_POOL_NOT_COST_REVIEWED: case is ${record.status}`,
        );
      }
      if (body.approvedBy === record.requestedBy) {
        throw new ConflictError(
          "STRATEGIC_POOL_SELF_APPROVAL: finance approver must differ from the requester",
        );
      }
      if (parseDecimal(record.poolAmount) > parseDecimal(record.capAmount)) {
        throw new ConflictError("STRATEGIC_POOL_EXCEEDS_CAP");
      }
      const updated = await platformStore.updateStrategicPoolCase({
        tenantId: tenantOf(request),
        caseId: record.id,
        patch: {
          financeApprovedBy: body.approvedBy,
          financeApprovedAt: new Date().toISOString(),
          deferredInstallmentMonths: body.deferredInstallmentMonths,
          status: "FINANCE_APPROVED",
        },
      });
      countEvent("strategic_pool_finance_approved");
      return data(updated, request);
    });

    app.post("/api/v1/strategic-pool-cases/:id/activate", async (request) => {
      requireRoles(request, "admin", "finance");
      const { record } = await strategicPoolOf(request);
      if (record.status !== "FINANCE_APPROVED") {
        throw new ConflictError(
          `STRATEGIC_POOL_NOT_FINANCE_APPROVED: case is ${record.status}`,
        );
      }
      const updated = await platformStore.updateStrategicPoolCase({
        tenantId: tenantOf(request),
        caseId: record.id,
        patch: {
          status: "ACTIVE",
          activatedAt: new Date().toISOString(),
        },
      });
      countEvent("strategic_pool_activated");
      return data(updated, request);
    });

    app.post("/api/v1/strategic-pool-cases/:id/settle", async (request) => {
      requireRoles(request, "finance");
      const { record } = await strategicPoolOf(request);
      if (record.status !== "ACTIVE") {
        throw new ConflictError(
          `STRATEGIC_POOL_NOT_ACTIVE: case is ${record.status}`,
        );
      }
      const updated = await platformStore.updateStrategicPoolCase({
        tenantId: tenantOf(request),
        caseId: record.id,
        patch: {
          status: "SETTLED",
          settledAt: new Date().toISOString(),
        },
      });
      countEvent("strategic_pool_settled");
      return data(updated, request);
    });
  };
}
