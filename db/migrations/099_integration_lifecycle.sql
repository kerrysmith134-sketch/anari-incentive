-- 099：Integration 生命周期收尾（2026-11-21 审计 NP-020/021/027）。
--
-- 1) raw_source_records（NP-020）：不可变原始落地表——payload AES-256-GCM
--    密文、mapping 版本、retention 分类；replay 仅允许触碰 replayed_at；
--    同一原始记录可按新 mapping 版本重放而无需重新拉取。
-- 2) sync_resources 资源级租约（NP-021）：lease_owner/lease_until/
--    fencing_token——一个资源同一时刻只有一个 worker 持有；token 单调递增
--    作 fencing（旧持有者过期后写不过新持有者）。
-- 3) external_object_identities 生命周期（NP-027）：unlink_reason +
--    unlinked_by——终止映射时留下人工处置痕迹（valid_to 已有）。

-- 1) NP-020 raw landing
CREATE TABLE raw_source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  external_record_id text NOT NULL,
  payload_encrypted text NOT NULL,
  mapping_version integer NOT NULL DEFAULT 1,
  retention_class text NOT NULL DEFAULT 'DEFAULT'
    CHECK (retention_class IN ('DEFAULT','PII','FINANCIAL')),
  replayed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, external_record_id)
);
ALTER TABLE raw_source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_source_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON raw_source_records
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- append-only：DELETE 拒绝；UPDATE 仅允许 replayed_at（其余经济列冻结）。
CREATE OR REPLACE FUNCTION guard_raw_source_records_immutability()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RAW_SOURCE_RECORDS_APPEND_ONLY: DELETE is not allowed'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW.source_system <> OLD.source_system)
     OR (NEW.external_record_id <> OLD.external_record_id)
     OR (NEW.payload_encrypted <> OLD.payload_encrypted)
     OR (NEW.mapping_version <> OLD.mapping_version)
     OR (NEW.retention_class <> OLD.retention_class) THEN
    RAISE EXCEPTION 'RAW_SOURCE_RECORDS_IMMUTABLE: only replayed_at may change'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_raw_source_records_immutable ON raw_source_records;
CREATE TRIGGER trg_raw_source_records_immutable
  BEFORE UPDATE OR DELETE ON raw_source_records
  FOR EACH ROW EXECUTE FUNCTION guard_raw_source_records_immutability();

CREATE INDEX IF NOT EXISTS idx_raw_source_records_created
  ON raw_source_records(tenant_id, source_system, created_at DESC);

-- 2) NP-021 资源级租约
ALTER TABLE sync_resources
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS fencing_token bigint NOT NULL DEFAULT 0;

-- 3) NP-027 身份生命周期处置痕迹
ALTER TABLE external_object_identities
  ADD COLUMN IF NOT EXISTS unlink_reason text,
  ADD COLUMN IF NOT EXISTS unlinked_by uuid;

ALTER TABLE external_object_identities
  ADD CONSTRAINT fk_external_identities_unlinker
  FOREIGN KEY (tenant_id, unlinked_by)
  REFERENCES people(tenant_id, id) NOT VALID;
ALTER TABLE external_object_identities VALIDATE CONSTRAINT fk_external_identities_unlinker;
