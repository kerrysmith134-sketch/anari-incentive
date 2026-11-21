/**
 * NP-033（2026-11-21 审计 Wave 5）：Integration Platform V2 资源同步域
 * 的 PG 契约对等测试——Memory 与 PG 双实现的 SyncResource/Checkpoint/
 * Quarantine/ExternalObjectIdentity/WebhookRoutingKey 生命周期一致。
 *
 * 与 store-contract.test.ts 同模式：describePg 门控（DATABASE_URL 存在才跑，
 * test:pg.sh 建容器后执行）；契约租户独立于演示租户，避免清扫耦合。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { PgPlatformStore } from "../platform-store.js";
import { MemoryPlatformStore } from "../platform-store.js";

const databaseUrl = process.env.DATABASE_URL;
const describePg = databaseUrl ? describe : describe.skip;

const CONTRACT_TENANT_ID = "00000000-0000-4000-8000-00000000d1a2";
const ADMIN = "00000000-0000-4000-8000-00000000c801";
/** NP-027 生命周期测试专用人员（独立于 store-contract 的 c801，避免跨租户 ON CONFLICT 跳过）。 */
const LIFECYCLE_PERSON = "00000000-0000-4000-8000-00000000d201";

describePg("NP-033: IntegrationPort 资源同步域 PG 契约", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    // 契约租户 + 契约人员（幂等；身份生命周期 unlinked_by 复合 FK 需要）。
    await pool.query(
      `INSERT INTO tenants (id, name, slug)
       VALUES ($1, 'NP033 Contract Tenant', 'np033-contract')
       ON CONFLICT (id) DO NOTHING`,
      [CONTRACT_TENANT_ID],
    );
    // people 有 RLS：必须带租户上下文插入（anari_app 无上下文直插被拒）。
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        CONTRACT_TENANT_ID,
      ]);
      await client.query(
        `INSERT INTO people (id, tenant_id, employee_code, display_name)
         VALUES ($1, $2, 'NP033-C1', '契约操作员')
         ON CONFLICT (id) DO NOTHING`,
        [LIFECYCLE_PERSON, CONTRACT_TENANT_ID],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  async function withTenantContext<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        CONTRACT_TENANT_ID,
      ]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function seedConnection(
    store: PgPlatformStore,
  ): Promise<{ connectionId: string; mappingId: string }> {
    const connection = await store.createIntegrationConnection({
      tenantId: CONTRACT_TENANT_ID,
      provider: "generic",
      connectionName: `np033-${randomUUID().slice(0, 8)}`,
      credentialRef: "vault/np033",
      config: { url: "https://provider.example" },
    });
    const mapping = await store.createIntegrationMapping({
      tenantId: CONTRACT_TENANT_ID,
      connectionId: connection.id,
      name: `np033-mapping-${randomUUID().slice(0, 8)}`,
      mappingType: "HTTP_JSON",
      sourceSystem: "np033-system",
      targetType: "FINANCIAL_FACT",
      fieldMap: {
        sourceRecordId: "id",
        eventType: "event_type",
        subjectType: "subject_type",
        subjectId: "subject_id",
        evidenceType: "GROSS_PROFIT",
      },
      config: {},
      version: 1,
    });
    return { connectionId: connection.id, mappingId: mapping.id };
  }

  it("SyncResource：创建/列表/重复 409/跨租户隔离", async () => {
    const store = new PgPlatformStore(pool);
    const { connectionId } = await seedConnection(store);
    const resource = await store.createSyncResource({
      tenantId: CONTRACT_TENANT_ID,
      connectionId,
      resourceKey: "mapping-a",
      mappingId: undefined,
    });
    expect(resource.status).toBe("ACTIVE");
    await expect(
      store.createSyncResource({
        tenantId: CONTRACT_TENANT_ID,
        connectionId,
        resourceKey: "mapping-a",
      }),
    ).rejects.toThrow(/SYNC_RESOURCE_EXISTS/);
    const list = await store.listSyncResources(CONTRACT_TENANT_ID, connectionId);
    expect(list.map((entry) => entry.resourceKey)).toContain("mapping-a");
    // 跨租户：其他租户（先建租户记录）查询为空。
    const otherTenant = "00000000-0000-4000-8000-00000000d1b2";
    await pool.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'NP033 B', 'np033-b')
       ON CONFLICT (id) DO NOTHING`,
      [otherTenant],
    );
    const foreignList = await store.listSyncResources(otherTenant, connectionId);
    expect(foreignList).toHaveLength(0);
  });

  it("Checkpoint：默认空 → 保存 → 回读（游标/lastRunId）", async () => {
    const store = new PgPlatformStore(pool);
    const { connectionId } = await seedConnection(store);
    const resource = await store.createSyncResource({
      tenantId: CONTRACT_TENANT_ID,
      connectionId,
      resourceKey: "mapping-cp",
    });
    const fresh = await store.getSyncCheckpoint(CONTRACT_TENANT_ID, resource.id);
    expect(fresh).toBeNull();
    const run = await store.createSyncRun({
      tenantId: CONTRACT_TENANT_ID,
      connectionId,
      status: "QUEUED",
    });
    const saved = await store.saveSyncCheckpoint({
      tenantId: CONTRACT_TENANT_ID,
      resourceId: resource.id,
      cursor: "cursor-7",
      lastRunId: run.id,
    });
    expect(saved.cursor).toBe("cursor-7");
    expect(saved.lastRunId).toBe(run.id);
    const reread = await store.getSyncCheckpoint(CONTRACT_TENANT_ID, resource.id);
    expect(reread?.cursor).toBe("cursor-7");
    // 幂等更新：再次保存覆盖游标。
    await store.saveSyncCheckpoint({
      tenantId: CONTRACT_TENANT_ID,
      resourceId: resource.id,
      cursor: "cursor-8",
      lastRunId: run.id,
    });
    const updated = await store.getSyncCheckpoint(CONTRACT_TENANT_ID, resource.id);
    expect(updated?.cursor).toBe("cursor-8");
  });

  it("Quarantine：写入/幂等 upsert/未解决过滤", async () => {
    const store = new PgPlatformStore(pool);
    const first = await store.recordQuarantineRecord({
      tenantId: CONTRACT_TENANT_ID,
      sourceSystem: "np033-system",
      externalRecordId: "Q-1",
      reason: "INVALID_CURRENCY",
      payload: { raw: { currency: "us$" } },
    });
    expect(first.reason).toBe("INVALID_CURRENCY");
    const second = await store.recordQuarantineRecord({
      tenantId: CONTRACT_TENANT_ID,
      sourceSystem: "np033-system",
      externalRecordId: "Q-1",
      reason: "SCHEMA_MISMATCH",
      payload: { raw: { currency: "" } },
    });
    expect(second.id).toBe(first.id);
    expect(second.reason).toBe("SCHEMA_MISMATCH");
    const list = await store.listQuarantineRecords(CONTRACT_TENANT_ID, {
      sourceSystem: "np033-system",
      unresolvedOnly: true,
    });
    expect(list.some((entry) => entry.id === first.id)).toBe(true);
  });

  it("ExternalObjectIdentity：注册/解析/未解析 null", async () => {
    const store = new PgPlatformStore(pool);
    const internalId = randomUUID();
    await store.upsertExternalObject({
      tenantId: CONTRACT_TENANT_ID,
      sourceSystem: "np033-system",
      externalObjectType: "ORDER",
      externalObjectId: "EXT-77",
      internalObjectType: "ORDER",
      internalObjectId: internalId,
      matchRule: "MANUAL",
    });
    const resolved = await store.resolveExternalObject(
      CONTRACT_TENANT_ID,
      "np033-system",
      "ORDER",
      "EXT-77",
    );
    expect(resolved?.internalObjectId).toBe(internalId);
    const missing = await store.resolveExternalObject(
      CONTRACT_TENANT_ID,
      "np033-system",
      "ORDER",
      "EXT-MISSING",
    );
    expect(missing).toBeNull();
  });

  it("WebhookRoutingKey：签发幂等 + 解析回连接；原始载荷加密落库", async () => {
    const store = new PgPlatformStore(pool);
    const { connectionId } = await seedConnection(store);
    const issued = await store.issueWebhookRoutingKey({
      tenantId: CONTRACT_TENANT_ID,
      connectionId,
    });
    const again = await store.issueWebhookRoutingKey({
      tenantId: CONTRACT_TENANT_ID,
      connectionId,
    });
    expect(again.routingKey).toBe(issued.routingKey);
    const resolved = await store.resolveWebhookRoutingKey(issued.routingKey);
    expect(resolved?.tenantId).toBe(CONTRACT_TENANT_ID);
    expect(resolved?.connectionId).toBe(connectionId);
    // 原始载荷收件 + messageId 幂等。
    const message = await store.receiveIntegrationWebhook({
      tenantId: CONTRACT_TENANT_ID,
      sourceSystem: "generic",
      messageId: `MSG-${randomUUID()}`,
      payloadHash: "deadbeef",
      rawPayloadEncrypted: "v1:aa:bb:cc",
    });
    expect(message.rawPayloadEncrypted).toBe("v1:aa:bb:cc");
    const duplicate = await store.receiveIntegrationWebhook({
      tenantId: CONTRACT_TENANT_ID,
      sourceSystem: "generic",
      messageId: message.messageId,
      payloadHash: "deadbeef",
      rawPayloadEncrypted: "v1:aa:bb:dd",
    });
    expect(duplicate.id).toBe(message.id);
  });

  it("RLS：无租户上下文直读 sync_resources 为空（FORCE RLS 负向）", async () => {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS count FROM sync_resources WHERE tenant_id=$1",
      [CONTRACT_TENANT_ID],
    );
    // anari_app 连接无上下文 → RLS 拦截 → 0 行（不是报错也不是泄漏）。
    expect(rows[0]?.count).toBe(0);
  });

  it("跨租户复合 FK：映射指向其他租户连接在 DB 层被拒", async () => {
    const otherTenant = "00000000-0000-4000-8000-00000000d1b2";
    const store = new PgPlatformStore(pool);
    const { connectionId } = await seedConnection(store);
    // 其他租户的 mapping 引用本租户 connection（composite FK tenant_id+id）→ 拒。
    await pool.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'NP033 B', 'np033-b')
       ON CONFLICT (id) DO NOTHING`,
      [otherTenant],
    );
    await expect(
      withTenantContext(async (client) => {
        await client.query(
          `INSERT INTO integration_mappings
             (id, tenant_id, connection_id, name, mapping_type, source_system, target_type, field_map, config, version)
           VALUES ($1, $2, $3, 'bad', 'HTTP_JSON', 'np033-system', 'EVIDENCE', '{}', '{}', 1)`,
          [randomUUID(), otherTenant, connectionId],
        );
      }),
    ).rejects.toThrow();
    void store;
  });

  it("NP-020 raw landing：落地/密文存取/重放标记（append-only）", async () => {
    const store = new PgPlatformStore(pool);
    const record = await store.appendRawSourceRecord({
      tenantId: CONTRACT_TENANT_ID,
      sourceSystem: "np033-system",
      externalRecordId: "RAW-1",
      payloadEncrypted: "v1:aa:bb:cc",
      mappingVersion: 2,
      retentionClass: "FINANCIAL",
    });
    expect(record.payloadEncrypted).toBe("v1:aa:bb:cc");
    expect(record.retentionClass).toBe("FINANCIAL");
    const fetched = await store.getRawSourceRecord(CONTRACT_TENANT_ID, record.id);
    expect(fetched.mappingVersion).toBe(2);
    const marked = await store.markRawSourceRecordReplayed(CONTRACT_TENANT_ID, record.id);
    expect(marked.replayedAt).toBeTruthy();
    const replayedList = await store.listRawSourceRecords(CONTRACT_TENANT_ID, {
      sourceSystem: "np033-system",
      replayedOnly: true,
    });
    expect(replayedList.some((entry) => entry.id === record.id)).toBe(true);
    // append-only：DELETE 被 DB 触发器拒绝。
    await expect(
      withTenantContext(async (client) => {
        await client.query("DELETE FROM raw_source_records WHERE id=$1", [record.id]);
      }),
    ).rejects.toThrow(/APPEND_ONLY/);
    // 经济列冻结：改 payload 被拒。
    await expect(
      withTenantContext(async (client) => {
        await client.query(
          "UPDATE raw_source_records SET payload_encrypted=$2 WHERE id=$1",
          [record.id, "v1:xx"],
        );
      }),
    ).rejects.toThrow(/IMMUTABLE/);
  });

  it("NP-021 资源级租约：token 递增/持有期内 409/stale fencing 拒绝", async () => {
    const store = new PgPlatformStore(pool);
    const { connectionId } = await seedConnection(store);
    const resource = await store.createSyncResource({
      tenantId: CONTRACT_TENANT_ID,
      connectionId,
      resourceKey: "lease-pg",
    });
    const first = await store.claimResourceSyncLease({
      tenantId: CONTRACT_TENANT_ID,
      resourceId: resource.id,
      leaseOwner: "worker-a",
      leaseSeconds: 300,
    });
    expect(first.fencingToken).toBeGreaterThanOrEqual(1);
    await expect(
      store.claimResourceSyncLease({
        tenantId: CONTRACT_TENANT_ID,
        resourceId: resource.id,
        leaseOwner: "worker-b",
        leaseSeconds: 300,
      }),
    ).rejects.toThrow(/RESOURCE_LEASED/);
    // stale fencing release 被拒。
    await expect(
      store.releaseResourceSyncLease({
        tenantId: CONTRACT_TENANT_ID,
        resourceId: resource.id,
        leaseOwner: "worker-b",
        fencingToken: first.fencingToken,
      }),
    ).rejects.toThrow(/RESOURCE_LEASE_STALE/);
    await store.releaseResourceSyncLease({
      tenantId: CONTRACT_TENANT_ID,
      resourceId: resource.id,
      leaseOwner: "worker-a",
      fencingToken: first.fencingToken,
    });
    const second = await store.claimResourceSyncLease({
      tenantId: CONTRACT_TENANT_ID,
      resourceId: resource.id,
      leaseOwner: "worker-b",
      leaseSeconds: 300,
    });
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken);
  });

  it("NP-027 身份生命周期：merge 并入/unlink 终止/历史可查", async () => {
    const store = new PgPlatformStore(pool);
    const internalA = randomUUID();
    const internalB = randomUUID();
    await store.upsertExternalObject({
      tenantId: CONTRACT_TENANT_ID,
      sourceSystem: "np033-system",
      externalObjectType: "ORDER",
      externalObjectId: "LC-1",
      internalObjectType: "ORDER",
      internalObjectId: internalA,
      matchRule: "MANUAL",
    });
    await store.upsertExternalObject({
      tenantId: CONTRACT_TENANT_ID,
      sourceSystem: "np033-system",
      externalObjectType: "ORDER",
      externalObjectId: "LC-2",
      internalObjectType: "ORDER",
      internalObjectId: internalB,
      matchRule: "MANUAL",
    });
    const merged = await store.mergeExternalObjects({
      tenantId: CONTRACT_TENANT_ID,
      sourceSystem: "np033-system",
      externalObjectType: "ORDER",
      keepExternalObjectId: "LC-1",
      mergeExternalObjectIds: ["LC-2"],
      actorPersonId: LIFECYCLE_PERSON,
    });
    expect(merged).toEqual({ merged: 1, internalObjectId: internalA });
    const resolved = await store.resolveExternalObject(
      CONTRACT_TENANT_ID,
      "np033-system",
      "ORDER",
      "LC-2",
    );
    expect(resolved?.internalObjectId).toBe(internalA);
    const unlinked = await store.unlinkExternalObject({
      tenantId: CONTRACT_TENANT_ID,
      sourceSystem: "np033-system",
      externalObjectType: "ORDER",
      externalObjectId: "LC-2",
      reason: "WRONG_MAPPING",
      actorPersonId: LIFECYCLE_PERSON,
    });
    expect(unlinked.unlinkReason).toBe("WRONG_MAPPING");
    expect(unlinked.validTo).toBeTruthy();
    const gone = await store.resolveExternalObject(
      CONTRACT_TENANT_ID,
      "np033-system",
      "ORDER",
      "LC-2",
    );
    expect(gone).toBeNull();
    const history = await store.listExternalObjects(CONTRACT_TENANT_ID, {
      sourceSystem: "np033-system",
      includeUnlinked: true,
    });
    const row = history.find((entry) => entry.externalObjectId === "LC-2");
    expect(row?.unlinkReason).toBe("WRONG_MAPPING");
  });

  it("Memory/PG 契约对等：同一套生命周期在 Memory 实现上表现一致", async () => {
    const memory = new MemoryPlatformStore({
      demoTenant: { id: CONTRACT_TENANT_ID, name: "np033-mem", slug: "np033-mem" },
    });
    const connectionId = await (async () => {
      const connection = await memory.createIntegrationConnection({
        tenantId: CONTRACT_TENANT_ID,
        provider: "generic",
        connectionName: "np033-mem-conn",
        credentialRef: "vault/np033",
        config: { url: "https://provider.example" },
      });
      await memory.createIntegrationMapping({
        tenantId: CONTRACT_TENANT_ID,
        connectionId: connection.id,
        name: "np033-mem-mapping",
        mappingType: "HTTP_JSON",
        sourceSystem: "np033-system",
        targetType: "FINANCIAL_FACT",
        fieldMap: {
          sourceRecordId: "id",
          eventType: "event_type",
          subjectType: "subject_type",
          subjectId: "subject_id",
          evidenceType: "GROSS_PROFIT",
        },
        config: {},
        version: 1,
      });
      return connection.id;
    })();
    const resource = await memory.createSyncResource({
      tenantId: CONTRACT_TENANT_ID,
      connectionId,
      resourceKey: "mapping-a",
    });
    await expect(
      memory.createSyncResource({
        tenantId: CONTRACT_TENANT_ID,
        connectionId,
        resourceKey: "mapping-a",
      }),
    ).rejects.toThrow(/SYNC_RESOURCE_EXISTS/);
    await memory.saveSyncCheckpoint({
      tenantId: CONTRACT_TENANT_ID,
      resourceId: resource.id,
      cursor: "cursor-7",
    });
    expect(
      (await memory.getSyncCheckpoint(CONTRACT_TENANT_ID, resource.id))?.cursor,
    ).toBe("cursor-7");
  });
});
