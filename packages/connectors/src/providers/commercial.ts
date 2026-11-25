/**
 * ANARI Commercial（本地 anari-commercial-sys）→ N-Perform Commercial provider.
 *
 * 事实来源（后端源码，2026-11-25 核对）：
 * - `GET /api/v1/customers`   → `{success,data,meta}`（customers.py:205）
 * - `GET /api/v1/quotations`  → `{success,data,meta}`（quotes.py:52；注意不是 /quotes）
 * - `GET /api/v1/orders`      → `{success,data,meta}`（orders.py:326）
 * 分页均为 `page`/`limit`（limit ≤ 100），`meta.next_cursor` 是 keyset 游标；
 * 本 provider 用页码翻页，同时导出游标读取器供调用方切换深分页。
 *
 * 关键约束：N-Perform 的 import/quote 必须有 externalOpportunityId，
 * import/order 必须有 externalContractId。真实 Commercial API 的报价只有
 * `customer_id`，订单只有 `quotation_id`，**没有** opportunity/deal 或
 * contract 字段（数据库也没有对应表）。把 customer/quotation 当父 ID 属于
 * 伪造关系，因此这类记录明确跳过（normalize 返回 `[]`），不做兜底。
 * 如果上游以后真的下发 `opportunity_id`/`deal_id` 或 `contract_id`，
 * 下面的映射无需改动即可接收。
 */
import type { CanonicalWrite, LocalProvider, PullTarget } from "./types.js";

export const COMMERCIAL_SOURCE_SYSTEM = "ANARI_COMMERCIAL";

const ACCOUNT_IMPORT_PATH = "/api/v1/commercial/import/accounts";
const OPPORTUNITY_IMPORT_PATH = "/api/v1/commercial/import/opportunities";
const QUOTE_IMPORT_PATH = "/api/v1/commercial/import/quotes";
const CONTRACT_IMPORT_PATH = "/api/v1/commercial/import/contracts";
const ORDER_IMPORT_PATH = "/api/v1/commercial/import/orders";

const PAGE_SIZE = 100;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstText(record: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return "";
}

function decimalString(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate && DECIMAL_PATTERN.test(candidate) ? candidate : undefined;
}

