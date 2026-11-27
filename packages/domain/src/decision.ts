/**
 * JEV Decision Record（通用决策记录，2026-11-27）。
 *
 * 绩效、贡献、申诉、激励资格与预算争议共用同一条决策链路：
 *
 *   decision_cases（案件：kind 复用，不按业务另建表）
 *     ├── decision_evidence（证据，append-only，content_hash 承诺）
 *     ├── decision_judgments（独立判断：HUMAN / AI_MODEL，一人一判，不改写）
 *     ├── decision_verifications（校验：利益冲突 / 证据覆盖 / 规则）
 *     └── decision_records（最终决定：一案一条，不可改）
 *
 * 关键约束（与迁移 118 和 API 路由共同实现）：
 * - 判定主体只有两类：人工（HUMAN）与 AI 建议（AI_MODEL）；AI 只能建议，
 *   最终决定必须由与全部人工判断者不同的人授权；
 * - 证据 hash 是内容承诺：追加时重新计算并比对，不一致直接拒绝；
 * - 判断 append-only：同一 (case, actorType, actorId) 只有一条，永不覆盖；
 * - 校验不通过（interest conflict / evidence coverage / rule）不得决定；
 * - record 一案一条，重复决定必须 409，历史决定不能被改写。
 *
 * 本模块只定义规范模型与纯函数，不依赖 HTTP 或存储；memory / postgres
 * adapter 共享同一套 hash、状态与最终判断选择规则。
 */

import { createHash } from "node:crypto";

export const DECISION_CASE_KINDS = [
  "PERFORMANCE",
  "CONTRIBUTION",
  "APPEAL",
  "INCENTIVE_ELIGIBILITY",
  "BUDGET",
] as const;
export type DecisionCaseKind = (typeof DECISION_CASE_KINDS)[number];

export const DECISION_CASE_STATUSES = [
  "DRAFT",
  "COLLECTING",
  "READY",
  "DECIDED",
  "CANCELLED",
] as const;
export type DecisionCaseStatus = (typeof DECISION_CASE_STATUSES)[number];

export const DECISION_EVIDENCE_SUPPORTS = ["FOR", "AGAINST", "NEUTRAL"] as const;
export type DecisionEvidenceSupport =
  (typeof DECISION_EVIDENCE_SUPPORTS)[number];

export const DECISION_JUDGMENT_ACTOR_TYPES = ["HUMAN", "AI_MODEL"] as const;
export type DecisionJudgmentActorType =
  (typeof DECISION_JUDGMENT_ACTOR_TYPES)[number];

/** 任意 JSON 对象；具体维度由各 kind 的决策模板定义。 */
export type DecisionJsonObject = Record<string, unknown>;

export interface DecisionCase {
  id: string;
  tenantId: string;
  /** 复用同一决策模型解决的五类争议。 */
  kind: DecisionCaseKind;
  /** 被决策对象类型（如 WORK_PACKAGE / ORDER / PERSON），不限定枚举。 */
  subjectType: string;
  /** 被决策对象 id；允许外部系统标识，因此是字符串而不是 uuid。 */
  subjectId: string;
  /** 业务上下文快照（周期、金额、政策版本等）。 */
  context: DecisionJsonObject;
  status: DecisionCaseStatus;
  /** 案件变更计数；决定时冻结进 record.version。 */
  version: number;
  createdBy: string;
  createdAt: string;
}

/**
 * 证据内容承诺（content_hash）+ 服务端复核副本。
 *
 * 120 起服务端保留 canonical JSON 文本作为复核副本，校验时重算 hash，避免
 * 只有承诺没有可验证对象；详情接口默认不返回 content，原始内容仍归来源系统。
 */
export interface DecisionEvidence {
  id: string;
  tenantId: string;
  caseId: string;
  sourceType: string;
  sourceId: string;
  /** `sha256:<hex>`；追加时由服务端重新计算校验。 */
  contentHash: string;
  supports: DecisionEvidenceSupport;
  /** 可选相对权重；不使用浮点金额，保持 decimal string 约定。 */
  weight?: string;
  /** 服务端复核副本；仅用于 EvidenceIntegrityChecker，不对外返回。 */
  content?: unknown;
  createdAt: string;
}

