import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_ENTITY_CONTRACTS } from "@anari/domain";

const root = process.cwd();
const target = join(root, "docs", "generated", "entity-contracts.json");

const tables = Object.fromEntries(
  [...CORE_ENTITY_CONTRACTS]
    .sort((left, right) => left.table.localeCompare(right.table))
    .map((entity) => [
      entity.table,
      {
        typeName: entity.typeName,
        columns: [...entity.columns]
          .sort((left, right) => left.column.localeCompare(right.column))
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

const manifest = {
  generatedFrom:
    "packages/domain/src/entity-contracts.ts#CORE_ENTITY_CONTRACTS",
  description:
    "Generated entity column contracts. Run `npm run contracts:entities`; do not edit by hand.",
  tables,
};

mkdirSync(join(root, "docs", "generated"), { recursive: true });
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `wrote ${Object.keys(tables).length} entity contracts to docs/generated/entity-contracts.json`,
);
