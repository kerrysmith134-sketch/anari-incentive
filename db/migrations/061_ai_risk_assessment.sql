-- Deterministic AI risk classification and second-review SLA evidence.
BEGIN;

ALTER TABLE ai_score_proposals
  ADD COLUMN risk_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN risk_assessed_at timestamptz,
  ADD COLUMN second_review_due_at timestamptz,
  ADD COLUMN second_review_sla_breached boolean NOT NULL DEFAULT false;

COMMIT;
