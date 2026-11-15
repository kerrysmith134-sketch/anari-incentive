import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const ACTOR = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

function setup() {
  const store = new Store("tenant-demo");
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo",
      slug: "demo",
      persons: [
        { id: ACTOR, employeeCode: "E001", displayName: "Actor" },
        { id: OTHER, employeeCode: "E002", displayName: "Other" },
      ],
    },
  });
  const app = buildApp(
    store,
    undefined,
    {
      async authenticate() {
        return { tenantId: "tenant-demo", userId: "user-actor", personId: ACTOR, roles: ["employee"] };
      },
    },
    platformStore,
  );
  return { app, store };
}

const eventBody = (subjectPersonId: string, extra: Record<string, unknown> = {}) => ({
  subjectPersonId,
  action: "Resolved commissioning issue",
  targetType: "ORDER",
  targetId: "ORDER-001",
  occurredAt: "2026-11-15T08:00:00.000Z",
  kind: "CONTRIBUTION",
  outcome: { summary: "Customer commissioning resumed" },
  evidenceRefs: [],
  ...extra,
});

describe("manual contribution event identity boundary", () => {
  it("derives actor and source from the authenticated session", async () => {
    const { app, store } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contribution-events",
      payload: eventBody(ACTOR),
    });
    expect(response.statusCode).toBe(201);
    const events = await store.listContributionEvents({ subjectPersonId: ACTOR });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorPersonId: ACTOR, subjectPersonId: ACTOR, source: "MANUAL" });
    await app.close();
  });

  it("rejects self-service attribution to another person", async () => {
    const { app, store } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contribution-events",
      payload: eventBody(OTHER),
    });
    expect(response.statusCode).toBe(403);
    expect(await store.listContributionEvents()).toHaveLength(0);
    await app.close();
  });

  it("rejects caller-supplied actor or source fields", async () => {
    const { app, store } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contribution-events",
      payload: eventBody(ACTOR, { actorPersonId: OTHER, source: "ERP" }),
    });
    expect(response.statusCode).toBe(400);
    expect(await store.listContributionEvents()).toHaveLength(0);
    await app.close();
  });
});
