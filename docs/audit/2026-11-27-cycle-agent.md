# Performance Cycle Agent：确定性周期编排（2026-11-27）

## 1. 背景与范围

本审计记录对应新增的 Performance Cycle Agent 编排层：给定某一绩效周期的
只读快照，主动计算 **Evaluation Readiness** 与 **Payout Readiness**，并输出
blockers、结构化待办、审批提案与连续升级。

设计约束：

- **不接 LLM**：全部判定由确定性规则完成，没有模型调用、没有 prompt、
  没有自然语言推断。
- **只读纯函数**：不访问数据库、不发通知、不建批次、不锁账、不记账、不付款。
- **不自动批准/付款**：审批包只是提案，必须由人工审批后才允许进入锁账与
  支付路径。
- **fail-closed**：未知/缺失状态一律按“未完成”处理，无法证明的条件阻断。
- **金额零浮点**：所有金额按 1e6 定点 `BigInt` 求和/比较，格式化回
  `DecimalString`。
- 未修改 API / DB / 前端 / JEV / award 代码。

新增/修改文件（仅此四项）：

| 文件 | 说明 |
| --- | --- |
| `packages/agent-runtime/src/performance-cycle-agent.ts` | 编排实现（纯函数 + 无状态类） |
| `packages/agent-runtime/src/__tests__/performance-cycle-agent.test.ts` | 23 条定向测试 |
| `packages/agent-runtime/src/index.ts` | 追加 1 行 `export *` |
| `docs/audit/2026-11-27-cycle-agent.md` | 本审计记录 |

## 2. 输入快照

`PerformanceCycleSnapshot` 覆盖需求列出的七类事实：

- `people`：参与人（`eligible` 缺省 true；重复 personId 取第一条）。
- `goalCards`：目标卡与指标证据引用（`metrics[].evidenceRefs`）。
- `drafts`：评价草案及状态。
- `appeals`：申诉（兼容 `status` / `decisionStatus`）。
- `runs`：计算运行（`mode` 缺省 FORMAL；`blockers` 参与门禁）。
- `awards`：奖励批次 + 行（金额、币种、状态、`glComplete` 断言）。
- `payments`：支付回执 + 可选的逐笔 GL 凭证。

另外可传入：

- `history`：前几轮的 `blockerKeys`，按时间升序，最后一条是紧邻本轮的前一轮；
- `escalationThreshold`：连续升级阈值，默认 3（最小 2）。

输出不含时间戳/随机数，因此同一输入必然得到逐字节相同的输出。

## 3. 输出契约

```ts
{
  cycleId,
  readiness: { evaluation, payout },   // 每域 status + checks[]
  blockers:  { evaluation[], payout[] },
  blockerKeys: string[],               // 扁平稳定排序，可直接作为下一轮 history
  actions:   Action[],                 // 由 blockers 派生并稳定排序
  approvalPackage: Package | null,
  escalations: Escalation[],
  sideEffects: "NONE",
  note
}
```

每个 blocker 带稳定 `key`、域、检查项、原因码、subject 与建议 action kind /
ownerRole。每个 action 必含：

`kind`、`priority`、`ownerRole`、`subjectType`、`subjectId`、`reason`、
`message`、`blockerKey`、`idempotencyKey`。

action 排序：priority（P0 → P1 → P2）→ kind（需求列出的固定顺序）→
subjectType → subjectId → reason → idempotencyKey。

## 4. Readiness 门禁

### 4.1 Evaluation Readiness

| check | PASS 条件 | 违约事实 |
| --- | --- | --- |
| `goalCards` | 每个应参与人有状态 `LOCKED` 的目标卡 | `GOAL_CARD_MISSING` / `GOAL_CARD_NOT_LOCKED` |
| `evidenceComplete` | 每张已锁定卡的每个适用指标至少 1 条非空 `evidenceRefs`；至少声明 1 个指标 | `EVIDENCE_MISSING` / `GOAL_CARD_WITHOUT_METRICS` |
| `draftsDecided` | 每个应参与人至少 1 份草案，且全部草案为 `APPROVED`/`REJECTED` | `DRAFT_MISSING` / `DRAFT_UNDECIDED` |
| `appealsResolved` | 所有申诉为 `DECIDED`/`CLOSED` | `APPEAL_OPEN` |

