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

export function parseDecimal(input: string): bigint {
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal string: ${input}`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");
  const padded = (fraction + "000000").slice(0, 6);
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
