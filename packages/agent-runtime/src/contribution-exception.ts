import type { AgentContext, ContributionClaim } from "./types.js";

/**
 * NPV2-025：Contribution Exception bounded workflow。
 *
 * 扫描贡献申报的三类异常并追踪到关闭（**不自动裁决**——所有裁决由人工
 * 通过 AttributionDecision 完成，本工作流只建待办/升级/按状态事实关闭）：
 * 1. 未认定超时：SUBMITTED 后超过 slaDays 仍无归属决定 → 建独立裁决待办；
 * 2. 补证指派：NEEDS_EVIDENCE 状态 → 建补证待办（assignee=申报人本人）；
 * 3. 自裁冲突：决策人 = 申报人 → 升级经理通道要求独立复核。
 * 关闭以状态事实为准：申报离开可裁决状态（ACCEPTED/REJECTED/WITHDRAWN）
 * 后，对应 OPEN 异常待办自动关闭（completedBy=SYSTEM_STATE_RECONCILED）。
 */
export interface ContributionExceptionAuditEntry {
  at: string;
  action:
    | "ADJUDICATION_TODO_CREATED"
    | "EVIDENCE_TODO_CREATED"
    | "CONFLICT_ESCALATED"
    | "TODO_STATE_RECONCILED"
    | "NO_OP";
  claimId: string;
  todoId?: string;
  detail: string;
}

export interface ContributionExceptionRunResult {
  adjudicationTodosCreated: number;
  evidenceTodosCreated: number;
  conflictsEscalated: number;
  todosReconciled: number;
  audit: ContributionExceptionAuditEntry[];
}

export interface ContributionExceptionWorkflowOptions {
  /** 未认定超时天数（SUBMITTED 后算起）。默认 3。 */
  slaDays?: number;
  /** now 的可注入覆盖（测试用）。 */
  now?: () => number;
}

const DONE_STATES = new Set(["ACCEPTED", "REJECTED", "WITHDRAWN"]);

export class ContributionExceptionWorkflow {
  private readonly slaDays: number;
  private readonly nowFn: () => number;
  /** 本实例已升级的 claim（跨轮去重；跨实例由通知幂等键兜底）。 */
  private readonly escalatedAdjudications = new Set<string>();

  constructor(
    private readonly context: AgentContext,
    options: ContributionExceptionWorkflowOptions = {},
  ) {
    this.slaDays = options.slaDays ?? 3;
    this.nowFn = options.now ?? Date.now;
  }

