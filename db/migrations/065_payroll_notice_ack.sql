-- Per-employee notice acknowledgement gate for payroll deductions (LG-04).
BEGIN;

ALTER TABLE payroll_lines
  ADD COLUMN notice_acknowledgement_passed boolean NOT NULL DEFAULT true,
  ADD COLUMN notice_acknowledgement_missing jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
