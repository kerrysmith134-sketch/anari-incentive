-- Red-team evidence for model/prompt releases (PRD AI-05).
BEGIN;

CREATE TABLE model_red_team_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  model_provider text NOT NULL,
  model_name text NOT NULL,
  prompt_version text NOT NULL,
  scope text NOT NULL,
  tests_run integer NOT NULL CHECK (tests_run > 0),
  passed boolean NOT NULL,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifact_ref text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, created_by) REFERENCES people(tenant_id, id)
);

ALTER TABLE model_red_team_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_red_team_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON model_red_team_runs
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
