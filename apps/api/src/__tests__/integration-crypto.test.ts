import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createIntegrationCrypto,
  createKeyRotationMonitor,
  IntegrationKeyConfigError,
  RawPayloadDecryptError,
  resolveIntegrationKeys,
  resolveWebhookKeyMaxAgeDays,
  sendIntegrationKeyAlert,
  type IntegrationKeyAlertPayload,
  type IntegrationKeyHealth,
  type RawPayloadDecryptErrorCode,
} from "../integration-crypto.js";

const SIGNING_SECRET = "unit-test-signing-secret-0123456789abcdef";
const RAW_KEY = "unit-test-raw-encryption-key-0123456789abcdef";

const makeCrypto = (overrides: Record<string, unknown> = {}) =>
  createIntegrationCrypto({
    env: {},
    nodeEnv: "production",
    signingSecret: SIGNING_SECRET,
    rawEncryptionKey: RAW_KEY,
    ...overrides,
  });

/** Encrypts with the pre-hardening v1 envelope (no key id). */
function legacyEncrypt(plaintext: string, rawKey = RAW_KEY): string {
  const key = createHash("sha256").update(rawKey, "utf8").digest();
  const iv = Buffer.alloc(12, 0x42);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    data.toString("hex"),
  ].join(":");
}

function expectDecryptError(
  fn: () => unknown,
  code: RawPayloadDecryptErrorCode,
): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RawPayloadDecryptError);
    expect((error as RawPayloadDecryptError).name).toBe(
      "RawPayloadDecryptError",
    );
    expect((error as RawPayloadDecryptError).code).toBe(code);
    return;
  }
  throw new Error(`expected RawPayloadDecryptError(${code})`);
}

function expectKeyConfigError(fn: () => unknown, fragment?: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IntegrationKeyConfigError);
    expect((error as IntegrationKeyConfigError).code).toBe(
      "INTEGRATION_KEY_CONFIG_INVALID",
    );
    if (fragment) expect((error as Error).message).toContain(fragment);
    return;
  }
  throw new Error("expected IntegrationKeyConfigError");
}

