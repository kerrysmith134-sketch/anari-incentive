-- Voluntary, consent-backed labels for aggregate fairness monitoring (ADR-008).
BEGIN;

CREATE TABLE workforce_subgroup_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  dimension text NOT NULL
    CHECK (dimension IN ('GENDER','AGE_BAND','REGION','TENURE_BAND','EMPLOYMENT_TYPE')),
  value text NOT NULL,
  consent_ref text NOT NULL,
  consented_at timestamptz NOT NULL,
  expires_at timestamptz,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, person_id, dimension),
  CHECK (expires_at IS NULL OR expires_at > consented_at),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES people(tenant_id, id)
);

ALTER TABLE workforce_subgroup_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_subgroup_attributes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON workforce_subgroup_attributes
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
