/**
 * JEV Decision Record（118）+ 服务端校验/版本绑定/AI 认证/业务引用（120）。
 *
 * 覆盖：
 * - 5 个 checker（Conflict / EvidenceIntegrity / Coverage / Rule / Freshness）的
 *   单元行为与整案 HTTP 行为；
 * - 服务端权威 passed（客户端提交 passed 直接 400）；
 * - verification 绑定 case.version / evidenceHash / judgmentsHash，追加证据或
 *   判断后 409 DECISION_STALE_VERIFICATION；
 * - AI_MODEL judgment 需要 x-decision-ai-token（env DECISION_AI_TOKEN）或
 *   platform_admin，普通业务 token 403 AI_JUDGMENT_FORBIDDEN；
 * - PERFORMANCE/CONTRIBUTION/APPEAL 空证据 409 EVIDENCE_REQUIRED，BUDGET 可 0；
 * - 业务对象通过 /link 引用 caseId，GET 详情回传 links；
 * - 人工/AI 分离（AI 只能建议、不能决定、不能被当作最终依据）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decisionEvidenceHash,
  decisionJudgmentsAggregateHash,
  decisionVerificationIsCurrent,
  runDecisionVerification,
  type DecisionCase,
  type DecisionEvidence,
  type DecisionJudgment,
} from "@anari/domain";
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
const AI_TOKEN = `jev-ai-${"x".repeat(40)}`;
const AI_TOKEN_HEADER = "x-decision-ai-token";

const ALL_ROLES = ["admin", "manager", "finance"];

type App = Awaited<ReturnType<typeof buildApp>>;

let actingPerson = ADMIN;
let actingRoles: string[] = [...ALL_ROLES];

function actAs(personId: string, roles: string[] = ALL_ROLES): void {
  actingPerson = personId;
  actingRoles = [...roles];
}

beforeEach(() => {
  process.env.DECISION_AI_TOKEN = AI_TOKEN;
  actAs(ADMIN);
});

afterEach(() => {
  delete process.env.DECISION_AI_TOKEN;
});

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
  content?: unknown;
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

interface CheckerShape {
  passed: boolean;
  findings: Array<{ code: string; checker: string }>;
  binding?: {
    caseVersion: number;
    evidenceHash: string;
    judgmentsHash: string;
  };
}

interface VerificationShape {
  id: string;
  caseId: string;
  checks: Record<string, CheckerShape>;
  findings: Array<{ code: string; checker: string }>;
  passed: boolean;
  verifiedBy: string;
  verifiedCaseVersion: number;
  evidenceHash: string;
  judgmentsHash: string;
  stale?: boolean;
}

interface LinkShape {
  id: string;
  caseId: string;
  resourceType: string;
  resourceId: string;
  note?: string;
  linkedBy: string;
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
  links: LinkShape[];
  record?: RecordShape;
}

interface ErrorShape {
  error: { code: string; message: string; details?: unknown };
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
        {
          id: REVIEWER,
          employeeCode: "E002",
          displayName: "Independent reviewer",
        },
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

function errorOf(result: InjectResult): ErrorShape["error"] {
  return (result.json() as ErrorShape).error;
}

function expectError(
  result: InjectResult,
  status: number,
  code: string,
): void {
  expect(result.statusCode).toBe(status);
  expect(errorOf(result).code).toBe(code);
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
    sourceType?: string;
    supports?: string;
    weight?: string | number;
  } = {},
): Promise<InjectResult> {
  const content =
    "content" in options ? options.content : { metric: "delivery", value: 4 };
  return post(app, `/api/v1/decision-cases/${caseId}/evidence`, {
    sourceType: options.sourceType ?? "WORK_ITEM",
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
  options: {
    actorId?: string;
    roles?: string[];
    token?: string | null;
    dimensionStates?: Record<string, unknown>;
  } = {},
): Promise<InjectResult> {
  actAs(ADMIN, options.roles ?? ALL_ROLES);
  const headers: Record<string, string> = {};
  if (options.token !== null) {
    headers[AI_TOKEN_HEADER] = options.token ?? AI_TOKEN;
  }
  return post(
    app,
    `/api/v1/decision-cases/${caseId}/judgments`,
    {
      actorType: "AI_MODEL",
      actorId: options.actorId ?? MODEL_ID,
      modelRef: MODEL_REF,
      independentScores: { quality: 3.8, delivery: 4.2 },
      independentRationale: "Model suggestion for reviewer consideration",
      dimensionStates: options.dimensionStates ?? {
        evidenceCoverage: "PARTIAL",
      },
      confidence: 0.64,
    },
    headers,
  );
}

async function addAiJudgmentOk(
  app: App,
  caseId: string,
  options: Parameters<typeof addAiJudgment>[2] = {},
): Promise<JudgmentShape> {
  const result = await addAiJudgment(app, caseId, options);
  expect(result.statusCode).toBe(201);
  return dataOf<JudgmentShape>(result);
}

async function recordVerification(
  app: App,
  caseId: string,
  options: {
    verifiedBy?: string;
    decidedBy?: string;
  } = {},
): Promise<InjectResult> {
  const verifiedBy = options.verifiedBy ?? ADMIN;
  actAs(verifiedBy);
  return post(app, `/api/v1/decision-cases/${caseId}/verify`, {
    verifiedBy,
    ...(options.decidedBy ? { decidedBy: options.decidedBy } : {}),
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

async function link(
  app: App,
  caseId: string,
  resourceType: string,
  resourceId = "eval-100",
  extra: Record<string, unknown> = {},
): Promise<InjectResult> {
  actAs(ADMIN);
  return post(app, `/api/v1/decision-cases/${caseId}/link`, {
    resourceType,
    resourceId,
    ...extra,
  });
}

async function detail(app: App, caseId: string): Promise<DetailShape> {
  const result = await get(app, `/api/v1/decision-cases/${caseId}`);
  expect(result.statusCode).toBe(200);
  return dataOf<DetailShape>(result);
}

/**
 * 一个满足 PERFORMANCE 覆盖要求的证据组合：两个独立来源 + 正反两面。
 */
