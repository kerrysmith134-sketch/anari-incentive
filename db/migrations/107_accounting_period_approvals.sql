-- 107：会计期间关闭/重开双人审批（2026-11-21 审计 Sprint 5 follow-up）。
--
-- 直接 close/reopen 不再由单次 API 调用完成：先创建 PENDING 请求，
-- 由另一名财务/管理员 approve 后才执行；requested_by 与 decided_by 必须不同。
-- 这样避免“同一人自批自关”并留下可审计凭证。

CREATE TABLE accounting_period_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id text NOT NULL,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  action text NOT NULL CHECK (action IN ('CLOSE','REOPEN')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  reopening_ref text,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (action <> 'REOPEN' OR reopening_ref IS NOT NULL)
);

ALTER TABLE accounting_period_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_period_change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_period_change_requests_isolation
  ON accounting_period_change_requests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX idx_accounting_period_requests_lookup
  ON accounting_period_change_requests(tenant_id, legal_entity_id, period, status);
