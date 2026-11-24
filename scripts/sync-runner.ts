/**
 * Integration Platform V2 sync runner CLI（npm run sync:runner）。
 * 核心逻辑在 @anari/connectors（packages/connectors/src/sync-runner.ts），
 * 供进程内管道测试复用（NP-002：runner 全流程走真实 API）。
 */
import {
  ClientCredentialsTokenSource,
  runSyncCycle,
  SyncRequestError,
} from "@anari/connectors";

const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const tenantId =
  process.env.TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
const token = process.env.API_TOKEN ?? process.env.WORKER_TOKEN;
const limit = Number(process.env.SYNC_CLAIM_LIMIT ?? "10");
const maxPages = Number(process.env.SYNC_MAX_PAGES ?? "5");

const headers: Record<string, string> = {
  "content-type": "application/json",
  "x-tenant-id": tenantId,
};
if (token) headers.authorization = `Bearer ${token}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { headers, ...init });
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string; code?: string };
  };
  if (!response.ok) {
    // INT-210：保留状态码与结构化错误码，runner 才能区分幂等重复与业务冲突。
    throw new SyncRequestError(
      body.error?.message ?? `HTTP ${response.status}`,
      response.status,
      body.error?.code,
    );
  }
  return body.data as T;
}

// INT-214：可选 OAuth client-credentials 凭据源（所有 credentialRef 共用）。
// 生产多连接场景应换成按 credentialRef 查 Vault 的 resolver。
const oauthTokenResolver =
  process.env.OAUTH_TOKEN_URL &&
  process.env.OAUTH_CLIENT_ID &&
  process.env.OAUTH_CLIENT_SECRET
    ? () =>
        new ClientCredentialsTokenSource({
          tokenUrl: process.env.OAUTH_TOKEN_URL!,
          clientId: process.env.OAUTH_CLIENT_ID!,
          clientSecret: process.env.OAUTH_CLIENT_SECRET!,
          scope: process.env.OAUTH_SCOPE,
        })
    : undefined;

const summary = await runSyncCycle({
  request,
  limit,
  maxPages,
  oauthTokenResolver,
});
console.log(
  `sync runner complete: ${summary.schedules.length} schedule(s), ` +
    `${summary.schedules.filter((s) => s.status === "SUCCEEDED").length} succeeded`,
);
