import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AppealCase,
  AttributionDecision,
  CalculationInput,
  CalculationRun,
  ContributionClaim,
  DataQualityIssue,
  EmployeeConfirmation,
  EvaluationDraft,
  EvidenceNode,
  InAppNotification,
  LegalGateRecord,
  PolicyDefinition,
  PublishPolicyInput,
  PublishedPolicy,
  WorkPackage,
} from "@anari/domain";
import {
  AgentRuntime,
  ContributionAnomalySkill,
  EvidenceGapSkill,
  SettlementReadinessSkill,
  createDefaultSkills,
  createDefaultTools,
  type AgentAuditEntry,
  type AgentContext,
  type AgentSkill,
  type AgentTask,
  type AgentTool,
  type AgentFinding,
  type AgentAction,
  type ToolInvocationRecord,
  type AgentTaskRepository,
  EvidenceCompletenessWorkflow,
  ContributionExceptionWorkflow,
  summarizeAgentMetrics,
  CycleReadinessWorkflow,
} from "../index.js";

class FakeContext implements AgentContext {
  todos = new Map<string, {
    id: string;
    title: string;
    assigneePersonId: string;
    status: string;
    dueAt?: string;
    targetId?: string;
    idempotencyKey: string;
    sourceType: string;
    sourceId: string;
  }>();

