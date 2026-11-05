import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SessionJwt } from "@anari/auth";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "tenant-demo";
const OWNER = "00000000-0000-4000-8000-000000000001";

const SESSION_SECRET = "test-session-secret-0123456789";

let appStore: Store;
let platformStore: MemoryPlatformStore;

function build(feishuFetch?: typeof fetch): FastifyInstance {
  return buildApp(
    appStore,
    undefined,
    undefined,
    platformStore,
    feishuFetch
      ? {
          feishu: {
            appId: "cli_test",
            appSecret: "secret_test",
            sessionSecret: SESSION_SECRET,
            tenantId: TENANT,
            consoleBaseUrl: "http://console.test",
            fetchImpl: feishuFetch,
          },
        }
      : {},
  );
}

/** Fake fetch covering the OAuth callback + directory endpoints. */
function feishuApiFixture(options?: {
  tokenCode?: number;
  userInfoCode?: number;
  departments?: Array<{
    open_department_id: string;
    name: string;
    parent_department_id: string;
    leader_user_id?: string;
  }>;
  usersByDepartment?: Record<
    string,
    Array<{
      open_id: string;
      name: string;
      email?: string;
      employee_no?: string;
      job_title?: string;
      department_ids?: string[];
      leader_user_id?: string;
    }>
  >;
}): typeof fetch {
  return (async (url: URL | string, init?: RequestInit) => {
    const target = String(url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (target.includes("/authen/v2/oauth/token")) {
      return new Response(
        JSON.stringify({
          code: options?.tokenCode ?? 0,
          msg: options?.tokenCode ? "bad code" : "",
          data: { access_token: options?.tokenCode ? undefined : "u-token" },
        }),
        { status: 200 },
      );
    }
    if (target.includes("/authen/v1/user_info")) {
      return new Response(
        JSON.stringify({
          code: options?.userInfoCode ?? 0,
          msg: options?.userInfoCode ? "no scope" : "",
          data: options?.userInfoCode
            ? undefined
            : {
                open_id: "ou-user-1",
                union_id: "un-user-1",
                name: "Feishu Person",
                email: "person@anari.test",
              },
        }),
        { status: 200 },
      );
    }
    if (target.includes("/auth/v3/tenant_access_token")) {
      return new Response(
        JSON.stringify({ code: 0, tenant_access_token: "t-token", expire: 7200 }),
        { status: 200 },
      );
    }
    if (target.includes("/contact/v3/departments/find_by_page")) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: { items: options?.departments ?? [], has_more: false },
        }),
        { status: 200 },
      );
    }
    if (target.includes("/contact/v3/users/find_by_page")) {
      const departmentId = new URL(target).searchParams.get("department_id") ?? "";
      const items =
        (body.department_id as string) === departmentId
          ? options?.usersByDepartment?.[departmentId] ?? []
          : options?.usersByDepartment?.[departmentId] ?? [];
      return new Response(
        JSON.stringify({ code: 0, data: { items, has_more: false } }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ code: -1, msg: "unexpected" }), {
      status: 404,
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  appStore = new Store();
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [{ id: OWNER, employeeCode: "E001", displayName: "Sales Lead" }],
    },
  });
});

describe("session jwt", () => {
  it("round-trips claims and rejects tampering", async () => {
    const jwt = new SessionJwt(SESSION_SECRET);
    const token = await jwt.sign({
      tenantId: TENANT,
      userId: "u1",
      personId: OWNER,
      roles: ["employee"],
    });
    const claims = await jwt.verify(token);
    expect(claims.tenantId).toBe(TENANT);
    expect(claims.roles).toEqual(["employee"]);
    await expect(
      new SessionJwt("another-secret-0123456789").verify(token),
    ).rejects.toThrow();
  });

  it("rejects short secrets", () => {
    expect(() => new SessionJwt("short")).toThrow(/FEISHU_SESSION_SECRET/);
  });
});

describe("feishu oauth login", () => {
  it("redirects to feishu when configured and explains when not", async () => {
    const unconfigured = build();
    const refused = await unconfigured.inject({
      method: "GET",
      url: "/api/v1/auth/feishu/authorize",
    });
    expect(refused.statusCode).toBe(501);
    expect(refused.json().error.code).toBe("FEISHU_NOT_CONFIGURED");

    const configured = build(feishuApiFixture());
    const start = await configured.inject({
      method: "GET",
      url: "/api/v1/auth/feishu/authorize",
    });
    expect(start.statusCode).toBe(302);
    const location = new URL(start.headers.location as string);
    expect(location.origin).toBe("https://open.feishu.cn");
    expect(location.searchParams.get("client_id")).toBe("cli_test");
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();
  });

  it("completes the callback, provisions a basic identity and issues a session", async () => {
    const configured = build(feishuApiFixture());
    const start = await configured.inject({
      method: "GET",
      url: "/api/v1/auth/feishu/authorize",
    });
    const state = new URL(start.headers.location as string).searchParams.get("state");

    const callback = await configured.inject({
      method: "GET",
      url: `/api/v1/auth/feishu/callback?code=abc&state=${state}`,
    });
    expect(callback.statusCode).toBe(302);
    const redirect = new URL(callback.headers.location as string);
    expect(redirect.origin).toBe("http://console.test");
    const hash = redirect.hash.slice(1);
    const params = new URLSearchParams(hash);
    const token = params.get("feishu-token");
    expect(token).toBeTruthy();

    const claims = await new SessionJwt(SESSION_SECRET).verify(token!);
    expect(claims.tenantId).toBe(TENANT);
    expect(claims.roles).toEqual(["employee"]);
    expect(claims.personId).toBeTruthy();

    const users = await platformStore.listUsers();
    expect(
      users.some((user) => user.authSubject === "feishu:ou-user-1"),
    ).toBe(true);
  });

  it("rejects replayed or unknown state with a human-readable redirect", async () => {
    const configured = build(feishuApiFixture());
    const callback = await configured.inject({
      method: "GET",
      url: "/api/v1/auth/feishu/callback?code=abc&state=forged",
    });
    expect(callback.statusCode).toBe(302);
    const redirect = new URL(callback.headers.location as string);
    expect(redirect.searchParams.get("error")).toContain("invalid or expired");
  });

  it("surfaces token exchange failures instead of failing silently", async () => {
    const configured = build(feishuApiFixture({ tokenCode: 20029 }));
    const start = await configured.inject({
      method: "GET",
      url: "/api/v1/auth/feishu/authorize",
    });
    const state = new URL(start.headers.location as string).searchParams.get("state");
    const callback = await configured.inject({
      method: "GET",
      url: `/api/v1/auth/feishu/callback?code=abc&state=${state}`,
    });
    const redirect = new URL(callback.headers.location as string);
    expect(redirect.searchParams.get("error")).toContain("20029");
  });
});

