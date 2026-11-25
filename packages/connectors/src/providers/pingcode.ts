/**
 * PingCode 开放 API → 规范工作项（Ticketing Work Item）适配器。
 *
 * 官方文档（2026-11-25 核对）：
 * - 根地址：公有云 https://open.pingcode.com，私有部署 {domain}/open
 * - 鉴权：Authorization: Bearer {access_token}
 *   - OAuth2 Client Credentials：GET /v2/auth/token?grant_type=client_credentials
 *     &client_id=...&client_secret=...（企业令牌，30 天）
 *   - 或个人访问令牌（Personal Access Token）
 * - 列表：GET /v2/pjm/workitems?page_index=0&page_size=30
 *   page_index 从 0 开始；page_size 默认 30、最大 100。
 *   响应：{ page_size, page_index, total, values: [...] }
 * - 时间字段为 10 位秒级 Unix 时间戳。
 *
 * provider 本身不取 token：认证由 runner/凭据层完成，这里只消费
 * PINGCODE_ACCESS_TOKEN 里已签发的 Bearer token。
 */
import type {
  WorkItemContributionInput,
  WorkItemEventInput,
  WorkItemStatus,
  WorkItemType,
} from "@anari/domain";
import type { CanonicalWrite, LocalProvider, PullTarget } from "./types.js";

const SOURCE_SYSTEM = "PINGCODE";
/** 官方现行文档为 v2（open.pingcode.com/api_data.js）；没有 v1 工作项列表。 */
const WORK_ITEM_LIST_PATH = "/v2/pjm/workitems";
const WORK_ITEM_IMPORT_PATH = "/api/v1/work-items/import";
/** 官方上限 100（默认 30），用满一页减少往返。 */
const PAGE_SIZE = 100;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** `identifier` 在响应里是数字（5），`whole_identifier` 才是 "SCR-5"。 */
function asIdentifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