/**
 * 独立判断：AI 与人工同表，但 actorType 区分，且永远不相互覆盖。
 * 同一 actor（actorType + actorId）在同一个 case 上只能有一判。
 */
export interface DecisionJudgment {
  id: string;
  tenantId: string;
  caseId: string;
  actorType: DecisionJudgmentActorType;
  /** HUMAN 时为人员 id；AI_MODEL 时为模型标识。 */
  actorId: string;
  /** AI 建议必须可追溯到具体模型/版本；人工判断可空。 */
  modelRef?: string;
  /** 各维度独立打分（不与其他 judgment 合并）。 */
  independentScores: DecisionJsonObject;
  independentRationale: string;
  /** 维度状态（如 integrity: PASS / coverage: PARTIAL）。 */
  dimensionStates: DecisionJsonObject;
  /** 判断者自信度 0..1；只作参考，不参与加权。 */
  confidence?: number;
  createdAt: string;
}

export interface DecisionVerification {
  id: string;
  tenantId: string;
  caseId: string;
  /** 5 个 checker 的机器可读结果（Conflict/EvidenceIntegrity/Coverage/Rule/Freshness）。 */
  checks: DecisionJsonObject;
  /** 发现项：每条至少包含 code，由调用方扩展。 */
  findings: DecisionJsonObject[];
  passed: boolean;
  verifiedBy: string;
  /**
   * FreshnessChecker 绑定：校验完成时案件的新版本（校验本身会 +1）。
   * 之后任何证据/判断写入都会推进版本，使这条校验失效。
   */
  verifiedCaseVersion: number;
  /** 校验时全部证据 content_hash 的聚合承诺。 */
  evidenceHash: string;
  /** 校验时全部判断（人工 + AI）的聚合承诺。 */
  judgmentsHash: string;
  /** 读取时派生：绑定是否仍与当前案件一致（不落库，不改写审计行）。 */
  stale?: boolean;
  verifiedAt: string;
}

/** 一案一条，不可改；version 冻结决定时的案件版本。 */
export interface DecisionRecord {
  id: string;
  tenantId: string;
  caseId: string;
  finalJudgmentId: string;
  decidedBy: string;
  rationale: string;
  /** 决定时全部证据 content_hash 的聚合承诺。 */
  evidenceHash: string;
  version: number;
  decidedAt: string;
}

/** 业务对象引用 caseId 的唯一入口（不强行改绩效/贡献/申诉现有路由）。 */
export const DECISION_LINK_RESOURCE_TYPES = [
  "PERFORMANCE_EVALUATION",
  "CONTRIBUTION_ASSESSMENT",
  "APPEAL",
  "INCENTIVE_ELIGIBILITY",
  "BUDGET",
] as const;
export type DecisionLinkResourceType =
  (typeof DECISION_LINK_RESOURCE_TYPES)[number];

/** 业务资源类型 ↔ 唯一允许的 case kind。 */
export const DECISION_LINK_KIND_BY_RESOURCE_TYPE: Record<
  DecisionLinkResourceType,
  DecisionCaseKind
> = {
  PERFORMANCE_EVALUATION: "PERFORMANCE",
  CONTRIBUTION_ASSESSMENT: "CONTRIBUTION",
  APPEAL: "APPEAL",
  INCENTIVE_ELIGIBILITY: "INCENTIVE_ELIGIBILITY",
  BUDGET: "BUDGET",
};

export interface DecisionCaseLink {
  id: string;
  tenantId: string;
  caseId: string;
  resourceType: DecisionLinkResourceType;
  /** 业务对象 id；允许外部系统标识，因此是字符串。 */
  resourceId: string;
  note?: string;
  linkedBy: string;
  linkedAt: string;
}

export interface LinkDecisionCaseInput {
  tenantId: string;
  caseId: string;
  resourceType: DecisionLinkResourceType;
  resourceId: string;
  note?: string;
  linkedBy: string;
}

