/**
 * ANARI-ERP（本地 Anari-ERP）→ N-Perform 财务事实 provider。
 *
 * 事实来源（2026-11-25 逐文件核对 Anari-ERP 源码，不是按 REST 惯例猜的）：
 * - `routers/finance.py:639` GET /api/finance/ap-payment-plan
 *     → `domains/finance/payment_advisor.py:suggest_payments`
 *     → `{ suggestions: [...], batches, excluded, ... }`
 *     参数：as_of（可选）、cash_available（可选）。**没有 page/limit**。
 * - `routers/finance.py:656` GET /api/finance/ar-collection-plan
 *     → `domains/finance/ar_advisor.py:suggest_collections`
 *     → `{ suggestions: [...], excluded, aging, ... }`
 *     参数：as_of（可选）、limit（1..200，默认 50）。没有 offset/page。
 * - `routers/finance.py:698` GET /api/finance/margin-portfolio
 *     → `domains/order/order_margin.py:margin_portfolio`
 *     → `{ rows: [...], summary: {...} }`
 *     参数：status（可选）、limit（1..500，默认 200）。没有 offset/page。
 *
 * 三个端点的共同点：都是**只读建议/分析快照**，不是可翻页的台账列表。AR/毛利只有
 * `limit` 上限、没有 offset；AP 连 limit 都没有。所以这里不声明 pageParam——单次
 * 请求就是完整的一页；重复拉取靠 sourceRecordId 幂等（DB 唯一键
 * tenant/source_system/source_record_id/fact_type，见 002_governance_schema.sql）。
 *
 * 金额：ERP 的 `money_f()` 在 JSON 边界把 Decimal 转成 **number**（Python float），
 * 而 `POST /api/v1/financial-facts` 的 `amount` 是 decimal **字符串**
 * （packages/contracts createFinancialFactSchema → primitives.decimal）。normalize
 * 因此把 number 无损展开成十进制字符串（不做四舍五入），也直通字符串输入；绝不
 * 用 Number() 往返，避免 binary float 把 0.1+0.2 那类误差写进金额事实。
 *
 * 鉴权：ERP 的 /api/* 路由走 `require_auth()` + `require_role("finance")`
 * （auth.py:74/175），读 `request.session["user"]`，没有 API key / Bearer 分支。
 * 所以 ANARI_ERP_TOKEN 必须是 runner 能注入的已登录会话凭据（finance 或 admin
 * 角色），并且会过期；provider 本身不发请求，不在这里实现认证。
 */

import type { CanonicalWrite, LocalProvider, PullTarget } from "./types.js";

/** N-Perform 里这批财务事实的来源标识。 */
export const ERP_SOURCE_SYSTEM = "ANARI_ERP";

/** `POST /api/v1/financial-facts`（apps/api/src/modules/budget/budget.routes.ts:207）。 */
export const FINANCIAL_FACTS_PATH = "/api/v1/financial-facts";

export const AP_PAYMENT_PLAN_PATH = "/api/finance/ap-payment-plan";
export const AR_COLLECTION_PLAN_PATH = "/api/finance/ar-collection-plan";
export const MARGIN_PORTFOLIO_PATH = "/api/finance/margin-portfolio";

/**
 * factType 取值。`/api/v1/financial-facts` 的 factType 是自由字符串
 * （createFinancialFactSchema：z.string().min(1)），DB 也没有 CHECK 约束；
 * 用独立取值区分应付/应收/毛利，便于按类型查询与对账。
 */
export const ERP_FACT_TYPES = {
  AP_PAYMENT: "AP_PAYMENT",
  AR_COLLECTION: "AR_COLLECTION",
  MARGIN: "MARGIN",
} as const;
export type ErpFactType = (typeof ERP_FACT_TYPES)[keyof typeof ERP_FACT_TYPES];

/** AR / 毛利端点的 `limit` 上限（FastAPI Query(le=200 / le=500)）。 */
const AR_COLLECTION_MAX_LIMIT = 200;
const MARGIN_PORTFOLIO_MAX_LIMIT = 500;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;
const INTEGER_ID_PATTERN = /^[1-9]\d*$/;
const ACCOUNTING_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `financialInstrumentTypeSchema`（packages/contracts）。 */
const FINANCIAL_INSTRUMENT_TYPES = new Set([
  "INVOICE",
  "CREDIT_NOTE",
  "PAYMENT",
  "COST",
  "REFUND",
]);

