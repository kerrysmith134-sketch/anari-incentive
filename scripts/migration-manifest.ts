/**
 * NPV2-010：迁移清单与 RLS 覆盖检查。
 *
 * 用途：
 *   DATABASE_URL=... npx tsx scripts/migration-manifest.ts
 *
 * 输出：
 *  1. migrations/manifest.json —— 迁移文件清单（名称、大小、SHA-256），
 *     用于 CI 校验「迁移未被原地改写」（历史迁移不可变的快速探针）。
 *  2. RLS 覆盖报告 —— 对每个含 tenant_id 的用户表，检查是否启用 RLS 且
 *     存在 policy。生产门禁要求：清单中所有 tenant-scoped 表全部覆盖。
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

function buildManifest() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const entries = files.map((name) => {
    const content = readFileSync(join(MIGRATIONS_DIR, name));
    return {
      file: name,
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  });
  return { generatedAt: new Date().toISOString(), migrations: entries };
}

const manifest = buildManifest();
const outPath = join(MIGRATIONS_DIR, "manifest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `manifest: ${manifest.migrations.length} migrations -> ${outPath}`,
);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL not set; skip live RLS coverage check.");
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  const { rows: tables } = await pool.query(`
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns i
          WHERE i.table_schema = 'public'
            AND i.table_name = c.relname
            AND i.column_name = 'tenant_id'
       )
     ORDER BY c.relname
  `);
  const uncovered: string[] = [];
  for (const { table_name } of tables) {
    const { rows } = await pool.query(
      `SELECT
         c.relrowsecurity AS rls_enabled,
         (SELECT COUNT(*) FROM pg_policy p
           WHERE p.polrelid = c.oid) AS policy_count
       FROM pg_class c
      WHERE c.oid = $1::regclass`,
      [table_name],
    );
    if (!rows[0]?.rls_enabled || Number(rows[0]?.policy_count) === 0) {
      uncovered.push(table_name);
    }
  }
  if (uncovered.length > 0) {
    console.error(
      `RLS coverage gaps (${uncovered.length}): ${uncovered.join(", ")}`,
    );
    console.error(
      "这些表携带 tenant_id 但未启用 RLS 或没有 policy；按 SECURITY_HARDENING.md 补迁移。",
    );
    process.exitCode = 1;
  } else {
    console.log(
      `RLS coverage OK: ${tables.length} tenant-scoped tables all protected.`,
    );
  }
} finally {
  await pool.end();
}
