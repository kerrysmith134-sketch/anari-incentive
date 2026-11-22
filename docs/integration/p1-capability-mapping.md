# Integration P1 能力映射说明（Sprint 2.1 P1 项的实现语义）

> 审计建议的 P1 项在本仓库的落地形态。部分项不是独立新模块，而是既有机制的
> 组合承载——本文说明映射关系与边界，避免"文档宣称 > 代码实际"。

## Resource-level Scheduler

- 连接级排期（`sync_schedules` + claim-due `FOR UPDATE SKIP LOCKED`）驱动轮询；
- **资源级节流**：`checkpoint.intervalOverrideMinutes`（资源级覆盖）——runner
  claim 租约后读取 checkpoint，距上次同步不足 override 间隔 → 释放租约并跳过
  该资源（`tdd-attack-rounds-3b` 覆盖）；
- 资源级租约（迁移 099 `lease_owner/lease_until/fencing_token`）保证同一资源
  流同一时刻只有一个 worker（INT-205 已接线 runner）。

## Retry / Backoff / DLQ

- **Retry/Backoff**：HttpJsonConnector 内建——429 尊重 Retry-After、5xx/网络
  错误指数退避+抖动（最多 3 次）；超时覆盖响应体消费（INT-017）。
- **DLQ 语义**由三机制组合承载（不设独立死信表）：
  1. 数据永不丢失：raw-first 版本化落地（INT-202）——投影失败时数据已在
     raw ledger，checkpoint 不推进，重放即可恢复；
  2. 单条校验失败 → 隔离区（`ingestion_quarantine`，DLQ 的运营可见形态），
     `resolve` 端点处置后可按新映射版本重放（INT-209）；
  3. run 级失败 → `sync_runs.error_summary` + checkpoint 回退自动重试。
  独立 DLQ 表在 raw ledger + quarantine 覆盖相同能力时不再单独建设。

## Webhook 标准化与事件处理

- 签名验证（generic HMAC / HubSpot v3 / Feishu）+ 不透明 routing key +
  原始载荷 AES-256-GCM 加密落地 + messageId 幂等（INT-009）；
- 消息统一进 `webhook_inbox`，`POST /webhook-inbox/:id/process` 消费
  （PROCESSED/FAILED + errorCode）；`integration-webhooks` 回调与直连
  `webhooks/:source` 共享同一消费链。

## Provider Schema Discovery

- `POST /integration-connections/:id/schema-preview`：probe 真实拉一页样本 →
  顶层字段推断 → 与 ACTIVE mapping fieldMap 对比给出 **drift 警告**（样本有
  但未引用 / fieldMap 引用但样本缺失）→ 映射后事件预览。
- 集成向导（NP-028）的映射预览步骤与该端点共享 fieldMap 语义。

## 数据血缘可视化与字段映射预览

- `GET /raw-source-records/lineage?sourceSystem=&externalRecordId=`：从原始
  记录追溯投影产物（财务事实按 source_record_id 精确匹配；证据按规范化
  payload 语义相等匹配）；集成「运营」页签提供血缘查询 UI。

## Integration Center 运维工作台

集成详情「运营」页签（`ops-section.tsx`）：Quarantine Review（处置）+
Resource Monitor（租约状态）+ Checkpoint Inspector（cursor/watermark/overlap）
+ Raw Record Explorer（密文元数据）+ Lineage Query + Schema Drift。
