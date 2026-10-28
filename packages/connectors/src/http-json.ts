import type { IngestionEvent } from "@anari/domain";
import { mapRecordToEvent, type ColumnMapping } from "./mapping.js";
import type { Connector, ConnectorPullResult } from "./types.js";

export interface HttpJsonConnectorConfig {
  sourceSystem: string;
  url: string;
  columns: ColumnMapping;
  headers?: Record<string, string>;
  /** Dot path to the record array; defaults to the body itself or `records`. */
  recordsPath?: string;
  /** Dot path to the next cursor; defaults to `nextCursor`. */
  nextCursorPath?: string;
  cursorParam?: string;
  pageSizeParam?: string;
  pageSize?: number;
  fetchImpl?: typeof fetch;
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value);
}

/**
 * Generic REST/JSON adapter for CRM, ERP and ticketing systems.
 *
 * The endpoint contract is intentionally simple: return an array (or an
 * object containing one at `recordsPath`), and optionally a cursor. Mapping
 * into the ingestion envelope is identical to the CSV connector.
 */
export class HttpJsonConnector implements Connector {
  readonly name: string;

  constructor(private readonly config: HttpJsonConnectorConfig) {
    this.name = `http-json:${config.sourceSystem}`;
  }

  async pull(cursor: string | null): Promise<ConnectorPullResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const url = new URL(this.config.url);
    if (cursor && this.config.cursorParam) {
      url.searchParams.set(this.config.cursorParam, cursor);
    }
    if (this.config.pageSizeParam) {
      url.searchParams.set(
        this.config.pageSizeParam,
        String(this.config.pageSize ?? 100),
      );
    }

    const response = await fetchImpl(url, {
      headers: { accept: "application/json", ...this.config.headers },
    });
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      throw new Error(
        `HTTP connector ${this.config.sourceSystem} failed: ${response.status}`,
      );
    }

    const records = this.config.recordsPath
      ? getPath(payload, this.config.recordsPath)
      : Array.isArray(payload)
        ? payload
        : getPath(payload, "records");
    if (!Array.isArray(records)) {
      throw new Error(
        `HTTP connector ${this.config.sourceSystem}: records not found`,
      );
    }

    const events: IngestionEvent[] = records.map((record) => {
      if (!record || typeof record !== "object") {
        throw new Error(
          `HTTP connector ${this.config.sourceSystem}: record is not an object`,
        );
      }
      return mapRecordToEvent(record as Record<string, unknown>, this.config.columns);
    });

    const nextCursor = this.config.nextCursorPath
      ? getPath(payload, this.config.nextCursorPath)
      : getPath(payload, "nextCursor");
    return {
      events,
      nextCursor:
        nextCursor === undefined || nextCursor === null
          ? null
          : String(nextCursor),
    };
  }
}
