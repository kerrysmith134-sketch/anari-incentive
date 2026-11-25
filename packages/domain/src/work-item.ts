/**
 * Canonical Ticketing Work Item（2026-11-25）。
 *
 * 工单系统（PingCode 及通用 Ticketing）的工作项是“贡献/激励”的上游事实，
 * 但它不是 Evidence 的附注：状态历史必须 append-only、多人贡献必须可分摊。
 * 本模块只定义规范模型与纯解析/校验函数，不做持久化：
 *
 *   work_items（当前快照）
 *     └── work_item_events（状态历史，append-only）
 *     └── work_item_contributions（person_id + role + weight/ratio）
 *
 * 关键约束：
 * - 来源感知身份 = (tenantId, sourceSystem, externalId)，重复导入必须幂等；
 * - 只有状态真的变化才追加事件；同一状态重复导入不得产生第二条事件；
 * - 缺必填字段/非法枚举/非法金额币种 → 解析失败，由调用方隔离而不是吞掉。
 *
 * 该模块经 types.ts 再导出到 `@anari/domain` 包面（types.ts 是既有聚合点）。
 */

export const WORK_ITEM_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "CANCELLED",
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_TYPES = [
  "STORY",
  "TASK",
  "BUG",
  "EPIC",
  "OTHER",
] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export const WORK_ITEM_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

