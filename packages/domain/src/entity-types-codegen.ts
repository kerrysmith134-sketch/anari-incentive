import type { EntityContract } from "./entity-contracts.js";

const BUILTIN_TYPES = new Set(["Record", "Array", "Promise", "Date"]);
/** Types declared in states.ts rather than types.ts. */
const STATE_TYPES = new Set(["CalculationRunStatus", "SettlementBatchStatus"]);

function referencedTypeNames(
  contracts: readonly EntityContract[],
): string[] {
  const used = new Set<string>();
  for (const entity of contracts) {
    for (const column of entity.columns) {
      if (column.exposed === false) continue;
      // Drop string-literal unions so their members are not imported.
      const stripped = column.tsType.replace(/"[^"]*"/g, "");
      for (const match of stripped.matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)) {
        if (BUILTIN_TYPES.has(match[0])) continue;
        used.add(match[0]);
      }
    }
  }
  return [...used].sort();
}

/**
 * Render the persisted entity interfaces from the registry. Only columns not
 * marked `exposed: false` are emitted; view-only fields stay on the
 * hand-written interfaces in `types.ts`.
 */
export function renderEntityTypes(
  contracts: readonly EntityContract[],
): string {
  const imports = referencedTypeNames(contracts);
  const stateImports = imports.filter((name) => STATE_TYPES.has(name));
  const typeImports = imports.filter((name) => !STATE_TYPES.has(name));
  const lines: string[] = [
    "/**",
    " * AUTO-GENERATED from packages/domain/src/entity-contracts.ts.",
    " * Run `npm run contracts:entities`; do not edit by hand.",
    " */",
    "",
  ];
  if (stateImports.length > 0) {
    lines.push(
      `import type { ${stateImports.join(", ")} } from "./states.js";`,
    );
  }
  if (typeImports.length > 0) {
    lines.push(
      `import type { ${typeImports.join(", ")} } from "./types.js";`,
    );
  }
  if (stateImports.length > 0 || typeImports.length > 0) lines.push("");
  for (const entity of contracts) {
    lines.push(`export interface ${entity.typeName}Persisted {`);
    for (const column of entity.columns) {
      if (column.exposed === false) continue;
      const optional = column.optional ? "?" : "";
      lines.push(`  ${column.field}${optional}: ${column.tsType};`);
    }
    lines.push("}", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
