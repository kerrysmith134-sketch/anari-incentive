# 安全与数据可靠性整改规范

## 1. RLS 设计

当前 Platform Pool 在连接参数中开启 `app.platform_admin=on`。V2 不将全局 admin setting 作为应用默认连接行为。

### 目标访问模式

- Normal tenant transaction：`BEGIN` → `set_config('app.tenant_id', tenantId, true)` → 执行 query → `COMMIT`。
- Platform admin transaction：先验证认证主体和平台权限，再通过单独的显式 wrapper 执行；记录 admin actor、reason、target 和 request id；事务结束即清除上下文。
- Worker transaction：从已被认证和授权的 AgentTask/Job 解析 tenantId，不从任意 payload 接受 tenantId。

## 2. ActorContext

所有写命令携带服务端构造的 ActorContext，不从 body 信任执行者 ID。区分：

- `initiatedBy`：谁提出请求。
- `approvedBy`：谁批准。
- `executedBy`：谁/哪个 service 执行。
- `subjectPersonId`：动作作用于谁。
- `agentTaskId`：由哪个 agent task 发起。

所有身份字段均进入不可变审计事件。前端不能指定 actorId 代替当前登录主体。

## 3. Money Path

- Calculation Input Snapshot、Policy Version、Engine Version、Trace Hash 必须不可变。
- ApprovalRequest 绑定目标动作和 payload hash；一次性消费。
- Ledger Entry 在 DB 层 append-only；应用 DB role 不可 UPDATE/DELETE。
- Settlement 只允许 LOCKED ledger；同一 ledger 不能并行进入多个 active settlement。
- Posting、approval consumption、audit/outbox 应在同一个数据库事务或可靠事务性 outbox 模式中完成。
- 纠错只能以 reversal/adjustment 追加；重放必须可审计。

## 4. Agent 工具安全

- Tool registry 允许列表，不允许运行时任意工具名或 URL。
- 证据文本视为不可信输入；检索结果不能直接触发调用。
- Tool input 经 Zod schema；tenant/resource scope 在服务端重新解析。
- T3 必须走 Approval Service，批准 payload hash 不匹配即拒绝。
- 每次 tool call 有 actor、approval、tenant、request/task、输入输出 hash、执行结果。
- 外部 egress 域名 allowlist；敏感字段在 prompt 前脱敏/最小化。

## 5. 必测安全矩阵

- tenant A/B 相互读写、IDOR、搜索、聚合、导出、异步任务。
- pool connection reuse 后 RLS session variable 不泄漏。
- platform admin 权限不可由 tenant admin 或 user request 自行提升。
- body 中伪造 requestedBy/decidedBy/approvedBy 被忽略或拒绝。
- 自批、利益冲突裁决、本人验收均阻断。
- Agent reader role 不可写；actor role 也不能越过业务权限。
- prompt injection 不可改变 Tool allowlist、tenant scope 或 actor。
- approval payload 变更、重复消费、过期消费均阻断。
- ledger UPDATE/DELETE 被 DB role / trigger 双重拒绝。
- audit/outbox/task 在故障注入后不出现不可解释的部分提交。

## 6. 生产发布门禁

不得只凭 `docs/PRD_TRACEABILITY.md` 的测试数量判定安全完成。每次 release 保留：migration run log、RLS integration test 报告、money path test 报告、backup restore 证据、E2E 截图/录像、dependency scan、secret scan、permission matrix 和 security review sign-off。
