import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_ENTITY_ACCESS } from "@anari/domain";

const root = process.cwd();
const target = join(root, "docs", "generated", "access-contracts.json");

const entities = Object.fromEntries(
  [...CORE_ENTITY_ACCESS]
    .sort((left, right) => left.entity.localeCompare(right.entity))
    .map((contract) => [
      contract.entity,
      {
        read: contract.read,
        write: contract.write,
        ...(contract.note ? { note: contract.note } : {}),
      },
    ]),
);

const manifest = {
  generatedFrom:
    "packages/domain/src/access-contracts.ts#CORE_ENTITY_ACCESS",
  description:
    "Generated entity read/write scope contracts. Run `npm run contracts:entities`; do not edit by hand.",
  entities,
};

mkdirSync(join(root, "docs", "generated"), { recursive: true });
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `wrote ${Object.keys(entities).length} access contracts to docs/generated/access-contracts.json`,
);
