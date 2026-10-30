-- Human-only PIP / adverse-action workflow (PRD LG-07).
BEGIN;

CREATE TABLE adverse_action_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN
    ('PIP','TRAINING','REASSIGNMENT','DEMOTION','PAY_REDUCTION','TERMINATION')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','LEGAL_REVIEW','APPROVED','REJECTED','ACTIVE','COMPLETED','CANCELLED')),
  reason text NOT NULL,
  performance_basis text NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by uuid NOT NULL,
  legal_reviewer_id uuid,
  legal_review_ref text,
  legal_reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  effective_from timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, legal_reviewer_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

ALTER TABLE adverse_action_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE adverse_action_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON adverse_action_cases
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
