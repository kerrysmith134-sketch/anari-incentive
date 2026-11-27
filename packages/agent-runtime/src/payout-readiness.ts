import type { DecimalString } from "@anari/domain";

/**
 * Payout Readiness（NP-PAY-READY）：奖励发放就绪判定。
 *
 * 与评价就绪（Evaluation Readiness）分开：评价就绪回答“人是否评完”，
 * 本模块回答“钱是否可以按批次安全发放/回执”。输入是某一结算窗口的
 * 人员决定、奖励批次（含行/支付/GL）以及未结申诉/退回，输出七项
 * 检查、阻断项、告警与金额汇总。
 *
 * 红线：纯函数、只读。不创建批次、不支付、不记账、不锁账；只根据
 * 调用方提供的事实做判定。任何无法证明的条件一律 fail-closed。
 */

export type PayoutReadinessCheckCode =
  | "allPeopleDecided"
  | "allAwardsBatched"
  | "batchApprovedLocked"
  | "paidMatchesDue"
  | "everyPaidHasGl"
  | "noOpenReturnsAppeals"
  | "ackImmutable";

export type PayoutReadinessCheckStatus = "PASS" | "BLOCKED" | "WARN";

export interface PayoutReadinessSource {
  type: string;
  id: string;
}

export interface PayoutReadinessCheck {
  check: PayoutReadinessCheckCode;
  status: PayoutReadinessCheckStatus;
  detail: string;
  sources: PayoutReadinessSource[];
}

export type PayoutReadinessIssueSeverity = "BLOCKER" | "WARNING";

export interface PayoutReadinessIssue {
  code: string;
  check: PayoutReadinessCheckCode;
  severity: PayoutReadinessIssueSeverity;
  message: string;
  subjectType?: string;
  subjectId?: string;
}

export interface PayoutReadinessCurrencyAmounts {
  currency: string;
  due: DecimalString;
  paid: DecimalString;
  outstanding: DecimalString;
  variance: DecimalString;
}

export interface PayoutReadinessAmounts {
  /**
   * 单币种时给出总额；多币种时总额无意义，置 null，只读 byCurrency。
   */
  currency: string | null;
  due: DecimalString | null;
  paid: DecimalString | null;
  outstanding: DecimalString | null;
  variance: DecimalString | null;
  byCurrency: PayoutReadinessCurrencyAmounts[];
}

export interface PayoutReadinessReport {
  ready: boolean;
  checks: PayoutReadinessCheck[];
  blockers: PayoutReadinessIssue[];
  warnings: PayoutReadinessIssue[];
  amounts: PayoutReadinessAmounts;
  note: string;
  generatedAt: string;
}

/** 人员决定：应参与人员必须已决（FORMAL/DECIDED）或被明确排除（EXCLUDED）。 */
export interface PayoutPersonDecision {
  personId: string;
  /** 参与资格；true 表示该人员应参与本次发放。 */
  eligibility: boolean;
  /**
   * 决定状态。只有 FORMAL / DECIDED 视为已决，EXCLUDED 视为明确排除；
   * 其它值（含未知/未来新增状态）按未决处理。
   */
  decisionStatus: string;
}

/**
 * 应发奖励清单（可选）。提供时按 source record 逐项核对“是否已进批次”，
 * 可发现同一人有多笔奖励时只入账一部分的漏批次；未提供时退化为
 * “每个应参与人员至少有一条批次行”的人员级覆盖检查。
 */
export interface PayoutDueAward {
  sourceRecordId: string;
  personId: string;
  amount?: DecimalString;
  currency?: string;
}

export interface PayoutGlPosting {
  voucherId?: string;
  /** 显式 false 表示凭证缺失，即使给出了金额。 */
  present?: boolean;
  totalDebit?: DecimalString;
  totalCredit?: DecimalString;
  /** 显式 false 直接判定未平衡。 */
  balanced?: boolean;
}

export interface PayoutPayment {
  id: string;
  lineId: string;
  amount: DecimalString;
  /** 缺省取对应行/批次币种。 */
  currency?: string;
  paymentRef: string;
  /** PAID 才计入已付；FAILED/RETURNED 只作为阻断事实。 */
  status: string;
  createdAt?: string;
  paidAt?: string;
  /**
   * ORDINARY（缺省）= 普通支付，ACK 之后出现即违约；
   * ADJUSTMENT = 审批后的调整，不按普通支付处理。
   */
  kind?: string;
  /** 可选的行级 GL 凭证；缺省时由批次的 glComplete 断言覆盖。 */
  gl?: PayoutGlPosting;
}

export interface PayoutAwardLine {
  id: string;
  personId: string;
  amount: DecimalString;
  currency: string;
  /** 来源制度记录；同一非取消批次集合内必须唯一。 */
  sourceRecordId?: string;
  sourceLineRef?: string;
}

export interface PayoutAwardBatch {
  id: string;
  batchNo?: string;
  /** APPROVED/LOCKED/EXPORTED/ACKNOWLEDGED 才算可发放；CANCELLED 不参与。 */
  status: string;
  currency: string;
  totalAmount: DecimalString;
  lines: PayoutAwardLine[];
  payments: PayoutPayment[];
  /** 该批次全部 PAID 支付均已生成且平衡的 GL 凭证。 */
  glComplete: boolean;
  /** ACKNOWLEDGED 批次的回执时间；用于证明 ACK 后未再发生普通支付。 */
  acknowledgedAt?: string;
}

