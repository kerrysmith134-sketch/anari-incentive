-- Gold-set registry and refresh tracking for model evaluation (PRD AI-02).
BEGIN;

CREATE TABLE model_evaluation_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  version integer NOT NULL,
  name text NOT NULL,
  sample_size integer NOT NULL CHECK (sample_size > 0),
  holdout_size integer NOT NULL CHECK (holdout_size > 0 AND holdout_size < sample_size),
  label_source text NOT NULL,
  owner_person_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  next_refresh_due_at timestamptz,
  content_hash text,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, version),
  FOREIGN KEY (tenant_id, owner_person_id) REFERENCES people(tenant_id, id)
);

ALTER TABLE model_evaluation_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_evaluation_datasets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON model_evaluation_datasets
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
