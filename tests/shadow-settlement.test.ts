/*
 * NPV2-009（影子周期基线）：shadow-settlement 对账脚本必须有确定性行为——
 * 干净 fixture 通过（exit 0），差异 fixture 失败（exit 1）且逐人报告差异。
 * 这是「财务对账差异 = 0」正式化门槛的脚本级验收。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "@anari/connectors";
import {
  compareShadowSettlement,
  type ShadowSettlementLine,
} from "@anari/ledger";

const root = join(__dirname, "..");
const run = (args: string[]) => {
  try {
    const stdout = execFileSync(
      "npx",
      ["tsx", "scripts/shadow-settlement.ts", ...args],
      { cwd: root, encoding: "utf8" },
    );
    return { exit: 0, stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    return { exit: err.status ?? 1, stdout: err.stdout ?? "" };
  }
};

describe("shadow settlement reconciliation (NPV2-009 baseline)", () => {
  it("passes with zero variance on the clean fixture", () => {
    const { exit, stdout } = run([]);
    expect(exit).toBe(0);
    expect(stdout).toContain('"variances": 0');
    expect(stdout).toContain('"withinTolerance": true');
    expect(stdout).toMatch(/reportHash": "sha256:[0-9a-f]{64}/);
  });

  it("fails with exit 1 and per-person variance on the drifted fixture", () => {
    const { exit, stdout } = run([
      "--finance",
      "fixtures/reconciliation/shadow-finance-variance-001.csv",
    ]);
    expect(exit).toBe(1);
    expect(stdout).toContain('"withinTolerance": false');
    // 逐人差异可见，而不是只给一个总数。
    expect(stdout).toContain('"variance": "-50"');
    expect(stdout).toContain('"variance": "50"');
  });

  it("is deterministic: identical inputs produce an identical report hash", () => {
    const engine = JSON.parse(
      readFileSync(
        join(root, "fixtures/reconciliation/shadow-engine-001.json"),
        "utf8",
      ),
    ) as ShadowSettlementLine[];
    const financeCsv = parseCsv(
      readFileSync(
        join(root, "fixtures/reconciliation/shadow-finance-001.csv"),
        "utf8",
      ),
    );
    const header = financeCsv[0]!.map((cell) => cell.trim().toLowerCase());
    const personIdx = header.findIndex((cell) =>
      ["person_key", "personkey", "person_id", "employee_code"].includes(cell),
    );
    const amountIdx = header.findIndex((cell) =>
      ["net_amount", "amount"].includes(cell),
    );
    const currencyIdx = header.findIndex((cell) => cell === "currency");
    const financeLines: ShadowSettlementLine[] = financeCsv
      .slice(1)
      .filter((row) => row.some((cell) => cell.trim()))
      .map((row) => ({
        personKey: row[personIdx]!,
        amount: row[amountIdx]!,
        currency: currencyIdx >= 0 ? row[currencyIdx]! : "CNY",
      }));
    const first = compareShadowSettlement(engine, financeLines);
    const second = compareShadowSettlement(engine, financeLines);
    expect(first.reportHash).toBe(second.reportHash);
    expect(first.counts.variances).toBe(0);
  });
});
