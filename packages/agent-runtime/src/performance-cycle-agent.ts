/**
 * Performance Cycle Agent（确定性编排，不接 LLM）。
 *
 * 输入是某一绩效周期的只读快照（people / goal cards / drafts / appeals /
 * runs / awards / payments），输出：
 * 1. `blockers`：按 Evaluation Readiness / Payout Readiness 两个域汇总；
 * 2. `actions`：结构化待办（固定 8 种 kind），每条带 priority / ownerRole /
 *    subjectId / reason / 稳定幂等键；
 * 3. `approvalPackage`：仅当两个域的 readiness 都 PASS 时生成的审批包；
 * 4. `escalations`：同一 blocker 连续 N 轮（默认 3 轮）出现时升级。
 *
 * 红线（与 cycle-readiness / payout-readiness 一致）：
 * - 纯函数：不读写数据库、不发通知、不创建批次、不锁账、不付款；
 * - 不自动批准、不自动付款；审批包只是提案，必须人工审批；
 * - 无法证明的条件一律 fail-closed（未知状态按未完成处理）；
 * - 输出完全由输入决定：不读取当前时间、不生成随机数，重放结果逐字节一致。
 */

import type { DecimalString } from "@anari/domain";

// ---------------------------------------------------------------------------
// 输出类型
// ---------------------------------------------------------------------------

export type CycleActionKind =
  | "COLLECT_EVIDENCE"
  | "COMPLETE_DRAFT"
  | "RESOLVE_APPEAL"
  | "RUN_CALCULATION"
  | "LOCK_RUN"
  | "CREATE_BATCH"
  | "RECORD_PAYMENT"
  | "FIX_GL";

/** 升级与待办只允许落到三类人工责任角色。 */
export type CycleOwnerRole = "HR" | "FINANCE" | "MANAGER";

export type CyclePriority = "P0" | "P1" | "P2";

export type ReadinessDomain = "EVALUATION" | "PAYOUT";

export type ReadinessStatus = "PASS" | "BLOCKED" | "NOT_MEASURABLE";

export type EvaluationCheckCode =
  | "goalCards"
  | "evidenceComplete"
  | "draftsDecided"
  | "appealsResolved";

export type PayoutCheckCode =
  | "calculationLocked"
  | "awardsBatched"
  | "batchesApproved"
  | "paymentsMatchDue"
  | "glComplete";

export type PerformanceCycleCheckCode =
  | EvaluationCheckCode
  | PayoutCheckCode;

export interface PerformanceCycleBlocker {
  /** 稳定键：同一事实在任意轮次得到同一个 key（升级按它连续计数）。 */
  key: string;
  domain: ReadinessDomain;
  /** 对应 Evaluation/Payout Readiness 的检查项。 */
  check: PerformanceCycleCheckCode;
  code: string;
  severity: "BLOCKING";
  message: string;
  subjectType: string;
  subjectId: string;
  /** 该 blocker 对应的待办种类（actions 由 blockers 派生）。 */
  actionKind: CycleActionKind;
  ownerRole: CycleOwnerRole;
}

export interface PerformanceCycleAction {
  kind: CycleActionKind;
  priority: CyclePriority;
  ownerRole: CycleOwnerRole;
  subjectType: string;
  subjectId: string;
  /** 稳定的机器可读原因码（用于筛选/统计，不随文案变化）。 */
  reason: string;
  /** 人类可读说明。 */
  message: string;
  blockerKey: string;
  /**
   * 幂等键：`perf-cycle:<cycleId>:<kind>:<blockerKey>`。
   * 不包含轮次、时间或数组下标，同输入重放保持一致。
   */
  idempotencyKey: string;
}

export interface PerformanceCycleReadinessCheck {
  check: PerformanceCycleCheckCode;
  status: ReadinessStatus;
  detail: string;
  blockerKeys: string[];
}

export interface PerformanceCycleReadiness {
  domain: ReadinessDomain;
  status: ReadinessStatus;
  checks: PerformanceCycleReadinessCheck[];
}

export interface PerformanceCycleBlockers {
  evaluation: PerformanceCycleBlocker[];
  payout: PerformanceCycleBlocker[];
}

export interface PerformanceCycleCurrencyAmount {
  currency: string;
  amount: DecimalString;
}

export interface PerformanceCycleApprovalPackage {
  /** 稳定包键；同输入重复生成得到同一个 key。 */
  packageKey: string;
  cycleId: string;
  cycleName?: string;
  period?: string;
  peopleCount: number;
  amountByCurrency: PerformanceCycleCurrencyAmount[];
  batchIds: string[];
  runIds: string[];
  paymentCount: number;
  /** 所有 PAID 支付均有可验证的平衡 GL 凭证 / 批次级 glComplete 断言。 */
  glComplete: boolean;
  readiness: { evaluation: "PASS"; payout: "PASS" };
  /** 红线：包是审批提案，不是批准结果，更不是付款指令。 */
  requiresHumanApproval: true;
  autoApproved: false;
  autoPaid: false;
  note: string;
}

export interface PerformanceCycleEscalation {
  /** 稳定升级键：同一 blocker 的连续升级键不随轮次变化。 */
  key: string;
  blockerKey: string;
  domain: ReadinessDomain;
  code: string;
  check: PerformanceCycleCheckCode;
  actionKind: CycleActionKind;
  /** 红线：升级只落到 HR / FINANCE / MANAGER。 */
  ownerRole: CycleOwnerRole;
  subjectType: string;
  subjectId: string;
  /** 含本轮在内的连续出现轮数（默认达到 3 才升级）。 */
  consecutiveRounds: number;
  message: string;
}

export interface PerformanceCycleAgentResult {
  cycleId: string;
  readiness: {
    evaluation: PerformanceCycleReadiness;
    payout: PerformanceCycleReadiness;
  };
  blockers: PerformanceCycleBlockers;
  /** 扁平且稳定排序的 blocker key，可直接作为下一轮 history 输入。 */
  blockerKeys: string[];
  actions: PerformanceCycleAction[];
  approvalPackage: PerformanceCycleApprovalPackage | null;
  escalations: PerformanceCycleEscalation[];
  /** 红线声明：本 agent 不产生任何副作用。 */
  sideEffects: "NONE";
  note: string;
}

