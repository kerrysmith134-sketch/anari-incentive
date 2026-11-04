/**
 * Startup configuration validation.
 *
 * The API and the worker call `assertRuntimeConfig(process.env)` before they
 * bind a port, so an unsafe deployment fails fast at boot instead of silently
 * running with development authentication or a non-durable store.
 *
 * All rules are pure functions of the environment so they can be unit tested.
 */

export interface RuntimeConfigIssues {
  /** Problems that must abort startup. */
  fatal: string[];
  /** Problems that should be surfaced but do not block startup. */
  warnings: string[];
}

const truthy = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

export function validateRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfigIssues {
  const fatal: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === "production";
  const authMode = env.AUTH_MODE ?? "dev";
  const usePostgres =
    env.STORE === "postgres" ||
    (env.STORE !== "memory" && Boolean(env.DATABASE_URL));

  if (authMode !== "dev" && authMode !== "oidc") {
    fatal.push(
      `AUTH_MODE must be "dev" or "oidc" (got ${JSON.stringify(authMode)})`,
    );
  }

  if (authMode === "oidc") {
    if (!env.OIDC_ISSUER) {
      fatal.push("AUTH_MODE=oidc requires OIDC_ISSUER");
    }
    if (!env.OIDC_JWKS_URL) {
      fatal.push("AUTH_MODE=oidc requires OIDC_JWKS_URL");
    }
  }

  if (production) {
    if (authMode === "dev" && !truthy(env.ALLOW_UNSAFE_DEV_AUTH)) {
      fatal.push(
        "AUTH_MODE=dev accepts spoofable X-Tenant-Id/X-User-Id headers; " +
          "set AUTH_MODE=oidc (or ALLOW_UNSAFE_DEV_AUTH=true to accept the risk explicitly)",
      );
    }
    if (!usePostgres && !truthy(env.ALLOW_MEMORY_STORE)) {
      fatal.push(
        "in-memory store loses all data on restart; set STORE=postgres with DATABASE_URL " +
          "(or ALLOW_MEMORY_STORE=true to accept the risk explicitly)",
      );
    }
    if (!env.RATE_LIMIT_PER_MINUTE && !truthy(env.ALLOW_NO_RATE_LIMIT)) {
      warnings.push(
        "RATE_LIMIT_PER_MINUTE is unset; multi-replica deployments must enforce a shared limit at the gateway",
      );
    }
  }

  if (usePostgres && !env.DATABASE_URL) {
    fatal.push("STORE=postgres requires DATABASE_URL");
  }

  return { fatal, warnings };
}

/** Throws with a combined message when the environment has fatal problems. */
export function assertRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const { fatal, warnings } = validateRuntimeConfig(env);
  for (const warning of warnings) {
    console.warn(`[config] warning: ${warning}`);
  }
  if (fatal.length > 0) {
    throw new Error(
      "Refusing to start with an unsafe configuration:\n" +
        fatal.map((problem) => `  - ${problem}`).join("\n"),
    );
  }
}