describe("resolveIntegrationKeys", () => {
  it("uses explicit keys in production without development defaults", () => {
    const keys = resolveIntegrationKeys({
      env: {},
      nodeEnv: "production",
      signingSecret: SIGNING_SECRET,
      rawEncryptionKey: RAW_KEY,
    });
    expect(keys).toMatchObject({
      signingKey: SIGNING_SECRET,
      rawKey: RAW_KEY,
      keyId: "v1",
      usedDevDefaults: false,
    });
    expect(keys.rawKeys).toEqual({ v1: RAW_KEY });
    expect(keys.signingKeys).toEqual({ v1: SIGNING_SECRET });
  });

  it("reads the production keys from the environment", () => {
    const keys = resolveIntegrationKeys({
      env: {
        NODE_ENV: "production",
        WEBHOOK_SIGNING_SECRET: SIGNING_SECRET,
        WEBHOOK_RAW_KEY: RAW_KEY,
        WEBHOOK_KEY_ID: "2026-11",
      },
    });
    expect(keys.signingKey).toBe(SIGNING_SECRET);
    expect(keys.rawKey).toBe(RAW_KEY);
    expect(keys.keyId).toBe("2026-11");
    expect(keys.usedDevDefaults).toBe(false);
  });

  it("rejects production when both keys are missing", () => {
    expectKeyConfigError(
      () => resolveIntegrationKeys({ env: {}, nodeEnv: "production" }),
      "WEBHOOK_SIGNING_SECRET is required",
    );
  });

  it.each([
    ["WEBHOOK_SIGNING_SECRET", { WEBHOOK_RAW_KEY: RAW_KEY }],
    ["WEBHOOK_RAW_KEY", { WEBHOOK_SIGNING_SECRET: SIGNING_SECRET }],
  ] as const)("rejects production without %s", (name, env) => {
    expectKeyConfigError(
      () => resolveIntegrationKeys({ env: { ...env }, nodeEnv: "production" }),
      `${name} is required`,
    );
  });

  it("never falls back to SESSION_SECRET in production", () => {
    expectKeyConfigError(
      () =>
        resolveIntegrationKeys({
          env: {
            NODE_ENV: "production",
            SESSION_SECRET: "session-secret-0123456789abcdefghijklmnop",
          },
          nodeEnv: "production",
        }),
      "WEBHOOK_SIGNING_SECRET is required",
    );
  });

  it("rejects identical production keys", () => {
    expectKeyConfigError(
      () =>
        resolveIntegrationKeys({
          env: {},
          nodeEnv: "production",
          signingSecret: SIGNING_SECRET,
          rawEncryptionKey: SIGNING_SECRET,
        }),
      "must be different values",
    );
  });

  it("rejects production keys shorter than 32 characters", () => {
    expectKeyConfigError(
      () =>
        resolveIntegrationKeys({
          env: {},
          nodeEnv: "production",
          signingSecret: "s".repeat(31),
          rawEncryptionKey: RAW_KEY,
        }),
      "at least 32 characters",
    );
    expectKeyConfigError(
      () =>
        resolveIntegrationKeys({
          env: {},
          nodeEnv: "production",
          signingSecret: SIGNING_SECRET,
          rawEncryptionKey: "r".repeat(31),
        }),
      "at least 32 characters",
    );
  });

  it("accepts exactly 32-character production keys that differ", () => {
    const keys = resolveIntegrationKeys({
      env: {},
      nodeEnv: "production",
      signingSecret: "s".repeat(32),
      rawEncryptionKey: "r".repeat(32),
    });
    expect(keys.signingKey).toBe("s".repeat(32));
    expect(keys.rawKey).toBe("r".repeat(32));
  });

  it("falls back to development defaults outside production", () => {
    const keys = resolveIntegrationKeys({ env: {}, nodeEnv: "development" });
    expect(keys.usedDevDefaults).toBe(true);
    expect(keys.signingKey.length).toBeGreaterThan(0);
    expect(keys.rawKey.length).toBeGreaterThan(0);
    expect(keys.signingKey).not.toBe(keys.rawKey);
    expect(keys.keyId).toBe("v1");
  });

  it("does not use SESSION_SECRET for the development fallback", () => {
    const withSession = resolveIntegrationKeys({
      env: { SESSION_SECRET: "session-secret-0123456789abcdefghijklmnop" },
      nodeEnv: "development",
    });
    const withoutSession = resolveIntegrationKeys({
      env: {},
      nodeEnv: "development",
    });
    expect(withSession).toEqual(withoutSession);
  });

  it("reports usedDevDefaults=false when both values are supplied in development", () => {
    const keys = resolveIntegrationKeys({
      env: {},
      nodeEnv: "development",
      signingSecret: SIGNING_SECRET,
      rawEncryptionKey: RAW_KEY,
    });
    expect(keys.usedDevDefaults).toBe(false);
  });

  it("still rejects identical keys outside production", () => {
    expectKeyConfigError(
      () =>
        resolveIntegrationKeys({
          env: {},
          nodeEnv: "development",
          signingSecret: SIGNING_SECRET,
          rawEncryptionKey: SIGNING_SECRET,
        }),
      "must be different values",
    );
  });

  it("prefers explicit injection over environment values", () => {
    const keys = resolveIntegrationKeys({
      env: {
        WEBHOOK_SIGNING_SECRET: "env-signing-secret-0123456789abcdef",
        WEBHOOK_RAW_KEY: "env-raw-key-0123456789abcdefghij",
      },
      nodeEnv: "production",
      signingSecret: SIGNING_SECRET,
      rawEncryptionKey: RAW_KEY,
    });
    expect(keys.signingKey).toBe(SIGNING_SECRET);
    expect(keys.rawKey).toBe(RAW_KEY);
  });

  it("rejects an unsafe key id", () => {
    expectKeyConfigError(
      () =>
        resolveIntegrationKeys({
          env: {},
          nodeEnv: "production",
          signingSecret: SIGNING_SECRET,
          rawEncryptionKey: RAW_KEY,
          keyId: "bad key id!",
        }),
      "WEBHOOK_KEY_ID",
    );
  });
});

