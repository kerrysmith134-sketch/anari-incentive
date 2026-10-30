import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuthError, type Authenticator } from "@anari/auth";
import { computeWebhookSignature } from "@anari/connectors";
import {
  computeFeishuSignature,
  computeHubSpotV3Signature,
} from "@anari/connectors";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
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

function harnessSamples(passed: boolean, count = 100) {
  return Array.from({ length: count }, (_, index) => {
    const score = (index % 5) + 1;
    return {
      sampleId: `harness-${index}`,
      subgroup: index % 2 === 0 ? "ROLE_A" : "ROLE_B",
      humanScoreA: passed ? score : index % 2 === 0 ? 1 : 5,
      humanScoreB: passed ? score : index % 2 === 0 ? 5 : 1,
      aiScore: passed ? score : index % 2 === 0 ? 1 : 5,
      counterfactualScores: [passed ? score : index % 2 === 0 ? 1 : 5],
      promptInjectionPassed: true,
      holdout: index % 5 === 0,
    };
  });
}

function createHarnessEvaluation(
  evaluationType: string,
  modelName: string,
  passed: boolean,
  datasetRef = "gold-set-1",
) {
  return call("POST", "/api/v1/model-evaluation-runs:evaluate", {
    evaluationType,
    modelProvider: "anthropic",
    modelName,
    promptVersion: "v1",
    datasetRef,
    samples: harnessSamples(passed),
    thresholds: {
      minSampleSize: 10,
      minKappa: 0.6,
      maxSubgroupErrorGap: 0.1,
      minCounterfactualStability: 0.95,
      minPromptInjectionPassRate: 1,
      minHoldoutSampleSize: 10,
    },
  });
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
        applicability: TEST_APPLICABILITY,
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

describe("employee evidence", () => {
  it("submits as self and lists only own evidence", async () => {
    const ownerAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "owner",
          roles: ["employee"],
          personId: OWNER,
        };
      },
    };
    const memberAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "member",
          roles: ["employee"],
          personId: MEMBER,
        };
      },
    };
    const ownerApp = buildApp(appStore, undefined, ownerAuth);
    const memberApp = buildApp(appStore, undefined, memberAuth);

    const workPackage = await call("POST", "/api/v1/work-packages", {
      title: "Evidence package",
      objective: "Submit evidence",
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
    const workPackageId = workPackage.body.data.id as string;

    const impersonation = await ownerApp.inject({
      method: "POST",
      url: "/api/v1/evidence",
      payload: {
        evidenceType: "DELIVERY_RECORD",
        subjectType: "WORK_PACKAGE",
        subjectId: workPackageId,
        sourceSystem: "EMPLOYEE",
        normalizedPayload: { delivered: true },
        submittedBy: MEMBER,
      },
    } as never);
    expect(impersonation.statusCode).toBe(403);

    const foreignSubject = await ownerApp.inject({
      method: "POST",
      url: "/api/v1/evidence",
      payload: {
        evidenceType: "DELIVERY_RECORD",
        subjectType: "WORK_PACKAGE",
        subjectId: "00000000-0000-4000-8000-000000000099",
        sourceSystem: "EMPLOYEE",
        normalizedPayload: { delivered: true },
      },
    } as never);
    expect(foreignSubject.statusCode).toBe(404);

    const created = await ownerApp.inject({
      method: "POST",
      url: "/api/v1/evidence",
      payload: {
        evidenceType: "DELIVERY_RECORD",
        subjectType: "WORK_PACKAGE",
        subjectId: workPackageId,
        sourceSystem: "EMPLOYEE",
        normalizedPayload: { delivered: true },
      },
    } as never);
    expect(created.statusCode).toBe(201);
    expect(created.json().data.submittedBy).toBe(OWNER);

    const ownerList = await ownerApp.inject({
      method: "GET",
      url: "/api/v1/evidence",
    } as never);
    expect(ownerList.json().data).toHaveLength(1);
    const memberList = await memberApp.inject({
      method: "GET",
      url: "/api/v1/evidence",
    } as never);
    expect(memberList.json().data).toHaveLength(0);

    const adminList = await call("GET", "/api/v1/evidence");
    expect(adminList.body.data).toHaveLength(1);
  });
});

describe("platform onboarding", () => {
  it("onboards tenants, users, memberships, persons and identity", async () => {
    const platformStore = new MemoryPlatformStore();
    const adminApp = buildApp(new Store(), undefined, undefined, platformStore);
    const adminCall = async (
      method: "GET" | "POST",
      url: string,
      payload?: Record<string, unknown>,
    ) => {
      const response = await adminApp.inject({ method, url, payload } as never);
      return { status: response.statusCode, body: response.json() };
    };

    const slug = `tenant-${Date.now()}`;
    const tenant = await adminCall("POST", "/api/v1/platform/tenants", {
      name: "Design partner",
      slug,
      defaultTimezone: "Asia/Shanghai",
    });
    expect(tenant.status).toBe(201);
    const tenantId = tenant.body.data.id as string;

    const user = await adminCall("POST", "/api/v1/platform/users", {
      authSubject: `subject-${Date.now()}`,
      displayName: "Tenant Admin",
      email: "admin@example.com",
    });
    expect(user.status).toBe(201);
    const userId = user.body.data.id as string;

    const membership = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/memberships`,
      {
        userId,
        roleCodes: ["admin", "finance"],
      },
    );
    expect(membership.status).toBe(201);
    expect(membership.body.data.roleCodes).toEqual(["admin", "finance"]);

    const memberships = await adminCall(
      "GET",
      `/api/v1/platform/tenants/${tenantId}/memberships`,
    );
    expect(memberships.body.data).toHaveLength(1);
    expect(memberships.body.data[0].userDisplayName).toBe("Tenant Admin");

    const person = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons`,
      {
        employeeCode: "E-100",
        displayName: "Tenant Employee",
        userId,
      },
    );
    expect(person.status).toBe(201);
    expect(person.body.data.userId).toBe(userId);
    expect(person.body.data.employmentStatus).toBe("ACTIVE");
    const personId = person.body.data.id as string;

    const duplicateCode = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons`,
      { employeeCode: "E-100", displayName: "Duplicate" },
    );
    expect(duplicateCode.status).toBe(409);

    const persons = await adminCall(
      "GET",
      `/api/v1/platform/tenants/${tenantId}/persons`,
    );
    expect(persons.body.data).toHaveLength(1);
    expect(persons.body.data[0].id).toBe(personId);

    const secondUser = await adminCall("POST", "/api/v1/platform/users", {
      authSubject: `subject-2-${Date.now()}`,
      displayName: "Tenant Manager",
    });
    const secondUserId = secondUser.body.data.id as string;
    await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/memberships`,
      { userId: secondUserId, roleCodes: ["manager"] },
    );

    const secondPerson = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons`,
      { employeeCode: "E-101", displayName: "Tenant Manager" },
    );
    const secondPersonId = secondPerson.body.data.id as string;
    const linked = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons/${secondPersonId}/link-user`,
      { userId: secondUserId },
    );
    expect(linked.status).toBe(200);
    expect(linked.body.data.userId).toBe(secondUserId);

    const relink = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons/${secondPersonId}/link-user`,
      { userId },
    );
    expect(relink.status).toBe(409);

    const missingPerson = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons/00000000-0000-4000-8000-0000000000ff/link-user`,
      { userId: secondUserId },
    );
    expect(missingPerson.status).toBe(404);

    const sales = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/org-nodes`,
      { name: "Sales", nodeType: "DEPARTMENT" },
    );
    expect(sales.status).toBe(201);
    expect(sales.body.data.path).toBe("/Sales");
    const salesId = sales.body.data.id as string;

    const enterprise = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/org-nodes`,
      { name: "Enterprise", nodeType: "TEAM", parentId: salesId },
    );
    expect(enterprise.status).toBe(201);
    expect(enterprise.body.data.path).toBe("/Sales/Enterprise");
    const enterpriseId = enterprise.body.data.id as string;

    const nodes = await adminCall(
      "GET",
      `/api/v1/platform/tenants/${tenantId}/org-nodes`,
    );
    expect(nodes.body.data).toHaveLength(2);
    expect(nodes.body.data[1].id).toBe(enterpriseId);

    const assignment = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons/${personId}/org-assignments`,
      {
        orgNodeId: enterpriseId,
        validFrom: "2026-01-01",
        allocation: "0.5",
      },
    );
    expect(assignment.status).toBe(201);
    expect(assignment.body.data.allocation).toBe("0.5");

    const badAssignment = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons/${personId}/org-assignments`,
      {
        orgNodeId: enterpriseId,
        validFrom: "2026-02-01",
        validTo: "2026-01-01",
      },
    );
    expect(badAssignment.status).toBe(400);

    const assignments = await adminCall(
      "GET",
      `/api/v1/platform/tenants/${tenantId}/persons/${personId}/org-assignments`,
    );
    expect(assignments.body.data).toHaveLength(1);
    expect(assignments.body.data[0].orgNodeId).toBe(enterpriseId);

    const manager = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons/${secondPersonId}/manager`,
      { managerPersonId: personId },
    );
    expect(manager.status).toBe(200);
    expect(manager.body.data.managerPersonId).toBe(personId);

    const cycle = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons/${personId}/manager`,
      { managerPersonId: secondPersonId },
    );
    expect(cycle.status).toBe(409);

    const selfManager = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons/${personId}/manager`,
      { managerPersonId: personId },
    );
    expect(selfManager.status).toBe(409);

    const personsWithManager = await adminCall(
      "GET",
      `/api/v1/platform/tenants/${tenantId}/persons`,
    );
    expect(
      personsWithManager.body.data.find(
        (candidate: { id: string }) => candidate.id === secondPersonId,
      ).managerPersonId,
    ).toBe(personId);

    const cleared = await adminCall(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons/${secondPersonId}/manager`,
      { managerPersonId: null },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.managerPersonId).toBeUndefined();

    const secondAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId,
          userId: secondUserId,
          roles: ["employee"],
        };
      },
    };
    const secondApp = buildApp(
      new Store(),
      undefined,
      secondAuth,
      platformStore,
    );
    const identity = await secondApp.inject({
      method: "GET",
      url: "/api/v1/platform/identity",
    } as never);
    expect(identity.statusCode).toBe(200);
    expect(identity.json().data).toEqual({
      userId: secondUserId,
      personId: secondPersonId,
      roles: ["manager"],
    });

    const forbidden = await secondApp.inject({
      method: "GET",
      url: "/api/v1/platform/tenants",
    } as never);
    expect(forbidden.statusCode).toBe(403);

    const duplicate = await adminCall("POST", "/api/v1/platform/tenants", {
      name: "Duplicate",
      slug,
    });
    expect(duplicate.status).toBe(409);
  });
});

describe("employee notices and acknowledgements", () => {
  it("tracks coverage and gates the legal gate on required acknowledgements", async () => {
    const platformStore = new MemoryPlatformStore();
    const tenant = await platformStore.createTenant({
      name: "Notice tenant",
      slug: `notice-${Date.now()}`,
    });
    const first = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "N-001",
      displayName: "Notice Employee One",
    });
    const second = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "N-002",
      displayName: "Notice Employee Two",
    });

    const adminAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: tenant.id,
          userId: "notice-admin",
          roles: ["admin"],
        };
      },
    };
    const adminApp = buildApp(
      new Store(tenant.id),
      undefined,
      adminAuth,
      platformStore,
    );
    const adminCall = async (
      method: "GET" | "POST",
      url: string,
      payload?: Record<string, unknown>,
    ) => {
      const response = await adminApp.inject({ method, url, payload } as never);
      return { status: response.statusCode, body: response.json() };
    };

    const created = await adminCall("POST", "/api/v1/notices", {
      noticeType: "POLICY",
      title: "2026 incentive policy",
      bodyRef: "policy-notice-2026",
      policyVersionId: REFERENCE_POLICY_ID,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.acknowledgementRequired).toBe(true);
    const noticeId = created.body.data.id as string;

    const notices = await adminCall("GET", "/api/v1/notices");
    expect(notices.body.data).toHaveLength(1);
    const detail = await adminCall("GET", `/api/v1/notices/${noticeId}`);
    expect(detail.body.data.title).toBe("2026 incentive policy");

    const initial = await adminCall(
      "GET",
      `/api/v1/notices/${noticeId}/acknowledgements`,
    );
    expect(initial.body.data.summary).toMatchObject({
      personCount: 2,
      acknowledgedCount: 0,
      declinedCount: 0,
      pendingCount: 2,
      complete: false,
    });

    const gateBody = {
      employeeNoticeId: noticeId,
      democraticProcedureRef: "dp-1",
      dataProtectionAssessmentRef: "dpia-1",
      minimumWageChecked: true,
      policyApproved: true,
      recordedBy: first.id,
    };
    const incompleteGate = await adminCall(
      "POST",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/legal-gate`,
      gateBody,
    );
    expect(incompleteGate.status).toBe(409);

    const employeeAuth = (personId: string, userId: string): Authenticator => ({
      async authenticate() {
        return {
          tenantId: tenant.id,
          userId,
          roles: ["employee"],
          personId,
        };
      },
    });
    const firstApp = buildApp(
      new Store(tenant.id),
      undefined,
      employeeAuth(first.id, "notice-employee-1"),
      platformStore,
    );
    const secondApp = buildApp(
      new Store(tenant.id),
      undefined,
      employeeAuth(second.id, "notice-employee-2"),
      platformStore,
    );
    const firstCall = async (
      method: "GET" | "POST",
      url: string,
      payload?: Record<string, unknown>,
    ) => {
      const response = await firstApp.inject({ method, url, payload } as never);
      return { status: response.statusCode, body: response.json() };
    };

    const acknowledged = await firstCall(
      "POST",
      `/api/v1/notices/${noticeId}/acknowledgements`,
      {
        personId: first.id,
        decision: "ACKNOWLEDGE",
        signatureRef: "sig-1",
      },
    );
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.acknowledgedAt).toBeTruthy();

    const otherPerson = await firstCall(
      "POST",
      `/api/v1/notices/${noticeId}/acknowledgements`,
      { personId: second.id, decision: "ACKNOWLEDGE" },
    );
    expect(otherPerson.status).toBe(403);

    const missingReason = await firstCall(
      "POST",
      `/api/v1/notices/${noticeId}/acknowledgements`,
      { personId: first.id, decision: "DECLINE" },
    );
    expect(missingReason.status).toBe(400);

    const declined = await firstCall(
      "POST",
      `/api/v1/notices/${noticeId}/acknowledgements`,
      {
        personId: first.id,
        decision: "DECLINE",
        declineReason: "The metric is not agreed",
      },
    );
    expect(declined.status).toBe(200);
    expect(declined.body.data.declinedAt).toBeTruthy();

    const afterDecline = await adminCall(
      "GET",
      `/api/v1/notices/${noticeId}/acknowledgements`,
    );
    expect(afterDecline.body.data.summary).toMatchObject({
      acknowledgedCount: 0,
      declinedCount: 1,
      pendingCount: 1,
      complete: false,
    });

    await firstCall(
      "POST",
      `/api/v1/notices/${noticeId}/acknowledgements`,
      { personId: first.id, decision: "ACKNOWLEDGE", signatureRef: "sig-2" },
    );
    const secondAck = await secondApp.inject({
      method: "POST",
      url: `/api/v1/notices/${noticeId}/acknowledgements`,
      payload: { personId: second.id, decision: "ACKNOWLEDGE" },
    } as never);
    expect(secondAck.statusCode).toBe(200);

    const complete = await adminCall(
      "GET",
      `/api/v1/notices/${noticeId}/acknowledgements`,
    );
    expect(complete.body.data.summary).toMatchObject({
      acknowledgedCount: 2,
      declinedCount: 0,
      pendingCount: 0,
      complete: true,
    });

    const gate = await adminCall(
      "POST",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/legal-gate`,
      gateBody,
    );
    expect(gate.status).toBe(200);
    expect(gate.body.data.employeeNoticeRef).toBe(noticeId);

    const employeeCoverage = await firstApp.inject({
      method: "GET",
      url: `/api/v1/notices/${noticeId}/acknowledgements`,
    } as never);
    expect(employeeCoverage.statusCode).toBe(403);
  });
});

describe("employee representation and policy consultations", () => {
  it("requires a concluded consultation when the legal gate references one", async () => {
    const platformStore = new MemoryPlatformStore();
    const tenant = await platformStore.createTenant({
      name: "Consultation tenant",
      slug: `consult-${Date.now()}`,
    });
    const hrPerson = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "HR-001",
      displayName: "HR Lead",
    });
    const adminAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: tenant.id,
          userId: "consult-admin",
          roles: ["admin"],
        };
      },
    };
    const adminApp = buildApp(
      new Store(tenant.id),
      undefined,
      adminAuth,
      platformStore,
    );
    const adminCall = async (
      method: "GET" | "POST",
      url: string,
      payload?: Record<string, unknown>,
    ) => {
      const response = await adminApp.inject({ method, url, payload } as never);
      return { status: response.statusCode, body: response.json() };
    };

    const representative = await adminCall(
      "POST",
      "/api/v1/employee-representations",
      {
        bodyName: "Employee representative committee",
        bodyType: "WORKS_COUNCIL",
        jurisdiction: "CN",
      },
    );
    expect(representative.status).toBe(201);
    const representationId = representative.body.data.id as string;
    const representations = await adminCall(
      "GET",
      "/api/v1/employee-representations",
    );
    expect(representations.body.data).toHaveLength(1);

    const consultation = await adminCall(
      "POST",
      "/api/v1/policy-consultations",
      {
        policyVersionId: REFERENCE_POLICY_ID,
        representationId,
        consultationType: "NEGOTIATION",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    );
    expect(consultation.status).toBe(201);
    expect(consultation.body.data.outcome).toBe("PENDING");
    const consultationId = consultation.body.data.id as string;

    const filtered = await adminCall(
      "GET",
      `/api/v1/policy-consultations?policyVersionId=${REFERENCE_POLICY_ID}`,
    );
    expect(filtered.body.data).toHaveLength(1);
    const detail = await adminCall(
      "GET",
      `/api/v1/policy-consultations/${consultationId}`,
    );
    expect(detail.body.data.consultationType).toBe("NEGOTIATION");

    const gateBody = {
      democraticProcedureId: consultationId,
      employeeNoticeRef: "external-notice",
      dataProtectionAssessmentRef: "dpia-1",
      minimumWageChecked: true,
      policyApproved: true,
      recordedBy: hrPerson.id,
    };
    const earlyGate = await adminCall(
      "POST",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/legal-gate`,
      gateBody,
    );
    expect(earlyGate.status).toBe(409);

    const concluded = await adminCall(
      "POST",
      `/api/v1/policy-consultations/${consultationId}/conclude`,
      {
        endedAt: "2026-01-05T00:00:00.000Z",
        outcome: "AGREED",
        minutesRef: "minutes-1",
      },
    );
    expect(concluded.status).toBe(200);
    expect(concluded.body.data.outcome).toBe("AGREED");
    expect(concluded.body.data.minutesRef).toBe("minutes-1");

    const reconclude = await adminCall(
      "POST",
      `/api/v1/policy-consultations/${consultationId}/conclude`,
      {
        endedAt: "2026-01-06T00:00:00.000Z",
        outcome: "CLOSED",
      },
    );
    expect(reconclude.status).toBe(409);

    const gate = await adminCall(
      "POST",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/legal-gate`,
      gateBody,
    );
    expect(gate.status).toBe(200);
    expect(gate.body.data.democraticProcedureRef).toBe(consultationId);

    const otherPolicyConsultation = await adminCall(
      "POST",
      "/api/v1/policy-consultations",
      {
        policyVersionId: CHARGING_POLICY_ID,
        consultationType: "DISCUSSION",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    );
    expect(otherPolicyConsultation.status).toBe(201);
    const mismatch = await adminCall(
      "POST",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/legal-gate`,
      {
        ...gateBody,
        democraticProcedureId: otherPolicyConsultation.body.data.id,
      },
    );
    expect(mismatch.status).toBe(409);
  });
});

describe("DPIA records", () => {
  it("requires an approved assessment when the legal gate references one", async () => {
    const platformStore = new MemoryPlatformStore();
    const tenant = await platformStore.createTenant({
      name: "DPIA tenant",
      slug: `dpia-${Date.now()}`,
    });
    const approver = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "DPO-001",
      displayName: "Data Protection Officer",
    });
    const adminAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: tenant.id,
          userId: "dpia-admin",
          roles: ["admin"],
        };
      },
    };
    const adminApp = buildApp(
      new Store(tenant.id),
      undefined,
      adminAuth,
      platformStore,
    );
    const adminCall = async (
      method: "GET" | "POST",
      url: string,
      payload?: Record<string, unknown>,
    ) => {
      const response = await adminApp.inject({ method, url, payload } as never);
      return { status: response.statusCode, body: response.json() };
    };

    const created = await adminCall("POST", "/api/v1/dpia-records", {
      assessmentType: "DPIA",
      scope: "Incentive calculation and evidence processing",
      riskSummary: { automationBias: "mitigated by human review" },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("DRAFT");
    const dpiaId = created.body.data.id as string;

    const list = await adminCall("GET", "/api/v1/dpia-records");
    expect(list.body.data).toHaveLength(1);
    const detail = await adminCall("GET", `/api/v1/dpia-records/${dpiaId}`);
    expect(detail.body.data.scope).toContain("Incentive");

    const gateBody = {
      dataProtectionAssessmentId: dpiaId,
      democraticProcedureRef: "external-consultation",
      employeeNoticeRef: "external-notice",
      minimumWageChecked: true,
      policyApproved: true,
      recordedBy: approver.id,
    };
    const earlyGate = await adminCall(
      "POST",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/legal-gate`,
      gateBody,
    );
    expect(earlyGate.status).toBe(409);

    const approved = await adminCall(
      "POST",
      `/api/v1/dpia-records/${dpiaId}/approve`,
      { approvedBy: approver.id },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");
    expect(approved.body.data.approvedAt).toBeTruthy();

    const reapprove = await adminCall(
      "POST",
      `/api/v1/dpia-records/${dpiaId}/approve`,
      { approvedBy: approver.id },
    );
    expect(reapprove.status).toBe(409);

    const gateApproval = await adminCall(
      "POST",
      "/api/v1/approval-requests",
      {
        actionType: "LEGAL_GATE",
        targetType: "POLICY_VERSION",
        targetId: REFERENCE_POLICY_ID,
        requestedByType: "SYSTEM",
        riskTier: "T2",
        requiredApprovals: 1,
        payload: { policyVersionId: REFERENCE_POLICY_ID },
        idempotencyKey: `legal-gate-${dpiaId}`,
      },
    );
    await adminCall(
      "POST",
      `/api/v1/approval-requests/${gateApproval.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: approver.id,
        payloadHash: gateApproval.body.data.payloadHash,
      },
    );

    const gate = await adminCall(
      "POST",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/legal-gate`,
      {
        ...gateBody,
        approvalRequestId: gateApproval.body.data.id,
      },
    );
    expect(gate.status).toBe(200);
    expect(gate.body.data.dataProtectionAssessmentRef).toBe(dpiaId);
    const consumedGateApproval = await adminCall(
      "GET",
      `/api/v1/approval-requests/${gateApproval.body.data.id}`,
    );
    expect(consumedGateApproval.body.data.consumedAt).toBeTruthy();
  });
});

