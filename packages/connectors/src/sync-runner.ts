/**
 * NP-INT-003/005/006/009 + 2026-11-21 审计 Wave 1（NP-002/003/004/015/016）：
 * Integration Platform V2 sync runner 核心（CLI 薄壳在 scripts/sync-runner.ts）。
 *
 * 每个资源流（SyncResource）独立调度——读取 checkpoint 断点续跑，
 * 按 mapping.targetType 路由到 Evidence / FinancialFact / Quarantine（NP-015），
 * checkpoint 只在本页目标写入全部成功后推进（NP-003），
 * 财务事实金额/币种从 payload 类型化、校验失败进隔离区（NP-004），
 * 运行计数与逐条结果精确对账（NP-016）。
 */
import {
  buildHttpJsonConnectorConfig,
  type IntegrationConnectionLike,
  type IntegrationMappingLike,
} from "./integration.js";
import { readFileSync } from "node:fs";
import { HttpJsonConnector } from "./http-json.js";
import { canonicalize, sha256Stable, type CanonicalBusinessEvent } from "./canonical.js";

export type SyncRequestFn = <T>(
  path: string,
  init?: { method?: string; body?: string },
) => Promise<T>;

/** OAuth token source contract used by the sync runner (shared with oauth.ts). */
export interface OAuthTokenSourceLike {
  getToken(): Promise<string>;
  invalidate?(): void;
}

interface SyncSchedule {
  id: string;
  connectionId: string;
  name: string;
}

interface SyncRun {
  id: string;
}

interface Mapping extends IntegrationMappingLike {
  id: string;
  status: string;
  targetType?: string;
  version?: number;
}

interface SyncResource {
  id: string;
  resourceKey: string;
  mappingId: string | null;
}

interface SyncCheckpoint {
  cursor: string | null;
  watermark: string | null;
}

interface QuarantineInput {
  sourceSystem: string;
  externalRecordId?: string;
  reason: string;
  payload?: Record<string, unknown>;
}

/**
 * NP-016 / INT-211：精确计数——与逐条结果对账。
 *
 * `recordsInvalid` 是 `recordsQuarantined` 的子集（契约校验失败），不参与
 * fetched = created + updated + duplicate + quarantined + failed 的求和。
 * `recordsUpserted` 为兼容字段，等于 created + updated（不含重复/隔离/失败）。
 */
export interface SyncCounters {
  recordsFetched: number;
  recordsRawPersisted: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsDuplicate: number;
  recordsInvalid: number;
  recordsUpserted: number;
  recordsQuarantined: number;
  recordsFailed: number;
}

/**
 * INT-210：runner 请求错误——携带 HTTP 状态与结构化错误码。
 * 只有已知的幂等重复码才能被解释为 DUPLICATE；其它 409 必须失败。
 */
export class SyncRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SyncRequestError";
  }
}

export interface SyncCycleSummary {
  schedules: Array<{
    scheduleId: string;
    connectionId: string;
    status: string;
    counters: SyncCounters;
  }>;
}

/** 与 096 迁移 ingestion_quarantine.reason CHECK 约束一致的取值。 */
const QUARANTINE_REASONS = new Set([
  "UNRESOLVED_IDENTITY",
  "INVALID_CURRENCY",
  "MISSING_RELATION",
  "SCHEMA_MISMATCH",
  "OTHER",
]);

const FINANCIAL_FACT_TYPES = new Set([
  "GROSS_PROFIT",
  "REVENUE",
  "COST",
  "REFUND",
  "ADJUSTMENT",
]);

const DECIMAL_PATTERN = /^-?\d+(\.\d{1,6})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * NP-008：主体身份解析——canonical UUID 直通；opaque 外部 ID 走
 * ExternalObjectIdentity（096 表）解析；未解析 → UNRESOLVED_IDENTITY 隔离。
 * 永不把 provider ID 强转 UUID。
 */
