import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { Store } from "../store.js";
import { REFERENCE_POLICY_ID } from "../policy-registry.js";
import { CHARGING_POLICY_ID, EQUIPMENT_POLICY_ID } from "./pack-ids.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADJUDICATOR = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";

let app: FastifyInstance;

async function call(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return { status: response.statusCode, body: response.json() };
}

async function createAcceptedWorkPackage() {
  const created = await call("POST", "/api/v1/work-packages", {
    title: "Cross-team order delivery",
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
  expect(created.status).toBe(201);
  const id = created.body.data.id as string;

  expect(
    (
      await call("POST", `/api/v1/work-packages/${id}/commit`, {
        expectedVersion: 1,
      })
    ).status,
  ).toBe(200);
  expect((await call("POST", `/api/v1/work-packages/${id}/start`)).status).toBe(200);
  expect((await call("POST", `/api/v1/work-packages/${id}/submit`)).status).toBe(200);
  expect(
    (
      await call("POST", `/api/v1/work-packages/${id}/accept`, {
        reviewerPersonId: MEMBER,
      })
    ).status,
  ).toBe(200);
  return id;
}

async function createConfirmedClaim(
  workPackageId: string,
  claimantPersonId: string,
) {
  const created = await call("POST", "/api/v1/contribution-claims", {
    workPackageId,
    claimantPersonId,
    claimType: "DELIVERABLE_CONTRIBUTION",
    claimedContribution: {
      dimensions: ["QUALITY", "TIMELINESS"],
      summary: "Delivered the agreed scope",
    },
    evidenceRefs: ["evidence-1"],
    rationale: "Delivered the agreed scope on time",
  });
  expect(created.status).toBe(201);
  const claimId = created.body.data.id as string;
  expect(
    (await call("POST", `/api/v1/contribution-claims/${claimId}/submit`)).status,
  ).toBe(200);
  const decision = await call("POST", "/api/v1/attribution-decisions", {
    claimId,
    adjudicatorPersonId: ADJUDICATOR,
    status: "CONFIRMED",
    acceptedFacts: ["Delivered the agreed scope"],
    rejectedFacts: [],
    contributionDimensions: { QUALITY: 1 },
    rationale: "Evidence supports the claim",
  });
  expect(decision.status).toBe(201);
  return { claimId, decisionId: decision.body.data.id as string };
}

async function recordCompleteLegalGate(policyVersionId = REFERENCE_POLICY_ID) {
  const gate = await call(
    "POST",
    `/api/v1/policy-versions/${policyVersionId}/legal-gate`,
    {
      policyApproved: true,
      minimumWageChecked: true,
      democraticProcedureRef: "demo-dp-1",
      employeeNoticeRef: "demo-notice-1",
      dataProtectionAssessmentRef: "demo-dpia-1",
      recordedBy: ADJUDICATOR,
    },
  );
  expect(gate.status).toBe(200);
}

async function formalRun(workPackageId: string) {
  return call("POST", "/api/v1/calculation-runs", {
    cycleId: CYCLE,
    policyVersionId: REFERENCE_POLICY_ID,
    mode: "FORMAL",
    order: { id: "order-1", grossProfit: "100000", currency: "CNY" },
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
}

async function confirmCalculation(runId: string, personId: string) {
  return call("POST", "/api/v1/employee-confirmations", {
    personId,
    targetType: "CALCULATION",
    targetId: runId,
    decision: "CONFIRMED",
  });
}

beforeEach(() => {
  app = buildApp(new Store());
});

describe("employee view", () => {
  it("serves the minimal employee confirmation page", async () => {
    const response = await app.inject({ method: "GET", url: "/" } as never);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("N-Perform 员工确认");
  });
});

describe("vertical slice", () => {
  it("runs work package -> claim -> attribution -> shadow calculation", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);

    const shadow = await call("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "SHADOW",
      order: { id: "order-1", grossProfit: "100000", currency: "CNY" },
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
    expect(shadow.status).toBe(201);
    expect(shadow.body.data.status).toBe("CALCULATED");
    expect(shadow.body.data.lines).toHaveLength(2);
    expect(shadow.body.data.lines[0].roundedAmount).toBe("3000");
    expect((await call("GET", "/api/v1/ledger")).body.data).toHaveLength(0);
  });

  it("blocks formal calculation without a server-side legal gate", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);

    const formal = await formalRun(workPackageId);
    expect(formal.status).toBe(422);
    expect(formal.body.error.code).toBe("CALCULATION_BLOCKED");
    expect(formal.body.error.details.blockers).toContain("LEGAL_GATE_MISSING");
  });

  it("reports missing legal-gate references explicitly", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await call(
      "POST",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/legal-gate`,
      {
        policyApproved: true,
        minimumWageChecked: true,
        recordedBy: ADJUDICATOR,
      },
    );

    const formal = await formalRun(workPackageId);
    expect(formal.status).toBe(422);
    expect(formal.body.error.details.blockers).toEqual(
      expect.arrayContaining([
        "DEMOCRATIC_PROCEDURE_MISSING",
        "EMPLOYEE_NOTICE_MISSING",
        "DATA_PROTECTION_ASSESSMENT_MISSING",
      ]),
    );
  });

  it("creates, confirms, approves and locks a formal run", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await recordCompleteLegalGate();

    const formal = await formalRun(workPackageId);
    expect(formal.status).toBe(201);
    const runId = formal.body.data.id as string;

    expect((await confirmCalculation(runId, OWNER)).status).toBe(201);
    expect((await confirmCalculation(runId, MEMBER)).status).toBe(201);

    const ledgerBefore = await call("GET", "/api/v1/ledger");
    expect(ledgerBefore.body.data).toHaveLength(2);
    expect(ledgerBefore.body.data[0].status).toBe("PROVISIONAL");

    expect(
      (await call("POST", `/api/v1/calculation-runs/${runId}/approve`)).status,
    ).toBe(200);
    const locked = await call("POST", `/api/v1/calculation-runs/${runId}/lock`, {
      confirmation: "LOCK_CALCULATION",
    });
    expect(locked.status).toBe(200);
    expect(locked.body.data.status).toBe("LOCKED");

    const ledgerAfter = await call("GET", "/api/v1/ledger");
    expect(
      ledgerAfter.body.data.every(
        (entry: { status: string }) => entry.status === "LOCKED",
      ),
    ).toBe(true);
    expect((await call("GET", "/api/v1/ledger/verify")).body.data.valid).toBe(true);
  });

  it("blocks locking when an employee objects", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await recordCompleteLegalGate();
    const formal = await formalRun(workPackageId);
    const runId = formal.body.data.id as string;

    await confirmCalculation(runId, OWNER);
    const objection = await call("POST", "/api/v1/employee-confirmations", {
      personId: MEMBER,
      targetType: "CALCULATION",
      targetId: runId,
      decision: "OBJECTED",
      reason: "Contribution weight does not reflect my delivery",
    });
    expect(objection.status).toBe(201);

    await call("POST", `/api/v1/calculation-runs/${runId}/approve`);
    const locked = await call("POST", `/api/v1/calculation-runs/${runId}/lock`, {
      confirmation: "LOCK_CALCULATION",
    });
    expect(locked.status).toBe(422);
    expect(locked.body.error.details.blockers).toContain(
      `EMPLOYEE_OBJECTION:${MEMBER}`,
    );
  });

  it("rejects illegal state transitions", async () => {
    const created = await call("POST", "/api/v1/work-packages", {
      title: "Draft package",
      objective: "Should not be accepted yet",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "Draft",
        },
      ],
      acceptanceCriteria: ["Done"],
    });
    const id = created.body.data.id as string;
    const accepted = await call("POST", `/api/v1/work-packages/${id}/accept`, {
      reviewerPersonId: MEMBER,
    });
    expect(accepted.status).toBe(409);
    expect(accepted.body.error.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("prevents a claimant from adjudicating their own claim", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    const claim = await call("POST", "/api/v1/contribution-claims", {
      workPackageId,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: { dimensions: ["QUALITY"], summary: "Done" },
      evidenceRefs: [],
      rationale: "Done",
    });
    const claimId = claim.body.data.id as string;
    await call("POST", `/api/v1/contribution-claims/${claimId}/submit`);
    const decision = await call("POST", "/api/v1/attribution-decisions", {
      claimId,
      adjudicatorPersonId: OWNER,
      status: "CONFIRMED",
      acceptedFacts: ["Done"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "Self review",
    });
    expect(decision.status).toBe(422);
    expect(decision.body.error.code).toBe("INVARIANT_VIOLATION");
  });

  it("calculates a charging equipment sale with cash weighting and reserve", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await recordCompleteLegalGate(EQUIPMENT_POLICY_ID);

    const run = await call("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: EQUIPMENT_POLICY_ID,
      mode: "SHADOW",
      order: {
        id: "equipment-api-001",
        grossProfit: "600000",
        currency: "CNY",
        invoiceAmount: "3000000",
        cashCollected: "2400000",
        creditApproved: true,
        qualityHold: false,
        channelShare: "0",
        projectType: "DC_CHARGING_PILE_SALE",
        siteId: "customer-api-001",
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
    expect(run.status).toBe(201);
    expect(
      run.body.data.lines.map((line: { roundedAmount: string }) => line.roundedAmount),
    ).toEqual(["10999.8", "7333.2"]);
    expect(run.body.data.lines[0].trace.afterSalesReserve).toBe("567");
  });

  it("blocks an equipment sale without credit approval", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await recordCompleteLegalGate(EQUIPMENT_POLICY_ID);

    const run = await call("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: EQUIPMENT_POLICY_ID,
      mode: "SHADOW",
      order: {
        id: "equipment-api-002",
        grossProfit: "600000",
        currency: "CNY",
        invoiceAmount: "3000000",
        cashCollected: "2400000",
        creditApproved: false,
        qualityHold: false,
        channelShare: "0",
      },
      participants: [
        {
          personId: OWNER,
          workPackageId,
          attributionWeight: "1",
          role: "SALES_LEAD",
        },
      ],
    });
    expect(run.status).toBe(422);
    expect(run.body.error.code).toBe("CALCULATION_BLOCKED");
    expect(run.body.error.details.blockers).toContain("CREDIT_NOT_APPROVED");
  });

  it("calculates a charging project with cash weighting and retention", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await recordCompleteLegalGate(CHARGING_POLICY_ID);

    const run = await call("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: CHARGING_POLICY_ID,
      mode: "SHADOW",
      order: {
        id: "charging-api-001",
        grossProfit: "1000000",
        currency: "CNY",
        contractAmount: "2000000",
        cashCollected: "1500000",
        projectType: "DC_FAST_CHARGING_STATION",
        siteId: "site-api-001",
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
    expect(run.status).toBe(201);
    expect(run.body.data.lines.map((line: { roundedAmount: string }) => line.roundedAmount)).toEqual([
      "20520",
      "13680",
    ]);
    expect(run.body.data.lines[0].trace.retentionHeld).toBe("1800");
  });

  it("blocks a charging project with an open safety incident", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await recordCompleteLegalGate(CHARGING_POLICY_ID);

    const run = await call("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: CHARGING_POLICY_ID,
      mode: "SHADOW",
      order: {
        id: "charging-api-002",
        grossProfit: "1000000",
        currency: "CNY",
        contractAmount: "2000000",
        cashCollected: "1500000",
        safetyIncidents: 1,
        acceptanceStatus: "ACCEPTED",
      },
      participants: [
        {
          personId: OWNER,
          workPackageId,
          attributionWeight: "1",
          role: "SALES_LEAD",
        },
      ],
    });
    expect(run.status).toBe(422);
    expect(run.body.error.code).toBe("CALCULATION_BLOCKED");
    expect(run.body.error.details.blockers).toContain("SAFETY_INCIDENT_OPEN");
  });

  it("runs a proactive agent task and requires approval for escalation", async () => {
    const created = await call("POST", "/api/v1/work-packages", {
      title: "Agent scan target",
      objective: "Check evidence gaps",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "Delivery",
        },
      ],
      acceptanceCriteria: ["Accepted"],
    });
    expect(created.status).toBe(201);

    const enqueued = await call("POST", "/api/v1/agent-tasks", {
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "agent-scan-1",
    });
    expect(enqueued.status).toBe(201);
    const taskId = enqueued.body.data.id as string;

    const ran = await call("POST", `/api/v1/agent-tasks/${taskId}/run`);
    expect(ran.status).toBe(200);
    expect(ran.body.data.status).toBe("WAITING_APPROVAL");
    expect(
      ran.body.data.findings.map((finding: { code: string }) => finding.code),
    ).toEqual(
      expect.arrayContaining(["WORK_PACKAGE_NOT_COMMITTED", "NO_EVIDENCE"]),
    );

    const escalate = ran.body.data.actions.find(
      (action: { tool: string }) => action.tool === "escalate",
    );
    const approved = await call(
      "POST",
      `/api/v1/agent-tasks/${taskId}/approve`,
      {
        actionId: escalate.id,
        approverPersonId: ADJUDICATOR,
      },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("SUCCEEDED");
    expect(approved.body.data.approvedBy).toBe(ADJUDICATOR);

    const replay = await call("POST", "/api/v1/agent-tasks", {
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "agent-scan-1",
    });
    expect(replay.body.data.id).toBe(taskId);
  });

  it("simulates a policy change without publishing it", async () => {
    const simulation = await call("POST", "/api/v1/policy-simulations", {
      currentPolicyVersionId: REFERENCE_POLICY_ID,
      proposedPolicy: {
        code: "GENERIC_CONTRIBUTION_V1",
        version: 2,
        currency: "CNY",
        poolRate: "0.06",
        poolCap: "100000",
        rounding: "HALF_UP",
        calculator: "SIMPLE_POOL",
      },
      samples: [
        {
          personId: OWNER,
          input: {
            cycleId: CYCLE,
            policyVersionId: REFERENCE_POLICY_ID,
            mode: "SHADOW",
            order: {
              id: "sim-order-1",
              grossProfit: "100000",
              currency: "CNY",
            },
            participants: [
              {
                personId: OWNER,
                workPackageId: "00000000-0000-4000-8000-000000000010",
                attributionWeight: "1",
                role: "OWNER",
              },
            ],
          },
        },
      ],
    });
    expect(simulation.status).toBe(200);
    expect(simulation.body.data.currentTotal).toBe("5000");
    expect(simulation.body.data.proposedTotal).toBe("6000");
    expect(simulation.body.data.deltaTotal).toBe("1000");
  });

  it("runs a proactive agent scan across the tenant", async () => {
    await call("POST", "/api/v1/work-packages", {
      title: "Scan target",
      objective: "Detect evidence gaps",
      ownerPersonId: OWNER,
      members: [
        {
          personId: OWNER,
          responsibilityCode: "OWNER",
          expectedOutput: "Delivery",
        },
      ],
      acceptanceCriteria: ["Accepted"],
    });

    const scan = await call("POST", "/api/v1/agent-tasks/scan", {
      idempotencyKey: "scan-test-1",
    });
    expect(scan.status).toBe(200);
    expect(scan.body.data.length).toBeGreaterThanOrEqual(2);
    expect(
      scan.body.data.some(
        (task: { agentType: string; status: string }) =>
          task.agentType === "EVIDENCE_GAP" &&
          task.status === "WAITING_APPROVAL",
      ),
    ).toBe(true);
  });

  it("creates an evidence graph and links supporting/counter evidence", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    const first = await call("POST", "/api/v1/evidence", {
      evidenceType: "DELIVERY_RECORD",
      subjectType: "WORK_PACKAGE",
      subjectId: workPackageId,
      sourceSystem: "CRM",
      normalizedPayload: { accepted: true, deliveredAt: "2026-10-20" },
      qualityStatus: "VALID",
    });
    expect(first.status).toBe(201);
    const evidenceId = first.body.data.id as string;

    const second = await call("POST", "/api/v1/evidence", {
      evidenceType: "CUSTOMER_FEEDBACK",
      subjectType: "WORK_PACKAGE",
      subjectId: workPackageId,
      sourceSystem: "SUPPORT",
      normalizedPayload: { score: 5 },
      qualityStatus: "VALID",
    });
    expect(second.status).toBe(201);
    const counterId = second.body.data.id as string;

    expect(
      (
        await call("POST", `/api/v1/evidence/${evidenceId}/links`, {
          toEvidenceId: counterId,
          relationType: "SUPPORTS",
          rationale: "Customer feedback confirms the delivery",
        })
      ).status,
    ).toBe(201);

    const list = await call(
      "GET",
      `/api/v1/evidence?subjectType=WORK_PACKAGE&subjectId=${workPackageId}`,
    );
    expect(list.body.data).toHaveLength(2);
    const links = await call("GET", `/api/v1/evidence/${evidenceId}/links`);
    expect(links.body.data[0].relationType).toBe("SUPPORTS");

    const claim = await call("POST", "/api/v1/contribution-claims", {
      workPackageId,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: { dimensions: ["QUALITY"], summary: "Delivered" },
      evidenceRefs: [evidenceId, counterId],
      rationale: "Delivery and customer feedback",
    });
    expect(claim.status).toBe(201);
    expect(claim.body.data.evidenceRefs).toEqual([evidenceId, counterId]);
  });

  it("runs an independent appeal review and preserves the original decision", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    const { claimId, decisionId } = await createConfirmedClaim(workPackageId, OWNER);
    const appeal = await call("POST", "/api/v1/appeals", {
      appellantPersonId: OWNER,
      targetType: "ATTRIBUTION",
      targetId: decisionId,
      reasonCode: "EVIDENCE_NOT_CONSIDERED",
      statement: "A key delivery was not included in the decision",
    });
    expect(appeal.status).toBe(201);
    const appealId = appeal.body.data.id as string;

    const selfTriage = await call("POST", `/api/v1/appeals/${appealId}/triage`, {
      reviewerPersonId: OWNER,
    });
    expect(selfTriage.status).toBe(409);

    expect(
      (
        await call("POST", `/api/v1/appeals/${appealId}/triage`, {
          reviewerPersonId: ADJUDICATOR,
        })
      ).status,
    ).toBe(200);
    expect((await call("POST", `/api/v1/appeals/${appealId}/review`)).status).toBe(200);
    const resolved = await call("POST", `/api/v1/appeals/${appealId}/resolve`, {
      reviewerPersonId: ADJUDICATOR,
      resolution: "CHANGE",
      rationale: "The missing delivery changes the attribution",
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe("RECALCULATION_REQUIRED");

    const decisions = await call(
      "GET",
      `/api/v1/attribution-decisions?claimId=${claimId}`,
    );
    expect(decisions.body.data[0].id).toBe(decisionId);
    expect(decisions.body.data[0].status).toBe("CONFIRMED");

    const appealAfter = await call("GET", `/api/v1/appeals/${appealId}`);
    expect(appealAfter.body.data.status).toBe("RECALCULATION_REQUIRED");
  });
});