export interface PayoutAppeal {
  id: string;
  /** 兼容 status / decisionStatus 两种字段名；缺省按未结处理。 */
  status?: string;
  decisionStatus?: string;
}

export interface PayoutReturnRecord {
  id: string;
  /** 只有 RESOLVED/CLOSED/REJECTED/CANCELLED 视为已结，其它按未结处理。 */
  status?: string;
}

export interface PayoutReadinessInput {
  people: PayoutPersonDecision[];
  batches: PayoutAwardBatch[];
  /** 应发奖励清单；提供时可做 source record 级漏批次核对。 */
  dueAwards?: PayoutDueAward[];
  appeals?: PayoutAppeal[];
  returns?: PayoutReturnRecord[];
}

const MICROS_PER_UNIT = 1_000_000n;

const APPROVABLE_BATCH_STATUSES: ReadonlySet<string> = new Set([
  "APPROVED",
  "LOCKED",
  "EXPORTED",
  "ACKNOWLEDGED",
]);

const DECIDED_PERSON_STATUSES: ReadonlySet<string> = new Set([
  "FORMAL",
  "DECIDED",
]);

const CLOSED_APPEAL_STATUSES: ReadonlySet<string> = new Set([
  "DECIDED",
  "CLOSED",
]);

const CLOSED_RETURN_STATUSES: ReadonlySet<string> = new Set([
  "RESOLVED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
]);

function normalizeStatus(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/** 币种统一大写；空值保留空串，由调用方决定是否阻断。 */
function normalizeCurrency(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/** 1e6 定点解析，拒绝浮点与超过 6 位小数；非法返回 null。 */
function parseMicros(value: DecimalString | undefined): bigint | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1];
  if (whole === undefined) return null;
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return BigInt(whole) * MICROS_PER_UNIT + BigInt(fraction || "0");
}

