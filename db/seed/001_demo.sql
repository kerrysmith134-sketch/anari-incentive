-- Demo seed for the first PostgreSQL-backed vertical slice.
-- Fixed UUIDs match apps/api/src/policy-registry.ts and the test fixtures.

BEGIN;

INSERT INTO tenants (id, name, slug, default_currency)
VALUES ('00000000-0000-4000-8000-000000000001', 'Anari Energy Demo', 'anari-energy-demo', 'CNY')
ON CONFLICT (id) DO NOTHING;

-- AUD-017/D-04：演示/试点租户显式开启扩展域（操作者动作；新租户默认 P0-only）。
UPDATE tenants
   SET settings = COALESCE(settings, '{}'::jsonb) || '{"modules": ["PAYROLL", "EQUITY", "STRATEGIC_POOL"], "settlementGo": true}'::jsonb
 WHERE id = '00000000-0000-4000-8000-000000000001';

INSERT INTO people (id, tenant_id, employee_code, display_name)
VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'E001', 'Sales Lead'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'E002', 'Product Manager'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'E003', 'Finance Reviewer')
ON CONFLICT (tenant_id, employee_code) DO NOTHING;

INSERT INTO evaluation_cycles (
  id, tenant_id, name, cycle_type, starts_at, ends_at, timezone, status
)
VALUES (
  '00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000001',
  '2026 Q4 charging equipment sales cycle',
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
  'GENERIC_CONTRIBUTION_V1',
  1,
  '{"legalEntity":"anari-demo","jurisdiction":"CN","roles":["OWNER","CONTRIBUTOR"]}'::jsonb,
  'PUBLISHED',
  '2026-10-01T00:00:00Z',
  '{"code":"GENERIC_CONTRIBUTION_V1","version":1,"currency":"CNY","poolRate":"0.05","poolCap":"100000","rounding":"HALF_UP","calculator":"SIMPLE_POOL","minimumWage":{"monthlyMinimum":"2690","checked":false}}'::jsonb,
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
  '{"code":"CHARGING_PROJECT_CONTRIBUTION_V1","version":1,"currency":"CNY","poolRate":"0.04","poolCap":"150000","rounding":"HALF_UP","cashCollectionWeight":"0.4","retentionHoldbackRate":"0.05","calculator":"CASH_WEIGHTED_RETENTION_POOL","qualityGate":{"requireAcceptance":true,"blockOnSafetyIncident":true},"minimumWage":{"monthlyMinimum":"2690","checked":false}}'::jsonb,
  '1.0',
  'demo-policy-hash-charging-v1',
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
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000001',
  'CHARGING_EQUIPMENT_SALES_V1',
  1,
  '{"legalEntity":"anari-demo","jurisdiction":"CN","salesModels":["DIRECT","CHANNEL"]}'::jsonb,
  'PUBLISHED',
  '2026-10-01T00:00:00Z',
  '{"code":"CHARGING_EQUIPMENT_SALES_V1","version":1,"currency":"CNY","poolRate":"0.035","poolCap":"120000","rounding":"HALF_UP","cashCollectionWeight":"0.5","afterSalesReserveRate":"0.03","calculator":"CASH_WEIGHTED_RESERVE_CHANNEL_POOL","creditGate":{"requireCreditApproval":true,"blockOnQualityHold":true},"minimumWage":{"monthlyMinimum":"2690","checked":false}}'::jsonb,
  '1.0',
  'demo-policy-hash-equipment-v1',
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
