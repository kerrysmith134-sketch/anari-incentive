-- ---------------------------------------------------------------------------
-- Policy succession
--
-- Published policy content is immutable, but a published version's open
-- effective window must be closable when a successor version is published.
-- Only NULL -> timestamp is allowed, and the timestamp must be after the
-- version's effective_from. Once closed, effective_to cannot change.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_published_policy_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('APPROVED','PUBLISHED') AND (
       NEW.rule_ast IS DISTINCT FROM OLD.rule_ast
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.policy_code IS DISTINCT FROM OLD.policy_code
    OR NEW.version IS DISTINCT FROM OLD.version
  ) THEN
    RAISE EXCEPTION 'approved/published policy version % is immutable; create a new version', OLD.id;
  END IF;

  IF OLD.effective_to IS NOT NULL
     AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    RAISE EXCEPTION 'policy version % effective_to is immutable once closed', OLD.id;
  END IF;

  IF OLD.effective_to IS NULL
     AND NEW.effective_to IS NOT NULL
     AND NEW.effective_to <= OLD.effective_from THEN
    RAISE EXCEPTION 'policy version % effective_to must be after effective_from', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;
