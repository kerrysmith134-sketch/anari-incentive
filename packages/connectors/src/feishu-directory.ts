import { FeishuTenantTokenSource } from "./feishu.js";

/**
 * Feishu/Lark directory (contact) reader for org-structure sync.
 *
 * Hardening carried over from real deployments (see the feishu-integration
 * skill): pagination caps with explicit errors, `code != 0` on HTTP 200 is a
 * failure, user listing requires `open_department_id` (`od-…`), and one
 * person may appear in several departments so results are de-duplicated by
 * `open_id`.
 */

export class FeishuDirectoryError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "FeishuDirectoryError";
  }
}

function describeCode(code: number | undefined, msg: string): string {
  if (code === 99991672) return `missing contact scope/permission (${code}): ${msg}`;
  if (code === 99991668) return `app is not available to these members (${code}): ${msg}`;
  if (code === 230002) return `invalid open_id (${code}): ${msg}`;
  return `feishu error ${code ?? "unknown"}: ${msg}`;
}

export interface FeishuDepartment {
  openDepartmentId: string;
  name: string;
  /** Empty string for the invisible root. */
  parentDepartmentId: string;
  leaderUserId?: string;
}

export interface FeishuDirectoryUser {
  openId: string;
  unionId?: string;
  name: string;
  email?: string;
  employeeNo?: string;
  jobTitle?: string;
  departmentIds: string[];
  leaderUserId?: string;
}

export interface FeishuDirectoryConfig {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Safety cap on pagination per endpoint; errors loudly when exceeded. */
  maxPages?: number;
}

interface FeishuEnvelope {
  code?: number;
  msg?: string;
  data?: unknown;
}

export class FeishuDirectoryClient {
  private readonly tokenSource: FeishuTenantTokenSource;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxPages: number;

  constructor(config: FeishuDirectoryConfig) {
    this.tokenSource = new FeishuTenantTokenSource({
      appId: config.appId,
      appSecret: config.appSecret,
      baseUrl: config.baseUrl,
      fetchImpl: config.fetchImpl,
      now: config.now,
    });
    this.baseUrl = config.baseUrl ?? "https://open.feishu.cn";
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxPages = config.maxPages ?? 50;
  }

  private async call<T>(path: string, params: Record<string, string>): Promise<T> {
    const token = await this.tokenSource.getToken();
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const response = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = (await response.json().catch(() => ({}))) as FeishuEnvelope;
    if (!response.ok || payload.code !== 0) {
      throw new FeishuDirectoryError(
        describeCode(payload.code, payload.msg ?? `HTTP ${response.status}`),
        payload.code,
      );
    }
    return payload.data as T;
  }

  /** Flat department list (`parent_department_id` links the tree). */
  async departments(): Promise<FeishuDepartment[]> {
    const departments: FeishuDepartment[] = [];
    let pageToken = "";
    for (let page = 0; page < this.maxPages; page += 1) {
      const params: Record<string, string> = { page_size: "50", fetch_child: "true" };
      if (pageToken) params.page_token = pageToken;
      const data = await this.call<{
        items?: Array<{
          open_department_id?: string;
          name?: string;
          parent_department_id?: string;
          leader_user_id?: string;
        }>;
        page_token?: string;
        has_more?: boolean;
      }>("/open-apis/contact/v3/departments/find_by_page", params);
      for (const item of data.items ?? []) {
        if (!item.open_department_id) continue;
        departments.push({
          openDepartmentId: item.open_department_id,
          name: item.name ?? item.open_department_id,
          parentDepartmentId: item.parent_department_id ?? "",
          leaderUserId: item.leader_user_id || undefined,
        });
      }
      if (!data.has_more || !data.page_token) return departments;
      pageToken = data.page_token;
    }
    throw new FeishuDirectoryError(
      `department pagination exceeded ${this.maxPages} pages; refusing to continue`,
    );
  }

  /**
   * Users across the given departments, de-duplicated by open_id (one person
   * may belong to several departments).
   */
  async users(departmentIds: string[]): Promise<FeishuDirectoryUser[]> {
    const byOpenId = new Map<string, FeishuDirectoryUser>();
    let pagesUsed = 0;
    for (const departmentId of departmentIds) {
      let pageToken = "";
      for (let page = 0; page < this.maxPages; page += 1) {
        pagesUsed += 1;
        if (pagesUsed > this.maxPages * 4) {
          throw new FeishuDirectoryError(
            `user pagination exceeded the safety cap (${this.maxPages * 4} pages); refusing to continue`,
          );
        }
        const params: Record<string, string> = {
          page_size: "50",
          department_id: departmentId,
        };
        if (pageToken) params.page_token = pageToken;
        const data = await this.call<{
          items?: Array<{
            open_id?: string;
            union_id?: string;
            name?: string;
            email?: string;
            employee_no?: string;
            job_title?: string;
            department_ids?: string[];
            leader_user_id?: string;
          }>;
          page_token?: string;
          has_more?: boolean;
        }>("/open-apis/contact/v3/users/find_by_page", params);
        for (const item of data.items ?? []) {
          if (!item.open_id) continue;
          const existing = byOpenId.get(item.open_id);
          if (existing) {
            for (const id of item.department_ids ?? []) {
              if (!existing.departmentIds.includes(id)) {
                existing.departmentIds.push(id);
              }
            }
            continue;
          }
          byOpenId.set(item.open_id, {
            openId: item.open_id,
            unionId: item.union_id,
            name: item.name ?? item.open_id,
            email: item.email || undefined,
            employeeNo: item.employee_no || undefined,
            jobTitle: item.job_title || undefined,
            departmentIds: item.department_ids ?? [],
            leaderUserId: item.leader_user_id || undefined,
          });
        }
        if (!data.has_more || !data.page_token) break;
        pageToken = data.page_token;
      }
    }
    return [...byOpenId.values()];
  }
}
