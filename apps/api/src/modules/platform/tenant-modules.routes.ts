/**
 * 租户模块 capability 开关（AUD-017 / D-04）。
 *
 * GET /api/v1/tenant-modules —— 当前租户已启用模块（前端导航同步用）。
 * PUT /api/v1/platform/tenants/:id/modules —— 平台管理员显式开启/关闭扩展域
 * （薪酬含个税/股权/计费/战略池）；缺省 = P0-only；变更写审计事件。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { NotFoundError } from "../../store.js";
import { TENANT_MODULE_KEYS, updateTenantModulesSchema } from "@anari/contracts";
import {
  data,
  idOf,
  parse,
  requireRoles,
  requireTenantMember,
  tenantModulesOf,
  tenantOf,
} from "../../http-helpers.js";

export function registerTenantModuleRoutes(deps: {
  platformStore: PlatformStore;
  storeFor: (request: FastifyRequest) => IncentiveStore;
}): FastifyPluginAsync {
  const { platformStore, storeFor } = deps;
  return async (app: FastifyInstance) => {
    app.get("/api/v1/tenant-modules", async (request) => {
      await requireTenantMember(request, tenantOf(request));
      return data(
        {
          modules: await tenantModulesOf(request, platformStore),
          available: TENANT_MODULE_KEYS,
          note:
            "P0 核心域始终启用；扩展域（PAYROLL/EQUITY/BILLING/STRATEGIC_POOL）" +
            "由平台管理员按租户显式开启（D-04），变更留审计。",
        },
        request,
      );
    });

    app.put("/api/v1/platform/tenants/:id/modules", async (request, reply) => {
      requireRoles(request, "admin");
      const body = parse(updateTenantModulesSchema, request.body);
      const tenantId = idOf(request);
      const before = await platformStore.getTenant(tenantId);
      const beforeModules = Array.isArray(
        (before.settings as { modules?: unknown } | undefined)?.modules,
      )
        ? ((before.settings as { modules: string[] }).modules)
        : [];
      const deduped = [...new Set(body.modules)];
      const updated = await platformStore.updateTenantSettings({
        tenantId,
        settings: { modules: deduped },
      });
      // AUD-017：开关变更必须留审计（前后状态可追溯）。
      await storeFor(request).recordAuditEvent({
        actorType: "USER",
        actorId: request.authContext?.userId,
        action: "TENANT_MODULE_FLAGS_UPDATED",
        objectType: "TENANT",
        objectId: tenantId,
        reason: `modules: [${beforeModules.join(",")}] -> [${deduped.join(",")}]`,
      });
      return reply.status(200).send(
        data(
          {
            tenantId,
            modules: (updated.settings as { modules?: string[] }).modules ?? [],
          },
          request,
        ),
      );
    });

    void NotFoundError;
  };
}
