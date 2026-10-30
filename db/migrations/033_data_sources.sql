-- Data-source registry with owner/SLA and field-level data map (PRD DATA-04/05).
BEGIN;

CREATE TABLE data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  owner_person_id uuid NOT NULL,
  backup_owner_person_id uuid,
  sla_hours integer NOT NULL CHECK (sla_hours > 0 AND sla_hours <= 8760),
  criticality text NOT NULL CHECK (criticality IN
    ('LOW','MEDIUM','HIGH','CRITICAL')),
  contains_personal_data boolean NOT NULL DEFAULT true,
  storage_region text NOT NULL,
  cross_border_transfers boolean NOT NULL DEFAULT false,
  processor_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  fields jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, owner_person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, backup_owner_person_id) REFERENCES people(tenant_id, id)
);

CREATE INDEX data_sources_tenant_status_idx
  ON data_sources (tenant_id, status, criticality);

ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON data_sources
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
