-- Strategic / A-class pool cases with cost accounting and finance sign-off (INC-09).
BEGIN;

CREATE TABLE strategic_pool_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL,
  pool_amount numeric(20,6) NOT NULL,
  cap_amount numeric(20,6) NOT NULL,
  currency text NOT NULL,
  budget_pool_id uuid,
  rationale text NOT NULL,
  requested_by text NOT NULL,
  units int,
  unit_standard_cost numeric(20,6),
  total_standard_cost numeric(20,6),
  transfer_pricing_ref text,
  cost_reviewed_by text,
  cost_reviewed_at timestamptz,
  finance_approved_by text,
  finance_approved_at timestamptz,
  deferred_installment_months int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','COST_REVIEWED','FINANCE_APPROVED','ACTIVE','SETTLED','REJECTED')),
  rejected_reason text,
  activated_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX strategic_pool_cases_tenant_idx ON strategic_pool_cases(tenant_id, created_at DESC);

ALTER TABLE strategic_pool_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategic_pool_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON strategic_pool_cases
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
