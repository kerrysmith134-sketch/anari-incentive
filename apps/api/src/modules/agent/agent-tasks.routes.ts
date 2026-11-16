/**
 * Agent 域路由（任务/聊天/命令/收件箱）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { ForbiddenError } from "@anari/auth";
import type { AgentRuntime, AgentStepRepository } from "@anari/agent-runtime";
import { llmChatComplete, extractJson, type LlmMessage } from "../../llm.js";
import { notifyBestEffort } from "../../notify.js";
import type { ApprovalPort, ModelgovPort,
  TenantPort,
} from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import {
  agentChatSchema,
  agentCommandSchema,
  approveAgentActionSchema,
  enqueueAgentTaskSchema,
  rejectAgentActionSchema,
  scanAgentTasksSchema,
  upsertAgentTodoSchema,
} from "@anari/contracts";
import {
  data,
  errorBody,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  personFilter,
  policyBody,
  requireActorRequired,
  isPrivileged,
  ownPersonId,} from "../../http-helpers.js";
import { assertModelProviderPolicy } from "../../model-policy.js";

/** 与 app.ts 中的 BadRequestError 同语义（协议层 400）。 */
class BadRequestError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}



/** Parameters the model may pass per command; everything else is dropped. */
const AGENT_CHAT_PARAM_KEYS: Record<string, string[]> = {
  check_settlement_readiness: ["runId"],
  check_appeal_sla: [],
  propose_policy_change: [],
  scan_evidence_gaps: [],
  scan_contribution_anomalies: [],
  scan_data_quality: [],
  run_cycle_pre_review: [],
  draft_evaluations: [],
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * The command name is already whitelisted; the payload must be too. Without
 * this the model could hand the POLICY_PROPOSAL skill an attacker-authored
 * policy body and samples.
 */
export function sanitizeAgentChatParams(
  command: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set([
    "idempotencyKey",
    ...(AGENT_CHAT_PARAM_KEYS[command] ?? []),
  ]);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!allowed.has(key)) continue;
    if (key === "runId" && (typeof value !== "string" || !UUID_PATTERN.test(value))) {
      continue;
    }
    if (key === "idempotencyKey" && typeof value !== "string") continue;
    clean[key] = value;
  }
  return clean;
}
const AGENT_COMMANDS: Record<
    string,
    { agentType: Parameters<AgentRuntime["enqueue"]>[0]["agentType"]; input?: (params: Record<string, unknown>) => Record<string, unknown> }
  > = {
    scan_evidence_gaps: { agentType: "EVIDENCE_GAP" },
    scan_contribution_anomalies: { agentType: "CONTRIBUTION_ANOMALY" },
    scan_data_quality: { agentType: "DATA_QUALITY" },
    check_settlement_readiness: {
      agentType: "SETTLEMENT_READINESS",
      input: (params) => params,
    },
    run_cycle_pre_review: { agentType: "CYCLE_PRE_REVIEW" },
    check_appeal_sla: {
      agentType: "APPEAL_SLA",
      input: (params) => params,
    },
    propose_policy_change: { agentType: "POLICY_PROPOSAL" },
    draft_evaluations: { agentType: "EVALUATION_DRAFT" },
  };

