/**
 * INT-203（Sprint 2.1）：Canonical Business Event——统一中间表示。
 *
 * 每条来源记录先规范化为 CanonicalBusinessEvent（来源/对象/事件/版本/哈希），
 * 再进入受治理投影（Evidence / FinancialFact / Quarantine）。
 * payloadHash 用稳定序列化计算（键排序），同内容恒同哈希。
 */
import { createHash } from "node:crypto";

export interface CanonicalContext {
  sourceSystem: string;
  mappingVersion: number;
}

export interface CanonicalBusinessEvent {
  sourceSystem: string;
  externalObjectType: string;
  externalObjectId: string;
  eventType: string;
  occurredAt?: string;
  /** 来源系统最后更新时间（增量水位依据；与 occurredAt 分离）。 */
  sourceUpdatedAt?: string;
  /** 本系统获取时间（服务端运行时刻）。 */
  fetchedAt: string;
  /** 来源事件版本；缺省为 payloadHash（内容即版本）。 */
  sourceVersion: string;
  mappingVersion: number;
  /** 稳定内容哈希（键排序 JSON 的 sha256），投影幂等判定依据。 */
  payloadHash: string;
  payload: Record<string, unknown>;
}

/** 稳定 JSON 序列化（键排序；与 policy-dsl sha256 语义一致但独立实现避免反向依赖）。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(
        Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return inner;
  });
}

export function sha256Stable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export interface CanonicalRecordInput {
  sourceRecordId?: unknown;
  sourceEventVersion?: unknown;
  eventType?: unknown;
  occurredAt?: unknown;
  subjectType?: unknown;
  subjectId?: unknown;
  evidenceType?: unknown;
  sourceUpdatedAt?: unknown;
  payload?: unknown;
}

/** 来源记录 → Canonical Business Event（fail-closed：必填字段缺失抛错）。 */
export function canonicalize(record: CanonicalRecordInput, ctx: CanonicalContext): CanonicalBusinessEvent {
  const text = (value: unknown, field: string): string => {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) throw new Error(`canonical: ${field} is required`);
    return normalized;
  };
  const payload = (record.payload ?? {}) as Record<string, unknown>;
  const payloadHash = sha256Stable(payload);
  const sourceVersion =
    typeof record.sourceEventVersion === "string" && record.sourceEventVersion.trim()
      ? record.sourceEventVersion.trim()
      : payloadHash;
  return {
    sourceSystem: ctx.sourceSystem,
    externalObjectType: text(record.subjectType, "subjectType"),
    externalObjectId: text(record.subjectId, "subjectId"),
    eventType: text(record.eventType, "eventType"),
    occurredAt: typeof record.occurredAt === "string" && record.occurredAt ? record.occurredAt : undefined,
    sourceUpdatedAt:
      typeof record.sourceUpdatedAt === "string" && record.sourceUpdatedAt
        ? record.sourceUpdatedAt
        : undefined,
    fetchedAt: new Date().toISOString(),
    sourceVersion,
    mappingVersion: ctx.mappingVersion,
    payloadHash,
    payload,
  };
}