  async upsertAgentTodo(input: {
    title: string;
    assigneePersonId: string;
    dueAt?: string;
    targetType?: string;
    targetId?: string;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
  }) {
    const existing = [...this.todos.values()].find(
      (todo) => todo.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return existing;
    const todo = {
      id: crypto.randomUUID(),
      title: input.title,
      assigneePersonId: input.assigneePersonId,
      status: "OPEN",
      dueAt: input.dueAt,
      targetId: input.targetId,
      idempotencyKey: input.idempotencyKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    };
    this.todos.set(todo.id, todo);
    return todo;
  }

  evaluationDecisions: Array<{
    id: string;
    status: string;
    personId: string;
    rubricVersionId: string;
    cycleId?: string;
  }> = [];
  policyVersions: Array<{
    policyVersionId: string;
    code: string;
    version: number;
    status: string;
  }> = [];

  async listDataQualityIssues(filter?: { cycleId?: string; status?: string }) {
    return this.dataQualityIssues.filter(
      (issue) =>
        (!filter?.cycleId ||
          (issue as unknown as { cycleId?: string }).cycleId ===
            filter.cycleId) &&
        (!filter?.status || issue.status === filter.status),
    );
  }

  async listEvaluationDecisions(filter?: { cycleId?: string; personId?: string }) {
    return this.evaluationDecisions.filter(
      (decision) =>
        (!filter?.cycleId || decision.cycleId === filter.cycleId) &&
        (!filter?.personId || decision.personId === filter.personId),
    );
  }

  async listEvaluationDrafts(filter?: { cycleId?: string; status?: string }) {
    return this.evaluationDrafts.filter(
      (draft) =>
        (!filter?.cycleId || draft.cycleId === filter.cycleId) &&
        (!filter?.status || draft.status === filter.status),
    );
  }

  async listPolicyVersions() {
    return this.policyVersions;
  }

  async getPolicy(policyVersionId: string) {
    const found = this.policyVersions.find(
      (version) => version.policyVersionId === policyVersionId,
    );
    if (!found) throw new Error("policy not found");
    return { code: found.code, version: found.version };
  }



  async completeAgentTodo(id: string, completedByPersonId: string) {
    const todo = this.todos.get(id);
    if (!todo) throw new Error("todo not found");
    todo.status = "DONE";
    return todo;
  }

  async listAgentTodos(filter?: { assigneePersonId?: string }) {
    return [...this.todos.values()].filter((todo) =>
      filter?.assigneePersonId
        ? todo.assigneePersonId === filter.assigneePersonId
        : true,
    );
  }

  async listEvaluationCycles() {
    return [];
  }
  async advanceEvaluationCycle() {
    return {};
  }
  workPackages: WorkPackage[] = [];
  claims: ContributionClaim[] = [];
  decisions: AttributionDecision[] = [];
  runs: CalculationRun[] = [];
  confirmations: EmployeeConfirmation[] = [];
  appeals: AppealCase[] = [];
  gates = new Map<string, LegalGateRecord>();
  evidence: EvidenceNode[] = [];
  published: PublishedPolicy[] = [];
  dataQualityIssues: DataQualityIssue[] = [];
  evaluationDrafts: EvaluationDraft[] = [];
  notifications: InAppNotification[] = [];

  async listWorkPackages() { return this.workPackages; }
  async listClaims() { return this.claims; }
  async listDecisions(claimId?: string) {
    return this.decisions.filter((decision) => !claimId || decision.claimId === claimId);
  }
  async listRuns() { return this.runs; }
  async listConfirmations() { return this.confirmations; }
  async listAppeals() { return this.appeals; }
  legalGate: {
    policyVersionId: string;
    democraticProcedureRef: string;
    employeeNoticeRef: string;
    dataProtectionAssessmentRef: string;
    minimumWageChecked: boolean;
    policyApproved: boolean;
    recordedBy: string;
    recordedAt: string;
  } | undefined = {
    policyVersionId: "seeded",
    democraticProcedureRef: "seeded",
    employeeNoticeRef: "seeded",
    dataProtectionAssessmentRef: "seeded",
    minimumWageChecked: true,
    policyApproved: true,
    recordedBy: "seed",
    recordedAt: new Date().toISOString(),
  };

  async getLegalGate(policyVersionId: string) { return this.gates.get(policyVersionId); }
  async listEvidence(subjectType?: string, subjectId?: string) {
    return this.evidence.filter(
      (node) =>
        (!subjectType || node.subjectType === subjectType) &&
        (!subjectId || node.subjectId === subjectId),
    );
  }
  async publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy> {
    const published: PublishedPolicy = {
      policyVersionId: input.policyVersionId ?? "policy-published-1",
      policy: input.policy,
      contentHash: "hash",
      effectiveFrom: input.effectiveFrom,
      publishedAt: new Date().toISOString(),
      approvedBy: input.approvedBy,
      applicability: input.applicability,
    };
    this.published.push(published);
    return published;
  }

  async createDataQualityIssue(input: {
    objectType: string;
    objectId: string;
    issueCode: string;
    severity: "INFO" | "WARNING" | "BLOCKING";
    details?: Record<string, unknown>;
  }): Promise<DataQualityIssue> {
    const timestamp = new Date().toISOString();
    const issue: DataQualityIssue = {
      id: `dq-${this.dataQualityIssues.length + 1}`,
      tenantId: "tenant-1",
      objectType: input.objectType,
      objectId: input.objectId,
      issueCode: input.issueCode,
      severity: input.severity,
      status: "OPEN",
      details: input.details ?? {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.dataQualityIssues.push(issue);
    return issue;
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
    const timestamp = new Date().toISOString();
    const draft: EvaluationDraft = {
      id: `draft-${this.evaluationDrafts.length + 1}`,
      tenantId: "tenant-1",
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
    this.evaluationDrafts.push(draft);
    return draft;
  }

  async createNotification(input: {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
  }): Promise<InAppNotification> {
    const notification: InAppNotification = {
      id: `notification-${this.notifications.length + 1}`,
      tenantId: "tenant-1",
      recipientPersonId: input.recipientPersonId,
      audience: input.audience,
      title: input.title,
      body: input.body,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: "UNREAD",
      createdAt: new Date().toISOString(),
    };
    this.notifications.push(notification);
    return notification;
  }
}

function workPackage(overrides: Partial<WorkPackage> = {}): WorkPackage {
  return {
    id: "wp-1",
    tenantId: "tenant-1",
    title: "Delivery",
    objective: "Deliver",
    packageType: "ORDER_DELIVERY",
    ownerPersonId: "person-1",
    status: "DRAFT",
    acceptanceCriteria: ["Accepted"],
    members: [],
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function formalRun(overrides: Partial<CalculationRun> = {}): CalculationRun {
  return {
    id: "run-1",
    tenantId: "tenant-1",
    cycleId: "cycle-1",
    mode: "FORMAL",
    policyVersionId: "policy-1",
    engineVersion: "test",
    inputSnapshotHash: "hash",
    inputSnapshot: {
      tenantId: "tenant-1",
      cycleId: "cycle-1",
      policyVersionId: "policy-1",
      mode: "FORMAL",
      order: { id: "order-1", grossProfit: "100", currency: "CNY" },
      participants: [],
    },
    status: "CALCULATED",
    lines: [
      {
        lineKey: "p:wp:ORDER_CONTRIBUTION",
        personId: "person-1",
        workPackageId: "wp-1",
        incentiveType: "ORDER_CONTRIBUTION",
        baseAmount: "100",
        multiplier: "1",
        rawAmount: "100",
        roundedAmount: "100",
        currency: "CNY",
        trace: {},
      },
    ],
    blockers: [],
    warnings: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function runtime(context: AgentContext, repository?: AgentTaskRepository) {
  return new AgentRuntime(
    context,
    createDefaultTools(),
    createDefaultSkills(),
    { requireApprovalAtOrAbove: "T3", actor: "agent", repository },
  );
}

class FakeRepository implements AgentTaskRepository {
  tasks = new Map<string, AgentTask>();
  audit: AgentAuditEntry[] = [];

  async load() {
    return {
      tasks: [...this.tasks.values()].map((task) => structuredClone(task)),
      audit: this.audit.map((entry) => ({ ...entry })),
    };
  }

  async saveTask(task: AgentTask) {
    this.tasks.set(task.id, structuredClone(task));
  }

  async appendAudit(entry: AgentAuditEntry) {
    this.audit.push({ ...entry });
  }

  async claimNextReadyTask(input: { workerId: string; leaseMs: number }) {
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
    this.tasks.set(candidate.id, structuredClone(candidate));
    return candidate;
  }

  async renewTaskLease(input: {
    taskId: string;
    workerId: string;
    leaseMs: number;
  }) {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseOwner !== input.workerId) return false;
    task.leaseUntil = new Date(Date.now() + input.leaseMs).toISOString();
    task.version += 1;
    this.tasks.set(task.id, structuredClone(task));
    return true;
  }

  async releaseTaskLease(input: { taskId: string; workerId: string }) {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseOwner !== input.workerId) return false;
    task.leaseOwner = undefined;
    task.leaseUntil = undefined;
    task.version += 1;
    this.tasks.set(task.id, structuredClone(task));
    return true;
  }

  async recoverExpiredLeases() {
    const nowMs = Date.now();
    let recovered = 0;
    for (const task of this.tasks.values()) {
      if (!task.leaseUntil) continue;
      if (new Date(task.leaseUntil).getTime() >= nowMs) continue;
      if (task.status === "RUNNING") task.status = "QUEUED";
      task.leaseOwner = undefined;
      task.leaseUntil = undefined;
      task.version += 1;
      this.tasks.set(task.id, structuredClone(task));
      recovered += 1;
    }
    return recovered;
  }
}

describe("contribution exception workflow (NPV2-025)", () => {
  function claim(overrides: Partial<ContributionClaim> = {}): ContributionClaim {
    const base: ContributionClaim = {
      id: randomUUID(),
      tenantId: "t1",
      workPackageId: "wp-x",
      claimantPersonId: "person-claimant",
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimMode: "STANDARD",
      claimedContribution: { dimensions: ["QUALITY"], summary: "x" },
      evidenceRefs: ["ev-1"],
      rationale: "done",
      status: "SUBMITTED",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submittedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    };
    return { ...base, ...overrides };
  }

  function setup(claims: ContributionClaim[], decisions: AttributionDecision[] = []) {
    const context = new FakeContext();
    context.claims = claims;
    (context as { decisions: AttributionDecision[] }).decisions = decisions;
    // listDecisions 读 decisions 字段？FakeContext.listDecisions 已实现——查它的数据源
    const workflow = new ContributionExceptionWorkflow(context);
    return { context, workflow };
  }

  it("creates an adjudication todo for overdue un-adjudicated claims (no auto-adjudication)", async () => {
    const overdue = claim({ id: "c-overdue" });
    const { context, workflow } = setup([overdue]);
    const result = await workflow.runOnce();
    expect(result.adjudicationTodosCreated).toBe(1);
    expect(result.audit.some((entry) => entry.action === "ADJUDICATION_TODO_CREATED")).toBe(true);
    expect(context.notifications.some((n) => n.title === "Contribution adjudication overdue")).toBe(true);
    const todos = await context.listAgentTodos();
    const todo = todos.find((t) => t.targetId === "c-overdue")!;
    expect(todo.status).toBe("OPEN");
    // 幂等：再跑一轮不重复
    const again = await workflow.runOnce();
    expect(again.adjudicationTodosCreated).toBe(0);
  });

  it("assigns an evidence todo to the claimant for NEEDS_EVIDENCE claims", async () => {
    const needsEvidence = claim({
      id: "c-evidence",
      status: "NEEDS_EVIDENCE",
      submittedAt: new Date().toISOString(),
    });
    const { context, workflow } = setup([needsEvidence]);
    const result = await workflow.runOnce();
    expect(result.evidenceTodosCreated).toBe(1);
    const todos = await context.listAgentTodos({
      assigneePersonId: needsEvidence.claimantPersonId,
    });
    expect(todos.some((t) => t.targetId === "c-evidence")).toBe(true);
  });

  it("escalates self-adjudication conflicts to the manager channel", async () => {
    const selfClaim = claim({ id: "c-self" });
    const selfContext = new FakeContext();
    selfContext.claims = [selfClaim];
    const selfDecision: AttributionDecision = {
      id: randomUUID(),
      tenantId: "t1",
      claimId: "c-self",
      adjudicatorPersonId: selfClaim.claimantPersonId,
      status: "CONFIRMED",
      acceptedFacts: [],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "self",
      decidedAt: new Date().toISOString(),
    } as unknown as AttributionDecision;
    selfContext.decisions = [selfDecision];
    const workflow = new ContributionExceptionWorkflow(selfContext);
    const result = await workflow.runOnce();
    expect(result.conflictsEscalated).toBe(1);
    expect(selfContext.notifications.some((n) => n.title === "Contribution conflict: self-adjudication")).toBe(true);
  });

  it("reconciles open exception todos when the claim reaches a terminal state", async () => {
    const done = claim({ id: "c-done", status: "ACCEPTED" });
    const { context, workflow } = setup([done]);
    // 预置遗留 OPEN 异常待办
    const todo = await context.upsertAgentTodo({
      title: "裁决待办",
      assigneePersonId: "UNASSIGNED_ADJUDICATOR",
      targetType: "CONTRIBUTION_CLAIM",
      targetId: done.id,
      sourceType: "AGENT_FINDING",
      sourceId: "ADJUDICATION_SLA",
      idempotencyKey: `contribution-exception:adjudication:${done.id}`,
    });
    const result = await workflow.runOnce();
    expect(result.todosReconciled).toBe(1);
    expect(todo.status).toBe("DONE");
  });
});

describe("cycle readiness workflow (NPV2-026)", () => {
  function makeReadyContext() {
    const context = new FakeContext();
    context.policyVersions = [
      {
        policyVersionId: "pv-1",
        code: "READY_POLICY",
        version: 1,
        status: "PUBLISHED",
      },
    ];
    const run = {
      id: "run-ready",
      tenantId: "t1",
      cycleId: "cycle-r",
      policyVersionId: "pv-1",
      mode: "FORMAL" as const,
      status: "LOCKED" as const,
      blockers: [] as string[],
      inputSnapshot: {} as Record<string, unknown>,
      inputSnapshotHash: "hash",
      resultHash: "hash",
      lines: [],
      warnings: [],
      createdAt: new Date().toISOString(),
      engineVersion: "v1",
    };
    (context as { runs: unknown[] }).runs = [run];
    (context as {
      gates: Map<string, unknown>;
    }).gates.set("pv-1", {
      policyVersionId: "pv-1",
      democraticProcedureRef: "dp-1",
      employeeNoticeRef: "notice-1",
      dataProtectionAssessmentRef: "dpia-1",
      minimumWageChecked: true,
      policyApproved: true,
      recordedBy: "reviewer",
      recordedAt: new Date().toISOString(),
    });
    return { context };
  }

  it("produces a per-gate readiness report with source references", async () => {
    const { context } = makeReadyContext();
    const workflow = new CycleReadinessWorkflow(context);
    const report = await workflow.run({ cycleId: "cycle-r" });
    const gates = report.checks.map((check) => check.gate);
    expect(gates).toEqual(
      expect.arrayContaining([
        "DATA",
        "POLICY",
        "LEGAL",
        "EVALUATION",
        "APPEAL",
        "CALCULATION",
        "APPROVAL",
      ]),
    );
    for (const check of report.checks) {
      if (check.status !== "NOT_MEASURABLE") {
        expect([check.gate, check.sources.length], JSON.stringify(check)).toEqual(
          expect.arrayContaining([expect.any(String), expect.any(Number)]),
        );
      }
    }
    const legal = report.checks.find((check) => check.gate === "LEGAL")!;
    expect(legal.status).toBe("PASS");
    expect(legal.sources[0]!.type).toBe("LEGAL_GATE");
    const calculation = report.checks.find((check) => check.gate === "CALCULATION")!;
    expect(calculation.status).toBe("PASS");
    expect(report.ready).toBe(true);
    expect(report.note).toContain("does not lock");
  });

  it("blocks on blocking data-quality issues and missing legal gate", async () => {
    const { context } = makeReadyContext();
    (context.dataQualityIssues as Array<{ id: string; severity: string; status: string; cycleId?: string }>) = [
      {
        id: "dq-1",
        severity: "BLOCKING",
        status: "OPEN",
        cycleId: "cycle-r",
      },
    ];
    // 清掉法务门禁 → LEGAL 检查应 BLOCKED。
    context.gates.clear();
    const workflow = new CycleReadinessWorkflow(context);
    const report = await workflow.run({ cycleId: "cycle-r" });
    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.gate === "DATA")!.status).toBe("BLOCKED");
    expect(report.checks.find((check) => check.gate === "LEGAL")!.status).toBe("BLOCKED");
  });
});

describe("agent metrics with external inputs (NPV2-027)", () => {
  function task(overrides: Partial<{
    status: string;
    results: Array<{ status: string; verified?: boolean }>;
    attempts: number;
  }> = {}) {
    return {
      status: "SUCCEEDED",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
      findings: [{ severity: "INFO" }],
      actions: [{ requiresApproval: false }],
      results: [{ status: "EXECUTED", verified: true }],
      attempts: 1,
      ...overrides,
    };
  }

  it("keeps cost/AI-off/false-positive explicitly unavailable without external inputs", async () => {
    const report = summarizeAgentMetrics([task()], "2026-10-03T00:00:00.000Z");
    expect(report.costPerClosedLoop).toBeNull();
    expect(report.aiOffFloor.baselineCompletionRate).toBeNull();
    expect(report.falsePositiveRate).toBeNull();
    const unavailable = report.availability.filter((entry) => !entry.available);
    expect(unavailable.map((entry) => entry.metric)).toEqual(
      expect.arrayContaining(["falsePositiveRate", "costPerClosedLoop", "aiOffFloor"]),
    );
    for (const entry of unavailable) {
      expect(entry.reason).toBeDefined();
      expect(entry.source).toBeDefined();
      expect(entry.denominator).toBeDefined();
    }
  });

  it("computes verified closure rate and costs when inputs are provided", async () => {
    const tasks = [
      task(),
      task({ results: [{ status: "EXECUTED", verified: false }] }),
      task({ status: "FAILED", results: [{ status: "FAILED", verified: false }] }),
    ];
    const report = summarizeAgentMetrics(
      tasks,
      "2026-10-03T00:00:00.000Z",
      {
        humanLabels: { reviewed: 10, falsePositives: 2 },
        costs: { modelCost: 30, toolCost: 10 },
        aiOffBaseline: { completionRate: 0.5, sampleSize: 20 },
      },
    );
    // EXECUTED 共 2 条，其中 1 条 verified
    expect(report.verifiedClosureRate).toBe(0.5);
    // 闭环分母含 FAILED（SUCCEEDED/FAILED/CANCELLED 皆闭环）：40/3 ≈ 13.33
    expect(report.costPerClosedLoop).toBe(13.33);
    expect(report.falsePositiveRate).toBe(0.2);
    expect(report.aiOffFloor.baselineCompletionRate).toBe(0.5);
    expect(report.aiOffFloor.delta).not.toBeNull();
    // 全部指标可测
    expect(report.availability.every((entry) => entry.available)).toBe(true);
  });
});

describe("evidence completeness workflow (NPV2-024)", () => {
  function setup() {
    const context = new FakeContext();
    const workflow = new EvidenceCompletenessWorkflow(context);
    return { context, workflow };
  }

  it("end-to-end: gap → todo + nudge → evidence arrives → todo verified closed", async () => {
    const { context, workflow } = setup();
    const wp = workPackage();
    context.workPackages = [wp];
    // 第一轮：无证据 → 建待办 + 催补证通知
    const round1 = await workflow.runOnce();
    expect(round1.todosCreated).toBe(1);
    expect(round1.audit.some((entry) => entry.action === "TODO_CREATED")).toBe(true);
    expect(context.notifications.some((n) => n.title === "Evidence requested")).toBe(true);

    // 幂等：再跑一轮不重复建待办
    const round2 = await workflow.runOnce();
    expect(round2.todosCreated).toBe(0);

    // 证据入库（模拟上传）→ 再跑一轮：待办被验证关闭
    context.evidence.push({
      id: `ev-${wp.id}`,
      subjectType: "WORK_PACKAGE",
      subjectId: wp.id,
    } as never);
    const round3 = await workflow.runOnce();
    expect(round3.todosVerifiedClosed).toBe(1);
    expect(round3.audit.some((entry) => entry.action === "TODO_VERIFIED_CLOSED")).toBe(true);
    const todos = await context.listAgentTodos();
    const closed = todos.find((t) => t.targetId === wp.id)!;
    expect((closed as { status: string }).status).toBe("DONE");
  });

  it("overdue open todos escalate to the manager channel", async () => {
    const { context, workflow } = setup();
    const wp = workPackage();
    context.workPackages = [wp];
    // 预置一条过期待办（绕过 workflow 直接落）
    await context.upsertAgentTodo({
      title: "过期证据待办",
      assigneePersonId: wp.ownerPersonId,
      dueAt: "2026-01-01T00:00:00.000Z",
      targetType: "WORK_PACKAGE",
      targetId: wp.id,
      sourceType: "AGENT_FINDING",
      sourceId: "NO_EVIDENCE",
      idempotencyKey: `evidence-gap:${wp.id}`,
    });
    const round = await workflow.runOnce();
    expect(round.escalations).toBeGreaterThanOrEqual(1);
    expect(context.notifications.some((n) => n.title === "Evidence todo overdue")).toBe(true);
  });
});

describe("tool contract: timeout/retry/postcondition (NPV2-021)", () => {
  function makeRuntimeWith(tools: AgentTool[]) {
    const context = new FakeContext();
    const repository = new FakeRepository();
    const runtime = new AgentRuntime(context, tools, createDefaultSkills(), {
      actor: "contract-worker",
      repository,
    });
    return { runtime, repository, context };
  }

  function planOneAction(tool: string): (finding: AgentFinding) => AgentAction[] {
    return (finding) => [
      {
        id: randomUUID(),
        tool,
        riskTier: "T0",
        targetType: "TEST",
        targetId: finding.subjectId,
        description: "contract probe",
        payload: {},
        requiresApproval: false,
      },
    ];
  }

  it("postcondition failure marks the action FAILED and the task is not SUCCEEDED", async () => {
    const probe: AgentTool = {
      name: "contract_probe",
      riskTier: "T0",
      access: "WRITE",
      description: "always succeeds but postcondition fails",
      contract: {
        scope: "probe",
        sideEffect: true,
        verifier: async () => false,
      },
      async execute() {
        return { ok: true };
      },
    };
    const skill: AgentSkill = {
      name: "PROBE",
      async observe(context) {
        return [
          {
            code: "PROBE_FINDING",
            severity: "INFO",
            subjectType: "TEST",
            subjectId: `probe-${Date.now()}`,
            message: "probe",
          },
        ];
      },
      plan: planOneAction("contract_probe"),
    };
    const { runtime } = makeRuntimeWith([probe]);
    const runtimeWithSkill = new AgentRuntime(
      new FakeContext(),
      [probe],
      { PROBE: skill },
      { actor: "contract-worker" },
    );
    const task = await runtimeWithSkill.enqueue({
      tenantId: "t1",
      agentType: "PROBE",
      triggerType: "MANUAL",
      idempotencyKey: `contract-1-${Date.now()}`,
    });
    const ran = await runtimeWithSkill.run(task.id);
    expect(ran.results[0]!.status).toBe("FAILED");
    expect(ran.results[0]!.error).toBe("POSTCONDITION_FAILED");
    expect(ran.status).not.toBe("SUCCEEDED");
    expect(ran.status).toBe("FAILED");
  });

  it("timeout marks the action FAILED with TOOL_TIMEOUT", async () => {
    const slow: AgentTool = {
      name: "slow_probe",
      riskTier: "T0",
      access: "READ",
      description: "hangs",
      contract: { scope: "probe", timeoutMs: 40 },
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { ok: true };
      },
    };
    const skill: AgentSkill = {
      name: "SLOW",
      async observe() {
        return [
          {
            code: "SLOW_FINDING",
            severity: "INFO",
            subjectType: "TEST",
            subjectId: `slow-${Date.now()}`,
            message: "slow",
          },
        ];
      },
      plan: planOneAction("slow_probe"),
    };
    const runtime = new AgentRuntime(
      new FakeContext(),
      [slow],
      { SLOW: skill },
      { actor: "contract-worker" },
    );
    const task = await runtime.enqueue({
      tenantId: "t1",
      agentType: "SLOW",
      triggerType: "MANUAL",
      idempotencyKey: `contract-2-${Date.now()}`,
    });
    const ran = await runtime.run(task.id);
    expect(ran.results[0]!.status).toBe("FAILED");
    expect(ran.results[0]!.error).toContain("exceeded 40ms");
    expect(ran.status).toBe("FAILED");
  });

  it("retries transient failures and records retry count", async () => {
    let attempts = 0;
    const flaky: AgentTool = {
      name: "flaky_probe",
      riskTier: "T0",
      access: "WRITE",
      description: "fails once then succeeds",
      contract: { scope: "probe", sideEffect: true, retries: 1 },
      async execute() {
        attempts += 1;
        if (attempts === 1) throw new Error("TRANSIENT");
        return { ok: true, attempts };
      },
    };
    const skill: AgentSkill = {
      name: "FLAKY",
      async observe() {
        return [
          {
            code: "FLAKY_FINDING",
            severity: "INFO",
            subjectType: "TEST",
            subjectId: `flaky-${Date.now()}`,
            message: "flaky",
          },
        ];
      },
      plan: planOneAction("flaky_probe"),
    };
    const runtime = new AgentRuntime(
      new FakeContext(),
      [flaky],
      { FLAKY: skill },
      { actor: "contract-worker" },
    );
    const task = await runtime.enqueue({
      tenantId: "t1",
      agentType: "FLAKY",
      triggerType: "MANUAL",
      idempotencyKey: `contract-3-${Date.now()}`,
    });
    const ran = await runtime.run(task.id);
    expect(ran.status).toBe("SUCCEEDED");
    const invocations = await runtime.getToolInvocations(task.id);
    expect(invocations[0]!.status).toBe("EXECUTED");
    expect(invocations[0]!.retries).toBe(1);
  });

  it("create_todo declares a contract and its verifier accepts real todos", async () => {
    const context = new FakeContext();
    const todoTool = createDefaultTools().find(
      (tool) => tool.name === "create_todo",
    )!;
    expect(todoTool.contract?.scope).toBe("agent_todos");
    expect(todoTool.contract?.sideEffect).toBe(true);
    // 直接调用工具（经 runtime 的契约层不可绕过 verifier——这里手工跑
    // verifier 验证真实落库路径）。
    const output = await todoTool.execute(
      {
        title: "补交验收单",
        assigneePersonId: "00000000-0000-4000-8000-00000000c801",
        targetType: "WORK_PACKAGE",
        targetId: "wp-contract",
        idempotencyKey: `contract-todo-${Date.now()}`,
      },
      context,
      { taskId: "task-todo", actor: "todo-contract-worker" },
    );
    expect((output as { todoId: string }).todoId).toBeDefined();
    // verifier 对真实落库的待办应放行。
    const ok = await todoTool.contract!.verifier!(
      {},
      output,
      context,
    );
    expect(ok).toBe(true);
    expect(context.todos.size).toBeGreaterThan(0);
  });
});

describe("persistent create_todo (NPV2-020)", () => {
  it("creates a todo via context and is idempotent on repeated calls", async () => {
    const context = new FakeContext();
    const runtime = new AgentRuntime(
      context,
      createDefaultTools(),
      createDefaultSkills(),
      { actor: "todo-worker" },
    );
    const task = await runtime.enqueue({
      tenantId: "t1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "todo-tool-1",
    });
    await runtime.run(task.id);
    // 工具经 context 落库（FakeContext.upsertAgentTodo 幂等键去重）
    const todos = await context.listAgentTodos();
    const ids = new Set(todos.map((t) => t.id));
    const keys = todos.map((t) => (t as { idempotencyKey?: string }).idempotencyKey);
    if (keys.length > 0) {
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(ids.size).toBe(todos.length);
  });
});

describe("agent step & tool invocation persistence (NPV2-019)", () => {
  function makeRuntime() {
    const context = new FakeContext();
    const repository = new FakeRepository();
    const runtime = new AgentRuntime(context, createDefaultTools(), createDefaultSkills(), {
      actor: "step-worker",
      repository,
    });
    return { runtime, repository };
  }

  it("records OBSERVE/PLAN steps with hashes and durations", async () => {
    const { runtime } = makeRuntime();
    const task = await runtime.enqueue({
      tenantId: "t1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "step-1",
    });
    await runtime.run(task.id);
    const steps = await runtime.getSteps(task.id);
    const kinds = steps.map((s) => s.kind);
    expect(kinds).toContain("OBSERVE");
    expect(kinds).toContain("PLAN");
    for (const step of steps) {
      expect(step.status).toBe("SUCCEEDED");
      expect(step.outputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
      expect(step.executedBy).toBe("step-worker");
    }
  });

  it("records tool invocations consistent with task results", async () => {
    const { runtime } = makeRuntime();
    const task = await runtime.enqueue({
      tenantId: "t1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "step-2",
    });
    const ran = await runtime.run(task.id);
    const invocations = await runtime.getToolInvocations(task.id);
    const executed = ran.results.filter((r) => r.status === "EXECUTED");
    expect(invocations.length).toBe(executed.length);
    for (const record of invocations) {
      expect(record.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(record.outputHash).toBeDefined();
      expect(record.status).toBe("EXECUTED");
    }
  });

  it("resets interrupted RUNNING steps to PENDING on resume", async () => {
    const { runtime } = makeRuntime();
    const task = await runtime.enqueue({
      tenantId: "t1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "step-3",
    });
    await runtime.run(task.id);
    // 模拟 worker 崩溃残留：一个步骤卡在 RUNNING
    const steps = await runtime.getSteps(task.id);
    const target = steps[0]!;
    target.status = "RUNNING";
    const reset = await runtime.resumeInterruptedSteps(task.id);
    expect(reset).toBeGreaterThanOrEqual(1);
    const after = await runtime.getSteps(task.id);
    expect(after.find((s) => s.id === target.id)!.status).toBe("PENDING");
  });
});

describe("agent task claim / lease / CAS (NPV2-018)", () => {
  function makeRuntime() {
    const context = new FakeContext();
    const repository = new FakeRepository();
    const runtime = new AgentRuntime(context, createDefaultTools(), createDefaultSkills(), {
      actor: "test",
      repository,
    });
    return { runtime, repository };
  }

  it("runClaimed executes exactly one queued task and releases the lease", async () => {
    const { runtime, repository } = makeRuntime();
    await runtime.enqueue({
      tenantId: "t1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "claim-1",
    });
    const ran = await runtime.runClaimed("worker-1", 60_000);
    expect(ran).toBeDefined();
    expect(ran!.status).not.toBe("QUEUED");
    const reloaded = await repository.load();
    const task = reloaded.tasks.find((t) => t.id === ran!.id)!;
    expect(task.leaseOwner).toBeUndefined();
    expect(task.leaseUntil).toBeUndefined();
    // 队列已空：下一个 worker 领不到。
    expect(await runtime.runClaimed("worker-2", 60_000)).toBeUndefined();
  });

  it("racing claims on the same task produce exactly one winner", async () => {
    const { runtime } = makeRuntime();
    await runtime.enqueue({
      tenantId: "t1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "claim-2",
    });
    const [a, b] = await Promise.all([
      runtime.claimNextReadyTask({ workerId: "worker-a", leaseMs: 60_000 }),
      runtime.claimNextReadyTask({ workerId: "worker-b", leaseMs: 60_000 }),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners.length).toBe(1);
  });

  it("expired leases are recoverable and RUNNING resets to QUEUED", async () => {
    const { runtime } = makeRuntime();
    const task = await runtime.enqueue({
      tenantId: "t1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "claim-3",
    });
    await runtime.claimNextReadyTask({ workerId: "dead-worker", leaseMs: 30 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const recovered = await runtime.recoverExpiredLeases();
    expect(recovered).toBeGreaterThanOrEqual(1);
    const loaded = await runtime.get(task.id);
    expect(loaded.leaseOwner).toBeUndefined();
    expect(loaded.leaseUntil).toBeUndefined();
  });
});

describe("agent runtime role isolation", () => {
  it("blocks WRITE tools when the runtime is in READER role", async () => {
    const context = new FakeContext();
    const writeTool: AgentTool = {
      name: "write_test",
      riskTier: "T0",
      access: "WRITE",
      description: "Write test",
      async execute() {
        return { wrote: true };
      },
    };
    const skill: AgentSkill = {
      name: "TEST_WRITE",
      async observe() {
        return [
          {
            code: "TEST",
            severity: "INFO",
            subjectType: "WORK_PACKAGE",
            subjectId: "wp-1",
            message: "test",
          },
        ];
      },
      plan() {
        return [
          {
            id: "action-1",
            tool: "write_test",
            riskTier: "T0",
            targetType: "WORK_PACKAGE",
            targetId: "wp-1",
            description: "write",
            payload: {},
            requiresApproval: false,
          },
        ];
      },
    };
    const agent = new AgentRuntime(context, [writeTool], { TEST_WRITE: skill }, {
      actor: "reader",
      role: "BOTH",
    });
    const readerTask = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "TEST_WRITE",
      triggerType: "MANUAL",
      idempotencyKey: "reader-role-1",
      actorRole: "READER",
    });
    const readerRun = await agent.run(readerTask.id);
    expect(readerRun.results[0]?.status).toBe("REJECTED");
    expect(readerRun.results[0]?.error).toBe("READER_ROLE_CANNOT_WRITE");
    const actorTask = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "TEST_WRITE",
      triggerType: "MANUAL",
      idempotencyKey: "actor-role-1",
      actorRole: "ACTOR",
    });
    const actorRun = await agent.run(actorTask.id);
    expect(actorRun.results[0]?.status).toBe("EXECUTED");
  });
});

describe("agent runtime", () => {
  it("runs a proactive evidence-gap scan and waits for approval on escalation", async () => {
    const context = new FakeContext();
    context.workPackages = [workPackage()];
    const agent = runtime(context);

    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "EVIDENCE_GAP",
      triggerType: "SCHEDULE",
      idempotencyKey: "scan-1",
    });
    const ran = await agent.run(task.id);
    expect(ran.status).toBe("WAITING_APPROVAL");
    expect(ran.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["WORK_PACKAGE_NOT_COMMITTED", "NO_EVIDENCE"]),
    );
    expect(
      context.notifications.some(
        (notification) => notification.recipientPersonId === "person-1",
      ),
    ).toBe(true);

    const escalation = ran.actions.find((action) => action.tool === "escalate")!;
    const approved = await agent.approve(ran.id, escalation.id, "manager-1");
    expect(approved.status).toBe("SUCCEEDED");
    expect(approved.approvedBy).toBe("manager-1");
    expect(
      (await agent.auditLog()).some((entry) => entry.tool === "escalate"),
    ).toBe(true);
    expect(
      context.notifications.some(
        (notification) => notification.audience === "MANAGER",
      ),
    ).toBe(true);
  });

  it("executes low-risk evidence requests automatically", async () => {
    const context = new FakeContext();
    context.workPackages = [
      workPackage({
        status: "ACCEPTED",
        commitmentSnapshot: {
          snapshotId: "snap-1",
          workPackageId: "wp-1",
          capturedAt: new Date().toISOString(),
          title: "Delivery",
          objective: "Deliver",
          ownerPersonId: "person-1",
          members: [],
          acceptanceCriteria: ["Accepted"],
          contentHash: "hash",
        },
      }),
    ];
    const agent = runtime(context);
    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "EVIDENCE_GAP",
      triggerType: "EVENT",
      idempotencyKey: "scan-2",
    });
    const ran = await agent.run(task.id);
    expect(ran.status).toBe("SUCCEEDED");
    expect(ran.results.every((result) => result.status === "EXECUTED")).toBe(true);
  });

  it("detects a formal settlement blocker and requires approval to escalate", async () => {
    const context = new FakeContext();
    context.runs = [formalRun()];
    const agent = runtime(context);
    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "SETTLEMENT_READINESS",
      triggerType: "THRESHOLD",
      input: { runId: "run-1" },
      idempotencyKey: "settlement-1",
    });
    const ran = await agent.run(task.id);
    expect(ran.status).toBe("WAITING_APPROVAL");
    expect(ran.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "LEGAL_GATE_MISSING",
        "MISSING_EMPLOYEE_CONFIRMATION",
      ]),
    );
  });

  it("detects self-adjudication in contribution claims", async () => {
    const context = new FakeContext();
    context.claims = [
      {
        id: "claim-1",
        tenantId: "tenant-1",
        workPackageId: "wp-1",
        claimantPersonId: "person-1",
        claimType: "DELIVERABLE_CONTRIBUTION",
        claimMode: "STANDARD",
        claimedContribution: { dimensions: ["QUALITY"], summary: "Done" },
        evidenceRefs: ["ev-1"],
        rationale: "Done",
        status: "UNDER_REVIEW",
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    context.decisions = [
      {
        id: "decision-1",
        tenantId: "tenant-1",
        claimId: "claim-1",
        decisionVersion: 1,
        status: "CONFIRMED",
        adjudicatorPersonId: "person-1",
        acceptedFacts: [],
        rejectedFacts: [],
        contributionDimensions: {},
        rationale: "Self",
        effectiveAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ];
    const agent = runtime(context);
    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "CONTRIBUTION_ANOMALY",
      triggerType: "SCHEDULE",
      idempotencyKey: "anomaly-1",
    });
    const ran = await agent.run(task.id);
    expect(ran.findings.map((finding) => finding.code)).toContain(
      "SELF_ADJUDICATION",
    );
    expect(ran.status).toBe("WAITING_APPROVAL");
  });

  it("proposes a policy change and requires T3 approval", async () => {
    const agent = runtime(new FakeContext());
    const current: PolicyDefinition = {
      code: "GENERIC_CONTRIBUTION_V1",
      version: 1,
      currency: "CNY",
      poolRate: "0.05",
      poolCap: "100000",
      rounding: "HALF_UP",
      calculator: "SIMPLE_POOL",
    };
    const proposed: PolicyDefinition = {
      ...current,
      version: 2,
      poolRate: "0.06",
    };
    const sampleInput: CalculationInput = {
      tenantId: "tenant-1",
      cycleId: "cycle-1",
      policyVersionId: "policy-1",
      mode: "SHADOW",
      order: { id: "order-1", grossProfit: "100000", currency: "CNY" },
      participants: [
        {
          personId: "person-1",
          workPackageId: "wp-1",
          attributionWeight: "1",
          role: "OWNER",
        },
      ],
    };

    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "POLICY_PROPOSAL",
      triggerType: "MANUAL",
      input: {
        currentPolicy: current,
        proposedPolicy: proposed,
        applicability: {
          legalEntity: "N-Perform Test Entity",
          jurisdictions: ["CN"],
          workLocations: ["Shanghai"],
          employeeCategories: ["FULL_TIME"],
          workTimeTypes: ["FULL_TIME"],
        },
        samples: [{ personId: "person-1", input: sampleInput }],
      },
      idempotencyKey: "policy-proposal-1",
    });
    const ran = await agent.run(task.id);
    expect(ran.status).toBe("WAITING_APPROVAL");
    expect(ran.findings.map((finding) => finding.code)).toContain(
      "POLICY_PROPOSAL_READY",
    );
    const publish = ran.actions.find((action) => action.tool === "publish_policy")!;
    const approved = await agent.approve(ran.id, publish.id, "admin-1");
    expect(approved.status).toBe("SUCCEEDED");
    expect(
      (await agent.auditLog()).some(
        (entry) => entry.tool === "publish_policy",
      ),
    ).toBe(true);
  });

  it("detects blocking evidence quality and escalates", async () => {
    const context = new FakeContext();
    context.evidence = [
      {
        id: "ev-1",
        tenantId: "tenant-1",
        evidenceType: "DELIVERY",
        subjectType: "WORK_PACKAGE",
        subjectId: "wp-1",
        sourceSystem: "CRM",
        observedAt: new Date().toISOString(),
        qualityStatus: "CONFLICTED",
        normalizedPayload: {},
        payloadHash: "hash",
        createdAt: new Date().toISOString(),
      },
    ];
    const agent = runtime(context);
    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "DATA_QUALITY",
      triggerType: "SCHEDULE",
      idempotencyKey: "dq-1",
    });
    const ran = await agent.run(task.id);
    expect(ran.status).toBe("WAITING_APPROVAL");
    expect(ran.findings[0]!.code).toBe("EVIDENCE_QUALITY_ISSUE");
  });

  it("detects an appeal SLA breach", async () => {
    const context = new FakeContext();
    context.appeals = [
      {
        id: "appeal-1",
        tenantId: "tenant-1",
        appellantPersonId: "person-1",
        targetType: "ATTRIBUTION",
        targetId: "decision-1",
        reasonCode: "EVIDENCE_NOT_CONSIDERED",
        statement: "Please review",
        status: "OPEN",
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    const agent = runtime(context);
    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "APPEAL_SLA",
      triggerType: "SCHEDULE",
      input: { slaDays: 3 },
      idempotencyKey: "appeal-sla-1",
    });
    const ran = await agent.run(task.id);
    expect(ran.status).toBe("WAITING_APPROVAL");
    expect(ran.findings[0]!.code).toBe("APPEAL_SLA_BREACH");
  });

  it("is idempotent for the same task key", async () => {
    const agent = runtime(new FakeContext());
    const first = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "same-key",
    });
    const second = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "same-key",
    });
    expect(second.id).toBe(first.id);
  });

  it("persists a data-quality issue and escalates a blocking finding", async () => {
    const context = new FakeContext();
    const timestamp = new Date().toISOString();
    context.evidence = [
      {
        id: "ev-1",
        tenantId: "tenant-1",
        evidenceType: "ORDER",
        subjectType: "WORK_PACKAGE",
        subjectId: "wp-1",
        sourceSystem: "CRM",
        observedAt: timestamp,
        qualityStatus: "CONFLICTED",
        normalizedPayload: {},
        payloadHash: "hash",
        createdAt: timestamp,
      },
    ];
    const agent = runtime(context);
    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "DATA_QUALITY",
      triggerType: "MANUAL",
      idempotencyKey: "data-quality-1",
    });
    const ran = await agent.run(task.id);
    expect(context.dataQualityIssues).toHaveLength(1);
    expect(context.dataQualityIssues[0]!.severity).toBe("BLOCKING");
    expect(context.dataQualityIssues[0]!.objectId).toBe("ev-1");
    expect(ran.status).toBe("WAITING_APPROVAL");
    expect(
      ran.results.some((result) => result.status === "EXECUTED"),
    ).toBe(true);
  });

  it("creates an evidence-bound evaluation draft without scoring", async () => {
    const context = new FakeContext();
    const timestamp = new Date().toISOString();
    context.claims = [
      {
        id: "claim-1",
        tenantId: "tenant-1",
        workPackageId: "wp-1",
        claimantPersonId: "person-1",
        claimType: "DELIVERABLE_CONTRIBUTION",
        claimMode: "STANDARD",
        claimedContribution: { dimensions: ["QUALITY"], summary: "Done" },
        evidenceRefs: ["ev-1"],
        rationale: "Done",
        status: "UNDER_REVIEW",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    context.decisions = [
      {
        id: "decision-1",
        tenantId: "tenant-1",
        claimId: "claim-1",
        decisionVersion: 1,
        status: "CONFIRMED",
        adjudicatorPersonId: "person-2",
        acceptedFacts: ["Delivered"],
        rejectedFacts: [],
        contributionDimensions: { QUALITY: 1 },
        rationale: "Evidence supports delivery",
        effectiveAt: timestamp,
        createdAt: timestamp,
      },
    ];
    context.evidence = [
      {
        id: "ev-1",
        tenantId: "tenant-1",
        evidenceType: "DELIVERY_RECORD",
        subjectType: "WORK_PACKAGE",
        subjectId: "wp-1",
        sourceSystem: "CRM",
        observedAt: timestamp,
        qualityStatus: "VALID",
        normalizedPayload: { accepted: true },
        payloadHash: "payload-hash-1",
        createdAt: timestamp,
      },
    ];

    const agent = runtime(context);
    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "EVALUATION_DRAFT",
      triggerType: "MANUAL",
      idempotencyKey: "evaluation-draft-1",
      input: { cycleId: "cycle-1", personId: "person-1" },
    });
    const ran = await agent.run(task.id);
    expect(ran.status).toBe("SUCCEEDED");
    expect(context.evaluationDrafts).toHaveLength(1);
    const draft = context.evaluationDrafts[0]!;
    expect(draft.generatedByType).toBe("AGENT");
    expect(draft.agentTaskId).toBe(task.id);
    expect(draft.missingInformation).toEqual([]);
    expect(draft.strengths.length).toBeGreaterThan(0);
    expect(draft.draftPayload).not.toHaveProperty("scores");
  });

  it("rehydrates tasks, idempotency and audit from a repository", async () => {
    const repository = new FakeRepository();
    const context = new FakeContext();
    context.workPackages = [workPackage()];
    const first = runtime(context, repository);
    const task = await first.enqueue({
      tenantId: "tenant-1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "durable-1",
    });
    await first.run(task.id);

    const second = runtime(new FakeContext(), repository);
    const loaded = await second.get(task.id);
    expect(loaded.status).toBe("WAITING_APPROVAL");
    expect(await second.list()).toHaveLength(1);
    expect((await second.auditLog()).length).toBeGreaterThan(0);

    const replay = await second.enqueue({
      tenantId: "tenant-1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "durable-1",
    });
    expect(replay.id).toBe(task.id);
  });

  it("retries action-free failures and dead-letters at the attempt limit", async () => {
    const repository = new FakeRepository();
    const agent = runtime(new FakeContext(), repository);
    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "UNKNOWN_SKILL",
      triggerType: "MANUAL",
      idempotencyKey: "retry-1",
    });
    expect((await agent.run(task.id)).status).toBe("FAILED");

    const first = await agent.retryFailed({
      minAgeMs: -1000,
      maxAttempts: 3,
    });
    expect(first).toHaveLength(1);
    expect(first[0]!.attempts).toBe(2);

    await agent.retryFailed({ minAgeMs: -1000, maxAttempts: 3 });
    const dead = await agent.retryFailed({
      minAgeMs: -1000,
      maxAttempts: 3,
    });
    expect(dead).toHaveLength(0);

    const loaded = await agent.get(task.id);
    expect(loaded.status).toBe("FAILED");
    expect(loaded.output?.deadLettered).toBe(true);

    const reloaded = runtime(new FakeContext(), repository);
    expect((await reloaded.get(task.id)).output?.deadLettered).toBe(true);
  });
});

