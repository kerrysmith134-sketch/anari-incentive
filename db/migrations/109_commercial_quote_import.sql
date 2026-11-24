-- 109：Commercial Quote 外部 source-aware 导入身份。
ALTER TABLE commercial_quotes
  ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS external_quote_id text;

ALTER TABLE commercial_quotes
  DROP CONSTRAINT IF EXISTS uq_commercial_quotes_source_external;
ALTER TABLE commercial_quotes
  ADD CONSTRAINT uq_commercial_quotes_source_external
  UNIQUE (tenant_id, source_system, external_quote_id);
