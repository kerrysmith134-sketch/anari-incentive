/**
 * 118：通用 JEV Decision Record。
 *
 * 覆盖：五类 kind 复用同一条链路、证据 hash 校验、独立判断不可改写、
 * AI 只能建议不能决定、无校验/校验不通过拒绝、自决拒绝、决定不可改。
 */
import { describe, expect, it } from "vitest";
import { decisionEvidenceHash } from "@anari/domain";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const TENANT_B = "00000000-0000-4000-8000-0000000000b1";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const REVIEWER = "00000000-0000-4000-8000-000000000002";
const THIRD = "00000000-0000-4000-8000-000000000003";
/** 模型标识允许非 uuid；AI 判断不绑定人员身份。 */
const MODEL_ID = "model-run-2026-11-27";
const MODEL_REF = "vllm/qwen2.5-72b-instruct@2026-11";

const ALL_ROLES = ["admin", "manager", "finance"];

type App = Awaited<ReturnType<typeof buildApp>>;

let actingPerson = ADMIN;
let actingRoles: string[] = [...ALL_ROLES];

function actAs(personId: string, roles: string[] = ALL_ROLES): void {
  actingPerson = personId;
  actingRoles = [...roles];
}

interface InjectResult {
  statusCode: number;
  json(): unknown;
}

interface DecisionCaseShape {
  id: string;
  tenantId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  status: string;
  version: number;
  createdBy: string;
}

interface EvidenceShape {
  id: string;
  caseId: string;
  sourceType: string;
  sourceId: string;
  contentHash: string;
  supports: string;
  weight?: string;
}

interface JudgmentShape {
  id: string;
  caseId: string;
  actorType: string;
  actorId: string;
  modelRef?: string;
  independentScores: Record<string, unknown>;
  independentRationale: string;
  dimensionStates: Record<string, unknown>;
  confidence?: number;
}

interface VerificationShape {
  id: string;
  caseId: string;
  checks: Record<string, unknown>;
  findings: Array<Record<string, unknown>>;
  passed: boolean;
  verifiedBy: string;
}

interface RecordShape {
  id: string;
  caseId: string;
  finalJudgmentId: string;
  decidedBy: string;
  rationale: string;
  evidenceHash: string;
  version: number;
  decidedAt: string;
}

interface DetailShape {
  case: DecisionCaseShape;
  evidence: EvidenceShape[];
  judgments: { human: JudgmentShape[]; ai: JudgmentShape[] };
  verifications: VerificationShape[];
  record?: RecordShape;
}

interface ErrorShape {
  error: { code: string; message: string };
}

