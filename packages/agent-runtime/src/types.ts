import type {
  AppealCase,
  AttributionDecision,
  CalculationRun,
  ContributionClaim,
  DataQualityIssue,
  EmployeeConfirmation,
  EvaluationDraft,
  EvidenceNode,
  InAppNotification,
  LegalGateRecord,
  PublishPolicyInput,
  PublishedPolicy,
  WorkPackage,
} from "@anari/domain";

export type AgentTaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "RETRY_PENDING"
  | "BLOCKED"
  | "FAILED"
  | "ESCALATED"
  | "SUCCEEDED"
  | "CANCELLED";

export type RiskTier = "T0" | "T1" | "T2" | "T3";
export type TriggerType = "EVENT" | "SCHEDULE" | "MANUAL" | "THRESHOLD";

export interface AgentFinding {
  code: string;
  severity: "INFO" | "WARNING" | "BLOCKING";
  subjectType: string;
  subjectId: string;
  message: string;
  evidenceRefs?: string[];
  suggestedAction?: string;
  /** Structured observation data passed to `plan`. */
  data?: Record<string, unknown>;
}

export interface AgentAction {
  id: string;
  tool: string;
  riskTier: RiskTier;
  targetType: string;
  targetId: string;
  description: string;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface AgentActionResult {
  actionId: string;
  status: "EXECUTED" | "PENDING_APPROVAL" | "REJECTED" | "FAILED";
  output?: unknown;
  error?: string;
}

export interface AgentTask {
  id: string;
  tenantId: string;
  agentType: string;
  triggerType: TriggerType;
  triggerRef?: string;
  status: AgentTaskStatus;
  riskTier: RiskTier;
  actorRole?: "READER" | "ACTOR";
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  findings: AgentFinding[];
  actions: AgentAction[];
  results: AgentActionResult[];
  attempts: number;
  /** NPV2-018：乐观锁版本——每次持久化 +1，CAS 竞争失败的写会被拒绝。 */
  version: number;
  /** NPV2-018：租约持有者与到期时间（DB claim 语义）。 */
  leaseOwner?: string;
  leaseUntil?: string;
  idempotencyKey: string;
  correlationId: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentContext {
  listWorkPackages(): Promise<WorkPackage[]>;
  listEvaluationCycles(): Promise<
    Array<{ id: string; name: string; status: string; startsAt: string; endsAt: string }>
  >;
  advanceEvaluationCycle(
    id: string,
    status: string,
    reason?: string,
  ): Promise<unknown>;
  listClaims(): Promise<ContributionClaim[]>;
  listDecisions(claimId?: string): Promise<AttributionDecision[]>;
  listRuns(): Promise<CalculationRun[]>;
  listConfirmations(personId?: string): Promise<EmployeeConfirmation[]>;
  listAppeals(): Promise<AppealCase[]>;
  getLegalGate(policyVersionId: string): Promise<LegalGateRecord | undefined>;
  listEvidence(
    subjectType?: string,
    subjectId?: string,
  ): Promise<EvidenceNode[]>;
  /** Publishes an approved policy version; T3 and never called without a human. */
  publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy>;
  createDataQualityIssue(input: {
    objectType: string;
    objectId: string;
    issueCode: string;
    severity: "INFO" | "WARNING" | "BLOCKING";
    details?: Record<string, unknown>;
  }): Promise<DataQualityIssue>;
  createNotification(input: {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
    /** AUD-011：稳定幂等键——重复扫描不重复通知。 */
    idempotencyKey?: string;
  }): Promise<InAppNotification>;
  /** NPV2-020：持久化待办（幂等：同 (tenant, idempotencyKey) 不重复创建）。 */
  upsertAgentTodo(input: {
    title: string;
    detail?: string;
    assigneePersonId: string;
    dueAt?: string;
    targetType?: string;
    targetId?: string;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    createdByAgentTaskId?: string;
  }): Promise<{
    id: string;
    title: string;
    assigneePersonId: string;
    status: string;
    dueAt?: string;
    idempotencyKey: string;
    sourceType: string;
    sourceId: string;
  }>;
  completeAgentTodo(
    id: string,
    completedByPersonId: string,
  ): Promise<{
    id: string;
    status: string;
    completedByPersonId?: string;
    completedAt?: string;
  }>;
  listDataQualityIssues(filter?: {
    cycleId?: string;
    status?: string;
  }): Promise<
    Array<{
      id: string;
      severity: string;
      status: string;
      objectType?: string;
      objectId?: string;
    }>
  >;
  listEvaluationDecisions(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<
    Array<{ id: string; status: string; personId: string; rubricVersionId: string }>
  >;
  listPolicyVersions(): Promise<
    Array<{ policyVersionId: string; code: string; version: number; status: string }>
  >;
  getPolicy(
    policyVersionId: string,
  ): Promise<{ code: string; version: number }>;
  listEvaluationDrafts(filter?: { cycleId?: string; status?: string }): Promise<
    Array<{ id: string; status: string; cycleId?: string }>
  >;
  listAgentTodos(filter?: {
    assigneePersonId?: string;
    status?: "OPEN" | "DONE" | "CANCELLED";
  }): Promise<
    Array<{
      id: string;
      title: string;
      assigneePersonId: string;
      status: string;
      dueAt?: string;
      targetId?: string;
      sourceId: string;
      idempotencyKey?: string;
    }>
  >;
  createEvaluationDraft(input: {
    cycleId: string;
    personId: string;
    generatedByType: "AGENT" | "USER" | "SYSTEM";
    generatedById?: string;
    modelProvider?: string;
    modelName?: string;
    promptVersion?: string;
    agentTaskId?: string;
    evidenceSnapshotHash: string;
    draftPayload: Record<string, unknown>;
    strengths?: string[];
    counterEvidence?: string[];
    missingInformation?: string[];
    uncertainty?: Record<string, unknown>;
  }): Promise<EvaluationDraft>;
}

export interface AgentToolExecutionContext {
  taskId: string;
  actor: string;
  /** Present only when a human approved this specific action. */
  approvedBy?: string;
}

/**
 * NPV2-021：工具契约——scope/副作用/超时/重试/后置条件校验。
 * 红线：工具执行成功但 verifier 不成立时，该次动作记 FAILED
 * （POSTCONDITION_FAILED），任务不得标 SUCCEEDED。
 */
export interface AgentToolContract {
  /** 工具作用域（数据面标识），用于权限与审计归集。 */
  scope?: string;
  /** 是否产生业务副作用（WRITE 工具恒视为 true）。 */
  sideEffect?: boolean;
  /** 单次执行超时毫秒；超时按失败处理（TOOL_TIMEOUT）。 */
  timeoutMs?: number;
  /** 失败自动重试次数（默认 0；仅超时与执行异常）。 */
  retries?: number;
  /**
   * 后置条件校验：工具成功返回后调用。返回 false 或抛错 → 动作记
   * FAILED（POSTCONDITION_FAILED），且不产生副作用确认。
   */
  verifier?: (
    input: Record<string, unknown>,
    output: unknown,
    context: AgentContext,
  ) => Promise<boolean>;
}

export interface AgentTool {
  name: string;
  riskTier: RiskTier;
  access: "READ" | "WRITE";
  description: string;
  contract?: AgentToolContract;
  execute(
    input: Record<string, unknown>,
    context: AgentContext,
    execution?: AgentToolExecutionContext,
  ): Promise<unknown>;
}

export interface AgentSkill {
  name: string;
  observe(
    context: AgentContext,
    input: Record<string, unknown>,
  ): Promise<AgentFinding[]>;
  plan(finding: AgentFinding, input?: Record<string, unknown>): AgentAction[];
}

export interface AgentAuditEntry {
  taskId: string;
  actionId?: string;
  tool?: string;
  actor: string;
  at: string;
  detail: string;
}

/**
 * Durable task/audit adapter. The runtime stays synchronous internally but
 * loads once on first use and persists each task snapshot after a mutation.
 */
export interface AgentTaskClaimInput {
  workerId: string;
  /** 租约时长（毫秒）；到期后其他 worker 可恢复该任务。 */
  leaseMs: number;
}

/**
 * NPV2-018：任务执行权协议——DB claim / lease / CAS。
 * - claimNextReadyTask：原子领取（FOR UPDATE SKIP LOCKED），两个 worker
 *   竞争同一任务时恰有一个成功；
 * - renewTaskLease / releaseTaskLease：持有者续期或交还；
 * - recoverExpiredLeases：过期租约复位（RUNNING → QUEUED）可恢复。
 */
export interface AgentTaskRepository {
  load(): Promise<{ tasks: AgentTask[]; audit: AgentAuditEntry[] }>;
  /** 乐观锁写：task.version 必须与库中一致，冲突抛 AgentTaskCasError。 */
  saveTask(task: AgentTask): Promise<void>;
  appendAudit(entry: AgentAuditEntry): Promise<void>;
  claimNextReadyTask(input: AgentTaskClaimInput): Promise<AgentTask | undefined>;
  renewTaskLease(input: {
    taskId: string;
    workerId: string;
    leaseMs: number;
  }): Promise<boolean>;
  releaseTaskLease(input: { taskId: string; workerId: string }): Promise<boolean>;
  recoverExpiredLeases(): Promise<number>;
}

/**
 * NPV2-019：任务步骤持久化——每个步骤有独立状态、输入/输出哈希、重试计数、
 * 执行身份与耗时。重启后可从未完成步骤恢复（resetInterruptedSteps 把
 * RUNNING 复位为 PENDING），task 与 audit 状态一致。
 */
export type AgentStepKind = "OBSERVE" | "PLAN" | "EXECUTE" | "VERIFY";
export type AgentStepStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "SKIPPED";

export interface AgentStep {
  id: string;
  tenantId: string;
  taskId: string;
  stepIndex: number;
  kind: AgentStepKind;
  status: AgentStepStatus;
  inputHash?: string;
  outputHash?: string;
  error?: string;
  attempts: number;
  executedBy?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

/** NPV2-019：工具调用记录——与 AgentStep 分离，一次动作一条。 */
export interface ToolInvocationRecord {
  id: string;
  tenantId: string;
  taskId: string;
  actionId: string;
  tool: string;
  riskTier: RiskTier;
  status: "PENDING" | "EXECUTED" | "FAILED" | "REJECTED";
  inputHash: string;
  outputHash?: string;
  retries: number;
  executedBy?: string;
  durationMs?: number;
  error?: string;
  createdAt: string;
}

/** NPV2-019：步骤/工具记录持久化协议（与 AgentTaskRepository 同实现）。 */
export interface AgentStepRepository {
  appendStep(step: AgentStep): Promise<void>;
  updateStep(input: {
    stepId: string;
    status?: AgentStepStatus;
    outputHash?: string;
    error?: string;
    executedBy?: string;
    durationMs?: number;
  }): Promise<void>;
  recordToolInvocation(record: ToolInvocationRecord): Promise<void>;
  updateToolInvocation(input: {
    invocationId: string;
    status?: ToolInvocationRecord["status"];
    outputHash?: string;
    retries?: number;
    error?: string;
    executedBy?: string;
    durationMs?: number;
  }): Promise<void>;
  listSteps(taskId: string): Promise<AgentStep[]>;
  listToolInvocations(taskId: string): Promise<ToolInvocationRecord[]>;
  /** 重启恢复：把该任务残留的 RUNNING 步骤复位为 PENDING。 */
  resetInterruptedSteps(taskId: string): Promise<number>;
}

/** NPV2-018：CAS 版本冲突——任务已被其他持有者修改。 */
export class AgentTaskCasError extends Error {
  constructor(
    readonly taskId: string,
    message = "agent task version conflict (CAS failed)",
  ) {
    super(`${message}: ${taskId}`);
    this.name = "AgentTaskCasError";
  }
}

export type {
  ContributionClaim,
} from "@anari/domain";
