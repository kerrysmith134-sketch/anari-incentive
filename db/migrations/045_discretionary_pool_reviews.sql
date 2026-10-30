-- Committee and employee-observer governance for discretionary pools (PRD INC-08).
BEGIN;

CREATE TABLE discretionary_pool_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  pool_id uuid NOT NULL,
  committee_person_ids jsonb NOT NULL,
  employee_observer_person_id uuid,
  selection_criteria text NOT NULL,
  decision_notes text NOT NULL,
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, pool_id) REFERENCES budget_pools(tenant_id, id),
  FOREIGN KEY (tenant_id, employee_observer_person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, reviewed_by) REFERENCES people(tenant_id, id)
);

ALTER TABLE discretionary_pool_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE discretionary_pool_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON discretionary_pool_reviews
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
