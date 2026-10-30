-- ---------------------------------------------------------------------------
-- Versioned integration field mappings
--
-- A mapping profile belongs to an integration connection and can be used by
-- CSV/HTTP connectors. At most one version of a named profile is ACTIVE.
-- ---------------------------------------------------------------------------

CREATE TABLE integration_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  connection_id uuid NOT NULL,
  name text NOT NULL,
  mapping_type text NOT NULL CHECK (mapping_type IN ('CSV','HTTP_JSON')),
  source_system text NOT NULL,
  target_type text NOT NULL,
  field_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, connection_id, name, version),
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES integration_connections(tenant_id, id)
);

CREATE UNIQUE INDEX idx_integration_mappings_active
  ON integration_mappings(tenant_id, connection_id, name)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_integration_mappings_connection
  ON integration_mappings(tenant_id, connection_id, name, version DESC);

ALTER TABLE integration_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON integration_mappings
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );
