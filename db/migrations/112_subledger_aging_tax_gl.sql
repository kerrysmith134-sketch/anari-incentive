-- 112：财务子账二期——账龄 / 税额 / 坏账 / ERP 对账 / 复式记账。
--
-- 111 已把业务文档（invoice/payment/refund/reversal/revaluation）提升为
-- financial_facts 的强类型列，但还缺：
--   - 税额：tax_rate（百分比 0-100）+ tax_amount（amount × tax_rate / 100）；
--   - 坏账：BAD_DEBT_PROVISION / BAD_DEBT_WRITE_OFF 两种新业务文档类型；
--   - 复式记账：gl_accounts / gl_journals / gl_journal_lines 三张科目账表。
--
-- 兼容策略：
--   - 新列全部可空，既有事实不受影响；税额只在应用层提供 taxRate 时写入；
--   - document_type CHECK 只做“加法”（新增两个枚举值），不改已有语义；
--   - 科目表按租户种子化（既有租户 + 运行时 ensure），所有三张表
--     ENABLE + FORCE RLS，租户隔离与 106/107 一致；
--   - 凭证借贷相等由 CHECK 二次兜底（应用层先算 1e6 定点并拒绝 409）。

ALTER TABLE financial_facts
  ADD COLUMN IF NOT EXISTS tax_rate numeric(20, 6),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(20, 6);

ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_tax_rate;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_tax_rate
  CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100));

ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_tax_amount;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_tax_amount
  CHECK (tax_amount IS NULL OR tax_amount >= 0);

-- 坏账计提 / 核销进入业务文档类型枚举（只增不改）。
ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_document_type;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_document_type
  CHECK (
    document_type IS NULL OR document_type IN
      ('INVOICE','PAYMENT','REFUND','FX_REVALUATION','REVERSAL','CREDIT_NOTE',
       'BAD_DEBT_PROVISION','BAD_DEBT_WRITE_OFF')
  );

-- 修订账本同步保存税额，保证冲销/重估/坏账调整可追溯。
ALTER TABLE financial_fact_revisions
  ADD COLUMN IF NOT EXISTS tax_rate numeric(20, 6),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(20, 6);

-- 账龄/对账按法人 + 业务文档类型回读整段子账。
CREATE INDEX IF NOT EXISTS idx_financial_facts_aging
  ON financial_facts(tenant_id, legal_entity_id, document_type, recognition_status)
  WHERE document_type IS NOT NULL;

-- ----------------------------------------------------------------------
-- 复式记账：科目表
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  name text NOT NULL,
  account_type text NOT NULL
    CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  normal_balance text NOT NULL
    CHECK (normal_balance IN ('DEBIT','CREDIT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_gl_accounts_tenant
  ON gl_accounts(tenant_id, code);

-- 最小科目表种子（既有租户）。新租户在首次记账时由应用层 ensure。
INSERT INTO gl_accounts (tenant_id, code, name, account_type, normal_balance)
SELECT tenant.id, seed.code, seed.name, seed.account_type, seed.normal_balance
  FROM tenants AS tenant
  CROSS JOIN (VALUES
    ('AR', 'Accounts Receivable', 'ASSET', 'DEBIT'),
    ('REVENUE', 'Revenue', 'REVENUE', 'CREDIT'),
    ('TAX_PAYABLE', 'Tax Payable', 'LIABILITY', 'CREDIT'),
    ('CASH', 'Cash', 'ASSET', 'DEBIT'),
    ('FX_GAIN_LOSS', 'FX Gain/Loss', 'REVENUE', 'CREDIT'),
    ('BAD_DEBT_EXPENSE', 'Bad Debt Expense', 'EXPENSE', 'DEBIT'),
    ('ALLOWANCE', 'Allowance for Doubtful Accounts', 'ASSET', 'CREDIT')
  ) AS seed(code, name, account_type, normal_balance)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 凭证头：一张业务文档一张凭证；总额借贷相等由 CHECK 兜底。
CREATE TABLE IF NOT EXISTS gl_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  journal_no text NOT NULL,
  document_type text NOT NULL
    CHECK (document_type IN
      ('INVOICE','PAYMENT','REFUND','FX_REVALUATION','REVERSAL','CREDIT_NOTE',
       'BAD_DEBT_PROVISION','BAD_DEBT_WRITE_OFF')),
  document_id text NOT NULL,
  legal_entity_id text NOT NULL,
  accounting_period text NOT NULL
    CHECK (accounting_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  currency char(3) NOT NULL,
  description text,
  source_fact_id text,
  total_debit numeric(20, 6) NOT NULL CHECK (total_debit > 0),
  total_credit numeric(20, 6) NOT NULL CHECK (total_credit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, document_type, document_id),
  CHECK (total_debit = total_credit)
);

CREATE INDEX IF NOT EXISTS idx_gl_journals_lookup
  ON gl_journals(tenant_id, legal_entity_id, accounting_period);
CREATE INDEX IF NOT EXISTS idx_gl_journals_document
  ON gl_journals(tenant_id, document_id);

-- 凭证行：每行只有借方或贷方之一为正。
CREATE TABLE IF NOT EXISTS gl_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  journal_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  account_code text NOT NULL CHECK (account_code ~ '^[A-Z][A-Z0-9_]*$'),
  debit numeric(20, 6) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(20, 6) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, journal_id, line_no),
  CHECK (debit > 0 OR credit > 0),
  CHECK (NOT (debit > 0 AND credit > 0)),
  FOREIGN KEY (tenant_id, journal_id)
    REFERENCES gl_journals(tenant_id, id),
  FOREIGN KEY (tenant_id, account_code)
    REFERENCES gl_accounts(tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_gl_journal_lines_journal
  ON gl_journal_lines(tenant_id, journal_id, line_no);
CREATE INDEX IF NOT EXISTS idx_gl_journal_lines_account
  ON gl_journal_lines(tenant_id, account_code);

ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY gl_accounts_isolation ON gl_accounts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE gl_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_journals FORCE ROW LEVEL SECURITY;
CREATE POLICY gl_journals_isolation ON gl_journals
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE gl_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_journal_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY gl_journal_lines_isolation ON gl_journal_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
