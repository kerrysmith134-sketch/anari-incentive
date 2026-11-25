/**
 * ANARI Ticketing → canonical N-Perform work item provider.
 *
 * Verified against the real backend (anari-ticketing):
 *
 *   GET /api/v1/admin/tickets
 *     TicketFilterParams: skip (0..20_000), limit (1..100), sort_by,
 *     sort_order, and an optional keyset `cursor` (created_at sort only).
 *     TicketListResponse: { items, total, skip, limit, has_next, page,
 *     total_capped, next_cursor }.
 *
 *   TicketResponse exposes ticket_no, subject, ticket_type, status,
 *   priority, assigned_to, created_at, resolved_at, closed_at, ... but it
 *   exposes **no project/board, no created_by and no due_at** column.
 *
 * Target contract: POST /api/v1/work-items/import, where `projectId` is
 * required (`z.string().min(1).max(256)`) and `type`/`status` are closed
 * enums (STORY|TASK|BUG|EPIC|OTHER, OPEN|IN_PROGRESS|BLOCKED|DONE|CANCELLED).
 *
 * The two mismatches are handled by refusing to invent facts:
 *   - projectId: upstream has no project dimension. The provider skips every
 *     ticket with MISSING_PROJECT_ID unless the deployment supplies a real
 *     project/board id (createTicketingProvider({ projectId })) or a future
 *     upstream response carries project_id/projectId/board_id/boardId.
 *   - type/status: mapped with the explicit tables below; the raw upstream
 *     values stay in `payload`, and unmapped values are skipped, never
 *     silently coerced.
 *
 * `events` is derived only from dated transitions the response actually
 * reports (resolved_at / closed_at). Creation is not a known status
 * transition, so no OPEN-at-created_at event is synthesised.
 */
import type {
  WorkItemPriority,
  WorkItemStatus,
  WorkItemType,
} from "@anari/domain";
import type {
  CanonicalWrite,
  LocalProvider,
  PullTarget,
} from "./types.js";

/** Source-system marker used as the work item identity namespace. */
export const TICKETING_SOURCE_SYSTEM = "ANARI_TICKETING";
/** N-Perform write endpoint this provider normalises to. */
export const TICKETING_IMPORT_PATH = "/api/v1/work-items/import";
/** Real upstream list endpoint. */
export const TICKETING_TICKETS_PATH = "/api/v1/admin/tickets";
/**
 * Optional deployment setting a runner may read to supply a real project/board
 * id via createTicketingProvider({ projectId }). Not read here: providers
 * receive configuration from the runner, they do not read the environment.
 */
export const TICKETING_PROJECT_ID_ENV = "ANARI_TICKETING_PROJECT_ID";

/**
 * Paging description for the runner. The upstream API is offset-based
 * (`skip`/`limit`); `page` is response-only and is not accepted as a request
 * parameter. The keyset `cursor` is only valid for the created_at sort, so
 * the generic runner uses offset paging and honours `has_next`.
 */
export const ticketingPagination = {
  mode: "offset",
  offsetParam: "skip",
  limitParam: "limit",
  pageSize: 100,
  maxLimit: 100,
  maxOffset: 20_000,
  hasNextField: "has_next",
  totalField: "total",
} as const;

export type TicketingSkipReason =
  | "NOT_AN_OBJECT"
  | "MISSING_EXTERNAL_ID"
  | "MISSING_PROJECT_ID"
  | "MISSING_TITLE"
  | "MISSING_TYPE"
  | "UNMAPPED_TYPE"
  | "MISSING_STATUS"
  | "UNMAPPED_STATUS";

export interface TicketingSkip {
  externalId?: string;
  reason: TicketingSkipReason;
}

/**
 * Normalisation result. `writes` is what the runner posts; `skipped` carries
 * the reason a record produced no write (the LocalProvider interface itself
 * has no place for that, so the runner should call normalizeTicketRecord
 * directly when it wants skip telemetry).
 */
export interface TicketingNormalization {
  writes: CanonicalWrite[];
  skipped: TicketingSkip[];
}

type JsonObject = Record<string, unknown>;

/**
 * Ticket types describe the commercial stage, not the engineering artifact.
 * A support ticket is not inherently a story, task or bug, so every known
 * type maps to OTHER rather than inventing a classification. The raw
 * ticket_type is preserved in payload for a later, informed mapping.
 */
const TICKET_TYPE_TO_WORK_ITEM_TYPE: Readonly<Record<string, WorkItemType>> = {
  pre_sales: "OTHER",
  after_sales: "OTHER",
  technical: "OTHER",
  escalation: "OTHER",
};

const TICKET_PRIORITY_TO_WORK_ITEM_PRIORITY: Readonly<
  Record<string, WorkItemPriority>
> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  urgent: "URGENT",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asUuid(value: unknown): string | undefined {
  const text = asText(value);
  return text !== undefined && UUID_PATTERN.test(text) ? text : undefined;
}