// ---------------------------------------------------------------------------
// 输入快照
// ---------------------------------------------------------------------------

export interface PerformanceCyclePerson {
  personId: string;
  name?: string;
  managerPersonId?: string;
  /** 缺省视为应参与（true）。 */
  eligible?: boolean;
}

export interface PerformanceCycleGoalMetric {
  metricId: string;
  /** 缺省视为适用；false 的指标不需要证据。 */
  applicable?: boolean;
  evidenceRefs?: string[];
}

export interface PerformanceCycleGoalCard {
  id: string;
  personId: string;
  /** DRAFT / LOCKED / ADJUSTED；只有 LOCKED 视为已锁定。 */
  status: string;
  metrics?: PerformanceCycleGoalMetric[];
}

export interface PerformanceCycleEvaluationDraft {
  id: string;
  personId: string;
  /** APPROVED / REJECTED 视为已决；其它（含未知）fail-closed 按未决。 */
  status: string;
}

export interface PerformanceCycleAppeal {
  id: string;
  status?: string;
  decisionStatus?: string;
  appellantPersonId?: string;
  targetType?: string;
  targetId?: string;
}

export interface PerformanceCycleCalculationRun {
  id: string;
  cycleId?: string;
  /** FORMAL / SHADOW；缺省视为 FORMAL。 */
  mode?: string;
  /** APPROVED / LOCKED 视为已定稿；LOCKED 才满足锁账门禁。 */
  status: string;
  blockers?: string[];
}

export interface PerformanceCycleAwardLine {
  id: string;
  personId: string;
  amount: DecimalString;
  currency?: string;
  sourceRecordId?: string;
}

export interface PerformanceCycleAwardBatch {
  id: string;
  batchNo?: string;
  /** DRAFT / PENDING_APPROVAL / APPROVED / LOCKED / EXPORTED / ACKNOWLEDGED / CANCELLED。 */
  status: string;
  currency: string;
  totalAmount?: DecimalString;
  lines?: PerformanceCycleAwardLine[];
  /** 批次级断言：该批次全部 PAID 支付均有平衡 GL 凭证。 */
  glComplete?: boolean;
}

export interface PerformanceCyclePaymentGl {
  voucherId?: string;
  /** 显式 false 表示凭证缺失（即使 batch.glComplete 为 true 也阻断）。 */
  present?: boolean;
  /** 显式 false 表示凭证未平衡。 */
  balanced?: boolean;
  totalDebit?: DecimalString;
  totalCredit?: DecimalString;
}

export interface PerformanceCyclePayment {
  id: string;
  batchId: string;
  lineId: string;
  amount: DecimalString;
  currency?: string;
  /** PAID 才计入已付；FAILED / RETURNED 只作为阻断事实。 */
  status: string;
  kind?: string;
  createdAt?: string;
  paidAt?: string;
  gl?: PerformanceCyclePaymentGl;
}

export interface PerformanceCycleSnapshot {
  /** 可显式给出；缺省取 `snapshot.cycle.id`。 */
  cycleId?: string;
  cycle: {
    id: string;
    name?: string;
    /** 例如 2026-Q4；进入审批包。 */
    period?: string;
    startsAt?: string;
    endsAt?: string;
    status?: string;
  };
  people?: PerformanceCyclePerson[];
  goalCards?: PerformanceCycleGoalCard[];
  drafts?: PerformanceCycleEvaluationDraft[];
  appeals?: PerformanceCycleAppeal[];
  runs?: PerformanceCycleCalculationRun[];
  awards?: PerformanceCycleAwardBatch[];
  payments?: PerformanceCyclePayment[];
}

/** 上一轮的 blocker 事实；按时间升序提供，最后一条是紧邻本轮的前一轮。 */
export interface PerformanceCycleHistoryRound {
  round?: number;
  blockerKeys: ReadonlyArray<string>;
}

export interface PerformanceCycleAgentInput {
  snapshot: PerformanceCycleSnapshot;
  /**
   * 连续升级所需的历次 blocker key。只比较“连续出现”：中间任一轮缺失
   * 即清零。调用方通常把上一轮 result.blockerKeys 追加进来。
   */
  history?: ReadonlyArray<PerformanceCycleHistoryRound>;
  /** 连续多少轮（含本轮）升级；默认 3，最小 2。 */
  escalationThreshold?: number;
}

// ---------------------------------------------------------------------------
// 常量 / 映射
// ---------------------------------------------------------------------------

const DEFAULT_ESCALATION_THRESHOLD = 3;

const ACTION_PRIORITY: Readonly<Record<CycleActionKind, CyclePriority>> = {
  // 先解决会让最终金额变化或让钱对不上的事项。
  RESOLVE_APPEAL: "P0",
  RUN_CALCULATION: "P0",
  LOCK_RUN: "P0",
  FIX_GL: "P0",
  COLLECT_EVIDENCE: "P1",
  COMPLETE_DRAFT: "P1",
  CREATE_BATCH: "P1",
  RECORD_PAYMENT: "P1",
};

const ACTION_OWNER: Readonly<Record<CycleActionKind, CycleOwnerRole>> = {
  COLLECT_EVIDENCE: "MANAGER",
  COMPLETE_DRAFT: "MANAGER",
  RESOLVE_APPEAL: "HR",
  RUN_CALCULATION: "FINANCE",
  LOCK_RUN: "FINANCE",
  CREATE_BATCH: "FINANCE",
  RECORD_PAYMENT: "FINANCE",
  FIX_GL: "FINANCE",
};

