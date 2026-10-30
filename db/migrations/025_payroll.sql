-- ---------------------------------------------------------------------------
-- HRIS contracts and payroll runs
--
-- Fixed salary and the legal minimum are declarations on the contract.
-- Payroll lines combine the fixed amount with LOCKED ledger entries for the
-- cycle and block approval when net pay falls below the declared minimum.
-- ---------------------------------------------------------------------------

CREATE TABLE employment_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  contract_code text NOT NULL,
  employment_type text NOT NULL
    CHECK (employment_type IN ('FULL_TIME','PART_TIME','CONTRACTOR')),
  start_date timestamptz NOT NULL,
  end_date timestamptz,
  work_location text NOT NULL,
  currency text NOT NULL,
  fixed_monthly_salary numeric(20,6) NOT NULL
    CHECK (fixed_monthly_salary >= 0),
  minimum_monthly_wage numeric(20,6) NOT NULL
    CHECK (minimum_monthly_wage >= 0),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','ENDED')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, contract_code),
  CHECK (end_date IS NULL OR end_date > start_date),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id)
);

CREATE TABLE payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','CALCULATED','BLOCKED','APPROVED','PAID','CANCELLED')),
  prepared_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  paid_at timestamptz,
  total_gross numeric(20,6) NOT NULL DEFAULT 0,
  total_deductions numeric(20,6) NOT NULL DEFAULT 0,
  total_net numeric(20,6) NOT NULL DEFAULT 0,
  line_count integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (period_end > period_start),
  FOREIGN KEY (tenant_id, prepared_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

CREATE TABLE payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  run_id uuid NOT NULL,
  person_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  currency text NOT NULL,
  fixed_amount numeric(20,6) NOT NULL,
  incentive_amount numeric(20,6) NOT NULL,
  gross_amount numeric(20,6) NOT NULL,
  deduction_amount numeric(20,6) NOT NULL CHECK (deduction_amount >= 0),
  net_amount numeric(20,6) NOT NULL,
  minimum_monthly_wage numeric(20,6) NOT NULL,
  minimum_wage_passed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES payroll_runs(tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, contract_id)
    REFERENCES employment_contracts(tenant_id, id)
);

CREATE INDEX idx_employment_contracts_person
  ON employment_contracts(tenant_id, person_id, start_date DESC);
CREATE INDEX idx_payroll_runs_cycle
  ON payroll_runs(tenant_id, cycle_id, created_at DESC);
CREATE INDEX idx_payroll_lines_run
  ON payroll_lines(tenant_id, run_id, person_id);

ALTER TABLE employment_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employment_contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON employment_contracts
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON payroll_runs
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

ALTER TABLE payroll_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON payroll_lines
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );
