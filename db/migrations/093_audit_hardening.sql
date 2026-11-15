-- 093：审计加固批（P1/P2）——完整性、隔离与索引。
--
-- 1) agent_feedback_labels：task_id 为 NULL 的标注参与唯一去重
--    （PG15+ NULLS NOT DISTINCT；否则每个 finding-only 标注都会重复计数）。
-- 2) 新增表补租户复合外键（防跨租户引用）：草案/步骤/工具调用/待办/标注/基线。
-- 3) 082/083/084 三张租户面 HR 表移除 platform_admin 旁路（严格租户隔离）。
-- 4) contribution_events 补 BEFORE TRUNCATE 守卫（append-only 完整）。
-- 5) 删除冗余索引（notifications 幂等查找索引、steps 任务索引）。
-- 6) 补查询所需索引（events 时间序、标注/基线 created_at）。
-- 7) agent_ai_off_baseline 窗口顺序约束。
-- 8) 账本反冲唯一性：同一源分录只能反冲一次（部分唯一索引）。

-- 1) 标注唯一性（NULL task_id 视为同一值去重）
ALTER TABLE agent_feedback_labels
  DROP CONSTRAINT IF EXISTS agent_feedback_labels_tenant_id_task_id_labeled_by_label_key;
ALTER TABLE agent_feedback_labels
  ADD CONSTRAINT uq_agent_feedback_labels_label
  UNIQUE NULLS NOT DISTINCT (tenant_id, task_id, labeled_by, label);

-- 2) 租户复合外键（NOT VALID 先建，随后 VALIDATE；有跨租户脏数据会在此暴露）
ALTER TABLE contribution_assessment_drafts
  ADD CONSTRAINT fk_drafts_claim
  FOREIGN KEY (tenant_id, claim_id)
  REFERENCES contribution_claims(tenant_id, id) NOT VALID;
ALTER TABLE contribution_assessment_drafts
  ADD CONSTRAINT fk_drafts_subject
  FOREIGN KEY (tenant_id, subject_person_id)
  REFERENCES people(tenant_id, id) NOT VALID;
ALTER TABLE contribution_assessment_drafts
  ADD CONSTRAINT fk_drafts_decision
  FOREIGN KEY (tenant_id, attribution_decision_id)
  REFERENCES attribution_decisions(tenant_id, id) NOT VALID;

ALTER TABLE agent_task_steps
  ADD CONSTRAINT fk_agent_steps_task
  FOREIGN KEY (tenant_id, task_id)
  REFERENCES agent_tasks(tenant_id, id) NOT VALID;

ALTER TABLE agent_tool_invocations
  ADD CONSTRAINT fk_agent_invocations_task
  FOREIGN KEY (tenant_id, task_id)
  REFERENCES agent_tasks(tenant_id, id) NOT VALID;

ALTER TABLE agent_todos
  ADD CONSTRAINT fk_agent_todos_assignee
  FOREIGN KEY (tenant_id, assignee_person_id)
  REFERENCES people(tenant_id, id) NOT VALID;
ALTER TABLE agent_todos
  ADD CONSTRAINT fk_agent_todos_task
  FOREIGN KEY (tenant_id, created_by_agent_task_id)
  REFERENCES agent_tasks(tenant_id, id) NOT VALID;

ALTER TABLE agent_feedback_labels
  ADD CONSTRAINT fk_agent_labels_task
  FOREIGN KEY (tenant_id, task_id)
  REFERENCES agent_tasks(tenant_id, id) NOT VALID;
ALTER TABLE agent_feedback_labels
  ADD CONSTRAINT fk_agent_labels_person
  FOREIGN KEY (tenant_id, labeled_by)
  REFERENCES people(tenant_id, id) NOT VALID;

ALTER TABLE agent_ai_off_baseline
  ADD CONSTRAINT fk_agent_baseline_person
  FOREIGN KEY (tenant_id, recorded_by)
  REFERENCES people(tenant_id, id) NOT VALID;

ALTER TABLE contribution_assessment_drafts VALIDATE CONSTRAINT fk_drafts_claim;
ALTER TABLE contribution_assessment_drafts VALIDATE CONSTRAINT fk_drafts_subject;
ALTER TABLE contribution_assessment_drafts VALIDATE CONSTRAINT fk_drafts_decision;
ALTER TABLE agent_task_steps VALIDATE CONSTRAINT fk_agent_steps_task;
ALTER TABLE agent_tool_invocations VALIDATE CONSTRAINT fk_agent_invocations_task;
ALTER TABLE agent_todos VALIDATE CONSTRAINT fk_agent_todos_assignee;
ALTER TABLE agent_todos VALIDATE CONSTRAINT fk_agent_todos_task;
ALTER TABLE agent_feedback_labels VALIDATE CONSTRAINT fk_agent_labels_task;
ALTER TABLE agent_feedback_labels VALIDATE CONSTRAINT fk_agent_labels_person;
ALTER TABLE agent_ai_off_baseline VALIDATE CONSTRAINT fk_agent_baseline_person;

-- 3) 严格租户隔离（移除 platform_admin 旁路；这几张是租户面 HR 数据）
DROP POLICY IF EXISTS tenant_or_platform_isolation ON contribution_events;
CREATE POLICY tenant_isolation ON contribution_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_or_platform_isolation ON contribution_assessment_drafts;
CREATE POLICY tenant_isolation ON contribution_assessment_drafts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_or_platform_isolation ON metric_measurement_snapshots;
CREATE POLICY tenant_isolation ON metric_measurement_snapshots
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- 4) append-only 补 TRUNCATE 守卫
CREATE OR REPLACE FUNCTION guard_contribution_events_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CONTRIBUTION_EVENTS_APPEND_ONLY: TRUNCATE is not allowed'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contribution_events_no_truncate ON contribution_events;
CREATE TRIGGER trg_contribution_events_no_truncate
  BEFORE TRUNCATE ON contribution_events
  FOR EACH STATEMENT EXECUTE FUNCTION guard_contribution_events_truncate();

-- 5) 冗余索引
DROP INDEX IF EXISTS idx_notifications_idempotency_lookup;
DROP INDEX IF EXISTS idx_agent_task_steps_task;

-- 6) 查询索引
CREATE INDEX IF NOT EXISTS idx_contribution_events_occurred
  ON contribution_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_feedback_labels_created
  ON agent_feedback_labels(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_ai_off_baseline_created
  ON agent_ai_off_baseline(tenant_id, created_at DESC);

-- 7) AI-off 基线窗口顺序
ALTER TABLE agent_ai_off_baseline
  ADD CONSTRAINT chk_agent_baseline_window
  CHECK (window_end >= window_start);

-- 8) 反冲唯一性：同一源分录只能被反冲一次
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_reversal_source
  ON amount_ledger(tenant_id, source_entry_id)
  WHERE entry_type = 'REVERSAL';
