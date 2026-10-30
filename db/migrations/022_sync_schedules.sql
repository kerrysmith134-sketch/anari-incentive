-- ---------------------------------------------------------------------------
-- Integration sync schedules
--
-- A schedule is a durable due-time record. An external sync runner claims
-- due schedules through the API, advances next_run_at and creates a sync run;
-- connector execution remains provider-specific.
-- ---------------------------------------------------------------------------

CREATE TABLE sync_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  connection_id uuid NOT NULL,
  name text NOT NULL,
  interval_minutes integer NOT NULL CHECK (interval_minutes > 0),
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, connection_id, name),
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES integration_connections(tenant_id, id)
);

CREATE INDEX idx_sync_schedules_due
  ON sync_schedules(tenant_id, next_run_at)
  WHERE enabled;

ALTER TABLE sync_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON sync_schedules
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );
