/**
 * Integrations Mapping Studio：字段映射的纯函数模型。
 *
 * 语义与 packages/connectors/src/mapping.ts 保持一致：
 * - `"properties.dealname"` → 点路径；
 * - `"=OPPORTUNITY"` → 常量（= 前缀，不经过转换管道）；
 * - `"updatedAt|date|trim"` → 转换管道（trim / upper / lower / number / date）。
 *
 * 这里只做前端解析与校验，不新增后端契约；保存仍走现有的
 * `POST /integration-connections/:id/mappings`（版本化）。
 */
import type { IntegrationMapping } from "../../lib/types.js";

/** 后端 connector 强制要求的 canonical 列（integration.ts REQUIRED_COLUMNS）。 */
export const CANONICAL_REQUIRED_FIELDS = [
  "sourceRecordId",
  "eventType",
  "subjectType",
  "subjectId",
  "evidenceType",
] as const;

/** canonical 可选列（有则使用，无则不投影）。 */
export const CANONICAL_OPTIONAL_FIELDS = [
  "occurredAt",
  "sourceUpdatedAt",
  "sourceEventVersion",
] as const;

export const CANONICAL_FIELD_ORDER: readonly string[] = [
  ...CANONICAL_REQUIRED_FIELDS,
  ...CANONICAL_OPTIONAL_FIELDS,
];

const REQUIRED_FIELD_SET = new Set<string>(CANONICAL_REQUIRED_FIELDS);

/** mapping.ts 支持的转换名。 */
export const TRANSFORM_NAMES = ["trim", "upper", "lower", "number", "date"] as const;
const TRANSFORM_SET = new Set<string>(TRANSFORM_NAMES);

const TRANSFORMS: Record<string, (value: string) => string> = {
  trim: (value) => value.trim(),
  upper: (value) => value.toUpperCase(),
  lower: (value) => value.toLowerCase(),
  number: (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed) : value;
  },
  date: (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  },
};

/** UI 行草稿：一条 fieldMap 项（目标列 ← 来源表达式）。 */
export interface MappingRowDraft {
  /** 仅用于 React key / 表单 id，不提交。 */
  id: string;
  targetField: string;
  sourceField: string;
  /** 管道语法，多个用 `|` 连接。 */
  transform: string;
  required: boolean;
}

export interface MappingRowErrors {
  target?: string;
  source?: string;
  transform?: string;
}

export interface MappingValidation {
  rowErrors: Record<string, MappingRowErrors>;
  formErrors: string[];
  /** 行内错误 + 表单级错误总数。 */
  errorCount: number;
}

let rowSequence = 0;

export function newMappingRow(
  partial: Partial<Omit<MappingRowDraft, "id">> = {},
): MappingRowDraft {
  rowSequence += 1;
  return {
    id: `mapping-row-${rowSequence}`,
    targetField: partial.targetField ?? "",
    sourceField: partial.sourceField ?? "",
    transform: partial.transform ?? "",
    required: partial.required ?? false,
  };
}

export function isCanonicalRequiredField(target: string): boolean {
  return REQUIRED_FIELD_SET.has(target);
}

