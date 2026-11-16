-- 095：NP-027 —— Evaluation Decision 的维度状态/数字分语义 DB 级约束。
-- 零分必须 ASSESSED；NOT_APPLICABLE / INSUFFICIENT_EVIDENCE 不得带正分；
-- 状态值只允许三枚举。
CREATE OR REPLACE FUNCTION guard_evaluation_decision_dimension_states()
RETURNS trigger AS $$
DECLARE
  dim text;
  state text;
  raw_score text;
BEGIN
  IF NEW.dimension_states IS NULL THEN
    RETURN NEW;
  END IF;
  FOR dim, state IN SELECT * FROM jsonb_each_text(NEW.dimension_states) LOOP
    IF state NOT IN ('ASSESSED', 'NOT_APPLICABLE', 'INSUFFICIENT_EVIDENCE') THEN
      RAISE EXCEPTION 'INVALID_DIMENSION_STATE: %=%', dim, state
        USING ERRCODE = '23514';
    END IF;
    raw_score := NEW.scores ->> dim;
    IF raw_score IS NOT NULL AND raw_score::numeric = 0 AND state <> 'ASSESSED' THEN
      RAISE EXCEPTION 'ZERO_SCORE_REQUIRES_ASSESSED_STATE: %', dim
        USING ERRCODE = '23514';
    END IF;
    IF state IN ('NOT_APPLICABLE', 'INSUFFICIENT_EVIDENCE')
       AND raw_score IS NOT NULL AND raw_score::numeric <> 0 THEN
      RAISE EXCEPTION 'DIMENSION_STATE_SCORE_CONFLICT: %', dim
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  -- 任何维度的 0 分都必须有 ASSESSED 状态。
  FOR dim, raw_score IN SELECT * FROM jsonb_each_text(NEW.scores) LOOP
    IF raw_score::numeric = 0
       AND COALESCE(NEW.dimension_states ->> dim, '') <> 'ASSESSED' THEN
      RAISE EXCEPTION 'ZERO_SCORE_REQUIRES_ASSESSED_STATE: %', dim
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_evaluation_decision_dimension_states ON evaluation_decisions;
CREATE TRIGGER trg_evaluation_decision_dimension_states
  BEFORE INSERT OR UPDATE ON evaluation_decisions
  FOR EACH ROW EXECUTE FUNCTION guard_evaluation_decision_dimension_states();