/** 顺序与需求列出的 kind 顺序一致，仅用于稳定排序。 */
const ACTION_KIND_ORDER: Readonly<Record<CycleActionKind, number>> = {
  COLLECT_EVIDENCE: 0,
  COMPLETE_DRAFT: 1,
  RESOLVE_APPEAL: 2,
  RUN_CALCULATION: 3,
  LOCK_RUN: 4,
  CREATE_BATCH: 5,
  RECORD_PAYMENT: 6,
  FIX_GL: 7,
};

const PRIORITY_ORDER: Readonly<Record<CyclePriority, number>> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

const DECIDED_DRAFT_STATUSES: ReadonlySet<string> = new Set([
  "APPROVED",
  "REJECTED",
]);

const CLOSED_APPEAL_STATUSES: ReadonlySet<string> = new Set([
  "DECIDED",
  "CLOSED",
]);

const FINALISED_RUN_STATUSES: ReadonlySet<string> = new Set([
  "APPROVED",
  "LOCKED",
]);

const APPROVABLE_BATCH_STATUSES: ReadonlySet<string> = new Set([
  "APPROVED",
  "LOCKED",
  "EXPORTED",
  "ACKNOWLEDGED",
]);

const EVALUATION_CHECK_CODES: ReadonlyArray<EvaluationCheckCode> = [
  "goalCards",
  "evidenceComplete",
  "draftsDecided",
  "appealsResolved",
];

const PAYOUT_CHECK_CODES: ReadonlyArray<PayoutCheckCode> = [
  "calculationLocked",
  "awardsBatched",
  "batchesApproved",
  "paymentsMatchDue",
  "glComplete",
];

const READ_ONLY_NOTE =
  "Deterministic read-only performance-cycle proposal. No side effects: the agent does not approve, lock, create batches, post GL entries or pay — every action requires a human in the owning role, and the approval package requires explicit human approval.";

const PACKAGE_NOTE =
  "Approval proposal only. Human approval is required before any run is locked, batch is released or payment is made.";

