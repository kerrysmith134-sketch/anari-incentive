/**
 * 确定性 Agent 辅助（不调用外部 LLM）。
 *
 * 三个能力都是纯函数：给定同样的输入必然得到同样的输出，不读 store、
 * 不写库、不发审计、不做网络调用。金额与比例一律用定点整数
 * （金额 1e6 标度，比例 basis points）比较，避免 IEEE-754 漂移。
 *
 * 1. suggestFieldMappings：根据样例记录的顶层键名/类型，给出
 *    sourceField → targetField 的启发式映射建议（带 confidence/reason）。
 * 2. detectSyncAnomalies：对同步运行计数做规则诊断（隔离/重复/连续失败/
 *    抓取量突增骤降/计数不平），返回 severity/explanation/evidence。
 * 3. explainReconciliation：对账差异分类并给出可执行下一步；0 差异不报。
 */
import { divRound, formatDecimal, parseDecimal } from "@anari/policy-dsl";

export const AGENT_ASSIST_TARGET_TYPES = [
  "COMMERCIAL_OPPORTUNITY",
  "WORK_ITEM",
  "FINANCIAL_FACT",
] as const;

export type AgentAssistTargetType = (typeof AGENT_ASSIST_TARGET_TYPES)[number];

// ----------------------------------------------------------------------
// 字段映射建议
// ----------------------------------------------------------------------

type SampleKind = "string" | "number" | "boolean" | "object" | "array" | "null";

type TargetFieldKind =
  | "identifier"
  | "text"
  | "decimal"
  | "currency"
  | "datetime"
  | "enum"
  | "object";

type MatchTier =
  | "EXACT_TARGET"
  | "EXACT_ALIAS"
  | "ALIAS_SUFFIX"
  | "ALIAS_TOKENS"
  | "TOKEN_OVERLAP";

interface TargetFieldSpec {
  readonly field: string;
  readonly required: boolean;
  readonly kind: TargetFieldKind;
  readonly aliases: readonly string[];
  readonly note?: string;
}

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * 目标字段以连接器/导入路径实际读取的规范字段为准：
 * - COMMERCIAL_OPPORTUNITY：sync-runner 的 commercial opportunity 投影。
 * - WORK_ITEM：114 规范工作项导入契约（importWorkItemSchema）。
 * - FINANCIAL_FACT：parseFinancialFact 的 payload 字段。
 */
const TARGET_FIELD_SPECS: Record<
  AgentAssistTargetType,
  readonly TargetFieldSpec[]
