import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "@anari/connectors";
import {
  compareShadowSettlement,
  type ShadowSettlementLine,
} from "@anari/ledger";

/**
 * Shadow settlement: compare the engine settlement with an independent
 * finance export. Run it in parallel with finance before go-live; a non-zero
 * exit means at least one person/currency differs or is missing.
 *
 * Usage:
 *   npm run shadow:settle -- --engine <json> --finance <csv> [--tolerance 0.01]
 */
const root = process.cwd();
const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? (args[index + 1] as string) : fallback;
}

const enginePath = arg(
  "engine",
  join(root, "fixtures", "reconciliation", "shadow-engine-001.json"),
);
const financePath = arg(
  "finance",
  join(root, "fixtures", "reconciliation", "shadow-finance-001.csv"),
);
const tolerance = arg("tolerance", "0");

function keyColumn(header: string[]): string {
  const candidates = [
    "person_key",
    "personkey",
    "person_id",
    "personid",
    "employee_code",
    "employeecode",
  ];
  const found = header.find((column) =>
    candidates.includes(column.trim().toLowerCase()),
  );
  if (!found) {
    throw new Error(
      `finance CSV needs a person key column (${candidates.join("/")}); got ${header.join(",")}`,
    );
  }
  return found;
}

const engineRaw = JSON.parse(readFileSync(enginePath, "utf8")) as
  | ShadowSettlementLine[]
  | { lines: ShadowSettlementLine[] };
const engineLines = Array.isArray(engineRaw) ? engineRaw : engineRaw.lines;
if (!Array.isArray(engineLines)) {
  throw new Error("engine file must be an array or { lines: [...] }");
}

const rows = parseCsv(readFileSync(financePath, "utf8").trim());
const header = rows[0] ?? [];
const personColumn = keyColumn(header);
const amountColumn = header.find(
  (column) => column.trim().toLowerCase() === "amount",
);
const currencyColumn = header.find(
  (column) => column.trim().toLowerCase() === "currency",
);
if (!amountColumn || !currencyColumn) {
  throw new Error("finance CSV needs amount and currency columns");
}
const personIndex = header.indexOf(personColumn);
const amountIndex = header.indexOf(amountColumn);
const currencyIndex = header.indexOf(currencyColumn);
const financeLines: ShadowSettlementLine[] = rows.slice(1).map((row) => ({
  personKey: (row[personIndex] ?? "").trim(),
  amount: (row[amountIndex] ?? "").trim(),
  currency: (row[currencyIndex] ?? "").trim().toUpperCase(),
}));

const report = compareShadowSettlement(engineLines, financeLines, {
  tolerance,
});
console.log(JSON.stringify(report, null, 2));
if (!report.withinTolerance) {
  console.error(
    `shadow settlement failed: ${report.counts.variances} variance(s), ` +
      `${report.counts.missingInFinance} missing in finance, ` +
      `${report.counts.missingInEngine} missing in engine`,
  );
  process.exitCode = 1;
}
