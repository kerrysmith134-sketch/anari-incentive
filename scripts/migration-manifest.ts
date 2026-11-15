/**
 * NPV2-010 / AUD-018：迁移清单、不可变门禁与 RLS 质量检查。
 *
 * 用途：
 *   npx tsx scripts/migration-manifest.ts            # 重新生成 manifest（维护者）
 *   npx tsx scripts/migration-manifest.ts --check    # CI 门禁：三查全过才放行
 *
 * --check 三查（AUD-018 验收）：
 *  1. 清单比对 —— 当前 SQL 文件 hash 与受保护基准 manifest.json 比对，
 *     任何历史迁移被原地改写 / 私自新增 / 删除都会 fail；
 *  2. 静态策略审计 —— 扫描迁移 SQL：tenant-scoped 表 ENABLE RLS 但缺
 *     FORCE RLS、或出现宽策略 USING (true) / WITH CHECK (true) 逐表报告；
 *  3. 活动 RLS 质量检查（有 DATABASE_URL 时）—— relforcerowsecurity、
 *     每表 policy 的 USING/WITH CHECK 表达式、BYPASSRLS 角色清单。
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

const checkOnly = process.argv.includes("--check");

const manifest = buildManifest();
const outPath = join(MIGRATIONS_DIR, "manifest.json");
if (checkOnly) {
  // AUD-018：CI 门禁——与受保护基准比对，不回写。
  let baseline: typeof manifest;
  try {
    baseline = JSON.parse(readFileSync(outPath, "utf8")) as typeof manifest;
  } catch {
    console.error(`--check: cannot read baseline manifest at ${outPath}`);
    process.exit(1);
  }
  const base = new Map(baseline.migrations.map((m) => [m.file, m]));
  const now = new Map(manifest.migrations.map((m) => [m.file, m]));
  const rewritten: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [file, entry] of now) {
    const expected = base.get(file);
    if (!expected) added.push(file);
    else if (
      expected.sha256 !== entry.sha256 ||
      expected.bytes !== entry.bytes
    ) {
      rewritten.push(file);
    }
  }
  for (const file of base.keys()) if (!now.has(file)) removed.push(file);
  if (rewritten.length + added.length + removed.length > 0) {
    console.error("--check FAILED: migration manifest drift detected");
    for (const file of rewritten) console.error(`  REWRITTEN: ${file}`);
    for (const file of added) console.error(`  NOT IN BASELINE: ${file}`);
    for (const file of removed) console.error(`  REMOVED: ${file}`);
    console.error(
      "历史迁移不可变：新迁移请新增 NNN_*.sql 并由维护者运行（不带 --check 的）本脚本刷新基准。",
    );
    process.exit(1);
  }
  console.log(
    `--check: manifest matches baseline (${manifest.migrations.length} migrations).`,
  );
} else {
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `manifest: ${manifest.migrations.length} migrations -> ${outPath}`,
  );
}

// AUD-018：静态策略审计（无需数据库，CI 必跑）。
{
  const problems: string[] = [];
  for (const entry of manifest.migrations) {
    const sql = readFileSync(join(MIGRATIONS_DIR, entry.file), "utf8");
    // 每个启用 RLS 的表都应有 FORCE RLS（表 owner 也要受策略约束）。
    const enableTargets = [...sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi,
    )].map((m) => m[1]!.replace(/"/g, ""));
    for (const table of enableTargets) {
      const forced = new RegExp(
        `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${table.replace(".", "\\.")}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "i",
      ).test(sql);
      if (!forced) {
        problems.push(`${entry.file}: ${table} ENABLE RLS 但缺 FORCE ROW LEVEL SECURITY`);
      }
    }
    // 宽策略：USING/WITH CHECK 直接给 true 的策略等于没有隔离。
    for (const m of sql.matchAll(
      /(USING|WITH\s+CHECK)\s*\(\s*true\s*\)/gi,
    )) {
      problems.push(
        `${entry.file}: 宽策略 ${m[0]}（等于对所有人可见/可写）——需要租户谓词或角色限定`,
      );
    }
  }
  if (problems.length > 0) {
    console.error(`--check: static RLS policy audit found ${problems.length} issue(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("--check: static RLS policy audit clean.");
  }
}
if (checkOnly && !process.env.DATABASE_URL) {
  // 静态门禁已跑；活动质量检查需要 DATABASE_URL（test:pg 场景补跑）。
  process.exit(process.exitCode ?? 0);
}

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
         c.relforcerowsecurity AS rls_forced,
         (SELECT COUNT(*) FROM pg_policy p
           WHERE p.polrelid = c.oid) AS policy_count
       FROM pg_class c
      WHERE c.oid = $1::regclass`,
      [table_name],
    );
    const notForced = !rows[0]?.rls_enabled || !rows[0]?.rls_forced;
    const noPolicy = Number(rows[0]?.policy_count) === 0;
    if (notForced || noPolicy) {
      uncovered.push(
        noPolicy ? `${table_name} (no policy)` : `${table_name} (RLS not forced)`,
      );
    }
  }
  if (uncovered.length > 0) {
    console.error(
      `RLS coverage gaps (${uncovered.length}): ${uncovered.join(", ")}`,
    );
    console.error(
      "这些表携带 tenant_id 但未启用/FORCE RLS 或没有 policy；按 SECURITY_HARDENING.md 补迁移。",
    );
    process.exitCode = 1;
  } else {
    console.log(
      `RLS coverage OK: ${tables.length} tenant-scoped tables all protected (FORCED).`,
    );
  }

  // AUD-018：活动库宽策略检查（USING(true)/WITH CHECK(true)）。
  const { rows: permissive } = await pool.query(`
    SELECT p.polname AS policy, c.relname AS table_name
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE pg_get_expr(p.polqual, p.polrelid) = 'true'
        OR pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
     ORDER BY c.relname
  `);
  if (permissive.length > 0) {
    console.error(
      `Permissive RLS policies (${permissive.length}): ${permissive
        .map((row) => `${row.table_name}.${row.policy}`)
        .join(", ")}`,
    );
    process.exitCode = 1;
  } else {
    console.log("Live policy quality OK: no USING(true)/WITH CHECK(true) policies.");
  }

  // AUD-018：BYPASSRLS 角色属性清单（应用连接角色不得旁路 RLS）。
  // 引导超管（容器 POSTGRES_USER，如 anari）天然旁路 RLS 且非应用连接角色；
  // 门禁针对"非超管的应用角色"——如 anari_app 被授予 BYPASSRLS 即 fail。
  const { rows: bypass } = await pool.query(`
    SELECT rolname FROM pg_roles
     WHERE rolbypassrls AND NOT rolsuper AND rolname NOT LIKE 'pg\_%'
  `);
  const appRoles = bypass
    .map((row) => row.rolname as string)
    .filter((name) => name.startsWith("anari"));
  if (appRoles.length > 0) {
    console.error(`BYPASSRLS roles on app roles: ${appRoles.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("Role audit OK: no anari_* role has BYPASSRLS.");
  }
} finally {
  await pool.end();
}
