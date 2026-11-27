import { parseCsv } from "@anari/connectors";

export interface PilotOrderParticipant {
  employeeCode: string;
  role: string;
}

export interface PilotOrder {
  recordNumber: number;
  orderId: string;
  title: string;
  objective: string;
  ownerEmployeeCode: string;
  participants: PilotOrderParticipant[];
  grossProfit: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
}

export interface ExistingPilotFinancialFact {
  sourceRecordId: string;
  amount: string;
  currency: string;
  periodStart?: string | Date;
  periodEnd?: string | Date;
}

export type PilotImportAction =
  | "CREATE_BOTH"
  | "CREATE_WORK_PACKAGE"
  | "CREATE_FINANCIAL_FACT"
  | "SKIP";

export interface PilotImportPlan {
  order: PilotOrder;
  action: PilotImportAction;
  createWorkPackage: boolean;
  createFinancialFact: boolean;
}

const REQUIRED_COLUMNS = [
  "order_id",
  "title",
  "objective",
  "owner_employee_code",
  "participants",
  "gross_profit",
  "currency",
  "period_start",
  "period_end",
] as const;

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function amountMicros(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new Error(`invalid gross_profit amount "${value}" (use decimal notation with at most 6 decimal places)`);
  const whole = match[2];
  if (!whole) throw new Error(`invalid gross_profit amount "${value}"`);
  const fraction = (match[3] ?? "").padEnd(6, "0");
  const magnitude = BigInt(whole) * 1_000_000n + BigInt(fraction || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

function normaliseDate(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/**
 * Strict, side-effect-free validation for the pilot import file.
 *
 * The shared RFC-4180 parser handles quoted fields/newlines; this layer
 * strips a UTF-8 BOM and validates the business schema before any DB write.
 */
export function parsePilotOrdersCsv(csv: string): PilotOrder[] {
  const source = csv.replace(/^\uFEFF/, "");
  const rows = parseCsv(source);
  if (rows.length === 0) throw new Error("orders CSV is empty");

  const header = (rows[0] ?? []).map((column) => column.trim().toLowerCase());
  if (header.length === 0 || header.every((column) => column.length === 0)) {
    throw new Error("orders CSV is missing its header row");
  }
  const duplicateHeaders = header.filter((column, index) => column && header.indexOf(column) !== index);
  if (duplicateHeaders.length > 0) {
    throw new Error(`orders CSV has duplicate header(s): ${[...new Set(duplicateHeaders)].join(", ")}`);
  }

  const indexes = new Map(header.map((column, index) => [column, index]));
  const missing = REQUIRED_COLUMNS.filter((column) => !indexes.has(column));
  if (missing.length > 0) {
    throw new Error(`orders CSV missing required column(s): ${missing.join(", ")}`);
  }

  const parsed: PilotOrder[] = [];
  const seenOrderIds = new Set<string>();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (row.every((cell) => cell.trim().length === 0)) continue;
    const recordNumber = rowIndex + 1;
    if (row.length !== header.length) {
      throw new Error(`CSV record ${recordNumber} has ${row.length} field(s); expected ${header.length}`);
    }
    const value = (column: (typeof REQUIRED_COLUMNS)[number]) =>
      (row[indexes.get(column)!] ?? "").trim();

    const orderId = value("order_id");
    const title = value("title");
    const objective = value("objective");
    const ownerEmployeeCode = value("owner_employee_code");
    const participantsRaw = value("participants");
    const grossProfit = value("gross_profit");
    const currency = value("currency").toUpperCase();
    const periodStart = value("period_start");
    const periodEnd = value("period_end");

    if (!orderId || orderId.length > 128 || /[\r\n|]/.test(orderId)) {
      throw new Error(`CSV record ${recordNumber}: order_id is empty or invalid`);
    }
    if (seenOrderIds.has(orderId)) {
      throw new Error(`CSV record ${recordNumber}: duplicate order_id "${orderId}" in this file`);
    }
    seenOrderIds.add(orderId);

    if (!title || title.length > 200) {
      throw new Error(`CSV record ${recordNumber} (${orderId}): title is required and must be at most 200 characters`);
    }
    if (!objective || objective.length > 2000) {
      throw new Error(`CSV record ${recordNumber} (${orderId}): objective is required and must be at most 2000 characters`);
    }
    if (!ownerEmployeeCode || ownerEmployeeCode.length > 128) {
      throw new Error(`CSV record ${recordNumber} (${orderId}): owner_employee_code is required`);
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`CSV record ${recordNumber} (${orderId}): currency must be a 3-letter ISO currency code`);
    }
    try {
      amountMicros(grossProfit);
    } catch (error) {
      throw new Error(`CSV record ${recordNumber} (${orderId}): ${(error as Error).message}`);
    }
    if (!validDateOnly(periodStart) || !validDateOnly(periodEnd)) {
      throw new Error(`CSV record ${recordNumber} (${orderId}): period_start and period_end must be valid YYYY-MM-DD dates`);
    }
    if (periodStart > periodEnd) {
      throw new Error(`CSV record ${recordNumber} (${orderId}): period_start must not be after period_end`);
    }

    const participants: PilotOrderParticipant[] = [];
    const seenParticipants = new Set<string>();
    for (const entry of participantsRaw.split("|")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const pair = trimmed.split(":");
      const employeeCode = (pair[0] ?? "").trim();
      const role = (pair[1] ?? "").trim().toUpperCase();
      if (pair.length !== 2 || !employeeCode || !/^[A-Z][A-Z0-9_]{1,31}$/.test(role)) {
        throw new Error(`CSV record ${recordNumber} (${orderId}): participant "${trimmed}" must use EMPLOYEE_CODE:ROLE format`);
      }
      if (seenParticipants.has(employeeCode)) {
        throw new Error(`CSV record ${recordNumber} (${orderId}): duplicate participant "${employeeCode}"`);
      }
      seenParticipants.add(employeeCode);
      participants.push({ employeeCode, role });
    }
    if (participants.length === 0) {
      throw new Error(`CSV record ${recordNumber} (${orderId}): at least one participant is required`);
    }

    const ownerParticipant = participants.find((participant) => participant.employeeCode === ownerEmployeeCode);
    if (ownerParticipant && ownerParticipant.role !== "OWNER") {
      throw new Error(`CSV record ${recordNumber} (${orderId}): owner_employee_code must have role OWNER in participants`);
    }
    if (!ownerParticipant) participants.unshift({ employeeCode: ownerEmployeeCode, role: "OWNER" });
    const owners = participants.filter((participant) => participant.role === "OWNER");
    if (owners.length !== 1 || owners[0]?.employeeCode !== ownerEmployeeCode) {
      throw new Error(`CSV record ${recordNumber} (${orderId}): exactly the declared owner must have role OWNER`);
    }

    parsed.push({
      recordNumber,
      orderId,
      title,
      objective,
      ownerEmployeeCode,
      participants,
      grossProfit,
      currency,
      periodStart,
      periodEnd,
    });
  }

  if (parsed.length === 0) throw new Error("orders CSV contains no order records");
  return parsed;
}

/**
 * Build a fail-closed, restart-safe import plan.
 *
 * Existing FinancialFacts are treated as immutable source snapshots here:
 * a matching source key with different business values is a correction case,
 * not permission for this pilot utility to create a new revision silently.
 */
export function planPilotOrderImports(
  orders: PilotOrder[],
  existingWorkPackageTitles: string[],
  existingFinancialFacts: ExistingPilotFinancialFact[],
): PilotImportPlan[] {
  const titleCounts = new Map<string, number>();
  for (const title of existingWorkPackageTitles) {
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  const factBySourceId = new Map<string, ExistingPilotFinancialFact>();
  for (const fact of existingFinancialFacts) {
    if (factBySourceId.has(fact.sourceRecordId)) {
      throw new Error(`multiple PILOT_IMPORT financial facts exist for order "${fact.sourceRecordId}"`);
    }
    factBySourceId.set(fact.sourceRecordId, fact);
  }

  return orders.map((order) => {
    const workPackageTitle = `试点订单 ${order.orderId}`;
    const titleCount = titleCounts.get(workPackageTitle) ?? 0;
    if (titleCount > 1) {
      throw new Error(`multiple work packages use pilot title "${workPackageTitle}"; resolve the duplicate before importing`);
    }
    const existingFact = factBySourceId.get(order.orderId);
    if (existingFact) {
      const same =
        amountMicros(existingFact.amount) === amountMicros(order.grossProfit) &&
        existingFact.currency.toUpperCase() === order.currency &&
        normaliseDate(existingFact.periodStart) === order.periodStart &&
        normaliseDate(existingFact.periodEnd) === order.periodEnd;
      if (!same) {
        throw new Error(
          `PILOT_IMPORT financial fact for order "${order.orderId}" differs from the CSV; do not overwrite an existing fact—use the controlled finance correction/revision workflow`,
        );
      }
    }

    const createWorkPackage = titleCount === 0;
    const createFinancialFact = !existingFact;
    const action: PilotImportAction =
      createWorkPackage && createFinancialFact
        ? "CREATE_BOTH"
        : createWorkPackage
          ? "CREATE_WORK_PACKAGE"
          : createFinancialFact
            ? "CREATE_FINANCIAL_FACT"
            : "SKIP";
    return { order, action, createWorkPackage, createFinancialFact };
  });
}
