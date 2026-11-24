/**
 * PG 存储实现的共享纯函数：日期/金额规范化、JSON 兜底与 not-found 错误。
 *
 * 行为保持型重构：以下函数体从原 `apps/api/src/pg-store.ts` 逐字搬移，仅改了模块位置。
 * `DEMO_TENANT_ID` / `DEMO_REQUESTER_ID` 仍由 `pg-store.ts` 对外 re-export，调用方无需改动。
 */

import { NotFoundError } from "./store.js";

export const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_REQUESTER_ID = "00000000-0000-4000-8000-000000000003";

export function iso(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function isoDate(value: Date | string | null): string | undefined {
  if (value === null) return undefined;
  return typeof value === "string"
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
}

export function notFound(kind: string, id: string): never {
  throw new NotFoundError(`${kind} ${id} not found`);
}

export function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export function asJson<T>(value: unknown, fallback: T): T {
  return (value ?? fallback) as T;
}

/** Canonical 6-decimal money string, matching PostgreSQL numeric(20,6). */
export function normalizeAmount(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const normalized = `${whole}.${(fraction + "000000").slice(0, 6)}`;
  // PostgreSQL numeric has no negative zero; hashing "-0.000000" would break
  // the ledger chain the moment the value reads back as "0.000000".
  const isZero = /^0+$/.test(normalized.replace(".", ""));
  return negative && !isZero ? `-${normalized}` : normalized;
}

/** Human/API-facing amount: drop trailing zeros, e.g. 20520.000000 -> 20520. */
export function negateAmount(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("-") ? trimmed.slice(1) : `-${trimmed}`;
}

export function trimAmount(value: string): string {
  const [whole, fraction] = value.split(".");
  if (!fraction) return value;
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole!;
}
