/**
 * 集成域路由（连接器/映射/同步排期/同步运行）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { IntegrationPort } from "../../store-ports.js";
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
  replayRawSourceRecordSchema,
  setIntegrationConnectionStatusSchema,
  setSyncScheduleEnabledSchema,
  upsertExternalObjectSchema,
  upsertSyncCheckpointSchema,
} from "@anari/contracts";
import {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

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
  (input: { url: string; headers: Record<string, string> }): Promise<{
    ok: boolean;
    status?: number;
    detail?: string;
    sample?: unknown;
  }>;
}
import { FIELD_MAPPING_PRESETS } from "@anari/connectors";
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
import { sha256 } from "@anari/policy-dsl";

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

  // NP-010：服务端凭据解析（引用 → 值）。来自 SECRETS_JSON / SECRETS_FILE。
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
    return undefined;
  }

  // NP-009：签名密钥由服务端密钥 + routing key 派生——无需存储即可校验。
  function signingKeyFor(routingKey: string): string {
    const serverSecret =
      webhookSigningSecret ??
      process.env.WEBHOOK_SIGNING_SECRET ??
      process.env.SESSION_SECRET ??
      "dev-integration-webhook-secret";
    return createHmac("sha256", serverSecret).update(routingKey).digest("hex");
  }

  function encryptRawPayload(text: string): string {
    const keySource =
      webhookRawEncryptionKey ??
      process.env.WEBHOOK_RAW_KEY ??
      process.env.SESSION_SECRET ??
      "dev-integration-webhook-raw";
    const key = createHash("sha256").update(keySource).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
  }

  function decryptRawPayload(stored: string): string {
    const [version, ivHex, tagHex, dataHex] = stored.split(":");
    if (version !== "v1" || !ivHex || !tagHex || !dataHex) return "";
    const keySource =
      webhookRawEncryptionKey ??
      process.env.WEBHOOK_RAW_KEY ??
      process.env.SESSION_SECRET ??
      "dev-integration-webhook-raw";
    const key = createHash("sha256").update(keySource).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  }

  return async (app: FastifyInstance) => {
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
    // NP-010：provider 真实探测（注入探针可测；默认 fetch 实现）。
    let sample: unknown;
    if (url) {
      const secret = connection.credentialRef
        ? resolveSecret(connection.credentialRef)
        : undefined;
      const probePath =
        typeof config.probePath === "string" && config.probePath
          ? config.probePath
          : "";
      const probe =
        integrationProbe ??
        (async (input: { url: string; headers: Record<string, string> }) => {
          try {
            const response = await fetch(input.url, {
              headers: input.headers,
              signal: AbortSignal.timeout(10_000),
              redirect: "manual",
            });
            const payload = (await response.json().catch(() => undefined)) as
              | { records?: unknown[]; data?: { items?: unknown[] } }
              | undefined;
            const records =
              payload && typeof payload === "object"
                ? (payload.records ??
                  payload.data?.items ??
                  undefined)
                : undefined;
            return {
              ok: response.ok,
              status: response.status,
              detail: response.ok ? undefined : `provider returned ${response.status}`,
              sample: Array.isArray(records) ? records[0] : undefined,
            };
          } catch (error) {
            return {
              ok: false,
              detail: error instanceof Error ? error.message : "provider unreachable",
            };
          }
        });
      const result = await probe({
        url: `${url.replace(/\/$/, "")}${probePath}`,
        headers: secret
          ? { authorization: `Bearer ${secret}`, accept: "application/json" }
          : { accept: "application/json" },
      });
      checks.push({
        name: "provider 探测",
        ok: result.ok,
        detail: result.detail,
      });
      if (result.ok) sample = result.sample;
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
    const record = await platformStore.appendRawSourceRecord({
      tenantId: tenantOf(request),
      sourceSystem: body.sourceSystem,
      externalRecordId: body.externalRecordId,
      payloadEncrypted: encryptRawPayload(JSON.stringify(body.payload ?? {})),
      mappingVersion: body.mappingVersion,
      retentionClass: body.retentionClass,
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

  // 重放：解密原始 payload → 按调用方给定的解析字段转投证据通道 → 标记。
  app.post("/api/v1/raw-source-records/:id/replay", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(replayRawSourceRecordSchema, request.body);
    const record = await platformStore.getRawSourceRecord(tenantOf(request), idOf(request));
    if (!record.replayedAt) {
      const rawText = decryptRawPayload(record.payloadEncrypted);
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      await storeFor(request).ingestEvents({
        sourceSystem: record.sourceSystem,
        events: [
          {
            sourceRecordId: record.externalRecordId,
            sourceEventVersion: `replay-${record.mappingVersion}`,
            eventType: body.eventType,
            occurredAt: body.occurredAt,
            subjectType: body.subjectType,
            subjectId: body.subjectId,
            evidenceType: body.evidenceType,
            payload,
          },
        ],
      });
      await platformStore.markRawSourceRecordReplayed(tenantOf(request), record.id);
      countEvent("raw_source_record_replayed");
      return data({ replayed: true, sourceRecordId: record.externalRecordId }, request);
    }
    // 已重放过：幂等返回（不重复转投）。
    return data({ replayed: true, duplicate: true, sourceRecordId: record.externalRecordId }, request);
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
    // 首次运行无 checkpoint → 返回空游标默认值（runner 语义）。
    return data(
      checkpoint ?? {
        id: null,
        resourceId: idOf(request),
        cursor: null,
        watermark: null,
        overlapSeconds: 0,
        lastRunId: null,
        updatedAt: null,
      },
      request,
    );
  });

  app.put("/api/v1/sync-resources/:id/checkpoint", async (request) => {
    requireRoles(request, "admin", "integration");
    const body = parse(upsertSyncCheckpointSchema, request.body);
    return data(
      await platformStore.saveSyncCheckpoint({
        tenantId: tenantOf(request),
        resourceId: idOf(request),
        cursor: body.cursor ?? null,
        watermark: body.watermark ?? null,
        lastRunId: body.lastRunId ?? null,
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
        recordsQuarantined: body.recordsQuarantined,
        recordsFailed: body.recordsFailed,
        cursorAfter: body.cursorAfter,
        errorSummary: body.errorSummary,
      }),
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
    const expected = createHmac("sha256", signingKeyFor(routingKey))
      .update(rawText)
      .digest("hex");
    const provided = String(request.headers["x-signature-256"] ?? "").replace(
      /^sha256=/,
      "",
    );
    if (
      !provided ||
      provided.length !== expected.length ||
      !timingSafeEqualStr(provided, expected)
    ) {
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