/** Canonical ISO-8601 (UTC, `Z`), the form the import schema accepts. */
function asIso(value: unknown): string | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function mapTicketType(value: string): WorkItemType | undefined {
  const normalized = value.toLowerCase();
  return Object.prototype.hasOwnProperty.call(
    TICKET_TYPE_TO_WORK_ITEM_TYPE,
    normalized,
  )
    ? TICKET_TYPE_TO_WORK_ITEM_TYPE[normalized]
    : undefined;
}

/**
 * The upstream state machine distinguishes two ways into `closed`:
 *   resolved → closed   normal sign-off (resolved_at is set)      → DONE
 *   open/in_progress → closed  withdrawal (resolved_at stays null) → CANCELLED
 * So `closed` cannot be mapped without reading resolved_at.
 */
function mapTicketStatus(
  status: string,
  hasResolvedAt: boolean,
): WorkItemStatus | undefined {
  switch (status.toLowerCase()) {
    case "open":
      return "OPEN";
    case "in_progress":
      return "IN_PROGRESS";
    case "resolved":
      return "DONE";
    case "closed":
      // Presence, not parseability: a malformed date must not turn a sign-off
      // into a withdrawal.
      return hasResolvedAt ? "DONE" : "CANCELLED";
    default:
      return undefined;
  }
}

function mapTicketPriority(
  value: string | undefined,
): WorkItemPriority | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  return Object.prototype.hasOwnProperty.call(
    TICKET_PRIORITY_TO_WORK_ITEM_PRIORITY,
    normalized,
  )
    ? TICKET_PRIORITY_TO_WORK_ITEM_PRIORITY[normalized]
    : undefined;
}

/**
 * Only transitions the response dates are emitted. The current snapshot plus
 * resolved_at/closed_at proves a terminal transition; nothing in the list
 * response proves when an open/in-progress ticket entered that state, so no
 * event is invented for it.
 */
function buildEvents(
  status: WorkItemStatus,
  resolvedAt: string | undefined,
  closedAt: string | undefined,
): Array<{ toStatus: WorkItemStatus; occurredAt: string }> {
  if (status === "DONE" && resolvedAt) {
    return [{ toStatus: "DONE", occurredAt: resolvedAt }];
  }
  if (status === "CANCELLED" && closedAt) {
    return [{ toStatus: "CANCELLED", occurredAt: closedAt }];
  }
  return [];
}

/**
 * Curated raw snapshot for traceability. Customer name/email and the free-text
 * description are deliberately excluded: duplicating PII into work_items buys
 * nothing that ticket_id does not already give us.
 */
function buildPayload(ticket: JsonObject): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const entries: Array<[string, unknown]> = [
    ["ticketId", asText(ticket.id)],
    ["ticketNo", asText(ticket.ticket_no)],
    ["ticketType", asText(ticket.ticket_type)],
    ["channel", asText(ticket.channel)],
    ["intent", asText(ticket.intent)],
    ["status", asText(ticket.status)],
    ["priority", asText(ticket.priority)],
    ["customerId", asText(ticket.customer_id)],
    ["assignedTo", asText(ticket.assigned_to)],
    [
      "reopenCount",
      typeof ticket.reopen_count === "number" ? ticket.reopen_count : undefined,
    ],
    ["createdAt", asIso(ticket.created_at)],
    ["updatedAt", asIso(ticket.updated_at)],
    ["firstResponseAt", asIso(ticket.first_response_at)],
    ["firstResponseDeadline", asIso(ticket.first_response_deadline)],
    ["resolutionDeadline", asIso(ticket.resolution_deadline)],
    ["resolvedAt", asIso(ticket.resolved_at)],
    ["closedAt", asIso(ticket.closed_at)],
    ["reopenedAt", asIso(ticket.reopened_at)],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}

/**
 * Resolve a project/board identifier from the deployment configuration or,
 * if upstream ever exposes one, from the record itself. There is no fallback
 * to a fabricated bucket: no real id means the record is skipped.
 */
function resolveProjectId(
  ticket: JsonObject,
  configuredProjectId: string | undefined,
): string | undefined {
  return (
    asText(configuredProjectId) ??
    asText(ticket.project_id) ??
    asText(ticket.projectId) ??
    asText(ticket.board_id) ??
    asText(ticket.boardId)
  );
}

/**
 * Map one real TicketResponse to the exact /api/v1/work-items/import body.
 * Returns `writes: []` plus a reason when a required fact is absent or an
 * enum value has no honest mapping — never a half-filled body.
 */
