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
  type AgentTaskRepository,
} from "../index.js";

class FakeContext implements AgentContext {
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
}

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
