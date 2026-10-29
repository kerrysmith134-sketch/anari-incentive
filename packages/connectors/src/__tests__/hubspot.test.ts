import { describe, expect, it } from "vitest";
import {
  computeHubSpotV1Signature,
  computeHubSpotV3Signature,
  verifyHubSpotSignature,
} from "../index.js";

const method = "POST";
const uri = "/api/v1/webhooks/hubspot?source=hubspot";
const body = '{"messageId":"hs-1"}';
const secret = "client-secret";
const timestamp = "1767225600000";
const now = Number(timestamp);

describe("HubSpot signatures", () => {
  it("verifies v3 with the timestamp window", () => {
    const signatureV3 = computeHubSpotV3Signature({
      clientSecret: secret,
      method,
      uri,
      body,
      timestamp,
    });
    expect(
      verifyHubSpotSignature({
        clientSecret: secret,
        method,
        uri,
        body,
        signatureV3,
        timestamp,
        now,
      }),
    ).toBe(true);
    expect(
      verifyHubSpotSignature({
        clientSecret: secret,
        method: "GET",
        uri,
        body,
        signatureV3,
        timestamp,
        now,
      }),
    ).toBe(false);
    expect(
      verifyHubSpotSignature({
        clientSecret: secret,
        method,
        uri,
        body: `${body} `,
        signatureV3,
        timestamp,
        now,
      }),
    ).toBe(false);
    expect(
      verifyHubSpotSignature({
        clientSecret: secret,
        method,
        uri,
        body,
        signatureV3,
        timestamp,
        now: now + 301_000,
      }),
    ).toBe(false);
  });

  it("verifies legacy v1 signatures", () => {
    const signatureV1 = computeHubSpotV1Signature({
      clientSecret: secret,
      body,
    });
    expect(
      verifyHubSpotSignature({
        clientSecret: secret,
        method,
        uri,
        body,
        signatureV1,
      }),
    ).toBe(true);
    expect(
      verifyHubSpotSignature({
        clientSecret: "wrong",
        method,
        uri,
        body,
        signatureV1,
      }),
    ).toBe(false);
  });

  it("rejects requests without a usable signature", () => {
    expect(
      verifyHubSpotSignature({
        clientSecret: secret,
        method,
        uri,
        body,
      }),
    ).toBe(false);
    expect(
      verifyHubSpotSignature({
        clientSecret: secret,
        method,
        uri,
        body,
        signatureV3: "deadbeef",
      }),
    ).toBe(false);
  });
});
