-- INC-03 real smoothing: raw vs smoothed incentive, mode/window/step controls.
BEGIN;

ALTER TABLE employment_contracts
  ADD COLUMN smoothing_mode text NOT NULL DEFAULT 'BLOCK',
  ADD COLUMN smoothing_window_periods integer NOT NULL DEFAULT 3,
  ADD COLUMN smoothing_max_step_rate numeric(10,6) NOT NULL DEFAULT 0.5;

ALTER TABLE payroll_lines
  ADD COLUMN raw_incentive_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN smoothed_incentive_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN smoothing_delta numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN smoothing_mode text NOT NULL DEFAULT 'BLOCK';

COMMIT;
