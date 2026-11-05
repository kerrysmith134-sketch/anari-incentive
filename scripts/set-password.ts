/**
 * 账号初始化 / 重置密码 CLI。
 *
 *   DATABASE_URL=... npm run user:password -- --email hr@acme.com --password 'S3cret!'
 *
 * 可选参数：
 *   --tenant <uuid>   指定租户（默认 SEED 租户）
 *   --role admin      创建时授予的角色（默认 admin，仅对新账号生效）
 *   --name "张三"     显示名（默认取邮箱前缀）
 *   --create-person   （默认开启）同时创建人员档案并绑定
 *
 * 已有用户仅设置/重置密码，不改变其角色与会话之外的任何状态。
 */
import { Pool } from "pg";
import { PgPlatformStore } from "../apps/api/src/platform-store.js";
import { hashPassword } from "../apps/api/src/password.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const email = arg("email");
const password = arg("password");
const databaseUrl = process.env.DATABASE_URL;

if (!email || !password) {
  console.error("用法: npm run user:password -- --email <邮箱> --password <密码>");
  process.exit(1);
}
if (!databaseUrl) {
  console.error("需要 DATABASE_URL 环境变量（PostgreSQL 部署）");
  process.exit(1);
}
if (password.length < 8) {
  console.error("密码至少 8 位");
  process.exit(1);
}

const tenantId =
  arg("tenant") ??
  process.env.DEFAULT_TENANT_ID ??
  "00000000-0000-4000-8000-000000000001";
const role = arg("role") ?? "admin";
const displayName = arg("name") ?? email.split("@")[0] ?? email;

const pool = new Pool({ connectionString: databaseUrl });
const store = new PgPlatformStore(pool);

try {
  const existing = await store.findUserByAuthSubject(email);
  let user = existing;
  if (!user) {
    user = await store.createUser({ authSubject: email, displayName, email });
    await store.addMembership({
      tenantId,
      userId: user.id,
      roleCodes: [role],
    });
    console.log(`已创建用户 ${email}（角色：${role}，租户：${tenantId}）`);
  } else {
    console.log(`用户已存在：${email}，仅重置密码，角色保持不变`);
  }
  await store.setUserPassword(user.id, hashPassword(password));

  const person = (await store.listPersons(tenantId)).find(
    (candidate) => candidate.userId === user!.id,
  );
  if (!person) {
    const created = await store.createPerson({
      tenantId,
      employeeCode: `EMP-${email.split("@")[0]?.slice(0, 8).toUpperCase()}`,
      displayName,
      userId: user.id,
    });
    console.log(`已创建并绑定人员档案：${created.id}`);
  }
  console.log("✅ 密码已设置：可用「账号密码登录」进入控制台");
} finally {
  await pool.end();
}
