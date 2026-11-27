-- 119：支付回执的记账维度 + 支付/GL/审计同事务契约。
--
-- 117 建立了单行支付回执，但记账维度（法人主体、会计期间、贷方科目）只
-- 存在于 GL 凭证和请求体里：同一 payment_ref 重试时无法证明“还是同一笔
-- 支付”，ACK 前也无法核对“每条 PAID 都有平衡凭证”。
--
-- 本迁移把维度持久化到回执本身，并加数据库级约束：
--   - legal_entity_id 必填（缺省 DEFAULT，与 117 的 GL 缺省一致）；
--   - accounting_period 为 NULL 或 YYYY-MM；
--   - credit_account 为 NULL 或 CASH/PAYABLE；
--   - status='PAID' 时 accounting_period 与 credit_account 必须同时存在，
--     保证“PAID 一定可记账、一定可被 gl_journals.document_id 核对”；
--   - FAILED/RETURNED 仍可不带期间/科目（它们只留痕，不生成凭证）。
--
-- 历史行回填：PAID 行按 paid_at（缺失则 created_at）取 YYYY-MM，贷方科目
-- 按 117 的缺省 CASH；非 PAID 行只回填 legal_entity_id，其余保持 NULL。
-- 注意：这里不伪造历史 GL 凭证。若历史 PAID 行没有平衡凭证，ACK 会以
-- AWARD_GL_MISSING 拒绝，要求先人工补记/核对，而不是让回执静默通过。
-- 唯一的写路径是应用层 recordIncentiveAwardPayments：它在同一 DB 事务内
-- 锁批次 → 写支付 → 写平衡 GL → 写审计，失败整体回滚。

ALTER TABLE incentive_award_payments
  ADD COLUMN IF NOT EXISTS legal_entity_id text NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS accounting_period text,
  ADD COLUMN IF NOT EXISTS credit_account text;

-- 历史 PAID 行补齐记账维度（幂等：只在缺失时回填）。
UPDATE incentive_award_payments
   SET accounting_period = to_char(
         COALESCE(paid_at, created_at) AT TIME ZONE 'UTC',
         'YYYY-MM'
       )
 WHERE status = 'PAID'
   AND accounting_period IS NULL;

UPDATE incentive_award_payments
   SET credit_account = 'CASH'
 WHERE status = 'PAID'
   AND credit_account IS NULL;

ALTER TABLE incentive_award_payments
  DROP CONSTRAINT IF EXISTS incentive_award_payments_legal_entity_chk;
ALTER TABLE incentive_award_payments
  ADD CONSTRAINT incentive_award_payments_legal_entity_chk
  CHECK (length(btrim(legal_entity_id)) > 0);

ALTER TABLE incentive_award_payments
  DROP CONSTRAINT IF EXISTS incentive_award_payments_period_chk;
ALTER TABLE incentive_award_payments
  ADD CONSTRAINT incentive_award_payments_period_chk
  CHECK (
    accounting_period IS NULL
    OR accounting_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  );

ALTER TABLE incentive_award_payments
  DROP CONSTRAINT IF EXISTS incentive_award_payments_credit_account_chk;
ALTER TABLE incentive_award_payments
  ADD CONSTRAINT incentive_award_payments_credit_account_chk
  CHECK (credit_account IS NULL OR credit_account IN ('CASH', 'PAYABLE'));

-- PAID 是会计事实：没有期间/贷方科目就无法出平衡凭证，直接不允许落库。
ALTER TABLE incentive_award_payments
  DROP CONSTRAINT IF EXISTS incentive_award_payments_paid_dimensions_chk;
ALTER TABLE incentive_award_payments
  ADD CONSTRAINT incentive_award_payments_paid_dimensions_chk
  CHECK (
    status <> 'PAID'
    OR (accounting_period IS NOT NULL AND credit_account IS NOT NULL)
  );

-- 回执一旦 PAID 即历史事实：退款/退票只能追加新的 RETURNED 记录，
-- 不能被 UPDATE 改写。数据库层再加一道门，防止绕过应用层改账。
CREATE OR REPLACE FUNCTION prevent_paid_award_payment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'PAID' THEN
    RAISE EXCEPTION
      'incentive_award_payments % is PAID and immutable; append a RETURNED record instead',
      OLD.id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_incentive_award_payments_paid_immutable
  ON incentive_award_payments;
CREATE TRIGGER trg_incentive_award_payments_paid_immutable
  BEFORE UPDATE OR DELETE ON incentive_award_payments
  FOR EACH ROW EXECUTE FUNCTION prevent_paid_award_payment_mutation();
