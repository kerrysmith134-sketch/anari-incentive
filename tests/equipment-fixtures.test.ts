import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import { calculateChargingEquipmentSales } from "@anari/policy-dsl";

const root = process.cwd();
const policy = JSON.parse(
  readFileSync(
    join(root, "fixtures", "policies", "charging-equipment-sales-v1.json"),
    "utf8",
  ),
) as PolicyDefinition;

const files = readdirSync(join(root, "fixtures", "orders"))
  .filter((file) => file.startsWith("equipment-") && file.endsWith(".json"))
  .sort();

interface EquipmentFixture {
  name: string;
  input: CalculationInput;
  expected: {
    pool: string;
    poolRounded: string;
    cashFactor: string;
    afterSalesReserve: string;
    channelPool: string;
    internalPool: string;
    lines: Array<{ personId: string; roundedAmount: string }>;
  };
}

describe("charging equipment sales fixtures", () => {
  it("has five equipment sales scenarios", () => {
    expect(files).toHaveLength(5);
  });

  for (const file of files) {
    it(`matches expected equipment calculation: ${file}`, () => {
      const fixture = JSON.parse(
        readFileSync(join(root, "fixtures", "orders", file), "utf8"),
      ) as EquipmentFixture;

      const result = calculateChargingEquipmentSales(policy, fixture.input);
      expect(result.pool).toBe(fixture.expected.pool);
      expect(result.poolRounded).toBe(fixture.expected.poolRounded);
      expect(result.cashFactor).toBe(fixture.expected.cashFactor);
      expect(result.afterSalesReserve).toBe(
        fixture.expected.afterSalesReserve,
      );
      expect(result.channelPool).toBe(fixture.expected.channelPool);
      expect(result.internalPool).toBe(fixture.expected.internalPool);

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
    });
  }
});
