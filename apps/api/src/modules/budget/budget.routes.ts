/**
 * 预算与财务域路由（自由裁量评审/预算释放/现金门禁/财务事实）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { BudgetPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import {
  closeAccountingPeriodSchema,
  createCashGateInputSchema,
  createDiscretionaryPoolReviewSchema,
  createFinancialFactSchema,
  reopenAccountingPeriodSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  requireActor,
  requireActorRequired,
} from "../../http-helpers.js";

export function registerBudgetRoutes(deps: {
  platformStore: BudgetPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
}): FastifyPluginAsync {
  const { platformStore, storeFor } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/budget-pools/:id/discretionary-reviews", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const body = parse(
        createDiscretionaryPoolReviewSchema,
        request.body,
      );
      return reply.status(201).send(
        data(
          await platformStore.createDiscretionaryPoolReview({
            tenantId: tenantOf(request),
            poolId: idOf(request),
            committeePersonIds: body.committeePersonIds,
            employeeObserverPersonId: body.employeeObserverPersonId,
            selectionCriteria: body.selectionCriteria,
            decisionNotes: body.decisionNotes,
            reviewedBy: requireActorRequired(
              request,
              body.reviewedBy,
              "reviewing discretionary allocation",
            ),
          }),
          request,
        ),
      );
  });

  app.get("/api/v1/budget-pools/:id/discretionary-reviews", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listDiscretionaryPoolReviews(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.get("/api/v1/discretionary-pool-reviews", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.listDiscretionaryPoolReviews(tenantOf(request)),
      request,
    );
  });
  app.post("/api/v1/budget-allocations/:id/release", async (request) => {
    requireRoles(request, "finance");
    return data(
      await platformStore.releaseBudgetAllocation({
        tenantId: tenantOf(request),
        allocationId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/cash-gate-inputs", async (request, reply) => {
    requireRoles(request, "finance");
    const body = parse(createCashGateInputSchema, request.body);
    await storeFor(request).getEvaluationCycle(body.cycleId);
    return reply.status(201).send(
      data(
        await platformStore.createCashGateInput({
          tenantId: tenantOf(request),
          cycleId: body.cycleId,
          asOfDate: body.asOfDate,
          safetyReserveMonths: body.safetyReserveMonths,
          thirteenWeekForecastRef: body.thirteenWeekForecastRef,
          passesGate: body.passesGate,
          approvedBy: requireActorRequired(request, body.approvedBy, "approve"),
          approvedAt: body.approvedAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/cash-gate-inputs", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { cycleId?: string };
    return data(
      await platformStore.listCashGateInputs(
        tenantOf(request),
        query.cycleId,
      ),
      request,
    );
  });

  app.post("/api/v1/financial-facts", async (request, reply) => {
    // INT-210：同步 worker 使用 integration 角色写财务事实（审计授权边界）。
    requireRoles(request, "finance", "integration");
    const body = parse(createFinancialFactSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createFinancialFact({
          tenantId: tenantOf(request),
          sourceSystem: body.sourceSystem,
          sourceRecordId: body.sourceRecordId,
          factType: body.factType,
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          amount: body.amount,
          currency: body.currency,
          qualityStatus: body.qualityStatus ?? "UNVERIFIED",
          sourceUpdatedAt: body.sourceUpdatedAt,
          payload: body.payload ?? {},
          legalEntityId: body.legalEntityId,
          orderId: body.orderId,
          contractRef: body.contractRef,
          instrumentType: body.instrumentType,
          recognitionStatus: body.recognitionStatus,
          accountingPeriod: body.accountingPeriod,
          fxSnapshot: body.fxSnapshot,
          sourceVersion: body.sourceVersion,
          reversalOf: body.reversalOf,
          reopeningRef: body.reopeningRef,
        }),
        request,
      ),
    );
  });

  // ------------------------------------------------------------------
  // Sprint 5（2026-11-21 审计）：会计期间关闭/重开。
  // 关闭后 POSTED 财务事实写入被拒绝；重开必须带凭证号，且后续 POSTED
  // 事实必须携带同一 reopeningRef。
  // ------------------------------------------------------------------
  app.get("/api/v1/accounting-periods", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    const query = request.query as { legalEntityId?: string; period?: string };
    return data(
      await platformStore.listAccountingPeriods(tenantOf(request), {
        legalEntityId: query.legalEntityId,
        period: query.period,
      }),
      request,
    );
  });

  app.post("/api/v1/accounting-periods/close", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = parse(closeAccountingPeriodSchema, request.body);
    const actor = requireActorRequired(
      request,
      body.actorPersonId,
      "close accounting period",
    );
    const closed = await platformStore.closeAccountingPeriod({
      tenantId: tenantOf(request),
      legalEntityId: body.legalEntityId,
      period: body.period,
      actorPersonId: actor,
      reason: body.reason,
    });
    try {
      await storeFor(request).recordAuditEvent?.({
        actorType: "USER",
        actorId: actor,
        action: "ACCOUNTING_PERIOD_CLOSED",
        objectType: "ACCOUNTING_PERIOD",
        objectId: `${body.legalEntityId}/${body.period}`,
        reason: body.reason,
      });
    } catch {
      /* audit is best-effort */
    }
    return data(closed, request);
  });

  app.post("/api/v1/accounting-periods/reopen", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = parse(reopenAccountingPeriodSchema, request.body);
    const actor = requireActorRequired(
      request,
      body.actorPersonId,
      "reopen accounting period",
    );
    const reopened = await platformStore.reopenAccountingPeriod({
      tenantId: tenantOf(request),
      legalEntityId: body.legalEntityId,
      period: body.period,
      actorPersonId: actor,
      reopeningRef: body.reopeningRef,
      reason: body.reason,
    });
    try {
      await storeFor(request).recordAuditEvent?.({
        actorType: "USER",
        actorId: actor,
        action: "ACCOUNTING_PERIOD_REOPENED",
        objectType: "ACCOUNTING_PERIOD",
        objectId: `${body.legalEntityId}/${body.period}`,
        reason: `${body.reopeningRef}: ${body.reason}`,
      });
    } catch {
      /* audit is best-effort */
    }
    return data(reopened, request);
  });

  app.get("/api/v1/financial-facts", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      factType?: string;
      sourceSystem?: string;
    };
    return data(
      await platformStore.listFinancialFacts(tenantOf(request), {
        factType: query.factType,
        sourceSystem: query.sourceSystem,
      }),
      request,
    );
  });
  };
}
