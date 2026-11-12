# 源码审查发现登记

> 所有行号均对应本次上传 ZIP 展开后的源码版本。若开发分支有新增提交，执行前需重新定位并核对差异。

| ID | 级别 | 代码证据 | 发现 | 风险/影响 | 整改 |
|---|---|---|---|---|---|
| F-001 | P1 | `apps/api/src/app.ts:1–15595`；AI 提案路由 `10218–10330` | API 装配、路由、部分流程编排都集中在超大文件 | 改动耦合、审查困难、回归影响面大 | 拆成按领域注册的 Fastify plugins；业务流程下沉 Application Service |
| F-002 | P1 | `apps/api/src/platform-store.ts:116–`；`MemoryPlatformStore` 从 1673 起，`PgPlatformStore` 从 8535 起；文件约 18060 行 | Store 契约、Memory 实现、PG 实现堆叠在一个文件；PlatformStore 接口横跨大量领域 | 存储实现难以按域独立演进；Memory/PG 行为漂移风险 | 按领域拆分 Port、Memory Adapter、PG Adapter；先保持同一接口行为 |
| F-003 | P0 | `packages/ai-gate/src/scoring.ts:48–107`；`apps/api/src/app.ts:10218–10330` | `/ai-score-proposals` 通过 evaluation gate，但实际分数由 `scoreEvidence()` 的证据质量权重/覆盖比例映射产生；不是对贡献价值的模型判断 | 证据数量/质量被误读为绩效或贡献水平；产生错误评分暗示 | 将函数重命名/改造为 coverage assessment；关闭其数字评分语义；分离 Evidence Coverage、Confidence、Contribution Assessment、Performance Decision |
| F-004 | P0 | `apps/api/src/app.ts:10272–10280`；`packages/ai-gate/src/scoring.ts:69–97` | 租户可设 `evidenceDefaultRule=ZERO`，coverage 分数为 0 时仍进入提案路径（另需理由和风险升级） | 未观测、证据缺失、真实零贡献可能混淆 | 新增显式状态 `INSUFFICIENT_EVIDENCE / NOT_OBSERVED / NOT_APPLICABLE / DISPUTED / ASSESSED`；缺证不得转成零分；ZERO 仅允许在人类有充分证据裁定后出现 |
| F-005 | P0 | `apps/api/src/platform-pool.ts:3–15`，尤其 `options: "-c app.platform_admin=on"`；相关 RLS policy 在 `db/migrations/*` | 平台连接池默认开启 platform_admin session setting；有对应策略允许该标记绕过 tenant_id 分支 | 该池上 RLS 不再是常规租户隔离的第二道防线，租户过滤需完全依赖应用查询；高影响 | 移除连接池全局 admin 标记；租户查询使用事务级 `set_config('app.tenant_id', ..., true)`；平台管理操作独立、短事务、显式授权；穿透测试 |
| F-006 | P0 | `apps/api/src/app.ts:10305–10328`、`10578–10585` | 创建/决定 AI score proposal 的 `requestedBy`、`decidedBy` 从 request body 读取；其他类似操作需全仓扫描 | 操作者身份与认证上下文割裂；审计可归因性依赖请求体 | 所有 `actor/approvedBy/decidedBy/requestedBy` 的执行者字段由认证上下文解析；body 仅描述对象主体或被评价人 |
| F-007 | P1 | `packages/agent-runtime/src/tools.ts:85–91` | `create_todo` 仅返回随机 UUID 和 targetId，不创建可追踪的持久化待办 | Agent 报告“已创建待办”但业务系统不存在真实任务 | 增加 Task/Todo Port，持久化写入、幂等键、责任人、到期日、状态、完成验证 |
| F-008 | P1 | `apps/worker/src/index.ts:19–21, 72–85` | Worker 从单个 `TENANT_ID` 初始化单租户 Context、Repository、Scheduler | 多租户产品化时任务分发和横向扩展受限 | 做租户感知 Dispatcher；按 tenant/job claim 分发；每个任务建立最小权限 tenant context |
| F-009 | P1 | `packages/agent-runtime/src/runtime.ts:86–124, 171–240, 272–345`；`packages/agent-persistence/src/pg-repository.ts:67–139` | Runtime 在进程内维护 Map，再分步骤 saveTask/appendAudit；任务状态更新和审计写入不是同一原子事务；没有看到 DB claim/lease/CAS 执行权 | 多 worker 并发、崩溃恢复、审批/执行重复、task 状态与审计事件不一致风险 | 将执行状态转成数据库驱动状态机；原子 claim/lease、version/CAS、action idempotency、task+audit+outbox 同事务 |
| F-010 | P1 | `packages/agent-runtime/src/runtime.ts:372–426` | 工具执行后记录审计，当前 actor 记录使用 runtime actor；批准人另作为 approvedBy 传递 | 审计 actor 与批准 actor、执行 actor 语义不够清楚 | 区分 requested_by、approved_by、executed_by、agent_identity；每次 Tool Invocation 独立审计 |
| F-011 | P1 | `packages/agent-runtime/src/metrics.ts:1–74` | `falsePositiveRate`、`costPerClosedLoop`、`aiOffFloor` 明确为 null | Agent 运营指标尚不能证明闭环有效/经济性 | 引入人工标注、token/推理成本、AI-off 实验和结果验证数据 |
| F-012 | P1 | `apps/web/src/pages/SettingsPage.tsx`、`PolicyPage.tsx`、`AiPage.tsx` 等 | 多个页面达到约 2,800–5,085 行 | 页面复杂度和交互回归成本高；页面把数据获取、表单、流程、视图揉在一起 | 提取 feature components/hooks/view models；按角色工作空间重组，不只是拆文件 |
| F-013 | P2 | `packages/domain/src/entity-contracts.ts`（需结合生成文件）；`docs/PRD_TRACEABILITY.md` 中声明 9 张核心表契约 | 自动化实体契约明确覆盖一组核心表，但平台已经扩展出许多业务域与迁移 | 单一来源契约覆盖面可能小于全产品对象范围 | 建立契约覆盖率清单：所有高风险核心表/请求/状态机必须纳入；非核心表可明确排除 |
| F-014 | P0 | `docs/PRD_V4.1_#U8bc4#U5ba1#U4fee#U8ba2#U7248.md:83–93, 130–153, 306–320` | PRD 对 P0 Agent 范围表述不一致：P0-03 排除 Agent Runtime；§2.7 描述主动 Runtime；§7.4 又规定不做自主 Agent、只做三个 bounded workflows | 开发与验收范围无法唯一解释 | 发布 PRD V4.2 决议：P0 具体交付哪些 bounded workflows、Runtime 最小基础设施包含什么、哪些自主能力明确延后 |
| F-015 | P0 | `docs/PRD_V4.1_#U8bc4#U5ba1#U4fee#U8ba2#U7248.md:61–106` 与当前代码实际范围 | PRD 收敛为单租户、单订单类型、5–10 单影子结算；当前工程实现大量额外域能力（工资、股权、计费、战略池等） | 资源分散；测试目标和产品目标偏离 | 将扩展域标为 feature flag / post-P0；P0 主纵向切片优先；不删除已实现能力，但停止扩张 |

## 风险解释

- P0 表示在接入真实员工/财务数据或进行有付款效力的结算前必须关闭。
- P1 表示当前升级周期应完成；可在影子试点中并行处理，但必须记录风险接受人和期限。
- P2 表示产品化成熟度建设，不应阻塞第一条端到端影子切片。

## 需重新验证的点

1. 对所有写操作扫描请求体中的 actor/person 字段，而非只修复 AI proposal 两个路由。
2. 对所有 RLS 策略和 pool 查询做实际 PostgreSQL 双租户测试，静态判断不能代替实测。
3. 对 PgAgentTaskRepository 的数据库约束、幂等索引和 worker 多实例部署方式做完整并发验证。
4. 对大页面做浏览器可用性评审，本文件只基于页面结构和代码规模给出拆分建议，不声称已完成像素级 UI 验收。
