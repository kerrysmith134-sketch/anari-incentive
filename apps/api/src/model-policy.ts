import type { FastifyRequest } from "fastify";
import type { PlatformStore } from "./platform-store.js";

/** 门禁只依赖这两个查询——便于窄接口路由复用。 */
export type ModelPolicyStore = Pick<
  PlatformStore,
  "getTenant" | "getActiveModelProviderPolicy"
>;
import { ConflictError } from "./store.js";
import { tenantOf } from "./http-helpers.js";

/** 租户开启 requireModelProviderPolicy 时，模型必须有生效的供应商策略。 */
export async function assertModelProviderPolicy(
  platformStore: ModelPolicyStore,
  request: FastifyRequest,
  provider: string,
  targetUrl?: string,
): Promise<void> {
  const tenant = await platformStore.getTenant(tenantOf(request));
  // External model egress is governed by default in production; a tenant
  // setting may opt into the same stricter gate in non-production.
  const required =
    process.env.NODE_ENV === "production" ||
    Boolean(
      (tenant.settings as { requireModelProviderPolicy?: unknown })
        .requireModelProviderPolicy,
    );
  if (!required) return;
  const policy = await platformStore.getActiveModelProviderPolicy(
    tenantOf(request),
    provider,
  );
  if (!policy) {
    throw new ConflictError(
      `MODEL_PROVIDER_POLICY_REQUIRED: no active policy for ${provider}`,
    );
  }
  if (!policy.zeroRetentionConfirmed || !policy.dpaRef) {
    throw new ConflictError(
      `MODEL_PROVIDER_POLICY_INCOMPLETE: zero retention and DPA are required for ${provider}`,
    );
  }
  if (policy.egressAllowlist.length === 0) {
    throw new ConflictError(
      `MODEL_PROVIDER_EGRESS_ALLOWLIST_REQUIRED: ${provider}`,
    );
  }
  if (targetUrl) {
    let targetHost: string;
    try {
      const parsedTarget = new URL(targetUrl);
      if (process.env.NODE_ENV === "production" && parsedTarget.protocol !== "https:") {
        throw new Error("HTTPS required in production");
      }
      if (parsedTarget.username || parsedTarget.password) {
        throw new Error("credentials in provider URL are forbidden");
      }
      targetHost = parsedTarget.hostname.toLowerCase();
    } catch {
      throw new ConflictError("MODEL_PROVIDER_URL_INVALID: HTTPS without embedded credentials is required in production");
    }
    const allowed = policy.egressAllowlist.some((entry) => {
      const raw = entry.trim().toLowerCase();
      const host = raw.includes("://")
        ? (() => { try { return new URL(raw).hostname.toLowerCase(); } catch { return ""; } })()
        : raw.replace(/^\*\./, "");
      if (!host) return false;
      return raw.startsWith("*.")
        ? targetHost.endsWith(`.${host}`)
        : targetHost === host;
    });
    if (!allowed) {
      throw new ConflictError(
        `MODEL_PROVIDER_EGRESS_NOT_ALLOWLISTED: ${targetHost} is not approved for ${provider}`,
      );
    }
  }
}