async function resolveSubject(
  request: SyncRequestFn,
  sourceSystem: string,
  subjectType: string,
  subjectId: string,
  /** INT-207：显式 UUID 直通开关（默认关闭——格式不能证明归属）。 */
  allowUuidPassthrough: boolean,
): Promise<{ subjectId: string } | { error: string }> {
  if (allowUuidPassthrough && UUID_PATTERN.test(subjectId)) {
    return { subjectId };
  }
  try {
    const identity = await request<{ internalObjectId: string }>(
      `/api/v1/external-objects:resolve?sourceSystem=${encodeURIComponent(sourceSystem)}&externalObjectType=${encodeURIComponent(subjectType)}&externalObjectId=${encodeURIComponent(subjectId)}`,
    );
    return { subjectId: identity.internalObjectId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // INT-207：404（未注册）→ 未解析隔离；网络/5xx → 抛出让整页重试，
    // 临时故障不得被误写成 UNRESOLVED_IDENTITY。
    if (/not found/i.test(message) || /HTTP 404/.test(message)) {
      return {
        error: `unresolved external identity ${subjectType}/${subjectId} for ${sourceSystem}`,
      };
    }
    throw error;
  }
}

/** NP-015：路由由 mapping.targetType 显式决定；不再从 evidenceType 猜测。 */
export function routeTarget(targetType: string | undefined): {
  route:
    | "EVIDENCE"
    | "FINANCIAL_FACT"
    | "COMMERCIAL_ACCOUNT"
    | "COMMERCIAL_OPPORTUNITY"
    | "COMMERCIAL_QUOTE"
    | "QUARANTINE";
  reason?: string;
} {
  if (targetType === "EVIDENCE") return { route: "EVIDENCE" };
  if (targetType === "FINANCIAL_FACT") return { route: "FINANCIAL_FACT" };
  if (targetType === "COMMERCIAL_ACCOUNT") {
    return { route: "COMMERCIAL_ACCOUNT" };
  }
  if (targetType === "COMMERCIAL_OPPORTUNITY") {
    return { route: "COMMERCIAL_OPPORTUNITY" };
  }
  if (targetType === "COMMERCIAL_QUOTE") {
    return { route: "COMMERCIAL_QUOTE" };
  }
  return {
    route: "QUARANTINE",
    reason: "SCHEMA_MISMATCH",
  };
}

/** NP-004：财务事实类型化校验——金额/币种必须来自 payload 且格式合法。 */
export interface ParsedFinancialFact {
  amount: string;
  currency: string;
  factType: string;
  legalEntityId?: string;
  orderId?: string;
  contractRef?: string;
  instrumentType?: "INVOICE" | "CREDIT_NOTE" | "PAYMENT" | "COST" | "REFUND";
  recognitionStatus: "DRAFT" | "POSTED";
  accountingPeriod?: string;
  fxSnapshot?: {
    rate: string;
    quoteCurrency: string;
    source: string;
    asOf: string;
  };
  sourceVersion?: string;
  reversalOf?: string;
  reopeningRef?: string;
}

const INSTRUMENT_TYPES = new Set([
  "INVOICE",
  "CREDIT_NOTE",
  "PAYMENT",
  "COST",
  "REFUND",
]);

const ACCOUNTING_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Sprint 5：财务事实类型化——金额/币种之外，POSTED 必须带齐会计语义。 */
export function parseFinancialFact(
  event: Record<string, unknown>,
): ParsedFinancialFact | { error: string; reason: string } {
  const factType = String(event.evidenceType ?? "").toUpperCase();
  if (!FINANCIAL_FACT_TYPES.has(factType)) {
    return {
      error: `evidenceType ${factType || "(missing)"} is not a financial fact type`,
      reason: "SCHEMA_MISMATCH",
    };
  }
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const amountRaw = String(payload.amount ?? "").trim();
  if (!DECIMAL_PATTERN.test(amountRaw)) {
    return {
      error: `financial fact ${event.sourceRecordId}: invalid amount ${amountRaw || "(missing)"}`,
      reason: "SCHEMA_MISMATCH",
    };
  }
  const currencyRaw = String(payload.currency ?? "").trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currencyRaw)) {
    return {
      error: `financial fact ${event.sourceRecordId}: invalid currency ${payload.currency ?? "(missing)"}`,
      reason: "INVALID_CURRENCY",
    };
  }

  const recognitionRaw = String(payload.recognitionStatus ?? "DRAFT")
    .trim()
    .toUpperCase();
  if (recognitionRaw !== "DRAFT" && recognitionRaw !== "POSTED") {
    return {
      error: `financial fact ${event.sourceRecordId}: invalid recognitionStatus ${recognitionRaw}`,
      reason: "SCHEMA_MISMATCH",
    };
  }
  const recognitionStatus = recognitionRaw as "DRAFT" | "POSTED";

  const instrumentRaw = String(payload.instrumentType ?? "").trim().toUpperCase();
  if (instrumentRaw && !INSTRUMENT_TYPES.has(instrumentRaw)) {
    return {
      error: `financial fact ${event.sourceRecordId}: invalid instrumentType ${instrumentRaw}`,
      reason: "SCHEMA_MISMATCH",
    };
  }
  const instrumentType = instrumentRaw
    ? (instrumentRaw as ParsedFinancialFact["instrumentType"])
    : undefined;

  const legalEntityId = textValue(payload.legalEntityId);
  const orderId = textValue(payload.orderId);
  const contractRef = textValue(payload.contractRef);
  const accountingPeriod = textValue(payload.accountingPeriod);
  const sourceVersion =
    textValue(payload.sourceVersion) ?? textValue(event.sourceEventVersion);
  const reversalOf = textValue(payload.reversalOf);
  const reopeningRef = textValue(payload.reopeningRef);

  if (accountingPeriod && !ACCOUNTING_PERIOD_PATTERN.test(accountingPeriod)) {
    return {
      error: `financial fact ${event.sourceRecordId}: accountingPeriod must be YYYY-MM`,
      reason: "SCHEMA_MISMATCH",
    };
  }
  if (instrumentType === "PAYMENT" && !orderId && !contractRef) {
    return {
      error: `financial fact ${event.sourceRecordId}: PAYMENT requires orderId or contractRef`,
      reason: "SCHEMA_MISMATCH",
    };
  }

  let fxSnapshot: ParsedFinancialFact["fxSnapshot"];
  if (payload.fxSnapshot && typeof payload.fxSnapshot === "object") {
    const fx = payload.fxSnapshot as Record<string, unknown>;
    const rate = String(fx.rate ?? "").trim();
    const quoteCurrency = String(fx.quoteCurrency ?? "").trim().toUpperCase();
    const source = String(fx.source ?? "").trim();
    const asOf = String(fx.asOf ?? "").trim();
    if (
      !DECIMAL_PATTERN.test(rate) ||
      !CURRENCY_PATTERN.test(quoteCurrency) ||
      !source ||
      !/^\d{4}-\d{2}-\d{2}T/.test(asOf)
    ) {
      return {
        error: `financial fact ${event.sourceRecordId}: invalid fxSnapshot`,
        reason: "SCHEMA_MISMATCH",
      };
    }
    fxSnapshot = { rate, quoteCurrency, source, asOf };
  }

  if (recognitionStatus === "POSTED") {
    if (!legalEntityId || !accountingPeriod || !instrumentType || !sourceVersion) {
      return {
        error:
          `financial fact ${event.sourceRecordId}: POSTED requires ` +
          "legalEntityId, accountingPeriod, instrumentType, sourceVersion",
        reason: "SCHEMA_MISMATCH",
      };
    }
  }

  return {
    amount: amountRaw,
    currency: currencyRaw,
    factType,
    legalEntityId,
    orderId,
    contractRef,
    instrumentType,
    recognitionStatus,
    accountingPeriod,
    fxSnapshot,
    sourceVersion,
    reversalOf,
    reopeningRef,
  };
}

