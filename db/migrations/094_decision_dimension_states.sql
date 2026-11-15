-- 094：D-03 零分认定的依据状态（dimensionStates）持久化。
-- 零分不再允许作为"未评"默认值：必须记录 ASSESSED 状态与独立理由。
ALTER TABLE evaluation_decisions
  ADD COLUMN IF NOT EXISTS dimension_states jsonb NOT NULL DEFAULT '{}'::jsonb;
