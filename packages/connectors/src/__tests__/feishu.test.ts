import { describe, expect, it } from "vitest";
import {
  FeishuTenantTokenSource,
  FeishuTokenError,
  computeFeishuSignature,
  verifyFeishuSignature,
} from "../index.js";

describe("Feishu signatures", () => {
  it("verifies the event signature and rejects tampering", () => {
    const input = {
      encryptKey: "encrypt-key",
      timestamp: "1767225600",
      nonce: "nonce-1",
      body: '{"event":"order.updated"}',
    };
    const signature = computeFeishuSignature(input);
    expect(
      verifyFeishuSignature({
        ...input,
        signature,
      }),
    ).toBe(true);
    expect(
      verifyFeishuSignature({
        ...input,
        body: `${input.body} `,
        signature,
      }),
    ).toBe(false);
    expect(
      verifyFeishuSignature({
        ...input,
        signature: undefined,
      }),
    ).toBe(false);
  });
});

describe("Feishu tenant access tokens", () => {
  it("caches and refreshes tenant tokens", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let now = 1_000_000;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          code: 0,
          tenant_access_token: `feishu-${calls.length}`,
          expire: 60,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const source = new FeishuTenantTokenSource({
      appId: "app-id",
      appSecret: "app-secret",
      fetchImpl,
      now: () => now,
    });

    expect(await source.getToken()).toBe("feishu-1");
    expect(await source.getToken()).toBe("feishu-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    );
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      app_id: "app-id",
      app_secret: "app-secret",
    });

    now += 40_000;
    expect(await source.getToken()).toBe("feishu-2");
    expect(calls).toHaveLength(2);
  });

  it("surfaces API and transport failures", async () => {
    const apiError = new FeishuTenantTokenSource({
      appId: "app-id",
      appSecret: "app-secret",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ code: 10003, msg: "invalid app" }), {
          status: 200,
        })) as typeof fetch,
    });
    await expect(apiError.getToken()).rejects.toMatchObject({
      code: "FEISHU_TOKEN_ERROR",
    });
    const httpError = new FeishuTenantTokenSource({
      appId: "app-id",
      appSecret: "app-secret",
      fetchImpl: (async () =>
        new Response("unavailable", { status: 503 })) as typeof fetch,
    });
    await expect(httpError.getToken()).rejects.toBeInstanceOf(
      FeishuTokenError,
    );
    await expect(httpError.getToken()).rejects.toMatchObject({
      status: 503,
    });
  });
});
