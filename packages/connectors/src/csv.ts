import { mapRecordToEvent, type ColumnMapping } from "./mapping.js";
import type { Connector, ConnectorPullResult } from "./types.js";

/** Minimal RFC-4180-style CSV parser (quotes, escaped quotes, newlines). */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // ignore; handled by \n
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface CsvConnectorConfig {
  sourceSystem: string;
  /** CSV column names mapped to ingestion fields. */
  columns: ColumnMapping;
  pageSize?: number;
}

/**
 * CSV adapter for the first phase; a real CRM/ERP adapter can replace this
 * without changing the core ingestion path.
 */
export class CsvConnector implements Connector {
  readonly name: string;
  private readonly rows: string[][];
  private readonly header: string[];

  constructor(
    csv: string,
    private readonly config: CsvConnectorConfig,
  ) {
    this.name = `csv:${config.sourceSystem}`;
    const parsed = parseCsv(csv.trim());
    this.header = parsed[0] ?? [];
    this.rows = parsed.slice(1);
  }

  async pull(cursor: string | null, _updatedSince?: string): Promise<ConnectorPullResult> {
    const pageSize = this.config.pageSize ?? 100;
    const start = cursor ? Number(cursor) : 0;
    if (!Number.isInteger(start) || start < 0) {
      throw new Error(`Invalid CSV cursor: ${cursor}`);
    }
    const page = this.rows.slice(start, start + pageSize);
    const events = page.map((row) => this.toEvent(row));
    const next = start + pageSize < this.rows.length ? String(start + pageSize) : null;
    return { events, nextCursor: next };
  }

  private toEvent(row: string[]) {
    const record = Object.fromEntries(
      this.header.map((column, index) => [column, row[index] ?? ""]),
    );
    return mapRecordToEvent(record, this.config.columns);
  }
}
