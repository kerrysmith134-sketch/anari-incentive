import { Pool } from "pg";

/**
 * Dedicated pool for platform/master-data queries.
 *
 * NPV2-002（S1 退役）：本池不再携带连接级 `app.platform_admin=on`——
 * 连接是普通身份，受 RLS 约束。平台管理提升改为**事务本地**显式设置
 * （见 PgPlatformStoreBase.transaction：BEGIN 内 set_config(..., true)，
 * 提交/回滚即失效），满足"显式、短时、可审计"，且不会跨事务泄漏。
 */
export function createPlatformPool(connectionString?: string): Pool {
  return new Pool({
    ...(connectionString ? { connectionString } : {}),
  });
}
