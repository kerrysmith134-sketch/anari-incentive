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

/** NP-016：精确计数——与逐条结果对账。 */
export interface SyncCounters {
  recordsFetched: number;
  recordsUpserted: number;
  recordsQuarantined: number;
  recordsFailed: number;
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
function routeTarget(targetType: string | undefined): {
  route: "EVIDENCE" | "FINANCIAL_FACT" | "QUARANTINE";
  reason?: string;
} {
  if (targetType === "EVIDENCE") return { route: "EVIDENCE" };
  if (targetType === "FINANCIAL_FACT") return { route: "FINANCIAL_FACT" };
  return {
    route: "QUARANTINE",
    reason: "SCHEMA_MISMATCH",
  };
}

/** NP-004：财务事实类型化校验——金额/币种必须来自 payload 且格式合法。 */
function parseFinancialFact(
  event: Record<string, unknown>,
): { amount: string; currency: string; factType: string } | { error: string; reason: string } {
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
  return { amount: amountRaw, currency: currencyRaw, factType };
}

/**
 * 幂等投影：仅当错误明确是目标端唯一键冲突（HTTP 409 / duplicate key /
 * UNIQUE constraint）才视为 DUPLICATE。收紧匹配（Sprint 2.1）：宽松的
 * "already" 前缀会把非幂等冲突隐藏为成功。
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
    if (
      /HTTP 409/.test(message) ||
      /duplicate key/i.test(message) ||
      /UNIQUE constraint/i.test(message) ||
      /_pkey|_key/.test(message) && /duplicate/i.test(message)
    ) {
      return "DUPLICATE";
    }
    // INT-208：迟到的旧财务快照 → 跳过（不覆盖新数据），非失败。
    if (/STALE_FINANCIAL_FACT/.test(message)) {
      return "DUPLICATE";
    }
    throw error;
  }
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
      recordsUpserted: 0,
      recordsQuarantined: 0,
      recordsFailed: 0,
    };
    /** INT-205：已领取租约（fencing token），循环结束或失败时统一释放。 */
    const claimedLeases: Array<{ resourceId: string; fencingToken: number }> = [];
    /** INT-204：本次运行已投影的 canonical 哈希（raw 版本化 + 目标唯一键双保险）。 */
    const projectedHashes = new Set<string>();
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
      }> = [];
      for (const mapping of httpMappings) {
        const config = buildHttpJsonConnectorConfig(connection, mapping);
        if (!config) continue;
        if (deps.providerFetchImpl) config.fetchImpl = deps.providerFetchImpl;
        // INT-201：凭据链——脱敏后的连接配置不含真实凭据；经 SecretProvider
        // 解析 credentialRef 并注入认证头。解析失败 → run FAILED（绝不发送
        // [REDACTED] 占位请求）。
        if (connection.credentialRef) {
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
        resources.push({ resource, mapping, config });
      }

      for (const { resource, mapping, config } of resources) {
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
            SyncCheckpoint & { overlapSeconds?: number }
          >(`/api/v1/sync-resources/${resource.id}/checkpoint`);
          cursor = cp.cursor;
          resourceOverlapSeconds = cp.overlapSeconds ?? resourceOverlapSeconds;
          if (cp.watermark) {
            const overlapMs = (cp.overlapSeconds ?? 0) * 1000;
            updatedSince = new Date(
              new Date(cp.watermark).getTime() - overlapMs,
            ).toISOString();
          }
        } catch {
          /* 首次运行无 checkpoint */
        }
        for (let page = 0; page < effectiveMaxPages; page += 1) {
          const result = await connector.pull(cursor, updatedSince);
          counters.recordsFetched += result.events.length;
          // INT-206：页内最大 occurredAt 作为增量 watermark（checkpoint 观测基准）。
          let pageWatermark: string | null = null;
          // NP-003：本页全部目标写入成功后才推进 checkpoint；
          // 任一写入失败抛出 → run FAILED → checkpoint 停留上一页（可重放、不丢数据）。
          for (const rawEvent of result.events) {
            const event = rawEvent as unknown as Record<string, unknown>;
            const occurredAt =
              typeof event.occurredAt === "string" && event.occurredAt
                ? event.occurredAt
                : undefined;
            if (occurredAt && (!pageWatermark || occurredAt > pageWatermark)) {
              pageWatermark = occurredAt;
            }
            // INT-203：先规范化为 Canonical Business Event（fail-closed）。
            const canonical: CanonicalBusinessEvent = canonicalize(event, {
              sourceSystem: mapping.sourceSystem,
              mappingVersion: mapping.version ?? 1,
            });
            // INT-202：raw-first——先加密落地原始记录（版本化、带内容哈希），
            // 落地失败抛出 → 整页失败，checkpoint 不推进（重放不丢数据）。
            await writeTargetIdempotent(request, "/api/v1/raw-source-records", JSON.stringify({
              sourceSystem: mapping.sourceSystem,
              externalRecordId: canonical.externalObjectId !== canonical.eventType ? String(event.sourceRecordId ?? canonical.externalObjectId) : canonical.externalObjectId,
              payload: event.payload ?? {},
              payloadHash: canonical.payloadHash,
              sourceVersion: canonical.sourceVersion,
              mappingVersion: canonical.mappingVersion,
            }));
            // INT-204：投影幂等——同 canonical 哈希本运行内不重复投影。
            const projectionKey = `${canonical.payloadHash}:${canonical.mappingVersion}`;
            if (projectedHashes.has(projectionKey)) {
              continue;
            }
            projectedHashes.add(projectionKey);
            const routing = routeTarget(mapping.targetType);
            try {
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
                    externalRecordId: String(event.sourceRecordId ?? ""),
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
                await writeTargetIdempotent(
                  request,
                  "/api/v1/ingestion/events:batch",
                  JSON.stringify({
                    sourceSystem: mapping.sourceSystem,
                    events: [resolvedEvent],
                  }),
                );
                counters.recordsUpserted += 1;
              } else if (routing.route === "FINANCIAL_FACT") {
                // NP-004：金额/币种类型化；校验失败 → 隔离（不吞错、不写 0）。
                const parsed = parseFinancialFact(event);
                if ("error" in parsed) {
                  await recordQuarantine(request, {
                    sourceSystem: mapping.sourceSystem,
                    externalRecordId: String(event.sourceRecordId ?? ""),
                    reason: parsed.reason,
                    payload: { raw: event.payload ?? event, detail: parsed.error },
                  });
                  counters.recordsQuarantined += 1;
                  continue;
                }
                const occurredAt =
                  typeof event.occurredAt === "string" ? event.occurredAt : "";
                await writeTargetIdempotent(
                  request,
                  "/api/v1/financial-facts",
                  JSON.stringify({
                    sourceSystem: mapping.sourceSystem,
                    sourceRecordId: event.sourceRecordId,
                    factType: parsed.factType,
                    periodStart: occurredAt.slice(0, 10) || undefined,
                    periodEnd: occurredAt.slice(0, 10) || undefined,
                    amount: parsed.amount,
                    currency: parsed.currency,
                    qualityStatus: "UNVERIFIED",
                    payload: event.payload,
                  }),
                );
                counters.recordsUpserted += 1;
              } else {
                await recordQuarantine(request, {
                  sourceSystem: mapping.sourceSystem,
                  externalRecordId: String(event.sourceRecordId ?? ""),
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
          await request(`/api/v1/sync-resources/${resource.id}/checkpoint`, {
            method: "PUT",
            body: JSON.stringify({
              cursor: result.nextCursor,
              lastRunId: run.id,
              watermark: pageWatermark,
              overlapSeconds: resourceOverlapSeconds,
            }),
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
