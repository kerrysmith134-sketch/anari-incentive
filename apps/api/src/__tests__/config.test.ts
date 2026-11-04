import { describe, expect, it } from "vitest";
import {
  assertRuntimeConfig,
  validateRuntimeConfig,
} from "../config.js";

const baseEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "development",
  AUTH_MODE: "dev",
  STORE: "memory",
});

describe("validateRuntimeConfig", () => {
  it("accepts the development defaults", () => {
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
});
