-- P0-04: the seven PRD success metrics as versioned metric definitions.
-- Idempotent: only seeds when the tenant has no metric definitions.
INSERT INTO metric_definitions
  (tenant_id, code, version, name, description, data_type, unit,
   aggregation_method, source_contract, active, effective_from)
SELECT
  t.id, m.code, 1, m.name, m.description, m.data_type, m.unit,
  m.aggregation_method, m.source_contract::jsonb, true, DATE '2026-01-01'
FROM tenants t
CROSS JOIN (VALUES
  ('EVIDENCE_COVERAGE', '证据覆盖率', '已验收工作包中附有有效证据的占比', 'PERCENT', '%', 'AVG',
   '{"target": 70, "window": "cycle", "denominator": "accepted work packages"}'),
  ('EMPLOYEE_SUPPLEMENT_TIME', '员工补证时间', '员工每周期补充证据的耗时上限', 'MINUTES', '分钟', 'P90',
   '{"target": 30, "stretch": 15, "window": "cycle"}'),
  ('MANAGER_REVIEW_TIME', '经理复核时间', '经理完成一轮申报复核的耗时上限', 'HOURS', '小时', 'AVG',
   '{"target": 2, "window": "cycle"}'),
  ('DISPUTE_RATE', '贡献争议率', '申诉与复核占认定的比例', 'PERCENT', '%', 'AVG',
   '{"target": 10, "direction": "below", "window": "cycle"}'),
  ('RECONCILIATION_DIFFERENCES', '财务对账差异', '系统与独立参照的对账差异数', 'COUNT', '笔', 'SUM',
   '{"target": 0, "direction": "equal", "window": "cycle"}'),
  ('TRUST_BASELINE', '员工信任基线', '信任/程序公平调查维度均值不低于基线', 'SCORE', '分', 'AVG',
   '{"target": "baseline", "source": "trust_surveys", "window": "quarter"}'),
  ('FORMAL_GATE_PASS', '正式结算门禁通过率', 'FORMAL 结算前置门禁须 100% 通过', 'PERCENT', '%', 'AVG',
   '{"target": 100, "window": "cycle"}')
) AS m(code, name, description, data_type, unit, aggregation_method, source_contract)
WHERE NOT EXISTS (
  SELECT 1 FROM metric_definitions md WHERE md.tenant_id = t.id
);
