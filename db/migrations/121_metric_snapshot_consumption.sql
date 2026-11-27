-- 121: 指标计量快照的「评分消费」凭证
--
-- 背景：018 score-from-facts 的正式评分必须把使用到的 FROZEN 快照一次性
-- 消费掉（同一存储方法内完成状态校验与写入），并把消费它的评分记录写进
-- 快照，形成 评分记录 → 快照 → 来源 的追溯链；评分记录落库失败时必须能
-- 补偿回滚，否则事实会被一次失败的计算烧掉。
--
-- 089 的约束只允许「评价决定绑定」这一种 CONSUMED 形态（evaluation_decision_id
-- 必填 + FK 指向 evaluation_decisions），而绩效评分记录存于
-- policy_engine_records，无法复用该列。本迁移新增评分消费专用的三列，
-- 放宽状态约束，并扩展不可变性触发器：只额外允许
--   FROZEN → CONSUMED（写 consumed_by_record_id）
--   CONSUMED → FROZEN（仅同一记录、且未绑定评价决定的补偿回滚）
-- 两种显式状态转换，其余 UPDATE/DELETE 仍然拒绝。

BEGIN;

ALTER TABLE metric_measurement_snapshots
  ADD COLUMN consumed_by_record_id text,
  ADD COLUMN consumed_by_person_id uuid,
  ADD COLUMN consumed_at timestamptz;

-- 消费人必须存在于同一租户；新列初始全为 NULL，校验对历史数据无影响。
ALTER TABLE metric_measurement_snapshots
  ADD CONSTRAINT fk_metric_snapshot_consumed_by_person
  FOREIGN KEY (tenant_id, consumed_by_person_id)
  REFERENCES people(tenant_id, id) NOT VALID;
ALTER TABLE metric_measurement_snapshots
  VALIDATE CONSTRAINT fk_metric_snapshot_consumed_by_person;

-- 一个评分记录最多消费一张快照（与 uq_metric_snapshot_decision 对称）。
CREATE UNIQUE INDEX uq_metric_snapshot_consumed_record
  ON metric_measurement_snapshots (tenant_id, consumed_by_record_id)
  WHERE consumed_by_record_id IS NOT NULL;

-- 状态绑定：FROZEN 不得携带任何消费凭证；CONSUMED 必须来自
-- 评价决定（原有形态）或评分记录（新增形态），二者互斥。
ALTER TABLE metric_measurement_snapshots
  DROP CONSTRAINT ck_metric_snapshot_status_binding;

ALTER TABLE metric_measurement_snapshots
  ADD CONSTRAINT ck_metric_snapshot_status_binding
  CHECK (
    (
      status = 'FROZEN'
      AND evaluation_decision_id IS NULL
      AND linked_by_person_id IS NULL
      AND legacy_linked_actor_unknown = false
      AND consumed_by_record_id IS NULL
      AND consumed_by_person_id IS NULL
      AND consumed_at IS NULL
    )
    OR
    (
      status = 'CONSUMED'
      AND (
        (
          evaluation_decision_id IS NOT NULL
          AND (
            (
              linked_by_person_id IS NOT NULL
              AND legacy_linked_actor_unknown = false
            )
            OR (
              linked_by_person_id IS NULL
              AND legacy_linked_actor_unknown = true
            )
          )
          AND consumed_by_record_id IS NULL
          AND consumed_by_person_id IS NULL
          AND consumed_at IS NULL
        )
        OR
        (
          evaluation_decision_id IS NULL
          AND consumed_by_record_id IS NOT NULL
          AND consumed_by_person_id IS NOT NULL
          AND consumed_at IS NOT NULL
          AND linked_by_person_id IS NULL
          AND legacy_linked_actor_unknown = false
        )
      )
    )
  ) NOT VALID;
ALTER TABLE metric_measurement_snapshots
  VALIDATE CONSTRAINT ck_metric_snapshot_status_binding;

-- 插入仍然只能是 FROZEN，且不能预置任何消费凭证。
CREATE OR REPLACE FUNCTION guard_metric_measurement_snapshot_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'FROZEN'
     OR NEW.evaluation_decision_id IS NOT NULL
     OR NEW.linked_by_person_id IS NOT NULL
     OR NEW.legacy_linked_actor_unknown
     OR NEW.consumed_by_record_id IS NOT NULL
     OR NEW.consumed_by_person_id IS NOT NULL
     OR NEW.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'metric measurement snapshots must be inserted in FROZEN state'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- 更新白名单：
--   A. FROZEN → CONSUMED（评价决定绑定，089 原语义）
--   B. FROZEN → CONSUMED（评分记录消费，新语义）
--   C. CONSUMED → FROZEN（仅限同一评分记录的补偿回滚，未绑定评价决定）
CREATE OR REPLACE FUNCTION guard_metric_measurement_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_decision evaluation_decisions%ROWTYPE;
  decision_binding boolean;
  score_binding boolean;
  score_release boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'metric measurement snapshots are append-only; DELETE is forbidden'
      USING ERRCODE = '55000';
  END IF;

  decision_binding :=
    OLD.status = 'FROZEN'
    AND NEW.status = 'CONSUMED'
    AND OLD.evaluation_decision_id IS NULL
    AND NEW.evaluation_decision_id IS NOT NULL
    AND OLD.linked_by_person_id IS NULL
    AND NEW.linked_by_person_id IS NOT NULL
    AND (to_jsonb(NEW) - ARRAY['status','evaluation_decision_id','linked_by_person_id']) =
        (to_jsonb(OLD) - ARRAY['status','evaluation_decision_id','linked_by_person_id']);

  score_binding :=
    OLD.status = 'FROZEN'
    AND NEW.status = 'CONSUMED'
    AND OLD.evaluation_decision_id IS NULL
    AND NEW.evaluation_decision_id IS NULL
    AND OLD.linked_by_person_id IS NULL
    AND NEW.linked_by_person_id IS NULL
    AND OLD.consumed_by_record_id IS NULL
    AND NEW.consumed_by_record_id IS NOT NULL
    AND NEW.consumed_by_person_id IS NOT NULL
    AND NEW.consumed_at IS NOT NULL
    AND (to_jsonb(NEW) - ARRAY['status','consumed_by_record_id','consumed_by_person_id','consumed_at']) =
        (to_jsonb(OLD) - ARRAY['status','consumed_by_record_id','consumed_by_person_id','consumed_at']);

  score_release :=
    OLD.status = 'CONSUMED'
    AND NEW.status = 'FROZEN'
    AND OLD.evaluation_decision_id IS NULL
    AND NEW.evaluation_decision_id IS NULL
    AND OLD.linked_by_person_id IS NULL
    AND NEW.linked_by_person_id IS NULL
    AND OLD.consumed_by_record_id IS NOT NULL
    AND NEW.consumed_by_record_id IS NULL
    AND NEW.consumed_by_person_id IS NULL
    AND NEW.consumed_at IS NULL
    AND (to_jsonb(NEW) - ARRAY['status','consumed_by_record_id','consumed_by_person_id','consumed_at']) =
        (to_jsonb(OLD) - ARRAY['status','consumed_by_record_id','consumed_by_person_id','consumed_at']);

  IF decision_binding THEN
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

  IF score_binding OR score_release THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'metric measurement snapshot is immutable; only FROZEN -> CONSUMED binding is allowed'
    USING ERRCODE = '55000';
END;
$$;

COMMIT;