/** createFinancialFactSchema.sourceVersion 上限。 */
const SOURCE_VERSION_MAX_LENGTH = 256;

type JsonRecord = Record<string, unknown>;

/**
 * qualityStatus：来源可信度。ERP 是应付/应收/订单的系统记录，金额与币种由台账
 * 直接给出 → `VALID`；毛利组合里由估算采购价或缺失成本维度算出的行是派生值
 * → `UNVERIFIED`。币种不一致时代码路径上 gross_margin 会是 null（被下面挡掉），
 * 但契约再变时仍标 `CONFLICTED`，不要把冲突当有效。
 */
type QualityStatus =
  | "VALID"
  | "MISSING"
  | "STALE"
  | "CONFLICTED"
  | "UNVERIFIED"
  | "INVALID";

// ---------------------------------------------------------------------------
// 公开 target
// ---------------------------------------------------------------------------

/**
 * GET /api/finance/ap-payment-plan —— AI 付款建议（只读）。
 *
 * 端点没有 page/limit：一次返回全部待付款建议（`suggestions`）。`included=false`
 * 表示本轮现金预算不足、建议延后的付款，它仍然是一笔真实应付，照常入账为
 * DRAFT 事实（`included` 等决策字段保留在 payload 里）。
 */
export const erpApPaymentTarget: PullTarget = {
  method: "GET",
  path: AP_PAYMENT_PLAN_PATH,
  extract: (json) =>
    recordsFrom(json, "suggestions", AP_PAYMENT_PLAN_PATH),
  normalize: normalizeErpApPayment,
};

/**
 * GET /api/finance/ar-collection-plan —— AI 收款建议（只读）。
 *
 * `limit` 是返回条数上限（1..200，默认 50），不是 offset 分页；单次请求即
 * 契约允许的最大一页，重复拉取按 receivable_id 幂等。
 */
export const erpArCollectionTarget: PullTarget = {
  method: "GET",
  path: AR_COLLECTION_PLAN_PATH,
  limitParam: "limit",
  pageSize: AR_COLLECTION_MAX_LIMIT,
  extract: (json) =>
    recordsFrom(json, "suggestions", AR_COLLECTION_PLAN_PATH),
  normalize: normalizeErpArCollection,
};

/**
 * GET /api/finance/margin-portfolio —— 订单毛利组合（只读）。
 *
 * `limit` 是订单条数上限（1..500，默认 200），不是 offset 分页。`gross_margin`
 * 为 null 的行（成本维度缺失或币种不一致）在 normalize 里 fail-closed 跳过，
 * 绝不按 0 冒充毛利。
 */
export const erpMarginPortfolioTarget: PullTarget = {
  method: "GET",
  path: MARGIN_PORTFOLIO_PATH,
  limitParam: "limit",
  pageSize: MARGIN_PORTFOLIO_MAX_LIMIT,
  extract: (json) => recordsFrom(json, "rows", MARGIN_PORTFOLIO_PATH),
  normalize: normalizeErpMarginRow,
};

/** ERP 不返回会计身份；联调时用配置补齐，默认 DRAFT 需要时改为 POSTED。 */
const ERP_POSTED_ENABLED = process.env.ANARI_ERP_POSTED === "1";
const DEFAULT_ERP_LEGAL_ENTITY =
  process.env.ANARI_ERP_LEGAL_ENTITY?.trim() || "ANARI";

function erpPeriod(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && /^\d{4}-\d{2}/.test(value)) {
      return value.slice(0, 7);
    }
  }
  return undefined;
}

export const erpProvider: LocalProvider = {
  code: "anari-erp",
  sourceSystem: ERP_SOURCE_SYSTEM,
  baseUrlEnv: "ANARI_ERP_BASE_URL",
  tokenEnv: "ANARI_ERP_TOKEN",
  targets: [
    erpApPaymentTarget,
    erpArCollectionTarget,
    erpMarginPortfolioTarget,
  ],
};

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

/**
 * 应付付款建议 → AP_PAYMENT 财务事实。
 *
 * sourceRecordId 只用 `payment_id`（应付台账主键），**不加 due_date**：到期日
 * 是可编辑业务属性，改期会生成一条新的 sourceRecordId，在按
 * (source_system, source_record_id, fact_type) upsert 的目标表里变成两笔应付。
 * 到期日保留在 payload 里，供对账/审计读取。
 *
 * 金额取 `amount`（原币应付金额），不是 `suggested_amount`（折合 CNY 的部分
 * 付款建议额）——后者的币种是 CNY，与记录的 `currency` 不是同一口径。
 */
