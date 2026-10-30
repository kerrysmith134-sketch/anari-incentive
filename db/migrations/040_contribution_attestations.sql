-- Peer and manager attestations supporting contribution claims (PRD DATA-02).
BEGIN;

CREATE TABLE contribution_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  work_package_id uuid NOT NULL,
  subject_person_id uuid NOT NULL,
  attester_person_id uuid NOT NULL,
  attestation_type text NOT NULL CHECK (attestation_type IN ('PEER','MANAGER')),
  statement text NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','WITHDRAWN')),
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (subject_person_id <> attester_person_id),
  FOREIGN KEY (tenant_id, work_package_id) REFERENCES work_packages(tenant_id, id),
  FOREIGN KEY (tenant_id, subject_person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, attester_person_id) REFERENCES people(tenant_id, id)
);

CREATE INDEX contribution_attestations_subject_idx
  ON contribution_attestations (tenant_id, work_package_id, subject_person_id, status);

ALTER TABLE contribution_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution_attestations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON contribution_attestations
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
