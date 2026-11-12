# PRD V4.2 决策冻结（NPV2-001）

> 状态：已冻结（2026-11-12）。本文关闭 `PRD_DECISIONS_TO_FREEZE.md` 中的全部待决项，
> 作为 V2 工程执行的唯一范围依据；与 PRD V4.1 冲突之处以本文为准。

## 冻结决议

| 决策 | 结论 |
| --- | --- |
| D-01 P0 Agent 范围 | **最小 Runtime + 三个 bounded workflows**（证据完整性 / 贡献异常 / 周期准备度）。不做开放式自主规划、多 Agent 协商、自动政策发布、自动定案、自动金额操作。 |
| D-02 AI 评分 | **numeric `scoreEvidence` 不作为正式贡献/绩效评分**。P0 只做证据整理、Coverage、Reliability、缺口/冲突建议（NPV2-004/005/006 落地）。Contribution Assessment Draft 需 Gold Set + 双评门禁，且仅草稿；正式决定由人做出。 |
| D-03 evidenceDefaultRule=ZERO | **废除"缺证据自动归零"路径**。零分只能是 `ASSESSED` 状态下有依据的人工认定；缺证据 → `INSUFFICIENT_EVIDENCE`（补证任务），不适用 → `NOT_APPLICABLE`，未观测 → `NOT_OBSERVED`。存量设置保留解析但新增提案一律走状态语义。 |
| D-04 扩展域范围 | 薪酬/个税/股权/计费/战略池**保留代码、移出 P0 路径**，由权限与 feature flag 控制；本阶段不新增扩展功能。 |
| D-05 多租户 | schema/领域保留 tenant_id；P0 验收为**单租户试点 + 租户隔离安全正确**（NPV2-002 双租户负向测试），不做 SaaS 自助开通与计费。 |
| D-06 工作事实粒度 | 引入轻量 **Contribution Event**（NPV2-015）；不做工时/甘特图/通用项目管理。 |
| D-07 正式结算 | P0 只做**影子结算**；正式结算另行 GO 审批（NPV2-009 验收后）。 |
| D-08 技术栈 | 保留 TypeScript / Fastify / React / PostgreSQL / Vite；模块化单体 + Worker；不拆微服务。 |

## P0 执行批次（对应 TASK_BACKLOG.csv）

- **批次 1（安全/语义，本提交起）**：NPV2-004、NPV2-005、NPV2-006、NPV2-002（测试基线）、NPV2-003（分批）。
- **批次 2（金额路径）**：NPV2-007、NPV2-008、NPV2-010。
- **批次 3（影子周期准备）**：NPV2-009。
- **批次 4（结构与 Agent）**：NPV2-011..014、018..027。
- **批次 5（工作空间）**：NPV2-028..031。

每项完成时回写 TASK_BACKLOG.csv 的 Status 字段（DONE / IN_PROGRESS），并在提交信息中引用 Task ID。
