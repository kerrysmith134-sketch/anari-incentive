-- Period-over-period incentive smoothing guard (PRD INC-03).
BEGIN;

ALTER TABLE employment_contracts
  ADD COLUMN smoothing_threshold_rate numeric(20,6) NOT NULL DEFAULT 1
  CHECK (smoothing_threshold_rate >= 0);

ALTER TABLE payroll_lines
  ADD COLUMN prior_incentive_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN incentive_change_rate numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN smoothing_threshold_rate numeric(20,6) NOT NULL DEFAULT 1,
  ADD COLUMN smoothing_passed boolean NOT NULL DEFAULT true;

COMMIT;