describe("createIntegrationCrypto", () => {
  it("round-trips UTF-8 payloads through a v2 envelope", () => {
    const crypto = makeCrypto();
    const plaintext = JSON.stringify({ hello: "世界", count: 2 });
    const stored = crypto.encryptRawPayload(plaintext);

    expect(stored).toMatch(/^v2:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(crypto.decryptRawPayload(stored)).toBe(plaintext);
  });

  it("round-trips an empty payload", () => {
    const crypto = makeCrypto();
    const stored = crypto.encryptRawPayload("");
    expect(stored).toMatch(/^v2:v1:/);
    expect(crypto.decryptRawPayload(stored)).toBe("");
  });

  it("uses a fresh random IV for every encryption", () => {
    const crypto = makeCrypto();
    const first = crypto.encryptRawPayload("same payload");
    const second = crypto.encryptRawPayload("same payload");
    expect(first).not.toBe(second);
    expect(crypto.decryptRawPayload(first)).toBe("same payload");
    expect(crypto.decryptRawPayload(second)).toBe("same payload");
  });

  it("decrypts legacy v1 ciphertext with the current raw key", () => {
    const crypto = makeCrypto();
    expect(crypto.decryptRawPayload(legacyEncrypt("legacy payload"))).toBe(
      "legacy payload",
    );
  });

  it("stamps the configured key id and accepts a matching key id", () => {
    const crypto = makeCrypto({ keyId: "2026-11" });
    const stored = crypto.encryptRawPayload("rotating");
    expect(stored.startsWith("v2:2026-11:")).toBe(true);
    expect(crypto.keyId).toBe("2026-11");
    expect(crypto.decryptRawPayload(stored)).toBe("rotating");
  });

  it("reads WEBHOOK_KEY_ID from the environment", () => {
    const crypto = createIntegrationCrypto({
      env: {
        WEBHOOK_SIGNING_SECRET: SIGNING_SECRET,
        WEBHOOK_RAW_KEY: RAW_KEY,
        WEBHOOK_KEY_ID: "env-key",
      },
      nodeEnv: "production",
    });
    expect(crypto.keyId).toBe("env-key");
    expect(crypto.usedDevDefaults).toBe(false);
  });

  it("rejects ciphertext written under a different key id", () => {
    const oldCrypto = makeCrypto({ keyId: "old" });
    const newCrypto = makeCrypto({ keyId: "new" });
    const stored = oldCrypto.encryptRawPayload("old row");
    expectDecryptError(
      () => newCrypto.decryptRawPayload(stored),
      "RAW_PAYLOAD_KEY_MISSING",
    );
    // The old key + old key id can still read the row for re-encryption.
    expect(oldCrypto.decryptRawPayload(stored)).toBe("old row");
  });

  it("throws RAW_PAYLOAD_DECRYPT_FAILED when the data is tampered with", () => {
    const crypto = makeCrypto();
    const stored = crypto.encryptRawPayload("tamper me");
    const parts = stored.split(":");
    const data = parts[4]!;
    parts[4] = (data.endsWith("0") ? data.slice(0, -1) + "1" : data.slice(0, -1) + "0");
    expectDecryptError(
      () => crypto.decryptRawPayload(parts.join(":")),
      "RAW_PAYLOAD_DECRYPT_FAILED",
    );
  });

  it("throws RAW_PAYLOAD_DECRYPT_FAILED when the auth tag is tampered with", () => {
    const crypto = makeCrypto();
    const stored = crypto.encryptRawPayload("tamper me");
    const parts = stored.split(":");
    const tag = parts[3]!;
    parts[3] = (tag.endsWith("0") ? tag.slice(0, -1) + "1" : tag.slice(0, -1) + "0");
    expectDecryptError(
      () => crypto.decryptRawPayload(parts.join(":")),
      "RAW_PAYLOAD_DECRYPT_FAILED",
    );
  });

  it("throws RAW_PAYLOAD_DECRYPT_FAILED when the raw key does not match", () => {
    const writer = makeCrypto();
    const reader = makeCrypto({
      rawEncryptionKey: "different-raw-key-0123456789abcdefgh",
    });
    expectDecryptError(
      () => reader.decryptRawPayload(writer.encryptRawPayload("secret")),
      "RAW_PAYLOAD_DECRYPT_FAILED",
    );
  });

  it.each([
    ["empty", ""],
    ["not an envelope", "garbage"],
    ["unknown version", "v3:v1:00112233445566778899aabb:00112233445566778899aabbccddeeff:00"],
    ["v1 with too few fields", "v1:00112233445566778899aabb:00112233445566778899aabbccddeeff"],
    ["v2 with too few fields", "v2:v1:00112233445566778899aabb:00112233445566778899aabbccddeeff"],
    ["short iv", "v2:v1:0011:00112233445566778899aabbccddeeff:00"],
    ["short tag", "v2:v1:00112233445566778899aabb:0011:00"],
    ["non-hex data", "v2:v1:00112233445566778899aabb:00112233445566778899aabbccddeeff:zz"],
    ["odd-length data", "v2:v1:00112233445566778899aabb:00112233445566778899aabbccddeeff:0"],
    ["missing key id", "v2::00112233445566778899aabb:00112233445566778899aabbccddeeff:00"],
    ["malformed key id", "v2:bad key:00112233445566778899aabb:00112233445566778899aabbccddeeff:00"],
  ])("throws RAW_PAYLOAD_FORMAT_INVALID for %s ciphertext", (_label, stored) => {
    expectDecryptError(
      () => makeCrypto().decryptRawPayload(stored),
      "RAW_PAYLOAD_FORMAT_INVALID",
    );
  });

  it("derives stable per-routing-key signatures and separates them from the raw key", () => {
    const crypto = makeCrypto();
    const expected = createHmac("sha256", SIGNING_SECRET)
      .update("crm:customer.created")
      .digest("hex");

    expect(crypto.signingKeyFor("crm:customer.created")).toBe(expected);
    expect(crypto.signingKeyFor("crm:customer.created")).toBe(
      crypto.signingKeyFor("crm:customer.created"),
    );
    expect(crypto.signingKeyFor("crm:customer.created")).not.toBe(
      crypto.signingKeyFor("crm:customer.updated"),
    );
    expect(crypto.signingKeyFor("crm:customer.created")).not.toBe(RAW_KEY);
  });

  it("encrypts with AES-256-GCM using SHA-256 of the raw key", () => {
    const crypto = makeCrypto();
    const plaintext = "verify key derivation";
    const stored = crypto.encryptRawPayload(plaintext);
    const [, , ivHex, tagHex, dataHex] = stored.split(":");

    const key = createHash("sha256").update(RAW_KEY, "utf8").digest();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex!, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex!, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex!, "hex")),
      decipher.final(),
    ]).toString("utf8");

    expect(decrypted).toBe(plaintext);
  });

  it("refuses to create crypto when signing and encryption keys are reused", () => {
    expectKeyConfigError(
      () =>
        makeCrypto({
          signingSecret: SIGNING_SECRET,
          rawEncryptionKey: SIGNING_SECRET,
        }),
      "must be different values",
    );
  });
});


