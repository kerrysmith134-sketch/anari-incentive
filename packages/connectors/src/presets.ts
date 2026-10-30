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
