-- ---------------------------------------------------------------------------
-- NPV2-018: agent task leases — atomic claim / lease / CAS.
--
-- Task execution moves from in-process maps to database claims: a worker
-- claims a ready task with FOR UPDATE SKIP LOCKED, holds a lease for a
-- bounded time, and mutates the task under a version check (CAS). Expired
-- leases are recoverable: a RUNNING task whose lease has lapsed can be
-- re-queued by another worker. Two workers racing on the same task: only
-- one claim wins.
-- ---------------------------------------------------------------------------

ALTER TABLE agent_tasks
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN version integer NOT NULL DEFAULT 1;

ALTER TABLE agent_tasks
  ADD CONSTRAINT agent_tasks_version_positive CHECK (version > 0);

-- 候选队列索引：可领取状态（租约有效性在查询里过滤——now() 非 IMMUTABLE
-- 不能进索引谓词）。
CREATE INDEX idx_agent_tasks_claimable
  ON agent_tasks(tenant_id, created_at, id)
  WHERE status IN ('QUEUED','RETRY_PENDING');
