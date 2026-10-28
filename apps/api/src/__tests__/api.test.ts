import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuthError, type Authenticator } from "@anari/auth";
import { buildApp } from "../app.js";
import { Store } from "../store.js";
import { REFERENCE_POLICY_ID } from "../policy-registry.js";
import { CHARGING_POLICY_ID, EQUIPMENT_POLICY_ID } from "./pack-ids.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADJUDICATOR = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";

let app: FastifyInstance;
let appStore: Store;

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
  appStore = new Store();
  app = buildApp(appStore);
});

describe("authentication", () => {
  it("rejects API requests when authentication fails", async () => {
    const rejecting: Authenticator = {
      async authenticate() {
        throw new AuthError("UNAUTHENTICATED", "no token");
      },
    };
    const protectedApp = buildApp(new Store(), undefined, rejecting);
    const response = await protectedApp.inject({
      method: "GET",
      url: "/api/v1/work-packages",
    } as never);
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects sensitive commands for a non-privileged role", async () => {
    const employee: Authenticator = {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "employee-1",
          roles: ["employee"],
          personId: OWNER,
        };
      },
    };
    const employeeApp = buildApp(new Store(), undefined, employee);
    const publish = await employeeApp.inject({
      method: "POST",
      url: "/api/v1/policy-versions",
      payload: {
        policy: {
          code: "GENERIC_CONTRIBUTION_V1",
          version: 9,
          currency: "CNY",
          poolRate: "0.05",
          poolCap: "100000",
          rounding: "HALF_UP",
          calculator: "SIMPLE_POOL",
        },
        effectiveFrom: "2026-11-01T00:00:00Z",
        approvedBy: ADJUDICATOR,
      },
    } as never);
    expect(publish.statusCode).toBe(403);
    expect(publish.json().error.code).toBe("FORBIDDEN");

    const settlement = await employeeApp.inject({
      method: "POST",
      url: "/api/v1/settlement-batches",
      payload: { cycleId: CYCLE },
    } as never);
    expect(settlement.statusCode).toBe(403);

    const confirmation = await employeeApp.inject({
      method: "POST",
      url: "/api/v1/employee-confirmations",
      payload: {
        personId: OWNER,
        targetType: "CALCULATION",
        targetId: CYCLE,
        decision: "VIEWED",
      },
    } as never);
    // The target does not exist in this fresh store (404), but the employee
    // role is not blocked by authorization.
    expect(confirmation.statusCode).not.toBe(403);

    const impersonation = await employeeApp.inject({
      method: "POST",
      url: "/api/v1/employee-confirmations",
      payload: {
        personId: MEMBER,
        targetType: "CALCULATION",
        targetId: CYCLE,
        decision: "VIEWED",
      },
    } as never);
    expect(impersonation.statusCode).toBe(403);

    const foreignPackage = await employeeApp.inject({
      method: "POST",
      url: "/api/v1/work-packages",
      payload: {
        title: "Someone else's package",
        objective: "Should fail",
        ownerPersonId: MEMBER,
        members: [
          {
            personId: MEMBER,
            responsibilityCode: "OWNER",
            expectedOutput: "Delivery",
          },
        ],
        acceptanceCriteria: ["Done"],
      },
    } as never);
    expect(foreignPackage.statusCode).toBe(403);

    const packages = await employeeApp.inject({
      method: "GET",
      url: "/api/v1/work-packages",
    } as never);
    expect(packages.statusCode).toBe(200);
    expect(packages.json().data).toEqual([]);
  });

  it("requires a person identity for employee-scoped reads", async () => {
    const noPerson: Authenticator = {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "employee-2",
          roles: ["employee"],
        };
      },
    };
    const employeeApp = buildApp(new Store(), undefined, noPerson);
    const response = await employeeApp.inject({
      method: "GET",
      url: "/api/v1/work-packages",
    } as never);
    expect(response.statusCode).toBe(403);
  });

  it("allows API requests when authentication succeeds", async () => {
    const allowing: Authenticator = {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "user-1",
          roles: ["employee"],
          personId: OWNER,
        };
      },
    };
    const protectedApp = buildApp(new Store(), undefined, allowing);
    const response = await protectedApp.inject({
      method: "GET",
      url: "/api/v1/work-packages",
    } as never);
    expect(response.statusCode).toBe(200);
  });
});

