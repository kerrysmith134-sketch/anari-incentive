/**
 * ANARI 报销（anari-baoxiao）开放 API v1 → N-Perform 财务事实 provider。
 *
 * 事实源（只读；租户由 API Key 本身决定，客户端不能指定 tenant）：
 *   GET /api/v1/reports   scope reports:read   报销单（金额字段 totalCNY）
 *   GET /api/v1/payments  scope payments:read  付款台账
 *   GET /api/v1/vouchers  scope vouchers:read  会计凭证
 * 对应 server/routes/openapi.js 的 `/api/v1/*` 只读端点。
 *
 * 鉴权：服务端 `requireApiKey`（server/lib/api-keys.js）先读
 * `Authorization: Bearer <key>`，再读 `X-API-Key`，且值必须以 `anari_` 开头；
 * 缺 Key → 401 API_KEY_MISSING，scope 不符 → 403 API_SCOPE_DENIED，
 * 超出密钥级配额 → 429 + Retry-After。因此这里统一发 Bearer 头，
 * 不用 X-API-Key（裸 key 没有 `anari_` 前缀时会被静默忽略并 401）。
 *
 * 分页：reports/payments 是 offset/limit（`pageMeta` 把 limit 夹到 1..200、
 * offset >= 0，响应带 `meta={limit,offset,count}`）；vouchers 只接受 limit，
 * 没有 offset 参数，单页最多 200 条，超出需要按 period/status 收窄重跑。
 *
 * 归一化目标：`POST /api/v1/financial-facts`（契约见 packages/contracts
 * createFinancialFactSchema）。该接口要求 periodStart/periodEnd 为 YYYY-MM-DD、
 * currency 长度为 3、amount 为十进制字符串；recognitionStatus=POSTED 还必须同时
 * 具备 legalEntityId、accountingPeriod、instrumentType、sourceVersion 与
 * orderId|contractRef。报销开放 API 不返回法人/凭证类型/来源版本/订单号，
 * 所以这里实际产出恒为 DRAFT，等目标系统补全后再过账。
 */
import type { CanonicalWrite, LocalProvider, PullTarget } from "./types.js";

export const FINANCE_SOURCE_SYSTEM = "ANARI_BAOXIAO";
export const FINANCE_BASE_URL_ENV = "ANARI_FINANCE_BASE_URL";
export const FINANCE_API_KEY_ENV = "ANARI_FINANCE_API_KEY";
export const FINANCIAL_FACTS_PATH = "/api/v1/financial-facts";

export type FinanceFactType = "EXPENSE_REPORT" | "PAYMENT" | "VOUCHER";
export type FinanceRecognitionStatus = "DRAFT" | "POSTED";

/** 与 packages/contracts financialInstrumentTypeSchema 保持同集合。 */
const INSTRUMENT_TYPES = [
  "INVOICE",
  "CREDIT_NOTE",
  "PAYMENT",
  "COST",
  "REFUND",
] as const;
export type FinanceInstrumentType = (typeof INSTRUMENT_TYPES)[number];

/**
 * 报销账本以 CNY 为本位币：reports 的权威总额字段就叫 totalCNY，
 * 凭证生成也硬编码 currency='CNY'（server/lib/db-sqlite.js generateVoucherForReport）。
 */
const DEFAULT_CURRENCY = "CNY";

/**
 * 服务端 apiKeyFromRequest 只认 `Bearer anari_...`（或带同样前缀的 X-API-Key）。
 * 前缀不符时服务端会当作“缺少 API Key”，所以这里提前失败而不是发一个必 401 的请求。
 */
export function financeAuthHeaders(apiKey: string): Record<string, string> {
  const key = String(apiKey ?? "").trim();
  if (!key.startsWith("anari_")) {
    throw new Error(
      "finance provider: ANARI_FINANCE_API_KEY must be an anari_ API key",
    );
  }
  return { Authorization: `Bearer ${key}` };
}

/** POSTED 所需的会计语义证据（全部来自来源记录，缺一不可）。 */
export interface FinancePostingEvidence {
  legalEntityId?: string;
  accountingPeriod?: string;
  instrumentType?: FinanceInstrumentType;
  sourceVersion?: string;
  orderId?: string;
  contractRef?: string;
}

/**
 * 只有会计语义齐全的事实才能标 POSTED；否则 DRAFT。
 * 这与 createFinancialFactSchema 的 superRefine 一一对应：把“缺法人/期间却标已过账”
 * 挡在目标系统之前，而不是等 API 400 后丢批。
 */