没有应参与人时该域为 `NOT_MEASURABLE`（不等于 PASS，不会产包）。

### 4.2 Payout Readiness

| check | PASS 条件 | 违约事实 |
| --- | --- | --- |
| `calculationLocked` | 存在 FORMAL run；全部 `APPROVED`/`LOCKED` 且至少一个 `LOCKED`；run 自身无 blockers | `CALCULATION_MISSING` / `RUN_NOT_FINALISED` / `RUN_BLOCKED` / `RUN_NOT_LOCKED` |
| `awardsBatched` | 至少一个非取消批次；批次非空；金额/币种自洽；每个应参与人至少 1 条批次行 | `BATCH_MISSING` / `BATCH_EMPTY` / `BATCH_TOTAL_INVALID` / `BATCH_TOTAL_MISMATCH` / `BATCH_CURRENCY_MISSING` / `LINE_AMOUNT_INVALID` / `LINE_CURRENCY_MISMATCH` / `DUPLICATE_LINE_ID` / `AWARD_MISSING` |
| `batchesApproved` | 所有非取消批次为 `APPROVED`/`LOCKED`/`EXPORTED`/`ACKNOWLEDGED` | `BATCH_NOT_APPROVED` |
| `paymentsMatchDue` | 每条批次行的 PAID 回执合计恰好等于应付；币种一致；无 FAILED/RETURNED 或未知回执 | `PAYMENT_MISSING` / `PAYMENT_UNDERPAID` / `PAYMENT_OVERPAID` / `PAYMENT_FAILED` / `PAYMENT_RETURNED` / `PAYMENT_NOT_PAID` / `PAYMENT_UNKNOWN_BATCH` / `PAYMENT_UNKNOWN_LINE` / `PAYMENT_AMOUNT_INVALID` / `PAYMENT_CURRENCY_MISMATCH` |
| `glComplete` | 每笔 PAID 要么有可验证的平衡 GL，要么批次显式 `glComplete === true` | `GL_MISSING` / `GL_UNBALANCED` / `GL_AMOUNT_MISMATCH` / `GL_INVALID` |

GL 判定细则（fail-closed）：

- 逐笔 `gl.present === false` 或 `gl.balanced === false` **优先阻断**，即使批次
  断言 `glComplete` 为 true（显式事实覆盖聚合断言）；
- 同时给出借贷金额时必须相等，且等于该笔支付金额；
- 只给单边金额视为不可验证；
- 既无逐笔凭证、批次也未断言 `glComplete` 时阻断。

## 5. Blocker → Action 映射

| Action kind | 触发场景 | ownerRole | priority |
| --- | --- | --- | --- |
| `COLLECT_EVIDENCE` | 缺证据 / 目标卡无指标 | MANAGER | P1 |
| `COMPLETE_DRAFT` | 缺评价草案 / 草案未决 / 目标卡未锁定/缺失 | MANAGER | P1 |
| `RESOLVE_APPEAL` | 未结申诉 | HR | P0 |
| `RUN_CALCULATION` | 缺 FORMAL run / run 未定稿 / run 有 blockers | FINANCE | P0 |
| `LOCK_RUN` | run 已 APPROVED 但无 LOCKED run | FINANCE | P0 |
| `CREATE_BATCH` | 缺批次 / 批次未审批 / 批次结构性金额问题 / 参与人漏批次 | FINANCE | P1 |
| `RECORD_PAYMENT` | 未付 / 少付 / 多付 / 失败/退回 / 未知或币种错误回执 | FINANCE | P1 |
| `FIX_GL` | PAID 缺 GL / 未平衡 / 金额不符 / 不可验证 | FINANCE | P0 |

每条 action 的幂等键：

```text
perf-cycle:<cycleId>:<kind>:<blockerKey>
```

不包含轮次、生成时间、数组下标或随机量。