export interface DecisionCaseDetail {
  case: DecisionCase;
  evidence: DecisionEvidence[];
  /** 人工判断与 AI 建议严格分开返回，避免前端把建议当决定。 */
  judgments: {
    human: DecisionJudgment[];
    ai: DecisionJudgment[];
  };
  verifications: DecisionVerification[];
  /** 引用该 caseId 的业务对象（评价/贡献/申诉/资格/预算）。 */
  links: DecisionCaseLink[];
  record?: DecisionRecord;
}

export interface CreateDecisionCaseInput {
  tenantId: string;
  kind: DecisionCaseKind;
  subjectType: string;
  subjectId: string;
  context?: DecisionJsonObject;
  createdBy: string;
  /**
   * 可选的调用方生成 id（幂等建案）。
   *
   * 122 起 (tenant_id, kind, subject_type, subject_id) 只有一条活跃案件：
   * 并发/重试插入时 adapter 返回已有案件而不是再开一案。调用方如果自己
   * 生成 id，可以用「返回的 id 是否等于自己提交的 id」判断本次调用是否
   * 真的创建了案件（HTTP 201 vs 200），不需要再读一次。
   */
  id?: string;
}

export interface AppendDecisionEvidenceInput {
  tenantId: string;
  caseId: string;
  sourceType: string;
  sourceId: string;
  /** 证据原文（仅用于服务端重算 hash，不落库）。 */
  content: unknown;
  /** 调用方声明的 hash；必须与 content 重算结果一致。 */
  contentHash: string;
  supports: DecisionEvidenceSupport;
  weight?: string;
}

export interface SubmitDecisionJudgmentInput {
  tenantId: string;
  caseId: string;
  actorType: DecisionJudgmentActorType;
  actorId: string;
  modelRef?: string;
  independentScores?: DecisionJsonObject;
  independentRationale: string;
  dimensionStates?: DecisionJsonObject;
  confidence?: number;
}

export interface RecordDecisionVerificationInput {
  tenantId: string;
  caseId: string;
  /**
   * 客户端不再提交 checks/findings/passed；服务端 5 个 checker 产出权威结果。
   * decidedBy 可选：提前声明拟授权人，让 ConflictChecker 在 verify 阶段
   * 就能发现“决定人同时是人工判断者 / AI actor”的利益冲突；decide 时仍
   * 以真实 decidedBy 再校验一次。
   */
  decidedBy?: string;
  verifiedBy: string;
  /**
   * @deprecated 120 起客户端 passed/checks/findings 一律忽略；仅为旧调用方
   * 编译兼容保留，adapter 绝不读取它们决定 passed。
   */
  passed?: boolean;
  checks?: DecisionJsonObject;
  findings?: DecisionJsonObject[];
}

export interface DecideDecisionCaseInput {
  tenantId: string;
  caseId: string;
  /** 可选指定最终依据的人工判断；缺省取最新一条人工判断。 */
  finalJudgmentId?: string;
  decidedBy: string;
  rationale: string;
}

/**
 * vLLM（或其他模型）接入 seam：adapter 只产出建议，不能写决定。
 *
 * 当前版本不接具体模型；后续实现只需把 case + evidence 送入模型，返回
 * DecisionAiProposal，再由 API 以 actorType=AI_MODEL 记录为普通 judgment。
 * 建议输入刻意不包含人工判断，避免 AI 建议被人工判断污染。
 */
export interface DecisionAiContext {
  case: DecisionCase;
  evidence: DecisionEvidence[];
}

export interface DecisionAiProposal {
  /** 模型/版本标识，写入 modelRef；同时作为 actorId 去重键。 */
  modelRef: string;
  independentScores: DecisionJsonObject;
  independentRationale: string;
  dimensionStates?: DecisionJsonObject;
  confidence?: number;
}

export interface DecisionAiAdapter {
  readonly modelRef: string;
  propose(context: DecisionAiContext): Promise<DecisionAiProposal>;
}

