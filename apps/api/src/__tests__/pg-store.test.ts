import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  AgentRuntime,
  createDefaultSkills,
  createDefaultTools,
} from "@anari/agent-runtime";
import { PgAgentTaskRepository } from "@anari/agent-persistence";
import { createAgentContext } from "../agent-context.js";
import { PgStore, DEMO_TENANT_ID } from "../pg-store.js";
import { REFERENCE_POLICY_ID } from "../policy-registry.js";
import { CHARGING_POLICY_ID, EQUIPMENT_POLICY_ID } from "./pack-ids.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADJUDICATOR = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";

const databaseUrl = process.env.DATABASE_URL;
const describePg = databaseUrl ? describe : describe.skip;

describePg("PgStore vertical slice", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const store = new PgStore(pool);

  afterAll(async () => {
    await pool.end();
  });

  async function acceptedWorkPackage() {
    const wp = await store.createWorkPackage({
      title: "Postgres cross-team order",
      objective: "Deliver a validated customer order",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "Order delivery",
        },
        {
          personId: MEMBER,
          responsibilityCode: "CONTRIBUTOR",
          expectedOutput: "Technical validation",
        },
      ],
      acceptanceCriteria: ["Customer accepts the delivery"],
    });
    await store.commitWorkPackage(wp.id, 1);
    await store.startWorkPackage(wp.id);
    await store.submitWorkPackage(wp.id);
    await store.acceptWorkPackage(wp.id, MEMBER);
    return wp.id;
  }

  async function confirmedClaim(workPackageId: string, personId: string) {
    const claim = await store.createClaim({
      workPackageId,
      claimantPersonId: personId,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: {
        dimensions: ["QUALITY"],
        summary: "Delivered the agreed scope",
      },
      evidenceRefs: ["pg-evidence-1"],
      rationale: "Delivered the agreed scope",
    });
    await store.submitClaim(claim.id);
    const decision = await store.createAttributionDecision({
      claimId: claim.id,
      adjudicatorPersonId: ADJUDICATOR,
      status: "CONFIRMED",
      acceptedFacts: ["Delivered"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "Evidence supports the claim",
    });
    return { claim, decision };
  }

  async function completeGate(policyVersionId = REFERENCE_POLICY_ID) {
    return store.recordLegalGate({
      policyVersionId,
      democraticProcedureRef: "pg-dp-1",
      employeeNoticeRef: "pg-notice-1",
      dataProtectionAssessmentRef: "pg-dpia-1",
      minimumWageChecked: true,
      policyApproved: true,
      recordedBy: ADJUDICATOR,
    });
  }

  it("runs a formal calculation through Postgres with ledger locking", async () => {
    const workPackageId = await acceptedWorkPackage();
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    await completeGate();

    const run = await store.createCalculationRun({
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "FORMAL",
      order: { id: "pg-order-1", grossProfit: "100000", currency: "CNY" },
      participants: [
        {
          personId: OWNER,
          workPackageId,
          attributionWeight: "0.6",
          role: "OWNER",
        },
        {
          personId: MEMBER,
          workPackageId,
          attributionWeight: "0.4",
          role: "CONTRIBUTOR",
        },
      ],
    });
    expect(run.status).toBe("CALCULATED");
    expect(run.lines).toHaveLength(2);

    await store.recordConfirmation({
      personId: OWNER,
      targetType: "CALCULATION",
      targetId: run.id,
      decision: "CONFIRMED",
    });
    await store.recordConfirmation({
      personId: MEMBER,
      targetType: "CALCULATION",
      targetId: run.id,
      decision: "CONFIRMED",
    });

    await store.approveRun(run.id);
    const locked = await store.lockRun(run.id, "LOCK_CALCULATION");
    expect(locked.status).toBe("LOCKED");

    const ledger = await store.listLedger();
    expect(ledger).toHaveLength(2);
    expect(ledger.every((entry) => entry.status === "LOCKED")).toBe(true);
    expect(await store.verifyLedger()).toBe(true);

    const batch = await store.createSettlementBatch({ cycleId: CYCLE });
    expect(batch.status).toBe("DRAFT");
    expect(batch.lineCount).toBe(2);
    expect(batch.totalAmount).toBe("5000");

    expect(
      (
        await store.commandSettlementBatch(batch.id, {
          command: "RECONCILE",
        })
      ).batch.status,
    ).toBe("RECONCILING");
    expect(
      (
        await store.commandSettlementBatch(batch.id, {
          command: "SUBMIT",
        })
      ).batch.status,
    ).toBe("PENDING_APPROVAL");
    expect(
      (
        await store.commandSettlementBatch(batch.id, {
          command: "APPROVE",
          actorPersonId: ADJUDICATOR,
        })
      ).batch.status,
    ).toBe("APPROVED");
    expect(
      (
        await store.commandSettlementBatch(batch.id, {
          command: "LOCK",
        })
      ).batch.status,
    ).toBe("LOCKED");
    const exported = await store.commandSettlementBatch(batch.id, {
      command: "EXPORT",
    });
    expect(exported.batch.status).toBe("EXPORTED");
    expect(exported.csv?.trim().split("\n")).toHaveLength(3);
    const acknowledged = await store.commandSettlementBatch(batch.id, {
      command: "ACKNOWLEDGE",
      externalReference: "pg-finance-1",
    });
    expect(acknowledged.batch.status).toBe("ACKNOWLEDGED");
    expect(acknowledged.batch.externalReference).toBe("pg-finance-1");

    const audit = await store.listAuditEvents(100);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.some((event) => event.action === "SETTLEMENT_CREATED")).toBe(
      true,
    );
    expect(
      audit.some((event) => event.action === "SETTLEMENT_ACKNOWLEDGE"),
    ).toBe(true);
    expect(audit.every((event) => event.eventHash.length > 0)).toBe(true);
    expect(await store.verifyAuditChain()).toBe(true);
  });

  it("blocks a formal run on an unresolved blocking data-quality issue", async () => {
    const workPackageId = await acceptedWorkPackage();
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    await completeGate();
    const issue = await store.createDataQualityIssue({
      objectType: "WORK_PACKAGE",
      objectId: workPackageId,
      issueCode: "MISSING_DELIVERY_RECORD",
      severity: "BLOCKING",
    });

    await expect(
      store.createCalculationRun({
        cycleId: CYCLE,
        policyVersionId: REFERENCE_POLICY_ID,
        mode: "FORMAL",
        order: { id: "pg-dq-order", grossProfit: "10000", currency: "CNY" },
        participants: [
          {
            personId: OWNER,
            workPackageId,
            attributionWeight: "1",
            role: "OWNER",
          },
        ],
      }),
    ).rejects.toMatchObject({
      blockers: expect.arrayContaining([
        `BLOCKING_DATA_QUALITY_ISSUE:${issue.id}`,
      ]),
    });

    await store.commandDataQualityIssue(issue.id, {
      command: "WAIVE",
      actorPersonId: ADJUDICATOR,
      reason: "Accepted by finance",
    });
    const allowed = await store.createCalculationRun({
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "FORMAL",
      order: { id: "pg-dq-order", grossProfit: "10000", currency: "CNY" },
      participants: [
        {
          personId: OWNER,
          workPackageId,
          attributionWeight: "1",
          role: "OWNER",
        },
      ],
    });
    expect(allowed.status).toBe("CALCULATED");
  });

  it("applies approved evaluation decisions to a formal calculation", async () => {
    const published = await store.publishPolicy({
      policy: {
        code: "PG_EVALUATED_CONTRIBUTION_V1",
        version: 1,
        currency: "CNY",
        poolRate: "0.05",
        poolCap: "100000",
        rounding: "HALF_UP",
        calculator: "SIMPLE_POOL",
        evaluation: {
          dimensionWeights: { QUALITY: "1" },
          floor: "0.5",
          ceiling: "1.5",
        },
      },
      effectiveFrom: "2026-12-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
    });
    await completeGate(published.policyVersionId);
    const rubric = await store.createRubric({
      code: "PG_EVALUATED_RUBRIC",
      name: "Evaluated rubric",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-10-01",
    });
    async function decision(personId: string, score: number) {
      const draft = await store.createEvaluationDraft({
        cycleId: CYCLE,
        personId,
        generatedByType: "USER",
        evidenceSnapshotHash: `pg-eval-${personId}`,
        draftPayload: {},
      });
      await store.submitEvaluationDraft(draft.id);
      const result = await store.decideEvaluationDraft(draft.id, {
        reviewerPersonId: ADJUDICATOR,
        rubricVersionId: rubric.id,
        decision: "APPROVE",
        scores: { QUALITY: score },
        rationale: "Reviewed",
      });
      return result.decision!.id;
    }
    const ownerDecision = await decision(OWNER, 5);
    const memberDecision = await decision(MEMBER, 0);

    const workPackageId = await acceptedWorkPackage();
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    const participants = [
      {
        personId: OWNER,
        workPackageId,
        attributionWeight: "0.6",
        role: "OWNER",
      },
      {
        personId: MEMBER,
        workPackageId,
        attributionWeight: "0.4",
        role: "CONTRIBUTOR",
      },
    ];
    await expect(
      store.createCalculationRun({
        cycleId: CYCLE,
        policyVersionId: published.policyVersionId,
        mode: "FORMAL",
        order: { id: "pg-eval-order", grossProfit: "100000", currency: "CNY" },
        participants,
      }),
    ).rejects.toMatchObject({
      blockers: expect.arrayContaining([
        `EVALUATION_DECISION_MISSING:${OWNER}`,
        `EVALUATION_DECISION_MISSING:${MEMBER}`,
      ]),
    });

    const run = await store.createCalculationRun({
      cycleId: CYCLE,
      policyVersionId: published.policyVersionId,
      mode: "FORMAL",
      order: { id: "pg-eval-order", grossProfit: "100000", currency: "CNY" },
      participants: [
        { ...participants[0]!, evaluationDecisionId: ownerDecision },
        { ...participants[1]!, evaluationDecisionId: memberDecision },
      ],
    });
    expect(run.status).toBe("CALCULATED");
    expect(
      run.inputSnapshot.participants.map(
        (participant) => participant.evaluationMultiplier,
      ),
    ).toEqual(["1.5", "0.5"]);
  });

  it("records human-reviewed evaluation decisions with versioning", async () => {
    const cycle = await store.createEvaluationCycle({
      name: "Postgres 2027 Q1",
      cycleType: "MONTHLY",
      startsAt: "2027-01-01T00:00:00Z",
      endsAt: "2027-01-31T23:59:59Z",
      timezone: "Asia/Shanghai",
    });
    expect(cycle.status).toBe("DRAFT");
    expect(
      (await store.listEvaluationCycles()).some(
        (candidate) => candidate.id === cycle.id,
      ),
    ).toBe(true);

    const rubric = await store.createRubric({
      code: "PG_PERFORMANCE_V1",
      name: "Postgres performance",
      dimensions: ["QUALITY", "SPEED"],
      scoringAnchors: { 1: "below", 3: "meets", 5: "exceeds" },
      effectiveFrom: "2026-10-01",
    });

    const draft = await store.createEvaluationDraft({
      cycleId: CYCLE,
      personId: MEMBER,
      generatedByType: "USER",
      evidenceSnapshotHash: "pg-eval-evidence-1",
      draftPayload: { summary: "First review" },
      strengths: ["Delivery"],
    });
    await store.submitEvaluationDraft(draft.id);
    const first = await store.decideEvaluationDraft(draft.id, {
      reviewerPersonId: ADJUDICATOR,
      rubricVersionId: rubric.id,
      decision: "APPROVE",
      scores: { QUALITY: 4, SPEED: 3 },
      rationale: "Evidence supports the rating",
    });
    expect(first.draft.status).toBe("APPROVED");
    const firstVersion = first.decision!.decisionVersion;
    expect(firstVersion).toBeGreaterThanOrEqual(1);

    const secondDraft = await store.createEvaluationDraft({
      cycleId: CYCLE,
      personId: MEMBER,
      generatedByType: "SYSTEM",
      evidenceSnapshotHash: "pg-eval-evidence-2",
      draftPayload: { summary: "Corrected review" },
    });
    await store.submitEvaluationDraft(secondDraft.id);
    const second = await store.decideEvaluationDraft(secondDraft.id, {
      reviewerPersonId: ADJUDICATOR,
      rubricVersionId: rubric.id,
      decision: "APPROVE",
      scores: { QUALITY: 5, SPEED: 4 },
      rationale: "Corrected evidence",
    });
    expect(second.decision?.decisionVersion).toBe(firstVersion + 1);
    expect(second.decision?.supersedesId).toBe(first.decision?.id);

    const decisions = await store.listEvaluationDecisions({
      personId: MEMBER,
    });
    expect(
      decisions.find((decision) => decision.id === first.decision?.id)?.status,
    ).toBe("SUPERSEDED");
    expect(
      decisions.find((decision) => decision.id === second.decision?.id)?.status,
    ).toBe("APPROVED");

    const selfDraft = await store.createEvaluationDraft({
      cycleId: CYCLE,
      personId: ADJUDICATOR,
      generatedByType: "USER",
      evidenceSnapshotHash: "pg-self",
      draftPayload: {},
    });
    await store.submitEvaluationDraft(selfDraft.id);
    await expect(
      store.decideEvaluationDraft(selfDraft.id, {
        reviewerPersonId: ADJUDICATOR,
        rubricVersionId: rubric.id,
        decision: "APPROVE",
        scores: { QUALITY: 5, SPEED: 5 },
        rationale: "Self",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("tracks data-quality issue lifecycle", async () => {
    const issue = await store.createDataQualityIssue({
      objectType: "WORK_PACKAGE",
      objectId: "00000000-0000-4000-8000-000000000010",
      issueCode: "EVIDENCE_MISSING",
      severity: "WARNING",
      details: { missing: ["DELIVERY_RECORD"] },
    });
    expect(issue.status).toBe("OPEN");

    expect(
      (
        await store.commandDataQualityIssue(issue.id, {
          command: "ASSIGN",
          assignedTo: ADJUDICATOR,
        })
      ).status,
    ).toBe("ASSIGNED");
    expect(
      (
        await store.commandDataQualityIssue(issue.id, {
          command: "START",
        })
      ).status,
    ).toBe("IN_PROGRESS");
    await expect(
      store.commandDataQualityIssue(issue.id, { command: "WAIVE" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const waived = await store.commandDataQualityIssue(issue.id, {
      command: "WAIVE",
      actorPersonId: ADJUDICATOR,
      reason: "Accepted risk",
    });
    expect(waived.status).toBe("WAIVED_WITH_APPROVAL");
    expect(waived.waiverReason).toBe("Accepted risk");
    expect(
      (
        await store.commandDataQualityIssue(issue.id, {
          command: "REOPEN",
        })
      ).status,
    ).toBe("REOPENED");
    expect(
      (await store.listDataQualityIssues({ status: "REOPENED" })).some(
        (candidate) => candidate.id === issue.id,
      ),
    ).toBe(true);
  });

  it("stores an evidence graph with provenance and links", async () => {
    const workPackageId = await acceptedWorkPackage();
    const first = await store.createEvidence({
      evidenceType: "DELIVERY_RECORD",
      subjectType: "WORK_PACKAGE",
      subjectId: workPackageId,
      sourceSystem: "CRM",
      normalizedPayload: { accepted: true },
      qualityStatus: "VALID",
      submittedBy: OWNER,
    });
    expect(first.submittedBy).toBe(OWNER);
    const second = await store.createEvidence({
      evidenceType: "CUSTOMER_FEEDBACK",
      subjectType: "WORK_PACKAGE",
      subjectId: workPackageId,
      sourceSystem: "SUPPORT",
      normalizedPayload: { score: 5 },
      qualityStatus: "VALID",
    });
    const linked = await store.linkEvidence(first.id, {
      toEvidenceId: second.id,
      relationType: "SUPPORTS",
      rationale: "Feedback confirms delivery",
    });
    expect(linked.relationType).toBe("SUPPORTS");

    const evidence = await store.listEvidence("WORK_PACKAGE", workPackageId);
    expect(evidence).toHaveLength(2);
    const links = await store.listEvidenceLinks(first.id);
    expect(links).toHaveLength(1);
  });

  it("ingests external events idempotently through PostgreSQL", async () => {
    const workPackageId = await acceptedWorkPackage();
    const batch = {
      sourceSystem: "crm",
      events: [
        {
          sourceRecordId: "pg-crm-order-1",
          sourceEventVersion: "1",
          eventType: "order.updated",
          subjectType: "WORK_PACKAGE",
          subjectId: workPackageId,
          evidenceType: "ORDER",
          payload: { amount: 1000 },
          qualityStatus: "VALID" as const,
        },
      ],
    };
    const first = await store.ingestEvents(batch);
    expect(first.accepted).toBe(1);
    expect(first.duplicates).toBe(0);

    const replay = await store.ingestEvents(batch);
    expect(replay.accepted).toBe(0);
    expect(replay.duplicates).toBe(1);

    const evidence = await store.listEvidence("WORK_PACKAGE", workPackageId);
    expect(evidence).toHaveLength(1);
  });

  it("calculates a charging project through PostgreSQL", async () => {
    const workPackageId = await acceptedWorkPackage();
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    await completeGate(CHARGING_POLICY_ID);

    const run = await store.createCalculationRun({
      cycleId: CYCLE,
      policyVersionId: CHARGING_POLICY_ID,
      mode: "SHADOW",
      order: {
        id: "pg-charging-001",
        grossProfit: "1000000",
        currency: "CNY",
        contractAmount: "2000000",
        cashCollected: "1500000",
        projectType: "DC_FAST_CHARGING_STATION",
        siteId: "site-pg-001",
        safetyIncidents: 0,
        acceptanceStatus: "ACCEPTED",
      },
      participants: [
        {
          personId: OWNER,
          workPackageId,
          attributionWeight: "0.6",
          role: "SALES_LEAD",
        },
        {
          personId: MEMBER,
          workPackageId,
          attributionWeight: "0.4",
          role: "DELIVERY_MANAGER",
        },
      ],
    });
    expect(run.status).toBe("CALCULATED");
    expect(run.lines.map((line) => line.roundedAmount)).toEqual([
      "20520",
      "13680",
    ]);
    expect(run.lines[0]!.trace.retentionHeld).toBe("1800");
  });

  it("calculates an equipment sale through PostgreSQL", async () => {
    const workPackageId = await acceptedWorkPackage();
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    await completeGate(EQUIPMENT_POLICY_ID);

    const run = await store.createCalculationRun({
      cycleId: CYCLE,
      policyVersionId: EQUIPMENT_POLICY_ID,
      mode: "SHADOW",
      order: {
        id: "pg-equipment-001",
        grossProfit: "600000",
        currency: "CNY",
        invoiceAmount: "3000000",
        cashCollected: "2400000",
        creditApproved: true,
        qualityHold: false,
        channelShare: "0",
      },
      participants: [
        {
          personId: OWNER,
          workPackageId,
          attributionWeight: "0.6",
          role: "SALES_LEAD",
        },
        {
          personId: MEMBER,
          workPackageId,
          attributionWeight: "0.4",
          role: "PRODUCT_MANAGER",
        },
      ],
    });
    expect(run.status).toBe("CALCULATED");
    expect(run.lines.map((line) => line.roundedAmount)).toEqual([
      "10999.8",
      "7333.2",
    ]);
    expect(run.lines[0]!.trace.afterSalesReserve).toBe("567");
  });

  it("blocks a formal run without a complete legal gate", async () => {
    const workPackageId = await acceptedWorkPackage();
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    await store.recordLegalGate({
      policyVersionId: REFERENCE_POLICY_ID,
      minimumWageChecked: true,
      policyApproved: true,
      recordedBy: ADJUDICATOR,
    });

    await expect(
      store.createCalculationRun({
        cycleId: CYCLE,
        policyVersionId: REFERENCE_POLICY_ID,
        mode: "FORMAL",
        order: { id: "pg-order-2", grossProfit: "10000", currency: "CNY" },
        participants: [
          {
            personId: OWNER,
            workPackageId,
            attributionWeight: "1",
            role: "OWNER",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "CALCULATION_BLOCKED",
      blockers: expect.arrayContaining([
        "DEMOCRATIC_PROCEDURE_MISSING",
        "EMPLOYEE_NOTICE_MISSING",
        "DATA_PROTECTION_ASSESSMENT_MISSING",
      ]),
    });
  });

  it("publishes a policy version and reads it back", async () => {
    const policy = {
      code: "GENERIC_CONTRIBUTION_V1",
      version: 42,
      currency: "CNY",
      poolRate: "0.07",
      poolCap: "100000",
      rounding: "HALF_UP" as const,
      calculator: "SIMPLE_POOL" as const,
    };
    const published = await store.publishPolicy({
      policy,
      effectiveFrom: "2026-11-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
    });
    expect(published.contentHash).toContain("sha256:");
    expect(published.approvedBy).toBe(ADJUDICATOR);

    const loaded = await store.getPolicy(published.policyVersionId);
    expect(loaded.code).toBe("GENERIC_CONTRIBUTION_V1");
    expect(loaded.version).toBe(42);

    const versions = await store.listPolicyVersions();
    expect(
      versions.some(
        (version) =>
          version.policyVersionId === published.policyVersionId &&
          version.code === "GENERIC_CONTRIBUTION_V1",
      ),
    ).toBe(true);

    await expect(
      store.publishPolicy({
        policy,
        effectiveFrom: "2026-12-01T00:00:00Z",
        approvedBy: ADJUDICATOR,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("persists and rehydrates agent tasks with audit", async () => {
    const repository = new PgAgentTaskRepository(pool, DEMO_TENANT_ID);
    const runtime = new AgentRuntime(
      createAgentContext(store),
      createDefaultTools(),
      createDefaultSkills(),
      { actor: "test", repository },
    );
    const task = await runtime.enqueue({
      tenantId: DEMO_TENANT_ID,
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "pg-agent-durable-1",
    });
    const ran = await runtime.run(task.id);
    expect(ran.status).not.toBe("QUEUED");

    const reloaded = new AgentRuntime(
      createAgentContext(store),
      createDefaultTools(),
      createDefaultSkills(),
      {
        actor: "test",
        repository: new PgAgentTaskRepository(pool, DEMO_TENANT_ID),
      },
    );
    const loaded = await reloaded.get(task.id);
    expect(loaded.id).toBe(task.id);
    expect(loaded.status).toBe(ran.status);
    expect(loaded.findings.length).toBe(ran.findings.length);
    expect((await reloaded.auditLog()).length).toBeGreaterThan(0);

    const replay = await reloaded.enqueue({
      tenantId: DEMO_TENANT_ID,
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "pg-agent-durable-1",
    });
    expect(replay.id).toBe(task.id);
  });

  it("scopes reads to the store's tenant", async () => {
    const other = new PgStore(
      pool,
      "00000000-0000-4000-8000-000000000099",
    );
    expect(await other.listWorkPackages()).toEqual([]);
    expect(await other.listClaims()).toEqual([]);
    expect(await other.listRuns()).toEqual([]);
  });

  it("applies RLS when the app role is not a superuser", async () => {
    const role = await pool.query(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    if (role.rows[0]?.rolsuper) return;
    const client = await pool.connect();
    try {
      const withoutContext = await client.query(
        "SELECT count(*)::int AS count FROM work_packages",
      );
      expect(withoutContext.rows[0].count).toBe(0);
    } finally {
      client.release();
    }
  });
});