> = {
  COMMERCIAL_OPPORTUNITY: [
    {
      field: "externalOpportunityId",
      required: true,
      kind: "identifier",
      aliases: [
        "external_opportunity_id",
        "opportunity_id",
        "opportunityid",
        "deal_id",
        "dealid",
        "deal_external_id",
        "opportunity_external_id",
      ],
    },
    {
      field: "externalAccountId",
      required: true,
      kind: "identifier",
      aliases: [
        "external_account_id",
        "account_id",
        "accountid",
        "account_external_id",
        "company_id",
        "customer_id",
        "crm_account_id",
        "account_number",
      ],
    },
    {
      field: "accountName",
      required: true,
      kind: "text",
      aliases: [
        "account_name",
        "company_name",
        "company",
        "customer_name",
        "client_name",
        "account",
      ],
    },
    {
      field: "name",
      required: true,
      kind: "text",
      aliases: [
        "name",
        "opportunity_name",
        "deal_name",
        "title",
        "subject",
        "opportunity",
      ],
    },
    {
      field: "stage",
      required: false,
      kind: "enum",
      aliases: [
        "stage",
        "deal_stage",
        "dealstage",
        "opportunity_stage",
        "pipeline_stage",
        "sales_stage",
        "status",
      ],
    },
    {
      field: "estimatedAmount",
      required: false,
      kind: "decimal",
      aliases: [
        "estimated_amount",
        "amount",
        "value",
        "deal_value",
        "dealvalue",
        "expected_value",
        "expected_revenue",
        "opportunity_amount",
        "arr",
        "mrr",
        "revenue",
      ],
      note: "amount is only imported when currency is also present",
    },
    {
      field: "currency",
      required: true,
      kind: "currency",
      aliases: ["currency", "currency_code", "ccy", "curr"],
    },
    {
      field: "ownerPersonId",
      required: false,
      kind: "identifier",
      aliases: [
        "owner_person_id",
        "owner_id",
        "ownerid",
        "owner",
        "account_owner",
        "sales_rep",
      ],
    },
  ],
  WORK_ITEM: [
    {
      field: "externalId",
      required: true,
      kind: "identifier",
      aliases: [
        "external_id",
        "id",
        "key",
        "ticket_id",
        "issue_id",
        "work_item_id",
        "task_id",
        "external_key",
      ],
    },
    {
      field: "projectId",
      required: true,
      kind: "identifier",
      aliases: [
        "project_id",
        "projectid",
        "project",
        "project_key",
        "board_id",
        "space_id",
      ],
    },
    {
      field: "title",
      required: true,
      kind: "text",
      aliases: ["title", "name", "summary", "subject"],
    },
    {
      field: "type",
      required: true,
      kind: "enum",
      aliases: ["type", "work_item_type", "issue_type", "ticket_type", "kind"],
    },
    {
      field: "status",
      required: true,
      kind: "enum",
      aliases: ["status", "state", "work_item_status", "ticket_status"],
    },
    {
      field: "priority",
      required: false,
      kind: "enum",
      aliases: ["priority", "severity", "importance"],
    },
    {
      field: "assigneePersonId",
      required: false,
      kind: "identifier",
      aliases: [
        "assignee_person_id",
        "assignee_id",
        "assignee",
        "assigneeid",
        "owner_id",
      ],
    },
    {
      field: "reporterPersonId",
      required: false,
      kind: "identifier",
      aliases: [
        "reporter_person_id",
        "reporter_id",
        "reporter",
        "created_by",
        "author_id",
        "creator_id",
      ],
    },
    {
      field: "startedAt",
      required: false,
      kind: "datetime",
      aliases: ["started_at", "start_date", "started", "start_time", "start"],
    },
    {
      field: "dueAt",
      required: false,
      kind: "datetime",
      aliases: ["due_at", "due_date", "due", "deadline", "target_date"],
    },
    {
      field: "completedAt",
      required: false,
      kind: "datetime",
      aliases: [
        "completed_at",
        "completed_date",
        "completed",
        "closed_at",
        "done_at",
        "resolved_at",
      ],
    },
    {
      field: "weight",
      required: false,
      kind: "decimal",
      aliases: ["weight", "weightage", "effort", "story_points", "points"],
    },
    {
      field: "amount",
      required: false,
      kind: "decimal",
      aliases: ["amount", "budget", "bounty_amount", "value", "cost"],
      note: "currency is also required when amount is present",
    },
    {
      field: "currency",
      required: false,
      kind: "currency",
      aliases: ["currency", "currency_code", "ccy", "curr"],
    },
  ],
  FINANCIAL_FACT: [
    {
      field: "amount",
      required: true,
      kind: "decimal",
      aliases: [
        "amount",
        "gross_amount",
        "net_amount",
        "total_amount",
        "value",
        "invoice_amount",
        "payment_amount",
        "cost_amount",
        "revenue",
      ],
    },
    {
      field: "currency",
      required: true,
      kind: "currency",
      aliases: ["currency", "currency_code", "ccy", "curr"],
    },
    {
      field: "legalEntityId",
      required: false,
      kind: "identifier",
      aliases: [
        "legal_entity_id",
        "legalentity",
        "legal_entity",
        "entity_id",
        "entity",
        "company_code",
      ],
      note: "conditional: only needed when recognitionStatus is POSTED",
    },
    {
      field: "orderId",
      required: false,
      kind: "identifier",
      aliases: [
        "order_id",
        "sales_order_id",
        "order_number",
        "order",
      ],
    },
    {
      field: "contractRef",
      required: false,
      kind: "text",
      aliases: [
        "contract_ref",
        "contract_id",
        "contract_number",
        "contract",
        "agreement_id",
      ],
    },
    {
      field: "instrumentType",
      required: false,
      kind: "enum",
      aliases: [
        "instrument_type",
        "instrument",
        "document_type",
        "doc_type",
        "voucher_type",
      ],
      note: "conditional: only needed when recognitionStatus is POSTED",
    },
    {
      field: "recognitionStatus",
      required: false,
      kind: "enum",
      aliases: [
        "recognition_status",
        "recognition",
        "posting_status",
        "recognition_state",
      ],
    },
    {
      field: "accountingPeriod",
      required: false,
      kind: "text",
      aliases: [
        "accounting_period",
        "period",
        "period_id",
        "fiscal_period",
        "posting_period",
      ],
      note: "conditional: only needed when recognitionStatus is POSTED",
    },
    {
      field: "sourceVersion",
      required: false,
      kind: "text",
      aliases: [
        "source_version",
        "version",
        "revision",
        "record_version",
        "etag",
      ],
      note: "conditional: only needed when recognitionStatus is POSTED",
    },
    {
      field: "reversalOf",
      required: false,
      kind: "text",
      aliases: ["reversal_of", "reverses", "reversal", "reversed_id"],
    },
    {
      field: "reopeningRef",
      required: false,
      kind: "text",
      aliases: ["reopening_ref", "reopen_ref", "reopened_by"],
    },
    {
      field: "fxSnapshot",
      required: false,
      kind: "object",
      aliases: ["fx_snapshot", "fx", "exchange_rate", "fx_rate", "rate_snapshot"],
    },
  ],
};

