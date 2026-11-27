# 验收：奖励发放就绪（Payout Readiness）

- 验收对象：`evaluatePayoutReadiness`（NP-PAY-READY）
- 代码唯一来源：`packages/agent-runtime/src/payout-readiness.ts`
- 回归测试：`packages/agent-runtime/src/__tests__/payout-readiness.test.ts`
- 定位：与评价就绪（Evaluation Readiness）分开。评价就绪回答“人是否评完”；本模块回答“钱是否可以按批次安全发放/回执”。
- 输入：人员决定（`personId` / `decisionStatus` / `eligibility`）、奖励批次（`status` / `lines` / `totalAmount` / `currency` / `payments` / `glComplete`）、可选应发奖励清单（`dueAwards`）与未结申诉/退回。
- 影响面：判定结论直接决定能否进入人工付款与批次回执，属金额相关判定。

## 七项检查口径

只有七项全部 `PASS` 才 `ready = true`。任何 `BLOCKED` 或 `WARN` 都视为未就绪。

| # | 检查 | PASS | BLOCKED / WARN |
| --- | --- | --- | --- |
| 1 | `allPeopleDecided` | 每个应参与人员（`eligibility=true`，或出现在批次行中）有 `FORMAL` / `DECIDED`，或被明确 `EXCLUDED` | 缺决定、未决状态（含未知/未来新增状态）、同一人重复决定 |
| 2 | `allAwardsBatched` | 所有应发奖励都在非取消批次；同一来源记录只被一个批次行引用 | 空批次、应参与人员无批次行、`dueAwards` 未入批次、来源记录重复、批次/行 id 重复、行缺来源记录（WARN）、已排除人员仍有奖励行（WARN） |
| 3 | `batchApprovedLocked` | 每个非取消批次为 `APPROVED` / `LOCKED` / `EXPORTED` / `ACKNOWLEDGED` | 其它状态（`DRAFT` / `PENDING_APPROVAL` / 未知状态） |
| 4 | `paidMatchesDue` | 每个币种 Σ`PAID` = 应付总额；每行已付 = 行金额 | 少付（`UNPAID` / `PARTIAL`）、多付、批次总额与行合计不符、未知行支付、币种不符、非法金额 |
| 5 | `everyPaidHasGl` | 有 `PAID` 支付的批次 `glComplete=true`，且可选的单笔 GL 凭证借贷平衡、金额等于支付额 | `glComplete` 非 true、凭证缺失、借贷不平、GL 金额与支付额不符、金额无法验证（WARN） |
| 6 | `noOpenReturnsAppeals` | 无 `RETURNED` / `FAILED` 支付；申诉均为 `DECIDED` / `CLOSED`；退回均为已结 | 任一 `RETURNED` / `FAILED`、未结申诉、未结退回 |
| 7 | `ackImmutable` | `ACKNOWLEDGED` 批次在 `acknowledgedAt` 之后没有普通支付 | ACK 后出现普通支付、ACK 批次有支付但缺 `acknowledgedAt`、支付缺时间戳（WARN） |

`CANCELLED` 批次不计入应付/已付与批次状态检查，但其 `RETURNED` / `FAILED` 支付仍会在第 6 项暴露，避免取消批次里的退款事实被静默忽略。

## 判定与金额口径

- **fail-closed**：未识别状态、缺失时间戳、缺失来源记录等无法证明安全的条件不会被静默放行；对应检查为 `WARN` 时同样不 ready。
- 金额一律按 1e6 定点用 `BigInt` 加减，禁止浮点。输出为去掉尾随零的十进制字符串；差值可能为负（`variance = paid - due`）。
- 多币种：`amounts.byCurrency` 逐币种给出 `due` / `paid` / `outstanding` / `variance`，并按币种分别要求 Σ`PAID` = 应付；多币种时顶层总额字段为 `null`，避免把不同币种相加。
- `paidMatchesDue` 同时做行级与批次级核对：即使批次合计相等，只要某行 `PARTIAL` / `OVERPAID`，仍阻断。
- `allAwardsBatched` 在提供 `dueAwards` 时按 `sourceRecordId` 逐项核对是否入批次，并在金额/币种/人员不一致时阻断；未提供时退化为“每个应参与人员至少一条批次行”的人员级覆盖检查。

## 输出结构

```ts
{
  ready: boolean,
  checks: Array<{
    check: "allPeopleDecided" | "allAwardsBatched" | "batchApprovedLocked"
         | "paidMatchesDue" | "everyPaidHasGl" | "noOpenReturnsAppeals" | "ackImmutable",
    status: "PASS" | "BLOCKED" | "WARN",
    detail: string,
    sources: Array<{ type: string; id: string }>
  }>,
  blockers: Array<{ code, check, severity: "BLOCKER", message, subjectType?, subjectId? }>,
  warnings: Array<{ code, check, severity: "WARNING", message, subjectType?, subjectId? }>,
  amounts: {
    currency: string | null,
    due: string | null,
    paid: string | null,
    outstanding: string | null,
    variance: string | null,
    byCurrency: Array<{ currency, due, paid, outstanding, variance }>
  },
  note: string,
  generatedAt: string
}
```

## 只读红线

本模块是纯函数，不创建批次、不发起支付、不写 GL、不锁账、不结算。报告 `note` 明确声明 `does not create batches, pay, post GL entries, lock or settle`；处置仍走人工/审批路径。

## 验收命令

```bash
npx tsc --noEmit
CI=1 npx vitest run packages/agent-runtime/src/__tests__/payout-readiness.test.ts </dev/null
```

## 回归覆盖

- 全通过（七项 PASS、金额 300/300、无 blocker/warning）；
- 未决人员（`DRAFT`）→ 第 1 项 BLOCKED；
- 漏批次：`dueAwards` 未入批次、应参与人员无批次行、完全无批次；
- 少付：行级 `PARTIAL` 且总额不足；
- 合计相等但行级 `PARTIAL` / `OVERPAID`；
- 无 GL（`glComplete=false`）与单笔 GL 借贷不平；
- 退回支付（即使已有替代支付）与未结申诉；
- ACK 之后又出现普通支付；
- 空批次；
- 跨批次重复来源记录。
