# NPV2-033：SLO 与可观测性

## SLI 采集

- **API**：`GET /metrics`（Prometheus 文本）暴露 `n_perform_http_requests_total`、
  `n_perform_http_request_duration_ms_{sum,count}`（按 route/status 分解）、
  `n_perform_business_events_total`；NPV2-033 新增
  `n_perform_agent_tasks{status}`、`n_perform_outbox_backlog`、
  `n_perform_outbox_oldest_age_ms`、`n_perform_db_pool_{total,idle,waiting}` gauge。
- **关联**：每个响应带 `X-Request-Id`（= Fastify request.id）；错误 envelope 的
  `meta.correlation_id` 与之一致；Agent 任务自带 `correlationId` 列——请求 →
  任务 → 审计链可通过 id 串联。

## SLO（建议基线，供告警规则引用）

| SLI | SLO | 告警建议 |
| --- | --- | --- |
| API 可用性（非 5xx 占比） | ≥ 99.5% / 30d | 5xx rate > 1% 持续 5m |
| API 延迟 p95（/api/v1 读路径） | ≤ 500ms | p95 > 1s 持续 10m |
| outbox 积压 | ≤ 50 条 | backlog > 200 持续 15m 或 oldest > 30m |
| agent task 失败率 | ≤ 5% / 24h | FAILED 占比 > 10% 持续 30m |
| DB pool 等待 | = 0 常态 | waiting > 0 持续 5m（连接池饱和） |

## 告警接线（示例 PromQL）

```promql
# outbox 积压
n_perform_outbox_backlog > 200
# DB pool 饱和
n_perform_db_pool_waiting > 0
# agent 任务失败率（gauge 比值——不能对 gauge 使用 rate()）
sum(n_perform_agent_tasks{status="FAILED"})
  / clamp_min(sum(n_perform_agent_tasks), 1) > 0.10
```

## 采集频率与责任

- Prometheus scrape 15s；API 在 3000 端口暴露 /metrics；worker 的 3100 端口只有
  /health 与 /ready（不提供 /metrics）。
- worker 侧 dispatcher/outbox 错误已打结构化日志（含 error 对象）；pool 饱和
  通过 waiting gauge 观测，连接数上限由部署侧 maxConnections 控制。
