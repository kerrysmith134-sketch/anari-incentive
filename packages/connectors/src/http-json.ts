import type { IngestionEvent } from "@anari/domain";
import { mapRecordToEvent, type ColumnMapping } from "./mapping.js";
import type { Connector, ConnectorPullResult } from "./types.js";
import { pinnedFetch } from "./outbound-http.js";

export interface HttpJsonConnectorConfig {
  sourceSystem: string;
  url: string;
  columns: ColumnMapping;
  headers?: Record<string, string>;
  /** NP-INT-008：允许的 URL 前缀（协议+主机）；未配置时默认拒绝私网/元数据。 */
  egressAllowlist?: string[];
  /** Dot path to the record array; defaults to the body itself or `records`. */
  recordsPath?: string;
  /** Dot path to the next cursor; defaults to `nextCursor`. */
  nextCursorPath?: string;
  cursorParam?: string;
  pageSizeParam?: string;
  pageSize?: number;
  /** HTTP method; POST is used by search-style APIs (e.g. HubSpot CRM search). */
  method?: "GET" | "POST";
  /** NP-017：单次请求超时（含响应体消费）；默认 30s。 */
  timeoutMs?: number;
  /** INT-206：增量拉取的更新时间查询参数名（GET）。 */
  updatedSinceParam?: string;
  /** INT-206：增量拉取的更新时间 body 键（POST）。 */
  updatedSinceBodyKey?: string;
  /** Static JSON body for POST requests. */
  body?: Record<string, unknown>;
  /** For POST requests: body key that carries the cursor (e.g. HubSpot `after`). */
  cursorBodyKey?: string;
  fetchImpl?: typeof fetch;
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value);
}

const BLOCKED_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
]);

/** NP-018（2026-11-21 审计 Wave 4）：IPv4 全特殊用途段拦截。 */
function isBlockedIpv4(a: number, b: number, c: number): boolean {
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // 10/8 私网
    a === 127 || // 127/8 回环
    (a === 169 && b === 254) || // 169.254/16 链路本地（含云元数据）
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 私网
    (a === 192 && b === 168) || // 192.168/16 私网
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmark
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // 组播/保留/广播
  );
}

/**
 * NP-018：解析 IPv4 的全部文字形式——点分十进制、十进制整数、
 * 八进制（0 前缀）、十六进制（0x 前缀）与混合形式。
 * 返回 null 表示不是纯数字 IPv4 主机。
 */
function parseIpv4Loose(host: string): [number, number, number, number] | null {
  if (!/^[0-9xXa-fA-F.]+$/.test(host)) return null;
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const numbers: number[] = [];
  let implicitCount = 0;
  for (const part of parts) {
    if (part === "") return null;
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
      value = parseInt(part, 16);
    } else if (/^0[0-7]+$/.test(part)) {
      value = parseInt(part, 8);
    } else if (/^\d+$/.test(part)) {
      value = parseInt(part, 10);
    } else {
      return null;
    }
    if (Number.isNaN(value) || value < 0 || value > 0xffffffff) return null;
    numbers.push(value);
  }
  if (numbers.length === 1) {
    // 32 位整数（十进制/十六进制/八进制整体形式）。
    const value = numbers[0]!;
    return [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
  }
  if (numbers.length === 4) {
    if (numbers.some((value) => value > 255)) return null;
    return numbers as [number, number, number, number];
  }
  // 部分形式（a.b.c / a.b）——最后一段承载隐含字节。
  implicitCount = 4 - numbers.length;
  const last = numbers.pop()!;
  if (last > 256 ** implicitCount - 1) return null;
  const tail: number[] = [];
  let rest = last;
  for (let index = 0; index < implicitCount; index += 1) {
    tail.unshift(rest & 0xff);
    rest >>>= 8;
  }
  const full = [...numbers, ...tail];
  if (numbers.some((value) => value > 255)) return null;
  return full as [number, number, number, number];
}

