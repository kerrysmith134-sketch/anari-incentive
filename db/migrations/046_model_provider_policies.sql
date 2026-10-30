-- Model-provider zero-retention, DPA, region and egress controls (PRD SEC-05).
BEGIN;

CREATE TABLE model_provider_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL,
  zero_retention_confirmed boolean NOT NULL,
  dpa_ref text NOT NULL,
  inference_region text NOT NULL,
  egress_allowlist jsonb NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

ALTER TABLE model_provider_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_provider_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON model_provider_policies
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
