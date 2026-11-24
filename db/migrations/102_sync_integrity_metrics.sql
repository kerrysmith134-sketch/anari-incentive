-- 102：同步完整性指标（2026-11-21 审计 Sprint 2 P1 / INT-211）。
--
-- 097 只有 records_fetched / quarantined / failed；把 rawPersisted、
-- created、updated、duplicate、invalid 拆开持久化，管理控制台才能区分
-- “真的写入了”与“幂等重复 / 隔离 / 失败”。旧行 NULL 表示未记录。

ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS records_raw_persisted integer,
  ADD COLUMN IF NOT EXISTS records_created integer,
  ADD COLUMN IF NOT EXISTS records_updated integer,
  ADD COLUMN IF NOT EXISTS records_duplicate integer,
  ADD COLUMN IF NOT EXISTS records_invalid integer;

-- 同一外部记录的多版本按资源 + 时间追溯（lineage / replay 查询）。
CREATE INDEX IF NOT EXISTS idx_raw_source_records_identity
  ON raw_source_records(tenant_id, source_system, external_record_id, created_at DESC);