/** 这些前缀只表示来源系统的包裹层，不携带业务语义（如 properties.amount）。 */
const IGNORED_KEY_PREFIXES = new Set([
  "properties",
  "property",
  "fields",
  "field",
  "data",
  "attributes",
  "attribute",
  "record",
  "payload",
  "item",
]);

/** 单 token 通用别名：仅单独命中时才给高置信度。 */
const GENERIC_ALIAS_TOKENS = new Set([
  "id",
  "key",
  "name",
  "title",
  "value",
  "amount",
  "type",
  "status",
  "stage",
  "date",
  "period",
  "currency",
  "rate",
  "owner",
  "assignee",
  "reporter",
  "priority",
  "weight",
  "version",
  "project",
  "account",
  "company",
  "contract",
  "order",
]);

const TIER_SCORE_BPS: Record<MatchTier, number> = {
  EXACT_TARGET: 9800,
  EXACT_ALIAS: 9200,
  ALIAS_SUFFIX: 8800,
  ALIAS_TOKENS: 7400,
  TOKEN_OVERLAP: 6800,
};

const TIER_RANK: Record<MatchTier, number> = {
  EXACT_TARGET: 5,
  EXACT_ALIAS: 4,
  ALIAS_SUFFIX: 3,
  ALIAS_TOKENS: 2,
  TOKEN_OVERLAP: 1,
};

const MIN_CONFIDENCE_BPS = 6000;

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sampleKindOf(value: unknown): SampleKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") {
    return Number.isFinite(value) ? "number" : "null";
  }
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return "null";
}

/**
 * 键名规范化：camelCase → 空格，非字母数字 → 分隔符，去掉来源系统包裹前缀。
 * 例：properties.dealstage → ["dealstage"]；opportunity_id → ["opportunity","id"]。
 */
function tokenizeKey(key: string): string[] {
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
  let start = 0;
  while (
    start < tokens.length - 1 &&
    IGNORED_KEY_PREFIXES.has(tokens[start] ?? "")
  ) {
    start += 1;
  }
  return tokens.slice(start);
}

function endsWithTokens(source: string[], suffix: string[]): boolean {
  if (suffix.length === 0 || suffix.length > source.length) return false;
  const offset = source.length - suffix.length;
  return suffix.every((token, index) => source[offset + index] === token);
}