function textValue(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? undefined : text;
}

/** 只有这些结构化错误码能被解释为“幂等重复”（成功）。 */
const DUPLICATE_CODES = new Set([
  "DUPLICATE_SOURCE_VERSION",
  "DUPLICATE_EVIDENCE",
  "DUPLICATE_FINANCIAL_FACT",
  "IDEMPOTENT_REPLAY",
  "STALE_FINANCIAL_FACT",
]);

/** 已知幂等重复的 message 前缀（旧 endpoint 仅返回 CONFLICT + message）。 */
const DUPLICATE_MESSAGE_PREFIXES = [
  "DUPLICATE_SOURCE_VERSION:",
  "DUPLICATE_EVIDENCE:",
  "DUPLICATE_FINANCIAL_FACT:",
  "IDEMPOTENT_REPLAY:",
  "STALE_FINANCIAL_FACT:",
];

function errorStatus(error: unknown): number | undefined {
  if (typeof (error as { status?: unknown }).status === "number") {
    return (error as { status: number }).status;
  }
  const match = /HTTP (\d{3})/.exec(
    error instanceof Error ? error.message : String(error),
  );
  return match ? Number(match[1]) : undefined;
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * 幂等投影：仅当返回结构化幂等码（或旧接口的已知重复 message 前缀）时
 * 视为 DUPLICATE。其它 409（期间关闭/身份冲突/乐观锁/资源版本冲突）必须
 * 抛出，不能被误判为“已经同步成功”。
 */
async function writeTargetIdempotent(
  request: SyncRequestFn,
  path: string,
  body: string,
): Promise<"CREATED" | "DUPLICATE"> {
  try {
    await request(path, { method: "POST", body });
    return "CREATED";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = errorCode(error);
    if (code && DUPLICATE_CODES.has(code)) return "DUPLICATE";
    if (DUPLICATE_MESSAGE_PREFIXES.some((prefix) => message.startsWith(prefix))) {
      return "DUPLICATE";
    }
    if (errorStatus(error) === 409) {
      throw new Error(
        `SYNC_CONFLICT_UNCLASSIFIED: ${message} ` +
          `(409 without an idempotency code is not a successful sync)`,
      );
    }
    throw error;
  }
}

/** 财务事实期间：优先 accountingPeriod（YYYY-MM），否则业务发生日期。 */
function financialPeriod(
  event: Record<string, unknown>,
  occurredAt: string,
): { periodStart?: string; periodEnd?: string } {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const period = String(payload.accountingPeriod ?? "").trim();
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) {
    const year = Number(month[1]);
    const monthIndex = Number(month[2]);
    if (monthIndex >= 1 && monthIndex <= 12) {
      const first = new Date(Date.UTC(year, monthIndex - 1, 1));
      const last = new Date(Date.UTC(year, monthIndex, 0));
      return {
        periodStart: first.toISOString().slice(0, 10),
        periodEnd: last.toISOString().slice(0, 10),
      };
    }
  }
  const start = String(payload.periodStart ?? "").slice(0, 10);
  const end = String(payload.periodEnd ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) || /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return {
      periodStart: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : undefined,
      periodEnd: /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : undefined,
    };
  }
  const date = occurredAt.slice(0, 10);
  return {
    periodStart: date || undefined,
    periodEnd: date || undefined,
  };
}

async function recordQuarantine(
  request: SyncRequestFn,
  input: QuarantineInput,
): Promise<void> {
  const reason = QUARANTINE_REASONS.has(input.reason) ? input.reason : "OTHER";
  await request("/api/v1/ingestion-quarantine", {
    method: "POST",
    body: JSON.stringify({
      sourceSystem: input.sourceSystem,
      externalRecordId: input.externalRecordId || undefined,
      reason,
      payload: input.payload ?? {},
    }),
  });
}

/**
 * 一轮同步：claim 到期排期 → 逐连接/逐资源处理 → finish。
 * request 可注入（进程内测试走 app.inject），providerFetchImpl 可注入（模拟供应商）。
 */
