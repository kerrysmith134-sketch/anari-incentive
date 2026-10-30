-- Voluntary pilot enrollment with evidence of consent (PRD ORG-01).
BEGIN;

CREATE TABLE pilot_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  pilot_code text NOT NULL,
  scope text NOT NULL,
  consent_signature_ref text NOT NULL,
  consent_signed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','WITHDRAWN')),
  withdrawn_at timestamptz,
  withdrawal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, person_id, pilot_code),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id)
);

ALTER TABLE pilot_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON pilot_enrollments
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
