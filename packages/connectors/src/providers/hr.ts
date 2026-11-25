/**
 * Anari HR（本地 FastAPI 服务）连接器。
 *
 * 事实基线（2026-11-25 核对）：
 * - /Users/kerrychu/anari-hr/src/modules/people/api.py
 * - /Users/kerrychu/anari-hr/src/modules/organization/api.py
 * - /Users/kerrychu/anari-hr/src/modules/employment/api.py
 * - .../people/schemas.py、.../organization/schemas.py、.../core/responses.py
 *
 * 端点与响应（ADR-018 信封）：
 * - GET /api/v1/people?limit=&cursor=
 *   → { data: PersonOut[], meta: { request_id, pagination: { limit, next_cursor, has_more } } }
 *   limit ∈ [1, 200]（默认 50）；cursor 是服务端不透明 keyset（created_at|id）。
 * - GET /api/v1/legal-entities
 *   → { data: LegalEntityOut[], meta: { request_id } }，无分页。
 * - GET /api/v1/organization-units?as_of=&legal_entity_id=
 *   → { data: OrgUnitOut[], meta: { request_id } }，无分页。
 * - 鉴权：Authorization: Bearer <ANARI_HR_TOKEN>；base URL 来自
 *   ANARI_HR_BASE_URL（settings 前缀 ANARI_HR_，见 anari-hr core/config.py）。
 *
 * 为什么三个 target 目前都是只读（normalize 一律返回 []）：
 * - N-Perform（本仓库）没有 /api/v1/people，也没有任何人员导入/upsert 路由。
 *   唯一的写入口是 POST /api/v1/platform/tenants/:id/persons，但它是 create-only：
 *   employeeCode 重复返回 409、需要 tenant admin、tenantId 在路径里，且没有更新语义，
 *   不能当作幂等同步目标（apps/api/src/modules/platform/platform-admin.routes.ts）。
 * - anari-hr 的 PersonCreate 只接受 display_name（唯一必填）、legal_name、
 *   preferred_name、primary_work_email、source_system、source_record_id；
 *   没有 employeeNo/status 字段，person_status 只能通过 PATCH + If-Match 修改。
 *   该路由属于源系统本身，把源记录再写回源系统不是本连接器的目标，也不应冒充
 *   N-Perform 写入。anari-hr 的 /people/{id}/external-identities 写的是 anari-hr
 *   自己的身份映射表，不是 N-Perform 的外部身份，不能拿来替代。
 * - LegalEntity / OrgUnit 在 N-Perform 同样没有写端点；anari-hr 的 create schema
 *   也不接收 source_system/source_record_id（OrgUnit 模型有列但 schema 未暴露），
 *   所以无法在不丢来源追溯信息的前提下安全回写。
 *
 * 因此 extract 只做严格读取与校验（UUID、日期/时间），供身份映射、数据质量校验
 * 和后续人工/批量导入使用；normalize 返回 []，绝不伪造 CanonicalWrite。等
 * N-Perform 提供带外部键与幂等语义的人员 upsert 路由后，再在这里实现真正写入。
 */
import type { CanonicalWrite, LocalProvider } from "./types.js";

/** N-Perform 里这批目录数据的来源标识。 */
export const HR_SOURCE_SYSTEM = "ANARI_HR";

export const HR_PEOPLE_PATH = "/api/v1/people";
export const HR_PEOPLE_IMPORT_PATH = "/api/v1/people/import";
export const HR_LEGAL_ENTITIES_PATH = "/api/v1/legal-entities";
export const HR_ORGANIZATION_UNITS_PATH = "/api/v1/organization-units";

export interface HrPerson {
  id: string;
  display_name: string;
  preferred_name: string | null;
  primary_work_email: string | null;
  person_status: string;
  data_quality_status: string;
  source_system: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  legal_name: string | null;
}

export interface HrLegalEntity {
  id: string;
  entity_code: string;
  legal_name: string;
  country_code: string;
  jurisdiction_code: string | null;
  currency_code: string;
  status: string;
  version: number;
}

