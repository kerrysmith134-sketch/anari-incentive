-- External e-signature envelope adapter (PRD LG-05).
BEGIN;

CREATE TABLE esign_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_id uuid NOT NULL,
  provider text NOT NULL,
  envelope_ref text NOT NULL,
  document_hash text NOT NULL,
  signer_person_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'SENT'
    CHECK (status IN ('SENT','SIGNED','DECLINED','VOID')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  decline_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, envelope_ref),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES employment_contracts(tenant_id, id),
  FOREIGN KEY (tenant_id, signer_person_id) REFERENCES people(tenant_id, id)
);

ALTER TABLE esign_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_envelopes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON esign_envelopes
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
