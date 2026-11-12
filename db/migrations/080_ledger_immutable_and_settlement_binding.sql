-- 080 (NPV2-007/008): ledger immutability and settlement binding guarantees.
--
-- amount_ledger must be append-only at the database level: corrections are
-- new REVERSAL/ADJUSTMENT rows linked via source_entry_id, never in-place
-- edits. The only permitted UPDATE is the PROVISIONAL -> LOCKED status flip
-- performed by lockRun; amount and every economic column are frozen.
--
-- settlement_lines gains a partial unique index so one ledger entry can be
-- bound by at most one ACTIVE settlement line, even under concurrent sweeps;
-- cancelled lines release their entry for re-batching.
BEGIN;

CREATE OR REPLACE FUNCTION amount_ledger_append_only()
RETURNS trigger AS $$
BEGIN
  -- Deletions are never allowed.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'amount_ledger is append-only: DELETE % rejected', OLD.id;
  END IF;

  -- Economic columns are frozen after insert.
  IF NEW.tenant_id      IS DISTINCT FROM OLD.tenant_id
      OR NEW.person_id  IS DISTINCT FROM OLD.person_id
      OR NEW.cycle_id   IS DISTINCT FROM OLD.cycle_id
      OR NEW.calculation_run_id IS DISTINCT FROM OLD.calculation_run_id
      OR NEW.calculation_line_id IS DISTINCT FROM OLD.calculation_line_id
      OR NEW.entry_type IS DISTINCT FROM OLD.entry_type
      OR NEW.amount     IS DISTINCT FROM OLD.amount
      OR NEW.currency   IS DISTINCT FROM OLD.currency
      OR NEW.source_entry_id IS DISTINCT FROM OLD.source_entry_id
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.entry_hash IS DISTINCT FROM OLD.entry_hash
      OR NEW.prev_hash  IS DISTINCT FROM OLD.prev_hash
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.ledger_seq IS DISTINCT FROM OLD.ledger_seq THEN
    RAISE EXCEPTION 'amount_ledger % is immutable: economic columns cannot change', OLD.id;
  END IF;

  -- The only allowed transition is PROVISIONAL -> LOCKED.
  IF NEW.status <> 'LOCKED' OR OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'amount_ledger % status transition % -> % rejected',
      OLD.id, OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS amount_ledger_append_only_guard ON amount_ledger;
CREATE TRIGGER amount_ledger_append_only_guard
  BEFORE UPDATE OR DELETE ON amount_ledger
  FOR EACH ROW EXECUTE FUNCTION amount_ledger_append_only();

-- 一次性绑定：一条账本分录最多出现在一条 ACTIVE 结算行中。
CREATE UNIQUE INDEX IF NOT EXISTS settlement_lines_unique_active_binding
  ON settlement_lines (tenant_id, ledger_id)
  WHERE active;

COMMIT;
