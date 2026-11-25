/**
 * 本地系统（ERP/CRM/Commercial/Ticketing/HR/Finance/PingCode）接入契约。
 * 每个 provider 负责：实际 endpoint、分页、记录提取、映射到 N-Perform 已有写接口。
 * 不在这里发请求；CLI/runner 负责认证、分页、重试。
 */
export interface CanonicalWrite {
  /** N-Perform API path, e.g. /api/v1/commercial/import/opportunities */
  path: string;
  /** Exact JSON body accepted by that API. */
  body: Record<string, unknown>;
  /** Stable source record id for dedupe/logging. */
  externalId: string;
}

export interface PullTarget {
  /** HTTP method, normally GET. */
  method: "GET";
  /** Path relative to the provider base URL. */
  path: string;
  /** Query params for paging, e.g. page/limit or cursor. */
  pageParam?: string;
  limitParam?: string;
  cursorParam?: string;
  /** Extra fixed query params (e.g. status=accepted). */
  query?: Record<string, string>;
  /** Default page size. */
  pageSize?: number;
  /** Extract records from a response body. */
  extract(json: unknown): unknown[];
  /** Map one provider record to one or more N-Perform writes. */
  normalize(record: unknown): CanonicalWrite | CanonicalWrite[];
}

export interface LocalProvider {
  code: string;
  sourceSystem: string;
  /** Env var for base URL, e.g. ANARI_ERP_BASE_URL. */
  baseUrlEnv: string;
  /** Env var for bearer token / API key, e.g. ANARI_ERP_TOKEN. */
  tokenEnv: string;
  targets: PullTarget[];
}
