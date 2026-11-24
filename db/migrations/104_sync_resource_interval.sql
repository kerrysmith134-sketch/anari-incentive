-- 104：资源级调度间隔（2026-11-21 审计 P1 / INT-212）。
--
-- Runner 曾读取 checkpoint.intervalOverrideMinutes，但该字段既没有数据库列，
-- 也不在 checkpoint API 响应中——节流分支实际是死代码。本迁移把资源级
-- 调度间隔落到 sync_resources，并由 checkpoint 响应回传。

ALTER TABLE sync_resources
  ADD COLUMN IF NOT EXISTS interval_minutes integer;

ALTER TABLE sync_resources
  DROP CONSTRAINT IF EXISTS chk_sync_resources_interval_minutes;
ALTER TABLE sync_resources
  ADD CONSTRAINT chk_sync_resources_interval_minutes
  CHECK (interval_minutes IS NULL OR interval_minutes > 0);
