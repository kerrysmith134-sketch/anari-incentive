import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";

let app: FastifyInstance;
let appStore: Store;
let platformStore: MemoryPlatformStore;
let employeeApp: FastifyInstance;

async function call(
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

async function employeeCall(
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await employeeApp.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

beforeEach(() => {
  appStore = new Store();
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: MEMBER, employeeCode: "E002", displayName: "Contributor" },
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore);
  employeeApp = buildApp(
    appStore,
    undefined,
    {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "emp-2",
          roles: ["employee"],
          personId: MEMBER,
        };
      },
    },
    platformStore,
  );
});

async function createdBounty(): Promise<string> {
  const created = await call("POST", "/api/v1/bounties", {
    title: "修复报表口径",
    description: "对齐本月提成报表与账本",
    rewardAmount: "800",
    currency: "CNY",
    createdBy: OWNER,
  });
  expect(created.status).toBe(201);
  return created.body.data.id;
}

describe("employee self-service: bounty", () => {
  it("lets an employee claim a bounty for themselves", async () => {
    const bountyId = await createdBounty();
    const claim = await employeeCall("POST", `/api/v1/bounties/${bountyId}/claim`, {
      personId: MEMBER,
    });
    expect(claim.status).toBeLessThan(300);
    const list = await employeeCall("GET", "/api/v1/bounties");
    const row = list.body.data.find((bounty: { id: string }) => bounty.id === bountyId);
    expect(row.assigneePersonId).toBe(MEMBER);
  });

  it("forbids claiming for somebody else", async () => {
    const bountyId = await createdBounty();
    const claim = await employeeCall("POST", `/api/v1/bounties/${bountyId}/claim`, {
      personId: OWNER,
    });
    expect(claim.status).toBe(403);
  });

  it("lets the assignee submit and blocks others from submitting", async () => {
    const bountyId = await createdBounty();
    await employeeCall("POST", `/api/v1/bounties/${bountyId}/claim`, {
      personId: MEMBER,
    });
    const foreign = await employeeCall("POST", `/api/v1/bounties/${bountyId}/submit`, {
      personId: OWNER,
      submissionRef: "pr-1",
    });
    expect(foreign.status).toBe(403);
    const own = await employeeCall("POST", `/api/v1/bounties/${bountyId}/submit`, {
      personId: MEMBER,
      submissionRef: "pr-1",
    });
    expect(own.status).toBeLessThan(300);
  });

  it("keeps acceptance and cancellation with managers", async () => {
    const bountyId = await createdBounty();
    await employeeCall("POST", `/api/v1/bounties/${bountyId}/claim`, {
      personId: MEMBER,
    });
    await employeeCall("POST", `/api/v1/bounties/${bountyId}/submit`, {
      personId: MEMBER,
      submissionRef: "pr-1",
    });
    const selfAccept = await employeeCall(
      "POST",
      `/api/v1/bounties/${bountyId}/accept`,
      { reviewerPersonId: MEMBER },
    );
    expect(selfAccept.status).toBe(403);
    const adminAccept = await call(
      "POST",
      `/api/v1/bounties/${bountyId}/accept`,
      { reviewerPersonId: OWNER },
    );
    expect(adminAccept.status).toBeLessThan(300);
  });
});

describe("employee self-service: equity", () => {
  async function grantFor(personId: string): Promise<string> {
    const grant = await call("POST", "/api/v1/equity-grants", {
      personId,
      grantCode: `G-${personId.slice(-4)}`,
      grantType: "RSU",
      totalUnits: "1200",
      strikePrice: "0",
      currency: "CNY",
      grantDate: "2025-01-01T00:00:00Z",
      vestingStart: "2025-01-01T00:00:00Z",
      cliffMonths: 12,
      vestingMonths: 48,
    });
    expect(grant.status).toBe(201);
    return grant.body.data.id;
  }

  it("shows people only their own grants", async () => {
    await grantFor(OWNER);
    await grantFor(MEMBER);
    const mine = await employeeCall("GET", "/api/v1/equity-grants");
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].personId).toBe(MEMBER);
  });

  it("lets employees read their own vesting but not others", async () => {
    const ownGrant = await grantFor(MEMBER);
    const foreignGrant = await grantFor(OWNER);
    const own = await employeeCall(
      "GET",
      `/api/v1/equity-grants/${ownGrant}/vesting`,
    );
    expect(own.status).toBe(200);
    const foreign = await employeeCall(
      "GET",
      `/api/v1/equity-grants/${foreignGrant}/vesting`,
    );
    expect(foreign.status).toBe(403);
  });

  it("lets employees request their own exercise but not someone else's", async () => {
    const grantId = await grantFor(MEMBER);
    const foreign = await employeeCall(
      "POST",
      `/api/v1/equity-grants/${grantId}/exercises`,
      { units: "10", requestedBy: OWNER },
    );
    expect(foreign.status).toBe(403);
    const own = await employeeCall(
      "POST",
      `/api/v1/equity-grants/${grantId}/exercises`,
      { units: "10", requestedBy: MEMBER },
    );
    expect(own.status).toBeLessThan(300);
  });
});
