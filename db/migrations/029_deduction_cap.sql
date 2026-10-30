-- Incentive guardrail: cap ledger deductions and keep the legal minimum wage (PRD LG-06 / INC-04).
BEGIN;

ALTER TABLE employment_contracts
  ADD COLUMN deduction_cap_rate numeric(20,6) NOT NULL DEFAULT 0.2
  CHECK (deduction_cap_rate >= 0 AND deduction_cap_rate <= 1);

ALTER TABLE payroll_lines
  ADD COLUMN deduction_cap_rate numeric(20,6) NOT NULL DEFAULT 0.2,
  ADD COLUMN deduction_cap_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN deduction_cap_passed boolean NOT NULL DEFAULT true;

COMMIT;
