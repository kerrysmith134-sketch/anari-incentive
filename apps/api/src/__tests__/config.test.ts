import { describe, expect, it } from "vitest";
import {
  assertRuntimeConfig,
  validateRuntimeConfig,
} from "../config.js";

const SIGNING_SECRET = "test-webhook-signing-secret-0123456789abcdef";
const RAW_PAYLOAD_KEY = "test-webhook-raw-encryption-key-0123456789abcdef";

const baseEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "development",
  AUTH_MODE: "dev",
  STORE: "memory",
  WEBHOOK_SIGNING_SECRET: SIGNING_SECRET,
  WEBHOOK_RAW_KEY: RAW_PAYLOAD_KEY,
});

/** A production environment that passes every existing gate. */
const productionEnv = (): NodeJS.ProcessEnv => ({
  ...baseEnv(),
  NODE_ENV: "production",
  AUTH_MODE: "oidc",
  OIDC_ISSUER: "https://issuer",
  OIDC_JWKS_URL: "https://issuer/jwks",
  STORE: "postgres",
  DATABASE_URL: "postgres://x",
  RATE_LIMIT_PER_MINUTE: "120",
});

describe("validateRuntimeConfig", () => {
  it("accepts a complete development configuration", () => {
    expect(validateRuntimeConfig(baseEnv())).toEqual({
      fatal: [],
      warnings: [],
    });
  });

  it("rejects an unknown auth mode", () => {
    const issues = validateRuntimeConfig({ ...baseEnv(), AUTH_MODE: "saml" });
    expect(issues.fatal[0]).toContain("AUTH_MODE must be");
  });

  it("requires issuer and JWKS URL for oidc", () => {
    const issues = validateRuntimeConfig({
      ...baseEnv(),
      AUTH_MODE: "oidc",
      STORE: "postgres",
      DATABASE_URL: "postgres://x",
    });
    expect(issues.fatal).toEqual([
      "AUTH_MODE=oidc requires OIDC_ISSUER",
      "AUTH_MODE=oidc requires OIDC_JWKS_URL",
    ]);
  });

  it("blocks dev auth in production unless explicitly accepted", () => {
    const env = {
      ...baseEnv(),
      NODE_ENV: "production",
      STORE: "postgres",
      DATABASE_URL: "postgres://x",
    };
    const issues = validateRuntimeConfig(env);
    expect(issues.fatal).toHaveLength(1);
    expect(issues.fatal[0]).toContain("ALLOW_UNSAFE_DEV_AUTH");

    expect(
      validateRuntimeConfig({ ...env, ALLOW_UNSAFE_DEV_AUTH: "true" }).fatal,
    ).toEqual([]);
  });

  it("blocks the in-memory store in production unless explicitly accepted", () => {
    const env = { ...baseEnv(), NODE_ENV: "production" };
    expect(
      validateRuntimeConfig(env).fatal.some((f) => f.includes("ALLOW_MEMORY_STORE")),
    ).toBe(true);
    expect(
      validateRuntimeConfig({
        ...env,
        ALLOW_MEMORY_STORE: "1",
        ALLOW_UNSAFE_DEV_AUTH: "true",
      }).fatal,
    ).toEqual([]);
  });

  it("warns about a missing rate limit in production only", () => {
    const env = {
      ...baseEnv(),
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      OIDC_ISSUER: "https://issuer",
      OIDC_JWKS_URL: "https://issuer/jwks",
      STORE: "postgres",
      DATABASE_URL: "postgres://x",
    };
    expect(validateRuntimeConfig(env).warnings).toHaveLength(1);
    expect(
      validateRuntimeConfig({ ...env, ALLOW_NO_RATE_LIMIT: "true" }).warnings,
    ).toEqual([]);
    expect(validateRuntimeConfig({ ...env, NODE_ENV: "test" }).warnings).toEqual(
      [],
    );
  });

  it("requires DATABASE_URL when postgres is selected", () => {
    const issues = validateRuntimeConfig({
      ...baseEnv(),
      STORE: "postgres",
    });
    expect(issues.fatal).toEqual(["STORE=postgres requires DATABASE_URL"]);
  });

  it("assertRuntimeConfig throws only on fatal problems", () => {
    expect(() => assertRuntimeConfig(baseEnv())).not.toThrow();
    expect(() =>
      assertRuntimeConfig({ ...baseEnv(), NODE_ENV: "production" }),
    ).toThrow(/unsafe configuration/);
  });

  describe("integration webhook keys", () => {
    it("accepts a complete production configuration", () => {
      const issues = validateRuntimeConfig(productionEnv());
      expect(issues.fatal).toEqual([]);
      expect(issues.warnings).toEqual([]);
    });

    it("rejects a missing WEBHOOK_SIGNING_SECRET in production", () => {
      const env = productionEnv();
      delete env.WEBHOOK_SIGNING_SECRET;
      const issues = validateRuntimeConfig(env);
      expect(
        issues.fatal.some((problem) =>
          problem.includes("WEBHOOK_SIGNING_SECRET is required"),
        ),
      ).toBe(true);
    });

    it("rejects a missing WEBHOOK_RAW_KEY in production", () => {
      const env = productionEnv();
      delete env.WEBHOOK_RAW_KEY;
      const issues = validateRuntimeConfig(env);
      expect(
        issues.fatal.some((problem) =>
          problem.includes("WEBHOOK_RAW_KEY is required"),
        ),
      ).toBe(true);
    });

    it("rejects SESSION_SECRET as a fallback for the webhook keys in production", () => {
      const env = productionEnv();
      delete env.WEBHOOK_SIGNING_SECRET;
      delete env.WEBHOOK_RAW_KEY;
      env.SESSION_SECRET = "session-secret-0123456789abcdefghijklmnop";
      const issues = validateRuntimeConfig(env);
      expect(
        issues.fatal.some((problem) =>
          problem.includes("WEBHOOK_SIGNING_SECRET is required"),
        ),
      ).toBe(true);
      expect(
        issues.fatal.some((problem) =>
          problem.includes("WEBHOOK_RAW_KEY is required"),
        ),
      ).toBe(true);
    });

    it("rejects identical signing and raw payload keys in production", () => {
      const issues = validateRuntimeConfig({
        ...productionEnv(),
        WEBHOOK_RAW_KEY: SIGNING_SECRET,
      });
      expect(
        issues.fatal.some((problem) =>
          problem.includes("must be different values"),
        ),
      ).toBe(true);
    });

    it("rejects a short WEBHOOK_SIGNING_SECRET in production", () => {
      const issues = validateRuntimeConfig({
        ...productionEnv(),
        WEBHOOK_SIGNING_SECRET: "a".repeat(31),
      });
      expect(
        issues.fatal.some(
          (problem) =>
            problem.includes("WEBHOOK_SIGNING_SECRET") &&
            problem.includes("at least 32 characters"),
        ),
      ).toBe(true);
    });

    it("rejects a short WEBHOOK_RAW_KEY in production", () => {
      const issues = validateRuntimeConfig({
        ...productionEnv(),
        WEBHOOK_RAW_KEY: "b".repeat(31),
      });
      expect(
        issues.fatal.some(
          (problem) =>
            problem.includes("WEBHOOK_RAW_KEY") &&
            problem.includes("at least 32 characters"),
        ),
      ).toBe(true);
    });

    it("accepts exactly 32-character distinct keys in production", () => {
      const issues = validateRuntimeConfig({
        ...productionEnv(),
        WEBHOOK_SIGNING_SECRET: "a".repeat(32),
        WEBHOOK_RAW_KEY: "b".repeat(32),
      });
      expect(issues.fatal).toEqual([]);
    });

    it("warns but does not block when the keys are missing outside production", () => {
      const env = baseEnv();
      delete env.WEBHOOK_SIGNING_SECRET;
      delete env.WEBHOOK_RAW_KEY;
      const issues = validateRuntimeConfig(env);
      expect(issues.fatal).toEqual([]);
      expect(issues.warnings).toHaveLength(2);
      expect(
        issues.warnings.some((warning) =>
          warning.includes("WEBHOOK_SIGNING_SECRET is unset"),
        ),
      ).toBe(true);
      expect(
        issues.warnings.some((warning) =>
          warning.includes("WEBHOOK_RAW_KEY is unset"),
        ),
      ).toBe(true);
    });

    it("accepts a KMS/Vault keyring file as the production key source", () => {
      const env = productionEnv();
      delete env.WEBHOOK_SIGNING_SECRET;
      delete env.WEBHOOK_RAW_KEY;
      env.WEBHOOK_KEYRING_FILE = "/run/secrets/webhook-keyring.json";
      expect(validateRuntimeConfig(env).fatal).toEqual([]);
    });

    it("still rejects identical keys outside production", () => {
      const issues = validateRuntimeConfig({
        ...baseEnv(),
        WEBHOOK_RAW_KEY: SIGNING_SECRET,
      });
      expect(
        issues.fatal.some((problem) =>
          problem.includes("must be different values"),
        ),
      ).toBe(true);
    });
  });
});
