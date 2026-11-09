-- 077: clawback cases need a state for "recovery already deducted".
-- Without it an approved case and a case whose deduction is already sitting in
-- a settlement batch look identical to reviewers.
BEGIN;

ALTER TABLE clawback_cases DROP CONSTRAINT IF EXISTS clawback_cases_status_check;
ALTER TABLE clawback_cases
  ADD CONSTRAINT clawback_cases_status_check
  CHECK (status IN ('DRAFT', 'APPROVED', 'RECOVERY_GENERATED', 'WAIVED', 'CANCELLED'));

-- Backfill: approved cases that already produced a recovery adjustment.
UPDATE clawback_cases AS c
   SET status = 'RECOVERY_GENERATED', updated_at = now()
 WHERE c.status = 'APPROVED'
   AND EXISTS (
     SELECT 1 FROM amount_ledger AS l
      WHERE l.idempotency_key = 'clawback-recovery:' || c.id::text
   );

COMMIT;