export function parseTransforms(value: string): string[] {
  return value
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface ParsedExpression {
  source: string;
  transforms: string[];
  constant: boolean;
}

export function parseMappingExpression(expression: string): ParsedExpression {
  // 常量与后端 resolveField 一致：= 之后整段都是值，不按 | 拆转换管道。
  if (expression.startsWith("=")) {
    return { source: expression, transforms: [], constant: true };
  }
  const [sourcePart, ...pipeParts] = expression.split("|");
  return {
    source: sourcePart ?? "",
    transforms: pipeParts.map((part) => part.trim()).filter(Boolean),
    constant: false,
  };
}

function readRequiredColumns(
  config: Record<string, unknown> | undefined,
): string[] {
  const value = config?.requiredColumns;
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 该 mapping 需要预览校验的必填目标列（契约五项 + config.requiredColumns）。 */
export function requiredTargetsForMapping(
  mapping: Pick<IntegrationMapping, "fieldMap" | "config">,
): Set<string> {
  const targets = new Set<string>(CANONICAL_REQUIRED_FIELDS);
  for (const target of readRequiredColumns(mapping.config)) targets.add(target);
  return targets;
}

/** fieldMap → 可编辑行。 */
export function rowsFromMapping(mapping: IntegrationMapping): MappingRowDraft[] {
  const extraRequired = new Set(readRequiredColumns(mapping.config));
  return Object.entries(mapping.fieldMap ?? {}).map(([target, expression]) => {
    const parsed = parseMappingExpression(expression);
    return newMappingRow({
      targetField: target,
      sourceField: parsed.source,
      transform: parsed.transforms.join("|"),
      required: REQUIRED_FIELD_SET.has(target) || extraRequired.has(target),
    });
  });
}

/** 可编辑行 → fieldMap（跳过空目标行；保存前会先做完整校验）。 */
export function fieldMapFromRows(
  rows: MappingRowDraft[],
): Record<string, string> {
  const fieldMap: Record<string, string> = {};
  for (const row of rows) {
    const target = row.targetField.trim();
    if (!target) continue;
    const source = row.sourceField.trim();
    const transforms = parseTransforms(row.transform);
    fieldMap[target] = transforms.length
      ? `${source}|${transforms.join("|")}`
      : source;
  }
  return fieldMap;
}

/** 必填目标列（契约必填列始终计入，即使行上的 checkbox 被改过）。 */
export function requiredColumnsFromRows(rows: MappingRowDraft[]): string[] {
  const targets = new Set<string>();
  for (const row of rows) {
    const target = row.targetField.trim();
    if (!target) continue;
    if (row.required || REQUIRED_FIELD_SET.has(target)) targets.add(target);
  }
  return [...targets].sort();
}

function normalizedRequiredTargets(
  fieldMap: Record<string, string>,
  config: Record<string, unknown> | undefined,
): string[] {
  const extra = new Set(readRequiredColumns(config));
  const targets = Object.keys(fieldMap ?? {}).filter(
    (target) => REQUIRED_FIELD_SET.has(target) || extra.has(target),
  );
  return targets.sort();
}

/** 草稿是否与已保存 mapping 完全一致（用于禁用「保存」与切换提醒）。 */
export function rowsMatchMapping(
  fieldMap: Record<string, string>,
  config: Record<string, unknown> | undefined,
  rows: MappingRowDraft[],
): boolean {
  const next = fieldMapFromRows(rows);
  const previousKeys = Object.keys(fieldMap ?? {}).sort();
  const nextKeys = Object.keys(next).sort();
  if (previousKeys.length !== nextKeys.length) return false;
  for (const key of previousKeys) {
    if (next[key] !== fieldMap[key]) return false;
  }
  const previousRequired = normalizedRequiredTargets(fieldMap, config);
  const nextRequired = requiredColumnsFromRows(rows);
  if (previousRequired.length !== nextRequired.length) return false;
  return previousRequired.every(
    (target, index) => target === nextRequired[index],
  );
}

/** 行草稿校验：目标/来源必填、目标去重、转换名合法、常量不带管道。 */
export function validateRows(rows: MappingRowDraft[]): MappingValidation {
  const rowErrors: Record<string, MappingRowErrors> = {};
  const formErrors: string[] = [];
  const targetCounts = new Map<string, number>();

  for (const row of rows) {
    const target = row.targetField.trim();
    if (!target) continue;
    targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
  }

  for (const row of rows) {
    const errors: MappingRowErrors = {};
    const target = row.targetField.trim();
    const source = row.sourceField.trim();
    const transforms = parseTransforms(row.transform);

    if (!target) {
      errors.target = "目标字段不能为空";
    } else if ((targetCounts.get(target) ?? 0) > 1) {
      errors.target = "目标字段重复";
    }

    if (!source) {
      errors.source = "来源字段不能为空（常量请以 = 开头）";
    } else if (source.startsWith("=") && source.length === 1) {
      errors.source = "常量 = 后需要具体值";
    }

    if (transforms.length > 0) {
      if (source.startsWith("=")) {
        errors.transform = "常量不支持 | 转换管道";
      } else {
        const unknown = transforms.filter(
          (name) => !TRANSFORM_SET.has(name),
        );
        if (unknown.length > 0) {
          errors.transform = `未知转换：${unknown.join("、")}（可用 ${TRANSFORM_NAMES.join(" / ")}）`;
        }
      }
    }

    if (Object.keys(errors).length > 0) rowErrors[row.id] = errors;
  }

  const targets = new Set(
    rows.map((row) => row.targetField.trim()).filter(Boolean),
  );
  const missing = CANONICAL_REQUIRED_FIELDS.filter(
    (field) => !targets.has(field),
  );
  if (missing.length > 0) {
    formErrors.push(
      `缺少契约必填字段：${missing.join("、")}（connector 与重放都依赖这五项）`,
    );
  }
  if (rows.length === 0) {
    formErrors.push("至少需要一条字段映射");
  }

  const rowErrorCount = Object.values(rowErrors).reduce(
    (total, errors) => total + Object.keys(errors).length,
    0,
  );

  return {
    rowErrors,
    formErrors,
    errorCount: rowErrorCount + formErrors.length,
  };
}

/**
 * 配置里是否含服务端脱敏占位符。GET mappings 会把 headers/token 等回显为
 * `[REDACTED]`；把这种 config 原样回写会覆盖真实凭据，因此宁可不保存。
 */
export function configContainsRedacted(value: unknown): boolean {
  if (typeof value === "string") return value.includes("[REDACTED]");
  if (Array.isArray(value)) return value.some(configContainsRedacted);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      configContainsRedacted,
    );
  }
  return false;
}

