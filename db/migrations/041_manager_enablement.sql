-- Manager training and calibration records (PRD ORG-04).
BEGIN;

CREATE TABLE manager_training_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  training_code text NOT NULL,
  title text NOT NULL,
  completed_at timestamptz NOT NULL,
  expires_at timestamptz,
  evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id)
);

CREATE INDEX manager_training_records_person_idx
  ON manager_training_records (tenant_id, person_id, training_code);

CREATE TABLE calibration_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  title text NOT NULL,
  held_at timestamptz NOT NULL,
  facilitator_person_id uuid NOT NULL,
  attendee_person_ids jsonb NOT NULL,
  policy_version_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, facilitator_person_id) REFERENCES people(tenant_id, id)
);

ALTER TABLE manager_training_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_training_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON manager_training_records
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

ALTER TABLE calibration_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON calibration_sessions
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
