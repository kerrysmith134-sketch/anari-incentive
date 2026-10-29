-- ---------------------------------------------------------------------------
-- Data quality SLA and escalation
--
-- Issues can carry a remediation deadline and an explicit escalation record
-- without changing their lifecycle status.
-- ---------------------------------------------------------------------------

ALTER TABLE data_quality_issues
  ADD COLUMN due_at timestamptz,
  ADD COLUMN escalated_at timestamptz,
  ADD COLUMN escalation_reason text;
