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
      roles?: string[];
    },
  ) {}

  async authenticate(input: AuthInput): Promise<AuthContext> {
    return {
      tenantId: input.tenantId ?? this.defaults.tenantId,
      userId: input.userId ?? this.defaults.userId,
      roles: this.defaults.roles ?? ["employee"],
    };
  }
}
