-- 079: tenant isolation for tables added after 020.
-- policy_engine_records (072) and the award batch tables (073) carried a
-- tenant_id but no RLS, so any code path using the application role could read
-- every tenant's performance/equity payloads and award amounts.
BEGIN;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'policy_engine_records',
    'incentive_award_batches',
    'incentive_award_lines'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_or_platform_isolation ON %I',
      t
    );
    EXECUTE format($policy$
      CREATE POLICY tenant_or_platform_isolation ON %I
        USING (
          tenant_id =
            NULLIF(current_setting('app.tenant_id', true), '')::uuid
          OR current_setting('app.platform_admin', true) = 'on'
        )
        WITH CHECK (
          tenant_id =
            NULLIF(current_setting('app.tenant_id', true), '')::uuid
          OR current_setting('app.platform_admin', true) = 'on'
        )
    $policy$, t);
  END LOOP;
END $$;

COMMIT;
