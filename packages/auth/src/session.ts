import { SignJWT, jwtVerify } from "jose";
import { AuthError, type AuthContext, type AuthInput, type Authenticator } from "./types.js";

/**
 * HMAC session tokens for console sign-in flows (e.g. Feishu OAuth).
 *
 * These tokens are issued by this deployment after an interactive login and
 * are separate from external OIDC bearer tokens: the console stores one in
 * sessionStorage and sends it as `authorization: Bearer <token>`.
 */
export interface SessionClaims {
  tenantId: string;
  userId: string;
  personId?: string;
  roles: string[];
  /** Unix seconds. */
  exp: number;
}

const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

export class SessionJwt {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    if (!secret || secret.length < 16) {
      throw new Error(
        "SessionJwt secret must be at least 16 characters (set FEISHU_SESSION_SECRET)",
      );
    }
    this.key = new TextEncoder().encode(secret);
  }

  async sign(
    claims: Omit<SessionClaims, "exp"> & { ttlSeconds?: number },
  ): Promise<string> {
    const ttl = claims.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    return new SignJWT({
      personId: claims.personId,
      roles: claims.roles,
      tenantId: claims.tenantId,
      userId: claims.userId,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(this.key);
  }

  async verify(token: string): Promise<SessionClaims> {
    const { payload } = await jwtVerify(token, this.key, {
      algorithms: ["HS256"],
    });
    const tenantId = payload.tenantId;
    const userId = payload.userId;
    if (typeof tenantId !== "string" || typeof userId !== "string") {
      throw new AuthError("SESSION_CLAIMS_MISSING", "session token lacks tenant/user claims");
    }
    const roles = Array.isArray(payload.roles)
      ? payload.roles.filter((role): role is string => typeof role === "string")
      : [];
    const personId = payload.personId;
    return {
      tenantId,
      userId,
      roles,
      personId: typeof personId === "string" ? personId : undefined,
      exp: payload.exp ?? 0,
    };
  }
}

/** Authenticates requests carrying a locally-issued session JWT. */
export class SessionAuthenticator implements Authenticator {
  private readonly jwt: SessionJwt;

  constructor(secret: string) {
    this.jwt = new SessionJwt(secret);
  }

  async authenticate(input: AuthInput): Promise<AuthContext> {
    if (!input.authorization?.startsWith("Bearer ")) {
      throw new AuthError("UNAUTHENTICATED", "Bearer token required");
    }
    try {
      const claims = await this.jwt.verify(input.authorization.slice("Bearer ".length));
      return {
        tenantId: claims.tenantId,
        userId: claims.userId,
        roles: claims.roles,
        personId: claims.personId,
      };
    } catch {
      throw new AuthError("SESSION_INVALID", "session token is invalid or expired");
    }
  }
}

/**
 * Tries each authenticator in order and returns the first success. Useful to
 * accept both locally-issued session tokens and the primary mode (dev/OIDC):
 * the session authenticator only fires on requests that carry a bearer token.
 */
export class CompositeAuthenticator implements Authenticator {
  constructor(private readonly delegates: Authenticator[]) {}

  async authenticate(input: AuthInput): Promise<AuthContext> {
    let lastError: unknown;
    for (const delegate of this.delegates) {
      try {
        return await delegate.authenticate(input);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new AuthError("UNAUTHENTICATED", "no authenticator accepted the request");
  }
}
