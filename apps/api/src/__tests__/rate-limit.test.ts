import { afterEach, describe, expect, it } from "vitest";
import type { Authenticator } from "@anari/auth";
import { buildApp } from "../app.js";
import { Store } from "../store.js";

const authenticator: Authenticator = {
  async authenticate(input) {
    return {
      tenantId: input.tenantId ?? "tenant-a",
      userId: "rate-limit-user",
      roles: ["admin"],
    };
  },
};

let app: ReturnType<typeof buildApp> | undefined;

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("rate limiting", () => {
  it("rejects requests over the per-actor limit and resets after the window", async () => {
    let now = 1_000_000;
    app = buildApp(new Store(), undefined, authenticator, undefined, {
      rateLimit: { limit: 2, windowMs: 1_000, now: () => now },
    });
    const request = () =>
      app!.inject({
        method: "GET",
        url: "/api/v1/work-packages",
        headers: { "x-tenant-id": "tenant-a" },
      } as never);

    const first = await request();
    expect(first.statusCode).toBe(200);
    expect(first.headers["x-ratelimit-limit"]).toBe("2");
    expect(first.headers["x-ratelimit-remaining"]).toBe("1");
    const second = await request();
    expect(second.statusCode).toBe(200);
    expect(second.headers["x-ratelimit-remaining"]).toBe("0");

    const limited = await request();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("1");
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    const metrics = await app.inject({
      method: "GET",
      url: "/metrics",
    } as never);
    expect(metrics.body).toContain('event="rate_limited"');

    now += 1_000;
    expect((await request()).statusCode).toBe(200);
  });

  it("keeps limits per tenant and leaves health checks unlimited", async () => {
    app = buildApp(new Store(), undefined, authenticator, undefined, {
      rateLimit: { limit: 1, windowMs: 60_000 },
    });
    const request = (tenantId: string) =>
      app!.inject({
        method: "GET",
        url: "/api/v1/work-packages",
        headers: { "x-tenant-id": tenantId },
      } as never);

    expect((await request("tenant-a")).statusCode).toBe(200);
    expect((await request("tenant-a")).statusCode).toBe(429);
    expect((await request("tenant-b")).statusCode).toBe(200);

    const health = await app.inject({
      method: "GET",
      url: "/health",
    } as never);
    expect(health.statusCode).toBe(200);
  });
});
