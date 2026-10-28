import { describe, expect, it } from "vitest";
import type {
  AttributionDecision,
  CalculationInput,
  CalculationRun,
  ContributionClaim,
  EmployeeConfirmation,
  EvidenceNode,
  LegalGateRecord,
  PolicyDefinition,
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
  gates = new Map<string, LegalGateRecord>();
  evidence: EvidenceNode[] = [];

  async listWorkPackages() { return this.workPackages; }
  async listClaims() { return this.claims; }
  async listDecisions(claimId?: string) {
    return this.decisions.filter((decision) => !claimId || decision.claimId === claimId);
  }
  async listRuns() { return this.runs; }
  async listConfirmations() { return this.confirmations; }
  async getLegalGate(policyVersionId: string) { return this.gates.get(policyVersionId); }
  async listEvidence(subjectType?: string, subjectId?: string) {
    return this.evidence.filter(
      (node) =>
        (!subjectType || node.subjectType === subjectType) &&
        (!subjectId || node.subjectId === subjectId),
    );
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
