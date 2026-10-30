-- Future-dated employment-contract amendments (PRD LG-05).
BEGIN;

ALTER TABLE employment_contract_amendments
  ADD COLUMN status text NOT NULL DEFAULT 'APPLIED'
    CHECK (status IN ('APPLIED','SCHEDULED','CANCELLED')),
  ADD COLUMN applied_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancel_reason text;

UPDATE employment_contract_amendments
   SET applied_at = created_at
 WHERE applied_at IS NULL;

COMMIT;
