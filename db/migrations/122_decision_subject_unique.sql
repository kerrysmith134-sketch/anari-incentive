-- 122：decision_cases 一对象一案（唯一建案）。
--
-- 缺口：正式评分的 JEV 衔接（score-from-facts → PERFORMANCE_SCORE）与评价
-- 决定建案都是两步：
--     findDecisionCaseBySubject（只读）→ createDecisionCase（写入）
-- 并发或重试时两个请求都可能查不到既有案件而各自插入，同一被决策对象出现
-- 两个案件：证据、独立判断与最终决定被拆到两条互不相连的审计链上，重复决定
-- 也不再被 (tenant_id, case_id) 唯一键挡住。
--
-- 本迁移在数据库层把「同一对象同一 kind 只能有一条活跃案件」变成硬约束，
-- 同时保留历史重复行的审计痕迹：
--
--   1. 清理：按 (tenant_id, kind, subject_type, subject_id) 分组，优先保留
--      已 DECIDED 的一条（最终决定不可被归档），其余取最早创建的一条；
--      其他重复行标记为 CANCELLED 且 version +1（变更留痕），不 DELETE。
--      删行会让 decision_evidence / judgments / verifications / records 的
--      复合外键与审计链失去宿主，因此只归档。
--   2. 唯一：UNIQUE (tenant_id, kind, subject_type, subject_id)，但只对
--      「活跃案件」（status <> 'CANCELLED'）生效。裸唯一约束会与第 1 步
--      保留的 CANCELLED 归档行冲突，而归档行必须保留；partial index 是
--      同时满足「不删除」与「并发只成功一次」的唯一做法。
--   3. 唯一键包含 kind：118 的设计是 kind 复用同一决策模型，同一个被决策
--      对象可以分别进入贡献认定、申诉等不同 kind 的案件（业务引用 /link
--      也按 kind 校验）；重复建案缺口针对的是同一对象、同一 kind。
--
-- 升级兼容：全新库没有重复行，清理为空操作；升级库的清理与索引创建在同一
-- 事务内，索引创建失败（清理后仍有重复）即整体回滚，不会留下半成品。
-- 清理按租户循环并设置事务内 app.tenant_id：decision_cases 是 FORCE RLS，
-- 以 schema owner 之外的角色执行时也不会因缺少租户上下文而静默漏清理。

DO $$
DECLARE
  tenant_row record;
  archived_rows bigint;
  total_archived bigint := 0;
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_row.id::text, true);

    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY tenant_id, kind, subject_type, subject_id
               ORDER BY (status = 'DECIDED') DESC, created_at ASC, id ASC
             ) AS duplicate_rank
        FROM decision_cases
       WHERE tenant_id = tenant_row.id
    )
    UPDATE decision_cases AS dc
       SET status = 'CANCELLED',
           version = dc.version + 1
      FROM ranked
     WHERE dc.id = ranked.id
       AND ranked.duplicate_rank > 1;

    GET DIAGNOSTICS archived_rows = ROW_COUNT;
    total_archived := total_archived + archived_rows;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);

  IF total_archived > 0 THEN
    RAISE NOTICE
      'migration 122: archived % duplicate decision case(s) as CANCELLED',
      total_archived;
  END IF;
END $$;

CREATE UNIQUE INDEX uq_decision_cases_active_subject
  ON decision_cases (tenant_id, kind, subject_type, subject_id)
  WHERE status <> 'CANCELLED';

COMMENT ON INDEX uq_decision_cases_active_subject IS
  '一对象一案：同一租户、同一 kind 的同一被决策对象只能有一条活跃案件；重复/并发建案返回已有案件，CANCELLED 为历史重复的归档态';
