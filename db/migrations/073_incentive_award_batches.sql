-- 2026 institutional incentive award batches: approval, lock, export, receipt.
BEGIN;

CREATE TABLE incentive_award_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_no text NOT NULL,
  award_type text NOT NULL,
  period text NOT NULL,
  cycle_id uuid,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  total_amount numeric(20,6) NOT NULL DEFAULT 0,
  line_count integer NOT NULL DEFAULT 0,
  source_record_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  locked_at timestamptz,
  exported_at timestamptz,
  acknowledged_at timestamptz,
  payment_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, batch_no)
);

CREATE INDEX incentive_award_batches_tenant_status_idx
  ON incentive_award_batches (tenant_id, status, created_at DESC);
CREATE INDEX incentive_award_batches_period_idx
  ON incentive_award_batches (tenant_id, award_type, period);

CREATE TABLE incentive_award_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_id uuid NOT NULL REFERENCES incentive_award_batches(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  amount numeric(20,6) NOT NULL,
  currency text NOT NULL,
  source_record_id text,
  source_line_ref text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, person_id, source_line_ref)
);

CREATE INDEX incentive_award_lines_person_idx
  ON incentive_award_lines (tenant_id, person_id);

COMMIT;
