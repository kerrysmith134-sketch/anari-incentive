import {
  buildHttpJsonConnectorConfig,
  HttpJsonConnector,
  type IntegrationConnectionLike,
  type IntegrationMappingLike,
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

interface SyncRun {
  id: string;
}

interface Mapping extends IntegrationMappingLike {
  id: string;
  status: string;
}

const claimed = await request<SyncSchedule[]>(
  "/api/v1/sync-schedules/claim-due",
  {
    method: "POST",
    body: JSON.stringify({ limit }),
  },
);

for (const schedule of claimed) {
  const run = await request<SyncRun>(
    `/api/v1/integration-connections/${schedule.connectionId}/sync-runs`,
    {
      method: "POST",
      body: JSON.stringify({ status: "RUNNING" }),
    },
  );
  let cursor: string | null = null;
  let recordsSeen = 0;
  try {
    const connection = await request<IntegrationConnectionLike>(
      `/api/v1/integration-connections/${schedule.connectionId}`,
    );
    const mappings = await request<Mapping[]>(
      `/api/v1/integration-connections/${schedule.connectionId}/mappings?status=ACTIVE`,
    );
    const mapping = mappings.find(
      (candidate) => candidate.mappingType === "HTTP_JSON",
    );
    if (!mapping) {
      throw new Error("no active HTTP_JSON mapping for the connection");
    }
    const config = buildHttpJsonConnectorConfig(connection, mapping);
    if (!config) {
      throw new Error(
        "mapping is missing a URL or a required field mapping",
      );
    }
    const connector = new HttpJsonConnector(config);
    const events = [];
    for (let page = 0; page < Math.max(1, maxPages); page += 1) {
      const result = await connector.pull(cursor);
      events.push(...result.events);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    recordsSeen = events.length;
    if (events.length > 0) {
      await request("/api/v1/ingestion/events:batch", {
        method: "POST",
        body: JSON.stringify({
          sourceSystem: mapping.sourceSystem,
          events,
        }),
      });
    }
    await request(`/api/v1/sync-runs/${run.id}/finish`, {
      method: "POST",
      body: JSON.stringify({
        status: "SUCCEEDED",
        recordsSeen,
        recordsUpserted: recordsSeen,
        ...(cursor ? { cursorAfter: { cursor } } : {}),
      }),
    });
    console.log(
      `schedule=${schedule.name} connection=${schedule.connectionId} run=${run.id} events=${events.length}`,
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
