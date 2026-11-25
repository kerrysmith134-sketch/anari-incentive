import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CORE_ENTITY_CONTRACTS,
  renderEntityTypes,
} from "@anari/domain";

const generatedPath = fileURLToPath(
  new URL(
    "../packages/domain/src/entity-types.generated.ts",
    import.meta.url,
  ),
);
const typesPath = fileURLToPath(
  new URL("../packages/domain/src/types.ts", import.meta.url),
);

const generated = readFileSync(generatedPath, "utf8");
const typesSource = readFileSync(typesPath, "utf8");

/** Fields that exist only on the read model, never in the database. */
const VIEW_ONLY_FIELDS: Record<string, string[]> = {
  EmploymentContract: ["redactedFields"],
  PayrollRun: ["lines", "statutoryCurrencyUnsupported"],
  PayrollLine: ["redactedFields", "statutoryCurrencyUnsupported"],
  CalculationRun: ["lines"],
  CalculationLine: [],
  AmountLedgerEntry: [],
  SettlementBatch: ["lines"],
  SettlementLine: ["personCode", "personName", "redactedFields"],
  AuditEvent: ["redacted", "redactionId"],
};

function declaredFields(typeName: string): string[] {
  const body = typesSource.match(
    new RegExp(
      `export interface ${typeName} extends ${typeName}Persisted \\{([\\s\\S]*?)\\}`,
      "m",
    ),
  );
  if (!body) return [];
  const fields: string[] = [];
  for (const line of (body[1] as string).split("\n")) {
    const field = line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\??:/);
    if (field) fields.push(field[1] as string);
  }
  return fields.sort();
}

describe("generated entity types", () => {
  it("is fresh with respect to the entity registry", () => {
    expect(generated).toBe(renderEntityTypes(CORE_ENTITY_CONTRACTS));
  });

  for (const entity of CORE_ENTITY_CONTRACTS) {
    it(`keeps ${entity.typeName} thin over its persisted fields`, () => {
      expect(typesSource).toContain(
        `export interface ${entity.typeName} extends ${entity.typeName}Persisted`,
      );
      expect(declaredFields(entity.typeName)).toEqual(
        [...(VIEW_ONLY_FIELDS[entity.typeName] ?? [])].sort(),
      );
    });
  }

  it("emits only exposed columns", () => {
    for (const entity of CORE_ENTITY_CONTRACTS) {
      const body = generated.match(
        new RegExp(
          `export interface ${entity.typeName}Persisted \\{([\\s\\S]*?)\\n\\}`,
          "m",
        ),
      )?.[1];
      expect(body, entity.typeName).toBeTruthy();
      for (const column of entity.columns) {
        if (column.exposed !== false) continue;
        expect(body).not.toMatch(
          new RegExp(`^\\s{2}${column.field}\\??:`, "m"),
        );
      }
    }
  });
});