export type MappingConfigBuild =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * 构造新版本的 config：保留原 config（recordsPath/headers 等），仅更新
 * `requiredColumns` 元数据。若原 config 含脱敏占位符则拒绝保存。
 */
export function buildVersionedMappingConfig(
  mapping: Pick<IntegrationMapping, "config">,
  rows: MappingRowDraft[],
): MappingConfigBuild {
  if (configContainsRedacted(mapping.config)) {
    return {
      ok: false,
      reason:
        "服务端返回的 config 含已脱敏的敏感键（例如 headers / token），前端无法安全回写。" +
        "为避免用 [REDACTED] 覆盖真实凭据，这里不创建新版本；" +
        "请使用「新建映射」手动填写完整 config，或推动后端提供映射更新接口。",
    };
  }
  const config = { ...mapping.config };
  const required = requiredColumnsFromRows(rows);
  if (required.length > 0) {
    config.requiredColumns = required;
  } else {
    delete config.requiredColumns;
  }
  return { ok: true, config };
}

/** 同名 mapping 的下一个版本号（至少大于 minimum）。 */
export function nextMappingVersion(
  mappings: IntegrationMapping[],
  name: string,
  minimum = 0,
): number {
  let highest = minimum;
  for (const mapping of mappings) {
    if (mapping.name === name && mapping.version > highest) {
      highest = mapping.version;
    }
  }
  return highest + 1;
}

/**
 * 与 connector resolveField 相同的解析规则（常量 / 点路径 / 管道转换）。
 * 注意：不含 config.constants 与 config.transforms 覆盖层。
 */
export function resolveFieldValue(
  record: Record<string, unknown>,
  expression: string | undefined,
): string | undefined {
  if (!expression) return undefined;
  if (expression.startsWith("=")) return expression.slice(1);

  const [path, ...pipe] = expression.split("|");
  let value: unknown = record;
  for (const segment of (path ?? "").split(".")) {
    if (value && typeof value === "object") {
      value = (value as Record<string, unknown>)[segment];
    } else {
      value = undefined;
      break;
    }
  }
  if (value === undefined || value === null || value === "") return undefined;

  let result = String(value);
  for (const name of pipe) {
    const transform = TRANSFORMS[name.trim()];
    if (transform) result = transform(result);
  }
  return result;
}