async function addCoveredEvidence(
  app: App,
  caseId: string,
): Promise<void> {
  const forEvidence = await addEvidence(app, caseId, {
    sourceType: "WORK_ITEM",
    sourceId: "wi-for",
    supports: "FOR",
    content: { metric: "delivery", value: 5 },
  });
  expect(forEvidence.statusCode).toBe(201);
  const againstEvidence = await addEvidence(app, caseId, {
    sourceType: "SYSTEM_METRIC",
    sourceId: "metric-against",
    supports: "AGAINST",
    content: { metric: "quality", value: 2 },
  });
  expect(againstEvidence.statusCode).toBe(201);
}

function findingCodes(verification: VerificationShape): string[] {
  return verification.findings.map((finding) => finding.code);
}

// ---------------------------------------------------------------------------
// 纯函数级 checker 测试：即使 HTTP 路径无法制造“存储被篡改”，checker 本身
// 的行为也必须可单独验证。
// ---------------------------------------------------------------------------

const CREATED_AT = "2026-11-27T10:00:00.000Z";

function domainCase(overrides: Partial<DecisionCase> = {}): DecisionCase {
  return {
    id: "case-120",
    tenantId: TENANT,
    kind: "PERFORMANCE",
    subjectType: "WORK_PACKAGE",
    subjectId: "wp-120",
    context: {},
    status: "COLLECTING",
    version: 3,
    createdBy: ADMIN,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function domainEvidence(
  overrides: Partial<DecisionEvidence> & { content?: unknown } = {},
): DecisionEvidence {
  const content = "content" in overrides ? overrides.content : { value: 1 };
  return {
    id: overrides.id ?? `evidence-${Math.random().toString(16).slice(2)}`,
    tenantId: TENANT,
    caseId: "case-120",
    sourceType: overrides.sourceType ?? "WORK_ITEM",
    sourceId: overrides.sourceId ?? "wi-1",
    contentHash: overrides.contentHash ?? decisionEvidenceHash(content),
    supports: overrides.supports ?? "FOR",
    content,
    createdAt: overrides.createdAt ?? CREATED_AT,
  };
}

function domainJudgment(
  overrides: Partial<DecisionJudgment> = {},
): DecisionJudgment {
  return {
    id: overrides.id ?? `judgment-${Math.random().toString(16).slice(2)}`,
    tenantId: TENANT,
    caseId: "case-120",
    actorType: "HUMAN",
    actorId: REVIEWER,
    independentScores: { quality: 4 },
    independentRationale: "Independent review",
    dimensionStates: {},
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe("JEV decision verification checkers (120)", () => {
  it("ConflictChecker rejects a decider who is a HUMAN judgment actor or an AI actor", () => {
    const human = domainJudgment({ actorId: REVIEWER });
    const ai = domainJudgment({
      actorType: "AI_MODEL",
      actorId: MODEL_ID,
      modelRef: MODEL_REF,
    });
    const evidence = [
      domainEvidence({ sourceType: "WORK_ITEM", supports: "FOR" }),
      domainEvidence({ sourceType: "SYSTEM_METRIC", supports: "AGAINST" }),
    ];

    const self = runDecisionVerification({
      case: domainCase(),
      evidence,
      judgments: [human],
      decidedBy: REVIEWER,
    });
    expect(self.checks.ConflictChecker.passed).toBe(false);
    expect(self.findings.map((finding) => finding.code)).toContain(
      "SELF_DECISION_FORBIDDEN",
    );

    const aiDecider = runDecisionVerification({
      case: domainCase(),
      evidence,
      judgments: [human, ai],
      decidedBy: MODEL_ID,
    });
    expect(aiDecider.checks.ConflictChecker.passed).toBe(false);
    expect(aiDecider.findings.map((finding) => finding.code)).toContain(
      "AI_MODEL_CANNOT_DECIDE",
    );

    const clean = runDecisionVerification({
      case: domainCase(),
      evidence,
      judgments: [human, ai],
      decidedBy: THIRD,
    });
    expect(clean.checks.ConflictChecker.passed).toBe(true);
  });

  it("EvidenceIntegrityChecker recomputes every content_hash and requires directional evidence", () => {
    const tampered = domainEvidence({
      content: { value: 1 },
      contentHash: decisionEvidenceHash({ value: 999 }),
    });
    const result = runDecisionVerification({
      case: domainCase(),
      evidence: [tampered],
      judgments: [domainJudgment()],
    });
    expect(result.checks.EvidenceIntegrityChecker.passed).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain(
      "EVIDENCE_HASH_MISMATCH",
    );

    const empty = runDecisionVerification({
      case: domainCase({ kind: "APPEAL" }),
      evidence: [],
      judgments: [domainJudgment()],
    });
    expect(empty.findings.map((finding) => finding.code)).toContain(
      "EVIDENCE_REQUIRED",
    );

    const budget = runDecisionVerification({
      case: domainCase({ kind: "BUDGET" }),
      evidence: [],
      judgments: [domainJudgment()],
    });
    expect(budget.checks.EvidenceIntegrityChecker.passed).toBe(true);

    const legacy = runDecisionVerification({
      case: domainCase(),
      evidence: [
        domainEvidence({ sourceType: "WORK_ITEM" }),
        domainEvidence({ sourceType: "SYSTEM_METRIC", content: undefined }),
      ],
      judgments: [domainJudgment()],
    });
    expect(legacy.findings.map((finding) => finding.code)).toContain(
      "EVIDENCE_CONTENT_MISSING",
    );
  });

  it("CoverageChecker requires two independent source types and both sides or an explicit gap", () => {
    const thin = runDecisionVerification({
      case: domainCase(),
      evidence: [domainEvidence({ sourceType: "WORK_ITEM", supports: "FOR" })],
      judgments: [domainJudgment()],
    });
    expect(thin.checks.CoverageChecker.passed).toBe(false);
    expect(thin.findings.map((finding) => finding.code)).toContain(
      "EVIDENCE_SOURCE_COVERAGE_INSUFFICIENT",
    );
    expect(thin.findings.map((finding) => finding.code)).toContain(
      "COVERAGE_MISSING_AGAINST",
    );

    const declared = runDecisionVerification({
      case: domainCase({
        context: {
          missingEvidence: [
            { supports: "AGAINST", reason: "no counter-evidence in source system" },
          ],
        },
      }),
      evidence: [
        domainEvidence({ sourceType: "WORK_ITEM", supports: "FOR" }),
        domainEvidence({ sourceType: "SYSTEM_METRIC", supports: "FOR" }),
      ],
      judgments: [domainJudgment()],
    });
    expect(declared.checks.CoverageChecker.passed).toBe(true);
  });

  it("RuleChecker requires a human judgment and a mutable legal status", () => {
    const aiOnly = runDecisionVerification({
      case: domainCase({ kind: "INCENTIVE_ELIGIBILITY" }),
      evidence: [],
      judgments: [
        domainJudgment({
          actorType: "AI_MODEL",
          actorId: MODEL_ID,
          modelRef: MODEL_REF,
        }),
      ],
    });
    expect(aiOnly.checks.RuleChecker.passed).toBe(false);
    expect(aiOnly.findings.map((finding) => finding.code)).toContain(
      "HUMAN_JUDGMENT_REQUIRED",
    );

    const decided = runDecisionVerification({
      case: domainCase({ status: "DECIDED" }),
      evidence: [
        domainEvidence({ sourceType: "WORK_ITEM" }),
        domainEvidence({ sourceType: "SYSTEM_METRIC", supports: "AGAINST" }),
      ],
      judgments: [domainJudgment()],
    });
    expect(decided.checks.RuleChecker.passed).toBe(false);
    expect(decided.findings.map((finding) => finding.code)).toContain(
      "DECISION_CASE_NOT_MUTABLE",
    );
  });

  it("FreshnessChecker binds version/evidenceHash/judgmentsHash and any fact change invalidates it", () => {
    const evidence = [
      domainEvidence({ id: "e1", sourceType: "WORK_ITEM", supports: "FOR" }),
      domainEvidence({
        id: "e2",
        sourceType: "SYSTEM_METRIC",
        supports: "AGAINST",
      }),
    ];
    const judgments = [domainJudgment({ id: "j1" })];
    const first = runDecisionVerification({
      case: domainCase({ version: 7 }),
      evidence,
      judgments,
    });
    expect(first.checks.FreshnessChecker.passed).toBe(true);
    expect(first.checks.FreshnessChecker.binding).toEqual(first.binding);
    expect(first.binding.caseVersion).toBe(8);
    expect(first.binding.evidenceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.binding.judgmentsHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const nextJudgment = domainJudgment({
      id: "j2",
      actorId: THIRD,
      independentRationale: "Second independent review",
    });
    const second = runDecisionVerification({
      case: domainCase({ version: 9 }),
      evidence,
      judgments: [...judgments, nextJudgment],
    });
    expect(second.binding.judgmentsHash).not.toBe(first.binding.judgmentsHash);
    expect(
      decisionJudgmentsAggregateHash([...judgments, nextJudgment]),
    ).toBe(second.binding.judgmentsHash);

    expect(
      decisionVerificationIsCurrent(
        {
          verifiedCaseVersion: first.binding.caseVersion,
          evidenceHash: first.binding.evidenceHash,
          judgmentsHash: first.binding.judgmentsHash,
        },
        {
          caseVersion: 9,
          evidenceHash: first.binding.evidenceHash,
          judgmentsHash: first.binding.judgmentsHash,
        },
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTTP 集成测试。
// ---------------------------------------------------------------------------

describe("JEV decision record HTTP (118 + 120)", () => {
  it("runs all five server-side checkers and records an immutable decision", async () => {
    const { app } = build();
    const decisionCase = await createCase(app);
    await addCoveredEvidence(app, decisionCase.id);
    const ai = await addAiJudgmentOk(app, decisionCase.id);
    const human = await addHumanJudgment(app, decisionCase.id, REVIEWER);

    const verifyResult = await recordVerification(app, decisionCase.id);
    expect(verifyResult.statusCode).toBe(201);
    const verification = dataOf<VerificationShape>(verifyResult);
    expect(verification.passed).toBe(true);
    expect(Object.keys(verification.checks).sort()).toEqual([
      "ConflictChecker",
      "CoverageChecker",
      "EvidenceIntegrityChecker",
      "FreshnessChecker",
      "RuleChecker",
    ]);
    expect(verification.findings).toEqual([]);
    expect(verification.verifiedCaseVersion).toBeGreaterThan(
      decisionCase.version,
    );
    expect(verification.evidenceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verification.judgmentsHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const before = await detail(app, decisionCase.id);
    expect(before.case.status).toBe("READY");
    expect(before.verifications[0]?.stale).toBe(false);
    expect(before.judgments.human.map((entry) => entry.id)).toEqual([
      human.id,
    ]);
    expect(before.judgments.ai.map((entry) => entry.id)).toEqual([ai.id]);

    const decisionResult = await decide(app, decisionCase.id, THIRD);
    expect(decisionResult.statusCode).toBe(200);
    const record = dataOf<RecordShape>(decisionResult);
    expect(record.finalJudgmentId).toBe(human.id);
    expect(record.decidedBy).toBe(THIRD);
    expect(record.evidenceHash).toBe(verification.evidenceHash);
    expect(record.version).toBe(verification.verifiedCaseVersion + 1);

    const after = await detail(app, decisionCase.id);
    expect(after.case.status).toBe("DECIDED");
    expect(after.record?.id).toBe(record.id);
    // 决定后事实不再变化：刚通过的那次校验不应被误标为过期。
    expect(after.verifications.at(-1)?.stale).toBe(false);
  });

  it("ignores a client-declared passed result in both directions", async () => {
    // 合法案件 + 客户端谎报 passed=false：服务端仍以 5 个 checker 判定通过。
    const { app } = build();
    const valid = await createCase(app, "BUDGET");
    await addHumanJudgment(app, valid.id, REVIEWER);
    actAs(ADMIN);
    const forcedFail = await post(
      app,
      `/api/v1/decision-cases/${valid.id}/verify`,
      {
        verifiedBy: ADMIN,
        passed: false,
        checks: { conflictOfInterest: "CONFLICT" },
        findings: [{ code: "FORGED_FAILURE" }],
      },
    );
    expect(forcedFail.statusCode).toBe(201);
    expect(dataOf<VerificationShape>(forcedFail).passed).toBe(true);
    expect(findingCodes(dataOf<VerificationShape>(forcedFail))).toEqual([]);

    // 空证据案件 + 客户端谎报 passed=true：服务端仍然 409。
    const invalid = await createCase(app, "PERFORMANCE");
    await addHumanJudgment(app, invalid.id, REVIEWER);
    actAs(ADMIN);
    const forcedPass = await post(
      app,
      `/api/v1/decision-cases/${invalid.id}/verify`,
      {
        verifiedBy: ADMIN,
        passed: true,
        checks: { conflictOfInterest: "NONE" },
        findings: [],
      },
    );
    expect(forcedPass.statusCode).toBe(409);
    expect(errorOf(forcedPass).code).toBe("DECISION_VERIFICATION_FAILED");
    const stored = await detail(app, invalid.id);
    expect(stored.verifications).toHaveLength(1);
    expect(stored.verifications[0]?.passed).toBe(false);
  });

  it("rejects a failing verification with 409 DECISION_VERIFICATION_FAILED and keeps an audit row", async () => {
    const { app } = build();
    const decisionCase = await createCase(app, "PERFORMANCE");
    await addHumanJudgment(app, decisionCase.id, REVIEWER);

    const failed = await recordVerification(app, decisionCase.id);
    expect(failed.statusCode).toBe(409);
    const error = errorOf(failed);
    expect(error.code).toBe("DECISION_VERIFICATION_FAILED");
    const details = error.details as {
      passed: boolean;
      checks: Record<string, CheckerShape>;
      findings: Array<{ code: string }>;
    };
    expect(details.passed).toBe(false);
    expect(details.checks.EvidenceIntegrityChecker?.passed).toBe(false);
    expect(details.findings.map((finding) => finding.code)).toContain(
      "EVIDENCE_REQUIRED",
    );

    const stored = await detail(app, decisionCase.id);
    expect(stored.verifications).toHaveLength(1);
    expect(stored.verifications[0]?.passed).toBe(false);
    expect(stored.case.status).toBe("COLLECTING");
    expect(stored.record).toBeUndefined();

    const decideEmpty = await decide(app, decisionCase.id, ADMIN);
    expectError(decideEmpty, 409, "EVIDENCE_REQUIRED");
  });

  it("allows a zero-evidence BUDGET / INCENTIVE_ELIGIBILITY decision but not PERFORMANCE/CONTRIBUTION/APPEAL", async () => {
    for (const kind of [
      "PERFORMANCE",
      "CONTRIBUTION",
      "APPEAL",
    ] as const) {
      const { app } = build();
      const decisionCase = await createCase(app, kind);
      await addHumanJudgment(app, decisionCase.id, REVIEWER);
      const verify = await recordVerification(app, decisionCase.id);
      expect(verify.statusCode).toBe(409);
      expect(errorOf(verify).code).toBe("DECISION_VERIFICATION_FAILED");
      expect(
        JSON.stringify(errorOf(verify).details),
      ).toContain("EVIDENCE_REQUIRED");
      const decideResult = await decide(app, decisionCase.id, ADMIN);
      expectError(decideResult, 409, "EVIDENCE_REQUIRED");
    }

    for (const kind of ["BUDGET", "INCENTIVE_ELIGIBILITY"] as const) {
      const { app } = build();
      const decisionCase = await createCase(app, kind);
      await addHumanJudgment(app, decisionCase.id, REVIEWER);
      const verify = await recordVerification(app, decisionCase.id);
      expect(verify.statusCode).toBe(201);
      const decisionResult = await decide(app, decisionCase.id, THIRD);
      expect(decisionResult.statusCode).toBe(200);
    }
  });

  it("recomputes evidence whose content is JSON null", async () => {
    const { app } = build();
    const decisionCase = await createCase(app, "BUDGET");
    const evidence = await addEvidence(app, decisionCase.id, {
      content: null,
      sourceType: "WORK_ITEM",
      sourceId: "wi-null-content",
      supports: "FOR",
    });
    expect(evidence.statusCode).toBe(201);
    expect(dataOf<EvidenceShape>(evidence).contentHash).toBe(
      decisionEvidenceHash(null),
    );
    await addHumanJudgment(app, decisionCase.id, REVIEWER);
    expect(
      (await recordVerification(app, decisionCase.id)).statusCode,
    ).toBe(201);
    expect((await decide(app, decisionCase.id, THIRD)).statusCode).toBe(200);
  });

  it("blocks PERFORMANCE until two independent sources cover both sides (or an explicit gap)", async () => {
    const { app } = build();
    const decisionCase = await createCase(app);
    const onlyFor = await addEvidence(app, decisionCase.id, {
      sourceType: "WORK_ITEM",
      sourceId: "wi-only-for",
      supports: "FOR",
    });
    expect(onlyFor.statusCode).toBe(201);
    await addHumanJudgment(app, decisionCase.id, REVIEWER);

    const failed = await recordVerification(app, decisionCase.id);
    expect(failed.statusCode).toBe(409);
    const details = errorOf(failed).details as {
      checks: Record<string, CheckerShape>;
    };
    expect(details.checks.CoverageChecker?.passed).toBe(false);
    expect(
      JSON.stringify(errorOf(failed).details),
    ).toContain("COVERAGE_MISSING_AGAINST");

    const second = await addEvidence(app, decisionCase.id, {
      sourceType: "SYSTEM_METRIC",
      sourceId: "metric-against",
      supports: "AGAINST",
    });
    expect(second.statusCode).toBe(201);
    const passed = await recordVerification(app, decisionCase.id);
    expect(passed.statusCode).toBe(201);
    expect((await decide(app, decisionCase.id, THIRD)).statusCode).toBe(200);
  });

  it("expires a verification when evidence is appended after it (DECISION_STALE_VERIFICATION)", async () => {
    const { app } = build();
    const decisionCase = await createCase(app);
    await addCoveredEvidence(app, decisionCase.id);
    await addHumanJudgment(app, decisionCase.id, REVIEWER);
    const verification = await recordVerification(app, decisionCase.id);
    expect(verification.statusCode).toBe(201);

    const lateEvidence = await addEvidence(app, decisionCase.id, {
      sourceType: "AUDIT_LOG",
      sourceId: "audit-late",
      supports: "FOR",
      content: { metric: "late", value: 1 },
    });
    expect(lateEvidence.statusCode).toBe(201);

    const stale = await decide(app, decisionCase.id, ADMIN);
    expectError(stale, 409, "DECISION_STALE_VERIFICATION");
    const stored = await detail(app, decisionCase.id);
    expect(stored.verifications.at(-1)?.stale).toBe(true);
    expect(stored.record).toBeUndefined();

    // 重新校验后可以决定。
    const reverified = await recordVerification(app, decisionCase.id);
    expect(reverified.statusCode).toBe(201);
    const decisionResult = await decide(app, decisionCase.id, THIRD);
    expect(decisionResult.statusCode).toBe(200);
  });

  it("expires a verification when a judgment is added after it", async () => {
    const { app } = build();
    const decisionCase = await createCase(app);
    await addCoveredEvidence(app, decisionCase.id);
    await addHumanJudgment(app, decisionCase.id, REVIEWER);
    expect(
      (await recordVerification(app, decisionCase.id)).statusCode,
    ).toBe(201);

    await addHumanJudgment(
      app,
      decisionCase.id,
      THIRD,
      "Second independent reviewer",
    );
    const stale = await decide(app, decisionCase.id, ADMIN);
    expectError(stale, 409, "DECISION_STALE_VERIFICATION");
  });

  it("requires x-decision-ai-token (>=32 chars) or platform_admin for AI_MODEL judgments", async () => {
    const { app } = build();
    const decisionCase = await createCase(app, "BUDGET");

    // 普通业务 token / 无 token：403 AI_JUDGMENT_FORBIDDEN。
    actAs(ADMIN);
    const missing = await addAiJudgment(app, decisionCase.id, { token: null });
    expectError(missing, 403, "AI_JUDGMENT_FORBIDDEN");

    actAs(ADMIN);
    const wrong = await addAiJudgment(app, decisionCase.id, {
      token: `${"y".repeat(40)}`,
    });
    expectError(wrong, 403, "AI_JUDGMENT_FORBIDDEN");

    // 配置值不足 32 字符：即使 header 完全一致也拒绝。
    const previous = process.env.DECISION_AI_TOKEN;
    process.env.DECISION_AI_TOKEN = "too-short";
    actAs(ADMIN);
    const short = await addAiJudgment(app, decisionCase.id, {
      token: "too-short",
    });
    expectError(short, 403, "AI_JUDGMENT_FORBIDDEN");
    process.env.DECISION_AI_TOKEN = previous;

    // 正确 token 放行。
    const allowed = await addAiJudgment(app, decisionCase.id, {
      actorId: MODEL_ID,
    });
    expect(allowed.statusCode).toBe(201);

    // platform_admin 不需要 token。
    const platformCase = await createCase(app, "BUDGET");
    const platformAdmin = await addAiJudgment(app, platformCase.id, {
      actorId: "model-platform-run",
      roles: ["platform_admin"],
      token: null,
    });
    expect(platformAdmin.statusCode).toBe(201);
  });

  it("keeps human judgment and AI suggestions separate and never lets AI authorize a decision", async () => {
    const { app } = build();
    const decisionCase = await createCase(app, "BUDGET");

    // AI actor 与授权人同 id：decide 必须拒绝。
    await addAiJudgmentOk(app, decisionCase.id, { actorId: ADMIN });
    const human = await addHumanJudgment(app, decisionCase.id, REVIEWER);
    expect(
      (await recordVerification(app, decisionCase.id)).statusCode,
    ).toBe(201);

    const aiAsDecider = await decide(app, decisionCase.id, ADMIN);
    expectError(aiAsDecider, 409, "AI_MODEL_CANNOT_DECIDE");

    // finalJudgmentId 指向 AI judgment：拒绝。
    const aiJudgment = (await detail(app, decisionCase.id)).judgments.ai[0]!;
    const aiAsFinal = await decide(app, decisionCase.id, THIRD, {
      finalJudgmentId: aiJudgment.id,
    });
    expectError(aiAsFinal, 409, "FINAL_JUDGMENT_MUST_BE_HUMAN");

    // 合法人工决定。
    const allowed = await decide(app, decisionCase.id, THIRD, {
      finalJudgmentId: human.id,
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("rejects self-decision when the decider submitted a human judgment", async () => {
    const { app } = build();
    const decisionCase = await createCase(app, "BUDGET");
    await addHumanJudgment(app, decisionCase.id, ADMIN, "My own judgment");
    expect(
      (await recordVerification(app, decisionCase.id, {
        decidedBy: ADMIN,
      })).statusCode,
    ).toBe(409);
    // verify 阶段已用拟授权人预检利益冲突；换未参与判断的人校验可过。
    expect(
      (await recordVerification(app, decisionCase.id, {
        verifiedBy: REVIEWER,
      })).statusCode,
    ).toBe(201);

    const self = await decide(app, decisionCase.id, ADMIN);
    expectError(self, 409, "SELF_DECISION_FORBIDDEN");
    expect((await detail(app, decisionCase.id)).record).toBeUndefined();

    const independent = await decide(app, decisionCase.id, THIRD);
    expect(independent.statusCode).toBe(200);
  });

  it("links business objects to a case and returns them from GET", async () => {
    const { app } = build();
    const decisionCase = await createCase(app, "PERFORMANCE");

    const created = await link(
      app,
      decisionCase.id,
      "PERFORMANCE_EVALUATION",
      "eval-2026-q4-100",
      { note: "official score-from-facts result" },
    );
    expect(created.statusCode).toBe(201);
    const linkRow = dataOf<LinkShape>(created);
    expect(linkRow.caseId).toBe(decisionCase.id);
    expect(linkRow.resourceType).toBe("PERFORMANCE_EVALUATION");
    expect(linkRow.linkedBy).toBe(ADMIN);

    const stored = await detail(app, decisionCase.id);
    expect(stored.links.map((entry) => entry.resourceId)).toEqual([
      "eval-2026-q4-100",
    ]);

    const duplicate = await link(
      app,
      decisionCase.id,
      "PERFORMANCE_EVALUATION",
      "eval-2026-q4-100",
    );
    expectError(duplicate, 409, "DECISION_LINK_ALREADY_RECORDED");

    const mismatch = await link(
      app,
      decisionCase.id,
      "CONTRIBUTION_ASSESSMENT",
      "contrib-1",
    );
    expectError(mismatch, 409, "DECISION_LINK_KIND_MISMATCH");

    const contributionCase = await createCase(app, "CONTRIBUTION");
    expect(
      (
        await link(
          app,
          contributionCase.id,
          "CONTRIBUTION_ASSESSMENT",
          "contrib-1",
        )
      ).statusCode,
    ).toBe(201);
    const appealCase = await createCase(app, "APPEAL");
    expect(
      (await link(app, appealCase.id, "APPEAL", "appeal-1")).statusCode,
    ).toBe(201);
    const eligibilityCase = await createCase(
      app,
      "INCENTIVE_ELIGIBILITY",
    );
    expect(
      (
        await link(
          app,
          eligibilityCase.id,
          "INCENTIVE_ELIGIBILITY",
          "eligibility-1",
        )
      ).statusCode,
    ).toBe(201);
  });

  it("isolates decision cases, judgments, verifications and links by tenant", async () => {
    const { app, platformStore } = build();
    const decisionCase = await createCase(app);
    await addCoveredEvidence(app, decisionCase.id);
    await addHumanJudgment(app, decisionCase.id, REVIEWER);
    expect(
      (await recordVerification(app, decisionCase.id)).statusCode,
    ).toBe(201);
    expect(
      (
        await link(
          app,
          decisionCase.id,
          "PERFORMANCE_EVALUATION",
          "eval-tenant-a",
        )
      ).statusCode,
    ).toBe(201);

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

    const crossTenantLink = await post(
      tenantB,
      `/api/v1/decision-cases/${decisionCase.id}/link`,
      {
        resourceType: "PERFORMANCE_EVALUATION",
        resourceId: "eval-cross",
      },
    );
    expect(crossTenantLink.statusCode).toBe(404);
  });

  it("freezes the final decision once recorded", async () => {
    const { app } = build();
    const decisionCase = await createCase(app, "BUDGET");
    await addHumanJudgment(app, decisionCase.id, REVIEWER);
    expect(
      (await recordVerification(app, decisionCase.id)).statusCode,
    ).toBe(201);
    const first = await decide(app, decisionCase.id, ADMIN);
    expect(first.statusCode).toBe(200);
    const record = dataOf<RecordShape>(first);

    const second = await decide(app, decisionCase.id, ADMIN);
    expectError(second, 409, "DECISION_RECORD_IMMUTABLE");

    const lateEvidence = await addEvidence(app, decisionCase.id, {
      sourceId: "wi-late",
      content: { metric: "late", value: 1 },
    });
    expectError(lateEvidence, 409, "DECISION_CASE_NOT_MUTABLE");

    const lateVerification = await recordVerification(app, decisionCase.id, {
      verifiedBy: ADMIN,
    });
    expectError(lateVerification, 409, "DECISION_CASE_NOT_MUTABLE");

    const stored = await detail(app, decisionCase.id);
    expect(stored.record?.id).toBe(record.id);
    expect(stored.record?.decidedAt).toBe(record.decidedAt);
    expect(stored.record?.rationale).toBe(record.rationale);
  });

  it("requires an authorized role and the authenticated identity to decide", async () => {
    const { app } = build();
    const decisionCase = await createCase(app, "BUDGET");
    await addHumanJudgment(app, decisionCase.id, REVIEWER);
    expect(
      (await recordVerification(app, decisionCase.id)).statusCode,
    ).toBe(201);

    actAs(THIRD, ["employee"]);
    const forbidden = await decide(
      app,
      decisionCase.id,
      THIRD,
      {},
      ["employee"],
    );
    expect(forbidden.statusCode).toBe(403);

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
