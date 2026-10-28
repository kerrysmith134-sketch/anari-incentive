import { Pool } from "pg";
import {
  DevHeaderAuthenticator,
  OidcJwtAuthenticator,
} from "@anari/auth";
import { buildApp } from "./app.js";
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
        tenantId: process.env.DEFAULT_TENANT_ID ?? "tenant-demo",
        userId: "dev-user",
        roles: ["admin"],
      });

const app = buildApp(resolveStore, undefined, authenticator);

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
