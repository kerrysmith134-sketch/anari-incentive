/**
 * NPV2-035：性能与容量基线（内存模式，通过 buildApp inject 高频路径）。
 *
 * 覆盖：工作包列表、计算运行列表、agent 任务列表、证据列表（高频读），
 * 以及批量计算运行的写入路径。输出 p50/p95/p99 与吞吐基线。
 *
 * 运行：npx tsx scripts/perf-baseline.ts
 */
import { performance } from "node:perf_hooks";
import { buildApp } from "../apps/api/src/app.js";
import { MemoryPlatformStore } from "../apps/api/src/platform-store.js";
import { Store } from "../apps/api/src/store.js";

interface Percentiles {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

function percentiles(samples: number[]): Percentiles {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const mean =
    sorted.reduce((sum, v) => sum + v, 0) / Math.max(sorted.length, 1);
  return {
    n: sorted.length,
    p50: Math.round(at(0.5) * 100) / 100,
    p95: Math.round(at(0.95) * 100) / 100,
    p99: Math.round(at(0.99) * 100) / 100,
    mean: Math.round(mean * 100) / 100,
  };
}

async function timeN(
  label: string,
  n: number,
  fn: () => Promise<unknown>,
): Promise<Percentiles> {
  const samples: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  const stats = percentiles(samples);
  console.log(
    `${label.padEnd(28)} n=${String(stats.n).padStart(4)}  p50=${String(stats.p50).padStart(8)}ms  p95=${String(stats.p95).padStart(8)}ms  p99=${String(stats.p99).padStart(8)}ms  mean=${stats.mean}ms`,
  );
  return stats;
}

async function main() {
  const platformStore = new MemoryPlatformStore();
  const app = buildApp(
    () => new Store("00000000-0000-4000-8000-000000000001"),
    undefined,
    undefined,
    platformStore,
    {
      agentChat: undefined,
    },
  );

  console.log("=== NPV2-035 性能基线（内存模式）===\n");

  // 造数据：20 个工作包 + 每个一条申报（SUBMITTED）
  const workPackageIds: string[] = [];
  for (let k = 0; k < 20; k += 1) {
    const wp = await app.inject({
      method: "POST",
      url: "/api/v1/work-packages",
      payload: {
        title: `perf wp ${k}`,
        objective: `Performance baseline objective ${k} with enough characters`,
        ownerPersonId: "00000000-0000-4000-8000-000000000001",
        members: [
          {
            personId: "00000000-0000-4000-8000-000000000001",
            responsibilityCode: "OWNER",
            expectedOutput: "delivery",
          },
        ],
        acceptanceCriteria: ["done"],
      },
    });
    const body = wp.json() as { data?: { id?: string } };
    const id = body.data?.id;
    if (id) workPackageIds.push(id);
    await app.inject({
      method: "POST",
      url: `/api/v1/work-packages/${id}/commit`,
      payload: { expectedVersion: 1 },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/work-packages/${id}/start`,
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/work-packages/${id}/submit`,
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/contribution-claims",
      payload: {
        workPackageId: id,
        claimantPersonId: "00000000-0000-4000-8000-000000000001",
        claimType: "DELIVERABLE_CONTRIBUTION",
        claimedContribution: { dimensions: ["QUALITY"], summary: "perf" },
        evidenceRefs: [],
        rationale: "perf baseline claim",
      },
    });
  }
  console.log(`seeded ${workPackageIds.length} work packages + claims\n`);

  const injectGet = (url: string) => app.inject({ method: "GET", url });

  await timeN("GET /work-packages (20 rows)", 200, () =>
    injectGet("/api/v1/work-packages"),
  );
  await timeN("GET /contribution-claims (20)", 200, () =>
    injectGet("/api/v1/contribution-claims"),
  );
  await timeN("GET /agent-tasks (empty)", 200, () =>
    injectGet("/api/v1/agent-tasks?limit=100"),
  );
  await timeN("GET /evidence (empty)", 200, () => injectGet("/api/v1/evidence"));
  await timeN("GET /evaluation-cycles", 200, () =>
    injectGet("/api/v1/evaluation-cycles"),
  );
  await timeN("GET /notifications", 200, () =>
    injectGet("/api/v1/notifications"),
  );

  // 批量写入路径：贡献事件 ingest（幂等键去重）
  const events = Array.from({ length: 50 }, (_, k) => ({
    subjectPersonId: "00000000-0000-4000-8000-000000000001",
    action: `PERF_ACTION_${k}`,
    targetType: "WORK_PACKAGE",
    targetId: workPackageIds[k % workPackageIds.length] ?? "wp",
    occurredAt: new Date().toISOString(),
    source: "PERF_DRILL",
    externalId: `perf-${k}`,
    kind: "ACTIVITY" as const,
    outcome: { summary: `perf event ${k}` },
    evidenceRefs: [],
  }));
  await timeN("POST contribution-events:ingest(50)", 5, () =>
    app.inject({
      method: "POST",
      url: "/api/v1/contribution-events:ingest",
      payload: { events },
    }),
  );

  // 结论提示
  console.log(
    "\n注：内存模式基线不含 PG/网络开销；PG 侧 p95 受连接池与索引影响，\n生产容量需以 docker compose + PG 基准另测（见 docs/operations/slo.md）。",
  );
  await app.close();
}

void main();
