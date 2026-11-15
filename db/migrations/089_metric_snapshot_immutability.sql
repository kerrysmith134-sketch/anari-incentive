-- NPV2.1: database-enforced integrity and immutability for metric measurement snapshots.
-- A snapshot may transition exactly once from FROZEN to CONSUMED when it is
-- bound to a same-tenant EvaluationDecision for the same person, cycle and
-- rubric version. No content/hash/identity fields may change during binding.

ALTER TABLE metric_measurement_snapshots
  ADD COLUMN linked_by_person_id uuid;

-- Pre-existing CONSUMED rows predate actor persistence. Do not fabricate the
-- linking actor: mark those historical rows explicitly as unknown. New rows
-- always default to false and must persist linked_by_person_id when consumed.
ALTER TABLE metric_measurement_snapshots
  ADD COLUMN legacy_linked_actor_unknown boolean NOT NULL DEFAULT false;

UPDATE metric_measurement_snapshots
   SET legacy_linked_actor_unknown = true
 WHERE status = 'CONSUMED'
   AND evaluation_decision_id IS NOT NULL
   AND linked_by_person_id IS NULL;

ALTER TABLE metric_measurement_snapshots
  ADD CONSTRAINT fk_metric_snapshot_cycle
  FOREIGN KEY (tenant_id, cycle_id)
  REFERENCES evaluation_cycles(tenant_id, id) NOT VALID;

ALTER TABLE metric_measurement_snapshots
  ADD CONSTRAINT fk_metric_snapshot_person
  FOREIGN KEY (tenant_id, person_id)
  REFERENCES people(tenant_id, id) NOT VALID;

ALTER TABLE metric_measurement_snapshots
  ADD CONSTRAINT fk_metric_snapshot_rubric
  FOREIGN KEY (tenant_id, rubric_version_id)
  REFERENCES rubrics(tenant_id, id) NOT VALID;

ALTER TABLE metric_measurement_snapshots
  ADD CONSTRAINT fk_metric_snapshot_frozen_by
  FOREIGN KEY (tenant_id, frozen_by)
  REFERENCES people(tenant_id, id) NOT VALID;

ALTER TABLE metric_measurement_snapshots
  ADD CONSTRAINT fk_metric_snapshot_linked_by
  FOREIGN KEY (tenant_id, linked_by_person_id)
  REFERENCES people(tenant_id, id) NOT VALID;

ALTER TABLE metric_measurement_snapshots
  ADD CONSTRAINT fk_metric_snapshot_evaluation_decision
  FOREIGN KEY (tenant_id, evaluation_decision_id)
  REFERENCES evaluation_decisions(tenant_id, id) NOT VALID;

ALTER TABLE metric_measurement_snapshots
  VALIDATE CONSTRAINT fk_metric_snapshot_cycle;
ALTER TABLE metric_measurement_snapshots
  VALIDATE CONSTRAINT fk_metric_snapshot_person;
ALTER TABLE metric_measurement_snapshots
  VALIDATE CONSTRAINT fk_metric_snapshot_rubric;
ALTER TABLE metric_measurement_snapshots
  VALIDATE CONSTRAINT fk_metric_snapshot_frozen_by;
ALTER TABLE metric_measurement_snapshots
  VALIDATE CONSTRAINT fk_metric_snapshot_linked_by;
ALTER TABLE metric_measurement_snapshots
  VALIDATE CONSTRAINT fk_metric_snapshot_evaluation_decision;

ALTER TABLE metric_measurement_snapshots
  ADD CONSTRAINT ck_metric_snapshot_status_binding
  CHECK (
    (status = 'FROZEN' AND evaluation_decision_id IS NULL AND linked_by_person_id IS NULL
      AND legacy_linked_actor_unknown = false)
    OR
    (status = 'CONSUMED' AND evaluation_decision_id IS NOT NULL
      AND ((linked_by_person_id IS NOT NULL AND legacy_linked_actor_unknown = false)
        OR (linked_by_person_id IS NULL AND legacy_linked_actor_unknown = true)))
  ) NOT VALID;

ALTER TABLE metric_measurement_snapshots
  VALIDATE CONSTRAINT ck_metric_snapshot_status_binding;

-- One evaluation decision consumes at most one metric snapshot.
CREATE UNIQUE INDEX uq_metric_snapshot_decision
  ON metric_measurement_snapshots (tenant_id, evaluation_decision_id)
  WHERE evaluation_decision_id IS NOT NULL;


-- Prevent bypassing the one-way state transition by inserting a row directly
-- in CONSUMED state. Every snapshot starts as FROZEN and is bound by a later
-- authorized transaction.
CREATE OR REPLACE FUNCTION guard_metric_measurement_snapshot_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'FROZEN'
     OR NEW.evaluation_decision_id IS NOT NULL
     OR NEW.linked_by_person_id IS NOT NULL
     OR NEW.legacy_linked_actor_unknown THEN
    RAISE EXCEPTION 'metric measurement snapshots must be inserted in FROZEN state'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_metric_snapshot_insert_frozen_only
  BEFORE INSERT ON metric_measurement_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION guard_metric_measurement_snapshot_insert();

CREATE OR REPLACE FUNCTION guard_metric_measurement_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_decision evaluation_decisions%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'metric measurement snapshots are append-only; DELETE is forbidden'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'FROZEN'
     AND NEW.status = 'CONSUMED'
     AND OLD.evaluation_decision_id IS NULL
     AND NEW.evaluation_decision_id IS NOT NULL
     AND OLD.linked_by_person_id IS NULL
     AND NEW.linked_by_person_id IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['status','evaluation_decision_id','linked_by_person_id']) =
         (to_jsonb(OLD) - ARRAY['status','evaluation_decision_id','linked_by_person_id']) THEN
    SELECT * INTO linked_decision
      FROM evaluation_decisions
     WHERE tenant_id = NEW.tenant_id
       AND id = NEW.evaluation_decision_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'metric snapshot decision must exist in the same tenant'
        USING ERRCODE = '23503';
    END IF;
    IF linked_decision.person_id <> NEW.person_id
       OR linked_decision.cycle_id <> NEW.cycle_id
       OR linked_decision.rubric_version_id <> NEW.rubric_version_id THEN
      RAISE EXCEPTION 'metric snapshot decision must match person, cycle and rubric version'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'metric measurement snapshot is immutable; only FROZEN -> CONSUMED binding is allowed'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_metric_snapshot_immutable_update
  BEFORE UPDATE OR DELETE ON metric_measurement_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION guard_metric_measurement_snapshot_update();

CREATE OR REPLACE FUNCTION guard_metric_measurement_snapshot_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'metric measurement snapshots cannot be truncated'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_metric_snapshot_no_truncate
  BEFORE TRUNCATE ON metric_measurement_snapshots
  FOR EACH STATEMENT
  EXECUTE FUNCTION guard_metric_measurement_snapshot_truncate();
