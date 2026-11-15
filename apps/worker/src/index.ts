import { createServer } from "node:http";
import { Pool } from "pg";
import {
  AgentRuntime,
  AgentScheduler,
  OutboxPoller,
  ContributionExceptionWorkflow,
  CycleReadinessWorkflow,
  EvidenceCompletenessWorkflow,
  createDefaultSkills,
  createDefaultTools,
} from "@anari/agent-runtime";
import {
  MultiTenantAgentDispatcher,
  PgAgentTaskRepository,
} from "@anari/agent-persistence";
import {
  ClientCredentialsTokenProvider,
  StaticTokenProvider,
  type TokenProvider,
} from "@anari/auth";
import { HttpAgentContext } from "./http-context.js";
import { PgOutboxSource } from "@anari/agent-persistence";

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
/** 所有租户共享的调度规则（多租户模式按租户各建一个 scheduler 实例）。 */
function configureScheduler(scheduler: AgentScheduler): AgentScheduler {
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
  return scheduler;
}

const scheduler = configureScheduler(
  new AgentScheduler(runtime, tenantId, "worker"),
);

// NPV2-022：多租户模式——一个 Worker Pool 按 tenant 公平消费任务，
// 任务执行绑定各自租户上下文（runtime/repository 惰性创建）。
// AUD-013/AUD-024：保存 dispatcher 引用，SIGTERM 时 drain（不留在块作用域）。
let dispatcher: MultiTenantAgentDispatcher | undefined;
if (process.env.WORKER_MULTI_TENANT === "1") {
  dispatcher = new MultiTenantAgentDispatcher({
    pool,
    workerId: `worker-${process.pid}`,
    leaseMs: Number(process.env.LEASE_MS ?? 300_000),
    perTenantBatch: Number(process.env.PER_TENANT_BATCH ?? 1),
    runtimeFactory: (tenant) =>
      new AgentRuntime(
        new HttpAgentContext(apiBaseUrl, tenant, tokenProvider),
        createDefaultTools(),
        createDefaultSkills(),
        {
          requireApprovalAtOrAbove: "T3",
          actor: "agent-worker",
          repository: new PgAgentTaskRepository(pool, tenant),
        },
      ),
  });
  dispatcher.start(pollIntervalMs);
  console.log(
    `[worker] multi-tenant dispatcher started (poll=${pollIntervalMs}ms, batch=${process.env.PER_TENANT_BATCH ?? 1}/tenant)`,
  );
}

// AUD-013/P0：多租户模式下调度只入队（autoRun=false），由 Dispatcher 统一
// claim 执行——避免「scheduler 直接 run」与「dispatcher claim」双执行。
const multiTenantSchedulers = new Map<string, AgentScheduler>();
function schedulerForTenant(tenant: string): AgentScheduler {
  if (!dispatcher) return scheduler;
  const existing = multiTenantSchedulers.get(tenant);
  if (existing) return existing;
  const built = configureScheduler(
    new AgentScheduler(
      dispatcher.runtimeFor(tenant),
      tenant,
      `worker:${tenant.slice(0, 8)}`,
      { autoRun: false },
    ),
  );
  multiTenantSchedulers.set(tenant, built);
  return built;
}

const poller = new OutboxPoller(
  new PgOutboxSource(pool, tenantId),
  scheduler,
  50,
  // 多租户：按事件租户分发；单租户：仅消费本租户（claim 已按租户过滤）。
  dispatcher ? { schedulerFor: schedulerForTenant } : {},
);

// AUD-024：Worker 心跳——/ready 不只 SELECT 1，还要求主循环活着。
// 暂停/卡死的 loop（超过 3 个 poll 周期无成功 tick）→ 503；SIGTERM 后 → 503。
const workerStartedAt = Date.now();
const heartbeat = {
  lastTickStartedAt: 0,
  lastTickOkAt: 0,
  draining: false,
  /** AUD-009：三个 bounded workflow 最近一轮执行情况（按租户聚合）。 */
  boundedWorkflows: {} as Record<
    string,
    { status: string; ranAt: string; durationMs: number; detail?: string }
  >,
};

