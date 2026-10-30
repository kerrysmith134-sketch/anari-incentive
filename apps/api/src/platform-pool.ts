import { Pool } from "pg";

/**
 * Dedicated pool for platform/master-data queries.
 *
 * Governance tables use RLS with `app.tenant_id` for tenant-scoped access and
 * `app.platform_admin` for the platform administration path. Keeping this on
 * a separate pool prevents the platform session setting from leaking into the
 * tenant-scoped `PgStore` pool.
 */
export function createPlatformPool(connectionString?: string): Pool {
  return new Pool({
    ...(connectionString ? { connectionString } : {}),
    options: "-c app.platform_admin=on",
  });
}
