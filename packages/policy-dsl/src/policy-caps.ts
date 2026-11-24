import type { PerformancePeriod } from "@anari/domain";

/**
 * 绩效周期上限的唯一来源（Single Source of Truth）。
 *
 * 现行批准口径来自 `docs/POLICY_CAPABILITY_MATRIX_2026.md`
 * （第三条：月度/季度/年度独立周期；B.4/B.5：单项 ≤150%，周期上限 110/150/105），
 * 与仓库既有代码、机器可读基线 `fixtures/policy/performance-caps.json` 一致。
 *
 * 2026-11-21 外部审计提出“已批准口径应为月度 1.10 / 季度 1.30 / 年度 1.50”
 * （即季度 130、年度 150）。该说法与仓库内制度矩阵及现行实现冲突，
 * 尚未取得业务书面确认。**在书面确认并同步更新制度矩阵、基线与本文件之前，
 * 任何人不得擅自修改下列数值**，也不得在调用方按审计口径私自封顶。
 *
 * 变更流程（政策验收门禁）：
 *   1. 取得业务书面确认并更新 `docs/POLICY_CAPABILITY_MATRIX_2026.md`；
 *   2. 同步更新本文件与 `fixtures/policy/performance-caps.json`；
 *   3. 同步更新 `docs/acceptance/policy-caps.md`；
 *   4. `packages/policy-dsl/src/__tests__/policy-caps.acceptance.test.ts` 必须通过。
 */
export const PERFORMANCE_CYCLE_CAPS: Readonly<Record<PerformancePeriod, string>> =
  Object.freeze({
    MONTHLY: "110",
    QUARTERLY: "150",
    ANNUAL: "105",
  });

/**
 * 现行批准口径的元数据。用于政策验收测试与验收文档对账，
 * 不做任何计算，避免在代码中重复“依据”字符串。
 */
export const PERFORMANCE_CYCLE_CAP_APPROVAL = Object.freeze({
  /** 现行批准口径的制度依据文件（相对仓库根目录）。 */
  source: "docs/POLICY_CAPABILITY_MATRIX_2026.md",
  /** 上限单位：百分制 S 分；绩效系数 K = S / 100。 */
  unit: "S/100",
  status: "CURRENT_APPROVED",
  /** 外部审计提出但尚未书面确认的冲突项编号。 */
  pendingConflictId: "CAP-AUDIT-2026-11-21",
});
