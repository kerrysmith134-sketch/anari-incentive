import { Pool } from "pg";
import { assertRuntimeConfig } from "./config.js";
import { resolveLlmConfigFromEnv } from "./llm.js";
import {
  AgentRuntime,
  createDefaultSkills,
  createDefaultTools,
} from "@anari/agent-runtime";
import { PgAgentTaskRepository } from "@anari/agent-persistence";
import {
  CompositeAuthenticator,
  DevHeaderAuthenticator,
  OidcJwtAuthenticator,
  SessionAuthenticator,
} from "@anari/auth";
import { buildApp, type AgentRuntimeFactory } from "./app.js";
import { createAgentContext } from "./agent-context.js";
import { createPlatformPool } from "./platform-pool.js";
import { OtlpHttpTraceExporter } from "./tracing.js";
import { Store } from "./store.js";
import { PgStore } from "./pg-store.js";
import {
  MemoryPlatformStore,
  PgPlatformStore,
} from "./platform-store.js";

assertRuntimeConfig();

const port = Number(process.env.PORT ?? 3000);
const usePostgres =
  process.env.STORE === "postgres" ||
  (process.env.STORE !== "memory" && Boolean(process.env.DATABASE_URL));

const pool = usePostgres
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;
const platformPool = usePostgres
  ? createPlatformPool(process.env.DATABASE_URL)
  : undefined;

const resolveStore = (tenantId: string) =>
  pool ? new PgStore(pool, tenantId) : new Store(tenantId);

const defaultTenantId =
  process.env.DEFAULT_TENANT_ID ??
  (usePostgres
    ? "00000000-0000-4000-8000-000000000001"
    : "tenant-demo");

const primaryAuthenticator =
  process.env.AUTH_MODE === "oidc"
    ? new OidcJwtAuthenticator({
        issuer: process.env.OIDC_ISSUER ?? "",
        audience: process.env.OIDC_AUDIENCE ?? "",
        jwksUrl: process.env.OIDC_JWKS_URL,
      })
    : new DevHeaderAuthenticator({
        tenantId: defaultTenantId,
        userId: "dev-user",
        personId:
          process.env.DEFAULT_PERSON_ID ??
          "00000000-0000-4000-8000-000000000001",
        roles: ["admin", "platform_admin"],
      });

// Feishu OAuth issues local session tokens; accept them alongside the
// primary mode. Session tokens only compete on requests carrying a bearer.
const feishuSessionSecret = process.env.FEISHU_SESSION_SECRET;
/** 开发/演示环境默认会话密钥：让账号密码登录开箱可用（生产必须显式配置）。 */
const sessionSecret =
  process.env.SESSION_SECRET ??
  (process.env.AUTH_MODE === "oidc"
    ? undefined
    : "dev-session-secret-change-me-0123456789");
if (!process.env.SESSION_SECRET && process.env.AUTH_MODE !== "oidc") {
  console.warn(
    "[config] SESSION_SECRET 未设置：使用开发默认会话密钥（仅限本地/演示，生产请配置）",
  );
}
/**
 * REQUIRE_SESSION_TOKEN=true：只认本机签发的会话 JWT，丢弃可伪造的
 * X-Tenant-Id / X-User-Id 开发身份。公网暴露的部署必须打开。
 */
const requireSessionToken = process.env.REQUIRE_SESSION_TOKEN === "true";
const authenticator = sessionSecret
  ? requireSessionToken
    ? new CompositeAuthenticator([new SessionAuthenticator(sessionSecret)])
    : new CompositeAuthenticator([
        new SessionAuthenticator(sessionSecret),
        primaryAuthenticator,
      ])
  : primaryAuthenticator;

const createRuntime: AgentRuntimeFactory | undefined = pool
  ? (store, tenantId) =>
      new AgentRuntime(
        createAgentContext(store),
        createDefaultTools(),
        createDefaultSkills(),
        {
          requireApprovalAtOrAbove: "T3",
          actor: "api",
          repository: new PgAgentTaskRepository(pool, tenantId),
        },
      )
  : undefined;

const platformStore = platformPool
  ? new PgPlatformStore(platformPool)
  : new MemoryPlatformStore({
      demoTenant: {
        id: defaultTenantId,
        name: "Demo tenant",
        slug: "demo-tenant",
        persons: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            employeeCode: "E001",
            displayName: "Sales Lead",
          },
          {
            id: "00000000-0000-4000-8000-000000000002",
            employeeCode: "E002",
            displayName: "Product Manager",
          },
          {
            id: "00000000-0000-4000-8000-000000000003",
            employeeCode: "E003",
            displayName: "Finance Reviewer",
          },
        ],
      },
    });

