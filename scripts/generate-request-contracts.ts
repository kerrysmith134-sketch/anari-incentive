import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeRequestSchema,
  requestSchemaRegistry,
} from "@anari/contracts";

const root = process.cwd();
const target = join(root, "docs", "generated", "request-contracts.json");

const schemas = Object.fromEntries(
  Object.entries(requestSchemaRegistry)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, schema]) => [name, describeRequestSchema(schema)]),
);

const manifest = {
  generatedFrom:
    "packages/contracts/src/index.ts#requestSchemaRegistry",
  description:
    "Generated request contracts derived from Zod. Run `npm run contracts:manifest`; do not edit by hand.",
  schemas,
};

mkdirSync(join(root, "docs", "generated"), { recursive: true });
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `wrote ${Object.keys(schemas).length} request contracts to docs/generated/request-contracts.json`,
);
