import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import { calculateOrderContribution, reconcileLines } from "@anari/policy-dsl";

const root = process.cwd();
const orderFile = process.argv[2] ?? join(root, "fixtures", "orders", "order-001-base-split.json");
const expectedFile = process.argv[3] ?? join(root, "fixtures", "reconciliation", "order-001.csv");

const policy = JSON.parse(
  readFileSync(join(root, "fixtures", "policies", "order-contribution-v1.json"), "utf8"),
) as PolicyDefinition;
const fixture = JSON.parse(readFileSync(orderFile, "utf8")) as {
  input: CalculationInput;
  expected: { poolRounded: string };
};
const csv = readFileSync(expectedFile, "utf8").trim().split(/\r?\n/);
const expected = csv.slice(1).map((line) => {
  const [personId, amount] = line.split(",");
  return { personId: personId!.trim(), amount: amount!.trim() };
});

const result = calculateOrderContribution(policy, fixture.input);
const differences = reconcileLines(expected, result.lines);

console.log(`Order: ${fixture.input.order.id}`);
console.log(`Pool (rounded): ${result.poolRounded}`);
console.log(`Expected lines: ${expected.length}; engine lines: ${result.lines.length}`);
console.log(`Differences: ${differences.length}`);
for (const difference of differences) {
  console.log(
    `  ${difference.personId}: expected ${difference.expected}, actual ${difference.actual ?? "MISSING"}, delta ${difference.delta}`,
  );
}
if (differences.length > 0) process.exitCode = 1;
