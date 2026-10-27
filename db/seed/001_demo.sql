-- Demo seed for the first PostgreSQL-backed vertical slice.
-- Fixed UUIDs match apps/api/src/policy-registry.ts and the test fixtures.

BEGIN;

INSERT INTO tenants (id, name, slug, default_currency)
VALUES ('00000000-0000-4000-8000-000000000001', 'Anari Demo', 'anari-demo', 'CNY')
ON CONFLICT (id) DO NOTHING;

INSERT INTO people (id, tenant_id, employee_code, display_name)
VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'E001', 'Owner'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'E002', 'Contributor'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'E003', 'Adjudicator')
ON CONFLICT (tenant_id, employee_code) DO NOTHING;

INSERT INTO evaluation_cycles (
  id, tenant_id, name, cycle_type, starts_at, ends_at, timezone, status
)
VALUES (
  '00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000001',
  'Demo monthly cycle',
  'MONTHLY',
  '2026-10-01T00:00:00Z',
  '2026-10-31T23:59:59Z',
  'Asia/Shanghai',
  'COLLECTING'
)
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO policy_versions (
  id, tenant_id, policy_code, version, scope, status,
  effective_from, rule_ast, rule_schema_version, content_hash,
  approved_by, approved_at, published_at
)
VALUES (
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000001',
  'ORDER_CONTRIBUTION_V1',
  1,
  '{"legalEntity":"anari-demo","jurisdiction":"CN","roles":["OWNER","CONTRIBUTOR"]}'::jsonb,
  'PUBLISHED',
  '2026-10-01T00:00:00Z',
  '{"code":"ORDER_CONTRIBUTION_V1","version":1,"currency":"CNY","poolRate":"0.05","poolCap":"100000","rounding":"HALF_UP","minimumWage":{"monthlyMinimum":"2690","checked":false}}'::jsonb,
  '1.0',
  'demo-policy-hash-v1',
  '00000000-0000-4000-8000-000000000003',
  '2026-10-01T00:00:00Z',
  '2026-10-01T00:00:00Z'
)
ON CONFLICT (tenant_id, policy_code, version) DO NOTHING;

INSERT INTO policy_versions (
  id, tenant_id, policy_code, version, scope, status,
  effective_from, rule_ast, rule_schema_version, content_hash,
  approved_by, approved_at, published_at
)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'CHARGING_PROJECT_CONTRIBUTION_V1',
  1,
  '{"legalEntity":"anari-demo","jurisdiction":"CN","projectTypes":["DC_FAST_CHARGING_STATION","PV_BESS_CHARGING"]}'::jsonb,
  'PUBLISHED',
  '2026-10-01T00:00:00Z',
  '{"code":"CHARGING_PROJECT_CONTRIBUTION_V1","version":1,"currency":"CNY","poolRate":"0.04","poolCap":"150000","rounding":"HALF_UP","cashCollectionWeight":"0.4","retentionHoldbackRate":"0.05","qualityGate":{"requireAcceptance":true,"blockOnSafetyIncident":true},"minimumWage":{"monthlyMinimum":"2690","checked":false}}'::jsonb,
  '1.0',
  'demo-policy-hash-charging-v1',
  '00000000-0000-4000-8000-000000000003',
  '2026-10-01T00:00:00Z',
  '2026-10-01T00:00:00Z'
)
ON CONFLICT (tenant_id, policy_code, version) DO NOTHING;

COMMIT;

-- Application role for RLS tests / local API. The role deliberately has
-- NOBYPASSRLS so tenant policies actually apply.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anari_app') THEN
    CREATE ROLE anari_app LOGIN PASSWORD 'anari_app' NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anari_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anari_app;
