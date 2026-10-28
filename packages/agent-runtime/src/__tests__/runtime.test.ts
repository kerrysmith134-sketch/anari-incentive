import { describe, expect, it } from "vitest";
import type {
  AppealCase,
  AttributionDecision,
  CalculationInput,
  CalculationRun,
  ContributionClaim,
  EmployeeConfirmation,
  EvidenceNode,
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
  type AgentContext,
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
    };
    this.published.push(published);
    return published;
  }
}

function workPackage(overrides: Partial<WorkPackage> = {}): WorkPackage {
  return {
    id: "wp-1",
    tenantId: "tenant-1",
    title: "Delivery",
    objective: "Deliver",
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

function runtime(context: AgentContext) {
  return new AgentRuntime(
    context,
    createDefaultTools(),
    createDefaultSkills(),
    { requireApprovalAtOrAbove: "T3", actor: "agent" },
  );
}

describe("agent runtime", () => {
  it("runs a proactive evidence-gap scan and waits for approval on escalation", async () => {
    const context = new FakeContext();
    context.workPackages = [workPackage()];
    const agent = runtime(context);

    const task = agent.enqueue({
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

    const escalation = ran.actions.find((action) => action.tool === "escalate")!;
    const approved = await agent.approve(ran.id, escalation.id, "manager-1");
    expect(approved.status).toBe("SUCCEEDED");
    expect(approved.approvedBy).toBe("manager-1");
    expect(agent.auditLog().some((entry) => entry.tool === "escalate")).toBe(true);
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
    const task = agent.enqueue({
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
    const task = agent.enqueue({
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
    const task = agent.enqueue({
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

    const task = agent.enqueue({
      tenantId: "tenant-1",
      agentType: "POLICY_PROPOSAL",
      triggerType: "MANUAL",
      input: {
        currentPolicy: current,
        proposedPolicy: proposed,
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
    expect(agent.auditLog().some((entry) => entry.tool === "publish_policy")).toBe(
      true,
    );
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
    const task = agent.enqueue({
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
    const task = agent.enqueue({
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

  it("is idempotent for the same task key", () => {
    const agent = runtime(new FakeContext());
    const first = agent.enqueue({
      tenantId: "tenant-1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "same-key",
    });
    const second = agent.enqueue({
      tenantId: "tenant-1",
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "same-key",
    });
    expect(second.id).toBe(first.id);
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

    const task = agent.enqueue({
      tenantId: "tenant-1",
      agentType: "POLICY_PROPOSAL",
      triggerType: "MANUAL",
      idempotencyKey: "policy-proposal-1",
      input: {
        currentPolicy: current,
        proposedPolicy: proposed,
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
