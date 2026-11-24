import type { SettlementBatch, SettlementLine } from "@anari/domain";

export const DEFAULT_TENANT_ID = "tenant-demo";
export const DEMO_CYCLE_ID = "00000000-0000-4000-8000-000000000020";

export class NotFoundError extends Error {
  readonly code = "RESOURCE_NOT_FOUND";
  constructor(message: string) {
    super(message);
  }
}

export class ConflictError extends Error {
  readonly code = "CONFLICT";
  constructor(message: string) {
    super(message);
  }
}

export class CalculationBlockedError extends Error {
  readonly code = "CALCULATION_BLOCKED";
  constructor(readonly blockers: string[]) {
    super(`Calculation blocked: ${blockers.join(", ")}`);
  }
}

/** Timestamp helper shared by every store domain. */
export function now(): string {
  return new Date().toISOString();
}

/** Throws the canonical "not found" error for a domain object. */
export function notFound(kind: string, id: string): never {
  throw new NotFoundError(`${kind} ${id} not found`);
}

/** Escapes one CSV field, neutralising spreadsheet formulas. */
export function csvField(value: unknown, protectFormula = true): string {
  let text = value === undefined || value === null ? "" : String(value);
  // A plain decimal number can never be a spreadsheet formula, so it must
  // keep its sign (negative RECOVERY nets are legitimate money); anything
  // else starting with a formula trigger still gets the "'" guard.
  const plainNumber = /^-?\d+(\.\d+)?$/;
  if (
    protectFormula &&
    /^[=+\-@\t\r]/.test(text) &&
    !plainNumber.test(text)
  ) {
    text = `'${text}`;
  }
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Renders the settlement-batch export exactly as the API has always served it. */
export function settlementCsv(
  batch: SettlementBatch,
  lines: SettlementLine[],
): string {
  const header =
    "batch_no,person_id,employee_code,person_name,ledger_id,amount,currency";
  const rows = lines
    .filter((line) => line.active)
    .map((line) =>
      [
        batch.batchNo,
        line.personId,
        line.personCode,
        line.personName,
        line.ledgerId,
        line.amount,
        line.currency,
      ]
        .map((value, index) => csvField(value, index !== 5))
        .join(","),
    );
  return [header, ...rows].join("\n") + "\n";
}