// LLM 意图解析（OpenAI 兼容：DeepSeek / GLM / Kimi / custom）。未配置则
// /agent-chat 返回 501，助手退回纯指令台（无 LLM 路径不受影响）。
const agentChatConfig = resolveLlmConfigFromEnv(process.env);

const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const otlpHeaders = Object.fromEntries(
  (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf("=");
      return index === -1
        ? [pair, ""]
        : [pair.slice(0, index), pair.slice(index + 1)];
    }),
);
const tracer = otlpEndpoint
  ? new OtlpHttpTraceExporter({
      endpoint: otlpEndpoint,
      headers: otlpHeaders,
      serviceName: "anari-incentive",
    })
  : undefined;

const rateLimitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE ?? "0");
const rateLimit =
  Number.isInteger(rateLimitPerMinute) && rateLimitPerMinute > 0
    ? { limit: rateLimitPerMinute }
    : undefined;
const bodyLimitBytes = Number(process.env.BODY_LIMIT_BYTES ?? "0");
const feishuConfig =
  process.env.FEISHU_APP_ID &&
  process.env.FEISHU_APP_SECRET &&
  process.env.FEISHU_SESSION_SECRET
    ? {
        appId: process.env.FEISHU_APP_ID,
        appSecret: process.env.FEISHU_APP_SECRET!,
        sessionSecret: process.env.FEISHU_SESSION_SECRET!,
        tenantId:
          process.env.FEISHU_TENANT_ID ?? defaultTenantId,
        consoleBaseUrl: process.env.CONSOLE_BASE_URL,
      }
    : undefined;
const bodyLimit =
  Number.isInteger(bodyLimitBytes) && bodyLimitBytes > 0
    ? bodyLimitBytes
    : undefined;

const app = buildApp(
  resolveStore,
  createRuntime,
  authenticator,
  platformStore,
  {
    // NPV2-031：Agent 步骤/工具调用持久化（按租户，postgres 模式）。
    agentStepRepositoryFor: usePostgres
      ? (tenantId) => new PgAgentTaskRepository(pool!, tenantId)
      : undefined,
    dbPoolProbe: usePostgres
      ? () => ({
          total: pool!.totalCount,
          idle: pool!.idleCount,
          waiting: pool!.waitingCount,
        })
      : undefined,
    outboxProbe: usePostgres
      ? async () => {
          const { rows } = await platformPool!.query(
            `SELECT count(*)::int AS backlog,
                    EXTRACT(EPOCH FROM (now() - MIN(occurred_at))) * 1000 AS oldest_ms
               FROM outbox_events
              WHERE published_at IS NULL`,
          );
          const row = rows[0] ?? {};
          return {
            backlog: Number(row.backlog ?? 0),
            oldestAgeMs: row.oldest_ms === null ? null : Number(row.oldest_ms),
          };
        }
      : undefined,
    agentTaskProbe: usePostgres
      ? async () => {
          const { rows } = await platformPool!.query(
            "SELECT status, count(*)::int AS count FROM agent_tasks GROUP BY status",
          );
          const byStatus: Record<string, number> = {};
          for (const row of rows) {
            byStatus[String(row.status)] = Number(row.count);
          }
          return byStatus;
        }
      : undefined,
    requiredApprovals: (process.env.REQUIRE_APPROVAL_FOR ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    webhookSecrets: Object.fromEntries(
      Object.entries(process.env)
        .filter(
          ([key, value]) =>
            key.startsWith("WEBHOOK_SECRET_") && Boolean(value),
        )
        .map(([key, value]) => [
          key.slice("WEBHOOK_SECRET_".length).toLowerCase(),
          value as string,
        ]),
    ),
    webhookSchemes: Object.fromEntries(
      Object.entries(process.env)
        .filter(
          ([key, value]) =>
            key.startsWith("WEBHOOK_SCHEME_") &&
            ["hmac", "hubspot", "feishu"].includes(value ?? ""),
        )
        .map(([key, value]) => [
          key.slice("WEBHOOK_SCHEME_".length).toLowerCase(),
          value as "hmac" | "hubspot" | "feishu",
        ]),
    ),
    enforceBudgetPools: process.env.ENFORCE_BUDGET_POOLS === "true",
    tracer,
    rateLimit,
    bodyLimitBytes: bodyLimit,
    sessionSecret: sessionSecret ?? feishuSessionSecret,
    feishu: feishuConfig,
    agentChat: agentChatConfig,
  },
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down`);
  await app.close();
  if (tracer) {
    await tracer
      .close()
      .catch((error) => console.error("[tracing] flush failed", error));
  }
  if (pool) await pool.end();
  if (platformPool) await platformPool.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

app
  .listen({ port, host: "0.0.0.0" })
  .then((address) => {
    console.log(
      `anari-incentive API listening on ${address} (${usePostgres ? "postgres" : "memory"})`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
