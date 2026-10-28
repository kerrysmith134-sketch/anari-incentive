import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import { calculateCashWeightedRetention } from "@anari/policy-dsl";

const root = process.cwd();
const policy = JSON.parse(
  readFileSync(
    join(root, "examples", "verticals", "charging-epc", "policy.json"),
    "utf8",
  ),
) as PolicyDefinition;

const files = readdirSync(join(root, "examples", "verticals", "charging-epc", "fixtures"))
  .filter((file) => file.endsWith(".json"))
  .sort();

interface ChargingFixture {
  name: string;
  input: CalculationInput;
  expected: {
    pool: string;
    poolRounded: string;
    cashFactor: string;
    retentionHeld: string;
    lines: Array<{ personId: string; roundedAmount: string }>;
  };
}

describe("charging project fixtures", () => {
  it("has five charging project scenarios", () => {
    expect(files).toHaveLength(5);
  });

  for (const file of files) {
    it(`matches expected charging calculation: ${file}`, () => {
      const fixture = JSON.parse(
        readFileSync(join(root, "examples", "verticals", "charging-epc", "fixtures", file), "utf8"),
      ) as ChargingFixture;

      const result = calculateCashWeightedRetention(
        policy,
        fixture.input,
      );
      expect(result.pool).toBe(fixture.expected.pool);
      expect(result.poolRounded).toBe(fixture.expected.poolRounded);
      expect(result.cashFactor).toBe(fixture.expected.cashFactor);
      expect(result.retentionHeld).toBe(fixture.expected.retentionHeld);

      const actual = new Map(
        result.lines.map((line) => [line.personId, line.roundedAmount]),
      );
      for (const line of fixture.expected.lines) {
        expect(actual.get(line.personId)).toBe(line.roundedAmount);
      }
      const sum = result.lines.reduce(
        (total, line) => total + Number(line.roundedAmount),
        0,
      );
      expect(sum).toBeCloseTo(Number(fixture.expected.poolRounded), 6);
      expect(
        calculateCashWeightedRetention(policy, fixture.input).resultHash,
      ).toBe(result.resultHash);
    });
  }
});
