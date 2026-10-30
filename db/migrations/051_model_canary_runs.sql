-- Canary/vendor-change regression comparison between evaluation runs (PRD AI-02).
BEGIN;

CREATE TABLE model_canary_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  baseline_evaluation_run_id uuid NOT NULL,
  candidate_evaluation_run_id uuid NOT NULL,
  dataset_ref text NOT NULL,
  traffic_percent integer NOT NULL CHECK (traffic_percent BETWEEN 1 AND 100),
  passed boolean NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, baseline_evaluation_run_id)
    REFERENCES model_evaluation_runs(tenant_id, id),
  FOREIGN KEY (tenant_id, candidate_evaluation_run_id)
    REFERENCES model_evaluation_runs(tenant_id, id)
);

ALTER TABLE model_canary_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_canary_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON model_canary_runs
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
