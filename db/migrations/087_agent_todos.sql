-- ---------------------------------------------------------------------------
-- NPV2-020: persistent agent todos (follow-up tasks).
--
-- Agent-created todos are durable business objects: assignee, dueAt, linked
-- target, idempotency key and source (agent task/finding). Business UI can
-- list, complete and verify them; duplicate create_todo calls with the same
-- (tenant, idempotency_key) do not create duplicates.
-- ---------------------------------------------------------------------------

CREATE TABLE agent_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  title text NOT NULL,
  detail text,
  assignee_person_id uuid NOT NULL,
  due_at timestamptz,
  target_type text,
  target_id text,
  source_type text NOT NULL,
  source_id text NOT NULL,
  idempotency_key text NOT NULL,
  created_by_agent_task_id uuid,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','DONE','CANCELLED')),
  completed_by_person_id uuid,
  completed_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX idx_agent_todos_idempotency
  ON agent_todos(tenant_id, idempotency_key);

CREATE INDEX idx_agent_todos_assignee
  ON agent_todos(tenant_id, assignee_person_id, status);

ALTER TABLE agent_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_todos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_todos
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
