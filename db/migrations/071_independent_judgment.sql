-- ATT-06: record the reviewer's independent judgment made BEFORE viewing
-- the AI draft (PRD: 人先独立判断，再看 AI).
BEGIN;

ALTER TABLE evaluation_decisions
  ADD COLUMN independent_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN independent_rationale text NOT NULL DEFAULT '',
  ADD COLUMN evidence_opened integer,
  ADD COLUMN review_started_at timestamptz;

COMMIT;
