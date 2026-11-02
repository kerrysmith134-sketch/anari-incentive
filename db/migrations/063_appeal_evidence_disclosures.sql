-- Evidence disclosure to appellants (PRD ATT-07).
BEGIN;

CREATE TABLE appeal_evidence_disclosures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appeal_id uuid NOT NULL,
  disclosed_by uuid NOT NULL,
  method text NOT NULL
    CHECK (method IN ('PORTAL','EMAIL','IN_PERSON','OTHER')),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  disclosed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, appeal_id) REFERENCES appeal_cases(tenant_id, id),
  FOREIGN KEY (tenant_id, disclosed_by) REFERENCES people(tenant_id, id)
);

CREATE INDEX idx_appeal_evidence_disclosures
  ON appeal_evidence_disclosures(tenant_id, appeal_id, disclosed_at DESC);

ALTER TABLE appeal_evidence_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE appeal_evidence_disclosures FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON appeal_evidence_disclosures
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
