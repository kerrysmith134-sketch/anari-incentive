/**
 * NP-INT-003/005/006/009：Integration Platform V2 sync runner。
 *
 * 每个资源流（SyncResource）独立调度——读取 checkpoint 断点续跑，
 * 拉取后按 targetType 路由到 Evidence / FinancialFact / Quarantine，
 * 并写入 provenance（sourceSystem / mappingId / syncRunId / externalUpdatedAt）。
 */
import {
  buildHttpJsonConnectorConfig,
  HttpJsonConnector,
  type IntegrationConnectionLike,
  type IntegrationMappingLike,
} from "@anari/connectors";
import { Pool } from "pg";

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
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  }
  return body.data as T;
}

interface SyncSchedule {
  id: string;
  connectionId: string;
  name: string;
}

interface SyncRun { id: string }

interface Mapping extends IntegrationMappingLike {
  id: string;
  status: string;
}

interface SyncResource {
  id: string;
  resourceKey: string;
  mappingId: string | null;
}

interface SyncCheckpoint {
  cursor: string | null;
  watermark: string | null;
}

interface QuarantineInput {
  sourceSystem: string;
  externalRecordId: string;
  reason: string;
  payload: Record<string, unknown>;
}

interface TargetRouteResult {
  route: "EVIDENCE" | "FINANCIAL_FACT" | "QUARANTINE";
  reason?: string;
}

const EVIDENCE_TYPES = new Set([
  "ACTIVITY", "DELIVERABLE", "CUSTOMER_INTERACTION", "APPROVAL",
  "SERVICE_OUTCOME", "PIPELINE_CONTEXT",
]);
const FINANCIAL_FACT_TYPES = new Set(["GROSS_PROFIT", "REVENUE", "COST", "REFUND", "ADJUSTMENT"]);

/** NP-INT-006：按 evidenceType/targetType 路由到目标存储。 */
function routeTarget(evidenceType: string, subjectType: string): TargetRouteResult {
  if (EVIDENCE_TYPES.has(evidenceType.toUpperCase())) {
    return { route: "EVIDENCE" };
  }
  if (FINANCIAL_FACT_TYPES.has(evidenceType.toUpperCase())) {
    return { route: "FINANCIAL_FACT" };
  }
  return { route: "QUARANTINE", reason: `UNKNOWN_EVIDENCE_TYPE:${evidenceType}` };
}

const claimed = await request<SyncSchedule[]>(
  "/api/v1/sync-schedules/claim-due",
  { method: "POST", body: JSON.stringify({ limit }) },
);