/** 规范工作项（跨来源去重后的唯一事实）。 */
export interface WorkItem {
  id: string;
  tenantId: string;
  /** 来源系统（pingcode / jira / generic-ticketing）。 */
  sourceSystem: string;
  /** 来源系统内的工单号；与 sourceSystem 一起构成幂等身份。 */
  externalId: string;
  /** 来源项目的规范标识（外部 ID，不强制内部项目表）。 */
  projectId: string;
  title: string;
  type: WorkItemType;
  priority?: WorkItemPriority;
  status: WorkItemStatus;
  assigneePersonId?: string;
  reporterPersonId?: string;
  startedAt?: string;
  dueAt?: string;
  completedAt?: string;
  /** 贡献权重；与金额/币种一起进入激励计算。 */
  weight?: string;
  currency?: string;
  amount?: string;
  /** 来源原始快照（可追溯，不参与幂等判定）。 */
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** 状态历史条目：append-only。fromStatus 为空表示来源记录的初始状态（本系统不合成）。 */
export interface WorkItemEvent {
  id: string;
  tenantId: string;
  workItemId: string;
  fromStatus?: WorkItemStatus;
  toStatus: WorkItemStatus;
  occurredAt: string;
  actorPersonId?: string;
  createdAt: string;
}

/** 单人贡献：同一工作项 + 人 + 角色唯一。 */
export interface WorkItemContribution {
  id: string;
  tenantId: string;
  workItemId: string;
  personId: string;
  role: string;
  weight?: string;
  ratio?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItemEventInput {
  fromStatus?: WorkItemStatus;
  toStatus: WorkItemStatus;
  occurredAt?: string;
  actorPersonId?: string;
}

export interface WorkItemContributionInput {
  personId: string;
  role: string;
  weight?: string;
  ratio?: string;
}

export interface WorkItemImportInput {
  tenantId: string;
  sourceSystem: string;
  externalId: string;
  projectId: string;
  title: string;
  type: WorkItemType;
  priority?: WorkItemPriority;
  status: WorkItemStatus;
  assigneePersonId?: string;
  reporterPersonId?: string;
  startedAt?: string;
  dueAt?: string;
  completedAt?: string;
  weight?: string;
  currency?: string;
  amount?: string;
  payload?: Record<string, unknown>;
  events?: WorkItemEventInput[];
  contributions?: WorkItemContributionInput[];
}

/** 导入结果：created 区分新建/更新；events 只含本次实际追加的事件。 */
export interface WorkItemImportResult {
  workItem: WorkItem;
  created: boolean;
  events: WorkItemEvent[];
  contributions: WorkItemContribution[];
}

export interface WorkItemFilter {
  projectId?: string;
  personId?: string;
}

export class WorkItemValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "WorkItemValidationError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** 权重/比例上限：防止一次导入把贡献权重放大到不可审计的量级。 */
const MAX_WEIGHT = "1000000000";

export function isWorkItemStatus(value: unknown): value is WorkItemStatus {
  return (
    typeof value === "string" &&
    (WORK_ITEM_STATUSES as readonly string[]).includes(value)
  );
}

export function isWorkItemType(value: unknown): value is WorkItemType {
  return (
    typeof value === "string" &&
    (WORK_ITEM_TYPES as readonly string[]).includes(value)
  );
}

export function isWorkItemPriority(value: unknown): value is WorkItemPriority {
  return (
    typeof value === "string" &&
    (WORK_ITEM_PRIORITIES as readonly string[]).includes(value)
  );
}

/** 终态：DONE / CANCELLED 不再产生“进行中”事件。 */
export function isTerminalWorkItemStatus(status: WorkItemStatus): boolean {
  return status === "DONE" || status === "CANCELLED";
}

/**
 * 规范时间戳：不同适配器/来源可能给 "2026-11-20T09:00:00Z" 或带毫秒，
 * 事件幂等键必须先归一（PostgreSQL 返回的 timestamptz 自带毫秒）。
 */
export function normalizeIsoTimestamp(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** 贡献幂等键：同一工作项下 person + role 唯一。 */
export function contributionKey(personId: string, role: string): string {
  return `${personId}|${role}`;
}

/**
 * 状态事件幂等键：from → to + 发生时间 + 执行人。
 * 同一转换重复导入（相同时间/执行人）不得追加第二条历史。
 */
export function workItemEventKey(event: WorkItemEventInput): string {
  return [
    event.fromStatus ?? "",
    event.toStatus,
    event.occurredAt ?? "",
    event.actorPersonId ?? "",
  ].join("|");
}

/**
 * 状态变化计划：只有 storedStatus 与 incoming 不同才产生一条事件。
 *
 * occurredAt 用“本次观测时间”，而不是 completedAt：来源补报历史完成时间时，
 * 若用 completedAt 会把后记录的转换排到先前事件之前，历史顺序不单调。
 * 真实完成时间保存在 work_items.completed_at。
 */
export function planStatusTransition(
  storedStatus: WorkItemStatus | undefined,
  status: WorkItemStatus,
  occurredAt: string,
): WorkItemEventInput | null {
  if (storedStatus === status) return null;
  return {
    fromStatus: storedStatus,
    toStatus: status,
    occurredAt,
  };
}

/**
 * 来源是否已提供同一转换的历史事件（from → to）。
 * 提供了就不再按“当前快照变化”补一条隐式事件，避免同一次转换被记两遍。
 */
export function hasStatusTransition(
  events: WorkItemEventInput[] | undefined,
  fromStatus: WorkItemStatus | undefined,
  toStatus: WorkItemStatus,
): boolean {
  return (events ?? []).some(
    (event) =>
      event.fromStatus === fromStatus && event.toStatus === toStatus,
  );
}

/**
 * 解析 ticketing payload → 规范导入输入（runner 与 API 共享同一套规则）。
 * 缺字段不返回半成品：全部错误一次性返回，调用方决定隔离/拒绝。
 */
export function parseWorkItemImportPayload(
  payload: Record<string, unknown> | undefined,
): { ok: true; value: Omit<WorkItemImportInput, "tenantId"> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const source = payload ?? {};

  const asText = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return undefined;
  };
  const asIso = (value: unknown, field: string): string | undefined => {
    const text = asText(value);
    if (!text) return undefined;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      errors.push(`${field} must be an ISO date-time`);
      return undefined;
    }
    return parsed.toISOString();
  };
  const asUuid = (value: unknown, field: string): string | undefined => {
    const text = asText(value);
    if (!text) return undefined;
    if (!UUID_PATTERN.test(text)) {
      errors.push(`${field} must be a UUID`);
      return undefined;
    }
    return text;
  };
  const asDecimal = (
    value: unknown,
    field: string,
    options: { positive?: boolean; min?: string; max?: string } = {},
  ): string | undefined => {
    const text = asText(value);
    if (!text) return undefined;
    if (!DECIMAL_PATTERN.test(text)) {
      errors.push(`${field} must be a decimal string`);
      return undefined;
    }
    const numeric = Number(text);
    if (options.positive && numeric <= 0) {
      errors.push(`${field} must be positive`);
      return undefined;
    }
    if (options.min !== undefined && numeric < Number(options.min)) {
      errors.push(`${field} must be at least ${options.min}`);
      return undefined;
    }
    if (options.max !== undefined && numeric > Number(options.max)) {
      errors.push(`${field} exceeds the maximum ${options.max}`);
      return undefined;
    }
    return text;
  };

