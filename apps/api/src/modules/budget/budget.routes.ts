/**
 * 预算与财务域路由（自由裁量评审/预算释放/现金门禁/财务事实）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { AccountingPeriodChangeRequest } from "@anari/domain";
import type { BudgetPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import {
  closeAccountingPeriodSchema,
  createCashGateInputSchema,
  decideAccountingPeriodChangeSchema,
  createDiscretionaryPoolReviewSchema,
  createFinancialFactSchema,
  reopenAccountingPeriodSchema,
  replaceAccountingPeriodApproversSchema,
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
import { registerFinancialSubledgerRoutes } from "./financial-subledger.routes.js";

export function registerBudgetRoutes(deps: {
  platformStore: BudgetPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
}): FastifyPluginAsync {
  const { platformStore, storeFor } = deps;
  return async (app: FastifyInstance) => {
  type PeriodNotificationInput = {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
    idempotencyKey?: string;
  };

  function createNotificationFor(request: FastifyRequest) {
    const store = storeFor(request);
    // 现有 IncentiveStore.createNotification 已支持 idempotencyKey（AUD-011），
    // 但接口签名未暴露；这里按实现签名收窄，避免重复提交产生重复通知。
    return store.createNotification.bind(store) as (
      input: PeriodNotificationInput,
    ) => Promise<unknown>;
  }

  async function notifyPeriodApprovers(
    request: FastifyRequest,
    change: AccountingPeriodChangeRequest,
  ): Promise<void> {
    try {
      const { approvers } =
        await platformStore.listEffectiveAccountingPeriodApprovers(
          tenantOf(request),
        );
      const notify = createNotificationFor(request);
      for (const approver of approvers) {
        if (approver.personId === change.requestedBy) continue;
        await notify({
          recipientPersonId: approver.personId,
          audience: "PERSON",
          title: `会计期间${change.action === "CLOSE" ? "关闭" : "重开"}待审批`,
          body:
            `请求 ${change.id}：法人 ${change.legalEntityId}，期间 ${change.period}，` +
            `动作 ${change.action}。请复核后批准或驳回。`,
          sourceType: "ACCOUNTING_PERIOD_APPROVAL",
          sourceId: change.id,
          idempotencyKey: `accounting-period-approval:${change.id}:${approver.personId}`,
        });
      }
    } catch (error) {
      // 通知是 best-effort：目录缺失/回退为空都不能阻断期间变更请求。
      console.error(
        "[accounting-period] approver notification failed",
        error,
      );
    }
  }

  async function notifyPeriodRequester(
    request: FastifyRequest,
    change: AccountingPeriodChangeRequest,
    decision: "APPROVE" | "REJECT",
    note?: string,
  ): Promise<void> {
    try {
      const notify = createNotificationFor(request);
      await notify({
        recipientPersonId: change.requestedBy,
        audience: "PERSON",
        title:
          decision === "APPROVE"
            ? "会计期间变更已批准"
            : "会计期间变更已驳回",
        body:
          `请求 ${change.id}（法人 ${change.legalEntityId}，期间 ${change.period}，` +
          `动作 ${change.action}）${decision === "APPROVE" ? "已批准并执行" : "已被驳回"}。` +
          (note ? `审批意见：${note}` : ""),
        sourceType: "ACCOUNTING_PERIOD_APPROVAL_RESULT",
        sourceId: change.id,
        idempotencyKey: `accounting-period-decision:${change.id}`,
      });
    } catch (error) {
      console.error(
        "[accounting-period] requester notification failed",
        error,
      );
    }
  }

  // 迁移 111：财务子账路由（发票/收款/退款/冲销/FX 重估/子账回读）。
  app.register(registerFinancialSubledgerRoutes({ platformStore }));
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
          documentType: body.documentType,
          documentId: body.documentId,
          relatedFactId: body.relatedFactId,
          fxRate: body.fxRate,
          functionalCurrency: body.functionalCurrency,
          functionalAmount: body.functionalAmount,
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

  // 迁移 113：会计期间审批人目录。空目录（或全部失效）时回退到
  // 租户内 admin/finance 角色人员，GET 用 source 字段说明当前来源。
  app.get("/api/v1/accounting-period-approvers", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    return data(
      await platformStore.listEffectiveAccountingPeriodApprovers(
        tenantOf(request),
      ),
      request,
    );
  });

  app.put("/api/v1/accounting-period-approvers", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = parse(replaceAccountingPeriodApproversSchema, request.body);
    const tenantId = tenantOf(request);
    const actor = request.authContext?.personId;
    const resolution = await platformStore.replaceAccountingPeriodApprovers({
      tenantId,
      personIds: body.personIds,
      updatedBy: actor,
    });
    try {
      await storeFor(request).recordAuditEvent?.({
        actorType: "USER",
        actorId: actor,
        action: "ACCOUNTING_PERIOD_APPROVERS_REPLACED",
        objectType: "ACCOUNTING_PERIOD_APPROVER_DIRECTORY",
        objectId: tenantId,
        reason: resolution.approvers
          .map((approver) => approver.personId)
          .join(","),
      });
    } catch {
      /* audit is best-effort */
    }
    return data(resolution, request);
  });

  app.post("/api/v1/accounting-periods/close", async (request, reply) => {
    requireRoles(request, "finance", "admin");
    const body = parse(closeAccountingPeriodSchema, request.body);
    const actor = requireActorRequired(
      request,
      body.actorPersonId,
      "request accounting period close",
    );
    const change = await platformStore.createAccountingPeriodChangeRequest({
      tenantId: tenantOf(request),
      legalEntityId: body.legalEntityId,
      period: body.period,
      action: "CLOSE",
      requestedBy: actor,
      reason: body.reason,
    });
    await notifyPeriodApprovers(request, change);
    return reply.status(202).send(data(change, request));
  });

  app.post("/api/v1/accounting-periods/reopen", async (request, reply) => {
    requireRoles(request, "finance", "admin");
    const body = parse(reopenAccountingPeriodSchema, request.body);
    const actor = requireActorRequired(
      request,
      body.actorPersonId,
      "request accounting period reopen",
    );
    const change = await platformStore.createAccountingPeriodChangeRequest({
      tenantId: tenantOf(request),
      legalEntityId: body.legalEntityId,
      period: body.period,
      action: "REOPEN",
      requestedBy: actor,
      reason: body.reason,
      reopeningRef: body.reopeningRef,
    });
    await notifyPeriodApprovers(request, change);
    return reply.status(202).send(data(change, request));
  });

  app.get("/api/v1/accounting-periods/change-requests", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    const query = request.query as {
      legalEntityId?: string;
      period?: string;
      status?: string;
    };
    const status =
      query.status === "PENDING" ||
      query.status === "APPROVED" ||
      query.status === "REJECTED"
        ? query.status
        : undefined;
    return data(
      await platformStore.listAccountingPeriodChangeRequests(
        tenantOf(request),
        {
          legalEntityId: query.legalEntityId,
          period: query.period,
          status,
        },
      ),
      request,
    );
  });

  app.post("/api/v1/accounting-periods/change-requests/:id/decide", async (request) => {
      requireRoles(request, "finance", "admin");
      const body = parse(decideAccountingPeriodChangeSchema, request.body);
      const approver = requireActorRequired(
        request,
        body.approverPersonId,
        "decide accounting period change",
      );
      const result = await platformStore.decideAccountingPeriodChange({
        tenantId: tenantOf(request),
        requestId: idOf(request),
        approverPersonId: approver,
        decision: body.decision,
        note: body.note,
      });
      await notifyPeriodRequester(
        request,
        result.request,
        body.decision,
        body.note,
      );
      try {
        await storeFor(request).recordAuditEvent?.({
          actorType: "USER",
          actorId: approver,
          action:
            body.decision === "APPROVE"
              ? `ACCOUNTING_PERIOD_${result.request.action}ED`
              : "ACCOUNTING_PERIOD_CHANGE_REJECTED",
          objectType: "ACCOUNTING_PERIOD_CHANGE_REQUEST",
          objectId: result.request.id,
          reason: `${result.request.legalEntityId}/${result.request.period}: ${body.note ?? ""}`,
        });
      } catch {
        /* audit is best-effort */
      }
      return data(result, request);
  });

  app.get("/api/v1/financial-facts", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      factType?: string;
      sourceSystem?: string;
      legalEntityId?: string;
      accountingPeriod?: string;
      recognitionStatus?: string;
    };
    const recognitionStatus =
      query.recognitionStatus === "POSTED" || query.recognitionStatus === "DRAFT"
        ? query.recognitionStatus
        : undefined;
    return data(
      await platformStore.listFinancialFacts(tenantOf(request), {
        factType: query.factType,
        sourceSystem: query.sourceSystem,
        legalEntityId: query.legalEntityId,
        accountingPeriod: query.accountingPeriod,
        recognitionStatus,
      }),
      request,
    );
  });
  };
}
