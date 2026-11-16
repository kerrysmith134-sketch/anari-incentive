import type { AuthContext, AuthInput, Authenticator } from "./types.js";

/**
 * Development/header authenticator. Never use in production: it trusts the
 * caller-supplied tenant and user headers. It exists so local demos and tests
 * work without an identity provider.
 */
export class DevHeaderAuthenticator implements Authenticator {
  constructor(
    private readonly defaults: {
      tenantId: string;
      userId: string;
      personId?: string;
      roles?: string[];
    },
  ) {}

  async authenticate(input: AuthInput): Promise<AuthContext> {
    const personId = input.personId ?? this.defaults.personId;
    return {
      tenantId: input.tenantId ?? this.defaults.tenantId,
      userId: input.userId ?? this.defaults.userId,
      roles: this.defaults.roles ?? ["employee"],
      personId,
      // 开发/集成头：无 person 声明视为服务主体（worker/连接器）。
      servicePrincipal: personId ? undefined : true,
    };
  }
}