export function registerAgentTaskRoutes(deps: {
  platformStore: ApprovalPort & ModelgovPort & TenantPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  runtimeFor: (request: FastifyRequest) => AgentRuntime;
  agentChat?: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    fetchImpl?: typeof fetch;
  };
  /** NPV2-031：可选——未提供时步骤端点返回空数组（内存模式）。 */
  stepRepositoryFor?: (tenantId: string) => AgentStepRepository;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, runtimeFor, agentChat,
    stepRepositoryFor,
  } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/agent-tasks/scan", async (request) => {
    requireRoles(request, "manager");
    const body = parse(scanAgentTasksSchema, request.body ?? {});
    const tenantId =
      request.authContext?.tenantId ??
      (request.headers["x-tenant-id"] as string | undefined) ??
      "tenant-demo";
    const batchKey = body.idempotencyKey ?? `scan-${Date.now()}`;
    const runs = await storeFor(request).listRuns();
    const runtime = runtimeFor(request);
    const tasks = [];

    for (const agentType of ["EVIDENCE_GAP", "CONTRIBUTION_ANOMALY"] as const) {
      const key =
        agentType === "EVIDENCE_GAP" ? "evidence-gap" : "contribution-anomaly";
      const task = await runtime.enqueue({
        tenantId,
        agentType,
        triggerType: "SCHEDULE",
        idempotencyKey: `${batchKey}:${key}`,
      });
      tasks.push(await runtime.run(task.id));
    }
    for (const run of runs.slice(0, 5)) {
      const task = await runtime.enqueue({
        tenantId,
        agentType: "SETTLEMENT_READINESS",
        triggerType: "SCHEDULE",
        input: { runId: run.id },
        idempotencyKey: `${batchKey}:settlement:${run.id}`,
      });
      tasks.push(await runtime.run(task.id));
    }
    return data(tasks, request);
  });

  app.post("/api/v1/agent-tasks", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(enqueueAgentTaskSchema, request.body);
    const tenantId =
      request.authContext?.tenantId ??
      (request.headers["x-tenant-id"] as string | undefined) ??
      "tenant-demo";
    return reply.status(201).send(
      data(
        await runtimeFor(request).enqueue({
          tenantId,
          agentType: body.agentType,
          triggerType: body.triggerType,
          triggerRef: body.triggerRef,
          input: body.input,
          idempotencyKey: body.idempotencyKey,
          riskTier: body.riskTier,
          actorRole: body.actorRole,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/agent-tasks", async (request) => {
    requireRoles(request, "manager");
    const query = request.query as { limit?: string };
    const requested = Number(query.limit ?? "200");
    // Newest first; cap the payload so a long-lived tenant does not ship
    // thousands of historical tasks to every console load.
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 500)
      : 200;
    const tasks = await runtimeFor(request).list();
    return data(tasks.slice(0, limit), request);
  });
  // 对话式入口（第二阶段）：LLM 只做意图选择与人话回复；
  // 命令必须命中 AGENT_COMMANDS 白名单才会执行，执行仍走任务状态机。
  const AGENT_CHAT_SYSTEM_PROMPT = [
    "你是 Anari N-Perform 绩效激励系统的 AI 助手。",
    "你只能从下面的命令目录中选择一个命令执行，或仅回答问题：",
    JSON.stringify(
      Object.entries(AGENT_COMMANDS).map(([command, definition]) => ({
        command,
        agentType: definition.agentType,
      })),
    ),
    "硬性规则（违反任何一条即为错误回复）：",
    "1. 你不能创造、修改或建议任何命令目录之外的命令；",
    "2. 你不能给出任何金额、绩效分数或系数——正式数值只由确定性引擎计算；",
    "3. 你不能批准任何动作——批准只能由人在任务卡上点击；",
    "4. 用户请求超出目录范围时，不要选择命令，用 reply 简短说明能做什么；",
    "5. 只输出严格 JSON：{\"command\": \"目录中的命令或空串\", \"params\": {}, \"reply\": \"不超过120字的人话回复\"}。",
  ].join("\n");

  app.get("/api/v1/agent-chat/status", async (request) => {
    return data(
      {
        enabled: Boolean(agentChat),
        provider: agentChat?.provider ?? null,
        model: agentChat?.model ?? null,
      },
      request,
    );
  });

  app.post("/api/v1/agent-chat", async (request, reply) => {
    requireRoles(request, "manager");
    if (!agentChat) {
      return reply.status(501).send({
        ...errorBody(
          "LLM_NOT_CONFIGURED",
          "对话意图解析未配置（LLM_PROVIDER/LLM_API_KEY）。请使用上方指令按钮，或联系管理员配置 DeepSeek/GLM/Kimi。",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const body = parse(agentChatSchema, request.body);
    // NP-005/D-02：出站 LLM 调用必须先过模型供应商数据策略门禁
    //（零留存/DPA/地区/出口白名单），不能只有模型摘要接口受管。
    await assertModelProviderPolicy(
      platformStore,
      request,
      agentChat.provider,
      agentChat.baseUrl,
    );
    const messages: LlmMessage[] = [
      { role: "system", content: AGENT_CHAT_SYSTEM_PROMPT },
      ...body.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];
    let parsed: Record<string, unknown> | null;
    try {
      const completion = await llmChatComplete(
        {
          provider: agentChat.provider as "deepseek" | "glm" | "kimi" | "custom",
          baseUrl: agentChat.baseUrl,
          apiKey: agentChat.apiKey,
          model: agentChat.model,
          fetchImpl: agentChat.fetchImpl,
        },
        messages,
        { temperature: 0.2, maxTokens: 500, timeoutMs: 25_000 },
      );
      parsed = extractJson(completion.content);
      if (!parsed) {
        return data(
          { reply: completion.content.slice(0, 600), task: null },
          request,
        );
      }
    } catch (error) {
      request.log.warn({ err: error }, "agent-chat llm call failed");
      throw new BadRequestError(
        "LLM_CALL_FAILED",
        error instanceof Error ? error.message : "LLM 调用失败",
      );
    }
    const replyText =
      typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim().slice(0, 600)
        : "已收到。";
    const commandName =
      typeof parsed.command === "string" ? parsed.command : "";
    const definition = AGENT_COMMANDS[commandName];
    if (!definition) {
      // 目录外的“命令”一律不执行——这是注入防护的最后闸门。
      return data({ reply: replyText, task: null }, request);
    }
    const tenantId = tenantOf(request);
    const runtime = runtimeFor(request);
    const params = sanitizeAgentChatParams(
      commandName,
      parsed.params && typeof parsed.params === "object"
        ? (parsed.params as Record<string, unknown>)
        : {},
    );
    const idempotencyKey =
      typeof params.idempotencyKey === "string" && params.idempotencyKey.trim()
        ? params.idempotencyKey
        : `chat:${commandName}:${Date.now()}`;
    const task = await runtime.enqueue({
      tenantId,
      agentType: definition.agentType,
      triggerType: "MANUAL",
      triggerRef: `chat:${commandName}`,
      input: definition.input ? definition.input(params) : params,
      idempotencyKey,
      actorRole: "ACTOR",
    });
    const executed = await runtime.run(task.id);
    countEvent("agent_chat_dispatched");
    return data({ reply: replyText, task: executed }, request);
  });

  // 智能指令台（无 LLM）：命令 → 现有 skill 任务；T0-T2 自动执行，
  // T3 一律等待人工批准（publish_policy），执行全部走既有状态机。

  app.post("/api/v1/agent-command", async (request, reply) => {
    requireRoles(request, "manager");
    const body = parse(agentCommandSchema, request.body);
    const command = AGENT_COMMANDS[body.command];
    if (!command) {
      throw new BadRequestError(
        "UNKNOWN_AGENT_COMMAND",
        `未知指令 ${body.command}`,
      );
    }
    const tenantId = tenantOf(request);
    const runtime = runtimeFor(request);
    const params = body.params ?? {};
    const idempotencyKey =
      typeof params.idempotencyKey === "string" && params.idempotencyKey.trim()
        ? params.idempotencyKey
        : `${body.command}:${Date.now()}`;
    const task = await runtime.enqueue({
      tenantId,
      agentType: command.agentType,
      triggerType: "MANUAL",
      triggerRef: body.command,
      input: command.input ? command.input(params) : params,
      idempotencyKey,
      actorRole: "ACTOR",
    });
    const executed = await runtime.run(task.id);
    countEvent("agent_command_dispatched");
    return reply.status(201).send(data(executed, request));
  });

  // 统一审批收件箱：agent 待批动作 + 业务审批 + 评分提案 三源聚合。
  app.get("/api/v1/agent-inbox", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    const tenantId = tenantOf(request);
    const [tasks, approvals, proposals] = await Promise.all([
      runtimeFor(request).list(),
      platformStore.listApprovalRequests(tenantId),
      platformStore.listAiScoreProposals(tenantId),
    ]);
    const items = [
      ...tasks
        .filter((task) => task.status === "WAITING_APPROVAL")
        .map((task) => ({
          source: "AGENT_TASK" as const,
          id: task.id,
          title: task.agentType,
          status: task.status,
          riskTier: task.riskTier,
          createdAt: task.createdAt,
          href: "/console/agent-ops",
        })),
      ...approvals
        .filter((approval) => approval.status === "PENDING")
        .map((approval) => ({
          source: "APPROVAL_REQUEST" as const,
          id: approval.id,
          title: approval.actionType,
          status: approval.status,
          createdAt: approval.createdAt,
          href: "/console/approvals",
        })),
      ...proposals
        .filter((proposal) => proposal.status === "PENDING")
        .map((proposal) => ({
          source: "SCORE_PROPOSAL" as const,
          id: proposal.id,
          title: "AI 评分提案复核",
          status: proposal.status,
          createdAt: proposal.createdAt,
          href: "/console/ai",
        })),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return data({ items, total: items.length }, request);
  });

  app.get("/api/v1/agent-tasks/:id", async (request) => {
    requireRoles(request, "manager");
    return data(await runtimeFor(request).get(idOf(request)), request);
  });

  app.post("/api/v1/agent-tasks/:id/run", async (request) => {
    requireRoles(request, "manager");
    return data(await runtimeFor(request).run(idOf(request)), request);
  });

  app.post("/api/v1/agent-tasks/:id/approve", async (request) => {
    const body = parse(approveAgentActionSchema, request.body);
    const runtime = runtimeFor(request);
    const task = await runtime.get(idOf(request));
    const action = task.actions.find(
      (candidate) => candidate.id === body.actionId,
    );
    requireRoles(
      request,
      ...(action?.tool === "publish_policy"
        ? ["admin"]
        : ["manager", "finance"]),
    );
    // NPV2-003/AUD-005：审批人必须是会话身份（不可代他人批准高风险动作）。
    const approver = requireActorRequired(
      request,
      body.approverPersonId,
      "approving an agent action",
    );
    return data(
      await runtime.approve(idOf(request), body.actionId, approver),
      request,
    );
  });

  app.post("/api/v1/agent-tasks/:id/reject", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(rejectAgentActionSchema, request.body);
    const approver = requireActorRequired(
      request,
      body.approverPersonId,
      "rejecting an agent action",
    );
    return data(
      await runtimeFor(request).reject(
        idOf(request),
        body.actionId,
        approver,
        body.reason,
      ),
      request,
    );
  });

  // ------------------------------------------------------------------
  // NPV2-020：Agent 待办——持久业务对象（责任人/dueAt/关联对象/幂等/来源），
  // 业务 UI 可查、可处理、可验证。
  // ------------------------------------------------------------------
  app.post("/api/v1/agent-todos:upsert", async (request, reply) => {
    requireRoles(request, "integration", "manager", "finance");
    const body = parse(upsertAgentTodoSchema, request.body);
    return reply.status(201).send(
      data(await storeFor(request).upsertAgentTodo(body), request),
    );
  });

  // NPV2-019/031：步骤与工具调用记录只读暴露（运维面板任务事实溯源）。
  // 审计轨迹含工具输入输出，仅管理/财务角色可读（person-level IDOR 收口）。
  app.get("/api/v1/agent-tasks/:id/steps", async (request) => {
    requireRoles(request, "manager", "finance");
    const repository = stepRepositoryFor?.(tenantOf(request));
    return data(repository ? await repository.listSteps(idOf(request)) : [], request);
  });

  app.get("/api/v1/agent-tasks/:id/invocations", async (request) => {
    requireRoles(request, "manager", "finance");
    const repository = stepRepositoryFor?.(tenantOf(request));
    return data(repository ? await repository.listToolInvocations(idOf(request)) : [], request);
  });

  app.get("/api/v1/agent-todos", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const person = personFilter(request);
    return data(
      await storeFor(request).listAgentTodos({
        assigneePersonId: person ?? query.assigneePersonId,
        status: query.status as never,
        sourceType: query.sourceType,
      }),
      request,
    );
  });

  app.get("/api/v1/agent-todos/:id", async (request) => {
    const todo = await storeFor(request).getAgentTodo(idOf(request));
    const person = personFilter(request);
    // 员工只能读自己的待办；管理/财务可读全部（审计与分派）。
    if (person && todo.assigneePersonId !== person) {
      throw new ForbiddenError("agent todo is not visible to this person");
    }
    return data(todo, request);
  });

  app.post("/api/v1/agent-todos/:id/complete", async (request) => {
    const body = policyBody(request);
    const store = storeFor(request);
    const todo = await store.getAgentTodo(idOf(request));
    const person = ownPersonId(request);
    const claimed =
      typeof body.completedByPersonId === "string"
        ? body.completedByPersonId
        : undefined;
    // 员工只能完成自己的待办；系统对账（机器令牌、无 person 声明）
    // 允许不写 completed_by（PG uuid 列存 NULL）。
    if (person && todo.assigneePersonId !== person && !isPrivileged(request)) {
      throw new ForbiddenError(
        "only the assignee (or a manager) can complete this todo",
      );
    }
    const completedBy = claimed
      ? requireActorRequired(request, claimed, "completing a todo")
      : person;
    return data(
      await store.completeAgentTodo(idOf(request), completedBy),
      request,
    );
  });

  app.post("/api/v1/agent-todos/:id/cancel", async (request) => {
    const body = policyBody(request);
    return data(
      await storeFor(request).cancelAgentTodo(
        idOf(request),
        typeof body.reason === "string" ? body.reason : undefined,
      ),
      request,
    );
  });

  };
}
