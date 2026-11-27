/**
 * vLLM decision AI adapter（decision-ai）定向测试。
 *
 * 覆盖：
 * - 合法响应 → 201 + 以 AI_MODEL 身份写 judgment，且案件仍未决定；
 * - 非法证据引用 / 非 JSON / 超时 → 502 VLLM_DECISION_FAILED 且不落 judgment；
 * - 连续 3 次失败 → 60s 熔断，第 4 次不再打模型端点；
 * - AI 建议不能决定案件（decide 拒绝 AI judgment / 非 uuid 的模型 actor）；
 * - 权限：非 manager 403；缺少服务 token 403 AI_JUDGMENT_FORBIDDEN。
 *
 * 使用本地 mock HTTP server（127.0.0.1:0）而不是打真实 vLLM。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { decisionEvidenceHash } from "@anari/domain";
import {
  decisionAiCircuitState,
  resetDecisionAiCircuitBreaker,
} from "../../../../packages/decision-ai/src/index.js";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-0000000000c1";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const REVIEWER = "00000000-0000-4000-8000-000000000002";
const DECIDER = "00000000-0000-4000-8000-000000000003";
const MODEL = "Qwen/Qwen2.5-7B-Instruct";
const MODEL_REF = `vllm/${MODEL}`;
const AI_TOKEN = `decision-ai-${"z".repeat(40)}`;
const AI_TOKEN_HEADER = "x-decision-ai-token";
const ALL_ROLES = ["admin", "manager", "finance"];

type App = Awaited<ReturnType<typeof buildApp>>;

let actingPerson = ADMIN;
let actingRoles: string[] = [...ALL_ROLES];

function actAs(personId: string, roles: string[] = ALL_ROLES): void {
  actingPerson = personId;
  actingRoles = [...roles];
}

// ---------------------------------------------------------------------------
// mock vLLM HTTP server
// ---------------------------------------------------------------------------

interface MockHit {
  path: string;
  body: Record<string, unknown>;
}

type MockReply =
  | { status: number; body: unknown; delayMs?: number }
  | { hangMs: number };

interface MockServer {
  url: string;
  hits: MockHit[];
  close(): Promise<void>;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function completion(
  content: string | Record<string, unknown>,
  status = 200,
): MockReply {
  return {
    status,
    body: {
      id: "chatcmpl-mock",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              typeof content === "string" ? content : JSON.stringify(content),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 123, completion_tokens: 45 },
    },
  };
}

async function startMock(
  handler: (body: Record<string, unknown>, index: number) => MockReply,
): Promise<MockServer> {
  const hits: MockHit[] = [];
  const server = createServer((request, response) => {
    response.on("error", () => undefined);
    request.on("error", () => undefined);
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        body = {};
      }
      hits.push({ path: request.url ?? "", body });
      const reply = handler(body, hits.length - 1);
      if ("hangMs" in reply) {
        setTimeout(() => {
          sendJson(response, 200, {
            choices: [{ message: { role: "assistant", content: "{}" } }],
          });
        }, reply.hangMs).unref?.();
        return;
      }
      const write = () => sendJson(response, reply.status, reply.body);
      if (reply.delayMs) {
        setTimeout(write, reply.delayMs).unref?.();
        return;
      }
      write();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    hits,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

// ---------------------------------------------------------------------------
// app helpers
// ---------------------------------------------------------------------------

function build(): { app: App; platformStore: MemoryPlatformStore } {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "Decision AI tenant",
      slug: "decision-ai",
      persons: [
        { id: ADMIN, employeeCode: "E001", displayName: "Case admin" },
        { id: REVIEWER, employeeCode: "E002", displayName: "Reviewer" },
        { id: DECIDER, employeeCode: "E003", displayName: "Authorized decider" },
      ],
    },
  });
  const app = buildApp(
    () => new Store(TENANT),
    undefined,
    {
      async authenticate() {
        return {
          tenantId: TENANT,
          userId: actingPerson,
          personId: actingPerson,
          roles: [...actingRoles],
        };
      },
    },
    platformStore,
  );
  return { app, platformStore };
}

interface InjectResult {
  statusCode: number;
  json(): unknown;
}

async function post(
  app: App,
  url: string,
  payload: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<InjectResult> {
  return (await app.inject({
    method: "POST",
    url,
    payload,
    headers: { "content-type": "application/json", ...headers },
  })) as unknown as InjectResult;
}

async function get(app: App, url: string): Promise<InjectResult> {
  return (await app.inject({
    method: "GET",
    url,
  })) as unknown as InjectResult;
}

function dataOf<T>(result: InjectResult): T {
  return (result.json() as { data: T }).data;
}

function errorOf(
  result: InjectResult,
): { code: string; message: string; details?: Record<string, unknown> } {
  return (
    result.json() as {
      error: { code: string; message: string; details?: Record<string, unknown> };
    }
  ).error;
}

interface CaseShape {
  id: string;
  kind: string;
  status: string;
  version: number;
}

interface EvidenceShape {
  id: string;
  contentHash: string;
  supports: string;
}

interface JudgmentShape {
  id: string;
  actorType: string;
  actorId: string;
  modelRef?: string;
  independentRationale: string;
  dimensionStates: Record<string, unknown>;
  confidence?: number;
}

interface DetailShape {
  case: CaseShape;
  evidence: EvidenceShape[];
  judgments: { human: JudgmentShape[]; ai: JudgmentShape[] };
  verifications: Array<{ passed: boolean }>;
  record?: { decidedBy: string; finalJudgmentId: string };
}

async function createCase(app: App, kind = "PERFORMANCE"): Promise<CaseShape> {
  actAs(ADMIN);
  const result = await post(app, "/api/v1/decision-cases", {
    kind,
    subjectType: "WORK_PACKAGE",
    subjectId: `wp-${Math.random().toString(16).slice(2)}`,
    context: { period: "2026-Q4", rubric: "delivery-and-quality" },
  });
  expect(result.statusCode).toBe(201);
  return dataOf<CaseShape>(result);
}

async function appendEvidence(
  app: App,
  caseId: string,
  supports: "FOR" | "AGAINST",
  content: Record<string, unknown>,
): Promise<EvidenceShape> {
  actAs(ADMIN);
  const result = await post(app, `/api/v1/decision-cases/${caseId}/evidence`, {
    sourceType: supports === "FOR" ? "WORK_ITEM" : "SYSTEM_METRIC",
    sourceId: `source-${Math.random().toString(16).slice(2)}`,
    content,
    contentHash: decisionEvidenceHash(content),
    supports,
  });
  expect(result.statusCode).toBe(201);
  return dataOf<EvidenceShape>(result);
}

function suggestionContent(
  dimensions: Array<{ dimension: string; refs: string[] }>,
): Record<string, unknown> {
  return {
    summary: "The supplied evidence supports a qualified conclusion.",
    dimensions: dimensions.map((entry) => ({
      dimension: entry.dimension,
      state: entry.refs.length > 0 ? "SUPPORTED" : "INSUFFICIENT_EVIDENCE",
      statement: `Assessment for ${entry.dimension} based on supplied evidence.`,
      evidenceRefs: entry.refs,
      confidence: 0.72,
    })),
    overallConfidence: 0.66,
  };
}

interface SuggestionResponse {
  judgmentId: string;
  modelRef: string;
  inputHash: string;
  suggestion: {
    summary: string;
    overallConfidence: number;
    dimensions: Array<{
      dimension: string;
      state: string;
      evidenceRefs: string[];
      confidence: number;
    }>;
  };
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

const servers: MockServer[] = [];
const apps: App[] = [];

async function mock(
  handler: (body: Record<string, unknown>, index: number) => MockReply,
): Promise<MockServer> {
  const server = await startMock(handler);
  servers.push(server);
  return server;
}

async function appForTest(): Promise<App> {
  const { app } = build();
  apps.push(app);
  return app;
}

function suggest(
  app: App,
  caseId: string,
  payload: Record<string, unknown> = {},
  headers: Record<string, string> = { [AI_TOKEN_HEADER]: AI_TOKEN },
): Promise<InjectResult> {
  return post(
    app,
    `/api/v1/decision-cases/${caseId}/ai-suggestion`,
    payload,
    headers,
  );
}

beforeEach(() => {
  // 熔断器是模块级状态：每个测试从零开始，避免相互污染。
  resetDecisionAiCircuitBreaker();
  process.env.DECISION_AI_TOKEN = AI_TOKEN;
  process.env.VLLM_MODEL = MODEL;
  process.env.VLLM_TIMEOUT_MS = "2000";
  delete process.env.VLLM_API_KEY;
  delete process.env.VLLM_BASE_URL;
  actAs(ADMIN);
});

afterEach(async () => {
  delete process.env.DECISION_AI_TOKEN;
  delete process.env.VLLM_MODEL;
  delete process.env.VLLM_TIMEOUT_MS;
  delete process.env.VLLM_BASE_URL;
  delete process.env.VLLM_API_KEY;
  resetDecisionAiCircuitBreaker();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(apps.splice(0).map((app) => app.close()));
  actAs(ADMIN);
});

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("POST /decision-cases/:id/ai-suggestion (vLLM)", () => {
  it("records a validated AI_MODEL suggestion with exact evidence refs", async () => {
    const app = await appForTest();
    const decisionCase = await createCase(app);
    const supporting = await appendEvidence(app, decisionCase.id, "FOR", {
      metric: "delivered_scope",
      value: 12,
    });
    const counter = await appendEvidence(app, decisionCase.id, "AGAINST", {
      metric: "defects",
      value: 3,
    });
    const dimensions = ["outcome_evidence", "attribution_basis"];
    const model = await mock(() =>
      completion(
        suggestionContent([
          { dimension: dimensions[0]!, refs: [supporting.id] },
          { dimension: dimensions[1]!, refs: [supporting.id, counter.id] },
        ]),
      ),
    );
    process.env.VLLM_BASE_URL = model.url;

    const result = await suggest(app, decisionCase.id, { dimensions });
    expect(result.statusCode).toBe(201);
    const body = dataOf<SuggestionResponse>(result);
    expect(body.modelRef).toBe(MODEL_REF);
    expect(body.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(body.suggestion.dimensions).toHaveLength(2);
    expect(body.judgmentId).toBeTruthy();

    // OpenAI-compatible wire shape：POST /v1/chat/completions + JSON mode。
    expect(model.hits).toHaveLength(1);
    const hit = model.hits[0]!;
    expect(hit.path).toBe("/v1/chat/completions");
    expect(hit.body.model).toBe(MODEL);
    expect(hit.body.temperature).toBe(0);
    expect(hit.body.response_format).toEqual({ type: "json_object" });
    const messages = hit.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    // prompt 里的证据只以 ref + 承诺出现，且 ref 精确匹配。
    const userPayload = JSON.parse(messages[1]!.content) as {
      evidence: Array<{ ref: string }>;
    };
    expect(userPayload.evidence.map((entry) => entry.ref).sort()).toEqual(
      [supporting.id, counter.id].sort(),
    );

    // judgment 以 AI_MODEL 身份落库；只有建议，没有决定。
    const detail = dataOf<DetailShape>(
      await get(app, `/api/v1/decision-cases/${decisionCase.id}`),
    );
    expect(detail.judgments.human).toHaveLength(0);
    expect(detail.judgments.ai).toHaveLength(1);
    const aiJudgment = detail.judgments.ai[0]!;
    expect(aiJudgment.actorType).toBe("AI_MODEL");
    expect(aiJudgment.actorId).toBe(MODEL_REF);
    expect(aiJudgment.modelRef).toBe(MODEL_REF);
    expect(aiJudgment.confidence).toBeCloseTo(0.66);
    expect(aiJudgment.independentRationale).toContain("evidence");
    expect(aiJudgment.dimensionStates.advisoryOnly).toBe(true);
    expect(aiJudgment.dimensionStates.finalDecision).toBeUndefined();
    expect(detail.record).toBeUndefined();
    expect(detail.case.status).not.toBe("DECIDED");
  });

  it("rejects a response that references evidence outside the case set and writes nothing", async () => {
    const app = await appForTest();
    const decisionCase = await createCase(app, "BUDGET");
    await appendEvidence(app, decisionCase.id, "FOR", { amount: 100 });
    const model = await mock(() =>
      completion(
        suggestionContent([
          { dimension: "budget_justification", refs: ["evidence-not-in-case"] },
          { dimension: "evidence_quality", refs: [] },
        ]),
      ),
    );
    process.env.VLLM_BASE_URL = model.url;

    const result = await suggest(app, decisionCase.id);
    expect(result.statusCode).toBe(502);
    const error = errorOf(result);
    expect(error.code).toBe("VLLM_DECISION_FAILED");
    expect(error.details?.reason).toBe("EVIDENCE_REF_NOT_FOUND");
    // 非法引用不是可重试错误：只调用一次。
    expect(model.hits).toHaveLength(1);

    const detail = dataOf<DetailShape>(
      await get(app, `/api/v1/decision-cases/${decisionCase.id}`),
    );
    expect(detail.judgments.ai).toHaveLength(0);
    expect(detail.judgments.human).toHaveLength(0);
  });

  it("rejects non-JSON model content and writes nothing", async () => {
    const app = await appForTest();
    const decisionCase = await createCase(app, "BUDGET");
    const model = await mock(() =>
      completion("I think the evidence is fine. No JSON here."),
    );
    process.env.VLLM_BASE_URL = model.url;

    const result = await suggest(app, decisionCase.id, {
      dimensions: ["budget_justification"],
    });
    expect(result.statusCode).toBe(502);
    expect(errorOf(result).code).toBe("VLLM_DECISION_FAILED");
    expect(errorOf(result).details?.reason).toBe("INVALID_JSON");
    expect(model.hits).toHaveLength(1);

    const detail = dataOf<DetailShape>(
      await get(app, `/api/v1/decision-cases/${decisionCase.id}`),
    );
    expect(detail.judgments.ai).toHaveLength(0);
  });

  it("times out, retries exactly once and reports TIMEOUT without writing a judgment", async () => {
    const app = await appForTest();
    const decisionCase = await createCase(app, "BUDGET");
    const model = await mock(() => ({ hangMs: 5_000 }));
    process.env.VLLM_BASE_URL = model.url;
    process.env.VLLM_TIMEOUT_MS = "80";

    const started = Date.now();
    const result = await suggest(app, decisionCase.id, {
      dimensions: ["budget_justification"],
    });
    const elapsed = Date.now() - started;
    expect(result.statusCode).toBe(502);
    expect(errorOf(result).details?.reason).toBe("TIMEOUT");
    expect(errorOf(result).details?.retryable).toBe(true);
    // 1 次超时 + 重试 1 次 = 2 个请求；不会无限重试。
    expect(model.hits).toHaveLength(2);
    expect(elapsed).toBeLessThan(2_000);

    const detail = dataOf<DetailShape>(
      await get(app, `/api/v1/decision-cases/${decisionCase.id}`),
    );
    expect(detail.judgments.ai).toHaveLength(0);
  });

  it("opens the circuit after three consecutive failures and short-circuits", async () => {
    const app = await appForTest();
    const model = await mock(() => ({
      status: 503,
      body: { error: "unavailable" },
    }));
    process.env.VLLM_BASE_URL = model.url;

    for (let index = 0; index < 3; index += 1) {
      const decisionCase = await createCase(app, "BUDGET");
      const failed = await suggest(app, decisionCase.id, {
        dimensions: ["budget_justification"],
      });
      expect(failed.statusCode).toBe(502);
      expect(errorOf(failed).details?.reason).toBe("HTTP_ERROR");
    }
    // 每次失败重试 1 次：3 * 2 = 6 个真实请求。
    expect(model.hits).toHaveLength(6);
    expect(
      decisionAiCircuitState(model.url, MODEL).failures,
    ).toBeGreaterThanOrEqual(3);

    const shortCircuitedCase = await createCase(app, "BUDGET");
    const shortCircuited = await suggest(app, shortCircuitedCase.id, {
      dimensions: ["budget_justification"],
    });
    expect(shortCircuited.statusCode).toBe(502);
    expect(errorOf(shortCircuited).details?.reason).toBe("CIRCUIT_OPEN");
    // 熔断期内不再打模型端点。
    expect(model.hits).toHaveLength(6);

    const detail = dataOf<DetailShape>(
      await get(app, `/api/v1/decision-cases/${shortCircuitedCase.id}`),
    );
    expect(detail.judgments.ai).toHaveLength(0);
  });

  it("keeps AI advice advisory: the AI judgment can never authorize the decision", async () => {
    const app = await appForTest();
    const decisionCase = await createCase(app);
    const supporting = await appendEvidence(app, decisionCase.id, "FOR", {
      metric: "delivered_scope",
      value: 12,
    });
    const counter = await appendEvidence(app, decisionCase.id, "AGAINST", {
      metric: "defects",
      value: 3,
    });
    const dimensions = ["outcome_evidence", "attribution_basis"];
    const model = await mock(() =>
      completion(
        suggestionContent([
          { dimension: dimensions[0]!, refs: [supporting.id] },
          { dimension: dimensions[1]!, refs: [supporting.id, counter.id] },
        ]),
      ),
    );
    process.env.VLLM_BASE_URL = model.url;

    expect(
      (await suggest(app, decisionCase.id, { dimensions })).statusCode,
    ).toBe(201);

    // 人工独立判断 + 服务端校验后才能决定。
    actAs(REVIEWER);
    expect(
      (
        await post(app, `/api/v1/decision-cases/${decisionCase.id}/judgments`, {
          actorType: "HUMAN",
          actorId: REVIEWER,
          independentScores: {},
          independentRationale: "Independent human review of the same evidence.",
        })
      ).statusCode,
    ).toBe(201);
    actAs(ADMIN);
    expect(
      (
        await post(app, `/api/v1/decision-cases/${decisionCase.id}/verify`, {
          verifiedBy: ADMIN,
        })
      ).statusCode,
    ).toBe(201);

    const detail = dataOf<DetailShape>(
      await get(app, `/api/v1/decision-cases/${decisionCase.id}`),
    );
    const aiJudgment = detail.judgments.ai[0]!;
    const humanJudgment = detail.judgments.human[0]!;

    // 用 AI judgment 作最终依据：拒绝。
    actAs(DECIDER);
    const aiAsFinal = await post(
      app,
      `/api/v1/decision-cases/${decisionCase.id}/decide`,
      {
        finalJudgmentId: aiJudgment.id,
        rationale: "Let the model decide.",
      },
    );
    expect(aiAsFinal.statusCode).toBe(409);
    expect(errorOf(aiAsFinal).code).toBe("FINAL_JUDGMENT_MUST_BE_HUMAN");

    // 让 AI actor 当决定人：actorId 非 uuid，协议层直接拒绝。
    const aiAsDecider = await post(
      app,
      `/api/v1/decision-cases/${decisionCase.id}/decide`,
      {
        decidedBy: aiJudgment.actorId,
        rationale: "The model decides this case.",
      },
    );
    expect(aiAsDecider.statusCode).toBe(400);
    expect(errorOf(aiAsDecider).code).toBe("VALIDATION_ERROR");

    // 人工决定成功，记录里的决定人仍是人。
    const humanDecision = await post(
      app,
      `/api/v1/decision-cases/${decisionCase.id}/decide`,
      {
        decidedBy: DECIDER,
        finalJudgmentId: humanJudgment.id,
        rationale: "Human decision after independent review.",
      },
    );
    expect(humanDecision.statusCode).toBe(200);
    const finalDetail = dataOf<DetailShape>(
      await get(app, `/api/v1/decision-cases/${decisionCase.id}`),
    );
    expect(finalDetail.record?.decidedBy).toBe(DECIDER);
    expect(finalDetail.record?.finalJudgmentId).toBe(humanJudgment.id);
  });

  it("requires a manager/admin caller and the AI service token", async () => {
    const app = await appForTest();
    const decisionCase = await createCase(app, "BUDGET");
    const model = await mock(() =>
      completion(
        suggestionContent([
          { dimension: "budget_justification", refs: [] },
          { dimension: "evidence_quality", refs: [] },
        ]),
      ),
    );
    process.env.VLLM_BASE_URL = model.url;

    // 普通员工：403（角色不足），且不触达模型。
    actAs(REVIEWER, ["viewer"]);
    const forbidden = await suggest(app, decisionCase.id, {
      dimensions: ["budget_justification"],
    });
    expect(forbidden.statusCode).toBe(403);
    expect(model.hits).toHaveLength(0);

    // 管理员会话但缺少服务 token：仍不能伪造 AI_MODEL 判断。
    actAs(ADMIN);
    const noToken = await suggest(
      app,
      decisionCase.id,
      { dimensions: ["budget_justification"] },
      {},
    );
    expect(noToken.statusCode).toBe(403);
    expect(errorOf(noToken).code).toBe("AI_JUDGMENT_FORBIDDEN");
    expect(model.hits).toHaveLength(0);
  });
});
