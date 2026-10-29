-- ---------------------------------------------------------------------------
-- Platform identity: one user maps to at most one person per tenant
--
-- `people.user_id` links an employee record to a platform login. Identity
-- resolution (`GET /platform/identity`) returns a single personId, so the
-- link must be unique within a tenant. Unlinked people are unconstrained.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX uq_people_tenant_user
  ON people (tenant_id, user_id)
  WHERE user_id IS NOT NULL;