function formatMicros(value: bigint): DecimalString {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / MICROS_PER_UNIT;
  const fraction = (absolute % MICROS_PER_UNIT)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

function parseInstant(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function makeIssue(
  severity: PayoutReadinessIssueSeverity,
  check: PayoutReadinessCheckCode,
  code: string,
  message: string,
  subjectType?: string,
  subjectId?: string,
): PayoutReadinessIssue {
  return {
    code,
    check,
    severity,
    message,
    ...(subjectType && subjectId ? { subjectType, subjectId } : {}),
  };
}

/**
 * 判定一次奖励发放是否就绪。纯函数：不修改输入，不产生副作用。
 */
export function evaluatePayoutReadiness(
  input: PayoutReadinessInput,
): PayoutReadinessReport {
  const people = input.people ?? [];
  const batches = input.batches ?? [];
  const dueAwards = input.dueAwards;
  const appeals = input.appeals ?? [];
  const returns = input.returns ?? [];

  const blockers: PayoutReadinessIssue[] = [];
  const warnings: PayoutReadinessIssue[] = [];

  const block = (
    check: PayoutReadinessCheckCode,
    code: string,
    message: string,
    subjectType?: string,
    subjectId?: string,
  ) =>
    blockers.push(
      makeIssue("BLOCKER", check, code, message, subjectType, subjectId),
    );
  const warn = (
    check: PayoutReadinessCheckCode,
    code: string,
    message: string,
    subjectType?: string,
    subjectId?: string,
  ) =>
    warnings.push(
      makeIssue("WARNING", check, code, message, subjectType, subjectId),
    );

  const activeBatches = batches.filter(
    (batch) => normalizeStatus(batch.status) !== "CANCELLED",
  );
  const activeLines: Array<{ batch: PayoutAwardBatch; line: PayoutAwardLine }> =
    [];
  for (const batch of activeBatches) {
    for (const line of batch.lines ?? []) {
      activeLines.push({ batch, line });
    }
  }

  // ------------------------------------------------------------------
  // 1) allPeopleDecided：应参与人员已决或被明确排除。
  // ------------------------------------------------------------------
  const decisions = new Map<string, PayoutPersonDecision>();
  for (const person of people) {
    if (!person.personId) {
      block(
        "allPeopleDecided",
        "INVALID_PERSON_DECISION",
        "person decision has no personId",
        "PERSON_DECISION",
        person.personId,
      );
      continue;
    }
    if (decisions.has(person.personId)) {
      block(
        "allPeopleDecided",
        "DUPLICATE_PERSON_DECISION",
        `person ${person.personId} has more than one decision in this payout window`,
        "PERSON",
        person.personId,
      );
      continue;
    }
    decisions.set(person.personId, person);
  }

  const awardedPersonIds = new Set(
    activeLines.map(({ line }) => line.personId),
  );
  const requiredParticipantIds = new Set<string>();
  for (const person of people) {
    if (person.personId && person.eligibility === true) {
      requiredParticipantIds.add(person.personId);
    }
  }
  for (const personId of awardedPersonIds) {
    requiredParticipantIds.add(personId);
  }

  let missingDecisionCount = 0;
  let undecidedCount = 0;
  const undecidedStatuses = new Set<string>();
  for (const personId of requiredParticipantIds) {
    const decision = decisions.get(personId);
    if (!decision) {
      missingDecisionCount += 1;
      block(
        "allPeopleDecided",
        "MISSING_PERSON_DECISION",
        `participant ${personId} has no decision in this payout window`,
        "PERSON",
        personId,
      );
      continue;
    }
    const status = normalizeStatus(decision.decisionStatus);
    if (status !== "EXCLUDED" && !DECIDED_PERSON_STATUSES.has(status)) {
      undecidedCount += 1;
      undecidedStatuses.add(status || "MISSING");
      block(
        "allPeopleDecided",
        "UNDECIDED_PERSON",
        `participant ${personId} is not decided (status ${status || "MISSING"})`,
        "PERSON",
        personId,
      );
    }
  }

  let allPeopleDecidedDetail: string;
  if (requiredParticipantIds.size === 0) {
    if (people.length === 0 && activeBatches.length === 0) {
      warn(
        "allPeopleDecided",
        "NO_PEOPLE_OR_BATCHES",
        "no people decisions and no award batches were supplied",
      );
      allPeopleDecidedDetail =
        "no people decisions or award batches to evaluate";
    } else {
      allPeopleDecidedDetail = "no participants require a decision";
    }
  } else if (missingDecisionCount + undecidedCount > 0) {
    allPeopleDecidedDetail = `${missingDecisionCount} missing and ${undecidedCount} undecided participant decision(s) across ${requiredParticipantIds.size} participant(s)${
      undecidedStatuses.size > 0
        ? ` (undecided statuses: ${[...undecidedStatuses].join(", ")})`
        : ""
    }`;
  } else {
    allPeopleDecidedDetail = `all ${requiredParticipantIds.size} participant(s) decided or explicitly excluded`;
  }

  // ------------------------------------------------------------------
  // 2) allAwardsBatched：应发奖励都在批次，来源记录唯一。
  // ------------------------------------------------------------------
  const batchIds = new Set<string>();
  for (const batch of activeBatches) {
    if (batchIds.has(batch.id)) {
      block(
        "allAwardsBatched",
        "DUPLICATE_BATCH_ID",
        `award batch ${batch.id} appears more than once`,
        "AWARD_BATCH",
        batch.id,
      );
    }
    batchIds.add(batch.id);
  }

  const lineIds = new Set<string>();
  let duplicateLineCount = 0;
  for (const { batch, line } of activeLines) {
    if (lineIds.has(line.id)) {
      duplicateLineCount += 1;
      block(
        "allAwardsBatched",
        "DUPLICATE_LINE_ID",
        `award line ${line.id} appears more than once (batch ${batch.id})`,
        "AWARD_LINE",
        line.id,
      );
    }
    lineIds.add(line.id);
  }

  let emptyBatchCount = 0;
  for (const batch of activeBatches) {
    if ((batch.lines ?? []).length === 0) {
      emptyBatchCount += 1;
      block(
        "allAwardsBatched",
        "EMPTY_BATCH",
        `award batch ${batch.batchNo ?? batch.id} has no lines`,
        "AWARD_BATCH",
        batch.id,
      );
    }
  }

  const expectedParticipantIds = new Set<string>();
  for (const person of people) {
    if (person.eligibility !== true) continue;
    const decision = decisions.get(person.personId);
    const status = normalizeStatus(decision?.decisionStatus);
    if (DECIDED_PERSON_STATUSES.has(status)) {
      expectedParticipantIds.add(person.personId);
    }
  }
  const linePersonIds = new Set(activeLines.map(({ line }) => line.personId));
  let missingBatchPersonCount = 0;
  for (const personId of expectedParticipantIds) {
    if (!linePersonIds.has(personId)) {
      missingBatchPersonCount += 1;
      block(
        "allAwardsBatched",
        "MISSING_AWARD_BATCH",
        `participant ${personId} is decided but has no award line in any active batch`,
        "PERSON",
        personId,
      );
    }
  }

  const sourceOccurrences = new Map<
    string,
    Array<{ batch: PayoutAwardBatch; line: PayoutAwardLine }>
  >();
  let missingSourceCount = 0;
  for (const { batch, line } of activeLines) {
    const sourceRecordId = (line.sourceRecordId ?? "").trim();
    if (!sourceRecordId) {
      missingSourceCount += 1;
      warn(
        "allAwardsBatched",
        "SOURCE_RECORD_MISSING",
        `award line ${line.id} in batch ${batch.batchNo ?? batch.id} has no source record`,
        "AWARD_LINE",
        line.id,
      );
      continue;
    }
    const occurrences = sourceOccurrences.get(sourceRecordId) ?? [];
    occurrences.push({ batch, line });
    sourceOccurrences.set(sourceRecordId, occurrences);
  }
  for (const [sourceRecordId, occurrences] of sourceOccurrences) {
    if (occurrences.length > 1) {
      const batchIdsForSource = [
        ...new Set(occurrences.map(({ batch }) => batch.id)),
      ];
      block(
        "allAwardsBatched",
        "DUPLICATE_SOURCE_RECORD",
        `source record ${sourceRecordId} is referenced by ${occurrences.length} award lines across ${batchIdsForSource.length} batch(es)`,
        "SOURCE_RECORD",
        sourceRecordId,
      );
    }
  }

  let awardForExcludedCount = 0;
  for (const { line } of activeLines) {
    const decision = decisions.get(line.personId);
    if (decision && normalizeStatus(decision.decisionStatus) === "EXCLUDED") {
      awardForExcludedCount += 1;
      warn(
        "allAwardsBatched",
        "AWARD_FOR_EXCLUDED_PERSON",
        `participant ${line.personId} is explicitly excluded but line ${line.id} awards ${line.amount} ${line.currency}`,
        "AWARD_LINE",
        line.id,
      );
    }
  }

  let dueAwardNotBatchedCount = 0;
  if (dueAwards) {
    for (const dueAward of dueAwards) {
      const sourceRecordId = (dueAward.sourceRecordId ?? "").trim();
      if (!sourceRecordId) {
        block(
          "allAwardsBatched",
          "INVALID_DUE_AWARD",
          "due award has no sourceRecordId",
          "DUE_AWARD",
          dueAward.personId,
        );
        continue;
      }
      const occurrences = sourceOccurrences.get(sourceRecordId) ?? [];
      if (occurrences.length === 0) {
        dueAwardNotBatchedCount += 1;
        block(
          "allAwardsBatched",
          "DUE_AWARD_NOT_BATCHED",
          `due award source record ${sourceRecordId} for participant ${dueAward.personId} is not in any active batch`,
          "SOURCE_RECORD",
          sourceRecordId,
        );
        continue;
      }
      const occurrence = occurrences[0];
      if (!occurrence) continue;
      const { line, batch } = occurrence;
      if (
        dueAward.personId &&
        line.personId !== dueAward.personId
      ) {
        block(
          "allAwardsBatched",
          "DUE_AWARD_PERSON_MISMATCH",
          `source record ${sourceRecordId} belongs to ${line.personId}, not ${dueAward.personId}`,
          "SOURCE_RECORD",
          sourceRecordId,
        );
      }
      if (dueAward.amount !== undefined) {
        const dueMicros = parseMicros(dueAward.amount);
        const lineMicros = parseMicros(line.amount);
        if (dueMicros === null) {
          block(
            "allAwardsBatched",
            "INVALID_DUE_AWARD_AMOUNT",
            `due award ${sourceRecordId} has invalid amount ${dueAward.amount}`,
            "SOURCE_RECORD",
            sourceRecordId,
          );
        } else if (lineMicros !== null && dueMicros !== lineMicros) {
          block(
            "allAwardsBatched",
            "DUE_AWARD_AMOUNT_MISMATCH",
            `source record ${sourceRecordId} is due ${dueAward.amount} but batched as ${line.amount}`,
            "SOURCE_RECORD",
            sourceRecordId,
          );
        }
      }
      if (dueAward.currency !== undefined) {
        const dueCurrency = normalizeCurrency(dueAward.currency);
        const lineCurrency = normalizeCurrency(
          line.currency || batch.currency,
        );
        if (dueCurrency !== lineCurrency) {
          block(
            "allAwardsBatched",
            "DUE_AWARD_CURRENCY_MISMATCH",
            `source record ${sourceRecordId} is due in ${dueCurrency || "MISSING"} but batched in ${lineCurrency || "MISSING"}`,
            "SOURCE_RECORD",
            sourceRecordId,
          );
        }
      }
    }
  }

  let allAwardsBatchedDetail: string;
  if (activeBatches.length === 0) {
    const hasObligations =
      expectedParticipantIds.size > 0 || (dueAwards?.length ?? 0) > 0;
    if (hasObligations) {
      block(
        "allAwardsBatched",
        "MISSING_AWARD_BATCHES",
        `no active award batch contains the required awards (${expectedParticipantIds.size} expected participant(s), ${dueAwards?.length ?? 0} due award(s))`,
      );
      allAwardsBatchedDetail =
        "no active award batches for the required awards";
    } else {
      allAwardsBatchedDetail = "no awards to batch";
    }
  } else {
    allAwardsBatchedDetail = `${activeLines.length} line(s) across ${activeBatches.length} active batch(es); ${sourceOccurrences.size} source record(s), ${emptyBatchCount} empty batch(es), ${missingBatchPersonCount} missing participant coverage, ${dueAwardNotBatchedCount} unbatched due award(s), ${duplicateLineCount} duplicate line id(s), ${missingSourceCount} line(s) without source record, ${awardForExcludedCount} award(s) for excluded participant(s)`;
  }

  // ------------------------------------------------------------------
  // 3) batchApprovedLocked：批次状态已审批/锁定/导出/回执。
  // ------------------------------------------------------------------
  let blockedBatchCount = 0;
  for (const batch of activeBatches) {
    const status = normalizeStatus(batch.status);
    if (!APPROVABLE_BATCH_STATUSES.has(status)) {
      blockedBatchCount += 1;
      block(
        "batchApprovedLocked",
        "BATCH_NOT_APPROVED",
        `award batch ${batch.batchNo ?? batch.id} has status ${status || "MISSING"}, expected APPROVED/LOCKED/EXPORTED/ACKNOWLEDGED`,
        "AWARD_BATCH",
        batch.id,
      );
    }
  }
  const batchApprovedLockedDetail =
    activeBatches.length === 0
      ? "no active award batches"
      : blockedBatchCount === 0
        ? `all ${activeBatches.length} active batch(es) are APPROVED/LOCKED/EXPORTED/ACKNOWLEDGED`
        : `${blockedBatchCount}/${activeBatches.length} active batch(es) are not approved/locked/exported/acknowledged`;

  // ------------------------------------------------------------------
  // 4) paidMatchesDue：ΣPAID = 应付总额，且没有 PARTIAL 行。
  // ------------------------------------------------------------------
  const currencyTotals = new Map<
    string,
    { due: bigint; paid: bigint }
  >();
  const totalsFor = (currency: string) => {
    const existing = currencyTotals.get(currency);
    if (existing) return existing;
    const created = { due: 0n, paid: 0n };
    currencyTotals.set(currency, created);
    return created;
  };

  for (const batch of activeBatches) {
    const batchCurrency = normalizeCurrency(batch.currency);
    if (!batchCurrency) {
      block(
        "paidMatchesDue",
        "MISSING_BATCH_CURRENCY",
        `award batch ${batch.batchNo ?? batch.id} has no currency`,
        "AWARD_BATCH",
        batch.id,
      );
    }
    const totalMicros = parseMicros(batch.totalAmount);
    if (totalMicros === null) {
      block(
        "paidMatchesDue",
        "INVALID_BATCH_TOTAL",
        `award batch ${batch.batchNo ?? batch.id} has invalid total ${batch.totalAmount}`,
        "AWARD_BATCH",
        batch.id,
      );
    }

    const lineById = new Map<string, PayoutAwardLine>();
    let lineSum = 0n;
    let hasInvalidLineAmount = false;
    for (const line of batch.lines ?? []) {
      if (!lineById.has(line.id)) lineById.set(line.id, line);
      const lineMicros = parseMicros(line.amount);
      if (lineMicros === null) {
        hasInvalidLineAmount = true;
        block(
          "paidMatchesDue",
          "INVALID_LINE_AMOUNT",
          `award line ${line.id} has invalid amount ${line.amount}`,
          "AWARD_LINE",
          line.id,
        );
        continue;
      }
      lineSum += lineMicros;
      const lineCurrency = normalizeCurrency(line.currency || batchCurrency);
      if (!lineCurrency) {
        block(
          "paidMatchesDue",
          "MISSING_LINE_CURRENCY",
          `award line ${line.id} has no currency`,
          "AWARD_LINE",
          line.id,
        );
      } else if (
        batchCurrency &&
        lineCurrency !== batchCurrency
      ) {
        block(
          "paidMatchesDue",
          "CURRENCY_MISMATCH",
          `award line ${line.id} is ${lineCurrency} but batch ${batch.batchNo ?? batch.id} is ${batchCurrency}`,
          "AWARD_LINE",
          line.id,
        );
      }
      totalsFor(lineCurrency || "UNSPECIFIED").due += lineMicros;
    }

    if (
      totalMicros !== null &&
      !hasInvalidLineAmount &&
      totalMicros !== lineSum
    ) {
      block(
        "paidMatchesDue",
        "BATCH_TOTAL_MISMATCH",
        `batch ${batch.batchNo ?? batch.id} total is ${batch.totalAmount} but its lines sum to ${formatMicros(lineSum)}`,
        "AWARD_BATCH",
        batch.id,
      );
    }

    const paidByLine = new Map<string, bigint>();
    for (const payment of batch.payments ?? []) {
      if (normalizeStatus(payment.status) !== "PAID") continue;
      const paidMicros = parseMicros(payment.amount);
      if (paidMicros === null) {
        block(
          "paidMatchesDue",
          "INVALID_PAYMENT_AMOUNT",
          `payment ${payment.id} has invalid amount ${payment.amount}`,
          "PAYMENT",
          payment.id,
        );
        continue;
      }
      const line = lineById.get(payment.lineId);
      if (!line) {
        block(
          "paidMatchesDue",
          "PAYMENT_FOR_UNKNOWN_LINE",
          `payment ${payment.id} references line ${payment.lineId}, which is not in batch ${batch.batchNo ?? batch.id}`,
          "PAYMENT",
          payment.id,
        );
      }
      const lineCurrency = line
        ? normalizeCurrency(line.currency || batchCurrency)
        : batchCurrency;
      const paymentCurrency = normalizeCurrency(
        payment.currency || lineCurrency || batchCurrency,
      );
      if (
        (batchCurrency && paymentCurrency !== batchCurrency) ||
        (lineCurrency && paymentCurrency !== lineCurrency)
      ) {
        block(
          "paidMatchesDue",
          "CURRENCY_MISMATCH",
          `payment ${payment.id} is ${paymentCurrency || "MISSING"} but its line/batch is ${lineCurrency || batchCurrency || "MISSING"}`,
          "PAYMENT",
          payment.id,
        );
      }
      totalsFor(paymentCurrency || "UNSPECIFIED").paid += paidMicros;
      if (line) {
        paidByLine.set(
          line.id,
          (paidByLine.get(line.id) ?? 0n) + paidMicros,
        );
      }
    }

    for (const line of batch.lines ?? []) {
      const lineMicros = parseMicros(line.amount);
      if (lineMicros === null) continue;
      const paidMicros = paidByLine.get(line.id) ?? 0n;
      if (paidMicros === lineMicros) continue;
      if (paidMicros === 0n) {
        block(
          "paidMatchesDue",
          "UNPAID_AWARD_LINE",
          `award line ${line.id} is unpaid (due ${line.amount} ${line.currency})`,
          "AWARD_LINE",
          line.id,
        );
      } else if (paidMicros < lineMicros) {
        block(
          "paidMatchesDue",
          "PARTIAL_AWARD_LINE",
          `award line ${line.id} is PARTIAL: paid ${formatMicros(paidMicros)} of ${line.amount} ${line.currency}`,
          "AWARD_LINE",
          line.id,
        );
      } else {
        block(
          "paidMatchesDue",
          "OVERPAID_AWARD_LINE",
          `award line ${line.id} is overpaid: paid ${formatMicros(paidMicros)} of ${line.amount} ${line.currency}`,
          "AWARD_LINE",
          line.id,
        );
      }
    }
  }

  const sortedCurrencies = [...currencyTotals.keys()].sort((a, b) =>
    a.localeCompare(b),
  );
  const byCurrency: PayoutReadinessCurrencyAmounts[] = sortedCurrencies.map(
    (currency) => {
      const totals = totalsFor(currency);
      return {
        currency,
        due: formatMicros(totals.due),
        paid: formatMicros(totals.paid),
        outstanding: formatMicros(
          totals.due > totals.paid ? totals.due - totals.paid : 0n,
        ),
        variance: formatMicros(totals.paid - totals.due),
      };
    },
  );
  for (const currencyAmount of byCurrency) {
    const totals = totalsFor(currencyAmount.currency);
    if (totals.due !== totals.paid) {
      block(
        "paidMatchesDue",
        "PAYMENT_MISMATCH",
        `currency ${currencyAmount.currency}: paid ${currencyAmount.paid} does not equal due ${currencyAmount.due} (variance ${currencyAmount.variance})`,
        "CURRENCY",
        currencyAmount.currency,
      );
    }
  }

  const singleCurrency = byCurrency.length === 1 ? byCurrency[0] : undefined;
  const amounts: PayoutReadinessAmounts = {
    currency: singleCurrency?.currency ?? null,
    due: singleCurrency?.due ?? (byCurrency.length === 0 ? "0" : null),
    paid: singleCurrency?.paid ?? (byCurrency.length === 0 ? "0" : null),
    outstanding:
      singleCurrency?.outstanding ?? (byCurrency.length === 0 ? "0" : null),
    variance:
      singleCurrency?.variance ?? (byCurrency.length === 0 ? "0" : null),
    byCurrency,
  };

  const paidMatchesDueIssueCount = blockers.filter(
    (issue) => issue.check === "paidMatchesDue",
  ).length;
  const paidMatchesDueDetail =
    activeBatches.length === 0
      ? "no active award batches"
      : paidMatchesDueIssueCount === 0
        ? `paid equals due in ${byCurrency.length} currency bucket(s)`
        : `${paidMatchesDueIssueCount} amount/payment issue(s); ${byCurrency
            .map(
              (entry) =>
                `${entry.currency} due ${entry.due} paid ${entry.paid}`,
            )
            .join(", ")}`;

  // ------------------------------------------------------------------
  // 5) everyPaidHasGl：每条 PAID 有 GL 且 balanced。
  // ------------------------------------------------------------------
  let paidWithGlCount = 0;
  let paidPaymentTotal = 0;
  for (const batch of activeBatches) {
    const paidPayments = (batch.payments ?? []).filter(
      (payment) => normalizeStatus(payment.status) === "PAID",
    );
    if (paidPayments.length === 0) continue;
    paidPaymentTotal += paidPayments.length;
    if (batch.glComplete !== true) {
      block(
        "everyPaidHasGl",
        "GL_NOT_COMPLETE",
        `batch ${batch.batchNo ?? batch.id} has ${paidPayments.length} PAID payment(s) but glComplete is not true`,
        "AWARD_BATCH",
        batch.id,
      );
    }
    for (const payment of paidPayments) {
      const gl = payment.gl;
      if (!gl) continue; // 批次级 glComplete 已断言全部 PAID 均有已平衡凭证。
      if (gl.present === false) {
        block(
          "everyPaidHasGl",
          "GL_MISSING",
          `PAID payment ${payment.id} has no GL voucher`,
          "PAYMENT",
          payment.id,
        );
        continue;
      }
      if (gl.balanced === false) {
        block(
          "everyPaidHasGl",
          "GL_UNBALANCED",
          `PAID payment ${payment.id} has an explicitly unbalanced GL voucher`,
          "PAYMENT",
          payment.id,
        );
      }
      const debit = gl.totalDebit === undefined
        ? null
        : parseMicros(gl.totalDebit);
      const credit = gl.totalCredit === undefined
        ? null
        : parseMicros(gl.totalCredit);
      if (gl.totalDebit !== undefined && debit === null) {
        block(
          "everyPaidHasGl",
          "INVALID_GL_AMOUNT",
          `PAID payment ${payment.id} has invalid GL debit ${gl.totalDebit}`,
          "PAYMENT",
          payment.id,
        );
      }
      if (gl.totalCredit !== undefined && credit === null) {
        block(
          "everyPaidHasGl",
          "INVALID_GL_AMOUNT",
          `PAID payment ${payment.id} has invalid GL credit ${gl.totalCredit}`,
          "PAYMENT",
          payment.id,
        );
      }
      const hasBothSides = debit !== null && credit !== null;
      if (hasBothSides) {
        paidWithGlCount += 1;
        if (debit !== credit) {
          block(
            "everyPaidHasGl",
            "GL_UNBALANCED",
            `PAID payment ${payment.id} GL is unbalanced: debit ${formatMicros(debit)} vs credit ${formatMicros(credit)}`,
            "PAYMENT",
            payment.id,
          );
        }
        const paymentMicros = parseMicros(payment.amount);
        if (paymentMicros !== null && debit !== paymentMicros) {
          block(
            "everyPaidHasGl",
            "GL_AMOUNT_MISMATCH",
            `PAID payment ${payment.id} is ${payment.amount} but its GL debit is ${formatMicros(debit)}`,
            "PAYMENT",
            payment.id,
          );
        }
      } else if (
        debit !== null ||
        credit !== null ||
        gl.balanced === undefined
      ) {
        warn(
          "everyPaidHasGl",
          "GL_UNVERIFIABLE",
          `PAID payment ${payment.id} GL voucher lacks both debit and credit amounts to verify balance`,
          "PAYMENT",
          payment.id,
        );
      }
    }
  }
  const everyPaidHasGlDetail =
    paidPaymentTotal === 0
      ? "no PAID payment requires GL"
      : blockers.some((issue) => issue.check === "everyPaidHasGl") ||
          warnings.some((issue) => issue.check === "everyPaidHasGl")
        ? "one or more PAID payments lack a complete balanced GL voucher"
        : `all ${paidPaymentTotal} PAID payment(s) are covered by glComplete and/or a balanced GL voucher (${paidWithGlCount} per-payment voucher(s) verified)`;

  // ------------------------------------------------------------------
  // 6) noOpenReturnsAppeals：无 RETURNED/FAILED、未结申诉/退回。
  // ------------------------------------------------------------------
  let returnedFailedPayments = 0;
  for (const batch of batches) {
    for (const payment of batch.payments ?? []) {
      const status = normalizeStatus(payment.status);
      if (status === "RETURNED" || status === "FAILED") {
        returnedFailedPayments += 1;
        block(
          "noOpenReturnsAppeals",
          status === "RETURNED" ? "PAYMENT_RETURNED" : "PAYMENT_FAILED",
          `payment ${payment.id} for batch ${batch.batchNo ?? batch.id} is ${status}`,
          "PAYMENT",
          payment.id,
        );
      }
    }
  }

  let openAppealCount = 0;
  for (const appeal of appeals) {
    const status = normalizeStatus(
      (appeal.status ?? "").trim()
        ? appeal.status
        : appeal.decisionStatus,
    );
    if (!CLOSED_APPEAL_STATUSES.has(status)) {
      openAppealCount += 1;
      block(
        "noOpenReturnsAppeals",
        "OPEN_APPEAL",
        `appeal ${appeal.id} is not decided/closed (status ${status || "MISSING"})`,
        "APPEAL",
        appeal.id,
      );
    }
  }

  let openReturnCount = 0;
  for (const returnRecord of returns) {
    const status = normalizeStatus(returnRecord.status);
    if (!CLOSED_RETURN_STATUSES.has(status)) {
      openReturnCount += 1;
      block(
        "noOpenReturnsAppeals",
        "OPEN_RETURN",
        `return ${returnRecord.id} is not resolved/closed (status ${status || "MISSING"})`,
        "RETURN",
        returnRecord.id,
      );
    }
  }

  const noOpenReturnsAppealsDetail =
    returnedFailedPayments + openAppealCount + openReturnCount === 0
      ? "no returned/failed payments, open appeals or open returns"
      : `${returnedFailedPayments} returned/failed payment(s), ${openAppealCount} open appeal(s), ${openReturnCount} open return(s)`;

  // ------------------------------------------------------------------
  // 7) ackImmutable：ACK 后不再有普通支付。
  // ------------------------------------------------------------------
  const acknowledgedBatches = activeBatches.filter(
    (batch) => normalizeStatus(batch.status) === "ACKNOWLEDGED",
  );
  let paymentAfterAckCount = 0;
  for (const batch of acknowledgedBatches) {
    const ackAt = parseInstant(batch.acknowledgedAt);
    const payments = batch.payments ?? [];
    if (ackAt === null) {
      if (payments.length > 0) {
        block(
          "ackImmutable",
          "ACK_TIMESTAMP_MISSING",
          `acknowledged batch ${batch.batchNo ?? batch.id} has payments but no valid acknowledgedAt`,
          "AWARD_BATCH",
          batch.id,
        );
      } else {
        warn(
          "ackImmutable",
          "ACK_TIMESTAMP_MISSING",
          `acknowledged batch ${batch.batchNo ?? batch.id} has no acknowledgedAt; immutability cannot be verified`,
          "AWARD_BATCH",
          batch.id,
        );
      }
      continue;
    }
    for (const payment of payments) {
      if (normalizeStatus(payment.kind) === "ADJUSTMENT") continue;
      const timestamps = [
        parseInstant(payment.createdAt),
        parseInstant(payment.paidAt),
      ].filter((value): value is number => value !== null);
      if (timestamps.length === 0) {
        warn(
          "ackImmutable",
          "PAYMENT_TIMESTAMP_MISSING",
          `payment ${payment.id} on acknowledged batch ${batch.batchNo ?? batch.id} has no timestamp; cannot prove it preceded ACK`,
          "PAYMENT",
          payment.id,
        );
        continue;
      }
      if (timestamps.some((timestamp) => timestamp > ackAt)) {
        paymentAfterAckCount += 1;
        block(
          "ackImmutable",
          "PAYMENT_AFTER_ACK",
          `payment ${payment.id} on acknowledged batch ${batch.batchNo ?? batch.id} is recorded after ACK`,
          "PAYMENT",
          payment.id,
        );
      }
    }
  }
  const ackImmutableDetail =
    acknowledgedBatches.length === 0
      ? "no ACKNOWLEDGED batch to check"
      : paymentAfterAckCount === 0
        ? `no ordinary payment after ACK across ${acknowledgedBatches.length} acknowledged batch(es)`
        : `${paymentAfterAckCount} ordinary payment(s) recorded after ACK`;

  // ------------------------------------------------------------------
  // 汇总
  // ------------------------------------------------------------------
  const statusFor = (
    check: PayoutReadinessCheckCode,
  ): PayoutReadinessCheckStatus => {
    if (blockers.some((issue) => issue.check === check)) return "BLOCKED";
    if (warnings.some((issue) => issue.check === check)) return "WARN";
    return "PASS";
  };

  const checks: PayoutReadinessCheck[] = [
    {
      check: "allPeopleDecided",
      status: statusFor("allPeopleDecided"),
      detail: allPeopleDecidedDetail,
      sources: [
        ...people.map((person) => ({
          type: "PERSON_DECISION",
          id: person.personId,
        })),
        ...[...awardedPersonIds].map((personId) => ({
          type: "PERSON",
          id: personId,
        })),
      ],
    },
    {
      check: "allAwardsBatched",
      status: statusFor("allAwardsBatched"),
      detail: allAwardsBatchedDetail,
      sources: activeLines.map(({ line }) => ({
        type: "AWARD_LINE",
        id: line.id,
      })),
    },
    {
      check: "batchApprovedLocked",
      status: statusFor("batchApprovedLocked"),
      detail: batchApprovedLockedDetail,
      sources: activeBatches.map((batch) => ({
        type: "AWARD_BATCH",
        id: batch.id,
      })),
    },
    {
      check: "paidMatchesDue",
      status: statusFor("paidMatchesDue"),
      detail: paidMatchesDueDetail,
      sources: activeBatches.flatMap((batch) => [
        { type: "AWARD_BATCH", id: batch.id },
        ...(batch.payments ?? []).map((payment) => ({
          type: "PAYMENT",
          id: payment.id,
        })),
      ]),
    },
    {
      check: "everyPaidHasGl",
      status: statusFor("everyPaidHasGl"),
      detail: everyPaidHasGlDetail,
      sources: activeBatches.flatMap((batch) =>
        (batch.payments ?? [])
          .filter((payment) => normalizeStatus(payment.status) === "PAID")
          .map((payment) => ({ type: "PAYMENT", id: payment.id })),
      ),
    },
    {
      check: "noOpenReturnsAppeals",
      status: statusFor("noOpenReturnsAppeals"),
      detail: noOpenReturnsAppealsDetail,
      sources: [
        ...appeals.map((appeal) => ({ type: "APPEAL", id: appeal.id })),
        ...returns.map((returnRecord) => ({
          type: "RETURN",
          id: returnRecord.id,
        })),
      ],
    },
    {
      check: "ackImmutable",
      status: statusFor("ackImmutable"),
      detail: ackImmutableDetail,
      sources: acknowledgedBatches.map((batch) => ({
        type: "AWARD_BATCH",
        id: batch.id,
      })),
    },
  ];

  const ready = checks.every((check) => check.status === "PASS");

  return {
    ready,
    checks,
    blockers,
    warnings,
    amounts,
    note: "Read-only payout readiness report. The agent does not create batches, pay, post GL entries, lock or settle — those remain human/approval-gated actions.",
    generatedAt: new Date().toISOString(),
  };
}
