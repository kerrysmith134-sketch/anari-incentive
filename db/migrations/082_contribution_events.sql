-- ---------------------------------------------------------------------------
-- NPV2-015: contribution events — append-only fact records.
--
-- A contribution event records WHAT HAPPENED (actor/subject/action/target/
-- time/source/outcome/evidence/correction chain). It is NOT a contribution
-- attribution: ACTIVITY events carry observed activity metrics and must never
-- be used as contribution weight. Ingest is idempotent per
-- (tenant_id, source, external_id); corrections append and reference the
-- corrected event via correction_of (never delete).
-- ---------------------------------------------------------------------------

CREATE TABLE contribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_person_id uuid,
  subject_person_id uuid NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  source text NOT NULL,
  external_id text,
  kind text NOT NULL CHECK (kind IN ('CONTRIBUTION','ACTIVITY','CONTEXT')),
  outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  correction_of uuid REFERENCES contribution_events(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- 幂等键：同一租户同一来源的 external_id 唯一（可空键不参与唯一性）。
CREATE UNIQUE INDEX idx_contribution_events_idempotency
  ON contribution_events(tenant_id, source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX idx_contribution_events_subject
  ON contribution_events(tenant_id, subject_person_id, occurred_at DESC);

CREATE INDEX idx_contribution_events_correction
  ON contribution_events(tenant_id, correction_of)
  WHERE correction_of IS NOT NULL;

ALTER TABLE contribution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON contribution_events
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );
