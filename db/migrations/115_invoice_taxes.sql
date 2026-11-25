-- 115：发票多税种（VAT + WHT / 附加税等）——明细入 payload，汇总入 tax_amount。
--
-- 112 只支持单一 tax_rate（百分比），一张发票只能表达一个税种。多税种发票的
-- 逐税种明细（code / rate / base / taxAmount）无法放进 numeric 列；按
-- “优先不新增列”的约束，明细写 financial_facts.payload.taxBreakdown：
--
--   payload.taxBreakdown = [
--     { "code": "VAT", "rate": "13", "base": "1000", "taxAmount": "130" },
--     { "code": "WHT", "rate": "6",  "base": "1000", "taxAmount": "60"  }
--   ]
--
-- 约定（应用层 apps/api/src/modules/budget/financial-subledger.routes.ts 用
-- 1e6 定点 BigInt 实现）：
--   - 1-5 条；code 1-32 字符，同一张发票内按大小写不敏感去重；rate 0-100
--     （≤6 位小数）；
--   - 每条 taxAmount = base(发票 amount) × rate / 100，逐条 HALF_UP 取整；
--     **先逐条取整再求和**，因此不等于“汇总税率一次性取整”；
--   - financial_facts.tax_amount = 各条 taxAmount 之和；发票总额 =
--     amount + tax_amount（账龄 open、AR 借方、GL 均直接读 tax_amount）；
--   - financial_facts.tax_rate 只服务旧的单一税率发票：多税种发票必须为
--     NULL，避免用汇总税额反推出一个并不存在的“单一税率”。
--
-- 本迁移不改表结构（无新列），只加两道数据库兜底：
--   1. CHECK：payload.taxBreakdown 出现时必须是 1-5 条 JSON 数组，且
--      tax_rate 为空、tax_amount 非空——防止应用层回归写入无法对账的形状；
--   2. COMMENT：把 tax_rate / tax_amount 的多税种语义写进 catalog，供
--      运维与 BI 直接读取，不依赖代码注释。
--
-- 兼容策略：既有事实 payload 没有 taxBreakdown，CHECK 直接放行；tax_amount
-- 的 numeric 精度、修订账本（financial_fact_revisions）与 RLS 均不变。

-- CASE 保证只在确认是数组时才调用 jsonb_array_length（非数组会抛错），
-- 非数组的 taxBreakdown 由该 CHECK 明确拒绝，而不是留给业务层兜底。
--
-- NOT VALID：payload 是开放 JSONB，历史上可能已有 ERP 默认写入的同名键；
-- 迁移不因历史行阻塞上线，但约束对迁移之后的所有 INSERT/UPDATE 立即生效
-- （新发票若税种形状不合规会被库层拒绝）。
ALTER TABLE financial_facts
  DROP CONSTRAINT IF EXISTS chk_financial_facts_tax_breakdown;
ALTER TABLE financial_facts
  ADD CONSTRAINT chk_financial_facts_tax_breakdown
  CHECK (
    CASE
      WHEN payload->'taxBreakdown' IS NULL THEN true
      WHEN jsonb_typeof(payload->'taxBreakdown') <> 'array' THEN false
      ELSE
        jsonb_array_length(payload->'taxBreakdown') BETWEEN 1 AND 5
        AND tax_rate IS NULL
        AND tax_amount IS NOT NULL
    END
  ) NOT VALID;

COMMENT ON COLUMN financial_facts.tax_rate IS
  'Single-rate invoice tax percentage (0-100). NULL for multi-tax invoices whose per-code rates live in payload.taxBreakdown.';
COMMENT ON COLUMN financial_facts.tax_amount IS
  'Invoice tax total in invoice currency. Single rate: amount * tax_rate / 100. Multi-tax: sum of payload.taxBreakdown[].taxAmount, each rounded HALF_UP at 1e6 fixed point.';
