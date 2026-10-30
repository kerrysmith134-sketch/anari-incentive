-- Two-person audit-reason redaction overlay (PRD SEC-06).
BEGIN;

CREATE TABLE audit_redactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  audit_event_id uuid NOT NULL,
  replacement text NOT NULL DEFAULT '[REDACTED]',
  reason text NOT NULL,
  requested_by uuid NOT NULL,
  approved_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, audit_event_id),
  CHECK (requested_by <> approved_by),
  FOREIGN KEY (tenant_id, audit_event_id) REFERENCES audit_events(tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

ALTER TABLE audit_redactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_redactions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON audit_redactions
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
