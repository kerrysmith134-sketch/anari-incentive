-- 105：Financial Fact 强类型 + 会计期间关闭/重开（2026-11-21 审计 Sprint 5）。
--
-- 101 把 Legal Entity / Order / Contract / FX 留在 payload 中，只够“金额事实”
-- 入口。本迁移把这些会计语义提升为列，并增加：
--   - recognition_status：DRAFT（未确认）/ POSTED（已入账）；
--   - instrument_type：INVOICE / CREDIT_NOTE / PAYMENT / COST / REFUND；
--   - accounting_period：YYYY-MM；
--   - fx_snapshot、source_version、reversal_of、reopening_ref；
--   - accounting_periods：按法人 + 期间关闭/重开，POSTED 事实写入前强制校验。
--
-- 兼容策略：既有行 recognition_status 默认 DRAFT（不是已确认会计事实），
-- 不追溯升级；只有 POSTED 才强制会计语义必填。

ALTER TABLE financial_facts
  ADD COLUMN IF NOT EXISTS legal_entity_id text,
  ADD COLUMN IF NOT EXISTS order_id text,
  ADD COLUMN IF NOT EXISTS contract_ref text,
  ADD COLUMN IF NOT EXISTS instrument_type text,
  ADD COLUMN IF NOT EXISTS recognition_status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS accounting_period text,
  ADD COLUMN IF NOT EXISTS fx_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS reversal_of text,
  ADD COLUMN IF NOT EXISTS reopening_ref text;

ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_recognition_status;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_recognition_status
  CHECK (recognition_status IN ('DRAFT','POSTED'));

ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_instrument_type;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_instrument_type
  CHECK (
    instrument_type IS NULL OR instrument_type IN
      ('INVOICE','CREDIT_NOTE','PAYMENT','COST','REFUND')
  );

ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_accounting_period;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_accounting_period
  CHECK (
    accounting_period IS NULL OR
    accounting_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  );

-- POSTED 事实必须带齐会计语义，且不得缺少来源版本/入账期间。
ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_posted_required;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_posted_required
  CHECK (
    recognition_status <> 'POSTED' OR (
      legal_entity_id IS NOT NULL AND
      accounting_period IS NOT NULL AND
      instrument_type IS NOT NULL AND
      source_version IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_financial_facts_accounting
  ON financial_facts(tenant_id, legal_entity_id, accounting_period, recognition_status);

-- 修订账本同步保存会计语义，保证追溯/冲销链不丢字段。
ALTER TABLE financial_fact_revisions
  ADD COLUMN IF NOT EXISTS legal_entity_id text,
  ADD COLUMN IF NOT EXISTS order_id text,
  ADD COLUMN IF NOT EXISTS contract_ref text,
  ADD COLUMN IF NOT EXISTS instrument_type text,
  ADD COLUMN IF NOT EXISTS recognition_status text,
  ADD COLUMN IF NOT EXISTS accounting_period text,
  ADD COLUMN IF NOT EXISTS fx_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS reversal_of text,
  ADD COLUMN IF NOT EXISTS reopening_ref text;

-- 会计期间：按 (租户, 法人, 期间) 唯一；关闭后拒绝 POSTED，重开需凭证号。
CREATE TABLE IF NOT EXISTS accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id text NOT NULL,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CLOSED')),
  closed_at timestamptz,
  closed_by uuid,
  close_reason text,
  reopened_at timestamptz,
  reopened_by uuid,
  reopening_ref text,
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, legal_entity_id, period),
  UNIQUE (tenant_id, id)
);

ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_periods_isolation ON accounting_periods
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX IF NOT EXISTS idx_accounting_periods_lookup
  ON accounting_periods(tenant_id, legal_entity_id, period);
