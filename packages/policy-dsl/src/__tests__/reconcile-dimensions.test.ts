/**
 * 2026-11-21 审计：同一人多行对账不得覆盖，跨币种/跨激励类型不得净额抵消。
 */
import { describe, expect, it } from "vitest";
import type { CalculationLine } from "@anari/domain";
import { reconcileLines } from "../index.js";

function actualLine(
  personId: string,
  roundedAmount: string,
  dimensions: { currency?: string; incentiveType?: string } = {},
): CalculationLine {
  return {
    lineKey: `${personId}:wp:${dimensions.incentiveType ?? "CONTRIBUTION"}`,
    personId,
    workPackageId: "00000000-0000-4000-8000-000000000010",
    incentiveType: dimensions.incentiveType ?? "CONTRIBUTION",
    baseAmount: "0",
    multiplier: "1",
    rawAmount: roundedAmount,
    roundedAmount,
    currency: dimensions.currency ?? "CNY",
    trace: {},
  };
}

/** 旧调用形态：只带 personId / roundedAmount 的最小行。 */
function bareLine(personId: string, roundedAmount: string): CalculationLine {
  return { personId, roundedAmount } as CalculationLine;
}

describe("reconcileLines — 同人多行聚合", () => {
  it("同一人两行 actual 求和后与 expected 相等（不再只保留最后一行）", () => {
    const differences = reconcileLines(
      [{ personId: "a", amount: "100" }],
      [bareLine("a", "60"), bareLine("a", "40")],
    );
    expect(differences).toEqual([]);
  });

  it("expected 同人多行同样求和后比较", () => {
    const differences = reconcileLines(
      [
        { personId: "a", amount: "60" },
        { personId: "a", amount: "40" },
      ],
      [bareLine("a", "100")],
    );
    expect(differences).toEqual([]);
  });

  it("旧 personId 模式下差异结构保持不变（无额外维度字段）", () => {
    const differences = reconcileLines(
      [{ personId: "a", amount: "90" }],
      [bareLine("a", "100")],
    );
    expect(differences).toEqual([
      { personId: "a", expected: "90", actual: "100", delta: "10" },
    ]);
  });
});

describe("reconcileLines — 跨币种不被合并", () => {
  it("同一人不同 currency 分别匹配，不净额抵消", () => {
    const differences = reconcileLines(
      [
        { personId: "a", amount: "100", currency: "CNY" },
        { personId: "a", amount: "10", currency: "USD" },
      ],
      [
        actualLine("a", "100", { currency: "CNY" }),
        actualLine("a", "10", { currency: "USD" }),
      ],
    );
    expect(differences).toEqual([]);
  });

  it("不同币种的差异单独报告，而不是按合计误判为一致", () => {
    // 合计 90 + 10 = 100，旧的按人汇总会认为与 expected 100 一致。
    const differences = reconcileLines(
      [{ personId: "a", amount: "100", currency: "CNY" }],
      [
        actualLine("a", "90", { currency: "CNY" }),
        actualLine("a", "10", { currency: "USD" }),
      ],
    );
    expect(differences).toHaveLength(2);
    expect(differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          personId: "a",
          currency: "CNY",
          expected: "100",
          actual: "90",
          delta: "-10",
        }),
        expect.objectContaining({
          personId: "a",
          currency: "USD",
          expected: "0",
          actual: "10",
        }),
      ]),
    );
  });

  it("actual 侧同人跨币种时自动升级为维度比较，person 级 expected 显式报告缺失", () => {
    // 110 = 100 CNY + 10 USD。旧的按人汇总会通过，掩盖跨币种抵消。
    const differences = reconcileLines(
      [{ personId: "a", amount: "110" }],
      [
        actualLine("a", "100", { currency: "CNY" }),
        actualLine("a", "10", { currency: "USD" }),
      ],
    );
    expect(differences).toHaveLength(3);
    expect(
      differences.filter((difference) => difference.actual === null),
    ).toHaveLength(1);
    expect(
      differences.filter((difference) => difference.expected === "0"),
    ).toHaveLength(2);
    expect(differences.every((difference) => difference.delta !== "0")).toBe(
      true,
    );
  });
});

describe("reconcileLines — 跨激励类型不被合并", () => {
  it("同一人同币种不同 incentiveType 分别比较", () => {
    const differences = reconcileLines(
      [
        {
          personId: "a",
          amount: "100",
          currency: "CNY",
          incentiveType: "BONUS",
        },
      ],
      [
        actualLine("a", "70", { currency: "CNY", incentiveType: "BONUS" }),
        actualLine("a", "30", {
          currency: "CNY",
          incentiveType: "CONTRIBUTION",
        }),
      ],
    );
    expect(differences).toHaveLength(2);
    expect(differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          incentiveType: "BONUS",
          delta: "-30",
        }),
        expect.objectContaining({
          incentiveType: "CONTRIBUTION",
          expected: "0",
          actual: "30",
        }),
      ]),
    );
  });
});

describe("reconcileLines — 缺失/多出维度可报告", () => {
  it("expected 的维度在 actual 中缺失、actual 的维度在 expected 中缺失，双向报告", () => {
    const differences = reconcileLines(
      [{ personId: "a", amount: "100", currency: "USD" }],
      [actualLine("a", "100", { currency: "CNY" })],
    );
    expect(differences).toHaveLength(2);
    expect(differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          personId: "a",
          currency: "USD",
          expected: "100",
          actual: null,
        }),
        expect.objectContaining({
          personId: "a",
          currency: "CNY",
          expected: "0",
          actual: "100",
        }),
      ]),
    );
  });

  it("expected 可通过显式 dimensionKey 与 actual 对齐", () => {
    const actual = [
      actualLine("a", "100", { currency: "CNY", incentiveType: "BONUS" }),
    ];
    expect(
      reconcileLines(
        [
          {
            personId: "a",
            amount: "100",
            dimensionKey: "a|CNY|BONUS",
          },
        ],
        actual,
      ),
    ).toEqual([]);
  });

  it("显式 dimensionKey 不匹配时带上维度键报告差异", () => {
    const differences = reconcileLines(
      [{ personId: "a", amount: "90", dimensionKey: "a|CNY|BONUS" }],
      [actualLine("a", "100", { currency: "CNY", incentiveType: "BONUS" })],
    );
    expect(differences).toEqual([
      expect.objectContaining({
        personId: "a",
        dimensionKey: "a|CNY|BONUS",
        delta: "10",
      }),
    ]);
  });
});
