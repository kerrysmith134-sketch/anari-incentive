/**
 * Startup configuration validation.
 *
 * The API and the worker call `assertRuntimeConfig(process.env)` before they
 * bind a port, so an unsafe deployment fails fast at boot instead of silently
 * running with development authentication or a non-durable store.
 *
 * All rules are pure functions of the environment so they can be unit tested.
 */

import { MIN_INTEGRATION_KEY_LENGTH } from "./integration-crypto.js";

export interface RuntimeConfigIssues {
  /** Problems that must abort startup. */
  fatal: string[];
  /** Problems that should be surfaced but do not block startup. */
  warnings: string[];
}

const truthy = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

const hasText = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

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

  // NP-009 / 2026-11-21 audit: webhook signatures and raw-payload encryption
  // must never fall back to SESSION_SECRET or a public development default in
  // production, and the two keys must not be the same value.
  const signingSecret = env.WEBHOOK_SIGNING_SECRET;
  const rawPayloadKey = env.WEBHOOK_RAW_KEY;
  // KMS/Vault sidecars may project a keyring file instead of env vars.
  const keyringFile = hasText(env.WEBHOOK_KEYRING_FILE);
  const hasSigningSecret = hasText(signingSecret) || keyringFile;
  const hasRawPayloadKey = hasText(rawPayloadKey) || keyringFile;

  if (production) {
    if (!hasSigningSecret) {
      fatal.push(
        "WEBHOOK_SIGNING_SECRET is required in production; set a dedicated " +
          `secret of at least ${MIN_INTEGRATION_KEY_LENGTH} characters ` +
          "(never reuse SESSION_SECRET)",
      );
    } else if (signingSecret && signingSecret.length < MIN_INTEGRATION_KEY_LENGTH) {
      fatal.push(
        `WEBHOOK_SIGNING_SECRET must be at least ${MIN_INTEGRATION_KEY_LENGTH} ` +
          `characters in production (got ${signingSecret.length}); use a ` +
          "high-entropy random secret",
      );
    }

    if (!hasRawPayloadKey) {
      fatal.push(
        "WEBHOOK_RAW_KEY is required in production; set a dedicated " +
          `encryption key of at least ${MIN_INTEGRATION_KEY_LENGTH} characters ` +
          "(independent from WEBHOOK_SIGNING_SECRET)",
      );
    } else if (rawPayloadKey && rawPayloadKey.length < MIN_INTEGRATION_KEY_LENGTH) {
      fatal.push(
        `WEBHOOK_RAW_KEY must be at least ${MIN_INTEGRATION_KEY_LENGTH} ` +
          `characters in production (got ${rawPayloadKey.length}); use a ` +
          "high-entropy random key",
      );
    }
  } else {
    if (!hasSigningSecret) {
      warnings.push(
        "WEBHOOK_SIGNING_SECRET is unset; using the development webhook " +
          "signing default (never use this default in production)",
      );
    }
    if (!hasRawPayloadKey) {
      warnings.push(
        "WEBHOOK_RAW_KEY is unset; using the development raw payload " +
          "encryption default (never use this default in production)",
      );
    }
  }

  if (
    hasText(signingSecret) &&
    hasText(rawPayloadKey) &&
    signingSecret === rawPayloadKey
  ) {
    fatal.push(
      "WEBHOOK_SIGNING_SECRET and WEBHOOK_RAW_KEY must be different values; " +
        "the webhook signing secret must never double as the raw payload " +
        "encryption key",
    );
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