// ---------------------------------------------------------------------------
// 纯工具函数
// ---------------------------------------------------------------------------

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeStatus(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeCurrency(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function nonEmpty(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const MICROS_PER_UNIT = 1_000_000n;

/** 1e6 定点解析；拒绝浮点、负数与超过 6 位小数。非法返回 null。 */
function parseAmount(value: DecimalString | undefined): bigint | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1];
  if (whole === undefined) return null;
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return BigInt(whole) * MICROS_PER_UNIT + BigInt(fraction || "0");
}

function formatAmount(value: bigint): DecimalString {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / MICROS_PER_UNIT;
  const fraction = (absolute % MICROS_PER_UNIT)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

function sortByText<T>(items: T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareText(keyOf(a), keyOf(b)));
}

function groupBy<T>(
  items: ReadonlyArray<T>,
  keyOf: (item: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!nonEmpty(key)) continue;
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function escalationThreshold(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_ESCALATION_THRESHOLD;
  }
  const normalized = Math.trunc(value);
  return normalized >= 2 ? normalized : DEFAULT_ESCALATION_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Blocker 构造
// ---------------------------------------------------------------------------

interface BlockerSpec {
  check: PerformanceCycleCheckCode;
  code: string;
  message: string;
  subjectType: string;
  subjectId: string;
  actionKind: CycleActionKind;
  ownerRole?: CycleOwnerRole;
  /** 同一 subject 的多个事实（例如一个目标卡的多个缺证指标）。 */
  discriminator?: string;
}

function toBlocker(
  domain: ReadinessDomain,
  spec: BlockerSpec,
): PerformanceCycleBlocker {
  const parts = [domain, spec.code, spec.subjectType, spec.subjectId];
  if (nonEmpty(spec.discriminator)) parts.push(spec.discriminator as string);
  return {
    key: parts.join(":"),
    domain,
    check: spec.check,
    code: spec.code,
    severity: "BLOCKING",
    message: spec.message,
    subjectType: spec.subjectType,
    subjectId: spec.subjectId,
    actionKind: spec.actionKind,
    ownerRole: spec.ownerRole ?? ACTION_OWNER[spec.actionKind],
  };
}

function checkDetail(
  check: PerformanceCycleCheckCode,
  blockers: PerformanceCycleBlocker[],
): string {
  if (blockers.length === 0) return `${check}: no issues`;
  const codes = [...new Set(blockers.map((blocker) => blocker.code))].sort(
    compareText,
  );
  return `${check}: ${blockers.length} blocker(s) [${codes.join(", ")}]`;
}

function buildReadinessChecks(
  codes: ReadonlyArray<PerformanceCycleCheckCode>,
  blockers: PerformanceCycleBlocker[],
  status: ReadinessStatus,
): PerformanceCycleReadinessCheck[] {
  return codes.map((check) => {
    const checkBlockers = blockers.filter(
      (blocker) => blocker.check === check,
    );
    return {
      check,
      status:
        checkBlockers.length > 0
          ? "BLOCKED"
          : status === "NOT_MEASURABLE"
            ? "NOT_MEASURABLE"
            : "PASS",
      detail: checkDetail(check, checkBlockers),
      blockerKeys: checkBlockers.map((blocker) => blocker.key),
    };
  });
}

// ---------------------------------------------------------------------------
// 评估结果
// ---------------------------------------------------------------------------

function adjudicateEvaluationStatus(
  measurable: boolean,
  blockers: PerformanceCycleBlocker[],
): ReadinessStatus {
  if (blockers.length > 0) return "BLOCKED";
  return measurable ? "PASS" : "NOT_MEASURABLE";
}

function adjudicatePayoutStatus(
  measurable: boolean,
  blockers: PerformanceCycleBlocker[],
): ReadinessStatus {
  if (blockers.length > 0) return "BLOCKED";
  return measurable ? "PASS" : "NOT_MEASURABLE";
}

/**
 * Performance Cycle Agent 的确定性入口。
 *
 * 同一输入（含 history / escalationThreshold）必然得到完全相同的输出；
 * 函数不修改输入对象，也不访问任何外部状态。
 */
export function evaluatePerformanceCycle(
  input: PerformanceCycleAgentInput,
): PerformanceCycleAgentResult {
  const snapshot = input.snapshot;
  const cycleId = nonEmpty(snapshot.cycleId)
    ? (snapshot.cycleId as string)
    : snapshot.cycle.id;

  const evaluationBlockers: PerformanceCycleBlocker[] = [];
  const payoutBlockers: PerformanceCycleBlocker[] = [];
  const evaluationKeys = new Set<string>();
  const payoutKeys = new Set<string>();

  const addEvaluationBlocker = (spec: BlockerSpec): void => {
    const blocker = toBlocker("EVALUATION", spec);
    if (evaluationKeys.has(blocker.key)) return;
    evaluationKeys.add(blocker.key);
    evaluationBlockers.push(blocker);
  };
  const addPayoutBlocker = (spec: BlockerSpec): void => {
    const blocker = toBlocker("PAYOUT", spec);
    if (payoutKeys.has(blocker.key)) return;
    payoutKeys.add(blocker.key);
    payoutBlockers.push(blocker);
  };

  // ------------------------------------------------------------------
  // 参与人（应被评价/发奖的人）
  // ------------------------------------------------------------------
  const participantById = new Map<string, PerformanceCyclePerson>();
  for (const person of snapshot.people ?? []) {
    if (!person || !nonEmpty(person.personId)) continue;
    if (!participantById.has(person.personId)) {
      participantById.set(person.personId, person);
    }
  }
  const participants = sortByText(
    [...participantById.values()].filter(
      (person) => person.eligible !== false,
    ),
    (person) => person.personId,
  );
  const participantIds = new Set(
    participants.map((person) => person.personId),
  );

  // ------------------------------------------------------------------
  // Evaluation Readiness
  // ------------------------------------------------------------------

  // 1) 目标卡：应参与人必须有已锁定目标卡。
  const goalCardsByPerson = groupBy(
    (snapshot.goalCards ?? []).filter(
      (card) =>
        card && nonEmpty(card.id) && nonEmpty(card.personId),
    ),
    (card) => card.personId,
  );

  for (const person of participants) {
    const cards = sortByText(
      goalCardsByPerson.get(person.personId) ?? [],
      (card) => card.id,
    );
    const lockedCard = cards.find(
      (card) => normalizeStatus(card.status) === "LOCKED",
    );
    const card = lockedCard ?? cards[0];
    if (!card) {
      addEvaluationBlocker({
        check: "goalCards",
        code: "GOAL_CARD_MISSING",
        message: `participant ${person.personId} has no performance goal card for cycle ${cycleId}`,
        subjectType: "PERSON",
        subjectId: person.personId,
        actionKind: "COMPLETE_DRAFT",
      });
      continue;
    }
    if (normalizeStatus(card.status) !== "LOCKED") {
      addEvaluationBlocker({
        check: "goalCards",
        code: "GOAL_CARD_NOT_LOCKED",
        message: `goal card ${card.id} for participant ${person.personId} is ${normalizeStatus(card.status) || "MISSING"}, expected LOCKED`,
        subjectType: "GOAL_CARD",
        subjectId: card.id,
        actionKind: "COMPLETE_DRAFT",
      });
    }

    // 2) 证据完整性：适用指标必须至少有 1 条证据引用；无指标按无法证明处理。
    const metrics = (card.metrics ?? []).filter(
      (metric) => metric && nonEmpty(metric.metricId),
    );
    if (metrics.length === 0) {
      addEvaluationBlocker({
        check: "evidenceComplete",
        code: "GOAL_CARD_WITHOUT_METRICS",
        message: `goal card ${card.id} declares no metrics; evidence completeness cannot be proven`,
        subjectType: "GOAL_CARD",
        subjectId: card.id,
        actionKind: "COLLECT_EVIDENCE",
      });
      continue;
    }
    for (const metric of sortByText(metrics, (entry) => entry.metricId)) {
      if (metric.applicable === false) continue;
      const evidenceRefs = (metric.evidenceRefs ?? []).filter((ref) =>
        nonEmpty(ref),
      );
      if (evidenceRefs.length === 0) {
        addEvaluationBlocker({
          check: "evidenceComplete",
          code: "EVIDENCE_MISSING",
          message: `metric ${metric.metricId} on goal card ${card.id} has no evidence reference`,
          subjectType: "GOAL_CARD",
          subjectId: card.id,
          actionKind: "COLLECT_EVIDENCE",
          discriminator: metric.metricId,
        });
      }
    }
  }

  // 3) 评价草案：每个应参与人至少一份草案，且全部草案已决（APPROVED/REJECTED）。
  const draftsByPerson = groupBy(
    (snapshot.drafts ?? []).filter(
      (draft) => draft && nonEmpty(draft.id) && nonEmpty(draft.personId),
    ),
    (draft) => draft.personId,
  );
  for (const person of participants) {
    const drafts = sortByText(
      draftsByPerson.get(person.personId) ?? [],
      (draft) => draft.id,
    );
    if (drafts.length === 0) {
      addEvaluationBlocker({
        check: "draftsDecided",
        code: "DRAFT_MISSING",
        message: `participant ${person.personId} has no evaluation draft in cycle ${cycleId}`,
        subjectType: "PERSON",
        subjectId: person.personId,
        actionKind: "COMPLETE_DRAFT",
      });
      continue;
    }
    for (const draft of drafts) {
      const status = normalizeStatus(draft.status);
      if (!DECIDED_DRAFT_STATUSES.has(status)) {
        addEvaluationBlocker({
          check: "draftsDecided",
          code: "DRAFT_UNDECIDED",
          message: `evaluation draft ${draft.id} for participant ${person.personId} is ${status || "MISSING"}, expected APPROVED or REJECTED`,
          subjectType: "EVALUATION_DRAFT",
          subjectId: draft.id,
          actionKind: "COMPLETE_DRAFT",
        });
      }
    }
  }

  // 4) 申诉：未结申诉会改变最终金额，必须结案。
  const appeals = sortByText(
    (snapshot.appeals ?? []).filter(
      (appeal) => appeal && nonEmpty(appeal.id),
    ),
    (appeal) => appeal.id,
  );
  for (const appeal of appeals) {
    const status = normalizeStatus(appeal.status ?? appeal.decisionStatus);
    if (!CLOSED_APPEAL_STATUSES.has(status)) {
      addEvaluationBlocker({
        check: "appealsResolved",
        code: "APPEAL_OPEN",
        message: `appeal ${appeal.id} is ${status || "MISSING"}, expected DECIDED or CLOSED`,
        subjectType: "APPEAL",
        subjectId: appeal.id,
        actionKind: "RESOLVE_APPEAL",
        ownerRole: "HR",
      });
    }
  }

  const evaluationStatus = adjudicateEvaluationStatus(
    participants.length > 0,
    evaluationBlockers,
  );

  // ------------------------------------------------------------------
  // Payout Readiness
  // ------------------------------------------------------------------

  // 5) 计算运行：周期内 FORMAL run 必须全部 APPROVED/LOCKED 且至少一个 LOCKED。
  const cycleRuns = sortByText(
    (snapshot.runs ?? []).filter(
      (run) =>
        run &&
        nonEmpty(run.id) &&
        (!nonEmpty(run.cycleId) || run.cycleId === cycleId),
    ),
    (run) => run.id,
  );
  const formalRuns = cycleRuns.filter(
    (run) => normalizeStatus(run.mode ?? "FORMAL") === "FORMAL",
  );
  if (formalRuns.length === 0) {
    addPayoutBlocker({
      check: "calculationLocked",
      code: "CALCULATION_MISSING",
      message: `cycle ${cycleId} has no FORMAL calculation run`,
      subjectType: "CYCLE",
      subjectId: cycleId,
      actionKind: "RUN_CALCULATION",
    });
  } else {
    for (const run of formalRuns) {
      const status = normalizeStatus(run.status);
      if (!FINALISED_RUN_STATUSES.has(status)) {
        addPayoutBlocker({
          check: "calculationLocked",
          code: "RUN_NOT_FINALISED",
          message: `FORMAL run ${run.id} is ${status || "MISSING"}, expected APPROVED or LOCKED`,
          subjectType: "CALCULATION_RUN",
          subjectId: run.id,
          actionKind: "RUN_CALCULATION",
        });
      }
      const runBlockers = (run.blockers ?? []).filter((blocker) =>
        nonEmpty(blocker),
      );
      if (runBlockers.length > 0) {
        addPayoutBlocker({
          check: "calculationLocked",
          code: "RUN_BLOCKED",
          message: `FORMAL run ${run.id} still has ${runBlockers.length} blocker(s): ${runBlockers
            .slice(0, 3)
            .join("; ")}`,
          subjectType: "CALCULATION_RUN",
          subjectId: run.id,
          actionKind: "RUN_CALCULATION",
        });
      }
    }
    const lockedRuns = formalRuns.filter(
      (run) => normalizeStatus(run.status) === "LOCKED",
    );
    if (lockedRuns.length === 0) {
      const lockable = formalRuns.find(
        (run) => normalizeStatus(run.status) === "APPROVED",
      );
      if (lockable) {
        addPayoutBlocker({
          check: "calculationLocked",
          code: "RUN_NOT_LOCKED",
          message: `FORMAL run ${lockable.id} is approved but not locked`,
          subjectType: "CALCULATION_RUN",
          subjectId: lockable.id,
          actionKind: "LOCK_RUN",
        });
      }
    }
  }

  // 6) 奖励批次：必须存在、非空、金额/币种自洽且已审批。
  const allBatches = sortByText(
    (snapshot.awards ?? []).filter(
      (batch) => batch && nonEmpty(batch.id),
    ),
    (batch) => batch.id,
  );
  const activeBatches = allBatches.filter(
    (batch) => normalizeStatus(batch.status) !== "CANCELLED",
  );
  const activeBatchById = new Map(
    activeBatches.map((batch) => [batch.id, batch] as const),
  );
  const activeLines: Array<{
    batch: PerformanceCycleAwardBatch;
    line: PerformanceCycleAwardLine;
  }> = [];
  const lineKey = (batchId: string, lineId: string): string =>
    `${batchId}\u0000${lineId}`;
  const lineById = new Map<
    string,
    { batch: PerformanceCycleAwardBatch; line: PerformanceCycleAwardLine }
  >();

  if (activeBatches.length === 0) {
    addPayoutBlocker({
      check: "awardsBatched",
      code: "BATCH_MISSING",
      message: `cycle ${cycleId} has no active award batch`,
      subjectType: "CYCLE",
      subjectId: cycleId,
      actionKind: "CREATE_BATCH",
    });
  } else {
    for (const batch of activeBatches) {
      const batchStatus = normalizeStatus(batch.status);
      const lines = sortByText(
        (batch.lines ?? []).filter(
          (line) => line && nonEmpty(line.id),
        ),
        (line) => line.id,
      );
      if (lines.length === 0) {
        addPayoutBlocker({
          check: "awardsBatched",
          code: "BATCH_EMPTY",
          message: `award batch ${batch.batchNo ?? batch.id} has no lines`,
          subjectType: "AWARD_BATCH",
          subjectId: batch.id,
          actionKind: "CREATE_BATCH",
        });
      }
      if (!APPROVABLE_BATCH_STATUSES.has(batchStatus)) {
        addPayoutBlocker({
          check: "batchesApproved",
          code: "BATCH_NOT_APPROVED",
          message: `award batch ${batch.batchNo ?? batch.id} is ${batchStatus || "MISSING"}, expected APPROVED/LOCKED/EXPORTED/ACKNOWLEDGED`,
          subjectType: "AWARD_BATCH",
          subjectId: batch.id,
          actionKind: "CREATE_BATCH",
        });
      }
      const batchCurrency = normalizeCurrency(batch.currency);
      if (!batchCurrency) {
        addPayoutBlocker({
          check: "awardsBatched",
          code: "BATCH_CURRENCY_MISSING",
          message: `award batch ${batch.batchNo ?? batch.id} has no currency`,
          subjectType: "AWARD_BATCH",
          subjectId: batch.id,
          actionKind: "CREATE_BATCH",
        });
      }

      let lineSum = 0n;
      let allLineAmountsValid = true;
      for (const line of lines) {
        const amount = parseAmount(line.amount);
        if (amount === null) {
          allLineAmountsValid = false;
          addPayoutBlocker({
            check: "awardsBatched",
            code: "LINE_AMOUNT_INVALID",
            message: `award line ${line.id} has invalid amount ${line.amount}`,
            subjectType: "AWARD_LINE",
            subjectId: line.id,
            actionKind: "CREATE_BATCH",
          });
        } else {
          lineSum += amount;
        }
        const lineCurrency =
          normalizeCurrency(line.currency) || batchCurrency;
        if (batchCurrency && lineCurrency && lineCurrency !== batchCurrency) {
          addPayoutBlocker({
            check: "awardsBatched",
            code: "LINE_CURRENCY_MISMATCH",
            message: `award line ${line.id} is ${lineCurrency} but batch ${batch.batchNo ?? batch.id} is ${batchCurrency}`,
            subjectType: "AWARD_LINE",
            subjectId: line.id,
            actionKind: "CREATE_BATCH",
          });
        }
        const entry = { batch, line };
        activeLines.push(entry);
        const key = lineKey(batch.id, line.id);
        if (lineById.has(key)) {
          addPayoutBlocker({
            check: "awardsBatched",
            code: "DUPLICATE_LINE_ID",
            message: `award line ${line.id} appears more than once in batch ${batch.batchNo ?? batch.id}`,
            subjectType: "AWARD_LINE",
            subjectId: line.id,
            actionKind: "CREATE_BATCH",
          });
        } else {
          lineById.set(key, entry);
        }
      }

      if (batch.totalAmount !== undefined) {
        const total = parseAmount(batch.totalAmount);
        if (total === null) {
          addPayoutBlocker({
            check: "awardsBatched",
            code: "BATCH_TOTAL_INVALID",
            message: `award batch ${batch.batchNo ?? batch.id} has invalid total ${batch.totalAmount}`,
            subjectType: "AWARD_BATCH",
            subjectId: batch.id,
            actionKind: "CREATE_BATCH",
          });
        } else if (allLineAmountsValid && total !== lineSum) {
          addPayoutBlocker({
            check: "awardsBatched",
            code: "BATCH_TOTAL_MISMATCH",
            message: `award batch ${batch.batchNo ?? batch.id} total ${batch.totalAmount} does not equal its lines ${formatAmount(lineSum)}`,
            subjectType: "AWARD_BATCH",
            subjectId: batch.id,
            actionKind: "CREATE_BATCH",
          });
        }
      }
    }

    // 应参与人必须有批次行，否则“全部奖励已入批次”无法证明。
    const awardedPersonIds = new Set(
      activeLines.map(({ line }) => line.personId),
    );
    for (const personId of [...participantIds].sort(compareText)) {
      if (!awardedPersonIds.has(personId)) {
        addPayoutBlocker({
          check: "awardsBatched",
          code: "AWARD_MISSING",
          message: `participant ${personId} has no award line in any active batch`,
          subjectType: "PERSON",
          subjectId: personId,
          actionKind: "CREATE_BATCH",
        });
      }
    }
  }

  // 7) 支付与 GL：逐行核对已付金额，逐笔核对 PAID 的 GL 凭证。
  const payments = sortByText(
    (snapshot.payments ?? []).filter(
      (payment) => payment && nonEmpty(payment.id),
    ),
    (payment) => payment.id,
  );
  const paidByLine = new Map<string, bigint>();

  for (const payment of payments) {
    const batch = activeBatchById.get(payment.batchId);
    const entry = lineById.get(lineKey(payment.batchId, payment.lineId));
    if (!batch) {
      addPayoutBlocker({
        check: "paymentsMatchDue",
        code: "PAYMENT_UNKNOWN_BATCH",
        message: `payment ${payment.id} references unknown or cancelled batch ${payment.batchId}`,
        subjectType: "PAYMENT",
        subjectId: payment.id,
        actionKind: "RECORD_PAYMENT",
      });
      continue;
    }
    if (!entry) {
      addPayoutBlocker({
        check: "paymentsMatchDue",
        code: "PAYMENT_UNKNOWN_LINE",
        message: `payment ${payment.id} references line ${payment.lineId}, which is not in batch ${batch.batchNo ?? batch.id}`,
        subjectType: "PAYMENT",
        subjectId: payment.id,
        actionKind: "RECORD_PAYMENT",
      });
      continue;
    }

    const status = normalizeStatus(payment.status);
    if (status === "FAILED" || status === "RETURNED") {
      addPayoutBlocker({
        check: "paymentsMatchDue",
        code: status === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_RETURNED",
        message: `payment ${payment.id} is ${status}; the award line is not settled`,
        subjectType: "PAYMENT",
        subjectId: payment.id,
        actionKind: "RECORD_PAYMENT",
      });
      continue;
    }
    if (status !== "PAID") {
      addPayoutBlocker({
        check: "paymentsMatchDue",
        code: "PAYMENT_NOT_PAID",
        message: `payment ${payment.id} is ${status || "MISSING"}, expected PAID`,
        subjectType: "PAYMENT",
        subjectId: payment.id,
        actionKind: "RECORD_PAYMENT",
      });
      continue;
    }

    const amount = parseAmount(payment.amount);
    if (amount === null) {
      addPayoutBlocker({
        check: "paymentsMatchDue",
        code: "PAYMENT_AMOUNT_INVALID",
        message: `payment ${payment.id} has invalid amount ${payment.amount}`,
        subjectType: "PAYMENT",
        subjectId: payment.id,
        actionKind: "RECORD_PAYMENT",
      });
      continue;
    }

    const expectedCurrency =
      normalizeCurrency(entry.line.currency) ||
      normalizeCurrency(batch.currency);
    const actualCurrency =
      normalizeCurrency(payment.currency) || expectedCurrency;
    if (expectedCurrency && actualCurrency !== expectedCurrency) {
      addPayoutBlocker({
        check: "paymentsMatchDue",
        code: "PAYMENT_CURRENCY_MISMATCH",
        message: `payment ${payment.id} is ${actualCurrency || "MISSING"} but its line/batch is ${expectedCurrency}`,
        subjectType: "PAYMENT",
        subjectId: payment.id,
        actionKind: "RECORD_PAYMENT",
      });
      continue;
    }

    const paidKey = lineKey(entry.batch.id, entry.line.id);
    paidByLine.set(paidKey, (paidByLine.get(paidKey) ?? 0n) + amount);

    const glFailure = findGlFailure(payment, batch);
    if (glFailure) {
      addPayoutBlocker({
        check: "glComplete",
        code: glFailure.code,
        message: glFailure.message,
        subjectType: "PAYMENT",
        subjectId: payment.id,
        actionKind: "FIX_GL",
      });
    }
  }

  const lineEntries = sortByText(
    activeLines,
    ({ batch, line }) => lineKey(batch.id, line.id),
  );
  for (const { batch, line } of lineEntries) {
    const due = parseAmount(line.amount);
    if (due === null) continue; // 已在批次扫描中记 LINE_AMOUNT_INVALID。
    const paid = paidByLine.get(lineKey(batch.id, line.id)) ?? 0n;
    if (paid === due) continue;
    if (paid < due) {
      addPayoutBlocker({
        check: "paymentsMatchDue",
        code: paid === 0n ? "PAYMENT_MISSING" : "PAYMENT_UNDERPAID",
        message:
          paid === 0n
            ? `award line ${line.id} is unpaid (due ${line.amount})`
            : `award line ${line.id} is underpaid: ${formatAmount(paid)} of ${line.amount}`,
        subjectType: "AWARD_LINE",
        subjectId: line.id,
        actionKind: "RECORD_PAYMENT",
      });
    } else {
      addPayoutBlocker({
        check: "paymentsMatchDue",
        code: "PAYMENT_OVERPAID",
        message: `award line ${line.id} is overpaid: ${formatAmount(paid)} of ${line.amount}`,
        subjectType: "AWARD_LINE",
        subjectId: line.id,
        actionKind: "RECORD_PAYMENT",
      });
    }
  }

  const payoutStatus = adjudicatePayoutStatus(
    formalRuns.length > 0 ||
      activeBatches.length > 0 ||
      payments.length > 0,
    payoutBlockers,
  );

  // ------------------------------------------------------------------
  // 稳定排序 + 待办派生
  // ------------------------------------------------------------------
  const sortedEvaluationBlockers = sortByText(
    evaluationBlockers,
    (blocker) => blocker.key,
  );
  const sortedPayoutBlockers = sortByText(
    payoutBlockers,
    (blocker) => blocker.key,
  );
  const allBlockers = [
    ...sortedEvaluationBlockers,
    ...sortedPayoutBlockers,
  ];
  const blockerKeys = allBlockers.map((blocker) => blocker.key);

  const actionByKey = new Map<string, PerformanceCycleAction>();
  for (const blocker of allBlockers) {
    const idempotencyKey = `perf-cycle:${cycleId}:${blocker.actionKind}:${blocker.key}`;
    if (actionByKey.has(idempotencyKey)) continue;
    actionByKey.set(idempotencyKey, {
      kind: blocker.actionKind,
      priority: ACTION_PRIORITY[blocker.actionKind],
      ownerRole: blocker.ownerRole,
      subjectType: blocker.subjectType,
      subjectId: blocker.subjectId,
      reason: blocker.code,
      message: blocker.message,
      blockerKey: blocker.key,
      idempotencyKey,
    });
  }
  const actions = [...actionByKey.values()].sort((a, b) => {
    const byPriority =
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (byPriority !== 0) return byPriority;
    const byKind =
      ACTION_KIND_ORDER[a.kind] - ACTION_KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    const bySubjectType = compareText(a.subjectType, b.subjectType);
    if (bySubjectType !== 0) return bySubjectType;
    const bySubject = compareText(a.subjectId, b.subjectId);
    if (bySubject !== 0) return bySubject;
    const byReason = compareText(a.reason, b.reason);
    if (byReason !== 0) return byReason;
    return compareText(a.idempotencyKey, b.idempotencyKey);
  });

  // ------------------------------------------------------------------
  // 连续升级
  // ------------------------------------------------------------------
  const threshold = escalationThreshold(input.escalationThreshold);
  const history = input.history ?? [];
  const escalations: PerformanceCycleEscalation[] = [];
  for (const blocker of allBlockers) {
    let priorConsecutive = 0;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const round = history[index];
      if (!round) break;
      if (!round.blockerKeys.includes(blocker.key)) break;
      priorConsecutive += 1;
    }
    const consecutiveRounds = priorConsecutive + 1; // 本轮同样出现。
    if (consecutiveRounds < threshold) continue;
    escalations.push({
      key: `perf-cycle-escalation:${cycleId}:${blocker.key}`,
      blockerKey: blocker.key,
      domain: blocker.domain,
      code: blocker.code,
      check: blocker.check,
      actionKind: blocker.actionKind,
      ownerRole: blocker.ownerRole,
      subjectType: blocker.subjectType,
      subjectId: blocker.subjectId,
      consecutiveRounds,
      message: `${blocker.message} — unchanged for ${consecutiveRounds} consecutive round(s); escalate to ${blocker.ownerRole}`,
    });
  }
  escalations.sort((a, b) => compareText(a.key, b.key));

  // ------------------------------------------------------------------
  // 审批包（仅双域 PASS）
  // ------------------------------------------------------------------
  let approvalPackage: PerformanceCycleApprovalPackage | null = null;
  if (evaluationStatus === "PASS" && payoutStatus === "PASS") {
    const totals = new Map<string, bigint>();
    const packagePeople = new Set<string>();
    for (const { batch, line } of activeLines) {
      const amount = parseAmount(line.amount);
      if (amount === null) continue;
      const currency =
        normalizeCurrency(line.currency) ||
        normalizeCurrency(batch.currency) ||
        "UNSPECIFIED";
      totals.set(currency, (totals.get(currency) ?? 0n) + amount);
      packagePeople.add(line.personId);
    }
    const amountByCurrency = [...totals.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([currency, amount]) => ({
        currency,
        amount: formatAmount(amount),
      }));
    const batchIds = activeBatches
      .map((batch) => batch.id)
      .sort(compareText);
    const runIds = formalRuns
      .filter((run) =>
        FINALISED_RUN_STATUSES.has(normalizeStatus(run.status)),
      )
      .map((run) => run.id)
      .sort(compareText);
    const glComplete = !sortedPayoutBlockers.some(
      (blocker) => blocker.check === "glComplete",
    );
    const packageKey = `approval-package:${cycleId}:${batchIds.join("+")}:${amountByCurrency
      .map((entry) => `${entry.currency}=${entry.amount}`)
      .join("+")}`;
    approvalPackage = {
      packageKey,
      cycleId,
      cycleName: snapshot.cycle.name,
      period: snapshot.cycle.period,
      peopleCount: packagePeople.size,
      amountByCurrency,
      batchIds,
      runIds,
      paymentCount: payments.filter(
        (payment) => normalizeStatus(payment.status) === "PAID",
      ).length,
      glComplete,
      readiness: { evaluation: "PASS", payout: "PASS" },
      requiresHumanApproval: true,
      autoApproved: false,
      autoPaid: false,
      note: PACKAGE_NOTE,
    };
  }

  // ------------------------------------------------------------------
  // 汇总
  // ------------------------------------------------------------------
  const evaluationReadiness: PerformanceCycleReadiness = {
    domain: "EVALUATION",
    status: evaluationStatus,
    checks: buildReadinessChecks(
      EVALUATION_CHECK_CODES,
      sortedEvaluationBlockers,
      evaluationStatus,
    ),
  };
  const payoutReadiness: PerformanceCycleReadiness = {
    domain: "PAYOUT",
    status: payoutStatus,
    checks: buildReadinessChecks(
      PAYOUT_CHECK_CODES,
      sortedPayoutBlockers,
      payoutStatus,
    ),
  };

  return {
    cycleId,
    readiness: {
      evaluation: evaluationReadiness,
      payout: payoutReadiness,
    },
    blockers: {
      evaluation: sortedEvaluationBlockers,
      payout: sortedPayoutBlockers,
    },
    blockerKeys,
    actions,
    approvalPackage,
    escalations,
    sideEffects: "NONE",
    note: READ_ONLY_NOTE,
  };
}

interface GlFailure {
  code: string;
  message: string;
}

/**
 * 逐笔 PAID 支付判定 GL：显式缺失/未平衡优先；有借贷金额时必须平衡且
 * 等于支付金额；否则只能依赖批次级 glComplete 断言（fail-closed）。
 */
function findGlFailure(
  payment: PerformanceCyclePayment,
  batch: PerformanceCycleAwardBatch,
): GlFailure | null {
  const gl = payment.gl;
  if (gl?.present === false) {
    return {
      code: "GL_MISSING",
      message: `PAID payment ${payment.id} has no GL voucher`,
    };
  }
  if (gl?.balanced === false) {
    return {
      code: "GL_UNBALANCED",
      message: `PAID payment ${payment.id} has an explicitly unbalanced GL voucher`,
    };
  }
  const debit =
    gl?.totalDebit !== undefined ? parseAmount(gl.totalDebit) : null;
  const credit =
    gl?.totalCredit !== undefined ? parseAmount(gl.totalCredit) : null;
  if (gl && gl.totalDebit !== undefined && debit === null) {
    return {
      code: "GL_INVALID",
      message: `PAID payment ${payment.id} has invalid GL debit ${gl.totalDebit}`,
    };
  }
  if (gl && gl.totalCredit !== undefined && credit === null) {
    return {
      code: "GL_INVALID",
      message: `PAID payment ${payment.id} has invalid GL credit ${gl.totalCredit}`,
    };
  }
  if (debit !== null && credit !== null) {
    if (debit !== credit) {
      return {
        code: "GL_UNBALANCED",
        message: `PAID payment ${payment.id} GL is unbalanced: debit ${formatAmount(debit)} vs credit ${formatAmount(credit)}`,
      };
    }
    const amount = parseAmount(payment.amount);
    if (amount !== null && debit !== amount) {
      return {
        code: "GL_AMOUNT_MISMATCH",
        message: `PAID payment ${payment.id} is ${payment.amount} but its GL debit is ${formatAmount(debit)}`,
      };
    }
    return null;
  }
  if (debit !== null || credit !== null) {
    return {
      code: "GL_INVALID",
      message: `PAID payment ${payment.id} GL must provide both debit and credit to be verifiable`,
    };
  }
  if (batch.glComplete === true) return null;
  return {
    code: "GL_MISSING",
    message: `PAID payment ${payment.id} has no verifiable GL voucher and batch ${batch.batchNo ?? batch.id} is not glComplete`,
  };
}

/**
 * 面向编排器的薄封装：agent 本身无状态，实例可安全复用。
 */
export class PerformanceCycleAgent {
  evaluate(input: PerformanceCycleAgentInput): PerformanceCycleAgentResult {
    return evaluatePerformanceCycle(input);
  }
}
