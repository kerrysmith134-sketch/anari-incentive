-- ---------------------------------------------------------------------------
-- AI numeric score proposals
--
-- A proposal is advisory: it records the evaluation run that opened the gate,
-- the evidence snapshot, the model/prompt provenance and the computed scores.
-- Only a human decision can mark it ACCEPTED or REJECTED.
-- ---------------------------------------------------------------------------

CREATE TABLE ai_score_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL,
  person_id uuid NOT NULL,
  evaluation_run_id uuid NOT NULL,
  model_prompt_id uuid,
  model_provider text NOT NULL,
  model_name text NOT NULL,
  prompt_version text NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_score numeric(10,2) NOT NULL CHECK (overall_score >= 0),
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  rationale text NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_snapshot_hash text NOT NULL,
  gate_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACCEPTED','REJECTED')),
  requested_by uuid,
  decided_by uuid,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, evaluation_run_id)
    REFERENCES model_evaluation_runs(tenant_id, id),
  FOREIGN KEY (tenant_id, model_prompt_id)
    REFERENCES model_prompts(tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by) REFERENCES people(tenant_id, id)
);

CREATE INDEX idx_ai_score_proposals_person
  ON ai_score_proposals(tenant_id, person_id, cycle_id, created_at DESC);
CREATE INDEX idx_ai_score_proposals_status
  ON ai_score_proposals(tenant_id, status, created_at DESC);
