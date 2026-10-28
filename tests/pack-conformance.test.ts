import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import { calculateByPolicy } from "@anari/policy-dsl";

const root = process.cwd();
const packsDir = join(root, "examples", "verticals");
const packs = readdirSync(packsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packsDir, entry.name))
  .filter((path) => existsSync(join(path, "pack.json")));

describe("policy pack conformance", () => {
  it("loads multiple, materially different packs without core code", () => {
    expect(packs.length).toBeGreaterThanOrEqual(3);
  });

  for (const packDir of packs) {
    it(`runs every fixture for ${packDir.split("/").pop()}`, () => {
      const manifest = JSON.parse(
        readFileSync(join(packDir, "pack.json"), "utf8"),
      ) as { policy: string; fixtures: string; corePolicyCode: string };
      const policy = JSON.parse(
        readFileSync(join(packDir, manifest.policy), "utf8"),
      ) as PolicyDefinition;
      expect(policy.code).toBe(manifest.corePolicyCode);

      const fixturesDir = join(packDir, manifest.fixtures);
      const files = readdirSync(fixturesDir).filter((file) =>
        file.endsWith(".json"),
      );
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        const fixture = JSON.parse(
          readFileSync(join(fixturesDir, file), "utf8"),
        ) as {
          input: CalculationInput;
          expected: { pool: string; lines: Array<{ roundedAmount: string }> };
        };
        const result = calculateByPolicy(policy, fixture.input);
        expect(result.pool).toBe(fixture.expected.pool);
        expect(result.lines).toHaveLength(fixture.expected.lines.length);
        const sum = result.lines.reduce(
          (total, line) => total + Number(line.roundedAmount),
          0,
        );
        expect(sum).toBeCloseTo(Number(result.poolRounded), 6);
      }
    });
  }
});
