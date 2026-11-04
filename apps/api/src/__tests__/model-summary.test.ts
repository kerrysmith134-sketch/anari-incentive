import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { Store } from "../store.js";
import { MemoryPlatformStore } from "../platform-store.js";
import {
  HttpModelScoringProvider,
  ModelProviderError,
} from "@anari/ai-gate";

const OWNER = "00000000-0000-4000-8000-000000000001";

let appStore: Store;

function appWith(fetchImpl?: typeof fetch): FastifyInstance {
  return buildApp(
    appStore,
    undefined,
    undefined,
    undefined,
    fetchImpl
      ? {
          modelScoring: {
            baseUrl: "https://model.test/v1",
            apiKey: "key",
            model: "test-model",
            fetchImpl,
          },
        }
      : {},
  );
}

beforeEach(() => {
  appStore = new Store();
  new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [{ id: OWNER, employeeCode: "E001", displayName: "Lead" }],
    },
  });
});

function okFetch(content: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
}

describe("model summary provider", () => {
  it("validates schema and returns structured output", async () => {
    const provider = new HttpModelScoringProvider({
      baseUrl: "https://model.test/v1",
      apiKey: "k",
      model: "m",
      fetchImpl: okFetch({
        summary: "Evidence supports delivery",
        dimensionScores: { QUALITY: 4, TIMELINESS: 3 },
        confidence: 0.8,
      }),
    });
    const result = await provider.summarise({
      dimensions: ["QUALITY", "TIMELINESS"],
      evidence: [{ ref: "e1", text: "delivered" }],
    });
    expect(result.dimensionScores.QUALITY).toBe(4);
    expect(result.model).toBe("m");
  });

  it("rejects out-of-range scores and missing dimensions", async () => {
    const provider = new HttpModelScoringProvider({
      baseUrl: "https://model.test/v1",
      apiKey: "k",
      model: "m",
      fetchImpl: okFetch({
        summary: "x",
        dimensionScores: { QUALITY: 9 },
        confidence: 0.5,
      }),
    });
    await expect(
      provider.summarise({
        dimensions: ["QUALITY"],
        evidence: [{ ref: "e1", text: "t" }],
      }),
    ).rejects.toBeInstanceOf(ModelProviderError);
  });

  it("returns 501 when no provider is configured", async () => {
    const response = await appWith().inject({
      method: "POST",
      url: "/api/v1/ai/model-summary",
      payload: { dimensions: ["QUALITY"], evidenceRefs: ["e1"] },
    } as never);
    expect(response.statusCode).toBe(501);
    expect(response.json().error.code).toBe("MODEL_PROVIDER_NOT_CONFIGURED");
  });
});
