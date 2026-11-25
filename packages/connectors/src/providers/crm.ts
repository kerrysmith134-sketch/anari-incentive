/**
 * ANARI CRM（本地 anari-ai-crm）→ N-Perform Commercial 导入适配。
 *
 * 事实来源（2026-11-25 逐文件核对 anari-ai-crm 源码，不是按 REST 惯例猜的）：
 *   - src/app/api/deals/route.ts       GET ?limit&offset → { deals, total }
 *   - src/services/deal-service.ts     listDeals：include stage/company/primaryContact/owner
 *   - src/app/api/companies/route.ts   GET ?limit&offset → { companies, total, enriched, totalContacts }
 *   - src/services/company-service.ts  listCompanies：include owner + _count{contacts,deals}
 *   - src/app/api/contacts/route.ts    GET ?limit&offset → { contacts, total, withEmail, highEngagement }
 *   - src/lib/pagination.ts            offset-based：limit 默认 50（deals 上限 100，companies/contacts 上限 200），offset 默认 0
 *   - prisma/schema.prisma             Deal.amount Decimal? @db.Decimal(14,2)；Deal.currency 默认 "CNY"
 *
 * 三个从源码里读出来、写代码前必须先知道的点：
 *   1. 列表响应不是数组，而是 { deals | companies | contacts, total } 信封。
 *   2. Prisma.Decimal 经 JSON.stringify 后是**字符串**（"1250000"，尾随零被去掉），
 *      不是数字。normalize 因此直通字符串，绝不做 Number() 往返——binary float
 *      会把 0.1+0.2 那类误差带进金额事实。
 *   3. 没有游标、没有 next 链接、也没有按 updatedAt 增量的过滤参数；只能 limit/offset
 *      翻页。pageParam 因此声明为 "offset"：runner 发 offset = pageIndex * pageSize。
 *
 * 鉴权：deals/companies/contacts 路由都先走 getCurrentSession()（src/lib/session.ts），
 * 只认 `Authorization: Bearer <CRM session JWT>` 或 anari_session cookie。所以
 * ANARI_CRM_TOKEN 必须是 CRM 签发的 session JWT（会过期，需运维续签），不是长期
 * API key。另外非 owner/admin 角色只看到自己（及其报告线/所带小组）名下、以及共享
 * 给自己的记录（viewerScopeParams），全量导入要用 owner/admin 的令牌，否则拉到的
 * 只是一个人的子集。
 *
 * 写入目标（CRM deal 绝不写成 Order：订单必须经过 Opportunity→Quote→Contract）：
 *   deal    → POST /api/v1/commercial/import/opportunities
 *   company → POST /api/v1/commercial/import/accounts
 *   contact → 没有联系人的导入端点，只提取不写（见 crmContactTarget 的注释）
 */
import type { CanonicalWrite, LocalProvider, PullTarget } from "./types.js";

/** N-Perform 里这条事实的来源标识。 */
export const CRM_SOURCE_SYSTEM = "ANARI_CRM";

/** 目标端点（apps/api/src/modules/commercial/commercial.routes.ts）。 */
export const CRM_OPPORTUNITY_PATH =
  "/api/v1/commercial/import/opportunities";
export const CRM_ACCOUNT_PATH = "/api/v1/commercial/import/accounts";

/** /api/v1/commercial/import/opportunities 接受的 stage 枚举（packages/contracts）。 */
export const CRM_OPPORTUNITY_STAGES = [
  "PROSPECT",
  "QUALIFIED",
  "PROPOSAL",
  "WON",
  "LOST",
] as const;
export type CrmOpportunityStage = (typeof CRM_OPPORTUNITY_STAGES)[number];

/**
 * CRM 阶段 → N-Perform 枚举。
 *
 * CRM 的阶段是可改名、可按团队配置的表（prisma seed 默认 7 个：Lead / Qualified /
 * Proposal / Negotiation / Contract Review / Closed Won / Closed Lost），N-Perform
 * 只有 5 个枚举值。映射规则：
 *   - isWon / isLost 布尔标记优先：它是阶段表上的输赢事实，改名不会改变它。
 *   - 其次按阶段名（大小写、空格、下划线、连字符归一后）查表。
 *   - Negotiation / Contract Review 落在 PROPOSAL 之后、WON 之前，枚举里没有更近
 *     的值，只能压到 PROPOSAL——这是有损映射，损失的部分是“比 proposal 更靠后”
 *     这一信息，不是输赢方向，所以可以接受。
 *   - 查不到 → 返回 undefined，调用方**省略 stage 字段**（契约里 stage 可选，
 *     upsert 时 COALESCE 保留库里已有值）。不把看不出来的阶段写成 QUALIFIED：
 *     在结算归因系统里，伪造一个阶段比少一个阶段危险得多。
 *   - 中文/自定义阶段名一律落到 undefined，等团队补映射，不猜。
 */
