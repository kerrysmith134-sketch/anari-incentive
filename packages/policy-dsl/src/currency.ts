/**
 * ISO 4217 currency metadata（2026-11-21 审计：金额最小单位不能统一按 0.01）。
 *
 * 内部金额统一用 1e6 定点数（见 decimal.ts）。对外“最小可支付单位”由币种
 * 决定：JPY 为 1 元（0 位小数）、USD/CNY 为 0.01（2 位）、KWD/BHD 为
 * 0.001（3 位）。政策分配的舍入与余数必须按该最小单位进行，否则同一笔
 * USD 与 JPY 激励会使用不同的精度语义，且与数据库/对账结果漂移。
 *
 * 未列出的三位字母代码按 ISO 4217 默认 2 位处理；非三位字母代码直接
 * fail-closed，避免把任意文本当成币种。
 */

/** 0 位小数的常见 ISO 4217 币种。 */
const ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

/** 3 位小数的 ISO 4217 币种。 */
const THREE_DECIMAL = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

export type CurrencyMinorUnits = 0 | 2 | 3;

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** 返回币种最小单位的小数位数；非法代码 fail-closed。 */
export function currencyMinorUnits(currency: string): CurrencyMinorUnits {
  const code = currency?.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(code)) {
    throw new Error(
      `INVALID_CURRENCY: ${JSON.stringify(currency)} is not an ISO 4217 alpha-3 code`,
    );
  }
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/**
 * 1e6 标定下该币种最小单位的步长。
 * JPY → 1_000_000n（1 元）；USD → 10_000n（0.01）；KWD → 1_000n（0.001）。
 */
export function currencyStep(currency: string): bigint {
  return 10n ** BigInt(6 - currencyMinorUnits(currency));
}

/** 按币种最小单位格式化为普通十进制字符串（去掉多余尾零）。 */
export function formatCurrencyAmount(
  value: bigint,
  currency: string,
): string {
  const decimals = currencyMinorUnits(currency);
  if (decimals === 0) {
    return (value / 1_000_000n).toString();
  }
  const step = 10n ** BigInt(6 - decimals);
  const rounded = value - (value % step);
  return formatFixed(rounded, decimals);
}

function formatFixed(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1_000_000n;
  const fraction = (abs % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .slice(0, decimals)
    .replace(/0+$/, "");
  const result = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${result}` : result;
}
