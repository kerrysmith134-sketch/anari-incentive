import type { ModelTokenUsage } from "./model-provider.js";

/**
 * AUD-019：模型调用的 token/成本计量（按 租户|provider|model 累计）。
 *
 * 进程内聚合，用于运行面板与成本审计；调用方（API 路由）在每次成功
 * summarise 后调用 recordModelUsage。快照只读，供 /ready、报表与
 * 运维导出使用。
 */
export interface ModelUsageEntry {
  tenantId: string;
  provider: string;
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  lastUsedAt: string;
}

const usageByKey = new Map<string, ModelUsageEntry>();

function key(tenantId: string, provider: string, model: string): string {
  return `${tenantId}|${provider}|${model}`;
}

export function recordModelUsage(
  tenantId: string,
  provider: string,
  model: string,
  usage: ModelTokenUsage,
): void {
  const entry = usageByKey.get(key(tenantId, provider, model)) ?? {
    tenantId,
    provider,
    model,
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    lastUsedAt: "",
  };
  entry.requests += 1;
  entry.promptTokens += usage.promptTokens;
  entry.completionTokens += usage.completionTokens;
  entry.lastUsedAt = new Date().toISOString();
  usageByKey.set(key(tenantId, provider, model), entry);
}

/** 只读快照（按最近使用排序）。 */
export function getModelUsageSnapshot(): ModelUsageEntry[] {
  return [...usageByKey.values()].sort((a, b) =>
    b.lastUsedAt.localeCompare(a.lastUsedAt),
  );
}

/** 供测试/运维复位。 */
export function resetModelUsage(): void {
  usageByKey.clear();
}