export function normalizeErpApPayment(record: unknown): CanonicalWrite[] {
  if (!isRecord(record)) return [];

  const paymentId = recordId(record.payment_id);
  const amount = decimalString(record.amount);
  const currency = currencyCode(record.currency);
  if (!paymentId || amount === undefined || currency === undefined) return [];
  // 应付金额必须为正：0/负数要么是脏数据要么是红冲中间态，不能凭空建事实。
  if (!isPositiveDecimal(amount)) return [];

  return [
    buildFinancialFactWrite({
      factType: ERP_FACT_TYPES.AP_PAYMENT,
      sourceRecordId: `${ERP_FACT_TYPES.AP_PAYMENT}:${paymentId}`,
      amount,
      currency,
      qualityStatus: "VALID",
      record,
      // ERP 当前不返回这些会计身份字段；映射写在这里，上游哪天补了就自动 POSTED。
      legalEntityId:
        optionalText(record.legal_entity_id) ??
        (ERP_POSTED_ENABLED ? DEFAULT_ERP_LEGAL_ENTITY : undefined),
      orderId: orderReference(record),
      contractRef: optionalText(record.contract_ref),
      instrumentType:
        optionalInstrumentType(record.instrument_type) ??
        (ERP_POSTED_ENABLED ? "PAYMENT" : undefined),
      accountingPeriod:
        optionalAccountingPeriod(record.accounting_period) ??
        (ERP_POSTED_ENABLED
          ? erpPeriod(record, "due_date", "expected_pay_date", "apply_date")
          : undefined),
      sourceVersion:
        optionalSourceVersion(record.source_version) ??
        (ERP_POSTED_ENABLED ? paymentId : undefined),
    }),
  ];
}

/**
 * 应收收款建议 → AR_COLLECTION 财务事实。
 *
 * 金额取 `amount`（未收余额，ERP 侧已扣部分收款），不是整单金额；币种是应收
 * 单据原币。sourceRecordId 用 `receivable_id`，同上不用 expected_due 做键。
 *
 * `order_number` 映射到 orderId（与 N-Perform 财务子账测试里的 "SO-REC-1" 同一
 * 业务引用口径），让 AR 事实能追溯到销售订单；它不是 UUID 也没关系，目标表
 * order_id 是 text。
 */
export function normalizeErpArCollection(record: unknown): CanonicalWrite[] {
  if (!isRecord(record)) return [];

  const receivableId = recordId(record.receivable_id);
  const amount = decimalString(record.amount);
  const currency = currencyCode(record.currency);
  if (!receivableId || amount === undefined || currency === undefined) return [];
  if (!isPositiveDecimal(amount)) return [];

  return [
    buildFinancialFactWrite({
      factType: ERP_FACT_TYPES.AR_COLLECTION,
      sourceRecordId: `${ERP_FACT_TYPES.AR_COLLECTION}:${receivableId}`,
      amount,
      currency,
      qualityStatus: "VALID",
      record,
      legalEntityId:
        optionalText(record.legal_entity_id) ??
        (ERP_POSTED_ENABLED ? DEFAULT_ERP_LEGAL_ENTITY : undefined),
      orderId: orderReference(record),
      contractRef: optionalText(record.contract_ref),
      instrumentType:
        optionalInstrumentType(record.instrument_type) ??
        (ERP_POSTED_ENABLED ? "INVOICE" : undefined),
      accountingPeriod:
        optionalAccountingPeriod(record.accounting_period) ??
        (ERP_POSTED_ENABLED
          ? erpPeriod(record, "expected_due", "due_date")
          : undefined),
      sourceVersion:
        optionalSourceVersion(record.source_version) ??
        (ERP_POSTED_ENABLED ? receivableId : undefined),
    }),
  ];
}

/**
 * 订单毛利行 → MARGIN 财务事实。
 *
 * 金额取 `gross_margin`（订单币种）。`cost_total`/`gross_margin` 为 null 表示
 * 该订单成本维度缺失（order_margin 的口径：unknown 不按 0），此时没有可信金额，
 * 直接跳过而不是写 0。
 *
 * sourceRecordId 用 `so_id + order_number`：两者都来自销售订单主数据
 * （order_number NOT NULL，PsiSalesOrder），跨拉取稳定；毛利没有“发生日期”
 * 字段，不臆造日期。
 */
