-- N-Perform money-path invariants, immutability, audit chain and RLS.
-- These are release-gate controls, not optional hardening.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Non-overlapping effective periods
-- ---------------------------------------------------------------------------

ALTER TABLE policy_versions
  ADD CONSTRAINT ex_policy_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    policy_code WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  );

ALTER TABLE person_org_assignments
  ADD CONSTRAINT ex_person_org_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    person_id WITH =,
    daterange(valid_from, valid_to, '[)') WITH &&
  );

ALTER TABLE work_package_members
  ADD CONSTRAINT ex_wp_member_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    work_package_id WITH =,
    person_id WITH =,
    tstzrange(active_from, active_to, '[)') WITH &&
  );

-- ---------------------------------------------------------------------------
-- 2. Locked ledger entries are immutable
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_locked_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'LOCKED' THEN
      RAISE EXCEPTION 'locked ledger entry % cannot be deleted', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  -- Any update of a locked row is forbidden. Corrections must be new rows.
  IF OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'locked ledger entry % is immutable; append an adjustment or reversal', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_amount_ledger_immutable
BEFORE UPDATE OR DELETE ON amount_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_locked_ledger_mutation();

-- ---------------------------------------------------------------------------
-- 3. Audit events are append-only and hash-chained
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER trg_audit_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE OR REPLACE FUNCTION compute_audit_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  last_hash text;
  last_sequence bigint;
BEGIN
  -- Serialise chain appends per tenant. This prevents two concurrent inserts
  -- from reading the same predecessor.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text)::bigint);

  SELECT event_hash, sequence
    INTO last_hash, last_sequence
    FROM audit_events
   WHERE tenant_id = NEW.tenant_id
   ORDER BY sequence DESC
   LIMIT 1;

  NEW.sequence := COALESCE(last_sequence, 0) + 1;
  NEW.prev_hash := COALESCE(last_hash, 'GENESIS');
  NEW.event_hash := encode(
    digest(
      NEW.prev_hash || '|' || NEW.tenant_id::text || '|' || NEW.action || '|' ||
      COALESCE(NEW.object_type, '') || '|' || COALESCE(NEW.object_id::text, '') || '|' ||
      COALESCE(NEW.before_hash, '') || '|' || COALESCE(NEW.after_hash, '') || '|' ||
      COALESCE(NEW.correlation_id::text, '') || '|' || NEW.occurred_at::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_chain
BEFORE INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION compute_audit_chain();

-- ---------------------------------------------------------------------------
-- 4. Settlement lines must reference a locked, matching ledger entry
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assert_settlement_line_ledger_locked()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ledger amount_ledger%ROWTYPE;
BEGIN
  SELECT * INTO ledger
    FROM amount_ledger
   WHERE tenant_id = NEW.tenant_id AND id = NEW.ledger_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger entry % not found', NEW.ledger_id;
  END IF;
  IF ledger.status <> 'LOCKED' THEN
    RAISE EXCEPTION 'settlement requires a locked ledger entry; % is %', ledger.id, ledger.status;
  END IF;
  IF ledger.person_id <> NEW.person_id
     OR ledger.amount <> NEW.amount
     OR ledger.currency <> NEW.currency THEN
    RAISE EXCEPTION 'settlement line does not match ledger entry %', ledger.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlement_line_ledger
BEFORE INSERT OR UPDATE ON settlement_lines
FOR EACH ROW EXECUTE FUNCTION assert_settlement_line_ledger_locked();

CREATE OR REPLACE FUNCTION recompute_settlement_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_tenant uuid;
  target_batch uuid;
BEGIN
  target_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
  target_batch := COALESCE(NEW.batch_id, OLD.batch_id);

  UPDATE settlement_batches b
     SET total_amount = COALESCE((
           SELECT SUM(sl.amount)
             FROM settlement_lines sl
            WHERE sl.tenant_id = b.tenant_id
              AND sl.batch_id = b.id
              AND sl.active
         ), 0),
         line_count = (
           SELECT COUNT(*)
             FROM settlement_lines sl
            WHERE sl.tenant_id = b.tenant_id
              AND sl.batch_id = b.id
              AND sl.active
         )
   WHERE b.tenant_id = target_tenant
     AND b.id = target_batch;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_settlement_totals
AFTER INSERT OR UPDATE OR DELETE ON settlement_lines
FOR EACH ROW EXECUTE FUNCTION recompute_settlement_totals();

-- ---------------------------------------------------------------------------
-- 5. Published policy versions are immutable
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_published_policy_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('APPROVED','PUBLISHED') AND (
       NEW.rule_ast IS DISTINCT FROM OLD.rule_ast
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
    OR NEW.policy_code IS DISTINCT FROM OLD.policy_code
    OR NEW.version IS DISTINCT FROM OLD.version
  ) THEN
    RAISE EXCEPTION 'approved/published policy version % is immutable; create a new version', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_policy_immutable
BEFORE UPDATE ON policy_versions
FOR EACH ROW EXECUTE FUNCTION prevent_published_policy_edit();

-- ---------------------------------------------------------------------------
-- 6. Approval consumption guard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assert_approval_consumption()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL THEN
    IF OLD.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'approval % must be APPROVED before consumption', OLD.id;
    END IF;
    IF NEW.consumed_by IS NULL THEN
      RAISE EXCEPTION 'approval % consumption requires consumed_by', OLD.id;
    END IF;
  END IF;
  IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
    RAISE EXCEPTION 'approval % has already been consumed', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_approval_consumption
BEFORE UPDATE ON approval_requests
FOR EACH ROW EXECUTE FUNCTION assert_approval_consumption();

-- ---------------------------------------------------------------------------
-- 7. updated_at helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_packages_updated_at
BEFORE UPDATE ON work_packages
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_claims_updated_at
BEFORE UPDATE ON contribution_claims
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_calc_runs_updated_at
BEFORE UPDATE ON calculation_runs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_settlement_batches_updated_at
BEFORE UPDATE ON settlement_batches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Additional indexes for money-path queries
-- ---------------------------------------------------------------------------

CREATE INDEX idx_calculation_lines_run_person
  ON calculation_lines(tenant_id, calculation_run_id, person_id);

CREATE INDEX idx_settlement_lines_batch_status
  ON settlement_lines(tenant_id, batch_id, status);

CREATE INDEX idx_approval_requests_pending
  ON approval_requests(tenant_id, status, created_at);

CREATE INDEX idx_employee_confirmations_pending
  ON employee_confirmations(tenant_id, person_id, confirmed_at)
  WHERE confirmed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 9. Row-level security for core tenant tables
--
-- The application role must be NOBYPASSRLS and must set:
--   SET LOCAL app.tenant_id = '<uuid>';
-- at the start of each transaction. Missing context yields no rows.
-- Remaining tenant tables should be added before productisation.
-- ---------------------------------------------------------------------------

ALTER TABLE work_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_packages
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE contribution_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contribution_claims
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE attribution_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attribution_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attribution_decisions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON policy_versions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE calculation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calculation_runs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE amount_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE amount_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON amount_ledger
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE settlement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON settlement_batches
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
