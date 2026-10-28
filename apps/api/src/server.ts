import { Pool } from "pg";
import {
  AgentRuntime,
  createDefaultSkills,
  createDefaultTools,
} from "@anari/agent-runtime";
import { PgAgentTaskRepository } from "@anari/agent-persistence";
import {
  DevHeaderAuthenticator,
  OidcJwtAuthenticator,
} from "@anari/auth";
import { buildApp, type AgentRuntimeFactory } from "./app.js";
import { createAgentContext } from "./agent-context.js";
import { Store } from "./store.js";
import { PgStore } from "./pg-store.js";

const port = Number(process.env.PORT ?? 3000);
const usePostgres =
  process.env.STORE === "postgres" ||
  (process.env.STORE !== "memory" && Boolean(process.env.DATABASE_URL));

const pool = usePostgres
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;

const resolveStore = (tenantId: string) =>
  pool ? new PgStore(pool, tenantId) : new Store(tenantId);

const authenticator =
  process.env.AUTH_MODE === "oidc"
    ? new OidcJwtAuthenticator({
        issuer: process.env.OIDC_ISSUER ?? "",
        audience: process.env.OIDC_AUDIENCE ?? "",
        jwksUrl: process.env.OIDC_JWKS_URL,
      })
    : new DevHeaderAuthenticator({
        tenantId:
          process.env.DEFAULT_TENANT_ID ??
          (usePostgres
            ? "00000000-0000-4000-8000-000000000001"
            : "tenant-demo"),
        userId: "dev-user",
        personId:
          process.env.DEFAULT_PERSON_ID ??
          "00000000-0000-4000-8000-000000000001",
        roles: ["admin"],
      });

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

const app = buildApp(resolveStore, createRuntime, authenticator);

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
