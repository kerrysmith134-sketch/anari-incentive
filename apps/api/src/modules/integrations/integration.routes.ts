/**
 * 集成域路由（连接器/映射/同步排期/同步运行）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { IntegrationPort } from "../../store-ports.js";
import type { RawSourceRecord } from "@anari/domain";
import {
  claimDueSyncSchedulesSchema,
  claimResourceLeaseSchema,
  createIntegrationConnectionSchema,
  createIntegrationMappingSchema,
  createQuarantineRecordSchema,
  createRawSourceRecordSchema,
  createSyncResourceSchema,
  createSyncRunSchema,
  createSyncScheduleSchema,
  externalObjectMergeSchema,
  externalObjectUnlinkSchema,
  finishSyncRunSchema,
  releaseResourceLeaseSchema,
  renewResourceLeaseSchema,
  replayRawSourceRecordSchema,
  replaySyncRunSchema,
  setIntegrationConnectionStatusSchema,
  setSyncScheduleEnabledSchema,
  upsertExternalObjectSchema,
  upsertSyncCheckpointSchema,
} from "@anari/contracts";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createIntegrationCrypto,
  createKeyRotationMonitor,
  DEFAULT_KEY_HEALTH_INTERVAL_MS,
  MIN_KEY_HEALTH_INTERVAL_MS,
  RawPayloadDecryptError,
  resolveWebhookKeyMaxAgeDays,
} from "../../integration-crypto.js";
import { outboundJsonFetch, redactSample } from "../../outbound-http.js";

/**
 * `WEBHOOK_KEY_HEALTH_INTERVAL_MS`（默认 1 小时，最小 1 分钟）。
 * 与轮换告警无关：只决定进程内健康检查的频率；非法值退回默认。
 */
function resolveKeyHealthIntervalMs(env: NodeJS.ProcessEnv): number {
  const raw = env.WEBHOOK_KEY_HEALTH_INTERVAL_MS;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_KEY_HEALTH_INTERVAL_MS;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_KEY_HEALTH_INTERVAL_MS;
  }
  return Math.max(MIN_KEY_HEALTH_INTERVAL_MS, Math.floor(parsed));
}

/** 重放/证据转投所需的最小 store 面。 */
interface IngestionStoreLike {
  ingestEvents(batch: {
    sourceSystem: string;
    events: Array<{
      sourceRecordId: string;
      sourceEventVersion?: string;
      eventType: string;
      occurredAt?: string;
      subjectType: string;
      subjectId: string;
      evidenceType: string;
      payload?: Record<string, unknown>;
    }>;
  }): Promise<unknown>;
  listFinancialFacts?(): Promise<
    Array<{
      id: string;
      sourceSystem: string;
      sourceRecordId: string;
      amount: string;
      currency: string;
    }>
  >;
  listEvidence(): Promise<
    Array<{
      id: string;
      sourceSystem: string;
      normalizedPayload?: Record<string, unknown>;
      subjectId?: string;
    }>
  >;
  createFinancialFact?(
    input: {
      tenantId: string;
      sourceSystem: string;
      sourceRecordId: string;
      factType: string;
      periodStart?: string;
      periodEnd?: string;
      amount: string;
      currency: string;
      qualityStatus: "VALID" | "UNVERIFIED" | "STALE" | "CONFLICTED" | "MISSING" | "INVALID";
      sourceUpdatedAt?: string;
      payload: Record<string, unknown>;
    },
  ): Promise<{ id: string; sourceUpdatedAt?: string | null }>;

  recordAuditEvent?(event: {
    actorType: "USER" | "AGENT" | "SYSTEM" | "INTEGRATION";
    actorId?: string;
    action: string;
    objectType: string;
    objectId?: string;
    reason?: string;
  }): Promise<unknown>;
}

/** NP-010：provider 探针（可注入以便测试；默认实现真实 fetch）。 */
export interface IntegrationProviderProbe {
  (input: {
    url: string;
    headers: Record<string, string>;
    /** 连接级 host allowlist（统一出站层逐跳校验）。 */
    allowlist?: string[];
  }): Promise<{
    ok: boolean;
    status?: number;
    detail?: string;
    sample?: unknown;
  }>;
}
import {
  buildHttpJsonConnectorConfig,
  mapRecordToEvent,
  parseFinancialFact,
  routeTarget,
  FIELD_MAPPING_PRESETS,
  type IntegrationMappingLike,
} from "@anari/connectors";
import {
  data,
  errorBody,
  parse,
  requireRoles,
  requireActorRequired,
  ownPersonId,
  tenantOf,
  idOf,
  paramOf,
} from "../../http-helpers.js";
import { canonicalJson, sha256 } from "@anari/policy-dsl";
import { ConflictError } from "../../store.js";

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

class NotFoundError extends Error {
  readonly code = "RESOURCE_NOT_FOUND";
  readonly statusCode = 404;
  constructor(message: string) {
    super(message);
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let index = 0; index < bufA.length; index += 1) {
    diff |= bufA[index]! ^ bufB[index]!;
  }
  return diff === 0;
}

