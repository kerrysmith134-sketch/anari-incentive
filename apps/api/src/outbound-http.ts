/**
 * 出站 HTTP 安全层（2026-11-21 外部审计 P0 SSRF 后续）。
 *
 * 审计发现：
 *   1. 集成页 `integration-connections/:id/test` 与 `schema-preview` 直接用
 *      全局 `fetch()`，完全绕过 `assertEgressAllowed`；
 *   2. 域名经 DNS 解析后的地址没有校验，且与连接未绑定 → DNS Rebinding；
 *   3. 重定向没有逐跳重新校验；
 *   4. schema preview 原样返回 provider 样本，可能泄露 PII/密钥。
 *
 * 本模块提供两件事：
 *   - `outboundJsonFetch`：仅使用 Node 内置模块（http/https/dns/net）的出站 GET，
 *     起始 URL 与每一跳重定向都执行 egress + DNS 校验，并把已校验地址 pin 到
 *     连接的 `lookup` 回调（连接只可能落到校验过的 IP），同时保留 SNI/证书校验。
 *   - `redactSample`：对 provider 样本做深度/长度受限的递归脱敏。
 *
 * 不新增第三方依赖。
 */

import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
} from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { assertEgressAllowed, assertEgressIpAllowed } from "@anari/connectors";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** 跨 origin 重定向时丢弃的凭据类请求头（避免泄露到第三方主机）。 */
const CROSS_ORIGIN_DROP_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
]);

// ---------------------------------------------------------------------------
// 类型与依赖注入点
// ---------------------------------------------------------------------------

export interface OutboundAddress {
  address: string;
  /** 4 或 6，与 dns.lookup 的 family 对齐。 */
  family: number;
}

/**
 * 响应体来源：Buffer/字符串或异步可迭代（`node:http` 的 IncomingMessage 即是）。
 * 核心逻辑负责在 maxBytes 内消费，超限抛 `OUTBOUND_RESPONSE_TOO_LARGE`。
 */
export type OutboundBody = Buffer | string | AsyncIterable<Buffer | string>;

export interface OutboundHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: OutboundBody;
}

/**
 * 传给注入 transport 的请求描述。`addresses` 是**已通过
 * `assertEgressIpAllowed` 校验**的完整解析结果；实现必须只连接其中之一
 * （默认实现通过 `lookup` pin 地址）。
 */
export interface OutboundRequestOptions {
  protocol: "http:" | "https:";
  /** 已去掉 IPv6 方括号的主机名。 */
  host: string;
  port: number;
  path: string;
  headers: Record<string, string>;
  /** TLS SNI 与证书校验使用的主机名（不是 IP）。 */
  servername: string;
  addresses: OutboundAddress[];
  signal: AbortSignal;
}

export type OutboundRequestFn = (
  options: OutboundRequestOptions,
) => Promise<OutboundHttpResponse>;

export interface OutboundHttpDeps {
  /** 覆盖 DNS 解析；默认 `dns.lookup(host, { all: true })`。 */
  lookup?: (host: string) => Promise<OutboundAddress[]>;
  /** 覆盖 HTTP transport；默认 node:https/http + pinned lookup。 */
  request?: OutboundRequestFn;
}

export interface OutboundJsonFetchInput {
  url: string;
  headers?: Record<string, string>;
  /** 整个请求（含全部重定向与响应体消费）的总超时；默认 10s。 */
  timeoutMs?: number;
  /** 默认 3。 */
  maxRedirects?: number;
  /** 响应体字节上限；默认 1 MiB。 */
  maxBytes?: number;
  /** 与 `assertEgressAllowed` 的 allowlist 语义一致，逐跳检查。 */
  allowlist?: string[];
  deps?: OutboundHttpDeps;
}

export interface OutboundJsonFetchResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  /** JSON.parse 失败时为 undefined（不抛错）。 */
  json: unknown;
  text: string;
  finalUrl: string;
  redirects: number;
}

// ---------------------------------------------------------------------------
// outboundJsonFetch
// ---------------------------------------------------------------------------