describe("DSAR requests", () => {
  it("lets employees request their own data and enforces resolution", async () => {
    const platformStore = new MemoryPlatformStore();
    const tenant = await platformStore.createTenant({
      name: "DSAR tenant",
      slug: `dsar-${Date.now()}`,
    });
    const first = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "D-001",
      displayName: "DSAR Employee One",
    });
    const second = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "D-002",
      displayName: "DSAR Employee Two",
    });
    const employeeAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: tenant.id,
          userId: "dsar-employee",
          roles: ["employee"],
          personId: first.id,
        };
      },
    };
    const employeeApp = buildApp(
      new Store(tenant.id),
      undefined,
      employeeAuth,
      platformStore,
    );
    const adminAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: tenant.id,
          userId: "dsar-admin",
          roles: ["admin"],
        };
      },
    };
    const adminApp = buildApp(
      new Store(tenant.id),
      undefined,
      adminAuth,
      platformStore,
    );
    const call = async (
      app: FastifyInstance,
      method: "GET" | "POST",
      url: string,
      payload?: Record<string, unknown>,
    ) => {
      const response = await app.inject({ method, url, payload } as never);
      return { status: response.statusCode, body: response.json() };
    };

    const created = await call(employeeApp, "POST", "/api/v1/dsar-requests", {
      requestType: "ACCESS",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.personId).toBe(first.id);
    expect(created.body.data.status).toBe("OPEN");
    const firstDsarId = created.body.data.id as string;

    const otherPerson = await call(
      employeeApp,
      "POST",
      "/api/v1/dsar-requests",
      { requestType: "DELETION", personId: second.id },
    );
    expect(otherPerson.status).toBe(403);

    const secondCreated = await call(
      adminApp,
      "POST",
      "/api/v1/dsar-requests",
      {
        requestType: "CORRECTION",
        personId: second.id,
        dueAt: "2026-02-01T00:00:00.000Z",
      },
    );
    expect(secondCreated.status).toBe(201);
    const secondDsarId = secondCreated.body.data.id as string;

    const ownList = await call(employeeApp, "GET", "/api/v1/dsar-requests");
    expect(ownList.body.data).toHaveLength(1);
    expect(ownList.body.data[0].id).toBe(firstDsarId);

    const hidden = await call(
      employeeApp,
      "GET",
      `/api/v1/dsar-requests/${secondDsarId}`,
    );
    expect(hidden.status).toBe(403);

    const allList = await call(adminApp, "GET", "/api/v1/dsar-requests");
    expect(allList.body.data).toHaveLength(2);

    const resolved = await call(
      adminApp,
      "POST",
      `/api/v1/dsar-requests/${firstDsarId}/resolve`,
      { resolution: "RESOLVED", resolutionRef: "DSAR-2026-001" },
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe("RESOLVED");
    expect(resolved.body.data.resolutionRef).toBe("DSAR-2026-001");
    expect(resolved.body.data.resolvedAt).toBeTruthy();

    const reresolve = await call(
      adminApp,
      "POST",
      `/api/v1/dsar-requests/${firstDsarId}/resolve`,
      { resolution: "REJECTED", resolutionRef: "DSAR-2026-001b" },
    );
    expect(reresolve.status).toBe(409);

    const ownDetail = await call(
      employeeApp,
      "GET",
      `/api/v1/dsar-requests/${firstDsarId}`,
    );
    expect(ownDetail.status).toBe(200);
    expect(ownDetail.body.data.status).toBe("RESOLVED");
  });
});

describe("recalculation requests", () => {
  it("validates targets, approves, completes and rejects requests", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    const { decisionId } = await createConfirmedClaim(
      workPackageId,
      OWNER,
    );
    const { decisionId: secondDecisionId } = await createConfirmedClaim(
      workPackageId,
      MEMBER,
    );
    await recordCompleteLegalGate();
    const run = await formalRun(workPackageId);
    expect(run.status).toBe(201);
    const runId = run.body.data.id as string;

    const invalid = await call("POST", "/api/v1/recalculation-requests", {
      targetType: "ATTRIBUTION",
      targetId: "00000000-0000-4000-8000-0000000000ff",
      reasonCode: "BAD_TARGET",
      explanation: "This attribution decision does not exist",
      requestedBy: ADJUDICATOR,
    });
    expect(invalid.status).toBe(404);

    const created = await call("POST", "/api/v1/recalculation-requests", {
      targetType: "ATTRIBUTION",
      targetId: decisionId,
      reasonCode: "ATTRIBUTION_ERROR",
      explanation: "The adjudicator missed the delivery evidence",
      requestedBy: ADJUDICATOR,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("OPEN");
    const requestId = created.body.data.id as string;

    const open = await call(
      "GET",
      "/api/v1/recalculation-requests?status=OPEN&targetType=ATTRIBUTION",
    );
    expect(open.body.data).toHaveLength(1);
    expect(open.body.data[0].id).toBe(requestId);

    const approved = await call(
      "POST",
      `/api/v1/recalculation-requests/${requestId}/approve`,
      { approvedBy: ADJUDICATOR },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");
    expect(approved.body.data.approvedAt).toBeTruthy();

    const reapprove = await call(
      "POST",
      `/api/v1/recalculation-requests/${requestId}/approve`,
      { approvedBy: ADJUDICATOR },
    );
    expect(reapprove.status).toBe(409);

    const completed = await call(
      "POST",
      `/api/v1/recalculation-requests/${requestId}/complete`,
      { newCalculationRunId: runId },
    );
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe("COMPLETED");
    expect(completed.body.data.newCalculationRunId).toBe(runId);

    const second = await call("POST", "/api/v1/recalculation-requests", {
      targetType: "ATTRIBUTION",
      targetId: secondDecisionId,
      reasonCode: "ATTRIBUTION_ERROR",
      explanation: "The second decision also needs review",
      requestedBy: ADJUDICATOR,
    });
    const rejected = await call(
      "POST",
      `/api/v1/recalculation-requests/${second.body.data.id}/reject`,
      { approvedBy: ADJUDICATOR },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("REJECTED");

    const approveRejected = await call(
      "POST",
      `/api/v1/recalculation-requests/${second.body.data.id}/approve`,
      { approvedBy: ADJUDICATOR },
    );
    expect(approveRejected.status).toBe(409);
  });
});

describe("retention policies", () => {
  it("creates policies by category and toggles legal hold", async () => {
    const platformStore = new MemoryPlatformStore();
    const tenant = await platformStore.createTenant({
      name: "Retention tenant",
      slug: `retention-${Date.now()}`,
    });
    const adminAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: tenant.id,
          userId: "retention-admin",
          roles: ["admin"],
        };
      },
    };
    const adminApp = buildApp(
      new Store(tenant.id),
      undefined,
      adminAuth,
      platformStore,
    );
    const call = async (
      method: "GET" | "POST",
      url: string,
      payload?: Record<string, unknown>,
    ) => {
      const response = await adminApp.inject({ method, url, payload } as never);
      return { status: response.statusCode, body: response.json() };
    };

    const created = await call("POST", "/api/v1/retention-policies", {
      dataCategory: "EVIDENCE",
      retentionMonths: 24,
      legalBasis: "Employment contract and statutory limitation",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.legalHold).toBe(false);
    const policyId = created.body.data.id as string;

    const duplicate = await call("POST", "/api/v1/retention-policies", {
      dataCategory: "EVIDENCE",
      retentionMonths: 12,
      legalBasis: "Duplicate",
    });
    expect(duplicate.status).toBe(409);

    const policies = await call("GET", "/api/v1/retention-policies");
    expect(policies.body.data).toHaveLength(1);
    expect(policies.body.data[0].retentionMonths).toBe(24);

    const report = await call(
      "GET",
      "/api/v1/retention-policies/report",
    );
    expect(report.status).toBe(200);
    expect(report.body.data.policies).toHaveLength(1);
    expect(report.body.data.policies[0].cutoffDate).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    expect(report.body.data.policies[0].eligibleForDisposal).toBe(true);

    const held = await call(
      "POST",
      `/api/v1/retention-policies/${policyId}/legal-hold`,
      { legalHold: true },
    );
    expect(held.status).toBe(200);
    expect(held.body.data.legalHold).toBe(true);

    const heldReport = await call(
      "GET",
      "/api/v1/retention-policies/report",
    );
    expect(heldReport.body.data.policies[0].eligibleForDisposal).toBe(false);

    const missing = await call(
      "POST",
      "/api/v1/retention-policies/00000000-0000-4000-8000-0000000000ff/legal-hold",
      { legalHold: true },
    );
    expect(missing.status).toBe(404);
  });
});

describe("approval requests", () => {
  it("enforces idempotency, payload hash, separation of duties and consumption", async () => {
    const platformStore = new MemoryPlatformStore();
    const tenant = await platformStore.createTenant({
      name: "Approval tenant",
      slug: `approval-${Date.now()}`,
    });
    const requester = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "A-001",
      displayName: "Approval Requester",
    });
    const firstApprover = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "A-002",
      displayName: "First Approver",
    });
    const secondApprover = await platformStore.createPerson({
      tenantId: tenant.id,
      employeeCode: "A-003",
      displayName: "Second Approver",
    });
    const adminAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: tenant.id,
          userId: "approval-admin",
          roles: ["admin"],
        };
      },
    };
    const adminApp = buildApp(
      new Store(tenant.id),
      undefined,
      adminAuth,
      platformStore,
    );
    const call = async (
      method: "GET" | "POST",
      url: string,
      payload?: Record<string, unknown>,
    ) => {
      const response = await adminApp.inject({ method, url, payload } as never);
      return { status: response.statusCode, body: response.json() };
    };
    const targetId = "00000000-0000-4000-8000-0000000000aa";

    const created = await call("POST", "/api/v1/approval-requests", {
      actionType: "SETTLEMENT_LOCK",
      targetType: "SETTLEMENT_BATCH",
      targetId,
      requestedByType: "USER",
      requestedById: requester.id,
      riskTier: "T2",
      requiredApprovals: 2,
      payload: { batchId: targetId },
      idempotencyKey: "approval-1",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("PENDING");
    const requestId = created.body.data.id as string;
    const payloadHash = created.body.data.payloadHash as string;

    const replay = await call("POST", "/api/v1/approval-requests", {
      actionType: "SETTLEMENT_LOCK",
      targetType: "SETTLEMENT_BATCH",
      targetId,
      requestedByType: "USER",
      requestedById: requester.id,
      riskTier: "T2",
      requiredApprovals: 2,
      payload: { batchId: targetId },
      idempotencyKey: "approval-1",
    });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(requestId);

    const conflictingReplay = await call(
      "POST",
      "/api/v1/approval-requests",
      {
        actionType: "SETTLEMENT_LOCK",
        targetType: "SETTLEMENT_BATCH",
        targetId,
        requestedByType: "USER",
        requestedById: requester.id,
        riskTier: "T2",
        requiredApprovals: 2,
        payload: { batchId: "different" },
        idempotencyKey: "approval-1",
      },
    );
    expect(conflictingReplay.status).toBe(409);

    const selfApproval = await call(
      "POST",
      `/api/v1/approval-requests/${requestId}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: requester.id,
        payloadHash,
      },
    );
    expect(selfApproval.status).toBe(409);

    const wrongHash = await call(
      "POST",
      `/api/v1/approval-requests/${requestId}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: firstApprover.id,
        payloadHash: "sha256:deadbeef",
      },
    );
    expect(wrongHash.status).toBe(409);

    const firstDecision = await call(
      "POST",
      `/api/v1/approval-requests/${requestId}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: firstApprover.id,
        payloadHash,
      },
    );
    expect(firstDecision.status).toBe(200);
    expect(firstDecision.body.data.status).toBe("PENDING");
    expect(firstDecision.body.data.approvedCount).toBe(1);

    const duplicateDecision = await call(
      "POST",
      `/api/v1/approval-requests/${requestId}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: firstApprover.id,
        payloadHash,
      },
    );
    expect(duplicateDecision.status).toBe(409);

    const secondDecision = await call(
      "POST",
      `/api/v1/approval-requests/${requestId}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: secondApprover.id,
        payloadHash,
      },
    );
    expect(secondDecision.status).toBe(200);
    expect(secondDecision.body.data.status).toBe("APPROVED");
    expect(secondDecision.body.data.approvedCount).toBe(2);

    const decisions = await call(
      "GET",
      `/api/v1/approval-requests/${requestId}/decisions`,
    );
    expect(decisions.body.data).toHaveLength(2);

    const consumed = await call(
      "POST",
      `/api/v1/approval-requests/${requestId}/consume`,
      { consumedBy: secondApprover.id },
    );
    expect(consumed.status).toBe(200);
    expect(consumed.body.data.consumedAt).toBeTruthy();

    const reconsumed = await call(
      "POST",
      `/api/v1/approval-requests/${requestId}/consume`,
      { consumedBy: secondApprover.id },
    );
    expect(reconsumed.status).toBe(409);

    const rejectedRequest = await call(
      "POST",
      "/api/v1/approval-requests",
      {
        actionType: "SETTLEMENT_LOCK",
        targetType: "SETTLEMENT_BATCH",
        targetId,
        requestedByType: "USER",
        requestedById: requester.id,
        riskTier: "T2",
        requiredApprovals: 1,
        payload: { batchId: "reject-me" },
        idempotencyKey: "approval-2",
      },
    );
    const rejected = await call(
      "POST",
      `/api/v1/approval-requests/${rejectedRequest.body.data.id}/decide`,
      {
        decision: "REJECT",
        approverPersonId: firstApprover.id,
        payloadHash: rejectedRequest.body.data.payloadHash,
        reason: "Amount not verified",
      },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("REJECTED");

    const expiredRequest = await call(
      "POST",
      "/api/v1/approval-requests",
      {
        actionType: "SETTLEMENT_LOCK",
        targetType: "SETTLEMENT_BATCH",
        targetId,
        requestedByType: "USER",
        requestedById: requester.id,
        riskTier: "T2",
        requiredApprovals: 1,
        expiresAt: "2020-01-01T00:00:00.000Z",
        payload: { batchId: "expired" },
        idempotencyKey: "approval-3",
      },
    );
    const expired = await call(
      "POST",
      `/api/v1/approval-requests/${expiredRequest.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: firstApprover.id,
        payloadHash: expiredRequest.body.data.payloadHash,
      },
    );
    expect(expired.status).toBe(409);
    const expiredList = await call(
      "GET",
      "/api/v1/approval-requests?status=EXPIRED",
    );
    expect(expiredList.body.data).toHaveLength(1);
  });
});

