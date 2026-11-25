/**
 * Ticketing 工作项路由（114）。
 *
 * 只做“来源 → 规范工作项”的导入与读取；状态历史由导入逻辑按 append-only
 * 追加，路由层不提供“改历史”的入口。
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { WorkItemPort } from "../../store-ports.js";
import { importWorkItemSchema } from "@anari/contracts";
import {
  data,
  idOf,
  parse,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";

export function registerWorkItemRoutes(deps: {
  platformStore: WorkItemPort;
}): FastifyPluginAsync {
  const { platformStore } = deps;
  return async (app: FastifyInstance) => {
    // 来源感知 upsert：201 新建 / 200 更新；payload 携带 events/contributions。
    app.post("/api/v1/work-items/import", async (request, reply) => {
      requireRoles(request, "admin", "integration");
      const body = parse(importWorkItemSchema, request.body);
      const result = await platformStore.importWorkItem({
        tenantId: tenantOf(request),
        ...body,
      });
      return reply
        .status(result.created ? 201 : 200)
        .send(data(result, request));
    });

    app.get("/api/v1/work-items", async (request) => {
      requireRoles(request, "manager", "finance", "integration");
      const query = request.query as {
        projectId?: string;
        personId?: string;
      };
      return data(
        await platformStore.listWorkItems(tenantOf(request), {
          projectId: query.projectId,
          personId: query.personId,
        }),
        request,
      );
    });

    // 状态历史与多人贡献的追溯视图（append-only，只读）。
    app.get("/api/v1/work-items/:id", async (request) => {
      requireRoles(request, "manager", "finance", "integration");
      return data(
        await platformStore.getWorkItem(tenantOf(request), idOf(request)),
        request,
      );
    });
  };
}
