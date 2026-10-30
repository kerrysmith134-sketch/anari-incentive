-- Per-type deduction caps (PRD LG-06).
BEGIN;

ALTER TABLE employment_contracts
  ADD COLUMN deduction_type_caps jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE payroll_lines
  ADD COLUMN deduction_type_cap_passed boolean NOT NULL DEFAULT true,
  ADD COLUMN deduction_type_cap_breaches jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