function isSubsequence(needle: string[], haystack: string[]): boolean {
  if (needle.length === 0) return false;
  let index = 0;
  for (const token of haystack) {
    if (token === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return index === needle.length;
}

function sharesToken(needle: string[], haystack: string[]): boolean {
  const tokens = new Set(haystack);
  return needle.some((token) => token.length >= 3 && tokens.has(token));
}

interface MatchResult {
  readonly tier: MatchTier;
  readonly alias: string | null;
}

function aliasMatch(
  sourceTokens: string[],
  sourceJoined: string,
  alias: string,
): MatchResult | null {
  const aliasTokens = tokenizeKey(alias);
  if (aliasTokens.length === 0) return null;
  const aliasJoined = aliasTokens.join("_");
  if (sourceJoined === aliasJoined) {
    return { tier: "EXACT_ALIAS", alias };
  }
  if (
    sourceTokens.length > aliasTokens.length &&
    endsWithTokens(sourceTokens, aliasTokens) &&
    (aliasTokens.length >= 2 || !GENERIC_ALIAS_TOKENS.has(aliasJoined))
  ) {
    return { tier: "ALIAS_SUFFIX", alias };
  }
  if (aliasTokens.length >= 2 && isSubsequence(aliasTokens, sourceTokens)) {
    return { tier: "ALIAS_TOKENS", alias };
  }
  if (sharesToken(aliasTokens, sourceTokens)) {
    return { tier: "TOKEN_OVERLAP", alias };
  }
  return null;
}

function matchTier(
  sourceTokens: string[],
  sourceJoined: string,
  spec: TargetFieldSpec,
): MatchResult | null {
  const targetJoined = tokenizeKey(spec.field).join("_");
  if (sourceJoined === targetJoined) {
    return { tier: "EXACT_TARGET", alias: spec.field };
  }
  let best: MatchResult | null = null;
  for (const alias of spec.aliases) {
    const result = aliasMatch(sourceTokens, sourceJoined, alias);
    if (!result) continue;
    if (!best || TIER_RANK[result.tier] > TIER_RANK[best.tier]) {
      best = result;
    }
  }
  return best;
}

function isCompatible(
  kind: TargetFieldKind,
  value: unknown,
  sampleKind: SampleKind,
): boolean {
  switch (kind) {
    case "identifier":
    case "text":
      return sampleKind === "string" || sampleKind === "number";
    case "decimal":
      return (
        sampleKind === "number" ||
        (sampleKind === "string" &&
          DECIMAL_PATTERN.test(String(value).trim()))
      );
    case "currency":
      return (
        sampleKind === "string" &&
        CURRENCY_PATTERN.test(String(value).trim())
      );
    case "datetime":
      return sampleKind === "string" && String(value).trim().length > 0;
    case "enum":
      return sampleKind === "string" && String(value).trim().length > 0;
    case "object":
      return sampleKind === "object";
  }
}

function typeBonusBps(
  kind: TargetFieldKind,
  value: unknown,
  sampleKind: SampleKind,
): number {
  if (kind === "decimal" && sampleKind === "number") return 200;
  if (
    kind === "datetime" &&
    sampleKind === "string" &&
    ISO_DATE_PREFIX.test(String(value).trim())
  ) {
    return 200;
  }
  return 0;
}

interface MappingCandidate {
  readonly sourceField: string;
  readonly specIndex: number;
  readonly spec: TargetFieldSpec;
  readonly scoreBps: number;
  readonly tier: MatchTier;
  readonly matchedAlias: string | null;
  readonly sampleKind: SampleKind;
}

export interface MappingFieldSuggestion {
  readonly sourceField: string;
  readonly targetField: string;
  readonly confidence: number;
  readonly reason: string;
  readonly required: boolean;
}

export interface MappingSuggestionResult {
  readonly targetType: AgentAssistTargetType;
  readonly suggestions: MappingFieldSuggestion[];
  readonly unmatchedSourceFields: string[];
  readonly missingRequiredFields: string[];
}

function reasonFor(candidate: MappingCandidate): string {
  const source = candidate.sourceField;
  const target = candidate.spec.field;
  const alias = candidate.matchedAlias ?? target;
  let text: string;
  switch (candidate.tier) {
    case "EXACT_TARGET":
      text = `source field "${source}" matches target field "${target}" exactly`;
      break;
    case "EXACT_ALIAS":
      text = `source field "${source}" is a known alias of target field "${target}"`;
      break;
    case "ALIAS_SUFFIX":
      text = `source field "${source}" ends with the alias "${alias}" of target field "${target}"`;
      break;
    case "ALIAS_TOKENS":
      text = `source field "${source}" contains all tokens of the alias "${alias}" for target field "${target}"`;
      break;
    case "TOKEN_OVERLAP":
      text = `source field "${source}" shares a token with target field "${target}"; review before publishing the mapping`;
      break;
  }
  const typeNote = `sample type: ${candidate.sampleKind}`;
  const specNote = candidate.spec.note ? `; ${candidate.spec.note}` : "";
  return `${text} (${typeNote}${specNote})`;
}

/**
 * 启发式映射建议：只看样例顶层键名与值类型，不执行任何写入。
 * 贪心分配保证一个 sourceField 最多对应一个 targetField（反之亦然），
 * 排序规则固定，输出顺序按目标字段规范顺序。
 */
export function suggestFieldMappings(input: {
  targetType: AgentAssistTargetType;
  sample: Record<string, unknown>;
}): MappingSuggestionResult {
  const specs = TARGET_FIELD_SPECS[input.targetType];
  const sourceFields = Object.keys(input.sample).sort(compareStrings);
  const candidates: MappingCandidate[] = [];

  for (const sourceField of sourceFields) {
    const value = input.sample[sourceField];
    const sampleKind = sampleKindOf(value);
    if (sampleKind === "array") continue;
    const sourceTokens = tokenizeKey(sourceField);
    if (sourceTokens.length === 0) continue;
    const sourceJoined = sourceTokens.join("_");

    specs.forEach((spec, specIndex) => {
      if (!isCompatible(spec.kind, value, sampleKind)) return;
      const match = matchTier(sourceTokens, sourceJoined, spec);
      if (!match) return;
      const scoreBps = Math.min(
        10000,
        TIER_SCORE_BPS[match.tier] + typeBonusBps(spec.kind, value, sampleKind),
      );
      if (scoreBps < MIN_CONFIDENCE_BPS) return;
      candidates.push({
        sourceField,
        specIndex,
        spec,
        scoreBps,
        tier: match.tier,
        matchedAlias: match.alias,
        sampleKind,
      });
    });
  }

  candidates.sort(
    (left, right) =>
      right.scoreBps - left.scoreBps ||
      Number(right.spec.required) - Number(left.spec.required) ||
      left.specIndex - right.specIndex ||
      compareStrings(left.sourceField, right.sourceField),
  );

  const assignedTargets = new Set<number>();
  const assignedSources = new Set<string>();
  const picks: MappingCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.scoreBps < 7000) continue;
    if (assignedTargets.has(candidate.specIndex)) continue;
    if (assignedSources.has(candidate.sourceField)) continue;
    assignedTargets.add(candidate.specIndex);
    assignedSources.add(candidate.sourceField);
    picks.push(candidate);
  }
  picks.sort((left, right) => left.specIndex - right.specIndex);

  return {
    targetType: input.targetType,
    suggestions: picks.map((candidate) => ({
      sourceField: candidate.sourceField,
      targetField: candidate.spec.field,
      confidence: candidate.scoreBps / 10000,
      reason: reasonFor(candidate),
      required: candidate.spec.required,
    })),
    unmatchedSourceFields: sourceFields.filter(
      (field) => !assignedSources.has(field),
    ),
    missingRequiredFields: specs
      .filter((spec, specIndex) => spec.required && !assignedTargets.has(specIndex))
      .map((spec) => spec.field),
  };
}