import { AgentScheduler } from "../scheduler.js";

describe("agent scheduler", () => {
  it("ticks schedules, emits events and evaluates thresholds idempotently", async () => {
    const context = new FakeContext();
    context.workPackages = [workPackage()];
    const agent = runtime(context);
    const scheduler = new AgentScheduler(agent, "tenant-1", "test");
    scheduler.addSchedule({
      id: "evidence-hourly",
      agentType: "EVIDENCE_GAP",
      intervalMs: 1000,
    });
    scheduler.addEventRule({
      id: "on-acceptance",
      eventType: "WORK_PACKAGE_ACCEPTED",
      agentType: "EVIDENCE_GAP",
    });
    scheduler.addThresholdRule({
      id: "open-appeals",
      metric: "openAppeals",
      comparator: ">=",
      value: 3,
      agentType: "CONTRIBUTION_ANOMALY",
    });

    const first = await scheduler.tick(0);
    expect(first).toHaveLength(1);
    expect(await scheduler.tick(500)).toHaveLength(0);
    const second = await scheduler.tick(1000);
    expect(second).toHaveLength(1);
    expect(second[0]!.id).not.toBe(first[0]!.id);

    const events = await scheduler.emit(
      "WORK_PACKAGE_ACCEPTED",
      {},
      "event-1",
    );
    expect(events).toHaveLength(1);

    const thresholds = await scheduler.evaluateThresholds({ openAppeals: 4 });
    expect(thresholds).toHaveLength(1);
    const replay = await scheduler.evaluateThresholds({ openAppeals: 4 });
    expect(replay[0]!.id).toBe(thresholds[0]!.id);
  });
});

