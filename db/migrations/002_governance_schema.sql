-- N-Perform governance schema
-- Legal gates, employee notices/confirmations, policy change governance,
-- budgets, financial facts, model evaluation and settlement evidence.
--
-- The product records and enforces these references. Legal sufficiency remains
-- a tenant / legal-counsel responsibility.

BEGIN;

-- ---------------------------------------------------------------------------
-- Employee representation, notices, confirmations
-- ---------------------------------------------------------------------------

CREATE TABLE employee_representations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  body_name text NOT NULL,
  body_type text NOT NULL CHECK (body_type IN ('WORKS_COUNCIL','UNION','EMPLOYEE_REP','ALL_EMPLOYEES')),
  jurisdiction text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE policy_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_version_id uuid NOT NULL,
  representation_id uuid,
  consultation_type text NOT NULL CHECK (consultation_type IN ('DISCUSSION','COMMENT_PERIOD','NEGOTIATION','INFORMATION')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  minutes_ref text,
  feedback_summary text,
  outcome text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES policy_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, representation_id) REFERENCES employee_representations(tenant_id, id)
);

CREATE TABLE employee_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_version_id uuid,
  notice_type text NOT NULL CHECK (notice_type IN ('POLICY','PAY_PLAN','AI_USE','DATA_PROCESSING','OTHER')),
  title text NOT NULL,
  body_ref text NOT NULL,
  published_at timestamptz NOT NULL,
  effective_from timestamptz NOT NULL,
  acknowledgement_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES policy_versions(tenant_id, id)
);

CREATE TABLE policy_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  notice_id uuid NOT NULL,
  person_id uuid NOT NULL,
  acknowledged_at timestamptz,
  signature_ref text,
  declined_at timestamptz,
  decline_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, notice_id, person_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, notice_id) REFERENCES employee_notices(tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id)
);

CREATE TABLE employee_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  cycle_id uuid,
  target_type text NOT NULL CHECK (target_type IN ('EVALUATION','ATTRIBUTION','CALCULATION','LEDGER')),
  target_id uuid NOT NULL,
  decision text NOT NULL DEFAULT 'VIEWED' CHECK (decision IN ('VIEWED','CONFIRMED','OBJECTED')),
  viewed_at timestamptz,
  confirmed_at timestamptz,
  objection_at timestamptz,
  objection_reason text,
  signature_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, person_id, target_type, target_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, cycle_id) REFERENCES evaluation_cycles(tenant_id, id)
);

CREATE TABLE legal_gate_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_version_id uuid NOT NULL,
  democratic_procedure_ref text,
  employee_notice_ref text,
  data_protection_assessment_ref text,
  minimum_wage_checked boolean NOT NULL DEFAULT false,
  policy_approved boolean NOT NULL DEFAULT false,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, policy_version_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES policy_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES people(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Policy change governance
-- ---------------------------------------------------------------------------

CREATE TABLE rule_change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_code text NOT NULL,
  from_policy_version_id uuid,
  to_policy_version_id uuid NOT NULL,
  change_type text NOT NULL,
  reason text NOT NULL,
  impact_simulation jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  publicized_at timestamptz,
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, from_policy_version_id) REFERENCES policy_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, to_policy_version_id) REFERENCES policy_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

CREATE TABLE policy_test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_version_id uuid NOT NULL,
  case_code text NOT NULL,
  input jsonb NOT NULL,
  expected_output jsonb NOT NULL,
  category text NOT NULL CHECK (category IN ('NORMAL','BOUNDARY','EXCEPTION','HISTORICAL')),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, policy_version_id, case_code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES policy_versions(tenant_id, id)
);

CREATE TABLE policy_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_version_id uuid NOT NULL,
  notice_id uuid NOT NULL,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, policy_version_id, notice_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES policy_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, notice_id) REFERENCES employee_notices(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Recalculation and appeals
-- ---------------------------------------------------------------------------

CREATE TABLE recalculation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  target_type text NOT NULL CHECK (target_type IN ('EVIDENCE','ATTRIBUTION','EVALUATION','LEDGER')),
  target_id uuid NOT NULL,
  reason_code text NOT NULL,
  explanation text NOT NULL,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  approved_by uuid,
  approved_at timestamptz,
  new_calculation_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, new_calculation_run_id) REFERENCES calculation_runs(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Budgets, cash gate, financial facts
-- ---------------------------------------------------------------------------

CREATE TABLE budget_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  pool_type text NOT NULL,
  currency char(3) NOT NULL,
  approved_amount numeric(20,6) NOT NULL CHECK (approved_amount >= 0),
  committed_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (committed_amount >= 0),
  status text NOT NULL DEFAULT 'DRAFT',
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cycle_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cycle_id) REFERENCES evaluation_cycles(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id),
  CHECK (committed_amount <= approved_amount)
);

CREATE TABLE budget_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  budget_pool_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'RESERVED',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, budget_pool_id) REFERENCES budget_pools(tenant_id, id)
);

CREATE TABLE cash_gate_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL,
  as_of_date date NOT NULL,
  safety_reserve_months numeric(6,2) NOT NULL,
  thirteen_week_forecast_ref text NOT NULL,
  passes_gate boolean NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cycle_id, as_of_date),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cycle_id) REFERENCES evaluation_cycles(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

CREATE TABLE financial_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  source_record_id text NOT NULL,
  fact_type text NOT NULL,
  period_start date,
  period_end date,
  amount numeric(20,6) NOT NULL,
  currency char(3) NOT NULL,
  quality_status quality_status NOT NULL DEFAULT 'UNVERIFIED',
  source_updated_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, source_record_id, fact_type),
  UNIQUE (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- AI evaluation
-- ---------------------------------------------------------------------------

CREATE TABLE model_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  evaluation_type text NOT NULL,
  model_provider text NOT NULL,
  model_name text NOT NULL,
  prompt_version text NOT NULL,
  dataset_ref text NOT NULL,
  sample_size integer NOT NULL CHECK (sample_size > 0),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  subgroup_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  passed boolean NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Settlement evidence
-- ---------------------------------------------------------------------------

CREATE TABLE settlement_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_id uuid NOT NULL,
  export_ref text NOT NULL,
  export_hash text NOT NULL,
  exported_by uuid NOT NULL,
  exported_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledgement_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES settlement_batches(tenant_id, id),
  FOREIGN KEY (tenant_id, exported_by) REFERENCES people(tenant_id, id)
);

CREATE TABLE settlement_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  export_id uuid NOT NULL,
  external_reference text NOT NULL,
  acknowledged_at timestamptz NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, export_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, export_id) REFERENCES settlement_exports(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Privacy and retention
-- ---------------------------------------------------------------------------

CREATE TABLE dpia_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  assessment_type text NOT NULL CHECK (assessment_type IN ('DPIA','PIPIA')),
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  risk_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  mitigation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

CREATE TABLE dsar_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('ACCESS','CORRECTION','DELETION','EXPLANATION','OBJECTION')),
  status text NOT NULL DEFAULT 'OPEN',
  received_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  resolved_at timestamptz,
  resolution_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id)
);

CREATE TABLE retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data_category text NOT NULL,
  retention_months integer NOT NULL CHECK (retention_months > 0),
  legal_basis text NOT NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, data_category),
  UNIQUE (tenant_id, id)
);

COMMIT;
