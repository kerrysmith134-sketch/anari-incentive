/**
 * 2026-11-21 审计 P0（SSRF 后续）：outboundJsonFetch / redactSample 测试。
 *
 * 全部离线：DNS 与 HTTP transport 均通过 `deps` 注入；不访问真实网络。
 */
import { describe, expect, it, vi } from "vitest";
import {
  outboundJsonFetch,
  pinnedFetch,
  redactSample,
  type OutboundAddress,
  type OutboundHttpResponse,
  type OutboundRequestFn,
} from "../outbound-http.js";

const PUBLIC_V4: OutboundAddress = { address: "93.184.216.34", family: 4 };
const PUBLIC_V4_ALT: OutboundAddress = { address: "1.1.1.1", family: 4 };
const PUBLIC_V6: OutboundAddress = { address: "2606:4700:4700::1111", family: 6 };

function jsonResponse(payload: unknown, status = 200): OutboundHttpResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function redirectResponse(location?: string, status = 302): OutboundHttpResponse {
  return {
    status,
    headers: location === undefined ? {} : { location },
    body: "",
  };
}

function lookupReturning(...records: OutboundAddress[]) {
  return vi.fn(async (_host: string): Promise<OutboundAddress[]> => records);
}

function familyOf(address: string): number {
  return address.includes(":") ? 6 : 4;
}