  async runOnce(): Promise<ContributionExceptionRunResult> {
    const audit: ContributionExceptionAuditEntry[] = [];
    const at = new Date().toISOString();
    let adjudicationTodosCreated = 0;
    let evidenceTodosCreated = 0;
    let conflictsEscalated = 0;
    let todosReconciled = 0;

    const openTodos = await this.context.listAgentTodos({ status: "OPEN" });
    const claims = await this.context.listClaims();
    const nowMs = this.nowFn();

    for (const claim of claims as Array<ContributionClaim & { submittedAt?: string }>) {
      const decisions = await this.context.listDecisions(claim.id);
      const hasHumanDecision = decisions.some(
        (decision) =>
          decision.adjudicatorPersonId !== claim.claimantPersonId,
      );
      const adjudicationKey = `contribution-exception:adjudication:${claim.id}`;
      const evidenceKey = `contribution-exception:evidence:${claim.id}`;

      // 终态申报：关闭遗留 OPEN 异常待办（状态事实为准），不再产生新待办。
      if (DONE_STATES.has(claim.status)) {
        for (const todo of openTodos) {
          if (todo.targetId !== claim.id) continue;
          if (!/^(contribution-exception:)/.test(todo.idempotencyKey ?? "")) {
            continue;
          }
          // 系统完成：completed_by 留空（PG uuid 列不能写非 UUID 字符串）。
          await this.context.completeAgentTodo(todo.id);
          todosReconciled += 1;
          audit.push({
            at,
            action: "TODO_STATE_RECONCILED",
            claimId: claim.id,
            todoId: todo.id,
            detail: `claim is ${claim.status}; exception todo closed by state fact`,
          });
        }
        continue;
      }

      // 冲突：自裁（决策人=申报人）→ 升级经理通道，不自动改判。
      const selfAdjudicated = decisions.some(
        (decision) => decision.adjudicatorPersonId === claim.claimantPersonId,
      );
      if (selfAdjudicated) {
        await this.context.createNotification({
          audience: "MANAGER",
          title: "Contribution conflict: self-adjudication",
          body: `Claim ${claim.id} was adjudicated by its own claimant; independent review required.`,
          sourceType: "CONTRIBUTION_CLAIM",
          sourceId: claim.id,
          // 稳定幂等键——每轮扫描不重复通知。
          idempotencyKey: `self-adjudication:${claim.id}`,
        });
        conflictsEscalated += 1;
        audit.push({
          at,
          action: "CONFLICT_ESCALATED",
          claimId: claim.id,
          detail: "self-adjudication escalated for independent review",
        });
      }

      // 补证指派：NEEDS_EVIDENCE → 待办给申报人本人。
      if (claim.status === "NEEDS_EVIDENCE") {
        const alreadyOpen = openTodos.some(
          (todo) =>
            todo.targetId === claim.id &&
            (todo as { idempotencyKey?: string }).idempotencyKey ===
              evidenceKey,
        );
        if (!alreadyOpen) {
          const todo = await this.context.upsertAgentTodo({
            title: `补交申报证据 ${claim.id}`,
            detail: "Claim was moved to NEEDS_EVIDENCE; supply the requested evidence.",
            assigneePersonId: claim.claimantPersonId,
            targetType: "CONTRIBUTION_CLAIM",
            targetId: claim.id,
            sourceType: "AGENT_FINDING",
            sourceId: "NEEDS_EVIDENCE",
            idempotencyKey: evidenceKey,
          });
          evidenceTodosCreated += 1;
          audit.push({
            at,
            action: "EVIDENCE_TODO_CREATED",
            claimId: claim.id,
            todoId: todo.id,
            detail: `evidence todo assigned to claimant ${claim.claimantPersonId}`,
          });
        }
      }

      // 未认定超时：SUBMITTED 且无人工归属决定，超 slaDays → 独立裁决待办。
      const awaiting =
        claim.status === "SUBMITTED" || claim.status === "UNDER_REVIEW";
      if (awaiting && !hasHumanDecision && claim.submittedAt) {
        const deadline =
          Date.parse(claim.submittedAt) + this.slaDays * 24 * 60 * 60 * 1000;
        if (nowMs > deadline) {
          const alreadyOpen = openTodos.some(
            (todo) =>
              todo.targetId === claim.id &&
              (todo as { idempotencyKey?: string }).idempotencyKey ===
                adjudicationKey,
          );
          if (!alreadyOpen) {
            if (this.escalatedAdjudications.has(claim.id)) continue;
            // AUD-011：不做非法 UUID 写入——逾期裁决走经理升级通知
            // （无持久化待办；裁决由人工在认定模块完成，红线不自动裁决）。
            await this.context.createNotification({
              audience: "MANAGER",
              title: "Contribution adjudication overdue",
              body: `Claim ${claim.id} has no independent decision within ${this.slaDays} days. Assign an adjudicator in the contribution module.`,
              sourceType: "CONTRIBUTION_CLAIM",
              sourceId: claim.id,
              // AUD-011：稳定幂等键——同一逾期事项只通知一次。
              idempotencyKey: `adjudication-overdue:${claim.id}`,
            });
            this.escalatedAdjudications.add(claim.id);
            adjudicationTodosCreated += 1;
            audit.push({
              at,
              action: "ADJUDICATION_TODO_CREATED",
              claimId: claim.id,
              detail: `adjudication overdue (sla ${this.slaDays}d); manager escalation sent (no auto-adjudication)`,
            });
          }
        }
      }
    }

    if (
      adjudicationTodosCreated +
        evidenceTodosCreated +
        conflictsEscalated +
        todosReconciled ===
      0
    ) {
      audit.push({ at, action: "NO_OP", claimId: "", detail: "no exceptions" });
    }
    return {
      adjudicationTodosCreated,
      evidenceTodosCreated,
      conflictsEscalated,
      todosReconciled,
      audit,
    };
  }
}

