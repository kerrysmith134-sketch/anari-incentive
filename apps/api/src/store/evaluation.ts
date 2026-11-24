import { randomUUID } from "node:crypto";
import {
  assertTransition,
  evaluationCycleTransitions,
  dataQualityIssueTransitions,
  evaluationDraftTransitions,
  type DataQualityIssue,
  type EvaluationCycle,
  type EvaluationDecision,
  type EvaluationDraft,
  type InAppNotification,
  type Rubric,
  type MetricMeasurementSnapshot,
  type MetricMeasurementSnapshotFilter,
  type CreateMetricMeasurementSnapshotInput,
  type AgentTodo,
  type AgentTodoFilter,
  type UpsertAgentTodoInput,
  type AgentFeedbackLabel,
  type AgentFeedbackLabelKind,
  type AgentModelUsage,
  type AgentAiOffBaseline,
} from "@anari/domain";
import {
  sha256,
} from "@anari/policy-dsl";
import {
  NotFoundError,
  ConflictError,
  now,
  notFound,
} from "../store-support.js";
import type { IncentiveStore } from "../store-interface.js";
import type { AuditApi } from "./audit.js";
import { StoreBase, type StoreCtor } from "./base.js";

export type EvaluationApi = Pick<
  IncentiveStore,
  | "upsertAgentTodo"
  | "listAgentTodos"
  | "recordAgentFeedbackLabel"
  | "listAgentFeedbackLabels"
  | "upsertAgentModelUsage"
  | "listAgentModelUsage"
  | "recordAgentAiOffBaseline"
  | "latestAgentAiOffBaseline"
  | "getAgentTodo"
  | "completeAgentTodo"
  | "cancelAgentTodo"
  | "createMetricMeasurementSnapshot"
  | "listMetricMeasurementSnapshots"
  | "getMetricMeasurementSnapshot"
  | "verifyMetricMeasurementSnapshot"
  | "linkMetricMeasurementSnapshotToDecision"
  | "createNotification"
  | "listNotifications"
  | "markNotificationRead"
  | "createDataQualityIssue"
  | "getDataQualityIssue"
  | "listDataQualityIssues"
  | "commandDataQualityIssue"
  | "createEvaluationCycle"
  | "getEvaluationCycle"
  | "listEvaluationCycles"
  | "createRubric"
  | "listRubrics"
  | "advanceEvaluationCycle"
  | "createEvaluationDraft"
  | "getEvaluationDraft"
  | "listEvaluationDrafts"
  | "submitEvaluationDraft"
  | "decideEvaluationDraft"
  | "listEvaluationDecisions"
  | "getEvaluationDecision"
>;

/**
 * Mixes the evaluation domain into the store chain. Methods keep the exact
 * behaviour of the former monolithic Store implementation.
 */