/** 把 AI adapter 的输出转成同表的 AI_MODEL judgment 输入。 */
export function decisionAiJudgmentInput(
  tenantId: string,
  caseId: string,
  proposal: DecisionAiProposal,
): SubmitDecisionJudgmentInput {
  return {
    tenantId,
    caseId,
    actorType: "AI_MODEL",
    actorId: proposal.modelRef,
    modelRef: proposal.modelRef,
    independentScores: proposal.independentScores,
    independentRationale: proposal.independentRationale,
    dimensionStates: proposal.dimensionStates,
    confidence: proposal.confidence,
  };
}

/** sha256 前缀与 policy-dsl 的 hash 约定一致，便于跨模块审计。 */
const HASH_PREFIX = "sha256:";

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForHash);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortForHash(record[key]);
        return acc;
      }, {});
  }
  return value;
}

/** 稳定 JSON：对象 key 递归排序，保证同一内容在不同适配器上 hash 相同。 */
export function canonicalDecisionJson(value: unknown): string {
  return JSON.stringify(sortForHash(value)) ?? "null";
}

/** 证据内容承诺：`sha256:<hex>`。 */
export function decisionEvidenceHash(content: unknown): string {
  const digest = createHash("sha256")
    .update(canonicalDecisionJson(content))
    .digest("hex");
  return `${HASH_PREFIX}${digest}`;
}

/** 接受 `sha256:<hex>` 或裸 hex，统一为小写带前缀格式。 */
export function normalizeDecisionHash(contentHash: string): string {
  const text = contentHash.trim().toLowerCase();
  return text.startsWith(HASH_PREFIX) ? text : `${HASH_PREFIX}${text}`;
}

/** 证据 hash 是否与内容一致（不一致由 API 返回 409）。 */
export function decisionEvidenceHashMatches(
  content: unknown,
  contentHash: string,
): boolean {
  return decisionEvidenceHash(content) === normalizeDecisionHash(contentHash);
}

/** 全部证据的聚合承诺：决定记录引用它，证据新增后 aggregate 必然变化。 */
export function decisionEvidenceAggregateHash(
  evidence: DecisionEvidence[],
): string {
  const ordered = [...evidence].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  return decisionEvidenceHash({
    algorithm: "sha256",
    evidence: ordered.map((entry) => normalizeDecisionHash(entry.contentHash)),
  });
}

/**
 * 全部判断的聚合承诺。顺序即写入顺序（adapter 按 seq / 追加顺序返回），
 * 不按 createdAt 排序：同一毫秒内的两条判断仍必须稳定可区分。
 */
export function decisionJudgmentsAggregateHash(
  judgments: DecisionJudgment[],
): string {
  return decisionEvidenceHash({
    algorithm: "sha256",
    judgments: judgments.map((judgment) => ({
      id: judgment.id,
      actorType: judgment.actorType,
      actorId: judgment.actorId,
      modelRef: judgment.modelRef ?? null,
      independentScores: judgment.independentScores,
      independentRationale: judgment.independentRationale,
      dimensionStates: judgment.dimensionStates,
      confidence: judgment.confidence ?? null,
      createdAt: judgment.createdAt,
    })),
  });
}

/** 这些 kind 的案件必须有至少一条 FOR/AGAINST 证据才能进入校验。 */
export const DECISION_EVIDENCE_REQUIRED_KINDS = [
  "PERFORMANCE",
  "CONTRIBUTION",
  "APPEAL",
] as const;

/** 这些 kind 需要独立来源覆盖与正反两面（或显式 missing）。 */
export const DECISION_COVERAGE_REQUIRED_KINDS = [
  "PERFORMANCE",
  "CONTRIBUTION",
] as const;

export function decisionCaseRequiresEvidence(
  kind: DecisionCaseKind,
): boolean {
  return (DECISION_EVIDENCE_REQUIRED_KINDS as readonly string[]).includes(kind);
}

