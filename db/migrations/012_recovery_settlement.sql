-- ---------------------------------------------------------------------------
-- Recovery settlements and employee confirmation
--
-- A RECOVERY batch may have a negative net total (clawback). Locking it
-- requires a CONFIRMED settlement confirmation from every person with a
-- negative line; an objection blocks the lock.
-- ---------------------------------------------------------------------------

ALTER TABLE settlement_batches
  ADD COLUMN kind text NOT NULL DEFAULT 'STANDARD'
  CHECK (kind IN ('STANDARD','RECOVERY'));

ALTER TABLE settlement_batches
  DROP CONSTRAINT settlement_batches_total_amount_check;
ALTER TABLE settlement_batches
  ADD CONSTRAINT settlement_batches_total_amount_check
  CHECK (total_amount >= 0 OR kind = 'RECOVERY');

ALTER TABLE employee_confirmations
  DROP CONSTRAINT employee_confirmations_target_type_check;
ALTER TABLE employee_confirmations
  ADD CONSTRAINT employee_confirmations_target_type_check
  CHECK (target_type IN ('EVALUATION','ATTRIBUTION','CALCULATION','LEDGER','SETTLEMENT'));