  const externalId = asText(source.externalId);
  if (!externalId) errors.push("externalId is required");
  const projectId = asText(source.projectId);
  if (!projectId) errors.push("projectId is required");
  const title = asText(source.title);
  if (!title) errors.push("title is required");

  const typeText = asText(source.type)?.toUpperCase();
  let type: WorkItemType | undefined;
  if (!typeText) errors.push("type is required");
  else if (!isWorkItemType(typeText)) {
    errors.push(`type must be one of ${WORK_ITEM_TYPES.join(", ")}`);
  } else type = typeText;

  const statusText = asText(source.status)?.toUpperCase();
  let status: WorkItemStatus | undefined;
  if (!statusText) errors.push("status is required");
  else if (!isWorkItemStatus(statusText)) {
    errors.push(`status must be one of ${WORK_ITEM_STATUSES.join(", ")}`);
  } else status = statusText;

  const priorityText = asText(source.priority)?.toUpperCase();
  let priority: WorkItemPriority | undefined;
  if (priorityText) {
    if (!isWorkItemPriority(priorityText)) {
      errors.push(`priority must be one of ${WORK_ITEM_PRIORITIES.join(", ")}`);
    } else priority = priorityText;
  }

  const currencyText = asText(source.currency)?.toUpperCase();
  const amount = asDecimal(source.amount, "amount");
  if (amount !== undefined) {
    if (!currencyText || !CURRENCY_PATTERN.test(currencyText)) {
      errors.push("currency is required with amount");
    }
  }
  if (currencyText && !CURRENCY_PATTERN.test(currencyText)) {
    errors.push("currency must be a 3-letter code");
  }
  const currency =
    currencyText && CURRENCY_PATTERN.test(currencyText) ? currencyText : undefined;

  const weight = asDecimal(source.weight, "weight", {
    positive: true,
    max: MAX_WEIGHT,
  });

  const events: WorkItemEventInput[] = [];
  if (source.events !== undefined) {
    if (!Array.isArray(source.events)) {
      errors.push("events must be an array");
    } else {
      source.events.forEach((raw, index) => {
        if (!raw || typeof raw !== "object") {
          errors.push(`events[${index}] must be an object`);
          return;
        }
        const entry = raw as Record<string, unknown>;
        const toText = asText(entry.toStatus)?.toUpperCase();
        if (!toText || !isWorkItemStatus(toText)) {
          errors.push(
            `events[${index}].toStatus must be one of ${WORK_ITEM_STATUSES.join(", ")}`,
          );
          return;
        }
        const fromText = asText(entry.fromStatus)?.toUpperCase();
        if (fromText && !isWorkItemStatus(fromText)) {
          errors.push(
            `events[${index}].fromStatus must be one of ${WORK_ITEM_STATUSES.join(", ")}`,
          );
          return;
        }
        events.push({
          fromStatus: (fromText as WorkItemStatus | undefined) ?? undefined,
          toStatus: toText as WorkItemStatus,
          occurredAt: asIso(entry.occurredAt, `events[${index}].occurredAt`),
          actorPersonId: asUuid(
            entry.actorPersonId,
            `events[${index}].actorPersonId`,
          ),
        });
      });
    }
  }

