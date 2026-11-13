-- ---------------------------------------------------------------------------
-- NPV2-017: metric measurement snapshots.
--
-- Freezes the raw metric measurements an evaluation decision is based on:
-- each measurement records metric/value/source/sourceRef/observedAt/quality;
-- content_hash is computed server-side over the sorted measurements and the
-- snapshot is immutable after freezing. A formal evaluation decision binds
-- itself to a snapshot (FROZEN -> CONSUMED) for traceability
-- (decision -> snapshot content hash + rubric version).
-- ---------------------------------------------------------------------------

CREATE TABLE metric_measurement_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL,
  person_id uuid NOT NULL,
  rubric_version_id uuid NOT NULL,
  measurements jsonb NOT NULL,
  content_hash text NOT NULL,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  frozen_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'FROZEN'
    CHECK (status IN ('FROZEN','CONSUMED')),
  evaluation_decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE INDEX idx_metric_snapshots_cycle_person
  ON metric_measurement_snapshots(tenant_id, cycle_id, person_id);

ALTER TABLE metric_measurement_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_measurement_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON metric_measurement_snapshots
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );
