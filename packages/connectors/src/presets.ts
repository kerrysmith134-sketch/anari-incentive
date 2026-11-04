import type { ColumnMapping } from "./mapping.js";
import type { HttpJsonConnectorConfig } from "./http-json.js";

export interface FieldMappingPreset {
  code: string;
  provider: string;
  name: string;
  mappingType: "CSV" | "HTTP_JSON";
  sourceSystem: string;
  targetType: string;
  fieldMap: Record<string, string>;
  config: Record<string, unknown>;
}

/**
 * Starter mapping profiles for common providers. They are reference data,
 * not a claim that every account uses these field names; tenants version and
 * adapt them through the integration mapping registry.
 */
export const FIELD_MAPPING_PRESETS: FieldMappingPreset[] = [
  {
    code: "hubspot-deals",
    provider: "hubspot",
    name: "HubSpot deals",
    mappingType: "HTTP_JSON",
    sourceSystem: "hubspot",
    targetType: "EVIDENCE",
    fieldMap: {
      sourceRecordId: "id",
      eventType: "properties.dealstage",
      subjectType: "objectType",
      subjectId: "id",
      evidenceType: "CRM_DEAL",
      occurredAt: "properties.closedate",
    },
    config: {
      recordsPath: "results",
      nextCursorPath: "paging.next.after",
      cursorParam: "after",
      pageSizeParam: "limit",
    },
  },
  {
    code: "feishu-bitable",
    provider: "feishu",
    name: "Feishu Bitable records",
    mappingType: "HTTP_JSON",
    sourceSystem: "feishu",
    targetType: "EVIDENCE",
    fieldMap: {
      sourceRecordId: "record_id",
      eventType: "fields.event_type",
      subjectType: "fields.subject_type",
      subjectId: "fields.subject_id",
      evidenceType: "FEISHU_RECORD",
      occurredAt: "fields.occurred_at",
    },
    config: {
      recordsPath: "data.items",
      nextCursorPath: "data.page_token",
      cursorParam: "page_token",
      pageSizeParam: "page_size",
    },
  },
  {
    code: "erp-orders",
    provider: "erp",
    name: "ERP orders",
    mappingType: "HTTP_JSON",
    sourceSystem: "erp",
    targetType: "EVIDENCE",
    fieldMap: {
      sourceRecordId: "order_id",
      eventType: "event_type",
      subjectType: "subject_type",
      subjectId: "subject_id",
      evidenceType: "ERP_ORDER",
      occurredAt: "occurred_at",
    },
    config: {
      recordsPath: "records",
      nextCursorPath: "next_cursor",
      cursorParam: "cursor",
      pageSizeParam: "page_size",
    },
  },
];

/**
 * HubSpot CRM search pull preset (POST /crm/v3/objects/{objectType}/search).
 * Paginates with the `after` cursor inside the request body.
 */
export function buildHubspotSearchPullConfig(input: {
  accessToken: string;
  objectType: string;
  properties: string[];
  columns: ColumnMapping;
  pageSize?: number;
  fetchImpl?: typeof fetch;
}): HttpJsonConnectorConfig {
  return {
    sourceSystem: "hubspot",
    url: `https://api.hubapi.com/crm/v3/objects/${input.objectType}/search`,
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}` },
    body: {
      properties: input.properties,
      sorts: [],
      filterGroups: [],
    },
    recordsPath: "results",
    nextCursorPath: "paging.next.after",
    cursorBodyKey: "after",
    pageSize: input.pageSize ?? 50,
    columns: input.columns,
    fetchImpl: input.fetchImpl,
  };
}

/**
 * Feishu/Lark Bitable records pull preset (GET with page_token pagination).
 * Records arrive at `data.items`; `data.page_token` drives the next page.
 */
export function buildFeishuBitablePullConfig(input: {
  tenantAccessToken: string;
  appToken: string;
  tableId: string;
  columns: ColumnMapping;
  pageSize?: number;
  fetchImpl?: typeof fetch;
}): HttpJsonConnectorConfig {
  return {
    sourceSystem: "feishu",
    url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${input.appToken}/tables/${input.tableId}/records`,
    headers: { authorization: `Bearer ${input.tenantAccessToken}` },
    recordsPath: "data.items",
    nextCursorPath: "data.page_token",
    cursorParam: "page_token",
    pageSizeParam: "page_size",
    pageSize: input.pageSize ?? 100,
    columns: input.columns,
    fetchImpl: input.fetchImpl,
  };
}
