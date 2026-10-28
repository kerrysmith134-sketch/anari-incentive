-- ---------------------------------------------------------------------------
-- Evaluation tenant isolation
--
-- Rubrics, drafts, decisions and cycles contain person-level ratings. Apply
-- the same tenant boundary as the money-path tables.
-- ---------------------------------------------------------------------------

ALTER TABLE evaluation_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_cycles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON evaluation_cycles
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubrics FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rubrics
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE evaluation_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON evaluation_drafts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE evaluation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON evaluation_decisions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
