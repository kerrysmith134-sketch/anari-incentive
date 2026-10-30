-- Published policies must declare their legal/operational applicability (PRD LG-02).
BEGIN;

ALTER TABLE policy_versions
  ADD COLUMN applicability jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
