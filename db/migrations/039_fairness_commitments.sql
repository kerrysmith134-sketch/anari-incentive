-- Published no-retaliation / fairness commitment (PRD ORG-03).
BEGIN;

CREATE TABLE fairness_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  version integer NOT NULL,
  statement text NOT NULL,
  owner_person_id uuid NOT NULL,
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED')),
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_person_id) REFERENCES people(tenant_id, id)
);

ALTER TABLE fairness_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fairness_commitments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON fairness_commitments
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