function build(tenantId = TENANT): {
  app: App;
  platformStore: MemoryPlatformStore;
} {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "JEV decision tenant",
      slug: "jev-decision",
      persons: [
        { id: ADMIN, employeeCode: "E001", displayName: "Case admin" },
        { id: REVIEWER, employeeCode: "E002", displayName: "Independent reviewer" },
        { id: THIRD, employeeCode: "E003", displayName: "Authorized decider" },
      ],
    },
  });
  const app = buildApp(
    () => new Store(tenantId),
    undefined,
    {
      async authenticate() {
        return {
          tenantId,
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

async function post(
  app: App,
  url: string,
  payload: Record<string, unknown>,
): Promise<InjectResult> {
  return (await app.inject({
    method: "POST",
    url,
    payload,
    headers: { "content-type": "application/json" },
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

function errorOf(result: InjectResult): ErrorShape["error"] {
  return (result.json() as ErrorShape).error;
}

function expectConflict(
  result: InjectResult,
  marker: string,
): void {
  expect(result.statusCode).toBe(409);
  const error = errorOf(result);
  expect(error.code).toBe("CONFLICT");
  expect(error.message).toContain(marker);
}

async function createCase(
  app: App,
  kind = "PERFORMANCE",
  overrides: Record<string, unknown> = {},
): Promise<DecisionCaseShape> {
  actAs(ADMIN);
  const result = await post(app, "/api/v1/decision-cases", {
    kind,
    subjectType: "WORK_PACKAGE",
    subjectId: "wp-100",
    context: { cycle: "2026-Q4", policyVersion: "v7" },
    ...overrides,
  });
  expect(result.statusCode).toBe(201);
  return dataOf<DecisionCaseShape>(result);
}

async function addEvidence(
  app: App,
  caseId: string,
  options: {
    content?: unknown;
    contentHash?: string;
    sourceId?: string;
    supports?: string;
    weight?: string | number;
  } = {},
): Promise<InjectResult> {
  const content = options.content ?? { metric: "delivery", value: 4 };
  return post(app, `/api/v1/decision-cases/${caseId}/evidence`, {
    sourceType: "WORK_ITEM",
    sourceId: options.sourceId ?? "wi-1",
    content,
    contentHash: options.contentHash ?? decisionEvidenceHash(content),
    supports: options.supports ?? "FOR",
    ...(options.weight ? { weight: options.weight } : {}),
  });
}

async function addHumanJudgment(
  app: App,
  caseId: string,
  actorId = REVIEWER,
  rationale = "Reviewed the source records independently",
): Promise<JudgmentShape> {
  actAs(actorId);
  const result = await post(
    app,
    `/api/v1/decision-cases/${caseId}/judgments`,
    {
      actorType: "HUMAN",
      actorId,
      independentScores: { quality: 4, delivery: 5 },
      independentRationale: rationale,
      dimensionStates: { evidenceCoverage: "FULL" },
      confidence: 0.82,
    },
  );
  expect(result.statusCode).toBe(201);
  return dataOf<JudgmentShape>(result);
}

async function addAiJudgment(
  app: App,
  caseId: string,
): Promise<JudgmentShape> {
  actAs(ADMIN);
  const result = await post(
    app,
    `/api/v1/decision-cases/${caseId}/judgments`,
    {
      actorType: "AI_MODEL",
      actorId: MODEL_ID,
      modelRef: MODEL_REF,
      independentScores: { quality: 3.8, delivery: 4.2 },
      independentRationale: "Model suggestion for reviewer consideration",
      dimensionStates: { evidenceCoverage: "PARTIAL" },
      confidence: 0.64,
    },
  );
  expect(result.statusCode).toBe(201);
  return dataOf<JudgmentShape>(result);
}

async function recordVerification(
  app: App,
  caseId: string,
  options: {
    passed?: boolean;
    verifiedBy?: string;
    findings?: Array<Record<string, unknown>>;
  } = {},
): Promise<InjectResult> {
  const verifiedBy = options.verifiedBy ?? ADMIN;
  actAs(verifiedBy);
  return post(app, `/api/v1/decision-cases/${caseId}/verify`, {
    checks: {
      conflictOfInterest: "NONE",
      evidenceCoverage: options.passed === false ? "INCOMPLETE" : "COMPLETE",
      ruleSet: "jev-2026.1",
    },
    findings: options.findings ?? [],
    passed: options.passed ?? true,
    verifiedBy,
  });
}

async function decide(
  app: App,
  caseId: string,
  decider = ADMIN,
  extra: Record<string, unknown> = {},
  roles: string[] = ALL_ROLES,
): Promise<InjectResult> {
  actAs(decider, roles);
  return post(app, `/api/v1/decision-cases/${caseId}/decide`, {
    decidedBy: decider,
    rationale: "Final decision after independent review and verification",
    ...extra,
  });
}

async function detail(app: App, caseId: string): Promise<DetailShape> {
  const result = await get(app, `/api/v1/decision-cases/${caseId}`);
  expect(result.statusCode).toBe(200);
  return dataOf<DetailShape>(result);
}

describe("JEV decision record (118)", () => {
  it("records evidence, AI suggestion, human judgment, verification and an immutable decision", async () => {
    const { app } = build();
    const decisionCase = await createCase(app);

    // canonical hash：字段顺序不同但内容相同，服务端重算应一致。
    const content = {
      metric: "delivery",
      value: 4,
      detail: { region: "EU", site: "S-1" },
    };
    const reordered = {
      detail: { site: "S-1", region: "EU" },
      value: 4,
      metric: "delivery",
    };
    const evidenceResult = await addEvidence(app, decisionCase.id, {
      content: reordered,
      contentHash: decisionEvidenceHash(content),
      weight: 1.5,
      supports: "FOR",
    });
    expect(evidenceResult.statusCode).toBe(201);
    const evidence = dataOf<EvidenceShape>(evidenceResult);
    expect(evidence.contentHash).toBe(decisionEvidenceHash(content));
    expect(evidence.weight).toBe("1.5");

    const ai = await addAiJudgment(app, decisionCase.id);
    const human = await addHumanJudgment(app, decisionCase.id);
    const verification = await recordVerification(app, decisionCase.id);
    expect(verification.statusCode).toBe(201);

    const before = await detail(app, decisionCase.id);
    expect(before.case.status).toBe("READY");
    expect(before.judgments.human.map((entry) => entry.id)).toEqual([
      human.id,
    ]);
    expect(before.judgments.ai.map((entry) => entry.id)).toEqual([ai.id]);

    const decisionResult = await decide(app, decisionCase.id, ADMIN);
    expect(decisionResult.statusCode).toBe(200);
    const record = dataOf<RecordShape>(decisionResult);
    expect(record.finalJudgmentId).toBe(human.id);
    expect(record.decidedBy).toBe(ADMIN);
    expect(record.evidenceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record.version).toBeGreaterThan(decisionCase.version);

    const after = await detail(app, decisionCase.id);
    expect(after.case.status).toBe("DECIDED");
    expect(after.record?.id).toBe(record.id);
    expect(after.record?.evidenceHash).toBe(record.evidenceHash);
    expect(after.judgments.human).toHaveLength(1);
    expect(after.judgments.ai).toHaveLength(1);
  });

  it("does not allow an independent judgment to be rewritten by the same actor", async () => {
    const { app } = build();
    const decisionCase = await createCase(app, "CONTRIBUTION");
    const first = await addHumanJudgment(app, decisionCase.id, REVIEWER);

    actAs(REVIEWER);
    const second = await post(
      app,
      `/api/v1/decision-cases/${decisionCase.id}/judgments`,
      {
        actorType: "HUMAN",
        actorId: REVIEWER,
        independentScores: { quality: 1 },
        independentRationale: "Attempted rewrite",
        dimensionStates: {},
        confidence: 0.2,
      },
    );
    expectConflict(second, "JUDGMENT_IMMUTABLE");

    // AI 建议同样一人一判，不因重复调用而覆盖。
    await addAiJudgment(app, decisionCase.id);
    actAs(ADMIN);
    const duplicateAi = await post(
      app,
      `/api/v1/decision-cases/${decisionCase.id}/judgments`,
      {
        actorType: "AI_MODEL",
        actorId: MODEL_ID,
        modelRef: MODEL_REF,
        independentScores: {},
        independentRationale: "Second model run",
        dimensionStates: {},
      },
    );
    expectConflict(duplicateAi, "JUDGMENT_IMMUTABLE");

    const stored = await detail(app, decisionCase.id);
    expect(stored.judgments.human).toHaveLength(1);
    expect(stored.judgments.human[0]?.id).toBe(first.id);
    expect(stored.judgments.human[0]?.independentRationale).toBe(
      first.independentRationale,
    );
    expect(stored.judgments.ai).toHaveLength(1);
  });

  it("rejects evidence whose content does not match the declared hash", async () => {
    const { app } = build();
    const decisionCase = await createCase(app);
    const content = { metric: "quality", value: 4 };
    const wrongHash = `sha256:${"0".repeat(64)}`;

    const mismatch = await addEvidence(app, decisionCase.id, {
      content,
      contentHash: wrongHash,
    });
    expectConflict(mismatch, "EVIDENCE_HASH_MISMATCH");

    const malformed = await addEvidence(app, decisionCase.id, {
      content,
      contentHash: "not-a-hash",
    });
    expect(malformed.statusCode).toBe(400);

    const accepted = await addEvidence(app, decisionCase.id, { content });
    expect(accepted.statusCode).toBe(201);

    // 同一来源 + 同一内容重复追加是冲突，不是第二条审计记录。
    const duplicate = await addEvidence(app, decisionCase.id, { content });
    expectConflict(duplicate, "EVIDENCE_ALREADY_RECORDED");

    const stored = await detail(app, decisionCase.id);
    expect(stored.evidence).toHaveLength(1);
    expect(stored.evidence[0]?.contentHash).toBe(decisionEvidenceHash(content));
  });

  it("requires a passing verification before deciding", async () => {
    const { app } = build();
    const decisionCase = await createCase(app, "APPEAL");
    await addHumanJudgment(app, decisionCase.id, REVIEWER);

    const missing = await decide(app, decisionCase.id, ADMIN);
    expectConflict(missing, "DECISION_VERIFICATION_REQUIRED");

    const failed = await recordVerification(app, decisionCase.id, {
      passed: false,
      verifiedBy: ADMIN,
      findings: [{ code: "EVIDENCE_GAP", detail: "missing source record" }],
    });
    expect(failed.statusCode).toBe(201);
    const rejected = await decide(app, decisionCase.id, ADMIN);
    expectConflict(rejected, "DECISION_VERIFICATION_NOT_PASSED");

    const passed = await recordVerification(app, decisionCase.id, {
      passed: true,
      verifiedBy: ADMIN,
    });
    expect(passed.statusCode).toBe(201);
    const allowed = await decide(app, decisionCase.id, ADMIN);
    expect(allowed.statusCode).toBe(200);
  });

  it("rejects self-decision when the decider submitted a human judgment", async () => {
    const { app } = build();
    const decisionCase = await createCase(app);
    await addHumanJudgment(app, decisionCase.id, ADMIN, "My own judgment");
    await recordVerification(app, decisionCase.id, { verifiedBy: REVIEWER });

    const self = await decide(app, decisionCase.id, ADMIN);
    expectConflict(self, "SELF_DECISION_FORBIDDEN");
    expect((await detail(app, decisionCase.id)).record).toBeUndefined();

    // 另一个未参与人工判断的授权人可以决定。
    const independent = await decide(app, decisionCase.id, THIRD);
    expect(independent.statusCode).toBe(200);
    expect(dataOf<RecordShape>(independent).decidedBy).toBe(THIRD);
  });

  it("does not let an AI suggestion become the decision", async () => {
    const { app } = build();
    const aiOnly = await createCase(app, "INCENTIVE_ELIGIBILITY");
    const ai = await addAiJudgment(app, aiOnly.id);
    await recordVerification(app, aiOnly.id, { verifiedBy: ADMIN });
    const noHuman = await decide(app, aiOnly.id, ADMIN);
    expectConflict(noHuman, "HUMAN_JUDGMENT_REQUIRED");

    const mixed = await createCase(app, "BUDGET");
    const human = await addHumanJudgment(app, mixed.id, REVIEWER);
    await addAiJudgment(app, mixed.id);
    await recordVerification(app, mixed.id, { verifiedBy: ADMIN });

    const aiAsFinal = await decide(app, mixed.id, ADMIN, {
      finalJudgmentId: ai.id,
    });
    expectConflict(aiAsFinal, "FINAL_JUDGMENT_MUST_BE_HUMAN");

    const humanAsFinal = await decide(app, mixed.id, ADMIN, {
      finalJudgmentId: human.id,
    });
    expect(humanAsFinal.statusCode).toBe(200);
  });

  it("freezes the final decision once recorded", async () => {
    const { app } = build();
    const decisionCase = await createCase(app);
    await addHumanJudgment(app, decisionCase.id, REVIEWER);
    await recordVerification(app, decisionCase.id, { verifiedBy: ADMIN });
    const first = await decide(app, decisionCase.id, ADMIN);
    expect(first.statusCode).toBe(200);
    const record = dataOf<RecordShape>(first);

    const second = await decide(app, decisionCase.id, ADMIN);
    expectConflict(second, "DECISION_RECORD_IMMUTABLE");

    const lateEvidence = await addEvidence(app, decisionCase.id, {
      sourceId: "wi-late",
      content: { metric: "late", value: 1 },
    });
    expectConflict(lateEvidence, "DECISION_CASE_NOT_MUTABLE");

    const lateVerification = await recordVerification(app, decisionCase.id, {
      verifiedBy: ADMIN,
    });
    expectConflict(lateVerification, "DECISION_CASE_NOT_MUTABLE");

    const stored = await detail(app, decisionCase.id);
    expect(stored.record?.id).toBe(record.id);
    expect(stored.record?.decidedAt).toBe(record.decidedAt);
    expect(stored.record?.rationale).toBe(record.rationale);
  });

  it("reuses the same chain for every decision kind without changing the invariants", async () => {
    const { app } = build();
    const kinds = [
      "PERFORMANCE",
      "CONTRIBUTION",
      "APPEAL",
      "INCENTIVE_ELIGIBILITY",
      "BUDGET",
    ];
    const decided: string[] = [];
    for (const kind of kinds) {
      const decisionCase = await createCase(app, kind, {
        subjectType: kind === "BUDGET" ? "BUDGET_POOL" : "WORK_PACKAGE",
        subjectId: `${kind.toLowerCase()}-subject`,
      });
      expect(decisionCase.kind).toBe(kind);
      await addHumanJudgment(app, decisionCase.id, REVIEWER);
      await recordVerification(app, decisionCase.id, { verifiedBy: ADMIN });
      const result = await decide(app, decisionCase.id, THIRD);
      expect(result.statusCode).toBe(200);
      expect(dataOf<RecordShape>(result).decidedBy).toBe(THIRD);
      decided.push(decisionCase.id);
    }
    expect(new Set(decided).size).toBe(kinds.length);
    for (const [index, caseId] of decided.entries()) {
      const stored = await detail(app, caseId);
      expect(stored.case.kind).toBe(kinds[index]);
      expect(stored.case.status).toBe("DECIDED");
      expect(stored.record?.decidedBy).toBe(THIRD);
    }
  });

  it("isolates decision cases by tenant", async () => {
    const { app, platformStore } = build();
    const decisionCase = await createCase(app);

    const tenantB = buildApp(
      () => new Store(TENANT_B),
      undefined,
      {
        async authenticate() {
          return {
            tenantId: TENANT_B,
            userId: ADMIN,
            personId: ADMIN,
            roles: [...ALL_ROLES],
          };
        },
      },
      platformStore,
    );
    const hidden = await get(
      tenantB,
      `/api/v1/decision-cases/${decisionCase.id}`,
    );
    expect(hidden.statusCode).toBe(404);
    expect(errorOf(hidden).code).toBe("RESOURCE_NOT_FOUND");

    const crossTenantEvidence = await post(
      tenantB,
      `/api/v1/decision-cases/${decisionCase.id}/evidence`,
      {
        sourceType: "WORK_ITEM",
        sourceId: "wi-cross",
        content: { metric: "cross" },
        contentHash: decisionEvidenceHash({ metric: "cross" }),
        supports: "FOR",
      },
    );
    expect(crossTenantEvidence.statusCode).toBe(404);
  });

  it("requires an authorized role and the authenticated identity to decide", async () => {
    const { app } = build();
    const decisionCase = await createCase(app);
    await addHumanJudgment(app, decisionCase.id, REVIEWER);
    await recordVerification(app, decisionCase.id, { verifiedBy: ADMIN });

    // 无 manager/finance/admin 角色 = 403，不进入存储层。
    actAs(THIRD, ["employee"]);
    const forbidden = await decide(
      app,
      decisionCase.id,
      THIRD,
      {},
      ["employee"],
    );
    expect(forbidden.statusCode).toBe(403);

    // 声称他人身份 = 403，不能借他人 id 绕过自决约束。
    actAs(THIRD);
    const impersonation = await post(
      app,
      `/api/v1/decision-cases/${decisionCase.id}/decide`,
      {
        decidedBy: REVIEWER,
        rationale: "Attempted impersonation",
      },
    );
    expect(impersonation.statusCode).toBe(403);
    expect((await detail(app, decisionCase.id)).record).toBeUndefined();
  });
});