export function financeRecognitionStatus(
  evidence: FinancePostingEvidence,
): FinanceRecognitionStatus {
  const posted =
    Boolean(evidence.legalEntityId) &&
    Boolean(evidence.accountingPeriod) &&
    Boolean(evidence.instrumentType) &&
    Boolean(evidence.sourceVersion) &&
    Boolean(evidence.orderId || evidence.contractRef);
  return posted ? "POSTED" : "DRAFT";
}

interface FinanceFactInput {
  /** 原始来源记录，按“payload 保留原始”原样投递。 */
  record: Record<string, unknown>;
  sourceRecordId: string;
  factType: FinanceFactType;
  amount: string;
  currency: string;
  periodStart?: string;
  periodEnd?: string;
  accountingPeriod?: string;
  sourceUpdatedAt?: string;
}

function buildFinancialFact(input: FinanceFactInput): CanonicalWrite {
  const evidence: FinancePostingEvidence = {
    legalEntityId: asText(input.record.legalEntityId),
    accountingPeriod: input.accountingPeriod,
    instrumentType: asInstrumentType(input.record.instrumentType),
    sourceVersion: asText(input.record.sourceVersion),
    orderId: asText(input.record.orderId),
    contractRef: asText(input.record.contractRef),
  };
  const recognitionStatus = financeRecognitionStatus(evidence);

  const body: Record<string, unknown> = {
    sourceSystem: FINANCE_SOURCE_SYSTEM,
    sourceRecordId: input.sourceRecordId,
    factType: input.factType,
    amount: input.amount,
    currency: input.currency,
    qualityStatus: "UNVERIFIED",
    recognitionStatus,
    payload: input.record,
  };
  if (input.periodStart) {
    body.periodStart = input.periodStart;
    body.periodEnd = input.periodEnd ?? input.periodStart;
  }
  // 期间即使不足以过账也是有信息量的会计事实（DRAFT 也允许带 accountingPeriod）。
  if (evidence.accountingPeriod) body.accountingPeriod = evidence.accountingPeriod;
  if (input.sourceUpdatedAt) body.sourceUpdatedAt = input.sourceUpdatedAt;
  // 合法会计字段即使 DRAFT 也保留（与 erp provider 同口径，便于人工补全后过账）；
  // 非法 instrumentType 已在 asInstrumentType 里被丢弃，避免 enum 校验整条 400。
  if (evidence.legalEntityId) body.legalEntityId = evidence.legalEntityId;
  if (evidence.instrumentType) body.instrumentType = evidence.instrumentType;
  if (evidence.sourceVersion) body.sourceVersion = evidence.sourceVersion;
  if (evidence.orderId) body.orderId = evidence.orderId;
  if (evidence.contractRef) body.contractRef = evidence.contractRef;

  return {
    path: FINANCIAL_FACTS_PATH,
    body,
    externalId: input.sourceRecordId,
  };
}

/**
 * 报销单。响应字段（server/routes/openapi.js GET /api/v1/reports）：
 * id, userId, status, totalCNY, submittedAt, dept, updatedAt, routeType。
 * totalCNY 是服务端权威的人民币总额，所以币种固定 CNY；列表不下发票据级日期，
 * 用 submittedAt 作为事实锚点（缺失时留空，不伪造）。
 */
function normalizeExpenseReport(record: unknown): CanonicalWrite[] {
  const source = asRecord(record);
  if (!source) return [];
  const sourceRecordId = asText(source.id);
  const amount = toDecimalString(source.totalCNY);
  if (!sourceRecordId || amount === null) return [];
  return [
    buildFinancialFact({
      record: source,
      sourceRecordId,
      factType: "EXPENSE_REPORT",
      amount,
      currency: DEFAULT_CURRENCY,
      periodStart: asIsoDate(source.submittedAt),
      accountingPeriod: asAccountingPeriod(source.accountingPeriod),
      sourceUpdatedAt: asIsoDateTime(source.updatedAt),
    }),
  ];
}

/**
 * 付款单。响应字段（GET /api/v1/payments）：
 * id, refType, refId, amount, direction, status, bankRef。
 * 列表不返回币种与时间字段（付款表没有 currency 列，账本为本位币 CNY），
 * 因此 periodStart/periodEnd 留空 —— 用创建时间顶替会把“计划付款日”写错。
 */
function normalizePayment(record: unknown): CanonicalWrite[] {
  const source = asRecord(record);
  if (!source) return [];
  const sourceRecordId = asText(source.id);
  const amount = toDecimalString(source.amount);
  const currency = toCurrency(source.currency);
  if (!sourceRecordId || amount === null || currency === null) return [];
  return [
    buildFinancialFact({
      record: source,
      sourceRecordId,
      factType: "PAYMENT",
      amount,
      currency,
      accountingPeriod: asAccountingPeriod(source.accountingPeriod),
    }),
  ];
}

