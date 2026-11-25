/**
 * 确定性 Agent 辅助路由（不调用外部 LLM）。
 *
 * 三个端点都只做纯函数计算：不写库、不写审计、不发通知。请求体全部经
 * Zod 契约校验；错误由 app 的统一错误处理器映射为 400 VALIDATION_ERROR。
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  mappingSuggestionsRequestSchema,
  reconciliationExplainRequestSchema,
  syncAnomaliesRequestSchema,
} from "@anari/contracts";
import { data, parse, requireRoles } from "../../http-helpers.js";
import {
  detectSyncAnomalies,
  explainReconciliation,
  suggestFieldMappings,
} from "../../agent-assist.js";

export function registerAgentAssistRoutes(): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    // 集成映射建议：只读样例、不执行写入。
    app.post("/api/v1/agent-assist/mapping-suggestions", async (request) => {
      requireRoles(request, "manager", "integration");
      const body = parse(mappingSuggestionsRequestSchema, request.body);
      return data(
        suggestFieldMappings({
          targetType: body.targetType,
          sample: body.sample,
        }),
        request,
      );
    });

    // 同步异常诊断：给定运行计数，返回规则化诊断。
    app.post("/api/v1/agent-assist/sync-anomalies", async (request) => {
      requireRoles(request, "manager", "integration");
      const body = parse(syncAnomaliesRequestSchema, request.body);
      return data(detectSyncAnomalies({ runs: body.runs }), request);
    });

    // 对账差异解释：财务读权限；只解释，不生成调整分录。
    app.post("/api/v1/agent-assist/reconciliation-explain", async (request) => {
      requireRoles(request, "manager", "finance");
      const body = parse(reconciliationExplainRequestSchema, request.body);
      return data(explainReconciliation({ rows: body.rows }), request);
    });
  };
}
