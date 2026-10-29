import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

/**
 * HubSpot v3 signature: HMAC-SHA256 over
 * `${method}${uri}${body}${timestamp}` using the app client secret.
 * `uri` is the full path and query as received.
 */
export function computeHubSpotV3Signature(input: {
  clientSecret: string;
  method: string;
  uri: string;
  body: string | Buffer;
  timestamp: string;
}): string {
  const body = Buffer.isBuffer(input.body)
    ? input.body
    : Buffer.from(input.body);
  const signed = Buffer.concat([
    Buffer.from(input.method.toUpperCase()),
    Buffer.from(input.uri),
    body,
    Buffer.from(input.timestamp),
  ]);
  return createHmac("sha256", input.clientSecret)
    .update(signed)
    .digest("hex");
}

/** HubSpot v1 signature: SHA256 over `${clientSecret}${body}`. */
export function computeHubSpotV1Signature(input: {
  clientSecret: string;
  body: string | Buffer;
}): string {
  const body = Buffer.isBuffer(input.body)
    ? input.body
    : Buffer.from(input.body);
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(input.clientSecret), body]))
    .digest("hex");
}

/**
 * Verify either a HubSpot v3 signature (with a timestamp replay window) or a
 * legacy v1 signature. Returns false for missing/mismatched values.
 */
export function verifyHubSpotSignature(input: {
  clientSecret: string;
  method: string;
  uri: string;
  body: string | Buffer;
  signatureV3?: string;
  signatureV1?: string;
  timestamp?: string;
  /** Replay window in seconds for v3. Defaults to 300. */
  toleranceSeconds?: number;
  /** Injectable clock in milliseconds, for tests. */
  now?: number;
}): boolean {
  if (input.signatureV3 !== undefined) {
    if (input.timestamp === undefined) return false;
    const timestampMs = Number(input.timestamp);
    if (!Number.isFinite(timestampMs)) return false;
    const now = input.now ?? Date.now();
    const tolerance = (input.toleranceSeconds ?? 300) * 1000;
    if (Math.abs(now - timestampMs) > tolerance) return false;
    const expected = computeHubSpotV3Signature({
      clientSecret: input.clientSecret,
      method: input.method,
      uri: input.uri,
      body: input.body,
      timestamp: input.timestamp,
    });
    return safeEqual(expected, input.signatureV3);
  }
  if (input.signatureV1 !== undefined) {
    const expected = computeHubSpotV1Signature({
      clientSecret: input.clientSecret,
      body: input.body,
    });
    return safeEqual(expected, input.signatureV1);
  }
  return false;
}