export function normalizeTicketRecord(
  record: unknown,
  projectId?: string,
): TicketingNormalization {
  const skip = (reason: TicketingSkipReason, externalId?: string) => ({
    writes: [] as CanonicalWrite[],
    skipped: [{ reason, ...(externalId ? { externalId } : {}) }],
  });

  const ticket = asObject(record);
  if (!ticket) return skip("NOT_AN_OBJECT");

  const externalId = asText(ticket.ticket_no) ?? asText(ticket.id);
  if (!externalId) return skip("MISSING_EXTERNAL_ID");

  const resolvedProjectId = resolveProjectId(ticket, projectId);
  if (!resolvedProjectId) return skip("MISSING_PROJECT_ID", externalId);

  const title = asText(ticket.subject);
  if (!title) return skip("MISSING_TITLE", externalId);

  const ticketType = asText(ticket.ticket_type);
  if (!ticketType) return skip("MISSING_TYPE", externalId);
  const type = mapTicketType(ticketType);
  if (!type) return skip("UNMAPPED_TYPE", externalId);

  const ticketStatus = asText(ticket.status);
  if (!ticketStatus) return skip("MISSING_STATUS", externalId);
  const hasResolvedAt = asText(ticket.resolved_at) !== undefined;
  const resolvedAt = asIso(ticket.resolved_at);
  const closedAt = asIso(ticket.closed_at);
  const status = mapTicketStatus(ticketStatus, hasResolvedAt);
  if (!status) return skip("UNMAPPED_STATUS", externalId);

  const priority = mapTicketPriority(asText(ticket.priority));
  const assigneePersonId = asUuid(ticket.assigned_to);
  const reporterPersonId =
    asUuid(ticket.created_by) ?? asUuid(ticket.createdBy);
  const startedAt = asIso(ticket.created_at);
  const dueAt = asIso(ticket.due_at) ?? asIso(ticket.dueAt);
  const completedAt =
    status === "DONE" ? (resolvedAt ?? asIso(ticket.completed_at)) : undefined;
  const events = buildEvents(status, resolvedAt, closedAt);

  const body: Record<string, unknown> = {
    sourceSystem: TICKETING_SOURCE_SYSTEM,
    externalId,
    projectId: resolvedProjectId,
    title,
    type,
    status,
    // Fixed at the source: the list response carries no amount and a support
    // ticket is one unit of work. currency is required whenever amount exists.
    weight: "1",
    currency: "CNY",
    amount: "0",
    payload: buildPayload(ticket),
  };
  if (priority) body.priority = priority;
  if (assigneePersonId) body.assigneePersonId = assigneePersonId;
  if (reporterPersonId) body.reporterPersonId = reporterPersonId;
  if (startedAt) body.startedAt = startedAt;
  if (dueAt) body.dueAt = dueAt;
  if (completedAt) body.completedAt = completedAt;
  if (events.length > 0) body.events = events;
  if (assigneePersonId) {
    // The API only accepts UUIDs as person ids; a non-UUID assigned_to is
    // dropped above rather than guessed at.
    body.contributions = [
      { personId: assigneePersonId, role: "ASSIGNEE", ratio: "1" },
    ];
  }

  return {
    writes: [{ path: TICKETING_IMPORT_PATH, body, externalId }],
    skipped: [],
  };
}

/**
 * Extract `items` from a real TicketListResponse. A malformed body throws:
 * treating it as an empty page would mark the sync complete while silently
 * losing tickets.
 */
export function extractTicketItems(json: unknown): unknown[] {
  const body = asObject(json);
  if (!body) {
    throw new Error("ticketing: expected a JSON object response");
  }
  if (!Array.isArray(body.items)) {
    throw new Error("ticketing: response has no items array");
  }
  return body.items;
}

export interface TicketingProviderOptions {
  /**
   * A real project/board id to attribute tickets to. Upstream tickets carry no
   * project dimension, so without this every record is skipped with
   * MISSING_PROJECT_ID. Only configure an id that exists in the target
   * project system; this module never invents one.
   */
  projectId?: string;
}

export function createTicketingProvider(
  options: TicketingProviderOptions = {},
): LocalProvider {
  const target: PullTarget = {
    method: "GET",
    path: TICKETING_TICKETS_PATH,
    pageParam: ticketingPagination.offsetParam,
    limitParam: ticketingPagination.limitParam,
    pageSize: ticketingPagination.pageSize,
    extract: extractTicketItems,
    normalize: (record) =>
      normalizeTicketRecord(record, options.projectId).writes,
  };

  return {
    code: "anari-ticketing",
    sourceSystem: TICKETING_SOURCE_SYSTEM,
    baseUrlEnv: "ANARI_TICKETING_BASE_URL",
    tokenEnv: "ANARI_TICKETING_TOKEN",
    targets: [target],
  };
}

/**
 * Default provider. Because the real ticket response exposes no project or
 * board, this instance skips every ticket rather than writing a fabricated
 * projectId. Deployments that know their real support project id should use
 * createTicketingProvider({ projectId }).
 */
export const ticketingProvider: LocalProvider = createTicketingProvider({
  projectId: process.env.ANARI_TICKETING_PROJECT_ID,
});
