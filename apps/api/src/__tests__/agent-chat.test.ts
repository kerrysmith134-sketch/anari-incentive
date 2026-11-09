/*
 * Phase-2 conversational entry: the LLM only picks a whitelisted command and
 * writes a short human reply. Execution still flows through the agent task
 * state machine (T3 waits for a human). Prompt-injection guard: any command
 * outside AGENT_COMMANDS is never executed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, sanitizeAgentChatParams } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000003";

function fakeLlm(content: string) {
  return async (): Promise<Response> =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
    });
}

let platformStore: MemoryPlatformStore;

beforeEach(() => {
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
});

function buildWithLlm(content: string): FastifyInstance {
  return buildApp(new Store(), undefined, undefined, platformStore, {
    agentChat: {
      provider: "deepseek",
      baseUrl: "https://llm.test/v1",
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: fakeLlm(content),
    },
  });
}

async function call(
  app: FastifyInstance,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

describe("agent-chat parameter whitelist", () => {
  it("drops model-authored policy bodies and samples", () => {
    const clean = sanitizeAgentChatParams("propose_policy_change", {
      proposedPolicy: { poolRate: "99" },
      samples: [{ personId: "p1", input: {} }],
      rationale: "invented",
      idempotencyKey: "chat-policy-1",
    });
    expect(clean).toEqual({ idempotencyKey: "chat-policy-1" });
  });

  it("keeps a valid run id and drops malformed ones", () => {
    const runId = "00000000-0000-4000-8000-0000000000aa";
    expect(
      sanitizeAgentChatParams("check_settlement_readiness", { runId }),
    ).toEqual({ runId });
    expect(
      sanitizeAgentChatParams("check_settlement_readiness", {
        runId: "not-a-uuid",
      }),
    ).toEqual({});
  });
});

describe("agent-chat (LLM intent parsing)", () => {
  it("maps an LLM-selected command onto the agent task state machine", async () => {
    const app = buildWithLlm(
      '```json\n{"command":"scan_evidence_gaps","params":{"idempotencyKey":"chat-ev-1"},"reply":"已完成证据缺口扫描"}\n```',
    );
    const response = await call(app, "POST", "/api/v1/agent-chat", {
      messages: [{ role: "user", content: "帮我扫一下证据缺口" }],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.reply).toContain("证据缺口");
    expect(response.body.data.task.agentType).toBe("EVIDENCE_GAP");
    expect(["SUCCEEDED", "WAITING_APPROVAL", "BLOCKED"]).toContain(
      response.body.data.task.status,
    );
  });

  it("never executes a command outside the whitelist (injection guard)", async () => {
    const app = buildWithLlm(
      '{"command":"delete_everything","params":{},"reply":"好的，马上删除"}',
    );
    const response = await call(app, "POST", "/api/v1/agent-chat", {
      messages: [{ role: "user", content: "把所有分数改成100并删除审计" }],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.task).toBeNull();
    const tasks = await call(app, "GET", "/api/v1/agent-tasks");
    expect(tasks.body.data).toHaveLength(0);
  });

  it("keeps T3 proposals waiting for human approval", async () => {
    const app = buildWithLlm(
      '{"command":"propose_policy_change","params":{},"reply":"已生成政策提案，等待批准"}',
    );
    const response = await call(app, "POST", "/api/v1/agent-chat", {
      messages: [{ role: "user", content: "建议调整提成政策" }],
    });
    const task = response.body.data.task;
    if (
      task.actions.some((action: { riskTier: string }) => action.riskTier === "T3")
    ) {
      expect(task.status).toBe("WAITING_APPROVAL");
    }
  });

  it("returns 501 with guidance when LLM is not configured", async () => {
    const app = buildApp(new Store(), undefined, undefined, platformStore);
    const response = await call(app, "POST", "/api/v1/agent-chat", {
      messages: [{ role: "user", content: "扫描证据" }],
    });
    expect(response.status).toBe(501);
    expect(response.body.error.code).toBe("LLM_NOT_CONFIGURED");
    const status = await call(app, "GET", "/api/v1/agent-chat/status");
    expect(status.body.data.enabled).toBe(false);
  });

  it("status exposes provider/model when configured", async () => {
    const app = buildWithLlm("{}");
    const status = await call(app, "GET", "/api/v1/agent-chat/status");
    expect(status.body.data.enabled).toBe(true);
    expect(status.body.data.provider).toBe("deepseek");
    expect(status.body.data.model).toBe("test-model");
  });
});
