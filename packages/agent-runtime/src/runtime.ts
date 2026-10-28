import { randomUUID } from "node:crypto";
import type {
  AgentAction,
  AgentActionResult,
  AgentAuditEntry,
  AgentContext,
  AgentFinding,
  AgentSkill,
  AgentTask,
  AgentTaskRepository,
  AgentTaskStatus,
  AgentTool,
  RiskTier,
  TriggerType,
} from "./types.js";

const RISK_ORDER: Record<RiskTier, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
};

function now(): string {
  return new Date().toISOString();
}

function rank(tier: RiskTier): number {
  return RISK_ORDER[tier];
}

export class AgentRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

export interface EnqueueAgentTaskInput {
  tenantId: string;
  agentType: string;
  triggerType: TriggerType;
  triggerRef?: string;
  input?: Record<string, unknown>;
  idempotencyKey: string;
  correlationId?: string;
  riskTier?: RiskTier;
}

export interface AgentRuntimeOptions {
  /** Actions at or above this tier require human approval. Defaults to T3. */
  requireApprovalAtOrAbove?: RiskTier;
  actor?: string;
  /** Optional durable adapter; omitted for tests and local in-memory use. */
  repository?: AgentTaskRepository;
}

/**
 * Proactive agent runtime.
 *
 * The runtime is deliberately separate from the policy engine:
 * - skills observe business state and produce findings;
 * - findings become typed actions with risk tiers;
 * - low-risk actions may execute automatically;
 * - high-impact actions wait for an authorized human;
 * - every step is audited and idempotent.
 *
 * No skill can write a formal amount, publish a policy or lock a settlement;
 * those actions are T3 and must be approved.
 */
export class AgentRuntime {
  private readonly tasks = new Map<string, AgentTask>();
  private readonly byIdempotency = new Map<string, string>();
  private readonly audit: AgentAuditEntry[] = [];
  private loaded = false;
  private loading?: Promise<void>;