export interface HrOrganizationUnit {
  id: string;
  org_key: string;
  version_no: number;
  supersedes_id: string | null;
  legal_entity_id: string;
  parent_org_key: string | null;
  unit_name: string;
  unit_type: string;
  unit_code: string | null;
  effective_from: string;
  effective_to: string | null;
  version: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** 严格日历日期（YYYY-MM-DD）；拒绝 2026-02-30 这类越界值。 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * anari-hr 的 datetime 由 Pydantic 序列化为 ISO 8601；SQLite 下可能带时区也可能
 * 是不带时区的 naive 值（`2026-11-20T09:45:12`），所以两种都接受。
 */
export function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return false;
  const datePart = match[1];
  if (datePart === undefined || !isIsoDate(datePart)) return false;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  if (hours > 23 || minutes > 59 || seconds > 59) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (offset) {
    if (Number(offset[2]) > 23 || Number(offset[3]) > 59) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** undefined = 字段类型非法；null/缺省 = 无值；空串归一为 null。 */
function textOrNull(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() ? value : null;
}

function uuidOrNull(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return isUuid(value) ? value : undefined;
}

function dateOrNull(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return isIsoDate(value) ? value : undefined;
}

/**
 * 信封 { data: [...] }。ADR-018 的成功响应一定带 data 数组；不是该形状时抛错，
 * 不返回空数组——静默空页会让调用方误以为源端没有数据并推进 checkpoint。
 */
function unwrapData(json: unknown): unknown[] {
  if (!isRecord(json)) {
    throw new Error("anari-hr: response is not a JSON object");
  }
  if (!Array.isArray(json.data)) {
    throw new Error("anari-hr: response is missing a data array");
  }
  return json.data;
}

/** PersonOut → 严格校验后的记录；缺 / 坏必填字段返回 null（由 extract 跳过）。 */
export function parseHrPerson(value: unknown): HrPerson | null {
  if (!isRecord(value)) return null;
  const { id, display_name, person_status, data_quality_status, version, created_at, updated_at } =
    value;
  if (
    !isUuid(id) ||
    !nonEmptyString(display_name) ||
    !nonEmptyString(person_status) ||
    !nonEmptyString(data_quality_status) ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    !isIsoDateTime(created_at) ||
    !isIsoDateTime(updated_at)
  ) {
    return null;
  }
  const preferredName = textOrNull(value.preferred_name);
  const primaryWorkEmail = textOrNull(value.primary_work_email);
  const sourceSystem = textOrNull(value.source_system);
  const legalName = textOrNull(value.legal_name);
  if (
    preferredName === undefined ||
    primaryWorkEmail === undefined ||
    sourceSystem === undefined ||
    legalName === undefined
  ) {
    return null;
  }
  return {
    id,
    display_name,
    preferred_name: preferredName,
    primary_work_email: primaryWorkEmail,
    person_status,
    data_quality_status,
    source_system: sourceSystem,
    version,
    created_at,
    updated_at,
    legal_name: legalName,
  };
}

export function parseHrLegalEntity(value: unknown): HrLegalEntity | null {
  if (!isRecord(value)) return null;
  const { id, entity_code, legal_name, country_code, currency_code, status, version } = value;
  if (
    !isUuid(id) ||
    !nonEmptyString(entity_code) ||
    !nonEmptyString(legal_name) ||
    !nonEmptyString(country_code) ||
    !nonEmptyString(currency_code) ||
    !nonEmptyString(status) ||
    typeof version !== "number" ||
    !Number.isInteger(version)
  ) {
    return null;
  }
  const jurisdictionCode = textOrNull(value.jurisdiction_code);
  if (jurisdictionCode === undefined) return null;
  return {
    id,
    entity_code,
    legal_name,
    country_code,
    jurisdiction_code: jurisdictionCode,
    currency_code,
    status,
    version,
  };
}

export function parseHrOrganizationUnit(value: unknown): HrOrganizationUnit | null {
  if (!isRecord(value)) return null;
  const { id, org_key, legal_entity_id, unit_name, unit_type, version, version_no } = value;
  if (
    !isUuid(id) ||
    !isUuid(org_key) ||
    !isUuid(legal_entity_id) ||
    !nonEmptyString(unit_name) ||
    !nonEmptyString(unit_type) ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    typeof version_no !== "number" ||
    !Number.isInteger(version_no) ||
    !isIsoDate(value.effective_from)
  ) {
    return null;
  }
  const supersedesId = uuidOrNull(value.supersedes_id);
  const parentOrgKey = uuidOrNull(value.parent_org_key);
  const unitCode = textOrNull(value.unit_code);
  const effectiveTo = dateOrNull(value.effective_to);
  if (
    supersedesId === undefined ||
    parentOrgKey === undefined ||
    unitCode === undefined ||
    effectiveTo === undefined
  ) {
    return null;
  }
  return {
    id,
    org_key,
    version_no,
    supersedes_id: supersedesId,
    legal_entity_id,
    parent_org_key: parentOrgKey,
    unit_name,
    unit_type,
    unit_code: unitCode,
    effective_from: value.effective_from,
    effective_to: effectiveTo,
    version,
  };
}

export function extractHrPeople(json: unknown): HrPerson[] {
  return unwrapData(json)
    .map(parseHrPerson)
    .filter((person): person is HrPerson => person !== null);
}

export function extractHrLegalEntities(json: unknown): HrLegalEntity[] {
  return unwrapData(json)
    .map(parseHrLegalEntity)
    .filter((entity): entity is HrLegalEntity => entity !== null);
}

export function extractHrOrganizationUnits(json: unknown): HrOrganizationUnit[] {
  return unwrapData(json)
    .map(parseHrOrganizationUnit)
    .filter((unit): unit is HrOrganizationUnit => unit !== null);
}

/** GET /api/v1/people 的 meta.pagination.next_cursor；无更多页时返回 null。 */
export function extractHrNextCursor(json: unknown): string | null {
  if (!isRecord(json)) return null;
  const meta = json.meta;
  if (!isRecord(meta)) return null;
  const pagination = meta.pagination;
  if (!isRecord(pagination)) return null;
  const cursor = pagination.next_cursor;
  return typeof cursor === "string" && cursor.trim() ? cursor.trim() : null;
}

export function normalizeHrPerson(record: unknown): CanonicalWrite[] {
  if (!record || typeof record !== "object") return [];
  const person = record as Partial<HrPerson>;
  if (!isUuid(person.id) || typeof person.display_name !== "string" || !person.display_name.trim()) {
    return [];
  }
  const status =
    typeof person.person_status === "string" && person.person_status.trim()
      ? person.person_status.trim().toUpperCase()
      : undefined;
  return [
    {
      path: HR_PEOPLE_IMPORT_PATH,
      externalId: person.id,
      body: {
        sourceSystem: HR_SOURCE_SYSTEM,
        externalId: person.id,
        employeeCode: `HR-${person.id}`,
        displayName: person.display_name.trim(),
        ...(status ? { employmentStatus: status } : {}),
      },
    },
  ];
}

export const hrProvider: LocalProvider = {
  code: "anari-hr",
  sourceSystem: HR_SOURCE_SYSTEM,
  baseUrlEnv: "ANARI_HR_BASE_URL",
  tokenEnv: "ANARI_HR_TOKEN",
  targets: [
    {
      method: "GET",
      path: HR_PEOPLE_PATH,
      // 游标分页：limit ∈ [1,200]，默认 50；cursor 由 meta.pagination.next_cursor 下发。
      cursorParam: "cursor",
      limitParam: "limit",
      pageSize: 50,
      extract: extractHrPeople,
      normalize: normalizeHrPerson,
    },
    {
      method: "GET",
      path: HR_LEGAL_ENTITIES_PATH,
      extract: extractHrLegalEntities,
      // 只读：仅用于法人映射/校验，N-Perform 无对应写端点。
      normalize: () => [],
    },
    {
      method: "GET",
      path: HR_ORGANIZATION_UNITS_PATH,
      extract: extractHrOrganizationUnits,
      // 只读：仅用于组织映射/校验，N-Perform 无对应写端点。
      normalize: () => [],
    },
  ],
};
