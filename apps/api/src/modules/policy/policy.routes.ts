import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import { randomUUID } from "node:crypto";
import { sha256 } from "@anari/policy-dsl";
import { ForbiddenError } from "@anari/auth";
import type { PolicygovPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import { NotFoundError } from "../../store.js";
import {
  calculateAnnualProfitSharing,
  calculateAnnualScorecard,
  calculateBountySettlement,
  calculateBusinessUnitCommission,
  calculateCapTableSnapshot,
  calculateDbcp,
  calculateEquityGrant,
  calculateEquityTax,
  calculateExecutiveSupplement,
  calculateFunctionalQuarterlyBonus,
  calculateInternalSplit,
  calculateMonthlyPerformanceWage,
  calculateOptionStrikePrice,
  calculateOverseasSalesAward,
  calculateRepurchase,
  calculateTechCenterAward,
  calculateTechCenterPool,
  calculateVestingSchedule,
  evaluateMonthlyStar,
  monthlyMetricTemplate,
  quarterlyMetricTemplate,
  annualMetricTemplate,
  scorePerformance,
  validatePerformanceMetricSet,
  validateTaskPod,
  validatePersonalTaskInventory,
} from "@anari/policy-dsl";
import {
  dataGovernanceCoverage,
  type AiMember,
  type PersonalTaskInventory,
  type EquityGrantCase,
  type PerformanceGoalCard,
  type TaskPod,
} from "@anari/domain";
import {
  businessUnitCommissionCalculationSchema,
  dbcpCalculationSchema,
  internalSplitCalculationSchema,
  techCenterPoolCalculationSchema,
} from "@anari/contracts";
import { ConflictError } from "../../store.js";
import { calculateTaskClosureRate } from "@anari/policy-dsl";
import { parseDecimal, formatDecimal } from "@anari/policy-dsl";
import {
  data,
  idOf,
  isPrivileged,
  ownPersonId,
  parse,
  personFilter,
  requireRoles,
  runPolicyInput,
  policyBody,
  requireString,
  tenantOf,
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


export interface PolicyEngineDeps {
  platformStore: PolicygovPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
}

export function registerPolicyEngineRoutes(deps: PolicyEngineDeps): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent } = deps;
  return async (app: FastifyInstance) => {
    // -------------------------------------------------------------------------
    // 2026 institutional policy set: performance, incentive, equity, task pods.
    // -------------------------------------------------------------------------
    const policyBody = (request: FastifyRequest): Record<string, unknown> => {
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new BadRequestError("INVALID_BODY", "请求体必须为 JSON 对象");
      }
      return body as Record<string, unknown>;
    };

    const runPolicyInput = <T>(calculation: () => T): T => {
      try {
        return calculation();
      } catch (error) {
        throw new BadRequestError(
          "POLICY_INPUT_INVALID",
          error instanceof Error ? error.message : "制度计算输入无效",
        );
      }
    };



    const requireString = (
      body: Record<string, unknown>,
      field: string,
    ): string => {
      const value = body[field];
      if (typeof value !== "string" || value.trim() === "") {
        throw new BadRequestError(
          "INVALID_INPUT",
          `字段 ${field} 必须为非空字符串`,
        );
      }
      return value;
    };

    app.get("/api/v1/policy/performance/templates", async (request) => {
      const query = request.query as { period?: string; role?: string };
      const period = (query.period ?? "MONTHLY").toUpperCase();
      if (period === "MONTHLY") {
        return data(monthlyMetricTemplate(), request);
      }
      if (period === "ANNUAL") {
        return data(annualMetricTemplate(), request);
      }
      if (period === "QUARTERLY") {
        if (!query.role) {
          throw new BadRequestError(
            "ROLE_REQUIRED",
            "季度指标模板必须指定岗位 role",
          );
        }
        return data(
          runPolicyInput(() => quarterlyMetricTemplate(query.role!)),
          request,
        );
      }
      throw new BadRequestError("INVALID_PERIOD", `不支持的周期 ${period}`);
    });

    app.post("/api/v1/policy/performance/score", async (request) => {
      requireRoles(request, "manager");
      const input =
        policyBody(request) as unknown as Parameters<typeof scorePerformance>[0];
      if (!input.personId || !input.period || !Array.isArray(input.metrics)) {
        throw new BadRequestError(
          "INVALID_INPUT",
          "必须提供 personId、period、metrics、measurements",
        );
      }
      if (!isPrivileged(request) && input.personId !== ownPersonId(request)) {
        throw new ForbiddenError("员工只能发起本人绩效评分");
      }
      const result = runPolicyInput(() => scorePerformance(input));
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "PERFORMANCE_SCORE",
        personId: input.personId,
        period: input.period,
        status: result.complete ? "COMPUTED" : "INCOMPLETE",
        payload: { request: input, result },
      });
      return data({ ...result, recordId: record.id }, request);
    });

    app.get("/api/v1/policy/performance/scores", async (request) => {
      const query = request.query as {
        personId?: string;
        period?: string;
        status?: string;
      };
      const scopedPerson = isPrivileged(request)
        ? query.personId
        : ownPersonId(request);
      if (!isPrivileged(request) && !scopedPerson) {
        throw new ForbiddenError("员工身份缺失");
      }
      return data(
        await platformStore.listPolicyEngineRecords(tenantOf(request), {
          recordType: "PERFORMANCE_SCORE",
          personId: scopedPerson,
          period: query.period,
          status: query.status,
        }),
        request,
      );
    });

    app.post("/api/v1/policy/performance/monthly-wage", async (request) => {
      requireRoles(request, "finance");
      const input =
        policyBody(request) as unknown as Parameters<
          typeof calculateMonthlyPerformanceWage
        >[0];
      return data(
        runPolicyInput(() => calculateMonthlyPerformanceWage(input)),
        request,
      );
    });

    app.post("/api/v1/policy/performance/functional-quarterly-bonus", async (request) => {
        requireRoles(request, "finance");
        const input =
          policyBody(request) as unknown as Parameters<
            typeof calculateFunctionalQuarterlyBonus
          >[0];
        return data(
          runPolicyInput(() => calculateFunctionalQuarterlyBonus(input)),
          request,
        );
      },
    );

    app.post("/api/v1/policy/performance/annual-scorecard", async (request) => {
      requireRoles(request, "finance");
      const input =
        policyBody(request) as unknown as Parameters<
          typeof calculateAnnualScorecard
        >[0];
      const result = runPolicyInput(() => calculateAnnualScorecard(input));
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "ANNUAL_SCORECARD",
        period: "ANNUAL",
        status: "COMPUTED",
        payload: { request: input, result },
      });
      return data({ ...result, recordId: record.id }, request);
    });

    app.post("/api/v1/policy/performance/annual-profit-sharing", async (request) => {
        requireRoles(request, "finance");
        const input =
          policyBody(request) as unknown as Parameters<
            typeof calculateAnnualProfitSharing
          >[0];
        const result = runPolicyInput(() => calculateAnnualProfitSharing(input));
        const record = await platformStore.savePolicyEngineRecord({
          tenantId: tenantOf(request),
          recordType: "ANNUAL_PROFIT_SHARING",
          period: "ANNUAL",
          status: result.eligible ? "COMPUTED" : "INELIGIBLE",
          payload: { request: input, result },
        });
        return data({ ...result, recordId: record.id }, request);
      },
    );

    app.post("/api/v1/policy/performance/monthly-star/evaluate", async (request) => {
        requireRoles(request, "manager");
        const body = policyBody(request);
        const candidates = body.candidates;
        if (!Array.isArray(candidates)) {
          throw new BadRequestError("INVALID_INPUT", "candidates 必须为数组");
        }
        const result = runPolicyInput(() =>
          evaluateMonthlyStar(
            candidates as Parameters<typeof evaluateMonthlyStar>[0],
            {
              ...(typeof body.m003Threshold === "string"
                ? { m003Threshold: body.m003Threshold }
                : {}),
              ...(typeof body.totalScoreThreshold === "string"
                ? { totalScoreThreshold: body.totalScoreThreshold }
                : {}),
            },
          ),
        );
        const record = await platformStore.savePolicyEngineRecord({
          tenantId: tenantOf(request),
          recordType: "MONTHLY_STAR_EVALUATION",
          period: typeof body.period === "string" ? body.period : undefined,
          personId:
            typeof body.personId === "string" ? body.personId : undefined,
          status: result.awarded ? "AWARDED" : "NO_AWARD",
          payload: { candidates, result },
        });
        return data({ ...result, recordId: record.id }, request);
      },
    );

    app.post("/api/v1/policy/incentive/dbcp", async (request) => {
      requireRoles(request, "finance");
      // NP-011：严格 Zod——负费用/超上限计提率在协议层 400。
      const body = parse(dbcpCalculationSchema, request.body);
      const result = runPolicyInput(() => calculateDbcp(body));
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "DBCP_STATEMENT",
        period: typeof body.period === "string" ? body.period : undefined,
        status: "COMPUTED",
        payload: { request: body, result },
      });
      return data({ ...result, recordId: record.id }, request);
    });

    app.post("/api/v1/policy/incentive/business-unit-commission", async (request) => {
        requireRoles(request, "finance");
        const body = parse(businessUnitCommissionCalculationSchema, request.body);
        const result = runPolicyInput(() =>
          calculateBusinessUnitCommission(body),
        );
        const record = await platformStore.savePolicyEngineRecord({
          tenantId: tenantOf(request),
          recordType: "BUSINESS_UNIT_COMMISSION",
          period: typeof body.period === "string" ? body.period : undefined,
          status: result.eligible ? "COMPUTED" : "INELIGIBLE",
          payload: { request: body, result },
        });
        return data({ ...result, recordId: record.id }, request);
      },
    );

    app.post("/api/v1/policy/incentive/executive-supplement", async (request) => {
        requireRoles(request, "finance");
        const input =
          policyBody(request) as unknown as Parameters<
            typeof calculateExecutiveSupplement
          >[0];
        return data(
          runPolicyInput(() => calculateExecutiveSupplement(input)),
          request,
        );
      },
    );

    app.post("/api/v1/policy/incentive/internal-split", async (request) => {
      requireRoles(request, "finance");
      const input = parse(internalSplitCalculationSchema, request.body);
      const result = runPolicyInput(() => calculateInternalSplit(input));
      return data(result, request);
    });

    app.post("/api/v1/policy/incentive/bounty-settlement", async (request) => {
        requireRoles(request, "manager", "finance");
        const body = policyBody(request);
        const input =
          body as unknown as Parameters<typeof calculateBountySettlement>[0];
        const result = runPolicyInput(() => calculateBountySettlement(input));
        const record = await platformStore.savePolicyEngineRecord({
          tenantId: tenantOf(request),
          recordType: "BOUNTY_SETTLEMENT",
          personId:
            typeof body.personId === "string" ? body.personId : undefined,
          status: "COMPUTED",
          payload: { request: input, result },
        });
        return data({ ...result, recordId: record.id }, request);
      },
    );

    app.post("/api/v1/policy/incentive/tech-center/award", async (request) => {
        requireRoles(request, "manager", "finance");
        const body = policyBody(request);
        const input =
          body as unknown as Parameters<typeof calculateTechCenterAward>[0];
        const result = runPolicyInput(() => calculateTechCenterAward(input));
        const record = await platformStore.savePolicyEngineRecord({
          tenantId: tenantOf(request),
          recordType: "TECH_CENTER_AWARD",
          personId:
            typeof body.personId === "string" ? body.personId : undefined,
          status: "COMPUTED",
          payload: { request: input, result },
        });
        return data({ ...result, recordId: record.id }, request);
      },
    );

    app.post("/api/v1/policy/incentive/tech-center/pool", async (request) => {
      requireRoles(request, "finance");
      const body = parse(techCenterPoolCalculationSchema, request.body);
      const result = runPolicyInput(() => calculateTechCenterPool(body));
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "TECH_CENTER_POOL",
        period: typeof body.period === "string" ? body.period : undefined,
        status: "COMPUTED",
        payload: { request: body, result },
      });
      return data({ ...result, recordId: record.id }, request);
    });

    app.post("/api/v1/policy/incentive/overseas-sales/award", async (request) => {
        requireRoles(request, "manager", "finance");
        const body = policyBody(request);
        const input =
          body as unknown as Parameters<typeof calculateOverseasSalesAward>[0];
        const result = runPolicyInput(() =>
          calculateOverseasSalesAward(input),
        );
        const record = await platformStore.savePolicyEngineRecord({
          tenantId: tenantOf(request),
          recordType: "OVERSEAS_SALES_AWARD",
          personId:
            typeof body.personId === "string" ? body.personId : undefined,
          status: result.disqualified
            ? "DISQUALIFIED"
            : result.netAmount === "0"
              ? "NO_AWARD"
              : "COMPUTED",
          payload: { request: input, result },
        });
        return data({ ...result, recordId: record.id }, request);
      },
    );

    app.post("/api/v1/policy/equity/grant-calc", async (request) => {
      requireRoles(request, "manager");
      const body = policyBody(request);
      const input =
        body as unknown as Parameters<typeof calculateEquityGrant>[0];
      const result = runPolicyInput(() => calculateEquityGrant(input));
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "EQUITY_GRANT_CALC",
        personId:
          typeof body.personId === "string" ? body.personId : undefined,
        status: result.withinSaturation ? "COMPUTED" : "SATURATED",
        payload: { request: input, result },
      });
      return data({ ...result, recordId: record.id }, request);
    });

    app.post("/api/v1/policy/equity/option-strike", async (request) => {
      requireRoles(request, "finance");
      const body = policyBody(request);
      return data(
        runPolicyInput(() =>
          calculateOptionStrikePrice(
            requireString(body, "latestPreferredPrice"),
            requireString(body, "stage") as Parameters<
              typeof calculateOptionStrikePrice
            >[1],
            typeof body.discountRatePercent === "string"
              ? body.discountRatePercent
              : undefined,
          ),
        ),
        request,
      );
    });

    app.post("/api/v1/policy/equity/vesting", async (request) => {
      const input =
        policyBody(request) as unknown as Parameters<
          typeof calculateVestingSchedule
        >[0];
      return data(
        runPolicyInput(() => calculateVestingSchedule(input)),
        request,
      );
    });

    app.post("/api/v1/policy/equity/repurchase", async (request) => {
      requireRoles(request, "manager", "finance");
      const body = policyBody(request);
      const input =
        body as unknown as Parameters<typeof calculateRepurchase>[0];
      const result = runPolicyInput(() => calculateRepurchase(input));
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "EQUITY_REPURCHASE",
        personId:
          typeof body.personId === "string" ? body.personId : undefined,
        status: "COMPUTED",
        payload: { request: input, result },
      });
      return data({ ...result, recordId: record.id }, request);
    });

    app.post("/api/v1/policy/equity/cap-table", async (request) => {
      requireRoles(request, "manager", "finance");
      const input =
        policyBody(request) as unknown as Parameters<
          typeof calculateCapTableSnapshot
        >[0];
      return data(
        runPolicyInput(() => calculateCapTableSnapshot(input)),
        request,
      );
    });

    app.get("/api/v1/policy/records", async (request) => {
      const query = request.query as {
        recordType?: string;
        personId?: string;
        period?: string;
        status?: string;
      };
      if (!isPrivileged(request)) {
        const own = ownPersonId(request);
        if (!own) throw new ForbiddenError("员工身份缺失");
        return data(
          await platformStore.listPolicyEngineRecords(tenantOf(request), {
            ...query,
            personId: own,
          }),
          request,
        );
      }
      return data(
        await platformStore.listPolicyEngineRecords(tenantOf(request), query),
        request,
      );
    });

    // 任务组（Task Pod）：人人可发起，发起人对结果负责。
    app.post("/api/v1/task-pods", async (request, reply) => {
      const body = policyBody(request);
      const members = body.members;
      if (!Array.isArray(members) || members.length === 0) {
        throw new BadRequestError("INVALID_INPUT", "members 必须为非空数组");
      }
      const initiatorPersonId =
        typeof body.initiatorPersonId === "string"
          ? body.initiatorPersonId
          : ownPersonId(request);
      if (!initiatorPersonId) {
        throw new BadRequestError(
          "INITIATOR_REQUIRED",
          "必须提供发起人 initiatorPersonId",
        );
      }
      if (!isPrivileged(request) && initiatorPersonId !== ownPersonId(request)) {
        throw new ForbiddenError("员工只能以本人身份发起任务组");
      }
      const timestamp = new Date().toISOString();
      const pod: TaskPod = {
        id: randomUUID(),
        tenantId: tenantOf(request),
        title: requireString(body, "title"),
        objective: requireString(body, "objective"),
        initiatorPersonId,
        status: "OPEN",
        members: members as TaskPod["members"],
        startsAt:
          typeof body.startsAt === "string" ? body.startsAt : timestamp,
        dueAt: typeof body.dueAt === "string" ? body.dueAt : undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      const aiRecords = await platformStore.listPolicyEngineRecords(
        tenantOf(request),
        { recordType: "AI_MEMBER" },
      );
      const aiMembers = aiRecords.map(
        (record) => record.payload as unknown as AiMember,
      );
      const validation = validateTaskPod(pod, aiMembers);
      if (!validation.valid) {
        throw new BadRequestError(
          "TASK_POD_INVALID",
          validation.errors.join("；"),
        );
      }
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "TASK_POD",
        personId: initiatorPersonId,
        status: pod.status,
        payload: pod as unknown as Record<string, unknown>,
      });
      return reply
        .status(201)
        .send(data({ ...pod, recordId: record.id }, request));
    });

    app.get("/api/v1/task-pods", async (request) => {
      const query = request.query as { status?: string };
      return data(
        await platformStore.listPolicyEngineRecords(tenantOf(request), {
          recordType: "TASK_POD",
          status: query.status,
        }),
        request,
      );
    });

    app.get("/api/v1/task-pods/:id", async (request) => {
      const record = await platformStore.getPolicyEngineRecord(
        tenantOf(request),
        idOf(request),
      );
      if (record.recordType !== "TASK_POD") {
        throw new NotFoundError(`TaskPod ${idOf(request)} 不存在`);
      }
      return data(record, request);
    });

    app.post("/api/v1/task-pods/:id/status", async (request) => {
      const record = await platformStore.getPolicyEngineRecord(
        tenantOf(request),
        idOf(request),
      );
      if (record.recordType !== "TASK_POD") {
        throw new NotFoundError(`TaskPod ${idOf(request)} 不存在`);
      }
      const pod = record.payload as unknown as TaskPod;
      if (!isPrivileged(request) && pod.initiatorPersonId !== ownPersonId(request)) {
        throw new ForbiddenError("只有发起人或管理者可以变更任务组状态");
      }
      const body = policyBody(request);
      const status = requireString(body, "status") as TaskPod["status"];
      if (
        !["OPEN", "ACTIVE", "COMPLETED", "DISSOLVED"].includes(status)
      ) {
        throw new BadRequestError("INVALID_STATUS", `不支持的任务组状态 ${status}`);
      }
      const updatedPod: TaskPod = {
        ...pod,
        status,
        completedAt:
          status === "COMPLETED" || status === "DISSOLVED"
            ? new Date().toISOString()
            : pod.completedAt,
        successorTaskPodId:
          typeof body.successorTaskPodId === "string"
            ? body.successorTaskPodId
            : pod.successorTaskPodId,
        updatedAt: new Date().toISOString(),
        version: pod.version + 1,
      };
      const updated = await platformStore.updatePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordId: record.id,
        status,
        payload: updatedPod as unknown as Record<string, unknown>,
      });
      return data(updated, request);
    });

    // AI 成员登记：有名字、有职责、有版本记录。
    app.post("/api/v1/ai-members", async (request, reply) => {
      requireRoles(request, "manager");
      const body = policyBody(request);
      const member = {
        id: randomUUID(),
        tenantId: tenantOf(request),
        name: requireString(body, "name"),
        role: requireString(body, "role"),
        aiVersion: requireString(body, "aiVersion"),
        responsibilities: Array.isArray(body.responsibilities)
          ? (body.responsibilities as string[])
          : [],
        ownerPersonId:
          typeof body.ownerPersonId === "string"
            ? body.ownerPersonId
            : ownPersonId(request) ?? "system",
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      } satisfies AiMember;
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "AI_MEMBER",
        personId: member.ownerPersonId,
        status: "ACTIVE",
        payload: member as unknown as Record<string, unknown>,
      });
      return reply
        .status(201)
        .send(data({ ...member, recordId: record.id }, request));
    });

    app.get("/api/v1/ai-members", async (request) => {
      return data(
        await platformStore.listPolicyEngineRecords(tenantOf(request), {
          recordType: "AI_MEMBER",
        }),
        request,
      );
    });

    app.post("/api/v1/ai-members/:id/retire", async (request) => {
      requireRoles(request, "manager");
      const record = await platformStore.getPolicyEngineRecord(
        tenantOf(request),
        idOf(request),
      );
      if (record.recordType !== "AI_MEMBER") {
        throw new NotFoundError(`AiMember ${idOf(request)} 不存在`);
      }
      const member = record.payload as unknown as AiMember;
      const updated = await platformStore.updatePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordId: record.id,
        status: "RETIRED",
        payload: {
          ...member,
          active: false,
          updatedAt: new Date().toISOString(),
          version: member.version + 1,
        } as unknown as Record<string, unknown>,
      });
      return data(updated, request);
    });

    // 个人任务清单：人 / AI / 人机协同标注，及本季度 AI 化改造对象。
    app.post("/api/v1/personal-task-inventories", async (request, reply) => {
      const body = policyBody(request);
      const personId =
        typeof body.personId === "string" ? body.personId : ownPersonId(request);
      if (!personId) {
        throw new BadRequestError("PERSON_REQUIRED", "必须提供 personId");
      }
      if (!isPrivileged(request) && personId !== ownPersonId(request)) {
        throw new ForbiddenError("员工只能提交本人的任务清单");
      }
      const tasks = body.tasks;
      if (!Array.isArray(tasks)) {
        throw new BadRequestError("INVALID_INPUT", "tasks 必须为数组");
      }
      const nowIso = new Date().toISOString();
      const inventory: PersonalTaskInventory = {
        id: randomUUID(),
        tenantId: tenantOf(request),
        personId,
        period: requireString(body, "period"),
        tasks: tasks as PersonalTaskInventory["tasks"],
        status: "DRAFT",
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      };
      const validation = validatePersonalTaskInventory(inventory);
      if (!validation.valid) {
        throw new BadRequestError(
          "INVENTORY_INVALID",
          validation.errors.join("；"),
        );
      }
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "PERSONAL_TASK_INVENTORY",
        personId,
        period: inventory.period,
        status: inventory.status,
        payload: inventory as unknown as Record<string, unknown>,
      });
      return reply
        .status(201)
        .send(data({ ...inventory, recordId: record.id }, request));
    });

    app.get("/api/v1/personal-task-inventories", async (request) => {
      const query = request.query as { personId?: string; period?: string };
      const personId = isPrivileged(request)
        ? query.personId
        : ownPersonId(request);
      if (!isPrivileged(request) && !personId) {
        throw new ForbiddenError("员工身份缺失");
      }
      return data(
        await platformStore.listPolicyEngineRecords(tenantOf(request), {
          recordType: "PERSONAL_TASK_INVENTORY",
          personId,
          period: query.period,
        }),
        request,
      );
    });

    app.post("/api/v1/personal-task-inventories/:id/status", async (request) => {
        const record = await platformStore.getPolicyEngineRecord(
          tenantOf(request),
          idOf(request),
        );
        if (record.recordType !== "PERSONAL_TASK_INVENTORY") {
          throw new NotFoundError(`PersonalTaskInventory ${idOf(request)} 不存在`);
        }
        const inventory =
          record.payload as unknown as PersonalTaskInventory;
        const body = policyBody(request);
        const status = requireString(
          body,
          "status",
        ) as PersonalTaskInventory["status"];
        if (!["SUBMITTED", "ACCEPTED", "RETURNED"].includes(status)) {
          throw new BadRequestError(
            "INVALID_STATUS",
            `不支持的任务清单状态 ${status}`,
          );
        }
        if (
          !isPrivileged(request) &&
          !(status === "SUBMITTED" && inventory.personId === ownPersonId(request))
        ) {
          throw new ForbiddenError("只有本人可提交，评审由管理者完成");
        }
        const updatedInventory: PersonalTaskInventory = {
          ...inventory,
          status,
          reviewerPersonId:
            status === "ACCEPTED" || status === "RETURNED"
              ? (typeof body.reviewerPersonId === "string"
                  ? body.reviewerPersonId
                  : ownPersonId(request))
              : inventory.reviewerPersonId,
          reviewedAt:
            status === "ACCEPTED" || status === "RETURNED"
              ? new Date().toISOString()
              : inventory.reviewedAt,
          reviewNote:
            typeof body.reviewNote === "string"
              ? body.reviewNote
              : inventory.reviewNote,
          updatedAt: new Date().toISOString(),
          version: inventory.version + 1,
        };
        const validation = validatePersonalTaskInventory(updatedInventory);
        if (!validation.valid) {
          throw new BadRequestError(
            "INVENTORY_INVALID",
            validation.errors.join("；"),
          );
        }
        const updated = await platformStore.updatePolicyEngineRecord({
          tenantId: tenantOf(request),
          recordId: record.id,
          status,
          payload: updatedInventory as unknown as Record<string, unknown>,
        });
        return data(updated, request);
      },
    );

    // M-001：任务按期有效闭环率 = 按期验收通过任务权重和 ÷ 应完成任务权重和。
    app.post("/api/v1/policy/performance/closure-rate", async (request) => {
      requireRoles(request, "manager");
      const body = policyBody(request);
      const personId =
        typeof body.personId === "string" ? body.personId : ownPersonId(request);
      if (!personId) {
        throw new BadRequestError("PERSON_REQUIRED", "必须提供 personId");
      }
      const startsAt = requireString(body, "startsAt");
      const endsAt = requireString(body, "endsAt");
      const defaultWeights: Record<string, string> = {
        GENERAL: "1",
        IMPORTANT: "2",
        CRITICAL: "3",
        COMPANY_CRITICAL: "5",
      };
      const weights = {
        ...defaultWeights,
        ...(typeof body.weights === "object" && body.weights !== null
          ? (body.weights as Record<string, string>)
          : {}),
      };
      const store = storeFor(request);
      const packages = await store.listWorkPackages();
      const evidence = await store.listEvidence();
      const evidenceSubjects = new Set(
        evidence.map((node) => `${node.subjectType}:${node.subjectId}`),
      );
      const tasks = packages
        .filter(
          (workPackage) =>
            workPackage.ownerPersonId === personId ||
            workPackage.members.some((member) => member.personId === personId),
        )
        .map((workPackage) => {
          const due = workPackage.dueAt ?? workPackage.createdAt;
          return { workPackage, due };
        })
        .filter(({ due }) => due >= startsAt && due <= endsAt)
        .map(({ workPackage, due }) => {
          const grade = workPackage.packageType;
          const weight = parseDecimal(weights[grade] ?? "1");
          const hasEvidence = evidenceSubjects.has(
            `WORK_PACKAGE:${workPackage.id}`,
          );
          const accepted = workPackage.status === "ACCEPTED";
          const onTime = accepted && workPackage.updatedAt <= due;
          return {
            workPackageId: workPackage.id,
            title: workPackage.title,
            grade,
            weight: formatDecimal(weight),
            status: workPackage.status,
            dueAt: due,
            acceptedAt: accepted ? workPackage.updatedAt : undefined,
            hasEvidence,
            validClosure: accepted && onTime && hasEvidence,
            reason: !accepted
              ? "未验收通过"
              : !onTime
                ? "验收晚于截止日期"
                : !hasEvidence
                  ? "缺少可核验证据"
                  : undefined,
          };
        });
      const closure = calculateTaskClosureRate(
        tasks.map((task) => ({
          weight: task.weight,
          status: task.status,
          dueAt: task.dueAt,
          acceptedAt: task.acceptedAt,
          hasEvidence: task.hasEvidence,
        })),
      );
      const result = {
        personId,
        startsAt,
        endsAt,
        taskCount: tasks.length,
        requiredWeight: closure.requiredWeight,
        qualifiedWeight: closure.qualifiedWeight,
        closureRate: closure.rate,
        note: closure.note,
        tasks,
      };
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "M001_CLOSURE_RATE",
        personId,
        period:
          typeof body.period === "string" ? body.period : undefined,
        status: closure.requiredWeight === "0" ? "NA" : "COMPUTED",
        payload: result,
      });
      return data({ ...result, recordId: record.id }, request);
    });

    // 第十三条：季度目标卡，指标权重合计 100%，锁定后不得追溯调整。
    app.post("/api/v1/policy/performance/goal-cards", async (request, reply) => {
      requireRoles(request, "manager");
      const body = policyBody(request);
      const personId = requireString(body, "personId");
      const period = requireString(body, "period") as PerformanceGoalCard["period"];
      if (!["MONTHLY", "QUARTERLY", "ANNUAL"].includes(period)) {
        throw new BadRequestError("INVALID_PERIOD", `不支持的周期 ${period}`);
      }
      const metrics = body.metrics;
      if (!Array.isArray(metrics)) {
        throw new BadRequestError("INVALID_INPUT", "metrics 必须为数组");
      }
      const validation = validatePerformanceMetricSet(
        metrics as PerformanceGoalCard["metrics"],
        period,
      );
      if (!validation.valid) {
        throw new BadRequestError(
          "GOAL_CARD_INVALID",
          validation.errors.join("；"),
        );
      }
      const nowIso = new Date().toISOString();
      const card: PerformanceGoalCard = {
        id: randomUUID(),
        tenantId: tenantOf(request),
        personId,
        period,
        roleCode: requireString(body, "roleCode"),
        metrics: metrics as PerformanceGoalCard["metrics"],
        status: "DRAFT",
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      };
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "PERFORMANCE_GOAL_CARD",
        personId,
        period,
        status: card.status,
        payload: card as unknown as Record<string, unknown>,
      });
      return reply
        .status(201)
        .send(data({ ...card, recordId: record.id, totalWeight: validation.totalWeight }, request));
    });

    app.get("/api/v1/policy/performance/goal-cards", async (request) => {
      const query = request.query as {
        personId?: string;
        period?: string;
        status?: string;
      };
      const person = personFilter(request);
      return data(
        await platformStore.listPolicyEngineRecords(tenantOf(request), {
          recordType: "PERFORMANCE_GOAL_CARD",
          personId: person ?? query.personId,
          period: query.period,
          status: query.status,
        }),
        request,
      );
    });

    app.post("/api/v1/policy/performance/goal-cards/:id/lock", async (request) => {
        requireRoles(request, "manager");
        const record = await platformStore.getPolicyEngineRecord(
          tenantOf(request),
          idOf(request),
        );
        if (record.recordType !== "PERFORMANCE_GOAL_CARD") {
          throw new NotFoundError(`GoalCard ${idOf(request)} 不存在`);
        }
        const card = record.payload as unknown as PerformanceGoalCard;
        const body = policyBody(request);
        if (card.status === "LOCKED") {
          throw new ConflictError("目标卡已锁定，不得静默覆盖");
        }
        const adjustmentReason =
          typeof body.adjustmentReason === "string"
            ? body.adjustmentReason
            : undefined;
        if (card.status === "ADJUSTED" && !adjustmentReason?.trim()) {
          throw new BadRequestError(
            "REASON_REQUIRED",
            "调整已锁定目标卡必须说明调整原因",
          );
        }
        const locked: PerformanceGoalCard = {
          ...card,
          status: "LOCKED",
          lockedAt: new Date().toISOString(),
          lockedBy: ownPersonId(request) ?? card.lockedBy,
          adjustmentReason,
          updatedAt: new Date().toISOString(),
          version: card.version + 1,
        };
        const updated = await platformStore.updatePolicyEngineRecord({
          tenantId: tenantOf(request),
          recordId: record.id,
          status: locked.status,
          payload: locked as unknown as Record<string, unknown>,
        });
        return data(updated, request);
      },
    );

    app.post("/api/v1/policy/equity/tax", async (request) => {
      requireRoles(request, "finance");
      const input =
        policyBody(request) as unknown as Parameters<
          typeof calculateEquityTax
        >[0];
      return data(runPolicyInput(() => calculateEquityTax(input)), request);
    });

    // 第15-16条：授予决策流程（资格 → 配股 → 方案 → 股东会 → 协议 → 工商 → 税务 → 台账）。
    const equityGrantSteps: EquityGrantCase["status"][] = [
      "QUALIFICATION",
      "CALCULATION",
      "PLAN",
      "SHAREHOLDER_APPROVAL",
      "AGREEMENT",
      "REGISTRATION",
      "TAX_FILING",
      "LEDGERED",
    ];

    app.post("/api/v1/policy/equity/grant-cases", async (request, reply) => {
      requireRoles(request, "manager");
      const body = policyBody(request);
      const personId = requireString(body, "personId");
      const nowIso = new Date().toISOString();
      const grantCase: EquityGrantCase = {
        id: randomUUID(),
        tenantId: tenantOf(request),
        personId,
        instrument: (body.instrument ?? "RSU") as EquityGrantCase["instrument"],
        status: "QUALIFICATION",
        positionLevel: (body.positionLevel ?? "L3") as EquityGrantCase["positionLevel"],
        financingStage: (body.financingStage ?? "A") as EquityGrantCase["financingStage"],
        performanceGrade: (body.performanceGrade ?? "B") as EquityGrantCase["performanceGrade"],
        tenureStage: (body.tenureStage ?? "A") as EquityGrantCase["tenureStage"],
        grantPercent: typeof body.grantPercent === "string" ? body.grantPercent : "0",
        totalUnits: typeof body.totalUnits === "string" ? body.totalUnits : "0",
        strikePrice: typeof body.strikePrice === "string" ? body.strikePrice : "0",
        married: body.married === true,
        spouseConfirmationSigned: false,
        agreementSigned: false,
        riskAcknowledged: body.riskAcknowledged === true,
        capTableUpdated: false,
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      };
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "EQUITY_GRANT_CASE",
        personId,
        status: grantCase.status,
        payload: grantCase as unknown as Record<string, unknown>,
      });
      return reply
        .status(201)
        .send(data({ ...grantCase, recordId: record.id }, request));
    });

    app.get("/api/v1/policy/equity/grant-cases", async (request) => {
      const query = request.query as { personId?: string; status?: string };
      const person = personFilter(request);
      return data(
        await platformStore.listPolicyEngineRecords(tenantOf(request), {
          recordType: "EQUITY_GRANT_CASE",
          personId: person ?? query.personId,
          status: query.status,
        }),
        request,
      );
    });



    app.post("/api/v1/policy/equity/grant-cases/:id/advance", async (request) => {
        requireRoles(request, "manager");
        const record = await platformStore.getPolicyEngineRecord(
          tenantOf(request),
          idOf(request),
        );
        if (record.recordType !== "EQUITY_GRANT_CASE") {
          throw new NotFoundError(`GrantCase ${idOf(request)} 不存在`);
        }
        const grantCase = record.payload as unknown as EquityGrantCase;
        const body = policyBody(request);
        const target = requireString(body, "status") as EquityGrantCase["status"];
        if (target === "REJECTED") {
          const reason = requireString(body, "rejectionReason");
          const updated = await platformStore.updatePolicyEngineRecord({
            tenantId: tenantOf(request),
            recordId: record.id,
            status: "REJECTED",
            payload: {
              ...grantCase,
              status: "REJECTED",
              rejectionReason: reason,
              updatedAt: new Date().toISOString(),
              version: grantCase.version + 1,
            } as unknown as Record<string, unknown>,
          });
          return data(updated, request);
        }
        const currentIndex = equityGrantSteps.indexOf(grantCase.status);
        const targetIndex = equityGrantSteps.indexOf(target);
        if (targetIndex !== currentIndex + 1) {
          throw new ConflictError(
            `授予流程必须按顺序推进：当前 ${grantCase.status}，下一步应为 ${equityGrantSteps[currentIndex + 1] ?? "无"}`,
          );
        }
        const agreementSigned =
          body.agreementSigned === true || grantCase.agreementSigned;
        const spouseConfirmationSigned =
          body.spouseConfirmationSigned === true ||
          grantCase.spouseConfirmationSigned;
        const capTableUpdated =
          body.capTableUpdated === true || grantCase.capTableUpdated;
        const shareholderResolutionRef =
          typeof body.shareholderResolutionRef === "string"
            ? body.shareholderResolutionRef
            : grantCase.shareholderResolutionRef;
        const taxFilingRef =
          typeof body.taxFilingRef === "string"
            ? body.taxFilingRef
            : grantCase.taxFilingRef;
        const riskAcknowledged =
          body.riskAcknowledged === true || grantCase.riskAcknowledged;
        if (target === "AGREEMENT" && !shareholderResolutionRef) {
          throw new BadRequestError(
            "RESOLUTION_REQUIRED",
            "进入协议签署前必须记录股东会决议编号",
          );
        }
        if (target === "AGREEMENT" && !riskAcknowledged) {
          throw new BadRequestError(
            "RISK_ACKNOWLEDGEMENT_REQUIRED",
            "签署授予协议前必须取得《员工承诺函》风险知悉确认",
          );
        }
        if (target === "REGISTRATION" && !agreementSigned) {
          throw new BadRequestError(
            "AGREEMENT_REQUIRED",
            "授予协议未签署，不得办理工商变更",
          );
        }
        if (
          target === "REGISTRATION" &&
          grantCase.married &&
          !spouseConfirmationSigned
        ) {
          throw new BadRequestError(
            "SPOUSE_CONFIRMATION_REQUIRED",
            "已婚激励对象未签署配偶确认函，暂缓工商变更",
          );
        }
        if (target === "TAX_FILING" && !taxFilingRef) {
          throw new BadRequestError(
            "TAX_FILING_REQUIRED",
            "税务备案步骤必须记录备案编号",
          );
        }
        if (target === "LEDGERED" && !capTableUpdated) {
          throw new BadRequestError(
            "CAP_TABLE_REQUIRED",
            "Cap Table 未更新，不能完成台账",
          );
        }
        const updatedCase: EquityGrantCase = {
          ...grantCase,
          status: target,
          agreementSigned,
          spouseConfirmationSigned,
          riskAcknowledged,
          capTableUpdated,
          shareholderResolutionRef,
          taxFilingRef,
          updatedAt: new Date().toISOString(),
          version: grantCase.version + 1,
        };
        const updated = await platformStore.updatePolicyEngineRecord({
          tenantId: tenantOf(request),
          recordId: record.id,
          status: target,
          payload: updatedCase as unknown as Record<string, unknown>,
        });
        return data(updated, request);
      },
    );
  };
}
