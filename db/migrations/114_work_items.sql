-- 114：Ticketing Canonical Work Item（PingCode / 通用 Ticketing）。
--
-- 工单系统的“工作项”此前只能作为 Evidence 落入 ingestion，无法承载状态
-- 历史与多人贡献，也无法跨来源去重。本迁移把它提升为一等实体：
--   - work_items：来源感知身份 (tenant, source_system, external_id) 唯一，
--     承载当前快照（标题/类型/优先级/状态/负责人/起止/权重/金额）；
--   - work_item_events：append-only 状态历史（from → to，发生时间、执行人）；
--     数据库触发器拒绝 UPDATE/DELETE，历史不可被“更新”覆盖；
--   - work_item_contributions：多人贡献（person_id + role + weight/ratio），
--     同一工作项同一角色同一人唯一。
--
-- 金额 numeric(20,6)、权重 numeric(20,6)，与财务事实/结算同一精度；
-- 币种只有 amount 存在时才要求（char(3) + 正则兜底）。
-- 全部表强制 RLS，策略谓词为租户上下文（app.tenant_id）。

CREATE TABLE work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  external_id text NOT NULL,
  project_id text NOT NULL,
  title text NOT NULL,
  type text NOT NULL
    CHECK (type IN ('STORY','TASK','BUG','EPIC','OTHER')),
  priority text
    CHECK (priority IS NULL OR priority IN ('LOW','MEDIUM','HIGH','URGENT')),
  status text NOT NULL
    CHECK (status IN ('OPEN','IN_PROGRESS','BLOCKED','DONE','CANCELLED')),
  assignee_person_id uuid,
  reporter_person_id uuid,
  started_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  weight numeric(20,6) CHECK (weight IS NULL OR weight > 0),
  currency char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  amount numeric(20,6),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- 来源感知身份：同一租户同一来源同一外部工单号只有一条规范工作项。
  UNIQUE (tenant_id, source_system, external_id),
  -- 有金额必须能说明币种；不允许“无币种金额”污染贡献/激励计算。
  CHECK (amount IS NULL OR currency IS NOT NULL),
  CHECK (
    completed_at IS NULL
    OR started_at IS NULL
    OR completed_at >= started_at
  )
);

CREATE TABLE work_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  work_item_id uuid NOT NULL,
  from_status text
    CHECK (
      from_status IS NULL
      OR from_status IN ('OPEN','IN_PROGRESS','BLOCKED','DONE','CANCELLED')
    ),
  to_status text NOT NULL
    CHECK (to_status IN ('OPEN','IN_PROGRESS','BLOCKED','DONE','CANCELLED')),
  occurred_at timestamptz NOT NULL,
  actor_person_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- 状态历史不随工作项级联删除：审计历史必须显式处理，不能被一次 DELETE 抹掉。
  FOREIGN KEY (tenant_id, work_item_id)
    REFERENCES work_items(tenant_id, id)
);

CREATE TABLE work_item_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  work_item_id uuid NOT NULL,
  person_id uuid NOT NULL,
  role text NOT NULL,
  weight numeric(20,6) CHECK (weight IS NULL OR weight > 0),
  ratio numeric(8,5) CHECK (ratio IS NULL OR (ratio >= 0 AND ratio <= 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- 同一工作项、同一人、同一角色只有一条贡献记录（导入幂等键）。
  UNIQUE (tenant_id, work_item_id, person_id, role),
  FOREIGN KEY (tenant_id, work_item_id)
    REFERENCES work_items(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_work_items_tenant_project
  ON work_items(tenant_id, project_id, status);
CREATE INDEX idx_work_items_tenant_assignee
  ON work_items(tenant_id, assignee_person_id)
  WHERE assignee_person_id IS NOT NULL;
CREATE INDEX idx_work_item_events_item
  ON work_item_events(tenant_id, work_item_id, occurred_at DESC);
CREATE INDEX idx_work_item_contributions_item
  ON work_item_contributions(tenant_id, work_item_id);
CREATE INDEX idx_work_item_contributions_person
  ON work_item_contributions(tenant_id, person_id);

-- 状态历史 append-only：任何 UPDATE/DELETE 由数据库直接拒绝，避免“改历史”。
CREATE OR REPLACE FUNCTION prevent_work_item_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'work_item_events is append-only: % rejected', TG_OP;
END;
$$;

CREATE TRIGGER trg_work_item_events_append_only
BEFORE UPDATE OR DELETE ON work_item_events
FOR EACH ROW EXECUTE FUNCTION prevent_work_item_event_mutation();

CREATE TRIGGER trg_work_items_updated_at
BEFORE UPDATE ON work_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_work_item_contributions_updated_at
BEFORE UPDATE ON work_item_contributions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_items FORCE ROW LEVEL SECURITY;
CREATE POLICY work_items_isolation ON work_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE work_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_item_events FORCE ROW LEVEL SECURITY;
CREATE POLICY work_item_events_isolation ON work_item_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE work_item_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_item_contributions FORCE ROW LEVEL SECURITY;
CREATE POLICY work_item_contributions_isolation ON work_item_contributions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