// ----------------------------------------------------------------------
// 同步异常诊断
// ----------------------------------------------------------------------

export type SyncAnomalyCode =
  | "HIGH_QUARANTINE_RATE"
  | "HIGH_DUPLICATE_RATE"
  | "CONSECUTIVE_FAILURES"
  | "FETCHED_SURGE"
  | "FETCHED_DROP"
  | "COUNT_IMBALANCE";

export type SyncAnomalySeverity = "HIGH" | "MEDIUM" | "LOW";

export interface SyncRunSummary {
  readonly status: string;
  readonly fetched: number;
  readonly created: number;
  readonly updated: number;
  readonly duplicate: number;
  readonly quarantined: number;
  readonly failed: number;
}

export interface SyncAnomalyEvidence {
  readonly [key: string]: number | string;
}

export interface SyncAnomaly {
  readonly code: SyncAnomalyCode;
  readonly severity: SyncAnomalySeverity;
  readonly runIndex: number;
  readonly explanation: string;
  readonly evidence: SyncAnomalyEvidence;
}

export interface SyncAnomalyResult {
  readonly runsAnalyzed: number;
  readonly anomalies: SyncAnomaly[];
}

/** 隔离率阈值：严格大于 5%（basis points）。 */
export const QUARANTINE_RATE_THRESHOLD_BPS = 500;
/** 重复率阈值：严格大于 50%。 */
export const DUPLICATE_RATE_THRESHOLD_BPS = 5000;
/** 连续失败阈值：>= 3 次。 */
export const CONSECUTIVE_FAILURE_THRESHOLD = 3;
/** 抓取量突增：>= 尾随均值的 2 倍。 */
export const FETCHED_SURGE_MULTIPLIER_BPS = 20000;
/** 抓取量骤降：<= 尾随均值的 0.5 倍。 */
export const FETCHED_DROP_MULTIPLIER_BPS = 5000;
/** 尾随窗口：最多 5 次成功运行。 */
export const FETCHED_BASELINE_WINDOW = 5;
/** 至少 3 次成功运行才判断突增/骤降。 */
export const FETCHED_BASELINE_MIN_RUNS = 3;
/** 尾随均值低于 10 条时忽略突增/骤降（样本太小）。 */
export const FETCHED_BASELINE_MIN_AVERAGE = 10;

const BPS_DENOMINATOR = 10_000n;

function isFailureStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return normalized === "FAILED" || normalized === "ERROR";
}

