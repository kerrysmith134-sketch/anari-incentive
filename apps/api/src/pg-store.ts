/**
 * PgStore — PostgreSQL 版 IncentiveStore 的入口。
 *
 * 行为保持型重构：原先 4,836 行的单类实现按领域拆到 `./pg-store/*`，
 * 本文件只做组合与 re-export。`PgStore` 的对外方法集合、构造签名
 * `(pool, tenantId?)`、SQL、事务边界、错误映射与审计顺序与拆分前一致。
 *
 * 领域层顺序（基类 → 顶层）：
 *   base → audit → ledger → policy → work-package → evidence → claims →
 *   attribution → contribution → assessment → calculation → settlement →
 *   appeals → evaluation → measurement → notifications → data-quality → agent
 */

import type { Pool } from "pg";
import { PgStoreAgent } from "./pg-store/agent.js";
import { DEMO_TENANT_ID } from "./pg-store-support.js";
import type { IncentiveStore } from "./store-interface.js";

export { DEMO_REQUESTER_ID, DEMO_TENANT_ID } from "./pg-store-support.js";

export class PgStore extends PgStoreAgent implements IncentiveStore {
  constructor(pool: Pool, tenantId: string = DEMO_TENANT_ID) {
    super(pool, tenantId);
  }
}