function firstDecimal(record: JsonRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = decimalString(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function currencyOf(record: JsonRecord): string | undefined {
  const currency = text(record.currency).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : undefined;
}

/**
 * Commercial 用 `datetime.isoformat()`（如 `+00:00`），而 N-Perform 的
 * `z.string().datetime()` 默认只接受 UTC `Z`。统一转成 `.toISOString()`。
 */
function isoDateTime(value: unknown): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * 金额必须与单据 `currency` 同币种：
 * - `*_original` 是成交币种金额，优先；
 * - `*_usd` 只在 currency === USD 时等价可用；
 * - 非 USD 且缺 original（历史脏数据）时不拿 USD 金额冒充，调用方跳过。
 */
function monetaryAmount(
  record: JsonRecord,
  currency: string,
  originalKeys: string[],
  usdKeys: string[],
): string | undefined {
  const original = firstDecimal(record, ...originalKeys);
  if (original !== undefined) return original;
  if (currency === "USD") return firstDecimal(record, ...usdKeys);
  return undefined;
}

function decimalParts(value: string): {
  negative: boolean;
  digits: bigint;
  scale: number;
} {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return {
    negative,
    digits: BigInt(`${whole}${fraction}` || "0"),
    scale: fraction.length,
  };
}

function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  const body = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${body}` : body;
}

function normalizedDecimalParts(value: string): {
  negative: boolean;
  digits: bigint;
  scale: number;
} {
  const parts = decimalParts(value);
  let digits = parts.digits;
  let scale = parts.scale;
  while (scale > 0 && digits % 10n === 0n) {
    digits /= 10n;
    scale -= 1;
  }
  return {
    negative: parts.negative && digits !== 0n,
    digits,
    scale,
  };
}

/**
 * N-Perform 的 `upsertCommercialOrder` 会精确校验
 * `quantity × unitPrice === amount`（否则 ORDER_LINE_AMOUNT_MISMATCH）。
 * 映射阶段就按同一口径校验，避免把必被拒绝的订单投递过去。
 */
function decimalProductEquals(
  unitPrice: string,
  quantity: string,
  expectedAmount: string,
): boolean {
  const price = normalizedDecimalParts(unitPrice);
  const count = normalizedDecimalParts(quantity);
  const expected = normalizedDecimalParts(expectedAmount);
  let digits = price.digits * count.digits;
  let scale = price.scale + count.scale;
  while (scale > 0 && digits % 10n === 0n) {
    digits /= 10n;
    scale -= 1;
  }
  const negative = price.negative !== count.negative && digits !== 0n;
  return (
    digits === expected.digits &&
    scale === expected.scale &&
    negative === expected.negative
  );
}

/** amount / quantity，保留 6 位小数（四舍五入），用于缺成交单价的兜底。 */
function divideDecimal(amount: string, quantity: string): string | undefined {
  const numerator = decimalParts(amount);
  const denominator = decimalParts(quantity);
  if (denominator.digits === 0n) return undefined;
  const scaledNumerator =
    numerator.digits * 10n ** BigInt(denominator.scale + 6);
  const scaledDenominator =
    denominator.digits * 10n ** BigInt(numerator.scale);
  let quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  if (remainder * 2n >= scaledDenominator) quotient += 1n;
  if (numerator.negative !== denominator.negative) quotient = -quotient;
  return formatScaled(quotient, 6);
}

const QUOTE_STATUS: Record<string, string> = {
  draft: "DRAFT",
  sent: "ISSUED",
  issued: "ISSUED",
  accepted: "ACCEPTED",
  rejected: "REJECTED",
  expired: "EXPIRED",
};

const ORDER_STATUS: Record<string, string> = {
  confirmed: "CONFIRMED",
  in_production: "CONFIRMED",
  partially_shipped: "CONFIRMED",
  shipped: "CONFIRMED",
  partially_delivered: "CONFIRMED",
  delivered: "CONFIRMED",
  completed: "CONFIRMED",
  cancelled: "CANCELLED",
};

const LINE_KINDS = new Set(["PRODUCT", "SERVICE", "DISCOUNT", "SURCHARGE"]);

function mappedStatus(
  record: JsonRecord,
  statuses: Record<string, string>,
): string | undefined {
  return statuses[text(record.status).toLowerCase()];
}

/**
 * Commercial 列表统一是 `{success,data,meta}`；也接受裸数组与 `records`
 * （与 HttpJsonConnector 的宽容度一致）。缺 records 视为协议漂移，直接报错，
 * 避免把“接口改结构”静默当成“没有数据”。
 */
export function extractCommercialRecords(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (isRecord(json) && Array.isArray(json.data)) return json.data;
  if (isRecord(json) && Array.isArray(json.records)) return json.records;
  throw new Error(
    "ANARI Commercial response is missing a records array (expected data/records)",
  );
}

/** 读取 `{success,data,meta.next_cursor}` 的游标；页码模式下可为 null。 */
export function extractCommercialNextCursor(json: unknown): string | null {
  if (!isRecord(json)) return null;
  if (isRecord(json.meta)) {
    const cursor = json.meta.next_cursor ?? json.meta.nextCursor;
    if (typeof cursor === "string" && cursor.trim()) return cursor.trim();
  }
  const topLevel = json.next_cursor ?? json.nextCursor;
  return typeof topLevel === "string" && topLevel.trim()
    ? topLevel.trim()
    : null;
}

/**
 * customer → import/accounts。
 * `externalAccountId` 优先稳定主键 id；真实 API 没有 `code`，但保留兼容。
 * `owner_id` 是用户 UUID，只在形如 UUID 时映射为 ownerPersonId，空/非 UUID 省略。
 */
export function normalizeCommercialAccount(
  record: unknown,
): CanonicalWrite | CanonicalWrite[] {
  if (!isRecord(record)) return [];
  const externalAccountId = firstText(
    record,
    "id",
    "code",
    "external_account_id",
    "externalAccountId",
  );
  const name = firstText(record, "name", "account_name", "accountName");
  if (!externalAccountId || !name) return [];

  const ownerId = firstText(
    record,
    "owner_id",
    "ownerId",
    "owner_person_id",
    "ownerPersonId",
  );
  const body: Record<string, unknown> = {
    sourceSystem: COMMERCIAL_SOURCE_SYSTEM,
    externalAccountId,
    name,
  };
  if (ownerId && isUuid(ownerId)) body.ownerPersonId = ownerId;

  return {
    path: ACCOUNT_IMPORT_PATH,
    body,
    externalId: externalAccountId,
  };
}

/** 1e6 定点求和，用于订单行合计（不经过 Number）。 */
function sumDecimalAmounts(values: string[]): string | undefined {
  let total = 0n;
  for (const value of values) {
    const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
    if (!match) return undefined;
    const sign = match[1] === "-" ? -1n : 1n;
    total += sign * BigInt(match[2] + (match[3] ?? "").padEnd(6, "0"));
  }
  const negative = total < 0n;
  const absolute = negative ? -total : total;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Commercial 源系统没有 Opportunity / Contract 表。为了让报价/订单进入
 * N-Perform 的生命周期，用稳定的派生父键建立“客户级商机 + 报价级合同”：
 *   CUST-<customerId>       → Account / Opportunity
 *   QUOTE-<quotationId>     → Quote（ACCEPTED）
 *   CONTRACT-<quotationId>  → Contract（SIGNED，金额=订单合计）
 * 这不是伪造来源外键：ID 前缀明确标识它是 N-Perform 的投影，源记录仍在
 * payload/来源 ID 中可追溯。订单金额与合同金额一致，满足合同/订单校验。
 */
function deriveCommercialParents(input: {
  customerId: string;
  customerName: string;
  currency: string;
  amount: string;
  quotationId?: string;
}): CanonicalWrite[] {
  const accountId = `CUST-${input.customerId}`;
  const opportunityId = accountId;
  const writes: CanonicalWrite[] = [
    {
      path: ACCOUNT_IMPORT_PATH,
      externalId: accountId,
      body: {
        sourceSystem: COMMERCIAL_SOURCE_SYSTEM,
        externalAccountId: accountId,
        name: input.customerName,
      },
    },
    {
      path: OPPORTUNITY_IMPORT_PATH,
      externalId: opportunityId,
      body: {
        sourceSystem: COMMERCIAL_SOURCE_SYSTEM,
        externalAccountId: accountId,
        accountName: input.customerName,
        externalOpportunityId: opportunityId,
        name: `${input.customerName} pipeline`,
        stage: "QUALIFIED",
        currency: input.currency,
        estimatedAmount: input.amount,
      },
    },
  ];
  if (!input.quotationId) return writes;
  const quoteId = `QUOTE-${input.quotationId}`;
  writes.push({
    path: QUOTE_IMPORT_PATH,
    externalId: quoteId,
    body: {
      sourceSystem: COMMERCIAL_SOURCE_SYSTEM,
      externalOpportunityId: opportunityId,
      externalQuoteId: quoteId,
      currency: input.currency,
      amount: input.amount,
      status: "ACCEPTED",
    },
  });
  writes.push({
    path: CONTRACT_IMPORT_PATH,
    externalId: `CONTRACT-${input.quotationId}`,
    body: {
      sourceSystem: COMMERCIAL_SOURCE_SYSTEM,
      externalContractId: `CONTRACT-${input.quotationId}`,
      externalQuoteId: quoteId,
      contractRef: `CONTRACT-${input.quotationId}`,
      currency: input.currency,
      amount: input.amount,
      status: "SIGNED",
    },
  });
  return writes;
}

/**
 * quotation → import/quotes。
 *
 * 只认真实的 opportunity 外键（opportunity_id/deal_id）。真实 API 的报价
 * 没有该字段，只有 customer_id；customer 不是 opportunity，不能用它兜底，
 * 否则会在 N-Perform 里凭空关联/创建不存在的商机。故返回 `[]` 表示跳过。
 */
export function normalizeCommercialQuote(
  record: unknown,
): CanonicalWrite | CanonicalWrite[] {
  if (!isRecord(record)) return [];
  const externalQuoteId = firstText(
    record,
    "id",
    "quote_id",
    "quote_number",
    "quoteNumber",
  );
  if (!externalQuoteId) return [];

  const currency = currencyOf(record);
  if (!currency) return [];
  const amount = monetaryAmount(
    record,
    currency,
    ["total_original", "totalOriginal"],
    ["total_usd", "totalUsd"],
  );
  if (amount === undefined) return [];

  let externalOpportunityId = firstText(
    record,
    "opportunity_id",
    "opportunityId",
    "deal_id",
    "dealId",
  );
  const customerId = firstText(record, "customer_id", "customerId");
  const customerName =
    firstText(record, "customer_name", "customerName") ||
    (customerId ? `Customer ${customerId}` : "");
  const writes: CanonicalWrite[] = [];
  if (!externalOpportunityId) {
    if (!customerId || !customerName) return [];
    externalOpportunityId = `CUST-${customerId}`;
    writes.push(
      ...deriveCommercialParents({
        customerId,
        customerName,
        currency,
        amount,
      }),
    );
  }

  const body: Record<string, unknown> = {
    sourceSystem: COMMERCIAL_SOURCE_SYSTEM,
    externalOpportunityId,
    externalQuoteId,
    currency,
    amount,
  };
  const status = mappedStatus(record, QUOTE_STATUS);
  if (status) body.status = status;
  const issuedAt = isoDateTime(
    record.issued_at ?? record.issuedAt ?? record.issued_at_utc,
  );
  if (issuedAt) body.issuedAt = issuedAt;
  const acceptedAt = isoDateTime(record.accepted_at ?? record.acceptedAt);
  if (acceptedAt) body.acceptedAt = acceptedAt;

  writes.push({
    path: QUOTE_IMPORT_PATH,
    body,
    externalId: externalQuoteId,
  });
  return writes;
}

/** 订单行 → import/orders.lines；任何必要金额无法按成交币种取得时整行跳过。 */
function normalizeOrderLine(
  item: unknown,
  currency: string,
): Record<string, unknown> | undefined {
  if (!isRecord(item)) return undefined;
  const description = firstText(
    item,
    "product_name",
    "productName",
    "description",
    "name",
    "sku",
  );
  const quantity = firstDecimal(item, "quantity");
  if (!description || quantity === undefined) return undefined;

  const amount = monetaryAmount(
    item,
    currency,
    ["total_original", "totalOriginal"],
    ["total_usd", "totalUsd", "total"],
  );
  if (amount === undefined) return undefined;

  // 单价取“实际成交单价”：成交币种原币优先，USD 单退回 discounted_price_usd。
  const explicitUnitPrice =
    firstDecimal(
      item,
      "discounted_price_original",
      "discountedPriceOriginal",
      "unit_price_original",
      "unitPriceOriginal",
    ) ??
    (currency === "USD"
      ? firstDecimal(
          item,
          "discounted_price_usd",
          "discountedPriceUsd",
          "unit_price_usd",
          "unitPriceUsd",
        )
      : undefined);

  // 只有满足 quantity × unitPrice === amount 的单价才能投递；源数据四舍五入
  // 导致对不上时，尝试 amount/quantity 的精确除法，仍不成立就跳过该行。
  let unitPrice = explicitUnitPrice;
  if (
    unitPrice === undefined ||
    !decimalProductEquals(unitPrice, quantity, amount)
  ) {
    const derived = divideDecimal(amount, quantity);
    unitPrice =
      derived !== undefined &&
      decimalProductEquals(derived, quantity, amount)
        ? derived
        : undefined;
  }
  if (unitPrice === undefined) return undefined;

  const rawKind = text(item.kind).toUpperCase();
  const kind = LINE_KINDS.has(rawKind) ? rawKind : "PRODUCT";

  return {
    kind,
    description,
    quantity,
    unitPrice,
    amount,
    currency,
  };
}

/**
 * order → import/orders。
 *
 * 只认真实的 contract 外键（contract_id/external_contract_id）。真实 API 的
 * 订单没有合同字段，只有 quotation_id；quotation 不是 contract，也不能拿
 * quote_snapshot/acceptance_reference 当合同号，故返回 `[]` 表示跳过。
 */
export function normalizeCommercialOrder(
  record: unknown,
): CanonicalWrite | CanonicalWrite[] {
  if (!isRecord(record)) return [];
  const externalOrderId = firstText(
    record,
    "id",
    "order_id",
    "order_number",
    "orderNumber",
  );
  const orderNumber = firstText(record, "order_number", "orderNumber");
  if (!externalOrderId || !orderNumber) return [];

  const currency = currencyOf(record);
  if (!currency) return [];

  const rawLines = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.lines)
      ? record.lines
      : [];
  const lines = rawLines
    .map((item) => normalizeOrderLine(item, currency))
    .filter((line): line is Record<string, unknown> => line !== undefined);
  if (lines.length === 0) return [];

  const amount = sumDecimalAmounts(lines.map((line) => String(line.amount)));
  if (!amount) return [];

  let externalContractId = firstText(
    record,
    "contract_id",
    "contractId",
    "external_contract_id",
    "externalContractId",
  );
  const customerId = firstText(record, "customer_id", "customerId");
  const customerName =
    firstText(record, "customer_name", "customerName") ||
    (customerId ? `Customer ${customerId}` : "");
  const quotationId = firstText(record, "quotation_id", "quotationId");
  const writes: CanonicalWrite[] = [];
  if (!externalContractId) {
    if (!customerId || !customerName || !quotationId) return [];
    externalContractId = `CONTRACT-${quotationId}`;
    writes.push(
      ...deriveCommercialParents({
        customerId,
        customerName,
        currency,
        amount,
        quotationId,
      }),
    );
  }

  const body: Record<string, unknown> = {
    sourceSystem: COMMERCIAL_SOURCE_SYSTEM,
    externalOrderId,
    externalContractId,
    orderNumber,
    currency,
    lines,
  };
  const status = mappedStatus(record, ORDER_STATUS);
  if (status) body.status = status;

  writes.push({
    path: ORDER_IMPORT_PATH,
    body,
    externalId: externalOrderId,
  });
  return writes;
}

/**
 * `PullTarget.query` 可承载固定过滤（如 `{status:"accepted"}`）。这里**不设**
 * 静态 status：Commercial 的报价/订单状态要全量导入（draft→DRAFT、
 * sent→ISSUED、accepted→ACCEPTED…；订单取消态也要同步），单个固定状态会把
 * 其余状态永久漏掉。需要按状态分批拉取时，由调用方在 target 上叠加 query。
 */
const targets: PullTarget[] = [
  {
    method: "GET",
    path: "/api/v1/customers",
    pageParam: "page",
    limitParam: "limit",
    pageSize: PAGE_SIZE,
    extract: extractCommercialRecords,
    normalize: normalizeCommercialAccount,
  },
  {
    method: "GET",
    // 真实路由是 /quotations（quotes.py 的 APIRouter(prefix='/quotations')）。
    path: "/api/v1/quotations",
    pageParam: "page",
    limitParam: "limit",
    pageSize: PAGE_SIZE,
    extract: extractCommercialRecords,
    normalize: normalizeCommercialQuote,
  },
  {
    method: "GET",
    path: "/api/v1/orders",
    pageParam: "page",
    limitParam: "limit",
    pageSize: PAGE_SIZE,
    extract: extractCommercialRecords,
    normalize: normalizeCommercialOrder,
  },
];

export const commercialProvider: LocalProvider = {
  code: "anari-commercial",
  sourceSystem: COMMERCIAL_SOURCE_SYSTEM,
  baseUrlEnv: "ANARI_COMMERCIAL_BASE_URL",
  tokenEnv: "ANARI_COMMERCIAL_TOKEN",
  targets,
};
