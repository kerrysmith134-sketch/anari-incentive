import { createServer } from "node:http";
import { Pool } from "pg";
import {
  AgentRuntime,
  AgentScheduler,
  OutboxPoller,
  createDefaultSkills,
  createDefaultTools,
} from "@anari/agent-runtime";
import { PgAgentTaskRepository } from "@anari/agent-persistence";
import {
  ClientCredentialsTokenProvider,
  StaticTokenProvider,
  type TokenProvider,
} from "@anari/auth";
import { HttpAgentContext } from "./http-context.js";
import { PgOutboxSource } from "./pg-outbox.js";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const tenantId =
  process.env.TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
const databaseUrl = process.env.DATABASE_URL;
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const scanIntervalMs = Number(process.env.SCAN_INTERVAL_MS ?? 15 * 60 * 1000);
// 组织架构定时同步（feishu-integration skill）：默认关闭，显式开启。
const feishuSyncEnabled = process.env.FEISHU_SYNC_SCHEDULED === "1";
const feishuSyncIntervalMs = Number(
  process.env.FEISHU_SYNC_INTERVAL_MS ?? 7 * 24 * 60 * 60 * 1000,
);

if (!databaseUrl) {
  console.error("DATABASE_URL is required for the agent worker (outbox).");
  process.exit(1);
}

if (
  process.env.NODE_ENV === "production" &&
  !(
    process.env.WORKER_TOKEN ||
    (process.env.OIDC_TOKEN_URL &&
      process.env.OIDC_CLIENT_ID &&
      process.env.OIDC_CLIENT_SECRET)
  )
) {
  console.error(
    "The worker needs WORKER_TOKEN or OIDC_TOKEN_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET in production; " +
      "an unauthenticated worker cannot call an OIDC-protected API.",
  );
  process.exit(1);
}

function createTokenProvider(): TokenProvider | undefined {
  if (
    process.env.OIDC_TOKEN_URL &&
    process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_CLIENT_SECRET
  ) {
    return new ClientCredentialsTokenProvider({
      tokenUrl: process.env.OIDC_TOKEN_URL,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      scope: process.env.OIDC_SCOPE,
      audience: process.env.OIDC_AUDIENCE,
    });
  }
  if (process.env.WORKER_TOKEN) {
    return new StaticTokenProvider(process.env.WORKER_TOKEN);
  }
  return undefined;
}

const pool = new Pool({ connectionString: databaseUrl });
const tokenProvider = createTokenProvider();
const context = new HttpAgentContext(apiBaseUrl, tenantId, tokenProvider);
const runtime = new AgentRuntime(
  context,
  createDefaultTools(),
  createDefaultSkills(),
  {
    requireApprovalAtOrAbove: "T3",
    actor: "agent-worker",
    repository: new PgAgentTaskRepository(pool, tenantId),
  },
);
const scheduler = new AgentScheduler(runtime, tenantId, "worker");

scheduler.addSchedule({
  id: "evidence-gap",
  agentType: "EVIDENCE_GAP",
  intervalMs: scanIntervalMs,
});
scheduler.addSchedule({
  id: "contribution-anomaly",
  agentType: "CONTRIBUTION_ANOMALY",
  intervalMs: 60 * 60 * 1000,
});
scheduler.addSchedule({
  id: "data-quality",
  agentType: "DATA_QUALITY",
  intervalMs: 30 * 60 * 1000,
});
scheduler.addSchedule({
  id: "appeal-sla",
  agentType: "APPEAL_SLA",
  intervalMs: 60 * 60 * 1000,
  input: { slaDays: 3 },
});
// AI-04 草稿生成 workflow（PRD §7.4 三个 bounded workflow 之一）：
// 周期到期前自动预审，生成证据 bound 的 AGENT 草稿供人工复核。
scheduler.addSchedule({
  id: "evaluation-draft",
  agentType: "EVALUATION_DRAFT",
  intervalMs: 6 * 60 * 60 * 1000,
});

