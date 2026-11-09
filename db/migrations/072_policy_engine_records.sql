-- 2026 institutional policy set: performance scoring, incentive allocation,
-- equity calculations and task-based / AI-native organisation records.
BEGIN;

CREATE TABLE policy_engine_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  record_type text NOT NULL,
  person_id uuid,
  period text,
  status text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX policy_engine_records_tenant_type_idx
  ON policy_engine_records (tenant_id, record_type, created_at DESC);
CREATE INDEX policy_engine_records_person_idx
  ON policy_engine_records (tenant_id, person_id);
CREATE INDEX policy_engine_records_period_idx
  ON policy_engine_records (tenant_id, period);

COMMIT;