  const contributions: WorkItemContributionInput[] = [];
  if (source.contributions !== undefined) {
    if (!Array.isArray(source.contributions)) {
      errors.push("contributions must be an array");
    } else {
      source.contributions.forEach((raw, index) => {
        if (!raw || typeof raw !== "object") {
          errors.push(`contributions[${index}] must be an object`);
          return;
        }
        const entry = raw as Record<string, unknown>;
        const personId = asUuid(entry.personId, `contributions[${index}].personId`);
        const role = asText(entry.role);
        if (!personId) errors.push(`contributions[${index}].personId is required`);
        if (!role) errors.push(`contributions[${index}].role is required`);
        if (!personId || !role) return;
        contributions.push({
          personId,
          role,
          weight: asDecimal(entry.weight, `contributions[${index}].weight`, {
            positive: true,
            max: MAX_WEIGHT,
          }),
          ratio: asDecimal(entry.ratio, `contributions[${index}].ratio`, {
            min: "0",
            max: "1",
          }),
        });
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      sourceSystem: asText(source.sourceSystem) ?? "",
      externalId: externalId!,
      projectId: projectId!,
      title: title!,
      type: type!,
      priority,
      status: status!,
      assigneePersonId: asUuid(source.assigneePersonId, "assigneePersonId"),
      reporterPersonId: asUuid(source.reporterPersonId, "reporterPersonId"),
      startedAt: asIso(source.startedAt, "startedAt"),
      dueAt: asIso(source.dueAt, "dueAt"),
      completedAt: asIso(source.completedAt, "completedAt"),
      weight,
      currency,
      amount,
      payload:
        source.payload && typeof source.payload === "object"
          ? (source.payload as Record<string, unknown>)
          : source,
      events,
      contributions,
    },
  };
}

/**
 * Adapter 侧防御性校验：即使路由契约被绕过，也不允许写入非规范枚举。
 * 抛 WorkItemValidationError（调用方按 400/隔离处理）。
 */
export function assertValidWorkItemImport(input: WorkItemImportInput): void {
  if (!input.tenantId) throw new WorkItemValidationError("TENANT_REQUIRED", "tenantId is required");
  if (!input.sourceSystem) {
    throw new WorkItemValidationError("SOURCE_REQUIRED", "sourceSystem is required");
  }
  if (!input.externalId) {
    throw new WorkItemValidationError("EXTERNAL_ID_REQUIRED", "externalId is required");
  }
  if (!input.projectId) {
    throw new WorkItemValidationError("PROJECT_REQUIRED", "projectId is required");
  }
  if (!input.title) {
    throw new WorkItemValidationError("TITLE_REQUIRED", "title is required");
  }
  if (!isWorkItemType(input.type)) {
    throw new WorkItemValidationError("INVALID_TYPE", `invalid work item type ${input.type}`);
  }
  if (!isWorkItemStatus(input.status)) {
    throw new WorkItemValidationError(
      "INVALID_STATUS",
      `invalid work item status ${input.status}`,
    );
  }
  if (input.priority && !isWorkItemPriority(input.priority)) {
    throw new WorkItemValidationError(
      "INVALID_PRIORITY",
      `invalid work item priority ${input.priority}`,
    );
  }
  if (input.amount && !DECIMAL_PATTERN.test(input.amount)) {
    throw new WorkItemValidationError(
      "INVALID_AMOUNT",
      `invalid amount ${input.amount}`,
    );
  }
  if (input.amount && !input.currency) {
    throw new WorkItemValidationError(
      "CURRENCY_REQUIRED",
      "currency is required when amount is present",
    );
  }
  if (input.currency && !CURRENCY_PATTERN.test(input.currency.toUpperCase())) {
    throw new WorkItemValidationError(
      "INVALID_CURRENCY",
      `invalid currency ${input.currency}`,
    );
  }
  if (input.weight !== undefined) {
    if (!DECIMAL_PATTERN.test(input.weight) || Number(input.weight) <= 0) {
      throw new WorkItemValidationError(
        "INVALID_WEIGHT",
        `invalid weight ${input.weight}`,
      );
    }
  }
  for (const event of input.events ?? []) {
    if (!isWorkItemStatus(event.toStatus)) {
      throw new WorkItemValidationError(
        "INVALID_EVENT_STATUS",
        `invalid event toStatus ${event.toStatus}`,
      );
    }
    if (event.fromStatus && !isWorkItemStatus(event.fromStatus)) {
      throw new WorkItemValidationError(
        "INVALID_EVENT_STATUS",
        `invalid event fromStatus ${event.fromStatus}`,
      );
    }
  }
  for (const contribution of input.contributions ?? []) {
    if (!contribution.personId || !contribution.role) {
      throw new WorkItemValidationError(
        "INVALID_CONTRIBUTION",
        "contribution requires personId and role",
      );
    }
    if (contribution.weight !== undefined) {
      if (
        !DECIMAL_PATTERN.test(contribution.weight) ||
        Number(contribution.weight) <= 0
      ) {
        throw new WorkItemValidationError(
          "INVALID_CONTRIBUTION_WEIGHT",
          `invalid contribution weight ${contribution.weight}`,
        );
      }
    }
    if (contribution.ratio !== undefined) {
      if (
        !DECIMAL_PATTERN.test(contribution.ratio) ||
        Number(contribution.ratio) < 0 ||
        Number(contribution.ratio) > 1
      ) {
        throw new WorkItemValidationError(
          "INVALID_CONTRIBUTION_RATIO",
          `invalid contribution ratio ${contribution.ratio}`,
        );
      }
    }
  }
}
