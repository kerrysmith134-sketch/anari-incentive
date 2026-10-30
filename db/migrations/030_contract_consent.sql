-- Employment contract consent and versioned amendments (PRD LG-05).
BEGIN;

ALTER TABLE employment_contracts
  ADD COLUMN pay_plan_version integer NOT NULL DEFAULT 1,
  ADD COLUMN consent_signature_ref text,
  ADD COLUMN consent_signed_at timestamptz;

UPDATE employment_contracts
   SET consent_signature_ref = COALESCE(consent_signature_ref, 'LEGACY_IMPORT'),
       consent_signed_at = COALESCE(consent_signed_at, created_at)
 WHERE consent_signature_ref IS NULL OR consent_signed_at IS NULL;

ALTER TABLE employment_contracts
  ALTER COLUMN consent_signature_ref SET NOT NULL,
  ALTER COLUMN consent_signed_at SET NOT NULL;

CREATE TABLE employment_contract_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_id uuid NOT NULL,
  pay_plan_version integer NOT NULL,
  before_terms jsonb NOT NULL,
  after_terms jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  consent_signature_ref text NOT NULL,
  approved_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES employment_contracts(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

ALTER TABLE employment_contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employment_contract_amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON employment_contract_amendments
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
