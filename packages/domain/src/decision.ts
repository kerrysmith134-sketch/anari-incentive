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

/** 证据只有内容承诺（content_hash），原始内容留在来源系统。 */
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
  /** 校验项（利益冲突 / 证据覆盖 / 规则命中）的机器可读结果。 */
  checks: DecisionJsonObject;
  /** 发现项：每条至少包含 code，由调用方扩展。 */
  findings: DecisionJsonObject[];
  passed: boolean;
  verifiedBy: string;
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

export interface DecisionCaseDetail {
  case: DecisionCase;
  evidence: DecisionEvidence[];
  /** 人工判断与 AI 建议严格分开返回，避免前端把建议当决定。 */
  judgments: {
    human: DecisionJudgment[];
    ai: DecisionJudgment[];
  };
  verifications: DecisionVerification[];
  record?: DecisionRecord;
}

export interface CreateDecisionCaseInput {
  tenantId: string;
  kind: DecisionCaseKind;
  subjectType: string;
  subjectId: string;
  context?: DecisionJsonObject;
  createdBy: string;
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
  checks: DecisionJsonObject;
  findings?: DecisionJsonObject[];
  passed: boolean;
  verifiedBy: string;
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
