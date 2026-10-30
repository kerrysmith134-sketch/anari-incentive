const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const tenantId =
  process.env.TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
const token = process.env.API_TOKEN ?? process.env.WORKER_TOKEN;
const limit = Number(process.env.SYNC_CLAIM_LIMIT ?? "10");

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

const claimed = await request<SyncSchedule[]>(
  "/api/v1/sync-schedules/claim-due",
  {
    method: "POST",
    body: JSON.stringify({ limit }),
  },
);

for (const schedule of claimed) {
  const run = await request<{ id: string }>(
    `/api/v1/integration-connections/${schedule.connectionId}/sync-runs`,
    {
      method: "POST",
      body: JSON.stringify({ status: "QUEUED" }),
    },
  );
  console.log(
    `claimed schedule=${schedule.name} connection=${schedule.connectionId} run=${run.id}`,
  );
}

console.log(`sync runner complete: ${claimed.length} scheduled run(s) queued`);
