import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import type { PolicyDefinition } from "@anari/domain";
import { sha256 } from "@anari/policy-dsl";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const tenantId =
  process.env.TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
const approvedBy = process.env.APPROVED_BY;
const effectiveFrom =
  process.env.EFFECTIVE_FROM ?? new Date().toISOString();
const status = approvedBy ? "PUBLISHED" : "DRAFT";
const root = process.cwd();
const packsDir = join(root, "examples", "verticals");

interface PackManifest {
  id?: string;
  policyVersionId?: string;
  policy?: string;
  corePolicyCode?: string;
  applicability?: Record<string, unknown>;
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  const entries = readdirSync(packsDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );
  for (const entry of entries) {
    const manifestPath = join(packsDir, entry.name, "pack.json");
    let manifest: PackManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackManifest;
    } catch {
      console.warn(`skip ${entry.name}: no readable pack.json`);
      continue;
    }
    if (!manifest.policyVersionId || !manifest.policy) {
      console.warn(`skip ${entry.name}: missing policyVersionId/policy`);
      continue;
    }
    const policy = JSON.parse(
      readFileSync(join(packsDir, entry.name, manifest.policy), "utf8"),
    ) as PolicyDefinition;
    const contentHash = sha256(policy);

    try {
      const result = await pool.query(
      `INSERT INTO policy_versions
        (id, tenant_id, policy_code, version, scope, status, effective_from,
         rule_ast, rule_schema_version, content_hash, approved_by,
         approved_at, published_at, applicability)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'policy-definition/v1',$9,$10,
               CASE WHEN $10::uuid IS NULL THEN NULL ELSE now() END,
               CASE WHEN $10::uuid IS NULL THEN NULL ELSE now() END,
               $11::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        manifest.policyVersionId,
        tenantId,
        policy.code,
        policy.version,
        JSON.stringify({ pack: manifest.id ?? entry.name }),
        status,
        effectiveFrom,
        JSON.stringify(policy),
        contentHash,
        approvedBy ?? null,
        JSON.stringify(manifest.applicability ?? {}),
      ],
    );
      console.log(
        `${result.rowCount === 1 ? "seeded" : "skipped"} ${policy.code}:${policy.version} (${status})`,
      );
    } catch (error) {
      console.warn(
        `failed ${policy.code}:${policy.version}: ${String(error)}`,
      );
    }
  }
} finally {
  await pool.end();
}
