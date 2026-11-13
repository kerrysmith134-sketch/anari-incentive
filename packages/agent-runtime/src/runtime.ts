import { randomUUID } from "node:crypto";
import { AgentTaskCasError } from "./types.js";
import { sha256 } from "@anari/policy-dsl";
import type {
  AgentAction,
  AgentStep,
  AgentStepKind,
  AgentStepStatus,
  ToolInvocationRecord,
  AgentActionResult,
  AgentAuditEntry,
  AgentContext,
  AgentFinding,
  AgentSkill,
  AgentTask,
  AgentTaskRepository,
  AgentStepRepository,
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
  actorRole?: "READER" | "ACTOR";
}

export interface AgentRuntimeOptions {
  /** Actions at or above this tier require human approval. Defaults to T3. */
  requireApprovalAtOrAbove?: RiskTier;
  actor?: string;
  /**
   * READER runtimes may observe/draft but cannot execute WRITE tools. ACTOR
   * runtimes may execute; BOTH keeps the legacy behaviour.
   */
  role?: "READER" | "ACTOR" | "BOTH";
  /** Optional durable adapter; omitted for tests and local in-memory use. */
  repository?: AgentTaskRepository;
  /** NPV2-019：步骤/工具调用持久化（可选；缺省存内存供检查）。 */
  stepRepository?: AgentStepRepository;
}

export interface RetryFailedOptions {
  maxAttempts?: number;
  /** Do not retry a task updated more recently than this. */
  minAgeMs?: number;
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
  /** NPV2-019：内存步骤/工具记录（无 stepRepository 时供检查）。 */
  private readonly steps = new Map<string, AgentStep>();
  private readonly toolInvocations = new Map<string, ToolInvocationRecord>();
  private stepCounter = 0;
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
      actorRole: input.actorRole,
      input: input.input ?? {},
      findings: [],
      actions: [],
      results: [],
      attempts: 0,
      version: 1,
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

  private hashOf(value: unknown): string {
    return sha256(value);
  }

