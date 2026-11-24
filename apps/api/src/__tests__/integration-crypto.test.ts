import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createIntegrationCrypto,
  IntegrationKeyConfigError,
  RawPayloadDecryptError,
  resolveIntegrationKeys,
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