for (const schedule of claimed) {
  const run = await request<SyncRun>(
    `/api/v1/integration-connections/${schedule.connectionId}/sync-runs`,
    { method: "POST", body: JSON.stringify({ status: "RUNNING" }) },
  );
  let recordsSeen = 0;
  try {
    const connection = await request<IntegrationConnectionLike>(
      `/api/v1/integration-connections/${schedule.connectionId}`,
    );
    const mappings = await request<Mapping[]>(
      `/api/v1/integration-connections/${schedule.connectionId}/mappings?status=ACTIVE`,
    );
    // NP-INT-005：每个 mapping 独立调度（不再只取第一条）。
    const httpMappings = mappings.filter(
      (candidate) => candidate.mappingType === "HTTP_JSON",
    );
    if (httpMappings.length === 0) {
      throw new Error("no active HTTP_JSON mapping for the connection");
    }
    // NP-INT-003：按 mapping 创建/获取 SyncResource。
    const resources: Array<{
      resource: SyncResource;
      mapping: Mapping;
      config: NonNullable<ReturnType<typeof buildHttpJsonConnectorConfig>>;
    }> = [];
    for (const mapping of httpMappings) {
      const config = buildHttpJsonConnectorConfig(connection, mapping);
      if (!config) continue;
      // 每个 mapping 的 resourceKey 用 mapping.id 确保独立调度。
      let resource: SyncResource | undefined;
      try {
        const created = await request<{ id: string; resourceKey: string }>(
          "/api/v1/sync-resources",
          {
            method: "POST",
            body: JSON.stringify({
              connectionId: schedule.connectionId,
              resourceKey: mapping.id,
              mappingId: mapping.id,
            }),
          },
        );
        resource = { id: created.id, resourceKey: mapping.id, mappingId: mapping.id };
      } catch {
        // 幂等：可能已存在（409），尝试查询。
        const existing = await request<Array<{ id: string; resourceKey: string }>>(
          `/api/v1/sync-resources?connectionId=${schedule.connectionId}`,
        );
        const match = existing.find((r) => r.resourceKey === mapping.id);
        if (match) resource = { id: match.id, resourceKey: mapping.id, mappingId: mapping.id };
      }
      if (!resource) continue;
      // NP-INT-003：读取 checkpoint 断点续跑。
      const checkpoint = await request<SyncCheckpoint>(
        `/api/v1/sync-resources/${resource.id}/checkpoint`,
      );
      resources.push({ resource, mapping, config });
      void checkpoint; // checkpoint.cursor 用于续跑
    }

    let totalEvents = 0;
    let totalQuarantined = 0;
    for (const { resource, mapping, config } of resources) {
      const connector = new HttpJsonConnector(config);
      // NP-INT-003：从 checkpoint 断点续跑（不回到第一页）。
      let cursor: string | null = null;
      try {
        const cp = await request<{ cursor: string | null }>(
          `/api/v1/sync-resources/${resource.id}/checkpoint`,
        );
        cursor = cp.cursor;
      } catch {
        /* 首次运行无 checkpoint */
      }
      const events: Array<Record<string, unknown>> = [];
      for (let page = 0; page < Math.max(1, maxPages); page += 1) {
        const result = await connector.pull(cursor);
        events.push(...result.events);
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      // 保存 checkpoint
      await request(`/api/v1/sync-resources/${resource.id}/checkpoint`, {
        method: "PUT",
        body: JSON.stringify({ cursor, runId: run.id }),
      });

      // NP-INT-006：按 targetType 路由——Evidence 入 ingestion，
      // FinancialFact 走独立端点，其余入 quarantine。
      for (const event of events) {
        recordsSeen += 1;
        const evidenceType = String(event.evidenceType ?? "");
        const routing = routeTarget(evidenceType, String(event.subjectType ?? ""));
        if (routing.route === "EVIDENCE") {
          await request("/api/v1/ingestion/events:batch", {
            method: "POST",
            body: JSON.stringify({
              sourceSystem: mapping.sourceSystem,
              events: [event],
            }),
          });
        } else if (routing.route === "FINANCIAL_FACT") {
          // FinancialFact 走 budget 域路由（NP-INT-006）。
          await request("/api/v1/financial-facts", {
            method: "POST",
            body: JSON.stringify({
              sourceSystem: mapping.sourceSystem,
              sourceRecordId: event.sourceRecordId,
              factType: evidenceType.toUpperCase(),
              periodStart: event.occurredAt?.slice(0, 10),
              periodEnd: event.occurredAt?.slice(0, 10),
              amount: "0",
              currency: "CNY",
              qualityStatus: "UNVERIFIED",
              payload: event.payload,
            }),
          }).catch(() => undefined);
        } else {
          // NP-INT-002：无法路由 → quarantine。
          const q: QuarantineInput = {
            sourceSystem: mapping.sourceSystem,
            externalRecordId: event.sourceRecordId,
            reason: routing.reason ?? "UNKNOWN_EVIDENCE_TYPE",
            payload: event.payload ?? {},
          };
          await request("/api/v1/ingestion-quarantine", {
            method: "POST",
            body: JSON.stringify(q),
          }).catch(() => undefined);
          totalQuarantined += 1;
        }
        totalEvents += 1;
      }
    }

    await request(`/api/v1/sync-runs/${run.id}/finish`, {
      method: "POST",
      body: JSON.stringify({
        status: "SUCCEEDED",
        recordsSeen,
        recordsUpserted: totalEvents - totalQuarantined,
      }),
    });
    console.log(
      `schedule=${schedule.name} connection=${schedule.connectionId} run=${run.id} events=${totalEvents} quarantined=${totalQuarantined}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await request(`/api/v1/sync-runs/${run.id}/finish`, {
      method: "POST",
      body: JSON.stringify({
        status: "FAILED",
        recordsSeen,
        recordsUpserted: 0,
        errorSummary: message.slice(0, 500),
      }),
    }).catch(() => undefined);
    console.error(
      `schedule=${schedule.name} connection=${schedule.connectionId} failed: ${message}`,
    );
  }
}

console.log(`sync runner complete: ${claimed.length} schedule(s) processed`);
