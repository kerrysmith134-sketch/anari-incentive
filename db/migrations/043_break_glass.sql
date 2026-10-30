-- Time-bound break-glass access for sensitive payroll fields (PRD SEC-03).
BEGIN;

CREATE TABLE break_glass_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope text NOT NULL CHECK (scope IN ('PAYROLL_BANK_ACCOUNT')),
  grantee_person_id uuid NOT NULL,
  reason text NOT NULL,
  granted_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, grantee_person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, granted_by) REFERENCES people(tenant_id, id)
);

CREATE INDEX break_glass_active_idx
  ON break_glass_grants (tenant_id, grantee_person_id, scope, status, expires_at);

ALTER TABLE break_glass_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE break_glass_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON break_glass_grants
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
