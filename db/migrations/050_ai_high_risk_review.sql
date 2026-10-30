-- Pre-decision second review for high-risk AI proposals (PRD AI-03).
BEGIN;

ALTER TABLE ai_score_proposals
  ADD COLUMN risk_tier text NOT NULL DEFAULT 'MEDIUM'
    CHECK (risk_tier IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  ADD COLUMN second_review_required boolean NOT NULL DEFAULT false;

COMMIT;
