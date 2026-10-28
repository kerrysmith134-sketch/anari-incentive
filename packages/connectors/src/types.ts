import type { IngestionEvent } from "@anari/domain";

export interface ConnectorPullResult {
  events: IngestionEvent[];
  nextCursor: string | null;
}

/**
 * Generic connector contract. A CRM/ERP/Feishu adapter implements `pull` and
 * returns normalized ingestion events; the core ingestion endpoint handles
 * idempotency and evidence creation.
 */
export interface Connector {
  name: string;
  pull(cursor: string | null): Promise<ConnectorPullResult>;
}
