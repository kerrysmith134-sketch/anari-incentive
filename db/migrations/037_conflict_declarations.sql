-- Related-party conflict registry for contribution adjudication (PRD ATT-02).
BEGIN;

CREATE TABLE conflict_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  related_person_id uuid NOT NULL,
  relationship_type text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  declared_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (person_id <> related_person_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, related_person_id) REFERENCES people(tenant_id, id)
);

CREATE INDEX conflict_declarations_pair_idx
  ON conflict_declarations (tenant_id, person_id, related_person_id, status);

ALTER TABLE conflict_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_declarations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON conflict_declarations
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
