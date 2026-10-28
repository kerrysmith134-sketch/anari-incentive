import {
  SignJWT,
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";
import { AuthError, type AuthContext, type AuthInput, type Authenticator } from "./types.js";

export interface OidcOptions {
  issuer: string;
  audience: string;
  jwksUrl?: string;
  /** Injectable for tests or local JWKS. */
  keyResolver?: JWTVerifyGetKey;
  tenantClaim?: string;
  personClaim?: string;
}

/**
 * OIDC/JWT authenticator. The token must carry a tenant claim (default
 * `tenant_id`), a subject and optional roles. Tenant isolation still has to be
 * enforced by the store/persistence layer; this class only establishes identity.
 */
export class OidcJwtAuthenticator implements Authenticator {
  private readonly keyResolver: JWTVerifyGetKey;

  constructor(private readonly options: OidcOptions) {
    if (!options.keyResolver && !options.jwksUrl) {
      throw new Error("OidcJwtAuthenticator requires jwksUrl or keyResolver");
    }
    this.keyResolver =
      options.keyResolver ?? createRemoteJWKSet(new URL(options.jwksUrl!));
  }

  async authenticate(input: AuthInput): Promise<AuthContext> {
    if (!input.authorization?.startsWith("Bearer ")) {
      throw new AuthError("UNAUTHENTICATED", "Bearer token required");
    }
    const token = input.authorization.slice("Bearer ".length);
    try {
      const { payload } = await jwtVerify(token, this.keyResolver, {
        issuer: this.options.issuer,
        audience: this.options.audience,
      });
      const tenantId = payload[this.options.tenantClaim ?? "tenant_id"];
      if (typeof tenantId !== "string" || tenantId.length === 0) {
        throw new AuthError("TENANT_CLAIM_MISSING", "token has no tenant claim");
      }
      const rawRoles = payload.roles;
      const roles = Array.isArray(rawRoles)
        ? rawRoles.filter((role): role is string => typeof role === "string")
        : typeof rawRoles === "string"
          ? [rawRoles]
          : [];
      const personId = payload[this.options.personClaim ?? "person_id"];
      return {
        tenantId,
        userId: String(payload.sub ?? ""),
        roles,
        ...(typeof personId === "string" && personId.length > 0
          ? { personId }
          : {}),
      };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError("INVALID_TOKEN", "token verification failed");
    }
  }
}

/** Test helper: sign a token with a local key. */
export async function signTestToken(
  privateKey: KeyLike,
  claims: Record<string, unknown>,
  options: { issuer: string; audience: string },
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setSubject(String(claims.sub ?? "test-user"))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