export function mapCrmStageToOpportunityStage(
  stage: unknown,
): CrmOpportunityStage | undefined {
  if (stage === null || stage === undefined) return undefined;

  // 允许直接传阶段名（某些调用点只拿到 stage.name 或字符串）。
  if (typeof stage === "string") return lookupStageName(stage);
  if (!isRecord(stage)) return undefined;

  if (stage.isWon === true) return "WON";
  if (stage.isLost === true) return "LOST";
  if (typeof stage.name !== "string") return undefined;
  return lookupStageName(stage.name);
}

/** 阶段名归一化查表：空格/下划线/连字符等价，"Closed_Won" 与 "closed won" 同义。 */
function lookupStageName(name: string): CrmOpportunityStage | undefined {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]+/g, " ")
    .replace(/\s+/g, " ");
  const mapped: Record<string, CrmOpportunityStage> = {
    // 未验证的线索
    lead: "PROSPECT",
    prospect: "PROSPECT",
    prospecting: "PROSPECT",
    inbound: "PROSPECT",
    new: "PROSPECT",
    // 已验证、可以推进
    qualified: "QUALIFIED",
    qualification: "QUALIFIED",
    discovery: "QUALIFIED",
    contacted: "QUALIFIED",
    // 方案/报价/谈判：都在 PROPOSAL 及之后、WON 之前
    proposal: "PROPOSAL",
    "proposal sent": "PROPOSAL",
    quote: "PROPOSAL",
    quoted: "PROPOSAL",
    negotiation: "PROPOSAL",
    "contract review": "PROPOSAL",
    "contract sent": "PROPOSAL",
    review: "PROPOSAL",
    // 终态（没有 isWon/isLost 标记时的兜底）
    won: "WON",
    "closed won": "WON",
    lost: "LOST",
    "closed lost": "LOST",
  };
  return mapped[key];
}

/**
 * CRM deal → 一条 opportunity 写入。
 *
 * 契约（importCommercialOpportunitySchema）要求 sourceSystem、externalAccountId、
 * accountName、externalOpportunityId、name、currency 全部非空。缺任何一项必需字段、
 * 或币种不是 3 位 → 返回 [] 跳过：这条记录无法被目标 API 接受，硬塞会得到 400 并在
 * runner 里变成隔离记录，不如在映射层就说清楚“这条不要”。
 * 金额不可解析不跳过（estimatedAmount 是可选字段）：记录照写，只省略金额，否则一条
 * 缺金额的单子会连它的存在一起丢掉。
 */
export function normalizeCrmDeal(record: unknown): CanonicalWrite[] {
  if (!isRecord(record)) return [];

  const dealId = text(record.id);
  const name = text(record.name);
  // company 是 include 出来的 { id, name }；companyId 是 Deal 上的非空外键。
  // 两个都给不出来时无法满足 externalAccountId + accountName，跳过。
  const company = isRecord(record.company) ? record.company : undefined;
  const externalAccountId = text(company?.id) ?? text(record.companyId);
  const accountName = text(company?.name);
  if (!dealId || !name || !externalAccountId || !accountName) return [];

  // 目标契约要求 3 位币种。CRM 库里有默认值 "CNY"，响应里理论上不会缺；缺或不
  // 合规说明来源 schema 漂移了，这时**不猜**币种（猜错币种的金额等于错账）。
  const currency = currencyCode(record.currency);
  if (!currency) return [];

  const body: Record<string, unknown> = {
    sourceSystem: CRM_SOURCE_SYSTEM,
    externalAccountId,
    accountName,
    externalOpportunityId: dealId,
    name,
    currency,
  };

  const stage = mapCrmStageToOpportunityStage(record.stage);
  if (stage !== undefined) body.stage = stage;

  // Deal.amount 是 Decimal(14,2)，JSON 里是字符串；没有金额就不写这个可选字段，
  // 不写 0（0 是一条“这个单子不值钱”的事实，null 才是“还没定”）。
  const estimatedAmount = decimalString(record.amount);
  if (estimatedAmount !== undefined) body.estimatedAmount = estimatedAmount;

  // CRM 的 User.id 是 cuid（cmq…），契约要 uuidSchema。只有真的拿到 UUID 形态的
  // 人员 id 才写，cuid 一律不写——写进去会被 uuid 校验拒掉整条请求。
  const ownerPersonId = ownerUuid(record.owner);
  if (ownerPersonId !== undefined) body.ownerPersonId = ownerPersonId;

  return [
    {
      path: CRM_OPPORTUNITY_PATH,
      body,
      externalId: dealId,
    },
  ];
}

/**
 * CRM company → 一条 account 写入。
 *
 * account 契约只有 sourceSystem / externalAccountId / name（+可选 ownerPersonId），
 * 所以 industry、domain、address 这些字段**不进 body**：目标端点不收，塞进去只
 * 会被 zod 剥掉，还会让人误以为它们被持久化了。
 */
