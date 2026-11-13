-- ---------------------------------------------------------------------------
-- NPV2-023: transactional outbox claims.
--
-- Claim/dispatch/mark-published with crash safety: a worker atomically claims
-- unpublished events (FOR UPDATE SKIP LOCKED) with a bounded lease; a crash
-- before mark-published leaves the claim to expire, after which another
-- worker can re-claim (events are never lost). Duplicate delivery is safe:
-- agent tasks are idempotent per event id.
-- ---------------------------------------------------------------------------

ALTER TABLE outbox_events
  ADD COLUMN claimed_by text,
  ADD COLUMN claimed_until timestamptz;

-- 候选索引：未发布且未被有效租约持有。
CREATE INDEX idx_outbox_claimable
  ON outbox_events(occurred_at, id)
  WHERE published_at IS NULL;
