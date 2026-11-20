import { zhStatus } from "./zh.js";

const SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
  SGD: "S$",
};

export function toNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 精确求和（1e6 微单位 BigInt）：金额字符串累加后返回 DecimalString。
 * 展示前再交给 formatMoney——绝不先用 Number 累加（浮点漂移）。
 */
export function sumMoney(
  values: Array<string | number | undefined | null>,
): string {
  const FACTOR = 1_000_000n;
  let total = 0n;
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const text = String(value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(text)) continue;
    const negative = text.startsWith("-");
    const [intPart = "0", fraction = ""] = (negative
      ? text.slice(1)
      : text
    ).split(".");
    const micros =
      BigInt(intPart) * FACTOR + BigInt((fraction + "000000").slice(0, 6));
    total += negative ? -micros : micros;
  }
  const sign = total < 0n ? "-" : "";
  const absolute = total < 0n ? -total : total;
  const whole = absolute / FACTOR;
  const fraction = String(absolute % FACTOR)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatMoney(
  value: string | number | undefined | null,
  currency = "CNY",
  options: { compact?: boolean; decimals?: number } = {},
): string {
  const amount = toNumber(value);
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  const decimals = options.decimals ?? (Number.isInteger(amount) ? 0 : 2);
  if (options.compact) {
    const abs = Math.abs(amount);
    if (abs >= 1_000_000) {
      return `${amount < 0 ? "-" : ""}${symbol}${trim(abs / 1_000_000, 2)}M`;
    }
    if (abs >= 10_000) {
      return `${amount < 0 ? "-" : ""}${symbol}${trim(abs / 1_000, 1)}K`;
    }
  }
  return `${amount < 0 ? "-" : ""}${symbol}${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(amount))}`;
}

function trim(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

export function formatNumber(
  value: number | string | undefined | null,
  compact = false,
): string {
  return new Intl.NumberFormat("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(toNumber(value));
}

export function formatPercent(
  value: number | string | undefined | null,
  digits = 0,
): string {
  return `${(toNumber(value) * 100).toFixed(digits)}%`;
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelative(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  const abs = Math.abs(deltaSeconds);
  if (abs < 60) return formatter.format(deltaSeconds, "second");
  if (abs < 3600) return formatter.format(Math.round(deltaSeconds / 60), "minute");
  if (abs < 86_400)
    return formatter.format(Math.round(deltaSeconds / 3600), "hour");
  if (abs < 2_592_000)
    return formatter.format(Math.round(deltaSeconds / 86_400), "day");
  return formatter.format(Math.round(deltaSeconds / 2_592_000), "month");
}

export function titleCase(value?: string | null): string {
  if (!value) return "—";
  // 已知枚举直接走中文词典（如 ACTIVE → 生效中）。
  const zh = zhStatus(value.trim().toUpperCase());
  if (zh !== value.trim().toUpperCase()) return zh;
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function initials(value?: string | null): string {
  if (!value) return "?";
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

export function shortId(value?: string | null, length = 8): string {
  if (!value) return "—";
  if (value.length <= length) return value;
  return value.slice(0, length);
}

export function displayName(
  personId: string | undefined | null,
  people: Array<{ id: string; displayName: string }>,
): string {
  if (!personId) return "—";
  return people.find((person) => person.id === personId)?.displayName ?? shortId(personId);
}

export function statusTone(
  status?: string | null,
): "neutral" | "success" | "warning" | "danger" | "info" | "accent" {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
    case "APPROVED":
    case "ACCEPTED":
    case "PAID":
    case "CONNECTED":
    case "COMPLETED":
    case "PASSED":
    case "HEALTHY":
      return "success";
    case "PENDING":
    case "CALCULATED":
    case "SUBMITTED":
    case "CLAIMED":
    case "DRAFT":
    case "QUEUED":
    case "SCHEDULED":
    case "PAUSED":
      return "warning";
    case "BLOCKED":
    case "FAILED":
    case "REJECTED":
    case "CANCELLED":
    case "REVERSED":
    case "EXPIRED":
    case "DISCONNECTED":
    case "OVERDUE":
      return "danger";
    case "OPEN":
    case "IN_PROGRESS":
    case "RUNNING":
      return "info";
    default:
      return "neutral";
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthBounds(reference = new Date()): {
  start: string;
  end: string;
  startInput: string;
  endInput: string;
} {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
  const startIso = new Date(
    Date.UTC(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0),
  ).toISOString();
  const endIso = new Date(
    Date.UTC(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59),
  ).toISOString();
  return {
    start: startIso,
    end: endIso,
    startInput: dateInputValue(start),
    endInput: dateInputValue(end),
  };
}

export function toIsoDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function sum(values: Array<string | number | undefined | null>): number {
  return values.reduce<number>((total, value) => total + toNumber(value), 0);
}

/**
 * 微单位（1e6）→ DecimalString——与 sumMoney 互逆，绝不走 Number（浮点漂移）。
 * 用于把对账差异 deltaMicros 预填进调整金额输入框（NP-023 B 方案）。
 */
export function microsToDecimal(micros: string): string {
  const value = micros.trim();
  if (!/^-?\d+$/.test(value)) return "0";
  const negative = value.startsWith("-");
  const absolute = (negative ? value.slice(1) : value);
  const whole = BigInt(absolute) / 1_000_000n;
  const fraction = String(BigInt(absolute) % 1_000_000n)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
