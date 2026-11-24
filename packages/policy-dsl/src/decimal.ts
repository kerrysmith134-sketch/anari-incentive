/**
 * Minimal deterministic decimal arithmetic for money.
 *
 * Values are represented as bigint scaled by 1e6. This avoids IEEE-754
 * floating-point drift and keeps the first vertical slice dependency-free.
 * Production code may replace this with a vetted decimal library, but the
 * external behaviour (scale, rounding modes, hashing) must remain identical.
 */

export const SCALE = 6n;
export const FACTOR = 10n ** SCALE;

export type RoundingMode = "HALF_UP" | "HALF_EVEN" | "DOWN";

/**
 * 2026-11-21 审计：此前 `parseDecimal` 对超过 6 位的小数静默截断
 * （如 1.0000009 → 1.000000），金额精度被悄悄丢弃。
 * 现在超精度输入 fail-closed 拒绝；仅“末尾补零”不受影响
 * （DB 的 numeric(20,8) 可能返回 0.50000000，这类值没有精度损失）。
 */
export class DecimalPrecisionError extends Error {
  readonly code = "DECIMAL_PRECISION_EXCEEDED";
  constructor(
    readonly input: string,
    readonly maxDecimals: number = Number(SCALE),
  ) {
    super(
      `DECIMAL_PRECISION_EXCEEDED: ${input} has more than ${maxDecimals} significant decimal places`,
    );
    this.name = "DecimalPrecisionError";
  }
}

/**
 * 策略/资金输入的取值范围错误（fail-closed，不静默 clamp）。
 * 由计算入口在产生任何金额之前抛出。
 */
export class PolicyRangeError extends Error {
  readonly code = "POLICY_RANGE_VIOLATION";
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field} ${reason}`);
    this.name = "PolicyRangeError";
  }
}

export interface RangeBounds {
  min?: bigint;
  max?: bigint;
  /** true 时下界为严格大于（例如合同金额必须 > 0）。 */
  minExclusive?: boolean;
}

/**
 * 断言一个 1e6 标定的数值落在策略允许范围内；越界抛 PolicyRangeError。
 * 合法边界（如权重 0 与 1）必须显式允许，不做静默修正。
 */
export function assertRange(
  field: string,
  value: bigint,
  bounds: RangeBounds,
): void {
  if (bounds.min !== undefined) {
    const violated = bounds.minExclusive
      ? value <= bounds.min
      : value < bounds.min;
    if (violated) {
      throw new PolicyRangeError(
        field,
        `must be ${bounds.minExclusive ? ">" : ">="} ${formatDecimal(
          bounds.min,
        )} (got ${formatDecimal(value)})`,
      );
    }
  }
  if (bounds.max !== undefined && value > bounds.max) {
    throw new PolicyRangeError(
      field,
      `must be <= ${formatDecimal(bounds.max)} (got ${formatDecimal(value)})`,
    );
  }
}

export function parseDecimal(input: string): bigint {
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal string: ${input}`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");
  // 只计算有效小数位（去掉末尾 0），避免把 DB 的零填充误判为超精度。
  const significantFraction = fraction.replace(/0+$/, "");
  if (significantFraction.length > Number(SCALE)) {
    throw new DecimalPrecisionError(input);
  }
  const padded = significantFraction.padEnd(Number(SCALE), "0");
  const value = BigInt(whole + padded);
  return negative ? -value : value;
}

export function formatDecimal(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / FACTOR;
  const fraction = (abs % FACTOR).toString().padStart(6, "0").replace(/0+$/, "");
  const result = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${result}` : result;
}

export function divRound(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = "HALF_UP",
): bigint {
  if (denominator === 0n) throw new Error("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let quotient = n / d;
  const remainder = n % d;
  if (remainder !== 0n) {
    if (mode === "HALF_UP") {
      if (remainder * 2n >= d) quotient += 1n;
    } else if (mode === "HALF_EVEN") {
      const twice = remainder * 2n;
      if (twice > d || (twice === d && quotient % 2n === 1n)) quotient += 1n;
    }
  }
  return negative ? -quotient : quotient;
}

export function add(a: bigint, b: bigint): bigint {
  return a + b;
}

export function sub(a: bigint, b: bigint): bigint {
  return a - b;
}

export function mul(
  a: bigint,
  b: bigint,
  mode: RoundingMode = "HALF_UP",
): bigint {
  return divRound(a * b, FACTOR, mode);
}

export function div(
  a: bigint,
  b: bigint,
  mode: RoundingMode = "HALF_UP",
): bigint {
  return divRound(a * FACTOR, b, mode);
}

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function isPositive(value: bigint): boolean {
  return value > 0n;
}

/**
 * Round a 1e6-scaled value to the requested number of decimal places while
 * keeping the 1e6 scale in the return value.
 */
export function roundTo(
  value: bigint,
  decimals: number,
  mode: RoundingMode,
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new Error(`Unsupported decimal places: ${decimals}`);
  }
  if (decimals === 6) return value;
  const step = 10n ** BigInt(6 - decimals);
  return divRound(value, step, mode) * step;
}

export function sum(values: bigint[]): bigint {
  return values.reduce((acc, value) => acc + value, 0n);
}
