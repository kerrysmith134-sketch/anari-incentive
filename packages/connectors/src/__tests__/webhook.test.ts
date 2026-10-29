import { describe, expect, it } from "vitest";
import {
  WebhookSignatureError,
  assertWebhookSignature,
  computeWebhookSignature,
  verifyWebhookSignature,
} from "../index.js";

describe("webhook signatures", () => {
  it("verifies sha256 and sha1 signatures and rejects tampering", () => {
    const payload = '{"messageId":"m-1"}';
    const sha256 = computeWebhookSignature({ secret: "secret", payload });
    expect(sha256.startsWith("sha256=")).toBe(true);
    expect(
      verifyWebhookSignature({
        secret: "secret",
        payload,
        signature: sha256,
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        secret: "secret",
        payload: `${payload} `,
        signature: sha256,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret: "wrong",
        payload,
        signature: sha256,
      }),
    ).toBe(false);

    const sha1 = computeWebhookSignature({
      secret: "secret",
      payload,
      algorithm: "sha1",
    });
    expect(
      verifyWebhookSignature({
        secret: "secret",
        payload,
        signature: sha1,
        algorithm: "sha1",
      }),
    ).toBe(true);
  });

  it("enforces the timestamp replay window", () => {
    const payload = '{"messageId":"m-2"}';
    const timestamp = "1767225600";
    const signature = computeWebhookSignature({
      secret: "secret",
      payload,
      timestamp,
    });
    const now = Number(timestamp) * 1000;
    expect(
      verifyWebhookSignature({
        secret: "secret",
        payload,
        signature,
        timestamp,
        toleranceSeconds: 300,
        now,
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        secret: "secret",
        payload,
        signature,
        timestamp,
        toleranceSeconds: 300,
        now: now + 301_000,
      }),
    ).toBe(false);
  });

  it("throws a typed error for a missing signature", () => {
    expect(() =>
      assertWebhookSignature({
        secret: "secret",
        payload: "{}",
        signature: undefined,
      }),
    ).toThrow(WebhookSignatureError);
  });
});
