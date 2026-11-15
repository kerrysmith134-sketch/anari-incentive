-- 091：通知幂等键（AUD-011/AUD-010 验收：同一逾期事项在同一 SLA 窗口
-- 只产生一条通知/待办）。幂等键对 (tenant_id, idempotency_key) 唯一，
-- 未提供键的通知不受约束（部分唯一索引）。
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_idempotency
  ON notifications (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_idempotency_lookup
  ON notifications (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
