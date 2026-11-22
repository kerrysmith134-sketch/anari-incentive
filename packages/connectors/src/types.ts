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
  /** INT-206：updatedSince 为增量 watermark（可选；connector 未配置时间参数时忽略）。 */
  pull(cursor: string | null, updatedSince?: string): Promise<ConnectorPullResult>;
}
