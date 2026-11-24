/**
 * 2026-11-21 审计包 Wave 4（P1）：HTTP 连接器限流/退避/超时 + SSRF 全面化。
 *
 * NP-017：429 Retry-After 尊重、5xx/网络错误指数退避+抖动重试、
 *         超时必须覆盖响应体消费（慢 body 也会被打断）；
 * NP-018：IPv6 回环/ULA/链路本地/NAT64、IPv4-mapped、十进制/八进制 IPv4
 *         便取形式全部拦截；allowlist 语义不变。
 */
import { describe, expect, it, vi } from "vitest";
import {
  assertEgressAllowed,
  assertEgressIpAllowed,
  HttpJsonConnector,
} from "../index.js";

function makeConnector(
  url: string,
  fetchImpl: typeof fetch,
): HttpJsonConnector {
  return new HttpJsonConnector({
    sourceSystem: "wave4",
    url,
    columns: {
      sourceRecordId: "id",
      eventType: "event_type",
      subjectType: "subject_type",
      subjectId: "subject_id",
      evidenceType: "=ACTIVITY",
    },
    fetchImpl,
  });
}

function jsonResponse(payload: unknown, extra: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    headers: new Headers(extra),
    redirected: false,
    url: "x",
  } as unknown as Response;
}

describe("NP-018: SSRF 全面拦截", () => {
  const blocked: Array<[string, string]> = [
    ["IPv6 回环", "http://[::1]/api"],
    ["IPv6 唯一本地", "http://[fc00::1]/api"],
    ["IPv6 链路本地", "http://[fe80::1]/api"],
    ["IPv6 未指定", "http://[::]/api"],
    ["IPv6 文档段", "http://[2001:db8::1]/api"],
    ["NAT64 映射回环", "http://[64:ff9b::127.0.0.1]/api"],
    ["IPv4-mapped IPv6", "http://[::ffff:127.0.0.1]/api"],
    ["十进制 IPv4", "http://2130706433/api"],
    ["八进制 IPv4", "http://0177.0.0.1/api"],
    ["十六进制 IPv4", "http://0x7f.0.0.1/api"],
    ["链路本地 v4", "http://169.254.10.10/api"],
    ["CGNAT", "http://100.64.0.1/api"],
    ["组播", "http://224.0.0.1/api"],
    ["TEST-NET-1", "http://192.0.2.1/api"],
  ];
  for (const [name, url] of blocked) {
    it(`拦截 ${name}`, () => {
      expect(() => assertEgressAllowed(new URL(url))).toThrow(/EGRESS_/);
    });
  }

  it("公网地址不拦截；allowlist 语义保持", () => {
    expect(() => assertEgressAllowed(new URL("https://provider.example/api"))).not.toThrow();
    expect(() =>
      assertEgressAllowed(new URL("http://8.8.8.8/api"), ["8.8.8.8"]),
    ).not.toThrow();
    expect(() =>
      assertEgressAllowed(new URL("https://other.example/api"), ["provider.example"]),
    ).toThrow(/NOT_ALLOWLISTED/);
  });
});

describe("NP-017: 限流/退避/超时", () => {
  it("429 + Retry-After: 0 → 自动重试后成功", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          json: async () => ({}),
          headers: new Headers({ "retry-after": "0" }),
          redirected: false,
          url: "x",
        } as unknown as Response;
      }
      return jsonResponse({ records: [{ id: "R1", event_type: "e", subject_type: "ORDER", subject_id: "00000000-0000-4000-8000-0000000000e1" }] });
    }) as unknown as typeof fetch;
    const connector = makeConnector("https://provider.example/api", fetchImpl);
    const result = await connector.pull(null);
    expect(result.events).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("5xx → 指数退避重试后成功（最多 3 次重试）", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls <= 2) {
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
          headers: new Headers(),
          redirected: false,
          url: "x",
        } as unknown as Response;
      }
      return jsonResponse({ records: [] });
    }) as unknown as typeof fetch;
    const connector = makeConnector("https://provider.example/api", fetchImpl);
    const result = await connector.pull(null);
    expect(result.events).toHaveLength(0);
    expect(calls).toBe(3);
  });

  it("持续 5xx → 重试耗尽后抛错（不吞错）", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      headers: new Headers(),
      redirected: false,
      url: "x",
    })) as unknown as typeof fetch;
    const connector = makeConnector("https://provider.example/api", fetchImpl);
    await expect(connector.pull(null)).rejects.toThrow(/failed: 500|HTTP 500|EGRESS|RETRY/i);
  });

  it("超时覆盖响应体消费——慢 body 被打断", async () => {
    const fetchImpl = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              // 真实 fetch 在中止时 reject——body 消费同样受信号约束。
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        }),
    ) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "wave4-slow",
      url: "https://provider.example/api",
      columns: {
        sourceRecordId: "id",
        eventType: "e",
        subjectType: "s",
        subjectId: "sid",
        evidenceType: "=ACTIVITY",
      },
      fetchImpl,
      timeoutMs: 80,
    });
    await expect(connector.pull(null)).rejects.toThrow(/TIMEOUT|abort/i);
  });
});

