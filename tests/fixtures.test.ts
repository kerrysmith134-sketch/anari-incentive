import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import {
  calculateOrderContribution,
  compareWithReference,
} from "@anari/policy-dsl";

const root = process.cwd();
const policy = JSON.parse(
  readFileSync(
    join(root, "fixtures", "policies", "order-contribution-v1.json"),
    "utf8",
  ),
) as PolicyDefinition;

const orderFiles = readdirSync(join(root, "fixtures", "orders"))
  .filter(
    (file) =>
      file.endsWith(".json") &&
      !file.startsWith("charging-") &&
      !file.startsWith("equipment-"),
  )
  .sort();

interface OrderFixture {
  name: string;
  description: string;
  input: CalculationInput;
  expected: {
    pool: string;
    poolRounded: string;
    lines: Array<{ personId: string; roundedAmount: string }>;
  };
}

describe("reference policy fixtures", () => {
  it("has a non-empty fixture set", () => {
    expect(orderFiles.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of orderFiles) {
    it(`matches expected calculation: ${file}`, () => {
      const fixture = JSON.parse(
        readFileSync(join(root, "fixtures", "orders", file), "utf8"),
      ) as OrderFixture;

      const result = calculateOrderContribution(policy, fixture.input);
      expect(result.pool).toBe(fixture.expected.pool);
      expect(result.poolRounded).toBe(fixture.expected.poolRounded);

      const actual = new Map(
        result.lines.map((line) => [line.personId, line.roundedAmount]),
      );
      for (const expectedLine of fixture.expected.lines) {
        expect(actual.get(expectedLine.personId)).toBe(
          expectedLine.roundedAmount,
        );
      }
      expect(actual.size).toBe(fixture.expected.lines.length);

      const roundedSum = result.lines.reduce(
        (sum, line) => sum + Number(line.roundedAmount),
        0,
      );
      expect(roundedSum).toBeCloseTo(Number(fixture.expected.poolRounded), 6);

      expect(compareWithReference(policy, fixture.input, result.lines)).toEqual(
        [],
      );
      expect(
        calculateOrderContribution(policy, fixture.input).resultHash,
      ).toBe(result.resultHash);
    });
  }
});
