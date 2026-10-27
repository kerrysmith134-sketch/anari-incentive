import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADJUDICATOR = "00000000-0000-4000-8000-000000000003";

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

  expect((await call("POST", `/api/v1/work-packages/${id}/commit`, { expectedVersion: 1 })).status).toBe(200);
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
  return claimId;
}

beforeEach(() => {
  app = buildApp(new Store());
});

describe("vertical slice", () => {
  it("runs work package -> claim -> attribution -> shadow calculation", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);

    const shadow = await call("POST", "/api/v1/calculation-runs", {
      cycleId: "00000000-0000-4000-8000-000000000020",
      policyVersionId: "policy-v1",
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

  it("blocks formal calculation without the legal gate", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);

    const formal = await call("POST", "/api/v1/calculation-runs", {
      cycleId: "00000000-0000-4000-8000-000000000020",
      policyVersionId: "policy-v1",
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
    expect(formal.status).toBe(422);
    expect(formal.body.error.code).toBe("CALCULATION_BLOCKED");
    expect(formal.body.error.details.blockers).toContain("LEGAL_GATE_MISSING");
  });

  it("creates, approves and locks a formal run with ledger entries", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);

    const formal = await call("POST", "/api/v1/calculation-runs", {
      cycleId: "00000000-0000-4000-8000-000000000020",
      policyVersionId: "policy-v1",
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
      legalGate: {
        policyApproved: true,
        minimumWageChecked: true,
        democraticProcedureRef: "demo-dp-1",
        employeeNoticeRef: "demo-notice-1",
        dataProtectionAssessmentRef: "demo-dpia-1",
      },
    });
    expect(formal.status).toBe(201);
    const runId = formal.body.data.id as string;
    expect(formal.body.data.status).toBe("CALCULATED");

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
    expect(ledgerAfter.body.data.every((entry: { status: string }) => entry.status === "LOCKED")).toBe(true);
    expect((await call("GET", "/api/v1/ledger/verify")).body.data.valid).toBe(true);
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
});