/**
 * NP-018：解析 IPv6（去括号/zone）并识别特殊用途段——
 * 回环 ::1、未指定 ::、唯一本地 fc00::/7、链路本地 fe80::/10、
 * 文档段 2001:db8::/32、NAT64 64:ff9b::/96 与 IPv4-mapped ::ffff:0:0/96。
 */
function parseIpv6Loose(host: string): { blocked: boolean; mappedIpv4?: [number, number, number, number] } | null {
  let text = host.replace(/^\[|\]$/g, "");
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(":")) return null;
  const expanded = expandIpv6(text);
  if (!expanded) return null;
  const words = expanded;
  const isZero = words.every((word) => word === 0);
  if (isZero) return { blocked: true }; // :: 未指定
  const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  if (loopback) return { blocked: true };
  // IPv4-mapped ::ffff:a.b.c.d（低 32 位）
  const mappedPrefix = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mappedPrefix) {
    const a = (words[6]! >> 8) & 0xff;
    const b = words[6]! & 0xff;
    const c = (words[7]! >> 8) & 0xff;
    const d = words[7]! & 0xff;
    return { blocked: isBlockedIpv4(a, b, c), mappedIpv4: [a, b, c, d] };
  }
  // NAT64 64:ff9b::/96
  if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) {
    const a = (words[6]! >> 8) & 0xff;
    const b = words[6]! & 0xff;
    const c = (words[7]! >> 8) & 0xff;
    const d = words[7]! & 0xff;
    return { blocked: isBlockedIpv4(a, b, c) };
  }
  const first = words[0]!;
  // fc00::/7 唯一本地
  if ((first & 0xfe00) === 0xfc00) return { blocked: true };
  // fe80::/10 链路本地
  if ((first & 0xffc0) === 0xfe80) return { blocked: true };
  // 2001:db8::/32 文档段
  if (first === 0x2001 && words[1] === 0x0db8) return { blocked: true };
  // ff00::/8 组播
  if ((first & 0xff00) === 0xff00) return { blocked: true };
  return { blocked: false };
}

function expandIpv6(text: string): number[] | null {
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    const words: number[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index]!;
      if (group.includes(".")) {
        // 内嵌 IPv4（只允许出现在末尾）。
        if (index !== groups.length - 1) return null;
        const ipv4 = parseIpv4Loose(group);
        if (!ipv4 || (group.match(/\./g) ?? []).length !== 3) return null;
        words.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      words.push(parseInt(group, 16));
    }
    return words;
  };
  const head = parseGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? "") : null;
  if (!head || (halves.length === 2 && !tail)) return null;
  const words = halves.length === 2 ? [...head, ...Array(8 - head.length - (tail?.length ?? 0)).fill(0), ...(tail ?? [])] : head;
  if (words.length !== 8) return null;
  return words as number[];
}

/** NP-INT-008 / NP-018：SSRF 防护——拒绝私网 IP（v4/v6 全形式）/元数据端点/未授权重定向。 */
export function assertEgressAllowed(
  url: URL,
  allowlist?: string[],
): void {
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`EGRESS_PROTOCOL_BLOCKED: ${url.protocol}`);
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(`EGRESS_HTTPS_REQUIRED: ${url.protocol}`);
  }
  if (BLOCKED_HOSTS.has(host)) {
    throw new Error(`EGRESS_HOST_BLOCKED: ${host}`);
  }
  // IPv4 全文字形式（含十进制/八进制/十六进制便取形式）。
  const ipv4 = parseIpv4Loose(host);
  if (ipv4) {
    if (isBlockedIpv4(ipv4[0]!, ipv4[1]!, ipv4[2]!)) {
      throw new Error(`EGRESS_PRIVATE_IP_BLOCKED: ${host}`);
    }
  } else {
    // IPv6（含 mapped/NAT64/ULA/链路本地/文档段/组播）。
    const ipv6 = parseIpv6Loose(host);
    if (ipv6 && ipv6.blocked) {
      throw new Error(`EGRESS_PRIVATE_IP_BLOCKED: ${host}`);
    }
  }
  // .internal / .local 后缀
  if (host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error(`EGRESS_INTERNAL_HOST_BLOCKED: ${host}`);
  }
  // allowlist：配置时必须匹配至少一个前缀
  if (allowlist && allowlist.length > 0) {
    const matched = allowlist.some((prefix) => {
      try {
        const parsed = new URL(prefix.includes("://") ? prefix : `https://${prefix}`);
        return host === parsed.hostname || host.endsWith(`.${parsed.hostname}`);
      } catch {
        return false;
      }
    });
    if (!matched) {
      throw new Error(`EGRESS_HOST_NOT_ALLOWLISTED: ${host}`);
    }
  }
}

