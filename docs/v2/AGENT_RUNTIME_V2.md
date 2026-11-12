# Agent Runtime V2 设计与验收

## 1. 当前代码位置与差距

- Runtime: `packages/agent-runtime/src/runtime.ts`，进程内 Map 维护 task，使用可选 Repository 加载/保存。
- Scheduler: `packages/agent-runtime/src/scheduler.ts`，schedule/event/threshold 类型规则。
- Tools: `packages/agent-runtime/src/tools.ts`，`create_todo` 当前仅生成随机 ID 返回，非持久化待办。
- Persistence: `packages/agent-persistence/src/pg-repository.ts`，`saveTask` 与 `appendAudit` 是不同事务。
- Worker: `apps/worker/src/index.ts`，以环境变量 `TENANT_ID` 构造 context/runtime/repository/scheduler。

现有基础是可复用的，不应推倒重来；需要将“任务对象持久化”提升为“执行权、步骤、动作、审计和结果的数据库驱动状态机”。

## 2. V2 核心模型

### AgentTask

`id, tenant_id, agent_type, trigger_type, trigger_ref, goal, status, priority, next_run_at, lease_owner, lease_expires_at, version, attempt_count, idempotency_key, correlation_id, created_at, updated_at`

### AgentStep

`task_id, sequence, step_type, input_ref, output_ref, status, started_at, finished_at, retry_policy, error_code`

### ToolInvocation

`id, task_id, step_id, tool_name, input_hash, output_hash, idempotency_key, requested_by_agent, approved_by, executed_by, status, started_at, finished_at, compensation_ref`

### VerificationResult

`task_id, action_id, verifier, assertion_code, expected_state, observed_state, passed, evidence_refs, verified_at`

### AgentAuditEvent

记录 enqueue、claim、observe、plan、approval request、approval/denial、tool execution、verification、retry、dead-letter、escalation、manual takeover、cancel。

## 3. 状态流

`QUEUED → CLAIMED → OBSERVING → PLANNING → WAITING_APPROVAL | EXECUTING → VERIFYING → SUCCEEDED | BLOCKED | ESCALATED | FAILED | DEAD_LETTERED | CANCELLED`

每次状态变化都由数据库 CAS/version 更新；Worker 通过 `FOR UPDATE SKIP LOCKED` 或等效原子 claim 获得 lease；租约过期可恢复；相同 idempotency key 不重复产生副作用。

## 4. Tool Contract

每个工具必须声明：

- input/output Zod schema
- read/write scope 与 tenant scope
- risk tier T0–T3
- idempotency key derivation
- timeout、retryability、rate limits
- side-effect description
- precondition validator
- execution handler
- postcondition verifier
- compensation/rollback 或人工恢复说明
- audit fields

`create_todo` 必须真正写入 Work Queue / Follow-up Task，含 owner、dueAt、relatedObject、reason、sourceAgentTask、status。重复触发必须返回既有任务而不是新建。

## 5. 风险与授权

- T0：读取和分析，不写业务对象。
- T1：提醒、催补证、创建可撤销任务；受 tenant policy、频率和 recipient 权限限制。
- T2：改派责任人、创建复核、升级工单；按租户策略批准或双阶段执行。
- T3：正式贡献认定、绩效定案、政策发布、金额批准、账本锁定、撤销已结算结果；必须由有权限且非利益冲突的人员批准，Agent 不得自批。

审批必须绑定 exact action payload hash；批准后 payload 变化自动失效。

## 6. 三条先行工作流

### A. Evidence Completeness

Observe：周期、岗位、工作包、证据要求、Evidence Coverage。  
Detect：缺少必需证据、来源过期、证据冲突。  
Plan：确定责任人、要求补充的最小材料、SLA。  
Act：创建待办/发提醒。  
Verify：检查新证据存在、归属正确、源信息完整。  
Close：关闭原 issue；否则升级。

### B. Contribution Exception

Observe：已验收工作包、责任快照、claims、attestations、decisions、conflict declarations。  
Detect：未申报、申报重复、多人冲突、裁决冲突、无责任快照、逾期。  
Act：生成异常清单、分派补证或人工裁决。  
Verify：claim/decision 状态发生预期变化。  
Close/Escalate：无法解决或利益冲突时升级至独立人员。

### C. Cycle Readiness

Observe：周期、数据同步、指标快照、评价、申诉、policy/legal gates、calculation、approvals、ledger。  
Detect：缺项、计算阻断、政策不适用、审批过期、重复 settlement。  
Act：按责任人生成修复任务，低风险提醒。  
Verify：门禁逐项变成通过，重新运行 calculation dry-run。  
Close：生成 Ready/Not Ready 报告和证据包；不得自行锁账。

## 7. 运行指标

必须把当前 `falsePositiveRate`、`costPerClosedLoop`、`aiOffFloor` 的 null 占位改成有数据来源的值或明确“不可测”状态，并设定追踪任务：

- detect precision/recall（由人工标注闭环结果提供标签）
- auto-resolved rate（经业务验证后关闭，不是仅执行工具就算）
- verification failure rate
- human override / approval / escalation rate
- median time to close
- retry/dead-letter rate
- cost per verified closure（模型、工具、基础设施成本）
- AI-off completion rate（人工流程完成率）

## 8. 故障注入验收

- worker 在 claim 后崩溃：租约过期后任务可被重新 claim，不丢失步骤。
- action 已产生副作用、task 保存前崩溃：重试通过 idempotency 防止重复写。
- 审批后 action payload 被改变：审批失效。
- 两个 worker 同时 claim：只有一个获得执行权。
- 外部 API 超时但实际成功：通过 external idempotency key 或 read-after-write 验证，不重复发送。
- tenant A task 不能读取/写入 tenant B 对象。
- T3 action 无批准不能执行；批准人不能与被保护的利益相关方冲突。
- AI provider 不可用：bounded workflow 回退到规则/人工流程。