  constructor(
    private readonly context: AgentContext,
    private readonly tools: AgentTool[],
    private readonly skills: Record<string, AgentSkill>,
    private readonly options: AgentRuntimeOptions = {},
  ) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded || !this.options.repository) {
      this.loaded = true;
      return;
    }
    if (!this.loading) {
      this.loading = this.options.repository.load().then(({ tasks, audit }) => {
        for (const task of tasks) {
          this.tasks.set(task.id, task);
          this.byIdempotency.set(
            `${task.tenantId}:${task.idempotencyKey}`,
            task.id,
          );
        }
        this.audit.push(...audit);
        this.loaded = true;
      });
    }
    await this.loading;
  }

  private async persist(task: AgentTask): Promise<void> {
    if (this.options.repository) {
      await this.options.repository.saveTask(task);
    }
  }

  private async recordAudit(entry: AgentAuditEntry): Promise<void> {
    this.audit.push(entry);
    if (this.options.repository) {
      await this.options.repository.appendAudit(entry);
    }
  }

  async enqueue(input: EnqueueAgentTaskInput): Promise<AgentTask> {
    await this.ensureLoaded();
    const key = `${input.tenantId}:${input.idempotencyKey}`;
    const existingId = this.byIdempotency.get(key);
    if (existingId) return this.get(existingId);

    const task: AgentTask = {
      id: randomUUID(),
      tenantId: input.tenantId,
      agentType: input.agentType,
      triggerType: input.triggerType,
      triggerRef: input.triggerRef,
      status: "QUEUED",
      riskTier: input.riskTier ?? "T1",
      input: input.input ?? {},
      findings: [],
      actions: [],
      results: [],
      attempts: 0,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId ?? randomUUID(),
      createdAt: now(),
      updatedAt: now(),
    };
    this.tasks.set(task.id, task);
    this.byIdempotency.set(key, task.id);
    await this.persist(task);
    await this.recordAudit({
      taskId: task.id,
      actor: this.options.actor ?? "system",
      at: now(),
      detail: `enqueued ${task.agentType}`,
    });
    return task;
  }

  async run(taskId: string): Promise<AgentTask> {
    const task = await this.get(taskId);
    if (task.status === "SUCCEEDED" || task.status === "WAITING_APPROVAL") {
      return task;
    }
    const skill = this.skills[task.agentType];
    if (!skill) {
      task.status = "FAILED";
      task.output = { error: `unknown agent type: ${task.agentType}` };
      task.updatedAt = now();
      await this.persist(task);
      return task;
    }

    task.status = "RUNNING";
    task.attempts += 1;
    task.updatedAt = now();
    try {
      const findings = await skill.observe(this.context, task.input);
      const actions = findings.flatMap((finding) =>
        skill.plan(finding, task.input),
      );
      task.findings = findings;
      task.actions = actions;
      task.riskTier = actions.reduce(
        (highest, action) =>
          rank(action.riskTier) > rank(highest) ? action.riskTier : highest,
        task.riskTier,
      );

      for (const action of actions) {
        const needsApproval =
          action.requiresApproval ||
          rank(action.riskTier) >=
            rank(this.options.requireApprovalAtOrAbove ?? "T3");
        if (needsApproval) {
          task.results.push({
            actionId: action.id,
            status: "PENDING_APPROVAL",
          });
          continue;
        }
        task.results.push(await this.execute(task, action));
      }

      task.status = task.results.some(
        (result) => result.status === "PENDING_APPROVAL",
      )
        ? "WAITING_APPROVAL"
        : task.results.some((result) => result.status === "FAILED")
          ? "FAILED"
          : "SUCCEEDED";
      task.output = {
        findings: findings.length,
        actions: actions.length,
        executed: task.results.filter((r) => r.status === "EXECUTED").length,
      };
    } catch (error) {
      task.status = "FAILED";
      task.output = { error: String(error) };
      await this.recordAudit({
        taskId: task.id,
        actor: this.options.actor ?? "system",
        at: now(),
        detail: `failed: ${String(error)}`,
      });
    }
    task.updatedAt = now();
    await this.persist(task);
    return task;
  }

  async approve(
    taskId: string,
    actionId: string,
    approverPersonId: string,
  ): Promise<AgentTask> {
    const task = await this.get(taskId);
    if (task.status !== "WAITING_APPROVAL") {
      throw new AgentRuntimeError(
        "AGENT_TASK_NOT_WAITING",
        `task ${taskId} is not waiting for approval`,
      );
    }
    const action = task.actions.find((candidate) => candidate.id === actionId);
    const result = task.results.find((candidate) => candidate.actionId === actionId);
    if (!action || !result || result.status !== "PENDING_APPROVAL") {
      throw new AgentRuntimeError(
        "AGENT_ACTION_NOT_PENDING",
        `action ${actionId} is not pending approval`,
      );
    }
    const executed = await this.execute(task, action, approverPersonId);
    Object.assign(result, executed);
    task.approvedBy = approverPersonId;
    task.approvedAt = now();
    await this.recordAudit({
      taskId: task.id,
      actionId,
      tool: action.tool,
      actor: approverPersonId,
      at: now(),
      detail: `approved and executed ${action.tool}`,
    });
    task.status = task.results.every(
      (candidate) =>
        candidate.status === "EXECUTED" || candidate.status === "REJECTED",
    )
      ? task.results.some((candidate) => candidate.status === "REJECTED")
        ? "BLOCKED"
        : "SUCCEEDED"
      : "WAITING_APPROVAL";
    task.updatedAt = now();
    await this.persist(task);
    return task;
  }

  async reject(
    taskId: string,
    actionId: string,
    approverPersonId: string,
    reason: string,
  ): Promise<AgentTask> {
    const task = await this.get(taskId);
    const result = task.results.find((candidate) => candidate.actionId === actionId);
    if (!result || result.status !== "PENDING_APPROVAL") {
      throw new AgentRuntimeError(
        "AGENT_ACTION_NOT_PENDING",
        `action ${actionId} is not pending approval`,
      );
    }
    result.status = "REJECTED";
    result.error = reason;
    task.status = "BLOCKED";
    task.approvedBy = approverPersonId;
    task.approvedAt = now();
    task.updatedAt = now();
    await this.recordAudit({
      taskId,
      actionId,
      actor: approverPersonId,
      at: now(),
      detail: `rejected: ${reason}`,
    });
    await this.persist(task);
    return task;
  }

  async get(taskId: string): Promise<AgentTask> {
    await this.ensureLoaded();
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new AgentRuntimeError(
        "AGENT_TASK_NOT_FOUND",
        `agent task ${taskId} not found`,
      );
    }
    return task;
  }

  async list(): Promise<AgentTask[]> {
    await this.ensureLoaded();
    return [...this.tasks.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async auditLog(): Promise<AgentAuditEntry[]> {
    await this.ensureLoaded();
    return [...this.audit];
  }

  private async execute(
    task: AgentTask,
    action: AgentAction,
    approvedBy?: string,
  ): Promise<AgentActionResult> {
    const tool = this.tools.find((candidate) => candidate.name === action.tool);
    if (!tool) {
      return {
        actionId: action.id,
        status: "FAILED",
        error: `unknown tool: ${action.tool}`,
      };
    }
    try {
      const output = await tool.execute(action.payload, this.context, {
        taskId: task.id,
        actor: approvedBy ?? task.approvedBy ?? this.options.actor ?? "system",
        approvedBy,
      });
      this.audit.push({
        taskId: task.id,
        actionId: action.id,
        tool: action.tool,
        actor: this.options.actor ?? "system",
        at: now(),
        detail: `executed ${action.tool}`,
      });
      return { actionId: action.id, status: "EXECUTED", output };
    } catch (error) {
      this.audit.push({
        taskId: task.id,
        actionId: action.id,
        tool: action.tool,
        actor: this.options.actor ?? "system",
        at: now(),
        detail: `tool failed: ${String(error)}`,
      });
      return {
        actionId: action.id,
        status: "FAILED",
        error: String(error),
      };
    }
  }
}
