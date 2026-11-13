-- ---------------------------------------------------------------------------
-- NPV2-019: agent task steps and tool invocation records.
--
-- Each step (observe/plan/execute/verify) and each tool invocation gets its
-- own durable state with input/output hashes, retry count, executor identity
-- and duration. After a worker restart the interrupted RUNNING steps are
-- reset to PENDING (recoverable); task state and audit stay consistent.
-- ---------------------------------------------------------------------------

CREATE TABLE agent_task_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  task_id uuid NOT NULL,
  step_index integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('OBSERVE','PLAN','EXECUTE','VERIFY')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  input_hash text,
  output_hash text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  executed_by text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, task_id, step_index)
);

CREATE INDEX idx_agent_task_steps_task
  ON agent_task_steps(tenant_id, task_id, step_index);

CREATE TABLE agent_tool_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  task_id uuid NOT NULL,
  action_id uuid NOT NULL,
  tool text NOT NULL,
  risk_tier text NOT NULL CHECK (risk_tier IN ('T0','T1','T2','T3')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','EXECUTED','FAILED','REJECTED')),
  input_hash text NOT NULL,
  output_hash text,
  retries integer NOT NULL DEFAULT 0,
  executed_by text,
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE INDEX idx_agent_tool_invocations_task
  ON agent_tool_invocations(tenant_id, task_id);

ALTER TABLE agent_task_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_task_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_task_steps
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE agent_tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_invocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_tool_invocations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
