import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  AgentRuntime,
  createDefaultSkills,
  createDefaultTools,
} from "@anari/agent-runtime";
import { PgAgentTaskRepository } from "@anari/agent-persistence";
import { createAgentContext } from "../agent-context.js";
import { PgPlatformStore } from "../platform-store.js";
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

  it("appends a locked ledger reversal and keeps the chain valid", async () => {
    const workPackageId = await acceptedWorkPackage();
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    await completeGate();
    const run = await store.createCalculationRun({
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "FORMAL",
      order: { id: "pg-reversal-order", grossProfit: "100000", currency: "CNY" },
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
    await store.lockRun(run.id, "LOCK_CALCULATION");

    const ownerEntry = (await store.listLedger()).find(
      (entry) =>
        entry.calculationRunId === run.id &&
        entry.personId === OWNER &&
        entry.entryType === "INCENTIVE",
    );
    expect(ownerEntry).toBeDefined();
    const reversal = await store.reverseLedgerEntry(ownerEntry!.id, {
      idempotencyKey: `pg-reversal-${run.id}`,
      reason: "Order corrected",
      approvedBy: ADJUDICATOR,
    });
    expect(reversal.entryType).toBe("REVERSAL");
    expect(reversal.status).toBe("LOCKED");
    expect(Number(reversal.amount)).toBe(-3000);
    const replay = await store.reverseLedgerEntry(ownerEntry!.id, {
      idempotencyKey: `pg-reversal-${run.id}`,
      reason: "Order corrected",
      approvedBy: ADJUDICATOR,
    });
    expect(replay.id).toBe(reversal.id);
    expect(await store.verifyLedger()).toBe(true);
    expect(
      (await store.listAuditEvents(100)).some(
        (event) => event.action === "LEDGER_REVERSAL",
      ),
    ).toBe(true);

    const settlement = await store.createSettlementBatch({ cycleId: CYCLE });
    expect(settlement.totalAmount).toBe("2000");
    expect(settlement.lineCount).toBe(3);
  });

  it("accepts work packages atomically in a PostgreSQL batch", async () => {
    async function submitted(title: string) {
      const wp = await store.createWorkPackage({
        title,
        objective: "Batch acceptance",
        ownerPersonId: OWNER,
        members: [
          {
            personId: OWNER,
            responsibilityCode: "OWNER",
            expectedOutput: "Delivery",
          },
          {
            personId: MEMBER,
            responsibilityCode: "CONTRIBUTOR",
            expectedOutput: "Support",
          },
        ],
        acceptanceCriteria: ["Accepted"],
      });
      await store.commitWorkPackage(wp.id, 1);
      await store.startWorkPackage(wp.id);
      await store.submitWorkPackage(wp.id);
      return wp.id;
    }
    const first = await submitted("PG batch accept 1");
    const second = await submitted("PG batch accept 2");
    const accepted = await store.acceptWorkPackagesBatch([
      { id: first, reviewerPersonId: MEMBER },
      { id: second, reviewerPersonId: MEMBER },
    ]);
    expect(accepted).toHaveLength(2);
    expect(accepted.every((wp) => wp.status === "ACCEPTED")).toBe(true);

    const third = await submitted("PG batch accept 3");
    const draft = await store.createWorkPackage({
      title: "PG draft",
      objective: "Not submitted",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "Draft",
        },
      ],
      acceptanceCriteria: ["Draft"],
    });
    await expect(
      store.acceptWorkPackagesBatch([
        { id: third, reviewerPersonId: MEMBER },
        { id: draft.id, reviewerPersonId: MEMBER },
      ]),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect((await store.getWorkPackage(third)).status).toBe("SUBMITTED");
  });

  it("stores and lists work-package commitment snapshots", async () => {
    const workPackageId = await acceptedWorkPackage();
    const versions = await store.listWorkPackageVersions(workPackageId);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.workPackageId).toBe(workPackageId);
    expect(versions[0]!.contentHash).toContain("sha256:");
  });

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

    const ledger = (await store.listLedger()).filter(
      (entry) => entry.calculationRunId === run.id,
    );
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
    expect(exported.csv).toContain("E001");
    expect(exported.csv).toContain("Sales Lead");
    const acknowledged = await store.commandSettlementBatch(batch.id, {
      command: "ACKNOWLEDGE",
      externalReference: "pg-finance-1",
    });
    expect(acknowledged.batch.status).toBe("ACKNOWLEDGED");
    expect(acknowledged.batch.externalReference).toBe("pg-finance-1");

    const adjusted = await store.commandSettlementBatch(batch.id, {
      command: "REQUIRE_ADJUSTMENT",
      actorPersonId: ADJUDICATOR,
      reason: "Post-export correction",
    });
    expect(adjusted.batch.status).toBe("ADJUSTMENT_REQUIRED");

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

  it("creates a PostgreSQL calculation batch atomically", async () => {
    const workPackageId = await acceptedWorkPackage();
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    await completeGate();
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
    const runInput = (orderId: string) => ({
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "FORMAL" as const,
      order: { id: orderId, grossProfit: "100000", currency: "CNY" },
      participants,
    });
    const runsBefore = (await store.listRuns()).length;
    const ledgerBefore = (await store.listLedger()).length;

    await expect(
      store.createCalculationRunsBatch([
        runInput("pg-batch-1"),
        {
          ...runInput("pg-batch-2"),
          participants: [
            {
              personId: ADJUDICATOR,
              workPackageId,
              attributionWeight: "1",
              role: "OWNER",
            },
          ],
        },
      ]),
    ).rejects.toMatchObject({ code: "CALCULATION_BLOCKED" });
    expect((await store.listRuns()).length).toBe(runsBefore);
    expect((await store.listLedger()).length).toBe(ledgerBefore);

    const runs = await store.createCalculationRunsBatch([
      runInput("pg-batch-1"),
      runInput("pg-batch-2"),
    ]);
    expect(runs).toHaveLength(2);
    expect((await store.listRuns()).length).toBe(runsBefore + 2);
    expect((await store.listLedger()).length).toBe(ledgerBefore + 4);
  });

  it("requires confirmation to lock a PostgreSQL recovery batch", async () => {
    const workPackageId = await acceptedWorkPackage();
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    await completeGate();
    const run = await store.createCalculationRun({
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "FORMAL",
      order: { id: "pg-recovery-order", grossProfit: "100000", currency: "CNY" },
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
    await store.lockRun(run.id, "LOCK_CALCULATION");
    const standard = await store.createSettlementBatch({ cycleId: CYCLE });
    expect(standard.kind).toBe("STANDARD");
    const ownerEntry = (await store.listLedger()).find(
      (entry) =>
        entry.calculationRunId === run.id &&
        entry.personId === OWNER &&
        entry.entryType === "INCENTIVE",
    );
    await store.reverseLedgerEntry(ownerEntry!.id, {
      idempotencyKey: `pg-recovery-reversal-${run.id}`,
      reason: "Clawback",
      approvedBy: ADJUDICATOR,
    });

    await expect(
      store.createSettlementBatch({ cycleId: CYCLE }),
    ).rejects.toMatchObject({ message: expect.stringContaining("NEGATIVE") });
    const recovery = await store.createSettlementBatch({
      cycleId: CYCLE,
      kind: "RECOVERY",
    });
    expect(recovery.kind).toBe("RECOVERY");
    expect(Number(recovery.totalAmount)).toBeLessThan(0);
    await store.commandSettlementBatch(recovery.id, { command: "RECONCILE" });
    await store.commandSettlementBatch(recovery.id, { command: "SUBMIT" });
    await store.commandSettlementBatch(recovery.id, {
      command: "APPROVE",
      actorPersonId: ADJUDICATOR,
    });
    await expect(
      store.commandSettlementBatch(recovery.id, { command: "LOCK" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await store.recordConfirmation({
      personId: OWNER,
      targetType: "SETTLEMENT",
      targetId: recovery.id,
      decision: "CONFIRMED",
    });
    const locked = await store.commandSettlementBatch(recovery.id, {
      command: "LOCK",
    });
    expect(locked.batch.status).toBe("LOCKED");
  });

  it("records PostgreSQL attribution decisions atomically in a batch", async () => {
    async function submittedClaim(workPackageId: string, personId: string) {
      const claim = await store.createClaim({
        workPackageId,
        claimantPersonId: personId,
        claimType: "DELIVERABLE_CONTRIBUTION",
        claimedContribution: { dimensions: ["QUALITY"], summary: "Done" },
        evidenceRefs: [],
        rationale: "Done",
      });
      await store.submitClaim(claim.id);
      return claim.id;
    }
    const decision = (claimId: string, adjudicatorPersonId: string) => ({
      claimId,
      adjudicatorPersonId,
      status: "CONFIRMED" as const,
      acceptedFacts: ["Done"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "Evidence supports the claim",
    });

    const workPackageId = await acceptedWorkPackage();
    const ownerClaim = await submittedClaim(workPackageId, OWNER);
    const memberClaim = await submittedClaim(workPackageId, MEMBER);
    const decisions = await store.createAttributionDecisionsBatch([
      decision(ownerClaim, ADJUDICATOR),
      decision(memberClaim, ADJUDICATOR),
    ]);
    expect(decisions).toHaveLength(2);
    expect((await store.getClaim(ownerClaim)).status).toBe("ACCEPTED");

    const secondPackage = await acceptedWorkPackage();
    const first = await submittedClaim(secondPackage, OWNER);
    const selfReviewed = await submittedClaim(secondPackage, MEMBER);
    await expect(
      store.createAttributionDecisionsBatch([
        decision(first, ADJUDICATOR),
        decision(selfReviewed, MEMBER),
      ]),
    ).rejects.toMatchObject({ code: "INVARIANT_VIOLATION" });
    expect((await store.getClaim(first)).status).toBe("SUBMITTED");
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
    const audit = await store.listAuditEvents(100);
    expect(
      audit.some((event) => event.action === "DATA_QUALITY_WAIVE"),
    ).toBe(true);
    expect(await store.verifyAuditChain()).toBe(true);
  });

  it("stores and reads in-app notifications per recipient", async () => {
    const notification = await store.createNotification({
      recipientPersonId: OWNER,
      audience: "PERSON",
      title: "Evidence needed",
      body: "Please upload the delivery record.",
      sourceType: "WORK_PACKAGE",
      sourceId: "00000000-0000-4000-8000-000000000010",
    });
    expect(notification.status).toBe("UNREAD");
    expect(
      (await store.listNotifications({ recipientPersonId: OWNER })).some(
        (candidate) => candidate.id === notification.id,
      ),
    ).toBe(true);
    expect(
      await store.listNotifications({ recipientPersonId: MEMBER }),
    ).toHaveLength(0);
    const read = await store.markNotificationRead(notification.id);
    expect(read.status).toBe("READ");
    expect(read.readAt).toBeDefined();
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

  it("onboards tenants, users, memberships, persons and identity", async () => {
    const platform = new PgPlatformStore(pool);
    const slug = `pg-tenant-${Date.now()}`;
    const tenant = await platform.createTenant({
      name: "PG design partner",
      slug,
      defaultTimezone: "Asia/Shanghai",
    });
    const user = await platform.createUser({
      authSubject: `pg-subject-${Date.now()}`,
      displayName: "PG Tenant Admin",
      email: "pg-admin@example.com",
    });
    const membership = await platform.addMembership({
      tenantId: tenant.id,
      userId: user.id,
      roleCodes: ["admin", "finance"],
    });
    expect(membership.roleCodes).toEqual(["admin", "finance"]);
    expect(
      (await platform.listTenants()).some((candidate) => candidate.id === tenant.id),
    ).toBe(true);
    const memberships = await platform.listMemberships(tenant.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.userDisplayName).toBe("PG Tenant Admin");
    await expect(
      platform.createTenant({ name: "Duplicate", slug }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const employeeCode = `E-PG-${Date.now()}`;
    const person = await platform.createPerson({
      tenantId: tenant.id,
      employeeCode,
      displayName: "PG Employee",
      userId: user.id,
    });
    expect(person.userId).toBe(user.id);
    const persons = await platform.listPersons(tenant.id);
    expect(persons.some((candidate) => candidate.id === person.id)).toBe(true);
    await expect(
      platform.createPerson({
        tenantId: tenant.id,
        employeeCode,
        displayName: "PG Duplicate",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const secondUser = await platform.createUser({
      authSubject: `pg-subject-2-${Date.now()}`,
      displayName: "PG Employee Login",
    });
    const linked = await platform.linkPersonUser({
      tenantId: tenant.id,
      personId: person.id,
      userId: secondUser.id,
    });
    expect(linked.userId).toBe(secondUser.id);
    await expect(
      platform.createPerson({
        tenantId: tenant.id,
        employeeCode: `${employeeCode}-2`,
        displayName: "PG Second Employee",
        userId: secondUser.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const unlinkedPerson = await platform.createPerson({
      tenantId: tenant.id,
      employeeCode: `${employeeCode}-3`,
      displayName: "PG Unlinked Employee",
    });
    await expect(
      platform.linkPersonUser({
        tenantId: tenant.id,
        personId: unlinkedPerson.id,
        userId: secondUser.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const identity = await platform.resolveIdentity({
      tenantId: tenant.id,
      userId: secondUser.id,
    });
    expect(identity.personId).toBe(person.id);
    expect(identity.roles).toEqual([]);
    const adminIdentity = await platform.resolveIdentity({
      tenantId: tenant.id,
      userId: user.id,
    });
    expect(adminIdentity.personId).toBeUndefined();
    expect(adminIdentity.roles).toEqual(["admin", "finance"]);

    const orgNode = await platform.createOrgNode({
      tenantId: tenant.id,
      name: "PG Sales",
      nodeType: "DEPARTMENT",
    });
    expect(orgNode.path).toBe("/PG Sales");
    const child = await platform.createOrgNode({
      tenantId: tenant.id,
      name: "PG Enterprise",
      nodeType: "TEAM",
      parentId: orgNode.id,
    });
    expect(child.path).toBe("/PG Sales/PG Enterprise");
    expect(await platform.listOrgNodes(tenant.id)).toHaveLength(2);

    const assignment = await platform.assignPersonOrg({
      tenantId: tenant.id,
      personId: person.id,
      orgNodeId: child.id,
      validFrom: "2026-01-01",
      allocation: "0.5",
    });
    expect(assignment.validFrom).toBe("2026-01-01");
    expect(assignment.allocation).toBe("0.5");
    const assignments = await platform.listOrgAssignments(
      tenant.id,
      person.id,
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.orgNodeId).toBe(child.id);

    const managed = await platform.setPersonManager({
      tenantId: tenant.id,
      personId: unlinkedPerson.id,
      managerPersonId: person.id,
    });
    expect(managed.managerPersonId).toBe(person.id);
    await expect(
      platform.setPersonManager({
        tenantId: tenant.id,
        personId: person.id,
        managerPersonId: unlinkedPerson.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      platform.setPersonManager({
        tenantId: tenant.id,
        personId: person.id,
        managerPersonId: person.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const cleared = await platform.setPersonManager({
      tenantId: tenant.id,
      personId: unlinkedPerson.id,
      managerPersonId: null,
    });
    expect(cleared.managerPersonId).toBeUndefined();

    const notice = await platform.createNotice({
      tenantId: tenant.id,
      noticeType: "POLICY",
      title: "PG incentive policy notice",
      bodyRef: "pg-notice-ref",
      effectiveFrom: "2026-01-01T00:00:00Z",
      acknowledgementRequired: true,
    });
    expect((await platform.listNotices(tenant.id)).some((n) => n.id === notice.id)).toBe(true);
    expect((await platform.getNotice(tenant.id, notice.id)).title).toBe(
      "PG incentive policy notice",
    );
    const before = await platform.listAcknowledgements(tenant.id, notice.id);
    expect(before.summary).toMatchObject({
      personCount: 2,
      acknowledgedCount: 0,
      declinedCount: 0,
      pendingCount: 2,
      complete: false,
    });
    await platform.recordAcknowledgement({
      tenantId: tenant.id,
      noticeId: notice.id,
      personId: person.id,
      decision: "ACKNOWLEDGE",
      signatureRef: "pg-signature",
    });
    await platform.recordAcknowledgement({
      tenantId: tenant.id,
      noticeId: notice.id,
      personId: unlinkedPerson.id,
      decision: "DECLINE",
      declineReason: "Metric not agreed",
    });
    const partial = await platform.listAcknowledgements(tenant.id, notice.id);
    expect(partial.summary).toMatchObject({
      acknowledgedCount: 1,
      declinedCount: 1,
      pendingCount: 0,
      complete: false,
    });
    await platform.recordAcknowledgement({
      tenantId: tenant.id,
      noticeId: notice.id,
      personId: unlinkedPerson.id,
      decision: "ACKNOWLEDGE",
    });
    const complete = await platform.listAcknowledgements(tenant.id, notice.id);
    expect(complete.summary).toMatchObject({
      acknowledgedCount: 2,
      declinedCount: 0,
      pendingCount: 0,
      complete: true,
    });
  });

  it("records employee representations and policy consultations", async () => {
    const platform = new PgPlatformStore(pool);
    const representation = await platform.createRepresentation({
      tenantId: DEMO_TENANT_ID,
      bodyName: `PG works council ${Date.now()}`,
      bodyType: "WORKS_COUNCIL",
      jurisdiction: "CN",
    });
    expect(
      (await platform.listRepresentations(DEMO_TENANT_ID)).some(
        (candidate) => candidate.id === representation.id,
      ),
    ).toBe(true);

    const consultation = await platform.createConsultation({
      tenantId: DEMO_TENANT_ID,
      policyVersionId: REFERENCE_POLICY_ID,
      representationId: representation.id,
      consultationType: "NEGOTIATION",
      startedAt: "2026-01-01T00:00:00Z",
      outcome: "PENDING",
    });
    expect(consultation.outcome).toBe("PENDING");
    expect(
      (
        await platform.listConsultations(
          DEMO_TENANT_ID,
          REFERENCE_POLICY_ID,
        )
      ).some((candidate) => candidate.id === consultation.id),
    ).toBe(true);

    const concluded = await platform.concludeConsultation({
      tenantId: DEMO_TENANT_ID,
      consultationId: consultation.id,
      endedAt: "2026-01-05T00:00:00Z",
      outcome: "AGREED",
      minutesRef: "pg-minutes",
      feedbackSummary: "Agreed after two sessions",
    });
    expect(concluded.outcome).toBe("AGREED");
    expect(concluded.minutesRef).toBe("pg-minutes");
    await expect(
      platform.concludeConsultation({
        tenantId: DEMO_TENANT_ID,
        consultationId: consultation.id,
        endedAt: "2026-01-06T00:00:00Z",
        outcome: "CLOSED",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("records and approves DPIA documents", async () => {
    const platform = new PgPlatformStore(pool);
    const dpia = await platform.createDpia({
      tenantId: DEMO_TENANT_ID,
      assessmentType: "DPIA",
      scope: "PG incentive and evidence processing",
      riskSummary: { automationBias: "human review required" },
    });
    expect(dpia.status).toBe("DRAFT");
    expect(
      (await platform.listDpias(DEMO_TENANT_ID)).some(
        (candidate) => candidate.id === dpia.id,
      ),
    ).toBe(true);
    const approved = await platform.approveDpia({
      tenantId: DEMO_TENANT_ID,
      dpiaId: dpia.id,
      approvedBy: ADJUDICATOR,
    });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).toBe(ADJUDICATOR);
    expect(approved.approvedAt).toBeTruthy();
    await expect(
      platform.approveDpia({
        tenantId: DEMO_TENANT_ID,
        dpiaId: dpia.id,
        approvedBy: ADJUDICATOR,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("records and resolves DSAR requests", async () => {
    const platform = new PgPlatformStore(pool);
    const dsar = await platform.createDsar({
      tenantId: DEMO_TENANT_ID,
      personId: OWNER,
      requestType: "ACCESS",
      dueAt: "2026-02-01T00:00:00Z",
    });
    expect(dsar.status).toBe("OPEN");
    expect(
      (await platform.listDsars(DEMO_TENANT_ID, OWNER)).some(
        (candidate) => candidate.id === dsar.id,
      ),
    ).toBe(true);
    const resolved = await platform.resolveDsar({
      tenantId: DEMO_TENANT_ID,
      dsarId: dsar.id,
      resolution: "RESOLVED",
      resolutionRef: `PG-DSAR-${Date.now()}`,
    });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolutionRef).toContain("PG-DSAR");
    await expect(
      platform.resolveDsar({
        tenantId: DEMO_TENANT_ID,
        dsarId: dsar.id,
        resolution: "REJECTED",
        resolutionRef: "PG-DSAR-again",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("records, approves and completes recalculation requests", async () => {
    const workPackageId = await acceptedWorkPackage();
    const { decision } = await confirmedClaim(workPackageId, OWNER);
    await completeGate();
    const run = await store.createCalculationRun({
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "FORMAL",
      order: {
        id: "pg-recalculation-order",
        grossProfit: "100000",
        currency: "CNY",
      },
      participants: [
        {
          personId: OWNER,
          workPackageId,
          attributionWeight: "1",
          role: "OWNER",
        },
      ],
    });

    const request = await store.createRecalculationRequest({
      targetType: "ATTRIBUTION",
      targetId: decision.id,
      reasonCode: "ATTRIBUTION_ERROR",
      explanation: "Recheck after the evidence correction",
      requestedBy: OWNER,
    });
    expect(request.status).toBe("OPEN");
    expect(
      (
        await store.listRecalculationRequests({ status: "OPEN" })
      ).some((candidate) => candidate.id === request.id),
    ).toBe(true);
    expect((await store.getRecalculationRequest(request.id)).targetId).toBe(
      decision.id,
    );

    const approved = await store.approveRecalculationRequest(
      request.id,
      ADJUDICATOR,
    );
    expect(approved.status).toBe("APPROVED");
    await expect(
      store.approveRecalculationRequest(request.id, ADJUDICATOR),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const completed = await store.completeRecalculationRequest(
      request.id,
      run.id,
    );
    expect(completed.status).toBe("COMPLETED");
    expect(completed.newCalculationRunId).toBe(run.id);

    const rejectedRequest = await store.createRecalculationRequest({
      targetType: "ATTRIBUTION",
      targetId: decision.id,
      reasonCode: "DUPLICATE",
      explanation: "Duplicate request should be rejected",
      requestedBy: OWNER,
    });
    const rejected = await store.rejectRecalculationRequest(
      rejectedRequest.id,
      ADJUDICATOR,
    );
    expect(rejected.status).toBe("REJECTED");
  });

  it("records applied migrations", async () => {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS count FROM schema_migrations",
    );
    expect(rows[0]?.count).toBeGreaterThanOrEqual(12);
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