/**
 * 会计凭证。响应字段（GET /api/v1/vouchers）为 rowToVoucher 原样输出：
 * id, tenantId, voucherNo, reportId, period(YYYY-MM), amount, currency, status,
 * lines, createdAt, createdBy, postedAt, postedBy。
 * 业务键优先用 voucherNo（`JV-<period>-<reportId>`，ERP 对账用的稳定凭证号）。
 * period 是会计期间，天然的 periodStart/End 是该月首末日（UTC 计算，不引入本地时区）。
 */
function normalizeVoucher(record: unknown): CanonicalWrite[] {
  const source = asRecord(record);
  if (!source) return [];
  const sourceRecordId = asText(source.voucherNo) ?? asText(source.id);
  const amount = toDecimalString(source.amount);
  const currency = toCurrency(source.currency);
  if (!sourceRecordId || amount === null || currency === null) return [];
  const period = asAccountingPeriod(source.period);
  const bounds = period ? monthBounds(period) : undefined;
  return [
    buildFinancialFact({
      record: source,
      sourceRecordId,
      factType: "VOUCHER",
      amount,
      currency,
      periodStart: bounds?.start,
      periodEnd: bounds?.end,
      accountingPeriod: period,
      sourceUpdatedAt: asIsoDateTime(source.updatedAt),
    }),
  ];
}

/**
 * 展开 `{ success, data, meta }` 信封。响应不合法就抛错：静默返回 [] 会让
 * “接口挂了”伪装成“本期 0 条”，是同步链路最难发现的失败模式。
 */
function extractDataArray(json: unknown): unknown[] {
  const envelope = asRecord(json);
  if (!envelope) {
    throw new Error("finance provider: response is not a JSON object");
  }
  if (envelope.success !== true) {
    const detail =
      asText(envelope.error) ?? asText(envelope.code) ?? "unknown_error";
    throw new Error(`finance provider: API returned an error: ${detail}`);
  }
  if (!Array.isArray(envelope.data)) {
    throw new Error("finance provider: response is missing a data array");
  }
  return envelope.data;
}

const financeTargets: PullTarget[] = [
  {
    method: "GET",
    path: "/api/v1/reports", // requireApiKey("reports:read")
    // 服务端是 offset/limit 而非页码，pageParam 直接写 offset。
    pageParam: "offset",
    limitParam: "limit",
    pageSize: 50,
    extract: extractDataArray,
    normalize: normalizeExpenseReport,
  },
  {
    method: "GET",
    path: "/api/v1/payments", // requireApiKey("payments:read")
    pageParam: "offset",
    limitParam: "limit",
    pageSize: 50,
    extract: extractDataArray,
    normalize: normalizePayment,
  },
  {
    method: "GET",
    path: "/api/v1/vouchers", // requireApiKey("vouchers:read")
    // 该端点只读 limit，没有 offset；分页靠 period/status 收窄，单页上限 200。
    limitParam: "limit",
    pageSize: 200,
    extract: extractDataArray,
    normalize: normalizeVoucher,
  },
];

export const financeProvider: LocalProvider = {
  code: "anari-finance",
  sourceSystem: FINANCE_SOURCE_SYSTEM,
  baseUrlEnv: FINANCE_BASE_URL_ENV,
  tokenEnv: FINANCE_API_KEY_ENV,
  targets: financeTargets,
};

// ── 记录字段解析 ───────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

/**
 * 金额 → 十进制字符串。SQLite 返回 number，PG 的 numeric 返回 string，
 * 两种都接受；指数形式（1e+21）和空串等无法通过 decimal 校验的直接跳过。
 */
function toDecimalString(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const text = String(value);
    return /^-?\d+(\.\d+)?$/.test(text) ? text : null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    return /^-?\d+(\.\d+)?$/.test(text) ? text : null;
  }
  return null;
}

/** 缺失币种按本位币 CNY；有值但不是 3 位字母 → null（跳过错值，不静默改写）。 */
function toCurrency(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_CURRENCY;
  }
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function asAccountingPeriod(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const period = value.trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : undefined;
}

/** `2026-10-14` 或 `2026-10-14T02:15:00.000Z` → `2026-10-14`（契约只收日期）。 */
function asIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length > 10 && text[10] !== "T") return undefined;
  const day = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

/** 契约的 z.string().datetime() 默认只收带 Z 的 ISO 时间。 */
function asIsoDateTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(text)
    ? text
    : undefined;
}

function asInstrumentType(value: unknown): FinanceInstrumentType | undefined {
  if (typeof value !== "string") return undefined;
  const found = INSTRUMENT_TYPES.find((type) => type === value);
  return found;
}

/** YYYY-MM → 该月首末日（UTC，无本地时区漂移）。 */
function monthBounds(period: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`finance provider: invalid accounting period ${period}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, "0")}`,
  };
}
