import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importWorkItemSchema } from "@anari/contracts";
import {
  createTicketingProvider,
  extractTicketItems,
  normalizeTicketRecord,
  TICKETING_PROJECT_ID_ENV,
  ticketingPagination,
  ticketingProvider,
} from "../ticketing.js";
import type { CanonicalWrite, LocalProvider } from "../types.js";

const root = process.cwd();
const ENGINEER_ID = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const REPORTER_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, "fixtures", "connectors", name), "utf8"),
  ) as Record<string, unknown>;
}

function itemsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const items = body.items;
  if (!Array.isArray(items)) throw new Error("fixture has no items");
  return items as Array<Record<string, unknown>>;
}

function without(
  record: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const copy = { ...record };
  for (const key of keys) delete copy[key];
  return copy;
}

function writesOf(provider: LocalProvider, record: unknown): CanonicalWrite[] {
  const result = provider.targets[0]!.normalize(record);
  return Array.isArray(result) ? result : [result];
}

function expectImportable(body: Record<string, unknown>): void {
  const parsed = importWorkItemSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(JSON.stringify(parsed.error.issues));
  }
  expect(parsed.success).toBe(true);
}

const page1 = readFixture("ticketing-ticket-list-page1.json");
const page2 = readFixture("ticketing-ticket-list-page2.json");
const page1Items = itemsOf(page1);
const page2Items = itemsOf(page2);
/** Real TicketResponse (resolved, assigned engineer). */
const ticketA = page1Items[0]!;
/** Real TicketResponse (closed with resolved_at, assigned engineer). */
const ticketC = page2Items[0]!;
/** Board-scoped provider: the only seam that supplies a real project id. */
const boardProvider = createTicketingProvider({ projectId: "BOARD-7" });

describe("ticketing provider: real upstream contract", () => {
  it("targets GET /api/v1/admin/tickets with the real skip/limit paging", () => {
    expect(ticketingProvider).toMatchObject({
      code: "anari-ticketing",
      sourceSystem: "ANARI_TICKETING",
      baseUrlEnv: "ANARI_TICKETING_BASE_URL",
      tokenEnv: "ANARI_TICKETING_TOKEN",
    });
    expect(ticketingProvider.targets).toHaveLength(1);

    const target = ticketingProvider.targets[0]!;
    expect(target.method).toBe("GET");
    expect(target.path).toBe("/api/v1/admin/tickets");
    // TicketFilterParams uses skip/limit; `page` is a response-only field.
    expect(target.pageParam).toBe("skip");
    expect(target.limitParam).toBe("limit");
    expect(target.pageSize).toBe(ticketingPagination.maxLimit);
    expect(TICKETING_PROJECT_ID_ENV).toBe("ANARI_TICKETING_PROJECT_ID");
    expect(ticketingPagination).toEqual({
      mode: "offset",
      offsetParam: "skip",
      limitParam: "limit",
      pageSize: 100,
      maxLimit: 100,
      maxOffset: 20_000,
      hasNextField: "has_next",
      totalField: "total",
    });
  });

  it("extracts TicketListResponse.items and advances skip by the page limit", () => {
    expect(extractTicketItems(page1)).toHaveLength(2);
    expect(extractTicketItems(page2)).toHaveLength(1);
    expect(page1).toMatchObject({
      total: 3,
      skip: 0,
      limit: 2,
      page: 1,
      total_capped: false,
    });
    expect(page2).toMatchObject({
      total: 3,
      skip: 2,
      limit: 2,
      page: 2,
      total_capped: false,
    });

    // has_next is exact (limit + 1 fetch upstream), so the runner can stop
    // without a second count round-trip.
    expect(page1.has_next).toBe(true);
    expect(page1.next_cursor).toBeTruthy();
    expect(page2.has_next).toBe(false);
    expect(page2.next_cursor).toBeNull();
    expect((page1.skip as number) + (page2.limit as number)).toBe(page2.skip);
  });

  it("throws rather than treating a malformed body as an empty page", () => {
    expect(() => extractTicketItems({ data: [] })).toThrow(/items array/);
    expect(() => extractTicketItems([])).toThrow(/JSON object/);
    expect(() => extractTicketItems(null)).toThrow(/JSON object/);
  });
});