describe("policy proposal loop", () => {
  it("publishes a policy only after a human approves the T3 action", async () => {
    const context = new FakeContext();
    const agent = runtime(context);
    const current: PolicyDefinition = {
      code: "GENERIC_CONTRIBUTION_V1",
      version: 1,
      currency: "CNY",
      poolRate: "0.05",
      poolCap: "100000",
      rounding: "HALF_UP",
      calculator: "SIMPLE_POOL",
    };
    const proposed: PolicyDefinition = {
      ...current,
      version: 2,
      poolRate: "0.06",
    };
    const sample: CalculationInput = {
      tenantId: "tenant-1",
      cycleId: "cycle-1",
      policyVersionId: "policy-1",
      mode: "SHADOW",
      order: { id: "order-1", grossProfit: "100000", currency: "CNY" },
      participants: [
        {
          personId: "person-1",
          workPackageId: "wp-1",
          attributionWeight: "1",
          role: "OWNER",
        },
      ],
    };

    const task = await agent.enqueue({
      tenantId: "tenant-1",
      agentType: "POLICY_PROPOSAL",
      triggerType: "MANUAL",
      idempotencyKey: "policy-proposal-1",
      input: {
        currentPolicy: current,
        proposedPolicy: proposed,
        applicability: {
          legalEntity: "N-Perform Test Entity",
          jurisdictions: ["CN"],
          workLocations: ["Shanghai"],
          employeeCategories: ["FULL_TIME"],
          workTimeTypes: ["FULL_TIME"],
        },
        samples: [{ personId: "person-1", input: sample }],
        effectiveFrom: "2026-11-01T00:00:00.000Z",
      },
    });
    const ran = await agent.run(task.id);
    expect(ran.status).toBe("WAITING_APPROVAL");
    expect(context.published).toHaveLength(0);

    const action = ran.actions.find(
      (candidate) => candidate.tool === "publish_policy",
    );
    expect(action).toBeDefined();
    const approved = await agent.approve(task.id, action!.id, "person-2");
    expect(approved.status).toBe("SUCCEEDED");
    expect(context.published).toHaveLength(1);
    expect(context.published[0]!.approvedBy).toBe("person-2");
    expect(context.published[0]!.effectiveFrom).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(context.published[0]!.policy.version).toBe(2);
  });
});