/** 比例转 basis points（向下取整；分母为 0 时返回 0）。 */
function rateBps(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Number((BigInt(part) * BPS_DENOMINATOR) / BigInt(whole));
}

function formatBps(bps: number): string {
  const sign = bps < 0 ? "-" : "";
  return `${sign}${(Math.abs(bps) / 100).toFixed(2)}%`;
}

function signedChangeBps(value: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return Number(
    ((BigInt(value) - BigInt(baseline)) * BPS_DENOMINATOR) / BigInt(baseline),
  );
}

/**
 * 同步运行异常诊断。规则固定、阈值显式，计数比较全部用整数/定点，
 * 相同输入必然得到相同输出（含异常顺序）。
 */
export function detectSyncAnomalies(input: {
  runs: readonly SyncRunSummary[];
}): SyncAnomalyResult {
  const anomalies: SyncAnomaly[] = [];
  const recentSuccessfulFetched: number[] = [];
  let failureStreak = 0;
  let failureStreakStart = -1;

  input.runs.forEach((run, runIndex) => {
    const failed = isFailureStatus(run.status);

    // 1) 隔离率 > 5%
    if (run.fetched > 0) {
      const exceeded =
        BigInt(run.quarantined) * BPS_DENOMINATOR >
        BigInt(run.fetched) * BigInt(QUARANTINE_RATE_THRESHOLD_BPS);
      if (exceeded) {
        const bps = rateBps(run.quarantined, run.fetched);
        anomalies.push({
          code: "HIGH_QUARANTINE_RATE",
          severity: "HIGH",
          runIndex,
          explanation:
            `quarantine rate ${formatBps(bps)} exceeds the 5.00% threshold ` +
            `(${run.quarantined}/${run.fetched} records)`,
          evidence: {
            fetched: run.fetched,
            quarantined: run.quarantined,
            rateBps: bps,
            thresholdBps: QUARANTINE_RATE_THRESHOLD_BPS,
          },
        });
      }
    }

    // 2) 重复率 > 50%
    if (run.fetched > 0) {
      const exceeded =
        BigInt(run.duplicate) * BPS_DENOMINATOR >
        BigInt(run.fetched) * BigInt(DUPLICATE_RATE_THRESHOLD_BPS);
      if (exceeded) {
        const bps = rateBps(run.duplicate, run.fetched);
        anomalies.push({
          code: "HIGH_DUPLICATE_RATE",
          severity: "MEDIUM",
          runIndex,
          explanation:
            `duplicate rate ${formatBps(bps)} exceeds the 50.00% threshold ` +
            `(${run.duplicate}/${run.fetched} records)`,
          evidence: {
            fetched: run.fetched,
            duplicate: run.duplicate,
            rateBps: bps,
            thresholdBps: DUPLICATE_RATE_THRESHOLD_BPS,
          },
        });
      }
    }

    // 3) 抓取量突增/骤降：与最近成功运行（最多 5 次）的均值比较。
    if (!failed && recentSuccessfulFetched.length >= FETCHED_BASELINE_MIN_RUNS) {
      const window = recentSuccessfulFetched.slice(-FETCHED_BASELINE_WINDOW);
      const sum = window.reduce((total, value) => total + value, 0);
      const baseline = Math.floor(sum / window.length);
      if (baseline >= FETCHED_BASELINE_MIN_AVERAGE) {
        const surge =
          BigInt(run.fetched) * BPS_DENOMINATOR >=
          BigInt(baseline) * BigInt(FETCHED_SURGE_MULTIPLIER_BPS);
        const drop =
          BigInt(run.fetched) * BPS_DENOMINATOR <=
          BigInt(baseline) * BigInt(FETCHED_DROP_MULTIPLIER_BPS);
        if (surge) {
          anomalies.push({
            code: "FETCHED_SURGE",
            severity: "MEDIUM",
            runIndex,
            explanation:
              `fetched volume ${run.fetched} is at least 2x the trailing ` +
              `average ${baseline} of the last ${window.length} successful runs`,
            evidence: {
              fetched: run.fetched,
              baselineFetched: baseline,
              baselineRuns: window.length,
              changeBps: signedChangeBps(run.fetched, baseline),
            },
          });
        } else if (drop) {
          anomalies.push({
            code: "FETCHED_DROP",
            severity: "MEDIUM",
            runIndex,
            explanation:
              `fetched volume ${run.fetched} is at most half the trailing ` +
              `average ${baseline} of the last ${window.length} successful runs`,
            evidence: {
              fetched: run.fetched,
              baselineFetched: baseline,
              baselineRuns: window.length,
              changeBps: signedChangeBps(run.fetched, baseline),
            },
          });
        }
      }
    }
    if (!failed) {
      recentSuccessfulFetched.push(run.fetched);
    }

    // 4) 计数不平：fetched 必须等于各结果计数之和（NP-016 / INT-211）。
    const counted =
      run.created +
      run.updated +
      run.duplicate +
      run.quarantined +
      run.failed;
    if (counted !== run.fetched) {
      const mismatch = run.fetched - counted;
      anomalies.push({
        code: "COUNT_IMBALANCE",
        severity: "HIGH",
        runIndex,
        explanation:
          `fetched ${run.fetched} does not equal ` +
          `created+updated+duplicate+quarantined+failed (${counted}); ` +
          `mismatch ${mismatch}`,
        evidence: {
          fetched: run.fetched,
          countedTotal: counted,
          mismatch,
          mismatchBps:
            run.fetched > 0
              ? rateBps(Math.abs(mismatch), run.fetched)
              : 0,
        },
      });
    }

    // 5) 连续失败 >= 3：每段连续失败只报一次（在达到阈值的运行处）。
    if (failed) {
      if (failureStreak === 0) failureStreakStart = runIndex;
      failureStreak += 1;
      if (failureStreak === CONSECUTIVE_FAILURE_THRESHOLD) {
        anomalies.push({
          code: "CONSECUTIVE_FAILURES",
          severity: "HIGH",
          runIndex,
          explanation:
            `${failureStreak} consecutive failed runs starting at run ` +
            `${failureStreakStart}`,
          evidence: {
            consecutiveFailures: failureStreak,
            startRunIndex: failureStreakStart,
            endRunIndex: runIndex,
            threshold: CONSECUTIVE_FAILURE_THRESHOLD,
          },
        });
      }
    } else {
      failureStreak = 0;
      failureStreakStart = -1;
    }
  });

  return { runsAnalyzed: input.runs.length, anomalies };
}

