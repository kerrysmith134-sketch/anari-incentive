# V2 开发前必须冻结的产品与架构决策

## D-01：P0 Agent 范围（阻塞）

PRD V4.1 §2.3、§2.7、§7.4 对 Agent Runtime 的 P0 范围存在不一致。建议定稿为：

- P0 实现最小 Runtime 基础设施：事件/定时触发、持久化任务、T0/T1 工具、审批队列、执行审计、结果验证、失败恢复、AI-off。
- P0 仅交付三个 bounded workflows：证据完整性、贡献异常、周期准备度。
- P0 不做开放式自主规划、多 Agent 自由协商、自动政策发布、自动绩效定案和任何自动金额操作。

## D-02：AI 评分是否属于 P0（阻塞）

建议明确：当前 numeric `scoreEvidence` 不作为正式贡献/绩效评分；P0 先做证据整理、Coverage、Reliability、缺口/冲突建议。只有模型及 rubric 通过 Gold Set、双评、偏差、反事实、红队门禁后，才考虑 Contribution Assessment Draft；正式决策依然由人类完成。

## D-03：`evidenceDefaultRule=ZERO`（阻塞）

建议取消缺证据自动归零。`ZERO` 只能作为人工在证据充分的情况下认定某个指标确实为零的结果，不应是系统缺少证据时的默认处理策略。

## D-04：产品范围与已有扩展功能（需冻结）

现有代码包含薪酬、法定税、股权、计费、战略池等大量额外域能力；PRD V4.1 P0 不需要它们。建议不删除，但通过权限/feature flag 将其放在 P0 试点路径之外；此阶段不再增加功能。

## D-05：多租户目标（阻塞）

产品长期制度无关并面向多租户，但 PRD P0 是单租户试点。建议：领域和 schema 保留 tenant_id 设计；本轮先保证 tenant isolation 的安全正确性，但不将 SaaS 自助开通、计费、多租户运维体验作为 P0 验收项。

## D-06：工作事实的最小粒度（需冻结）

建议在现有 WorkPackage/Deliverable/Evidence 上补轻量 Contribution Event；不引入工时、甘特图、通用项目管理。Contribution Event 表达业务有意义的行为、对象、时间、来源和结果引用。

## D-07：正式结算范围（阻塞）

P0 只完成影子结算；正式结算需另行审批 GO。所有历史数据、规则、账本可复算，但不触发付款或工资单的实际资金动作。

## D-08：技术栈（可冻结）

保留 TypeScript / Fastify / React / PostgreSQL / Vite。模块化单体 + Worker，不切微服务，不因追逐新框架改写全栈。
