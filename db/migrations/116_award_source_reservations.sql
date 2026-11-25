-- 116：奖励批次来源记录原子占用，杜绝并发下同一来源进入两个批次。
CREATE TABLE incentive_award_source_reservations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_record_id text NOT NULL,
  batch_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_record_id)
);

ALTER TABLE incentive_award_source_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_award_source_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON incentive_award_source_reservations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX incentive_award_source_reservations_batch_idx
  ON incentive_award_source_reservations (tenant_id, batch_id);
