import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const seedDir = join(process.cwd(), "db", "seed");
const pool = new Pool({ connectionString: databaseUrl });

try {
  for (const file of readdirSync(seedDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    console.log(`seeding ${file}`);
    await pool.query(readFileSync(join(seedDir, file), "utf8"));
  }
  console.log("seed complete");
} finally {
  await pool.end();
}
