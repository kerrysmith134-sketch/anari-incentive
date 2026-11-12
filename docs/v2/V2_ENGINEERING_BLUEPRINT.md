# N-Perform V2 工程升级蓝图

## 1. 执行决策

**不推翻重写；不更换主技术栈；不继续无约束扩功能。** 以现有 TypeScript 模块化单体为基础，先关闭 P0 安全/语义问题，再按领域边界拆分 API 和 Store，重做 AI 评价语义与 Agent 执行底座，最后重构角色工作空间并跑真实业务影子周期。

### V2 的定义

V2 不等于增加更多 Agent、模型或仪表盘。V2 的目标是把当前已有的宽功能平台变成一个可信的工作闭环：

`业务事实 → 证据标准化 → 缺口/冲突识别 → 工作包与交付 → 贡献申报/认定 → 绩效评价 → 确定性激励计算 → 审批 → 账本/影子结算 → 员工确认/申诉 → 结果反馈`

## 2. 代码基线与产品约束

### 2.1 已确认的代码事实

- 前端：React 19 / TypeScript / Vite / React Router 7。
- API：Fastify 5 / TypeScript；worker 单独运行。
- 数据库：PostgreSQL，79 个 SQL migration 文件。
- 有 `domain`、`contracts`、`policy-dsl`、`ledger`、`ai-gate`、`agent-runtime`、`agent-persistence`、`connectors`、`auth` 等 package。
- API `app.ts` 约 15,595 行；`platform-store.ts` 约 18,060 行，包含 `PlatformStore` interface、MemoryPlatformStore 和 PgPlatformStore；`pg-store.ts` 约 3,876 行；若干前端页面超过 2,000 行。
- AI 提案路由先校验 Model Evaluation Gate，但 `scoreEvidence()` 以证据质量权重和覆盖率生成数字分数。
- `create_todo` 当前只产生随机 ID，没有写入待办系统。
- Worker 当前以单个 `TENANT_ID` 构造调度器和 repository。

### 2.2 PRD 约束

PRD V4.1 的产品定位是“制度无关、AI-native 的多人贡献认定与激励结算 assurance layer”，不是通用 HRIS、薪资系统或通用项目管理软件。首个 P0 纵向切片是一个租户、一个法人、一种跨部门订单类型、20–50 人、5–10 个真实订单、一个月度周期，跑通影子结算。

必须保留：

- 贡献申报与贡献认定分离。
- 贡献认定与绩效评价分离。
- 证据可反驳；证据缺失不等于零贡献。
- LLM 不得写正式金额、批准或锁账。
- 政策和计算可版本化、可复算。
- 账本追加式；修正通过 reversal / adjustment。
- 高影响/不可逆动作必须人类批准。
- AI 可关闭，人工流程仍可运行。

**PRD 决策待办**：V4.1 §2.3 将 Agent Runtime 列为 P0 不做；§2.7 描述主动式 Agent Runtime；§7.4 写成不做自主 Agent、但要做三个 bounded workflows。必须在 V4.2 明确 Runtime 最小基础设施与三个 workflow 的边界。

## 3. 当前成熟度判定

| 能力 | 代码存在性 | 业务可信度 | V2 处理 |
|---|---|---|---|
| 身份/租户/组织 | 高 | 需 RLS 与 actor 实测 | 先修隔离和身份来源 |
| 连接器/同步 | 中高 | 需真实同步覆盖、去重和异常重放数据 | 先冻结一个 CRM/ERP/Feishu 数据切片 |
| 证据图谱 | 中高 | 证据来源与业务影响仍需实测 | 增加 Contribution Event 和状态语义 |
| 工作包/交付/验收 | 中高 | 需验证真实订单适配与负担 | 做真实订单纵向切片 |
| 贡献认定 | 中高 | 缺失/冲突/追认路径需验证 | 做多人案例盲审与回放 |
| 绩效评价 | 中高 | 指标数据溯源与不适用语义需强化 | 建 Metric Measurement Snapshot |
| Policy/Calculation | 中高 | 需金额边界、并发和重放验证 | 计算链不重写，强化输入快照和对账 |
| Ledger/Settlement | 中高 | 需并发、故障注入与权限验证 | 先做财务不变量测试 |
| AI Evaluation | 中 | 评测门禁和数值提案语义需修正 | 先拆评价对象，不直接启用 LLM 评分 |
| Agent Runtime | 中 | 目前更像规则扫描+动作执行框架 | 数据库驱动任务状态、工具幂等、验证闭环 |
| Frontend | 广覆盖 | 信息架构/可用性待重构 | 角色工作空间与 feature component 拆分 |

