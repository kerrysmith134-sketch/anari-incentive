-- 118：通用 JEV Decision Record（绩效 / 贡献 / 申诉 / 激励资格 / 预算）。
--
-- 一个案件（decision_cases.kind）走完整决策链：
--   evidence（append-only，内容 hash 承诺）
--     → judgments（独立判断：HUMAN / AI_MODEL，一人一判，不改写）
--     → verifications（利益冲突 / 证据覆盖 / 规则校验）
--     → records（最终决定，一案一条，不可改）
--
-- 关键约束：
-- - 子表冗余 tenant_id：既满足 RLS，也让 (tenant_id, case_id) 复合外键
--   把“跨租户引用”挡在数据库层；
-- - 证据/判断/校验/决定全部 append-only：UPDATE/DELETE 直接由触发器拒绝；
-- - 判断 (tenant_id, case_id, actor_type, actor_id) 唯一：同一 actor 一人一判；
-- - 证据 (tenant_id, case_id, source_type, source_id, content_hash) 唯一：
--   同一来源同一内容重复追加返回冲突，而不是堆叠不可审计副本；
-- - records (tenant_id, case_id) 唯一：一案一条，重复决定在并发下也只会成功一次。
--
-- 所有表强制 RLS，谓词为租户上下文 app.tenant_id。

CREATE TABLE decision_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL
    CHECK (kind IN (
      'PERFORMANCE','CONTRIBUTION','APPEAL','INCENTIVE_ELIGIBILITY','BUDGET'
    )),
  subject_type text NOT NULL CHECK (length(btrim(subject_type)) > 0),
  subject_id text NOT NULL CHECK (length(btrim(subject_id)) > 0),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','COLLECTING','READY','DECIDED','CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE decision_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  case_id uuid NOT NULL,
  source_type text NOT NULL CHECK (length(btrim(source_type)) > 0),
  source_id text NOT NULL CHECK (length(btrim(source_id)) > 0),
  content_hash text NOT NULL
    CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  supports text NOT NULL CHECK (supports IN ('FOR','AGAINST','NEUTRAL')),
  weight numeric(20,6) CHECK (weight IS NULL OR weight > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, case_id, source_type, source_id, content_hash),
  -- 审计历史不随案件级联删除：证据必须显式处理，不能被一次 DELETE 抹掉。
  FOREIGN KEY (tenant_id, case_id)
    REFERENCES decision_cases(tenant_id, id)
);

CREATE TABLE decision_judgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 写入顺序（不是业务字段）：同一毫秒内的多条判断必须有稳定先后。
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  case_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('HUMAN','AI_MODEL')),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  model_ref text,
  independent_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  independent_rationale text NOT NULL
    CHECK (length(btrim(independent_rationale)) > 0),
  dimension_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- 一人一判：同一 actor 在同一案件只能提交一次，永不覆盖。
  UNIQUE (tenant_id, case_id, actor_type, actor_id),
  -- AI 建议必须可追溯到具体模型/版本。
  CHECK (actor_type <> 'AI_MODEL' OR model_ref IS NOT NULL),
  FOREIGN KEY (tenant_id, case_id)
    REFERENCES decision_cases(tenant_id, id)
);

CREATE TABLE decision_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 写入顺序：决定时取最后一条，不能靠 verified_at 毫秒值 + 随机 id。
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  case_id uuid NOT NULL,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  passed boolean NOT NULL,
  verified_by text NOT NULL CHECK (length(btrim(verified_by)) > 0),
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, case_id)
    REFERENCES decision_cases(tenant_id, id)
);

CREATE TABLE decision_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  case_id uuid NOT NULL,
  final_judgment_id uuid NOT NULL,
  decided_by text NOT NULL CHECK (length(btrim(decided_by)) > 0),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  evidence_hash text NOT NULL
    CHECK (evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  version integer NOT NULL CHECK (version > 0),
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- 一案一条：最终决定不可改，也不能被第二条记录覆盖。
  UNIQUE (tenant_id, case_id),
  FOREIGN KEY (tenant_id, case_id)
    REFERENCES decision_cases(tenant_id, id),
  FOREIGN KEY (tenant_id, final_judgment_id)
    REFERENCES decision_judgments(tenant_id, id)
);

CREATE INDEX idx_decision_cases_tenant_kind
  ON decision_cases(tenant_id, kind, status);
CREATE INDEX idx_decision_cases_tenant_subject
  ON decision_cases(tenant_id, subject_type, subject_id);
CREATE INDEX idx_decision_evidence_case
  ON decision_evidence(tenant_id, case_id, created_at DESC);
CREATE INDEX idx_decision_judgments_case
  ON decision_judgments(tenant_id, case_id, seq);
CREATE INDEX idx_decision_verifications_case
  ON decision_verifications(tenant_id, case_id, seq);
CREATE INDEX idx_decision_records_tenant_decided
  ON decision_records(tenant_id, decided_at DESC);

-- 证据、判断、校验、决定都是审计事实：数据库层拒绝 UPDATE/DELETE。
CREATE OR REPLACE FUNCTION prevent_decision_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % rejected', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER trg_decision_evidence_append_only
BEFORE UPDATE OR DELETE ON decision_evidence
FOR EACH ROW EXECUTE FUNCTION prevent_decision_append_only_mutation();

CREATE TRIGGER trg_decision_judgments_append_only
BEFORE UPDATE OR DELETE ON decision_judgments
FOR EACH ROW EXECUTE FUNCTION prevent_decision_append_only_mutation();

CREATE TRIGGER trg_decision_verifications_append_only
BEFORE UPDATE OR DELETE ON decision_verifications
FOR EACH ROW EXECUTE FUNCTION prevent_decision_append_only_mutation();

CREATE TRIGGER trg_decision_records_append_only
BEFORE UPDATE OR DELETE ON decision_records
FOR EACH ROW EXECUTE FUNCTION prevent_decision_append_only_mutation();

ALTER TABLE decision_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_cases_isolation ON decision_cases
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE decision_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_evidence_isolation ON decision_evidence
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE decision_judgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_judgments FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_judgments_isolation ON decision_judgments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE decision_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_verifications_isolation ON decision_verifications
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE decision_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_records FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_records_isolation ON decision_records
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
