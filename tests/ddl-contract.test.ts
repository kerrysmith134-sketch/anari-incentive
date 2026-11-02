import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORE_ENTITY_CONTRACTS } from "@anari/domain";

const migrationsDir = fileURLToPath(
  new URL("../db/migrations/", import.meta.url),
);
const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const manifest = JSON.parse(
  readFileSync(
    new URL("../docs/generated/entity-contracts.json", import.meta.url),
    "utf8",
  ),
) as {
  tables: Record<
    string,
    { columns: string[]; classifications: Record<string, string> }
  >;
};

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

describe("database DDL contract", () => {
  it("keeps the generated entity manifest in sync with the registry", () => {
    const expected = Object.fromEntries(
      [...CORE_ENTITY_CONTRACTS]
        .sort((left, right) => left.table.localeCompare(right.table))
        .map((entity) => [
          entity.table,
          {
            typeName: entity.typeName,
            columns: [...entity.columns]
              .sort((left, right) =>
                left.column.localeCompare(right.column),
              )
              .map((column) => ({
                column: column.column,
                field: column.field,
                tsType: column.tsType,
                optional: column.optional === true,
                exposed: column.exposed !== false,
                ...(column.classification
                  ? { classification: column.classification }
                  : {}),
              })),
          },
        ]),
    );
    expect(manifest.tables).toEqual(expected);
  });

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

  for (const entity of CORE_ENTITY_CONTRACTS) {
    it(`matches the declared columns for ${entity.table}`, () => {
      const parsed = tables.get(entity.table);
      expect(parsed, entity.table).toBeTruthy();
      expect([...(parsed ?? [])].sort()).toEqual(
        entity.columns.map((column) => column.column).sort(),
      );
    });
  }
});
