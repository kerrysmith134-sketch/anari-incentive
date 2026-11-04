import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { Store } from "../store.js";
import { MemoryPlatformStore } from "../platform-store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000003";

let app: FastifyInstance;

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

beforeEach(() => {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
  app = buildApp(new Store(), undefined, undefined, platformStore);
});

describe("retention disposal processor (SEC-06)", () => {
  it("completes due approved disposals and skips legal holds", async () => {
    const policy = await call("POST", "/api/v1/retention-policies", {
      dataCategory: "AI_EVALUATION_EVIDENCE",
      retentionMonths: 12,
      legalBasis: "consent",
      legalHold: false,
    });
    expect(policy.status).toBe(201);

    const held = await call("POST", "/api/v1/retention-policies", {
      dataCategory: "PAYROLL_RECORDS",
      retentionMonths: 24,
      legalBasis: "statute",
      legalHold: true,
    });
    expect(held.status).toBe(201);

    const disposal = await call(
      "POST",
      "/api/v1/retention-disposal-requests",
      {
        retentionPolicyId: policy.body.data.id,
        requestedBy: OWNER,
        reason: "retention window elapsed",
        scheduledFor: new Date(Date.now() + 1000).toISOString(),
      },
    );
    expect(disposal.status).toBe(201);

    // Legal-hold categories refuse disposal creation outright.
    const blocked = await call("POST", "/api/v1/retention-disposal-requests", {
      retentionPolicyId: held.body.data.id,
      requestedBy: OWNER,
      reason: "should not pass",
      scheduledFor: new Date(Date.now() + 1000).toISOString(),
    });
    expect(blocked.status).toBe(409);

    await call(
      "POST",
      `/api/v1/retention-disposal-requests/${disposal.body.data.id}/approve`,
      { approvedBy: ADMIN },
    );

    // Before the grace period elapses the processor skips it.
    const early = await call("POST", "/api/v1/retention-disposal-requests:process", {
      actorPersonId: ADMIN,
    });
    expect(early.body.data.processedCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const processed = await call(
      "POST",
      "/api/v1/retention-disposal-requests:process",
      { actorPersonId: ADMIN },
    );
    expect(processed.body.data.processedCount).toBe(1);
    expect(processed.body.data.completed).toEqual([disposal.body.data.id]);

    const list = await call("GET", "/api/v1/retention-disposal-requests");
    expect(list.body.data[0].status).toBe("COMPLETED");
    expect(list.body.data[0].completedAt).toBeTruthy();

    // Idempotent: nothing left to process.
    const again = await call(
      "POST",
      "/api/v1/retention-disposal-requests:process",
      { actorPersonId: ADMIN },
    );
    expect(again.body.data.processedCount).toBe(0);
  });
});
