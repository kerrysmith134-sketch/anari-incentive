-- 106：Commercial 领域实体（2026-11-21 审计 Sprint 3）。
--
-- Account → Opportunity → Quote(version) → Contract → Order → OrderLine。
-- CRM Deal 只能进入 Opportunity；Order 必须引用已签 Contract（应用层由
-- packages/domain/src/commercial.ts 校验，DB 只保证键与状态合法）。
--
-- 所有表强制 RLS；金额 numeric(20,6) 与财务事实同一精度。

CREATE TABLE commercial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  external_account_id text,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  owner_person_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, external_account_id)
);

CREATE TABLE commercial_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL,
  external_opportunity_id text,
  name text NOT NULL,
  stage text NOT NULL DEFAULT 'QUALIFIED'
    CHECK (stage IN ('PROSPECT','QUALIFIED','PROPOSAL','WON','LOST')),
  estimated_amount numeric(20,6),
  currency char(3) NOT NULL,
  owner_person_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, external_opportunity_id),
  FOREIGN KEY (tenant_id, account_id)
    REFERENCES commercial_accounts(tenant_id, id)
);

CREATE TABLE commercial_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  opportunity_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ISSUED','ACCEPTED','REJECTED','EXPIRED')),
  currency char(3) NOT NULL,
  amount numeric(20,6) NOT NULL,
  issued_at timestamptz,
  accepted_at timestamptz,
  supersedes_quote_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, opportunity_id, version),
  FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES commercial_opportunities(tenant_id, id)
);

CREATE TABLE commercial_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  contract_ref text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SIGNED','TERMINATED')),
  signed_at timestamptz,
  currency char(3) NOT NULL,
  amount numeric(20,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, contract_ref),
  FOREIGN KEY (tenant_id, account_id)
    REFERENCES commercial_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES commercial_opportunities(tenant_id, id),
  FOREIGN KEY (tenant_id, quote_id)
    REFERENCES commercial_quotes(tenant_id, id)
);

CREATE TABLE commercial_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  order_number text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED')),
  currency char(3) NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_number),
  FOREIGN KEY (tenant_id, account_id)
    REFERENCES commercial_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, contract_id)
    REFERENCES commercial_contracts(tenant_id, id)
);

CREATE TABLE commercial_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('PRODUCT','SERVICE','DISCOUNT','SURCHARGE')),
  description text NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  unit_price numeric(20,6) NOT NULL,
  amount numeric(20,6) NOT NULL,
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id)
    REFERENCES commercial_orders(tenant_id, id)
);

CREATE INDEX idx_commercial_accounts_tenant
  ON commercial_accounts(tenant_id, name);
CREATE INDEX idx_commercial_opportunities_tenant
  ON commercial_opportunities(tenant_id, account_id, stage);
CREATE INDEX idx_commercial_quotes_tenant
  ON commercial_quotes(tenant_id, opportunity_id, version DESC);
CREATE INDEX idx_commercial_contracts_tenant
  ON commercial_contracts(tenant_id, account_id, status);
CREATE INDEX idx_commercial_orders_tenant
  ON commercial_orders(tenant_id, account_id, status);
CREATE INDEX idx_commercial_order_lines_tenant
  ON commercial_order_lines(tenant_id, order_id);

ALTER TABLE commercial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_accounts_isolation ON commercial_accounts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE commercial_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_opportunities FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_opportunities_isolation ON commercial_opportunities
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE commercial_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_quotes_isolation ON commercial_quotes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE commercial_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_contracts_isolation ON commercial_contracts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE commercial_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_orders_isolation ON commercial_orders
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE commercial_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_order_lines_isolation ON commercial_order_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
