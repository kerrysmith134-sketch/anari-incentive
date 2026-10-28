import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgStore } from "../pg-store.js";
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
    });
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
