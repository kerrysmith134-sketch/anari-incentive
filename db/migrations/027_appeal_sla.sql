-- Appeal SLA and evidence disclosure support (PRD ATT-07 / LG-10).
BEGIN;

ALTER TABLE appeal_cases
  ADD COLUMN due_at timestamptz;

UPDATE appeal_cases
   SET due_at = created_at + interval '10 days'
 WHERE due_at IS NULL;

COMMIT;
