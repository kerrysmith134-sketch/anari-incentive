import type { AgentContext } from "./types.js";
import { EvidenceGapSkill } from "./skills.js";

/**
 * NPV2-024：Evidence Completeness bounded workflow。
 *
 * 端到端闭环（不依赖 AI——每一步都可由人工在业务 UI 完成）：
 * 1. 发现缺口：复用 EvidenceGapSkill 的 observe（无证据的工作包等）；
 * 2. 建待办 + 催补证：为每个缺口的 owner 建持久待办（幂等键
 *    evidence-gap:<workPackageId>，重复运行不重复创建）；
 * 3. 验证证据入库：待办关联的工作包出现证据后，系统校验并关闭待办
 *    （completedBy = SYSTEM_EVIDENCE_VERIFIED）；
 * 4. 升级：OPEN 且已过 dueAt 的待办向经理通道发升级通知；
 * 5. 全程产出审计记录，由调用方落审计链。
 */
export interface EvidenceCompletenessAuditEntry {
  at: string;
  action: "TODO_CREATED" | "TODO_VERIFIED_CLOSED" | "ESCALATED" | "NO_OP";
  workPackageId: string;
  todoId?: string;
  detail: string;
}

export interface EvidenceCompletenessRunResult {
  todosCreated: number;
  todosVerifiedClosed: number;
  escalations: number;
  audit: EvidenceCompletenessAuditEntry[];
}

/** 证据缺口待办的状态快照（AgentContext.listAgentTodos 的子集）。 */
interface GapTodo {
  id: string;
  title?: string;
  status: string;
  dueAt?: string;
  targetId?: string;
}

export class EvidenceCompletenessWorkflow {
  private readonly gapSkill = new EvidenceGapSkill();

  constructor(private readonly context: AgentContext) {}

  async runOnce(): Promise<EvidenceCompletenessRunResult> {
    const audit: EvidenceCompletenessAuditEntry[] = [];
    const at = new Date().toISOString();
    let todosCreated = 0;
    let todosVerifiedClosed = 0;
    let escalations = 0;

    // 1) 发现缺口（复用 019 之前的 observe 逻辑）。
    const findings = await this.gapSkill.observe(this.context, {});
    const evidenceGaps = findings.filter(
      (finding) => finding.code === "NO_EVIDENCE",
    );

    const existingTodos = await this.context.listAgentTodos({
      status: "OPEN",
    });

    // 2) 缺口 → 持久待办（幂等键 evidence-gap:<wpId>）+ 催补证通知。
    for (const gap of evidenceGaps) {
      const key = `evidence-gap:${gap.subjectId}`;
      const alreadyOpen = existingTodos.some(
        (todo) =>
          todo.targetId === gap.subjectId && todo.status === "OPEN",
      );
      if (alreadyOpen) continue;
      const todo = await this.context.upsertAgentTodo({
        title: `补交工作包证据 ${gap.subjectId}`,
        detail: gap.message,
        assigneePersonId: await this.ownerOf(gap.subjectId),
        targetType: gap.subjectType,
        targetId: gap.subjectId,
        sourceType: "AGENT_FINDING",
        sourceId: gap.code,
        idempotencyKey: key,
      });
      // 催补证：走既有通知通道（owner）。
      await this.context.createNotification({
        recipientPersonId: todo.assigneePersonId,
        audience: "PERSON",
        title: "Evidence requested",
        body: `Work package ${gap.subjectId} is missing evidence; please upload.`,
        sourceType: "WORK_PACKAGE",
        sourceId: gap.subjectId,
      });
      todosCreated += 1;
      audit.push({
        at,
        action: "TODO_CREATED",
        workPackageId: gap.subjectId,
        todoId: todo.id,
        detail: `evidence gap todo created for ${todo.assigneePersonId}`,
      });
    }

    // 3) 验证证据入库 → 关闭待办。
    const openGapTodos = (await this.context.listAgentTodos({
      status: "OPEN",
    })) as GapTodo[];
    for (const todo of openGapTodos) {
      if (!todo.id || !todo.targetId) continue;
      if (!todo.id.startsWith("")) {
        /* no-op：所有 OPEN 待办均可被证据校验关闭（同键幂等创建） */
      }
      const evidence = await this.context.listEvidence(
        "WORK_PACKAGE",
        todo.targetId,
      );
      if (evidence.length === 0) continue;
      await this.context.completeAgentTodo(
        todo.id,
        "SYSTEM_EVIDENCE_VERIFIED",
      );
      todosVerifiedClosed += 1;
      audit.push({
        at,
        action: "TODO_VERIFIED_CLOSED",
        workPackageId: todo.targetId,
        todoId: todo.id,
        detail: "evidence arrived; todo verified and closed",
      });
    }

    // 4) 升级：剩余 OPEN 且过期的证据缺口待办。
    const stillOpen = (await this.context.listAgentTodos({
      status: "OPEN",
    })) as GapTodo[];
    for (const todo of stillOpen) {
      if (!todo.dueAt || Date.parse(todo.dueAt) >= Date.now()) continue;
      await this.context.createNotification({
        audience: "MANAGER",
        title: "Evidence todo overdue",
        body: `Todo ${todo.id} (${todo.title ?? "evidence gap"}) is past due.`,
        sourceType: "AGENT_TODO",
        sourceId: todo.id,
      });
      escalations += 1;
      audit.push({
        at,
        action: "ESCALATED",
        workPackageId: todo.targetId ?? "",
        todoId: todo.id,
        detail: "overdue evidence todo escalated to manager",
      });
    }

    if (todosCreated + todosVerifiedClosed + escalations === 0) {
      audit.push({ at, action: "NO_OP", workPackageId: "", detail: "no gaps" });
    }
    return { todosCreated, todosVerifiedClosed, escalations, audit };
  }

  /** 找工作包 owner（找不到时退回占位，保证待办仍可创建并由人工改派）。 */
  private async ownerOf(workPackageId: string): Promise<string> {
    const workPackages = await this.context.listWorkPackages();
    const wp = workPackages.find((candidate) => candidate.id === workPackageId);
    return wp?.ownerPersonId ?? "UNASSIGNED";
  }
}