// ----------------------------------------------------------------------
// 对账差异解释
// ----------------------------------------------------------------------

export type ReconciliationClassification =
  | "ROUNDING"
  | "FX"
  | "TIMING"
  | "MISSING_SOURCE"
  | "MISSING_TARGET"
  | "AMOUNT_MISMATCH";

export interface ReconciliationRow {
  readonly key: string;
  readonly source?: string | null;
  readonly target?: string | null;
  readonly delta: string;
}

export interface ReconciliationEvidence {
  readonly source: string | null;
  readonly target: string | null;
  readonly absoluteDelta: string;
  readonly relativeDeltaBps: number | null;
}

export interface ReconciliationExplanation {
  readonly key: string;
  readonly classification: ReconciliationClassification;
  readonly delta: string;
  readonly explanation: string;
  readonly nextStep: string;
  readonly evidence: ReconciliationEvidence;
}

export interface ReconciliationExplainResult {
  readonly rowsAnalyzed: number;
  readonly reported: number;
  readonly ignoredZeroDelta: number;
  readonly explanations: ReconciliationExplanation[];
}

/** 舍入容差：|delta| <= 0.01 视为舍入差异（显式绝对容差）。 */
export const RECONCILIATION_ROUNDING_TOLERANCE = "0.01";

const ROUNDING_TOLERANCE_SCALED = parseDecimal(
  RECONCILIATION_ROUNDING_TOLERANCE,
);

/** 键名含 FX/币种换算语义 → 优先按汇率差解释。 */
const FX_KEY_TOKENS = new Set([
  "fx",
  "forex",
  "exchange",
  "conversion",
  "revaluation",
  "reval",
  "translate",
  "translation",
  "currency",
]);

/** 键名含期间/截止语义 → 按时间性差异解释。 */
const TIMING_KEY_TOKENS = new Set([
  "timing",
  "period",
  "periodend",
  "cutoff",
  "cut",
  "accrual",
  "deferred",
  "late",
  "lag",
  "settlement",
  "posting",
  "booking",
  "month",
  "quarter",
  "fiscal",
  "crossover",
]);

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function maximum(left: bigint, right: bigint): bigint {
  return left >= right ? left : right;
}

function classificationFor(
  key: string,
  source: bigint | null,
  target: bigint | null,
  delta: bigint,
): ReconciliationClassification {
  if (source === null) return "MISSING_SOURCE";
  if (target === null) return "MISSING_TARGET";
  const absDelta = absolute(delta);
  if (absDelta <= ROUNDING_TOLERANCE_SCALED) return "ROUNDING";
  const tokens = new Set(tokenizeKey(key));
  for (const token of FX_KEY_TOKENS) {
    if (tokens.has(token)) return "FX";
  }
  for (const token of TIMING_KEY_TOKENS) {
    if (tokens.has(token)) return "TIMING";
  }
  return "AMOUNT_MISMATCH";
}

