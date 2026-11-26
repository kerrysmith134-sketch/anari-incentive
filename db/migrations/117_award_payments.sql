-- 117：奖励批次支付回执 + 总账闭环。
--
-- 073 的发放批次只到“导出/回执”，无法回答“哪一行真的付了、付了多少、
-- 对应哪张 GL 凭证”。本迁移新增单行支付回执表：
--   - 唯一键 (tenant_id, batch_id, line_id, payment_ref) 即幂等键：同一笔
--     银行流水重复回传只落一条；同一行用不同 ref 重复支付会累计为多付，
--     在服务层对账为 VARIANCE，而不是被静默吞掉；
--   - status 仅 PAID/FAILED/RETURNED：只有 PAID 计入“已付”并生成 GL 凭证；
--   - (tenant_id, batch_id, line_id) 复合外键保证回执不可能指向别的租户
--     或别的批次的行，即使应用层校验被绕过数据库也会拒绝；
--   - ENABLE + FORCE RLS，租户隔离与 073/079/116 一致。
--
-- 总账科目 INCENTIVE_EXPENSE / PAYABLE 由应用层 ensureGlAccounts 在首次
-- 记账时按租户补齐（112 的 gl_accounts 已有 FORCE RLS，迁移内批量 INSERT
-- 需要逐租户 app.tenant_id 上下文，故不在 SQL 里回填历史租户）。

-- 供支付回执引用的复合唯一键（id 已是主键，这里只补租户维度）。
ALTER TABLE incentive_award_batches
  DROP CONSTRAINT IF EXISTS incentive_award_batches_tenant_id_id_key;
ALTER TABLE incentive_award_batches
  ADD CONSTRAINT incentive_award_batches_tenant_id_id_key
  UNIQUE (tenant_id, id);

ALTER TABLE incentive_award_lines
  DROP CONSTRAINT IF EXISTS incentive_award_lines_tenant_batch_id_key;
ALTER TABLE incentive_award_lines
  ADD CONSTRAINT incentive_award_lines_tenant_batch_id_key
  UNIQUE (tenant_id, batch_id, id);

CREATE TABLE incentive_award_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_id uuid NOT NULL,
  line_id uuid NOT NULL,
  person_id uuid NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_ref text NOT NULL CHECK (length(btrim(payment_ref)) > 0),
  status text NOT NULL CHECK (status IN ('PAID','FAILED','RETURNED')),
  paid_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, batch_id, line_id, payment_ref),
  FOREIGN KEY (tenant_id, batch_id)
    REFERENCES incentive_award_batches (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id, line_id)
    REFERENCES incentive_award_lines (tenant_id, batch_id, id)
);

CREATE INDEX incentive_award_payments_batch_idx
  ON incentive_award_payments (tenant_id, batch_id, status);
CREATE INDEX incentive_award_payments_line_idx
  ON incentive_award_payments (tenant_id, line_id);

ALTER TABLE incentive_award_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_award_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON incentive_award_payments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