export function normalizeErpMarginRow(record: unknown): CanonicalWrite[] {
  if (!isRecord(record)) return [];

  const soId = recordId(record.so_id);
  const orderNumber = optionalText(record.order_number);
  const amount = decimalString(record.gross_margin);
  const currency = currencyCode(record.currency);
  if (!soId || !orderNumber || amount === undefined || currency === undefined) {
    return [];
  }

  return [
    buildFinancialFactWrite({
      factType: ERP_FACT_TYPES.MARGIN,
      sourceRecordId: `${ERP_FACT_TYPES.MARGIN}:${soId}:${orderNumber}`,
      amount,
      currency,
      qualityStatus: marginQualityStatus(record),
      record,
      legalEntityId: optionalText(record.legal_entity_id),
      orderId: orderReference(record),
      contractRef: optionalText(record.contract_ref),
      instrumentType: optionalInstrumentType(record.instrument_type),
      accountingPeriod: optionalAccountingPeriod(record.accounting_period),
      sourceVersion: optionalSourceVersion(record.source_version),
    }),
  ];
}

// ---------------------------------------------------------------------------
// 目标载荷
// ---------------------------------------------------------------------------

interface FinancialFactWriteInput {
  factType: ErpFactType;
  sourceRecordId: string;
  /** 已校验的十进制字符串（原币）。 */
  amount: string;
  currency: string;
  qualityStatus: QualityStatus;
  /** 原始 ERP 记录，原样保留到 payload。 */
  record: JsonRecord;
  legalEntityId?: string;
  orderId?: string;
  contractRef?: string;
  instrumentType?: string;
  accountingPeriod?: string;
  sourceVersion?: string;
}

/**
 * 生成 `/api/v1/financial-facts` 的 body。
 *
 * recognitionStatus：这些建议/分析端点不返回会计身份（legalEntityId /
 * accountingPeriod / instrumentType / sourceVersion），所以默认 DRAFT；只有五个
 * 前置条件 + order/contract 追溯关系全部具备时才 POSTED（契约 superRefine 的
 * 硬要求，写少了目标 API 会 400）。DRAFT 也不丢弃已提供的合法字段，便于后续
 * 人工确认时补全。
 */
function buildFinancialFactWrite(
  input: FinancialFactWriteInput,
): CanonicalWrite {
  const recognitionStatus: "DRAFT" | "POSTED" =
    input.legalEntityId !== undefined &&
    input.accountingPeriod !== undefined &&
    input.instrumentType !== undefined &&
    input.sourceVersion !== undefined &&
    (input.orderId !== undefined || input.contractRef !== undefined)
      ? "POSTED"
      : "DRAFT";

  const body: Record<string, unknown> = {
    sourceSystem: ERP_SOURCE_SYSTEM,
    sourceRecordId: input.sourceRecordId,
    factType: input.factType,
    amount: input.amount,
    currency: input.currency,
    qualityStatus: input.qualityStatus,
    recognitionStatus,
    payload: input.record,
  };

  // 可选字段只在值合法时出现；invalid 的 instrumentType 一律不写（目标 schema
  // 是 enum，写了会整条 400，连带丢掉本来可用的金额）。
  if (input.legalEntityId !== undefined) {
    body.legalEntityId = input.legalEntityId;
  }
  if (input.orderId !== undefined) body.orderId = input.orderId;
  if (input.contractRef !== undefined) body.contractRef = input.contractRef;
  if (input.instrumentType !== undefined) {
    body.instrumentType = input.instrumentType;
  }
  if (input.accountingPeriod !== undefined) {
    body.accountingPeriod = input.accountingPeriod;
  }
  if (input.sourceVersion !== undefined) body.sourceVersion = input.sourceVersion;

  return {
    path: FINANCIAL_FACTS_PATH,
    body,
    externalId: input.sourceRecordId,
  };
}

/**
 * 毛利行的可信度：币种冲突 > 估算/缺维度。`currency_mismatch=true` 时 ERP 已把
 * gross_margin 置 null（会被 normalize 挡掉），这里仍保留判断，避免上游口径变化
 * 时把冲突行标成 VALID。
 */
