import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORE_ENTITY_CONTRACTS } from "@anari/domain";

const typesSource = readFileSync(
  fileURLToPath(new URL("../packages/domain/src/types.ts", import.meta.url)),
  "utf8",
);

const INTERFACE_BY_TABLE: Record<string, string> = {
  employment_contracts: "EmploymentContract",
  payroll_runs: "PayrollRun",
  payroll_lines: "PayrollLine",
  calculation_runs: "CalculationRun",
  calculation_lines: "CalculationLine",
  amount_ledger: "AmountLedgerEntry",
  settlement_batches: "SettlementBatch",
  settlement_lines: "SettlementLine",
  audit_events: "AuditEvent",
};

/** Fields the API adds at read time and that never exist as DDL columns. */
const VIEW_ONLY_COLUMNS: Record<string, string[]> = {
  employment_contracts: ["redacted_fields"],
  payroll_runs: ["lines"],
  payroll_lines: ["redacted_fields"],
  calculation_runs: ["lines"],
  settlement_batches: ["lines"],
  settlement_lines: ["person_code", "person_name", "redacted_fields"],
  audit_events: ["redacted", "redaction_id"],
};

/** Interface names that map onto a differently named DDL column. */
const COLUMN_ALIASES: Record<string, Record<string, string>> = {
  calculation_runs: { calculated_at: "finished_at" },
};

/** DDL columns intentionally not exposed on the domain interface yet. */
const DB_ONLY_COLUMNS: Record<string, string[]> = {
  calculation_runs: ["requested_by", "started_at", "updated_at", "version"],
  calculation_lines: [
    "calculation_run_id",
    "created_at",
    "id",
    "result_hash",
    "tenant_id",
  ],
  amount_ledger: ["ledger_seq"],
  settlement_lines: ["external_reference"],
  audit_events: ["source_ip"],
};

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function interfaceFields(name: string): string[] {
  const match = typesSource.match(
    new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`, "m"),
  );
  if (!match) throw new Error(`interface ${name} not found`);
  const fields: string[] = [];
  for (const line of (match[1] as string).split("\n")) {
    const field = line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\??:/);
    if (field) fields.push(snakeCase(field[1] as string));
  }
  return fields;
}

describe("domain interface ↔ entity contract drift", () => {
  for (const entity of CORE_ENTITY_CONTRACTS) {
    const interfaceName = INTERFACE_BY_TABLE[entity.table];
    it(`keeps ${interfaceName} aligned with ${entity.table}`, () => {
      expect(interfaceName, entity.table).toBeTruthy();
      const fields = interfaceFields(interfaceName as string);
      expect(fields.length, interfaceName).toBeGreaterThan(0);
      const viewOnly = VIEW_ONLY_COLUMNS[entity.table] ?? [];
      const aliases = COLUMN_ALIASES[entity.table] ?? {};
      const dbOnly = DB_ONLY_COLUMNS[entity.table] ?? [];
      const columns = new Set(entity.columns);

      const mapped = fields
        .filter((field) => !viewOnly.includes(field))
        .map((field) => aliases[field] ?? field);

      // Every interface field must exist in the declared DDL contract.
      expect(mapped.filter((field) => !columns.has(field))).toEqual([]);

      // Every DDL column must be exposed or explicitly declared DB-only.
      const declaredDbOnly = new Set(dbOnly);
      expect(
        entity.columns.filter(
          (column) =>
            !mapped.includes(column) && !declaredDbOnly.has(column),
        ),
      ).toEqual([]);

      // Declared exceptions must stay real, not stale.
      expect(dbOnly.filter((column) => !columns.has(column))).toEqual([]);
      expect(dbOnly.filter((column) => mapped.includes(column))).toEqual([]);
      expect(viewOnly.filter((field) => columns.has(field))).toEqual([]);
    });
  }
});
