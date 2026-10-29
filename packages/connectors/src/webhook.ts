import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookSignatureAlgorithm = "sha256" | "sha1";

export class WebhookSignatureError extends Error {
  readonly code = "WEBHOOK_SIGNATURE_INVALID";
  constructor(message = "webhook signature is invalid") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/**
 * Compute an HMAC signature over the exact raw request bytes. When a
 * timestamp is supplied the signed content is `${timestamp}.${payload}`,
 * matching common provider schemes (e.g. Stripe).
 */
export function computeWebhookSignature(input: {
  secret: string;
  payload: string | Buffer;
  algorithm?: WebhookSignatureAlgorithm;
  timestamp?: string;
}): string {
  const algorithm = input.algorithm ?? "sha256";
  const payload = Buffer.isBuffer(input.payload)
    ? input.payload
    : Buffer.from(input.payload);
  const signed = input.timestamp
    ? Buffer.concat([Buffer.from(`${input.timestamp}.`), payload])
    : payload;
  const digest = createHmac(algorithm, input.secret)
    .update(signed)
    .digest("hex");
  return `${algorithm}=${digest}`;
}

/**
 * Verify a webhook signature with a constant-time comparison. Returns false
 * for a missing/malformed signature or a timestamp outside the tolerance.
 */
export function verifyWebhookSignature(input: {
  secret: string;
  payload: string | Buffer;
  signature: string | undefined;
  algorithm?: WebhookSignatureAlgorithm;
  timestamp?: string;
  /** Replay window in seconds; only checked when timestamp is supplied. */
  toleranceSeconds?: number;
  /** Injectable clock in milliseconds, for tests. */
  now?: number;
}): boolean {
  if (!input.signature) return false;
  const algorithm = input.algorithm ?? "sha256";
  if (input.timestamp !== undefined && input.toleranceSeconds !== undefined) {
    const seconds = Number(input.timestamp);
    if (!Number.isFinite(seconds)) return false;
    const now = input.now ?? Date.now();
    if (Math.abs(now - seconds * 1000) > input.toleranceSeconds * 1000) {
      return false;
    }
  }
  const expected = computeWebhookSignature({
    secret: input.secret,
    payload: input.payload,
    algorithm,
    timestamp: input.timestamp,
  });
  const provided = input.signature.startsWith(`${algorithm}=`)
    ? input.signature
    : `${algorithm}=${input.signature}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

/** Verify or throw `WebhookSignatureError`. */
export function assertWebhookSignature(
  input: Parameters<typeof verifyWebhookSignature>[0],
): void {
  if (!verifyWebhookSignature(input)) {
    throw new WebhookSignatureError();
  }
}
