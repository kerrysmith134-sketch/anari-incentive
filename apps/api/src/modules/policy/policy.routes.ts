import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import { randomUUID } from "node:crypto";
import { sha256 } from "@anari/policy-dsl";
import { ForbiddenError } from "@anari/auth";
import type {
  DecisionPort,
  MetricSnapshotConsumptionPort,
  PolicygovPort,
} from "../../store-ports.js";
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
  type MetricMeasurement,
  type MetricMeasurementRecord,
  type MetricMeasurementSnapshot,
  type PerformanceMetricSpec,
  type PerformancePeriod,
  type PersonalTaskInventory,
  type EquityGrantCase,
  type PerformanceGoalCard,
  type TaskPod,
  type DecisionCase,
  type DecisionEvidence,
  type PolicyEngineRecord,
} from "@anari/domain";
import {
  businessUnitCommissionCalculationSchema,
  dbcpCalculationSchema,
  internalSplitCalculationSchema,
  scorePerformanceFromFactsSchema,
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

/**
 * 权威绩效事实缺失：没有已锁定目标卡，或没有通过 contentHash 重算的冻结
 * 计量快照。fail-closed——绝不退回到「客户端输入」继续算分。
 */
class PerformanceFactsNotReadyError extends Error {
  readonly statusCode = 409;
  readonly code = "PERFORMANCE_FACTS_NOT_READY";
  constructor(message: string) {
    super(message);
  }
}

/**
 * 客户端 metricInputs 试图提供/覆盖权威字段（rawValue/value/applicable/
 * acceptanceScore/eventAdjustment 等），或引入快照中没有的测量。
 */
class PerformanceInputOverridesFactsError extends Error {
  readonly statusCode = 409;
  readonly code = "PERFORMANCE_INPUT_OVERRIDES_FACTS";
  constructor(message: string) {
    super(message);
  }
}

/**
 * 正式评分资格：
 * - FORMAL：结果完整可评、指标全覆盖且逐项 quality=VALID、制度版本已发布
 *   且与周期绑定一致；只有 FORMAL 才写 COMPUTED 并消费计量快照。
 * - INCOMPLETE：缺指标/质量非 VALID，补齐测量后可重算。
 * - BLOCKED：制度版本缺失/未发布/不适用于该周期；可算出参考分但不得作为
 *   正式评价依据，记录状态写 BLOCKED。
 */
type PerformanceEligibility = "FORMAL" | "INCOMPLETE" | "BLOCKED";

/** 事实唯一性被破坏（多张锁定卡/多张冻结快照）：fail-closed，不产生正式分。 */
class PerformanceFactsAmbiguousError extends Error {
  readonly statusCode = 409;
  readonly code = "PERFORMANCE_FACTS_AMBIGUOUS";
  constructor(message: string) {
    super(message);
  }
}

/** 快照逐项来源追溯缺失：没有来源就没有可复核的事实。 */
class PerformanceSourceTraceMissingError extends Error {
  readonly statusCode = 409;
  readonly code = "PERFORMANCE_SOURCE_TRACE_MISSING";
  constructor(message: string) {
    super(message);
  }
}

/** 快照已被正式评分/评价决定消费，事实不可复用。 */
class SnapshotAlreadyConsumedError extends Error {
  readonly statusCode = 409;
  readonly code = "SNAPSHOT_ALREADY_CONSUMED";
  constructor(message: string) {
    super(message);
  }
}

/** 制度版本与评价周期绑定不一致（或版本不适用于该周期）。 */
class PolicyVersionMismatchError extends Error {
  readonly statusCode = 409;
  readonly code = "POLICY_VERSION_MISMATCH";
  constructor(message: string) {
    super(message);
  }
}

/**
 * 只有 FORMAL 评分才能进入 JEV：INCOMPLETE/BLOCKED 是参考分，不能成为
 * 评价决定的证据来源。
 */
class PerformanceNotFormalError extends Error {
  readonly statusCode = 409;
  readonly code = "PERFORMANCE_NOT_FORMAL";
  constructor(message: string) {
    super(message);
  }
}

/**
 * 评分记录里的事实与 factsHash 对不上：fail-closed，绝不写入一条
 * 「hash 承诺与内容不一致」的 JEV 证据。
 */
class PerformanceFactsHashMismatchError extends Error {
  readonly statusCode = 409;
  readonly code = "PERFORMANCE_FACTS_HASH_MISMATCH";
  constructor(message: string) {
    super(message);
  }
}

/** 评分记录类型不匹配（只有 PERFORMANCE_SCORE 可以关联绩效案件）。 */
class PerformanceRecordTypeError extends Error {
  readonly statusCode = 409;
  readonly code = "PERFORMANCE_RECORD_TYPE_MISMATCH";
  constructor(message: string) {
    super(message);
  }
}

/** 评分记录负载里的事实绑定（factsHash 的原文承诺）。 */
interface PerformanceFactsBinding {
  kind: string;
  tenantId: string;
  facts: unknown;
  supplements: Array<{
    metricId: string;
    naReason: string | null;
    sampleSize: number | null;
    evidenceRefs: string[];
  }>;
}

/**
 * 从评分记录 payload 复原 factsHash 的原文承诺。
 *
 * 评分时 factsHash = sha256({kind, tenantId, facts, supplements})，因此这里
 * 必须逐字段复原（含 null 归一与 metricId 排序），再重算比对；复原不出来
 * 就 fail-closed，绝不用「随便一个 hash」冒充证据承诺。
 */
function performanceFactsBindingOf(
  record: PolicyEngineRecord,
): {
  binding: PerformanceFactsBinding;
  factsHash: string;
  payload: {
    eligibility?: string;
    factsHash?: string;
    facts?: Record<string, unknown>;
    request?: {
      cycleId?: string;
      personId?: string;
      metricInputs?: Array<Record<string, unknown>>;
    };
  };
} {
  const payload = (record.payload ?? {}) as {
    eligibility?: string;
    factsHash?: string;
    facts?: Record<string, unknown>;
    request?: {
      cycleId?: string;
      personId?: string;
      metricInputs?: Array<Record<string, unknown>>;
    };
  };
  if (payload.eligibility !== "FORMAL") {
    throw new PerformanceNotFormalError(
      `评分记录 ${record.id} 的资格是 ${payload.eligibility ?? "UNKNOWN"}：只有 FORMAL 评分才能关联 JEV 案件`,
    );
  }
  const declaredHash = typeof payload.factsHash === "string"
    ? payload.factsHash
    : "";
  if (!declaredHash) {
    throw new PerformanceFactsHashMismatchError(
      `评分记录 ${record.id} 缺少 factsHash，无法作为 JEV 证据`,
    );
  }
  const metricInputs = Array.isArray(payload.request?.metricInputs)
    ? payload.request!.metricInputs
    : [];
  const binding: PerformanceFactsBinding = {
    kind: "PERFORMANCE_SCORE_FROM_FACTS/v2",
    tenantId: record.tenantId,
    facts: payload.facts,
    supplements: metricInputs
      .map((input) => ({
        metricId: String(input.metricId),
        naReason: (input.naReason as string | undefined) ?? null,
        sampleSize: (input.sampleSize as number | undefined) ?? null,
        evidenceRefs: [
          ...((input.evidenceRefs as string[] | undefined) ?? []),
        ].sort(),
      }))
      .sort((left, right) => left.metricId.localeCompare(right.metricId)),
  };
  return { binding, factsHash: declaredHash, payload };
}

/**
 * score-from-facts 的 JEV 衔接（幂等）：同一 recordId 只关联一个
 * PERFORMANCE 案件、只写一条 PERFORMANCE_SCORE 证据。
 *
 * - 幂等键是 (subjectType="PERFORMANCE_SCORE", subjectId=recordId)，通过
 *   findDecisionCaseBySubject 只读查询找到已有案件，不重复开案；
 * - 证据 content 是可重算的事实绑定，contentHash 必须等于 factsHash；
 * - 已存在案件时只在证据缺失时补写（例如上次写到一半），不会重复追加。
 */
async function ensurePerformanceScoreDecisionCase(input: {
  platformStore: PolicygovPort & DecisionPort;
  tenantId: string;
  record: PolicyEngineRecord;
  createdBy: string;
}): Promise<{
  decisionCase: DecisionCase;
  evidence: DecisionEvidence[];
  created: boolean;
}> {
  const { platformStore, tenantId, record, createdBy } = input;
  const { binding, factsHash, payload } = performanceFactsBindingOf(record);
  const recomputed = sha256(binding);
  if (recomputed !== factsHash) {
    throw new PerformanceFactsHashMismatchError(
      `评分记录 ${record.id} 的 factsHash ${factsHash} 与重算结果 ${recomputed} 不一致：不得作为 JEV 证据`,
    );
  }
  let decisionCase = await platformStore.findDecisionCaseBySubject(
    tenantId,
    "PERFORMANCE_SCORE",
    record.id,
  );
  let created = false;
  if (!decisionCase) {
    created = true;
    const facts = payload.facts ?? {};
    decisionCase = await platformStore.createDecisionCase({
      tenantId,
      kind: "PERFORMANCE",
      subjectType: "PERFORMANCE_SCORE",
      subjectId: record.id,
      context: {
        flow: "PERFORMANCE_SCORE",
        cycleId: payload.request?.cycleId ?? null,
        personId: record.personId ?? payload.request?.personId ?? null,
        period: record.period ?? null,
        eligibility: "FORMAL",
        factsHash,
        finalScore: (facts as { finalScore?: unknown }).finalScore ?? null,
        kp: (facts as { kp?: unknown }).kp ?? null,
        snapshotId: (facts as { snapshotId?: unknown }).snapshotId ?? null,
      },
      createdBy,
    });
  }
  let detail = await platformStore.getDecisionCase(tenantId, decisionCase.id);
  if (
    !detail.evidence.some(
      (entry) =>
        entry.sourceType === "PERFORMANCE_SCORE" &&
        entry.sourceId === record.id,
    )
  ) {
    await platformStore.appendDecisionEvidence({
      tenantId,
      caseId: decisionCase.id,
      sourceType: "PERFORMANCE_SCORE",
      sourceId: record.id,
      content: binding,
      contentHash: factsHash,
      supports: "FOR",
    });
    detail = await platformStore.getDecisionCase(tenantId, decisionCase.id);
  }
  return { decisionCase, evidence: detail.evidence, created };
}

/** 评分来源标记：只有 LOCKED_FACTS 可作为正式评价依据。 */
const PERFORMANCE_SOURCE_LOCKED_FACTS = "LOCKED_FACTS";
const PERFORMANCE_SOURCE_CLIENT_INPUT = "CLIENT_INPUT";

/** 快照逐项来源追溯字段：正式评分要求四项齐全。 */
const REQUIRED_SNAPSHOT_SOURCE_FIELDS = [
  "sourceRef",
  "sourceSystem",
  "sourceRecordId",
  "sourceVersion",
] as const;

/** 快照测量记录的来源追溯扩展（domain 类型只声明了 sourceRef）。 */
type TraceableMeasurementRecord = MetricMeasurementRecord & {
  sourceSystem?: string;
  sourceRecordId?: string;
  sourceVersion?: string;
};

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

type PerformancePolicyBinding = {
  bound: boolean;
  blocker?: string;
  version?: {
    policyVersionId: string;
    status: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  };
};

/**
 * 制度版本闸门：
 * - 周期已绑定版本时，请求版本必须完全一致，否则 409；
 * - 周期未绑定版本时以请求版本为准（无周期更新端口，不能写回，只把有效
 *   版本固化进本次 facts/记录），并校验该版本在本周期内有效；
 * - 版本不存在或未 PUBLISHED 不阻断算分，但资格只能是 BLOCKED。
 */
async function resolvePerformancePolicyBinding(
  store: IncentiveStore,
  cycle: {
    id: string;
    startsAt: string;
    endsAt: string;
    policyVersionId?: string;
  },
  requestedPolicyVersionId: string,
): Promise<PerformancePolicyBinding> {
  if (cycle.policyVersionId && cycle.policyVersionId !== requestedPolicyVersionId) {
    throw new PolicyVersionMismatchError(
      `评价周期 ${cycle.id} 绑定制度版本 ${cycle.policyVersionId}，与请求的 ${requestedPolicyVersionId} 不一致：不存在该版本下的锁定事实`,
    );
  }
  let version;
  try {
    version = await store.getPolicyVersion(requestedPolicyVersionId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return {
        bound: false,
        blocker: `制度版本 ${requestedPolicyVersionId} 不存在`,
      };
    }
    throw error;
  }
  if (version.status !== "PUBLISHED") {
    return {
      bound: false,
      blocker: `制度版本 ${requestedPolicyVersionId} 状态为 ${version.status}，未发布`,
      version: {
        policyVersionId: version.policyVersionId,
        status: version.status,
        effectiveFrom: version.effectiveFrom,
        effectiveTo: version.effectiveTo,
      },
    };
  }
  if (!cycle.policyVersionId) {
    // 周期未绑定：请求版本必须在该周期窗口内有效，否则视为不匹配。
    const cycleStart = Date.parse(cycle.startsAt);
    const cycleEnd = Date.parse(cycle.endsAt);
    const effectiveFrom = version.effectiveFrom
      ? Date.parse(version.effectiveFrom)
      : Number.NaN;
    const effectiveTo = version.effectiveTo
      ? Date.parse(version.effectiveTo)
      : Number.NaN;
    if (
      Number.isFinite(effectiveFrom) &&
      Number.isFinite(cycleEnd) &&
      effectiveFrom > cycleEnd
    ) {
      throw new PolicyVersionMismatchError(
        `制度版本 ${requestedPolicyVersionId} 的生效时间 ${version.effectiveFrom} 晚于评价周期 ${cycle.id}，不能作为该周期的事实依据`,
      );
    }
    if (
      Number.isFinite(effectiveTo) &&
      Number.isFinite(cycleStart) &&
      effectiveTo <= cycleStart
    ) {
      throw new PolicyVersionMismatchError(
        `制度版本 ${requestedPolicyVersionId} 在评价周期 ${cycle.id} 开始前已失效`,
      );
    }
  }
  return {
    bound: true,
    version: {
      policyVersionId: version.policyVersionId,
      status: version.status,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
    },
  };
}

/** 旧 /score 的兼容告警：分数来自客户端自报输入，不是权威事实。 */
const CLIENT_INPUT_SCORE_WARNING =
  "该评分直接采用客户端提交的指标与测量值（source=CLIENT_INPUT），未绑定已锁定目标卡与已核验计量快照，不得作为正式评价依据；正式评分请使用 POST /api/v1/policy/performance/score-from-facts";

/**
 * 目标卡与评价周期的绑定周期：cycleType 优先，其次按起止跨度推断。
 * 目标卡本身只有 MONTHLY/QUARTERLY/ANNUAL，没有 cycleId，故由周期决定
 * 哪张锁定卡是该周期的事实来源。
 */
function performancePeriodOfCycle(cycle: {
  cycleType?: string;
  startsAt?: string;
  endsAt?: string;
}): PerformancePeriod {
  const type = (cycle.cycleType ?? "").toUpperCase();
  if (type.includes("ANNUAL") || type.includes("YEAR")) return "ANNUAL";
  if (type.includes("QUARTER")) return "QUARTERLY";
  if (type.includes("MONTH")) return "MONTHLY";
  const startsAt = Date.parse(cycle.startsAt ?? "");
  const endsAt = Date.parse(cycle.endsAt ?? "");
  if (Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt > startsAt) {
    const days = (endsAt - startsAt) / 86_400_000;
    if (days > 200) return "ANNUAL";
    if (days > 45) return "QUARTERLY";
  }
  return "MONTHLY";
}

/**
 * 客户端在 metricInputs 中唯一允许出现的字段：说明性、非权威。
 * 任何其他字段都意味着客户端想自己决定被评分的值。
 */
const NON_AUTHORITATIVE_METRIC_INPUT_FIELDS = new Set([
  "metricId",
  "naReason",
  "sampleSize",
  "evidenceRefs",
]);

/** 快照值按评分函数落到对应的权威字段，客户端无权再改写。 */
function measurementSlotForMetricType(
  metricType: PerformanceMetricSpec["metricType"] | undefined,
  value: string,
): Partial<MetricMeasurement> {
  if (metricType === "INTERVAL_EVENT") return { eventAdjustment: value };
  if (metricType === "WEIGHTED_ACCEPTANCE") return { acceptanceScore: value };
  return { rawValue: value };
}

const DECIMAL_VALUE_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * 目标卡记录负载：租户与周期绑定写在 payload 里（目标卡类型本身没有
 * cycleId），因此这里按「字段都可能缺失」读取，再显式校验。
 */
type LockedGoalCardPayload = Omit<PerformanceGoalCard, "tenantId"> & {
  tenantId?: string;
  cycleId?: string;
};


export interface PolicyEngineDeps {
  /** 制度引擎端口 + JEV 决策端口（同一门面实例，绩效正式结果要进 JEV）。 */
  platformStore: PolicygovPort & DecisionPort;
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

    /**
     * 目标卡可选绑定到评价周期：目标卡类型本身没有 cycleId，绑定信息存进
     * payload，供 score-from-facts 精确定位该周期的锁定卡。
     */
    const bindGoalCardToCycle = async (
      request: FastifyRequest,
      body: Record<string, unknown>,
      period: PerformanceGoalCard["period"],
    ): Promise<{ id: string } | undefined> => {
      const raw = body.cycleId;
      if (raw === undefined || raw === null) return undefined;
      if (typeof raw !== "string" || raw.trim() === "") {
        throw new BadRequestError(
          "INVALID_INPUT",
          "字段 cycleId 必须为非空字符串",
        );
      }
      let cycle;
      try {
        cycle = await storeFor(request).getEvaluationCycle(raw);
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new BadRequestError("CYCLE_NOT_FOUND", `评价周期 ${raw} 不存在`);
        }
        throw error;
      }
      const cyclePeriod = performancePeriodOfCycle(cycle);
      if (cyclePeriod !== period) {
        throw new BadRequestError(
          "CYCLE_PERIOD_MISMATCH",
          `目标卡周期 ${period} 与评价周期 ${raw} 的周期 ${cyclePeriod} 不一致`,
        );
      }
      return { id: cycle.id };
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
      // 兼容保留：分值完全来自客户端自报，明确标注来源并给出告警，避免被
      // 当成与 score-from-facts 等价的形式评价依据。
      // 客户端自报分值永远不具备正式资格：记录状态固定 INCOMPLETE，
      // 绝不写 COMPUTED（只有 FORMAL 才能写正式状态）。
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "PERFORMANCE_SCORE",
        personId: input.personId,
        period: input.period,
        status: "INCOMPLETE",
        payload: {
          request: input,
          result,
          source: PERFORMANCE_SOURCE_CLIENT_INPUT,
        },
      });
      return data(
        {
          ...result,
          source: PERFORMANCE_SOURCE_CLIENT_INPUT,
          warnings: [CLIENT_INPUT_SCORE_WARNING],
          recordId: record.id,
        },
        request,
      );
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
      // 可选的评价周期绑定：写入目标卡 payload，使 score-from-facts 能精确
      // 找到「该 cycle 的锁定卡」，而不是只靠 MONTHLY/QUARTERLY/ANNUAL 匹配。
      const binding = await bindGoalCardToCycle(request, body, period);
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
      const boundCard = binding ? { ...card, cycleId: binding.id } : card;
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "PERFORMANCE_GOAL_CARD",
        personId,
        period,
        status: card.status,
        payload: boundCard as unknown as Record<string, unknown>,
      });
      return reply
        .status(201)
        .send(data({ ...boundCard, recordId: record.id, totalWeight: validation.totalWeight }, request));
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

    // -------------------------------------------------------------------------
    // 权威绩效评分（018）：分值只能来自「已锁定目标卡 + 已核验计量快照」。
    // 客户端 metricInputs 仅可补充说明性字段；覆盖权威字段一律 409。
    //
    // 正式资格（eligibility）：
    // - FORMAL：complete && scoreable、指标全覆盖且逐项 quality=VALID、
    //   制度版本已发布且与周期绑定一致；只有 FORMAL 写 COMPUTED；
    // - INCOMPLETE：缺指标/质量非 VALID，需补测量（新快照）后重算；
    // - BLOCKED：制度版本缺失/未发布/不适用；分数仅作参考，记录写 BLOCKED。
    // 任何成功保存的评分记录都会原子消费其快照（一次性事实凭证）；
    // 记录落库失败则回滚消费。
    // -------------------------------------------------------------------------
    app.post("/api/v1/policy/performance/score-from-facts", async (request) => {
      requireRoles(request, "manager");
      const body = parse(scorePerformanceFromFactsSchema, request.body);
      if (!isPrivileged(request) && body.personId !== ownPersonId(request)) {
        throw new ForbiddenError("员工只能发起本人绩效评分");
      }
      const tenantId = tenantOf(request);
      const store = storeFor(request);
      const snapshotStore = store as IncentiveStore &
        MetricSnapshotConsumptionPort;
      const actorPersonId = ownPersonId(request) ?? body.personId;
      const metricInputs = body.metricInputs ?? [];
      const suppliedMetricIds = new Set<string>();
      for (const input of metricInputs) {
        if (suppliedMetricIds.has(input.metricId)) {
          throw new BadRequestError(
            "INVALID_INPUT",
            `metricInputs 中指标 ${input.metricId} 重复`,
          );
        }
        suppliedMetricIds.add(input.metricId);
      }

      const cycle = await store.getEvaluationCycle(body.cycleId);
      const period = performancePeriodOfCycle(cycle);

      // 制度版本闸门（409 只用于「绑定冲突/版本不适用于该周期」；缺失或
      // 未发布降级为 BLOCKED，仍可算出参考分但绝不写正式）。
      const policyBinding = await resolvePerformancePolicyBinding(
        store,
        cycle,
        body.policyVersionId,
      );
      const policyFacts = {
        policyVersionId: body.policyVersionId,
        policyVersionStatus: policyBinding.version?.status ?? null,
        policyVersionEffectiveFrom:
          policyBinding.version?.effectiveFrom ?? null,
        policyVersionEffectiveTo: policyBinding.version?.effectiveTo ?? null,
        cyclePolicyVersionId: cycle.policyVersionId ?? null,
        policyBindingSource: cycle.policyVersionId ? "CYCLE" : "REQUEST",
        policyBound: policyBinding.bound,
      };
      const blockers: string[] = [];
      if (policyBinding.blocker) blockers.push(policyBinding.blocker);

      // 权威指标集：已锁定目标卡（cycleId 精确绑定优先，其次按周期匹配）。
      const goalCardRecords = await platformStore.listPolicyEngineRecords(
        tenantId,
        { recordType: "PERFORMANCE_GOAL_CARD", personId: body.personId },
      );
      const lockedCards = goalCardRecords
        .map(
          (record) => record.payload as unknown as LockedGoalCardPayload,
        )
        .filter(
          (card) =>
            card?.status === "LOCKED" &&
            card.personId === body.personId &&
            // 存储层已按租户过滤；负载里的 tenantId 只做防御性核对。
            (card.tenantId === undefined || card.tenantId === tenantId) &&
            (card.cycleId
              ? card.cycleId === cycle.id
              : card.period === period),
        );
      if (lockedCards.length === 0) {
        throw new PerformanceFactsNotReadyError(
          `人员 ${body.personId} 在评价周期 ${cycle.id}（${period}）没有已锁定的目标卡：缺少权威指标集与权重`,
        );
      }
      if (lockedCards.length > 1) {
        throw new PerformanceFactsAmbiguousError(
          `人员 ${body.personId} 在评价周期 ${cycle.id} 存在 ${lockedCards
            .map((card) => card.id)
            .join("、")} 共 ${lockedCards.length} 张已锁定目标卡，无法确定唯一权威事实`,
        );
      }
      const goalCard = lockedCards[0]!;

      // 权威测量：只认唯一一张已通过 contentHash 复核的冻结快照；已消费
      // （CONSUMED）的快照不得再次评分，存在多张冻结快照则事实不唯一。
      const snapshots = await store.listMetricMeasurementSnapshots({
        cycleId: cycle.id,
        personId: body.personId,
      });
      const frozenCandidates = snapshots.filter(
        (candidate) =>
          candidate.status === "FROZEN" && candidate.measurements.length > 0,
      );
      if (frozenCandidates.length === 0) {
        const consumed = snapshots.filter(
          (candidate) => candidate.status === "CONSUMED",
        );
        if (consumed.length > 0) {
          throw new SnapshotAlreadyConsumedError(
            `评价周期 ${cycle.id} / 人员 ${body.personId} 的冻结快照已被消费（${consumed
              .map((candidate) => candidate.id)
              .join("、")}），不能再次评分`,
          );
        }
        throw new PerformanceFactsNotReadyError(
          `评价周期 ${cycle.id} / 人员 ${body.personId} 没有冻结的指标计量快照`,
        );
      }
      if (frozenCandidates.length > 1) {
        throw new PerformanceFactsAmbiguousError(
          `评价周期 ${cycle.id} / 人员 ${body.personId} 存在 ${frozenCandidates.length} 张冻结快照（${frozenCandidates
            .map((candidate) => candidate.id)
            .join("、")}），无法确定唯一权威事实`,
        );
      }
      const activeSnapshot = frozenCandidates[0]!;
      const verification = await store.verifyMetricMeasurementSnapshot(
        activeSnapshot.id,
      );
      if (!verification.valid) {
        throw new PerformanceFactsNotReadyError(
          `指标计量快照 ${activeSnapshot.id} contentHash 复核失败（期望 ${verification.expectedHash}，实际 ${verification.actualHash}），不得作为评分事实`,
        );
      }

      // 来源追溯：每项测量都必须能回到 sourceRef/sourceSystem/
      // sourceRecordId/sourceVersion，否则事实不可复核（fail-closed）。
      const traceGaps: string[] = [];
      for (const record of activeSnapshot.measurements) {
        const missing = REQUIRED_SNAPSHOT_SOURCE_FIELDS.filter(
          (field) => !hasText((record as TraceableMeasurementRecord)[field]),
        );
        if (missing.length > 0) {
          traceGaps.push(`${record.metricId}: ${missing.join("/")}`);
        }
      }
      if (traceGaps.length > 0) {
        throw new PerformanceSourceTraceMissingError(
          `计量快照 ${activeSnapshot.id} 的来源追溯不完整（${traceGaps.join(
            "；",
          )}）：每项快照必须提供 sourceRef/sourceSystem/sourceRecordId/sourceVersion`,
        );
      }

      const metricById = new Map(
        goalCard.metrics.map((metric) => [metric.metricId, metric]),
      );
      const snapshotById = new Map(
        activeSnapshot.measurements.map((record) => [record.metricId, record]),
      );
      const snapshotMetricIds = new Set(snapshotById.keys());
      const supplements = new Map(
        metricInputs.map((input) => [input.metricId, input]),
      );
      for (const input of metricInputs) {
        // 说明性字段之外的一切都必须被拒绝：否则客户端就能决定分值的来源。
        const authoritativeFields = Object.keys(input).filter(
          (key) => !NON_AUTHORITATIVE_METRIC_INPUT_FIELDS.has(key),
        );
        if (authoritativeFields.length > 0) {
          throw new PerformanceInputOverridesFactsError(
            `metricInputs.${input.metricId} 提供了权威字段 ${authoritativeFields.join(
              "、",
            )}；指标值只能来自已核验的计量快照`,
          );
        }
        if (!snapshotMetricIds.has(input.metricId)) {
          throw new PerformanceInputOverridesFactsError(
            `metricInputs.${input.metricId} 不在已冻结快照中：不得以客户端输入补齐测量事实`,
          );
        }
      }

      const measurements: MetricMeasurement[] = activeSnapshot.measurements.map(
        (record) => {
          const supplement = supplements.get(record.metricId);
          const value = (record.value ?? "").trim();
          const usable =
            record.qualityStatus === "VALID" &&
            DECIMAL_VALUE_PATTERN.test(value);
          const evidenceRefs = [
            ...new Set([
              `metric-snapshot:${activeSnapshot.id}:${record.metricId}`,
              ...(record.sourceRef ? [record.sourceRef] : []),
              ...(supplement?.evidenceRefs ?? []),
            ]),
          ];
          const measurement: MetricMeasurement = {
            metricId: record.metricId,
            applicable: usable,
            evidenceRefs,
          };
          if (usable) {
            Object.assign(
              measurement,
              measurementSlotForMetricType(
                metricById.get(record.metricId)?.metricType,
                value,
              ),
            );
          } else {
            measurement.naReason =
              supplement?.naReason ??
              (record.qualityStatus !== "VALID"
                ? `快照质量状态 ${record.qualityStatus}，不作为评分依据`
                : `快照值 ${JSON.stringify(record.value)} 不是可解析的十进制数，不作为评分依据`);
          }
          if (supplement?.sampleSize !== undefined) {
            measurement.sampleSize = supplement.sampleSize;
          }
          return measurement;
        },
      );

      const missingMetricIds = goalCard.metrics
        .map((metric) => metric.metricId)
        .filter((metricId) => !snapshotMetricIds.has(metricId));
      const coverageComplete = missingMetricIds.length === 0;
      // 逐项质量：目标卡上的每个指标都必须有 quality=VALID 且可解析的快照值。
      const invalidQualityMetricIds = goalCard.metrics
        .map((metric) => metric.metricId)
        .filter((metricId) => {
          const record = snapshotById.get(metricId);
          if (!record) return false;
          return (
            record.qualityStatus !== "VALID" ||
            !DECIMAL_VALUE_PATTERN.test((record.value ?? "").trim())
          );
        });
      const qualityAllValid = invalidQualityMetricIds.length === 0;

      const result = runPolicyInput(() =>
        scorePerformance({
          personId: body.personId,
          period: goalCard.period,
          metrics: goalCard.metrics,
          measurements,
          coverageComplete,
        }),
      );

      const eligibility: PerformanceEligibility = !policyBinding.bound
        ? "BLOCKED"
        : result.complete &&
            result.scoreable &&
            coverageComplete &&
            qualityAllValid
          ? "FORMAL"
          : "INCOMPLETE";
      // 只有 FORMAL 才写 COMPUTED；其余写 INCOMPLETE/BLOCKED，绝不把算出
      // 的参考分伪装成正式评分。
      const recordStatus =
        eligibility === "FORMAL" ? "COMPUTED" : eligibility;

      const sources = activeSnapshot.measurements
        .map((record) => {
          const traceable = record as TraceableMeasurementRecord;
          return {
            metricId: record.metricId,
            source: record.source,
            sourceRef: record.sourceRef ?? null,
            sourceSystem: traceable.sourceSystem ?? null,
            sourceRecordId: traceable.sourceRecordId ?? null,
            sourceVersion: traceable.sourceVersion ?? null,
            observedAt: record.observedAt,
            qualityStatus: record.qualityStatus,
          };
        })
        .sort((left, right) => left.metricId.localeCompare(right.metricId));

      const facts = {
        source: PERFORMANCE_SOURCE_LOCKED_FACTS,
        cycleId: cycle.id,
        cycleType: cycle.cycleType,
        personId: body.personId,
        ...policyFacts,
        period: goalCard.period,
        goalCardId: goalCard.id,
        goalCardVersion: goalCard.version,
        goalCardStatus: goalCard.status,
        goalCardLockedAt: goalCard.lockedAt ?? null,
        goalCardMetricsHash: sha256(goalCard.metrics),
        snapshotId: activeSnapshot.id,
        snapshotContentHash: activeSnapshot.contentHash,
        snapshotStatus: activeSnapshot.status,
        snapshotFrozenAt: activeSnapshot.frozenAt,
        snapshotCreatedAt: activeSnapshot.createdAt,
        measurementCount: activeSnapshot.measurements.length,
        eligibility,
        sources,
      };
      // 事实哈希：同输入重放必须一致；补充字段与逐项来源也纳入绑定，避免
      // 「同 hash 不同解释」。这个对象同时是 JEV 证据的原文承诺——证据
      // contentHash 必须等于 factsHash，服务端重算才对得上。
      const factsBinding = {
        kind: "PERFORMANCE_SCORE_FROM_FACTS/v2",
        tenantId,
        facts,
        supplements: metricInputs
          .map((input) => ({
            metricId: input.metricId,
            naReason: input.naReason ?? null,
            sampleSize: input.sampleSize ?? null,
            evidenceRefs: [...(input.evidenceRefs ?? [])].sort(),
          }))
          .sort((left, right) => left.metricId.localeCompare(right.metricId)),
      };
      const factsHash = sha256(factsBinding);

      const warnings: string[] = [];
      if (policyBinding.blocker) {
        warnings.push(
          `${policyBinding.blocker}：本次评分标记 BLOCKED，不得作为正式评价依据`,
        );
      }
      if (!coverageComplete) {
        warnings.push(
          `指标覆盖不完整：快照缺少 ${missingMetricIds.join(
            "、",
          )}，结果仅供复核参考，不得作为正式评价依据`,
        );
      }
      if (!qualityAllValid) {
        warnings.push(
          `快照质量状态非 VALID 的指标：${invalidQualityMetricIds.join(
            "、",
          )}，结果标记 INCOMPLETE，补齐测量后可重算`,
        );
      }
      if (
        eligibility === "INCOMPLETE" &&
        coverageComplete &&
        qualityAllValid
      ) {
        warnings.push(
          "结果未达到正式资格（complete/scoreable 为 false），不得作为正式评价依据",
        );
      }
      if (metricInputs.length > 0) {
        warnings.push(
          "客户端 metricInputs 仅补充说明性字段（naReason/sampleSize/evidenceRefs），未参与评分取值",
        );
      }

      // 评分记录与快照消费的落库顺序（PG 适配器只支持按既有 id 更新记录）：
      // 1) 先写评分记录：草稿状态不可能是 COMPUTED，保存失败则快照不消费；
      // 2) 同一存储方法原子消费快照（consumedByRecordId = 记录 id）；
      // 3) 只有 FORMAL 才把记录升级为 COMPUTED；升级失败回滚消费，绝不留下
      //    「已算出正式分但事实未被消费」或「事实被烧掉但记录不存在」。
      const basePayload = {
        source: PERFORMANCE_SOURCE_LOCKED_FACTS,
        eligibility,
        blockers,
        factsHash,
        facts,
        request: {
          cycleId: body.cycleId,
          personId: body.personId,
          policyVersionId: body.policyVersionId,
          metricInputs,
        },
        measurements,
        result,
      };
      // JEV 案件 id：只有 FORMAL 才会产生；响应回传，便于前端/审计直接跳转。
      let decisionCaseId: string | undefined;
      let record = await platformStore.savePolicyEngineRecord({
        tenantId,
        recordType: "PERFORMANCE_SCORE",
        personId: body.personId,
        period: goalCard.period,
        // 草稿记录永远不是 COMPUTED：只有 FORMAL 且消费成功后才升级。
        status: eligibility === "FORMAL" ? "INCOMPLETE" : recordStatus,
        payload: basePayload,
      });

      let consumedSnapshot:
        | {
            status: string;
            consumedByRecordId?: string;
            consumedByPersonId?: string;
            consumedAt?: string;
          }
        | undefined;
      try {
        consumedSnapshot =
          await snapshotStore.consumeMetricMeasurementSnapshotForScore({
            snapshotId: activeSnapshot.id,
            consumedByRecordId: record.id,
            consumedByPersonId: actorPersonId,
          });
      } catch (error) {
        // 消费失败：把草稿标记为 BLOCKED（best-effort），绝不留正式状态。
        try {
          await platformStore.updatePolicyEngineRecord({
            tenantId,
            recordId: record.id,
            status: "BLOCKED",
            payload: {
              ...basePayload,
              blockers: [...blockers, "SNAPSHOT_CONSUMPTION_FAILED"],
              snapshotConsumption: {
                snapshotId: activeSnapshot.id,
                error: error instanceof Error ? error.message : String(error),
              },
            },
          });
        } catch (updateError) {
          request.log.error(
            { err: updateError, recordId: record.id },
            "failed to mark score record BLOCKED after snapshot consumption failure",
          );
        }
        if (
          error instanceof ConflictError &&
          error.message.startsWith("SNAPSHOT_ALREADY_CONSUMED")
        ) {
          throw new SnapshotAlreadyConsumedError(error.message);
        }
        throw error;
      }

      if (eligibility === "FORMAL") {
        try {
          // 正式结果必须进入 JEV：先创建/关联 PERFORMANCE 案件并写入一条
          // PERFORMANCE_SCORE 证据（contentHash = factsHash），成功后才把记录
          // 升级为 COMPUTED。JEV 写入失败与记录落库失败同路径回滚，绝不留下
          // 「正式但不可审计」的评分。
          const decisionCase = await ensurePerformanceScoreDecisionCase({
            platformStore,
            tenantId,
            record,
            createdBy: actorPersonId,
          });
          decisionCaseId = decisionCase.decisionCase.id;
          record = await platformStore.updatePolicyEngineRecord({
            tenantId,
            recordId: record.id,
            status: "COMPUTED",
            payload: {
              ...basePayload,
              decisionCaseId: decisionCase.decisionCase.id,
              snapshotConsumption: {
                snapshotId: activeSnapshot.id,
                consumedByRecordId: record.id,
                consumedByPersonId: actorPersonId,
                consumedAt: consumedSnapshot.consumedAt,
              },
            },
          });
        } catch (error) {
          try {
            await snapshotStore.releaseMetricMeasurementSnapshotConsumption({
              snapshotId: activeSnapshot.id,
              consumedByRecordId: record.id,
            });
          } catch (releaseError) {
            request.log.error(
              {
                err: releaseError,
                snapshotId: activeSnapshot.id,
                recordId: record.id,
              },
              "failed to release metric snapshot after score record persistence failure",
            );
          }
          // 草稿最多留在 INCOMPLETE/BLOCKED，绝不留下「正式」假象。
          try {
            await platformStore.updatePolicyEngineRecord({
              tenantId,
              recordId: record.id,
              status: "BLOCKED",
              payload: {
                ...basePayload,
                blockers: [...blockers, "RECORD_PERSISTENCE_FAILED"],
              },
            });
          } catch (updateError) {
            request.log.error(
              { err: updateError, recordId: record.id },
              "failed to mark score record BLOCKED after persistence failure",
            );
          }
          throw error;
        }
      }

      return data(
        {
          ...result,
          source: PERFORMANCE_SOURCE_LOCKED_FACTS,
          eligibility,
          factsHash,
          facts,
          policyVersion: policyFacts,
          coverage: { complete: coverageComplete, missingMetricIds },
          snapshot: {
            id: activeSnapshot.id,
            status: consumedSnapshot?.status ?? activeSnapshot.status,
            consumedByRecordId: consumedSnapshot?.consumedByRecordId,
            consumedAt: consumedSnapshot?.consumedAt,
          },
          blockers,
          warnings,
          recordId: record.id,
          // FORMAL 结果对应的 JEV 案件（kind=PERFORMANCE，subject=评分记录）。
          decisionCaseId: decisionCaseId ?? null,
        },
        request,
      );
    });

    // -------------------------------------------------------------------------
    // 正式评分的 JEV 案件（幂等）。
    //
    // score-from-facts 已经为 FORMAL 结果自动建案；这两个端点用于：
    // - GET：审计/前端读取「这条正式评分属于哪个 JEV 案件」；
    // - POST：对历史 FORMAL 记录补建（或重放时修复半途失败），同一
    //   recordId 只关联一次，重复调用返回 created=false 与同一案件。
    // -------------------------------------------------------------------------
    app.post("/api/v1/policy/performance/scores/:id/decision-case", async (request, reply) => {
      requireRoles(request, "manager", "finance");
      const createdBy = ownPersonId(request);
      if (!createdBy) {
        throw new ForbiddenError(
          "linking a performance score decision case requires an employee identity",
        );
      }
      const tenantId = tenantOf(request);
      const record = await platformStore.getPolicyEngineRecord(
        tenantId,
        idOf(request),
      );
      if (record.recordType !== "PERFORMANCE_SCORE") {
        throw new PerformanceRecordTypeError(
          `记录 ${record.id} 的类型是 ${record.recordType}，不是 PERFORMANCE_SCORE`,
        );
      }
      const ensured = await ensurePerformanceScoreDecisionCase({
        platformStore,
        tenantId,
        record,
        createdBy,
      });
      return reply.status(ensured.created ? 201 : 200).send(
        data(
          {
            created: ensured.created,
            subjectType: "PERFORMANCE_SCORE",
            subjectId: record.id,
            case: ensured.decisionCase,
            evidence: ensured.evidence,
          },
          request,
        ),
      );
    });

    app.get("/api/v1/policy/performance/scores/:id/decision-case", async (request) => {
      requireRoles(request, "manager", "finance");
      const tenantId = tenantOf(request);
      const record = await platformStore.getPolicyEngineRecord(
        tenantId,
        idOf(request),
      );
      if (record.recordType !== "PERFORMANCE_SCORE") {
        throw new PerformanceRecordTypeError(
          `记录 ${record.id} 的类型是 ${record.recordType}，不是 PERFORMANCE_SCORE`,
        );
      }
      const decisionCase = await platformStore.findDecisionCaseBySubject(
        tenantId,
        "PERFORMANCE_SCORE",
        record.id,
      );
      if (!decisionCase) {
        return data(
          {
            recordId: record.id,
            case: null,
            evidence: [],
            judgments: { human: [], ai: [] },
            record: null,
          },
          request,
        );
      }
      return data(
        await platformStore.getDecisionCase(tenantId, decisionCase.id),
        request,
      );
    });

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
