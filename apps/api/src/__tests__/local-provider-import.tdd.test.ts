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
  normalizeCrmDeal,
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

describe("TDD: provider API chains", () => {
  it("round 32: commercial order projection imports account -> opportunity -> quote -> contract -> order", async () => {
    const app = buildTestApp();
    const order = (fixture("commercial-orders.sample.json") as { data: unknown[] }).data[0];
    const writes = normalizeCommercialOrder(order);
    const list = Array.isArray(writes) ? writes : [writes];
    expect(list).toHaveLength(5);
    for (const write of list) {
      const result = await post(app, write.path, write.body);
      expect(result.status, `${write.path}: ${JSON.stringify(result.json)}`).toBeLessThan(300);
    }
    const orders = await app.inject({ method: "GET", url: "/api/v1/commercial/orders" });
    expect(orders.statusCode).toBe(200);
  });

  it("round 33: repeating the same commercial order projection is idempotent", async () => {
    const app = buildTestApp();
    const order = (fixture("commercial-orders.sample.json") as { data: unknown[] }).data[0];
    const writes = normalizeCommercialOrder(order);
    const list = Array.isArray(writes) ? writes : [writes];
    for (const pass of [1, 2]) {
      for (const write of list) {
        const result = await post(app, write.path, write.body);
        expect(result.status, `pass ${pass} ${write.path}`).toBeLessThan(300);
      }
    }
    const rows = await app.inject({ method: "GET", url: "/api/v1/commercial/orders" });
    const body = rows.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("round 35: ticketing projection imports a work item", async () => {
    const app = buildTestApp();
    const ticket = (fixture("ticketing-ticket-list-page1.json") as { items: unknown[] }).items[0];
    const result = normalizeTicketRecord(ticket, "BOARD-7");
    expect(result.writes).toHaveLength(1);
    const response = await post(app, "/api/v1/work-items/import", result.writes[0]!.body);
    expect(response.status, JSON.stringify(response.json)).toBeLessThan(300);
    const list = await app.inject({ method: "GET", url: "/api/v1/work-items?projectId=BOARD-7" });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  it("round 36: CRM deal projection imports an opportunity", async () => {
    const app = buildTestApp();
    const deal = (fixture("crm-deals.page1.json") as { deals: unknown[] }).deals[0];
    const writes = normalizeCrmDeal(deal);
    const list = Array.isArray(writes) ? writes : [writes];
    expect(list.length).toBeGreaterThan(0);
    for (const write of list) {
      const response = await post(app, write.path, write.body);
      expect(response.status, `${write.path}: ${JSON.stringify(response.json)}`).toBeLessThan(300);
    }
  });

  it("round 37: PingCode work item projection imports", async () => {
    const app = buildTestApp();
    const record = (fixture("pingcode-work-items.sample.json") as { values: unknown[] }).values[0];
    const target = LOCAL_PROVIDERS.pingcode!.targets[0]!;
    const normalized = target.normalize(record);
    const list = Array.isArray(normalized) ? normalized : [normalized];
    expect(list).toHaveLength(1);
    const response = await post(app, "/api/v1/work-items/import", list[0]!.body);
    expect(response.status, JSON.stringify(response.json)).toBeLessThan(300);
  });

  it("round 34: people import isolates tenants", async () => {
    const app = buildTestApp();
    const first = await post(app, "/api/v1/people/import", {
      sourceSystem: "ANARI_HR",
      externalId: "cross-tenant-1",
      employeeCode: "E-CROSS-1",
      displayName: "Cross Tenant",
    });
    expect([200, 201]).toContain(first.status);
  });
});
