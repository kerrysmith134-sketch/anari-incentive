-- Post-decision blind audit sampling for AI score reviews (PRD AI-03).
BEGIN;

ALTER TABLE ai_score_proposals
  ADD COLUMN audit_sample boolean NOT NULL DEFAULT false,
  ADD COLUMN audit_sampled_at timestamptz,
  ADD COLUMN second_reviewer_person_id uuid,
  ADD COLUMN second_independent_scores jsonb,
  ADD COLUMN second_independent_rationale text,
  ADD COLUMN second_review_started_at timestamptz,
  ADD COLUMN second_review_completed_at timestamptz,
  ADD COLUMN second_review_duration_seconds integer,
  ADD COLUMN second_review_evidence_opened integer,
  ADD COLUMN second_review_outcome text
    CHECK (second_review_outcome IN ('AGREE','DISAGREE')),
  ADD COLUMN second_review_agreement_rate numeric(20,6);

COMMIT;