describe("feishu directory sync", () => {
  const departments = [
    { open_department_id: "od-root", name: "Anari", parent_department_id: "" },
    {
      open_department_id: "od-sales",
      name: "Sales",
      parent_department_id: "od-root",
    },
  ];
  const users: Record<
    string,
    Array<{
      open_id: string;
      name: string;
      email?: string;
      employee_no?: string;
      job_title?: string;
      department_ids?: string[];
      leader_user_id?: string;
    }>
  > = {
    "od-sales": [
      {
        open_id: "ou-leader",
        name: "Sales Lead Feishu",
        employee_no: "FS-1001",
        job_title: "销售总监",
        department_ids: ["od-sales"],
      },
      {
        open_id: "ou-member",
        name: "Sales Member",
        department_ids: ["od-sales"],
        leader_user_id: "ou-leader",
      },
    ],
  };

  function syncApp(): FastifyInstance {
    return build(feishuApiFixture({ departments, usersByDepartment: users }));
  }

  it("previews without writing when dryRun", async () => {
    const app = syncApp();
    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/platform/feishu/sync-directory",
      payload: { dryRun: true, allowCreate: true },
    } as never);
    expect(preview.statusCode).toBe(200);
    const result = preview.json().data;
    expect(result.departments).toHaveLength(2);
    expect(result.departments.every((d: { action: string }) => d.action === "CREATE")).toBe(true);
    expect(result.users.map((u: { action: string }) => u.action)).toEqual([
      "PROVISION",
      "PROVISION",
    ]);
    expect(await platformStore.listOrgNodes(TENANT)).toHaveLength(0);
  });

  it("applies org nodes, people, assignments and reporting lines", async () => {
    const app = syncApp();
    const applied = await app.inject({
      method: "POST",
      url: "/api/v1/platform/feishu/sync-directory",
      payload: { dryRun: false, allowCreate: true },
    } as never);
    expect(applied.statusCode).toBe(200);
    const result = applied.json().data;
    expect(result.managersLinked).toBe(1);
    expect(result.orgAssignmentsCreated).toBe(2);

    const nodes = await platformStore.listOrgNodes(TENANT);
    expect(nodes).toHaveLength(2);
    const sales = nodes.find((node) => node.externalId === "od-sales");
    expect(sales?.name).toBe("Sales");

    const persons = await platformStore.listPersons(TENANT);
    expect(persons).toHaveLength(3); // original + two synced
    const member = persons.find((p) => p.displayName === "Sales Member");
    expect(member?.managerPersonId).toBeTruthy();

    const assignments = await platformStore.listOrgAssignments(TENANT);
    expect(assignments).toHaveLength(2);

    // Re-running is idempotent.
    const again = await app.inject({
      method: "POST",
      url: "/api/v1/platform/feishu/sync-directory",
      payload: { dryRun: false, allowCreate: true },
    } as never);
    const rerun = again.json().data;
    expect(rerun.departments.every((d: { action: string }) => d.action === "EXISTS")).toBe(true);
    expect(rerun.orgAssignmentsCreated).toBe(0);
    expect(await platformStore.listPersons(TENANT)).toHaveLength(3);
  });

  it("respects allowCreate=false and never provisions without it", async () => {
    const app = syncApp();
    const applied = await app.inject({
      method: "POST",
      url: "/api/v1/platform/feishu/sync-directory",
      payload: { dryRun: false, allowCreate: false },
    } as never);
    const result = applied.json().data;
    expect(result.users.every((u: { action: string }) => u.action === "SKIPPED_NO_PROVISIONING")).toBe(true);
    // Departments still sync — only people provisioning is gated.
    expect(await platformStore.listOrgNodes(TENANT)).toHaveLength(2);
    expect(await platformStore.listPersons(TENANT)).toHaveLength(1);
  });

  it("returns 501 when feishu is not configured", async () => {
    const app = build();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/platform/feishu/sync-directory",
      payload: { dryRun: true },
    } as never);
    expect(response.statusCode).toBe(501);
  });
});