## 4. 目标架构

### 4.1 总体架构

保持模块化单体 + 异步 Worker：

- **Web App**：角色工作空间、工作流视图、业务对象详情、Agent Operations。
- **API App**：Fastify transport adapter；认证、租户解析、权限；调用 application services。
- **Domain/Application**：每个领域拥有 commands、queries、policies、domain events、repository ports。
- **Infrastructure**：PostgreSQL adapters、Outbox、队列/worker、对象存储、外部连接器、LLM provider adapter。
- **Agent Runtime**：observe → detect → plan → authorize → act → verify → close/escalate。
- **Deterministic Engines**：贡献决策辅助、政策规则、金额计算与账本都不能依赖 LLM 来决定正式结果。

### 4.2 领域模块边界

1. Identity & Tenant：user、membership、person、role、tenant context。
2. Organization：org node、manager relationship、employment scope。
3. Integration：connections、mappings、webhook inbox、sync run、external identity map。
4. Evidence：raw events、evidence normalization、evidence nodes/links、quality issues、source lineage。
5. Work Package：work package、commitment snapshot、responsibility、deliverable、acceptance。
6. Contribution：claim、attestation、contribution event、attribution proposal/decision、conflict checks、appeals。
7. Performance：cycles、metric definition、measurement snapshot、rubric、evaluation draft/decision。
8. Policy & Calculation：policy version、policy pack、DSL、calculation run、trace、reconciliation。
9. Ledger & Settlement：ledger entries、approval consumption、settlement batch/export/acknowledgement、adjustments。
10. Governance：legal gate、notice、consent、privacy、retention、fairness、audit。
11. AI Governance：datasets、gold set、evaluation run、prompt version、model/provider policy、canary/red-team、proposal log。
12. Agent Operations：task/plan/step/tool invocation/approval/verification/dead letter/metrics。

不要为每个领域创建微服务。当前先用清晰 package/module 边界和依赖规则实现可测试的模块化单体。

### 4.3 依赖规则

- `domain` 不能 import `apps/api`、`pg`、React 或 LLM SDK。
- `application` 依赖领域类型与 repository ports，不依赖具体 PostgreSQL。
- `infrastructure` 实现 ports，不向上层暴露 SQL row 类型。
- `api` 只做鉴权、schema、调用 application service、映射响应。
- `agent-runtime` 只通过 typed tools 调用 application services；不能直接访问数据库或绕过权限。
- `policy-dsl` 不依赖 LLM；输入和输出必须可序列化、确定性重放。
- Web 不能复制业务规则，显示和输入校验可以复用合同，但最终验证由服务端负责。

## 5. 必须先关闭的 P0 缺陷

### P0-A：RLS/租户上下文

当前 `createPlatformPool()` 通过 pool 级连接参数默认设置 `app.platform_admin=on`。改为：

- 普通请求取得认证主体与 tenant membership 后，在每个事务中使用 `SET LOCAL` / `set_config(..., true)` 设置 tenant_id。
- platform admin 使用独立、短时、显式的 admin transaction wrapper；默认不允许 pool 连接拥有 admin bypass。
- Repository 方法必须携带 `TenantContext`，不接受裸 tenant string 以外的隐式上下文。
- 以两个租户构建 PostgreSQL 测试：读、写、join、导出、异步任务、后台报表均跨租户拒绝。
- 验证连接复用时 `tenant_id` / `platform_admin` 不泄漏。

