import type { IngestionEvent } from "@anari/domain";

/** Source fields mapped to the generic ingestion envelope. */
export interface ColumnMapping {
  sourceRecordId: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  evidenceType: string;
  occurredAt?: string;
  sourceEventVersion?: string;
}

export function mapRecordToEvent(
  record: Record<string, unknown>,
  columns: ColumnMapping,
): IngestionEvent {
  const text = (key: string | undefined): string | undefined => {
    if (!key) return undefined;
    const value = record[key];
    if (value === undefined || value === null || value === "") return undefined;
    return String(value);
  };
  const required = (key: string, field: string): string => {
    const value = text(key);
    if (!value) {
      throw new Error(`Mapped field ${field} (${key}) is empty`);
    }
    return value;
  };

  return {
    sourceRecordId: required(columns.sourceRecordId, "sourceRecordId"),
    sourceEventVersion: text(columns.sourceEventVersion) ?? "1",
    eventType: required(columns.eventType, "eventType"),
    occurredAt: text(columns.occurredAt),
    subjectType: required(columns.subjectType, "subjectType"),
    subjectId: required(columns.subjectId, "subjectId"),
    evidenceType: required(columns.evidenceType, "evidenceType"),
    qualityStatus: "UNVERIFIED",
    payload: record,
  };
}
