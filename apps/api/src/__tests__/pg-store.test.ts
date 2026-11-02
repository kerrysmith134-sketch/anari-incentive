import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  AgentRuntime,
  createDefaultSkills,
  createDefaultTools,
} from "@anari/agent-runtime";
import { PgAgentTaskRepository } from "@anari/agent-persistence";
import { createAgentContext } from "../agent-context.js";
import { createPlatformPool } from "../platform-pool.js";
import { PgPlatformStore } from "../platform-store.js";
import { calculatePayroll } from "../payroll.js";
import { PgStore, DEMO_TENANT_ID } from "../pg-store.js";
import { REFERENCE_POLICY_ID } from "../policy-registry.js";
import { CHARGING_POLICY_ID, EQUIPMENT_POLICY_ID } from "./pack-ids.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADJUDICATOR = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";

const TEST_APPLICABILITY = {
  legalEntity: "N-Perform Test Entity",
  jurisdictions: ["CN"],
  workLocations: ["Shanghai"],
  employeeCategories: ["FULL_TIME"],
  workTimeTypes: ["FULL_TIME"],
};

const databaseUrl = process.env.DATABASE_URL;
const describePg = databaseUrl ? describe : describe.skip;

describePg("PgStore vertical slice", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const platformPool = createPlatformPool(databaseUrl);
  const store = new PgStore(pool);

  afterAll(async () => {
    await pool.end();
    await platformPool.end();
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

    const platform = new PgPlatformStore(platformPool);
    const exportEvidence = await platform.createSettlementExport({
      tenantId: DEMO_TENANT_ID,
      batchId: batch.id,
      exportRef: `pg-export-${Date.now()}`,
      exportHash: "sha256:pg-settlement-export",
      exportedBy: ADJUDICATOR,
    });
    expect(exportEvidence.exportHash).toBe("sha256:pg-settlement-export");
    const exportAck = await platform.acknowledgeSettlementExport({
      tenantId: DEMO_TENANT_ID,
      exportId: exportEvidence.id,
      externalReference: "pg-export-receipt",
    });
    expect(exportAck.payloadHash).toBe("sha256:pg-settlement-export");
    await expect(
      platform.acknowledgeSettlementExport({
        tenantId: DEMO_TENANT_ID,
        exportId: exportEvidence.id,
        externalReference: "pg-export-receipt-2",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

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
      applicability: TEST_APPLICABILITY,
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
      dueAt: "2026-12-31T00:00:00Z",
    });
    expect(issue.status).toBe("OPEN");
    expect(issue.dueAt).toBe(
      new Date("2026-12-31T00:00:00Z").toISOString(),
    );

    expect(
      (
        await store.commandDataQualityIssue(issue.id, {
          command: "ASSIGN",
          assignedTo: ADJUDICATOR,
        })
      ).status,
    ).toBe("ASSIGNED");
    const escalated = await store.commandDataQualityIssue(issue.id, {
      command: "ESCALATE",
      reason: "SLA exceeded",
    });
    expect(escalated.status).toBe("ASSIGNED");
    expect(escalated.escalatedAt).toBeTruthy();
    expect(escalated.escalationReason).toBe("SLA exceeded");
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
      applicability: TEST_APPLICABILITY,
    });
    expect(published.contentHash).toContain("sha256:");
    expect(published.approvedBy).toBe(ADJUDICATOR);

    const loaded = await store.getPolicy(published.policyVersionId);
    expect(loaded.code).toBe("GENERIC_CONTRIBUTION_V1");
    expect(loaded.version).toBe(42);

    const superseded = await store.getPolicyVersion(REFERENCE_POLICY_ID);
    expect(superseded.effectiveTo).toBe(
      new Date("2026-11-01T00:00:00Z").toISOString(),
    );

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
        applicability: TEST_APPLICABILITY,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reads policy version details and closes windows on succession", async () => {
    const base = {
      code: "PG_POLICY_SUCCESSION",
      currency: "CNY",
      poolRate: "0.05",
      poolCap: "100000",
      rounding: "HALF_UP" as const,
      calculator: "SIMPLE_POOL" as const,
    };
    const first = await store.publishPolicy({
      policy: { ...base, version: 1 },
      effectiveFrom: "2027-01-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
      applicability: TEST_APPLICABILITY,
      scope: { region: "CN" },
    });
    const second = await store.publishPolicy({
      policy: { ...base, version: 2, poolRate: "0.07" },
      effectiveFrom: "2027-02-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
      applicability: TEST_APPLICABILITY,
    });

    const detail = await store.getPolicyVersion(first.policyVersionId);
    expect(detail.code).toBe("PG_POLICY_SUCCESSION");
    expect(detail.version).toBe(1);
    expect(detail.policy.poolRate).toBe("0.05");
    expect(detail.scope).toEqual({ region: "CN" });
    expect(detail.effectiveTo).toBe(
      new Date("2027-02-01T00:00:00Z").toISOString(),
    );

    const current = await store.getPolicyVersion(second.policyVersionId);
    expect(current.version).toBe(2);
    expect(current.effectiveTo).toBeUndefined();
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
      actorRole: "ACTOR",
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
    expect(loaded.actorRole).toBe("ACTOR");
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
    const platform = new PgPlatformStore(platformPool);
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
    const configured = await platform.updateTenantSettings({
      tenantId: tenant.id,
      settings: { requiredApprovals: ["SETTLEMENT_LOCK"] },
    });
    expect(configured.settings).toEqual({
      requiredApprovals: ["SETTLEMENT_LOCK"],
    });
    expect((await platform.getTenant(tenant.id)).settings).toEqual({
      requiredApprovals: ["SETTLEMENT_LOCK"],
    });
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
    const platform = new PgPlatformStore(platformPool);
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
    const platform = new PgPlatformStore(platformPool);
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
    const platform = new PgPlatformStore(platformPool);
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

  it("records retention policies and legal holds", async () => {
    const platform = new PgPlatformStore(platformPool);
    const dataCategory = `PG_EVIDENCE_${Date.now()}`;
    const policy = await platform.createRetentionPolicy({
      tenantId: DEMO_TENANT_ID,
      dataCategory,
      retentionMonths: 24,
      legalBasis: "Employment contract",
      legalHold: false,
    });
    expect(policy.legalHold).toBe(false);
    expect(
      (await platform.listRetentionPolicies(DEMO_TENANT_ID)).some(
        (candidate) => candidate.id === policy.id,
      ),
    ).toBe(true);
    await expect(
      platform.createRetentionPolicy({
        tenantId: DEMO_TENANT_ID,
        dataCategory,
        retentionMonths: 12,
        legalBasis: "Duplicate",
        legalHold: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const held = await platform.setRetentionLegalHold({
      tenantId: DEMO_TENANT_ID,
      retentionPolicyId: policy.id,
      legalHold: true,
    });
    expect(held.legalHold).toBe(true);
  });

  it("records approval requests with dual decisions", async () => {
    const platform = new PgPlatformStore(platformPool);
    const idempotencyKey = `pg-approval-${Date.now()}`;
    const request = await platform.createApprovalRequest({
      tenantId: DEMO_TENANT_ID,
      actionType: "LEDGER_LOCK",
      targetType: "LEDGER_ENTRY",
      targetId: "00000000-0000-4000-8000-0000000000ab",
      targetVersion: 1,
      requestedByType: "USER",
      requestedById: OWNER,
      riskTier: "T2",
      requiredApprovals: 2,
      payloadHash: "sha256:pg-approval-payload",
      idempotencyKey,
    });
    expect(request.status).toBe("PENDING");

    const replay = await platform.createApprovalRequest({
      tenantId: DEMO_TENANT_ID,
      actionType: "LEDGER_LOCK",
      targetType: "LEDGER_ENTRY",
      targetId: "00000000-0000-4000-8000-0000000000ab",
      targetVersion: 1,
      requestedByType: "USER",
      requestedById: OWNER,
      riskTier: "T2",
      requiredApprovals: 2,
      payloadHash: "sha256:pg-approval-payload",
      idempotencyKey,
    });
    expect(replay.id).toBe(request.id);

    await expect(
      platform.decideApprovalRequest({
        tenantId: DEMO_TENANT_ID,
        requestId: request.id,
        decision: "APPROVE",
        approverPersonId: OWNER,
        payloadHash: "sha256:pg-approval-payload",
        authContext: {},
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      platform.decideApprovalRequest({
        tenantId: DEMO_TENANT_ID,
        requestId: request.id,
        decision: "APPROVE",
        approverPersonId: ADJUDICATOR,
        payloadHash: "sha256:wrong",
        authContext: {},
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const first = await platform.decideApprovalRequest({
      tenantId: DEMO_TENANT_ID,
      requestId: request.id,
      decision: "APPROVE",
      approverPersonId: ADJUDICATOR,
      payloadHash: "sha256:pg-approval-payload",
      authContext: { role: "finance" },
    });
    expect(first.status).toBe("PENDING");
    expect(first.approvedCount).toBe(1);

    const second = await platform.decideApprovalRequest({
      tenantId: DEMO_TENANT_ID,
      requestId: request.id,
      decision: "APPROVE",
      approverPersonId: MEMBER,
      payloadHash: "sha256:pg-approval-payload",
      authContext: { role: "finance" },
    });
    expect(second.status).toBe("APPROVED");
    expect(second.approvedCount).toBe(2);
    expect(
      await platform.listApprovalDecisions(DEMO_TENANT_ID, request.id),
    ).toHaveLength(2);

    const consumed = await platform.consumeApprovalRequest({
      tenantId: DEMO_TENANT_ID,
      requestId: request.id,
      consumedBy: ADJUDICATOR,
    });
    expect(consumed.consumedAt).toBeTruthy();
    await expect(
      platform.consumeApprovalRequest({
        tenantId: DEMO_TENANT_ID,
        requestId: request.id,
        consumedBy: ADJUDICATOR,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("enforces budget pool approval, allocation limits and cash gates", async () => {
    const platform = new PgPlatformStore(platformPool);
    const tenant = await platform.createTenant({
      name: "PG budget tenant",
      slug: `pg-budget-${Date.now()}`,
    });
    const tenantStore = new PgStore(pool, tenant.id);
    const cycle = await tenantStore.createEvaluationCycle({
      name: "PG budget cycle",
      cycleType: "MONTHLY",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-01-31T23:59:59.000Z",
      timezone: "UTC",
    });
    const approver = await platform.createPerson({
      tenantId: tenant.id,
      employeeCode: "B-001",
      displayName: "Budget Approver",
    });
    const budgetPool = await platform.createBudgetPool({
      tenantId: tenant.id,
      cycleId: cycle.id,
      code: "CORE",
      name: "Core pool",
      poolType: "STANDARD",
      currency: "CNY",
      approvedAmount: "10000",
    });
    expect(budgetPool.status).toBe("DRAFT");
    await expect(
      platform.createBudgetAllocation({
        tenantId: tenant.id,
        poolId: budgetPool.id,
        targetType: "WORK_PACKAGE",
        targetId: "00000000-0000-4000-8000-000000000010",
        amount: "1000",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await platform.approveBudgetPool({
      tenantId: tenant.id,
      poolId: budgetPool.id,
      approvedBy: approver.id,
    });
    const allocation = await platform.createBudgetAllocation({
      tenantId: tenant.id,
      poolId: budgetPool.id,
      targetType: "WORK_PACKAGE",
      targetId: "00000000-0000-4000-8000-000000000010",
      amount: "6000",
    });
    expect(allocation.amount).toBe("6000");
    await expect(
      platform.createBudgetAllocation({
        tenantId: tenant.id,
        poolId: budgetPool.id,
        targetType: "WORK_PACKAGE",
        targetId: "00000000-0000-4000-8000-000000000011",
        amount: "5000",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const pooled = await platform.getBudgetPool(tenant.id, budgetPool.id);
    expect(pooled.committedAmount).toBe("6000");
    expect(pooled.allocations).toHaveLength(1);
    await platform.releaseBudgetAllocation({
      tenantId: tenant.id,
      allocationId: allocation.id,
    });
    expect(
      (await platform.getBudgetPool(tenant.id, budgetPool.id))
        .committedAmount,
    ).toBe("0");

    const gate = await platform.createCashGateInput({
      tenantId: tenant.id,
      cycleId: cycle.id,
      asOfDate: "2026-01-15",
      safetyReserveMonths: "3.5",
      thirteenWeekForecastRef: "pg-forecast",
      passesGate: true,
      approvedBy: approver.id,
    });
    expect(gate.passesGate).toBe(true);
    await expect(
      platform.createCashGateInput({
        tenantId: tenant.id,
        cycleId: cycle.id,
        asOfDate: "2026-01-15",
        safetyReserveMonths: "4",
        thirteenWeekForecastRef: "pg-forecast-2",
        passesGate: false,
        approvedBy: approver.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await platform.listCashGateInputs(tenant.id, cycle.id),
    ).toHaveLength(1);

    const fact = await platform.createFinancialFact({
      tenantId: tenant.id,
      sourceSystem: "ERP",
      sourceRecordId: "INV-1",
      factType: "INVOICE_AMOUNT",
      amount: "12000",
      currency: "CNY",
      qualityStatus: "UNVERIFIED",
      payload: { invoice: "INV-1" },
    });
    const factReplay = await platform.createFinancialFact({
      tenantId: tenant.id,
      sourceSystem: "ERP",
      sourceRecordId: "INV-1",
      factType: "INVOICE_AMOUNT",
      amount: "13000",
      currency: "CNY",
      qualityStatus: "VALID",
      payload: { invoice: "INV-1", corrected: true },
    });
    expect(factReplay.id).toBe(fact.id);
    expect(factReplay.amount).toBe("13000");
    expect(
      await platform.listFinancialFacts(tenant.id, {
        factType: "INVOICE_AMOUNT",
      }),
    ).toHaveLength(1);
  });

  it("records rule change orders, policy test cases and notice links", async () => {
    const platform = new PgPlatformStore(platformPool);
    const order = await platform.createRuleChangeOrder({
      tenantId: DEMO_TENANT_ID,
      policyCode: "GENERIC_CONTRIBUTION_V1",
      toPolicyVersionId: REFERENCE_POLICY_ID,
      changeType: "POOL_RATE",
      reason: "PG rule change approval",
      impactSimulation: { affectedPeople: 2 },
      effectiveFrom: "2026-11-01T00:00:00Z",
      requestedBy: OWNER,
    });
    expect(order.status).toBe("DRAFT");
    await expect(
      platform.approveRuleChangeOrder({
        tenantId: DEMO_TENANT_ID,
        orderId: order.id,
        approvedBy: OWNER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const approved = await platform.approveRuleChangeOrder({
      tenantId: DEMO_TENANT_ID,
      orderId: order.id,
      approvedBy: ADJUDICATOR,
    });
    expect(approved.status).toBe("APPROVED");
    const publicized = await platform.publicizeRuleChangeOrder({
      tenantId: DEMO_TENANT_ID,
      orderId: order.id,
    });
    expect(publicized.status).toBe("PUBLICIZED");

    const caseCode = `PG-CASE-${Date.now()}`;
    const testCase = await platform.createPolicyTestCase({
      tenantId: DEMO_TENANT_ID,
      policyVersionId: REFERENCE_POLICY_ID,
      caseCode,
      input: { grossProfit: "100000" },
      expectedOutput: { roundedAmount: "5000" },
      category: "NORMAL",
    });
    expect(testCase.status).toBe("ACTIVE");
    const loadedCase = await platform.getPolicyTestCase(
      DEMO_TENANT_ID,
      testCase.id,
    );
    expect(loadedCase.caseCode).toBe(caseCode);
    expect(loadedCase.expectedOutput).toEqual({ roundedAmount: "5000" });
    const recordedRun = await platform.recordPolicyTestCaseRun({
      tenantId: DEMO_TENANT_ID,
      testCaseId: testCase.id,
      passed: true,
      resultHash: "sha256:test-case-run",
    });
    expect(recordedRun.lastRunPassed).toBe(true);
    expect(recordedRun.lastRunAt).toBeTruthy();
    expect(recordedRun.lastRunResultHash).toBe("sha256:test-case-run");
    const testRun = await platform.recordPolicyTestRun({
      tenantId: DEMO_TENANT_ID,
      policyVersionId: REFERENCE_POLICY_ID,
      total: 1,
      passedCount: 1,
      failedCount: 0,
      retiredCount: 0,
      passed: true,
      resultsHash: "sha256:test-suite",
      results: [],
    });
    expect(testRun.passed).toBe(true);
    const testRuns = await platform.listPolicyTestRuns(
      DEMO_TENANT_ID,
      REFERENCE_POLICY_ID,
    );
    expect(
      testRuns.some((candidate) => candidate.id === testRun.id),
    ).toBe(true);
    await expect(
      platform.createPolicyTestCase({
        tenantId: DEMO_TENANT_ID,
        policyVersionId: REFERENCE_POLICY_ID,
        caseCode,
        input: {},
        expectedOutput: {},
        category: "BOUNDARY",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const retired = await platform.retirePolicyTestCase({
      tenantId: DEMO_TENANT_ID,
      testCaseId: testCase.id,
    });
    expect(retired.status).toBe("RETIRED");

    const notice = await platform.createNotice({
      tenantId: DEMO_TENANT_ID,
      noticeType: "POLICY",
      title: `PG policy notice ${Date.now()}`,
      bodyRef: "pg-policy-notice",
      effectiveFrom: "2026-11-01T00:00:00Z",
      acknowledgementRequired: false,
    });
    const link = await platform.createPolicyNotice({
      tenantId: DEMO_TENANT_ID,
      policyVersionId: REFERENCE_POLICY_ID,
      noticeId: notice.id,
      audience: { group: "all" },
    });
    expect(link.noticeId).toBe(notice.id);
    await expect(
      platform.createPolicyNotice({
        tenantId: DEMO_TENANT_ID,
        policyVersionId: REFERENCE_POLICY_ID,
        noticeId: notice.id,
        audience: {},
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await platform.listPolicyNotices(
          DEMO_TENANT_ID,
          REFERENCE_POLICY_ID,
        )
      ).some((candidate) => candidate.id === link.id),
    ).toBe(true);

    const metricCode = `PG_METRIC_${Date.now()}`;
    const metric = await platform.createMetricDefinition({
      tenantId: DEMO_TENANT_ID,
      code: metricCode,
      version: 1,
      name: "PG metric",
      dataType: "DECIMAL",
      sourceContract: { source: "ERP" },
      effectiveFrom: "2026-01-01",
    });
    expect(metric.active).toBe(true);
    await expect(
      platform.createMetricDefinition({
        tenantId: DEMO_TENANT_ID,
        code: metricCode,
        version: 1,
        name: "Duplicate",
        dataType: "DECIMAL",
        sourceContract: {},
        effectiveFrom: "2026-01-01",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const retiredMetric = await platform.retireMetricDefinition({
      tenantId: DEMO_TENANT_ID,
      metricId: metric.id,
    });
    expect(retiredMetric.active).toBe(false);
  });

  it("records deliverables and acceptance evidence", async () => {
    const platform = new PgPlatformStore(platformPool);
    const workPackageId = await acceptedWorkPackage();
    const deliverable = await platform.createDeliverable({
      tenantId: DEMO_TENANT_ID,
      workPackageId,
      title: "PG acceptance certificate",
      deliverableType: "DOCUMENT",
      ownerPersonId: OWNER,
    });
    expect(deliverable.status).toBe("DRAFT");
    await expect(
      platform.recordDeliverableAcceptance({
        tenantId: DEMO_TENANT_ID,
        deliverableId: deliverable.id,
        decision: "ACCEPT",
        reviewerPersonId: MEMBER,
        criteriaResults: {},
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const submitted = await platform.submitDeliverable({
      tenantId: DEMO_TENANT_ID,
      deliverableId: deliverable.id,
      artifactRef: "pg://acceptance-certificate",
    });
    expect(submitted.status).toBe("SUBMITTED");
    await expect(
      platform.recordDeliverableAcceptance({
        tenantId: DEMO_TENANT_ID,
        deliverableId: deliverable.id,
        decision: "ACCEPT",
        reviewerPersonId: OWNER,
        criteriaResults: {},
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const acceptance = await platform.recordDeliverableAcceptance({
      tenantId: DEMO_TENANT_ID,
      deliverableId: deliverable.id,
      decision: "ACCEPT",
      reviewerPersonId: MEMBER,
      criteriaResults: { complete: true },
      comments: "Accepted",
    });
    expect(acceptance.decision).toBe("ACCEPT");
    expect(
      await platform.listDeliverableAcceptances(
        DEMO_TENANT_ID,
        deliverable.id,
      ),
    ).toHaveLength(1);
  });

  it("records AI suggestions, model evaluations and workflow runs", async () => {
    const platform = new PgPlatformStore(platformPool);
    const runtime = new AgentRuntime(
      createAgentContext(store),
      createDefaultTools(),
      createDefaultSkills(),
      {
        requireApprovalAtOrAbove: "T3",
        actor: "api",
        repository: new PgAgentTaskRepository(pool, DEMO_TENANT_ID),
      },
    );
    const task = await runtime.enqueue({
      tenantId: DEMO_TENANT_ID,
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: `pg-ai-log-${Date.now()}`,
    });

    const suggestion = await platform.createAiSuggestion({
      tenantId: DEMO_TENANT_ID,
      agentTaskId: task.id,
      targetType: "EVALUATION_DRAFT",
      suggestionType: "EVIDENCE_SUMMARY",
      modelProvider: "anthropic",
      modelName: "claude",
      promptVersion: "v1",
      inputHash: "sha256:pg-input",
      outputJson: { summary: "PG gaps" },
      validationStatus: "VALID",
    });
    expect(suggestion.acceptedAt).toBeUndefined();
    const accepted = await platform.acceptAiSuggestion({
      tenantId: DEMO_TENANT_ID,
      suggestionId: suggestion.id,
      acceptedBy: ADJUDICATOR,
    });
    expect(accepted.acceptedAt).toBeTruthy();
    await expect(
      platform.acceptAiSuggestion({
        tenantId: DEMO_TENANT_ID,
        suggestionId: suggestion.id,
        acceptedBy: ADJUDICATOR,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const evaluation = await platform.createModelEvaluationRun({
      tenantId: DEMO_TENANT_ID,
      evaluationType: "IRR",
      modelProvider: "anthropic",
      modelName: "claude",
      promptVersion: "v1",
      datasetRef: "pg-gold-set",
      sampleSize: 50,
      metrics: { kappa: 0.8 },
      subgroupMetrics: {},
      passed: true,
      blockers: [],
    });
    expect(
      (
        await platform.listModelEvaluationRuns(DEMO_TENANT_ID, {
          passed: true,
        })
      ).some((candidate) => candidate.id === evaluation.id),
    ).toBe(true);
    expect(
      (await platform.getModelEvaluationRun(DEMO_TENANT_ID, evaluation.id))
        .sampleSize,
    ).toBe(50);

    const prompt = await platform.createModelPrompt({
      tenantId: DEMO_TENANT_ID,
      promptCode: "PG_EVIDENCE_SUMMARY",
      version: 1,
      purpose: "EVIDENCE_SUMMARY",
      modelProvider: "anthropic",
      modelName: "claude",
      template: "Summarize evidence without scoring.",
    });
    expect(prompt.status).toBe("DRAFT");
    expect(prompt.templateHash).toMatch(/^sha256:/);
    const activatedPrompt = await platform.activateModelPrompt({
      tenantId: DEMO_TENANT_ID,
      promptId: prompt.id,
      evaluationRunId: evaluation.id,
    });
    expect(activatedPrompt.status).toBe("ACTIVE");
    expect(activatedPrompt.evaluationRunId).toBe(evaluation.id);
    const linkedSuggestion = await platform.createAiSuggestion({
      tenantId: DEMO_TENANT_ID,
      agentTaskId: task.id,
      targetType: "CALCULATION_RUN",
      suggestionType: "EVIDENCE_SUMMARY",
      modelProvider: "anthropic",
      modelName: "claude",
      modelPromptId: prompt.id,
      promptVersion: "v1",
      inputHash: "pg-link-hash",
      outputJson: { summary: "Evidence summary" },
      validationStatus: "VALID",
    });
    expect(linkedSuggestion.modelPromptId).toBe(prompt.id);
    const scoreProposal = await platform.createAiScoreProposal({
      tenantId: DEMO_TENANT_ID,
      cycleId: CYCLE,
      personId: OWNER,
      evaluationRunId: evaluation.id,
      modelPromptId: prompt.id,
      modelProvider: "anthropic",
      modelName: "claude",
      promptVersion: "v1",
      dimensions: ["QUALITY"],
      scores: { QUALITY: 4.5 },
      overallScore: 4.5,
      confidence: 0.9,
      rationale: "Two valid evidence items",
      evidenceRefs: ["pg-score-e1"],
      evidenceSnapshotHash: "sha256:pg-score",
      gateMetrics: { kappa: 0.8 },
      riskTier: "HIGH",
      requestedBy: OWNER,
    });
    expect(scoreProposal.status).toBe("PENDING");
    expect(scoreProposal.secondReviewRequired).toBe(true);
    const decidedScore = await platform.decideAiScoreProposal({
      tenantId: DEMO_TENANT_ID,
      proposalId: scoreProposal.id,
      decision: "ACCEPT",
      decidedBy: ADJUDICATOR,
      note: "Reviewed",
      independentScores: { QUALITY: 4.5 },
      reviewStartedAt: new Date(Date.now() - 60_000).toISOString(),
      reviewDurationSeconds: 60,
      evidenceOpened: 1,
      override: false,
      blindReview: true,
      auditSample: false,
      secondReviewerPersonId: MEMBER,
      secondIndependentScores: { QUALITY: 4.5 },
      secondIndependentRationale: "Second reviewer agrees",
      secondReviewStartedAt: new Date(Date.now() - 30_000).toISOString(),
      secondEvidenceOpened: 1,
      secondReviewOutcome: "AGREE",
      secondReviewAgreementRate: 1,
    });
    expect(decidedScore.status).toBe("ACCEPTED");
    expect(decidedScore.auditSample).toBe(false);
    expect(decidedScore.secondReviewerPersonId).toBe(MEMBER);
    expect(decidedScore.secondReviewOutcome).toBe("AGREE");
    expect(
      (
        await platform.listAiScoreProposals(DEMO_TENANT_ID, {
          personId: OWNER,
          cycleId: CYCLE,
          status: "ACCEPTED",
        })
      ).map((candidate) => candidate.id),
    ).toContain(scoreProposal.id);
    expect(
      (
        await platform.listModelPrompts(DEMO_TENANT_ID, {
          promptCode: "PG_EVIDENCE_SUMMARY",
          status: "ACTIVE",
        })
      ).map((candidate) => candidate.id),
    ).toEqual([prompt.id]);
    const retiredPrompt = await platform.retireModelPrompt({
      tenantId: DEMO_TENANT_ID,
      promptId: prompt.id,
    });
    expect(retiredPrompt.status).toBe("RETIRED");

    const workflow = await platform.createWorkflowRun({
      tenantId: DEMO_TENANT_ID,
      agentTaskId: task.id,
      workflowName: "evidence-gap",
      workflowVersion: "v1",
      status: "RUNNING",
      currentStep: "COLLECT",
      state: { examined: 2 },
    });
    const finished = await platform.finishWorkflowRun({
      tenantId: DEMO_TENANT_ID,
      workflowRunId: workflow.id,
      status: "COMPLETED",
      currentStep: "VERIFY",
    });
    expect(finished.finishedAt).toBeTruthy();
    await expect(
      platform.finishWorkflowRun({
        tenantId: DEMO_TENANT_ID,
        workflowRunId: workflow.id,
        status: "COMPLETED",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await platform.listWorkflowRuns(DEMO_TENANT_ID, task.id)).some(
        (candidate) => candidate.id === workflow.id,
      ),
    ).toBe(true);
  });

  it("records integration connections, sync runs, identities and webhooks", async () => {
    const platform = new PgPlatformStore(platformPool);
    const connection = await platform.createIntegrationConnection({
      tenantId: DEMO_TENANT_ID,
      provider: "hubspot",
      connectionName: `PG CRM ${Date.now()}`,
      credentialRef: "vault://pg-crm",
      config: { region: "cn" },
    });
    expect(connection.status).toBe("ACTIVE");

    const mapping = await platform.createIntegrationMapping({
      tenantId: DEMO_TENANT_ID,
      connectionId: connection.id,
      name: "pg-orders",
      mappingType: "CSV",
      sourceSystem: "pg-crm",
      targetType: "EVIDENCE",
      fieldMap: { order_id: "sourceRecordId" },
      config: { pageSize: 50 },
      version: 1,
    });
    expect(mapping.status).toBe("ACTIVE");
    await expect(
      platform.createIntegrationMapping({
        tenantId: DEMO_TENANT_ID,
        connectionId: connection.id,
        name: "pg-orders",
        mappingType: "CSV",
        sourceSystem: "pg-crm",
        targetType: "EVIDENCE",
        fieldMap: { order_id: "sourceRecordId" },
        config: {},
        version: 2,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await platform.listIntegrationMappings(
          DEMO_TENANT_ID,
          connection.id,
        )
      ).map((candidate) => candidate.id),
    ).toEqual([mapping.id]);
    const retiredMapping = await platform.retireIntegrationMapping({
      tenantId: DEMO_TENANT_ID,
      mappingId: mapping.id,
    });
    expect(retiredMapping.status).toBe("RETIRED");

    const schedule = await platform.createSyncSchedule({
      tenantId: DEMO_TENANT_ID,
      connectionId: connection.id,
      name: "pg-hourly",
      intervalMinutes: 60,
      startAt: "2020-01-01T00:00:00Z",
    });
    expect(schedule.enabled).toBe(true);
    const claimed = await platform.claimDueSyncSchedules({
      tenantId: DEMO_TENANT_ID,
      limit: 10,
      now: "2026-01-01T00:00:00Z",
    });
    expect(claimed.map((candidate) => candidate.id)).toEqual([
      schedule.id,
    ]);
    await platform.setSyncScheduleEnabled({
      tenantId: DEMO_TENANT_ID,
      scheduleId: schedule.id,
      enabled: false,
    });
    expect(
      await platform.claimDueSyncSchedules({
        tenantId: DEMO_TENANT_ID,
        limit: 10,
        now: "2026-02-01T00:00:00Z",
      }),
    ).toHaveLength(0);

    const run = await platform.createSyncRun({
      tenantId: DEMO_TENANT_ID,
      connectionId: connection.id,
      status: "RUNNING",
    });
    const finished = await platform.finishSyncRun({
      tenantId: DEMO_TENANT_ID,
      syncRunId: run.id,
      status: "COMPLETED",
      recordsSeen: 10,
      recordsUpserted: 8,
      cursorAfter: { page: 2 },
    });
    expect(finished.recordsUpserted).toBe(8);
    expect(finished.finishedAt).toBeTruthy();
    await expect(
      platform.finishSyncRun({
        tenantId: DEMO_TENANT_ID,
        syncRunId: run.id,
        status: "COMPLETED",
        recordsSeen: 0,
        recordsUpserted: 0,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await platform.getIntegrationConnection(DEMO_TENANT_ID, connection.id))
        .lastSyncAt,
    ).toBeTruthy();

    const externalId = `pg-contact-${Date.now()}`;
    const identity = await platform.upsertExternalIdentity({
      tenantId: DEMO_TENANT_ID,
      sourceSystem: "hubspot",
      externalId,
      personId: OWNER,
      objectType: "PERSON",
    });
    expect(identity.personId).toBe(OWNER);
    const replay = await platform.upsertExternalIdentity({
      tenantId: DEMO_TENANT_ID,
      sourceSystem: "hubspot",
      externalId,
      objectType: "PERSON",
    });
    expect(replay.id).toBe(identity.id);

    const messageId = `pg-msg-${Date.now()}`;
    const webhook = await platform.receiveWebhook({
      tenantId: DEMO_TENANT_ID,
      sourceSystem: "hubspot",
      messageId,
      payloadHash: "sha256:pg-webhook",
    });
    expect(webhook.status).toBe("RECEIVED");
    const webhookReplay = await platform.receiveWebhook({
      tenantId: DEMO_TENANT_ID,
      sourceSystem: "hubspot",
      messageId,
      payloadHash: "sha256:pg-webhook",
    });
    expect(webhookReplay.id).toBe(webhook.id);
    const processed = await platform.processWebhook({
      tenantId: DEMO_TENANT_ID,
      webhookId: webhook.id,
      status: "PROCESSED",
    });
    expect(processed.processedAt).toBeTruthy();
    await expect(
      platform.processWebhook({
        tenantId: DEMO_TENANT_ID,
        webhookId: webhook.id,
        status: "FAILED",
        errorCode: "DUPLICATE",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const consumerName = `pg-worker-${Date.now()}`;
    const inboxMessage = await platform.receiveInboxMessage({
      tenantId: DEMO_TENANT_ID,
      consumerName,
      messageId: "inbox-1",
    });
    const inboxReplay = await platform.receiveInboxMessage({
      tenantId: DEMO_TENANT_ID,
      consumerName,
      messageId: "inbox-1",
    });
    expect(inboxReplay.id).toBe(inboxMessage.id);
    const processedInbox = await platform.processInboxMessage({
      tenantId: DEMO_TENANT_ID,
      inboxMessageId: inboxMessage.id,
      status: "PROCESSED",
    });
    expect(processedInbox.processedAt).toBeTruthy();
    await expect(
      platform.processInboxMessage({
        tenantId: DEMO_TENANT_ID,
        inboxMessageId: inboxMessage.id,
        status: "FAILED",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await platform.listInboxMessages(DEMO_TENANT_ID, {
          consumerName,
        })
      ).length,
    ).toBe(1);
  });

  it("appends a linked ledger adjustment", async () => {
    const workPackageId = await acceptedWorkPackage();
    await confirmedClaim(workPackageId, OWNER);
    await confirmedClaim(workPackageId, MEMBER);
    await completeGate();
    const run = await store.createCalculationRun({
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "FORMAL",
      order: {
        id: "pg-adjustment-order",
        grossProfit: "100000",
        currency: "CNY",
      },
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

    const original = (await store.listLedger()).find(
      (entry) =>
        entry.personId === OWNER && entry.entryType === "INCENTIVE",
    );
    expect(original).toBeTruthy();
    const idempotencyKey = `pg-adjustment-${original!.id}`;
    const adjusted = await store.adjustLedgerEntry(original!.id, {
      amount: "-1000",
      reasonCode: "EVIDENCE_CORRECTION",
      explanation: "Corrected after evidence review",
      approvedBy: ADJUDICATOR,
      idempotencyKey,
    });
    expect(adjusted.entry.entryType).toBe("ADJUSTMENT");
    expect(adjusted.entry.status).toBe("LOCKED");
    expect(adjusted.entry.sourceEntryId).toBe(original!.id);
    expect(adjusted.record.originalLedgerId).toBe(original!.id);
    const replay = await store.adjustLedgerEntry(original!.id, {
      amount: "-1000",
      reasonCode: "EVIDENCE_CORRECTION",
      explanation: "Corrected after evidence review",
      approvedBy: ADJUDICATOR,
      idempotencyKey,
    });
    expect(replay.entry.id).toBe(adjusted.entry.id);
    expect(
      (await store.listAdjustmentRecords()).some(
        (record) => record.adjustmentLedgerId === adjusted.entry.id,
      ),
    ).toBe(true);
  });

  it("scopes governance records by tenant", async () => {
    const platform = new PgPlatformStore(platformPool);
    const tenantA = await platform.createTenant({
      name: "Isolation A",
      slug: `isolation-a-${Date.now()}`,
    });
    const tenantB = await platform.createTenant({
      name: "Isolation B",
      slug: `isolation-b-${Date.now()}`,
    });
    const personA = await platform.createPerson({
      tenantId: tenantA.id,
      employeeCode: "ISO-A1",
      displayName: "Isolation Person A",
    });
    const noticeA = await platform.createNotice({
      tenantId: tenantA.id,
      noticeType: "POLICY",
      title: "Isolation notice",
      bodyRef: "isolation-notice",
      effectiveFrom: "2026-01-01T00:00:00Z",
      acknowledgementRequired: false,
    });
    const approvalA = await platform.createApprovalRequest({
      tenantId: tenantA.id,
      actionType: "SETTLEMENT_LOCK",
      targetType: "SETTLEMENT_BATCH",
      targetId: personA.id,
      targetVersion: 1,
      requestedByType: "USER",
      requestedById: personA.id,
      riskTier: "T2",
      requiredApprovals: 1,
      payloadHash: "sha256:isolation",
      idempotencyKey: `isolation-${Date.now()}`,
    });
    const connectionA = await platform.createIntegrationConnection({
      tenantId: tenantA.id,
      provider: "isolation",
      connectionName: "Isolation connection",
      credentialRef: "vault://isolation",
      config: {},
    });
    await platform.receiveWebhook({
      tenantId: tenantA.id,
      sourceSystem: "isolation",
      messageId: "isolation-message",
      payloadHash: "sha256:isolation-webhook",
    });
    await platform.receiveInboxMessage({
      tenantId: tenantA.id,
      consumerName: "isolation",
      messageId: "isolation-inbox",
    });
    await platform.upsertExternalIdentity({
      tenantId: tenantA.id,
      sourceSystem: "isolation",
      externalId: "isolation-external",
      personId: personA.id,
      objectType: "PERSON",
    });

    expect(
      (await platform.listNotices(tenantA.id)).some(
        (notice) => notice.id === noticeA.id,
      ),
    ).toBe(true);
    expect(await platform.listNotices(tenantB.id)).toEqual([]);
    await expect(
      platform.getNotice(tenantB.id, noticeA.id),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    expect(await platform.listApprovalRequests(tenantB.id)).toEqual([]);
    await expect(
      platform.getApprovalRequest(tenantB.id, approvalA.id),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    expect(await platform.listIntegrationConnections(tenantB.id)).toEqual(
      [],
    );
    await expect(
      platform.getIntegrationConnection(tenantB.id, connectionA.id),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    expect(await platform.listWebhooks(tenantB.id)).toEqual([]);
    expect(await platform.listInboxMessages(tenantB.id)).toEqual([]);
    expect(await platform.listExternalIdentities(tenantB.id)).toEqual([]);
  });

  it("records applied migrations", async () => {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS count FROM schema_migrations",
    );
    expect(rows[0]?.count).toBeGreaterThanOrEqual(12);
  });

  it("tracks equity vesting and exercises", async () => {
    const platform = new PgPlatformStore(platformPool);
    const grant = await platform.createEquityGrant({
      tenantId: DEMO_TENANT_ID,
      personId: OWNER,
      grantCode: `PG-EQ-${Date.now()}`,
      grantType: "OPTION",
      totalUnits: "10000",
      strikePrice: "1.5",
      currency: "CNY",
      grantDate: "2025-01-01T00:00:00Z",
      vestingStart: "2025-01-01T00:00:00Z",
      cliffMonths: 12,
      vestingMonths: 48,
    });
    const vesting = await platform.getEquityVesting(
      DEMO_TENANT_ID,
      grant.id,
      "2026-01-01T00:00:00Z",
    );
    expect(vesting.vestedUnits).toBe("2500");
    expect(vesting.availableUnits).toBe("2500");
    const exercise = await platform.createEquityExercise({
      tenantId: DEMO_TENANT_ID,
      grantId: grant.id,
      units: "1000",
      requestedBy: OWNER,
    });
    expect(exercise.totalCost).toBe("1500");
    await expect(
      platform.approveEquityExercise({
        tenantId: DEMO_TENANT_ID,
        exerciseId: exercise.id,
        approvedBy: OWNER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const approved = await platform.approveEquityExercise({
      tenantId: DEMO_TENANT_ID,
      exerciseId: exercise.id,
      approvedBy: ADJUDICATOR,
    });
    expect(approved.status).toBe("APPROVED");
    const settled = await platform.settleEquityExercise({
      tenantId: DEMO_TENANT_ID,
      exerciseId: exercise.id,
    });
    expect(settled.status).toBe("SETTLED");
    expect(
      (
        await platform.listEquityExercises(DEMO_TENANT_ID, grant.id)
      ).map((candidate) => candidate.id),
    ).toEqual([exercise.id]);
  });

  it("runs the bounty lifecycle", async () => {
    const platform = new PgPlatformStore(platformPool);
    const bounty = await platform.createBounty({
      tenantId: DEMO_TENANT_ID,
      title: "PG evidence cleanup",
      description: "Close missing evidence",
      rewardAmount: "5000",
      currency: "CNY",
      createdBy: ADJUDICATOR,
    });
    expect(bounty.status).toBe("OPEN");
    const claimed = await platform.claimBounty({
      tenantId: DEMO_TENANT_ID,
      bountyId: bounty.id,
      personId: OWNER,
    });
    expect(claimed.status).toBe("CLAIMED");
    const submitted = await platform.submitBounty({
      tenantId: DEMO_TENANT_ID,
      bountyId: bounty.id,
      personId: OWNER,
      submissionRef: "pg-evidence-pack",
    });
    expect(submitted.status).toBe("SUBMITTED");
    await expect(
      platform.acceptBounty({
        tenantId: DEMO_TENANT_ID,
        bountyId: bounty.id,
        reviewerPersonId: OWNER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const accepted = await platform.acceptBounty({
      tenantId: DEMO_TENANT_ID,
      bountyId: bounty.id,
      reviewerPersonId: ADJUDICATOR,
      paymentRef: "PG-PAY-1",
    });
    expect(accepted.status).toBe("ACCEPTED");
    expect(
      (
        await platform.listBounties(DEMO_TENANT_ID, "ACCEPTED")
      ).map((candidate) => candidate.id),
    ).toContain(bounty.id);
  });

  it("persists payroll runs and blocks sub-minimum lines", async () => {
    const platform = new PgPlatformStore(platformPool);
    await platform.createEmploymentContract({
      tenantId: DEMO_TENANT_ID,
      personId: OWNER,
      contractCode: `PG-CT-${Date.now()}`,
      employmentType: "FULL_TIME",
      startDate: "2025-01-01T00:00:00Z",
      workLocation: "Shanghai",
      currency: "CNY",
      fixedMonthlySalary: "8000",
      minimumMonthlyWage: "2690",
      taxRate: "0.1",
      socialInsuranceRate: "0.05",
      deductionCapRate: "0.2",
      variableShareCapRate: "1",
      deductionOrder: ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
      deductionTypeCaps: {},
      smoothingThresholdRate: "1",
      bankAccountRef: "PG-BANK-001",
      consentSignatureRef: "PG-ESIGN-001",
    });
    const run = await platform.createPayrollRun({
      tenantId: DEMO_TENANT_ID,
      cycleId: CYCLE,
      periodStart: "2026-10-01T00:00:00Z",
      periodEnd: "2026-10-31T23:59:59Z",
      currency: "CNY",
      preparedBy: ADJUDICATOR,
    });
    const contracts = await platform.listEmploymentContracts(
      DEMO_TENANT_ID,
    );
    const calculation = calculatePayroll({
      contracts,
      ledger: [],
      cycleId: CYCLE,
      currency: "CNY",
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
    });
    const calculated = await platform.savePayrollCalculation({
      tenantId: DEMO_TENANT_ID,
      runId: run.id,
      lines: calculation.lines,
      totalGross: calculation.totalGross,
      totalDeductions: calculation.totalDeductions,
      totalTax: calculation.totalTax,
      totalSocialInsurance: calculation.totalSocialInsurance,
      totalNet: calculation.totalNet,
      blockedCount: calculation.blockedCount,
    });
    expect(calculated.status).toBe("CALCULATED");
    expect(calculated.lines?.length).toBe(calculation.lines.length);
    expect(calculated.lines?.[0]?.variableShareCapRate).toBe("1");
    expect(calculated.lines?.[0]?.variableSharePassed).toBe(true);
    expect(calculated.lines?.[0]?.deductionBreakdown).toEqual([]);
    expect(calculated.lines?.[0]?.smoothingPassed).toBe(true);
    expect(calculated.lines?.[0]?.priorIncentiveAmount).toBe("0");
    const approved = await platform.approvePayrollRun({
      tenantId: DEMO_TENANT_ID,
      runId: run.id,
      approvedBy: OWNER,
    });
    expect(approved.status).toBe("APPROVED");
    const paid = await platform.payPayrollRun({
      tenantId: DEMO_TENANT_ID,
      runId: run.id,
    });
    expect(paid.status).toBe("PAID");
    const reversed = await platform.reversePayrollRun({
      tenantId: DEMO_TENANT_ID,
      runId: run.id,
      reason: "CORRECTION",
      reversedBy: OWNER,
    });
    expect(reversed.status).toBe("REVERSED");
    expect(reversed.reversalReason).toBe("CORRECTION");
  });

  it("persists contract consent and amendment history", async () => {
    const platform = new PgPlatformStore(platformPool);
    const contract = await platform.createEmploymentContract({
      tenantId: DEMO_TENANT_ID,
      personId: MEMBER,
      contractCode: `PG-CONSENT-${Date.now()}`,
      employmentType: "FULL_TIME",
      startDate: "2025-01-01T00:00:00Z",
      workLocation: "Shanghai",
      currency: "CNY",
      fixedMonthlySalary: "9000",
      minimumMonthlyWage: "2690",
      taxRate: "0.1",
      socialInsuranceRate: "0.05",
      deductionCapRate: "0.2",
      variableShareCapRate: "0.5",
      deductionOrder: ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
      deductionTypeCaps: {},
      smoothingThresholdRate: "1",
      consentSignatureRef: "PG-ESIGN-1",
    });
    expect(contract.payPlanVersion).toBe(1);
    expect(contract.consentSignatureRef).toBe("PG-ESIGN-1");
    const amended = await platform.amendEmploymentContract({
      tenantId: DEMO_TENANT_ID,
      contractId: contract.id,
      fixedMonthlySalary: "10000",
      minimumMonthlyWage: "2800",
      taxRate: "0.12",
      socialInsuranceRate: "0.06",
      deductionCapRate: "0.2",
      variableShareCapRate: "0.5",
      deductionOrder: ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
      deductionTypeCaps: {},
      smoothingThresholdRate: "1",
      effectiveFrom: "2026-01-01T00:00:00Z",
      consentSignatureRef: "PG-ESIGN-2",
      approvedBy: ADJUDICATOR,
    });
    expect(amended.fixedMonthlySalary).toBe("10000");
    expect(amended.payPlanVersion).toBe(2);
    const history = await platform.listEmploymentContractAmendments(
      DEMO_TENANT_ID,
      contract.id,
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.consentSignatureRef).toBe("PG-ESIGN-2");
  });

  it("persists a human adverse-action lifecycle", async () => {
    const platform = new PgPlatformStore(platformPool);
    const action = await platform.createAdverseAction({
      tenantId: DEMO_TENANT_ID,
      personId: MEMBER,
      actionType: "PIP",
      reason: "Documented handover gaps",
      performanceBasis: "Two review cycles and coaching notes",
      evidenceRefs: [],
      requestedBy: ADJUDICATOR,
    });
    expect(action.status).toBe("DRAFT");
    const reviewed = await platform.reviewAdverseAction({
      tenantId: DEMO_TENANT_ID,
      actionId: action.id,
      legalReviewerId: OWNER,
      legalReviewRef: "PG-LEGAL-1",
      decision: "APPROVE",
    });
    expect(reviewed.status).toBe("LEGAL_REVIEW");
    const approved = await platform.approveAdverseAction({
      tenantId: DEMO_TENANT_ID,
      actionId: action.id,
      approvedBy: MEMBER,
    });
    expect(approved.status).toBe("APPROVED");
    const active = await platform.activateAdverseAction({
      tenantId: DEMO_TENANT_ID,
      actionId: action.id,
      effectiveFrom: "2026-10-01T00:00:00Z",
    });
    expect(active.status).toBe("ACTIVE");
    const completed = await platform.completeAdverseAction({
      tenantId: DEMO_TENANT_ID,
      actionId: action.id,
    });
    expect(completed.status).toBe("COMPLETED");
  });

  it("persists appeal evidence refs and SLA due dates", async () => {
    const dueAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const evidenceRef = "00000000-0000-4000-8000-0000000000ab";
    const appeal = await store.createAppeal({
      appellantPersonId: OWNER,
      targetType: "CALCULATION",
      targetId: "00000000-0000-4000-8000-0000000000ac",
      reasonCode: "SLA_TEST",
      statement: "The calculation omitted a delivery.",
      evidenceRefs: [evidenceRef],
      dueAt,
    });
    expect(appeal.dueAt).toBe(dueAt);
    expect(appeal.evidenceRefs).toEqual([evidenceRef]);
    const loaded = await store.getAppeal(appeal.id);
    expect(loaded.dueAt).toBe(dueAt);
    expect(loaded.evidenceRefs).toEqual([evidenceRef]);
    const platform = new PgPlatformStore(platformPool);
    const disclosure = await platform.createAppealEvidenceDisclosure({
      tenantId: DEMO_TENANT_ID,
      appealId: appeal.id,
      disclosedBy: ADJUDICATOR,
      method: "PORTAL",
      evidenceRefs: [evidenceRef],
      note: "Shared with the appellant",
    });
    expect(disclosure.evidenceRefs).toEqual([evidenceRef]);
    const disclosures = await platform.listAppealEvidenceDisclosures(
      DEMO_TENANT_ID,
      appeal.id,
    );
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]?.method).toBe("PORTAL");
  });

  it("persists data sources with owner, SLA and field classification", async () => {
    const platform = new PgPlatformStore(platformPool);
    const tenant = await platform.createTenant({
      name: "PG data governance",
      slug: `pg-data-${Date.now()}`,
    });
    const person = await platform.createPerson({
      tenantId: tenant.id,
      employeeCode: `E-DATA-${Date.now()}`,
      displayName: "Data Owner",
    });
    const source = await platform.createDataSource({
      tenantId: tenant.id,
      code: "CRM-PG",
      name: "CRM",
      category: "SALES",
      ownerPersonId: person.id,
      slaHours: 12,
      criticality: "HIGH",
      containsPersonalData: true,
      storageRegion: "cn-shanghai",
      crossBorderTransfers: false,
      processorRefs: ["crm-vendor"],
      fields: [
        {
          fieldName: "contact",
          classification: "PERSONAL",
          purpose: "Order contact",
          retentionMonths: 24,
        },
      ],
    });
    expect(source.ownerPersonId).toBe(person.id);
    expect(source.fields[0]!.classification).toBe("PERSONAL");
    await expect(
      platform.createDataSource({
        tenantId: tenant.id,
        code: "CRM-PG",
        name: "Duplicate",
        category: "SALES",
        ownerPersonId: person.id,
        slaHours: 12,
        criticality: "LOW",
        containsPersonalData: false,
        storageRegion: "cn-shanghai",
        crossBorderTransfers: false,
        processorRefs: [],
        fields: [
          {
            fieldName: "id",
            classification: "INTERNAL",
            purpose: "Identity",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const listed = await platform.listDataSources(tenant.id);
    expect(listed.map((row) => row.code)).toEqual(["CRM-PG"]);
    const retired = await platform.retireDataSource({
      tenantId: tenant.id,
      dataSourceId: source.id,
    });
    expect(retired.status).toBe("RETIRED");
    expect(retired.version).toBe(2);
  });

  it("persists claim exception provenance", async () => {
    const workPackageId = await acceptedWorkPackage();
    const claim = await store.createClaim({
      workPackageId,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimMode: "EXCEPTION",
      exceptionReason: "Evidence system outage",
      claimedContribution: {
        dimensions: ["QUALITY"],
        summary: "Late evidence",
      },
      evidenceRefs: [],
      rationale: "Evidence arrived outside the normal window",
    });
    expect(claim.claimMode).toBe("EXCEPTION");
    expect(claim.exceptionReason).toBe("Evidence system outage");
    const loaded = await store.getClaim(claim.id);
    expect(loaded.claimMode).toBe("EXCEPTION");
    expect(loaded.exceptionReason).toBe("Evidence system outage");
  });

  it("persists and revokes conflict declarations", async () => {
    const platform = new PgPlatformStore(platformPool);
    const declaration = await platform.createConflictDeclaration({
      tenantId: DEMO_TENANT_ID,
      personId: ADJUDICATOR,
      relatedPersonId: MEMBER,
      relationshipType: "FAMILY",
      description: "Close family relationship",
    });
    expect(declaration.status).toBe("ACTIVE");
    const found = await platform.findConflictDeclaration(
      DEMO_TENANT_ID,
      MEMBER,
      ADJUDICATOR,
    );
    expect(found?.id).toBe(declaration.id);
    const listed = await platform.listConflictDeclarations(
      DEMO_TENANT_ID,
      ADJUDICATOR,
    );
    expect(listed.map((row) => row.id)).toContain(declaration.id);
    const revoked = await platform.revokeConflictDeclaration({
      tenantId: DEMO_TENANT_ID,
      declarationId: declaration.id,
      reason: "Relationship ended",
    });
    expect(revoked.status).toBe("REVOKED");
    expect(
      await platform.findConflictDeclaration(
        DEMO_TENANT_ID,
        MEMBER,
        ADJUDICATOR,
      ),
    ).toBeUndefined();
  });

  it("persists anonymous trust-survey responses and aggregates them", async () => {
    const platform = new PgPlatformStore(platformPool);
    const survey = await platform.createTrustSurvey({
      tenantId: DEMO_TENANT_ID,
      code: `PG_TRUST_${Date.now()}`,
      period: "2026-Q4",
      title: "PG trust survey",
      questions: [
        {
          code: "FAIRNESS",
          prompt: "The process is fair.",
          dimension: "FAIRNESS",
        },
      ],
    });
    expect(survey.status).toBe("DRAFT");
    await platform.openTrustSurvey({
      tenantId: DEMO_TENANT_ID,
      surveyId: survey.id,
    });
    const response = await platform.submitTrustSurveyResponse({
      tenantId: DEMO_TENANT_ID,
      surveyId: survey.id,
      personId: MEMBER,
      scores: { FAIRNESS: 5 },
    });
    expect(response.respondentHash).toMatch(/^sha256:/);
    await expect(
      platform.submitTrustSurveyResponse({
        tenantId: DEMO_TENANT_ID,
        surveyId: survey.id,
        personId: MEMBER,
        scores: { FAIRNESS: 3 },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const report = await platform.getTrustSurveyReport(
      DEMO_TENANT_ID,
      survey.id,
    );
    expect(report.responseCount).toBe(1);
    expect(report.dimensions.FAIRNESS).toBe(5);
    const closed = await platform.closeTrustSurvey({
      tenantId: DEMO_TENANT_ID,
      surveyId: survey.id,
    });
    expect(closed.status).toBe("CLOSED");
  });

  it("persists fairness commitments and supersedes the prior version", async () => {
    const platform = new PgPlatformStore(platformPool);
    const first = await platform.createFairnessCommitment({
      tenantId: DEMO_TENANT_ID,
      statement: "No retaliation for good-faith concerns.",
      ownerPersonId: OWNER,
      channels: ["INTRANET"],
    });
    expect(first.version).toBe(1);
    const second = await platform.createFairnessCommitment({
      tenantId: DEMO_TENANT_ID,
      statement: "Concerns can also be raised anonymously.",
      ownerPersonId: MEMBER,
      channels: ["INTRANET"],
    });
    expect(second.version).toBe(2);
    const list = await platform.listFairnessCommitments(DEMO_TENANT_ID);
    expect(list.map((commitment) => commitment.version)).toEqual([2, 1]);
    expect(list[1]?.status).toBe("SUPERSEDED");
    expect(
      (await platform.getActiveFairnessCommitment(DEMO_TENANT_ID))?.version,
    ).toBe(2);
  });

  it("persists contribution attestations and withdrawal", async () => {
    const workPackageId = await acceptedWorkPackage();
    const attestation = await store.createContributionAttestation({
      workPackageId,
      subjectPersonId: OWNER,
      attesterPersonId: MEMBER,
      attestationType: "PEER",
      statement: "Delivered the integration work.",
      evidenceRefs: [],
    });
    expect(attestation.status).toBe("SUBMITTED");
    const listed = await store.listContributionAttestations({
      workPackageId,
      subjectPersonId: OWNER,
    });
    expect(listed.map((row) => row.id)).toContain(attestation.id);
    await expect(
      store.withdrawContributionAttestation(attestation.id, OWNER),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const withdrawn = await store.withdrawContributionAttestation(
      attestation.id,
      MEMBER,
    );
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(withdrawn.withdrawnAt).toBeTruthy();
  });

  it("persists manager training and calibration records", async () => {
    const platform = new PgPlatformStore(platformPool);
    const training = await platform.createManagerTrainingRecord({
      tenantId: DEMO_TENANT_ID,
      personId: OWNER,
      trainingCode: "PG_FAIRNESS",
      title: "Fairness training",
      completedAt: "2026-09-01T00:00:00Z",
      evidenceRef: "pg-training-cert",
    });
    expect(training.evidenceRef).toBe("pg-training-cert");
    const calibration = await platform.createCalibrationSession({
      tenantId: DEMO_TENANT_ID,
      code: `PG-CAL-${Date.now()}`,
      title: "PG calibration",
      heldAt: "2026-09-15T00:00:00Z",
      facilitatorPersonId: ADJUDICATOR,
      attendeePersonIds: [OWNER, MEMBER],
      notes: "Anchor alignment",
    });
    expect(calibration.attendeePersonIds).toHaveLength(2);
    expect(
      (await platform.listManagerTrainingRecords(DEMO_TENANT_ID)).map(
        (row) => row.id,
      ),
    ).toContain(training.id);
    expect(
      (await platform.listCalibrationSessions(DEMO_TENANT_ID)).map(
        (row) => row.id,
      ),
    ).toContain(calibration.id);
  });

  it("persists voluntary pilot enrollment and withdrawal", async () => {
    const platform = new PgPlatformStore(platformPool);
    const enrollment = await platform.createPilotEnrollment({
      tenantId: DEMO_TENANT_ID,
      personId: OWNER,
      pilotCode: "PG-PILOT",
      scope: "PG pilot cohort",
      consentSignatureRef: "PG-PILOT-ESIGN",
    });
    expect(enrollment.status).toBe("ACTIVE");
    await expect(
      platform.createPilotEnrollment({
        tenantId: DEMO_TENANT_ID,
        personId: OWNER,
        pilotCode: "PG-PILOT",
        scope: "PG pilot cohort",
        consentSignatureRef: "PG-PILOT-ESIGN",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const withdrawn = await platform.withdrawPilotEnrollment({
      tenantId: DEMO_TENANT_ID,
      enrollmentId: enrollment.id,
      reason: "Voluntary withdrawal",
    });
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(withdrawn.withdrawalReason).toBe("Voluntary withdrawal");
    expect(
      (await platform.listPilotEnrollments(DEMO_TENANT_ID)).map(
        (row) => row.id,
      ),
    ).toContain(enrollment.id);
  });

  it("persists time-bound break-glass grants", async () => {
    const platform = new PgPlatformStore(platformPool);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const grant = await platform.createBreakGlassGrant({
      tenantId: DEMO_TENANT_ID,
      scope: "PAYROLL_BANK_ACCOUNT",
      granteePersonId: MEMBER,
      reason: "Payroll reconciliation incident",
      grantedBy: OWNER,
      expiresAt,
    });
    expect(grant.status).toBe("ACTIVE");
    expect(
      (
        await platform.findActiveBreakGlassGrant(
          DEMO_TENANT_ID,
          MEMBER,
          "PAYROLL_BANK_ACCOUNT",
        )
      )?.id,
    ).toBe(grant.id);
    await expect(
      platform.createBreakGlassGrant({
        tenantId: DEMO_TENANT_ID,
        scope: "PAYROLL_BANK_ACCOUNT",
        granteePersonId: OWNER,
        reason: "Self grant",
        grantedBy: OWNER,
        expiresAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const revoked = await platform.revokeBreakGlassGrant({
      tenantId: DEMO_TENANT_ID,
      grantId: grant.id,
    });
    expect(revoked.status).toBe("REVOKED");
    expect(
      await platform.findActiveBreakGlassGrant(
        DEMO_TENANT_ID,
        MEMBER,
        "PAYROLL_BANK_ACCOUNT",
      ),
    ).toBeUndefined();
  });

  it("persists clawback terms, approval and waiver", async () => {
    const platform = new PgPlatformStore(platformPool);
    const clawback = await platform.createClawbackCase({
      tenantId: DEMO_TENANT_ID,
      personId: MEMBER,
      amount: "500",
      currency: "CNY",
      reasonCode: "OVERPAYMENT",
      explanation: "Duplicate incentive",
      consentSignatureRef: "PG-CLAWBACK-ESIGN",
      installmentMonths: 3,
      hardshipWaiver: false,
      requestedBy: OWNER,
    });
    expect(clawback.status).toBe("DRAFT");
    await expect(
      platform.approveClawbackCase({
        tenantId: DEMO_TENANT_ID,
        caseId: clawback.id,
        approvedBy: OWNER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const approved = await platform.approveClawbackCase({
      tenantId: DEMO_TENANT_ID,
      caseId: clawback.id,
      approvedBy: ADJUDICATOR,
    });
    expect(approved.status).toBe("APPROVED");
    const waived = await platform.closeClawbackCase({
      tenantId: DEMO_TENANT_ID,
      caseId: clawback.id,
      action: "WAIVE",
      reason: "Documented hardship",
      actorPersonId: ADJUDICATOR,
    });
    expect(waived.status).toBe("WAIVED");
    expect(waived.waiverReason).toBe("Documented hardship");
    expect(
      (await platform.listClawbackCases(DEMO_TENANT_ID)).map(
        (row) => row.id,
      ),
    ).toContain(clawback.id);
  });

  it("persists discretionary pool reviews with an independent observer", async () => {
    const platform = new PgPlatformStore(platformPool);
    const pool = await platform.createBudgetPool({
      tenantId: DEMO_TENANT_ID,
      cycleId: CYCLE,
      code: `PG-DISC-${Date.now()}`,
      name: "PG discretionary pool",
      poolType: "DISCRETIONARY",
      currency: "CNY",
      approvedAmount: "10000",
    });
    const review = await platform.createDiscretionaryPoolReview({
      tenantId: DEMO_TENANT_ID,
      poolId: pool.id,
      committeePersonIds: [OWNER, MEMBER],
      employeeObserverPersonId: ADJUDICATOR,
      selectionCriteria: "Documented exceptional contribution",
      decisionNotes: "Committee reviewed the slate.",
      reviewedBy: ADJUDICATOR,
    });
    expect(review.employeeObserverPersonId).toBe(ADJUDICATOR);
    const listed = await platform.listDiscretionaryPoolReviews(
      DEMO_TENANT_ID,
      pool.id,
    );
    expect(listed.map((row) => row.id)).toContain(review.id);
  });

  it("persists model-provider zero-retention and egress policies", async () => {
    const platform = new PgPlatformStore(platformPool);
    const policy = await platform.createModelProviderPolicy({
      tenantId: DEMO_TENANT_ID,
      provider: "anthropic",
      zeroRetentionConfirmed: true,
      dpaRef: "PG-DPA-2026",
      inferenceRegion: "cn-shanghai",
      egressAllowlist: ["api.anthropic.com"],
      approvedBy: OWNER,
    });
    expect(policy.status).toBe("ACTIVE");
    expect(policy.egressAllowlist).toEqual(["api.anthropic.com"]);
    expect(
      (
        await platform.getActiveModelProviderPolicy(
          DEMO_TENANT_ID,
          "anthropic",
        )
      )?.dpaRef,
    ).toBe("PG-DPA-2026");
    const retired = await platform.retireModelProviderPolicy({
      tenantId: DEMO_TENANT_ID,
      policyId: policy.id,
    });
    expect(retired.status).toBe("RETIRED");
    expect(
      await platform.getActiveModelProviderPolicy(
        DEMO_TENANT_ID,
        "anthropic",
      ),
    ).toBeUndefined();
  });

  it("persists gold-set versions and retirement", async () => {
    const platform = new PgPlatformStore(platformPool);
    const dataset = await platform.createModelEvaluationDataset({
      tenantId: DEMO_TENANT_ID,
      code: `PG-GOLD-${Date.now()}`,
      version: 1,
      name: "PG gold set",
      sampleSize: 100,
      holdoutSize: 20,
      labelSource: "DOUBLE_ANNOTATION",
      ownerPersonId: OWNER,
    });
    expect(dataset.status).toBe("ACTIVE");
    await expect(
      platform.createModelEvaluationDataset({
        tenantId: DEMO_TENANT_ID,
        code: dataset.code,
        version: 1,
        name: "Duplicate",
        sampleSize: 100,
        holdoutSize: 20,
        labelSource: "DOUBLE_ANNOTATION",
        ownerPersonId: OWNER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await platform.getActiveModelEvaluationDataset(
          DEMO_TENANT_ID,
          dataset.code,
        )
      )?.id,
    ).toBe(dataset.id);
    const retired = await platform.retireModelEvaluationDataset({
      tenantId: DEMO_TENANT_ID,
      datasetId: dataset.id,
    });
    expect(retired.status).toBe("RETIRED");
  });

  it("schedules future contract amendments and cancels them before application", async () => {
    const platform = new PgPlatformStore(platformPool);
    const contract = await platform.createEmploymentContract({
      tenantId: DEMO_TENANT_ID,
      personId: OWNER,
      contractCode: `PG-FUTURE-${Date.now()}`,
      employmentType: "FULL_TIME",
      startDate: "2025-01-01T00:00:00Z",
      workLocation: "Shanghai",
      currency: "CNY",
      fixedMonthlySalary: "8000",
      minimumMonthlyWage: "2690",
      taxRate: "0.1",
      socialInsuranceRate: "0.05",
      deductionCapRate: "0.2",
      variableShareCapRate: "1",
      deductionOrder: ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
      deductionTypeCaps: {},
      smoothingThresholdRate: "1",
      consentSignatureRef: "PG-FUTURE-ESIGN-1",
    });
    const unchanged = await platform.amendEmploymentContract({
      tenantId: DEMO_TENANT_ID,
      contractId: contract.id,
      fixedMonthlySalary: "9000",
      minimumMonthlyWage: "2800",
      taxRate: "0.12",
      socialInsuranceRate: "0.06",
      deductionCapRate: "0.2",
      variableShareCapRate: "0.5",
      deductionOrder: ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
      deductionTypeCaps: {},
      smoothingThresholdRate: "1",
      effectiveFrom: "2027-01-01T00:00:00Z",
      consentSignatureRef: "PG-FUTURE-ESIGN-2",
      approvedBy: ADJUDICATOR,
    });
    expect(unchanged.fixedMonthlySalary).toBe("8000");
    const amendments = await platform.listEmploymentContractAmendments(
      DEMO_TENANT_ID,
      contract.id,
    );
    expect(amendments).toHaveLength(1);
    expect(amendments[0]?.status).toBe("SCHEDULED");
    const applied = await platform.applyDueContractAmendments(DEMO_TENANT_ID);
    expect(applied).toEqual([]);
    const cancelled = await platform.cancelContractAmendment({
      tenantId: DEMO_TENANT_ID,
      contractId: contract.id,
      amendmentId: amendments[0]!.id,
      reason: "Terms superseded",
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("Terms superseded");
  });

  it("persists model canary comparisons", async () => {
    const platform = new PgPlatformStore(platformPool);
    const baseline = await platform.createModelEvaluationRun({
      tenantId: DEMO_TENANT_ID,
      evaluationType: "IRR",
      modelProvider: "anthropic",
      modelName: "claude",
      promptVersion: "v1",
      datasetRef: `pg-canary-${Date.now()}`,
      sampleSize: 100,
      metrics: { harnessVersion: "ai-gate-v1" },
      subgroupMetrics: {},
      passed: true,
      blockers: [],
    });
    const candidate = await platform.createModelEvaluationRun({
      tenantId: DEMO_TENANT_ID,
      evaluationType: "IRR",
      modelProvider: "anthropic",
      modelName: "claude-new",
      promptVersion: "v2",
      datasetRef: baseline.datasetRef,
      sampleSize: 100,
      metrics: { harnessVersion: "ai-gate-v1" },
      subgroupMetrics: {},
      passed: true,
      blockers: [],
    });
    const canary = await platform.createModelCanaryRun({
      tenantId: DEMO_TENANT_ID,
      baselineEvaluationRunId: baseline.id,
      candidateEvaluationRunId: candidate.id,
      datasetRef: baseline.datasetRef,
      trafficPercent: 10,
      passed: true,
      blockers: [],
      metrics: {},
    });
    expect(canary.passed).toBe(true);
    expect(
      (await platform.listModelCanaryRuns(DEMO_TENANT_ID)).map(
        (row) => row.id,
      ),
    ).toContain(canary.id);
  });

  it("persists two-person audit redactions against a real event", async () => {
    const platform = new PgPlatformStore(platformPool);
    const workPackage = await store.createWorkPackage({
      title: "Redaction audit target",
      objective: "Generate an audit event",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "Package",
        },
      ],
      acceptanceCriteria: ["Accepted"],
    });
    expect(workPackage.id).toBeTruthy();
    const events = await store.listAuditEvents(20);
    const event = events[0];
    expect(event).toBeTruthy();
    const redaction = await platform.createAuditRedaction({
      tenantId: DEMO_TENANT_ID,
      auditEventId: event!.id,
      replacement: "[REDACTED]",
      reason: "Reason contained unrelated personal data",
      requestedBy: OWNER,
      approvedBy: MEMBER,
    });
    expect(redaction.auditEventId).toBe(event!.id);
    await expect(
      platform.createAuditRedaction({
        tenantId: DEMO_TENANT_ID,
        auditEventId: event!.id,
        replacement: "[REDACTED]",
        reason: "Duplicate",
        requestedBy: OWNER,
        approvedBy: MEMBER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await platform.listAuditRedactions(DEMO_TENANT_ID)).map(
        (row) => row.id,
      ),
    ).toContain(redaction.id);
  });

  it("persists red-team runs and finds passed evidence", async () => {
    const platform = new PgPlatformStore(platformPool);
    const run = await platform.createModelRedTeamRun({
      tenantId: DEMO_TENANT_ID,
      modelProvider: "anthropic",
      modelName: "claude",
      promptVersion: `pg-v-${Date.now()}`,
      scope: "Prompt injection and exfiltration",
      testsRun: 12,
      passed: true,
      findings: [],
      artifactRef: "pg-red-team-report",
      createdBy: OWNER,
    });
    expect(run.passed).toBe(true);
    expect(
      (
        await platform.findPassedModelRedTeamRun(
          DEMO_TENANT_ID,
          "anthropic",
          "claude",
          run.promptVersion,
        )
      )?.id,
    ).toBe(run.id);
    expect(
      (await platform.listModelRedTeamRuns(DEMO_TENANT_ID)).map(
        (row) => row.id,
      ),
    ).toContain(run.id);
    await expect(
      platform.createModelRedTeamRun({
        tenantId: DEMO_TENANT_ID,
        modelProvider: "anthropic",
        modelName: "claude",
        promptVersion: "pg-failed",
        scope: "Failure without findings",
        testsRun: 1,
        passed: false,
        findings: [],
        createdBy: OWNER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("persists role compensation templates", async () => {
    const platform = new PgPlatformStore(platformPool);
    const code = `PG-TEMPLATE-${Date.now()}`;
    const template = await platform.createCompensationTemplate({
      tenantId: DEMO_TENANT_ID,
      code,
      name: "PG sales template",
      roleCode: "SALES",
      employmentType: "FULL_TIME",
      currency: "CNY",
      fixedSalaryMin: "8000",
      fixedSalaryMax: "12000",
      deductionCapRate: "0.2",
      variableShareCapRate: "0.6",
      smoothingThresholdRate: "0.5",
      deductionOrder: ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
      deductionTypeCaps: { RECOVERY: "0.1" },
    });
    expect(template.fixedSalaryMax).toBe("12000");
    expect(
      (
        await platform.getActiveCompensationTemplate(
          DEMO_TENANT_ID,
          code,
        )
      )?.id,
    ).toBe(template.id);
    expect(
      (await platform.listCompensationTemplates(DEMO_TENANT_ID)).map(
        (row) => row.id,
      ),
    ).toContain(template.id);
    const retired = await platform.retireCompensationTemplate({
      tenantId: DEMO_TENANT_ID,
      templateId: template.id,
    });
    expect(retired.status).toBe("RETIRED");
  });

  it("persists e-sign envelopes and applies signed consent", async () => {
    const platform = new PgPlatformStore(platformPool);
    const contract = await platform.createEmploymentContract({
      tenantId: DEMO_TENANT_ID,
      personId: OWNER,
      contractCode: `PG-ESIGN-${Date.now()}`,
      employmentType: "FULL_TIME",
      startDate: "2025-01-01T00:00:00Z",
      workLocation: "Shanghai",
      currency: "CNY",
      fixedMonthlySalary: "8000",
      minimumMonthlyWage: "2690",
      taxRate: "0.1",
      socialInsuranceRate: "0.05",
      deductionCapRate: "0.2",
      variableShareCapRate: "1",
      deductionOrder: ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
      deductionTypeCaps: {},
      smoothingThresholdRate: "1",
      consentSignatureRef: "PG-PENDING-ESIGN",
    });
    const envelope = await platform.createESignEnvelope({
      tenantId: DEMO_TENANT_ID,
      contractId: contract.id,
      provider: "docusign",
      envelopeRef: `ENV-${Date.now()}`,
      documentHash: "sha256:pg-contract",
      signerPersonId: OWNER,
    });
    expect(envelope.status).toBe("SENT");
    const completed = await platform.completeESignEnvelope({
      tenantId: DEMO_TENANT_ID,
      provider: "docusign",
      envelopeRef: envelope.envelopeRef,
      status: "SIGNED",
      signatureRef: "PG-ESIGN-CALLBACK",
    });
    expect(completed.status).toBe("SIGNED");
    const updated = await platform.getEmploymentContract(
      DEMO_TENANT_ID,
      contract.id,
    );
    expect(updated.consentSignatureRef).toBe("PG-ESIGN-CALLBACK");
  });

  it("persists reviewed retention disposal requests", async () => {
    const platform = new PgPlatformStore(platformPool);
    const policy = await platform.createRetentionPolicy({
      tenantId: DEMO_TENANT_ID,
      dataCategory: `PG_RETENTION_${Date.now()}`,
      retentionMonths: 360,
      legalBasis: "Accounting archives",
      legalHold: false,
    });
    const disposal = await platform.createRetentionDisposalRequest({
      tenantId: DEMO_TENANT_ID,
      retentionPolicyId: policy.id,
      requestedBy: OWNER,
      reason: "Retention expired",
    });
    expect(disposal.status).toBe("REQUESTED");
    await expect(
      platform.approveRetentionDisposalRequest({
        tenantId: DEMO_TENANT_ID,
        requestId: disposal.id,
        approvedBy: OWNER,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const approved = await platform.approveRetentionDisposalRequest({
      tenantId: DEMO_TENANT_ID,
      requestId: disposal.id,
      approvedBy: ADJUDICATOR,
    });
    expect(approved.status).toBe("APPROVED");
    await expect(
      platform.completeRetentionDisposalRequest({
        tenantId: DEMO_TENANT_ID,
        requestId: disposal.id,
        actorPersonId: ADJUDICATOR,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const cancelled = await platform.cancelRetentionDisposalRequest({
      tenantId: DEMO_TENANT_ID,
      requestId: disposal.id,
      actorPersonId: ADJUDICATOR,
      reason: "Review requested",
    });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("persists consent-backed subgroup labels and removes them on withdrawal", async () => {
    const platform = new PgPlatformStore(platformPool);
    const recorded = await platform.recordWorkforceSubgroupAttribute({
      tenantId: DEMO_TENANT_ID,
      personId: OWNER,
      dimension: "GENDER",
      value: "FEMALE",
      consentRef: "pg-consent-1",
      consentedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      recordedBy: ADJUDICATOR,
    });
    expect(recorded.dimension).toBe("GENDER");
    expect(recorded.value).toBe("FEMALE");
    const updated = await platform.recordWorkforceSubgroupAttribute({
      tenantId: DEMO_TENANT_ID,
      personId: OWNER,
      dimension: "GENDER",
      value: "NONBINARY",
      consentRef: "pg-consent-2",
      consentedAt: "2026-02-01T00:00:00Z",
      recordedBy: ADJUDICATOR,
    });
    expect(updated.id).toBe(recorded.id);
    expect(updated.value).toBe("NONBINARY");
    const listed = await platform.listWorkforceSubgroupAttributes(
      DEMO_TENANT_ID,
      { personId: OWNER, dimension: "GENDER" },
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.consentRef).toBe("pg-consent-2");
    const withdrawn = await platform.withdrawWorkforceSubgroupAttribute({
      tenantId: DEMO_TENANT_ID,
      personId: OWNER,
      dimension: "GENDER",
    });
    expect(withdrawn.id).toBe(recorded.id);
    const after = await platform.listWorkforceSubgroupAttributes(
      DEMO_TENANT_ID,
      { personId: OWNER },
    );
    expect(after).toHaveLength(0);
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
      const governanceWithoutContext = await client.query(
        "SELECT count(*)::int AS count FROM people",
      );
      expect(governanceWithoutContext.rows[0].count).toBe(0);
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        DEMO_TENANT_ID,
      ]);
      const governanceWithContext = await client.query(
        "SELECT count(*)::int AS count FROM people",
      );
      expect(governanceWithContext.rows[0].count).toBeGreaterThan(0);
      await client.query("ROLLBACK");
      const platformRows = await platformPool.query(
        "SELECT count(*)::int AS count FROM people",
      );
      expect(platformRows.rows[0].count).toBeGreaterThan(0);
    } finally {
      client.release();
    }
  });
});
