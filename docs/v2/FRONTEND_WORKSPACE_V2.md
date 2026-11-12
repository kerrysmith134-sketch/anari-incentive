# Frontend Workspace V2

## 1. 目标

将当前多页面功能控制台升级为角色驱动的工作空间。不是单纯缩短菜单，而是把“下一件需要做的事、为何要做、证据是什么、做完如何验证”放在首屏。

## 2. 四个工作空间 + 一个配置空间

### My Workbench

- 本周期我的工作包与责任承诺。
- 我参与的交付、证据和贡献事件。
- 系统发现的证据缺口/待补充事项。
- 已认定与待认定贡献。
- 绩效维度、Rubric anchor、原始数据快照和 AI 辅助解释。
- 激励计算明细、确认/异议、申诉状态。

### Management Center

- 周期准备度和团队覆盖率。
- 待裁决贡献、冲突、反证和逾期项。
- 独立绩效判断队列（先独立判断，再揭示 AI）。
- 团队异常、评价一致性和工作分配公平性。
- 批量操作必须可预览、可撤销/补偿，并保留审计。

### Finance & Settlement

- 利润池/预算和来源事实。
- Policy Version、Calculation Run、Reference Reconciliation。
- 阻断项、金额差异、舍入分摊和 cap。
- 审批消费、锁定账本、Settlement Batch、导出/确认。
- Reversal/Adjustment 与历史关联。

### Agent Operations

- Agent 在线状态、租户/任务队列健康。
- Findings、Plan、Proposed Actions、审批、执行、验证结果。
- 失败/超时/死信/人工接管。
- 每个 Agent 的精确率、关闭周期、人工覆写和成本。
- 每个结论可追溯到 Evidence/业务对象，不以聊天记录作为唯一入口。

### Governance & Configuration

租户、组织、Policy Pack、指标/Rubric、数据源、字段权限、保留策略、模型/Provider Policy、Gold Set、审计与合规。低频配置不占据普通员工主导航。

## 3. 现有页面迁移

| 当前页面 | V2 落点 |
|---|---|
| Dashboard | Management Center overview（按角色适配） |
| Contribution / TaskPod | My Workbench + Management contribution review |
| Performance / Cycles | Management Center |
| Rewards / MyRewards | My Workbench；财务可看聚合金额 |
| Settlements / AwardBatch / Approvals | Finance & Settlement |
| AI / AgentOps | Agent Operations + Governance 子页 |
| Settings / Policy / Integrations / People / Institutions | Governance & Configuration |

## 4. 代码拆分准则

- Page 组件只做布局和组合。
- `useXxxQuery` 负责读取；`useXxxCommand` 负责命令提交和刷新策略。
- Feature component 负责单一业务交互，例如 EvidenceGapCard、ContributionDecisionPanel、CalculationTraceViewer。
- 复杂表格、状态标签、时间线、Diff、Evidence graph 作为共享组件。
- 表单与状态机校验以服务端 schema 为权威；前端仅做即时反馈。
- 每个高风险决定显示“对象、作用人、依据、风险、操作人、是否可撤销、后续影响”。

## 5. UX 验收

用 5 类角色进行任务测试：员工、直属主管、跨部门裁决人、财务、系统管理员。核心任务包括补证、裁决贡献、完成独立评价、解释激励金额、处理申诉、完成结算对账。记录完成率、耗时、错误率、回退率和用户是否能说清“下一步做什么”。
