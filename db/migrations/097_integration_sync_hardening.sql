-- 097：Integration 同步管道加固（2026-11-21 审计 NP-016/NP-019）。
--
-- 1) sync_runs 补精确计数列（NP-016）：records_fetched / records_quarantined /
--    records_failed —— 运行计数与逐条结果精确对账（旧行 NULL 表示未记录）。
-- 2) 096 四表补租户复合外键（NP-019）：防跨租户引用
--    （mapping/schedule/checkpoint/run/审计 actor 的所有权约束）。

-- 1) NP-016 精确计数列
ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS records_fetched integer,
  ADD COLUMN IF NOT EXISTS records_quarantined integer,
  ADD COLUMN IF NOT EXISTS records_failed integer;

-- 2) NP-019 租户复合外键（NOT VALID 先建，随后 VALIDATE；跨租户脏数据会在此暴露）
ALTER TABLE sync_resources
  ADD CONSTRAINT fk_sync_resources_mapping
  FOREIGN KEY (tenant_id, mapping_id)
  REFERENCES integration_mappings(tenant_id, id) NOT VALID;
ALTER TABLE sync_resources
  ADD CONSTRAINT fk_sync_resources_schedule
  FOREIGN KEY (tenant_id, schedule_id)
  REFERENCES sync_schedules(tenant_id, id) NOT VALID;

ALTER TABLE sync_checkpoints
  ADD CONSTRAINT fk_sync_checkpoints_run
  FOREIGN KEY (tenant_id, last_run_id)
  REFERENCES sync_runs(tenant_id, id) NOT VALID;

ALTER TABLE external_object_identities
  ADD CONSTRAINT fk_external_identities_confirmer
  FOREIGN KEY (tenant_id, confirmed_by)
  REFERENCES people(tenant_id, id) NOT VALID;

ALTER TABLE ingestion_quarantine
  ADD CONSTRAINT fk_ingestion_quarantine_resolver
  FOREIGN KEY (tenant_id, resolved_by)
  REFERENCES people(tenant_id, id) NOT VALID;

ALTER TABLE sync_resources VALIDATE CONSTRAINT fk_sync_resources_mapping;
ALTER TABLE sync_resources VALIDATE CONSTRAINT fk_sync_resources_schedule;
ALTER TABLE sync_checkpoints VALIDATE CONSTRAINT fk_sync_checkpoints_run;
ALTER TABLE external_object_identities VALIDATE CONSTRAINT fk_external_identities_confirmer;
ALTER TABLE ingestion_quarantine VALIDATE CONSTRAINT fk_ingestion_quarantine_resolver;

-- 3) NP-009：webhook 不透明路由端点 + 原始载荷（加密列）。
CREATE TABLE IF NOT EXISTS integration_webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  connection_id uuid NOT NULL,
  routing_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connection_id),
  UNIQUE (routing_key),
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES integration_connections(tenant_id, id)
);
ALTER TABLE integration_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_webhook_endpoints_isolation ON integration_webhook_endpoints
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE webhook_inbox ADD COLUMN IF NOT EXISTS raw_payload_encrypted text;
