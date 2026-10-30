-- Guardrail: cap variable pay as a share of gross pay per contract (PRD INC-04).
BEGIN;

ALTER TABLE employment_contracts
  ADD COLUMN variable_share_cap_rate numeric(20,6) NOT NULL DEFAULT 1
  CHECK (variable_share_cap_rate >= 0 AND variable_share_cap_rate <= 1);

ALTER TABLE payroll_lines
  ADD COLUMN variable_share_rate numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN variable_share_cap_rate numeric(20,6) NOT NULL DEFAULT 1,
  ADD COLUMN variable_share_cap_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN variable_share_passed boolean NOT NULL DEFAULT true;

COMMIT;
