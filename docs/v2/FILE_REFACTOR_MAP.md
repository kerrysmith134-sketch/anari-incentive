# 文件级重构映射

## 1. API：从单一 app.ts 转为领域路由注册

| 当前文件/范围 | 目标模块 | 迁移方式 |
|---|---|---|
| `apps/api/src/app.ts` app composition、通用 helpers | `apps/api/src/app.ts` + `platform/plugins` | 只保留 Fastify 初始化、插件注册、错误处理、hooks |
| `app.ts` 贡献/工作包/交付/验收/证据路由 | `modules/work-packages/*.routes.ts`、`modules/evidence/*.routes.ts`、`modules/contribution/*.routes.ts` | 先按路由块原样迁移，再抽 use cases；不同时改变 API contract |
| `app.ts` evaluation/cycles/AI proposals | `modules/performance/*.routes.ts`、`modules/ai-governance/*.routes.ts` | AI proposal 路由只调用 `AiAssessmentApplicationService` |
| `app.ts` policy/calculation | `modules/policy/*.routes.ts`、`modules/calculation/*.routes.ts` | 与 policy DSL 保持纯函数边界 |
| `app.ts` ledger/settlement/approval | `modules/ledger/*.routes.ts`、`modules/settlement/*.routes.ts`、`modules/approvals/*.routes.ts` | 采用统一 ApprovalService 和事务边界 |
| `app.ts` governance/privacy/org/integrations | 对应领域 routes | 后迁移，先稳定核心纵向切片 |

## 2. Store：拆契约和 Adapter

当前 `apps/api/src/platform-store.ts` 同时定义 `PlatformStore`（116 行起）、`MemoryPlatformStore`（1673 行起）、`PgPlatformStore`（8535 行起）。不要直接按方法名机械切碎；按聚合边界拆：

```text
apps/api/src/platform/
  ports/
    tenant-repository.ts
    identity-repository.ts
    organization-repository.ts
    governance-repository.ts
    model-governance-repository.ts
    integration-repository.ts
    budget-repository.ts
  adapters/
    memory/
      tenant.repository.ts
      identity.repository.ts
      governance.repository.ts
      ...
    postgres/
      tenant.repository.ts
      identity.repository.ts
      governance.repository.ts
      ...
  composition/
    memory-platform-adapter.ts
    postgres-platform-adapter.ts
```

旧 `PlatformStore` 暂时作为 Facade/Compatibility Adapter，逐个领域切换调用者；每个 Port 有同一套 contract tests。只有达到 parity 才删除 Facade。

原 `apps/api/src/store.ts` 与 `pg-store.ts` 也按同样方式拆为 WorkPackage、Evidence、Contribution、Evaluation、Calculation、Ledger、Appeal、Notification 等 Repository。两种 Store 必须共用契约测试。

## 3. Domain/Application 目标结构

```text
packages/
  identity-domain/ (或先留在 domain 内的 identity 子域)
  work-package-domain/
  evidence-domain/
  contribution-domain/
  performance-domain/
  policy-dsl/                 # 继续保持纯确定性
  ledger/                     # 继续保持金额账本内核
  ai-governance/              # 由当前 ai-gate 演进
  agent-runtime/              # 由当前 runtime 演进
  agent-persistence/          # 数据库队列/任务执行权
  connectors/
```

第一阶段不一定真的拆成多个 workspace packages；可先用单一 `packages/domain/src/<domain>` 目录与 TS project reference 限定依赖。稳定后再根据团队边界拆包。

## 4. Agent Runtime 文件映射

| 当前 | V2 目标 | 主要工作 |
|---|---|---|
| `packages/agent-runtime/src/runtime.ts` | `engine/agent-orchestrator.ts` + task lifecycle services | 移除“只靠进程内 Map 管理任务”的唯一权威模式；增加 claim/lease/CAS |
| `scheduler.ts` | `scheduler/tenant-dispatcher.ts` + schedule registry | tenant-aware dispatch，不以单个环境变量绑定 Worker |
| `tools.ts` | `tools/registry.ts` + `tools/<domain>/*.tool.ts` | 每个 tool 绑定 schema、scope、idempotency、side-effect class、verifier |
| `skills.ts` | `agents/<agent>/observe.ts / plan.ts / verify.ts` | Skill 不止生成 findings/actions，增加 verification 与 close condition |
| `outbox.ts` | `events/outbox-dispatcher.ts` | inbox/outbox 幂等消费、claim lease、失败重试 |
| `agent-persistence/pg-repository.ts` | `persistence/task.repository.ts`、`action.repository.ts`、`audit.repository.ts` | task/step/action/audit/outbox 同事务或可靠一致性方案 |
| `apps/worker/src/index.ts` | Worker bootstrap + tenant dispatcher | 多租户队列消费、健康检查、优雅停机、并发上限 |

## 5. 前端重构映射

| 当前页面 | 目标工作空间/Feature |
|---|---|
| `DashboardPage.tsx` | Management Center overview（按角色可见不同视图） |
| `ContributionPage.tsx`、`TaskPodPage.tsx` | My Workbench + Contribution Review feature |
| `PerformancePage.tsx`、`CyclesPage.tsx` | Management Center / Cycle readiness |
| `RewardsPage.tsx`、`MyRewardsPage.tsx` | My Workbench / Reward explanation |
| `SettlementsPage.tsx`、`AwardBatchPage.tsx`、`ApprovalsPage.tsx` | Finance & Settlement |
| `AiPage.tsx`、`AgentOpsPage.tsx` | Agent Operations / AI Governance |
| `SettingsPage.tsx`、`PolicyPage.tsx`、`IntegrationsPage.tsx`、`PeoplePage.tsx`、`InstitutionsPage.tsx` | Governance & Configuration |

每个页面拆成 `Page`、`ViewModel hook`、`Feature components`、`Query/Command hooks`、`domain view types`。前端重组不应改变领域状态机。

## 6. 拆分顺序

1. P0 安全与评分语义修复（先于文件拆分）。
2. 拆 Evidence/Contribution API + Store（纵向切片最常改）。
3. 拆 Performance/AI Governance。
4. 拆 Policy/Calculation/Ledger/Settlement。
5. 拆 Integration/Governance/Organization。
6. 最后收敛低频扩展模块。

每次只迁移一组 endpoint + 一个 Port + 两种 Adapter + contract tests，禁止一次性大爆炸式重构。