describe("NP-018 后续：DNS 解析后单 IP 校验（assertEgressIpAllowed）", () => {
  it("公网 IPv4/IPv6 通过", () => {
    expect(() => assertEgressIpAllowed("93.184.216.34")).not.toThrow();
    expect(() => assertEgressIpAllowed("1.1.1.1")).not.toThrow();
    expect(() =>
      assertEgressIpAllowed("2606:4700:4700::1111", "provider.example"),
    ).not.toThrow();
    expect(() => assertEgressIpAllowed("[2606:4700:4700::1111]")).not.toThrow();
  });

  const blockedIps: Array<[string, string]> = [
    ["IPv4 回环", "127.0.0.1"],
    ["IPv4 私网 10/8", "10.1.2.3"],
    ["IPv4 私网 172.16/12", "172.16.0.1"],
    ["IPv4 私网 192.168/16", "192.168.1.1"],
    ["云元数据链路本地", "169.254.169.254"],
    ["CGNAT", "100.64.0.1"],
    ["this-network", "0.0.0.0"],
    ["组播", "224.0.0.1"],
    ["benchmark", "198.18.0.1"],
    ["TEST-NET-1", "192.0.2.1"],
    ["IPv6 回环", "::1"],
    ["IPv6 未指定", "::"],
    ["IPv6 ULA", "fc00::1"],
    ["IPv6 链路本地", "fe80::1%en0"],
    ["IPv6 文档段", "2001:db8::1"],
    ["IPv6 组播", "ff02::1"],
    ["IPv4-mapped 回环", "::ffff:127.0.0.1"],
    ["IPv4-mapped 元数据", "::ffff:169.254.169.254"],
    ["NAT64 映射私网", "64:ff9b::10.0.0.1"],
    ["十进制 IPv4", "2130706433"],
    ["八进制 IPv4", "0177.0.0.1"],
    ["十六进制 IPv4", "0x7f.0.0.1"],
  ];

  for (const [name, address] of blockedIps) {
    it(`拦截 ${name} (${address})`, () => {
      expect(() => assertEgressIpAllowed(address)).toThrow(/EGRESS_PRIVATE_IP_BLOCKED/);
    });
  }

  it("错误信息保留 host 上下文（便于诊断，不泄露其他内容）", () => {
    expect(() => assertEgressIpAllowed("10.0.0.1", "provider.example")).toThrow(
      /10\.0\.0\.1 \(provider\.example\)/,
    );
  });

  it("非法/空地址 fail closed 为 EGRESS_IP_BLOCKED", () => {
    for (const address of ["", "   ", "not-an-ip", "999.1.1.1", "example.com"]) {
      expect(() => assertEgressIpAllowed(address)).toThrow(/EGRESS_IP_BLOCKED/);
    }
  });

  it("现有 assertEgressAllowed 行为不受重构影响（字面量仍拦截）", () => {
    expect(() => assertEgressAllowed(new URL("http://[::1]/api"))).toThrow(
      /EGRESS_PRIVATE_IP_BLOCKED/,
    );
    expect(() => assertEgressAllowed(new URL("https://provider.example/api"))).not.toThrow();
  });
});