/**
 * NP-018 后续（2026-11-21 审计 P0 SSRF / DNS Rebinding）：
 * 对**已解析**的单个 IPv4/IPv6 地址应用与 `assertEgressAllowed` 相同的规则。
 *
 * `assertEgressAllowed` 只能检查 URL 字面量；域名在 DNS 解析后可能指向私网。
 * 出站 HTTP 层必须在建立连接前对每条 A/AAAA 记录调用本函数，并把校验过的
 * 地址 pin 给 `lookup`，否则解析与连接之间存在 rebinding 窗口。
 *
 * - 私网/回环/链路本地/CGNAT/元数据/组播/保留/文档段 → `EGRESS_PRIVATE_IP_BLOCKED`
 * - 无法解析为 IP（非法输入）→ `EGRESS_IP_BLOCKED`（fail closed）
 *
 * 复用 `parseIpv4Loose` / `parseIpv6Loose` / `isBlockedIpv4`，避免第二套规则漂移。
 */
export function assertEgressIpAllowed(address: string, host?: string): void {
  const label = host ? `${address} (${host})` : address;
  const text = typeof address === "string" ? address.trim() : "";
  if (!text) {
    throw new Error(`EGRESS_IP_BLOCKED: empty address${host ? ` for ${host}` : ""}`);
  }
  const normalized = text.replace(/^\[|\]$/g, "");
  const ipv4 = parseIpv4Loose(normalized);
  if (ipv4) {
    if (isBlockedIpv4(ipv4[0]!, ipv4[1]!, ipv4[2]!)) {
      throw new Error(`EGRESS_PRIVATE_IP_BLOCKED: ${label}`);
    }
    return;
  }
  const ipv6 = parseIpv6Loose(normalized);
  if (!ipv6) {
    throw new Error(`EGRESS_IP_BLOCKED: not an IP address: ${label}`);
  }
  if (ipv6.blocked) {
    throw new Error(`EGRESS_PRIVATE_IP_BLOCKED: ${label}`);
  }
}

/**
 * Generic REST/JSON adapter for CRM, ERP and ticketing systems.
 *
 * The endpoint contract is intentionally simple: return an array (or an
 * object containing one at `recordsPath`), and optionally a cursor. Mapping
 * into the ingestion envelope is identical to the CSV connector.
 */
export class HttpJsonConnector implements Connector {
  readonly name: string;

  constructor(private readonly config: HttpJsonConnectorConfig) {
    this.name = `http-json:${config.sourceSystem}`;
  }