describe("tenant isolation", () => {
  it("resolves a store and agent runtime per authenticated tenant", async () => {
    const authenticator: Authenticator = {
      async authenticate(credentials) {
        return {
          tenantId: credentials.tenantId ?? "tenant-a",
          userId: "user-1",
          roles: ["admin"],
        };
      },
    };
    const scopedApp = buildApp(
      (tenantId) => new Store(tenantId),
      undefined,
      authenticator,
    );

    const created = await scopedApp.inject({
      method: "POST",
      url: "/api/v1/work-packages",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        title: "Tenant A package",
        objective: "Prove isolation",
        ownerPersonId: OWNER,
        members: [
          {
            personId: OWNER,
            responsibilityCode: "OWNER",
            expectedOutput: "Delivery",
          },
        ],
        acceptanceCriteria: ["Accepted"],
      },
    } as never);
    expect(created.statusCode).toBe(201);
    expect(created.json().data.tenantId).toBe("tenant-a");

    const tenantA = await scopedApp.inject({
      method: "GET",
      url: "/api/v1/work-packages",
      headers: { "x-tenant-id": "tenant-a" },
    } as never);
    expect(tenantA.json().data).toHaveLength(1);

    const tenantB = await scopedApp.inject({
      method: "GET",
      url: "/api/v1/work-packages",
      headers: { "x-tenant-id": "tenant-b" },
    } as never);
    expect(tenantB.json().data).toHaveLength(0);

    await scopedApp.inject({
      method: "POST",
      url: "/api/v1/agent-tasks",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        agentType: "EVIDENCE_GAP",
        triggerType: "MANUAL",
        idempotencyKey: "tenant-a-task",
      },
    } as never);
    const tasksA = await scopedApp.inject({
      method: "GET",
      url: "/api/v1/agent-tasks",
      headers: { "x-tenant-id": "tenant-a" },
    } as never);
    expect(tasksA.json().data).toHaveLength(1);
    const tasksB = await scopedApp.inject({
      method: "GET",
      url: "/api/v1/agent-tasks",
      headers: { "x-tenant-id": "tenant-b" },
    } as never);
    expect(tasksB.json().data).toHaveLength(0);
  });
});

describe("employee data redaction", () => {
  it("returns only the employee's line and hides order economics", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    const run = await call("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "SHADOW",
      order: { id: "redaction-order", grossProfit: "100000", currency: "CNY" },
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
    const runId = run.body.data.id as string;

    const employee: Authenticator = {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "employee-1",
          roles: ["employee"],
          personId: OWNER,
        };
      },
    };
    const employeeApp = buildApp(appStore, undefined, employee);
    const visible = await employeeApp.inject({
      method: "GET",
      url: `/api/v1/calculation-runs/${runId}`,
    } as never);
    expect(visible.statusCode).toBe(200);
    expect(visible.json().data.lines).toHaveLength(1);
    expect(visible.json().data.lines[0].personId).toBe(OWNER);
    expect(visible.json().data.lines[0].trace).toEqual({});
    expect(visible.json().data.inputSnapshot.order.grossProfit).toBe(
      "REDACTED",
    );
    expect(visible.json().data.inputSnapshot.participants).toHaveLength(1);
  });
});

describe("employee view", () => {
  it("serves the minimal employee confirmation page", async () => {
    const response = await app.inject({ method: "GET", url: "/" } as never);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("N-Perform 员工确认");
  });
});

describe("observability", () => {
  it("reports readiness", async () => {
    const response = await app.inject({ method: "GET", url: "/ready" } as never);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("ready");
  });

  it("renders Prometheus metrics with bounded route labels", async () => {
    await app.inject({ method: "GET", url: "/health" } as never);
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
    } as never);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("n_perform_http_requests_total");
    expect(response.body).toContain('route="/health"');
    expect(response.body).toContain("n_perform_process_uptime_seconds");
  });
});

