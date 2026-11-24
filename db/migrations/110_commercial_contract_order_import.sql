-- 110：Commercial Contract / Order 外部 source-aware 导入身份。
ALTER TABLE commercial_contracts
  ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS external_contract_id text;
ALTER TABLE commercial_orders
  ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS external_order_id text;

ALTER TABLE commercial_contracts
  DROP CONSTRAINT IF EXISTS uq_commercial_contracts_source_external;
ALTER TABLE commercial_contracts
  ADD CONSTRAINT uq_commercial_contracts_source_external
  UNIQUE (tenant_id, source_system, external_contract_id);

ALTER TABLE commercial_orders
  DROP CONSTRAINT IF EXISTS uq_commercial_orders_source_external;
ALTER TABLE commercial_orders
  ADD CONSTRAINT uq_commercial_orders_source_external
  UNIQUE (tenant_id, source_system, external_order_id);