scheduler.addEventRule({
  id: "claim-submitted",
  eventType: "ContributionClaimSubmitted",
  agentType: "CONTRIBUTION_ANOMALY",
});
scheduler.addEventRule({
  id: "calculation-succeeded",
  eventType: "CalculationRunSucceeded",
  agentType: "SETTLEMENT_READINESS",
});
scheduler.addEventRule({
  id: "appeal-opened",
  eventType: "AppealOpened",
  agentType: "APPEAL_SLA",
});

const poller = new OutboxPoller(
  new PgOutboxSource(pool, tenantId),
  scheduler,
);

const healthPort = Number(process.env.WORKER_PORT ?? 3100);
const health = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/health") {
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.url === "/ready") {
    try {
      await pool.query("SELECT 1");
      response.end(JSON.stringify({ status: "ready" }));
    } catch {
      response.statusCode = 503;
      response.end(JSON.stringify({ status: "not_ready" }));
    }
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not_found" }));
});
health.listen(healthPort, "0.0.0.0");

let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});

console.log(
  `agent worker started: api=${apiBaseUrl} tenant=${tenantId} scan=${scanIntervalMs}ms auth=${
    tokenProvider ? "bearer" : "dev-headers"
  }`,
);

/** 周期推进：COLLECTING 且 endsAt 已过 → 自动进入 AI_PRE_REVIEW。 */
async function advanceDueCycles(): Promise<number> {
  const headers: Record<string, string> = tokenProvider
    ? { authorization: `Bearer ${await tokenProvider.getToken()}` }
    : { "x-tenant-id": tenantId, "x-user-id": "worker" };
  const listResponse = await fetch(`${apiBaseUrl}/api/v1/evaluation-cycles`, {
    headers,
  });
  if (!listResponse.ok) return 0;
  const { data } = (await listResponse.json()) as { data?: Array<{ id: string; status: string; endsAt: string }> };
  let advanced = 0;
  for (const cycle of data ?? []) {
    if (cycle.status !== "COLLECTING") continue;
    if (Date.parse(cycle.endsAt) > Date.now()) continue;
    const advanceResponse = await fetch(
      `${apiBaseUrl}/api/v1/evaluation-cycles/${cycle.id}/advance`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          status: "AI_PRE_REVIEW",
          reason: "周期已到期，自动进入 AI 预审",
        }),
      },
    );
    if (advanceResponse.ok) advanced += 1;
  }
  return advanced;
}

let lastCycleAdvanceMs = 0;
const CYCLE_ADVANCE_INTERVAL_MS = 30 * 60 * 1000;

let lastFeishuSyncMs = 0;
async function runFeishuDirectorySync(): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
  };
  const token = await tokenProvider?.getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(
    `${apiBaseUrl}/api/v1/platform/feishu/sync-directory`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ dryRun: false, allowCreate: true }),
    },
  );
  if (!response.ok) {
    throw new Error(`feishu sync failed: HTTP ${response.status}`);
  }
  console.log("agent worker: feishu directory sync completed");
}

while (running) {
  try {
    const scheduled = await scheduler.tick();
    const events = await poller.pollOnce();
    const retried = await runtime.retryFailed({
      maxAttempts: 3,
      minAgeMs: 60_000,
    });
    if (Date.now() - lastCycleAdvanceMs >= CYCLE_ADVANCE_INTERVAL_MS) {
      lastCycleAdvanceMs = Date.now();
      const advanced = await advanceDueCycles();
      if (advanced > 0) console.log(`agent worker: cycles advanced=${advanced}`);
    }
    if (
      feishuSyncEnabled &&
      Date.now() - lastFeishuSyncMs >= feishuSyncIntervalMs
    ) {
      lastFeishuSyncMs = Date.now();
      try {
        await runFeishuDirectorySync();
      } catch (syncError) {
        console.error("agent worker: feishu sync failed", syncError);
      }
    }
    if (scheduled.length + events.length + retried.length > 0) {
      console.log(
        `agent worker: scheduled=${scheduled.length} events=${events.length} retried=${retried.length}`,
      );
    }
  } catch (error) {
    console.error("agent worker iteration failed", error);
  }
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
}

health.close();
await pool.end();
console.log("agent worker stopped");
