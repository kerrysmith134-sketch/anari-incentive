-- ---------------------------------------------------------------------------
-- NPV2-016: contribution assessment drafts.
--
-- An assessment draft evaluates a contribution claim by consuming
-- contribution events (082): supporting / counter evidence / missing
-- information / alternative explanations / qualitative uncertainty. Every
-- assertion carries evidence refs; no default percentages; ACTIVITY events
-- may not back any assertion (enforced in the store); a draft may only be
-- linked to an existing human attribution decision (DECIDED).
-- ---------------------------------------------------------------------------

CREATE TABLE contribution_assessment_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  claim_id uuid NOT NULL,
  subject_person_id uuid NOT NULL,
  generated_by_type text NOT NULL
    CHECK (generated_by_type IN ('AGENT','USER','SYSTEM')),
  generated_by_id uuid,
  model_provider text,
  model_name text,
  prompt_version text,
  supporting jsonb NOT NULL DEFAULT '[]'::jsonb,
  counter jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_information jsonb NOT NULL DEFAULT '[]'::jsonb,
  alternative_explanations jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty jsonb NOT NULL DEFAULT '{}'::jsonb,
  based_on_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  activity_events_excluded boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','DECIDED','DISCARDED')),
  attribution_decision_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE INDEX idx_contribution_assessment_drafts_claim
  ON contribution_assessment_drafts(tenant_id, claim_id, version DESC);

CREATE INDEX idx_contribution_assessment_drafts_subject
  ON contribution_assessment_drafts(tenant_id, subject_person_id);

ALTER TABLE contribution_assessment_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution_assessment_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON contribution_assessment_drafts
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );
