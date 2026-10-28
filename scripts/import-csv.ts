import { readFileSync } from "node:fs";
import { CsvConnector, type CsvConnectorConfig } from "@anari/connectors";

const csvPath = process.argv[2];
const mappingPath = process.argv[3];
const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const tenantId =
  process.env.TENANT_ID ?? "00000000-0000-4000-8000-000000000001";

if (!csvPath || !mappingPath) {
  console.error("Usage: npm run import:csv -- <file.csv> <mapping.json>");
  process.exit(1);
}

const connector = new CsvConnector(
  readFileSync(csvPath, "utf8"),
  JSON.parse(readFileSync(mappingPath, "utf8")) as CsvConnectorConfig,
);

let cursor: string | null = null;
let total = 0;
do {
  const page = await connector.pull(cursor);
  if (page.events.length === 0) break;
  const response = await fetch(`${baseUrl}/api/v1/ingestion/events:batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": tenantId,
    },
    body: JSON.stringify({
      sourceSystem: connector.name.replace(/^csv:/, ""),
      events: page.events,
    }),
  });
  const body = (await response.json()) as {
    data?: { accepted: number; duplicates: number };
    error?: { message?: string };
  };
  if (!response.ok) {
    console.error(`Import failed: ${body.error?.message ?? response.status}`);
    process.exit(1);
  }
  total += body.data?.accepted ?? 0;
  console.log(
    `page cursor=${cursor ?? "start"} accepted=${body.data?.accepted ?? 0} duplicates=${body.data?.duplicates ?? 0}`,
  );
  cursor = page.nextCursor;
} while (cursor !== null);

console.log(`CSV import complete: ${total} accepted`);
