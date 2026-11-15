-- ---------------------------------------------------------------------------
-- NPV2 AUD-020: contribution event data integrity and concurrent idempotency.
--
-- correction_of becomes a tenant-scoped composite FK (was a global FK that
-- allowed cross-tenant correction references); actor/subject get tenant
-- composite FKs to people; the table becomes append-only (UPDATE/DELETE
-- rejected). Concurrent duplicate external_id ingestion is handled by
-- ON CONFLICT at the store layer against the existing partial unique index.
-- ---------------------------------------------------------------------------

ALTER TABLE contribution_events
  DROP CONSTRAINT IF EXISTS contribution_events_correction_of_fkey;

ALTER TABLE contribution_events
  ADD CONSTRAINT fk_contribution_events_correction
  FOREIGN KEY (tenant_id, correction_of)
  REFERENCES contribution_events(tenant_id, id) NOT VALID;

ALTER TABLE contribution_events
  ADD CONSTRAINT fk_contribution_events_actor
  FOREIGN KEY (tenant_id, actor_person_id)
  REFERENCES people(tenant_id, id) NOT VALID;

ALTER TABLE contribution_events
  ADD CONSTRAINT fk_contribution_events_subject
  FOREIGN KEY (tenant_id, subject_person_id)
  REFERENCES people(tenant_id, id) NOT VALID;

ALTER TABLE contribution_events VALIDATE CONSTRAINT fk_contribution_events_correction;
ALTER TABLE contribution_events VALIDATE CONSTRAINT fk_contribution_events_actor;
ALTER TABLE contribution_events VALIDATE CONSTRAINT fk_contribution_events_subject;

CREATE OR REPLACE FUNCTION guard_contribution_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'contribution events are append-only; DELETE is forbidden'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'contribution events are append-only; UPDATE is forbidden (append a correction event instead)'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contribution_events_append_only
  BEFORE UPDATE OR DELETE ON contribution_events
  FOR EACH ROW
  EXECUTE FUNCTION guard_contribution_events_append_only();
