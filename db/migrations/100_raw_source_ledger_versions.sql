-- 100：Raw Source Ledger 版本化（Sprint 2.1 INT-202，审计 2026-11-21 P0）。
--
-- 每个来源记录版本独立追加（同 external_record_id 多版本并存，禁止覆盖）：
-- - source_version：来源版本（来源事件版本或 mapping 版本）
-- - payload_hash：内容哈希（投影幂等判定 + 篡改检测）
-- - resource_id：来源资源（同步流）
-- - fetched_at / source_updated_at：获取时间与来源更新时间
-- 唯一键扩为 (tenant, system, external_record_id, source_version)。
-- 099 的 append-only 触发器保持不变：任何 UPDATE/DELETE 仍被拒绝。

ALTER TABLE raw_source_records
  ADD COLUMN IF NOT EXISTS source_version text NOT NULL DEFAULT '1',
  ADD COLUMN IF NOT EXISTS payload_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resource_id uuid,
  ADD COLUMN IF NOT EXISTS fetched_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;

-- 099 的 UNIQUE (tenant_id, source_system, external_record_id) 阻止版本并存——替换。
ALTER TABLE raw_source_records
  DROP CONSTRAINT IF EXISTS raw_source_records_tenant_id_source_system_external_record_id_key;
ALTER TABLE raw_source_records
  ADD CONSTRAINT uq_raw_source_record_version
  UNIQUE (tenant_id, source_system, external_record_id, source_version);

CREATE INDEX IF NOT EXISTS idx_raw_source_records_resource
  ON raw_source_records(tenant_id, resource_id, fetched_at DESC);
