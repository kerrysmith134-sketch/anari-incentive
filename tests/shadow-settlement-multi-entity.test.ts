import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

describe("shadow settlement multi-entity dimensions", () => {
  it("does not net offsetting amounts across legal entities", () => {
    try {
      execFileSync(
        "npx",
        [
          "tsx",
          "scripts/shadow-settlement.ts",
          "--engine",
          "fixtures/reconciliation/shadow-engine-multi-entity.json",
          "--finance",
          "fixtures/reconciliation/shadow-finance-multi-entity.csv",
        ],
        { cwd: root, encoding: "utf8" },
      );
      throw new Error("expected shadow settlement to fail");
    } catch (error) {
      const err = error as { status?: number; stdout?: string; stderr?: string };
      expect(err.status).toBe(1);
      const report = JSON.parse(err.stdout ?? "{}") as {
        rows: Array<{ legalEntity?: string; status: string }>;
        counts: { variances: number };
      };
      expect(report.rows).toHaveLength(2);
      expect(report.rows.map((row) => row.legalEntity).sort()).toEqual([
        "LE-A",
        "LE-B",
      ]);
      expect(report.counts.variances).toBe(2);
    }
  });
});
