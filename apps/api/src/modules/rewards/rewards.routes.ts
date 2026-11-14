/**
 * 激励发放域路由（NPV2-011 第九片）：
 * 股权授予台账/修正/归属/行权 + 悬赏全生命周期。
 * 行为与拆分前等价。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { IncentivePort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import {
  acceptBountySchema,
  adjustEquityGrantSchema,
  approveEquityExerciseSchema,
  claimBountySchema,
  createBountySchema,
  createEquityExerciseSchema,
  createEquityGrantSchema,
  submitBountySchema,
} from "@anari/contracts";
import { ForbiddenError } from "@anari/auth";
import { NotFoundError } from "../../store.js";

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
import {
  data,
  idOf,
  isPlatformAdmin,
  isPrivileged,
  ownPersonId,
  parse,
  requireRoles,
  tenantOf,
  requireActor,
  requireActorRequired,
} from "../../http-helpers.js";

export function registerRewardsRoutes(deps: {
  platformStore: IncentivePort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/equity-grants", async (request, reply) => {
      requireRoles(request, "admin");
      const body = parse(createEquityGrantSchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createEquityGrant({
            tenantId: tenantOf(request),
            personId: body.personId,
            grantCode: body.grantCode,
            grantType: body.grantType,
            totalUnits: body.totalUnits,
            strikePrice: body.strikePrice,
            currency: body.currency,
            grantDate: body.grantDate,
            vestingStart: body.vestingStart,
            cliffMonths: body.cliffMonths ?? 0,
            vestingMonths: body.vestingMonths,
          }),
          request,
        ),
      );
    });

    app.get("/api/v1/equity-grants", async (request) => {
      const query = request.query as { personId?: string };
      const own = ownPersonId(request);
      if (!isPrivileged(request)) {
        if (!own) throw new ForbiddenError("员工身份缺失，无法查看本人授予");
        return data(
          (await platformStore.listEquityGrants(tenantOf(request), own)).filter(
            (grant) => grant.personId === own,
          ),
          request,
        );
      }
      return data(
        await platformStore.listEquityGrants(
          tenantOf(request),
          query.personId,
        ),
        request,
      );
    });

    app.get("/api/v1/equity-grants/:id", async (request) => {
      const grant = await platformStore.getEquityGrant(
        tenantOf(request),
        idOf(request),
      );
      if (!isPrivileged(request) && grant.personId !== ownPersonId(request)) {
        throw new ForbiddenError("只能查看本人的授予");
      }
      return data(grant, request);
    });

    // 人工修正入口：自动配股计算完成后，允许管理员在台账锁定前修正数量/价格/归属参数。
    app.post("/api/v1/equity-grants/:id/adjust", async (request) => {
      requireRoles(request, "admin");
      const body = parse(adjustEquityGrantSchema, request.body);
      const grant = await platformStore.updateEquityGrant({
        tenantId: tenantOf(request),
        grantId: idOf(request),
        patch: {
          totalUnits: body.totalUnits,
          strikePrice: body.strikePrice,
          grantDate: body.grantDate,
          vestingStart: body.vestingStart,
          cliffMonths: body.cliffMonths,
          vestingMonths: body.vestingMonths,
        },
        reason: body.reason,
        actorPersonId: ownPersonId(request),
      });
      try {
        await storeFor(request).recordAuditEvent({
          actorType: "USER",
          actorId: ownPersonId(request) ?? request.authContext?.userId,
          action: "EQUITY_GRANT_ADJUSTED",
          objectType: "EQUITY_GRANT",
          objectId: grant.id,
          reason: body.reason,
        });
      } catch {
        /* audit is best-effort for legacy stores */
      }
      countEvent("equity_grant_adjusted");
      return data(grant, request);
    });

    app.get("/api/v1/equity-grants/:id/vesting", async (request) => {
      if (!isPrivileged(request)) {
        const grant = await platformStore.getEquityGrant(
          tenantOf(request),
          idOf(request),
        );
        if (grant.personId !== ownPersonId(request)) {
          throw new ForbiddenError("只能查看本人的归属进度");
        }
      }
      const query = request.query as { asOf?: string };
      let asOf: string | undefined;
      if (query.asOf !== undefined) {
        const parsed = Date.parse(query.asOf);
        if (!Number.isFinite(parsed)) {
          throw new BadRequestError(
            "INVALID_AS_OF",
            "asOf 必须是有效日期（ISO 8601）",
          );
        }
        asOf = new Date(parsed).toISOString();
      }
      return data(
        await platformStore.getEquityVesting(
          tenantOf(request),
          idOf(request),
          asOf,
        ),
        request,
      );
    });

    app.post("/api/v1/equity-grants/:id/exercises", async (request, reply) => {
      const body = parse(createEquityExerciseSchema, request.body);
      if (!isPrivileged(request)) {
        const own = ownPersonId(request);
        if (!own || requireActor(request, body.requestedBy, "request") !== own) {
          throw new ForbiddenError("员工只能为本人发起行权");
        }
      }
      return reply.status(201).send(
        data(
          await platformStore.createEquityExercise({
            tenantId: tenantOf(request),
            grantId: idOf(request),
            units: body.units,
            requestedBy: requireActorRequired(request, body.requestedBy, "request"),
          }),
          request,
        ),
      );
    });

    app.get("/api/v1/equity-exercises", async (request) => {
      requireRoles(request, "manager", "finance");
      const query = request.query as { grantId?: string };
      return data(
        await platformStore.listEquityExercises(
          tenantOf(request),
          query.grantId,
        ),
        request,
      );
    });

    app.post("/api/v1/equity-exercises/:id/approve", async (request) => {
      requireRoles(request, "admin");
      const body = parse(approveEquityExerciseSchema, request.body);
      return data(
        await platformStore.approveEquityExercise({
          tenantId: tenantOf(request),
          exerciseId: idOf(request),
          approvedBy: requireActorRequired(request, body.approvedBy, "approve"),
        }),
        request,
      );
    });

    app.post("/api/v1/equity-exercises/:id/settle", async (request) => {
      requireRoles(request, "finance");
      return data(
        await platformStore.settleEquityExercise({
          tenantId: tenantOf(request),
          exerciseId: idOf(request),
        }),
        request,
      );
    });

    app.post("/api/v1/bounties", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const body = parse(createBountySchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createBounty({
            tenantId: tenantOf(request),
            title: body.title,
            description: body.description,
            rewardAmount: body.rewardAmount,
            currency: body.currency,
            createdBy: requireActorRequired(request, body.createdBy, "create"),
            dueAt: body.dueAt,
          }),
          request,
        ),
      );
    });

    app.get("/api/v1/bounties", async (request) => {
      // 员工可浏览悬赏列表（只读）；写操作在各自路由校验。
      const query = request.query as {
        status?: "OPEN" | "CLAIMED" | "SUBMITTED" | "ACCEPTED" | "CANCELLED";
      };
      return data(
        await platformStore.listBounties(tenantOf(request), query.status),
        request,
      );
    });

    app.get("/api/v1/bounties/:id", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.getBounty(tenantOf(request), idOf(request)),
        request,
      );
    });

    app.post("/api/v1/bounties/:id/claim", async (request) => {
      const body = parse(claimBountySchema, request.body);
      // 管理员/经理可代登记；员工只能认领给本人（悬赏自助）。
      if (!isPrivileged(request)) {
        const own = ownPersonId(request);
        if (!own || body.personId !== own) {
          throw new ForbiddenError("员工只能为本人认领悬赏");
        }
      }
      return data(
        await platformStore.claimBounty({
          tenantId: tenantOf(request),
          bountyId: idOf(request),
          personId: body.personId,
        }),
        request,
      );
    });

    app.post("/api/v1/bounties/:id/submit", async (request) => {
      const body = parse(submitBountySchema, request.body);
      if (!isPrivileged(request)) {
        const own = ownPersonId(request);
        if (!own || body.personId !== own) {
          throw new ForbiddenError("员工只能提交本人的成果");
        }
      }
      return data(
        await platformStore.submitBounty({
          tenantId: tenantOf(request),
          bountyId: idOf(request),
          personId: body.personId,
          submissionRef: body.submissionRef,
        }),
        request,
      );
    });

    app.post("/api/v1/bounties/:id/accept", async (request) => {
      requireRoles(request, "manager", "finance");
      const body = parse(acceptBountySchema, request.body);
      // NPV2-003：验收人必须是会话主体（平台管理员除外）。
      const bountyOwn = ownPersonId(request);
      if (bountyOwn && !isPlatformAdmin(request) && body.reviewerPersonId !== bountyOwn) {
        throw new ForbiddenError(
          "bounty acceptance must use the authenticated identity",
        );
      }
      return data(
        await platformStore.acceptBounty({
          tenantId: tenantOf(request),
          bountyId: idOf(request),
          reviewerPersonId: body.reviewerPersonId,
          paymentRef: body.paymentRef,
        }),
        request,
      );
    });

    app.post("/api/v1/bounties/:id/cancel", async (request) => {
      requireRoles(request, "admin");
      return data(
        await platformStore.cancelBounty({
          tenantId: tenantOf(request),
          bountyId: idOf(request),
        }),
        request,
      );
    });

  };
}