  async pull(
    cursor: string | null,
    updatedSince?: string,
  ): Promise<ConnectorPullResult> {
    const fetchImpl = this.config.fetchImpl ?? (pinnedFetch as typeof fetch);
    const url = new URL(this.config.url);
    assertEgressAllowed(url, this.config.egressAllowlist);
    if (cursor && this.config.cursorParam) {
      url.searchParams.set(this.config.cursorParam, cursor);
    }
    if (this.config.pageSizeParam) {
      url.searchParams.set(
        this.config.pageSizeParam,
        String(this.config.pageSize ?? 100),
      );
    }
    // INT-206：增量 watermark——供应商按更新时间过滤，避免全量重扫。
    if (updatedSince && this.config.updatedSinceParam) {
      url.searchParams.set(this.config.updatedSinceParam, updatedSince);
    }

    const method = this.config.method ?? "GET";
    let requestInit: RequestInit = {
      method,
      headers: { accept: "application/json", ...this.config.headers },
    };
    if (method === "POST") {
      const body: Record<string, unknown> = {
        ...(this.config.body ?? {}),
        limit: this.config.pageSize ?? 100,
      };
      if (cursor && this.config.cursorBodyKey) {
        body[this.config.cursorBodyKey] = cursor;
      }
      if (updatedSince && this.config.updatedSinceBodyKey) {
        body[this.config.updatedSinceBodyKey] = updatedSince;
      }
      requestInit = {
        ...requestInit,
        headers: {
          ...requestInit.headers,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      };
    }
    // NP-INT-008：重定向后必须重新校验目标（防止 allowlist 绕过）。
    requestInit.redirect = "manual";

    // NP-017（2026-11-21 审计 Wave 4）：429/5xx/网络错误指数退避重试
    // （尊重 Retry-After + 抖动）；超时覆盖整个请求含响应体消费。
    const maxRetries = 3;
    const timeoutMs = this.config.timeoutMs ?? 30_000;
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          ...requestInit,
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          throw new Error(
            `EGRESS_REDIRECT_BLOCKED: ${this.config.sourceSystem} redirected to ${response.headers.get("location") ?? "?"}`,
          );
        }
        // 响应体在超时窗口内消费（慢 body 也会被打断）。
        const payload = (await response.json().catch(() => ({}))) as unknown;
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable || attempt >= maxRetries) {
            throw new Error(
              `HTTP connector ${this.config.sourceSystem} failed: ${response.status}`,
            );
          }
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          const backoff = Math.max(retryAfter * 1000, 25 * 2 ** attempt);
          await new Promise((resolve) =>
            setTimeout(resolve, backoff + Math.floor(Math.random() * 25)),
          );
          attempt += 1;
          continue;
        }
        const records = this.config.recordsPath
          ? getPath(payload, this.config.recordsPath)
          : Array.isArray(payload)
            ? payload
            : getPath(payload, "records");
        if (!Array.isArray(records)) {
          throw new Error(
            `HTTP connector ${this.config.sourceSystem}: records not found`,
          );
        }
        const events: IngestionEvent[] = records.map((record) => {
          if (!record || typeof record !== "object") {
            throw new Error(
              `HTTP connector ${this.config.sourceSystem}: record is not an object`,
            );
          }
          return mapRecordToEvent(record as Record<string, unknown>, this.config.columns);
        });
        const nextCursor = this.config.nextCursorPath
          ? getPath(payload, this.config.nextCursorPath)
          : getPath(payload, "nextCursor");
        return {
          events,
          nextCursor:
            nextCursor === undefined || nextCursor === null
              ? null
              : String(nextCursor),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isAbort =
          error instanceof Error &&
          (error.name === "AbortError" || /TIMEOUT|abort/i.test(message));
        if (isAbort) {
          throw new Error(
            `HTTP connector ${this.config.sourceSystem} TIMEOUT after ${timeoutMs}ms (body consumption included)`,
          );
        }
        // 网络层错误（fetch reject）按可重试处理；EGRESS_/HTTP 4xx 不重试。
        const retryableNetwork =
          attempt < maxRetries &&
          error instanceof Error &&
          !/EGRESS_|HTTP connector|TIMEOUT/.test(message);
        if (retryableNetwork) {
          const backoff = 25 * 2 ** attempt;
          await new Promise((resolve) =>
            setTimeout(resolve, backoff + Math.floor(Math.random() * 25)),
          );
          attempt += 1;
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}
