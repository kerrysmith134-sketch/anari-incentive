export interface AuthContext {
  tenantId: string;
  userId: string;
  roles: string[];
}

export interface AuthInput {
  authorization?: string;
  tenantId?: string;
  userId?: string;
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