export function withEvaluation<TBase extends StoreCtor<StoreBase & AuditApi>>(Base: TBase) {
  const Mixin = class EvaluationMixin extends Base implements EvaluationApi {

  /** NPV2-020：Agent 待办 upsert（幂等：同 (tenant, idempotencyKey) 返回既有）。 */
  async upsertAgentTodo(input: UpsertAgentTodoInput): Promise<AgentTodo> {
    const existing = [...this.agentTodos.values()].find(
      (todo) => todo.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return existing;
    const timestamp = now();
    const todo: AgentTodo = {
      id: randomUUID(),
      tenantId: this.tenantId,
      ...input,
      status: "OPEN",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.agentTodos.set(todo.id, todo);
    return todo;
  }

  async listAgentTodos(filter?: AgentTodoFilter): Promise<AgentTodo[]> {
    let todos = [...this.agentTodos.values()];
    if (filter?.assigneePersonId) {
      todos = todos.filter(
        (todo) => todo.assigneePersonId === filter.assigneePersonId,
      );
    }
    if (filter?.status) {
      todos = todos.filter((todo) => todo.status === filter.status);
    }
    if (filter?.sourceType) {
      todos = todos.filter((todo) => todo.sourceType === filter.sourceType);
    }
    return todos.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  // ------------------------------------------------------------------
  // AUD-023：Agent 可观测性持久化事实（标注/模型用量/AI-off 基线）。
  // ------------------------------------------------------------------
  async recordAgentFeedbackLabel(input: {
    taskId?: string;
    findingRef?: string;
    label: AgentFeedbackLabelKind;
    labeledBy: string;
    model?: string;
    promptVersion?: string;
    comment?: string;
  }): Promise<AgentFeedbackLabel> {
    // 同 (task, labeledBy, label) 幂等——重复标注返回既有记录。
    const existing = [...this.agentFeedbackLabels.values()].find(
      (entry) =>
        (entry.taskId ?? undefined) === (input.taskId ?? undefined) &&
        entry.labeledBy === input.labeledBy &&
        entry.label === input.label,
    );
    if (existing) return existing;
    const label: AgentFeedbackLabel = {
      id: randomUUID(),
      tenantId: this.tenantId,
      taskId: input.taskId,
      findingRef: input.findingRef,
      label: input.label,
      labeledBy: input.labeledBy,
      model: input.model,
      promptVersion: input.promptVersion,
      comment: input.comment,
      createdAt: now(),
    };
    this.agentFeedbackLabels.set(label.id, label);
    return label;
  }

  async listAgentFeedbackLabels(): Promise<AgentFeedbackLabel[]> {
    return [...this.agentFeedbackLabels.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async upsertAgentModelUsage(input: {
    provider: string;
    model: string;
    requests: number;
    promptTokens: number;
    completionTokens: number;
  }): Promise<AgentModelUsage> {
    const key = `${input.provider}|${input.model}`;
    const existing = this.agentModelUsage.get(key);
    if (existing) {
      existing.requests += input.requests;
      existing.promptTokens += input.promptTokens;
      existing.completionTokens += input.completionTokens;
      existing.updatedAt = now();
      return existing;
    }
    const usage: AgentModelUsage = {
      tenantId: this.tenantId,
      provider: input.provider,
      model: input.model,
      requests: input.requests,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      updatedAt: now(),
    };
    this.agentModelUsage.set(key, usage);
    return usage;
  }

  async listAgentModelUsage(): Promise<AgentModelUsage[]> {
    return [...this.agentModelUsage.values()];
  }

  async recordAgentAiOffBaseline(input: {
    windowStart: string;
    windowEnd: string;
    completionRate: string;
    sampleSize: number;
    recordedBy: string;
  }): Promise<AgentAiOffBaseline> {
    const baseline: AgentAiOffBaseline = {
      id: randomUUID(),
      tenantId: this.tenantId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      completionRate: input.completionRate,
      sampleSize: input.sampleSize,
      recordedBy: input.recordedBy,
      createdAt: now(),
    };
    this.agentAiOffBaselines.push(baseline);
    return baseline;
  }

  async latestAgentAiOffBaseline(): Promise<AgentAiOffBaseline | undefined> {
    return [...this.agentAiOffBaselines]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .at(0);
  }

  async getAgentTodo(id: string): Promise<AgentTodo> {
    const todo = this.agentTodos.get(id);
    if (!todo) throw new NotFoundError(`AgentTodo ${id} not found`);
    return todo;
  }

  async completeAgentTodo(
    id: string,
    completedByPersonId?: string,
  ): Promise<AgentTodo> {
    const todo = await this.getAgentTodo(id);
    if (todo.status !== "OPEN") {
      throw new ConflictError(`AGENT_TODO_NOT_OPEN: todo is ${todo.status}`);
    }
    todo.status = "DONE";
    todo.completedByPersonId = completedByPersonId;
    todo.completedAt = now();
    todo.updatedAt = now();
    return todo;
  }

  async cancelAgentTodo(id: string, reason?: string): Promise<AgentTodo> {
    const todo = await this.getAgentTodo(id);
    if (todo.status !== "OPEN") {
      throw new ConflictError(`AGENT_TODO_NOT_OPEN: todo is ${todo.status}`);
    }
    todo.status = "CANCELLED";
    todo.cancelReason = reason;
    todo.updatedAt = now();
    return todo;
  }

  /** 服务端计算冻结哈希：按 metricId+observedAt 排序后 sha256。 */
  private computeSnapshotHash(
    measurements: MetricMeasurementSnapshot["measurements"],
  ): string {
    const ordered = [...measurements].sort((a, b) =>
      `${a.metricId}|${a.observedAt}` < `${b.metricId}|${b.observedAt}` ? -1 : 1,
    );
    return sha256(ordered);
  }

  async createMetricMeasurementSnapshot(
    input: CreateMetricMeasurementSnapshotInput,
  ): Promise<MetricMeasurementSnapshot> {
    const cycle = await this.getEvaluationCycle(input.cycleId);
    if (!cycle) {
      throw new NotFoundError(`EvaluationCycle ${input.cycleId} not found`);
    }
    const timestamp = now();
    const snapshot: MetricMeasurementSnapshot = {
      id: randomUUID(),
      tenantId: this.tenantId,
      cycleId: input.cycleId,
      personId: input.personId,
      rubricVersionId: input.rubricVersionId,
      // 冻结语义：深拷贝，外部变异不影响 verify 复算。
      measurements: structuredClone(input.measurements),
      contentHash: this.computeSnapshotHash(input.measurements),
      frozenAt: timestamp,
      frozenBy: input.frozenBy,
      status: "FROZEN",
      legacyLinkedActorUnknown: false,
      createdAt: timestamp,
    };
    // NPV2-035 TDD R13：存副本——调用方变异返回值不影响冻结完整性。
    this.metricSnapshots.set(
      snapshot.id,
      { ...snapshot, measurements: structuredClone(snapshot.measurements) },
    );
    return snapshot;
  }

  async listMetricMeasurementSnapshots(
    filter?: MetricMeasurementSnapshotFilter,
  ): Promise<MetricMeasurementSnapshot[]> {
    let snapshots = [...this.metricSnapshots.values()];
    if (filter?.cycleId) {
      snapshots = snapshots.filter((s) => s.cycleId === filter.cycleId);
    }
    if (filter?.personId) {
      snapshots = snapshots.filter((s) => s.personId === filter.personId);
    }
    if (filter?.status) {
      snapshots = snapshots.filter((s) => s.status === filter.status);
    }
    return snapshots
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((snapshot) => ({ ...snapshot, measurements: structuredClone(snapshot.measurements) }));
  }

  async getMetricMeasurementSnapshot(
    id: string,
  ): Promise<MetricMeasurementSnapshot> {
    const snapshot = this.metricSnapshots.get(id);
    if (!snapshot) {
      throw new NotFoundError(`MetricMeasurementSnapshot ${id} not found`);
    }
    return { ...snapshot, measurements: structuredClone(snapshot.measurements) };
  }

  async verifyMetricMeasurementSnapshot(id: string) {
    const snapshot = await this.getMetricMeasurementSnapshot(id);
    const actualHash = this.computeSnapshotHash(snapshot.measurements);
    return {
      snapshotId: snapshot.id,
      valid: actualHash === snapshot.contentHash,
      expectedHash: snapshot.contentHash,
      actualHash,
    };
  }

  async linkMetricMeasurementSnapshotToDecision(
    id: string,
    input: { evaluationDecisionId: string; linkedBy: string },
  ): Promise<MetricMeasurementSnapshot> {
    const stored = this.metricSnapshots.get(id);
    if (!stored) {
      throw new NotFoundError(`MetricMeasurementSnapshot ${id} not found`);
    }
    const snapshot = { ...stored, measurements: structuredClone(stored.measurements) };
    if (snapshot.status !== "FROZEN") {
      throw new ConflictError(
        `SNAPSHOT_NOT_FROZEN: snapshot is ${snapshot.status}`,
      );
    }
    const decision = await this.getEvaluationDecision(
      input.evaluationDecisionId,
    );
    if (
      decision.personId !== snapshot.personId ||
      decision.cycleId !== snapshot.cycleId ||
      decision.rubricVersionId !== snapshot.rubricVersionId
    ) {
      throw new ConflictError(
        "SNAPSHOT_DECISION_MISMATCH: decision belongs to a different person, cycle or rubric version",
      );
    }
    snapshot.status = "CONSUMED";
    snapshot.evaluationDecisionId = decision.id;
    snapshot.linkedByPersonId = input.linkedBy;
    snapshot.legacyLinkedActorUnknown = false;
    this.metricSnapshots.set(id, {
      ...snapshot,
      measurements: structuredClone(snapshot.measurements),
    });
    return { ...snapshot, measurements: structuredClone(snapshot.measurements) };
  }

  async createNotification(input: {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
    idempotencyKey?: string;
  }): Promise<InAppNotification> {
    // AUD-011：同租户同幂等键只产生一条通知（重复扫描去重）。
    if (input.idempotencyKey) {
      const existing = [...this.notifications.values()].find(
        (candidate) => candidate.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return existing;
    }
    const notification: InAppNotification = {
      id: randomUUID(),
      tenantId: this.tenantId,
      recipientPersonId: input.recipientPersonId,
      audience: input.audience,
      title: input.title,
      body: input.body,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      status: "UNREAD",
      createdAt: now(),
    };
    this.notifications.set(notification.id, notification);
    return notification;
  }

  async listNotifications(filter?: {
    recipientPersonId?: string;
    audience?: string;
    status?: string;
  }): Promise<InAppNotification[]> {
    return [...this.notifications.values()]
      .filter(
        (notification) =>
          (!filter?.recipientPersonId ||
            notification.recipientPersonId === filter.recipientPersonId) &&
          (!filter?.audience || notification.audience === filter.audience) &&
          (!filter?.status || notification.status === filter.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async markNotificationRead(id: string): Promise<InAppNotification> {
    const notification = this.notifications.get(id);
    if (!notification) notFound("Notification", id);
    if (notification.status !== "READ") {
      notification.status = "READ";
      notification.readAt = now();
    }
    return notification;
  }

  async createDataQualityIssue(input: {
    objectType: string;
    objectId: string;
    issueCode: string;
    severity: "INFO" | "WARNING" | "BLOCKING";
    details?: Record<string, unknown>;
    assignedTo?: string;
    dueAt?: string;
  }): Promise<DataQualityIssue> {
    const timestamp = now();
    const issue: DataQualityIssue = {
      id: randomUUID(),
      tenantId: this.tenantId,
      objectType: input.objectType,
      objectId: input.objectId,
      issueCode: input.issueCode,
      severity: input.severity,
      status: input.assignedTo ? "ASSIGNED" : "OPEN",
      assignedTo: input.assignedTo,
      details: input.details ?? {},
      dueAt: input.dueAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.dataQualityIssues.set(issue.id, issue);
    return issue;
  }

  async getDataQualityIssue(id: string): Promise<DataQualityIssue> {
    const issue = this.dataQualityIssues.get(id);
    if (!issue) notFound("DataQualityIssue", id);
    return issue;
  }

  async listDataQualityIssues(filter?: {
    status?: string;
  }): Promise<DataQualityIssue[]> {
    return [...this.dataQualityIssues.values()]
      .filter((issue) => !filter?.status || issue.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async commandDataQualityIssue(
    id: string,
    input: {
      command:
        | "ASSIGN"
        | "START"
        | "RESOLVE"
        | "WAIVE"
        | "REOPEN"
        | "ESCALATE";
      assignedTo?: string;
      actorPersonId?: string;
      reason?: string;
    },
  ): Promise<DataQualityIssue> {
    const issue = await this.getDataQualityIssue(id);
    const target = {
      ASSIGN: "ASSIGNED",
      START: "IN_PROGRESS",
      RESOLVE: "RESOLVED",
      WAIVE: "WAIVED_WITH_APPROVAL",
      REOPEN: "REOPENED",
    } as const;
    if (input.command !== "ESCALATE") {
      assertTransition(
        dataQualityIssueTransitions,
        "DataQualityIssue",
        issue.status,
        target[input.command],
      );
    }
    const timestamp = now();
    switch (input.command) {
      case "ASSIGN":
        if (!input.assignedTo) {
          throw new ConflictError("DQ_ASSIGNEE_REQUIRED");
        }
        issue.assignedTo = input.assignedTo;
        issue.status = "ASSIGNED";
        break;
      case "START":
        issue.status = "IN_PROGRESS";
        break;
      case "RESOLVE":
        issue.status = "RESOLVED";
        issue.resolvedAt = timestamp;
        break;
      case "WAIVE":
        if (!input.actorPersonId || !input.reason) {
          throw new ConflictError("DQ_WAIVER_REQUIRES_APPROVER_AND_REASON");
        }
        issue.status = "WAIVED_WITH_APPROVAL";
        issue.waivedBy = input.actorPersonId;
        issue.waiverReason = input.reason;
        break;
      case "REOPEN":
        issue.status = "REOPENED";
        issue.resolvedAt = undefined;
        break;
      case "ESCALATE":
        if (
          issue.status === "RESOLVED" ||
          issue.status === "WAIVED_WITH_APPROVAL"
        ) {
          throw new ConflictError("DQ_ISSUE_CLOSED");
        }
        issue.escalatedAt = timestamp;
        issue.escalationReason = input.reason ?? "ESCALATED";
        break;
    }
    issue.updatedAt = timestamp;
    return issue;
  }

  async createEvaluationCycle(input: {
    name: string;
    cycleType: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    policyVersionId?: string;
    rubricVersionId?: string;
  }): Promise<EvaluationCycle> {
    if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
      throw new ConflictError("CYCLE_DATES_INVALID");
    }
    const timestamp = now();
    const cycle: EvaluationCycle = {
      id: randomUUID(),
      tenantId: this.tenantId,
      name: input.name,
      cycleType: input.cycleType,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      status: "DRAFT",
      policyVersionId: input.policyVersionId,
      rubricVersionId: input.rubricVersionId,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.evaluationCycles.set(cycle.id, cycle);
    return cycle;
  }

  async getEvaluationCycle(id: string): Promise<EvaluationCycle> {
    const cycle = this.evaluationCycles.get(id);
    if (!cycle) notFound("EvaluationCycle", id);
    return cycle;
  }

  async listEvaluationCycles(): Promise<EvaluationCycle[]> {
    return [...this.evaluationCycles.values()].sort((a, b) =>
      b.startsAt.localeCompare(a.startsAt),
    );
  }

  async createRubric(input: {
    code: string;
    name: string;
    dimensions: string[];
    scoringAnchors: Record<string, unknown>;
    scope?: Record<string, unknown>;
    effectiveFrom: string;
  }): Promise<Rubric> {
    const version =
      Math.max(
        0,
        ...[...this.rubrics.values()]
          .filter((rubric) => rubric.code === input.code)
          .map((rubric) => rubric.version),
      ) + 1;
    const rubric: Rubric = {
      id: randomUUID(),
      tenantId: this.tenantId,
      code: input.code,
      name: input.name,
      dimensions: input.dimensions,
      scoringAnchors: input.scoringAnchors,
      scope: input.scope ?? {},
      status: "ACTIVE",
      version,
      effectiveFrom: input.effectiveFrom,
      createdAt: now(),
    };
    this.rubrics.set(rubric.id, rubric);
    return rubric;
  }

  async listRubrics(): Promise<Rubric[]> {
    return [...this.rubrics.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    );
  }

  async advanceEvaluationCycle(
    id: string,
    input: { status: string; reason?: string; actorPersonId?: string },
  ): Promise<EvaluationCycle> {
    const cycle = await this.getEvaluationCycle(id);
    assertTransition(
      evaluationCycleTransitions,
      "EvaluationCycle",
      cycle.status,
      input.status as never,
    );
    cycle.status = input.status;
    cycle.updatedAt = now();
    this.recordAuditEvent({
      actorType: "USER",
      actorId: input.actorPersonId,
      action: "EVALUATION_CYCLE_ADVANCED",
      objectType: "EVALUATION_CYCLE",
      objectId: id,
      reason: `${cycle.status} → ${input.status}${input.reason ? `: ${input.reason}` : ""}`,
    });
    return cycle;
  }

  async createEvaluationDraft(input: {
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
  }): Promise<EvaluationDraft> {
    const timestamp = now();
    const draft: EvaluationDraft = {
      id: randomUUID(),
      tenantId: this.tenantId,
      cycleId: input.cycleId,
      personId: input.personId,
      generatedByType: input.generatedByType,
      generatedById: input.generatedById,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      promptVersion: input.promptVersion,
      agentTaskId: input.agentTaskId,
      evidenceSnapshotHash: input.evidenceSnapshotHash,
      draftPayload: input.draftPayload,
      strengths: input.strengths ?? [],
      counterEvidence: input.counterEvidence ?? [],
      missingInformation: input.missingInformation ?? [],
      uncertainty: input.uncertainty ?? {},
      status: "DRAFT",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.evaluationDrafts.set(draft.id, draft);
    return draft;
  }

  async getEvaluationDraft(id: string): Promise<EvaluationDraft> {
    const draft = this.evaluationDrafts.get(id);
    if (!draft) notFound("EvaluationDraft", id);
    return draft;
  }

  async listEvaluationDrafts(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<EvaluationDraft[]> {
    return [...this.evaluationDrafts.values()]
      .filter(
        (draft) =>
          (!filter?.cycleId || draft.cycleId === filter.cycleId) &&
          (!filter?.personId || draft.personId === filter.personId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async submitEvaluationDraft(id: string): Promise<EvaluationDraft> {
    const draft = await this.getEvaluationDraft(id);
    assertTransition(
      evaluationDraftTransitions,
      "EvaluationDraft",
      draft.status,
      "SUBMITTED",
    );
    draft.status = "SUBMITTED";
    draft.updatedAt = now();
    return draft;
  }

  async decideEvaluationDraft(
    id: string,
    input: {
      reviewerPersonId: string;
      rubricVersionId: string;
      decision: "APPROVE" | "REJECT";
      scores: Record<string, number>;
      rationale: string;
      independentScores: Record<string, number>;
      independentRationale: string;
      evidenceOpened?: number;
      reviewStartedAt?: string;
      dimensionStates?: Record<
        string,
        "ASSESSED" | "NOT_APPLICABLE" | "INSUFFICIENT_EVIDENCE"
      >;
    },
  ): Promise<{ draft: EvaluationDraft; decision?: EvaluationDecision }> {
    const draft = await this.getEvaluationDraft(id);
    assertTransition(
      evaluationDraftTransitions,
      "EvaluationDraft",
      draft.status,
      input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
    );
    if (input.reviewerPersonId === draft.personId) {
      throw new ConflictError("SELF_REVIEW_FORBIDDEN");
    }
    const rubric = this.rubrics.get(input.rubricVersionId);
    if (!rubric) notFound("Rubric", input.rubricVersionId);

    const timestamp = now();
    if (input.decision === "REJECT") {
      draft.status = "REJECTED";
      draft.updatedAt = timestamp;
      return { draft };
    }
    // NP-006：允许"全部维度 NOT_APPLICABLE/INSUFFICIENT_EVIDENCE"的决定
    // （无数字分）；逐维度校验在下方循环里完成。

    // NP-006/D-03：维度状态完整语义——NOT_APPLICABLE / INSUFFICIENT_EVIDENCE
    // 可不填数字分（填了必须为 0）；ASSESSED/未声明状态必须有分，0 分须
    // ASSESSED + 独立理由。
    const states = input.dimensionStates ?? {};
    const effectiveScores: Record<string, number> = { ...input.scores };
    for (const dimension of rubric.dimensions) {
      const state = states[dimension];
      const hasScore = dimension in input.scores;
      if (state === "NOT_APPLICABLE" || state === "INSUFFICIENT_EVIDENCE") {
        if (hasScore && input.scores[dimension] !== 0) {
          throw new ConflictError(
            `DIMENSION_STATE_SCORE_CONFLICT: ${dimension} is ${state} but has a numeric score`,
          );
        }
        delete effectiveScores[dimension];
        continue;
      }
      if (!hasScore) {
        throw new ConflictError(`EVALUATION_DIMENSION_MISSING: ${dimension}`);
      }
      if (input.scores[dimension] === 0) {
        if (state !== "ASSESSED") {
          throw new ConflictError(
            `ZERO_SCORE_REQUIRES_ASSESSED_STATE: ${dimension} scored 0 without an ASSESSED dimension state`,
          );
        }
        if ((input.independentRationale ?? "").trim().length < 3) {
          throw new ConflictError(
            `ZERO_SCORE_REQUIRES_ASSESSED_STATE: ${dimension} scored 0 without an evidence-backed rationale`,
          );
        }
      }
    }

    const prior = [...this.evaluationDecisions.values()]
      .filter(
        (candidate) =>
          candidate.cycleId === draft.cycleId &&
          candidate.personId === draft.personId,
      )
      .sort((a, b) => b.decisionVersion - a.decisionVersion);
    const latest = prior[0];
    for (const candidate of prior) {
      if (candidate.status === "APPROVED") candidate.status = "SUPERSEDED";
    }
    const decision: EvaluationDecision = {
      id: randomUUID(),
      tenantId: this.tenantId,
      cycleId: draft.cycleId,
      personId: draft.personId,
      decisionVersion: (latest?.decisionVersion ?? 0) + 1,
      status: "APPROVED",
      rubricVersionId: input.rubricVersionId,
      evidenceSnapshotHash: draft.evidenceSnapshotHash,
      scores: effectiveScores,
      independentScores: input.independentScores,
      independentRationale: input.independentRationale,
      dimensionStates: input.dimensionStates,
      evidenceOpened: input.evidenceOpened,
      reviewStartedAt: input.reviewStartedAt,
      rationale: input.rationale,
      reviewerPersonId: input.reviewerPersonId,
      approvedAt: timestamp,
      supersedesId: latest?.id,
      createdAt: timestamp,
    };
    this.evaluationDecisions.set(decision.id, decision);
    draft.status = "APPROVED";
    draft.updatedAt = timestamp;
    return { draft, decision };
  }

  async listEvaluationDecisions(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<EvaluationDecision[]> {
    return [...this.evaluationDecisions.values()]
      .filter(
        (decision) =>
          (!filter?.cycleId || decision.cycleId === filter.cycleId) &&
          (!filter?.personId || decision.personId === filter.personId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getEvaluationDecision(id: string): Promise<EvaluationDecision> {
    const decision = this.evaluationDecisions.get(id);
    if (!decision) notFound("EvaluationDecision", id);
    return decision;
  }
  };
  return Mixin as unknown as TBase & StoreCtor<EvaluationApi>;
}
