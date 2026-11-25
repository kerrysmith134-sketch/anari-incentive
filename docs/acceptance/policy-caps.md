# 政策验收：绩效周期上限（Policy Acceptance — Performance Cycle Caps）

- 验收对象：017/018 绩效管理的周期上限（月度 / 季度 / 年度）
- 代码唯一来源：`packages/policy-dsl/src/policy-caps.ts`
- 机器可读基线：`fixtures/policy/performance-caps.json`
- 验收门禁测试：`packages/policy-dsl/src/__tests__/policy-caps.acceptance.test.ts`
- 现行批准依据：`docs/POLICY_CAPABILITY_MATRIX_2026.md`（第三条、B.4/B.5）
- 单位：百分制 S 分；绩效系数 K = S / 100（Kp/Kq）

## 现行批准口径

| 周期 | S 上限 | 系数上限（K = S/100） | 依据 | 状态 |
| --- | --- | --- | --- | --- |
| MONTHLY | 110 | 1.10 | `docs/POLICY_CAPABILITY_MATRIX_2026.md`（第三条 / B.4-B.5） | 现行批准 |
| QUARTERLY | 150 | 1.50 | `docs/POLICY_CAPABILITY_MATRIX_2026.md`（第三条 / B.4-B.5） | 现行批准 |
| ANNUAL | 105 | 1.05 | `docs/POLICY_CAPABILITY_MATRIX_2026.md`（第三条；第十四条 S_company=min(105,…)） | 现行批准 |

## 待确认冲突（未应用）

2026-11-21 外部审计提出“已批准口径应为月度 1.10 / 季度 1.30 / 年度 1.50”。该口径与仓库内制度矩阵和现行实现冲突：

| 周期 | 仓库现行 | 审计提议 | 差异 | 处理 |
| --- | --- | --- | --- | --- |
| MONTHLY | 1.10（110） | 1.10（110） | 无 | 无需变更 |
| QUARTERLY | 1.50（150） | 1.30（130） | 审计提议下调 0.20 | **不采用**，2026-11-25 业务确认 |
| ANNUAL | 1.05（105） | 1.50（150） | 审计提议上调 0.45 | **不采用**，2026-11-25 业务确认 |

- 冲突编号：`CAP-AUDIT-2026-11-21`（已决议：保留 150/105）
- 状态：`PENDING_BUSINESS_WRITTEN_CONFIRMATION`
- 原则：制度数值以书面批准与制度矩阵为准，不得由工程侧按审计意见擅自变更；审计意见本身不构成变更依据。

## 政策验收门禁

`policy-caps.acceptance.test.ts` 会同时读取代码常量与 `fixtures/policy/performance-caps.json`，并断言：

1. 两个来源的周期集合完全一致（不允许新增/遗漏周期）；
2. 每个周期的 S 上限字符串完全一致（改代码不改基线，或改基线不改代码，测试即失败）；
3. 基线的 `multiplier` 与 `score` 数学一致（K = S / 100）；
4. 基线固定为 110/150/105；审计提议的 130/150 已决议不采用；
5. 该文档存在，并记录现行口径与待确认冲突；
6. `scorePerformance()` 实际使用的封顶值与基线一致（政策不是“写在文档里的死数字”）。

## 变更流程

任何周期上限的正式变更，必须一次性完成并留下书面依据：

1. 取得业务书面确认（记录批准人、日期、文件编号）；
2. 更新 `docs/POLICY_CAPABILITY_MATRIX_2026.md`；
3. 同步更新 `packages/policy-dsl/src/policy-caps.ts` 与 `fixtures/policy/performance-caps.json`；
4. 更新本文档（含冲突状态）；
5. 运行 `npx vitest run packages/policy-dsl/src/__tests__/policy-caps.acceptance.test.ts` 并全绿；
6. 若封顶行为变化影响已结算数据，按引擎版本策略评估是否需要 bump `ENGINE_VERSION`。
