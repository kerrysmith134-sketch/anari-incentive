-- Anonymous trust / procedural-fairness surveys (PRD ORG-05).
BEGIN;

CREATE TABLE trust_survey_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  period text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','CLOSED')),
  anonymous boolean NOT NULL DEFAULT true,
  questions jsonb NOT NULL,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code, period)
);

CREATE TABLE trust_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  survey_id uuid NOT NULL,
  respondent_hash text NOT NULL,
  scores jsonb NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, survey_id, respondent_hash),
  FOREIGN KEY (tenant_id, survey_id) REFERENCES trust_survey_runs(tenant_id, id)
);

ALTER TABLE trust_survey_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_survey_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON trust_survey_runs
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

ALTER TABLE trust_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_survey_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON trust_survey_responses
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