### P0-B：操作者身份

新增统一 `ActorContext`：

`actorType / actorId / userId / personId / tenantId / roles / authMethod / requestId / correlationId`

所有决定类 API 只能从服务端 `request.authContext` 解析 actor。请求体字段 `requestedBy/decidedBy/approvedBy/acceptedBy` 不再作为可信操作人来源。兼容策略：旧字段先忽略或拒绝，并输出迁移错误码；前端改用 session 身份。

### P0-C：AI 评分语义修正

`scoreEvidence()` 当前是 coverage proxy，不应被命名或使用为人员评分。V2 将其改为 `assessEvidenceCoverage()`，只输出：coverage ratio、quality-weighted coverage、missing dimensions、stale/conflicted counts、source diversity、lineage completeness、confidence band。不得输出 0–5 的绩效分或 overallScore。

若模型未通过覆盖充分、标注一致性、公平性、反事实和红队门禁，AI 只做摘要/证据提取/缺口提示。只有独立 Gold Set 与人工双评验证通过后，才允许生成 **Contribution Assessment Draft**，且不能直接变成 Evaluation Decision。

### P0-D：评价状态语义

每个维度采用状态，而不是只存一个 number：

- `ASSESSED`：证据足够且按 rubric 完成判断。
- `INSUFFICIENT_EVIDENCE`：证据不足，要求补证/人工调查。
- `NOT_OBSERVED`：当前周期未观察到足够业务机会或行为。
- `NOT_APPLICABLE`：指标不适用于该人员/岗位/周期。
- `DISPUTED`：证据或事实存在争议。
- `PENDING_REVIEW`：待人工判断。

零分必须属于 `ASSESSED`，且需要明确 rubric anchor、证据、评价理由和必要的二次复核；不能由空证据、无数据或覆盖率算法自动产生。

### P0-E：财务与账本

建立 money-path integration tests：重复请求、并发审批、重复 outbox delivery、锁定后写入、settlement 双重绑定、reversal、adjustment、断线重试和快照重放。审批消费、账本写入、审计/Outbox 要在明确事务边界内原子完成。

## 6. 架构重构策略

### 6.1 API 拆分

`apps/api/src/app.ts` 变成轻量 app composer：注册 plugins、middleware、error handler、route modules。按领域建立 `modules/<domain>/<domain>.routes.ts`，复杂流程转到 `application/<use-case>.ts`。

拆分顺序：Evidence/Contribution → Performance/AI → Policy/Calculation → Settlement/Ledger → Governance/Integration → Identity/Organization。每个 route plugin 必须有独立 route tests 和 schema tests。

### 6.2 Store 拆分

当前 PlatformStore interface、MemoryPlatformStore、PgPlatformStore 同在 `platform-store.ts`。拆分成 `ports/<domain>-repository.ts`、`adapters/memory/<domain>-repository.ts`、`adapters/postgres/<domain>-repository.ts`。同一领域先有契约测试，再拆实现。避免一开始就把所有 18k 行拆成几十个没有稳定边界的小文件。

### 6.3 Memory/PG parity

所有 Repository Port 有 contract test suite，在 Memory 与 PostgreSQL 两种 adapter 上共用。任何一方不支持必须明确标记，不允许“测试走 Memory、生产走 PG”产生隐性差异。

### 6.4 Database migrations

79 个迁移先保持历史不可改。新增 migration 只做向前兼容扩展。每个 release 执行空库迁移、上一版本升级、备份恢复和 RLS contract。重复 migration 编号/功能相似 migration 要通过 schema manifest 做盘点，确认后再合并或保留，不能直接重写历史。

## 7. Contribution Intelligence V2

不要把工时、活动量、claim 数、证据条数或 AI confidence 作为贡献权重。

建议的对象链：

`Business Outcome → Work Package → Responsibility Snapshot → Contribution Event → Evidence Graph → Contribution Claim → Assessment Draft → Human Attribution Decision`

### Contribution Event 最小字段

