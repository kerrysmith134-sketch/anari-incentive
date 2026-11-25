import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ConsolidationError,
  consolidateEntities,
  parseTransactionsCsv,
  type EntityDefinition,
  type RateTable,
} from "@anari/ledger";

/**
 * Shadow consolidation CLI: reads the multi-entity fixture, translates every
 * entity into the group currency, eliminates intercompany AR/AP and verifies
 * the balance sheet. Exits non-zero (and prints FAIL) on any error.
 *
 * Usage:
 *   npx tsx scripts/shadow-consolidation.ts \
 *     --fixture fixtures/reconciliation/multi-entity-consolidation [--json] [--group USD]
 */
const args = process.argv.slice(2);

function arg(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

async function main(): Promise<void> {
  const fixtureDir = resolve(
    process.cwd(),
    arg("fixture") ?? "fixtures/reconciliation/multi-entity-consolidation",
  );
  const entitiesDocument = JSON.parse(
    readFileSync(join(fixtureDir, "entities.json"), "utf8"),
  ) as { groupCurrency?: string; entities: EntityDefinition[] };
  const rates = JSON.parse(
    readFileSync(join(fixtureDir, "rates.json"), "utf8"),
  ) as RateTable;
  const transactions = parseTransactionsCsv(
    readFileSync(join(fixtureDir, "transactions.csv"), "utf8"),
  );

  const report = consolidateEntities({
    entities: entitiesDocument.entities,
    transactions,
    rates,
    groupCurrency:
      arg("group") ?? entitiesDocument.groupCurrency ?? "USD",
  });

  if (hasFlag("json")) {
    // Machine-readable mode: stdout stays valid JSON.
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `period ${report.period} | group currency ${report.groupCurrency}`,
    );
    for (const entity of report.entities) {
      const functional = entity.functional;
      const translated = entity.translated;
      console.log(
        `${entity.entityId} (${entity.functionalCurrency}) ` +
          `functional assets=${functional.totalAssets} ` +
          `liabilities=${functional.totalLiabilities} ` +
          `netIncome=${functional.netIncome} | ` +
          `USD assets=${translated.assets} liabilities=${translated.liabilities} ` +
          `netIncome=${translated.netIncome} CTA=${translated.cta}`,
      );
    }
    console.log(
      `eliminations ${report.eliminations.lines.length} pair(s): ` +
        `receivable=${report.eliminations.totalReceivable} ` +
        `payable=${report.eliminations.totalPayable} ` +
        `difference=${report.eliminations.totalDifference}`,
    );
    console.log(
      `group ${report.groupCurrency}: assets=${report.group.assets} ` +
        `liabilities=${report.group.liabilities} netAssets=${report.group.netAssets} ` +
        `netIncome=${report.group.netIncome} CTA=${report.group.cta} ` +
        `balanceDifference=${report.group.balanceDifference}`,
    );
    console.log(
      `checks: entityFunctionalBalanced=${report.checks.entityFunctionalBalanced} ` +
        `intercompanyCleared=${report.checks.intercompanyCleared} ` +
        `groupBalanced=${report.checks.groupBalanced} ` +
        `ctaTranslationOnly=${report.checks.ctaTranslationOnly}`,
    );
    console.log(`reportHash ${report.reportHash}`);
  }

  if (!report.checks.balanced) {
    console.error("FAIL: consolidation checks did not pass");
    process.exitCode = 1;
    return;
  }
  if (!hasFlag("json")) console.log("PASS");
}

main().catch((error: unknown) => {
  if (error instanceof ConsolidationError) {
    console.error(`FAIL [${error.code}] ${error.message}`);
  } else {
    console.error("FAIL", error);
  }
  process.exitCode = 1;
});