export function normalizeCrmCompany(record: unknown): CanonicalWrite[] {
  if (!isRecord(record)) return [];

  const companyId = text(record.id);
  const name = text(record.name);
  if (!companyId || !name) return [];

  const body: Record<string, unknown> = {
    sourceSystem: CRM_SOURCE_SYSTEM,
    externalAccountId: companyId,
    name,
  };
  const ownerPersonId = ownerUuid(record.owner);
  if (ownerPersonId !== undefined) body.ownerPersonId = ownerPersonId;

  return [
    {
      path: CRM_ACCOUNT_PATH,
      body,
      externalId: companyId,
    },
  ];
}

/**
 * 联系人：只提取，不写。
 *
 * N-Perform 目前没有“导入联系人”的端点（commercial 域的主数据只有 Account /
 * Opportunity），所以这里**明确**返回空数组而不是硬塞到 account 或 opportunity：
 * 把联系人当 account 写会把一个人的名字变成一家公司，污染客户主数据。
 * 等有了联系人目标端点，只需改这个函数，PullTarget 契约不用动。
 *
 * 注意：如果 runner 把“一个 target 零写入”当成异常（隔离/失败计数），应把
 * crmContactTarget 从 targets 里去掉——contacts 目前只在人工排查时有参考价值。
 */
export function normalizeCrmContact(_record: unknown): CanonicalWrite[] {
  return [];
}

/** GET /api/deals?limit=&offset= —— 只读，带 stage/company/owner 投影。 */
export const crmDealTarget: PullTarget = {
  method: "GET",
  path: "/api/deals",
  // offset-based，不是 1-based page：runner 必须发 offset = pageIndex * pageSize。
  pageParam: "offset",
  limitParam: "limit",
  // deals 接口默认 50、上限 100（parsePagination maxLimit: 100）。
  pageSize: 50,
  extract: (json) => recordsFrom(json, "deals", "/api/deals"),
  normalize: normalizeCrmDeal,
};

/** GET /api/companies?limit=&offset= —— 只读，带 owner + _count 投影。 */
export const crmCompanyTarget: PullTarget = {
  method: "GET",
  path: "/api/companies",
  pageParam: "offset",
  limitParam: "limit",
  // companies 默认 50、上限 200；与 deals 取同一个 50，翻页步长统一。
  pageSize: 50,
  extract: (json) => recordsFrom(json, "companies", "/api/companies"),
  normalize: normalizeCrmCompany,
};

/** GET /api/contacts?limit=&offset= —— 只读；normalize 恒为 []（无写目标）。 */
export const crmContactTarget: PullTarget = {
  method: "GET",
  path: "/api/contacts",
  pageParam: "offset",
  limitParam: "limit",
  pageSize: 50,
  extract: (json) => recordsFrom(json, "contacts", "/api/contacts"),
  normalize: normalizeCrmContact,
};

export const crmProvider: LocalProvider = {
  code: "anari-crm",
  sourceSystem: CRM_SOURCE_SYSTEM,
  baseUrlEnv: "ANARI_CRM_BASE_URL",
  tokenEnv: "ANARI_CRM_TOKEN",
  targets: [crmDealTarget, crmCompanyTarget, crmContactTarget],
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 取信封里的列表。形状不对时**抛错**而不是返回 []：CRM 鉴权失败返回的是
 * { error: "..." }，静默当成“这一页没有数据”会让一次全量同步悄悄同步了 0 条。
 */
function recordsFrom(json: unknown, key: string, path: string): unknown[] {
  if (!isRecord(json)) {
    const actual = Array.isArray(json)
      ? "array"
      : json === null
        ? "null"
        : typeof json;
    throw new Error(`${path}: expected a JSON object with "${key}", got ${actual}`);
  }
  const list = json[key];
  if (!Array.isArray(list)) {
    throw new Error(`${path}: response is missing the "${key}" array`);
  }
  return list;
}

/** 非空字符串（去空白）；空串等同于缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 目标契约的 decimal：`^-?\d+(\.\d+)?$`（packages/contracts/src/primitives.ts）。 */
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Decimal 值 → 契约要求的十进制字符串。
 * 字符串直通（Prisma.Decimal 的 JSON 形态），数字只在没有科学计数法时接受；
 * 其它形态（"1,250"、"1e21"、"abc"、NaN）返回 undefined，由调用方跳过。
 */
function decimalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return DECIMAL_RE.test(trimmed) ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const asText = String(value);
    return DECIMAL_RE.test(asText) ? asText : undefined;
  }
  return undefined;
}

/** ISO-4217 形态的 3 位大写币种，与 runner 的校验一致。 */
const CURRENCY_RE = /^[A-Z]{3}$/;

function currencyCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return CURRENCY_RE.test(code) ? code : undefined;
}

/**
 * 与 contracts 的 uuidSchema（zod v3 `.uuid()`）完全一致的判定：任意 8-4-4-4-12
 * 十六进制。放宽或收紧都会让目标 API 的校验结果和这里不一致。
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ownerUuid(owner: unknown): string | undefined {
  if (!isRecord(owner)) return undefined;
  const id = text(owner.id);
  return id !== undefined && UUID_RE.test(id) ? id : undefined;
}