`id, tenant_id, subject_person_id, actor_person_id, event_type, target_type, target_id, occurred_at, source_type, source_ref, business_context_ref, outcome_ref, evidence_refs, provenance, captured_at, correction_of, idempotency_key`

事件应该描述有意义的业务动作，例如“解决导致验收阻塞的配置问题”，而不是“发了 12 条消息”。来源可以是 CRM、ERP、工单、邮件/飞书审批、代码仓库或人工补充。不同来源的可信等级要单独表示。

### 贡献分析输出

- 事实摘要（可追溯至 evidence refs）。
- 对应工作包/交付/业务结果。
- 参与角色与职责。
- 支持证据、反证、缺失信息。
- 可能的协同关系和贡献边界。
- 置信度（只反映事实判断可信度，不是贡献大小）。
- 需要补证的问题。
- 推荐人工裁决路径。

正式 Decision 需要理由、rubric/policy reference、证据快照、裁决人和利益冲突检查。申报、AI assessment、最终 decision 不得合并。

## 8. AI & Agent V2

### 8.1 AI 能力分级

- **Tier A — Evidence Copilot**：抽取、去重、归类、摘要、引用、缺口与矛盾识别。可以先上线，但输出必须绑定证据 ID 与 source lineage。
- **Tier B — Contribution Analyst**：对工作包、交付、业务结果和证据做有理由的分析草稿；不得生成正式归因百分比或决定。
- **Tier C — Performance Analyst**：按已冻结 Rubric 生成维度说明和异常信号；需通过 Gold Set、双评、偏差与反事实门禁；人类独立判断优先。
- **Tier D — Policy/Settlement Assurance**：确定性模拟、差异解释、异常定位；LLM 只能解释已经算出的数值，不能写入金额。

### 8.2 Agent 闭环模型

每个 Agent Task 应包含：

`Goal → Observation Snapshot → Findings → Plan → Action Proposals → Authorization → Tool Invocations → Verification → Outcome → Learning Signal`

关键能力：

- 持久化 task/step/action；数据库 claim/lease 和版本号 CAS。
- Tool invocation 有独立 idempotency key、schema、权限、执行身份、输入/输出 hash、重试策略、timeout 和结果验证器。
- 业务写动作与 action result、audit、outbox 同事务提交，或用可靠的 transactional outbox 处理。
- 多 worker 可安全竞争同一队列；租户上下文绑定到任务，而不是 Worker 进程环境变量。
- Action 执行后必须 verify；工具返回成功不等于业务目标完成。
- T0 只读；T1 低风险和可逆（催补证/建待办）；T2 业务流程变更（指派/升级/发起复核）；T3 正式认定、评价、政策发布、金额批准、锁账，永远需要授权人审批。
- 支持 AI off、人工接管、死信、回放、任务取消和补偿。

### 8.3 Agent 首批范围

优先把现有 Skills 收敛为三个可以端到端验收的工作流：

1. Evidence Completeness：发现证据缺失 → 自动建真实待办/请求证据 → 跟踪补充 → 验证证据进入正确对象 → 关闭。
2. Contribution Exception：识别未归因工作包、多人 claim 冲突、缺失责任快照、利益冲突 → 形成处理计划 → 指派/通知 → 跟踪裁决 → 关闭或升级。
3. Cycle Readiness：检查周期数据、指标快照、审批/申诉、计算和结算门禁 → 生成阻断清单 → 跟踪修复 → 输出 ready/not-ready 证据。

不优先做“八个 Agent 品牌”。先保证这三个闭环真实完成。

## 9. 前端 V2

前端主导航重组为：

1. **My Workbench**：我的工作包、贡献记录、待补证、绩效解释、激励明细、确认与申诉。
2. **Management Center**：团队贡献认定、独立评价、异常处理、待审批、周期准备度。
3. **Finance & Settlement**：利润池/预算、政策计算、复核、对账、锁账、导出与账本。
4. **Agent Operations**：Agent 观察、发现、任务计划、执行动作、验证、失败/升级、成本和质量指标。
5. **Governance & Configuration**：租户、组织、政策、数据源、权限、AI 治理等低频配置。