function explanationFor(
  classification: ReconciliationClassification,
  source: bigint | null,
  target: bigint | null,
  absDelta: bigint,
): string {
  const deltaText = formatDecimal(absDelta);
  switch (classification) {
    case "MISSING_SOURCE":
      return `source side is absent while the target reports ${target === null ? "(missing)" : formatDecimal(target)}`;
    case "MISSING_TARGET":
      return `target side is absent while the source reports ${source === null ? "(missing)" : formatDecimal(source)}`;
    case "ROUNDING":
      return `difference ${deltaText} is within the ${RECONCILIATION_ROUNDING_TOLERANCE} rounding tolerance`;
    case "FX":
      return `both sides are present; difference ${deltaText} exceeds the ${RECONCILIATION_ROUNDING_TOLERANCE} tolerance and the key indicates FX/currency conversion`;
    case "TIMING":
      return `both sides are present; difference ${deltaText} exceeds the ${RECONCILIATION_ROUNDING_TOLERANCE} tolerance and the key indicates a cut-off/period timing difference`;
    case "AMOUNT_MISMATCH":
      return `both sides are present; difference ${deltaText} exceeds the ${RECONCILIATION_ROUNDING_TOLERANCE} tolerance and the key carries no FX or timing indicator`;
  }
}

function nextStepFor(
  classification: ReconciliationClassification,
  key: string,
): string {
  switch (classification) {
    case "ROUNDING":
      return "No adjustment is needed if settlement rounds to 2 decimals; re-check the rounding mode (HALF_UP) on both sides before escalating.";
    case "FX":
      return "Revalue the line with the booked FX snapshot (rate + as-of); if the rate source was refreshed after recognition, re-run the revaluation and keep both snapshots as evidence.";
    case "TIMING":
      return "Re-extract both sides for the same accounting period/timezone, then re-run reconciliation before booking any adjustment.";
    case "MISSING_SOURCE":
      return `Locate or re-ingest the source record for "${key}"; if it is intentionally absent, record that decision instead of adjusting the target.`;
    case "MISSING_TARGET":
      return `Replay the target projection for "${key}" from the mapped source and verify the write result; do not post a manual adjustment yet.`;
    case "AMOUNT_MISMATCH":
      return `Open a reconciliation case for "${key}", compare the underlying documents, and correct via an adjustment entry that references both records (no in-place overwrite).`;
  }
}

/**
 * 对账差异解释：delta 为 0 的行直接跳过；其余按 MISSING_SOURCE /
 * MISSING_TARGET / ROUNDING / FX / TIMING / AMOUNT_MISMATCH 分类。
 * 金额用定点 bigint 计算，相对差异按 basis points 输出。
 */
export function explainReconciliation(input: {
  rows: readonly ReconciliationRow[];
}): ReconciliationExplainResult {
  const explanations: ReconciliationExplanation[] = [];
  let ignoredZeroDelta = 0;

  for (const row of input.rows) {
    const delta = parseDecimal(row.delta);
    if (delta === 0n) {
      ignoredZeroDelta += 1;
      continue;
    }
    const source = row.source == null ? null : parseDecimal(row.source);
    const target = row.target == null ? null : parseDecimal(row.target);
    const classification = classificationFor(row.key, source, target, delta);
    const absDelta = absolute(delta);

    let relativeDeltaBps: number | null = null;
    if (source !== null && target !== null) {
      const scale = maximum(absolute(source), absolute(target));
      if (scale > 0n) {
        relativeDeltaBps = Number(
          divRound(absDelta * BPS_DENOMINATOR, scale, "HALF_UP"),
        );
      }
    }

    explanations.push({
      key: row.key,
      classification,
      delta: formatDecimal(delta),
      explanation: explanationFor(classification, source, target, absDelta),
      nextStep: nextStepFor(classification, row.key),
      evidence: {
        source: source === null ? null : formatDecimal(source),
        target: target === null ? null : formatDecimal(target),
        absoluteDelta: formatDecimal(absDelta),
        relativeDeltaBps,
      },
    });
  }

  return {
    rowsAnalyzed: input.rows.length,
    reported: explanations.length,
    ignoredZeroDelta,
    explanations,
  };
}