describe("key rotation keyring / dual-signature window", () => {
  const OLD_RAW = "old-raw-key-0123456789abcdefghijklmnop";
  const NEW_RAW = "new-raw-key-0123456789abcdefghijklmnop";
  const OLD_SIGNING = "old-signing-key-0123456789abcdefghij";
  const NEW_SIGNING = "new-signing-key-0123456789abcdefghij";

  it("decrypts rows written with a retained old raw key", () => {
    const oldCrypto = createIntegrationCrypto({
      env: {},
      nodeEnv: "production",
      signingSecret: OLD_SIGNING,
      rawEncryptionKey: OLD_RAW,
      keyId: "2026-10",
    });
    const ciphertext = oldCrypto.encryptRawPayload("historical hr data");
    expect(ciphertext.startsWith("v2:2026-10:")).toBe(true);

    const newCrypto = createIntegrationCrypto({
      env: {},
      nodeEnv: "production",
      signingSecret: NEW_SIGNING,
      rawEncryptionKey: NEW_RAW,
      keyId: "2026-11",
      rawKeys: { "2026-10": OLD_RAW, "2026-11": NEW_RAW },
      signingKeys: { "2026-10": OLD_SIGNING, "2026-11": NEW_SIGNING },
    });
    expect(newCrypto.keyIds.sort()).toEqual(["2026-10", "2026-11"]);
    expect(newCrypto.decryptRawPayload(ciphertext)).toBe("historical hr data");
    const fresh = newCrypto.encryptRawPayload("new data");
    expect(fresh.startsWith("v2:2026-11:")).toBe(true);
  });

  it("accepts signatures derived from old and new signing keys", () => {
    const crypto = createIntegrationCrypto({
      env: {},
      nodeEnv: "production",
      signingSecret: NEW_SIGNING,
      rawEncryptionKey: NEW_RAW,
      signingKeys: { old: OLD_SIGNING, new: NEW_SIGNING },
    });
    const signatures = crypto.signatureKeysFor("routing-key-1");
    expect(signatures).toHaveLength(2);
    expect(
      signatures,
    ).toContain(
      createHmac("sha256", OLD_SIGNING)
        .update("routing-key-1")
        .digest("hex"),
    );
    expect(
      signatures,
    ).toContain(
      createHmac("sha256", NEW_SIGNING)
        .update("routing-key-1")
        .digest("hex"),
    );
    expect(crypto.signingKeyFor("routing-key-1")).toBe(signatures[0]);
  });

  it("fails closed when a v2 keyId is not in the keyring", () => {
    const crypto = createIntegrationCrypto({
      env: {},
      nodeEnv: "production",
      signingSecret: SIGNING_SECRET,
      rawEncryptionKey: RAW_KEY,
      rawKeys: { v1: RAW_KEY },
    });
    const foreign = `v2:retired:${"00".repeat(12)}:${"00".repeat(16)}:00`;
    expectDecryptError(
      () => crypto.decryptRawPayload(foreign),
      "RAW_PAYLOAD_KEY_MISSING",
    );
  });

  it("loads the keyring from a KMS/Vault projected file", () => {
    const dir = mkdtempSync(join(tmpdir(), "webhook-keyring-"));
    const file = join(dir, "keyring.json");
    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { v1: RAW_KEY, v2: "rotated-raw-key-0123456789abcdefghij" },
        signingKeys: {
          v1: SIGNING_SECRET,
          v2: "rotated-signing-key-0123456789abcdef",
        },
      }),
    );
    const keys = resolveIntegrationKeys({
      env: { NODE_ENV: "production", WEBHOOK_KEYRING_FILE: file },
      nodeEnv: "production",
      keyId: "v1",
    });
    expect(keys.rawKeys.v1).toBe(RAW_KEY);
    expect(keys.signingKeys.v2).toBe("rotated-signing-key-0123456789abcdef");
  });

  it("hot-reloads the keyring and switches the active key", () => {
    const dir = mkdtempSync(join(tmpdir(), "webhook-reload-"));
    const file = join(dir, "keyring.json");
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      WEBHOOK_KEYRING_FILE: file,
      WEBHOOK_KEY_ID: "2026-10",
    };
    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { "2026-10": OLD_RAW },
        signingKeys: { "2026-10": OLD_SIGNING },
      }),
    );
    const crypto = createIntegrationCrypto({ env, nodeEnv: "production" });
    const oldCiphertext = crypto.encryptRawPayload("old");
    expect(crypto.keyId).toBe("2026-10");

    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { "2026-10": OLD_RAW, "2026-11": NEW_RAW },
        signingKeys: {
          "2026-10": OLD_SIGNING,
          "2026-11": NEW_SIGNING,
        },
      }),
    );
    env.WEBHOOK_KEY_ID = "2026-11";
    crypto.reload();
    expect(crypto.keyId).toBe("2026-11");
    expect(crypto.keyIds.sort()).toEqual(["2026-10", "2026-11"]);
    expect(crypto.decryptRawPayload(oldCiphertext)).toBe("old");
    expect(crypto.encryptRawPayload("new").startsWith("v2:2026-11:")).toBe(true);
  });

  it("rejects reusing a raw key as a signing key anywhere in the keyrings", () => {
    expectKeyConfigError(
      () =>
        resolveIntegrationKeys({
          env: {},
          nodeEnv: "production",
          signingSecret: SIGNING_SECRET,
          rawEncryptionKey: RAW_KEY,
          rawKeys: { old: "shared-secret-0123456789abcdefghijklmnop" },
          signingKeys: {
            old: "shared-secret-0123456789abcdefghijklmnop",
          },
        }),
      "must be different values",
    );
  });
});

