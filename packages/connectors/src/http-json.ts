import type { IngestionEvent } from "@anari/domain";
import { mapRecordToEvent, type ColumnMapping } from "./mapping.js";
import type { Connector, ConnectorPullResult } from "./types.js";

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
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
]);

/** NP-INT-008：SSRF 防护——拒绝私网 IP/元数据端点/未授权重定向。 */
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
  // 私网/回环 IPv4
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a = 0, b = 0] = ipv4.slice(1).map((v) => Number(v));
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a === 0) {
      throw new Error(`EGRESS_PRIVATE_IP_BLOCKED: ${host}`);
    }
  }
  // .internal 后缀
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

  async pull(cursor: string | null): Promise<ConnectorPullResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetchImpl(url, { ...requestInit, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        `EGRESS_REDIRECT_BLOCKED: ${this.config.sourceSystem} redirected to ${response.headers.get("location") ?? "?"}`,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      throw new Error(
        `HTTP connector ${this.config.sourceSystem} failed: ${response.status}`,
      );
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
  }
}
