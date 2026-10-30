-- Deduction type/order breakdown on payroll (PRD LG-06 / INC-03).
BEGIN;

ALTER TABLE employment_contracts
  ADD COLUMN deduction_order jsonb NOT NULL
  DEFAULT '["RECOVERY","REVERSAL","ADJUSTMENT","OTHER"]'::jsonb;

ALTER TABLE payroll_lines
  ADD COLUMN deduction_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
