/*
 * Proxy compatibility: nginx deployments that keep HTTP basic auth in front of
 * the API rewrite `Authorization` to `Basic ...`, which used to hide a valid
 * `x-session-token` and turn every console request into a 401.
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import { SessionAuthenticator, SessionJwt } from "@anari/auth";

const SECRET = "secret-0123456789abcdef";
const PERSON = "00000000-0000-4000-8000-000000000001";

function buildStrictApp() {
  return buildApp(
    new Store(),
    undefined,
    new SessionAuthenticator(SECRET),
    new MemoryPlatformStore({
      demoTenant: {
        id: "tenant-demo",
        name: "Demo tenant",
        slug: "demo-tenant",
        persons: [
          { id: PERSON, employeeCode: "E001", displayName: "Sales Lead" },
        ],
      },
    }),
  );
}

async function token(roles: string[] = ["admin"]) {
  const jwt = new SessionJwt(SECRET);
  return jwt.sign({
    tenantId: "tenant-demo",
    userId: "session-user",
    personId: PERSON,
    roles,
  });
}

describe("session token behind a basic-auth proxy", () => {
  it("accepts x-session-token when Authorization was replaced with Basic", async () => {
    const app = buildStrictApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: {
        authorization: `Basic ${Buffer.from("gateway:secret").toString("base64")}`,
        "x-session-token": await token(),
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it("still rejects a request whose only credential is basic auth", async () => {
    const app = buildStrictApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: {
        authorization: `Basic ${Buffer.from("gateway:secret").toString("base64")}`,
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("prefers a genuine Bearer token over x-session-token", async () => {
    const app = buildStrictApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: {
        authorization: `Bearer ${await token(["admin"])}`,
        "x-session-token": "not-a-real-token",
      },
    });
    expect(response.statusCode).toBe(200);
  });
});