function marginQualityStatus(record: JsonRecord): QualityStatus {
  if (record.currency_mismatch === true) return "CONFLICTED";
  const unknownCount = record.unknown_count;
  if (
    record.estimated === true ||
    (typeof unknownCount === "number" &&
      Number.isFinite(unknownCount) &&
      unknownCount > 0)
  ) {
    return "UNVERIFIED";
  }
  return "VALID";
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 取信封里的列表。形状不对时**抛错**而不是返回 []：ERP 鉴权失败/路由改名返回的
 * 是 `{detail: ...}`，静默当成“这一页没有数据”会让一次全量同步悄悄同步 0 条。
 * 数组存在但元素不是对象时过滤掉（normalize 也会再挡一层）。
 */
function recordsFrom(json: unknown, key: string, path: string): unknown[] {
  if (!isRecord(json) || !Array.isArray(json[key])) {
    throw new Error(
      `${path}: expected a JSON object with a "${key}" array, got ${
        Array.isArray(json) ? "array" : typeof json
      }`,
    );
  }
  return (json[key] as unknown[]).filter(isRecord);
}

/** 非空字符串（trim 后），否则 undefined。 */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  return candidate.length > 0 ? candidate : undefined;
}

/**
 * 财务事实的 orderId 是**业务订单引用**（N-Perform 财务子账测试用 "SO-REC-1"
 * 这类值），不是 ERP 自增主键。优先 order_number；order_id 只在看起来是业务
 * 引用（非纯数字）时采用，避免把 ERP 内部的 `77` 写成订单号。
 */
function orderReference(record: JsonRecord): string | undefined {
  const orderNumber = optionalText(record.order_number);
  if (orderNumber) return orderNumber;
  const orderId = optionalText(record.order_id);
  return orderId && !INTEGER_ID_PATTERN.test(orderId) ? orderId : undefined;
}

/**
 * ERP 主键 → 稳定的十进制 id 字符串。只接受正安全整数或纯数字字符串；
 * 0/负数/小数/空值一律视为缺失（fail-closed），不做 Number 截断。
 */
function recordId(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  }
  if (typeof value === "string") {
    const candidate = value.trim();
    return INTEGER_ID_PATTERN.test(candidate) ? candidate : undefined;
  }
  return undefined;
}

/**
 * 金额 → 十进制字符串。number 走指数展开（Number 的 shortest round-trip 表示
 * 是精确的十进制写法），string 原样校验后直通（保留来源精度/尾随零）。
 */
function decimalString(value: unknown): string | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    const expanded = expandExponential(String(value));
    return DECIMAL_PATTERN.test(expanded) ? expanded : undefined;
  }
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  return DECIMAL_PATTERN.test(candidate) ? candidate : undefined;
}

/** 把 `1.5e+21` / `1e-7` 展开成 `1500…` / `0.0000001`，不改变数值。 */
function expandExponential(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(value);
  if (!match) return value;
  const sign = match[1] ?? "";
  const whole = match[2] ?? "";
  const fraction = match[3] ?? "";
  const exponent = Number(match[4]);
  if (!Number.isInteger(exponent)) return value;
  const digits = `${whole}${fraction}`;
  const point = whole.length + exponent;
  let expanded: string;
  if (point <= 0) {
    expanded = `0.${"0".repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    expanded = `${digits}${"0".repeat(point - digits.length)}`;
  } else {
    expanded = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return `${sign}${expanded}`;
}

/** 正数（不含符号、至少一个非零数字）。用于应付/应收金额，排除 0 和负数。 */
function isPositiveDecimal(value: string): boolean {
  return !value.startsWith("-") && /[1-9]/.test(value);
}

/** ISO 4217 三位大写；ERP 少量代码路径输出小写，统一 upper。 */
function currencyCode(value: unknown): string | undefined {
  const candidate = optionalText(value)?.toUpperCase();
  return candidate && ISO_CURRENCY_PATTERN.test(candidate)
    ? candidate
    : undefined;
}

function optionalInstrumentType(value: unknown): string | undefined {
  const candidate = optionalText(value)?.toUpperCase();
  return candidate && FINANCIAL_INSTRUMENT_TYPES.has(candidate)
    ? candidate
    : undefined;
}

function optionalAccountingPeriod(value: unknown): string | undefined {
  const candidate = optionalText(value);
  return candidate && ACCOUNTING_PERIOD_PATTERN.test(candidate)
    ? candidate
    : undefined;
}

function optionalSourceVersion(value: unknown): string | undefined {
  const candidate = optionalText(value);
  return candidate && candidate.length <= SOURCE_VERSION_MAX_LENGTH
    ? candidate
    : undefined;
}
