import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(
  new URL("../db/migrations/", import.meta.url),
);
const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const CONSTRAINT_KEYWORDS = new Set([
  "constraint",
  "primary",
  "unique",
  "check",
  "foreign",
  "exclude",
  "like",
]);

type TableColumns = Map<string, Set<string>>;

function parseMigrations(): {
  tables: TableColumns;
  columnOccurrences: Map<string, number>;
  alteredTables: string[];
} {
  const tables: TableColumns = new Map();
  const columnOccurrences = new Map<string, number>();
  const alteredTables: string[] = [];
  const bump = (table: string, column: string): void => {
    const key = `${table}.${column}`;
    columnOccurrences.set(key, (columnOccurrences.get(key) ?? 0) + 1);
  };
  for (const file of files) {
    const sql = readFileSync(`${migrationsDir}${file}`, "utf8").replace(
      /--[^\n]*/g,
      "",
    );
    for (const match of sql.matchAll(
      /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/g,
    )) {
      const table = match[1] as string;
      const columns = tables.get(table) ?? new Set<string>();
      for (const line of (match[2] as string).split("\n")) {
        const column = line.match(/^\s{2}([a-z_][a-z0-9_]*)\s+\S/)?.[1];
        if (!column || CONSTRAINT_KEYWORDS.has(column)) continue;
        columns.add(column);
        bump(table, column);
      }
      tables.set(table, columns);
    }
    for (const match of sql.matchAll(
      /ALTER TABLE\s+([a-z_][a-z0-9_]*)\s+([\s\S]*?);/g,
    )) {
      const table = match[1] as string;
      alteredTables.push(table);
      const columns = tables.get(table) ?? new Set<string>();
      for (const added of (match[2] as string).matchAll(
        /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/g,
      )) {
        const column = added[1] as string;
        columns.add(column);
        bump(table, column);
      }
      tables.set(table, columns);
    }
  }
  return { tables, columnOccurrences, alteredTables };
}

const { tables, columnOccurrences, alteredTables } = parseMigrations();

/** Money-path and audit tables whose columns must never silently disappear. */
const CORE_COLUMNS: Record<string, string[]> = {
  employment_contracts: [
    "person_id",
    "contract_code",
    "start_date",
    "currency",
    "fixed_monthly_salary",
    "minimum_monthly_wage",
    "tax_rate",
    "social_insurance_rate",
    "deduction_cap_rate",
    "variable_share_cap_rate",
    "deduction_order",
    "deduction_type_caps",
    "smoothing_threshold_rate",
    "bank_account_ref",
    "consent_signature_ref",
    "consent_signed_at",
    "pay_plan_version",
    "status",
    "version",
  ],
  payroll_runs: [
    "cycle_id",
    "period_start",
    "period_end",
    "currency",
    "status",
    "prepared_by",
    "approved_by",
    "approved_at",
    "total_gross",
    "total_deductions",
    "total_tax",
    "total_social_insurance",
    "total_net",
    "line_count",
    "blocked_count",
  ],
  payroll_lines: [
    "run_id",
    "person_id",
    "contract_id",
    "fixed_amount",
    "incentive_amount",
    "gross_amount",
    "deduction_amount",
    "deduction_cap_amount",
    "deduction_cap_passed",
    "deduction_breakdown",
    "deduction_type_cap_passed",
    "deduction_type_cap_breaches",
    "variable_share_cap_amount",
    "smoothing_passed",
    "tax_amount",
    "social_insurance_amount",
    "net_amount",
    "bank_account_ref",
  ],
  calculation_runs: [
    "cycle_id",
    "policy_version_id",
    "mode",
    "engine_version",
    "input_snapshot_hash",
    "input_snapshot",
    "status",
    "result_hash",
    "blockers",
  ],
  calculation_lines: [
    "calculation_run_id",
    "line_key",
    "person_id",
    "work_package_id",
    "incentive_type",
    "base_amount",
    "multiplier",
    "raw_amount",
    "rounded_amount",
    "currency",
    "trace",
  ],
  amount_ledger: [
    "person_id",
    "cycle_id",
    "calculation_run_id",
    "calculation_line_id",
    "entry_type",
    "amount",
    "currency",
    "status",
    "entry_hash",
    "prev_hash",
    "locked_at",
  ],
  settlement_batches: [
    "cycle_id",
    "batch_no",
    "status",
    "kind",
    "currency",
    "total_amount",
    "line_count",
    "approved_by",
    "approved_at",
  ],
  settlement_lines: [
    "batch_id",
    "ledger_id",
    "person_id",
    "amount",
    "currency",
    "status",
    "active",
  ],
  audit_events: [
    "sequence",
    "action",
    "object_type",
    "object_id",
    "reason",
    "occurred_at",
    "prev_hash",
    "event_hash",
  ],
};

describe("database DDL contract", () => {
  it("parses a migration chain with no duplicate column definitions", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(tables.size).toBeGreaterThan(30);
    const duplicates = [...columnOccurrences.entries()]
      .filter(([, count]) => count > 1)
      .map(([column]) => column);
    expect(duplicates).toEqual([]);
  });

  it("only alters tables that a migration creates", () => {
    const unknown = [...new Set(alteredTables)].filter(
      (table) => !tables.has(table),
    );
    expect(unknown).toEqual([]);
  });

  for (const [table, required] of Object.entries(CORE_COLUMNS)) {
    it(`keeps ${table} money-path columns present`, () => {
      const columns = tables.get(table);
      expect(columns, table).toBeTruthy();
      const missing = required.filter(
        (column) => !columns?.has(column),
      );
      expect(missing).toEqual([]);
    });
  }
});
