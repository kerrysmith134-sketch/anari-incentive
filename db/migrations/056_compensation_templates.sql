-- Role-specific compensation templates (PRD INC-02).
BEGIN;

CREATE TABLE compensation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name text NOT NULL,
  role_code text NOT NULL,
  employment_type text NOT NULL CHECK (employment_type IN
    ('FULL_TIME','PART_TIME','CONTRACTOR')),
  currency text NOT NULL,
  fixed_salary_min numeric(20,6) NOT NULL CHECK (fixed_salary_min >= 0),
  fixed_salary_max numeric(20,6) NOT NULL CHECK (fixed_salary_max >= fixed_salary_min),
  deduction_cap_rate numeric(20,6) NOT NULL DEFAULT 0.2
    CHECK (deduction_cap_rate >= 0 AND deduction_cap_rate <= 1),
  variable_share_cap_rate numeric(20,6) NOT NULL DEFAULT 1
    CHECK (variable_share_cap_rate >= 0 AND variable_share_cap_rate <= 1),
  smoothing_threshold_rate numeric(20,6) NOT NULL DEFAULT 1
    CHECK (smoothing_threshold_rate >= 0),
  deduction_order jsonb NOT NULL DEFAULT '["RECOVERY","REVERSAL","ADJUSTMENT","OTHER"]'::jsonb,
  deduction_type_caps jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE compensation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE compensation_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON compensation_templates
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

ALTER TABLE employment_contracts
  ADD COLUMN compensation_template_code text;

COMMIT;
