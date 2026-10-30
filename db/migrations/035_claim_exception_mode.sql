-- Contribution exception/backfill provenance (PRD ATT-03).
BEGIN;

ALTER TABLE contribution_claims
  ADD COLUMN claim_mode text NOT NULL DEFAULT 'STANDARD'
    CHECK (claim_mode IN ('STANDARD','EXCEPTION','BACKFILL')),
  ADD COLUMN exception_reason text;

ALTER TABLE contribution_claims
  ADD CONSTRAINT contribution_claim_exception_reason_check
  CHECK (claim_mode = 'STANDARD' OR exception_reason IS NOT NULL);

COMMIT;
