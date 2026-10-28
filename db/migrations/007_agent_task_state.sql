-- ---------------------------------------------------------------------------
-- Durable agent task state
--
-- agent_tasks already stores the queue envelope. These columns persist the
-- runtime's findings/actions/results and approval so a restarted API or worker
-- can rehydrate the task. Audit entries get their own append-only table.
-- ---------------------------------------------------------------------------

ALTER TABLE agent_tasks
  ADD COLUMN findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN results jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz;

CREATE TABLE agent_task_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  task_id uuid NOT NULL,
  action_id uuid,
  tool text,
  actor text NOT NULL,
  detail text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, task_id) REFERENCES agent_tasks(tenant_id, id)
);
CREATE INDEX idx_agent_task_audit_task
  ON agent_task_audit(tenant_id, task_id, occurred_at);

ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_tasks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE agent_task_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_task_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_task_audit
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
