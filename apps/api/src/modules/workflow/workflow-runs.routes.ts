/**
 * 工作流运行域路由（受限工作流的运行记录）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import {
  createWorkflowRunSchema,
  finishWorkflowRunSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
} from "../../http-helpers.js";

export function registerWorkflowRunRoutes(deps: {
  platformStore: PlatformStore;
}): FastifyPluginAsync {
  const { platformStore } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/workflow-runs", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createWorkflowRunSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createWorkflowRun({
          tenantId: tenantOf(request),
          agentTaskId: body.agentTaskId,
          workflowName: body.workflowName,
          workflowVersion: body.workflowVersion,
          status: body.status,
          currentStep: body.currentStep,
          state: body.state ?? {},
          startedAt: body.startedAt,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/workflow-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { agentTaskId?: string };
    return data(
      await platformStore.listWorkflowRuns(
        tenantOf(request),
        query.agentTaskId,
      ),
      request,
    );
  });

  app.post("/api/v1/workflow-runs/:id/finish", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(finishWorkflowRunSchema, request.body);
    return data(
      await platformStore.finishWorkflowRun({
        tenantId: tenantOf(request),
        workflowRunId: idOf(request),
        status: body.status,
        currentStep: body.currentStep,
      }),
      request,
    );
  });
  };
}
