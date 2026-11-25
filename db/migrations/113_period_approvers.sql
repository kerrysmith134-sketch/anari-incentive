-- 113：会计期间审批人目录（2026-11-21 审计 Sprint 5 follow-up）。
--
-- 107 的期间关闭/重开只校验“请求人 ≠ 审批人”，没有明确“该通知谁”。
-- 本表按租户维护一个显式审批人目录：
--   - 唯一键 (tenant_id, person_id)，同一人只出现一次；
--   - active 用于 PUT 全量替换时的软停用（保留历史可追溯）；
--   - 目录为空时服务层回退到租户内 admin/finance 角色人员，不阻断请求；
--   - 与 105/107 一致，ENABLE + FORCE RLS，租户隔离由策略兜底。

CREATE TABLE accounting_period_approvers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, person_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id)
);

ALTER TABLE accounting_period_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_period_approvers FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_period_approvers_isolation
  ON accounting_period_approvers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX idx_accounting_period_approvers_active
  ON accounting_period_approvers(tenant_id, active);
