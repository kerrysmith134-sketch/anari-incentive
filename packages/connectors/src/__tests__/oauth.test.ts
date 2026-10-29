import { describe, expect, it } from "vitest";
import {
  ClientCredentialsTokenSource,
  OAuthTokenError,
  RefreshTokenSource,
} from "../index.js";

describe("client credentials token source", () => {
  it("caches tokens and refreshes before expiry", async () => {
    const calls: RequestInit[] = [];
    let now = 1_000_000;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(
        JSON.stringify({
          access_token: `token-${calls.length}`,
          token_type: "Bearer",
          expires_in: 60,
          scope: "read",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const source = new ClientCredentialsTokenSource({
      tokenUrl: "https://auth.example/token",
      clientId: "client-id",
      clientSecret: "client-secret",
      scope: "read",
      fetchImpl,
      now: () => now,
    });

    expect(await source.getToken()).toBe("token-1");
    expect(await source.getToken()).toBe("token-1");
    expect(calls).toHaveLength(1);
    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    );
    expect(String(calls[0]!.body)).toContain("grant_type=client_credentials");
    expect(String(calls[0]!.body)).toContain("scope=read");

    now += 40_000;
    expect(await source.getToken()).toBe("token-2");
    expect(calls).toHaveLength(2);
  });

  it("surfaces token endpoint failures", async () => {
    const fetchImpl = (async () =>
      new Response("unauthorized", { status: 401 })) as typeof fetch;
    const source = new ClientCredentialsTokenSource({
      tokenUrl: "https://auth.example/token",
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl,
    });
    await expect(source.getToken()).rejects.toMatchObject({
      code: "OAUTH_TOKEN_ERROR",
      status: 401,
    });
    await expect(source.getToken()).rejects.toBeInstanceOf(OAuthTokenError);
  });

  it("rejects responses without an access token", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { status: 200 })) as typeof fetch;
    const source = new ClientCredentialsTokenSource({
      tokenUrl: "https://auth.example/token",
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl,
    });
    await expect(source.getToken()).rejects.toMatchObject({
      code: "OAUTH_TOKEN_ERROR",
    });
  });

  it("rotates refresh tokens and reuses the rotated value", async () => {
    const bodies: string[] = [];
    let calls = 0;
    let now = 1_000_000;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          access_token: `token-${calls}`,
          refresh_token: `refresh-${calls + 1}`,
          expires_in: 60,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const source = new RefreshTokenSource({
      tokenUrl: "https://auth.example/token",
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-1",
      fetchImpl,
      now: () => now,
    });

    expect(await source.getToken()).toBe("token-1");
    expect(bodies[0]).toContain("grant_type=refresh_token");
    expect(bodies[0]).toContain("refresh_token=refresh-1");
    now += 40_000;
    expect(await source.getToken()).toBe("token-2");
    expect(bodies[1]).toContain("refresh_token=refresh-2");
  });
});
