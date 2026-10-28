-- ---------------------------------------------------------------------------
-- Evidence submitter and tenant isolation
-- ---------------------------------------------------------------------------

ALTER TABLE evidence_nodes
  ADD COLUMN submitted_by uuid;

ALTER TABLE evidence_nodes
  ADD CONSTRAINT fk_evidence_submitter
  FOREIGN KEY (tenant_id, submitted_by) REFERENCES people(tenant_id, id);

ALTER TABLE evidence_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON evidence_nodes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON evidence_links
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