/** PingCode REST API 统一使用 10 位秒级时间戳；非法/占位值返回 undefined。 */
function secondsToIso(value: unknown): string | undefined {
  const seconds = asNumber(value);
  if (seconds === undefined || seconds <= 0) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 与 @anari/domain 的 UUID 校验保持同一宽松格式（不限 v4）。 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 人员外键只接受 UUID。PingCode 的用户 id 通常是 32 位十六进制
 * （如 a0417f68e846aae315c85d24643678a9），不是 UUID；贸然写进
 * person_id 会污染人员库，所以非 UUID 一律不映射。
 */
function asUuid(value: unknown): string | undefined {
  const text = asString(value);
  return text && UUID_PATTERN.test(text) ? text : undefined;
}

/**
 * 工作项类型映射。官方 `type.group` 允许值：
 * requirement / task / bug / issue / plan（见「创建一个工作项类型」）。
 * 自定义类型名不可穷举，先按名称/图标识别常见内置类型，再退回分组；
 * 无法归入规范枚举的（未知分组、缺 type）返回 undefined → 调用方跳过。
 */
const TYPE_BY_NAME: ReadonlyArray<readonly [RegExp, WorkItemType]> = [
  // 规范枚举没有 SUBTASK；子任务按 TASK 计入（父子层级与工作量仍保留在 payload）。
  [/^(?:sub-?task|子任务)$/u, "TASK"],
  [/^(?:user-?story|story|用户故事)$/u, "STORY"],
  [/^(?:task|任务)$/u, "TASK"],
  [/^(?:bug|defect|缺陷)$/u, "BUG"],
  [/^(?:epic|史诗|feature|特性)$/u, "EPIC"],
  [/^(?:issue|其他)$/u, "OTHER"],
];

const TYPE_BY_ICON: Record<string, WorkItemType> = {
  story: "STORY",
  "user-story": "STORY",
  task: "TASK",
  subtask: "TASK",
  "sub-task": "TASK",
  bug: "BUG",
  epic: "EPIC",
  issue: "OTHER",
};

const TYPE_BY_GROUP: Record<string, WorkItemType> = {
  requirement: "STORY",
  task: "TASK",
  bug: "BUG",
  issue: "OTHER",
  // 「计划」类在规范枚举中没有对应项，归入 OTHER。
  plan: "OTHER",
};

function mapWorkItemType(type: JsonObject | undefined): WorkItemType | undefined {
  if (!type) return undefined;
  const name = asString(type.name)?.toLowerCase().replace(/\s+/g, "");
  if (name) {
    for (const [pattern, mapped] of TYPE_BY_NAME) {
      if (pattern.test(name)) return mapped;
    }
  }
  const icon = asString(type.icon)?.toLowerCase();
  if (icon) {
    const mapped = TYPE_BY_ICON[icon];
    if (mapped) return mapped;
  }
  const group = asString(type.group)?.toLowerCase();
  return group ? TYPE_BY_GROUP[group] : undefined;
}

/**
 * 工作项状态映射。官方状态对象带 `type`（工作项自定义状态名不影响它）：
 * pending → OPEN，in_progress → IN_PROGRESS，completed → DONE，closed → CANCELLED。
 * 未识别的 type 不猜名称，直接跳过（半截状态不能写进状态历史）。
 */
const STATUS_BY_STATE_TYPE: Record<string, WorkItemStatus> = {
  pending: "OPEN",
  in_progress: "IN_PROGRESS",
  completed: "DONE",
  closed: "CANCELLED",
};

function mapWorkItemStatus(
  state: JsonObject | undefined,
): WorkItemStatus | undefined {
  const stateType = asString(state?.type)
    ?.toLowerCase()
    .replace(/\s+/g, "_");
  return stateType ? STATUS_BY_STATE_TYPE[stateType] : undefined;
}

/**
 * 状态事件只从「终态 + 完成时间」生成：
 * - 列表接口只返回当前快照，没有历史；用 updated_at 伪造事件会在每次
 *   标题/描述改动时重复追加“初始状态”，所以非终态不生成事件，交给
 *   导入器按存储状态追加真实转换。
 * - DONE / CANCELLED 且带 completed_at 时，完成时刻是来源事实，可作为
 *   幂等键稳定地追加一条终态事件。
 */
function completionEvents(
  status: WorkItemStatus,
  completedAt: string | undefined,
): WorkItemEventInput[] {
  if (!completedAt) return [];
  if (status !== "DONE" && status !== "CANCELLED") return [];
  return [{ toStatus: status, occurredAt: completedAt }];
}

/**
 * 贡献者同样只接受 UUID：
 * - 负责人（若 id 是 UUID）记 ASSIGNEE；
 * - participants 中 type=user 的 UUID 记 PARTICIPANT（去重）。
 * PingCode 常见的 32 位十六进制 id 全部跳过，不产生贡献。
 */
function collectContributions(
  record: JsonObject,
  assigneePersonId: string | undefined,
): WorkItemContributionInput[] {
  const contributions: WorkItemContributionInput[] = [];
  const seen = new Set<string>();
  if (assigneePersonId) {
    seen.add(assigneePersonId);
    contributions.push({ personId: assigneePersonId, role: "ASSIGNEE" });
  }
  const participants = record.participants;
  if (!Array.isArray(participants)) return contributions;
  for (const raw of participants) {
    const participant = asObject(raw);
    if (!participant) continue;
    if (asString(participant.type)?.toLowerCase() !== "user") continue;
    const user = asObject(participant.user);
    const personId = asUuid(user?.id) ?? asUuid(participant.id);
    if (!personId || seen.has(personId)) continue;
    seen.add(personId);
    contributions.push({ personId, role: "PARTICIPANT" });
  }
  return contributions;
}

/**
 * 单条工作项 → `/api/v1/work-items/import` 请求体。
 * 必填字段（externalId / projectId / title / type / status）任一缺失或
 * 无法映射 → undefined，由调用方跳过（不缺字段硬造）。
 */
function normalizeWorkItem(record: unknown): CanonicalWrite | undefined {
  const source = asObject(record);
  if (!source) return undefined;

  const externalId =
    asString(source.id) ??
    asString(source.whole_identifier) ??
    asIdentifier(source.identifier);
  const projectId = asString(asObject(source.project)?.id);
  const title = asString(source.title);
  const type = mapWorkItemType(asObject(source.type));
  const status = mapWorkItemStatus(asObject(source.state));
  if (!externalId || !projectId || !title || !type || !status) return undefined;

  const completedAt = secondsToIso(source.completed_at);
  const assigneePersonId = asUuid(asObject(source.assignee)?.id);
  const events = completionEvents(status, completedAt);
  const contributions = collectContributions(source, assigneePersonId);

  const body: Record<string, unknown> = {
    sourceSystem: SOURCE_SYSTEM,
    externalId,
    projectId,
    title,
    type,
    status,
    // 原始快照保留 sprint / identifier / created_at / updated_at 等
    // 规范表没有独立列的来源字段，供追溯与后续重放。
    payload: source,
  };
  if (assigneePersonId) body.assigneePersonId = assigneePersonId;
  if (completedAt) body.completedAt = completedAt;
  if (events.length > 0) body.events = events;
  if (contributions.length > 0) body.contributions = contributions;

  return { path: WORK_ITEM_IMPORT_PATH, body, externalId };
}

const workItemsTarget: PullTarget = {
  method: "GET",
  path: WORK_ITEM_LIST_PATH,
  // 官方分页：page_index 从 0 开始，page_size 默认 30、最大 100。
  pageParam: "page_index",
  limitParam: "page_size",
  pageSize: PAGE_SIZE,
  extract(json) {
    const values = asObject(json)?.values;
    return Array.isArray(values) ? values : [];
  },
  normalize(record) {
    const write = normalizeWorkItem(record);
    return write ? [write] : [];
  },
};

export const pingcodeProvider: LocalProvider = {
  code: "pingcode",
  sourceSystem: SOURCE_SYSTEM,
  baseUrlEnv: "PINGCODE_BASE_URL",
  tokenEnv: "PINGCODE_ACCESS_TOKEN",
  targets: [workItemsTarget],
};
