-- Explicit rationale for zero-scored dimensions, protecting unpriced work (PRD INC-06).
BEGIN;

ALTER TABLE ai_score_proposals
  ADD COLUMN zero_score_rationale text;

COMMIT;