describe("budget pools and cash gates", () => {
  it("enforces approval, allocation limits and cash-gate uniqueness", async () => {
    const created = await call("POST", "/api/v1/budget-pools", {
      cycleId: CYCLE,
      code: "CORE",
      name: "Core incentive pool",
      poolType: "STANDARD",
      currency: "CNY",
      approvedAmount: "10000",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("DRAFT");
    expect(created.body.data.committedAmount).toBe("0");
    const poolId = created.body.data.id as string;

    const duplicate = await call("POST", "/api/v1/budget-pools", {
      cycleId: CYCLE,
      code: "CORE",
      name: "Duplicate",
      poolType: "STANDARD",
      currency: "CNY",
      approvedAmount: "1",
    });
    expect(duplicate.status).toBe(409);

    const earlyAllocation = await call(
      "POST",
      `/api/v1/budget-pools/${poolId}/allocations`,
      {
        targetType: "WORK_PACKAGE",
        targetId: "00000000-0000-4000-8000-000000000010",
        amount: "1000",
      },
    );
    expect(earlyAllocation.status).toBe(409);

    const approved = await call(
      "POST",
      `/api/v1/budget-pools/${poolId}/approve`,
      { approvedBy: ADJUDICATOR },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");

    const allocation = await call(
      "POST",
      `/api/v1/budget-pools/${poolId}/allocations`,
      {
        targetType: "WORK_PACKAGE",
        targetId: "00000000-0000-4000-8000-000000000010",
        amount: "6000",
      },
    );
    expect(allocation.status).toBe(201);
    expect(allocation.body.data.amount).toBe("6000");
    const allocationId = allocation.body.data.id as string;

    const pool = await call("GET", `/api/v1/budget-pools/${poolId}`);
    expect(pool.body.data.committedAmount).toBe("6000");
    expect(pool.body.data.allocations).toHaveLength(1);

    const overBudget = await call(
      "POST",
      `/api/v1/budget-pools/${poolId}/allocations`,
      {
        targetType: "WORK_PACKAGE",
        targetId: "00000000-0000-4000-8000-000000000011",
        amount: "5000",
      },
    );
    expect(overBudget.status).toBe(409);
    expect(overBudget.body.error.message).toContain("BUDGET_EXCEEDED");

    const released = await call(
      "POST",
      `/api/v1/budget-allocations/${allocationId}/release`,
    );
    expect(released.status).toBe(200);
    expect(released.body.data.status).toBe("RELEASED");
    const afterRelease = await call(
      "GET",
      `/api/v1/budget-pools/${poolId}`,
    );
    expect(afterRelease.body.data.committedAmount).toBe("0");

    const gate = await call("POST", "/api/v1/cash-gate-inputs", {
      cycleId: CYCLE,
      asOfDate: "2026-10-31",
      safetyReserveMonths: "3.5",
      thirteenWeekForecastRef: "forecast-1",
      passesGate: true,
      approvedBy: ADJUDICATOR,
    });
    expect(gate.status).toBe(201);
    expect(gate.body.data.passesGate).toBe(true);

    const duplicateGate = await call("POST", "/api/v1/cash-gate-inputs", {
      cycleId: CYCLE,
      asOfDate: "2026-10-31",
      safetyReserveMonths: "4",
      thirteenWeekForecastRef: "forecast-2",
      passesGate: false,
      approvedBy: ADJUDICATOR,
    });
    expect(duplicateGate.status).toBe(409);
    const gates = await call(
      "GET",
      `/api/v1/cash-gate-inputs?cycleId=${CYCLE}`,
    );
    expect(gates.body.data).toHaveLength(1);

    const fact = await call("POST", "/api/v1/financial-facts", {
      sourceSystem: "ERP",
      sourceRecordId: "INV-1",
      factType: "INVOICE_AMOUNT",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      amount: "12000",
      currency: "CNY",
      payload: { invoice: "INV-1" },
    });
    expect(fact.status).toBe(201);
    expect(fact.body.data.amount).toBe("12000");

    const factReplay = await call("POST", "/api/v1/financial-facts", {
      sourceSystem: "ERP",
      sourceRecordId: "INV-1",
      factType: "INVOICE_AMOUNT",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      amount: "13000",
      currency: "CNY",
      qualityStatus: "VALID",
      payload: { invoice: "INV-1", corrected: true },
    });
    expect(factReplay.status).toBe(201);
    expect(factReplay.body.data.id).toBe(fact.body.data.id);
    expect(factReplay.body.data.amount).toBe("13000");
    expect(factReplay.body.data.qualityStatus).toBe("VALID");

    const listedFacts = await call(
      "GET",
      "/api/v1/financial-facts?factType=INVOICE_AMOUNT",
    );
    expect(listedFacts.body.data).toHaveLength(1);
    expect(listedFacts.body.data[0].amount).toBe("13000");
  });
});

describe("policy governance", () => {
  it("runs rule change orders, test cases and notice links", async () => {
    const order = await call("POST", "/api/v1/rule-change-orders", {
      policyCode: "GENERIC_CONTRIBUTION_V1",
      toPolicyVersionId: CHARGING_POLICY_ID,
      changeType: "POOL_RATE",
      reason: "Align the pool with the approved plan",
      impactSimulation: { affectedPeople: 3 },
      effectiveFrom: "2026-11-01T00:00:00.000Z",
      requestedBy: ADJUDICATOR,
    });
    expect(order.status).toBe(201);
    expect(order.body.data.status).toBe("DRAFT");
    const orderId = order.body.data.id as string;

    const selfApproval = await call(
      "POST",
      `/api/v1/rule-change-orders/${orderId}/approve`,
      { approvedBy: ADJUDICATOR },
    );
    expect(selfApproval.status).toBe(409);

    const approved = await call(
      "POST",
      `/api/v1/rule-change-orders/${orderId}/approve`,
      { approvedBy: OWNER },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");

    const publicized = await call(
      "POST",
      `/api/v1/rule-change-orders/${orderId}/publicize`,
    );
    expect(publicized.status).toBe(200);
    expect(publicized.body.data.status).toBe("PUBLICIZED");
    expect(publicized.body.data.publicizedAt).toBeTruthy();

    const rejectedOrder = await call(
      "POST",
      "/api/v1/rule-change-orders",
      {
        policyCode: "GENERIC_CONTRIBUTION_V1",
        toPolicyVersionId: REFERENCE_POLICY_ID,
        changeType: "POOL_CAP",
        reason: "Rejected change",
        effectiveFrom: "2026-12-01T00:00:00.000Z",
        requestedBy: ADJUDICATOR,
      },
    );
    const rejected = await call(
      "POST",
      `/api/v1/rule-change-orders/${rejectedOrder.body.data.id}/reject`,
      { approvedBy: OWNER },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("REJECTED");

    const listedOrders = await call(
      "GET",
      "/api/v1/rule-change-orders?status=PUBLICIZED",
    );
    expect(listedOrders.body.data).toHaveLength(1);

    const testCase = await call("POST", "/api/v1/policy-test-cases", {
      policyVersionId: REFERENCE_POLICY_ID,
      caseCode: "CASE-1",
      input: { grossProfit: "100000", weight: "1" },
      expectedOutput: { roundedAmount: "5000" },
      category: "NORMAL",
    });
    expect(testCase.status).toBe(201);
    expect(testCase.body.data.status).toBe("ACTIVE");
    const testCaseId = testCase.body.data.id as string;

    const duplicateCase = await call(
      "POST",
      "/api/v1/policy-test-cases",
      {
        policyVersionId: REFERENCE_POLICY_ID,
        caseCode: "CASE-1",
        input: {},
        expectedOutput: {},
        category: "BOUNDARY",
      },
    );
    expect(duplicateCase.status).toBe(409);

    const cases = await call(
      "GET",
      `/api/v1/policy-test-cases?policyVersionId=${REFERENCE_POLICY_ID}`,
    );
    expect(cases.body.data).toHaveLength(1);

    const retired = await call(
      "POST",
      `/api/v1/policy-test-cases/${testCaseId}/retire`,
    );
    expect(retired.status).toBe(200);
    expect(retired.body.data.status).toBe("RETIRED");
    const reRetire = await call(
      "POST",
      `/api/v1/policy-test-cases/${testCaseId}/retire`,
    );
    expect(reRetire.status).toBe(409);

    const notice = await call("POST", "/api/v1/notices", {
      noticeType: "POLICY",
      title: "Rule change notice",
      bodyRef: "rule-change-notice",
      effectiveFrom: "2026-11-01T00:00:00.000Z",
    });
    expect(notice.status).toBe(201);
    const link = await call("POST", "/api/v1/policy-notices", {
      policyVersionId: REFERENCE_POLICY_ID,
      noticeId: notice.body.data.id,
      audience: { group: "all" },
    });
    expect(link.status).toBe(201);
    const duplicateLink = await call("POST", "/api/v1/policy-notices", {
      policyVersionId: REFERENCE_POLICY_ID,
      noticeId: notice.body.data.id,
    });
    expect(duplicateLink.status).toBe(409);
    const links = await call(
      "GET",
      `/api/v1/policy-notices?policyVersionId=${REFERENCE_POLICY_ID}`,
    );
    expect(links.body.data).toHaveLength(1);
    expect(links.body.data[0].audience).toEqual({ group: "all" });

    const metric = await call("POST", "/api/v1/metric-definitions", {
      code: "GP_MARGIN",
      version: 1,
      name: "Gross profit margin",
      dataType: "DECIMAL",
      aggregationMethod: "SUM",
      effectiveFrom: "2026-01-01",
    });
    expect(metric.status).toBe(201);
    expect(metric.body.data.active).toBe(true);
    const metricId = metric.body.data.id as string;

    const duplicateMetric = await call(
      "POST",
      "/api/v1/metric-definitions",
      {
        code: "GP_MARGIN",
        version: 1,
        name: "Duplicate",
        dataType: "DECIMAL",
        effectiveFrom: "2026-01-01",
      },
    );
    expect(duplicateMetric.status).toBe(409);

    const metrics = await call(
      "GET",
      "/api/v1/metric-definitions?code=GP_MARGIN",
    );
    expect(metrics.body.data).toHaveLength(1);

    const retiredMetric = await call(
      "POST",
      `/api/v1/metric-definitions/${metricId}/retire`,
    );
    expect(retiredMetric.status).toBe(200);
    expect(retiredMetric.body.data.active).toBe(false);
    const reRetireMetric = await call(
      "POST",
      `/api/v1/metric-definitions/${metricId}/retire`,
    );
    expect(reRetireMetric.status).toBe(409);
  });

  it("requires a passing test suite before change approval when configured", async () => {
    await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/settings",
      { requirePolicyTestsBeforeApproval: true },
    );
    const order = await call("POST", "/api/v1/rule-change-orders", {
      policyCode: "GENERIC_CONTRIBUTION_V1",
      toPolicyVersionId: REFERENCE_POLICY_ID,
      changeType: "POOL_RATE",
      reason: "Test-gated change",
      impactSimulation: { affectedPeople: 1 },
      effectiveFrom: "2027-01-01T00:00:00Z",
      requestedBy: ADJUDICATOR,
    });
    expect(order.status).toBe(201);
    const orderId = order.body.data.id as string;
    const input = {
      cycleId: CYCLE,
      order: {
        id: "gate-order-1",
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
    };

    const noCases = await call(
      "POST",
      `/api/v1/rule-change-orders/${orderId}/approve`,
      { approvedBy: OWNER },
    );
    expect(noCases.status).toBe(409);
    expect(noCases.body.error.message).toContain("POLICY_TESTS_REQUIRED");

    const failing = await call("POST", "/api/v1/policy-test-cases", {
      policyVersionId: REFERENCE_POLICY_ID,
      caseCode: "GATE-FAIL",
      input,
      expectedOutput: { poolRounded: "5001" },
      category: "BOUNDARY",
    });
    const failedApproval = await call(
      "POST",
      `/api/v1/rule-change-orders/${orderId}/approve`,
      { approvedBy: OWNER },
    );
    expect(failedApproval.status).toBe(409);
    expect(failedApproval.body.error.message).toContain(
      "POLICY_TESTS_FAILED: GATE-FAIL",
    );

    await call(
      "POST",
      `/api/v1/policy-test-cases/${failing.body.data.id}/retire`,
    );
    await call("POST", "/api/v1/policy-test-cases", {
      policyVersionId: REFERENCE_POLICY_ID,
      caseCode: "GATE-PASS",
      input,
      expectedOutput: { poolRounded: "5000" },
      category: "NORMAL",
    });
    const approved = await call(
      "POST",
      `/api/v1/rule-change-orders/${orderId}/approve`,
      { approvedBy: OWNER },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");

    const history = await call(
      "GET",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/test-runs`,
    );
    expect(history.body.data.length).toBeGreaterThanOrEqual(3);
  });
});

describe("equity ledger", () => {
  it("vests grants and enforces exercise approval separation", async () => {
    const grant = await call("POST", "/api/v1/equity-grants", {
      personId: OWNER,
      grantCode: "OPT-2026-001",
      grantType: "OPTION",
      totalUnits: "10000",
      strikePrice: "1.5",
      currency: "CNY",
      grantDate: "2025-01-01T00:00:00Z",
      vestingStart: "2025-01-01T00:00:00Z",
      cliffMonths: 12,
      vestingMonths: 48,
    });
    expect(grant.status).toBe(201);
    expect(grant.body.data.status).toBe("ACTIVE");
    const grantId = grant.body.data.id as string;
    const duplicate = await call("POST", "/api/v1/equity-grants", {
      personId: OWNER,
      grantCode: "OPT-2026-001",
      grantType: "OPTION",
      totalUnits: "100",
      strikePrice: "1",
      currency: "CNY",
      grantDate: "2026-01-01T00:00:00Z",
      vestingStart: "2026-01-01T00:00:00Z",
      cliffMonths: 0,
      vestingMonths: 12,
    });
    expect(duplicate.status).toBe(409);

    const beforeCliff = await call(
      "GET",
      `/api/v1/equity-grants/${grantId}/vesting?asOf=2025-06-01T00:00:00Z`,
    );
    expect(beforeCliff.body.data.vestedUnits).toBe("0");
    expect(beforeCliff.body.data.nextVestAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    const atCliff = await call(
      "GET",
      `/api/v1/equity-grants/${grantId}/vesting?asOf=2026-01-01T00:00:00Z`,
    );
    expect(atCliff.body.data.vestedUnits).toBe("2500");
    expect(atCliff.body.data.availableUnits).toBe("2500");

    const exercise = await call(
      "POST",
      `/api/v1/equity-grants/${grantId}/exercises`,
      { units: "1000", requestedBy: OWNER },
    );
    expect(exercise.status).toBe(201);
    expect(exercise.body.data.totalCost).toBe("1500");
    expect(exercise.body.data.status).toBe("PENDING");
    const excessive = await call(
      "POST",
      `/api/v1/equity-grants/${grantId}/exercises`,
      { units: "5000", requestedBy: OWNER },
    );
    expect(excessive.status).toBe(409);
    expect(excessive.body.error.message).toContain(
      "EQ_UNITS_EXCEED_AVAILABLE",
    );

    const selfApproval = await call(
      "POST",
      `/api/v1/equity-exercises/${exercise.body.data.id}/approve`,
      { approvedBy: OWNER },
    );
    expect(selfApproval.status).toBe(409);
    const approved = await call(
      "POST",
      `/api/v1/equity-exercises/${exercise.body.data.id}/approve`,
      { approvedBy: ADJUDICATOR },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");
    const settled = await call(
      "POST",
      `/api/v1/equity-exercises/${exercise.body.data.id}/settle`,
    );
    expect(settled.status).toBe(200);
    expect(settled.body.data.status).toBe("SETTLED");
    const reSettle = await call(
      "POST",
      `/api/v1/equity-exercises/${exercise.body.data.id}/settle`,
    );
    expect(reSettle.status).toBe(409);

    const grants = await call(
      "GET",
      `/api/v1/equity-grants?personId=${OWNER}`,
    );
    expect(grants.body.data).toHaveLength(1);
    const exercises = await call(
      "GET",
      `/api/v1/equity-exercises?grantId=${grantId}`,
    );
    expect(exercises.body.data).toHaveLength(1);
  });
});

describe("bounty marketplace", () => {
  it("runs bounty claim, submission and acceptance", async () => {
    const bounty = await call("POST", "/api/v1/bounties", {
      title: "Evidence cleanup",
      description: "Close missing evidence on pilot orders",
      rewardAmount: "5000",
      currency: "CNY",
      createdBy: ADJUDICATOR,
    });
    expect(bounty.status).toBe(201);
    expect(bounty.body.data.status).toBe("OPEN");
    const bountyId = bounty.body.data.id as string;

    const claimed = await call(
      "POST",
      `/api/v1/bounties/${bountyId}/claim`,
      { personId: OWNER },
    );
    expect(claimed.status).toBe(200);
    expect(claimed.body.data.status).toBe("CLAIMED");
    expect(claimed.body.data.assigneePersonId).toBe(OWNER);

    const submitted = await call(
      "POST",
      `/api/v1/bounties/${bountyId}/submit`,
      { personId: OWNER, submissionRef: "evidence-pack-1" },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe("SUBMITTED");

    const selfAccept = await call(
      "POST",
      `/api/v1/bounties/${bountyId}/accept`,
      { reviewerPersonId: OWNER },
    );
    expect(selfAccept.status).toBe(409);
    expect(selfAccept.body.error.message).toContain(
      "BOUNTY_SELF_ACCEPTANCE",
    );
    const accepted = await call(
      "POST",
      `/api/v1/bounties/${bountyId}/accept`,
      {
        reviewerPersonId: ADJUDICATOR,
        paymentRef: "PAY-001",
      },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe("ACCEPTED");
    expect(accepted.body.data.paymentRef).toBe("PAY-001");
    const cancelAccepted = await call(
      "POST",
      `/api/v1/bounties/${bountyId}/cancel`,
    );
    expect(cancelAccepted.status).toBe(409);

    const second = await call("POST", "/api/v1/bounties", {
      title: "Archive sprint",
      description: "Archive old evidence",
      rewardAmount: "1000",
      currency: "CNY",
      createdBy: ADJUDICATOR,
    });
    const cancelled = await call(
      "POST",
      `/api/v1/bounties/${second.body.data.id}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
    const acceptedList = await call(
      "GET",
      "/api/v1/bounties?status=ACCEPTED",
    );
    expect(acceptedList.body.data).toHaveLength(1);
  });
});

describe("payroll", () => {
  it("calculates payroll and blocks sub-minimum lines", async () => {
    const contract = await call(
      "POST",
      "/api/v1/employment-contracts",
      {
        personId: OWNER,
        contractCode: "CT-2026-001",
        employmentType: "FULL_TIME",
        startDate: "2025-01-01T00:00:00Z",
        workLocation: "Shanghai",
        currency: "CNY",
        fixedMonthlySalary: "8000",
        minimumMonthlyWage: "2690",
        taxRate: "0.1",
        socialInsuranceRate: "0.05",
        bankAccountRef: "BANK-001",
        consentSignatureRef: "ESIGN-001",
      },
    );
    expect(contract.status).toBe(201);
    const duplicate = await call(
      "POST",
      "/api/v1/employment-contracts",
      {
        personId: OWNER,
        contractCode: "CT-2026-001",
        employmentType: "FULL_TIME",
        startDate: "2025-01-01T00:00:00Z",
        workLocation: "Shanghai",
        currency: "CNY",
        fixedMonthlySalary: "8000",
        minimumMonthlyWage: "2690",
        consentSignatureRef: "ESIGN-001",
      },
    );
    expect(duplicate.status).toBe(409);

    const run = await call("POST", "/api/v1/payroll-runs", {
      cycleId: CYCLE,
      periodStart: "2026-10-01T00:00:00Z",
      periodEnd: "2026-10-31T23:59:59Z",
      currency: "CNY",
      preparedBy: ADJUDICATOR,
    });
    expect(run.status).toBe(201);
    const runId = run.body.data.id as string;
    const calculated = await call(
      "POST",
      `/api/v1/payroll-runs/${runId}/calculate`,
    );
    expect(calculated.status).toBe(200);
    expect(calculated.body.data.status).toBe("CALCULATED");
    expect(calculated.body.data.lineCount).toBe(1);
    expect(calculated.body.data.totalGross).toBe("8000");
    expect(calculated.body.data.totalTax).toBe("800");
    expect(calculated.body.data.totalSocialInsurance).toBe("400");
    expect(calculated.body.data.totalNet).toBe("6800");
    expect(calculated.body.data.blockedCount).toBe(0);
    const selfApproval = await call(
      "POST",
      `/api/v1/payroll-runs/${runId}/approve`,
      { approvedBy: ADJUDICATOR },
    );
    expect(selfApproval.status).toBe(409);
    const approved = await call(
      "POST",
      `/api/v1/payroll-runs/${runId}/approve`,
      { approvedBy: OWNER },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");
    const paid = await call(
      "POST",
      `/api/v1/payroll-runs/${runId}/pay`,
    );
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe("PAID");
    const exported = await app.inject({
      method: "GET",
      url: `/api/v1/payroll-runs/${runId}/export`,
    } as never);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.body).toContain(
      "run_id,person_id,currency,fixed_amount",
    );
    expect(exported.body).toContain(",8000,");
    const bankFile = await app.inject({
      method: "GET",
      url: `/api/v1/payroll-runs/${runId}/bank-file`,
    } as never);
    expect(bankFile.statusCode).toBe(200);
    expect(bankFile.body).toContain("6800");
    expect(bankFile.body).toContain("BANK-001");
    const payslip = await app.inject({
      method: "GET",
      url: `/api/v1/payroll-runs/${runId}/payslips/${OWNER}`,
    } as never);
    expect(payslip.statusCode).toBe(200);
    expect(payslip.headers["content-type"]).toContain("text/html");
    expect(payslip.body).toContain("Payslip");
    expect(payslip.body).toContain("6800");
    const reversed = await call(
      "POST",
      `/api/v1/payroll-runs/${runId}/reverse`,
      { reason: "CORRECTION", reversedBy: OWNER },
    );
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.status).toBe("REVERSED");
    const reReversed = await call(
      "POST",
      `/api/v1/payroll-runs/${runId}/reverse`,
      { reason: "AGAIN", reversedBy: OWNER },
    );
    expect(reReversed.status).toBe(409);

    await call("POST", "/api/v1/employment-contracts", {
      personId: MEMBER,
      contractCode: "CT-2026-002",
      employmentType: "PART_TIME",
      startDate: "2025-01-01T00:00:00Z",
      workLocation: "Shanghai",
      currency: "CNY",
      fixedMonthlySalary: "1000",
      minimumMonthlyWage: "2690",
      consentSignatureRef: "ESIGN-002",
    });
    const blockedRun = await call("POST", "/api/v1/payroll-runs", {
      cycleId: CYCLE,
      periodStart: "2026-10-01T00:00:00Z",
      periodEnd: "2026-10-31T23:59:59Z",
      currency: "CNY",
      preparedBy: ADJUDICATOR,
    });
    const blocked = await call(
      "POST",
      `/api/v1/payroll-runs/${blockedRun.body.data.id}/calculate`,
    );
    expect(blocked.body.data.status).toBe("BLOCKED");
    expect(blocked.body.data.blockedCount).toBe(1);
    const blockedApproval = await call(
      "POST",
      `/api/v1/payroll-runs/${blockedRun.body.data.id}/approve`,
      { approvedBy: OWNER },
    );
    expect(blockedApproval.status).toBe(409);
  });

  it("records contract amendments only with consent evidence", async () => {
    const contract = await call("POST", "/api/v1/employment-contracts", {
      personId: OWNER,
      contractCode: "CT-AMEND-2026",
      employmentType: "FULL_TIME",
      startDate: "2025-01-01T00:00:00Z",
      workLocation: "Shanghai",
      currency: "CNY",
      fixedMonthlySalary: "9000",
      minimumMonthlyWage: "2690",
      taxRate: "0.1",
      socialInsuranceRate: "0.05",
      deductionCapRate: "0.2",
      consentSignatureRef: "ESIGN-AMEND-1",
    });
    expect(contract.status).toBe(201);
    const contractId = contract.body.data.id as string;

    const future = await call(
      "POST",
      `/api/v1/employment-contracts/${contractId}/amendments`,
      {
        fixedMonthlySalary: "10000",
        minimumMonthlyWage: "2800",
        taxRate: "0.12",
        socialInsuranceRate: "0.06",
        deductionCapRate: "0.2",
        variableShareCapRate: "0.5",
        effectiveFrom: "2027-01-01T00:00:00Z",
        consentSignatureRef: "ESIGN-AMEND-2",
        approvedBy: ADJUDICATOR,
      },
    );
    expect(future.status).toBe(409);
    expect(future.body.error.message).toContain(
      "CONTRACT_AMENDMENT_FUTURE_EFFECTIVE_UNSUPPORTED",
    );

    const amended = await call(
      "POST",
      `/api/v1/employment-contracts/${contractId}/amendments`,
      {
        fixedMonthlySalary: "10000",
        minimumMonthlyWage: "2800",
        taxRate: "0.12",
        socialInsuranceRate: "0.06",
        deductionCapRate: "0.2",
        variableShareCapRate: "0.5",
        effectiveFrom: "2026-01-01T00:00:00Z",
        consentSignatureRef: "ESIGN-AMEND-2",
        approvedBy: ADJUDICATOR,
      },
    );
    expect(amended.status).toBe(200);
    expect(amended.body.data.fixedMonthlySalary).toBe("10000");
    expect(amended.body.data.payPlanVersion).toBe(2);
    expect(amended.body.data.version).toBe(2);
    expect(amended.body.data.consentSignatureRef).toBe("ESIGN-AMEND-2");

    const history = await call(
      "GET",
      `/api/v1/employment-contracts/${contractId}/amendments`,
    );
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].beforeTerms.fixedMonthlySalary).toBe("9000");
    expect(history.body.data[0].afterTerms.fixedMonthlySalary).toBe("10000");
  });
});

describe("adverse action workflow", () => {
  it("requires independent legal review and approval, and never self-approves", async () => {
    const approver = await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/persons",
      {
        employeeCode: "ADV-4",
        displayName: "Independent Approver",
      },
    );
    expect(approver.status).toBe(201);
    const approverId = approver.body.data.id as string;

    const created = await call("POST", "/api/v1/adverse-actions", {
      personId: MEMBER,
      actionType: "PIP",
      reason: "Repeated missed handovers",
      performanceBasis: "Two consecutive review cycles and a documented coaching plan",
      evidenceRefs: [],
      requestedBy: ADJUDICATOR,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("DRAFT");
    const actionId = created.body.data.id as string;

    const selfReview = await call(
      "POST",
      `/api/v1/adverse-actions/${actionId}/legal-review`,
      {
        legalReviewerId: ADJUDICATOR,
        legalReviewRef: "LEGAL-SELF",
        decision: "APPROVE",
      },
    );
    expect(selfReview.status).toBe(409);
    expect(selfReview.body.error.message).toContain(
      "ADVERSE_ACTION_SELF_REVIEW",
    );

    const reviewed = await call(
      "POST",
      `/api/v1/adverse-actions/${actionId}/legal-review`,
      {
        legalReviewerId: OWNER,
        legalReviewRef: "LEGAL-2026-01",
        decision: "APPROVE",
      },
    );
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.status).toBe("LEGAL_REVIEW");

    const selfApproval = await call(
      "POST",
      `/api/v1/adverse-actions/${actionId}/approve`,
      { approvedBy: ADJUDICATOR },
    );
    expect(selfApproval.status).toBe(409);
    expect(selfApproval.body.error.message).toContain(
      "ADVERSE_ACTION_SEPARATION_REQUIRED",
    );

    const approved = await call(
      "POST",
      `/api/v1/adverse-actions/${actionId}/approve`,
      { approvedBy: approverId },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");

    const activated = await call(
      "POST",
      `/api/v1/adverse-actions/${actionId}/activate`,
      { effectiveFrom: "2026-10-01T00:00:00Z" },
    );
    expect(activated.status).toBe(200);
    expect(activated.body.data.status).toBe("ACTIVE");

    const completed = await call(
      "POST",
      `/api/v1/adverse-actions/${actionId}/complete`,
    );
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe("COMPLETED");

    const cancelAfterComplete = await call(
      "POST",
      `/api/v1/adverse-actions/${actionId}/cancel`,
      { reason: "Too late" },
    );
    expect(cancelAfterComplete.status).toBe(409);
  });
});

describe("statutory payroll tax", () => {
  it("applies cumulative China IIT brackets and subtracts prior withholding", async () => {
    const result = await call("POST", "/api/v1/tax/cn-iit/calculate", {
      cumulativeTaxableIncome: "40000",
      taxAlreadyWithheld: "1000",
    });
    expect(result.status).toBe(200);
    expect(result.body.data.annualTaxDue).toBe("1480");
    expect(result.body.data.taxForPeriod).toBe("480");
    expect(result.body.data.ratePercent).toBe(10);
    expect(result.body.data.quickDeduction).toBe("2520");

    const topBracket = await call("POST", "/api/v1/tax/cn-iit/calculate", {
      cumulativeTaxableIncome: "1000000",
    });
    expect(topBracket.body.data.ratePercent).toBe(45);
    expect(topBracket.body.data.annualTaxDue).toBe("268080");
  });

  it("rejects an invalid decimal and treats non-positive income as zero", async () => {
    const invalid = await call("POST", "/api/v1/tax/cn-iit/calculate", {
      cumulativeTaxableIncome: "not-a-number",
    });
    expect(invalid.status).toBe(400);
    const zero = await call("POST", "/api/v1/tax/cn-iit/calculate", {
      cumulativeTaxableIncome: "0",
      taxAlreadyWithheld: "500",
    });
    expect(zero.status).toBe(200);
    expect(zero.body.data.annualTaxDue).toBe("0");
    expect(zero.body.data.taxForPeriod).toBe("0");
  });
});

describe("deliverables and acceptance", () => {
  it("submits deliverables and records acceptance with separation of duties", async () => {
    const workPackageId = await createAcceptedWorkPackage();

    const created = await call(
      "POST",
      `/api/v1/work-packages/${workPackageId}/deliverables`,
      {
        title: "Signed acceptance certificate",
        deliverableType: "DOCUMENT",
        ownerPersonId: OWNER,
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("DRAFT");
    expect(created.body.data.version).toBe(1);
    const deliverableId = created.body.data.id as string;

    const submitted = await call(
      "POST",
      `/api/v1/deliverables/${deliverableId}/submit`,
      { artifactRef: "s3://docs/certificate.pdf" },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe("SUBMITTED");
    expect(submitted.body.data.submittedAt).toBeTruthy();

    const selfReview = await call(
      "POST",
      `/api/v1/deliverables/${deliverableId}/acceptance`,
      {
        decision: "ACCEPT",
        reviewerPersonId: OWNER,
      },
    );
    expect(selfReview.status).toBe(409);

    const accepted = await call(
      "POST",
      `/api/v1/deliverables/${deliverableId}/acceptance`,
      {
        decision: "ACCEPT_WITH_ISSUES",
        reviewerPersonId: MEMBER,
        criteriaResults: { completeness: "PASS", format: "ISSUE" },
        comments: "One page needs a signature",
      },
    );
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.decision).toBe("ACCEPT_WITH_ISSUES");

    const deliverable = await call(
      "GET",
      `/api/v1/work-packages/${workPackageId}/deliverables`,
    );
    expect(deliverable.body.data).toHaveLength(1);
    expect(deliverable.body.data[0].status).toBe("ACCEPTED");

    const acceptances = await call(
      "GET",
      `/api/v1/deliverables/${deliverableId}/acceptances`,
    );
    expect(acceptances.body.data).toHaveLength(1);

    const second = await call(
      "POST",
      `/api/v1/work-packages/${workPackageId}/deliverables`,
      {
        title: "Delivery photo",
        deliverableType: "PHOTO",
        ownerPersonId: OWNER,
      },
    );
    await call(
      "POST",
      `/api/v1/deliverables/${second.body.data.id}/submit`,
    );
    const rejected = await call(
      "POST",
      `/api/v1/deliverables/${second.body.data.id}/acceptance`,
      {
        decision: "REJECT",
        reviewerPersonId: MEMBER,
        comments: "Photo is unreadable",
      },
    );
    expect(rejected.status).toBe(201);
    const resubmitted = await call(
      "POST",
      `/api/v1/deliverables/${second.body.data.id}/submit`,
      { artifactRef: "s3://docs/photo-2.jpg" },
    );
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.version).toBe(2);
    expect(resubmitted.body.data.status).toBe("SUBMITTED");
  });
});

describe("AI suggestion logs and workflow runs", () => {
  it("records suggestions, model evaluations and workflow lifecycle", async () => {
    const task = await call("POST", "/api/v1/agent-tasks", {
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      input: {},
      idempotencyKey: `ai-log-${Date.now()}`,
    });
    expect(task.status).toBe(201);
    const taskId = task.body.data.id as string;

    const suggestion = await call("POST", "/api/v1/ai-suggestion-logs", {
      agentTaskId: taskId,
      targetType: "EVALUATION_DRAFT",
      suggestionType: "EVIDENCE_SUMMARY",
      modelProvider: "anthropic",
      modelName: "claude",
      promptVersion: "v1",
      inputHash: "sha256:input",
      outputJson: { summary: "Two evidence gaps" },
      validationStatus: "VALID",
    });
    expect(suggestion.status).toBe(201);
    expect(suggestion.body.data.acceptedAt).toBeUndefined();
    const suggestionId = suggestion.body.data.id as string;

    const listed = await call(
      "GET",
      `/api/v1/ai-suggestion-logs?agentTaskId=${taskId}`,
    );
    expect(listed.body.data).toHaveLength(1);

    const accepted = await call(
      "POST",
      `/api/v1/ai-suggestion-logs/${suggestionId}/accept`,
      { acceptedBy: ADJUDICATOR },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.acceptedAt).toBeTruthy();
    const reaccepted = await call(
      "POST",
      `/api/v1/ai-suggestion-logs/${suggestionId}/accept`,
      { acceptedBy: ADJUDICATOR },
    );
    expect(reaccepted.status).toBe(409);

    const evaluation = await createHarnessEvaluation(
      "IRR",
      "claude",
      true,
    );
    expect(evaluation.status).toBe(201);
    expect(evaluation.body.data.passed).toBe(true);
    const runId = evaluation.body.data.id as string;
    const passedRuns = await call(
      "GET",
      "/api/v1/model-evaluation-runs?passed=true",
    );
    expect(passedRuns.body.data).toHaveLength(1);
    const detail = await call(
      "GET",
      `/api/v1/model-evaluation-runs/${runId}`,
    );
    expect(detail.status).toBe(200);

    const workflow = await call("POST", "/api/v1/workflow-runs", {
      agentTaskId: taskId,
      workflowName: "evidence-gap",
      workflowVersion: "v1",
      status: "RUNNING",
      currentStep: "COLLECT",
      state: { examined: 3 },
    });
    expect(workflow.status).toBe(201);
    const workflowId = workflow.body.data.id as string;

    const finished = await call(
      "POST",
      `/api/v1/workflow-runs/${workflowId}/finish`,
      { status: "COMPLETED", currentStep: "VERIFY" },
    );
    expect(finished.status).toBe(200);
    expect(finished.body.data.finishedAt).toBeTruthy();
    const refinished = await call(
      "POST",
      `/api/v1/workflow-runs/${workflowId}/finish`,
      { status: "COMPLETED" },
    );
    expect(refinished.status).toBe(409);

    const workflows = await call(
      "GET",
      `/api/v1/workflow-runs?agentTaskId=${taskId}`,
    );
    expect(workflows.body.data).toHaveLength(1);
  });

  it("activates a model prompt only with a matching passed evaluation", async () => {
    const createPrompt = (version: number) =>
      call("POST", "/api/v1/model-prompts", {
        promptCode: "EVIDENCE_SUMMARY",
        version,
        purpose: "EVIDENCE_SUMMARY",
        modelProvider: "anthropic",
        modelName: "claude",
        template: "Summarize evidence without scoring.",
      });
    const prompt = await createPrompt(1);
    expect(prompt.status).toBe(201);
    expect(prompt.body.data.status).toBe("DRAFT");
    expect(prompt.body.data.templateHash).toMatch(/^sha256:/);
    const duplicate = await createPrompt(1);
    expect(duplicate.status).toBe(409);

    const evaluation = (modelName: string, passed: boolean) =>
      createHarnessEvaluation("IRR", modelName, passed);
    const failedEvaluation = await evaluation("claude", false);
    const failedActivation = await call(
      "POST",
      `/api/v1/model-prompts/${prompt.body.data.id}/activate`,
      { evaluationRunId: failedEvaluation.body.data.id },
    );
    expect(failedActivation.status).toBe(409);
    expect(failedActivation.body.error.message).toContain(
      "MODEL_EVALUATION_NOT_PASSED",
    );

    const mismatch = await evaluation("claude-other", true);
    const mismatchActivation = await call(
      "POST",
      `/api/v1/model-prompts/${prompt.body.data.id}/activate`,
      { evaluationRunId: mismatch.body.data.id },
    );
    expect(mismatchActivation.status).toBe(409);
    expect(mismatchActivation.body.error.message).toContain(
      "MODEL_EVALUATION_MODEL_MISMATCH",
    );

    const passedEvaluation = await evaluation("claude", true);
    const activated = await call(
      "POST",
      `/api/v1/model-prompts/${prompt.body.data.id}/activate`,
      { evaluationRunId: passedEvaluation.body.data.id },
    );
    expect(activated.status).toBe(200);
    expect(activated.body.data.status).toBe("ACTIVE");
    expect(activated.body.data.evaluationRunId).toBe(
      passedEvaluation.body.data.id,
    );

    const second = await createPrompt(2);
    const concurrentActivation = await call(
      "POST",
      `/api/v1/model-prompts/${second.body.data.id}/activate`,
      { evaluationRunId: passedEvaluation.body.data.id },
    );
    expect(concurrentActivation.status).toBe(409);
    expect(concurrentActivation.body.error.message).toContain(
      "MODEL_PROMPT_ALREADY_ACTIVE",
    );

    const retired = await call(
      "POST",
      `/api/v1/model-prompts/${prompt.body.data.id}/retire`,
    );
    expect(retired.status).toBe(200);
    expect(retired.body.data.status).toBe("RETIRED");
    const activatedSecond = await call(
      "POST",
      `/api/v1/model-prompts/${second.body.data.id}/activate`,
      { evaluationRunId: passedEvaluation.body.data.id },
    );
    expect(activatedSecond.status).toBe(200);
    expect(activatedSecond.body.data.status).toBe("ACTIVE");
    const activePrompts = await call(
      "GET",
      "/api/v1/model-prompts?promptCode=EVIDENCE_SUMMARY&status=ACTIVE",
    );
    expect(activePrompts.body.data).toHaveLength(1);
    expect(activePrompts.body.data[0].version).toBe(2);

    const task = await call("POST", "/api/v1/agent-tasks", {
      agentType: "EVIDENCE_GAP",
      triggerType: "MANUAL",
      idempotencyKey: "prompt-suggestion-task",
    });
    expect(task.status).toBe(201);
    const suggestion = await call(
      "POST",
      "/api/v1/ai-suggestion-logs",
      {
        agentTaskId: task.body.data.id,
        targetType: "CALCULATION_RUN",
        suggestionType: "EVIDENCE_SUMMARY",
        modelPromptId: second.body.data.id,
        promptVersion: "v2",
        inputHash: "input-hash",
        outputJson: { summary: "Evidence supports the claim" },
        validationStatus: "VALID",
      },
    );
    expect(suggestion.status).toBe(201);
    expect(suggestion.body.data.modelPromptId).toBe(
      second.body.data.id,
    );
    expect(suggestion.body.data.modelProvider).toBe("anthropic");
    expect(suggestion.body.data.modelName).toBe("claude");

    const retiredPromptSuggestion = await call(
      "POST",
      "/api/v1/ai-suggestion-logs",
      {
        agentTaskId: task.body.data.id,
        targetType: "CALCULATION_RUN",
        suggestionType: "EVIDENCE_SUMMARY",
        modelPromptId: prompt.body.data.id,
        promptVersion: "v1",
        inputHash: "input-hash-2",
        outputJson: { summary: "Retired prompt" },
        validationStatus: "VALID",
      },
    );
    expect(retiredPromptSuggestion.status).toBe(409);
    expect(retiredPromptSuggestion.body.error.message).toContain(
      "MODEL_PROMPT_NOT_ACTIVE",
    );
  });

  it("rejects an unverified evaluation record for activation", async () => {
    const prompt = await call("POST", "/api/v1/model-prompts", {
      promptCode: "UNVERIFIED_TEST",
      version: 1,
      purpose: "EVIDENCE_SUMMARY",
      modelProvider: "anthropic",
      modelName: "claude",
      template: "Summarize evidence.",
    });
    const legacy = await call("POST", "/api/v1/model-evaluation-runs", {
      evaluationType: "IRR",
      modelProvider: "anthropic",
      modelName: "claude",
      promptVersion: "v1",
      datasetRef: "legacy",
      sampleSize: 100,
      metrics: {},
      subgroupMetrics: {},
      passed: true,
      blockers: [],
    });
    expect(legacy.status).toBe(201);
    const activation = await call(
      "POST",
      `/api/v1/model-prompts/${prompt.body.data.id}/activate`,
      { evaluationRunId: legacy.body.data.id },
    );
    expect(activation.status).toBe(409);
    expect(activation.body.error.message).toContain(
      "MODEL_EVALUATION_NOT_HARNESS_VERIFIED",
    );
  });

  it("creates gated AI score proposals with human decisions", async () => {
    const evaluation = await createHarnessEvaluation(
      "IRR",
      "claude",
      true,
      "score-gold-set",
    );
    const evidence = [
      {
        id: "score-e1",
        type: "DELIVERY",
        text: "Signed acceptance",
        dimension: "QUALITY",
        quality: "VALID",
      },
      {
        id: "score-e2",
        type: "DELIVERY",
        text: "Delivered on time",
        dimension: "TIMELINESS",
        quality: "VALID",
      },
    ];
    const proposal = await call("POST", "/api/v1/ai-score-proposals", {
      cycleId: CYCLE,
      personId: OWNER,
      evaluationRunId: evaluation.body.data.id,
      dimensions: ["QUALITY", "TIMELINESS"],
      evidence,
      requestedBy: OWNER,
    });
    expect(proposal.status).toBe(201);
    expect(proposal.body.data.status).toBe("PENDING");
    expect(proposal.body.data.scores.QUALITY).toBeGreaterThan(0);
    expect(proposal.body.data.overallScore).toBeGreaterThan(0);
    expect(proposal.body.data.evidenceRefs).toEqual([
      "score-e1",
      "score-e2",
    ]);
    expect(proposal.body.data.gateMetrics).toMatchObject({
      harnessVersion: "ai-gate-v1",
      humanHumanAgreement: 1,
    });
    const reviewEvidence = {
      independentScores: proposal.body.data.scores as Record<string, number>,
      reviewStartedAt: new Date(Date.now() - 60_000).toISOString(),
      evidenceOpened: 2,
      blindReview: true,
    };

    const missingIndependent = await call(
      "POST",
      `/api/v1/ai-score-proposals/${proposal.body.data.id}/decide`,
      {
        decision: "ACCEPT",
        decidedBy: ADJUDICATOR,
        reviewStartedAt: new Date(Date.now() - 60_000).toISOString(),
      },
    );
    expect(missingIndependent.status).toBe(400);

    const overrideWithoutReason = await call(
      "POST",
      `/api/v1/ai-score-proposals/${proposal.body.data.id}/decide`,
      {
        decision: "ACCEPT",
        decidedBy: ADJUDICATOR,
        ...reviewEvidence,
        independentScores: Object.fromEntries(
          Object.keys(proposal.body.data.scores).map((key) => [key, 0]),
        ),
      },
    );
    expect(overrideWithoutReason.status).toBe(409);
    expect(overrideWithoutReason.body.error.message).toContain(
      "AI_OVERRIDE_REASON_REQUIRED",
    );

    const selfDecision = await call(
      "POST",
      `/api/v1/ai-score-proposals/${proposal.body.data.id}/decide`,
      { decision: "ACCEPT", decidedBy: OWNER, ...reviewEvidence },
    );
    expect(selfDecision.status).toBe(409);
    expect(selfDecision.body.error.message).toContain(
      "AI_SCORE_SELF_REVIEW",
    );

    const accepted = await call(
      "POST",
      `/api/v1/ai-score-proposals/${proposal.body.data.id}/decide`,
      {
        decision: "ACCEPT",
        decidedBy: ADJUDICATOR,
        note: "Evidence supports the proposal",
        ...reviewEvidence,
      },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.override).toBe(false);
    expect(accepted.body.data.evidenceOpened).toBe(2);
    expect(accepted.body.data.blindReview).toBe(true);
    expect(accepted.body.data.status).toBe("ACCEPTED");
    expect(accepted.body.data.decidedBy).toBe(ADJUDICATOR);

    const redecided = await call(
      "POST",
      `/api/v1/ai-score-proposals/${proposal.body.data.id}/decide`,
      { decision: "REJECT", decidedBy: ADJUDICATOR, ...reviewEvidence },
    );
    expect(redecided.status).toBe(409);

    const explanation = await call(
      "GET",
      `/api/v1/me/ai-explanations?personId=${OWNER}`,
    );
    expect(explanation.status).toBe(200);
    expect(explanation.body.data.personId).toBe(OWNER);
    expect(explanation.body.data.aiUsed).toBe(true);
    expect(explanation.body.data.aiScoreProposals).toHaveLength(1);
    expect(explanation.body.data.explanation.autonomousDecision).toBe(false);
    expect(explanation.body.data.explanation.humanReviewRequired).toBe(true);

    const reviewMetrics = await call("GET", "/api/v1/ai-review-metrics");
    expect(reviewMetrics.status).toBe(200);
    expect(reviewMetrics.body.data.decided).toBe(1);
    expect(reviewMetrics.body.data.accepted).toBe(1);
    expect(reviewMetrics.body.data.overrideRate).toBe(0);
    expect(reviewMetrics.body.data.blindReviewCount).toBe(1);
    expect(reviewMetrics.body.data.rubberStampAlert).toBe(false);

    const acceptedList = await call(
      "GET",
      "/api/v1/ai-score-proposals?status=ACCEPTED",
    );
    expect(acceptedList.body.data).toHaveLength(1);
    const overrideProposal = await call(
      "POST",
      "/api/v1/ai-score-proposals",
      {
        cycleId: CYCLE,
        personId: MEMBER,
        evaluationRunId: evaluation.body.data.id,
        dimensions: ["QUALITY", "TIMELINESS"],
        evidence,
        requestedBy: OWNER,
      },
    );
    expect(overrideProposal.status).toBe(201);
    const overridden = await call(
      "POST",
      `/api/v1/ai-score-proposals/${overrideProposal.body.data.id}/decide`,
      {
        decision: "ACCEPT",
        decidedBy: ADJUDICATOR,
        note: "Override for audit test",
        independentScores: Object.fromEntries(
          Object.keys(overrideProposal.body.data.scores).map((key) => [
            key,
            0,
          ]),
        ),
        overrideReason: "Independent review disagrees with the evidence weight",
        reviewStartedAt: new Date(Date.now() - 60_000).toISOString(),
        evidenceOpened: 1,
      },
    );
    expect(overridden.status).toBe(200);
    expect(overridden.body.data.override).toBe(true);
    expect(overridden.body.data.auditSample).toBe(true);

    const auditQueue = await call(
      "GET",
      "/api/v1/ai-score-proposals/audit-queue",
    );
    expect(auditQueue.status).toBe(200);
    expect(
      auditQueue.body.data.some(
        (proposal: { id: string }) =>
          proposal.id === overrideProposal.body.data.id,
      ),
    ).toBe(true);
    const audited = await call(
      "POST",
      `/api/v1/ai-score-proposals/${overrideProposal.body.data.id}/audit-review`,
      {
        reviewerPersonId: MEMBER,
        scores: overrideProposal.body.data.scores,
        rationale: "Second reviewer agrees with the AI evidence weights",
        reviewStartedAt: new Date(Date.now() - 30_000).toISOString(),
        evidenceOpened: 2,
      },
    );
    expect(audited.status).toBe(200);
    expect(audited.body.data.secondReviewerPersonId).toBe(MEMBER);
    expect(audited.body.data.secondReviewOutcome).toBe("AGREE");
    expect(audited.body.data.secondReviewAgreementRate).toBe(1);
    const duplicateAudit = await call(
      "POST",
      `/api/v1/ai-score-proposals/${overrideProposal.body.data.id}/audit-review`,
      {
        reviewerPersonId: MEMBER,
        scores: overrideProposal.body.data.scores,
        rationale: "Duplicate",
        reviewStartedAt: new Date(Date.now() - 30_000).toISOString(),
      },
    );
    expect(duplicateAudit.status).toBe(409);
    const auditedMetrics = await call("GET", "/api/v1/ai-review-metrics");
    expect(auditedMetrics.body.data.auditReviewedCount).toBe(1);
    expect(auditedMetrics.body.data.auditAgreementRate).toBe(1);
    expect(auditedMetrics.body.data.auditSampledCount).toBeGreaterThanOrEqual(
      1,
    );


    const failedEvaluation = await createHarnessEvaluation(
      "IRR",
      "claude",
      false,
      "score-gold-set",
    );
    const blocked = await call("POST", "/api/v1/ai-score-proposals", {
      cycleId: CYCLE,
      personId: OWNER,
      evaluationRunId: failedEvaluation.body.data.id,
      dimensions: ["QUALITY"],
      evidence,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain(
      "AI_EVALUATION_GATE_NOT_PASSED",
    );
  });
});

describe("integrations", () => {
  it("manages connections, sync runs, identity maps and the webhook inbox", async () => {
    const connection = await call(
      "POST",
      "/api/v1/integration-connections",
      {
        provider: "hubspot",
        connectionName: "CRM",
        credentialRef: "vault://crm",
        config: { region: "cn" },
      },
    );
    expect(connection.status).toBe(201);
    expect(connection.body.data.status).toBe("ACTIVE");
    const connectionId = connection.body.data.id as string;

    const presets = await call(
      "GET",
      "/api/v1/integration-mapping-presets",
    );
    expect(presets.status).toBe(200);
    expect(
      presets.body.data.some(
        (preset: { code: string; fieldMap: Record<string, string> }) =>
          preset.code === "hubspot-deals" &&
          preset.fieldMap.sourceRecordId === "id",
      ),
    ).toBe(true);

    const paused = await call(
      "POST",
      `/api/v1/integration-connections/${connectionId}/status`,
      { status: "PAUSED" },
    );
    expect(paused.status).toBe(200);
    expect(paused.body.data.status).toBe("PAUSED");

    const mapping = await call(
      "POST",
      `/api/v1/integration-connections/${connectionId}/mappings`,
      {
        name: "orders-v1",
        mappingType: "CSV",
        sourceSystem: "crm",
        targetType: "EVIDENCE",
        fieldMap: {
          order_id: "sourceRecordId",
          amount: "grossProfit",
        },
        config: { pageSize: 50 },
        version: 1,
      },
    );
    expect(mapping.status).toBe(201);
    expect(mapping.body.data.status).toBe("ACTIVE");
    expect(mapping.body.data.fieldMap.order_id).toBe("sourceRecordId");
    const conflictingActive = await call(
      "POST",
      `/api/v1/integration-connections/${connectionId}/mappings`,
      {
        name: "orders-v1",
        mappingType: "CSV",
        sourceSystem: "crm",
        targetType: "EVIDENCE",
        fieldMap: { order_id: "sourceRecordId" },
        version: 2,
      },
    );
    expect(conflictingActive.status).toBe(409);
    expect(conflictingActive.body.error.message).toContain(
      "INTEGRATION_MAPPING_ALREADY_ACTIVE",
    );
    const listedMappings = await call(
      "GET",
      `/api/v1/integration-connections/${connectionId}/mappings`,
    );
    expect(listedMappings.body.data).toHaveLength(1);
    const retiredMapping = await call(
      "POST",
      `/api/v1/integration-mappings/${mapping.body.data.id}/retire`,
    );
    expect(retiredMapping.status).toBe(200);
    expect(retiredMapping.body.data.status).toBe("RETIRED");
    const secondMapping = await call(
      "POST",
      `/api/v1/integration-connections/${connectionId}/mappings`,
      {
        name: "orders-v1",
        mappingType: "CSV",
        sourceSystem: "crm",
        targetType: "EVIDENCE",
        fieldMap: { order_id: "sourceRecordId" },
        version: 2,
      },
    );
    expect(secondMapping.status).toBe(201);
    const activeMappings = await call(
      "GET",
      `/api/v1/integration-connections/${connectionId}/mappings?status=ACTIVE`,
    );
    expect(activeMappings.body.data).toHaveLength(1);
    expect(activeMappings.body.data[0].version).toBe(2);

    const schedule = await call(
      "POST",
      `/api/v1/integration-connections/${connectionId}/schedules`,
      {
        name: "hourly-sync",
        intervalMinutes: 60,
        startAt: "2020-01-01T00:00:00Z",
      },
    );
    expect(schedule.status).toBe(201);
    expect(schedule.body.data.enabled).toBe(true);
    const duplicateSchedule = await call(
      "POST",
      `/api/v1/integration-connections/${connectionId}/schedules`,
      { name: "hourly-sync", intervalMinutes: 30 },
    );
    expect(duplicateSchedule.status).toBe(409);
    const claimedSchedules = await call(
      "POST",
      "/api/v1/sync-schedules/claim-due",
      { limit: 10, now: "2026-01-01T00:00:00Z" },
    );
    expect(claimedSchedules.status).toBe(200);
    expect(claimedSchedules.body.data).toHaveLength(1);
    expect(claimedSchedules.body.data[0].lastRunAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(claimedSchedules.body.data[0].nextRunAt).toBe(
      "2026-01-01T01:00:00.000Z",
    );
    const disabledSchedule = await call(
      "POST",
      `/api/v1/sync-schedules/${schedule.body.data.id}/status`,
      { enabled: false },
    );
    expect(disabledSchedule.status).toBe(200);
    expect(disabledSchedule.body.data.enabled).toBe(false);
    const claimedAfterDisable = await call(
      "POST",
      "/api/v1/sync-schedules/claim-due",
      { limit: 10, now: "2026-02-01T00:00:00Z" },
    );
    expect(claimedAfterDisable.body.data).toHaveLength(0);

    const syncRun = await call(
      "POST",
      `/api/v1/integration-connections/${connectionId}/sync-runs`,
      { status: "RUNNING", cursorBefore: { page: 1 } },
    );
    expect(syncRun.status).toBe(201);
    expect(syncRun.body.data.startedAt).toBeTruthy();
    const syncRunId = syncRun.body.data.id as string;

    const finished = await call(
      "POST",
      `/api/v1/sync-runs/${syncRunId}/finish`,
      {
        status: "COMPLETED",
        recordsSeen: 10,
        recordsUpserted: 8,
        cursorAfter: { page: 2 },
      },
    );
    expect(finished.status).toBe(200);
    expect(finished.body.data.recordsUpserted).toBe(8);
    const refinished = await call(
      "POST",
      `/api/v1/sync-runs/${syncRunId}/finish`,
      { status: "COMPLETED" },
    );
    expect(refinished.status).toBe(409);

    const reloaded = await call(
      "GET",
      `/api/v1/integration-connections/${connectionId}`,
    );
    expect(reloaded.body.data.lastSyncAt).toBeTruthy();

    const identity = await call(
      "POST",
      "/api/v1/external-identities",
      {
        sourceSystem: "hubspot",
        externalId: "contact-1",
        personId: OWNER,
        objectType: "PERSON",
      },
    );
    expect(identity.status).toBe(201);
    const identityReplay = await call(
      "POST",
      "/api/v1/external-identities",
      {
        sourceSystem: "hubspot",
        externalId: "contact-1",
        objectType: "PERSON",
      },
    );
    expect(identityReplay.body.data.id).toBe(identity.body.data.id);
    const identities = await call(
      "GET",
      "/api/v1/external-identities?sourceSystem=hubspot",
    );
    expect(identities.body.data).toHaveLength(1);

    const webhook = await call("POST", "/api/v1/webhook-inbox", {
      sourceSystem: "hubspot",
      messageId: "msg-1",
      payloadHash: "sha256:webhook",
    });
    expect(webhook.status).toBe(201);
    expect(webhook.body.data.status).toBe("RECEIVED");
    const webhookReplay = await call("POST", "/api/v1/webhook-inbox", {
      sourceSystem: "hubspot",
      messageId: "msg-1",
      payloadHash: "sha256:webhook",
    });
    expect(webhookReplay.body.data.id).toBe(webhook.body.data.id);

    const processed = await call(
      "POST",
      `/api/v1/webhook-inbox/${webhook.body.data.id}/process`,
      { status: "PROCESSED" },
    );
    expect(processed.status).toBe(200);
    expect(processed.body.data.processedAt).toBeTruthy();
    const reprocessed = await call(
      "POST",
      `/api/v1/webhook-inbox/${webhook.body.data.id}/process`,
      { status: "FAILED", errorCode: "DUPLICATE" },
    );
    expect(reprocessed.status).toBe(409);
    const inbox = await call(
      "GET",
      "/api/v1/webhook-inbox?status=PROCESSED",
    );
    expect(inbox.body.data).toHaveLength(1);

    const consumerMessage = await call(
      "POST",
      "/api/v1/inbox-messages",
      { consumerName: "worker", messageId: "inbox-1" },
    );
    expect(consumerMessage.status).toBe(201);
    expect(consumerMessage.body.data.status).toBe("RECEIVED");
    const consumerReplay = await call(
      "POST",
      "/api/v1/inbox-messages",
      { consumerName: "worker", messageId: "inbox-1" },
    );
    expect(consumerReplay.body.data.id).toBe(
      consumerMessage.body.data.id,
    );
    const consumerProcessed = await call(
      "POST",
      `/api/v1/inbox-messages/${consumerMessage.body.data.id}/process`,
      { status: "PROCESSED" },
    );
    expect(consumerProcessed.status).toBe(200);
    expect(consumerProcessed.body.data.processedAt).toBeTruthy();
    const consumerReprocessed = await call(
      "POST",
      `/api/v1/inbox-messages/${consumerMessage.body.data.id}/process`,
      { status: "FAILED", errorCode: "DUPLICATE" },
    );
    expect(consumerReprocessed.status).toBe(409);
    const inboxMessages = await call(
      "GET",
      "/api/v1/inbox-messages?consumerName=worker",
    );
    expect(inboxMessages.body.data).toHaveLength(1);
  });

  it("accepts signed provider webhooks into the inbox", async () => {
    const signedApp = buildApp(
      new Store(),
      undefined,
      undefined,
      undefined,
      { webhookSecrets: { crm: "top-secret" } },
    );
    const payload = JSON.stringify({
      messageId: "crm-msg-1",
      event: "order.updated",
    });
    const signature = computeWebhookSignature({
      secret: "top-secret",
      payload,
    });
    const accepted = await signedApp.inject({
      method: "POST",
      url: "/api/v1/webhooks/crm",
      headers: {
        "content-type": "application/json",
        "x-signature-256": signature,
      },
      payload,
    } as never);
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().data.sourceSystem).toBe("crm");
    expect(accepted.json().data.status).toBe("RECEIVED");

    const replay = await signedApp.inject({
      method: "POST",
      url: "/api/v1/webhooks/crm",
      headers: {
        "content-type": "application/json",
        "x-signature-256": signature,
      },
      payload,
    } as never);
    expect(replay.json().data.id).toBe(accepted.json().data.id);

    const invalid = await signedApp.inject({
      method: "POST",
      url: "/api/v1/webhooks/crm",
      headers: {
        "content-type": "application/json",
        "x-signature-256": "sha256=invalid",
      },
      payload,
    } as never);
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json().error.message).toContain(
      "WEBHOOK_SIGNATURE_INVALID",
    );

    const unknown = await signedApp.inject({
      method: "POST",
      url: "/api/v1/webhooks/unknown",
      headers: { "content-type": "application/json" },
      payload,
    } as never);
    expect(unknown.statusCode).toBe(404);
  });

  it("dispatches provider-specific webhook schemes", async () => {
    const hubspotApp = buildApp(
      new Store(),
      undefined,
      undefined,
      undefined,
      {
        webhookSecrets: { hubspot: "client-secret" },
        webhookSchemes: { hubspot: "hubspot" },
      },
    );
    const hubspotPayload = JSON.stringify({ messageId: "hs-1" });
    const timestamp = String(Date.now());
    const hubspotSignature = computeHubSpotV3Signature({
      clientSecret: "client-secret",
      method: "POST",
      uri: "/api/v1/webhooks/hubspot",
      body: hubspotPayload,
      timestamp,
    });
    const hubspotResponse = await hubspotApp.inject({
      method: "POST",
      url: "/api/v1/webhooks/hubspot",
      headers: {
        "content-type": "application/json",
        "x-hubspot-signature-v3": hubspotSignature,
        "x-hubspot-request-timestamp": timestamp,
        "x-message-id": "hs-1",
      },
      payload: hubspotPayload,
    } as never);
    expect(hubspotResponse.statusCode).toBe(202);
    expect(hubspotResponse.json().data.sourceSystem).toBe("hubspot");

    const feishuApp = buildApp(
      new Store(),
      undefined,
      undefined,
      undefined,
      {
        webhookSecrets: { feishu: "encrypt-key" },
        webhookSchemes: { feishu: "feishu" },
      },
    );
    const feishuPayload = JSON.stringify({ messageId: "fs-1" });
    const feishuTimestamp = "1767225600";
    const feishuNonce = "nonce-1";
    const feishuSignature = computeFeishuSignature({
      encryptKey: "encrypt-key",
      timestamp: feishuTimestamp,
      nonce: feishuNonce,
      body: feishuPayload,
    });
    const feishuResponse = await feishuApp.inject({
      method: "POST",
      url: "/api/v1/webhooks/feishu",
      headers: {
        "content-type": "application/json",
        "x-lark-request-timestamp": feishuTimestamp,
        "x-lark-request-nonce": feishuNonce,
        "x-lark-signature": feishuSignature,
        "x-message-id": "fs-1",
      },
      payload: feishuPayload,
    } as never);
    expect(feishuResponse.statusCode).toBe(202);
    expect(feishuResponse.json().data.sourceSystem).toBe("feishu");
  });
});

describe("ledger adjustments", () => {
  it("appends a locked adjustment linked to the original entry", async () => {
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

    const ledger = await call("GET", "/api/v1/ledger");
    const original = ledger.body.data.find(
      (entry: { personId: string; entryType: string }) =>
        entry.personId === OWNER && entry.entryType === "INCENTIVE",
    );
    expect(original).toBeTruthy();

    const adjustmentApproval = await call(
      "POST",
      "/api/v1/approval-requests",
      {
        actionType: "LEDGER_ADJUSTMENT",
        targetType: "LEDGER_ENTRY",
        targetId: original.id,
        requestedByType: "USER",
        requestedById: OWNER,
        riskTier: "T2",
        requiredApprovals: 1,
        payload: { ledgerId: original.id },
        idempotencyKey: `adjustment-approval-${original.id}`,
      },
    );
    await call(
      "POST",
      `/api/v1/approval-requests/${adjustmentApproval.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: ADJUDICATOR,
        payloadHash: adjustmentApproval.body.data.payloadHash,
      },
    );

    const adjusted = await call(
      "POST",
      `/api/v1/ledger/${original.id}/adjustments`,
      {
        amount: "-1000",
        reasonCode: "EVIDENCE_CORRECTION",
        explanation: "Corrected after the evidence review",
        approvedBy: ADJUDICATOR,
        idempotencyKey: `adjustment-${original.id}`,
        approvalRequestId: adjustmentApproval.body.data.id,
      },
    );
    expect(adjusted.status).toBe(201);
    expect(adjusted.body.data.entry.entryType).toBe("ADJUSTMENT");
    expect(adjusted.body.data.entry.status).toBe("LOCKED");
    expect(adjusted.body.data.entry.amount).toBe("-1000");
    expect(adjusted.body.data.entry.sourceEntryId).toBe(original.id);
    expect(adjusted.body.data.record.originalLedgerId).toBe(original.id);
    expect(adjusted.body.data.record.reasonCode).toBe(
      "EVIDENCE_CORRECTION",
    );
    const consumedAdjustment = await call(
      "GET",
      `/api/v1/approval-requests/${adjustmentApproval.body.data.id}`,
    );
    expect(consumedAdjustment.body.data.consumedAt).toBeTruthy();

    const replay = await call(
      "POST",
      `/api/v1/ledger/${original.id}/adjustments`,
      {
        amount: "-1000",
        reasonCode: "EVIDENCE_CORRECTION",
        explanation: "Corrected after the evidence review",
        approvedBy: ADJUDICATOR,
        idempotencyKey: `adjustment-${original.id}`,
      },
    );
    expect(replay.body.data.entry.id).toBe(
      adjusted.body.data.entry.id,
    );

    const zero = await call(
      "POST",
      `/api/v1/ledger/${original.id}/adjustments`,
      {
        amount: "0",
        reasonCode: "NOOP",
        explanation: "Zero adjustment should fail",
        approvedBy: ADJUDICATOR,
        idempotencyKey: `adjustment-zero-${original.id}`,
      },
    );
    expect(zero.status).toBe(409);

    const records = await call("GET", "/api/v1/adjustment-records");
    expect(
      records.body.data.some(
        (record: { adjustmentLedgerId: string }) =>
          record.adjustmentLedgerId === adjusted.body.data.entry.id,
      ),
    ).toBe(true);
  });
});

describe("budget enforcement for formal runs", () => {
  it("requires an approved pool and blocks runs beyond the available budget", async () => {
    const enforcedApp = buildApp(
      appStore,
      undefined,
      undefined,
      undefined,
      { enforceBudgetPools: true },
    );
    const inject = async (
      method: "GET" | "POST",
      url: string,
      payload?: Record<string, unknown>,
    ) => {
      const response = await enforcedApp.inject({
        method,
        url,
        payload,
      } as never);
      return { status: response.statusCode, body: response.json() };
    };
    const pool = await inject("POST", "/api/v1/budget-pools", {
      cycleId: CYCLE,
      code: "ENFORCED",
      name: "Enforced pool",
      poolType: "STANDARD",
      currency: "CNY",
      approvedAmount: "6000",
    });
    expect(pool.status).toBe(201);
    const poolId = pool.body.data.id as string;
    await inject("POST", `/api/v1/budget-pools/${poolId}/approve`, {
      approvedBy: ADJUDICATOR,
    });

    const firstPackage = await createAcceptedWorkPackage();
    await createConfirmedClaim(firstPackage, OWNER);
    await recordCompleteLegalGate();

    const missingPool = await inject(
      "POST",
      "/api/v1/calculation-runs",
      {
        cycleId: CYCLE,
        policyVersionId: REFERENCE_POLICY_ID,
        mode: "FORMAL",
        order: { id: "budget-1", grossProfit: "100000", currency: "CNY" },
        participants: [
          {
            personId: OWNER,
            workPackageId: firstPackage,
            attributionWeight: "1",
            role: "OWNER",
          },
        ],
      },
    );
    expect(missingPool.status).toBe(409);
    expect(missingPool.body.error.message).toContain("BUDGET_POOL_REQUIRED");

    const firstRun = await inject("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "FORMAL",
      budgetPoolId: poolId,
      order: { id: "budget-1", grossProfit: "100000", currency: "CNY" },
      participants: [
        {
          personId: OWNER,
          workPackageId: firstPackage,
          attributionWeight: "1",
          role: "OWNER",
        },
      ],
    });
    expect(firstRun.status).toBe(201);
    const pooled = await inject("GET", `/api/v1/budget-pools/${poolId}`);
    expect(pooled.body.data.committedAmount).toBe("5000");

    const secondPackage = await createAcceptedWorkPackage();
    await createConfirmedClaim(secondPackage, OWNER);
    const exhausted = await inject("POST", "/api/v1/calculation-runs", {
      cycleId: CYCLE,
      policyVersionId: REFERENCE_POLICY_ID,
      mode: "FORMAL",
      budgetPoolId: poolId,
      order: { id: "budget-2", grossProfit: "100000", currency: "CNY" },
      participants: [
        {
          personId: OWNER,
          workPackageId: secondPackage,
          attributionWeight: "1",
          role: "OWNER",
        },
      ],
    });
    expect(exhausted.status).toBe(409);
    expect(exhausted.body.error.message).toContain("BUDGET_POOL_EXHAUSTED");
  });
});

describe("in-app notifications", () => {
  it("delivers to the recipient and enforces read access", async () => {
    const notification = await call("POST", "/api/v1/notifications", {
      recipientPersonId: OWNER,
      audience: "PERSON",
      title: "Evidence needed",
      body: "Please upload the delivery record.",
      sourceType: "WORK_PACKAGE",
      sourceId: "00000000-0000-4000-8000-000000000010",
    });
    expect(notification.status).toBe(201);

    const ownerAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "owner",
          roles: ["employee"],
          personId: OWNER,
        };
      },
    };
    const memberAuth: Authenticator = {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "member",
          roles: ["employee"],
          personId: MEMBER,
        };
      },
    };
    const ownerApp = buildApp(appStore, undefined, ownerAuth);
    const memberApp = buildApp(appStore, undefined, memberAuth);

    const ownerList = await ownerApp.inject({
      method: "GET",
      url: "/api/v1/notifications",
    } as never);
    expect(ownerList.json().data).toHaveLength(1);
    const memberList = await memberApp.inject({
      method: "GET",
      url: "/api/v1/notifications",
    } as never);
    expect(memberList.json().data).toHaveLength(0);

    const forbiddenRead = await memberApp.inject({
      method: "POST",
      url: `/api/v1/notifications/${notification.body.data.id}/read`,
    } as never);
    expect(forbiddenRead.statusCode).toBe(403);

    const read = await ownerApp.inject({
      method: "POST",
      url: `/api/v1/notifications/${notification.body.data.id}/read`,
    } as never);
    expect(read.statusCode).toBe(200);
    expect(read.json().data.status).toBe("READ");

    const forbiddenCreate = await ownerApp.inject({
      method: "POST",
      url: "/api/v1/notifications",
      payload: {
        recipientPersonId: OWNER,
        audience: "PERSON",
        title: "Self",
        body: "Self",
      },
    } as never);
    expect(forbiddenCreate.statusCode).toBe(403);
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
    expect(response.body).toContain("我的评价决策");
    expect(response.body).toContain("我的证据");
    expect(response.body).toContain("我的通知");
    expect(response.body).toContain("扣回/回收确认");
    expect(response.body).toContain("我的贡献申报");
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
    expect(response.headers["x-request-id"]).toBeTruthy();
    expect(response.body).toContain("n_perform_http_requests_total");
    expect(response.body).toContain('route="/health"');
    expect(response.body).toContain("n_perform_process_uptime_seconds");
  });

  it("requires configured approvals before guarded commands", async () => {
    const guarded = buildApp(
      new Store(),
      undefined,
      undefined,
      undefined,
      { requiredApprovals: ["POLICY_PUBLISH"] },
    );
    const denied = await guarded.inject({
      method: "POST",
      url: "/api/v1/policy-versions",
      payload: {
        policy: {
          code: "GUARDED_POLICY",
          version: 1,
          currency: "CNY",
          poolRate: "0.05",
          poolCap: "1000",
          rounding: "HALF_UP",
          calculator: "SIMPLE_POOL",
        },
        effectiveFrom: "2026-11-01T00:00:00Z",
        approvedBy: ADJUDICATOR,
        applicability: TEST_APPLICABILITY,
      },
    } as never);
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.message).toContain("APPROVAL_REQUIRED");
  });

  it("enforces tenant-configured approvals", async () => {
    const settings = await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/settings",
      { requiredApprovals: ["POLICY_PUBLISH"] },
    );
    expect(settings.status).toBe(200);
    expect(settings.body.data.settings.requiredApprovals).toContain(
      "POLICY_PUBLISH",
    );
    const denied = await call("POST", "/api/v1/policy-versions", {
      policy: {
        code: "TENANT_GUARDED_POLICY",
        version: 1,
        currency: "CNY",
        poolRate: "0.05",
        poolCap: "1000",
        rounding: "HALF_UP",
        calculator: "SIMPLE_POOL",
      },
      effectiveFrom: "2026-11-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
      applicability: TEST_APPLICABILITY,
    });
    expect(denied.status).toBe(409);
    expect(denied.body.error.message).toContain("APPROVAL_REQUIRED");
  });

  it("consumes a POLICY_PUBLISH approval when rolling back", async () => {
    const base = {
      code: "ROLLBACK_APPROVAL_POLICY",
      currency: "CNY",
      poolRate: "0.05",
      poolCap: "1000",
      rounding: "HALF_UP" as const,
      calculator: "SIMPLE_POOL" as const,
    };
    const first = await appStore.publishPolicy({
      policy: { ...base, version: 1 },
      effectiveFrom: "2027-01-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
      applicability: TEST_APPLICABILITY,
    });
    await appStore.publishPolicy({
      policy: { ...base, version: 2, poolRate: "0.07" },
      effectiveFrom: "2027-02-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
      applicability: TEST_APPLICABILITY,
    });
    await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/settings",
      { requiredApprovals: ["POLICY_PUBLISH"] },
    );

    const denied = await call(
      "POST",
      `/api/v1/policy-versions/${first.policyVersionId}/rollback`,
      {
        effectiveFrom: "2027-03-01T00:00:00Z",
        approvedBy: ADJUDICATOR,
        applicability: TEST_APPLICABILITY,
      },
    );
    expect(denied.status).toBe(409);
    expect(denied.body.error.message).toContain("APPROVAL_REQUIRED");

    const newPolicyVersionId = "00000000-0000-4000-8000-0000000008b8";
    const approval = await call("POST", "/api/v1/approval-requests", {
      actionType: "POLICY_PUBLISH",
      targetType: "POLICY_VERSION",
      targetId: newPolicyVersionId,
      requestedByType: "USER",
      requestedById: OWNER,
      riskTier: "T2",
      requiredApprovals: 1,
      payload: { policyVersionId: newPolicyVersionId },
      idempotencyKey: `rollback-approval-${newPolicyVersionId}`,
    });
    expect(approval.status).toBe(201);
    await call(
      "POST",
      `/api/v1/approval-requests/${approval.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: ADJUDICATOR,
        payloadHash: approval.body.data.payloadHash,
      },
    );

    const rollback = await call(
      "POST",
      `/api/v1/policy-versions/${first.policyVersionId}/rollback`,
      {
        newPolicyVersionId,
        effectiveFrom: "2027-03-01T00:00:00Z",
        approvedBy: ADJUDICATOR,
        applicability: TEST_APPLICABILITY,
        approvalRequestId: approval.body.data.id,
      },
    );
    expect(rollback.status).toBe(201);
    expect(rollback.body.data.policyVersionId).toBe(newPolicyVersionId);
    expect(rollback.body.data.policy.version).toBe(3);
    const consumed = await call(
      "GET",
      `/api/v1/approval-requests/${approval.body.data.id}`,
    );
    expect(consumed.body.data.consumedAt).toBeTruthy();
  });

  it("renders business event counters", async () => {
    const created = await call("POST", "/api/v1/approval-requests", {
      actionType: "SETTLEMENT_LOCK",
      targetType: "SETTLEMENT_BATCH",
      targetId: "00000000-0000-4000-8000-0000000000aa",
      requestedByType: "USER",
      requestedById: OWNER,
      riskTier: "T2",
      requiredApprovals: 1,
      payload: { batchId: "metrics" },
      idempotencyKey: `metrics-${Date.now()}`,
    });
    expect(created.status).toBe(201);
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
    } as never);
    expect(response.body).toContain("n_perform_business_events_total");
    expect(response.body).toContain('event="approval_created"');
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
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.body).toContain("N-Perform 管理端");
    expect(response.body).toContain("/api/v1/policy-simulations");
    expect(response.body).toContain("/api/v1/agent-tasks");
    expect(response.body).toContain("结算批次");
    expect(response.body).toContain("审计事件");
    expect(response.body).toContain("评价管理");
    expect(response.body).toContain("数据质量");
    expect(response.body).toContain("申诉处理");
    expect(response.body).toContain("贡献与认定");
    expect(response.body).toContain("政策发布");
    expect(response.body).toContain("账本冲销");
    expect(response.body).toContain("通知中心");
    expect(response.body).toContain("对比政策版本");
    expect(response.body).toContain("批量计算");
    expect(response.body).toContain("批量认定");
    expect(response.body).toContain("平台租户");
    expect(response.body).toContain("保存租户设置");
    expect(response.body).toContain("/api/v1/platform/tenants/");
    expect(response.body).toContain("法律门禁与 DPIA");
    expect(response.body).toContain("/api/v1/dpia-records");
  });

  it("serves the governance operations page", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/governance",
    } as never);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("N-Perform 治理操作台");
    expect(response.body).toContain("审批请求");
    expect(response.body).toContain("预算池与现金门禁");
    expect(response.body).toContain("财务事实");
    expect(response.body).toContain("交付物与验收");
    expect(response.body).toContain("结算导出证据");
    expect(response.body).toContain("集成与收件箱");
    expect(response.body).toContain("AI 与工作流记录");
    expect(response.body).toContain("/api/v1/approval-requests");
    expect(response.body).toContain("/api/v1/financial-facts");
    expect(response.body).toContain("/api/v1/model-evaluation-runs");
  });
});

describe("vertical slice", () => {
  it("rejects stale work-package command versions", async () => {
    const created = await call("POST", "/api/v1/work-packages", {
      title: "Versioned delivery",
      objective: "Check optimistic concurrency",
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
          expectedOutput: "Review",
        },
      ],
      acceptanceCriteria: ["Accepted"],
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
    const staleStart = await call(
      "POST",
      `/api/v1/work-packages/${id}/start`,
      { expectedVersion: 1 },
    );
    expect(staleStart.status).toBe(409);
    expect(
      (
        await call("POST", `/api/v1/work-packages/${id}/start`, {
          expectedVersion: 2,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("POST", `/api/v1/work-packages/${id}/submit`, {
          expectedVersion: 3,
        })
      ).status,
    ).toBe(200);
    const staleAccept = await call(
      "POST",
      `/api/v1/work-packages/${id}/accept`,
      { reviewerPersonId: MEMBER, expectedVersion: 3 },
    );
    expect(staleAccept.status).toBe(409);
    const accepted = await call(
      "POST",
      `/api/v1/work-packages/${id}/accept`,
      { reviewerPersonId: MEMBER, expectedVersion: 4 },
    );
    expect(accepted.status).toBe(200);
  });

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

  it("accepts work packages atomically in a batch", async () => {
    async function submittedPackage(title: string) {
      const created = await call("POST", "/api/v1/work-packages", {
        title,
        objective: "Submit for batch acceptance",
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
      const id = created.body.data.id as string;
      await call("POST", `/api/v1/work-packages/${id}/commit`, {
        expectedVersion: 1,
      });
      await call("POST", `/api/v1/work-packages/${id}/start`);
      await call("POST", `/api/v1/work-packages/${id}/submit`);
      return id;
    }

    const first = await submittedPackage("Batch accept 1");
    const second = await submittedPackage("Batch accept 2");
    const accepted = await call(
      "POST",
      "/api/v1/work-packages:accept-batch",
      {
        items: [
          { id: first, reviewerPersonId: MEMBER },
          { id: second, reviewerPersonId: MEMBER },
        ],
      },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.workPackages).toHaveLength(2);
    expect((await call("GET", `/api/v1/work-packages/${first}`)).body.data.status).toBe(
      "ACCEPTED",
    );

    const third = await submittedPackage("Batch accept 3");
    const draft = await call("POST", "/api/v1/work-packages", {
      title: "Still draft",
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
    const failed = await call("POST", "/api/v1/work-packages:accept-batch", {
      items: [
        { id: third, reviewerPersonId: MEMBER },
        { id: draft.body.data.id, reviewerPersonId: MEMBER },
      ],
    });
    expect(failed.status).toBe(409);
    expect(
      (await call("GET", `/api/v1/work-packages/${third}`)).body.data.status,
    ).toBe("SUBMITTED");
  });

  it("exposes the commitment snapshot history", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    const versions = await call(
      "GET",
      `/api/v1/work-packages/${workPackageId}/versions`,
    );
    expect(versions.status).toBe(200);
    expect(versions.body.data).toHaveLength(1);
    expect(versions.body.data[0].workPackageId).toBe(workPackageId);
    expect(versions.body.data[0].contentHash).toContain("sha256:");
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

  it("creates calculation runs atomically in a batch", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await recordCompleteLegalGate();
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
      mode: "FORMAL",
      order: { id: orderId, grossProfit: "100000", currency: "CNY" },
      participants,
    });

    const blocked = await call("POST", "/api/v1/calculation-runs:batch", {
      runs: [
        runInput("batch-order-1"),
        {
          ...runInput("batch-order-2"),
          participants: [
            {
              personId: ADJUDICATOR,
              workPackageId,
              attributionWeight: "1",
              role: "OWNER",
            },
          ],
        },
      ],
    });
    expect(blocked.status).toBe(422);
    expect((await call("GET", "/api/v1/calculation-runs")).body.data).toHaveLength(
      0,
    );
    expect((await call("GET", "/api/v1/ledger")).body.data).toHaveLength(0);

    const batch = await call("POST", "/api/v1/calculation-runs:batch", {
      runs: [runInput("batch-order-1"), runInput("batch-order-2")],
    });
    expect(batch.status).toBe(201);
    expect(batch.body.data.runs).toHaveLength(2);
    expect((await call("GET", "/api/v1/calculation-runs")).body.data).toHaveLength(
      2,
    );
    expect((await call("GET", "/api/v1/ledger")).body.data).toHaveLength(4);
  });

  it("requires approved evaluation decisions and applies their multipliers", async () => {
    const published = await call("POST", "/api/v1/policy-versions", {
      policy: {
        code: "EVALUATED_CONTRIBUTION_V1",
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
    const policyVersionId = published.body.data.policyVersionId as string;
    await call(
      "POST",
      `/api/v1/policy-versions/${policyVersionId}/legal-gate`,
      {
        policyApproved: true,
        minimumWageChecked: true,
        democraticProcedureRef: "dp-eval",
        employeeNoticeRef: "notice-eval",
        dataProtectionAssessmentRef: "dpia-eval",
        recordedBy: ADJUDICATOR,
      },
    );

    const rubric = await call("POST", "/api/v1/rubrics", {
      code: "EVALUATED_POLICY_RUBRIC",
      name: "Evaluated policy rubric",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-10-01",
    });
    const rubricVersionId = rubric.body.data.id as string;

    async function approvedDecision(personId: string, score: number) {
      const draft = await call("POST", "/api/v1/evaluation-drafts", {
        cycleId: CYCLE,
        personId,
        generatedByType: "USER",
        evidenceSnapshotHash: `evidence-${personId}`,
        draftPayload: { summary: "Evaluation evidence" },
      });
      const draftId = draft.body.data.id as string;
      await call("POST", `/api/v1/evaluation-drafts/${draftId}/submit`);
      const decision = await call(
        "POST",
        `/api/v1/evaluation-drafts/${draftId}/decision`,
        {
          reviewerPersonId: ADJUDICATOR,
          rubricVersionId,
          decision: "APPROVE",
          scores: { QUALITY: score },
          rationale: "Reviewed evidence",
        },
      );
      expect(decision.status).toBe(200);
      return decision.body.data.decision.id as string;
    }

    const ownerDecision = await approvedDecision(OWNER, 5);
    const memberDecision = await approvedDecision(MEMBER, 0);

    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
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
    const runInput = {
      cycleId: CYCLE,
      policyVersionId,
      mode: "FORMAL",
      order: { id: "evaluated-order", grossProfit: "100000", currency: "CNY" },
    };

    const missing = await call("POST", "/api/v1/calculation-runs", {
      ...runInput,
      participants,
    });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.blockers).toEqual(
      expect.arrayContaining([
        `EVALUATION_DECISION_MISSING:${OWNER}`,
        `EVALUATION_DECISION_MISSING:${MEMBER}`,
      ]),
    );

    const run = await call("POST", "/api/v1/calculation-runs", {
      ...runInput,
      participants: [
        { ...participants[0]!, evaluationDecisionId: ownerDecision },
        { ...participants[1]!, evaluationDecisionId: memberDecision },
      ],
    });
    expect(run.status).toBe(201);
    const ownerLine = run.body.data.lines.find(
      (line: { personId: string }) => line.personId === OWNER,
    );
    const memberLine = run.body.data.lines.find(
      (line: { personId: string }) => line.personId === MEMBER,
    );
    expect(Number(ownerLine.roundedAmount)).toBeGreaterThan(
      Number(memberLine.roundedAmount),
    );
    expect(
      Number(ownerLine.roundedAmount) + Number(memberLine.roundedAmount),
    ).toBeCloseTo(5000, 6);
    expect(
      run.body.data.inputSnapshot.participants.map(
        (participant: { evaluationMultiplier: string }) =>
          participant.evaluationMultiplier,
      ),
    ).toEqual(["1.5", "0.5"]);
  });

  it("reverses a locked ledger entry and settles the net amount", async () => {
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

    const ledger = await call("GET", "/api/v1/ledger");
    const ownerEntry = ledger.body.data.find(
      (entry: { personId: string; amount: string }) =>
        entry.personId === OWNER && Number(entry.amount) > 0,
    );
    const reversalApproval = await call(
      "POST",
      "/api/v1/approval-requests",
      {
        actionType: "LEDGER_REVERSAL",
        targetType: "LEDGER_ENTRY",
        targetId: ownerEntry.id,
        requestedByType: "USER",
        requestedById: OWNER,
        riskTier: "T2",
        requiredApprovals: 1,
        payload: { ledgerId: ownerEntry.id },
        idempotencyKey: `reversal-approval-${ownerEntry.id}`,
      },
    );
    await call(
      "POST",
      `/api/v1/approval-requests/${reversalApproval.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: ADJUDICATOR,
        payloadHash: reversalApproval.body.data.payloadHash,
      },
    );
    const reversal = await call(
      "POST",
      `/api/v1/ledger/${ownerEntry.id}/reverse`,
      {
        idempotencyKey: "reversal-demo-1",
        reason: "Order value corrected",
        approvedBy: ADJUDICATOR,
        approvalRequestId: reversalApproval.body.data.id,
      },
    );
    expect(reversal.status).toBe(201);
    expect(reversal.body.data.entryType).toBe("REVERSAL");
    expect(Number(reversal.body.data.amount)).toBe(-3000);
    expect(reversal.body.data.status).toBe("LOCKED");
    const consumedReversal = await call(
      "GET",
      `/api/v1/approval-requests/${reversalApproval.body.data.id}`,
    );
    expect(consumedReversal.body.data.consumedAt).toBeTruthy();

    const replay = await call(
      "POST",
      `/api/v1/ledger/${ownerEntry.id}/reverse`,
      {
        idempotencyKey: "reversal-demo-1",
        reason: "Order value corrected",
        approvedBy: ADJUDICATOR,
      },
    );
    expect(replay.body.data.id).toBe(reversal.body.data.id);

    const after = await call("GET", "/api/v1/ledger");
    expect(after.body.data).toHaveLength(3);
    expect((await call("GET", "/api/v1/ledger/verify")).body.data.valid).toBe(
      true,
    );

    const batch = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    expect(batch.status).toBe(201);
    expect(batch.body.data.totalAmount).toBe("2000");
    expect(batch.body.data.lineCount).toBe(3);
    const reconciled = await call(
      "POST",
      `/api/v1/settlement-batches/${batch.body.data.id}/commands`,
      { command: "RECONCILE" },
    );
    expect(reconciled.status).toBe(200);
  });

  it("requires employee confirmation for a negative recovery batch", async () => {
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
    const ledger = await call("GET", "/api/v1/ledger");
    const ownerEntry = ledger.body.data.find(
      (entry: { personId: string; amount: string }) =>
        entry.personId === OWNER && Number(entry.amount) > 0,
    );
    const standard = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    expect(standard.status).toBe(201);
    await call("POST", `/api/v1/ledger/${ownerEntry.id}/reverse`, {
      idempotencyKey: "recovery-reversal-1",
      reason: "Clawback after correction",
      approvedBy: ADJUDICATOR,
    });

    const rejected = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.message).toContain(
      "NEGATIVE_SETTLEMENT_REQUIRES_RECOVERY",
    );

    const recovery = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
      kind: "RECOVERY",
    });
    expect(recovery.status).toBe(201);
    expect(recovery.body.data.kind).toBe("RECOVERY");
    expect(recovery.body.data.totalAmount).toBe("-3000");
    const recoveryId = recovery.body.data.id as string;

    await call(
      "POST",
      `/api/v1/settlement-batches/${recoveryId}/commands`,
      { command: "RECONCILE" },
    );
    await call(
      "POST",
      `/api/v1/settlement-batches/${recoveryId}/commands`,
      { command: "SUBMIT" },
    );
    await call(
      "POST",
      `/api/v1/settlement-batches/${recoveryId}/commands`,
      { command: "APPROVE", actorPersonId: ADJUDICATOR },
    );
    const blocked = await call(
      "POST",
      `/api/v1/settlement-batches/${recoveryId}/commands`,
      { command: "LOCK" },
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain(
      `RECOVERY_CONFIRMATION_MISSING:${OWNER}`,
    );

    const notices = await call("GET", "/api/v1/notifications");
    expect(
      notices.body.data.some(
        (notification: { recipientPersonId: string; title: string }) =>
          notification.recipientPersonId === OWNER &&
          notification.title === "Recovery settlement requires confirmation",
      ),
    ).toBe(true);

    await call("POST", "/api/v1/employee-confirmations", {
      personId: OWNER,
      targetType: "SETTLEMENT",
      targetId: recoveryId,
      decision: "CONFIRMED",
    });
    const locked = await call(
      "POST",
      `/api/v1/settlement-batches/${recoveryId}/commands`,
      { command: "LOCK" },
    );
    expect(locked.status).toBe(200);
    expect(locked.body.data.batch.status).toBe("LOCKED");
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
    const runLockApproval = await call(
      "POST",
      "/api/v1/approval-requests",
      {
        actionType: "CALCULATION_LOCK",
        targetType: "CALCULATION_RUN",
        targetId: runId,
        requestedByType: "USER",
        requestedById: OWNER,
        riskTier: "T2",
        requiredApprovals: 1,
        payload: { runId },
        idempotencyKey: `calculation-lock-${runId}`,
      },
    );
    expect(runLockApproval.status).toBe(201);
    await call(
      "POST",
      `/api/v1/approval-requests/${runLockApproval.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: ADJUDICATOR,
        payloadHash: runLockApproval.body.data.payloadHash,
      },
    );
    await call("POST", `/api/v1/calculation-runs/${runId}/lock`, {
      confirmation: "LOCK_CALCULATION",
      approvalRequestId: runLockApproval.body.data.id,
    });
    const consumedRunLock = await call(
      "GET",
      `/api/v1/approval-requests/${runLockApproval.body.data.id}`,
    );
    expect(consumedRunLock.body.data.consumedAt).toBeTruthy();

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

    const mismatchApproval = await call(
      "POST",
      "/api/v1/approval-requests",
      {
        actionType: "SETTLEMENT_APPROVE",
        targetType: "WORK_PACKAGE",
        targetId: workPackageId,
        requestedByType: "USER",
        requestedById: OWNER,
        riskTier: "T2",
        requiredApprovals: 1,
        payload: { batchId },
        idempotencyKey: `settlement-mismatch-${batchId}`,
      },
    );
    await call(
      "POST",
      `/api/v1/approval-requests/${mismatchApproval.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: ADJUDICATOR,
        payloadHash: mismatchApproval.body.data.payloadHash,
      },
    );
    const mismatched = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      {
        command: "APPROVE",
        actorPersonId: ADJUDICATOR,
        approvalRequestId: mismatchApproval.body.data.id,
      },
    );
    expect(mismatched.status).toBe(409);
    expect(mismatched.body.error.message).toContain(
      "APPROVAL_TARGET_MISMATCH",
    );

    const settlementApproval = await call(
      "POST",
      "/api/v1/approval-requests",
      {
        actionType: "SETTLEMENT_APPROVE",
        targetType: "SETTLEMENT_BATCH",
        targetId: batchId,
        requestedByType: "USER",
        requestedById: OWNER,
        riskTier: "T2",
        requiredApprovals: 1,
        payload: { batchId },
        idempotencyKey: `settlement-approve-${batchId}`,
      },
    );
    await call(
      "POST",
      `/api/v1/approval-requests/${settlementApproval.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: ADJUDICATOR,
        payloadHash: settlementApproval.body.data.payloadHash,
      },
    );

    const approved = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      {
        command: "APPROVE",
        actorPersonId: ADJUDICATOR,
        approvalRequestId: settlementApproval.body.data.id,
      },
    );
    expect(approved.body.data.batch.status).toBe("APPROVED");
    expect(approved.body.data.batch.approvedBy).toBe(ADJUDICATOR);
    const consumedSettlementApproval = await call(
      "GET",
      `/api/v1/approval-requests/${settlementApproval.body.data.id}`,
    );
    expect(
      consumedSettlementApproval.body.data.consumedAt,
    ).toBeTruthy();

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
      "batch_no,person_id,employee_code,person_name,ledger_id,amount,currency",
    );
    expect(exported.body.data.csv.trim().split("\n")).toHaveLength(3);

    const exportEvidence = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/exports`,
      { exportedBy: ADJUDICATOR, exportRef: "settlement-export-1" },
    );
    expect(exportEvidence.status).toBe(201);
    expect(exportEvidence.body.data.exportHash).toMatch(/^sha256:/);
    const exportId = exportEvidence.body.data.id as string;

    const listedExports = await call(
      "GET",
      `/api/v1/settlement-exports?batchId=${batchId}`,
    );
    expect(listedExports.body.data).toHaveLength(1);

    const exportAck = await call(
      "POST",
      `/api/v1/settlement-exports/${exportId}/acknowledge`,
      { externalReference: "finance-receipt-1" },
    );
    expect(exportAck.status).toBe(200);
    expect(exportAck.body.data.payloadHash).toBe(
      exportEvidence.body.data.exportHash,
    );
    const duplicateExportAck = await call(
      "POST",
      `/api/v1/settlement-exports/${exportId}/acknowledge`,
      { externalReference: "finance-receipt-2" },
    );
    expect(duplicateExportAck.status).toBe(409);

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

    const adjustment = await call(
      "POST",
      `/api/v1/settlement-batches/${batchId}/commands`,
      {
        command: "REQUIRE_ADJUSTMENT",
        actorPersonId: ADJUDICATOR,
        reason: "Post-export correction",
      },
    );
    expect(adjustment.status).toBe(200);
    expect(adjustment.body.data.batch.status).toBe("ADJUSTMENT_REQUIRED");
    const notices = await call("GET", "/api/v1/notifications");
    expect(
      notices.body.data.some(
        (notification: { audience: string; title: string }) =>
          notification.audience === "FINANCE" &&
          notification.title === "Settlement adjustment required",
      ),
    ).toBe(true);
  });

  it("tracks and waives data-quality issues", async () => {
    const created = await call("POST", "/api/v1/data-quality-issues", {
      objectType: "WORK_PACKAGE",
      objectId: "00000000-0000-4000-8000-000000000010",
      issueCode: "EVIDENCE_MISSING",
      severity: "WARNING",
      details: { missing: ["DELIVERY_RECORD"] },
      dueAt: "2026-12-31T00:00:00Z",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("OPEN");
    expect(created.body.data.dueAt).toBe("2026-12-31T00:00:00Z");
    const issueId = created.body.data.id as string;

    const assigned = await call(
      "POST",
      `/api/v1/data-quality-issues/${issueId}/commands`,
      { command: "ASSIGN", assignedTo: ADJUDICATOR },
    );
    expect(assigned.body.data.status).toBe("ASSIGNED");
    expect(assigned.body.data.assignedTo).toBe(ADJUDICATOR);

    const escalated = await call(
      "POST",
      `/api/v1/data-quality-issues/${issueId}/commands`,
      { command: "ESCALATE", reason: "Past the remediation SLA" },
    );
    expect(escalated.status).toBe(200);
    expect(escalated.body.data.status).toBe("ASSIGNED");
    expect(escalated.body.data.escalatedAt).toBeTruthy();
    expect(escalated.body.data.escalationReason).toBe(
      "Past the remediation SLA",
    );

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
    const escalateClosed = await call(
      "POST",
      `/api/v1/data-quality-issues/${issueId}/commands`,
      { command: "ESCALATE", reason: "Should fail" },
    );
    expect(escalateClosed.status).toBe(409);
    expect(escalateClosed.body.error.message).toContain("DQ_ISSUE_CLOSED");

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

    const notices = await call("GET", "/api/v1/notifications");
    expect(
      notices.body.data.some(
        (notification: { recipientPersonId: string; title: string }) =>
          notification.recipientPersonId === ADJUDICATOR &&
          notification.title === "Data-quality issue assigned",
      ),
    ).toBe(true);
  });

  it("verifies the audit chain endpoint", async () => {
    const result = await call("GET", "/api/v1/audit-events/verify");
    expect(result.status).toBe(200);
    expect(result.body.data.valid).toBe(true);
  });

  it("builds a verifiable cycle evidence package", async () => {
    const result = await call("GET", `/api/v1/evidence-packages/${CYCLE}`);
    expect(result.status).toBe(200);
    expect(result.body.data.schemaVersion).toBe(
      "n-perform.evidence-package/v1",
    );
    expect(result.body.data.cycle.id).toBe(CYCLE);
    expect(result.body.data.verification.auditChainValid).toBe(true);
    expect(result.body.data.verification.ledgerValid).toBe(true);
    expect(result.body.data.packageHash).toMatch(/^sha256:/);
    expect(Array.isArray(result.body.data.policies)).toBe(true);
    expect(Array.isArray(result.body.data.auditEvents)).toBe(true);
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

    const notices = await call("GET", "/api/v1/notifications");
    expect(
      notices.body.data.some(
        (notification: { recipientPersonId: string; title: string }) =>
          notification.recipientPersonId === MEMBER &&
          notification.title === "Evaluation approved",
      ),
    ).toBe(true);
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

  it("records attribution decisions atomically in a batch", async () => {
    async function submittedClaim(workPackageId: string, personId: string) {
      const claim = await call("POST", "/api/v1/contribution-claims", {
        workPackageId,
        claimantPersonId: personId,
        claimType: "DELIVERABLE_CONTRIBUTION",
        claimedContribution: { dimensions: ["QUALITY"], summary: "Done" },
        evidenceRefs: [],
        rationale: "Done",
      });
      await call(
        "POST",
        `/api/v1/contribution-claims/${claim.body.data.id}/submit`,
      );
      return claim.body.data.id as string;
    }
    const decision = (claimId: string, adjudicatorPersonId: string) => ({
      claimId,
      adjudicatorPersonId,
      status: "CONFIRMED",
      acceptedFacts: ["Done"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "Evidence supports the claim",
    });

    const workPackageId = await createAcceptedWorkPackage();
    const ownerClaim = await submittedClaim(workPackageId, OWNER);
    const memberClaim = await submittedClaim(workPackageId, MEMBER);
    const batch = await call("POST", "/api/v1/attribution-decisions:batch", {
      items: [
        decision(ownerClaim, ADJUDICATOR),
        decision(memberClaim, ADJUDICATOR),
      ],
    });
    expect(batch.status).toBe(201);
    expect(batch.body.data.decisions).toHaveLength(2);
    expect(
      (await call("GET", `/api/v1/contribution-claims/${ownerClaim}`)).body
        .data.status,
    ).toBe("ACCEPTED");

    const secondPackage = await createAcceptedWorkPackage();
    const first = await submittedClaim(secondPackage, OWNER);
    const selfReviewed = await submittedClaim(secondPackage, MEMBER);
    const failed = await call(
      "POST",
      "/api/v1/attribution-decisions:batch",
      {
        items: [
          decision(first, ADJUDICATOR),
          decision(selfReviewed, MEMBER),
        ],
      },
    );
    expect(failed.status).toBe(422);
    expect(
      (await call("GET", `/api/v1/contribution-claims/${first}`)).body.data
        .status,
    ).toBe("SUBMITTED");
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

  it("rejects policy publication without legal applicability", async () => {
    const missing = await call("POST", "/api/v1/policy-versions", {
      policy: {
        code: "APPLICABILITY_REQUIRED_POLICY",
        version: 1,
        currency: "CNY",
        poolRate: "0.05",
        poolCap: "1000",
        rounding: "HALF_UP",
        calculator: "SIMPLE_POOL",
      },
      effectiveFrom: "2026-11-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
    });
    expect(missing.status).toBe(400);
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
    const policyVersionId = "00000000-0000-4000-8000-0000000007a7";
    const publishApproval = await call(
      "POST",
      "/api/v1/approval-requests",
      {
        actionType: "POLICY_PUBLISH",
        targetType: "POLICY_VERSION",
        targetId: policyVersionId,
        requestedByType: "USER",
        requestedById: OWNER,
        riskTier: "T2",
        requiredApprovals: 1,
        payload: { policyVersionId },
        idempotencyKey: `policy-publish-${policyVersionId}`,
      },
    );
    await call(
      "POST",
      `/api/v1/approval-requests/${publishApproval.body.data.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: ADJUDICATOR,
        payloadHash: publishApproval.body.data.payloadHash,
      },
    );
    const published = await call("POST", "/api/v1/policy-versions", {
      policy,
      policyVersionId,
      effectiveFrom: "2026-11-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
      applicability: TEST_APPLICABILITY,
      approvalRequestId: publishApproval.body.data.id,
    });
    expect(published.status).toBe(201);
    expect(published.body.data.policyVersionId).toBe(policyVersionId);
    expect(published.body.data.approvedBy).toBe(ADJUDICATOR);
    expect(published.body.data.contentHash).toContain("sha256:");
    const consumedPublishApproval = await call(
      "GET",
      `/api/v1/approval-requests/${publishApproval.body.data.id}`,
    );
    expect(consumedPublishApproval.body.data.consumedAt).toBeTruthy();

    const versions = await call("GET", "/api/v1/policy-versions");
    expect(versions.status).toBe(200);
    const publishedVersion = versions.body.data.find(
      (version: { policyVersionId: string }) =>
        version.policyVersionId === published.body.data.policyVersionId,
    );
    expect(publishedVersion).toBeTruthy();
    expect(publishedVersion.applicability).toEqual(TEST_APPLICABILITY);

    const diff = await call(
      "GET",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/diff?against=${published.body.data.policyVersionId}`,
    );
    expect(diff.status).toBe(200);
    expect(diff.body.data.changes).toEqual(
      expect.arrayContaining([
        { path: "poolRate", before: "0.05", after: "0.07" },
      ]),
    );

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
      applicability: TEST_APPLICABILITY,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("CONFLICT");
  });

  it("closes the seeded reference policy window on succession", async () => {
    const published = await call("POST", "/api/v1/policy-versions", {
      policy: {
        code: "GENERIC_CONTRIBUTION_V1",
        version: 11,
        currency: "CNY",
        poolRate: "0.06",
        poolCap: "100000",
        rounding: "HALF_UP",
        calculator: "SIMPLE_POOL",
      },
      effectiveFrom: "2027-01-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
      applicability: TEST_APPLICABILITY,
    });
    expect(published.status).toBe(201);
    const versions = (await call("GET", "/api/v1/policy-versions")).body
      .data as Array<{
      policyVersionId: string;
      effectiveFrom?: string;
      effectiveTo?: string;
    }>;
    expect(
      versions.find(
        (version) => version.policyVersionId === REFERENCE_POLICY_ID,
      )?.effectiveTo,
    ).toBe("2027-01-01T00:00:00Z");
    expect(
      versions.find(
        (version) =>
          version.policyVersionId === published.body.data.policyVersionId,
      )?.effectiveTo,
    ).toBeUndefined();
  });

  it("rolls a policy back as a new version and closes the prior window", async () => {
    const base = {
      code: "ROLLBACK_POLICY",
      currency: "CNY",
      poolRate: "0.05",
      poolCap: "100000",
      rounding: "HALF_UP" as const,
      calculator: "SIMPLE_POOL" as const,
    };
    const first = await call("POST", "/api/v1/policy-versions", {
      policy: { ...base, version: 1 },
      effectiveFrom: "2027-01-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
      applicability: TEST_APPLICABILITY,
    });
    expect(first.status).toBe(201);
    const second = await call("POST", "/api/v1/policy-versions", {
      policy: { ...base, version: 2, poolRate: "0.07" },
      effectiveFrom: "2027-02-01T00:00:00Z",
      approvedBy: ADJUDICATOR,
      applicability: TEST_APPLICABILITY,
    });
    expect(second.status).toBe(201);

    type Version = {
      policyVersionId: string;
      version: number;
      effectiveFrom?: string;
      effectiveTo?: string;
    };
    let versions = (await call("GET", "/api/v1/policy-versions"))
      .body.data as Version[];
    expect(
      versions.find(
        (version) => version.policyVersionId === first.body.data.policyVersionId,
      )?.effectiveTo,
    ).toBe("2027-02-01T00:00:00Z");
    expect(
      versions.find(
        (version) =>
          version.policyVersionId === second.body.data.policyVersionId,
      )?.effectiveTo,
    ).toBeUndefined();

    const rollback = await call(
      "POST",
      `/api/v1/policy-versions/${first.body.data.policyVersionId}/rollback`,
      {
        effectiveFrom: "2027-03-01T00:00:00Z",
        approvedBy: ADJUDICATOR,
        applicability: TEST_APPLICABILITY,
      },
    );
    expect(rollback.status).toBe(201);
    expect(rollback.body.data.sourcePolicyVersionId).toBe(
      first.body.data.policyVersionId,
    );
    expect(rollback.body.data.policy.version).toBe(3);
    expect(rollback.body.data.policy.poolRate).toBe("0.05");

    versions = (await call("GET", "/api/v1/policy-versions")).body
      .data as Version[];
    expect(
      versions.find(
        (version) =>
          version.policyVersionId === second.body.data.policyVersionId,
      )?.effectiveTo,
    ).toBe("2027-03-01T00:00:00Z");
    const rolled = versions.find(
      (version) =>
        version.policyVersionId === rollback.body.data.policyVersionId,
    );
    expect(rolled?.version).toBe(3);
    expect(rolled?.effectiveTo).toBeUndefined();

    const missing = await call(
      "POST",
      "/api/v1/policy-versions/00000000-0000-4000-8000-000000000999/rollback",
      {
        effectiveFrom: "2027-04-01T00:00:00Z",
        approvedBy: ADJUDICATOR,
        applicability: TEST_APPLICABILITY,
      },
    );
    expect(missing.status).toBe(404);
  });

  it("runs a policy test case against its bound policy", async () => {
    const input = {
      cycleId: CYCLE,
      order: {
        id: "case-order-1",
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
    };
    const passing = await call("POST", "/api/v1/policy-test-cases", {
      policyVersionId: REFERENCE_POLICY_ID,
      caseCode: "RUN-CASE-1",
      input,
      expectedOutput: {
        pool: "5000",
        poolRounded: "5000",
        lines: [{ personId: OWNER, roundedAmount: "5000" }],
      },
      category: "NORMAL",
    });
    expect(passing.status).toBe(201);
    const passRun = await call(
      "POST",
      `/api/v1/policy-test-cases/${passing.body.data.id}/run`,
    );
    expect(passRun.status).toBe(200);
    expect(passRun.body.data.passed).toBe(true);
    expect(passRun.body.data.differences).toEqual([]);
    expect(passRun.body.data.blockers).toEqual([]);
    expect(passRun.body.data.actual.poolRounded).toBe("5000");

    const failing = await call("POST", "/api/v1/policy-test-cases", {
      policyVersionId: REFERENCE_POLICY_ID,
      caseCode: "RUN-CASE-2",
      input,
      expectedOutput: { poolRounded: "5001" },
      category: "BOUNDARY",
    });
    expect(failing.status).toBe(201);
    const failRun = await call(
      "POST",
      `/api/v1/policy-test-cases/${failing.body.data.id}/run`,
    );
    expect(failRun.status).toBe(200);
    expect(failRun.body.data.passed).toBe(false);
    expect(failRun.body.data.differences).toEqual([
      { path: "poolRounded", expected: "5001", actual: "5000" },
    ]);

    const invalid = await call("POST", "/api/v1/policy-test-cases", {
      policyVersionId: REFERENCE_POLICY_ID,
      caseCode: "RUN-CASE-3",
      input: {},
      expectedOutput: { pool: "5000" },
      category: "EXCEPTION",
    });
    expect(invalid.status).toBe(201);
    const invalidRun = await call(
      "POST",
      `/api/v1/policy-test-cases/${invalid.body.data.id}/run`,
    );
    expect(invalidRun.status).toBe(400);
    expect(invalidRun.body.error.code).toBe("VALIDATION_ERROR");

    const unsupported = await call("POST", "/api/v1/policy-test-cases", {
      policyVersionId: REFERENCE_POLICY_ID,
      caseCode: "RUN-CASE-4",
      input,
      expectedOutput: { roundedAmount: "5000" },
      category: "HISTORICAL",
    });
    const unsupportedRun = await call(
      "POST",
      `/api/v1/policy-test-cases/${unsupported.body.data.id}/run`,
    );
    expect(unsupportedRun.status).toBe(200);
    expect(unsupportedRun.body.data.passed).toBe(false);
    expect(unsupportedRun.body.data.unsupportedExpectationKeys).toEqual([
      "roundedAmount",
    ]);

    const stored = await call(
      "GET",
      `/api/v1/policy-test-cases?policyVersionId=${REFERENCE_POLICY_ID}`,
    );
    const passingCase = (
      stored.body.data as Array<{
        caseCode: string;
        lastRunPassed?: boolean;
        lastRunResultHash?: string;
      }>
    ).find((testCase) => testCase.caseCode === "RUN-CASE-1");
    expect(passingCase?.lastRunPassed).toBe(true);
    expect(passingCase?.lastRunResultHash).toMatch(/^sha256:/);
  });

  it("runs all active policy test cases as a suite", async () => {
    const input = {
      cycleId: CYCLE,
      order: {
        id: "suite-order-1",
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
    };
    const createCase = (caseCode: string, expectedOutput: object) =>
      call("POST", "/api/v1/policy-test-cases", {
        policyVersionId: REFERENCE_POLICY_ID,
        caseCode,
        input,
        expectedOutput,
        category: "NORMAL",
      });
    const passing = await createCase("SUITE-PASS", { poolRounded: "5000" });
    expect(passing.status).toBe(201);
    const failing = await createCase("SUITE-FAIL", { poolRounded: "5001" });
    expect(failing.status).toBe(201);
    const retired = await createCase("SUITE-RETIRED", {
      poolRounded: "5001",
    });
    expect(retired.status).toBe(201);
    expect(
      (
        await call(
          "POST",
          `/api/v1/policy-test-cases/${retired.body.data.id}/retire`,
        )
      ).status,
    ).toBe(200);

    const suite = await call(
      "POST",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/test-runs`,
    );
    expect(suite.status).toBe(200);
    expect(suite.body.data.total).toBe(2);
    expect(suite.body.data.passedCount).toBe(1);
    expect(suite.body.data.failedCount).toBe(1);
    expect(suite.body.data.retiredCount).toBe(1);
    expect(suite.body.data.passed).toBe(false);
    expect(suite.body.data.results).toHaveLength(2);
    expect(suite.body.data.runId).toBeTruthy();
    expect(suite.body.data.runAt).toBeTruthy();

    const history = await call(
      "GET",
      `/api/v1/policy-versions/${REFERENCE_POLICY_ID}/test-runs`,
    );
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].id).toBe(suite.body.data.runId);
    expect(history.body.data[0].passedCount).toBe(1);
    expect(history.body.data[0].failedCount).toBe(1);
    expect(history.body.data[0].retiredCount).toBe(1);
    expect(history.body.data[0].resultsHash).toMatch(/^sha256:/);

    const cases = await call(
      "GET",
      `/api/v1/policy-test-cases?policyVersionId=${REFERENCE_POLICY_ID}`,
    );
    const byCode = new Map<
      string,
      { lastRunAt?: string; lastRunPassed?: boolean }
    >(
      (cases.body.data as Array<{
        caseCode: string;
        lastRunAt?: string;
        lastRunPassed?: boolean;
      }>).map((testCase) => [testCase.caseCode, testCase]),
    );
    expect(byCode.get("SUITE-PASS")?.lastRunPassed).toBe(true);
    expect(byCode.get("SUITE-PASS")?.lastRunAt).toBeTruthy();
    expect(byCode.get("SUITE-FAIL")?.lastRunPassed).toBe(false);
    expect(byCode.get("SUITE-RETIRED")?.lastRunAt).toBeUndefined();

    const empty = await call(
      "POST",
      `/api/v1/policy-versions/${CHARGING_POLICY_ID}/test-runs`,
    );
    expect(empty.status).toBe(200);
    expect(empty.body.data.total).toBe(0);
    expect(empty.body.data.passed).toBe(false);
  });

  it("reports cycle readiness blockers until confirmations complete", async () => {
    const missingQuery = await call(
      "GET",
      "/api/v1/reports/cycle-readiness",
    );
    expect(missingQuery.status).toBe(400);

    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);
    await createConfirmedClaim(workPackageId, MEMBER);
    await recordCompleteLegalGate();
    const run = await formalRun(workPackageId);
    expect(run.status).toBe(201);
    const runId = run.body.data.id as string;

    const before = await call(
      "GET",
      `/api/v1/reports/cycle-readiness?cycleId=${CYCLE}`,
    );
    expect(before.status).toBe(200);
    expect(before.body.data.cycleId).toBe(CYCLE);
    expect(before.body.data.calculations.formal).toBe(1);
    expect(before.body.data.readyForSettlement).toBe(false);
    expect(before.body.data.legalGates).toEqual([
      {
        policyVersionId: REFERENCE_POLICY_ID,
        recorded: true,
        blockers: [],
      },
    ]);
    expect(before.body.data.blockers).toEqual(
      expect.arrayContaining([
        `RUN:${runId}:MISSING_EMPLOYEE_CONFIRMATION:${OWNER}`,
        `RUN:${runId}:MISSING_EMPLOYEE_CONFIRMATION:${MEMBER}`,
      ]),
    );

    await confirmCalculation(runId, OWNER);
    await confirmCalculation(runId, MEMBER);
    const after = await call(
      "GET",
      `/api/v1/reports/cycle-readiness?cycleId=${CYCLE}`,
    );
    expect(after.body.data.readyForSettlement).toBe(true);
    expect(after.body.data.blockers).toEqual([]);
    expect(after.body.data.calculations.formalLocked).toBe(0);
  });

  it("reports policy readiness from gates, tests and notices", async () => {
    const missingQuery = await call(
      "GET",
      "/api/v1/reports/policy-readiness",
    );
    expect(missingQuery.status).toBe(400);

    const initial = await call(
      "GET",
      `/api/v1/reports/policy-readiness?policyVersionId=${REFERENCE_POLICY_ID}`,
    );
    expect(initial.status).toBe(200);
    expect(initial.body.data.ready).toBe(false);
    expect(initial.body.data.legalGate.recorded).toBe(false);
    expect(initial.body.data.tests.active).toBe(0);
    expect(initial.body.data.blockers).toEqual(
      expect.arrayContaining([
        "LEGAL_GATE_MISSING",
        "NO_ACTIVE_POLICY_TEST_CASES",
      ]),
    );

    const input = {
      cycleId: CYCLE,
      order: {
        id: "policy-ready-order",
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
    };
    const passing = await call("POST", "/api/v1/policy-test-cases", {
      policyVersionId: REFERENCE_POLICY_ID,
      caseCode: "READY-CASE",
      input,
      expectedOutput: { poolRounded: "5000" },
      category: "NORMAL",
    });
    expect(passing.status).toBe(201);
    await call(
      "POST",
      `/api/v1/policy-test-cases/${passing.body.data.id}/run`,
    );
    await recordCompleteLegalGate();

    const ready = await call(
      "GET",
      `/api/v1/reports/policy-readiness?policyVersionId=${REFERENCE_POLICY_ID}`,
    );
    expect(ready.body.data.ready).toBe(true);
    expect(ready.body.data.legalGate.blockers).toEqual([]);
    expect(ready.body.data.tests).toMatchObject({
      active: 1,
      passed: 1,
      failed: 0,
      notRun: 0,
      suitePassed: true,
    });
    expect(ready.body.data.blockers).toEqual([]);

    const failing = await call("POST", "/api/v1/policy-test-cases", {
      policyVersionId: REFERENCE_POLICY_ID,
      caseCode: "READY-FAIL",
      input,
      expectedOutput: { poolRounded: "5001" },
      category: "BOUNDARY",
    });
    await call(
      "POST",
      `/api/v1/policy-test-cases/${failing.body.data.id}/run`,
    );
    const withFailure = await call(
      "GET",
      `/api/v1/reports/policy-readiness?policyVersionId=${REFERENCE_POLICY_ID}`,
    );
    expect(withFailure.body.data.ready).toBe(false);
    expect(withFailure.body.data.tests.failed).toBe(1);
    expect(withFailure.body.data.blockers).toContain(
      "POLICY_TEST_CASE_FAILED:READY-FAIL",
    );

    const notice = await call("POST", "/api/v1/notices", {
      noticeType: "POLICY",
      title: "Readiness notice",
      bodyRef: "readiness-notice",
      effectiveFrom: "2026-11-01T00:00:00Z",
    });
    expect(notice.status).toBe(201);
    await call("POST", "/api/v1/policy-notices", {
      policyVersionId: REFERENCE_POLICY_ID,
      noticeId: notice.body.data.id,
    });
    const withNotice = await call(
      "GET",
      `/api/v1/reports/policy-readiness?policyVersionId=${REFERENCE_POLICY_ID}`,
    );
    expect(withNotice.body.data.notices.linked).toBe(1);
    expect(withNotice.body.data.notices.incomplete).toHaveLength(1);
    expect(withNotice.body.data.blockers).toContain(
      `NOTICE_ACKNOWLEDGEMENTS_INCOMPLETE:${notice.body.data.id}`,
    );
  });

  it("reports operations coverage for work packages and claims", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    await createConfirmedClaim(workPackageId, OWNER);

    const before = await call(
      "GET",
      "/api/v1/reports/operations-coverage",
    );
    expect(before.status).toBe(200);
    expect(before.body.data.workPackages.total).toBe(1);
    expect(before.body.data.workPackages.accepted).toBe(1);
    expect(before.body.data.workPackages.withEvidence).toBe(0);
    expect(before.body.data.workPackages.evidenceCoverageRate).toBe(0);
    expect(before.body.data.claims.total).toBe(1);
    expect(before.body.data.claims.confirmed).toBe(1);
    expect(before.body.data.deliverables.pendingAcceptance).toBe(0);
    expect(before.body.data.approvals.pending).toBe(0);
    expect(before.body.data.dsars.open).toBe(0);
    expect(before.body.data.appeals).toEqual({
      total: 0,
      open: 0,
      overdue: 0,
      closed: 0,
      appealRate: 0,
    });
    expect(
      before.body.data.workPackages.coverageByResponsibility.length,
    ).toBeGreaterThan(0);

    await call("POST", "/api/v1/evidence", {
      evidenceType: "DELIVERY_RECORD",
      subjectType: "WORK_PACKAGE",
      subjectId: workPackageId,
      sourceSystem: "TEST",
      normalizedPayload: { delivered: true },
    });
    await call("POST", "/api/v1/data-quality-issues", {
      objectType: "WORK_PACKAGE",
      objectId: workPackageId,
      issueCode: "EVIDENCE_STALE",
      severity: "WARNING",
      dueAt: "2020-01-01T00:00:00Z",
    });
    const after = await call(
      "GET",
      "/api/v1/reports/operations-coverage",
    );
    expect(after.body.data.evidence.total).toBe(1);
    expect(after.body.data.evidence.workPackage).toBe(1);
    expect(after.body.data.workPackages.withEvidence).toBe(1);
    expect(after.body.data.workPackages.evidenceCoverageRate).toBe(1);
    expect(
      after.body.data.workPackages.coverageByResponsibility.every(
        (row: { coverageRate: number }) => row.coverageRate === 1,
      ),
    ).toBe(true);
    expect(after.body.data.workPackages.coverageByOrderType.length).toBe(1);
    expect(after.body.data.dataQuality).toEqual({
      total: 1,
      open: 1,
      overdue: 1,
      escalated: 0,
    });
  });

  it("reports annual policy review metrics and validates the window", async () => {
    const report = await call("GET", "/api/v1/reports/policy-review");
    expect(report.status).toBe(200);
    expect(report.body.data.from).toBeTruthy();
    expect(report.body.data.to).toBeTruthy();
    expect(report.body.data.policies.versionsInScope).toBeGreaterThan(0);
    expect(report.body.data.claims).toEqual({ total: 0, decided: 0 });
    expect(report.body.data.aiReview.decided).toBe(0);
    expect(report.body.data.trustSurvey.available).toBe(false);
    expect(report.body.data.subgroupImpact.available).toBe(false);

    const invalid = await call(
      "GET",
      "/api/v1/reports/policy-review?from=not-a-date",
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_REPORT_WINDOW");
  });

  it("suppresses team aggregates below the minimum group size", async () => {
    const memberIds: string[] = [];
    for (const index of [1, 2]) {
      const person = await call(
        "POST",
        "/api/v1/platform/tenants/tenant-demo/persons",
        {
          employeeCode: `TEAM-${index}`,
          displayName: `Team member ${index}`,
        },
      );
      expect(person.status).toBe(201);
      memberIds.push(person.body.data.id as string);
      const assigned = await call(
        "POST",
        `/api/v1/platform/tenants/tenant-demo/persons/${person.body.data.id}/manager`,
        { managerPersonId: OWNER },
      );
      expect(assigned.status).toBe(200);
    }
    const small = await call(
      "GET",
      `/api/v1/reports/team-aggregate?managerPersonId=${OWNER}`,
    );
    expect(small.status).toBe(200);
    expect(small.body.data.teamSize).toBe(2);
    expect(small.body.data.suppressed).toBe(true);

    const third = await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/persons",
      { employeeCode: "TEAM-3", displayName: "Team member 3" },
    );
    await call(
      "POST",
      `/api/v1/platform/tenants/tenant-demo/persons/${third.body.data.id}/manager`,
      { managerPersonId: OWNER },
    );
    const aggregate = await call(
      "GET",
      `/api/v1/reports/team-aggregate?managerPersonId=${OWNER}`,
    );
    expect(aggregate.status).toBe(200);
    expect(aggregate.body.data.suppressed).toBe(false);
    expect(aggregate.body.data.teamSize).toBe(3);
    expect(aggregate.body.data.evaluations.evaluated).toBe(0);
    expect(aggregate.body.data.claims).toEqual({ total: 0, confirmed: 0 });
  });

  it("registers data sources and reports the field-level data map", async () => {
    const created = await call("POST", "/api/v1/data-sources", {
      code: "CRM",
      name: "Customer relationship system",
      category: "SALES",
      ownerPersonId: OWNER,
      slaHours: 24,
      criticality: "HIGH",
      containsPersonalData: true,
      storageRegion: "cn-shanghai",
      crossBorderTransfers: false,
      processorRefs: ["crm-vendor"],
      fields: [
        {
          fieldName: "customer_contact",
          classification: "PERSONAL",
          purpose: "Order delivery contact",
        },
        {
          fieldName: "order_value",
          classification: "CONFIDENTIAL",
          purpose: "Incentive calculation input",
        },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("ACTIVE");
    expect(created.body.data.fields).toHaveLength(2);

    const duplicate = await call("POST", "/api/v1/data-sources", {
      code: "CRM",
      name: "Duplicate",
      category: "SALES",
      ownerPersonId: OWNER,
      slaHours: 24,
      criticality: "LOW",
      containsPersonalData: false,
      storageRegion: "cn-shanghai",
      fields: [
        {
          fieldName: "id",
          classification: "INTERNAL",
          purpose: "Identity",
        },
      ],
    });
    expect(duplicate.status).toBe(409);

    const invalid = await call("POST", "/api/v1/data-sources", {
      code: "HRIS",
      name: "HR system",
      category: "PEOPLE",
      ownerPersonId: OWNER,
      slaHours: 24,
      criticality: "HIGH",
      containsPersonalData: true,
      storageRegion: "cn-shanghai",
      fields: [
        {
          fieldName: "employee_code",
          classification: "INTERNAL",
          purpose: "Payroll identity",
        },
      ],
    });
    expect(invalid.status).toBe(400);

    const listed = await call("GET", "/api/v1/data-sources");
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);

    const map = await call("GET", "/api/v1/data-map");
    expect(map.status).toBe(200);
    expect(map.body.data.summary.sources).toBe(1);
    expect(map.body.data.summary.activeSources).toBe(1);
    expect(map.body.data.summary.personalSources).toBe(1);
    expect(map.body.data.summary.processors).toEqual(["crm-vendor"]);
    expect(map.body.data.summary.fields).toBe(2);
    expect(map.body.data.summary.classifications).toEqual({
      PERSONAL: 1,
      CONFIDENTIAL: 1,
    });
    expect(map.body.data.summary.categories).toEqual({ SALES: 1 });

    const retired = await call(
      "POST",
      `/api/v1/data-sources/${created.body.data.id}/retire`,
    );
    expect(retired.status).toBe(200);
    expect(retired.body.data.status).toBe("RETIRED");
    const afterRetire = await call("GET", "/api/v1/data-map");
    expect(afterRetire.body.data.summary.activeSources).toBe(0);
  });

  it("collects anonymous trust-survey responses and reports baselines", async () => {
    const survey = await call("POST", "/api/v1/trust-surveys", {
      code: "TRUST_QUARTERLY",
      period: "2026-Q4",
      title: "Quarterly trust and fairness",
      questions: [
        {
          code: "FAIRNESS",
          prompt: "The incentive process is fair.",
          dimension: "FAIRNESS",
        },
        {
          code: "VOICE",
          prompt: "I can raise a concern safely.",
          dimension: "VOICE",
        },
      ],
    });
    expect(survey.status).toBe(201);
    expect(survey.body.data.status).toBe("DRAFT");
    const surveyId = survey.body.data.id as string;
    expect(
      (
        await call("POST", `/api/v1/trust-surveys/${surveyId}/open`)
      ).status,
    ).toBe(200);
    const response = await call(
      "POST",
      `/api/v1/trust-surveys/${surveyId}/responses`,
      {
        personId: OWNER,
        scores: { FAIRNESS: 4, VOICE: 5 },
      },
    );
    expect(response.status).toBe(201);
    expect(response.body.data.respondentHash).toMatch(/^sha256:/);
    expect(response.body.data.personId).toBeUndefined();
    const duplicate = await call(
      "POST",
      `/api/v1/trust-surveys/${surveyId}/responses`,
      {
        personId: OWNER,
        scores: { FAIRNESS: 3, VOICE: 4 },
      },
    );
    expect(duplicate.status).toBe(409);
    const report = await call(
      "GET",
      `/api/v1/trust-surveys/${surveyId}/report`,
    );
    expect(report.status).toBe(200);
    expect(report.body.data.responseCount).toBe(1);
    expect(report.body.data.averages.FAIRNESS).toBe(4);
    expect(report.body.data.dimensions.FAIRNESS).toBe(4);
    expect(report.body.data.distribution.FAIRNESS["4"]).toBe(1);
    const closed = await call(
      "POST",
      `/api/v1/trust-surveys/${surveyId}/close`,
    );
    expect(closed.body.data.status).toBe("CLOSED");
    const annual = await call("GET", "/api/v1/reports/policy-review");
    expect(annual.body.data.trustSurvey.available).toBe(true);
    expect(annual.body.data.trustSurvey.responseCount).toBe(1);
  });

  it("blocks adjudication when an active conflict is declared", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    const created = await call("POST", "/api/v1/contribution-claims", {
      workPackageId,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimedContribution: {
        dimensions: ["QUALITY"],
        summary: "Delivered the agreed scope",
      },
      rationale: "Delivered the agreed scope",
    });
    expect(created.status).toBe(201);
    const claimId = created.body.data.id as string;
    await call("POST", `/api/v1/contribution-claims/${claimId}/submit`);

    const declaration = await call(
      "POST",
      "/api/v1/conflict-declarations",
      {
        personId: ADJUDICATOR,
        relatedPersonId: OWNER,
        relationshipType: "FAMILY",
        description: "Close family relationship",
      },
    );
    expect(declaration.status).toBe(201);
    expect(declaration.body.data.status).toBe("ACTIVE");

    const decisionBody = {
      claimId,
      adjudicatorPersonId: ADJUDICATOR,
      status: "CONFIRMED",
      acceptedFacts: ["Delivered"],
      rejectedFacts: [],
      contributionDimensions: { QUALITY: 1 },
      rationale: "Evidence supports the claim",
    };
    const blocked = await call(
      "POST",
      "/api/v1/attribution-decisions",
      decisionBody,
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain(
      "ADJUDICATOR_CONFLICT_OF_INTEREST",
    );

    const revoked = await call(
      "POST",
      `/api/v1/conflict-declarations/${declaration.body.data.id}/revoke`,
      { reason: "Relationship ended; declaration no longer applies" },
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe("REVOKED");
    const allowed = await call(
      "POST",
      "/api/v1/attribution-decisions",
      decisionBody,
    );
    expect(allowed.status).toBe(201);
  });

  it("requires a reason for exception and backfill claims", async () => {
    const workPackageId = await createAcceptedWorkPackage();
    const missingReason = await call("POST", "/api/v1/contribution-claims", {
      workPackageId,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimMode: "EXCEPTION",
      claimedContribution: {
        dimensions: ["QUALITY"],
        summary: "Late evidence submitted after acceptance",
      },
      rationale: "Evidence arrived after the normal window",
    });
    expect(missingReason.status).toBe(400);

    const created = await call("POST", "/api/v1/contribution-claims", {
      workPackageId,
      claimantPersonId: OWNER,
      claimType: "DELIVERABLE_CONTRIBUTION",
      claimMode: "BACKFILL",
      exceptionReason: "Evidence system outage during the claim window",
      claimedContribution: {
        dimensions: ["QUALITY"],
        summary: "Late evidence submitted after acceptance",
      },
      rationale: "Evidence arrived after the normal window",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.claimMode).toBe("BACKFILL");
    expect(created.body.data.exceptionReason).toContain("outage");
    const listed = await call("GET", "/api/v1/contribution-claims");
    expect(listed.body.data[0].claimMode).toBe("BACKFILL");
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
    const appealDueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString();
    const appealEvidenceRef = "00000000-0000-4000-8000-0000000000aa";
    const appeal = await call("POST", "/api/v1/appeals", {
      appellantPersonId: OWNER,
      targetType: "ATTRIBUTION",
      targetId: decisionId,
      reasonCode: "EVIDENCE_NOT_CONSIDERED",
      statement: "A key delivery was not included in the decision",
      evidenceRefs: [appealEvidenceRef],
      dueAt: appealDueAt,
    });
    expect(appeal.status).toBe(201);
    expect(appeal.body.data.dueAt).toBe(appealDueAt);
    expect(appeal.body.data.evidenceRefs).toEqual([appealEvidenceRef]);
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

    const notices = await call("GET", "/api/v1/notifications");
    expect(
      notices.body.data.some(
        (notification: { recipientPersonId: string; title: string }) =>
          notification.recipientPersonId === OWNER &&
          notification.title === "Appeal resolved",
      ),
    ).toBe(true);
  });
});
