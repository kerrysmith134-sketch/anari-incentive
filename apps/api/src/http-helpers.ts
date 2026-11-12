/**
 * 共享 HTTP 适配工具（NPV2-011 第一步）：从 app.ts 抽出的协议层纯函数，
 * 供 app 与各域 route module 复用。不含业务逻辑。
 */
import type { ZodType } from "zod";
import type { FastifyRequest } from "fastify";
import { ForbiddenError } from "@anari/auth";

export type IdParams = { id: string };

export function idOf(request: FastifyRequest): string {
  return (request.params as IdParams).id;
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
