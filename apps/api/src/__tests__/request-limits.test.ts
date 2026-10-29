import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { Store } from "../store.js";

describe("request body limits", () => {
  it("rejects oversized bodies with a PAYLOAD_TOO_LARGE envelope", async () => {
    const app = buildApp(new Store(), undefined, undefined, undefined, {
      bodyLimitBytes: 128,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/work-packages",
      payload: { title: "x".repeat(512) },
    } as never);
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("PAYLOAD_TOO_LARGE");
    await app.close();
  });
});
