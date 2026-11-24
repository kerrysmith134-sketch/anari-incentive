import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

describe("shadow settlement multi-entity multi-currency pilot", () => {
  it("passes a clean four-entity/three-currency period", () => {
    const stdout = execFileSync(
      "npx",
      [
        "tsx",
        "scripts/shadow-settlement.ts",
        "--engine",
        "fixtures/reconciliation/multi-entity-currency/engine.json",
        "--finance",
        "fixtures/reconciliation/multi-entity-currency/finance.csv",
      ],
      { cwd: root, encoding: "utf8" },
    );
    const report = JSON.parse(stdout) as {
      counts: { variances: number; matched: number };
      withinTolerance: boolean;
      rows: Array<{ legalEntity?: string; currency: string }>;
    };
    expect(report.withinTolerance).toBe(true);
    expect(report.counts.variances).toBe(0);
    expect(report.counts.matched).toBe(4);
    expect(new Set(report.rows.map((row) => row.currency))).toEqual(
      new Set(["USD", "EUR", "JPY"]),
    );
  });
});
