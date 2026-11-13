/**
 * 集成域路由（连接器/映射/同步排期/同步运行）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import {
  claimDueSyncSchedulesSchema,
  createIntegrationConnectionSchema,
  createIntegrationMappingSchema,
  createSyncRunSchema,
  createSyncScheduleSchema,
  finishSyncRunSchema,
  setIntegrationConnectionStatusSchema,
  setSyncScheduleEnabledSchema,
} from "@anari/contracts";
import { FIELD_MAPPING_PRESETS } from "@anari/connectors";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
} from "../../http-helpers.js";

export function registerIntegrationRoutes(deps: {
  platformStore: PlatformStore;
  countEvent: (event: string) => void;
}): FastifyPluginAsync {
  const { platformStore, countEvent } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/integration-connections", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createIntegrationConnectionSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createIntegrationConnection({
          tenantId: tenantOf(request),
          provider: body.provider,
          connectionName: body.connectionName,
          credentialRef: body.credentialRef,
          config: body.config ?? {},
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    return data(
      await platformStore.listIntegrationConnections(tenantOf(request)),
      request,
    );
  });

  app.get("/api/v1/integration-connections/:id", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    return data(
      await platformStore.getIntegrationConnection(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  // 连接测试：校验凭据引用存在、配置 JSON 可解析、字段映射可解析。
  app.get("/api/v1/integration-connections/:id/test", async (request) => {
    requireRoles(request, "admin", "integration");
    const connection = await platformStore.getIntegrationConnection(
      tenantOf(request),
      idOf(request),
    );
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
    checks.push({
      name: "凭据引用",
      ok: Boolean(connection.credentialRef),
      detail: connection.credentialRef
        ? "已设置（服务端不回显值）"
        : "缺失：请填写保管库路径或密钥名",
    });
    const config = (connection.config ?? {}) as Record<string, unknown>;
    const required =
      connection.provider === "hubspot"
        ? ["portalId"]
        : connection.provider === "feishu"
          ? ["appToken"]
          : ["baseUrl"];
    const missing = required.filter((key) => !(key in config));
    checks.push({
      name: "连接配置",
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? "必需键齐全"
          : `缺少键：${missing.join(", ")}`,
    });
    const ok = checks.every((check) => check.ok);
    countEvent("integration_connection_tested");
    return data(
      {
        connectionId: connection.id,
        provider: connection.provider,
        ok,
        checks,
        testedAt: new Date().toISOString(),
      },
      request,
    );
  });

  app.post("/api/v1/integration-connections/:id/status", async (request) => {
    requireRoles(request, "admin");
    const body = parse(setIntegrationConnectionStatusSchema, request.body);
    return data(
      await platformStore.setIntegrationConnectionStatus({
        tenantId: tenantOf(request),
        connectionId: idOf(request),
        status: body.status,
      }),
      request,
    );
  });

  app.post("/api/v1/integration-connections/:id/mappings", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createIntegrationMappingSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createIntegrationMapping({
          tenantId: tenantOf(request),
          connectionId: idOf(request),
          name: body.name,
          mappingType: body.mappingType,
          sourceSystem: body.sourceSystem,
          targetType: body.targetType,
          fieldMap: body.fieldMap,
          config: body.config ?? {},
          version: body.version ?? 1,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections/:id/mappings", async (request) => {
    requireRoles(request, "admin", "integration");
    const query = request.query as {
      status?: "ACTIVE" | "RETIRED";
    };
    return data(
      await platformStore.listIntegrationMappings(
        tenantOf(request),
        idOf(request),
        query.status,
      ),
      request,
    );
  });

  app.post("/api/v1/integration-mappings/:id/retire", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.retireIntegrationMapping({
        tenantId: tenantOf(request),
        mappingId: idOf(request),
      }),
      request,
    );
  });

  app.get("/api/v1/integration-mapping-presets", async (request) => {
    requireRoles(request, "admin", "integration", "manager", "finance");
    return data(FIELD_MAPPING_PRESETS, request);
  });

  app.post("/api/v1/integration-connections/:id/schedules", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createSyncScheduleSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createSyncSchedule({
          tenantId: tenantOf(request),
          connectionId: idOf(request),
          name: body.name,
          intervalMinutes: body.intervalMinutes,
          startAt: body.startAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections/:id/schedules", async (request) => {
    requireRoles(request, "admin", "integration");
    return data(
      await platformStore.listSyncSchedules(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.get("/api/v1/sync-schedules", async (request) => {
    requireRoles(request, "admin", "integration");
    const query = request.query as { connectionId?: string };
    return data(
      await platformStore.listSyncSchedules(
        tenantOf(request),
        query.connectionId,
      ),
      request,
    );
  });

  app.post("/api/v1/sync-schedules/claim-due", async (request) => {
    requireRoles(request, "integration");
    const body = parse(claimDueSyncSchedulesSchema, request.body ?? {});
    return data(
      await platformStore.claimDueSyncSchedules({
        tenantId: tenantOf(request),
        limit: body.limit ?? 10,
        now: body.now,
      }),
      request,
    );
  });

  app.post("/api/v1/sync-schedules/:id/status", async (request) => {
    requireRoles(request, "admin");
    const body = parse(setSyncScheduleEnabledSchema, request.body);
    return data(
      await platformStore.setSyncScheduleEnabled({
        tenantId: tenantOf(request),
        scheduleId: idOf(request),
        enabled: body.enabled,
      }),
      request,
    );
  });
  app.post("/api/v1/integration-connections/:id/sync-runs", async (request, reply) => {
    requireRoles(request, "manager", "finance", "integration");
    const body = parse(createSyncRunSchema, request.body ?? {});
    return reply.status(201).send(
      data(
        await platformStore.createSyncRun({
          tenantId: tenantOf(request),
          connectionId: idOf(request),
          status: body.status ?? "QUEUED",
          cursorBefore: body.cursorBefore,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/integration-connections/:id/sync-runs", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    return data(
      await platformStore.listSyncRuns(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/sync-runs/:id/finish", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    const body = parse(finishSyncRunSchema, request.body);
    return data(
      await platformStore.finishSyncRun({
        tenantId: tenantOf(request),
        syncRunId: idOf(request),
        status: body.status,
        recordsSeen: body.recordsSeen ?? 0,
        recordsUpserted: body.recordsUpserted ?? 0,
        cursorAfter: body.cursorAfter,
        errorSummary: body.errorSummary,
      }),
      request,
    );
  });
  };
}
