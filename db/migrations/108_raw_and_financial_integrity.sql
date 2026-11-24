-- 108：第二轮审计 P0/P1 修复。
--
-- 1) raw_source_records 不可变触发器覆盖迁移 100 新增字段：
--    source_version/payload_hash/resource_id/fetched_at/source_updated_at
--    也只允许 replayed_at 变更。
-- 2) FinancialFact POSTED 约束补齐 order_id OR contract_ref（与 API 一致）。
-- 3) Commercial 外部同步身份：source_system + external_id 复合唯一键。

CREATE OR REPLACE FUNCTION guard_raw_source_records_immutability()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RAW_SOURCE_RECORDS_APPEND_ONLY: DELETE is not allowed'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW.source_system IS DISTINCT FROM OLD.source_system)
     OR (NEW.external_record_id IS DISTINCT FROM OLD.external_record_id)
     OR (NEW.payload_encrypted IS DISTINCT FROM OLD.payload_encrypted)
     OR (NEW.mapping_version IS DISTINCT FROM OLD.mapping_version)
     OR (NEW.retention_class IS DISTINCT FROM OLD.retention_class)
     OR (NEW.source_version IS DISTINCT FROM OLD.source_version)
     OR (NEW.payload_hash IS DISTINCT FROM OLD.payload_hash)
     OR (NEW.resource_id IS DISTINCT FROM OLD.resource_id)
     OR (NEW.fetched_at IS DISTINCT FROM OLD.fetched_at)
     OR (NEW.source_updated_at IS DISTINCT FROM OLD.source_updated_at) THEN
    RAISE EXCEPTION 'RAW_SOURCE_RECORDS_IMMUTABLE: only replayed_at may change'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_posted_required;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_posted_required
  CHECK (
    recognition_status <> 'POSTED' OR (
      legal_entity_id IS NOT NULL AND
      accounting_period IS NOT NULL AND
      instrument_type IS NOT NULL AND
      source_version IS NOT NULL AND
      (order_id IS NOT NULL OR contract_ref IS NOT NULL)
    )
  ) NOT VALID;

ALTER TABLE commercial_accounts
  ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE commercial_opportunities
  ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'MANUAL';

ALTER TABLE commercial_accounts
  DROP CONSTRAINT IF EXISTS uq_commercial_accounts_source_external;
ALTER TABLE commercial_accounts
  ADD CONSTRAINT uq_commercial_accounts_source_external
  UNIQUE (tenant_id, source_system, external_account_id);

ALTER TABLE commercial_opportunities
  DROP CONSTRAINT IF EXISTS uq_commercial_opportunities_source_external;
ALTER TABLE commercial_opportunities
  ADD CONSTRAINT uq_commercial_opportunities_source_external
  UNIQUE (tenant_id, source_system, external_opportunity_id);
