import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const root = process.cwd();
const migrationsDir = join(root, "db", "migrations");
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      filename text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await pool.query<{
    version: string;
    checksum: string;
  }>("SELECT version, checksum FROM schema_migrations");
  const applied = new Map(rows.map((row) => [row.version, row.checksum]));

  // NPV2-010：--until <version> 支持两阶段应用（升级路径实测：
  // 先应用上一版基线，再全量应用——与生产滚动升级一致）。
  const untilIndex = process.argv.indexOf("--until");
  const until =
    untilIndex >= 0 ? (process.argv[untilIndex + 1] ?? "") : undefined;
  const allFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const files = until
    ? allFiles.filter((file) => file.replace(/\.sql$/, "") <= until)
    : allFiles;
  if (until) {
    console.log(`--until ${until}: applying ${files.length}/${allFiles.length} migrations`);
  }

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = applied.get(version);
    if (existing) {
      if (existing !== checksum) {
        throw new Error(
          `migration ${file} was modified after being applied (checksum mismatch)`,
        );
      }
      console.log(`skip ${file}`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (version, filename, checksum)
         VALUES ($1,$2,$3)`,
        [version, file, checksum],
      );
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log("migrations complete");
} finally {
  await pool.end();
}
