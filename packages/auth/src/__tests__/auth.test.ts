import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import {
  AuthError,
  ClientCredentialsTokenProvider,
  DevHeaderAuthenticator,
  OidcJwtAuthenticator,
  StaticTokenProvider,
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
      {
        sub: "user-1",
        tenant_id: "tenant-1",
        person_id: "person-1",
        roles: ["manager"],
      },
      { issuer: "https://issuer.example", audience: "anari-incentive" },
    );
    await expect(
      auth.authenticate({ authorization: `Bearer ${token}` }),
    ).resolves.toEqual({
      tenantId: "tenant-1",
      userId: "user-1",
      roles: ["manager"],
      personId: "person-1",
    });
  });

  it("fetches and caches a client-credentials token", async () => {
    let calls = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls += 1;
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("grant_type=client_credentials");
      return new Response(
        JSON.stringify({ access_token: "service-token", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const provider = new ClientCredentialsTokenProvider({
      tokenUrl: "https://issuer.example/token",
      clientId: "worker",
      clientSecret: "secret",
      fetchImpl,
    });
    expect(await provider.getToken()).toBe("service-token");
    expect(await provider.getToken()).toBe("service-token");
    expect(calls).toBe(1);
    expect(await new StaticTokenProvider("static").getToken()).toBe("static");
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
