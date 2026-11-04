/**
 * Audit anchor archival job (MON-07).
 *
 * Fetches the current anchor manifest from the API and pushes it to the
 * configured WORM endpoint (AUDIT_WORM_URI), recording the receipt hash.
 * Designed to run from cron/systemd timers:
 *
 *   API_BASE_URL=… TENANT_ID=… API_TOKEN=… AUDIT_WORM_URI=https://… \
 *     npm run anchor:export
 *
 * If AUDIT_WORM_URI is unset the manifest is written to the local filesystem
 * path in AUDIT_ANCHOR_DIR (default ./anchor-archive) so operators still get
 * an append-only receipt trail to sync to WORM storage later.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const tenantId = process.env.TENANT_ID ?? "tenant-demo";
const token = process.env.API_TOKEN ?? process.env.WORKER_TOKEN ?? "";
const wormUri = process.env.AUDIT_WORM_URI ?? "";
const anchorDir =
  process.env.AUDIT_ANCHOR_DIR ?? join(process.cwd(), "anchor-archive");

async function main(): Promise<void> {
  if (!token) {
    console.error(
      "API_TOKEN (or WORKER_TOKEN) is required to read the anchor manifest.",
    );
    process.exit(1);
  }

  const response = await fetch(
    `${apiBaseUrl}/api/v1/audit-events/anchor`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        "x-tenant-id": tenantId,
      },
    },
  );
  if (!response.ok) {
    console.error(`anchor fetch failed: ${response.status}`);
    process.exit(1);
  }
  const payload = (await response.json()) as { data: unknown };
  const manifest = JSON.stringify(
    { tenantId, exportedAt: new Date().toISOString(), anchor: payload.data },
    null,
    2,
  );
  const receiptHash = createHash("sha256").update(manifest).digest("hex");

  if (wormUri) {
    const wormResponse = await fetch(wormUri, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.AUDIT_WORM_TOKEN
          ? {
              authorization: `Bearer ${process.env.AUDIT_WORM_TOKEN}`,
            }
          : {}),
      },
      body: manifest,
    });
    if (!wormResponse.ok) {
      console.error(`WORM archival failed: ${wormResponse.status}`);
      process.exit(1);
    }
    console.log(
      `archived anchor to ${wormUri}: receipt=${receiptHash.slice(0, 16)}…`,
    );
  } else {
    await mkdir(anchorDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeFile(join(anchorDir, `anchor-${stamp}.json`), manifest, "utf8");
    await appendFile(
      join(anchorDir, "receipts.log"),
      `${new Date().toISOString()} ${receiptHash}\n`,
      "utf8",
    );
    console.log(
      `wrote local anchor archive (no AUDIT_WORM_URI configured): ` +
        `receipt=${receiptHash.slice(0, 16)}…`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