describe("admin view", () => {
  it("serves the admin simulation and agent approval page", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin",
    } as never);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("N-Perform 管理端");
    expect(response.body).toContain("/api/v1/policy-simulations");
    expect(response.body).toContain("/api/v1/agent-tasks");
    expect(response.body).toContain("结算批次");
    expect(response.body).toContain("审计事件");
    expect(response.body).toContain("评价管理");
    expect(response.body).toContain("数据质量");
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

  it("reconciles, approves, locks and exports a settlement batch", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await recordCompleteLegalGate();
    const formal = await formalRun(workPackageId);
    const runId = formal.body.data.id as string;
    await confirmCalculation(runId, OWNER);
    await confirmCalculation(runId, MEMBER);
    await call("POST", `/api/v1/calculation-runs/${runId}/approve`);
    await call("POST", `/api/v1/calculation-runs/${runId}/lock`, {
      confirmation: "LOCK_CALCULATION",
    });

    const created = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("DRAFT");
    expect(created.body.data.lineCount).toBe(2);
    expect(created.body.data.totalAmount).toBe("5000");
    const batchId = created.body.data.id as string;

    const duplicate = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("CONFLICT");

    const reconciled = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      { command: "RECONCILE" },
    );
    expect(reconciled.status).toBe(200);
    expect(reconciled.body.data.batch.status).toBe("RECONCILING");

    const submitted = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      { command: "SUBMIT" },
    );
    expect(submitted.body.data.batch.status).toBe("PENDING_APPROVAL");

    const missingApprover = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      { command: "APPROVE" },
    );
    expect(missingApprover.status).toBe(409);
    expect(missingApprover.body.error.message).toContain("APPROVER_REQUIRED");

    const approved = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      { command: "APPROVE", actorPersonId: ADJUDICATOR },
    );
    expect(approved.body.data.batch.status).toBe("APPROVED");
    expect(approved.body.data.batch.approvedBy).toBe(ADJUDICATOR);

    const locked = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      { command: "LOCK" },
    );
    expect(locked.body.data.batch.status).toBe("LOCKED");

    const exported = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      { command: "EXPORT" },
    );
    expect(exported.body.data.batch.status).toBe("EXPORTED");
    expect(exported.body.data.csv).toContain(
      "batch_no,person_id,ledger_id,amount,currency",
    );
    expect(exported.body.data.csv.trim().split("\n")).toHaveLength(3);

    const acknowledged = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      { command: "ACKNOWLEDGE", externalReference: "finance-batch-1" },
    );
    expect(acknowledged.body.data.batch.status).toBe("ACKNOWLEDGED");
    expect(acknowledged.body.data.batch.externalReference).toBe(
      "finance-batch-1",
    );

    const fetched = await call(
      "GET",
      `/api/v1/settlement-batches/${batchId}`,
    );
    expect(fetched.body.data.lines).toHaveLength(2);
  });

  it("tracks and waives data-quality issues", async () => {
    const created = await call("POST", "/api/v1/data-quality-issues", {
      objectType: "WORK_PACKAGE",
      objectId: "00000000-0000-4000-8000-000000000010",
      issueCode: "EVIDENCE_MISSING",
      severity: "WARNING",
      details: { missing: ["DELIVERY_RECORD"] },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("OPEN");
    const issueId = created.body.data.id as string;

    const assigned = await call(
      "POST",
      `/api/v1/data-quality-issues/${issueId}/commands`,
      { command: "ASSIGN", assignedTo: ADJUDICATOR },
    );
    expect(assigned.body.data.status).toBe("ASSIGNED");
    expect(assigned.body.data.assignedTo).toBe(ADJUDICATOR);

    const started = await call(
      "POST",
      `/api/v1/data-quality-issues/${issueId}/commands`,
      { command: "START" },
    );
    expect(started.body.data.status).toBe("IN_PROGRESS");

    const invalidWaiver = await call(
      "POST",
      `/api/v1/data-quality-issues/${issueId}/commands`,
      { command: "WAIVE" },
    );
    expect(invalidWaiver.status).toBe(409);

    const waived = await call(
      "POST",
      `/api/v1/data-quality-issues/${issueId}/commands`,
      {
        command: "WAIVE",
        actorPersonId: ADJUDICATOR,
        reason: "Evidence will arrive next cycle",
      },
    );
    expect(waived.body.data.status).toBe("WAIVED_WITH_APPROVAL");
    expect(waived.body.data.waiverReason).toBe(
      "Evidence will arrive next cycle",
    );

    const reopened = await call(
      "POST",
      `/api/v1/data-quality-issues/${issueId}/commands`,
      { command: "REOPEN" },
    );
    expect(reopened.body.data.status).toBe("REOPENED");

    const list = await call(
      "GET",
      "/api/v1/data-quality-issues?status=REOPENED",
    );
    expect(
      list.body.data.some((issue: { id: string }) => issue.id === issueId),
    ).toBe(true);
  });

  it("creates and lists evaluation cycles", async () => {
    const created = await call("POST", "/api/v1/evaluation-cycles", {
      name: "2027 Q1 cycle",
      cycleType: "MONTHLY",
      startsAt: "2027-01-01T00:00:00Z",
      endsAt: "2027-01-31T23:59:59Z",
      timezone: "Asia/Shanghai",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("DRAFT");

    const list = await call("GET", "/api/v1/evaluation-cycles");
    expect(list.status).toBe(200);
    expect(
      list.body.data.some(
        (cycle: { id: string }) => cycle.id === created.body.data.id,
      ),
    ).toBe(true);
  });

  it("runs a human-reviewed evaluation with versioned decisions", async () => {
    const rubric = await call("POST", "/api/v1/rubrics", {
      code: "PERFORMANCE_V1",
      name: "Performance",
      dimensions: ["QUALITY", "SPEED"],
      scoringAnchors: { 1: "below", 3: "meets", 5: "exceeds" },
      effectiveFrom: "2026-10-01",
    });
    expect(rubric.status).toBe(201);
    const rubricId = rubric.body.data.id as string;

    const firstDraft = await call("POST", "/api/v1/evaluation-drafts", {
      cycleId: CYCLE,
      personId: MEMBER,
      generatedByType: "USER",
      evidenceSnapshotHash: "evidence-1",
      draftPayload: { summary: "Delivered the cycle scope" },
      strengths: ["Delivery"],
      counterEvidence: [],
      missingInformation: [],
    });
    expect(firstDraft.status).toBe(201);
    const firstDraftId = firstDraft.body.data.id as string;
    await call("POST", `/api/v1/evaluation-drafts/${firstDraftId}/submit`);
    const firstDecision = await call(
      "POST",
      `/api/v1/evaluation-drafts/${firstDraftId}/decision`,
      {
        reviewerPersonId: ADJUDICATOR,
        rubricVersionId: rubricId,
        decision: "APPROVE",
        scores: { QUALITY: 4, SPEED: 3 },
        rationale: "Evidence supports the rating",
      },
    );
    expect(firstDecision.status).toBe(200);
    expect(firstDecision.body.data.draft.status).toBe("APPROVED");
    expect(firstDecision.body.data.decision.decisionVersion).toBe(1);

    const secondDraft = await call("POST", "/api/v1/evaluation-drafts", {
      cycleId: CYCLE,
      personId: MEMBER,
      generatedByType: "SYSTEM",
      evidenceSnapshotHash: "evidence-2",
      draftPayload: { summary: "Corrected cycle evidence" },
    });
    const secondDraftId = secondDraft.body.data.id as string;
    await call("POST", `/api/v1/evaluation-drafts/${secondDraftId}/submit`);
    const secondDecision = await call(
      "POST",
      `/api/v1/evaluation-drafts/${secondDraftId}/decision`,
      {
        reviewerPersonId: ADJUDICATOR,
        rubricVersionId: rubricId,
        decision: "APPROVE",
        scores: { QUALITY: 5, SPEED: 4 },
        rationale: "Corrected evidence",
      },
    );
    expect(secondDecision.body.data.decision.decisionVersion).toBe(2);
    expect(secondDecision.body.data.decision.supersedesId).toBe(
      firstDecision.body.data.decision.id,
    );

    const decisions = await call(
      "GET",
      `/api/v1/evaluation-decisions?personId=${MEMBER}`,
    );
    expect(decisions.body.data).toHaveLength(2);
    const latest = decisions.body.data.find(
      (decision: { decisionVersion: number }) =>
        decision.decisionVersion === 2,
    );
    expect(latest.status).toBe("APPROVED");
    expect(
      decisions.body.data.find(
        (decision: { decisionVersion: number }) =>
          decision.decisionVersion === 1,
      ).status,
    ).toBe("SUPERSEDED");
  });

  it("blocks self-review of an evaluation", async () => {
    const rubric = await call("POST", "/api/v1/rubrics", {
      code: "SELF_REVIEW_V1",
      name: "Self review",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-10-01",
    });
    const draft = await call("POST", "/api/v1/evaluation-drafts", {
      cycleId: CYCLE,
      personId: ADJUDICATOR,
      generatedByType: "USER",
      evidenceSnapshotHash: "self-evidence",
      draftPayload: { summary: "Self" },
    });
    const draftId = draft.body.data.id as string;
    await call("POST", `/api/v1/evaluation-drafts/${draftId}/submit`);
    const decision = await call(
      "POST",
      `/api/v1/evaluation-drafts/${draftId}/decision`,
      {
        reviewerPersonId: ADJUDICATOR,
        rubricVersionId: rubric.body.data.id,
        decision: "APPROVE",
        scores: { QUALITY: 5 },
        rationale: "Self review",
      },
    );
    expect(decision.status).toBe(409);
    expect(decision.body.error.message).toContain("SELF_REVIEW_FORBIDDEN");
  });

  it("blocks a formal run on an unresolved blocking data-quality issue", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await recordCompleteLegalGate();

    const issue = await call("POST", "/api/v1/data-quality-issues", {
      objectType: "WORK_PACKAGE",
      objectId: workPackageId,
      issueCode: "MISSING_DELIVERY_RECORD",
      severity: "BLOCKING",
    });
    const issueId = issue.body.data.id as string;

    const blocked = await formalRun(workPackageId);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.blockers).toContain(
      `BLOCKING_DATA_QUALITY_ISSUE:${issueId}`,
    );

    await call(
      "POST",
      `/api/v1/data-quality-issues/${issueId}/commands`,
      {
        command: "WAIVE",
        actorPersonId: ADJUDICATOR,
        reason: "Finance accepted the missing record",
      },
    );
    const allowed = await formalRun(workPackageId);
    expect(allowed.status).toBe(201);
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

  it("publishes a policy version and rejects duplicates", async () => {
    const policy = {
      code: "GENERIC_CONTRIBUTION_V1",
      version: 7,
      currency: "CNY",
      poolRate: "0.07",
      poolCap: "100000",
      rounding: "HALF_UP",
      calculator: "SIMPLE_POOL",
    };
    const published = await call("POST", "/api/v1/policy-versions", {
      policy,
      effectiveFrom: "2026-11-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
    });
    expect(published.status).toBe(201);
    expect(published.body.data.policyVersionId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(published.body.data.approvedBy).toBe(ADJUDICATOR);
    expect(published.body.data.contentHash).toContain("sha256:");

    const versions = await call("GET", "/api/v1/policy-versions");
    expect(versions.status).toBe(200);
    expect(
      versions.body.data.some(
        (version: { policyVersionId: string }) =>
          version.policyVersionId === published.body.data.policyVersionId,
      ),
    ).toBe(true);

    const simulation = await call("POST", "/api/v1/policy-simulations", {
      currentPolicyVersionId: published.body.data.policyVersionId,
      proposedPolicy: { ...policy, version: 8, poolRate: "0.08" },
      samples: [
        {
          personId: OWNER,
          input: {
            cycleId: CYCLE,
            policyVersionId: published.body.data.policyVersionId,
            mode: "SHADOW",
            order: {
              id: "published-policy-order",
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
    expect(simulation.body.data.currentTotal).toBe("7000");

    const duplicate = await call("POST", "/api/v1/policy-versions", {
      policy,
      effectiveFrom: "2026-12-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("CONFLICT");
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

  it("ingests external events idempotently", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    const batch = {
      sourceSystem: "crm",
      events: [
        {
          sourceRecordId: "crm-order-1",
          sourceEventVersion: "1",
          eventType: "order.updated",
          subjectType: "WORK_PACKAGE",
          subjectId: workPackageId,
          evidenceType: "ORDER",
          payload: { orderId: "crm-order-1", stage: "won" },
          qualityStatus: "VALID",
        },
      ],
    };
    const first = await call("POST", "/api/v1/ingestion/events:batch", batch);
    expect(first.status).toBe(200);
    expect(first.body.data.accepted).toBe(1);
    expect(first.body.data.duplicates).toBe(0);

    const replay = await call("POST", "/api/v1/ingestion/events:batch", batch);
    expect(replay.status).toBe(200);
    expect(replay.body.data.accepted).toBe(0);
    expect(replay.body.data.duplicates).toBe(1);

    const evidence = await call(
      "GET",
      `/api/v1/evidence?subjectType=WORK_PACKAGE&subjectId=${workPackageId}`,
    );
    expect(evidence.body.data).toHaveLength(1);
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
