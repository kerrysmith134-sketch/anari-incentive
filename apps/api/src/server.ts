import { Pool } from "pg";
import { assertRuntimeConfig } from "./config.js";
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
        roles: ["admin"],
      });

// Feishu OAuth issues local session tokens; accept them alongside the
// primary mode. Session tokens only compete on requests carrying a bearer.
const feishuSessionSecret = process.env.FEISHU_SESSION_SECRET;
const authenticator = feishuSessionSecret
  ? new CompositeAuthenticator([
      new SessionAuthenticator(feishuSessionSecret),
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
    sessionSecret:
      process.env.SESSION_SECRET ?? process.env.FEISHU_SESSION_SECRET,
    feishu: feishuConfig,
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
