-- ---------------------------------------------------------------------------
-- Policy test case run evidence
--
-- A golden case records the latest execution so the policy workbench can show
-- whether the case still passes without replaying history.
-- ---------------------------------------------------------------------------

ALTER TABLE policy_test_cases
  ADD COLUMN last_run_at timestamptz,
  ADD COLUMN last_run_passed boolean,
  ADD COLUMN last_run_result_hash text;
