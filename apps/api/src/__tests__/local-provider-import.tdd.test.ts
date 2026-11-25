import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import {
  LOCAL_PROVIDERS,
  normalizeCommercialOrder,
  normalizeCommercialQuote,
  normalizeHrPerson,
  normalizeTicketRecord,
} from "@anari/connectors";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/connectors/${name}`, import.meta.url)), "utf8"));

const TENANT = "00000000-0000-4000-8000-0000000000aa";
const ADMIN = "00000000-0000-4000-8000-0000000000ab";

function buildTestApp() {
  const platformStore = new MemoryPlatformStore({
    demoTenant: { id: TENANT, name: "TDD tenant", slug: "tdd" },
  });
  return buildApp(
    () => new Store(TENANT),
    undefined,
    {
      async authenticate() {
        return {
          tenantId: TENANT,
          userId: "tdd",
          roles: ["admin", "manager", "finance", "integration"],
          personId: ADMIN,
        };
      },
    },
    platformStore,
  );
}

async function post(app: ReturnType<typeof buildApp>, url: string, body: unknown) {
  const response = await app.inject({ method: "POST", url, payload: body as object });
  return { status: response.statusCode, json: response.json() as { data?: unknown; error?: { message?: string } } };
}

describe("TDD: local provider projections", () => {
  it("round 2: people import is idempotent by source external id", async () => {
    const app = buildTestApp();
    const first = await post(app, "/api/v1/people/import", {
      sourceSystem: "ANARI_HR",
      externalId: "hr-person-1",
      employeeCode: "E-HR-1",
      displayName: "Imported Person",
      employmentStatus: "ACTIVE",
    });
    expect(first.status).toBe(201);
    const second = await post(app, "/api/v1/people/import", {
      sourceSystem: "ANARI_HR",
      externalId: "hr-person-1",
      employeeCode: "E-HR-1",
      displayName: "Imported Person",
      employmentStatus: "ACTIVE",
    });
    expect(second.status).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/v1/platform/tenants/" + TENANT + "/persons" });
    const rows = (list.json() as { data: Array<{ employeeCode: string }> }).data;
    expect(rows.filter((row) => row.employeeCode === "E-HR-1")).toHaveLength(1);
  });

  it("round 3: default ticketing provider projects a stable project bucket", () => {
    const ticket = (fixture("ticketing-ticket-list-page1.json") as { items: unknown[] }).items[0];
    const writes = normalizeTicketRecord(ticket, "ANARI-TICKETING").writes;
    expect(writes).toHaveLength(1);
    expect(writes[0]!.body.projectId).toBe("ANARI-TICKETING");
    expect(LOCAL_PROVIDERS["anari-ticketing"]).toBeDefined();
  });

  it("round 1: commercial quote projection imports account -> opportunity -> quote", async () => {
    const app = buildTestApp();
    const quote = (fixture("commercial-quotes.sample.json") as { data: unknown[] }).data[0];
    const writes = normalizeCommercialQuote(quote);
    const list = Array.isArray(writes) ? writes : [writes];
    expect(list).toHaveLength(3);
    for (const write of list) {
      const result = await post(app, write.path, write.body);
      expect(result.status, `${write.path}: ${JSON.stringify(result.json)}`).toBeLessThan(300);
    }
  });
});