describe("ticketing provider: projectId is absent upstream", () => {
  it("the real TicketResponse has no project/board field", () => {
    // The fixture is a full TicketResponse, not a trimmed projection.
    for (const key of [
      "id",
      "ticket_no",
      "customer_id",
      "customer_name",
      "customer_email",
      "assigned_to",
      "assigned_name",
      "channel",
      "ticket_type",
      "intent",
      "priority",
      "status",
      "subject",
      "description",
      "first_response_at",
      "first_response_deadline",
      "resolved_at",
      "resolution_deadline",
      "closed_at",
      "reopened_at",
      "reopen_count",
      "created_at",
      "updated_at",
      "device_snapshot",
    ]) {
      expect(ticketA, key).toHaveProperty(key);
    }
    for (const key of ["project_id", "projectId", "board_id", "boardId"]) {
      expect(ticketA).not.toHaveProperty(key);
    }
  });

  it("skips every real ticket instead of inventing a project bucket", () => {
    // Default provider: no configured project, and upstream supplies none.
    expect(ticketingProvider.targets[0]!.normalize(ticketA)).toEqual([]);
    expect(normalizeTicketRecord(ticketA).writes).toEqual([]);
    expect(normalizeTicketRecord(ticketA).skipped).toEqual([
      { reason: "MISSING_PROJECT_ID", externalId: "TKT-2026-00042" },
    ]);

    for (const ticket of [...page1Items, ...page2Items]) {
      const result = normalizeTicketRecord(ticket);
      expect(result.writes).toHaveLength(0);
      expect(result.skipped[0]?.reason).toBe("MISSING_PROJECT_ID");
    }
  });

  it("accepts a real configured project/board id and produces a contract body", () => {
    const writes = writesOf(boardProvider, ticketA);
    expect(writes).toHaveLength(1);

    const write = writes[0]!;
    expect(write.path).toBe("/api/v1/work-items/import");
    expect(write.externalId).toBe("TKT-2026-00042");
    expect(write.body).toMatchObject({
      sourceSystem: "ANARI_TICKETING",
      externalId: "TKT-2026-00042",
      projectId: "BOARD-7",
      title: "Charging session fails at 80%",
      // Ticket types have no work-item equivalent; the real type stays in payload.
      type: "OTHER",
      status: "DONE",
      priority: "HIGH",
      assigneePersonId: ENGINEER_ID,
      weight: "1",
      currency: "CNY",
      amount: "0",
      startedAt: "2026-11-20T09:00:00.000Z",
      completedAt: "2026-11-21T11:00:00.000Z",
      events: [
        { toStatus: "DONE", occurredAt: "2026-11-21T11:00:00.000Z" },
      ],
      contributions: [{ personId: ENGINEER_ID, role: "ASSIGNEE", ratio: "1" }],
    });
    // No created_by / due_at in the real response: do not fabricate them.
    expect(write.body).not.toHaveProperty("reporterPersonId");
    expect(write.body).not.toHaveProperty("dueAt");
    expectImportable(write.body);
  });

  it("keeps the raw upstream facts in payload without copying customer PII", () => {
    const body = writesOf(boardProvider, ticketA)[0]!.body;
    expect(body.payload).toMatchObject({
      ticketId: "0d9f8e7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f",
      ticketNo: "TKT-2026-00042",
      ticketType: "technical",
      channel: "portal",
      intent: "charging_failure",
      status: "resolved",
      priority: "high",
      customerId: "5f0c2a7e-2b1d-4e3a-9c4d-1a2b3c4d5e6f",
      assignedTo: ENGINEER_ID,
      reopenCount: 0,
      createdAt: "2026-11-20T09:00:00.000Z",
      resolvedAt: "2026-11-21T11:00:00.000Z",
    });
    const serialized = JSON.stringify(body.payload);
    expect(serialized).not.toContain("ops@northwind.example");
    expect(serialized).not.toContain("Northwind Charging");
    expect(body.payload).not.toHaveProperty("description");
  });
});

