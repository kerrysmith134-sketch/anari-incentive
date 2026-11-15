/**
 * Worker HTTP 上下文：租户头必须始终携带；待办字段按 camelCase 映射
 * （AUD-010/AUD-013 回归——此前 dueAt/targetId/idempotencyKey 恒为 undefined）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAgentContext } from "../http-context.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function captureFetch(payload: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const stub = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  globalThis.fetch = stub;
  return calls;
}

describe("HttpAgentContext", () => {
  it("无 token：始终发送 x-tenant-id", async () => {
    const calls = captureFetch({ data: [] });
    const context = new HttpAgentContext("http://api.test", "tenant-a");
    await context.listAgentTodos({ status: "OPEN" });
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe("tenant-a");
  });

  it("有 token：authorization 与 x-tenant-id 同时携带（不能只剩 bearer）", async () => {
    const calls = captureFetch({ data: [] });
    const context = new HttpAgentContext("http://api.test", "tenant-b", {
      getToken: async () => "jwt-token",
    } as never);
    await context.listAgentTodos({ status: "OPEN" });
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer jwt-token");
    expect(headers["x-tenant-id"]).toBe("tenant-b");
  });

  it("listAgentTodos 按 camelCase 映射（含 idempotencyKey）", async () => {
    captureFetch({
      data: [
        {
          id: "todo-1",
          title: "补交证据",
          detail: "detail",
          assigneePersonId: "person-1",
          status: "OPEN",
          dueAt: "2026-11-20T00:00:00.000Z",
          targetType: "WORK_PACKAGE",
          targetId: "wp-1",
          sourceType: "AGENT_FINDING",
          sourceId: "NO_EVIDENCE",
          idempotencyKey: "evidence-gap:wp-1",
        },
      ],
    });
    const context = new HttpAgentContext("http://api.test", "tenant-a");
    const todos = await context.listAgentTodos({ status: "OPEN" });
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({
      id: "todo-1",
      assigneePersonId: "person-1",
      dueAt: "2026-11-20T00:00:00.000Z",
      targetType: "WORK_PACKAGE",
      targetId: "wp-1",
      sourceType: "AGENT_FINDING",
      sourceId: "NO_EVIDENCE",
      idempotencyKey: "evidence-gap:wp-1",
    });
  });

  it("系统完成待办不提交 completedByPersonId（uuid 列收 NULL）", async () => {
    const calls = captureFetch({ data: { id: "todo-1", status: "DONE" } });
    const context = new HttpAgentContext("http://api.test", "tenant-a");
    await context.completeAgentTodo("todo-1");
    const body = JSON.parse(String(calls[0]!.init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    expect(body.completedByPersonId).toBeUndefined();
  });
});