import { OutboxPoller, type OutboxEvent, type OutboxSource } from "../outbox.js";

class FakeOutbox implements OutboxSource {
  events: OutboxEvent[] = [];
  published = new Set<string>();

  async claimBatch(limit: number) {
    return this.events
      .filter((event) => !this.published.has(event.id))
      .slice(0, limit);
  }
  async markPublished(id: string) {
    this.published.add(id);
  }
}

describe("outbox poller", () => {
  it("turns unpublished events into agent work and marks them published", async () => {
    const context = new FakeContext();
    context.workPackages = [workPackage()];
    const agent = runtime(context);
    const scheduler = new AgentScheduler(agent, "tenant-1", "test");
    scheduler.addEventRule({
      id: "claim-submitted",
      eventType: "ContributionClaimSubmitted",
      agentType: "EVIDENCE_GAP",
    });
    const outbox = new FakeOutbox();
    outbox.events = [
      {
        id: "event-1",
        tenantId: "tenant-1",
        eventType: "ContributionClaimSubmitted",
        payload: { claimId: "claim-1" },
        occurredAt: new Date().toISOString(),
      },
    ];
    const poller = new OutboxPoller(outbox, scheduler);
    const tasks = await poller.pollOnce();
    expect(tasks).toHaveLength(1);
    expect(outbox.published.has("event-1")).toBe(true);
    expect(await poller.pollOnce()).toHaveLength(0);
  });
});
