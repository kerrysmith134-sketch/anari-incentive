/*
 * LLM gateway config: compose files pass empty strings for unset variables
 * (`${VAR:-}`). Empty must mean "not configured", never a boot-time crash.
 */
import { describe, expect, it } from "vitest";
import { LLM_PRESETS, resolveLlmConfigFromEnv } from "../llm.js";

describe("LLM environment resolution", () => {
  it("uses the provider preset for empty base-url/model values", () => {
    const config = resolveLlmConfigFromEnv({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "sk-test",
      LLM_BASE_URL: "",
      LLM_MODEL: "",
    });
    expect(config?.baseUrl).toBe(LLM_PRESETS.deepseek.baseUrl);
    expect(config?.model).toBe(LLM_PRESETS.deepseek.defaultModel);
  });

  it("stays disabled when the provider is empty but a key is set", () => {
    expect(
      resolveLlmConfigFromEnv({ LLM_PROVIDER: "", LLM_API_KEY: "sk-test" }),
    ).toBeUndefined();
  });

  it("honours explicit overrides", () => {
    const config = resolveLlmConfigFromEnv({
      LLM_PROVIDER: "glm",
      LLM_API_KEY: "sk-test",
      LLM_BASE_URL: "https://gateway.internal/v1",
      LLM_MODEL: "glm-4-air",
    });
    expect(config).toMatchObject({
      provider: "glm",
      baseUrl: "https://gateway.internal/v1",
      model: "glm-4-air",
    });
  });

  it("still rejects an unknown provider name", () => {
    expect(() =>
      resolveLlmConfigFromEnv({
        LLM_PROVIDER: "openai",
        LLM_API_KEY: "sk-test",
      }),
    ).toThrow(/LLM_PROVIDER/);
  });

  it("requires a base url for the custom provider", () => {
    expect(() =>
      resolveLlmConfigFromEnv({
        LLM_PROVIDER: "custom",
        LLM_API_KEY: "sk-test",
        LLM_BASE_URL: "",
      }),
    ).toThrow(/LLM_BASE_URL/);
  });
});
