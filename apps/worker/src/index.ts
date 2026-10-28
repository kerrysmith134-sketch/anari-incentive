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

if (!databaseUrl) {
  console.error("DATABASE_URL is required for the agent worker (outbox).");
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

while (running) {
  try {
    const scheduled = await scheduler.tick();
    const events = await poller.pollOnce();
    const retried = await runtime.retryFailed({
      maxAttempts: 3,
      minAgeMs: 60_000,
    });
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

await pool.end();
console.log("agent worker stopped");
