-- ---------------------------------------------------------------------------
-- Payroll tax/social-insurance declarations and reversal
-- ---------------------------------------------------------------------------

ALTER TABLE employment_contracts
  ADD COLUMN tax_rate numeric(8,6) NOT NULL DEFAULT 0
    CHECK (tax_rate >= 0 AND tax_rate <= 1),
  ADD COLUMN social_insurance_rate numeric(8,6) NOT NULL DEFAULT 0
    CHECK (social_insurance_rate >= 0 AND social_insurance_rate <= 1),
  ADD COLUMN bank_account_ref text;

ALTER TABLE payroll_lines
  ADD COLUMN tax_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN social_insurance_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN bank_account_ref text;

ALTER TABLE payroll_runs
  ADD COLUMN total_tax numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN total_social_insurance numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversed_by uuid,
  ADD COLUMN reversal_reason text,
  ADD CONSTRAINT payroll_runs_reversed_by_fk
    FOREIGN KEY (tenant_id, reversed_by) REFERENCES people(tenant_id, id);

ALTER TABLE payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_status_check;
ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN ('DRAFT','CALCULATED','BLOCKED','APPROVED','PAID','REVERSED','CANCELLED'));