页面拆分原则：page 只编排区块；数据获取进 query hooks；表单进 feature components；状态变更经 command hooks；复杂表格抽成可复用 view components。不要在一次 UI 改造中同时改 API 语义和视觉系统。

## 10. 12 周执行顺序与阶段门禁

| 阶段 | 周期建议 | 交付 | Exit Criteria |
|---|---|---|---|
| S0 规范冻结 | 第 1 周 | PRD V4.2 决策、ADR 更新、风险登记 | P0 范围唯一；数据/actor/RLS 语义冻结 |
| S1 安全与评分语义 | 第 2–3 周 | RLS/ActorContext 修复；Evidence Assessment 状态模型 | 双租户拒绝测试；零分/无证据语义测试 |
| S2 纵向切片领域闭环 | 第 4–5 周 | WorkPackage→Claim→Decision→Calculation→Shadow Ledger | 5 个真实案例回放，独立计算一致 |
| S3 模块化重构 | 第 4–8 周并行 | API/Store 按域拆分，Repository contracts | 行为兼容、Memory/PG contract tests |
| S4 Agent Execution | 第 6–9 周 | task lease、tool idempotency、verify、三条 bounded workflows | 多 Worker 故障/重复触发/AI-off 验证 |
| S5 Role Workspaces | 第 8–10 周 | 四类工作空间 | 关键角色任务可用性测试通过 |
| S6 影子周期 | 第 11–12 周 | 5–10 单、20–50 人、月度周期、证据包 | 金额差异 0；核心门禁 100%；员工/经理耗时达到 PRD 指标或形成整改决议 |

注意：上述为并行工作安排建议，不等于承诺 12 周一定正式上线。若数据源或制度适配不满足，优先延长影子周期，不降低验收门槛。

## 11. 正式化门槛

正式结算（有实际付款/薪酬效力）之前必须全部满足：

- 所有跨租户读写/导出/异步路径通过 PostgreSQL RLS 负向测试。
- 所有高影响 actor 来自认证上下文，不能由请求 body 伪造。
- 证据缺失、不适用、未观测、争议、真实零值语义完全区分。
- 每个正式贡献决定都有证据快照、标准、裁决人和理由。
- 每个金额可从 policy version、engine version、input snapshot 和 calculation trace 重放。
- 财务独立参照差异为 0；金额路径所有并发/幂等/账本不变量测试通过。
- 员工可以查看依据、补充证据、确认、提出异议和申诉。
- 申诉由非原决定人处理；必要证据对申诉人披露且有审计记录。
- Agent 可以关闭；所有高风险动作有审批；Agent 执行结果有业务验证。
- 备份恢复、审计持久化和事件重放经过实测。

## 12. 关键指标

**业务**：证据覆盖率（按角色/工作类型分层）≥70%；员工补证时间 ≤30 分钟/周期；经理复核 ≤2 小时/周期；争议率 <10%；系统与独立财务参照差异 = 0。

**AI**：摘要引用准确率、证据抽取精确率/召回率、冲突发现召回率、人工改判率、盲审一致率、反事实敏感度、模型版本回归结果。不能把 AI 采纳率作为唯一成功指标。

**Agent**：发现到关闭中位时长、自动闭环率、升级率、误报率、人工接管率、执行验证失败率、每个闭环成本、AI-off 人工完成率。

**工程**：模块依赖环数 = 0；Money path regression 全绿；Memory/PG contract parity；迁移空库/升级/恢复测试通过；Critical APIs p95 与任务堆积有明确 SLO。

## 13. 非目标与保留项

- 不引入微服务作为本轮目标。
- 不为“看起来 Agentic”而接入新的 Agent 框架。
- 不让 LLM 直接评分后自动生效。
- 不新增完整工时、甘特图或通用项目管理。
- 不将现有 payroll/equity/billing 模块一刀删除；把其产品范围放在 V2 P0 之外，通过 feature flags 控制优先级。
- 不重写历史 migration；通过新增兼容迁移演进。