// ---------------------------------------------------------------------------
// KMS/keyring rotation health + alerting
// ---------------------------------------------------------------------------


const DAY_MS = 24 * 60 * 60 * 1000;

/** Mutable test clock: deterministic load timestamps and key ages. */
function testClock(iso: string) {
  let current = new Date(iso).getTime();
  return {
    now: () => new Date(current),
    advanceDays: (days: number) => {
      current += days * DAY_MS;
    },
  };
}

/** fetch double that records calls and answers with `status`. */
function recordingFetch(status = 204) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ALERT_URL = "https://alerts.example.test/hooks/key-rotation";

function alertBody(init: RequestInit): IntegrationKeyAlertPayload {
  return JSON.parse(String(init.body)) as IntegrationKeyAlertPayload;
}

describe("key rotation health", () => {
  it("reports the health shape for a freshly loaded keyring", () => {
    const clock = testClock("2026-11-01T00:00:00.000Z");
    const crypto = makeCrypto({ now: clock.now });

    const health = crypto.keyHealth();
    expect(health).toEqual({
      ok: true,
      activeKeyId: "v1",
      keyCount: 1,
      keyIds: ["v1"],
      source: "ENV",
      lastLoadedAt: "2026-11-01T00:00:00.000Z",
      ageDays: 0,
      rotationDue: false,
      maxAgeDays: 90,
      usedDevDefaults: false,
    });
    expect(health.lastError).toBeUndefined();
  });

  it("reports FILE as the source for a KMS/Vault projected keyring", () => {
    const dir = mkdtempSync(join(tmpdir(), "webhook-health-source-"));
    const file = join(dir, "keyring.json");
    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { "2026-11": RAW_KEY },
        signingKeys: { "2026-11": SIGNING_SECRET },
      }),
    );
    const crypto = createIntegrationCrypto({
      env: {
        NODE_ENV: "production",
        WEBHOOK_KEYRING_FILE: file,
        WEBHOOK_KEY_ID: "2026-11",
      },
      nodeEnv: "production",
    });
    expect(crypto.keyHealth()).toMatchObject({
      source: "FILE",
      activeKeyId: "2026-11",
      keyCount: 1,
      rotationDue: false,
      ok: true,
    });
  });

  it("never includes key material in the health snapshot", () => {
    const crypto = makeCrypto({
      rawKeys: { v1: RAW_KEY, rotated: "rotated-raw-key-0123456789abcdefghij" },
    });
    const serialized = JSON.stringify(crypto.keyHealth());
    expect(serialized).not.toContain(RAW_KEY);
    expect(serialized).not.toContain(SIGNING_SECRET);
    expect(serialized).not.toContain("rotated-raw-key-0123456789abcdefghij");
  });

  it("flags rotationDue and ok=false once the key is older than 90 days", () => {
    const clock = testClock("2026-01-01T00:00:00.000Z");
    const crypto = makeCrypto({ now: clock.now });

    clock.advanceDays(90);
    expect(crypto.keyHealth()).toMatchObject({
      ageDays: 90,
      rotationDue: false,
      ok: true,
    });

    clock.advanceDays(1);
    expect(crypto.keyHealth()).toMatchObject({
      ageDays: 91,
      rotationDue: true,
      ok: false,
      maxAgeDays: 90,
    });
  });

  it("honours a custom max age (option and WEBHOOK_KEY_MAX_AGE_DAYS)", () => {
    const clock = testClock("2026-01-01T00:00:00.000Z");
    const byOption = makeCrypto({ now: clock.now, maxAgeDays: 30 });
    clock.advanceDays(31);
    expect(byOption.keyHealth()).toMatchObject({
      maxAgeDays: 30,
      rotationDue: true,
      ok: false,
    });

    const byEnv = createIntegrationCrypto({
      env: { WEBHOOK_KEY_MAX_AGE_DAYS: "7" },
      nodeEnv: "production",
      signingSecret: SIGNING_SECRET,
      rawEncryptionKey: RAW_KEY,
      now: clock.now,
    });
    expect(byEnv.keyHealth()).toMatchObject({
      maxAgeDays: 7,
      ageDays: 0,
      rotationDue: false,
    });
    clock.advanceDays(8);
    expect(byEnv.keyHealth().rotationDue).toBe(true);
  });

  it("resolves WEBHOOK_KEY_MAX_AGE_DAYS with a 90-day default and 1-3650 range", () => {
    expect(resolveWebhookKeyMaxAgeDays({}).days).toBe(90);
    expect(
      resolveWebhookKeyMaxAgeDays({ WEBHOOK_KEY_MAX_AGE_DAYS: "" }).days,
    ).toBe(90);
    expect(
      resolveWebhookKeyMaxAgeDays({ WEBHOOK_KEY_MAX_AGE_DAYS: "1" }).days,
    ).toBe(1);
    expect(
      resolveWebhookKeyMaxAgeDays({ WEBHOOK_KEY_MAX_AGE_DAYS: "3650" }).days,
    ).toBe(3650);
    for (const invalid of ["0", "3651", "-5", "90.5", "ninety"]) {
      const resolved = resolveWebhookKeyMaxAgeDays({
        WEBHOOK_KEY_MAX_AGE_DAYS: invalid,
      });
      expect(resolved.days).toBe(90);
      expect(resolved.warning).toContain("WEBHOOK_KEY_MAX_AGE_DAYS");
    }
  });

  it("keeps the age across a reload that does not change the key material", () => {
    const clock = testClock("2026-01-01T00:00:00.000Z");
    const dir = mkdtempSync(join(tmpdir(), "webhook-health-noop-reload-"));
    const file = join(dir, "keyring.json");
    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { v1: RAW_KEY },
        signingKeys: { v1: SIGNING_SECRET },
      }),
    );
    const crypto = createIntegrationCrypto({
      env: { NODE_ENV: "production", WEBHOOK_KEYRING_FILE: file },
      nodeEnv: "production",
      now: clock.now,
    });

    clock.advanceDays(100);
    crypto.reload(); // same material
    const health = crypto.keyHealth();
    expect(health.ageDays).toBe(100);
    expect(health.rotationDue).toBe(true);
    // lastLoadedAt does move forward even though the key age does not.
    expect(health.lastLoadedAt).toBe(clock.now().toISOString());
  });

  it("resets the key age after a rotation (reload/rotate updates the load time)", () => {
    const clock = testClock("2026-01-01T00:00:00.000Z");
    const dir = mkdtempSync(join(tmpdir(), "webhook-health-rotate-"));
    const file = join(dir, "keyring.json");
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      WEBHOOK_KEYRING_FILE: file,
      WEBHOOK_KEY_ID: "2026-01",
    };
    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { "2026-01": RAW_KEY },
        signingKeys: { "2026-01": SIGNING_SECRET },
      }),
    );
    const crypto = createIntegrationCrypto({ env, nodeEnv: "production", now: clock.now });

    clock.advanceDays(120);
    expect(crypto.keyHealth()).toMatchObject({
      activeKeyId: "2026-01",
      ageDays: 120,
      rotationDue: true,
      ok: false,
    });

    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { "2026-01": RAW_KEY, "2026-05": "rotated-raw-key-0123456789abcdefghij" },
        signingKeys: {
          "2026-01": SIGNING_SECRET,
          "2026-05": "rotated-signing-key-0123456789abcdef",
        },
      }),
    );
    env.WEBHOOK_KEY_ID = "2026-05";
    crypto.reload();

    expect(crypto.keyHealth()).toMatchObject({
      activeKeyId: "2026-05",
      keyCount: 2,
      keyIds: expect.arrayContaining(["2026-01", "2026-05"]),
      ageDays: 0,
      rotationDue: false,
      ok: true,
    });
  });

  it("records lastError on a failed reload and keeps the old keys usable", () => {
    const clock = testClock("2026-01-01T00:00:00.000Z");
    const dir = mkdtempSync(join(tmpdir(), "webhook-health-reload-fail-"));
    const file = join(dir, "keyring.json");
    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { v1: RAW_KEY },
        signingKeys: { v1: SIGNING_SECRET },
      }),
    );
    const crypto = createIntegrationCrypto({
      env: { NODE_ENV: "production", WEBHOOK_KEYRING_FILE: file },
      nodeEnv: "production",
      now: clock.now,
    });
    const ciphertext = crypto.encryptRawPayload("kept readable");

    // Reload rejects: the new keyring is too short in production.
    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { v1: "too-short-key" },
        signingKeys: { v1: SIGNING_SECRET },
      }),
    );
    expect(() => crypto.reload()).toThrow(IntegrationKeyConfigError);

    const health = crypto.keyHealth();
    expect(health.ok).toBe(false);
    expect(health.activeKeyId).toBe("v1");
    expect(health.lastError).toBeTruthy();
    expect(health.lastError).toContain("at least 32 characters");
    // No material in the published error, and the old key still decrypts.
    expect(health.lastError).not.toContain(RAW_KEY);
    expect(health.lastError).not.toContain(SIGNING_SECRET);
    expect(health.lastError).not.toContain("too-short-key");
    expect(crypto.decryptRawPayload(ciphertext)).toBe("kept readable");

    // A later successful reload clears the error.
    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { v1: RAW_KEY },
        signingKeys: { v1: SIGNING_SECRET },
      }),
    );
    crypto.reload();
    expect(crypto.keyHealth().lastError).toBeUndefined();
    expect(crypto.keyHealth().ok).toBe(true);
  });

  it("does not leak key material when the keyring file becomes unreadable", () => {
    const dir = mkdtempSync(join(tmpdir(), "webhook-health-broken-file-"));
    const file = join(dir, "keyring.json");
    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { v1: RAW_KEY },
        signingKeys: { v1: SIGNING_SECRET },
      }),
    );
    const crypto = createIntegrationCrypto({
      env: { NODE_ENV: "production", WEBHOOK_KEYRING_FILE: file },
      nodeEnv: "production",
    });
    writeFileSync(file, "{ this is not json");
    expect(() => crypto.reload()).toThrow();

    const health = crypto.keyHealth();
    expect(health.lastError).toBeTruthy();
    expect(health.lastError).not.toContain(RAW_KEY);
    expect(health.lastError).not.toContain(SIGNING_SECRET);
  });
});