export function decisionCaseRequiresCoverage(
  kind: DecisionCaseKind,
): boolean {
  return (DECISION_COVERAGE_REQUIRED_KINDS as readonly string[]).includes(kind);
}

export const DECISION_VERIFICATION_CHECKERS = [
  "ConflictChecker",
  "EvidenceIntegrityChecker",
  "CoverageChecker",
  "RuleChecker",
  "FreshnessChecker",
] as const;
export type DecisionVerificationCheckerName =
  (typeof DECISION_VERIFICATION_CHECKERS)[number];

export interface DecisionVerificationFinding {
  /** 允许附加领域细节，同时兼容 DecisionJsonObject 的序列化形状。 */
  [key: string]: unknown;
  checker: DecisionVerificationCheckerName;
  /** 稳定机器码，例如 EVIDENCE_HASH_MISMATCH / HUMAN_JUDGMENT_REQUIRED。 */
  code: string;
  severity: "ERROR" | "WARNING";
  message: string;
  evidenceId?: string;
  judgmentId?: string;
  details?: DecisionJsonObject;
}

export interface DecisionVerificationCheck {
  passed: boolean;
  findings: DecisionVerificationFinding[];
  /** 仅 FreshnessChecker 产出：本校验要绑定的事实承诺。 */
  binding?: DecisionVerificationBinding;
}

export interface DecisionVerificationBinding {
  /** 校验完成后的案件版本（校验动作本身会推进版本）。 */
  caseVersion: number;
  evidenceHash: string;
  judgmentsHash: string;
}

export interface DecisionVerificationResult {
  checks: Record<DecisionVerificationCheckerName, DecisionVerificationCheck>;
  findings: DecisionVerificationFinding[];
  passed: boolean;
  binding: DecisionVerificationBinding;
}

export interface DecisionVerificationContext {
  case: DecisionCase;
  evidence: DecisionEvidence[];
  judgments: DecisionJudgment[];
  /** 可选拟授权人；verify 阶段传入时可提前发现利益冲突。 */
  decidedBy?: string;
}

function verificationFinding(
  checker: DecisionVerificationCheckerName,
  code: string,
  message: string,
  extra: Partial<Omit<DecisionVerificationFinding, "checker" | "code" | "message">> = {},
): DecisionVerificationFinding {
  return { checker, code, severity: "ERROR", message, ...extra };
}

/** 从 context 读取调用方显式声明的缺失面（支持字符串/对象/映射三种写法）。 */
export function declaredMissingEvidenceSupports(
  context: DecisionJsonObject,
): Set<"FOR" | "AGAINST"> {
  const declared = new Set<"FOR" | "AGAINST">();
  const record = (value: unknown): void => {
    if (typeof value !== "string") return;
    const normalized = value.trim().toUpperCase();
    if (normalized === "FOR" || normalized === "AGAINST") {
      declared.add(normalized);
    }
  };
  const readCollection = (raw: unknown): void => {
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (typeof entry === "string") {
          record(entry);
        } else if (entry !== null && typeof entry === "object") {
          const row = entry as Record<string, unknown>;
          record(row.supports);
          record(row.support);
        }
      }
      return;
    }
    if (raw !== null && typeof raw === "object") {
      for (const [key, value] of Object.entries(
        raw as Record<string, unknown>,
      )) {
        if (value !== false && value !== null && value !== undefined) {
          record(key);
        }
      }
    }
  };
  readCollection(context.missingEvidence);
  readCollection(context.evidenceGaps);
  readCollection(context.missingSupports);
  return declared;
}

/**
 * 证据必填校验（decide 直接复用）：PERFORMANCE / CONTRIBUTION / APPEAL
 * 至少一条 FOR/AGAINST 证据；BUDGET / INCENTIVE_ELIGIBILITY 可以为 0。
 */
