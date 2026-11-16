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
  /** NP-011：证据待办截止期（天）——逾期扫描只对有 dueAt 的待办生效。 */
  private readonly evidenceDueDays: number;

  constructor(
    private readonly context: AgentContext,
    options: { evidenceDueDays?: number } = {},
  ) {
    this.evidenceDueDays = options.evidenceDueDays ?? 7;
  }
  /** 本实例已升级的无主缺口（跨轮去重；跨实例由通知幂等键兜底）。 */
  private readonly escalatedOwnerless = new Set<string>();

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
      const owner = await this.ownerOf(gap.subjectId);
      if (!owner) {
        if (this.escalatedOwnerless.has(gap.subjectId)) continue;
        // AUD-011：无 owner 不做非法 UUID 写入——升级经理通道。
        await this.context.createNotification({
          audience: "MANAGER",
          title: "Evidence gap without owner",
          body: `Work package ${gap.subjectId} has no evidence and no resolvable owner; manual assignment required.`,
          sourceType: "WORK_PACKAGE",
          sourceId: gap.subjectId,
          // AUD-010/AUD-011：稳定幂等键——同一缺口只升级一次。
          idempotencyKey: `evidence-gap-no-owner:${gap.subjectId}`,
        });
        this.escalatedOwnerless.add(gap.subjectId);
        escalations += 1;
        audit.push({
          at,
          action: "ESCALATED",
          workPackageId: gap.subjectId,
          detail: "evidence gap without resolvable owner escalated to manager",
        });
        continue;
      }
      const todo = await this.context.upsertAgentTodo({
        title: `补交工作包证据 ${gap.subjectId}`,
        detail: gap.message,
        assigneePersonId: owner,
        dueAt: new Date(
          Date.now() + this.evidenceDueDays * 24 * 60 * 60 * 1000,
        ).toISOString(),
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
        // 同一缺口的催补证只发一次（键含责任人，改派后可再提醒）。
        idempotencyKey: `evidence-requested:${gap.subjectId}:${todo.assigneePersonId}`,
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
    // AUD-010：只处理本 workflow 创建的 evidence-gap 待办（idempotencyKey
    // 前缀 evidence-gap:），不误关其他来源的无关任务。
    const openGapTodos = ((await this.context.listAgentTodos({
      status: "OPEN",
    })) as Array<GapTodo & { idempotencyKey?: string }>).filter(
      (todo) =>
        // NP-009：未知 key（undefined/其他来源）不得视为本 workflow 的待办。
        (todo as { idempotencyKey?: string }).idempotencyKey?.startsWith(
          "evidence-gap:",
        ) === true,
    );
    for (const todo of openGapTodos) {
      if (!todo.id || !todo.targetId) continue;
      const evidence = await this.context.listEvidence(
        "WORK_PACKAGE",
        todo.targetId,
      );
      if (evidence.length === 0) continue;
      // 系统完成：completed_by 留空（PG uuid 列不能写非 UUID 字符串）。
      await this.context.completeAgentTodo(todo.id);
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
        // 同一待办只在首个逾期窗口通知一次（跨扫描/跨重启稳定）。
        idempotencyKey: `evidence-overdue:${todo.id}`,
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

  /**
   * AUD-011：找工作包 owner；缺失时返回 undefined——调用方跳过待办创建
   * 并走经理升级通道（不做非法 UUID 写入）。
   */
  private async ownerOf(workPackageId: string): Promise<string | undefined> {
    const workPackages = await this.context.listWorkPackages();
    const wp = workPackages.find((candidate) => candidate.id === workPackageId);
    return wp?.ownerPersonId;
  }
}