describe("ticketing provider: field normalisation", () => {
  it("drops a non-UUID assigned_to and its contribution", () => {
    const record = { ...ticketA, assigned_to: "engineer-42" };
    const body = writesOf(boardProvider, record)[0]!.body;
    expect(body).not.toHaveProperty("assigneePersonId");
    expect(body).not.toHaveProperty("contributions");
    // The raw value remains auditable in payload.
    expect((body.payload as Record<string, unknown>).assignedTo).toBe(
      "engineer-42",
    );
    expectImportable(body);
  });

  it("omits assignee fields when assigned_to is null", () => {
    const body = writesOf(boardProvider, { ...ticketA, assigned_to: null })[0]!
      .body;
    expect(body).not.toHaveProperty("assigneePersonId");
    expect(body).not.toHaveProperty("contributions");
    expectImportable(body);
  });

  it("uses reporter/created_by and due_at only when upstream provides them", () => {
    const record = {
      ...ticketA,
      created_by: REPORTER_ID,
      due_at: "2026-11-25T10:00:00Z",
    };
    const body = writesOf(boardProvider, record)[0]!.body;
    expect(body.reporterPersonId).toBe(REPORTER_ID);
    expect(body.dueAt).toBe("2026-11-25T10:00:00.000Z");
    expectImportable(body);
  });

  it("drops a non-UUID created_by", () => {
    const body = writesOf(boardProvider, { ...ticketA, created_by: "mei" })[0]!
      .body;
    expect(body).not.toHaveProperty("reporterPersonId");
    expectImportable(body);
  });

  it("maps enum values case-insensitively while preserving the raw payload", () => {
    const body = writesOf(boardProvider, {
      ...ticketA,
      ticket_type: "TECHNICAL",
      status: "RESOLVED",
      priority: "HIGH",
    })[0]!.body;
    expect(body.type).toBe("OTHER");
    expect(body.status).toBe("DONE");
    expect(body.priority).toBe("HIGH");
    expect((body.payload as Record<string, unknown>).ticketType).toBe(
      "TECHNICAL",
    );
    expectImportable(body);
  });

  it("normalises timestamps to UTC ISO and drops unparseable dates", () => {
    const body = writesOf(boardProvider, {
      ...ticketA,
      created_at: "2026-11-20T09:00:00+08:00",
      resolved_at: "not-a-date",
    })[0]!.body;
    expect(body.startedAt).toBe("2026-11-20T01:00:00.000Z");
    expect(body).not.toHaveProperty("completedAt");
    expect(body).not.toHaveProperty("events");
    expectImportable(body);
  });

  it("drops an unmappable priority rather than coercing it", () => {
    const body = writesOf(boardProvider, { ...ticketA, priority: "critical" })[0]!
      .body;
    expect(body).not.toHaveProperty("priority");
    expectImportable(body);
  });
});

