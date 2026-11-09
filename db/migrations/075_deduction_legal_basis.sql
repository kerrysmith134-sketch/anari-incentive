-- LG-06: court-order / employee-consent evidence gate for statutory deductions.
BEGIN;

ALTER TABLE payroll_lines
  ADD COLUMN deduction_legal_basis_passed boolean NOT NULL DEFAULT true,
  ADD COLUMN deduction_legal_basis_missing text[] NOT NULL DEFAULT '{}';

COMMIT;
