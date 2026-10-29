-- ---------------------------------------------------------------------------
-- Model prompt registry
--
-- Versioned prompt templates for AI-assisted workflows. A prompt can only be
-- activated with a passed model evaluation for the same provider/model; at
-- most one version per prompt code may be active at a time.
-- ---------------------------------------------------------------------------

CREATE TABLE model_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  prompt_code text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  purpose text NOT NULL,
  model_provider text NOT NULL,
  model_name text NOT NULL,
  template text NOT NULL,
  template_hash text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  evaluation_run_id uuid,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, prompt_code, version),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, evaluation_run_id)
    REFERENCES model_evaluation_runs(tenant_id, id)
);

CREATE UNIQUE INDEX idx_model_prompts_active_code
  ON model_prompts(tenant_id, prompt_code)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_model_prompts_code_version
  ON model_prompts(tenant_id, prompt_code, version DESC);
