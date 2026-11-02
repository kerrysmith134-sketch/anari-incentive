-- Per-task reader/actor isolation (PRD AI-05).
BEGIN;

ALTER TABLE agent_tasks
  ADD COLUMN actor_role text CHECK (actor_role IN ('READER','ACTOR'));

COMMIT;
