-- ---------------------------------------------------------------------------
-- Data-quality issue tenant isolation
-- ---------------------------------------------------------------------------

ALTER TABLE data_quality_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_quality_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON data_quality_issues
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