describe("outboundJsonFetch：DNS 校验与连接绑定", () => {
  it("公网域名 + 公网 IP：成功并解析 JSON；请求携带 pinned 地址与 SNI", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi.fn<OutboundRequestFn>(async () =>
      jsonResponse({ records: [{ id: "r1" }] }),
    );

    const result = await outboundJsonFetch({
      url: "https://provider.example/v1/contacts",
      headers: { Accept: "application/json", "X-Trace": "t1" },
      deps: { lookup, request },
    });

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.json).toEqual({ records: [{ id: "r1" }] });
    expect(result.text).toContain("records");
    expect(result.finalUrl).toBe("https://provider.example/v1/contacts");
    expect(result.redirects).toBe(0);
    expect(lookup).toHaveBeenCalledWith("provider.example");

    const options = request.mock.calls[0]![0];
    expect(options.protocol).toBe("https:");
    expect(options.host).toBe("provider.example");
    expect(options.port).toBe(443);
    expect(options.path).toBe("/v1/contacts");
    expect(options.servername).toBe("provider.example");
    expect(options.addresses).toEqual([PUBLIC_V4]);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    // 请求头名称统一小写，值不变。
    expect(options.headers).toMatchObject({ accept: "application/json", "x-trace": "t1" });
  });

  it("IPv6 字面量：去掉方括号后传入 host，SNI 仍是主机名", async () => {
    const lookup = lookupReturning(PUBLIC_V6);
    const request = vi.fn<OutboundRequestFn>(async () => jsonResponse({ ok: true }));

    const result = await outboundJsonFetch({
      url: "https://[2606:4700:4700::1111]/v1/ping",
      deps: { lookup, request },
    });

    expect(result.ok).toBe(true);
    expect(lookup).toHaveBeenCalledWith("2606:4700:4700::1111");
    const options = request.mock.calls[0]![0];
    expect(options.host).toBe("2606:4700:4700::1111");
    expect(options.port).toBe(443);
    expect(options.servername).toBe("2606:4700:4700::1111");
  });

  const blockedAddresses = [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ];

  for (const address of blockedAddresses) {
    it(`DNS 解析到 ${address} 时拒绝，且不发起连接`, async () => {
      const lookup = lookupReturning({ address, family: familyOf(address) });
      const request = vi.fn<OutboundRequestFn>(async () => jsonResponse({}));

      await expect(
        outboundJsonFetch({
          url: "https://provider.example/api",
          deps: { lookup, request },
        }),
      ).rejects.toThrow(/EGRESS_PRIVATE_IP_BLOCKED/);
      expect(request).not.toHaveBeenCalled();
    });
  }

  it("混合解析记录中只要有一条私网就整体拒绝（不是只看选中地址）", async () => {
    const lookup = lookupReturning(PUBLIC_V4, {
      address: "10.0.0.7",
      family: 4,
    });
    const request = vi.fn<OutboundRequestFn>(async () => jsonResponse({}));

    await expect(
      outboundJsonFetch({
        url: "https://provider.example/api",
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/EGRESS_PRIVATE_IP_BLOCKED/);
    expect(request).not.toHaveBeenCalled();
  });

  it("allowlist 不匹配时拒绝，且不解析 DNS/不发请求", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi.fn<OutboundRequestFn>(async () => jsonResponse({}));

    await expect(
      outboundJsonFetch({
        url: "https://evil.example/api",
        allowlist: ["provider.example"],
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/EGRESS_HOST_NOT_ALLOWLISTED/);
    expect(lookup).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("URL 内嵌 username/password 时拒绝", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi.fn<OutboundRequestFn>(async () => jsonResponse({}));

    await expect(
      outboundJsonFetch({
        url: "https://user:secret@provider.example/api",
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/OUTBOUND_URL_CREDENTIALS_BLOCKED/);
    expect(request).not.toHaveBeenCalled();
  });

  it("非 http(s) 协议沿用 EGRESS_PROTOCOL_BLOCKED", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi.fn<OutboundRequestFn>(async () => jsonResponse({}));

    await expect(
      outboundJsonFetch({
        url: "ftp://provider.example/api",
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/EGRESS_PROTOCOL_BLOCKED/);
    expect(request).not.toHaveBeenCalled();
  });

  it("DNS 解析失败/空结果时给出稳定错误前缀", async () => {
    const failing = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    await expect(
      outboundJsonFetch({
        url: "https://provider.example/api",
        deps: { lookup: failing, request: vi.fn<OutboundRequestFn>() },
      }),
    ).rejects.toThrow(/OUTBOUND_DNS_FAILED: provider\.example/);

    const empty = vi.fn(async (): Promise<OutboundAddress[]> => []);
    await expect(
      outboundJsonFetch({
        url: "https://provider.example/api",
        deps: { lookup: empty, request: vi.fn<OutboundRequestFn>() },
      }),
    ).rejects.toThrow(/OUTBOUND_DNS_EMPTY/);
  });
});

describe("outboundJsonFetch：重定向逐跳校验", () => {
  it("跟随相对重定向，每一跳重新解析/校验 DNS", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi
      .fn<OutboundRequestFn>()
      .mockResolvedValueOnce(redirectResponse("/v2/items"))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    const result = await outboundJsonFetch({
      url: "https://provider.example/v1/items",
      deps: { lookup, request },
    });

    expect(result.status).toBe(200);
    expect(result.redirects).toBe(1);
    expect(result.finalUrl).toBe("https://provider.example/v2/items");
    expect(request).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]![0].path).toBe("/v2/items");
  });

  it("重定向到私网字面量 IP 时拒绝（未发起第二跳）", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi
      .fn<OutboundRequestFn>()
      .mockResolvedValueOnce(redirectResponse("https://10.1.2.3/latest/meta-data"));

    await expect(
      outboundJsonFetch({
        url: "https://provider.example/start",
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/EGRESS_PRIVATE_IP_BLOCKED/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("重定向到解析结果为私网的新域名时拒绝（逐跳 DNS 校验）", async () => {
    const lookup = vi.fn(async (host: string): Promise<OutboundAddress[]> =>
      host === "provider.example"
        ? [PUBLIC_V4]
        : [{ address: "10.0.0.9", family: 4 }],
    );
    const request = vi
      .fn<OutboundRequestFn>()
      .mockResolvedValueOnce(redirectResponse("https://internal.example/next"));

    await expect(
      outboundJsonFetch({
        url: "https://provider.example/start",
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/EGRESS_PRIVATE_IP_BLOCKED/);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("跨 host 重定向丢弃 Authorization/Cookie；同 host 保留 Authorization", async () => {
    const lookup = vi.fn(
      async (host: string): Promise<OutboundAddress[]> =>
        host === "provider.example" ? [PUBLIC_V4] : [PUBLIC_V4_ALT],
    );

    // 跨 host
    const crossRequest = vi
      .fn<OutboundRequestFn>()
      .mockResolvedValueOnce(redirectResponse("https://other.example/next"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    await outboundJsonFetch({
      url: "https://provider.example/start",
      headers: {
        Authorization: "Bearer super-secret",
        Cookie: "sid=1",
        Accept: "application/json",
      },
      deps: { lookup, request: crossRequest },
    });
    expect(crossRequest.mock.calls[0]![0].headers.authorization).toBe(
      "Bearer super-secret",
    );
    const crossHeaders = crossRequest.mock.calls[1]![0].headers;
    expect(crossHeaders.authorization).toBeUndefined();
    expect(crossHeaders.cookie).toBeUndefined();
    expect(crossHeaders.accept).toBe("application/json");
    expect(crossRequest.mock.calls[1]![0].host).toBe("other.example");

    // 同 host
    const sameRequest = vi
      .fn<OutboundRequestFn>()
      .mockResolvedValueOnce(redirectResponse("/next"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    await outboundJsonFetch({
      url: "https://provider.example/start",
      headers: { Authorization: "Bearer keep-me" },
      deps: { lookup, request: sameRequest },
    });
    expect(sameRequest.mock.calls[1]![0].headers.authorization).toBe("Bearer keep-me");
  });

  it("超过 maxRedirects 时抛出 OUTBOUND_TOO_MANY_REDIRECTS", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi.fn<OutboundRequestFn>(async () => redirectResponse("/loop"));

    await expect(
      outboundJsonFetch({
        url: "https://provider.example/loop",
        maxRedirects: 2,
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/OUTBOUND_TOO_MANY_REDIRECTS/);
    // 初始请求 + 2 次跟随，第 3 次 302 时停止。
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("重定向目标同样受 allowlist 约束", async () => {
    const lookup = vi.fn(
      async (host: string): Promise<OutboundAddress[]> =>
        host === "provider.example" ? [PUBLIC_V4] : [PUBLIC_V4_ALT],
    );
    const request = vi
      .fn<OutboundRequestFn>()
      .mockResolvedValueOnce(redirectResponse("https://other.example/next"));

    await expect(
      outboundJsonFetch({
        url: "https://provider.example/start",
        allowlist: ["provider.example"],
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/EGRESS_HOST_NOT_ALLOWLISTED/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("重定向到非 http(s) 协议时拒绝", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi
      .fn<OutboundRequestFn>()
      .mockResolvedValueOnce(redirectResponse("file:///etc/passwd"));

    await expect(
      outboundJsonFetch({
        url: "https://provider.example/start",
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/EGRESS_PROTOCOL_BLOCKED/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("3xx 但缺少 Location 时 fail closed", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi.fn<OutboundRequestFn>(async () => redirectResponse(undefined, 301));

    await expect(
      outboundJsonFetch({
        url: "https://provider.example/start",
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/OUTBOUND_REDIRECT_WITHOUT_LOCATION/);
  });
});

describe("outboundJsonFetch：超时、体积上限、解析容错", () => {
  it("响应体超过 maxBytes（异步流）→ OUTBOUND_RESPONSE_TOO_LARGE", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi.fn<OutboundRequestFn>(async () => ({
      status: 200,
      headers: {},
      body: (async function* () {
        yield Buffer.from("0123", "utf8");
        yield Buffer.from("456789", "utf8");
      })(),
    }));

    await expect(
      outboundJsonFetch({
        url: "https://provider.example/big",
        maxBytes: 4,
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/OUTBOUND_RESPONSE_TOO_LARGE/);
  });

  it("响应体超过 maxBytes（单 Buffer）与 content-length 提前拒绝", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const buffered = vi.fn<OutboundRequestFn>(async () => ({
      status: 200,
      headers: {},
      body: Buffer.from("0123456789"),
    }));
    await expect(
      outboundJsonFetch({
        url: "https://provider.example/big",
        maxBytes: 4,
        deps: { lookup, request: buffered },
      }),
    ).rejects.toThrow(/OUTBOUND_RESPONSE_TOO_LARGE/);

    const declared = vi.fn<OutboundRequestFn>(async () => ({
      status: 200,
      headers: { "content-length": "1000" },
      body: "",
    }));
    await expect(
      outboundJsonFetch({
        url: "https://provider.example/big",
        maxBytes: 10,
        deps: { lookup, request: declared },
      }),
    ).rejects.toThrow(/OUTBOUND_RESPONSE_TOO_LARGE/);
  });

  it("超时（含未响应）→ OUTBOUND_TIMEOUT", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi.fn<OutboundRequestFn>(
      () => new Promise<OutboundHttpResponse>(() => {}),
    );

    await expect(
      outboundJsonFetch({
        url: "https://provider.example/slow",
        timeoutMs: 20,
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/OUTBOUND_TIMEOUT/);
  });

  it("JSON 解析失败时 json 为 undefined、text/status 保留、不抛错", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi.fn<OutboundRequestFn>(async () => ({
      status: 502,
      headers: { "content-type": "text/html" },
      body: "<html>bad gateway</html>",
    }));

    const result = await outboundJsonFetch({
      url: "https://provider.example/api",
      deps: { lookup, request },
    });
    expect(result.status).toBe(502);
    expect(result.ok).toBe(false);
    expect(result.json).toBeUndefined();
    expect(result.text).toBe("<html>bad gateway</html>");
  });

  it("transport 抛未知错误时带 OUTBOUND_REQUEST_FAILED 前缀", async () => {
    const lookup = lookupReturning(PUBLIC_V4);
    const request = vi.fn<OutboundRequestFn>(async () => {
      throw new Error("ECONNRESET");
    });

    await expect(
      outboundJsonFetch({
        url: "https://provider.example/api",
        deps: { lookup, request },
      }),
    ).rejects.toThrow(/OUTBOUND_REQUEST_FAILED: ECONNRESET/);
  });
});

describe("redactSample：PII/密钥脱敏", () => {
  it("敏感 key（大小写/下划线/中文）整体替换为 [REDACTED]", () => {
    const sample = {
      authorization: "Bearer abc",
      api_key: "key-123",
      apiKey: "camel-123",
      client_secret: "shh",
      access_token: "tok",
      password: "p@ss",
      credential: "cred",
      cookie: "sid=1",
      sessionId: "sess",
      email: "user@example.com",
      phone: "13800138000",
      mobile: "13800138000",
      id_card: "110101199001011234",
      身份证: "110101199001011234",
      手机: "13800138000",
      邮箱: "user@example.com",
      name: "Alice",
    };

    const redacted = redactSample(sample) as Record<string, unknown>;
    for (const key of [
      "authorization",
      "api_key",
      "apiKey",
      "client_secret",
      "access_token",
      "password",
      "credential",
      "cookie",
      "sessionId",
      "email",
      "phone",
      "mobile",
      "id_card",
      "身份证",
      "手机",
      "邮箱",
    ]) {
      expect(redacted[key]).toBe("[REDACTED]");
    }
    expect(redacted.name).toBe("Alice");
  });

  it("非敏感 key 的字符串按形态脱敏：邮箱 / 手机号 / 高熵长串", () => {
    const redacted = redactSample({
      contact: "alice@example.com",
      tel: "+86 138-0013-8000",
      note: "sk_test_example_0123456789abcdefghijklmnop",
      short: "abc",
      chinese: "这是普通的备注文本不是密钥",
      lowEntropy: "a".repeat(64),
      amount: 42,
      active: true,
      missing: null,
    }) as Record<string, unknown>;

    expect(redacted.contact).toBe("***@***");
    expect(redacted.tel).toBe("***");
    expect(redacted.note).toBe("[REDACTED]");
    expect(redacted.short).toBe("abc");
    expect(redacted.chinese).toBe("这是普通的备注文本不是密钥");
    expect(redacted.lowEntropy).toBe("a".repeat(64));
    expect(redacted.amount).toBe(42);
    expect(redacted.active).toBe(true);
    expect(redacted.missing).toBeNull();
  });

  it("嵌套对象/数组递归脱敏且保留结构", () => {
    const redacted = redactSample({
      user: {
        email: "user@example.com",
        password: { hash: "deadbeef" },
        name: "Bob",
      },
      contacts: [
        { type: "work", value: "bob@example.com" },
        { type: "mobile", value: "13900139000" },
      ],
    }) as {
      user: Record<string, unknown>;
      contacts: Array<Record<string, unknown>>;
    };

    expect(redacted.user.email).toBe("[REDACTED]");
    expect(redacted.user.password).toBe("[REDACTED]");
    expect(redacted.user.name).toBe("Bob");
    expect(redacted.contacts[0]!.value).toBe("***@***");
    expect(redacted.contacts[1]!.value).toBe("***");
    expect(redacted.contacts[0]!.type).toBe("work");
  });

  it("深度上限 6：更深的子树替换为 [TRUNCATED]", () => {
    let deep: Record<string, unknown> = { leaf: "value" };
    for (let index = 0; index < 10; index += 1) {
      deep = { child: deep };
    }

    const redacted = redactSample(deep);
    let cursor: unknown = redacted;
    for (let index = 0; index < 6; index += 1) {
      cursor = (cursor as Record<string, unknown>).child;
    }
    expect(cursor).toBe("[TRUNCATED]");
  });

  it("数组最多保留 20 项", () => {
    const redacted = redactSample({
      items: Array.from({ length: 30 }, (_, index) => index),
    }) as { items: number[] };
    expect(redacted.items).toHaveLength(20);
    expect(redacted.items[0]).toBe(0);
    expect(redacted.items[19]).toBe(19);
  });

  it("provider JSON 的自有 __proto__ 键不会污染结果原型", () => {
    const parsed = JSON.parse(
      '{"__proto__":{"polluted":true},"name":"x","token":"abc"}',
    ) as Record<string, unknown>;
    const redacted = redactSample(parsed) as Record<string, unknown>;

    expect(Object.keys(redacted)).toContain("__proto__");
    expect(redacted.token).toBe("[REDACTED]");
    expect(redacted.name).toBe("x");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
  });

  it("循环引用不导致栈溢出", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;

    const redacted = redactSample(cyclic) as Record<string, unknown>;
    expect(redacted.name).toBe("x");
    expect(redacted.self).toBe("[CIRCULAR]");
  });

  it("从非零 depth 开始调用时沿用剩余深度", () => {
    const nested = { child: { child: { leaf: 1 } } };
    expect(redactSample(nested, 6)).toBe("[TRUNCATED]");
  });
});

describe("pinnedFetch (sync connector default transport)", () => {
  it("rejects private/loopback URLs before any connection", async () => {
    await expect(pinnedFetch("https://127.0.0.1/internal")).rejects.toThrow(
      /EGRESS_/,
    );
    await expect(pinnedFetch("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
      /EGRESS_/,
    );
  });

  it("rejects URL-embedded credentials", async () => {
    await expect(
      pinnedFetch("https://user:pass@provider.example/api"),
    ).rejects.toThrow(/OUTBOUND_URL_CREDENTIALS_BLOCKED/);
  });
});
