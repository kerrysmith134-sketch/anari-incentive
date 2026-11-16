export interface AuthContext {
  tenantId: string;
  userId: string;
  roles: string[];
  /** Employee identity used for object-level filtering. */
  personId?: string;
  /**
   * 服务主体（机器身份，如 agent worker）：无 person 声明但允许在审计中
   * 以"代办"方式记录 body actor。普通用户令牌缺失 person 必须 fail-closed。
   */
  servicePrincipal?: boolean;
}

export interface AuthInput {
  authorization?: string;
  tenantId?: string;
  userId?: string;
  personId?: string;
}

export interface Authenticator {
  authenticate(input: AuthInput): Promise<AuthContext>;
}

export class AuthError extends Error {
  readonly status = 401;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";
  constructor(message = "insufficient role") {
    super(message);
    this.name = "ForbiddenError";
  }
}
