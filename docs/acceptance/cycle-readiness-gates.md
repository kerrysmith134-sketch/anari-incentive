# 验收：周期就绪门禁（Cycle Readiness Gates）

- 验收对象：`CycleReadinessWorkflow`（NPV2-026）就绪判定
- 代码唯一来源：`packages/agent-runtime/src/cycle-readiness.ts`
- 回归测试：`packages/agent-runtime/src/__tests__/cycle-readiness.test.ts`
- 既有回归：`packages/agent-runtime/src/__tests__/runtime.test.ts`（cycle readiness 用例）
- 缺陷来源：Cycle Readiness 审计（评价 DRAFT 放行 / 申诉 WARN 放行 / 计算门禁只看单个 run）
- 影响面：门禁结论决定周期能否进入人工锁账与结算，属金额相关判定

## 门禁口径（本轮修正后）

| 门禁 | PASS | BLOCKED | NOT_MEASURABLE |
| --- | --- | --- | --- |
| DATA | 无未关闭 BLOCKING 级数据质量问题 | 存在未关闭 BLOCKING 问题 | — |
| POLICY | 周期引用的政策版本已发布 | 政策版本取不到 | 周期内无 run 引用政策版本 |
| LEGAL | 政策版本有法务门禁记录 | 有 FORMAL run 但无法务门禁 | 无 FORMAL run / 政策版本 |
| EVALUATION | 周期内草案全部已决（APPROVED/REJECTED） | 存在任一未决草案（DRAFT、SUBMITTED，或其它非已决状态） | 周期内无草案 |
| APPEAL | 申诉全部 DECIDED/CLOSED | 存在任一未结申诉 | — |
| CALCULATION | 所有 FORMAL run 均 APPROVED/LOCKED，且至少一个 LOCKED | 任一 FORMAL run 为其它状态（含 BLOCKED/REVIEW 类），或无 LOCKED | 周期内无 FORMAL run |
| APPROVAL | 无 run 登记未解决 blockers | 存在带 blocker 的 run | 周期内无 run |

`ready` = 无任何 `BLOCKED` 且全部必需门禁（POLICY/LEGAL/EVALUATION/CALCULATION/APPROVAL）为 `PASS`。
必需门禁的 `NOT_MEASURABLE` 视同未就绪（AUD-012 / NP-007）。DATA 仍为披露性门禁，不单独阻断。

## 三处修正与理由

1. **评价门禁：DRAFT 也阻断。** 原实现只拦 `SUBMITTED`，未提交草案可以无限期挂起且金额仍可被改写；现 `DRAFT`/`SUBMITTED` 均计为未决，只有 `APPROVED`/`REJECTED` 视为已决。判定取 fail-closed：未识别/未来新增状态按未决处理，detail 列出未决状态集合。
2. **申诉门禁：open appeal 改为 BLOCKED（原 WARN）。** 申诉可改判归属与最终金额；在申诉未结案时把周期判为就绪，等于让未定金额进入结算。`DECIDED`/`CLOSED` 之外的任何状态（含 `OPEN`/`TRIAGED`/`UNDER_REVIEW`/`RECALCULATION_REQUIRED`）都阻断。
3. **计算门禁：不再"存在一个已审批 run"即通过。** 现在要求周期内**所有** FORMAL run 均为 `APPROVED`/`LOCKED`，且至少一个 `LOCKED`；任一未定稿状态即 `BLOCKED`，detail 列出未定稿状态集合。影子（SHADOW）run 仍不满足该门禁。

## 只读红线

本工作流不锁账、不结算、不写任何金额：报告 `note` 明确声明 `does not lock runs or settle batches`。门禁只输出判定与来源 id，处置仍走人工/审批路径。

## 验收命令

```bash
npx tsc --noEmit
CI=1 npx vitest run packages/agent-runtime </dev/null
```

回归覆盖：DRAFT 阻断、SUBMITTED 阻断、全部已决 PASS、无草案 NOT_MEASURABLE、open appeal BLOCKED、closed appeal PASS、混合 FORMAL run BLOCKED、全 LOCKED PASS、全 APPROVED 无 LOCKED BLOCKED、APPROVED+LOCKED PASS、仅 SHADOW NOT_MEASURABLE、`ready` 语义与不产出 WARN。
