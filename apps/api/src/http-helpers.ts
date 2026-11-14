/**
 * 共享 HTTP 适配工具（NPV2-011 第一步）：从 app.ts 抽出的协议层纯函数，
 * 供 app 与各域 route module 复用。不含业务逻辑。
 */
import type { ZodType } from "zod";
import type { FastifyRequest } from "fastify";
import { ForbiddenError } from "@anari/auth";

/** 与 app.ts 中的 BadRequestError 同语义（协议层 400）。 */
class BadRequestError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type IdParams = { id: string };

export function idOf(request: FastifyRequest): string {
  return (request.params as IdParams).id;
}

export function paramOf(
  request: FastifyRequest,
  name: string,
): string {
  return (request.params as Record<string, string>)[name] ?? "";
}

export function data(data: unknown, request: FastifyRequest) {
  return { data, meta: { correlation_id: request.id } };
}

export function errorBody(
  code: string,
  message: string,
  details?: unknown,
) {
  return { error: { code, message, details }, meta: {} };
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export function tenantOf(request: FastifyRequest): string {
  return request.authContext?.tenantId ?? "tenant-demo";
}

export function requireRoles(
  request: FastifyRequest,
  ...allowed: string[]
): void {
  const roles = request.authContext?.roles ?? [];
  if (roles.includes("admin") || roles.some((role) => allowed.includes(role))) {
    return;
  }
  throw new ForbiddenError(
    `requires one of: ${allowed.join(", ")} (or admin)`,
  );
}

export function isPrivileged(request: FastifyRequest): boolean {
  const roles = request.authContext?.roles ?? [];
  return roles.some((role) =>
    ["admin", "manager", "finance"].includes(role),
  );
}

export function ownPersonId(request: FastifyRequest): string | undefined {
  return request.authContext?.personId;
}

export function isPlatformAdmin(request: FastifyRequest): boolean {
  return (request.authContext?.roles ?? []).includes("platform_admin");
}

export function requirePlatformAdmin(request: FastifyRequest): void {
  if (!isPlatformAdmin(request)) {
    throw new ForbiddenError("requires platform_admin");
  }
}

/** Platform operators, or the admin of the tenant being addressed. */
export function requireTenantAdmin(
  request: FastifyRequest,
  tenantId: string,
): void {
  if (isPlatformAdmin(request)) return;
  const roles = request.authContext?.roles ?? [];
  if (roles.includes("admin") && tenantId === tenantOf(request)) return;
  throw new ForbiddenError(
    "requires platform_admin or the admin of this tenant",
  );
}

export function personFilter(request: FastifyRequest): string | undefined {
  if (isPrivileged(request)) return undefined;
  const person = ownPersonId(request);
  if (!person) {
    throw new ForbiddenError(
      "employee identity is required (person_id claim or X-Person-Id)",
    );
  }
  return person;
}

export function policyBody(request: FastifyRequest): Record<string, unknown> {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("INVALID_BODY", "请求体必须为 JSON 对象");
  }
  return body as Record<string, unknown>;
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestError(
      "INVALID_INPUT",
      `字段 ${field} 必须为非空字符串`,
    );
  }
  return value;
}

export function runPolicyInput<T>(calculation: () => T): T {
  try {
    return calculation();
  } catch (error) {
    throw new BadRequestError(
      "POLICY_INPUT_INVALID",
      error instanceof Error ? error.message : "制度计算输入无效",
    );
  }
}

export function normalizeHeaderKey(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

export function columnIndexFor(header: string[], aliases: string[]): number {
  const normalized = header.map(normalizeHeaderKey);
  return normalized.findIndex((cell) => aliases.includes(cell));
}

/**
 * 平台管理员或本租户成员可读目录；跨租户一律拒绝。
 */
export function requireTenantMember(
  request: FastifyRequest,
  tenantId: string,
): void {
  if (isPlatformAdmin(request)) return;
  if (tenantId !== tenantOf(request)) {
    throw new ForbiddenError("cannot read another tenant's directory");
  }
}

/**
 * NPV2-003：执行者身份统一收口——body 声称的 actor 必须等于会话身份
 * （平台管理员可代操作）。返回校验后的 id，供审计与持久化使用。
 */
/** NPV2-003：必填执行者字段——未提供或伪造一律拒绝。 */
export function requireActorRequired(
  request: FastifyRequest,
  claimed: unknown,
  action: string,
): string {
  const resolved = requireActor(request, claimed, action);
  if (resolved === undefined) {
    throw new ForbiddenError(`${action}: actor is required`);
  }
  return resolved;
}

export function requireActor(
  request: FastifyRequest,
  claimed: unknown,
  action: string,
): string | undefined {
  // 未提供：字段本身可选（zod 必填已先行拦截），放行。
  if (claimed === undefined || claimed === null || claimed === "") {
    return undefined;
  }
  if (typeof claimed !== "string") {
    throw new ForbiddenError(`${action}: actor must be a string`);
  }
  const own = ownPersonId(request);
  if (own) {
    // 会话声明了 person：body actor 必须是会话身份（平台管理员可代操作）。
    if (own === claimed) return claimed;
    if (!isPlatformAdmin(request)) {
      throw new ForbiddenError(
        `${action}: must use the authenticated identity (got ${claimed})`,
      );
    }
    return claimed;
  }
  // 无 person 声明的会话（机器/admin token）：角色鉴权已把关，放行。
  return claimed;
}