export function decisionEvidenceRequirementFinding(
  kind: DecisionCaseKind,
  evidence: DecisionEvidence[],
): DecisionVerificationFinding | undefined {
  if (!decisionCaseRequiresEvidence(kind)) return undefined;
  const hasDirectional = evidence.some(
    (entry) => entry.supports === "FOR" || entry.supports === "AGAINST",
  );
  if (hasDirectional) return undefined;
  return verificationFinding(
    "EvidenceIntegrityChecker",
    "EVIDENCE_REQUIRED",
    `${kind} decision requires at least one FOR or AGAINST evidence`,
    { details: { kind } },
  );
}

function runConflictChecker(
  context: DecisionVerificationContext,
): DecisionVerificationCheck {
  const findings: DecisionVerificationFinding[] = [];
  const humanActors = new Set(
    context.judgments
      .filter(isHumanDecisionJudgment)
      .map((judgment) => judgment.actorId),
  );
  const aiActors = new Set(
    context.judgments
      .filter((judgment) => judgment.actorType === "AI_MODEL")
      .map((judgment) => judgment.actorId),
  );
  if (context.decidedBy) {
    if (humanActors.has(context.decidedBy)) {
      findings.push(
        verificationFinding(
          "ConflictChecker",
          "SELF_DECISION_FORBIDDEN",
          "the decider submitted a human judgment on this case",
          { details: { decidedBy: context.decidedBy } },
        ),
      );
    } else if (aiActors.has(context.decidedBy)) {
      findings.push(
        verificationFinding(
          "ConflictChecker",
          "AI_MODEL_CANNOT_DECIDE",
          "an AI judgment actor cannot authorize the final decision",
          { details: { decidedBy: context.decidedBy } },
        ),
      );
    }
  }
  return { passed: findings.length === 0, findings };
}

function runEvidenceIntegrityChecker(
  context: DecisionVerificationContext,
): DecisionVerificationCheck {
  const findings: DecisionVerificationFinding[] = [];
  for (const entry of context.evidence) {
    if (entry.content === undefined) {
      findings.push(
        verificationFinding(
          "EvidenceIntegrityChecker",
          "EVIDENCE_CONTENT_MISSING",
          "evidence content is unavailable for hash recomputation",
          { evidenceId: entry.id },
        ),
      );
      continue;
    }
    if (!decisionEvidenceHashMatches(entry.content, entry.contentHash)) {
      findings.push(
        verificationFinding(
          "EvidenceIntegrityChecker",
          "EVIDENCE_HASH_MISMATCH",
          "evidence content no longer matches its content hash",
          { evidenceId: entry.id },
        ),
      );
    }
  }
  const required = decisionEvidenceRequirementFinding(
    context.case.kind,
    context.evidence,
  );
  if (required) findings.push(required);
  return { passed: findings.length === 0, findings };
}

function runCoverageChecker(
  context: DecisionVerificationContext,
): DecisionVerificationCheck {
  if (!decisionCaseRequiresCoverage(context.case.kind)) {
    return { passed: true, findings: [] };
  }
  const findings: DecisionVerificationFinding[] = [];
  const sourceTypes = new Set(
    context.evidence.map((entry) => entry.sourceType),
  );
  if (sourceTypes.size < 2) {
    findings.push(
      verificationFinding(
        "CoverageChecker",
        "EVIDENCE_SOURCE_COVERAGE_INSUFFICIENT",
        "at least two independent source types are required",
        {
          details: {
            sourceTypes: [...sourceTypes].sort(),
            requiredSourceTypes: 2,
          },
        },
      ),
    );
  }
  const supports = new Set(
    context.evidence
      .map((entry) => entry.supports)
      .filter((value) => value === "FOR" || value === "AGAINST"),
  );
  const declaredMissing = declaredMissingEvidenceSupports(
    context.case.context,
  );
  for (const side of ["FOR", "AGAINST"] as const) {
    if (supports.has(side) || declaredMissing.has(side)) continue;
    findings.push(
      verificationFinding(
        "CoverageChecker",
        `COVERAGE_MISSING_${side}`,
        `${side} evidence is missing and not declared as explicitly missing`,
        { details: { supports: side } },
      ),
    );
  }
  return { passed: findings.length === 0, findings };
}

