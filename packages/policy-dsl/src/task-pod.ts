import type {
  AiMember,
  PersonalTaskInventory,
  TaskPod,
} from "@anari/domain";

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 任务制附件：任务组围绕具体任务组建，人人可发起、可被邀请；
 * 发起人对结果负责且必须是任务组成员；AI 成员必须已登记并带版本。
 */
export function validateTaskPod(
  pod: TaskPod,
  aiMembers: AiMember[] = [],
): PolicyValidationResult {
  const errors: string[] = [];
  if (!pod.title.trim()) errors.push("任务组必须载明任务名称");
  if (!pod.objective.trim()) errors.push("任务组必须载明目标成果");
  if (pod.members.length === 0) errors.push("任务组至少需要一名成员");
  const initiator = pod.members.find(
    (member) => member.kind === "PERSON" && member.memberId === pod.initiatorPersonId,
  );
  if (!initiator) errors.push("发起人必须是任务组成员");
  if (!pod.members.some((member) => member.kind === "PERSON")) {
    errors.push("任务组至少包含一名人员成员");
  }
  const registry = new Map(aiMembers.map((member) => [member.id, member]));
  for (const member of pod.members) {
    if (member.kind !== "AI") continue;
    const registered = registry.get(member.memberId);
    if (!registered) {
      errors.push(`AI 成员 ${member.memberId} 未登记`);
      continue;
    }
    if (!registered.active) {
      errors.push(`AI 成员 ${registered.name} 已停用`);
    }
    if (member.aiVersion && member.aiVersion !== registered.aiVersion) {
      errors.push(
        `AI 成员 ${registered.name} 版本快照 ${member.aiVersion} 与登记版本 ${registered.aiVersion} 不一致`,
      );
    }
  }
  if (pod.status === "COMPLETED" && !pod.completedAt) {
    errors.push("已完成任务组必须记录完成时间");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * 任务制附件 2026 Q4：每位伙伴完成《个人任务清单》，逐项标注
 * 人独立完成 / AI 完成 / 人机协同，并选出一项最高频、最耗时任务完成 AI 化改造。
 */
export function validatePersonalTaskInventory(
  inventory: PersonalTaskInventory,
): PolicyValidationResult {
  const errors: string[] = [];
  if (!inventory.period.trim()) errors.push("任务清单必须载明周期");
  if (inventory.tasks.length === 0) errors.push("任务清单至少包含一项任务");
  const seen = new Set<string>();
  for (const task of inventory.tasks) {
    if (!task.taskId.trim()) errors.push("任务缺少 task_id");
    if (seen.has(task.taskId)) errors.push(`任务 ${task.taskId} 重复`);
    seen.add(task.taskId);
    if (!task.name.trim()) errors.push(`任务 ${task.taskId} 缺少名称`);
    if (!task.deliverable.trim())
      errors.push(`任务 ${task.taskId} 缺少可交付成果`);
    if (!task.measure.trim())
      errors.push(`任务 ${task.taskId} 缺少可衡量口径`);
    if (task.mode !== "HUMAN" && !task.aiWorkflow?.trim()) {
      errors.push(`任务 ${task.taskId} 为 AI/人机协同，必须说明 AI 工作流`);
    }
  }
  if (
    inventory.tasks.length > 0 &&
    !inventory.tasks.some((task) => task.aiTransformationCandidate)
  ) {
    errors.push("必须选出一项最高频、最耗时任务作为本季度 AI 化改造对象");
  }
  if (inventory.status === "ACCEPTED" && !inventory.reviewerPersonId) {
    errors.push("已验收任务清单必须记录评审人");
  }
  return { valid: errors.length === 0, errors };
}
