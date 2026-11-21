-- 101：FinancialFact Revision Ledger（Sprint 2.1 INT-208，财务红线）。
--
-- 财务事实的每次变更把旧值追加到 append-only 修订账本：
-- - 同键新 sourceUpdatedAt 更新主表时，旧值先写 revisions；
-- - 迟到旧快照（source_updated_at 早于现行）由应用层拒绝（STALE_FINANCIAL_FACT，
--   409），主表不变；应用层将该错误映射为同步跳过；
-- - 修订账本自身 append-only（触发器禁 UPDATE/DELETE），支持追溯与冲销链。
--   Legal Entity / Order / Invoice / FX 等财务语义字段进入 payload 约定，
--   待 ERP 契约明确后提升为列（真值表 NO_GO 解除的前置条件之一）。

CREATE TABLE financial_fact_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  fact_id uuid NOT NULL,
  revision integer NOT NULL,
  amount numeric(20, 6) NOT NULL,
  currency char(3) NOT NULL,
  period_start date,
  period_end date,
  quality_status text,
  source_updated_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, fact_id, revision),
  FOREIGN KEY (tenant_id, fact_id)
    REFERENCES financial_facts(tenant_id, id)
);

ALTER TABLE financial_fact_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_fact_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON financial_fact_revisions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION guard_financial_fact_revisions_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FINANCIAL_FACT_REVISIONS_APPEND_ONLY: % is not allowed', TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_financial_fact_revisions_immutable ON financial_fact_revisions;
CREATE TRIGGER trg_financial_fact_revisions_immutable
  BEFORE UPDATE OR DELETE ON financial_fact_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_financial_fact_revisions_immutable();

CREATE INDEX IF NOT EXISTS idx_financial_fact_revisions_fact
  ON financial_fact_revisions(tenant_id, fact_id, revision DESC);
