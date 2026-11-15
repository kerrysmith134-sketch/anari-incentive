import { afterEach, describe, expect, it } from "vitest";
import {
  HttpModelScoringProvider,
  ModelProviderError,
  resetModelProviderBreakers,
} from "../model-provider.js";
import {
  getModelUsageSnapshot,
  recordModelUsage,
  resetModelUsage,
} from "../usage.js";

const VALID_OUTPUT = {
  summary: "Delivery evidence is present.",
  dimensionAssessments: [
    {
      dimension: "QUALITY",
      status: "SUPPORTED",
      rationale: "A signed acceptance record supports the claim.",
      supportingEvidenceRefs: ["e1"],
      counterEvidenceRefs: [],
      missingInformation: [],
    },
  ],
  uncertainty: { band: "LOW", reasons: [] },
};

function okFetch(
  content: unknown,
  status = 200,
  counters?: { calls: number },
): typeof fetch {
  return (async () => {
    if (counters) counters.calls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 42, completion_tokens: 7 },
      }),
      { status },
    );
  }) as unknown as typeof fetch;
}

function provider(
  fetchImpl: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof HttpModelScoringProvider>[0]> = {},
): HttpModelScoringProvider {
  return new HttpModelScoringProvider({
    baseUrl: "https://model.test/v1",
    apiKey: "k",
    model: "m",
    fetchImpl,
    retryBaseDelayMs: 1,
    ...overrides,
  });
}

const input = {
  dimensions: ["QUALITY"],
  evidence: [{ ref: "e1", text: "signed acceptance" }],
};

describe("AUD-019: LLM 请求运行时保护", () => {
  afterEach(() => {
    resetModelProviderBreakers();
    resetModelUsage();
  });

  it("捕获 provider 上报的 token 用量并按租户聚合", async () => {
    const result = await provider(okFetch(VALID_OUTPUT)).summarise(input);
    expect(result.usage).toEqual({ promptTokens: 42, completionTokens: 7 });
    recordModelUsage("tenant-a", result.provider, result.model, result.usage);
    recordModelUsage("tenant-a", result.provider, result.model, result.usage);
    const snapshot = getModelUsageSnapshot();
    const entry = snapshot.find(
      (item) => item.tenantId === "tenant-a" && item.model === "m",
    );
    expect(entry?.requests).toBe(2);
    expect(entry?.promptTokens).toBe(84);
    expect(entry?.completionTokens).toBe(14);
  });

  it("429/5xx 在预算内退避重试并成功", async () => {
    const counters = { calls: 0 };
    const flaky = (async (...args: Parameters<typeof fetch>) => {
      counters.calls += 1;
      if (counters.calls === 1) {
        return new Response("throttled", { status: 429 });
      }
      return okFetch(VALID_OUTPUT)(...args);
    }) as unknown as typeof fetch;
    const result = await provider(flaky, { maxRetries: 2 }).summarise(input);
    expect(result.summary).toContain("Delivery evidence");
    expect(counters.calls).toBe(2);
  });

  it("网络错误耗尽预算后抛 MODEL_PROVIDER_HTTP_ERROR", async () => {
    const counters = { calls: 0 };
    const failing = (async () => {
      counters.calls += 1;
      throw new TypeError("connection reset");
    }) as unknown as typeof fetch;
    const promise = provider(failing, { maxRetries: 1 }).summarise(input);
    await expect(promise).rejects.toMatchObject({
      code: "MODEL_PROVIDER_HTTP_ERROR",
    });
    expect(counters.calls).toBe(2); // maxRetries(1) + 1
  });

  it("异常大响应被字节上限拒绝（不整体载入）", async () => {
    const huge = {
      ...VALID_OUTPUT,
      summary: "x".repeat(5_000),
    };
    const promise = provider(okFetch(huge), { maxResponseBytes: 1_000 }).summarise(
      input,
    );
    await expect(promise).rejects.toMatchObject({
      code: "MODEL_PROVIDER_INVALID_OUTPUT",
      message: expect.stringContaining("byte limit"),
    });
  });

  it("连续失败触发熔断：预算外请求 fail-fast 不再调用 fetch", async () => {
    const counters = { calls: 0 };
    const failing = (async () => {
      counters.calls += 1;
      return new Response("boom", { status: 503 });
    }) as unknown as typeof fetch;
    const broken = provider(failing, { maxRetries: 0 });
    for (let k = 0; k < 5; k += 1) {
      await expect(broken.summarise(input)).rejects.toMatchObject({
        code: "MODEL_PROVIDER_HTTP_ERROR",
      });
    }
    const afterFailures = counters.calls;
    await expect(broken.summarise(input)).rejects.toMatchObject({
      code: "MODEL_PROVIDER_CIRCUIT_OPEN",
    });
    expect(counters.calls).toBe(afterFailures); // fail-fast：无新 fetch
    // 复位后恢复尝试。
    resetModelProviderBreakers();
    await expect(broken.summarise(input)).rejects.toMatchObject({
      code: "MODEL_PROVIDER_HTTP_ERROR",
    });
    expect(counters.calls).toBe(afterFailures + 1);
  });
});