export function registerIntegrationRoutes(deps: {
  platformStore: IntegrationPort;
  storeFor: (request: FastifyRequest) => IngestionStoreLike;
  countEvent: (event: string) => void;
  integrationProbe?: IntegrationProviderProbe;
  webhookSigningSecret?: string;
  webhookRawEncryptionKey?: string;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, integrationProbe, webhookSigningSecret, webhookRawEncryptionKey } = deps;

  /**
   * P0（2026-11-21 审计）：webhook 签名密钥与原始数据加密密钥完全分离。
   * 生产缺失/过短/相同 → 启动期 fail-closed（integration-crypto 抛错），
   * 绝不回退 SESSION_SECRET 或公开 dev 默认值。
   */
  const integrationCrypto = createIntegrationCrypto({
    signingSecret: webhookSigningSecret,
    rawEncryptionKey: webhookRawEncryptionKey,
  });

  /**
   * P0（2026-11-21 审计）：所有 provider 诊断请求必须经过统一的出站安全层
   * （egress + DNS 解析校验 + IP pin + 逐跳重定向校验）。禁止直接 fetch。
   */
  const defaultIntegrationProbe: IntegrationProviderProbe = async (input) => {
    try {
      const response = await outboundJsonFetch({
        url: input.url,
        headers: input.headers,
        timeoutMs: 10_000,
        allowlist: input.allowlist,
      });
      const payload = response.json as
        | { records?: unknown[]; data?: { items?: unknown[] } }
        | undefined;
      const records =
        payload && typeof payload === "object"
          ? (payload.records ?? payload.data?.items ?? undefined)
          : undefined;
      return {
        ok: response.ok,
        status: response.status,
        detail: response.ok ? undefined : `provider returned ${response.status}`,
        // 诊断样本只用于字段发现：值级脱敏，字段名保留。
        sample: Array.isArray(records) ? redactSample(records[0]) : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : "provider unreachable",
      };
    }
  };

  // ------------------------------------------------------------------
  // NP-005（2026-11-21 审计）：凭据脱敏——任何连接/映射配置响应中的
  // 敏感键（Authorization/API key/secret/token/password）替换为 [REDACTED]。
  // 凭据值只能来自服务端 SecretProvider（凭据引用 → 值），永不回显。
  // ------------------------------------------------------------------
  const SENSITIVE_KEY_PATTERN =
    /authorization|api[_-]?key|secret|token|password|credential/i;
  function redactConfig(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactConfig);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
          key,
          SENSITIVE_KEY_PATTERN.test(key) && typeof inner === "string" && inner
            ? "[REDACTED]"
            : redactConfig(inner),
        ]),
      );
    }
    return value;
  }
  function redactConnection<T extends { config?: Record<string, unknown> }>(
    connection: T,
  ): T {
    return { ...connection, config: redactConfig(connection.config) as T["config"] };
  }

  // NP-010：服务端凭据解析（引用 → 值）。SECRETS_JSON 与 SECRETS_FILE 同源，
  // 与 worker 的 SecretResolver 保持一致（审计 P1：只读 SECRETS_JSON）。
  function resolveSecret(credentialRef: string): string | undefined {
    const inline = process.env.SECRETS_JSON;
    if (inline) {
      try {
        const map = JSON.parse(inline) as Record<string, string>;
        if (typeof map[credentialRef] === "string") return map[credentialRef];
      } catch {
        /* 配置错误按缺失处理 */
      }
    }
    const filePath = process.env.SECRETS_FILE;
    if (filePath) {
      try {
        const map = JSON.parse(readFileSync(filePath, "utf8")) as Record<
          string,
          string
        >;
        if (typeof map[credentialRef] === "string") return map[credentialRef];
      } catch {
        /* 配置错误按缺失处理 */
      }
    }
    return undefined;
  }

  // NP-009：签名密钥由独立服务端密钥 + routing key 派生。
  const signingKeyFor = (routingKey: string): string =>
    integrationCrypto.signingKeyFor(routingKey);
  const encryptRawPayload = (text: string): string =>
    integrationCrypto.encryptRawPayload(text);

  /** 解密失败必须显式失败（422 + 稳定错误码），不能静默返回 {}。 */
  class RawPayloadUnavailableError extends Error {
    readonly statusCode = 422;
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  function decryptRawPayload(stored: string): string {
    try {
      return integrationCrypto.decryptRawPayload(stored);
    } catch (error) {
      if (error instanceof RawPayloadDecryptError) {
        countEvent("integration_raw_payload_decrypt_failed");
        throw new RawPayloadUnavailableError(error.code, error.message);
      }
      throw error;
    }
  }

  function rawPayloadOf(payloadEncrypted: string): Record<string, unknown> {
    const text = decryptRawPayload(payloadEncrypted);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new RawPayloadUnavailableError(
        "RAW_PAYLOAD_FORMAT_INVALID",
        "raw payload is not a JSON object",
      );
    }
    return parsed as Record<string, unknown>;
  }

  /**
   * INT-209：按 mapping 版本重放单条原始记录——服务端读映射、应用 fieldMap
   * （含 =常量与转换）并按 targetType 投影，成功后标记 replayed 并留审计。
   *
   * sync-run 级重放复用同一路径（单条端点与 run 级端点不得有两套目标写入
   * 语义）；失败由调用方决定是整体报错还是计入 failed 计数。
   */
  async function replayRawRecordByMapping(
    request: FastifyRequest,
    record: RawSourceRecord,
    mappingId: string,
    /** 单条端点已解密时直接复用，避免重复解密。 */
    decryptedPayload?: Record<string, unknown>,
    options?: {
      /**
       * 证据通道的 sourceEventVersion。run 级重放传入原始投影所用版本，
       * 已成功投影的记录会命中 ingest 幂等键（duplicates），不重复落证据。
       */
      sourceEventVersion?: string;
    },
  ): Promise<{ targetType?: string; skipped?: boolean }> {
    const payload = decryptedPayload ?? rawPayloadOf(record.payloadEncrypted);
    const mapping = await platformStore.getIntegrationMapping(
      tenantOf(request),
      mappingId,
    );
    const providerConnection = await platformStore.getIntegrationConnection(
      tenantOf(request),
      mapping.connectionId,
    );
    const mappingLike = mapping as unknown as IntegrationMappingLike;
    const columns = buildHttpJsonConnectorConfig(
      {
        provider: providerConnection.provider,
        credentialRef: providerConnection.credentialRef,
        config: providerConnection.config,
      },
      mappingLike,
    )?.columns;
    if (!columns) {
      throw new ConflictError(
        `REPLAY_MAPPING_UNUSABLE: mapping ${mapping.id} is not an HTTP_JSON mapping with usable columns`,
      );
    }
    const event = mapRecordToEvent(payload, columns);
    const routing = routeTarget(mappingLike.targetType);
    /** 已成功投影过的记录在 run 级重放中应计入 skipped，而不是重复写目标。 */
    let skipped = false;
    if (routing.route === "EVIDENCE") {
      const ingested = await storeFor(request).ingestEvents({
        sourceSystem: mapping.sourceSystem,
        events: [
          {
            ...event,
            ...(options?.sourceEventVersion
              ? { sourceEventVersion: options.sourceEventVersion }
              : {}),
            payload,
          },
        ],
      });
      const result = ingested as
        | { accepted?: number; duplicates?: number }
        | undefined;
      skipped =
        (result?.accepted ?? 1) === 0 && (result?.duplicates ?? 0) > 0;
    } else if (routing.route === "FINANCIAL_FACT") {
      const parsed = parseFinancialFact(
        event as unknown as Record<string, unknown>,
      );
      if ("error" in parsed) {
        throw new ConflictError(
          `REPLAY_FINANCIAL_FACT_INVALID: ${parsed.error}`,
        );
      }
      const occurredAt =
        typeof event.occurredAt === "string" ? event.occurredAt : "";
      await (
        storeFor(request) as unknown as {
          createFinancialFact: (input: Record<string, unknown>) => Promise<unknown>;
        }
      ).createFinancialFact({
        tenantId: tenantOf(request),
        sourceSystem: mapping.sourceSystem,
        sourceRecordId: String(event.sourceRecordId ?? record.externalRecordId),
        factType: parsed.factType,
        periodStart: occurredAt.slice(0, 10) || undefined,
        periodEnd: occurredAt.slice(0, 10) || undefined,
        amount: parsed.amount,
        currency: parsed.currency,
        qualityStatus: "UNVERIFIED",
        sourceUpdatedAt: event.sourceUpdatedAt,
        legalEntityId: parsed.legalEntityId,
        orderId: parsed.orderId,
        contractRef: parsed.contractRef,
        instrumentType: parsed.instrumentType,
        recognitionStatus: parsed.recognitionStatus,
        accountingPeriod: parsed.accountingPeriod,
        fxSnapshot: parsed.fxSnapshot,
        sourceVersion: parsed.sourceVersion,
        reversalOf: parsed.reversalOf,
        payload: event.payload ?? {},
      });
    } else {
      throw new ConflictError(
        `REPLAY_TARGET_UNSUPPORTED: targetType ${mappingLike.targetType ?? "(missing)"} cannot be replayed`,
      );
    }
    await platformStore.markRawSourceRecordReplayed(tenantOf(request), record.id);
    countEvent("raw_source_record_replayed_by_mapping");
    try {
      await storeFor(request)?.recordAuditEvent?.({
        actorType: "USER",
        actorId: ownPersonId(request) ?? undefined,
        action: "RAW_SOURCE_RECORD_REPLAYED_BY_MAPPING",
        objectType: "RAW_SOURCE_RECORD",
        objectId: record.id,
        reason: `mapping=${mappingId} sourceRecord=${record.externalRecordId}`,
      });
    } catch {
      /* audit is best-effort */
    }
    return { targetType: mappingLike.targetType, skipped };
  }


  return async (app: FastifyInstance) => {
  // ------------------------------------------------------------------
  // INT-219：KMS/keyring 轮换健康与告警。
  // 启动检查 + 定时检查只写日志（超龄不阻断启动）；可选
  // WEBHOOK_KEY_ALERT_URL 在超龄/轮换失败时 POST 一条 JSON（5s 超时，
  // 失败只记日志、不递归）。健康快照不含任何密钥材料。
  // ------------------------------------------------------------------
  const keyRotationMonitor = createKeyRotationMonitor({
    crypto: integrationCrypto,
    alertUrl: process.env.WEBHOOK_KEY_ALERT_URL,
    logger: {
      warn: (message, meta) => {
        app.log.warn(meta ?? {}, message);
      },
    },
    countEvent,
    intervalMs: resolveKeyHealthIntervalMs(process.env),
  });
  keyRotationMonitor.start();
  app.addHook("onClose", async () => {
    keyRotationMonitor.stop();
  });
  const keyMaxAge = resolveWebhookKeyMaxAgeDays(process.env);
  if (keyMaxAge.warning) {
    app.log.warn({ setting: "WEBHOOK_KEY_MAX_AGE_DAYS" }, keyMaxAge.warning);
  }

  // INT-217：KMS 主动轮换回调（无员工会话；共享 token + 常数时间比较）。
  app.post("/api/v1/integration-keys/rotate", async (request, reply) => {
    const expected = process.env.WEBHOOK_ROTATION_CALLBACK_TOKEN;
    if (!expected || expected.length < 32) {
      return reply.status(404).send(
        errorBody(
          "ROTATION_CALLBACK_DISABLED",
          "WEBHOOK_ROTATION_CALLBACK_TOKEN is not configured",
        ),
      );
    }
    const provided = String(request.headers["x-rotation-token"] ?? "");
    if (
      provided.length !== expected.length ||
      !timingSafeEqualStr(provided, expected)
    ) {
      countEvent("integration_rotation_callback_rejected");
      return reply.status(401).send(
        errorBody("ROTATION_TOKEN_INVALID", "invalid rotation token"),
      );
    }
    try {
      integrationCrypto.reload();
    } catch {
      // 旧 keyring 继续生效（不静默降级）；health.lastError 暴露原因。
      void keyRotationMonitor.reportReloadFailure();
      return reply.status(500).send(
        errorBody(
          "INTEGRATION_KEY_ROTATION_FAILED",
          integrationCrypto.keyHealth().lastError ??
            "keyring rotation was rejected",
        ),
      );
    }
    countEvent("integration_keys_rotated_by_callback");
    return data(
      {
        keyId: integrationCrypto.keyId,
        keyIds: integrationCrypto.keyIds,
        rotatedAt: new Date().toISOString(),
      },
      request,
    );
  });

  // INT-216：KMS/Vault/文件 keyring 热加载（无需重启 API）。
  app.post("/api/v1/integration-keys/reload", async (request, reply) => {
    requireRoles(request, "admin");
    try {
      integrationCrypto.reload();
    } catch {
      void keyRotationMonitor.reportReloadFailure();
      return reply.status(409).send(
        errorBody(
          "INTEGRATION_KEY_RELOAD_FAILED",
          integrationCrypto.keyHealth().lastError ??
            "keyring reload was rejected",
        ),
      );
    }
    countEvent("integration_keys_reloaded");
    return data(
      {
        keyId: integrationCrypto.keyId,
        keyIds: integrationCrypto.keyIds,
        reloadedAt: new Date().toISOString(),
      },
      request,
    );
  });

  // INT-219：轮换健康（admin）——只返回 keyId/年龄/来源，不含密钥材料。
  app.get("/api/v1/integration-keys/health", async (request) => {
    requireRoles(request, "admin");
    return data(integrationCrypto.keyHealth(), request);
  });

  app.post("/api/v1/integration-connections", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createIntegrationConnectionSchema, request.body);
    return reply.status(201).send(
      data(
        redactConnection(
          await platformStore.createIntegrationConnection({
            tenantId: tenantOf(request),
            provider: body.provider,
            connectionName: body.connectionName,
            credentialRef: body.credentialRef,
            config: body.config ?? {},
          }),
        ),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    return data(
      (await platformStore.listIntegrationConnections(tenantOf(request))).map(
        (connection) => redactConnection(connection),
      ),
      request,
    );
  });

  app.get("/api/v1/integration-connections/:id", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    return data(
      redactConnection(
        await platformStore.getIntegrationConnection(
          tenantOf(request),
          idOf(request),
        ),
      ),
      request,
    );
  });

  // 连接测试（NP-010）：凭据引用/必需键之外，必须真实探测 provider
  // （认证 + 端点读取 + 样例）；诊断信息脱敏（只回状态码/摘要，不回凭据）。
  app.get("/api/v1/integration-connections/:id/test", async (request) => {
    requireRoles(request, "admin", "integration");
    const connection = await platformStore.getIntegrationConnection(
      tenantOf(request),
      idOf(request),
    );
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
    checks.push({
      name: "凭据引用",
      ok: Boolean(connection.credentialRef),
      detail: connection.credentialRef
        ? "已设置（服务端不回显值）"
        : "缺失：请填写保管库路径或密钥名",
    });
    const config = (connection.config ?? {}) as Record<string, unknown>;
    const url =
      typeof config.url === "string" && config.url.trim()
        ? config.url.trim()
        : undefined;
    const required =
      connection.provider === "hubspot"
        ? ["portalId"]
        : connection.provider === "feishu"
          ? ["appToken"]
          : ["url"];
    const missing = required.filter((key) => !(key in config));
    checks.push({
      name: "连接配置",
      ok: missing.length === 0 && Boolean(url),
      detail:
        missing.length === 0 && url
          ? "必需键齐全"
          : `缺少键：${missing.join(", ") || "url"}`,
    });
    // NP-010：provider 真实探测（注入探针可测；默认走统一出站安全层）。
    let sample: unknown;
    if (url) {
      const secret = connection.credentialRef
        ? resolveSecret(connection.credentialRef)
        : undefined;
      const probePath =
        typeof config.probePath === "string" && config.probePath
          ? config.probePath
          : "";
      const probe = integrationProbe ?? defaultIntegrationProbe;
      const result = await probe({
        url: `${url.replace(/\/$/, "")}${probePath}`,
        headers: secret
          ? { authorization: `Bearer ${secret}`, accept: "application/json" }
          : { accept: "application/json" },
        allowlist: Array.isArray(config.egressAllowlist)
          ? (config.egressAllowlist as string[])
          : undefined,
      });
      checks.push({
        name: "provider 探测",
        ok: result.ok,
        detail: result.detail,
      });
      // 注入探针同样要脱敏，不能只依赖默认实现。
      if (result.ok && result.sample !== undefined) {
        sample = redactSample(result.sample);
      }
    }
    const ok = checks.every((check) => check.ok);
    countEvent("integration_connection_tested");
    return data(
      {
        connectionId: connection.id,
        provider: connection.provider,
        ok,
        checks,
        sample,
        testedAt: new Date().toISOString(),
      },
      request,
    );
  });

  // ------------------------------------------------------------------
  // P1 Provider Schema Discovery：probe 真实拉一页样本 → 顶层字段推断 →
  // 与 ACTIVE mapping 的 fieldMap 对比给出 drift 警告 → 映射后事件预览。
  // ------------------------------------------------------------------
  app.post("/api/v1/integration-connections/:id/schema-preview", async (request) => {
    requireRoles(request, "admin", "integration");
    const connection = await platformStore.getIntegrationConnection(
      tenantOf(request),
      idOf(request),
    );
    const config = (connection.config ?? {}) as Record<string, unknown>;
    const url =
      typeof config.url === "string" && config.url.trim() ? config.url.trim() : undefined;
    const body = (request.body ?? {}) as { probePath?: string; recordsPath?: string };
    const secret = connection.credentialRef ? resolveSecret(connection.credentialRef) : undefined;
    const probePath =
      typeof body.probePath === "string" && body.probePath ? body.probePath : "";
    const recordsPath =
      typeof body.recordsPath === "string" && body.recordsPath
        ? body.recordsPath
        : "records";
    const probe = integrationProbe ?? defaultIntegrationProbe;
    let sample: Record<string, unknown> | undefined;
    let ok = false;
    let probeDetail: string | undefined;
    if (url) {
      const result = await probe({
        url: `${url.replace(/\/$/, "")}${probePath}`,
        headers: secret
          ? { authorization: `Bearer ${secret}`, accept: "application/json" }
          : { accept: "application/json" },
        allowlist: Array.isArray(config.egressAllowlist)
          ? (config.egressAllowlist as string[])
          : undefined,
      });
      ok = result.ok;
      probeDetail = result.detail;
      if (result.ok && result.sample && typeof result.sample === "object") {
        // 字段级脱敏：保留字段名/类型用于映射，值不回显 PII/token。
        sample = redactSample(result.sample) as Record<string, unknown>;
      }
    }
    // Drift 检测：ACTIVE mapping 的 fieldMap 源路径（非 =常量）与样本顶层字段对比。
    const drift: string[] = [];
    const mappedPreview: Record<string, string> = {};
    if (sample) {
      const sampleKeys = new Set(Object.keys(sample));
      const mappings = await platformStore.listIntegrationMappings(
        tenantOf(request),
        idOf(request),
        "ACTIVE",
      );
      for (const mapping of mappings) {
        for (const [column, expression] of Object.entries(mapping.fieldMap)) {
          if (expression.startsWith("=")) {
            mappedPreview[column] = expression.slice(1);
            continue;
          }
          const [path] = expression.split("|");
          const topKey = (path ?? "").split(".")[0]!;
          if (!sampleKeys.has(topKey)) {
            drift.push(`${mapping.name}: 源字段 "${topKey}" 不在样本中（列 ${column}）`);
          }
          const value = (path ?? "")
            .split(".")
            .reduce<unknown>(
              (acc, segment) =>
                acc && typeof acc === "object"
                  ? (acc as Record<string, unknown>)[segment]
                  : undefined,
              sample,
            );
          if (value !== undefined) {
            mappedPreview[column] = String(redactSample(value));
          }
        }
        // 样本中出现但任何 mapping 未引用的顶层字段 → drift 提示
        for (const key of sampleKeys) {
          const referenced = mappings.some((mapping) =>
            Object.values(mapping.fieldMap).some((expr) => !expr.startsWith("=") && (expr.split("|")[0] ?? "").split(".")[0] === key),
          );
          if (!referenced && !drift.some((entry) => entry.includes(`"${key}"`))) {
            drift.push(`样本字段 "${key}" 未被任何 ACTIVE 映射引用`);
          }
        }
      }
    }
    countEvent("integration_schema_previewed");
    if (drift.length > 0) {
      try {
        await storeFor(request)?.recordAuditEvent?.({
          actorType: "USER",
          actorId: ownPersonId(request) ?? undefined,
          action: "INTEGRATION_SCHEMA_DRIFT_DETECTED",
          objectType: "INTEGRATION_CONNECTION",
          objectId: connection.id,
          reason: drift.slice(0, 5).join("; "),
        });
      } catch {
        /* audit is best-effort */
      }
    }
    return data(
      {
        connectionId: connection.id,
        ok,
        detail: probeDetail,
        fields: sample ? Object.keys(sample) : [],
        sample,
        mappedPreview,
        drift,
        testedAt: new Date().toISOString(),
      },
      request,
    );
  });

  app.post("/api/v1/integration-connections/:id/status", async (request) => {
    requireRoles(request, "admin");
    const body = parse(setIntegrationConnectionStatusSchema, request.body);
    return data(
      await platformStore.setIntegrationConnectionStatus({
        tenantId: tenantOf(request),
        connectionId: idOf(request),
        status: body.status,
      }),
      request,
    );
  });

  app.post("/api/v1/integration-connections/:id/mappings", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createIntegrationMappingSchema, request.body);
    // INT-210：mapping config 响应同样脱敏（headers 等敏感键不回显）。
    return reply.status(201).send(
      data(
        {
          ...(await platformStore.createIntegrationMapping({
            tenantId: tenantOf(request),
            connectionId: idOf(request),
            name: body.name,
            mappingType: body.mappingType,
            sourceSystem: body.sourceSystem,
            targetType: body.targetType,
            fieldMap: body.fieldMap,
            config: body.config ?? {},
            version: body.version ?? 1,
          })),
          config: redactConfig(body.config ?? {}) as Record<string, unknown>,
        },
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections/:id/mappings", async (request) => {
    requireRoles(request, "admin", "integration");
    const query = request.query as {
      status?: "ACTIVE" | "RETIRED";
    };
    return data(
      (await platformStore.listIntegrationMappings(
        tenantOf(request),
        idOf(request),
        query.status,
      )).map((mapping) => ({
        ...mapping,
        config: redactConfig(mapping.config) as Record<string, unknown>,
      })),
      request,
    );
  });

  app.post("/api/v1/integration-mappings/:id/retire", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.retireIntegrationMapping({
        tenantId: tenantOf(request),
        mappingId: idOf(request),
      }),
      request,
    );
  });

  app.get("/api/v1/integration-mapping-presets", async (request) => {
    requireRoles(request, "admin", "integration", "manager", "finance");
    return data(FIELD_MAPPING_PRESETS, request);
  });

  app.post("/api/v1/integration-connections/:id/schedules", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createSyncScheduleSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createSyncSchedule({
          tenantId: tenantOf(request),
          connectionId: idOf(request),
          name: body.name,
          intervalMinutes: body.intervalMinutes,
          startAt: body.startAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections/:id/schedules", async (request) => {
    requireRoles(request, "admin", "integration");
    return data(
      await platformStore.listSyncSchedules(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.get("/api/v1/sync-schedules", async (request) => {
    requireRoles(request, "admin", "integration");
    const query = request.query as { connectionId?: string };
    return data(
      await platformStore.listSyncSchedules(
        tenantOf(request),
        query.connectionId,
      ),
      request,
    );
  });

  app.post("/api/v1/sync-schedules/claim-due", async (request) => {
    requireRoles(request, "integration");
    const body = parse(claimDueSyncSchedulesSchema, request.body ?? {});
    return data(
      await platformStore.claimDueSyncSchedules({
        tenantId: tenantOf(request),
        limit: body.limit ?? 10,
        now: body.now,
      }),
      request,
    );
  });

  app.post("/api/v1/sync-schedules/:id/status", async (request) => {
    requireRoles(request, "admin");
    const body = parse(setSyncScheduleEnabledSchema, request.body);
    return data(
      await platformStore.setSyncScheduleEnabled({
        tenantId: tenantOf(request),
        scheduleId: idOf(request),
        enabled: body.enabled,
      }),
      request,
    );
  });
  app.post("/api/v1/integration-connections/:id/sync-runs", async (request, reply) => {
    requireRoles(request, "manager", "finance", "integration");
    const body = parse(createSyncRunSchema, request.body ?? {});
    return reply.status(201).send(
      data(
        await platformStore.createSyncRun({
          tenantId: tenantOf(request),
          connectionId: idOf(request),
          status: body.status ?? "QUEUED",
          cursorBefore: body.cursorBefore,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections/:id/sync-runs", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    return data(
      await platformStore.listSyncRuns(tenantOf(request), idOf(request)),
      request,
    );
  });

  // ------------------------------------------------------------------
  // NP-008：外部对象身份注册/解析（opaque 外部 ID → 内部 UUID）。
  // ------------------------------------------------------------------
  app.post("/api/v1/external-objects", async (request, reply) => {
    requireRoles(request, "admin", "integration");
    const body = parse(upsertExternalObjectSchema, request.body);
    const identity = await platformStore.upsertExternalObject({
      tenantId: tenantOf(request),
      sourceSystem: body.sourceSystem,
      externalObjectType: body.externalObjectType,
      externalObjectId: body.externalObjectId,
      internalObjectType: body.internalObjectType,
      internalObjectId: body.internalObjectId,
      matchRule: body.matchRule,
      confidence: body.confidence,
      // INT-207：确认人一律取会话身份——不信任 body 提交。
      confirmedBy: ownPersonId(request) ?? undefined,
    });
    return reply.status(201).send(data(identity, request));
  });

  app.get("/api/v1/external-objects:resolve", async (request) => {
    requireRoles(request, "admin", "integration");
    const query = request.query as {
      sourceSystem?: string;
      externalObjectType?: string;
      externalObjectId?: string;
    };
    if (!query.sourceSystem || !query.externalObjectType || !query.externalObjectId) {
      throw new BadRequestError(
        "RESOLVE_PARAMS_REQUIRED",
        "sourceSystem/externalObjectType/externalObjectId 均为必填",
      );
    }
    const identity = await platformStore.resolveExternalObject(
      tenantOf(request),
      query.sourceSystem,
      query.externalObjectType,
      query.externalObjectId,
    );
    if (!identity) {
      throw new NotFoundError(
        `ExternalObjectIdentity ${query.sourceSystem}/${query.externalObjectType}/${query.externalObjectId} not found`,
      );
    }
    return data(
      {
        internalObjectType: identity.internalObjectType,
        internalObjectId: identity.internalObjectId,
        matchRule: identity.matchRule,
        confidence: identity.confidence,
      },
      request,
    );
  });

  app.get("/api/v1/external-objects", async (request) => {
    requireRoles(request, "admin", "integration");
    const query = request.query as {
      sourceSystem?: string;
      externalObjectType?: string;
      includeUnlinked?: string;
    };
    return data(
      await platformStore.listExternalObjects(tenantOf(request), {
        sourceSystem: query.sourceSystem,
        externalObjectType: query.externalObjectType,
        includeUnlinked: query.includeUnlinked === "1" || query.includeUnlinked === "true",
      }),
      request,
    );
  });

  // ------------------------------------------------------------------
  // NP-027：身份生命周期——unlink 终止映射（人工处置留痕）、merge 并入。
  // ------------------------------------------------------------------
  app.post("/api/v1/external-objects/unlink", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(externalObjectUnlinkSchema, request.body);
    const identity = await platformStore.unlinkExternalObject({
      tenantId: tenantOf(request),
      sourceSystem: body.sourceSystem,
      externalObjectType: body.externalObjectType,
      externalObjectId: body.externalObjectId,
      reason: body.reason,
      actorPersonId: requireActorRequired(request, body.actorPersonId, "unlink external object"),
    });
    try {
      await storeFor(request)?.recordAuditEvent?.({
        actorType: "USER",
        actorId: ownPersonId(request) ?? body.actorPersonId,
        action: "EXTERNAL_IDENTITY_UNLINKED",
        objectType: "EXTERNAL_OBJECT_IDENTITY",
        objectId: identity.id,
        reason: `${body.sourceSystem}/${body.externalObjectType}/${body.externalObjectId}:${body.reason}`,
      });
    } catch {
      /* audit is best-effort */
    }
    countEvent("external_identity_unlinked");
    return data(identity, request);
  });

  app.post("/api/v1/external-objects:merge", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(externalObjectMergeSchema, request.body);
    const result = await platformStore.mergeExternalObjects({
      tenantId: tenantOf(request),
      sourceSystem: body.sourceSystem,
      externalObjectType: body.externalObjectType,
      keepExternalObjectId: body.keepExternalObjectId,
      mergeExternalObjectIds: body.mergeExternalObjectIds,
      actorPersonId: requireActorRequired(request, body.actorPersonId, "merge external objects"),
    });
    try {
      await storeFor(request)?.recordAuditEvent?.({
        actorType: "USER",
        actorId: ownPersonId(request) ?? body.actorPersonId,
        action: "EXTERNAL_IDENTITY_MERGED",
        objectType: "EXTERNAL_OBJECT_IDENTITY",
        objectId: `${body.sourceSystem}/${body.externalObjectType}/${body.keepExternalObjectId}`,
        reason: `merged=${result.merged} into=${result.internalObjectId}`,
      });
    } catch {
      /* audit is best-effort */
    }
    countEvent("external_identity_merged");
    return data(result, request);
  });

  // ------------------------------------------------------------------
  // NP-020：原始落地（append-only；payload AES-256-GCM 密文）+ 重放。
  // ------------------------------------------------------------------
  app.post("/api/v1/raw-source-records", async (request, reply) => {
    requireRoles(request, "admin", "integration");
    const body = parse(createRawSourceRecordSchema, request.body);
    const payload = body.payload ?? {};
    // INT-215：保留分类由同步目标/来源推导，调用方不得把 FINANCIAL 原始数据
    // 标成 DEFAULT（否则会被普通保留策略提前清理）。
    let inferredRetention: "PII" | "FINANCIAL" | undefined;
    if (body.resourceId) {
      const resource = await platformStore.getSyncResource(
        tenantOf(request),
        body.resourceId,
      );
      if (resource.mappingId) {
        const mapping = await platformStore.getIntegrationMapping(
          tenantOf(request),
          resource.mappingId,
        );
        if (mapping.targetType === "FINANCIAL_FACT") inferredRetention = "FINANCIAL";
      }
    }
    if (!inferredRetention) {
      if (body.sourceSystem === "feishu" || body.sourceSystem === "hr") {
        inferredRetention = "PII";
      }
    }
    if (
      inferredRetention &&
      body.retentionClass &&
      body.retentionClass !== inferredRetention
    ) {
      throw new ConflictError(
        `RETENTION_CLASS_MISMATCH: ${body.sourceSystem}/${body.externalRecordId} ` +
          `must be ${inferredRetention}, got ${body.retentionClass}`,
      );
    }
    // INT-218：Hash 必须由服务端对 payload 重新计算并核对；客户端传入
    // 不一致的 Hash 直接拒绝，避免伪造版本身份绕过幂等/篡改检测。
    const payloadHash = createHash("sha256")
      .update(canonicalJson(payload))
      .digest("hex");
    if (body.payloadHash && body.payloadHash !== payloadHash) {
      throw new ConflictError(
        `RAW_PAYLOAD_HASH_MISMATCH: provided ${body.payloadHash}, computed ${payloadHash}`,
      );
    }
    const record = await platformStore.appendRawSourceRecord({
      tenantId: tenantOf(request),
      sourceSystem: body.sourceSystem,
      externalRecordId: body.externalRecordId,
      payloadEncrypted: encryptRawPayload(JSON.stringify(payload)),
      payloadHash,
      sourceVersion: body.sourceVersion ?? payloadHash,
      mappingVersion: body.mappingVersion,
      retentionClass: body.retentionClass ?? inferredRetention,
      resourceId: body.resourceId,
      sourceUpdatedAt: body.sourceUpdatedAt,
    });
    countEvent("raw_source_record_appended");
    return reply.status(201).send(
      data({ ...record, payload: undefined, payloadEncrypted: "[ENCRYPTED]" }, request),
    );
  });

  app.get("/api/v1/raw-source-records", async (request) => {
    requireRoles(request, "admin", "integration");
    const query = request.query as { sourceSystem?: string; replayed?: string };
    return data(
      (await platformStore.listRawSourceRecords(tenantOf(request), {
        sourceSystem: query.sourceSystem,
        replayedOnly: query.replayed === "1" || query.replayed === "true",
      })).map((record) => ({ ...record, payloadEncrypted: "[ENCRYPTED]" })),
      request,
    );
  });

  // ------------------------------------------------------------------
  // P1 Data Lineage：从原始记录追溯投影产物（证据/财务事实）。
  // ------------------------------------------------------------------
  app.get("/api/v1/raw-source-records/lineage", async (request) => {
    requireRoles(request, "admin", "integration");
    const query = request.query as {
      sourceSystem?: string;
      externalRecordId?: string;
    };
    if (!query.sourceSystem || !query.externalRecordId) {
      throw new BadRequestError(
        "LINEAGE_PARAMS_REQUIRED",
        "sourceSystem 与 externalRecordId 均为必填",
      );
    }
    const store = storeFor(request);
    const raws = await platformStore.listRawSourceRecords(tenantOf(request), {
      sourceSystem: query.sourceSystem,
    });
    const raw = raws.find((entry) => entry.externalRecordId === query.externalRecordId) ?? null;
    // 投影产物：财务事实按 (source_system, source_record_id) 精确匹配；
    // 证据按 source_system + normalized_payload 与 raw payload 语义相等匹配。
    const facts = (
      (
        (await (
          store as unknown as {
            listFinancialFacts?: () => Promise<
              Array<{
                id: string;
                sourceSystem: string;
                sourceRecordId: string;
                amount: string;
                currency: string;
              }>
            >;
          }
        ).listFinancialFacts?.()) ?? []
      ).filter(
        (fact) =>
          fact.sourceSystem === query.sourceSystem &&
          fact.sourceRecordId === query.externalRecordId,
      )
    );
    const rawPayloadText = raw ? JSON.stringify(rawPayloadOf(raw.payloadEncrypted)) : "";
    const evidence = (await store.listEvidence()).filter(
      (node) =>
        node.sourceSystem === query.sourceSystem &&
        raw &&
        JSON.stringify(node.normalizedPayload ?? {}) === rawPayloadText,
    );
    const projections = [
      ...facts.map((fact) => ({
        kind: "FINANCIAL_FACT" as const,
        id: fact.id,
        amount: fact.amount,
        currency: fact.currency,
      })),
      ...evidence.map((node) => ({
        kind: "EVIDENCE" as const,
        id: node.id,
        subjectId: node.subjectId,
      })),
    ];
    return data({ raw, projections }, request);
  });

  // 重放：解密原始 payload → 按调用方给定的解析字段转投证据通道 → 标记。
  app.post("/api/v1/raw-source-records/:id/replay", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(replayRawSourceRecordSchema, request.body);
    const record = await platformStore.getRawSourceRecord(tenantOf(request), idOf(request));
    if (record.replayedAt) {
      // 已重放过：幂等返回（不重复转投）。
      return data(
        { replayed: true, duplicate: true, sourceRecordId: record.externalRecordId },
        request,
      );
    }
    // 解密/解析失败 → 422 显式失败（不得以空 payload 继续投影）。
    const payload = rawPayloadOf(record.payloadEncrypted);
    if (body.mappingId) {
      // INT-209（Sprint 2.1 P1）：基于 Mapping 版本的重放——服务端读映射、
      // 应用 fieldMap（含 =常量与转换）并按其 targetType 投影；审计可追溯。
      const replayed = await replayRawRecordByMapping(
        request,
        record,
        body.mappingId,
        payload,
      );
      return data(
        {
          replayed: true,
          sourceRecordId: record.externalRecordId,
          mappingId: body.mappingId,
          targetType: replayed.targetType,
        },
        request,
      );
    }
    // 兼容路径：调用方提供解析字段（无 mappingId）
    await storeFor(request).ingestEvents({
      sourceSystem: record.sourceSystem,
      events: [
        {
          sourceRecordId: record.externalRecordId,
          sourceEventVersion: `replay-${record.mappingVersion}`,
          eventType: body.eventType!,
          occurredAt: body.occurredAt,
          subjectType: body.subjectType!,
          subjectId: body.subjectId!,
          evidenceType: body.evidenceType!,
          payload,
        },
      ],
    });
    await platformStore.markRawSourceRecordReplayed(tenantOf(request), record.id);
    countEvent("raw_source_record_replayed");
    return data({ replayed: true, sourceRecordId: record.externalRecordId }, request);
  });

  // ------------------------------------------------------------------
  // NP-021：资源级租约（fencing token）。
  // ------------------------------------------------------------------
  app.post("/api/v1/sync-resources/:id/claim-lease", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(claimResourceLeaseSchema, request.body);
    const lease = await platformStore.claimResourceSyncLease({
      tenantId: tenantOf(request),
      resourceId: idOf(request),
      leaseOwner: body.leaseOwner,
      leaseSeconds: body.leaseSeconds,
    });
    countEvent("resource_lease_claimed");
    return data(lease, request);
  });

  app.post("/api/v1/sync-resources/:id/release-lease", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(releaseResourceLeaseSchema, request.body);
    await platformStore.releaseResourceSyncLease({
      tenantId: tenantOf(request),
      resourceId: idOf(request),
      leaseOwner: body.leaseOwner,
      fencingToken: body.fencingToken,
    });
    countEvent("resource_lease_released");
    return data({ released: true }, request);
  });

  // INT-205：长同步心跳续约——owner+token 匹配且未过期才延长。
  app.post("/api/v1/sync-resources/:id/renew-lease", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(renewResourceLeaseSchema, request.body);
    const lease = await platformStore.renewResourceSyncLease({
      tenantId: tenantOf(request),
      resourceId: idOf(request),
      leaseOwner: body.leaseOwner,
      fencingToken: body.fencingToken,
      leaseSeconds: body.leaseSeconds,
    });
    countEvent("resource_lease_renewed");
    return data(lease, request);
  });

  // ------------------------------------------------------------------
  // NP-009：webhook 不透明路由键（签发时一次性返回派生签名密钥）。
  // ------------------------------------------------------------------
  app.post(
    "/api/v1/integration-connections/:id/webhook-routing-key",
    async (request, reply) => {
      requireRoles(request, "admin", "integration");
      const entry = await platformStore.issueWebhookRoutingKey({
        tenantId: tenantOf(request),
        connectionId: idOf(request),
      });
      countEvent("integration_webhook_key_issued");
      // signingSecret 派生自服务端密钥 + routing key，仅在签发响应中出现一次。
      return reply.status(201).send(
        data(
          {
            routingKey: entry.routingKey,
            signingSecret: signingKeyFor(entry.routingKey),
          },
          request,
        ),
      );
    },
  );

  // ------------------------------------------------------------------
  // NP-001（2026-11-21 审计 Wave 1）：资源流 / 检查点 / 隔离区端点。
  // runner（scripts/sync-runner.ts）依赖以下全部路径。
  // ------------------------------------------------------------------
  app.post("/api/v1/sync-resources", async (request, reply) => {
    requireRoles(request, "admin", "integration");
    const body = parse(createSyncResourceSchema, request.body);
    const resource = await platformStore.createSyncResource({
      tenantId: tenantOf(request),
      connectionId: body.connectionId,
      resourceKey: body.resourceKey,
      mappingId: body.mappingId,
      scheduleId: body.scheduleId,
      intervalMinutes: body.intervalMinutes,
    });
    return reply.status(201).send(data(resource, request));
  });

  app.get("/api/v1/sync-resources", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    const query = request.query as { connectionId?: string };
    return data(
      await platformStore.listSyncResources(tenantOf(request), query.connectionId),
      request,
    );
  });

  app.get("/api/v1/sync-resources/:id/checkpoint", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    const checkpoint = await platformStore.getSyncCheckpoint(
      tenantOf(request),
      idOf(request),
    );
    // INT-212：资源级最小调度间隔随 checkpoint 返回（runner 节流依据）。
    const resource = await platformStore.getSyncResource(
      tenantOf(request),
      idOf(request),
    );
    // 首次运行无 checkpoint → 返回空游标默认值（runner 语义）。
    return data(
      {
        ...(checkpoint ?? {
          id: null,
          resourceId: idOf(request),
          cursor: null,
          watermark: null,
          overlapSeconds: 0,
          lastRunId: null,
          updatedAt: null,
        }),
        intervalOverrideMinutes: resource.intervalMinutes ?? undefined,
      },
      request,
    );
  });

  app.put("/api/v1/sync-resources/:id/checkpoint", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(upsertSyncCheckpointSchema, request.body);
    // INT-210：区分“字段未提供”与“显式 null”——前者保留旧值，后者清空。
    const rawBody = (request.body ?? {}) as Record<string, unknown>;
    return data(
      await platformStore.saveSyncCheckpoint({
        tenantId: tenantOf(request),
        resourceId: idOf(request),
        cursor: "cursor" in rawBody ? (body.cursor ?? null) : undefined,
        watermark: "watermark" in rawBody ? (body.watermark ?? null) : undefined,
        lastRunId: "lastRunId" in rawBody ? (body.lastRunId ?? null) : undefined,
        overlapSeconds: body.overlapSeconds,
        leaseOwner: body.leaseOwner,
        fencingToken: body.fencingToken,
      }),
      request,
    );
  });

  app.post("/api/v1/ingestion-quarantine", async (request, reply) => {
    requireRoles(request, "admin", "integration");
    const body = parse(createQuarantineRecordSchema, request.body);
    const record = await platformStore.recordQuarantineRecord({
      tenantId: tenantOf(request),
      sourceSystem: body.sourceSystem,
      externalRecordId: body.externalRecordId,
      reason: body.reason,
      payload: body.payload,
      resolutionNote: body.resolutionNote,
    });
    return reply.status(201).send(data(record, request));
  });

  // INT-209：隔离区人工处置（resolve）——处置留痕 + 审计。
  app.post("/api/v1/ingestion-quarantine/:id/resolve", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = (request.body ?? {}) as Record<string, unknown>;
    const note = typeof body.resolutionNote === "string" && body.resolutionNote.trim() ? body.resolutionNote.trim() : "";
    if (!note) {
      throw new BadRequestError("RESOLUTION_NOTE_REQUIRED", "resolutionNote 为必填");
    }
    const record = await platformStore.resolveQuarantineRecord({
      tenantId: tenantOf(request),
      quarantineId: idOf(request),
      resolutionNote: note,
      actorPersonId: requireActorRequired(request, body.actorPersonId, "resolve quarantine record"),
    });
    try {
      await storeFor(request)?.recordAuditEvent?.({
        actorType: "USER",
        actorId: ownPersonId(request) ?? record.resolvedBy ?? undefined,
        action: "QUARANTINE_RECORD_RESOLVED",
        objectType: "INGESTION_QUARANTINE",
        objectId: record.id,
        reason: note,
      });
    } catch {
      /* audit is best-effort */
    }
    countEvent("quarantine_record_resolved");
    return data(record, request);
  });

  app.get("/api/v1/ingestion-quarantine", async (request) => {

    requireRoles(request, "manager", "finance", "integration");
    const query = request.query as { sourceSystem?: string; unresolved?: string };
    return data(
      await platformStore.listQuarantineRecords(tenantOf(request), {
        sourceSystem: query.sourceSystem,
        unresolvedOnly: query.unresolved === "1" || query.unresolved === "true",
      }),
      request,
    );
  });

  app.post("/api/v1/sync-runs/:id/finish", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    const body = parse(finishSyncRunSchema, request.body);
    return data(
      await platformStore.finishSyncRun({
        tenantId: tenantOf(request),
        syncRunId: idOf(request),
        status: body.status,
        recordsSeen: body.recordsSeen ?? 0,
        recordsUpserted: body.recordsUpserted ?? 0,
        recordsFetched: body.recordsFetched,
        recordsRawPersisted: body.recordsRawPersisted,
        recordsCreated: body.recordsCreated,
        recordsUpdated: body.recordsUpdated,
        recordsDuplicate: body.recordsDuplicate,
        recordsInvalid: body.recordsInvalid,
        recordsQuarantined: body.recordsQuarantined,
        recordsFailed: body.recordsFailed,
        cursorAfter: body.cursorAfter,
        errorSummary: body.errorSummary,
      }),
      request,
    );
  });

  /**
   * sync-run 级重放（Mapping Studio 失败面板）。
   *
   * 语义边界（INT-209 的 run 级封装）：
   * - 只有该 run 所属租户可重放；跨租户一律 404（不泄露 run 是否存在）。
   * - 只有 FAILED / PARTIAL 的 run 可重放；SUCCEEDED 等状态 409。
   * - 只重放目标写入：不重置 checkpoint、不创建新 run、不改原 run 计数，
   *   原始 run 的记录与审计保持原样（重放本身另记审计）。
   * - 幂等：replayedAt 已存在的原始记录计入 skipped，不重复投影。
   * - 缺省范围 = 该 run 期间（createdAt/startedAt → finishedAt）落地的
   *   failed / quarantined 原始记录：隔离记录按 quarantine 精确匹配；失败
   *   目标写入没有逐条标记（禁止新增迁移列），按 run 窗口内的原始记录
   *   回收，已成功投影的记录由目标写入幂等/去重跳过。计数器明确为
   *   0/0 的 run（例如 provider 拉取失败）没有可重放记录。
   * - body.rawRecordIds 可精确指定（仍受租户与该连接归属约束）。
   */
  app.post("/api/v1/sync-runs/:id/replay", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(replaySyncRunSchema, request.body ?? {});
    const tenantId = tenantOf(request);
    const run = await platformStore.getSyncRun(tenantId, idOf(request));
    if (run.status !== "FAILED" && run.status !== "PARTIAL") {
      throw new ConflictError(
        `SYNC_RUN_NOT_REPLAYABLE: run ${run.id} is ${run.status}; only FAILED or PARTIAL runs can be replayed`,
      );
    }
    const [resources, mappings, allRecords] = await Promise.all([
      platformStore.listSyncResources(tenantId, run.connectionId),
      platformStore.listIntegrationMappings(tenantId, run.connectionId),
      platformStore.listRawSourceRecords(tenantId),
    ]);
    const resourceById = new Map(
      resources.map((resource) => [resource.id, resource]),
    );
    const mappingById = new Map(
      mappings.map((mapping) => [mapping.id, mapping]),
    );
    // 没有 resourceId 的历史原始记录退回按连接映射的 sourceSystem 判定归属。
    const connectionSourceSystems = new Set(
      mappings.map((mapping) => mapping.sourceSystem),
    );
    const belongsToRun = (record: RawSourceRecord): boolean =>
      record.resourceId
        ? resourceById.has(record.resourceId)
        : connectionSourceSystems.has(record.sourceSystem);
    const recordById = new Map(
      allRecords.map((record) => [record.id, record]),
    );
    let candidates: RawSourceRecord[];
    if (body.rawRecordIds) {
      const seen = new Set<string>();
      candidates = [];
      for (const rawRecordId of body.rawRecordIds) {
        if (seen.has(rawRecordId)) continue;
        seen.add(rawRecordId);
        const record = recordById.get(rawRecordId);
        // 跨租户 / 不属于该 run 的原始记录：404（不泄露存在性）。
        if (!record || !belongsToRun(record)) {
          throw new NotFoundError(
            `RawSourceRecord ${rawRecordId} not found for sync run ${run.id}`,
          );
        }
        candidates.push(record);
      }
    } else {
      const windowStart = Date.parse(run.startedAt ?? run.createdAt);
      const windowEnd = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
      const landedInRun = (record: RawSourceRecord): boolean => {
        if (!belongsToRun(record)) return false;
        const landedAt = Date.parse(record.createdAt);
        return landedAt >= windowStart && landedAt <= windowEnd;
      };
      const failedCount = run.recordsFailed;
      const quarantinedCount = run.recordsQuarantined;
      const countersKnown =
        failedCount !== undefined || quarantinedCount !== undefined;
      if (
        countersKnown &&
        (failedCount ?? 0) === 0 &&
        (quarantinedCount ?? 0) === 0
      ) {
        // 该 run 没有 failed / quarantined 记录（例如 provider 拉取失败），
        // 缺省重放范围为空——不把已成功的运行数据重复投影。
        candidates = [];
      } else if (!countersKnown || (failedCount ?? 0) > 0) {
        // failed target write 没有逐条标记（禁止新增迁移列），按 run 窗口
        // 回收；已成功投影的记录由目标写入幂等/去重跳过。
        candidates = allRecords.filter(landedInRun);
      } else {
        // 只有 quarantined 计数：按隔离区记录精确定位对应原始记录。
        const quarantinedKeys = new Set(
          (
            await platformStore.listQuarantineRecords(tenantId)
          )
            .filter(
              (entry) =>
                Boolean(entry.externalRecordId) &&
                Date.parse(entry.createdAt) >= windowStart &&
                Date.parse(entry.createdAt) <= windowEnd,
            )
            .map(
              (entry) =>
                `${entry.sourceSystem}\u0000${entry.externalRecordId ?? ""}`,
            ),
        );
        candidates = allRecords.filter(
          (record) =>
            landedInRun(record) &&
            quarantinedKeys.has(
              `${record.sourceSystem}\u0000${record.externalRecordId}`,
            ),
        );
      }
    }
    let skipped = 0;
    let replayed = 0;
    let failed = 0;
    const replayedIds: string[] = [];
    const failures: string[] = [];
    for (const record of candidates) {
      if (record.replayedAt) {
        skipped += 1;
        continue;
      }
      const resource = record.resourceId
        ? resourceById.get(record.resourceId)
        : undefined;
      // 优先用资源绑定映射；否则用同 sourceSystem 的最新 ACTIVE 映射。
      const fallbackMapping = mappings
        .filter(
          (mapping) =>
            mapping.sourceSystem === record.sourceSystem &&
            mapping.status === "ACTIVE",
        )
        .sort((left, right) => right.version - left.version)[0];
      const mappingId =
        (resource?.mappingId && mappingById.has(resource.mappingId)
          ? resource.mappingId
          : undefined) ?? fallbackMapping?.id;
      if (!mappingId) {
        failed += 1;
        if (failures.length < 5) {
          failures.push(`${record.id}: no usable mapping`);
        }
        continue;
      }
      try {
        // 证据通道按原始投影版本重放，已成功投影的记录命中 ingest 幂等键。
        const projectionVersion =
          record.sourceVersion &&
          record.payloadHash &&
          record.sourceVersion === record.payloadHash
            ? "1"
            : record.sourceVersion;
        const outcome = await replayRawRecordByMapping(
          request,
          record,
          mappingId,
          undefined,
          { sourceEventVersion: projectionVersion },
        );
        if (outcome.skipped) {
          skipped += 1;
        } else {
          replayed += 1;
          replayedIds.push(record.id);
        }
      } catch (error) {
        failed += 1;
        if (failures.length < 5) {
          failures.push(
            `${record.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
    try {
      await storeFor(request)?.recordAuditEvent?.({
        actorType: "USER",
        actorId: ownPersonId(request) ?? undefined,
        action: "SYNC_RUN_REPLAYED",
        objectType: "SYNC_RUN",
        objectId: run.id,
        reason:
          `run=${run.id} connection=${run.connectionId} ` +
          `replayed=${replayed} skipped=${skipped} failed=${failed}` +
          (replayedIds.length > 0
            ? ` rawRecordIds=${replayedIds.slice(0, 20).join(",")}`
            : "") +
          (failures.length > 0 ? ` failures=${failures.join("; ")}` : ""),
      });
    } catch {
      /* audit is best-effort */
    }
    countEvent("sync_run_replayed");
    return data(
      { replayed, skipped, failed, rawRecordIds: replayedIds },
      request,
    );
  });

  // ------------------------------------------------------------------
  // NP-009：供应商签名回调（公开路由——routing key 即租户入口，无员工会话）。
  // HMAC-SHA256 原始体校验；原始载荷 AES-256-GCM 加密落库；messageId 幂等。
  // ------------------------------------------------------------------
  app.post("/api/v1/integration-webhooks/:routingKey", async (request, reply) => {
    const routingKey = paramOf(request, "routingKey");
    const resolved = await platformStore.resolveWebhookRoutingKey(routingKey);
    if (!resolved) {
      throw new NotFoundError("Webhook routing key not found");
    }
    const raw =
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody ??
      Buffer.alloc(0);
    const rawText = raw.toString("utf8");
    // INT-213：轮换窗口内同时接受旧/新签名密钥派生的签名。
    const expectedSignatures = integrationCrypto
      .signatureKeysFor(routingKey)
      .map((secret) =>
        createHmac("sha256", secret).update(rawText).digest("hex"),
      );
    const provided = String(request.headers["x-signature-256"] ?? "").replace(
      /^sha256=/,
      "",
    );
    const matched =
      provided.length > 0 &&
      expectedSignatures.some(
        (expected) =>
          provided.length === expected.length &&
          timingSafeEqualStr(provided, expected),
      );
    if (!matched) {
      countEvent("integration_webhook_rejected");
      return reply.status(401).send({
        ...errorBody("WEBHOOK_SIGNATURE_INVALID", "signature mismatch"),
        meta: { correlation_id: request.id },
      });
    }
    const payload = (request.body ?? {}) as { messageId?: string };
    const messageId =
      (request.headers["x-message-id"] as string | undefined) ??
      payload.messageId ??
      sha256(rawText);
    const webhook = await platformStore.receiveIntegrationWebhook({
      tenantId: resolved.tenantId,
      sourceSystem: resolved.provider,
      messageId,
      payloadHash: sha256(rawText),
      rawPayloadEncrypted: encryptRawPayload(rawText),
    });
    countEvent("integration_webhook_received");
    return reply.status(202).send(data(webhook, request));
  });
  };
}
