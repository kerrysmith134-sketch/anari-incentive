-- 081 (NPV2-010): ledger_exclusions was created in 078 without RLS even
-- though it is tenant-scoped; caught by scripts/migration-manifest.ts.
BEGIN;

ALTER TABLE ledger_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_exclusions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_or_platform_isolation ON ledger_exclusions;
CREATE POLICY tenant_or_platform_isolation ON ledger_exclusions
  USING (
    tenant_id =
      NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    tenant_id =
      NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'on'
  );

COMMIT;
