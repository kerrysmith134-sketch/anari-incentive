-- Human-in-the-loop AI review evidence (PRD AI-03).
BEGIN;

ALTER TABLE ai_score_proposals
  ADD COLUMN independent_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN independent_rationale text,
  ADD COLUMN review_started_at timestamptz,
  ADD COLUMN review_duration_seconds integer,
  ADD COLUMN evidence_opened integer NOT NULL DEFAULT 0,
  ADD COLUMN override boolean NOT NULL DEFAULT false,
  ADD COLUMN override_reason text,
  ADD COLUMN blind_review boolean NOT NULL DEFAULT false;

COMMIT;