describe("ticketing provider: status history is not fabricated", () => {
  it("maps resolved → DONE at resolved_at", () => {
    const body = writesOf(boardProvider, ticketA)[0]!.body;
    expect(body.status).toBe("DONE");
    expect(body.completedAt).toBe("2026-11-21T11:00:00.000Z");
    expect(body.events).toEqual([
      { toStatus: "DONE", occurredAt: "2026-11-21T11:00:00.000Z" },
    ]);
  });

  it("maps closed with resolved_at (normal sign-off) → DONE", () => {
    const body = writesOf(boardProvider, ticketC)[0]!.body;
    expect(body.status).toBe("DONE");
    expect(body.completedAt).toBe("2026-11-23T10:00:00.000Z");
    expect(body.events).toEqual([
      { toStatus: "DONE", occurredAt: "2026-11-23T10:00:00.000Z" },
    ]);
    expect((body.payload as Record<string, unknown>).closedAt).toBe(
      "2026-11-24T09:00:00.000Z",
    );
    expectImportable(body);
  });

  it("maps closed without resolved_at (withdrawal) → CANCELLED", () => {
    const body = writesOf(boardProvider, {
      ...ticketC,
      resolved_at: null,
      closed_at: "2026-11-24T09:00:00Z",
    })[0]!.body;
    expect(body.status).toBe("CANCELLED");
    expect(body).not.toHaveProperty("completedAt");
    expect(body.events).toEqual([
      { toStatus: "CANCELLED", occurredAt: "2026-11-24T09:00:00.000Z" },
    ]);
    expectImportable(body);
  });

  it("does not turn a closed sign-off into a withdrawal when resolved_at is malformed", () => {
    const body = writesOf(boardProvider, {
      ...ticketC,
      status: "closed",
      resolved_at: "not-a-date",
      closed_at: "2026-11-24T09:00:00Z",
    })[0]!.body;
    // Presence of resolved_at proves sign-off; the bad timestamp is dropped.
    expect(body.status).toBe("DONE");
    expect(body).not.toHaveProperty("completedAt");
    expect(body).not.toHaveProperty("events");
    expectImportable(body);
  });

  it("does not synthesise a start event for an open ticket", () => {
    const body = writesOf(boardProvider, {
      ...ticketA,
      status: "open",
      resolved_at: null,
      closed_at: null,
      reopened_at: null,
    })[0]!.body;
    expect(body.status).toBe("OPEN");
    expect(body).not.toHaveProperty("completedAt");
    expect(body).not.toHaveProperty("events");
    expectImportable(body);
  });
});

describe("ticketing provider: required fields fail closed", () => {
  it("skips records that cannot satisfy the import contract", () => {
    const cases: Array<{
      name: string;
      record: unknown;
      projectId?: string;
      reason: string;
    }> = [
      {
        name: "not an object",
        record: "ticket",
        projectId: "BOARD-7",
        reason: "NOT_AN_OBJECT",
      },
      {
        name: "no ticket_no and no id",
        record: without(ticketA, ["ticket_no", "id"]),
        projectId: "BOARD-7",
        reason: "MISSING_EXTERNAL_ID",
      },
      {
        name: "no project",
        record: ticketA,
        reason: "MISSING_PROJECT_ID",
      },
      {
        name: "blank subject",
        record: { ...ticketA, subject: "   " },
        projectId: "BOARD-7",
        reason: "MISSING_TITLE",
      },
      {
        name: "no ticket_type",
        record: without(ticketA, ["ticket_type"]),
        projectId: "BOARD-7",
        reason: "MISSING_TYPE",
      },
      {
        name: "unknown ticket_type",
        record: { ...ticketA, ticket_type: "refund" },
        projectId: "BOARD-7",
        reason: "UNMAPPED_TYPE",
      },
      {
        name: "no status",
        record: without(ticketA, ["status"]),
        projectId: "BOARD-7",
        reason: "MISSING_STATUS",
      },
      {
        name: "unknown status",
        record: { ...ticketA, status: "pending" },
        projectId: "BOARD-7",
        reason: "UNMAPPED_STATUS",
      },
    ];

    for (const entry of cases) {
      const result = normalizeTicketRecord(entry.record, entry.projectId);
      expect(result.writes, entry.name).toEqual([]);
      expect(result.skipped, entry.name).toHaveLength(1);
      expect(result.skipped[0]?.reason, entry.name).toBe(entry.reason);
    }
  });

  it("falls back to id when ticket_no is blank", () => {
    const write = writesOf(boardProvider, {
      ...ticketA,
      ticket_no: "  ",
    })[0]!;
    expect(write.externalId).toBe("0d9f8e7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f");
    expect(write.body.externalId).toBe(
      "0d9f8e7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f",
    );
    expectImportable(write.body);
  });

  it("reads a future project/board field when upstream exposes one", () => {
    const write = writesOf(createTicketingProvider(), {
      ...ticketA,
      board_id: "BOARD-9",
    })[0]!;
    expect(write.body.projectId).toBe("BOARD-9");
    expectImportable(write.body);
  });
});
