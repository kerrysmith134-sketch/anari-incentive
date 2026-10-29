-- ---------------------------------------------------------------------------
-- Policy test suite run history
--
-- Each suite execution is an append-only record of the result set, so policy
-- owners can show what was tested before a change was approved or published.
-- ---------------------------------------------------------------------------

CREATE TABLE policy_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_version_id uuid NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  total integer NOT NULL CHECK (total >= 0),
  passed_count integer NOT NULL CHECK (passed_count >= 0),
  failed_count integer NOT NULL CHECK (failed_count >= 0),
  retired_count integer NOT NULL CHECK (retired_count >= 0),
  passed boolean NOT NULL,
  results_hash text NOT NULL,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_version_id)
    REFERENCES policy_versions(tenant_id, id)
);

CREATE INDEX idx_policy_test_runs_version
  ON policy_test_runs(tenant_id, policy_version_id, run_at DESC);
