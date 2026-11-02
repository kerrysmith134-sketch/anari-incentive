-- Employing legal entity on employment contracts (SEC-03 sameLegalEntity).
BEGIN;

ALTER TABLE employment_contracts
  ADD COLUMN legal_entity text;

COMMIT;