function runRuleChecker(
  context: DecisionVerificationContext,
): DecisionVerificationCheck {
  const findings: DecisionVerificationFinding[] = [];
  if (!isDecisionCaseMutable(context.case.status)) {
    findings.push(
      verificationFinding(
        "RuleChecker",
        "DECISION_CASE_NOT_MUTABLE",
        `case is ${context.case.status} and can no longer be verified`,
        { details: { status: context.case.status } },
      ),
    );
  }
  const human = humanDecisionJudgments(context.judgments);
  if (human.length === 0) {
    findings.push(
      verificationFinding(
        "RuleChecker",
        "HUMAN_JUDGMENT_REQUIRED",
        "a human independent judgment is required before verification can pass",
      ),
    );
  }
  for (const judgment of context.judgments) {
    if (judgment.actorType === "AI_MODEL" && !judgment.modelRef) {
      findings.push(
        verificationFinding(
          "RuleChecker",
          "AI_MODEL_REF_REQUIRED",
          "an AI_MODEL judgment must be traceable to a model reference",
          { judgmentId: judgment.id },
        ),
      );
    }
  }
  // AI 判断只能建议：任何把 AI_MODEL judgment 当作最终依据的标记都拒绝。
  for (const judgment of context.judgments) {
    if (
      judgment.actorType === "AI_MODEL" &&
      judgment.dimensionStates.finalDecision === true
    ) {
      findings.push(
        verificationFinding(
          "RuleChecker",
          "AI_MODEL_CANNOT_BE_FINAL",
          "an AI_MODEL judgment cannot be marked as the final decision",
          { judgmentId: judgment.id },
        ),
      );
    }
  }
  if (context.decidedBy) {
    const decider = context.judgments.find(
      (judgment) => judgment.actorId === context.decidedBy,
    );
    if (decider?.actorType === "AI_MODEL") {
      findings.push(
        verificationFinding(
          "RuleChecker",
          "AI_MODEL_CANNOT_DECIDE",
          "an AI judgment actor cannot authorize the final decision",
        ),
      );
    }
  }
  return { passed: findings.length === 0, findings };
}

function runFreshnessChecker(
  context: DecisionVerificationContext,
): DecisionVerificationCheck {
  // 绑定就是本 checker 的产物；案件可变性由 RuleChecker 统一判定。
  const binding: DecisionVerificationBinding = {
    caseVersion: context.case.version + 1,
    evidenceHash: decisionEvidenceAggregateHash(context.evidence),
    judgmentsHash: decisionJudgmentsAggregateHash(context.judgments),
  };
  return { passed: true, findings: [], binding };
}

/**
 * 服务端权威校验：所有 passed 结论只来自本函数，客户端提交的 passed 无效。
 * 5 个 checker 全部执行（不是短路），便于审计一次看到全部发现项。
 */
export function runDecisionVerification(
  context: DecisionVerificationContext,
): DecisionVerificationResult {
  const checks: Record<
    DecisionVerificationCheckerName,
    DecisionVerificationCheck
  > = {
    ConflictChecker: runConflictChecker(context),
    EvidenceIntegrityChecker: runEvidenceIntegrityChecker(context),
    CoverageChecker: runCoverageChecker(context),
    RuleChecker: runRuleChecker(context),
    FreshnessChecker: runFreshnessChecker(context),
  };
  const findings = Object.values(checks).flatMap(
    (check) => check.findings,
  );
  const binding = checks.FreshnessChecker.binding ?? {
    caseVersion: context.case.version + 1,
    evidenceHash: decisionEvidenceAggregateHash(context.evidence),
    judgmentsHash: decisionJudgmentsAggregateHash(context.judgments),
  };
  return {
    checks,
    findings,
    passed: findings.length === 0,
    binding,
  };
}

/**
 * 校验绑定是否仍与当前案件一致。decide 用它判断 DECISION_STALE_VERIFICATION。
 * 旧版（无绑定）校验一律视为过期，必须重新校验。
 */
