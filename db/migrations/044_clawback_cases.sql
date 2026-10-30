-- Clawback terms, consent and hardship/installment handling (PRD INC-10).
BEGIN;

CREATE TABLE clawback_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  reason_code text NOT NULL,
  explanation text NOT NULL,
  consent_signature_ref text NOT NULL,
  installment_months integer NOT NULL DEFAULT 1
    CHECK (installment_months BETWEEN 1 AND 12),
  hardship_waiver boolean NOT NULL DEFAULT false,
  hardship_reason text,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','APPROVED','WAIVED','CANCELLED')),
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  waived_at timestamptz,
  waiver_reason text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

ALTER TABLE clawback_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE clawback_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON clawback_cases
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