export async function runSyncCycle(deps: {
  request: SyncRequestFn;
  limit?: number;
  maxPages?: number;
  claimNow?: string;
  providerFetchImpl?: typeof fetch;
  /** INT-201：凭据解析（credentialRef → 真实凭据）。缺省读 SECRETS_JSON/SECRETS_FILE。 */
  credentialRefResolver?: (credentialRef: string) => string | undefined;
  /**
   * INT-214：OAuth token source（client-credentials / refresh-token）。
   * 给了它就不再用静态 Bearer；401 时 invalidate + 重试一次。
   */
  oauthTokenResolver?: (credentialRef: string) => OAuthTokenSourceLike | undefined;
}): Promise<SyncCycleSummary> {
  const { request } = deps;
  const effectiveMaxPages = Math.max(1, deps.maxPages ?? 5);
  const claimed = await request<SyncSchedule[]>("/api/v1/sync-schedules/claim-due", {
    method: "POST",
    body: JSON.stringify({ limit: deps.limit ?? 10, now: deps.claimNow }),
  });

  const summary: SyncCycleSummary = { schedules: [] };
  for (const schedule of claimed) {
    const counters: SyncCounters = {
      recordsFetched: 0,
      recordsRawPersisted: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsDuplicate: 0,
      recordsInvalid: 0,
      recordsUpserted: 0,
      recordsQuarantined: 0,
      recordsFailed: 0,
    };
    /** INT-205：已领取租约（fencing token），循环结束或失败时统一释放。 */
    const claimedLeases: Array<{ resourceId: string; fencingToken: number }> = [];
    /**
     * INT-204：本次运行已投影的键。必须包含业务身份（租户由 resource 隐式
     * 隔离、来源、资源、外部记录、来源版本、映射版本、目标类型）——只用
     * payloadHash 会把两个内容相同但业务上不同的记录误判为重复。
     */
    const projectedKeys = new Set<string>();
    let run: SyncRun | undefined;
    try {
      run = await request<SyncRun>(
        `/api/v1/integration-connections/${schedule.connectionId}/sync-runs`,
        { method: "POST", body: JSON.stringify({ status: "QUEUED" }) },
      );
      const connection = await request<IntegrationConnectionLike>(
        `/api/v1/integration-connections/${schedule.connectionId}`,
      );
      const mappings = await request<Mapping[]>(
        `/api/v1/integration-connections/${schedule.connectionId}/mappings?status=ACTIVE`,
      );
      // NP-INT-005：每个 mapping 独立调度（不再只取第一条）。
      const httpMappings = mappings.filter(
        (candidate) => candidate.mappingType === "HTTP_JSON",
      );
      if (httpMappings.length === 0) {
        throw new Error("no active HTTP_JSON mapping for the connection");
      }

      // NP-INT-003：按 mapping 创建/获取 SyncResource（幂等：409 视为已存在）。
      const resources: Array<{
        resource: SyncResource;
        mapping: Mapping;
        config: NonNullable<ReturnType<typeof buildHttpJsonConnectorConfig>>;
        oauthSource?: OAuthTokenSourceLike;
      }> = [];
      for (const mapping of httpMappings) {
        const config = buildHttpJsonConnectorConfig(connection, mapping);
        if (!config) {
          // INT-211：映射不可用是配置错误，必须让 run FAILED——绝不能
          // 静默跳过、让排期看起来成功但实际没有同步。
          throw new Error(
            `MAPPING_CONFIG_INVALID: mapping ${mapping.id} ` +
              `is missing url or required fieldMap columns (sourceRecordId/eventType/subjectType/subjectId/evidenceType)`,
          );
        }
        if (deps.providerFetchImpl) config.fetchImpl = deps.providerFetchImpl;
        // INT-201/214：凭据链——OAuth token source 优先；否则静态凭据。
        // 解析失败 → run FAILED（绝不发送 [REDACTED] 占位请求）。
        let oauthSource: OAuthTokenSourceLike | undefined;
        if (connection.credentialRef) {
          oauthSource = deps.oauthTokenResolver?.(connection.credentialRef);
          if (!oauthSource) {
            const secret =
              deps.credentialRefResolver?.(connection.credentialRef) ??
              resolveSecretFromEnv(connection.credentialRef);
            if (!secret) {
              throw new Error(
                `SECRET_RESOLUTION_FAILED: credentialRef ${connection.credentialRef} is not resolvable — refusing to call the provider without credentials`,
              );
            }
            config.headers = {
              ...(config.headers ?? {}),
              authorization: secret.startsWith("Bearer ") ? secret : `Bearer ${secret}`,
            };
          }
        }
        // 每个 mapping 的 resourceKey 用 mapping.id 确保独立调度。
        let resource: SyncResource | undefined;
        try {
          const created = await request<{ id: string; resourceKey: string }>(
            "/api/v1/sync-resources",
            {
              method: "POST",
              body: JSON.stringify({
                connectionId: schedule.connectionId,
                resourceKey: mapping.id,
                mappingId: mapping.id,
              }),
            },
          );
          resource = { id: created.id, resourceKey: mapping.id, mappingId: mapping.id };
        } catch {
          // 幂等：可能已存在（409），尝试查询。
          const existing = await request<
            Array<{ id: string; resourceKey: string; mappingId: string | null }>
          >(`/api/v1/sync-resources?connectionId=${schedule.connectionId}`);
          const match = existing.find((r) => r.resourceKey === mapping.id);
          if (match) resource = { id: match.id, resourceKey: mapping.id, mappingId: match.mappingId };
        }
        if (!resource) continue;
        resources.push({ resource, mapping, config, oauthSource });
      }

      for (const { resource, mapping, config, oauthSource } of resources) {
        let resourceOverlapSeconds = 0;
        // INT-205：资源级租约——worker 实际使用 API 租约与 fencing token。
        const lease = await request<{ fencingToken: number; leaseUntil: string }>(
          `/api/v1/sync-resources/${resource.id}/claim-lease`,
          { method: "POST", body: JSON.stringify({ leaseOwner: run!.id, leaseSeconds: 900 }) },
        );
        claimedLeases.push({ resourceId: resource.id, fencingToken: lease.fencingToken });
        const connector = new HttpJsonConnector(config);
        // NP-INT-003：从 checkpoint 断点续跑（不回到第一页）。
        let cursor: string | null = null;
        // INT-206：watermark 回退 overlap 窗口作为增量起点（边界防丢）。
        let updatedSince: string | undefined;
        try {
          const cp = await request<
            SyncCheckpoint & {
              overlapSeconds?: number;
              updatedAt?: string;
              intervalOverrideMinutes?: number;
            }
          >(`/api/v1/sync-resources/${resource.id}/checkpoint`);
          cursor = cp.cursor;
          resourceOverlapSeconds = cp.overlapSeconds ?? resourceOverlapSeconds;
          if (cp.watermark) {
            const overlapMs = (cp.overlapSeconds ?? 0) * 1000;
            updatedSince = new Date(
              new Date(cp.watermark).getTime() - overlapMs,
            ).toISOString();
          }
          // INT-212：资源级最小调度间隔——距上次同步不足间隔则释放租约并
          // 跳过该资源（连接级排期继续驱动轮询）。
          const overrideMinutes = cp.intervalOverrideMinutes;
          if (overrideMinutes && cp.updatedAt) {
            const elapsedMinutes =
              (Date.now() - new Date(cp.updatedAt).getTime()) / 60_000;
            if (elapsedMinutes < overrideMinutes) {
              await request(`/api/v1/sync-resources/${resource.id}/release-lease`, {
                method: "POST",
                body: JSON.stringify({
                  leaseOwner: run!.id,
                  fencingToken: lease.fencingToken,
                }),
              }).catch(() => undefined);
              const idx = claimedLeases.findIndex(
                (entry) => entry.resourceId === resource.id,
              );
              if (idx >= 0) claimedLeases.splice(idx, 1);
              console.log(
                `resource=${resource.id} throttled: next sync in ${Math.ceil(overrideMinutes - elapsedMinutes)}min`,
              );
              continue;
            }
          }
        } catch (error) {
          // 只有“资源/检查点不存在”可以按首次运行处理；网络/5xx 必须失败，
          // 否则会从第一页重新拉取并制造重复投影。
          if (errorStatus(error) !== 404) throw error;
        }
        // INT-205：长同步心跳——每 5 分钟续约一次；续约失败（租约被抢/过期）
        // 立即抛出，停止当前同步，而不是继续写一个已经失效的 checkpoint。
        let leaseRenewedAt = Date.now();
        for (let page = 0; page < effectiveMaxPages; page += 1) {
          if (Date.now() - leaseRenewedAt > 5 * 60_000) {
            const renewed = await request<{
              fencingToken: number;
              leaseUntil: string;
            }>(`/api/v1/sync-resources/${resource.id}/renew-lease`, {
              method: "POST",
              body: JSON.stringify({
                leaseOwner: run!.id,
                fencingToken: lease.fencingToken,
                leaseSeconds: 900,
              }),
            });
            lease.fencingToken = renewed.fencingToken;
            leaseRenewedAt = Date.now();
          }
          const pullPage = async () => {
            if (oauthSource) {
              const token = await oauthSource.getToken();
              config.headers = {
                ...(config.headers ?? {}),
                authorization: token.startsWith("Bearer ")
                  ? token
                  : `Bearer ${token}`,
              };
            }
            return connector.pull(cursor, updatedSince);
          };
          let result: Awaited<ReturnType<HttpJsonConnector["pull"]>>;
          try {
            result = await pullPage();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            // 401 视为 token 过期：invalidate 后重试一次；仍失败则 run FAILED。
            if (oauthSource && /failed: 401\b/.test(message)) {
              oauthSource.invalidate?.();
              result = await pullPage();
            } else {
              throw error;
            }
          }
          counters.recordsFetched += result.events.length;
          // INT-206：页内最大 sourceUpdatedAt（无则退回 occurredAt）作为增量
          // watermark。用业务发生时间做水位会漏掉“旧单据后来被修改”。
          let pageWatermark: string | null = null;
          // NP-003：本页全部目标写入成功后才推进 checkpoint；
          // 任一写入失败抛出 → run FAILED → checkpoint 停留上一页（可重放、不丢数据）。
          for (const rawEvent of result.events) {
            const event = rawEvent as unknown as Record<string, unknown>;
            const watermarkCandidate =
              (typeof event.sourceUpdatedAt === "string" && event.sourceUpdatedAt) ||
              (typeof event.occurredAt === "string" && event.occurredAt) ||
              undefined;
            if (
              watermarkCandidate &&
              (!pageWatermark || watermarkCandidate > pageWatermark)
            ) {
              pageWatermark = watermarkCandidate;
            }
            // INT-203：先规范化为 Canonical Business Event（fail-closed）。
            let canonical: CanonicalBusinessEvent;
            try {
              canonical = canonicalize(event, {
                sourceSystem: mapping.sourceSystem,
                mappingVersion: mapping.version ?? 1,
              });
            } catch (error) {
              // 契约失败是“坏记录”，不是整页故障：隔离并继续，指标可追溯。
              counters.recordsInvalid += 1;
              counters.recordsQuarantined += 1;
              await recordQuarantine(request, {
                sourceSystem: mapping.sourceSystem,
                externalRecordId: String(event.sourceRecordId ?? ""),
                reason: "SCHEMA_MISMATCH",
                payload: {
                  raw: event.payload ?? event,
                  detail: error instanceof Error ? error.message : String(error),
                },
              });
              continue;
            }
            const externalRecordId = String(
              event.sourceRecordId ?? canonical.externalObjectId,
            );
            const retentionClass =
              mapping.targetType === "FINANCIAL_FACT"
                ? "FINANCIAL"
                : mapping.sourceSystem === "feishu" ||
                    mapping.sourceSystem === "hr"
                  ? "PII"
                  : "DEFAULT";
            // INT-202：raw-first——先落地原始记录（版本化、带内容哈希），
            // 落地失败抛出 → 整页失败，checkpoint 不推进（重放不丢数据）。
            let rawRecord: {
              id: string;
              payloadHash?: string;
              sourceVersion?: string;
            };
            try {
              rawRecord = await request(
                "/api/v1/raw-source-records",
                {
                  method: "POST",
                  body: JSON.stringify({
                    sourceSystem: mapping.sourceSystem,
                    externalRecordId,
                    payload: event.payload ?? {},
                    payloadHash: canonical.payloadHash,
                    sourceVersion: canonical.sourceVersion,
                    mappingVersion: canonical.mappingVersion,
                    retentionClass,
                    resourceId: resource.id,
                    sourceUpdatedAt: canonical.sourceUpdatedAt,
                  }),
                },
              );
            } catch (error) {
              counters.recordsFailed += 1;
              throw error;
            }
            counters.recordsRawPersisted += 1;
            // 同一 sourceVersion 命中既有记录但内容哈希不同 → 来源版本冲突，
            // 不得用旧快照投影新内容，也不得覆盖历史。
            if (
              rawRecord.payloadHash &&
              rawRecord.payloadHash !== canonical.payloadHash
            ) {
              counters.recordsInvalid += 1;
              counters.recordsQuarantined += 1;
              await recordQuarantine(request, {
                sourceSystem: mapping.sourceSystem,
                externalRecordId,
                reason: "OTHER",
                payload: {
                  raw: event.payload ?? event,
                  detail:
                    `SOURCE_VERSION_CONFLICT: sourceVersion ${canonical.sourceVersion} ` +
                    `already stored with payloadHash ${rawRecord.payloadHash}; ` +
                    `incoming ${canonical.payloadHash}`,
                },
              });
              continue;
            }
            // INT-204：投影幂等键包含完整业务身份，避免“内容相同 = 重复”。
            const projectionKey = [
              mapping.sourceSystem,
              resource.id,
              externalRecordId,
              canonical.externalObjectId,
              canonical.sourceVersion,
              canonical.mappingVersion,
              mapping.targetType ?? "UNKNOWN",
            ].join("|");
            if (projectedKeys.has(projectionKey)) {
              counters.recordsDuplicate += 1;
              continue;
            }
            projectedKeys.add(projectionKey);
            const routing = routeTarget(mapping.targetType);
            try {
              if (routing.route === "COMMERCIAL_ACCOUNT") {
                const payload = (event.payload ?? {}) as Record<string, unknown>;
                const externalAccountId = String(
                  payload.externalAccountId ?? event.sourceRecordId ?? "",
                ).trim();
                const name = String(
                  payload.name ?? payload.accountName ?? "",
                ).trim();
                if (!externalAccountId || !name) {
                  counters.recordsInvalid += 1;
                  counters.recordsQuarantined += 1;
                  await recordQuarantine(request, {
                    sourceSystem: mapping.sourceSystem,
                    externalRecordId,
                    reason: "SCHEMA_MISMATCH",
                    payload: { raw: payload, detail: "commercial account requires externalAccountId and name" },
                  });
                  continue;
                }
                const result = await request<{ created: boolean }>(
                  "/api/v1/commercial/import/accounts",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      sourceSystem: mapping.sourceSystem,
                      externalAccountId,
                      name,
                    }),
                  },
                );
                if (result.created) counters.recordsCreated += 1;
                else counters.recordsUpdated += 1;
                counters.recordsUpserted += 1;
                continue;
              }
              if (routing.route === "COMMERCIAL_OPPORTUNITY") {
                const payload = (event.payload ?? {}) as Record<string, unknown>;
                const externalAccountId = String(
                  payload.externalAccountId ?? payload.accountId ?? "",
                ).trim();
                const accountName = String(
                  payload.accountName ?? payload.account ?? "",
                ).trim();
                const externalOpportunityId = String(
                  payload.externalOpportunityId ??
                    event.sourceRecordId ??
                    canonical.externalObjectId,
                ).trim();
                const name = String(payload.name ?? payload.opportunityName ?? "").trim();
                const currency = String(payload.currency ?? "").trim().toUpperCase();
                if (
                  !externalAccountId ||
                  !accountName ||
                  !externalOpportunityId ||
                  !name ||
                  !/^[A-Z]{3}$/.test(currency)
                ) {
                  counters.recordsInvalid += 1;
                  counters.recordsQuarantined += 1;
                  await recordQuarantine(request, {
                    sourceSystem: mapping.sourceSystem,
                    externalRecordId,
                    reason: "SCHEMA_MISMATCH",
                    payload: {
                      raw: payload,
                      detail:
                        "commercial opportunity requires externalAccountId, accountName, externalOpportunityId, name, currency",
                    },
                  });
                  continue;
                }
                const result = await request<{ created: boolean }>(
                  "/api/v1/commercial/import/opportunities",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      sourceSystem: mapping.sourceSystem,
                      externalAccountId,
                      accountName,
                      externalOpportunityId,
                      name,
                      currency,
                      stage: payload.stage,
                      estimatedAmount: payload.estimatedAmount,
                    }),
                  },
                );
                if (result.created) counters.recordsCreated += 1;
                else counters.recordsUpdated += 1;
                counters.recordsUpserted += 1;
                continue;
              }
              if (routing.route === "COMMERCIAL_QUOTE") {
                const payload = (event.payload ?? {}) as Record<string, unknown>;
                const externalOpportunityId = String(
                  payload.externalOpportunityId ?? "",
                ).trim();
                const externalQuoteId = String(
                  payload.externalQuoteId ?? event.sourceRecordId ?? "",
                ).trim();
                const currency = String(payload.currency ?? "").trim().toUpperCase();
                const amount = String(payload.amount ?? "").trim();
                if (
                  !externalOpportunityId ||
                  !externalQuoteId ||
                  !/^[A-Z]{3}$/.test(currency) ||
                  !/^-?\d+(\.\d{1,6})?$/.test(amount)
                ) {
                  counters.recordsInvalid += 1;
                  counters.recordsQuarantined += 1;
                  await recordQuarantine(request, {
                    sourceSystem: mapping.sourceSystem,
                    externalRecordId,
                    reason: "SCHEMA_MISMATCH",
                    payload: { raw: payload, detail: "commercial quote requires externalOpportunityId, externalQuoteId, currency, amount" },
                  });
                  continue;
                }
                const result = await request<{ created: boolean }>(
                  "/api/v1/commercial/import/quotes",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      sourceSystem: mapping.sourceSystem,
                      externalOpportunityId,
                      externalQuoteId,
                      currency,
                      amount,
                      status: payload.status,
                      issuedAt: payload.issuedAt,
                      acceptedAt: payload.acceptedAt,
                    }),
                  },
                );
                if (result.created) counters.recordsCreated += 1;
                else counters.recordsUpdated += 1;
                counters.recordsUpserted += 1;
                continue;
              }
              if (routing.route === "EVIDENCE") {
                // NP-008 + INT-207：外部 ID（含 UUID 形态）先解析身份；未解析 → 隔离。
                const subject = await resolveSubject(
                  request,
                  mapping.sourceSystem,
                  String(event.subjectType ?? ""),
                  String(event.subjectId ?? ""),
                  (mapping.config as { allowUuidPassthrough?: boolean } | undefined)
                    ?.allowUuidPassthrough === true,
                );
                if ("error" in subject) {
                  await recordQuarantine(request, {
                    sourceSystem: mapping.sourceSystem,
                    externalRecordId,
                    reason: "UNRESOLVED_IDENTITY",
                    payload: {
                      raw: event.payload ?? event,
                      detail: subject.error,
                    },
                  });
                  counters.recordsQuarantined += 1;
                  continue;
                }
                const resolvedEvent = { ...rawEvent, subjectId: subject.subjectId } as typeof rawEvent;
                // ingestion batch 内部按 (source, sourceRecordId, eventVersion)
                // 幂等——返回 accepted/duplicates 才是真实结果，不能一律记 created。
                const ingested = await request<{
                  accepted?: number;
                  duplicates?: number;
                }>("/api/v1/ingestion/events:batch", {
                  method: "POST",
                  body: JSON.stringify({
                    sourceSystem: mapping.sourceSystem,
                    events: [resolvedEvent],
                  }),
                });
                if ((ingested.duplicates ?? 0) > 0 && (ingested.accepted ?? 0) === 0) {
                  counters.recordsDuplicate += 1;
                } else {
                  counters.recordsCreated += 1;
                  counters.recordsUpserted += 1;
                }
              } else if (routing.route === "FINANCIAL_FACT") {
                // NP-004：金额/币种类型化；校验失败 → 隔离（不吞错、不写 0）。
                const parsed = parseFinancialFact(event);
                if ("error" in parsed) {
                  await recordQuarantine(request, {
                    sourceSystem: mapping.sourceSystem,
                    externalRecordId,
                    reason: parsed.reason,
                    payload: { raw: event.payload ?? event, detail: parsed.error },
                  });
                  counters.recordsQuarantined += 1;
                  continue;
                }
                const occurredAt =
                  typeof event.occurredAt === "string" ? event.occurredAt : "";
                const period = financialPeriod(event, occurredAt);
                const outcome = await writeTargetIdempotent(
                  request,
                  "/api/v1/financial-facts",
                  JSON.stringify({
                    sourceSystem: mapping.sourceSystem,
                    sourceRecordId: event.sourceRecordId,
                    factType: parsed.factType,
                    periodStart: period.periodStart,
                    periodEnd: period.periodEnd,
                    amount: parsed.amount,
                    currency: parsed.currency,
                    qualityStatus: "UNVERIFIED",
                    sourceUpdatedAt: canonical.sourceUpdatedAt,
                    legalEntityId: parsed.legalEntityId,
                    orderId: parsed.orderId,
                    contractRef: parsed.contractRef,
                    instrumentType: parsed.instrumentType,
                    recognitionStatus: parsed.recognitionStatus,
                    accountingPeriod: parsed.accountingPeriod,
                    fxSnapshot: parsed.fxSnapshot,
                    sourceVersion: parsed.sourceVersion ?? canonical.sourceVersion,
                    reversalOf: parsed.reversalOf,
                    reopeningRef: parsed.reopeningRef,
                    payload: event.payload,
                  }),
                );
                if (outcome === "DUPLICATE") {
                  counters.recordsDuplicate += 1;
                } else {
                  counters.recordsCreated += 1;
                  counters.recordsUpserted += 1;
                }
              } else {
                await recordQuarantine(request, {
                  sourceSystem: mapping.sourceSystem,
                  externalRecordId,
                  reason: routing.reason ?? "SCHEMA_MISMATCH",
                  payload: {
                    raw: event.payload ?? event,
                    detail: `unsupported targetType ${mapping.targetType ?? "(missing)"}`,
                  },
                });
                counters.recordsQuarantined += 1;
              }
            } catch (error) {
              // NP-016：失败计数后再抛——run FAILED 且计数与结果对账。
              counters.recordsFailed += 1;
              throw error;
            }
          }
          // 本页全部写入成功 → 推进 checkpoint（NP-003）+ watermark（INT-206）。
          // watermark 缺省表示保留旧值；只有本页确实观测到时间戳才更新，
          // 不能因为“本页没有时间字段”而清空之前的增量水位。
          const checkpointBody: Record<string, unknown> = {
            cursor: result.nextCursor,
            lastRunId: run.id,
            overlapSeconds: resourceOverlapSeconds,
            // INT-205：只有当前租约持有人可以推进游标。
            leaseOwner: run.id,
            fencingToken: lease.fencingToken,
          };
          if (pageWatermark !== null) checkpointBody.watermark = pageWatermark;
          await request(`/api/v1/sync-resources/${resource.id}/checkpoint`, {
            method: "PUT",
            body: JSON.stringify(checkpointBody),
          });
          cursor = result.nextCursor;
          if (!cursor) break;
        }
      }

      // INT-205：统一释放租约（真实 fencing token）。
      for (const lease of claimedLeases) {
        await request(`/api/v1/sync-resources/${lease.resourceId}/release-lease`, {
          method: "POST",
          body: JSON.stringify({ leaseOwner: run!.id, fencingToken: lease.fencingToken }),
        }).catch(() => undefined);
      }

      // NP-016：finish 计数与逐条结果对账。
      await request(`/api/v1/sync-runs/${run.id}/finish`, {
        method: "POST",
        body: JSON.stringify({
          status: "SUCCEEDED",
          recordsSeen: counters.recordsFetched,
          recordsUpserted: counters.recordsUpserted,
          recordsFetched: counters.recordsFetched,
          recordsRawPersisted: counters.recordsRawPersisted,
          recordsCreated: counters.recordsCreated,
          recordsUpdated: counters.recordsUpdated,
          recordsDuplicate: counters.recordsDuplicate,
          recordsInvalid: counters.recordsInvalid,
          recordsQuarantined: counters.recordsQuarantined,
          recordsFailed: counters.recordsFailed,
        }),
      });
      summary.schedules.push({
        scheduleId: schedule.id,
        connectionId: schedule.connectionId,
        status: "SUCCEEDED",
        counters,
      });
      console.log(
        `schedule=${schedule.name} connection=${schedule.connectionId} run=${run.id} fetched=${counters.recordsFetched} upserted=${counters.recordsUpserted} quarantined=${counters.recordsQuarantined}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // INT-205：失败路径同样释放已领取租约（stale 被拒属预期，吞掉）。
      for (const lease of claimedLeases) {
        await request(`/api/v1/sync-resources/${lease.resourceId}/release-lease`, {
          method: "POST",
          body: JSON.stringify({ leaseOwner: run?.id ?? "unknown", fencingToken: lease.fencingToken }),
        }).catch(() => undefined);
      }
      if (run) {
        await request(`/api/v1/sync-runs/${run.id}/finish`, {
          method: "POST",
          body: JSON.stringify({
            status: "FAILED",
            recordsSeen: counters.recordsFetched,
            recordsUpserted: counters.recordsUpserted,
            recordsFetched: counters.recordsFetched,
            recordsRawPersisted: counters.recordsRawPersisted,
            recordsCreated: counters.recordsCreated,
            recordsUpdated: counters.recordsUpdated,
            recordsDuplicate: counters.recordsDuplicate,
            recordsInvalid: counters.recordsInvalid,
            recordsQuarantined: counters.recordsQuarantined,
            recordsFailed: counters.recordsFailed,
            errorSummary: message.slice(0, 500),
          }),
        }).catch(() => undefined);
      }
      summary.schedules.push({
        scheduleId: schedule.id,
        connectionId: schedule.connectionId,
        status: "FAILED",
        counters,
      });
      console.error(
        `schedule=${schedule.name} connection=${schedule.connectionId} failed: ${message}`,
      );
    }
  }
  return summary;
}

/** INT-201：缺省凭据解析（env：SECRETS_JSON / SECRETS_FILE）。 */
function resolveSecretFromEnv(credentialRef: string): string | undefined {
  try {
    const inline = process.env.SECRETS_JSON;
    if (inline) {
      const map = JSON.parse(inline) as Record<string, string>;
      if (typeof map[credentialRef] === "string") return map[credentialRef];
    }
    const filePath = process.env.SECRETS_FILE;
    if (filePath) {
      const map = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string>;
      if (typeof map[credentialRef] === "string") return map[credentialRef];
    }
  } catch {
    /* 配置错误按缺失处理 */
  }
  return undefined;
}
