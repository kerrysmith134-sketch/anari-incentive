-- 092：Agent 可观测性持久化事实（AUD-023）。
-- false-positive 人工标注 / 模型 token 用量 / AI-off 对照基线落库，
-- 使关键指标可从持久化事实自动计算（不再依赖外部手工输入冒充实时值）。

CREATE TABLE IF NOT EXISTS agent_feedback_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  task_id uuid,
  finding_ref text,
  label text NOT NULL CHECK (label IN ('CONFIRMED_POSITIVE','FALSE_POSITIVE','ESCALATED')),
  labeled_by uuid NOT NULL,
  model text,
  prompt_version text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, task_id, labeled_by, label)
);

CREATE TABLE IF NOT EXISTS agent_model_usage (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL,
  model text NOT NULL,
  requests bigint NOT NULL DEFAULT 0,
  prompt_tokens bigint NOT NULL DEFAULT 0,
  completion_tokens bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider, model)
);

CREATE TABLE IF NOT EXISTS agent_ai_off_baseline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  window_start date NOT NULL,
  window_end date NOT NULL,
  completion_rate numeric NOT NULL CHECK (completion_rate >= 0 AND completion_rate <= 1),
  sample_size integer NOT NULL CHECK (sample_size > 0),
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_feedback_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_feedback_labels FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_model_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_model_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_ai_off_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_ai_off_baseline FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_feedback_labels_tenant_isolation
  ON agent_feedback_labels
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY agent_model_usage_tenant_isolation
  ON agent_model_usage
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY agent_ai_off_baseline_tenant_isolation
  ON agent_ai_off_baseline
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
