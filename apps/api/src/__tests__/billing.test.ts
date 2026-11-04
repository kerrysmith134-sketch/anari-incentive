import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { Store } from "../store.js";

let app: FastifyInstance;
let appStore: Store;

async function call(
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return { status: response.statusCode, body: response.json() };
}

const TEAM_PLAN = {
  code: "TEAM",
  name: "Team",
  monthlyPrice: "1999.00",
  currency: "CNY",
  seatLimit: 2,
  trialDays: 14,
  features: ["payroll", "audit"],
};

beforeEach(() => {
  appStore = new Store();
  app = buildApp(appStore);
});

describe("public signup and billing", () => {
  it("lists active plans publicly", async () => {
    const empty = await call("GET", "/api/v1/public/plans");
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);

    await call("POST", "/api/v1/platform/plans", {
      ...TEAM_PLAN,
      active: false,
    });
    // Inactive plans stay internal.
    expect((await call("GET", "/api/v1/public/plans")).body.data).toEqual([]);
    expect(
      (await call("GET", "/api/v1/platform/plans")).body.data,
    ).toHaveLength(1);
  });

  it("creates plans via the platform admin API", async () => {
    const created = await call("POST", "/api/v1/platform/plans", TEAM_PLAN);
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe("TEAM");
    expect(created.body.data.seatLimit).toBe(2);
  });

  it("rejects an invalid plan price", async () => {
    const created = await call("POST", "/api/v1/platform/plans", {
      ...TEAM_PLAN,
      monthlyPrice: "19.999",
    });
    expect(created.status).toBe(400);
  });

  it("signs up a tenant with a trial subscription without authentication", async () => {
    await call("POST", "/api/v1/platform/plans", TEAM_PLAN);
    const signup = await call("POST", "/api/v1/public/signup", {
      companyName: "Acme Energy",
      adminDisplayName: "Kerry",
      adminEmail: "admin@acme.test",
      planCode: "TEAM",
      acceptTerms: true,
    });
    expect(signup.status).toBe(201);
    expect(signup.body.data.tenantId).toBeTruthy();
    expect(signup.body.data.slug).toBe("acme-energy");
    expect(signup.body.data.subscription.status).toBe("TRIALING");
    expect(signup.body.data.subscription.planCode).toBe("TEAM");
    expect(signup.body.data.subscription.trialEndsAt).toBeTruthy();
  });

  it("rejects signup when terms are not accepted", async () => {
    const signup = await call("POST", "/api/v1/public/signup", {
      companyName: "Acme Energy",
      adminDisplayName: "Kerry",
      adminEmail: "admin@acme.test",
      acceptTerms: false,
    });
    expect(signup.status).toBe(400);
  });

  it("rate-limits repeated signups from one IP", async () => {
    for (let index = 0; index < 10; index += 1) {
      const attempt = await call("POST", "/api/v1/public/signup", {
        companyName: `Tenant ${index}`,
        adminDisplayName: "Kerry",
        adminEmail: `admin${index}@acme.test`,
        acceptTerms: true,
      });
      expect(attempt.status).toBe(201);
    }
    const blocked = await call("POST", "/api/v1/public/signup", {
      companyName: "One too many",
      adminDisplayName: "Kerry",
      adminEmail: "overflow@acme.test",
      acceptTerms: true,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });

  it("can disable self-service signup", async () => {
    const disabled = buildApp(
      new Store(),
      undefined,
      undefined,
      undefined,
      { publicSignup: false },
    );
    const response = await disabled.inject({
      method: "POST",
      url: "/api/v1/public/signup",
      payload: {
        companyName: "Acme Energy",
        adminDisplayName: "Kerry",
        adminEmail: "admin@acme.test",
        acceptTerms: true,
      },
    } as never);
    expect(response.statusCode).toBe(404);
  });

  it("enforces the plan seat limit when onboarding people", async () => {
    await call("POST", "/api/v1/platform/plans", TEAM_PLAN);
    const signup = await call("POST", "/api/v1/public/signup", {
      companyName: "Acme Energy",
      adminDisplayName: "Kerry",
      adminEmail: "admin@acme.test",
      planCode: "TEAM",
      acceptTerms: true,
    });
    const tenantId = signup.body.data.tenantId;

    const second = await call(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons`,
      { employeeCode: "E002", displayName: "Second Person" },
    );
    expect(second.status).toBe(201);

    const third = await call(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons`,
      { employeeCode: "E003", displayName: "Third Person" },
    );
    expect(third.status).toBe(402);
    expect(third.body.error.code).toBe("SEAT_LIMIT_REACHED");

    // Inactive onboarding stays possible at the limit: only ACTIVE people
    // consume seats.
    const inactive = await call(
      "POST",
      `/api/v1/platform/tenants/${tenantId}/persons`,
      {
        employeeCode: "E004",
        displayName: "Pre-hire Person",
        employmentStatus: "TERMINATED",
      },
    );
    expect(inactive.status).toBe(201);
  });

  it("manages subscriptions and invoices end to end", async () => {
    await call("POST", "/api/v1/platform/plans", TEAM_PLAN);

    const missing = await call("GET", "/api/v1/me/subscription");
    expect(missing.status).toBe(404);

    const set = await call(
      "PUT",
      "/api/v1/platform/tenants/tenant-demo/subscription",
      {
        planCode: "TEAM",
        status: "ACTIVE",
        seats: 2,
        currentPeriodStart: "2026-11-01T00:00:00.000Z",
        currentPeriodEnd: "2026-11-30T23:59:59.000Z",
      },
    );
    expect(set.status).toBe(200);
    expect(set.body.data.status).toBe("ACTIVE");

    const mine = await call("GET", "/api/v1/me/subscription");
    expect(mine.status).toBe(200);
    expect(mine.body.data.planCode).toBe("TEAM");

    const invoice = await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/invoices",
      {
        lineItems: [
          {
            description: "Team plan, November 2026",
            quantity: 1,
            unitAmount: "1999.00",
            amount: "1999.00",
          },
        ],
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        dueDate: "2026-12-07",
      },
    );
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.number).toMatch(/^INV-\d{6}-\d{4}$/);
    expect(invoice.body.data.totalAmount).toBe("1999.00");
    expect(invoice.body.data.status).toBe("DRAFT");

    const issued = await call(
      "POST",
      `/api/v1/platform/invoices/${invoice.body.data.id}/status`,
      { status: "ISSUED" },
    );
    expect(issued.body.data.status).toBe("ISSUED");
    expect(issued.body.data.issuedAt).toBeTruthy();

    const paid = await call(
      "POST",
      `/api/v1/platform/invoices/${invoice.body.data.id}/status`,
      { status: "PAID" },
    );
    expect(paid.body.data.status).toBe("PAID");
    expect(paid.body.data.paidAt).toBeTruthy();

    const listed = await call("GET", "/api/v1/me/invoices");
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].status).toBe("PAID");
  });

  it("rejects invoices for tenants without a subscription", async () => {
    const created = await call(
      "POST",
      "/api/v1/platform/tenants/tenant-demo/invoices",
      {
        lineItems: [
          {
            description: "Orphan",
            quantity: 1,
            unitAmount: "1.00",
            amount: "1.00",
          },
        ],
      },
    );
    expect(created.status).toBe(404);
  });
});
