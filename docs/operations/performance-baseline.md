# 性能与容量基线（NPV2-035）

## 运行方式

```bash
npx tsx scripts/perf-baseline.ts
```

内存模式（buildApp inject），不含 PG/网络开销；PG 侧 p95 受连接池与索引影响，
生产容量需以 docker compose + PG 基准另测。

## 基线（2026-11-14，M-series/arm64，20 WP + 20 申报 + 50 事件）

| 路径 | n | p50 | p95 | p99 | mean |
| --- | --- | --- | --- | --- | --- |
| GET /work-packages（20 行） | 200 | 0.09ms | 0.17ms | 1.69ms | 0.12ms |
| GET /contribution-claims | 200 | 0.04ms | 0.06ms | 0.20ms | 0.05ms |
| GET /agent-tasks | 200 | 0.05ms | 0.09ms | 0.78ms | 0.07ms |
| GET /evidence | 200 | 0.04ms | 0.09ms | 0.36ms | 0.05ms |
| GET /evaluation-cycles | 200 | 0.04ms | 0.08ms | 0.18ms | 0.05ms |
| GET /notifications | 200 | 0.04ms | 0.06ms | 0.09ms | 0.04ms |
| POST contribution-events:ingest（50 事件批量） | 5 | 2.99ms | 5.18ms | 5.18ms | 3.07ms |

## 结论与容量提示

- 读路径 p95 全部 < 0.2ms（内存模式）——PG 侧同样的查询走索引后，
  瓶颈在网络往返（~0.5-2ms/查询）与连接池上限；
- 批量 ingest 50 事件 3ms（逐行查重 + 插入），线性扩展；
- agent-tasks claim 用 FOR UPDATE SKIP LOCKED：并发 worker 数建议
  ≤ 租约时限内可完成消费的租户数（NPV2-022 每租户批量默认 1）；
- DB 连接池：pool max 建议为 (worker 数 × 每任务事务数) 与 PG
  max_connections 的较小值；waiting gauge > 0 即饱和（见 slo.md 告警）。