describe("rotation alerts and periodic checks", () => {
  const frozenHealth = (
    overrides: Partial<IntegrationKeyHealth> = {},
  ): IntegrationKeyHealth => ({
    ok: false,
    activeKeyId: "2026-05",
    keyCount: 2,
    keyIds: ["2026-01", "2026-05"],
    source: "FILE",
    lastLoadedAt: "2026-08-01T00:00:00.000Z",
    ageDays: 96,
    rotationDue: true,
    maxAgeDays: 90,
    usedDevDefaults: false,
    ...overrides,
  });

  it("POSTs one rotation_due JSON alert when the active key is over age", async () => {
    const clock = testClock("2026-11-01T00:00:00.000Z");
    const crypto = makeCrypto({ now: clock.now });
    clock.advanceDays(120);
    const { calls, fetchImpl } = recordingFetch();
    const monitor = createKeyRotationMonitor({
      crypto,
      alertUrl: ALERT_URL,
      fetchImpl,
      now: clock.now,
      intervalMs: 0,
    });

    const health = await monitor.check();
    expect(health.rotationDue).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(ALERT_URL);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toMatchObject({
      "content-type": "application/json",
    });
    expect(alertBody(calls[0]!.init)).toEqual({
      event: "rotation_due",
      activeKeyId: "v1",
      ageDays: 120,
      at: clock.now().toISOString(),
    });
    expect(String(calls[0]!.init.body)).not.toContain(RAW_KEY);
    expect(String(calls[0]!.init.body)).not.toContain(SIGNING_SECRET);
  });

  it("does not alert while the key is inside the max age, and skips a blank URL", async () => {
    const fresh = makeCrypto({ now: () => new Date("2026-11-01T00:00:00.000Z") });
    const recording = recordingFetch();
    await createKeyRotationMonitor({
      crypto: fresh,
      alertUrl: ALERT_URL,
      fetchImpl: recording.fetchImpl,
      intervalMs: 0,
    }).check();
    expect(recording.calls).toHaveLength(0);

    const overdue = frozenHealth();
    const noUrl = recordingFetch();
    await createKeyRotationMonitor({
      crypto: { keyHealth: () => overdue },
      alertUrl: "",
      fetchImpl: noUrl.fetchImpl,
      intervalMs: 0,
    }).check();
    expect(noUrl.calls).toHaveLength(0);
  });

  it("alerts at most once per (event, activeKeyId) while the key stays overdue", async () => {
    const crypto = { keyHealth: () => frozenHealth() };
    const { calls, fetchImpl } = recordingFetch();
    const monitor = createKeyRotationMonitor({
      crypto,
      alertUrl: ALERT_URL,
      fetchImpl,
      intervalMs: 0,
    });
    await monitor.check();
    await monitor.check();
    await monitor.check();
    expect(calls).toHaveLength(1);
  });

  it("logs an alert delivery failure, does not retry it inline, and never throws", async () => {
    const warnings: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const monitor = createKeyRotationMonitor({
      crypto: { keyHealth: () => frozenHealth() },
      alertUrl: ALERT_URL,
      fetchImpl,
      intervalMs: 0,
      logger: {
        warn: (message, meta) => {
          warnings.push({ message, meta });
        },
      },
    });

    await expect(monitor.check()).resolves.toMatchObject({ rotationDue: true });
    expect(attempts).toBe(1);
    expect(
      warnings.some((entry) =>
        entry.message.includes("alert delivery failed"),
      ),
    ).toBe(true);
    // Deduped: a second check does not start another POST (no recursion/spam).
    await monitor.check();
    expect(attempts).toBe(1);
  });

  it("aborts the alert POST after the configured timeout", async () => {
    const fetchImpl = (async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      })) as unknown as typeof fetch;

    const started = Date.now();
    const result = await sendIntegrationKeyAlert({
      url: ALERT_URL,
      payload: {
        event: "rotation_due",
        activeKeyId: "v1",
        ageDays: 92,
        at: "2026-11-01T00:00:00.000Z",
      },
      fetchImpl,
      timeoutMs: 25,
    });
    expect(result.sent).toBe(false);
    expect(result.error).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("refuses a non-http(s) alert URL instead of fetching it", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const result = await sendIntegrationKeyAlert({
      url: "file:///etc/passwd",
      payload: { event: "rotation_due", activeKeyId: "v1", ageDays: 91, at: "x" },
      fetchImpl,
    });
    expect(result.sent).toBe(false);
    expect(result.error).toContain("http(s)");
    expect(calls).toHaveLength(0);
  });

  it("POSTs reload_failed with the sanitized reason after a failed reload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "webhook-alert-reload-"));
    const file = join(dir, "keyring.json");
    writeFileSync(
      file,
      JSON.stringify({
        rawKeys: { "2026-05": RAW_KEY },
        signingKeys: { "2026-05": SIGNING_SECRET },
      }),
    );
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      WEBHOOK_KEYRING_FILE: file,
      WEBHOOK_KEY_ID: "2026-05",
    };
    const crypto = createIntegrationCrypto({ env, nodeEnv: "production" });
    writeFileSync(file, "{}");
    expect(() => crypto.reload()).toThrow();

    const { calls, fetchImpl } = recordingFetch();
    const logger = { warn: () => {} };
    const monitor = createKeyRotationMonitor({
      crypto,
      alertUrl: ALERT_URL,
      fetchImpl,
      intervalMs: 0,
      logger,
    });
    await monitor.reportReloadFailure();

    expect(calls).toHaveLength(1);
    const body = alertBody(calls[0]!.init);
    expect(body.event).toBe("reload_failed");
    expect(body.activeKeyId).toBe("2026-05");
    expect(typeof body.at).toBe("string");
    expect(JSON.stringify(body)).not.toContain(RAW_KEY);
  });

  it("start() runs the startup check without blocking and stop() clears the timer", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const monitor = createKeyRotationMonitor({
      crypto: { keyHealth: () => frozenHealth() },
      alertUrl: ALERT_URL,
      fetchImpl,
      intervalMs: 10,
      logger: { warn: () => {} },
    });

    expect(() => monitor.start()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 30));
    monitor.stop();
    // Startup alert plus at most a couple of interval ticks; dedupe keeps it 1.
    expect(calls).toHaveLength(1);
  });
});