export function decisionVerificationIsCurrent(
  verification: Pick<
    DecisionVerification,
    "verifiedCaseVersion" | "evidenceHash" | "judgmentsHash"
  >,
  input: {
    caseVersion: number;
    evidenceHash: string;
    judgmentsHash: string;
  },
): boolean {
  return (
    verification.verifiedCaseVersion === input.caseVersion &&
    verification.evidenceHash === input.evidenceHash &&
    verification.judgmentsHash === input.judgmentsHash
  );
}

export function isHumanDecisionJudgment(
  judgment: DecisionJudgment,
): boolean {
  return judgment.actorType === "HUMAN";
}

/**
 * 最终依据必须是人工判断：
 * - 指定 finalJudgmentId 时必须命中该 case 的一条 HUMAN judgment；
 * - 未指定时取数组中最后一条人工判断（adapter 按写入顺序返回，避免同一
 *   毫秒内 createdAt 相同导致随机 id 决定“最新”）；
 * - 只有 AI 建议时返回 undefined，调用方拒绝决定。
 */
export function selectFinalHumanJudgment(
  judgments: DecisionJudgment[],
  requestedId?: string,
): DecisionJudgment | undefined {
  const human = judgments.filter(isHumanDecisionJudgment);
  if (requestedId) return human.find((judgment) => judgment.id === requestedId);
  return human.at(-1);
}

export function humanDecisionJudgments(
  judgments: DecisionJudgment[],
): DecisionJudgment[] {
  return judgments.filter(isHumanDecisionJudgment);
}

export function aiDecisionJudgments(
  judgments: DecisionJudgment[],
): DecisionJudgment[] {
  return judgments.filter((judgment) => judgment.actorType === "AI_MODEL");
}

/** 已决定/已取消的案件不再接受证据、判断、校验或二次决定。 */
export function isDecisionCaseMutable(status: DecisionCaseStatus): boolean {
  return status === "DRAFT" || status === "COLLECTING" || status === "READY";
}

/** 追加证据/判断后：草稿进入收集态；READY 保持（由新的校验决定是否降级）。 */
export function decisionCaseStatusAfterCollection(
  status: DecisionCaseStatus,
): DecisionCaseStatus {
  return status === "DRAFT" ? "COLLECTING" : status;
}

/** 校验通过且有独立人工判断 → READY；否则回到 COLLECTING。 */
export function decisionCaseStatusAfterVerification(
  passed: boolean,
  hasHumanJudgment: boolean,
): DecisionCaseStatus {
  return passed && hasHumanJudgment ? "READY" : "COLLECTING";
}

/**
 * 盲审可见性（NP-004 的服务端判据）。
 *
 * AI 建议必须先经过人工独立判断才能被同一复核人看到；否则「先看 AI 再
 * 打分」的锚定效应会让独立判断变成事后合理化。前端可以配合隐藏，但唯一
 * 权威判据在这里，输入全部来自服务端事实：
 *
 * - `generatedByUser`：人写的草案不是 AI 建议，不属于盲审范围；
 * - `pendingIndependentJudgment`：仍在等待独立判断（如 SUBMITTED）；
 * - `isReviewer`：请求者具备复核资格（服务端角色判断，不信任前端声明）；
 * - `hasIndependentJudgment`：请求者已提交独立判断（append-only 事实）；
 * - `isSubject`：请求者就是被评价人——本人永远不能解锁 AI 建议。
 *
 * 任一条件不满足都回到遮蔽状态；只有「非本人 + 有复核资格 + 已独立判断」
 * 才揭示内容。
 */
export interface DecisionBlindReviewVisibilityInput {
  generatedByUser: boolean;
  pendingIndependentJudgment: boolean;
  isReviewer: boolean;
  hasIndependentJudgment: boolean;
  isSubject?: boolean;
}

export function decisionBlindReviewContentVisible(
  input: DecisionBlindReviewVisibilityInput,
): boolean {
  if (input.generatedByUser) return true;
  if (!input.pendingIndependentJudgment) return true;
  if (input.isSubject) return false;
  return input.isReviewer && input.hasIndependentJudgment;
}
