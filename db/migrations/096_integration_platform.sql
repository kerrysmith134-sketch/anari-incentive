-- 096：Integration Platform V2 数据层（NP-INT-002/003/005/006/009）。
-- SyncResource（每个连接下的独立数据流）、SyncCheckpoint（资源级游标）、
-- ExternalObjectIdentity（外部对象→内部对象映射）、IngestionQuarantine（隔离区）。

CREATE TABLE sync_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  connection_id uuid NOT NULL,
  resource_key text NOT NULL,
  mapping_id uuid,
  schedule_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','PAUSED','RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connection_id, resource_key)
);

CREATE TABLE sync_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  resource_id uuid NOT NULL REFERENCES sync_resources(id),
  cursor text,
  watermark timestamptz,
  overlap_seconds integer NOT NULL DEFAULT 0,
  last_run_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, resource_id)
);

CREATE TABLE external_object_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  external_object_type text NOT NULL,
  external_object_id text NOT NULL,
  internal_object_type text NOT NULL,
  internal_object_id uuid NOT NULL,
  match_rule text NOT NULL DEFAULT 'MANUAL',
  confidence numeric NOT NULL DEFAULT 1.0
    CHECK (confidence >= 0 AND confidence <= 1),
  confirmed_by uuid,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, external_object_type, external_object_id)
);

CREATE TABLE ingestion_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  external_record_id text,
  reason text NOT NULL
    CHECK (reason IN ('UNRESOLVED_IDENTITY','INVALID_CURRENCY','MISSING_RELATION','SCHEMA_MISMATCH','OTHER')),
  payload jsonb NOT NULL DEFAULT '{}',
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, external_record_id)
);

ALTER TABLE sync_resources
  ADD CONSTRAINT fk_sync_resources_connection
  FOREIGN KEY (tenant_id, connection_id)
  REFERENCES integration_connections(tenant_id, id) NOT VALID;
ALTER TABLE sync_resources VALIDATE CONSTRAINT fk_sync_resources_connection;
ALTER TABLE sync_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_resources_isolation ON sync_resources
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE sync_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_checkpoints_isolation ON sync_checkpoints
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE external_object_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_object_identities FORCE ROW LEVEL SECURITY;
CREATE POLICY external_object_identities_isolation ON external_object_identities
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE ingestion_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_quarantine FORCE ROW LEVEL SECURITY;
CREATE POLICY ingestion_quarantine_isolation ON ingestion_quarantine
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