## 6. 审批包

仅当 `evaluation.status === "PASS"` **且** `payout.status === "PASS"` 时生成，
否则为 `null`。包内包含：

- 周期：`cycleId`、`cycleName`、`period`；
- 金额：按币种汇总的批次行应付金额（`amountByCurrency`）；
- 人数：批次行覆盖的去重人数；
- 批次：非取消批次 id（稳定排序）；
- 计算：已定稿/锁定 run id；
- 支付笔数与 GL 完整性（`glComplete`）；
- 红线字段：`requiresHumanApproval: true`、`autoApproved: false`、
  `autoPaid: false`。

`packageKey` 由周期、批次与币种金额派生，同输入重复生成一致。

## 7. 连续升级

- 默认阈值 3 轮（含本轮）；只有**连续**出现才累计，中间任一轮缺失即清零。
- 升级项保留 blocker 的原因码、检查项、subject、建议 action 与 ownerRole。
- `ownerRole` 只允许 `HR` / `FINANCE` / `MANAGER`。
- 升级键：`perf-cycle-escalation:<cycleId>:<blockerKey>`，跨轮稳定，便于上层
  去重通知/待办。

## 8. 幂等与副作用

- 纯函数：不修改输入对象；测试用 `JSON.stringify` 前后比对确认。
- 内部所有集合先按 id 稳定排序，再做 Map 聚合，输出顺序与输入数组顺序无关。
- 同一输入连续调用三次，结果深比较相等。
- action 幂等键唯一；blockerKeys 扁平稳定，可直接持久化后回灌 `history`。
- 不调用任何写接口；结果只声明 `sideEffects: "NONE"`，不产生“已执行/已付款”
  字段。审批包上的 `autoApproved/autoPaid` 恒为 false。

## 9. 测试证据

测试文件：`packages/agent-runtime/src/__tests__/performance-cycle-agent.test.ts`

覆盖：

1. 缺证据 → `COLLECT_EVIDENCE`（MANAGER / EVIDENCE_MISSING）；
2. 目标卡无指标 → fail-closed；
3. 缺草案 → `COMPLETE_DRAFT`（DRAFT_MISSING）；
4. 草案未决 → `COMPLETE_DRAFT`（DRAFT_UNDECIDED）；
5. 未结申诉 → `RESOLVE_APPEAL`（HR / APPEAL_OPEN）；
6. 缺计算 → `RUN_CALCULATION`；已审批未锁 → `LOCK_RUN`；
7. 缺批次 → `CREATE_BATCH`；
8. 缺支付 → 逐行 `RECORD_PAYMENT`；
9. GL 未平衡 / 缺失 → `FIX_GL`；
10. 双域 PASS → 包内周期/金额/人数/批次/GL 正确；任一域阻断 → 包为 null；
11. 连续 3 轮升级；中间断档不升级；阈值可配；
12. 重放完全一致；输入数组倒序不改变 actions/blockerKeys；幂等键唯一；
13. action 结构化契约与稳定排序；
14. 不自动批准/付款，无副作用。

验收命令与结果：

```text
$ npx tsc --noEmit
TSC_EXIT=0

$ CI=1 npx vitest run packages/agent-runtime/src/__tests__/performance-cycle-agent.test.ts </dev/null
✓ packages/agent-runtime/src/__tests__/performance-cycle-agent.test.ts (23 tests)
Test Files  1 passed (1)
Tests       23 passed (23)
VITEST_EXIT=0
```

## 10. 已知边界

- Agent 不持久化 history；连续升级依赖调用方把上一轮 `blockerKeys` 追加到
  `history`（这是保持纯函数与可重放的代价）。
- 快照由调用方按周期圈定；跨周期数据不会被本 agent 自动过滤（`runs` 若带
  `cycleId` 会过滤，其余事实按快照边界处理）。
- 本层只做“是否就绪/下一步做什么”的编排，不替代人工审批、锁账、付款或
  GL 过账；所有金额事实仍以原始记录为准。
- 本次未 commit（按任务要求）。