export interface FieldPreview {
  target: string;
  expression: string;
  value: string | undefined;
  required: boolean;
  error?: string;
}

/** 对示例 payload 逐字段解析，并标出必填/转换错误。 */
export function analyzeFieldMap(
  fieldMap: Record<string, string>,
  payload: Record<string, unknown>,
  requiredTargets: ReadonlySet<string>,
): FieldPreview[] {
  const canonicalOrder = new Map(
    CANONICAL_FIELD_ORDER.map((field, index) => [field, index]),
  );
  const requiredSet = new Set<string>([
    ...CANONICAL_REQUIRED_FIELDS,
    ...requiredTargets,
  ]);
  const rows = Object.entries(fieldMap ?? {}).map(([target, expression]) => {
    const required = requiredSet.has(target);
    const parsed = parseMappingExpression(expression ?? "");
    const value = resolveFieldValue(payload, expression);
    const unknown = parsed.transforms.filter(
      (name) => !TRANSFORM_SET.has(name),
    );

    let error: string | undefined;
    if (!(expression ?? "").trim()) {
      error = "映射表达式为空";
    } else if (parsed.constant && parsed.transforms.length > 0) {
      error = "常量不支持 | 转换管道（服务端会忽略转换）";
    } else if (unknown.length > 0) {
      error = `未知转换：${unknown.join("、")}`;
    } else if (required && !value) {
      error = "必填字段未解析出值（路径缺失或值为空）";
    }

    return { target, expression, value, required, error };
  });

  // fieldMap 里完全没有的必填列也要显式标红——否则「缺字段」在预览里看不见。
  const presentTargets = new Set(rows.map((row) => row.target));
  for (const target of requiredSet) {
    if (presentTargets.has(target)) continue;
    rows.push({
      target,
      expression: "",
      value: undefined,
      required: true,
      error: "缺少必填字段（fieldMap 中没有这一列）",
    });
  }

  return rows.sort((left, right) => {
    const leftRank = canonicalOrder.get(left.target) ?? Number.MAX_SAFE_INTEGER;
    const rightRank =
      canonicalOrder.get(right.target) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.target.localeCompare(right.target);
  });
}

function sampleValueFor(segment: string): string | number {
  if (/amount|price|total|gross|net|cost/i.test(segment)) return 1000;
  if (/date|time/i.test(segment)) return "2026-01-15T09:00:00.000Z";
  return "sample";
}

/** 根据 fieldMap 的来源路径生成示例 payload，便于直接预览。 */
export function samplePayloadFor(
  fieldMap: Record<string, string>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const expression of Object.values(fieldMap ?? {})) {
    if (!expression || expression.startsWith("=")) continue;
    const { source } = parseMappingExpression(expression);
    const segments = source.split(".").filter(Boolean);
    if (segments.length === 0) continue;
    let node = root;
    segments.forEach((segment, index) => {
      const isLast = index === segments.length - 1;
      if (isLast) {
        if (!(segment in node)) node[segment] = sampleValueFor(segment);
        return;
      }
      const existing = node[segment];
      if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        node[segment] = {};
      }
      node = node[segment] as Record<string, unknown>;
    });
  }
  return root;
}

/** payload 顶层字段里没有被任何映射表达式引用的键（帮助发现拼写错误）。 */
export function unusedTopLevelFields(
  payload: Record<string, unknown>,
  fieldMap: Record<string, string>,
): string[] {
  const referenced = new Set<string>();
  for (const expression of Object.values(fieldMap ?? {})) {
    if (!expression || expression.startsWith("=")) continue;
    const first = parseMappingExpression(expression).source.split(".")[0];
    if (first) referenced.add(first);
  }
  return Object.keys(payload).filter((key) => !referenced.has(key));
}
