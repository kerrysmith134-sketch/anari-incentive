-- 120：JEV 服务端校验、版本绑定与业务引用。
--
-- 118 只记录了“有人提交过一次校验”，passed 由客户端声明，且校验没有绑定
-- 任何事实承诺。120 补齐三件事：
--
-- 1. 证据保留服务端复核副本（content text，标准 JSON）。content_hash 仍是
--    唯一承诺，但校验时必须能用 content 重算，才能发现“承诺在、内容被换掉”
--    的情况；用文本而不是 jsonb，避免数据库 numeric 规范化改变 JSON 文本，
--    也避免 jsonb null 与 SQL NULL 无法区分。详情接口默认不返回 content，
--    原始内容仍归来源系统。
-- 2. verification 绑定 case.version / evidence_hash / judgments_hash。
--    三者由服务端在 verify 时计算；decide 必须与最新通过校验完全一致。
--    校验行 append-only，不在原行上标记失效——旧绑定与新事实不一致即
--    “过期”（读取时派生 stale），任何补证/补判都会改变 hash/版本。
-- 3. decision_case_links：绩效评价/贡献认定/申诉/资格/预算可通过
--    POST /api/v1/decision-cases/:id/link 引用 caseId，GET 详情回传。
--    不在现有业务路由里强行写 case，跨模块耦合留在引用层。
--
-- 兼容性：118 已存在的行没有 content / 绑定，列保持可空；读取时视为
-- stale（必须重新校验后才能决定）。新写入由服务端全量填充。

ALTER TABLE decision_evidence
  ADD COLUMN content text;

COMMENT ON COLUMN decision_evidence.content IS
  '服务端复核副本（canonical JSON 文本）：仅用于重算 content_hash，详情接口不返回';

ALTER TABLE decision_verifications
  ADD COLUMN verified_case_version integer
    CHECK (verified_case_version IS NULL OR verified_case_version > 0),
  ADD COLUMN evidence_hash text
    CHECK (evidence_hash IS NULL OR evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN judgments_hash text
    CHECK (judgments_hash IS NULL OR judgments_hash ~ '^sha256:[0-9a-f]{64}$');

-- 绑定必须“要么全有、要么全无”：不允许只绑定证据却漏掉判断。
ALTER TABLE decision_verifications
  ADD CONSTRAINT decision_verifications_binding_complete
  CHECK (
    (verified_case_version IS NULL
      AND evidence_hash IS NULL
      AND judgments_hash IS NULL)
    OR
    (verified_case_version IS NOT NULL
      AND evidence_hash IS NOT NULL
      AND judgments_hash IS NOT NULL)
  );

COMMENT ON COLUMN decision_verifications.verified_case_version IS
  '校验完成后的 case.version（校验动作本身 +1）；追加证据/判断后不再相等';
COMMENT ON COLUMN decision_verifications.evidence_hash IS
  '校验时全部证据 content_hash 的聚合承诺';
COMMENT ON COLUMN decision_verifications.judgments_hash IS
  '校验时全部判断（人工 + AI，按写入顺序）的聚合承诺';

CREATE TABLE decision_case_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  case_id uuid NOT NULL,
  resource_type text NOT NULL
    CHECK (resource_type IN (
      'PERFORMANCE_EVALUATION',
      'CONTRIBUTION_ASSESSMENT',
      'APPEAL',
      'INCENTIVE_ELIGIBILITY',
      'BUDGET'
    )),
  resource_id text NOT NULL CHECK (length(btrim(resource_id)) > 0),
  note text CHECK (note IS NULL OR length(btrim(note)) > 0),
  linked_by text NOT NULL CHECK (length(btrim(linked_by)) > 0),
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- 同一业务对象只引用一次：重复 POST 返回冲突，而不是堆叠审计副本。
  UNIQUE (tenant_id, case_id, resource_type, resource_id),
  FOREIGN KEY (tenant_id, case_id)
    REFERENCES decision_cases(tenant_id, id)
);

CREATE INDEX idx_decision_case_links_case
  ON decision_case_links(tenant_id, case_id, linked_at DESC);
CREATE INDEX idx_decision_case_links_resource
  ON decision_case_links(tenant_id, resource_type, resource_id);

-- 引用也是审计事实：数据库层拒绝 UPDATE/DELETE（复用 118 的通用函数）。
CREATE TRIGGER trg_decision_case_links_append_only
BEFORE UPDATE OR DELETE ON decision_case_links
FOR EACH ROW EXECUTE FUNCTION prevent_decision_append_only_mutation();

ALTER TABLE decision_case_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_case_links FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_case_links_isolation ON decision_case_links
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