const healthPort = Number(process.env.WORKER_PORT ?? 3100);
const health = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/health") {
    response.end(
      JSON.stringify({
        status: "ok",
        uptimeMs: Date.now() - workerStartedAt,
        lastTickOkAt: heartbeat.lastTickOkAt || null,
        boundedWorkflows: heartbeat.boundedWorkflows,
      }),
    );
    return;
  }
  if (request.url === "/ready") {
    // 启动宽限：lastTickStartedAt 仍为 0（首 tick 未发生）时不判停滞。
    const stale =
      heartbeat.lastTickStartedAt > 0 &&
      Date.now() - heartbeat.lastTickOkAt > 3 * pollIntervalMs;
    try {
      await pool.query("SELECT 1");
      if (heartbeat.draining || stale) {
        response.statusCode = 503;
        response.end(
          JSON.stringify({
            status: "not_ready",
            reason: heartbeat.draining ? "draining" : "worker_loop_stalled",
            lastTickOkAt: heartbeat.lastTickOkAt || null,
          }),
        );
        return;
      }
      response.end(JSON.stringify({ status: "ready", lastTickOkAt: heartbeat.lastTickOkAt || null }));
    } catch {
      response.statusCode = 503;
      response.end(JSON.stringify({ status: "not_ready", reason: "database_unreachable" }));
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

// AUD-009：三个 bounded workflow（NPV2-024..026）接入生产 Worker——
// 默认单租户跑默认租户；多租户模式遍历全部租户（复用 dispatcher 的租户枚举）。
const BOUNDED_WORKFLOW_INTERVAL_MS = Number(
  process.env.BOUNDED_WORKFLOW_INTERVAL_MS ?? 60 * 60 * 1000,
);
let lastBoundedWorkflowsMs = 0;

async function runBoundedWorkflowsForTenant(tenant: string): Promise<void> {
  const agentContext =
    tenant === tenantId ? context : new HttpAgentContext(apiBaseUrl, tenant, tokenProvider);
  const startedAt = Date.now();
  const outcomes: string[] = [];
  // 1) 证据补齐（缺口待办 + 催补证 + 逾期提醒）。
  try {
    const result = await new EvidenceCompletenessWorkflow(agentContext).runOnce();
    outcomes.push(`evidence:${result.todosCreated}+${result.escalations}`);
  } catch (error) {
    outcomes.push(`evidence:FAILED`);
    console.error(`[bounded] evidence-completeness failed (${tenant})`, error);
  }
  // 2) 贡献异常（逾期裁决经理升级 + 冲突升级 + 待办对账）。
  try {
    const result = await new ContributionExceptionWorkflow(agentContext).runOnce();
    outcomes.push(`exception:${result.adjudicationTodosCreated}+${result.conflictsEscalated}`);
  } catch (error) {
    outcomes.push(`exception:FAILED`);
    console.error(`[bounded] contribution-exception failed (${tenant})`, error);
  }
  // 3) 周期准备度（只读报告；对最旧未结算周期出报告）。
  try {
    const cycles = await agentContext.listEvaluationCycles();
    const target = cycles.find((cycle) => cycle.status !== "SETTLED") ?? cycles[cycles.length - 1];
    if (target) {
      const report = await new CycleReadinessWorkflow(agentContext).run({ cycleId: target.id });
      outcomes.push(`readiness:${report.ready ? "READY" : "NOT_READY"}`);
    }
  } catch (error) {
    outcomes.push(`readiness:FAILED`);
    console.error(`[bounded] cycle-readiness failed (${tenant})`, error);
  }
  heartbeat.boundedWorkflows[tenant] = {
    status: outcomes.some((entry) => entry.endsWith("FAILED")) ? "PARTIAL" : "OK",
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    detail: outcomes.join(","),
  };
}

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
  heartbeat.lastTickStartedAt = Date.now();
  try {
    if (Date.now() - lastBoundedWorkflowsMs >= BOUNDED_WORKFLOW_INTERVAL_MS) {
      lastBoundedWorkflowsMs = Date.now();
      const tenants = dispatcher ? await dispatcher.listTenantIds() : [tenantId];
      for (const tenant of tenants) {
        await runBoundedWorkflowsForTenant(tenant);
        // 长任务阶段推进心跳：单个租户的 workflow 可能远超 poll 周期。
        heartbeat.lastTickOkAt = Date.now();
      }
    }
    let scheduled: Awaited<ReturnType<AgentScheduler["tick"]>> = [];
    let retried: Awaited<ReturnType<AgentRuntime["retryFailed"]>> = [];
    if (dispatcher) {
      // 多租户：每个租户独立调度/重试，只入队；执行权归 Dispatcher。
      const tenants = await dispatcher.listTenantIds();
      for (const tenant of tenants) {
        scheduled = scheduled.concat(await schedulerForTenant(tenant).tick());
        retried = retried.concat(
          await dispatcher.runtimeFor(tenant).retryFailed({
            maxAttempts: 3,
            minAgeMs: 60_000,
            execute: false,
          }),
        );
      }
    } else {
      scheduled = await scheduler.tick();
      retried = await runtime.retryFailed({
        maxAttempts: 3,
        minAgeMs: 60_000,
      });
    }
    heartbeat.lastTickOkAt = Date.now();
    const events = await poller.pollOnce({
      workerId: `outbox-${process.pid}`,
      leaseMs: 60_000,
      // 单租户消费必须限定本租户，禁止跨租户取事件。
      tenantId: dispatcher ? undefined : tenantId,
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
    heartbeat.lastTickOkAt = Date.now();
  } catch (error) {
    console.error("agent worker iteration failed", error);
  }
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
}

// AUD-013/AUD-024 graceful drain：先停 dispatcher（等在途轮次），
// 再关健康端口与连接池——不在已关闭 pool 上继续操作。
heartbeat.draining = true;
if (dispatcher) await dispatcher.stop();
health.close();
await pool.end();
console.log("agent worker stopped");
