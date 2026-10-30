-- ---------------------------------------------------------------------------
-- Equity grants and exercises
--
-- Grants carry a cliff/monthly vesting schedule. Exercises reserve vested
-- units and move through PENDING -> APPROVED -> SETTLED with separation of
-- duties between requester and approver.
-- ---------------------------------------------------------------------------

CREATE TABLE equity_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  grant_code text NOT NULL,
  grant_type text NOT NULL CHECK (grant_type IN ('OPTION','RSU','SAR')),
  total_units numeric(20,6) NOT NULL CHECK (total_units > 0),
  strike_price numeric(20,6) NOT NULL CHECK (strike_price >= 0),
  currency text NOT NULL,
  grant_date timestamptz NOT NULL,
  vesting_start timestamptz NOT NULL,
  cliff_months integer NOT NULL DEFAULT 0 CHECK (cliff_months >= 0),
  vesting_months integer NOT NULL CHECK (vesting_months > 0),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','CANCELLED','EXHAUSTED','EXPIRED')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, grant_code),
  CHECK (cliff_months <= vesting_months),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id)
);

CREATE TABLE equity_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  grant_id uuid NOT NULL,
  person_id uuid NOT NULL,
  units numeric(20,6) NOT NULL CHECK (units > 0),
  strike_price numeric(20,6) NOT NULL CHECK (strike_price >= 0),
  total_cost numeric(20,6) NOT NULL CHECK (total_cost >= 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','SETTLED','CANCELLED')),
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  settled_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, grant_id) REFERENCES equity_grants(tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

CREATE INDEX idx_equity_grants_person
  ON equity_grants(tenant_id, person_id, grant_date DESC);
CREATE INDEX idx_equity_exercises_grant
  ON equity_exercises(tenant_id, grant_id, created_at DESC);

ALTER TABLE equity_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON equity_grants
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

ALTER TABLE equity_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_exercises FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_platform_isolation ON equity_exercises
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );
