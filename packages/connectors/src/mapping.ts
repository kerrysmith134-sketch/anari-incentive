import type { IngestionEvent } from "@anari/domain";

/**
 * NP-INT-001：字段映射规格——支持点路径、常量与转换。
 *
 * - `"properties.dealname"`  → 嵌套点路径解析
 * - `"=CRM_DEAL"`            → 常量（= 前缀）
 * - `"updatedAt|date"`       → 转换管道（| 分隔：date、number、trim、upper、lower）
 */
export interface ColumnMapping {
  sourceRecordId: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  evidenceType: string;
  occurredAt?: string;
  sourceEventVersion?: string;
  /** 可选常量：优先于字段路径。 */
  constants?: Record<string, string>;
  /** 可选逐字段转换管道（键为映射目标名）。 */
  transforms?: Record<string, string[]>;
}

const TRANSFORMS: Record<
  string,
  (value: string) => string
> = {
  trim: (value) => value.trim(),
  upper: (value) => value.toUpperCase(),
  lower: (value) => value.toLowerCase(),
  number: (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed) : value;
  },
  date: (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  },
};

/** 解析映射表达式：常量（=前缀）→ 点路径 → 转换管道。 */
export function resolveField(
  record: Record<string, unknown>,
  expression: string | undefined,
  transforms?: string[],
): string | undefined {
  if (!expression) return undefined;
  if (expression.startsWith("=")) {
    // 常量：不经过转换管道（调用方已有显式值）。
    return expression.slice(1);
  }
  const [path, ...pipe] = expression.split("|");
  let value: unknown = record;
  for (const segment of (path ?? "").split(".")) {
    if (value && typeof value === "object") {
      value = (value as Record<string, unknown>)[segment];
    } else {
      value = undefined;
      break;
    }
  }
  if (value === undefined || value === null || value === "") return undefined;
  let result = String(value);
  const transformsToApply = pipe.length > 0 ? pipe : (transforms ?? []);
  for (const name of transformsToApply) {
    const fn = TRANSFORMS[name.trim()];
    if (fn) result = fn(result);
  }
  return result;
}

export function mapRecordToEvent(
  record: Record<string, unknown>,
  columns: ColumnMapping,
): IngestionEvent {
  const text = (key: string | undefined): string | undefined => {
    if (!key) return undefined;
    // 常量优先。
    if (columns.constants && columns.constants[key] !== undefined) {
      return columns.constants[key];
    }
    return resolveField(record, key, columns.transforms?.[key]);
  };
  const required = (key: string, field: string): string => {
    const value = text(key);
    if (!value) {
      throw new Error(`Mapped field ${field} (${key}) is empty`);
    }
    return value;
  };

  const version = text(columns.sourceEventVersion);

  return {
    sourceRecordId: required(columns.sourceRecordId, "sourceRecordId"),
    // NP-INT-004：无显式版本键时用标准化 payload 哈希代替固定 "1"，
    // 使同一外部记录的后续修改不会被幂等逻辑误判为重复。
    sourceEventVersion:
      version ??
      sha256Json({
        ...record,
      }),
    eventType: required(columns.eventType, "eventType"),
    occurredAt: text(columns.occurredAt),
    subjectType: required(columns.subjectType, "subjectType"),
    subjectId: required(columns.subjectId, "subjectId"),
    evidenceType: required(columns.evidenceType, "evidenceType"),
    qualityStatus: "UNVERIFIED",
    payload: record,
  };
}

import { createHash } from "node:crypto";

/** NP-INT-004：稳定版本键——对去除无意义空白后的 payload 计算哈希。 */
export function sha256Json(value: Record<string, unknown>): string {
  const stable = JSON.stringify(value, (_key, inner: unknown) =>
    inner instanceof Object && !(inner instanceof Array) && !(inner instanceof Date)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : inner,
  );
  return createHash("sha256").update(stable).digest("hex");
}
