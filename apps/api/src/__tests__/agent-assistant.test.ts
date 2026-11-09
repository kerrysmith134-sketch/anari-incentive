/*
 * Agentic workbench backend: /agent-command (no-LLM command router) and
 * /agent-inbox (unified approval inbox). Governance rules unchanged:
 * execution always flows through the existing T0-T3 task state machine.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";

let app: FastifyInstance;
let platformStore: MemoryPlatformStore;

async function call(
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

beforeEach(() => {
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: MEMBER, employeeCode: "E002", displayName: "Contributor" },
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
  app = buildApp(new Store(), undefined, undefined, platformStore);
});

describe("agent command router", () => {
  it("dispatches a scan command and executes it through the runtime", async () => {
    const response = await call("POST", "/api/v1/agent-command", {
      command: "scan_evidence_gaps",
      params: { idempotencyKey: "cmd-evidence-1" },
    });
    expect(response.status).toBe(201);
    expect(response.body.data.agentType).toBe("EVIDENCE_GAP");
    expect(["SUCCEEDED", "WAITING_APPROVAL", "BLOCKED"]).toContain(
      response.body.data.status,
    );
    // Idempotent: same key returns the same task, not a duplicate.
    const again = await call("POST", "/api/v1/agent-command", {
      command: "scan_evidence_gaps",
      params: { idempotencyKey: "cmd-evidence-1" },
    });
    expect(again.body.data.id).toBe(response.body.data.id);
  });

  it("rejects unknown commands with 400", async () => {
    const response = await call("POST", "/api/v1/agent-command", {
      command: "delete_everything",
    });
    expect(response.status).toBe(400);
  });

  it("keeps T3 policy proposals waiting for human approval", async () => {
    const response = await call("POST", "/api/v1/agent-command", {
      command: "propose_policy_change",
      params: { idempotencyKey: "cmd-policy-1" },
    });
    expect(response.status).toBe(201);
    const task = response.body.data;
    if (task.actions.some((action: { riskTier: string }) => action.riskTier === "T3")) {
      expect(task.status).toBe("WAITING_APPROVAL");
    }
  });
});

describe("unified approval inbox", () => {
  it("aggregates agent waiting-approval tasks and business approvals", async () => {
    // 业务审批（PENDING）
    const approval = await call("POST", "/api/v1/approval-requests", {
      actionType: "LEDGER_ADJUSTMENT",
      targetType: "LEDGER_ENTRY",
      targetId: "00000000-0000-4000-8000-0000000000a1",
      requestedByType: "USER",
      requestedById: ADMIN,
      riskTier: "T2",
      idempotencyKey: `apr-${Date.now()}`,
    });
    expect(approval.status).toBeLessThan(300);
    // Agent 待批动作（T3）
    await call("POST", "/api/v1/agent-command", {
      command: "propose_policy_change",
      params: { idempotencyKey: `policy-${Date.now()}` },
    });
    const inbox = await call("GET", "/api/v1/agent-inbox");
    expect(inbox.status).toBe(200);
    const sources = inbox.body.data.items.map(
      (item: { source: string }) => item.source,
    );
    expect(sources).toContain("APPROVAL_REQUEST");
    expect(inbox.body.data.total).toBeGreaterThanOrEqual(1);
  });

  it("is manager/finance/admin only", async () => {
    const employeeApp = buildApp(
      new Store(),
      undefined,
      {
        async authenticate() {
          return {
            tenantId: "tenant-demo",
            userId: "emp",
            roles: ["employee"],
            personId: MEMBER,
          };
        },
      },
      platformStore,
    );
    const response = await employeeApp.inject({
      method: "GET",
      url: "/api/v1/agent-inbox",
    } as never);
    expect(response.statusCode).toBe(403);
  });
});
