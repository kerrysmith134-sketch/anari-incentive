-- ---------------------------------------------------------------------------
-- Tenant isolation for the remaining tenant-scoped tables
--
-- Tenant queries run with `app.tenant_id` set inside a transaction. The
-- dedicated platform pool sets `app.platform_admin=on` for platform/master-data
-- access. A missing context yields no rows.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'acceptances',
    'adjustment_records',
    'ai_score_proposals',
    'ai_suggestion_logs',
    'appeal_cases',
    'approval_decisions',
    'approval_requests',
    'budget_allocations',
    'budget_pools',
    'calculation_lines',
    'cash_gate_inputs',
    'claim_evidence_links',
    'deliverables',
    'dpia_records',
    'dsar_requests',
    'employee_confirmations',
    'employee_notices',
    'employee_representations',
    'external_identity_map',
    'financial_facts',
    'inbox_messages',
    'integration_connections',
    'legal_gate_records',
    'memberships',
    'metric_definitions',
    'model_evaluation_runs',
    'model_prompts',
    'org_nodes',
    'outbox_events',
    'people',
    'person_org_assignments',
    'policy_acknowledgements',
    'policy_consultations',
    'policy_notices',
    'policy_test_cases',
    'policy_test_runs',
    'raw_events',
    'recalculation_requests',
    'retention_policies',
    'rule_change_orders',
    'settlement_acknowledgements',
    'settlement_exports',
    'sync_runs',
    'webhook_inbox',
    'work_package_members',
    'work_package_versions',
    'workflow_runs'
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
