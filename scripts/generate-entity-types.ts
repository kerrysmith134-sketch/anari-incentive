import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORE_ENTITY_CONTRACTS,
  renderEntityTypes,
} from "@anari/domain";

const root = process.cwd();
const target = join(root, "packages", "domain", "src", "entity-types.generated.ts");

writeFileSync(target, renderEntityTypes(CORE_ENTITY_CONTRACTS));
console.log(
  `wrote ${CORE_ENTITY_CONTRACTS.length} persisted entity types to packages/domain/src/entity-types.generated.ts`,
);
