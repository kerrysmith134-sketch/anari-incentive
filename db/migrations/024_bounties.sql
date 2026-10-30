-- ---------------------------------------------------------------------------
-- Bounty marketplace
--
-- OPEN -> CLAIMED -> SUBMITTED -> ACCEPTED, or CANCELLED before acceptance.
-- Acceptance requires a reviewer who is not the assignee; payment is an
-- external reference, not a ledger write.
-- ---------------------------------------------------------------------------

CREATE TABLE bounties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  title text NOT NULL,
  description text NOT NULL,
  reward_amount numeric(20,6) NOT NULL CHECK (reward_amount > 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CLAIMED','SUBMITTED','ACCEPTED','CANCELLED')),
  created_by uuid NOT NULL,
  due_at timestamptz,
  assignee_person_id uuid,
  claimed_at timestamptz,
  submission_ref text,
  submitted_at timestamptz,
  accepted_by uuid,
  accepted_at timestamptz,
  payment_ref text,
  cancelled_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, assignee_person_id)
    REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, accepted_by) REFERENCES people(tenant_id, id)
);

CREATE INDEX idx_bounties_status
  ON bounties(tenant_id, status, created_at DESC);

ALTER TABLE bounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON bounties
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );
