import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SessionJwt } from "@anari/auth";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const SECRET = "session-secret-0123456789";
const ADMIN = "00000000-0000-4000-8000-000000000003";

let app: FastifyInstance;
let appStore: Store;
let platformStore: MemoryPlatformStore;

async function call(
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

beforeEach(() => {
  appStore = new Store();
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore, {
    sessionSecret: SECRET,
  });
});

describe("account password login", () => {
  it("signs up with a password and logs in with it", async () => {
    const signup = await call("POST", "/api/v1/public/signup", {
      companyName: "Acme Energy",
      adminDisplayName: "Kerry",
      adminEmail: "kerry@acme.test",
      password: "Sup3r-Secret!",
      acceptTerms: true,
    });
    expect(signup.status).toBe(201);

    const login = await call("POST", "/api/v1/auth/password/login", {
      email: "kerry@acme.test",
      password: "Sup3r-Secret!",
    });
    expect(login.status).toBe(200);
    expect(login.body.data.token).toBeTruthy();
    expect(login.body.data.tenantId).toBe(signup.body.data.tenantId);

    // The issued session token authenticates against the API.
    const jwt = new SessionJwt(SECRET);
    const claims = await jwt.verify(login.body.data.token);
    expect(claims.tenantId).toBe(signup.body.data.tenantId);
    expect(claims.roles).toContain("admin");
  });

  it("admin sets a password and the user logs in", async () => {
    const user = await call("POST", "/api/v1/platform/users", {
      authSubject: "hr@acme.test",
      displayName: "HR Manager",
      email: "hr@acme.test",
    });
    await call("POST", "/api/v1/platform/tenants/tenant-demo/memberships", {
      userId: user.body.data.id,
      roleCodes: ["manager"],
    });
    const setPassword = await call(
      "POST",
      "/api/v1/platform/users/set-password",
      { userId: user.body.data.id, password: "Initial-Passw0rd" },
    );
    expect(setPassword.status).toBe(200);

    const login = await call("POST", "/api/v1/auth/password/login", {
      email: "HR@acme.test", // case-insensitive email match
      password: "Initial-Passw0rd",
    });
    expect(login.status).toBe(200);
  });

  it("never rate-limits successful sign-ins from the same IP", async () => {
    await call("POST", "/api/v1/public/signup", {
      companyName: "Acme",
      adminDisplayName: "K",
      adminEmail: "repeat@acme.test",
      password: "Correct-Horse-1",
      acceptTerms: true,
    });
    // A shared office NAT can produce many legitimate logins in one window;
    // only failed credentials may count towards the limit.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const login = await call("POST", "/api/v1/auth/password/login", {
        email: "repeat@acme.test",
        password: "Correct-Horse-1",
      });
      expect(login.status).toBe(200);
    }
  });

  it("rejects a wrong password with a uniform 401", async () => {
    await call("POST", "/api/v1/public/signup", {
      companyName: "Acme",
      adminDisplayName: "K",
      adminEmail: "k@acme.test",
      password: "Correct-Horse-1",
      acceptTerms: true,
    });
    const wrong = await call("POST", "/api/v1/auth/password/login", {
      email: "k@acme.test",
      password: "wrong-password",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
    const unknown = await call("POST", "/api/v1/auth/password/login", {
      email: "nobody@acme.test",
      password: "whatever-1",
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 501 when session secret is not configured", async () => {
    const plain = buildApp(new Store());
    const response = await plain.inject({
      method: "POST",
      url: "/api/v1/auth/password/login",
      payload: { email: "a@b.test", password: "x" },
    } as never);
    expect(response.statusCode).toBe(501);
  });

  it("refuses login for a user without tenant membership", async () => {
    await call("POST", "/api/v1/platform/users", {
      authSubject: "ghost@acme.test",
      displayName: "Ghost",
      email: "ghost@acme.test",
    });
    await call("POST", "/api/v1/platform/users/set-password", {
      userId: (
        await call("GET", "/api/v1/platform/users")
      ).body.data.find((u: { authSubject: string }) => u.authSubject === "ghost@acme.test")
        .id,
      password: "Lonely-Passw0rd",
    });
    const login = await call("POST", "/api/v1/auth/password/login", {
      email: "ghost@acme.test",
      password: "Lonely-Passw0rd",
    });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("NO_TENANT_MEMBERSHIP");
  });
});
