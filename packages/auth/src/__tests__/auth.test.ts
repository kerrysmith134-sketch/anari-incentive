import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import {
  AuthError,
  DevHeaderAuthenticator,
  OidcJwtAuthenticator,
  signTestToken,
} from "../index.js";

describe("dev authenticator", () => {
  it("uses headers with a default fallback", async () => {
    const auth = new DevHeaderAuthenticator({
      tenantId: "tenant-demo",
      userId: "user-demo",
    });
    await expect(auth.authenticate({})).resolves.toMatchObject({
      tenantId: "tenant-demo",
      userId: "user-demo",
    });
    await expect(
      auth.authenticate({ tenantId: "tenant-2", userId: "user-2" }),
    ).resolves.toMatchObject({ tenantId: "tenant-2", userId: "user-2" });
  });
});

describe("OIDC authenticator", () => {
  it("verifies a signed token and extracts tenant/role claims", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const keyResolver = createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256" }] });
    const auth = new OidcJwtAuthenticator({
      issuer: "https://issuer.example",
      audience: "anari-incentive",
      keyResolver,
    });
    const token = await signTestToken(
      privateKey,
      { sub: "user-1", tenant_id: "tenant-1", roles: ["manager"] },
      { issuer: "https://issuer.example", audience: "anari-incentive" },
    );
    await expect(
      auth.authenticate({ authorization: `Bearer ${token}` }),
    ).resolves.toEqual({
      tenantId: "tenant-1",
      userId: "user-1",
      roles: ["manager"],
    });
  });

  it("rejects missing tokens", async () => {
    const { publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const auth = new OidcJwtAuthenticator({
      issuer: "https://issuer.example",
      audience: "anari-incentive",
      keyResolver: createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256" }] }),
    });
    await expect(auth.authenticate({})).rejects.toBeInstanceOf(AuthError);
  });
});
