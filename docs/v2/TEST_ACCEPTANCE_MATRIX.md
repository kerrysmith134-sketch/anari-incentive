# 测试与验收矩阵

| ID | 场景 | 测试类型 | 通过标准 | 优先级 |
|---|---|---|---|---|
| T-001 | Tenant A 不能读取 Tenant B 的 person/work package/evidence/claim/ledger | PG integration / RLS | 所有读写均拒绝或空结果；无信息泄露 | P0 |
| T-002 | Platform Pool 连接复用后普通 tenant query 不继承 admin bypass | PG integration | 每事务 tenant context 隔离；默认角色无跨租户读取 | P0 |
| T-003 | body 伪造 requestedBy/decidedBy/approvedBy | API security | actor 始终等于 auth principal；伪造值被忽略/拒绝 | P0 |
| T-004 | 自己申报、自己裁决、本人验收、利益冲突裁决 | Domain invariant | 均被拒绝并有 audit reason | P0 |
| T-005 | 空证据、过期证据、冲突证据 | AI/domain | 产生状态与缺口，不产生自动零分 | P0 |
| T-006 | NOT_APPLICABLE / NOT_OBSERVED 与零分区分 | Domain/API/UI | 不能把缺测/不适用转换为 0 | P0 |
| T-007 | Evidence Coverage 评估 | Unit/property | 只输出覆盖信息，不输出绩效分 | P0 |
| T-008 | Contribution Assessment 包含支持证据、反证和替代解释 | AI eval | 无引用主张被拒；反证不被忽略 | P0 |
| T-009 | 人先独立评分再揭示 AI | API/E2E | reveal 前 AI draft 隐藏；记录独立分数/理由/时长 | P0 |
| T-010 | Model/Prompt/Retrieval 版本变更 | Model eval | 未过 holdout/canary/red-team Gate 不得激活 | P0 |
| T-011 | calculation snapshot 重放 | property/integration | 同 policy hash + engine version + input hash 结果完全一致 | P0 |
| T-012 | 两个并发审批消费同一 approval request | PG concurrency | 仅一个成功；另一个冲突 | P0 |
| T-013 | 同一 calculation line 重复入账 | PG concurrency | 唯一约束/幂等保证只一条有效 entry | P0 |
| T-014 | 锁定 ledger UPDATE/DELETE | PG permission/trigger | 数据库层拒绝 | P0 |
| T-015 | settlement 重复绑定同一 ledger | PG integration | active settlement 唯一约束生效 | P0 |
| T-016 | action 执行后进程崩溃 | Agent fault injection | 重启后按幂等键继续，不重复副作用 | P1 |
| T-017 | 两个 Worker 同时 claim 同一 AgentTask | PG concurrency | 只有一个得到有效 lease | P1 |
| T-018 | 过期 lease 回收 | Agent integration | 新 Worker 可恢复未完成 task | P1 |
| T-019 | `create_todo` 创建业务待办 | Tool integration | 可从任务中心读取；有 owner/dueAt/source/idempotency | P1 |
| T-020 | Tool 执行成功但业务状态未改变 | Agent verification | 验证失败，task 不得标记 SUCCEEDED | P1 |
| T-021 | Outbox 重复投递 | Integration | 不产生重复 task/action | P1 |
| T-022 | Agent T3 无审批 / 改 payload 后用旧审批 | Security | 执行被拒绝 | P0 |
| T-023 | AI provider 断开 | Chaos/E2E | 人工流程仍可完成，AI 降级标识可见 | P1 |
| T-024 | Memory 与 PG Adapter 共用 repository contract suite | Contract | 行为一致；差异明确记录 | P1 |
| T-025 | 从空库执行全部 migration | CI | 成功且 schema manifest 一致 | P0 |
| T-026 | 从上一个 release 升级数据库 | CI | 数据保留、migration 成功 | P0 |
| T-027 | 备份恢复演练 | Ops | 在目标 RTO/RPO 内恢复且校验账本/审计链 | P0 |
| T-028 | 员工补证、申诉与查看个人依据 | E2E | 不泄露他人个人/金额信息 | P0 |
| T-029 | 主管贡献裁决与独立评价 | E2E | 权限、回避、证据展示、盲审顺序正确 | P0 |
| T-030 | Finance 影子结算 | E2E/financial reconciliation | 5–10 订单差异为 0；不得产生实际付款效力 | P0 |
| T-031 | 经理复核耗时 | Pilot metric | 每周期 ≤2h 或形成削减流程决议 | P0 |
| T-032 | 员工补证耗时 | Pilot metric | 每周期 ≤30 分钟，目标 ≤15 分钟 | P0 |
| T-033 | Evidence coverage 分层 | Pilot metric | 按 role/task/order type 出具覆盖率，目标 ≥70% | P0 |
| T-034 | 贡献争议率 | Pilot metric | <10% 或触发原因分析/产品修订 | P0 |
| T-035 | 角色工作空间可用性 | Usability | 五类用户完成核心任务，无关键阻塞 | P1 |

## 执行要求

每个测试要保留测试数据、代码版本、运行时间、环境、日志/截图/报告。对金额、RLS、审批、账本、Agent 副作用类测试，禁止只在 Memory Store 上跑。
