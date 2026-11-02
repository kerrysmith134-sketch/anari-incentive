-- Reviewed retention-disposal workflow; no automatic hard delete (PRD SEC-06).
BEGIN;

CREATE TABLE retention_disposal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  retention_policy_id uuid NOT NULL,
  data_category text NOT NULL,
  requested_by uuid NOT NULL,
  approved_by uuid,
  status text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','APPROVED','COMPLETED','CANCELLED')),
  reason text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz NOT NULL,
  approved_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  FOREIGN KEY (tenant_id, retention_policy_id)
    REFERENCES retention_policies(tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

ALTER TABLE retention_disposal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_disposal_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON retention_disposal_requests
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
