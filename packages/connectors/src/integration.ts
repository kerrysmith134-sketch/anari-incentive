import type { HttpJsonConnectorConfig } from "./http-json.js";
import type { ColumnMapping } from "./mapping.js";

export interface IntegrationConnectionLike {
  provider: string;
  credentialRef: string;
  config: Record<string, unknown>;
}

export interface IntegrationMappingLike {
  mappingType: "CSV" | "HTTP_JSON";
  sourceSystem: string;
  targetType?: string;
  fieldMap: Record<string, string>;
  config: Record<string, unknown>;
}

const REQUIRED_COLUMNS = [
  "sourceRecordId",
  "eventType",
  "subjectType",
  "subjectId",
  "evidenceType",
] as const;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Turn a registered connection + mapping into an HTTP JSON connector config.
 * Connection config (endpoint, headers) wins over mapping config (record paths),
 * so a tenant can override the endpoint without cloning the mapping.
 * Returns null when the mapping is not HTTP_JSON or required fields are absent.
 */
export function buildHttpJsonConnectorConfig(
  connection: IntegrationConnectionLike,
  mapping: IntegrationMappingLike,
): HttpJsonConnectorConfig | null {
  if (mapping.mappingType !== "HTTP_JSON") return null;
  const merged = { ...mapping.config, ...connection.config };
  const url = text(merged.url);
  if (!url) return null;
  for (const column of REQUIRED_COLUMNS) {
    if (!mapping.fieldMap[column]?.trim()) return null;
  }
  const columns: ColumnMapping = {
    sourceRecordId: mapping.fieldMap.sourceRecordId as string,
    eventType: mapping.fieldMap.eventType as string,
    subjectType: mapping.fieldMap.subjectType as string,
    subjectId: mapping.fieldMap.subjectId as string,
    evidenceType: mapping.fieldMap.evidenceType as string,
    occurredAt: mapping.fieldMap.occurredAt,
    sourceUpdatedAt: mapping.fieldMap.sourceUpdatedAt,
    sourceEventVersion: mapping.fieldMap.sourceEventVersion,
  };
  const headers =
    merged.headers && typeof merged.headers === "object"
      ? Object.fromEntries(
          Object.entries(merged.headers as Record<string, unknown>)
            .filter(([, value]) => String(value ?? "").length > 0)
            .map(([key, value]) => [key, String(value)]),
        )
      : undefined;
  const config: HttpJsonConnectorConfig = {
    sourceSystem: mapping.sourceSystem,
    url,
    columns,
  };
  if (headers && Object.keys(headers).length > 0) config.headers = headers;
  const recordsPath = text(merged.recordsPath);
  if (recordsPath) config.recordsPath = recordsPath;
  const nextCursorPath = text(merged.nextCursorPath);
  if (nextCursorPath) config.nextCursorPath = nextCursorPath;
  const cursorParam = text(merged.cursorParam);
  if (cursorParam) config.cursorParam = cursorParam;
  const pageSizeParam = text(merged.pageSizeParam);
  if (pageSizeParam) config.pageSizeParam = pageSizeParam;
  if (typeof merged.pageSize === "number" && merged.pageSize > 0) {
    config.pageSize = merged.pageSize;
  }
  // NP-006（2026-11-21 审计）：完整保留映射语义——常量/转换/POST body/游标体键/egress allowlist。
  if (
    merged.constants &&
    typeof merged.constants === "object" &&
    !Array.isArray(merged.constants)
  ) {
    const constants = Object.fromEntries(
      Object.entries(merged.constants as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && value.length > 0)
        .map(([key, value]) => [key, String(value)]),
    );
    if (Object.keys(constants).length > 0) columns.constants = constants;
  }
  if (
    merged.transforms &&
    typeof merged.transforms === "object" &&
    !Array.isArray(merged.transforms)
  ) {
    const transforms = Object.fromEntries(
      Object.entries(merged.transforms as Record<string, unknown>)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return [key, value.map(String)];
          }
          if (typeof value === "string" && value.trim()) {
            // 管道语法："date|trim" → ["date", "trim"]。
            return [key, value.split("|").map((part) => part.trim())];
          }
          return [key, []];
        })
        .filter(([, value]) => (value as string[]).length > 0),
    ) as Record<string, string[]>;
    if (Object.keys(transforms).length > 0) columns.transforms = transforms;
  }
  if (merged.method === "POST" || merged.method === "GET") {
    config.method = merged.method;
  }
  if (
    merged.body &&
    typeof merged.body === "object" &&
    !Array.isArray(merged.body)
  ) {
    config.body = merged.body as Record<string, unknown>;
  }
  const cursorBodyKey = text(merged.cursorBodyKey);
  if (cursorBodyKey) config.cursorBodyKey = cursorBodyKey;
  // INT-206：增量拉取参数必须真正进入 connector 配置，否则 updatedSince
  // 永远发不出去（runner 传了也会被连接器忽略）。
  const updatedSinceParam = text(merged.updatedSinceParam);
  if (updatedSinceParam) config.updatedSinceParam = updatedSinceParam;
  const updatedSinceBodyKey = text(merged.updatedSinceBodyKey);
  if (updatedSinceBodyKey) config.updatedSinceBodyKey = updatedSinceBodyKey;
  if (
    Array.isArray(merged.egressAllowlist) &&
    merged.egressAllowlist.every((item) => typeof item === "string" && item.trim())
  ) {
    config.egressAllowlist = (merged.egressAllowlist as string[]).map((item) =>
      item.trim(),
    );
  }
  return config;
}
