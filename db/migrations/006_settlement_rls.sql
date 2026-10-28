-- ---------------------------------------------------------------------------
-- Settlement lines tenant isolation
--
-- settlement_batches already has RLS; lines must have the same protection
-- because they carry person-level amounts and are joined by the export.
-- ---------------------------------------------------------------------------

ALTER TABLE settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON settlement_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