export async function outboundJsonFetch(
  input: OutboundJsonFetchInput,
): Promise<OutboundJsonFetchResult> {
  const timeoutMs = resolvePositiveInt(input.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  const maxRedirects = resolveNonNegativeInt(
    input.maxRedirects,
    DEFAULT_MAX_REDIRECTS,
    "maxRedirects",
  );
  const maxBytes = resolveNonNegativeInt(input.maxBytes, DEFAULT_MAX_BYTES, "maxBytes");
  const deps = input.deps ?? {};
  const lookup = deps.lookup ?? defaultLookup;
  const requestFn = deps.request ?? nodeOutboundRequest;

  let url = parseStartUrl(input.url);
  let headers = normalizeRequestHeaders(input.headers);
  let redirects = 0;

  const controller = new AbortController();
  let timedOut = false;
  let rejectDeadline: (error: Error) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  // 防止超时拒绝在没有 race 监听时变成 unhandledRejection。
  void deadline.catch(() => {});
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectDeadline(new Error(`OUTBOUND_TIMEOUT: exceeded ${timeoutMs}ms`));
  }, timeoutMs);
  const guard = <T>(work: Promise<T>): Promise<T> =>
    Promise.race([work, deadline]);

  try {
    for (;;) {
      // 起始 URL 与每一跳都要重新过 egress（协议 / 字面量私网 / allowlist / 生产 https）。
      assertEgressAllowed(url, input.allowlist);
      assertNoUrlCredentials(url);

      const host = hostnameFor(url);
      const addresses = await resolvePublicAddresses(host, lookup, guard);

      let response: OutboundHttpResponse;
      try {
        response = await guard(
          requestFn({
            protocol: url.protocol as "http:" | "https:",
            host,
            port: portFor(url),
            path: `${url.pathname}${url.search}`,
            headers,
            servername: host,
            addresses,
            signal: controller.signal,
          }),
        );
      } catch (error) {
        throw normalizeTransportError(error, "OUTBOUND_REQUEST_FAILED");
      }

      if (!response || typeof response.status !== "number") {
        throw new Error("OUTBOUND_INVALID_RESPONSE: transport returned no status");
      }
      const responseHeaders = normalizeResponseHeaders(response.headers);

      if (REDIRECT_STATUSES.has(response.status)) {
        // 不消费 3xx body；显式销毁底层流，避免默认 transport 留下半开 socket。
        discardBody(response.body);
        if (redirects >= maxRedirects) {
          throw new Error(
            `OUTBOUND_TOO_MANY_REDIRECTS: ${redirects} >= ${maxRedirects}`,
          );
        }
        const location = responseHeaders["location"];
        if (!location || location.trim() === "") {
          throw new Error(
            `OUTBOUND_REDIRECT_WITHOUT_LOCATION: status ${response.status}`,
          );
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, url);
        } catch {
          throw new Error("OUTBOUND_INVALID_REDIRECT: malformed Location header");
        }
        // 跨 origin（含协议/端口变化）不携带凭据类头；下一轮会重新校验目标。
        if (nextUrl.origin !== url.origin) {
          headers = dropCrossOriginHeaders(headers);
        }
        url = nextUrl;
        redirects += 1;
        continue;
      }

      const declaredLength = Number(responseHeaders["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        discardBody(response.body);
        throw new Error(
          `OUTBOUND_RESPONSE_TOO_LARGE: declared ${declaredLength} > ${maxBytes}`,
        );
      }

      let body: Buffer;
      try {
        body = await guard(readBody(response.body ?? Buffer.alloc(0), maxBytes));
      } catch (error) {
        throw normalizeTransportError(error, "OUTBOUND_RESPONSE_FAILED");
      }

      const text = body.toString("utf8");
      let json: unknown;
      try {
        json = text === "" ? undefined : JSON.parse(text);
      } catch {
        json = undefined;
      }

      return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        headers: responseHeaders,
        json,
        text,
        finalUrl: url.href,
        redirects,
      };
    }
  } catch (error) {
    if (timedOut) {
      throw new Error(`OUTBOUND_TIMEOUT: exceeded ${timeoutMs}ms`);
    }
    const message = errorMessage(error);
    // 保留稳定的 EGRESS_* / OUTBOUND_* 前缀；只包装未知的底层错误。
    if (/^(EGRESS_|OUTBOUND_)/.test(message)) throw error;
    throw new Error(`OUTBOUND_REQUEST_FAILED: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

function parseStartUrl(raw: unknown): URL {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("OUTBOUND_INVALID_URL: empty URL");
  }
  try {
    return new URL(raw);
  } catch {
    // 不回显原始 URL：其中可能含凭据或一次性 token。
    throw new Error("OUTBOUND_INVALID_URL: malformed URL");
  }
}

function assertNoUrlCredentials(url: URL): void {
  if (url.username !== "" || url.password !== "") {
    throw new Error(
      "OUTBOUND_URL_CREDENTIALS_BLOCKED: credentials are not allowed in outbound URLs",
    );
  }
}

function hostnameFor(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

function portFor(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

async function resolvePublicAddresses(
  host: string,
  lookup: (host: string) => Promise<OutboundAddress[]>,
  guard: <T>(work: Promise<T>) => Promise<T>,
): Promise<OutboundAddress[]> {
  let resolved: OutboundAddress[];
  try {
    resolved = await guard(lookup(host));
  } catch (error) {
    const message = errorMessage(error);
    if (/^(EGRESS_|OUTBOUND_)/.test(message)) throw error;
    throw new Error(`OUTBOUND_DNS_FAILED: ${host}: ${message}`);
  }
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(`OUTBOUND_DNS_EMPTY: ${host}`);
  }
  const addresses: OutboundAddress[] = [];
  for (const record of resolved) {
    if (
      !record ||
      typeof record.address !== "string" ||
      record.address.trim() === ""
    ) {
      throw new Error(`OUTBOUND_DNS_INVALID: ${host}`);
    }
    // 全部 A/AAAA 记录都必须合法：任意一条私网即整体拒绝。
    assertEgressIpAllowed(record.address, host);
    addresses.push({
      address: record.address,
      family: record.family === 6 ? 6 : 4,
    });
  }
  return addresses;
}

/** 丢弃未消费的响应体（Node Readable 会释放 socket；注入的异步流无副作用）。 */
function discardBody(body: OutboundBody | undefined): void {
  if (!body || typeof body === "string" || Buffer.isBuffer(body)) return;
  const destroy = (body as { destroy?: unknown }).destroy;
  if (typeof destroy === "function") {
    try {
      destroy.call(body);
    } catch {
      /* best-effort：清理失败不影响安全决策 */
    }
  }
}

function normalizeTransportError(error: unknown, prefix: string): Error {
  const message = errorMessage(error);
  if (/^(EGRESS_|OUTBOUND_)/.test(message)) {
    return error instanceof Error ? error : new Error(message);
  }
  return new Error(`${prefix}: ${message}`);
}

async function readBody(body: OutboundBody, maxBytes: number): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    if (body.byteLength > maxBytes) {
      throw new Error(
        `OUTBOUND_RESPONSE_TOO_LARGE: ${body.byteLength} > ${maxBytes}`,
      );
    }
    return body;
  }
  if (typeof body === "string") {
    const buffer = Buffer.from(body);
    if (buffer.byteLength > maxBytes) {
      throw new Error(
        `OUTBOUND_RESPONSE_TOO_LARGE: ${buffer.byteLength} > ${maxBytes}`,
      );
    }
    return buffer;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new Error(`OUTBOUND_RESPONSE_TOO_LARGE: ${total} > ${maxBytes}`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// 默认 transport：node:https/http + 已校验地址 pin
// ---------------------------------------------------------------------------

type NodeLookup = (
  hostname: string,
  options: LookupOptions | number,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => void;

async function defaultLookup(host: string): Promise<OutboundAddress[]> {
  const records = await dnsLookup(host, { all: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
}

/**
 * 构造 pin 住已校验地址的 `lookup`：
 * - 忽略 Node 传入的主机名，只返回 `addresses` 中的地址（不再走 DNS）；
 * - 返回前再次 `assertEgressIpAllowed`（纵深防御）；
 * - 尊重 family 请求；不匹配时退回全部合法地址。
 *
 * 连接建立后目标 IP 不可能被 DNS 重解析改变——这就是 DNS Rebinding 的
 * 主要缓解。注意：该保证只覆盖默认 transport；注入自定义 `request` 时由
 * 调用方负责只连接 `addresses`。
 */
function createPinnedLookup(addresses: OutboundAddress[]): NodeLookup {
  return (_hostname, rawOptions, callback) => {
    try {
      for (const entry of addresses) {
        assertEgressIpAllowed(entry.address);
      }
      if (addresses.length === 0) {
        callback(
          makeErrno("OUTBOUND_DNS_EMPTY: no pinned address"),
          "",
          0,
        );
        return;
      }
      const requestedFamily = normalizeFamily(rawOptions);
      const wantsAll =
        typeof rawOptions === "object" &&
        rawOptions !== null &&
        rawOptions.all === true;
      const eligible =
        requestedFamily === 4 || requestedFamily === 6
          ? addresses.filter((entry) => entry.family === requestedFamily)
          : addresses;
      const chosen = eligible.length > 0 ? eligible : addresses;
      if (wantsAll) {
        callback(
          null,
          chosen.map((entry) => ({
            address: entry.address,
            family: entry.family,
          })),
        );
        return;
      }
      const first = chosen[0]!;
      callback(null, first.address, first.family);
    } catch (error) {
      callback(toError(error), "", 0);
    }
  };
}

function normalizeFamily(options: LookupOptions | number): number {
  if (typeof options === "number") return options;
  const family = options.family;
  if (family === "IPv4") return 4;
  if (family === "IPv6") return 6;
  const parsed = Number(family ?? 0);
  return parsed === 4 || parsed === 6 ? parsed : 0;
}

function nodeOutboundRequest(
  options: OutboundRequestOptions,
): Promise<OutboundHttpResponse> {
  return new Promise<OutboundHttpResponse>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(toError(error));
    };

    const requestOptions: RequestOptions = {
      host: options.host,
      port: options.port,
      path: options.path,
      method: "GET",
      headers: options.headers,
      // 每次请求新建连接：不复用 agent 池里的旧 socket（避免绕过 pin）。
      agent: false,
      lookup: createPinnedLookup(options.addresses) as unknown as RequestOptions["lookup"],
    };
    if (options.protocol === "https:") {
      // 用原 host 做 SNI 与证书主机名校验，即便实际连接的是 pinned IP。
      requestOptions.servername = options.servername;
    }

    const onResponse = (res: import("node:http").IncomingMessage): void => {
      settled = true;
      resolve({
        status: res.statusCode ?? 0,
        headers: normalizeResponseHeaders(res.headers),
        body: res,
      });
    };

    let request: ClientRequest;
    try {
      request =
        options.protocol === "https:"
          ? httpsRequest(requestOptions, onResponse)
          : httpRequest(requestOptions, onResponse);
    } catch (error) {
      fail(error);
      return;
    }

    request.once("error", fail);

    const onAbort = (): void => {
      request.destroy(new Error("OUTBOUND_ABORTED: request aborted"));
    };
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
    request.end();
  });
}

// ---------------------------------------------------------------------------
// 头部处理
// ---------------------------------------------------------------------------

function normalizeRequestHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value !== "string") continue;
    const name = key.trim().toLowerCase();
    if (name === "") continue;
    normalized[name] = value;
  }
  return normalized;
}

function normalizeResponseHeaders(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value === undefined) continue;
    normalized[key.toLowerCase()] = Array.isArray(value)
      ? value.join(", ")
      : String(value);
  }
  return normalized;
}

function dropCrossOriginHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!CROSS_ORIGIN_DROP_HEADERS.has(key.toLowerCase())) {
      next[key] = value;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// 参数与错误工具
// ---------------------------------------------------------------------------

function resolvePositiveInt(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`OUTBOUND_INVALID_OPTION: ${name} must be a positive number`);
  }
  return Math.max(1, Math.floor(value));
}

function resolveNonNegativeInt(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `OUTBOUND_INVALID_OPTION: ${name} must be a non-negative number`,
    );
  }
  return Math.floor(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function makeErrno(message: string): NodeJS.ErrnoException {
  return new Error(message) as NodeJS.ErrnoException;
}

// ---------------------------------------------------------------------------
// redactSample：provider 样本脱敏
// ---------------------------------------------------------------------------

const SENSITIVE_KEY =
  /authorization|api[_-]?key|secret|token|password|credential|cookie|session|email|phone|mobile|id_card|身份证|手机|邮箱/i;

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;
const CN_MOBILE_PATTERN = /^(?:\+?86)?1[3-9]\d{9}$/;
const TOKEN_SHAPE = /^[A-Za-z0-9_+/=.-]{32,}$/;

const REDACT_MAX_DEPTH = 6;
const REDACT_MAX_ARRAY = 20;
const REDACT_MAX_EMAIL_INPUT = 320;
const REDACT_MAX_PHONE_INPUT = 32;
const REDACT_TOKEN_ENTROPY_THRESHOLD = 3.5;
const REDACT_TOKEN_NO_ENTROPY_CHECK_LENGTH = 8192;

/**
 * 递归脱敏 provider 样本，保留字段名与（非敏感字段的）结构。
 *
 * 规则：
 * - key 命中 /authorization|api_key|secret|token|password|credential|cookie|
 *   session|email|phone|mobile|id_card|身份证|手机|邮箱/i → 整体 `"[REDACTED]"`；
 * - 字符串值形如邮箱 → `"***@***"`；形如中国手机号 → `"***"`；
 *   形如 >=32 位高熵随机串 → `"[REDACTED]"`；
 * - 最大递归深度 6（超出 → `"[TRUNCATED]"`），数组最多保留 20 项；
 * - 循环引用 → `"[CIRCULAR]"`（防止栈溢出）。
 */
export function redactSample(value: unknown, depth = 0): unknown {
  const startDepth =
    typeof depth === "number" && Number.isFinite(depth) && depth > 0
      ? Math.floor(depth)
      : 0;
  return redactValue(value, startDepth, false, new WeakSet<object>());
}

function redactValue(
  value: unknown,
  depth: number,
  sensitive: boolean,
  seen: WeakSet<object>,
): unknown {
  if (sensitive) {
    // 敏感键无论值类型一律替换：密码/token 对象同样不能泄露。
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= REDACT_MAX_DEPTH) {
    return "[TRUNCATED]";
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, REDACT_MAX_ARRAY)
      .map((item) => redactValue(item, depth + 1, false, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    // 用 defineProperty 而不是赋值：JSON.parse 可产生自有 "__proto__" 键，
    // 直接赋值会改写结果对象的原型而不是保留字段。
    Object.defineProperty(result, key, {
      value: redactValue(child, depth + 1, SENSITIVE_KEY.test(key), seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function redactString(value: string): string {
  if (value === "") return value;
  if (value.length <= REDACT_MAX_EMAIL_INPUT && EMAIL_PATTERN.test(value)) {
    return "***@***";
  }
  if (value.length <= REDACT_MAX_PHONE_INPUT) {
    const compact = value.replace(/[\s-]/g, "");
    if (CN_MOBILE_PATTERN.test(compact)) return "***";
  }
  if (TOKEN_SHAPE.test(value)) {
    if (value.length > REDACT_TOKEN_NO_ENTROPY_CHECK_LENGTH) {
      return "[REDACTED]";
    }
    if (shannonEntropy(value) >= REDACT_TOKEN_ENTROPY_THRESHOLD) {
      return "[REDACTED]";
    }
  }
  return value;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}