  /** NPV2-019：开启一个步骤（持久化或内存）。 */
  private async beginStep(
    task: AgentTask,
    kind: AgentStepKind,
    input?: unknown,
  ): Promise<AgentStep> {
    const timestamp = now();
    const step: AgentStep = {
      id: randomUUID(),
      tenantId: task.tenantId,
      taskId: task.id,
      stepIndex: this.stepCounter++,
      kind,
      status: "RUNNING",
      inputHash: input === undefined ? undefined : this.hashOf(input),
      attempts: 1,
      executedBy: this.options.actor ?? "system",
      startedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (this.options.stepRepository) {
      await this.options.stepRepository.appendStep(step);
    } else {
      this.steps.set(step.id, step);
    }
    return step;
  }

  private async finishStep(
    step: AgentStep,
    status: AgentStepStatus,
    output?: unknown,
    error?: string,
  ): Promise<void> {
    const finishedAt = now();
    step.status = status;
    step.outputHash = output === undefined ? undefined : this.hashOf(output);
    step.error = error;
    step.finishedAt = finishedAt;
    step.durationMs =
      step.startedAt ? Date.parse(finishedAt) - Date.parse(step.startedAt) : 0;
    step.updatedAt = finishedAt;
    if (this.options.stepRepository) {
      await this.options.stepRepository.updateStep({
        stepId: step.id,
        status,
        outputHash: step.outputHash,
        error,
        executedBy: step.executedBy,
        durationMs: step.durationMs,
      });
    } else {
      this.steps.set(step.id, step);
    }
  }

  /** NPV2-019：记录一次工具调用（输入哈希先落，输出哈希后补）。 */
  private async beginToolInvocation(
    task: AgentTask,
    action: AgentAction,
  ): Promise<ToolInvocationRecord> {
    const record: ToolInvocationRecord = {
      id: randomUUID(),
      tenantId: task.tenantId,
      taskId: task.id,
      actionId: action.id,
      tool: action.tool,
      riskTier: action.riskTier,
      status: "PENDING",
      inputHash: this.hashOf({
        tool: action.tool,
        payload: action.payload,
        targetType: action.targetType,
        targetId: action.targetId,
      }),
      retries: 0,
      executedBy: this.options.actor ?? "system",
      createdAt: now(),
    };
    if (this.options.stepRepository) {
      await this.options.stepRepository.recordToolInvocation(record);
    } else {
      this.toolInvocations.set(record.id, record);
    }
    return record;
  }

  private async finishToolInvocation(
    record: ToolInvocationRecord,
    status: ToolInvocationRecord["status"],
    output?: unknown,
    error?: string,
  ): Promise<void> {
    record.status = status;
    record.outputHash = output === undefined ? undefined : this.hashOf(output);
    record.error = error;
    record.durationMs =
      Date.parse(now()) - Date.parse(record.createdAt);
    if (this.options.stepRepository) {
      await this.options.stepRepository.updateToolInvocation({
        invocationId: record.id,
        status,
        outputHash: record.outputHash,
        retries: record.retries,
        error,
        executedBy: record.executedBy,
        durationMs: record.durationMs,
      });
    } else {
      this.toolInvocations.set(record.id, record);
    }
  }

  /** NPV2-019：步骤/工具记录查询（重启后检查用）。 */
  async getSteps(taskId: string): Promise<AgentStep[]> {
    if (this.options.stepRepository) {
      return this.options.stepRepository.listSteps(taskId);
    }
    return [...this.steps.values()]
      .filter((step) => step.taskId === taskId)
      .sort((a, b) => a.stepIndex - b.stepIndex);
  }

  async getToolInvocations(taskId: string): Promise<ToolInvocationRecord[]> {
    if (this.options.stepRepository) {
      return this.options.stepRepository.listToolInvocations(taskId);
    }
    return [...this.toolInvocations.values()].filter(
      (record) => record.taskId === taskId,
    );
  }

  /** NPV2-019：重启恢复——把该任务残留的 RUNNING 步骤复位为 PENDING。 */
  async resumeInterruptedSteps(taskId: string): Promise<number> {
    if (this.options.stepRepository) {
      return this.options.stepRepository.resetInterruptedSteps(taskId);
    }
    let reset = 0;
    for (const step of this.steps.values()) {
      if (step.taskId !== taskId || step.status !== "RUNNING") continue;
      step.status = "PENDING";
      step.updatedAt = now();
      this.steps.set(step.id, step);
      reset += 1;
    }
    return reset;
  }

  async run(taskId: string): Promise<AgentTask> {
    const task = await this.get(taskId);
    if (task.status === "SUCCEEDED" || task.status === "WAITING_APPROVAL") {
      return task;
    }
    // NPV2-018：只有 READY 状态可执行；RUNNING 由租约持有者独占。
    if (task.status !== "QUEUED" && task.status !== "RETRY_PENDING") {
      throw new AgentRuntimeError(
        "AGENT_TASK_NOT_CLAIMABLE",
        `task ${taskId} is ${task.status} and cannot be started`,
      );
    }
    task.status = "RUNNING";
    task.attempts += 1;
    task.updatedAt = now();

    const skill = this.skills[task.agentType];
    if (!skill) {
      task.status = "FAILED";
      task.output = { error: `unknown agent type: ${task.agentType}` };
      task.updatedAt = now();
      await this.persist(task);
      return task;
    }
    try {
      const observeStep = await this.beginStep(task, "OBSERVE", task.input);
      const findings = await skill.observe(this.context, task.input);
      await this.finishStep(observeStep, "SUCCEEDED", findings);

      const planStep = await this.beginStep(task, "PLAN", findings);
      const actions = findings.flatMap((finding) =>
        skill.plan(finding, task.input),
      );
      await this.finishStep(planStep, "SUCCEEDED", actions);
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

  // ------------------------------------------------------------------
  // NPV2-018：任务执行权协议（DB claim / lease / CAS）。
  // 有 repository 时走 SQL（FOR UPDATE SKIP LOCKED + 版本检查）；
  // 无 repository（进程内单 worker）时在 Map 上实现同语义 CAS。
  // ------------------------------------------------------------------

  async claimNextReadyTask(
    input: { workerId: string; leaseMs: number },
  ): Promise<AgentTask | undefined> {
    if (this.options.repository) {
      return this.options.repository.claimNextReadyTask(input);
    }
    await this.ensureLoaded();
    const nowMs = Date.now();
    const candidate = [...this.tasks.values()]
      .filter(
        (task) =>
          (task.status === "QUEUED" || task.status === "RETRY_PENDING") &&
          (!task.leaseUntil || new Date(task.leaseUntil).getTime() < nowMs),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
    if (!candidate) return undefined;
    candidate.leaseOwner = input.workerId;
    candidate.leaseUntil = new Date(nowMs + input.leaseMs).toISOString();
    candidate.version += 1;
    candidate.updatedAt = now();
    await this.persist(candidate);
    return candidate;
  }

  async renewTaskLease(input: {
    taskId: string;
    workerId: string;
    leaseMs: number;
  }): Promise<boolean> {
    if (this.options.repository) {
      return this.options.repository.renewTaskLease(input);
    }
    await this.ensureLoaded();
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseOwner !== input.workerId) return false;
    task.leaseUntil = new Date(Date.now() + input.leaseMs).toISOString();
    task.version += 1;
    task.updatedAt = now();
    await this.persist(task);
    return true;
  }

  async releaseTaskLease(input: {
    taskId: string;
    workerId: string;
  }): Promise<boolean> {
    if (this.options.repository) {
      return this.options.repository.releaseTaskLease(input);
    }
    await this.ensureLoaded();
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseOwner !== input.workerId) return false;
    task.leaseOwner = undefined;
    task.leaseUntil = undefined;
    task.version += 1;
    task.updatedAt = now();
    await this.persist(task);
    return true;
  }

  async recoverExpiredLeases(): Promise<number> {
    if (this.options.repository) {
      return this.options.repository.recoverExpiredLeases();
    }
    await this.ensureLoaded();
    const nowMs = Date.now();
    let recovered = 0;
    for (const task of this.tasks.values()) {
      if (!task.leaseUntil) continue;
      if (new Date(task.leaseUntil).getTime() >= nowMs) continue;
      // 过期租约：清租约；RUNNING 任务复位为 QUEUED（可被重新领取）。
      if (task.status === "RUNNING") task.status = "QUEUED";
      task.leaseOwner = undefined;
      task.leaseUntil = undefined;
      task.version += 1;
      task.updatedAt = now();
      await this.persist(task);
      recovered += 1;
    }
    return recovered;
  }

  /**
   * Worker 编排：领取一个就绪任务（租约）→ 执行 → 交还租约。
   * 两个 worker 竞争同一任务时，输家 claim 返回 undefined。
   */
  async runClaimed(
    workerId: string,
    leaseMs = 300_000,
  ): Promise<AgentTask | undefined> {
    const claimed = await this.claimNextReadyTask({ workerId, leaseMs });
    if (!claimed) return undefined;
    // DB claim 已把 version+1：同步进本地副本，否则 run 的 persist 会 CAS 失败。
    const local = this.tasks.get(claimed.id);
    if (local) {
      local.version = claimed.version;
      local.leaseOwner = claimed.leaseOwner;
      local.leaseUntil = claimed.leaseUntil;
    }
    try {
      return await this.run(claimed.id);
    } finally {
      await this.releaseTaskLease({ taskId: claimed.id, workerId });
    }
  }

  /**
   * Retries failed tasks that did not execute any action. A task with an
   * EXECUTED action is never retried automatically: a partial side effect
   * needs a human decision. After `maxAttempts`, the task is marked as
   * dead-lettered and left FAILED for the admin queue.
   */
  async retryFailed(options: RetryFailedOptions = {}): Promise<AgentTask[]> {
    await this.ensureLoaded();
    const maxAttempts = options.maxAttempts ?? 3;
    const threshold = Date.now() - (options.minAgeMs ?? 60_000);
    const retried: AgentTask[] = [];

    for (const task of [...this.tasks.values()]) {
      if (task.status !== "FAILED") continue;
      if (task.results.some((result) => result.status === "EXECUTED")) continue;
      if (task.attempts >= maxAttempts) {
        if (!task.output?.deadLettered) {
          task.output = { ...(task.output ?? {}), deadLettered: true };
          task.updatedAt = now();
          await this.persist(task);
        }
        continue;
      }
      if (new Date(task.updatedAt).getTime() > threshold) continue;
      // NPV2-018：FAILED → RETRY_PENDING（READY 态）才能被重新领取执行。
      task.status = "RETRY_PENDING";
      task.updatedAt = now();
      await this.persist(task);
      retried.push(await this.run(task.id));
    }
    return retried;
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
    const readerRole =
      task.actorRole === "READER" ||
      (!task.actorRole && this.options.role === "READER");
    if (readerRole && tool.access === "WRITE") {
      this.audit.push({
        taskId: task.id,
        actionId: action.id,
        tool: action.tool,
        actor: this.options.actor ?? "system",
        at: now(),
        detail: `blocked write tool in READER role: ${action.tool}`,
      });
      const rejected = await this.beginToolInvocation(task, action);
      await this.finishToolInvocation(
        rejected,
        "REJECTED",
        undefined,
        "READER_ROLE_CANNOT_WRITE",
      );
      return {
        actionId: action.id,
        status: "REJECTED",
        error: "READER_ROLE_CANNOT_WRITE",
      };
    }
    const invocation = await this.beginToolInvocation(task, action);
    try {
      const output = await tool.execute(
        {
          ...action.payload,
          targetType: action.targetType,
          targetId: action.targetId,
        },
        this.context,
        {
          taskId: task.id,
          actor:
            approvedBy ?? task.approvedBy ?? this.options.actor ?? "system",
          approvedBy,
        },
      );
      await this.finishToolInvocation(invocation, "EXECUTED", output);
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
      await this.finishToolInvocation(invocation, "FAILED", undefined, String(error));
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
