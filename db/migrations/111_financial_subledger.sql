-- 111：财务子账（发票 / 收款 / 退款 / 冲销 / FX 重估）最小闭环。
--
-- 105 已把 Legal Entity / Order / Contract / Instrument / 会计期间提升为列，
-- 但一笔业务“文档”（发票号、收款单号）与功能币种金额仍只能塞进 payload。
-- 本迁移把它们提升为列，保证：
--   - document_type/document_id：业务文档身份（INVOICE/PAYMENT/REFUND/
--     FX_REVALUATION/REVERSAL/CREDIT_NOTE），同一租户内唯一；
--   - related_fact_id：收款/退款指向发票、重估/冲销指向被调整事实；
--   - fx_rate/functional_currency/functional_amount：原币与功能币双金额，
--     应用层用 1e6 定点 BigInt 计算并校验一致性；
--   - 修订账本同步保存以上字段，冲销链追溯不丢列。
--
-- 兼容策略：新列全部可空，既有 DRAFT/POSTED 事实不受影响；只有应用层在
-- POSTED 且 currency <> functional_currency 时才强制 fx_rate/functional_amount
-- （数据库 CHECK 二次兜底）。

ALTER TABLE financial_facts
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS document_id text,
  ADD COLUMN IF NOT EXISTS related_fact_id text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric(20, 6),
  ADD COLUMN IF NOT EXISTS functional_currency char(3),
  ADD COLUMN IF NOT EXISTS functional_amount numeric(20, 6);

ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_document_type;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_document_type
  CHECK (
    document_type IS NULL OR document_type IN
      ('INVOICE','PAYMENT','REFUND','FX_REVALUATION','REVERSAL','CREDIT_NOTE')
  );

-- 文档号与文档类型必须成对出现，避免出现无法去重的半截身份。
ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_document_pair;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_document_pair
  CHECK (document_id IS NULL OR document_type IS NOT NULL);

ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_fx_rate;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_fx_rate
  CHECK (fx_rate IS NULL OR fx_rate > 0);

ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_functional_currency;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_functional_currency
  CHECK (functional_currency IS NULL OR functional_currency ~ '^[A-Z]{3}$');

-- POSTED 且跨币种时，必须同时提供汇率与功能币金额（应用层仍会重算校验）。
ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_functional_required;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_functional_required
  CHECK (
    recognition_status <> 'POSTED' OR
    functional_currency IS NULL OR
    functional_currency = currency OR
    (fx_rate IS NOT NULL AND functional_amount IS NOT NULL)
  );

-- 同一租户内业务文档唯一；document_id 为空的历史事实不参与唯一性。
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_facts_document
  ON financial_facts(tenant_id, document_type, document_id)
  WHERE document_id IS NOT NULL;

-- 子账按订单/合同/关联事实回读整条链。
CREATE INDEX IF NOT EXISTS idx_financial_facts_order
  ON financial_facts(tenant_id, order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_facts_contract
  ON financial_facts(tenant_id, contract_ref)
  WHERE contract_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_facts_related
  ON financial_facts(tenant_id, related_fact_id)
  WHERE related_fact_id IS NOT NULL;

-- 修订账本同步保存子账语义，保证冲销/重估可追溯。
ALTER TABLE financial_fact_revisions
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS document_id text,
  ADD COLUMN IF NOT EXISTS related_fact_id text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric(20, 6),
  ADD COLUMN IF NOT EXISTS functional_currency char(3),
  ADD COLUMN IF NOT EXISTS functional_amount numeric(20, 6);
