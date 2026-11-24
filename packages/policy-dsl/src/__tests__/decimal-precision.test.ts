/**
 * 2026-11-21 审计：金额小数精度不得静默截断。
 * - 超过 6 位有效小数 fail-closed（DECIMAL_PRECISION_EXCEEDED）；
 * - 仅末尾补零（DB numeric(20,8) 的 0.50000000）不算超精度；
 * - 范围校验统一抛 POLICY_RANGE_VIOLATION，合法边界 0 / 1 放行。
 */
import { describe, expect, it } from "vitest";
import {
  DecimalPrecisionError,
  PolicyRangeError,
  assertRange,
  formatDecimal,
  parseDecimal,
} from "../index.js";

describe("parseDecimal precision (no silent truncation)", () => {
  it("接受恰好 6 位有效小数", () => {
    expect(parseDecimal("0.000001")).toBe(1n);
    expect(parseDecimal("1.123456")).toBe(1123456n);
    expect(formatDecimal(parseDecimal("1.123456"))).toBe("1.123456");
  });

  it("拒绝第 7 位及以上的有效小数，而不是截断", () => {
    for (const input of [
      "0.1234567",
      "1.0000001",
      "-0.0000001",
      "123.45000001",
    ]) {
      expect(() => parseDecimal(input), input).toThrow(
        DecimalPrecisionError,
      );
      expect(() => parseDecimal(input), input).toThrow(
        /DECIMAL_PRECISION_EXCEEDED/,
      );
    }
  });

  it("超过 6 位但只有末尾补零时不算精度损失", () => {
    expect(parseDecimal("0.50000000")).toBe(parseDecimal("0.5"));
    expect(parseDecimal("1.00000000")).toBe(parseDecimal("1"));
    expect(parseDecimal("-2.25000000")).toBe(parseDecimal("-2.25"));
  });

  it("错误对象携带稳定错误码", () => {
    try {
      parseDecimal("9.9999999");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DecimalPrecisionError);
      expect((error as DecimalPrecisionError).code).toBe(
        "DECIMAL_PRECISION_EXCEEDED",
      );
    }
  });
});

describe("assertRange fail-closed bounds", () => {
  const zero = parseDecimal("0");
  const one = parseDecimal("1");

  it("接受合法边界 0 与 1", () => {
    expect(() =>
      assertRange("weight", zero, { min: zero, max: one }),
    ).not.toThrow();
    expect(() =>
      assertRange("weight", one, { min: zero, max: one }),
    ).not.toThrow();
  });

  it("拒绝越界值并带字段名与稳定错误码", () => {
    for (const value of [parseDecimal("-0.01"), parseDecimal("1.01")]) {
      expect(() => assertRange("weight", value, { min: zero, max: one })).toThrow(
        PolicyRangeError,
      );
    }
    try {
      assertRange("amount", parseDecimal("0"), {
        min: zero,
        minExclusive: true,
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as PolicyRangeError).code).toBe("POLICY_RANGE_VIOLATION");
      expect((error as PolicyRangeError).field).toBe("amount");
      expect((error as Error).message).toMatch(/must be > 0/);
    }
  });
});
