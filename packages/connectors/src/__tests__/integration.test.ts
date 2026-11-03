import { describe, expect, it } from "vitest";
import { buildHttpJsonConnectorConfig } from "../integration.js";

const connection = {
  provider: "erp",
  credentialRef: "ERP_SECRET",
  config: { url: "https://erp.example/api/orders", pageSize: 50 },
};
const mapping = {
  mappingType: "HTTP_JSON" as const,
  sourceSystem: "erp",
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
    pageSize: 10,
  },
};

describe("integration connector config", () => {
  it("merges mapping paths with connection endpoint overrides", () => {
    const config = buildHttpJsonConnectorConfig(connection, mapping);
    expect(config).not.toBeNull();
    expect(config?.url).toBe("https://erp.example/api/orders");
    expect(config?.pageSize).toBe(50);
    expect(config?.recordsPath).toBe("records");
    expect(config?.nextCursorPath).toBe("next_cursor");
    expect(config?.cursorParam).toBe("cursor");
    expect(config?.pageSizeParam).toBe("page_size");
    expect(config?.columns.subjectId).toBe("subject_id");
  });

  it("includes configured headers as strings", () => {
    const config = buildHttpJsonConnectorConfig(
      { ...connection, config: { ...connection.config, headers: { "x-api-key": "k", empty: "" } } },
      mapping,
    );
    expect(config?.headers).toEqual({ "x-api-key": "k" });
  });

  it("rejects non-HTTP mappings, missing urls and missing required fields", () => {
    expect(
      buildHttpJsonConnectorConfig(connection, {
        ...mapping,
        mappingType: "CSV",
      }),
    ).toBeNull();
    expect(
      buildHttpJsonConnectorConfig(
        { ...connection, config: { ...connection.config, url: "" } },
        mapping,
      ),
    ).toBeNull();
    expect(
      buildHttpJsonConnectorConfig(connection, {
        ...mapping,
        fieldMap: { ...mapping.fieldMap, subjectId: "" },
      }),
    ).toBeNull();
  });
});
