/**
 * Integration webhook cryptography.
 *
 * Two independent secrets are used here:
 *
 *   1. The webhook signing secret (`WEBHOOK_SIGNING_SECRET`) is the HMAC server
 *      secret. A per-routing-key signing key is derived from it, so the
 *      signature can be verified without storing per-key material.
 *   2. The raw payload encryption key (`WEBHOOK_RAW_KEY`) is the AES-256-GCM
 *      key used to encrypt the provider webhook body at rest.
 *
 * The two secrets MUST be different. Reusing one value for both means a leak
 * of the signing secret also decrypts every stored raw payload (and vice
 * versa). This module refuses to operate when they are equal.
 *
 * This module deliberately has no Fastify / store dependency so the key
 * policy can be unit tested and reused by the API, the worker, or offline
 * re-encryption scripts. It never reads `SESSION_SECRET`: the console session
 * key is a different trust domain and must not silently become a webhook key.
 *
 * Key rotation (Key ID / version):
 * ---------------------------------
 * New ciphertexts use the envelope
 *
 *   v2:<keyId>:<ivHex>:<tagHex>:<dataHex>
 *
 * The `keyId` names the raw key that was in force when the row was written.
 * `decryptRawPayload` only accepts the keyId this instance was constructed
 * with; a different keyId raises `RAW_PAYLOAD_KEY_MISSING` instead of trying
 * the current key and reporting a confusing authentication failure.
 *
 * This module holds exactly one active raw key, not a keyring. To rotate:
 *   1. keep the old key material available in the deployment secret store;
 *   2. re-encrypt historical rows with the new key (read them via a crypto
 *      instance constructed with the old key + old keyId, write with the new
 *      instance), or keep an old-key reader online during the migration;
 *   3. only remove the old key after every row carrying the old keyId has been
 *      re-encrypted.
 * Until then, rows written under a retired keyId are not decryptable and are
 * surfaced as `RAW_PAYLOAD_KEY_MISSING` so the caller can quarantine/alert
 * rather than silently treating the payload as empty.
 *
 * Rotation health (observability):
 * ---------------------------------
 * `keyHealth()` returns a key-material-free snapshot (active keyId, key ids,
 * source, process-local load timestamp, age in days, rotationDue) for the admin
 * health endpoint. The process remembers when each key *material* was first
 * observed: a reload that does not change the material keeps the original
 * timestamp, so a periodic reload cannot mask an overdue rotation. Over-age
 * keys and failed reloads are alerted, never fatal: the startup/periodic check
 * only logs, and the optional `WEBHOOK_KEY_ALERT_URL` receives one JSON POST
 * per state change. A failed alert POST is logged and never retried inline, so
 * alerting cannot recurse.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { readFileSync } from "node:fs";

/** Production integration secrets must be at least this many characters. */
export const MIN_INTEGRATION_KEY_LENGTH = 32;

/** Envelope version used by `encryptRawPayload`. */
export const RAW_PAYLOAD_ENVELOPE_VERSION = "v2";

/** Key id used when neither the caller nor `WEBHOOK_KEY_ID` names one. */
export const DEFAULT_WEBHOOK_KEY_ID = "v1";

/** Default age (days) after which a key counts as due for rotation. */
export const DEFAULT_WEBHOOK_KEY_MAX_AGE_DAYS = 90;

/** Accepted `WEBHOOK_KEY_MAX_AGE_DAYS` range. */
export const MIN_WEBHOOK_KEY_MAX_AGE_DAYS = 1;
export const MAX_WEBHOOK_KEY_MAX_AGE_DAYS = 3650;

/** Rotation alert POST timeout (requirement: 5s). */
export const KEY_ALERT_TIMEOUT_MS = 5_000;

/** Default interval of the in-process rotation check (1 hour). */
export const DEFAULT_KEY_HEALTH_INTERVAL_MS = 3_600_000;

/** Never check more often than once a minute. */
export const MIN_KEY_HEALTH_INTERVAL_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Development-only fallbacks. They are public by design and keep local runs
 * working; production refuses to use them.
 */
const DEV_SIGNING_KEY =
  "dev-integration-signing-secret-do-not-use-in-production";
const DEV_RAW_KEY = "dev-integration-raw-key-do-not-use-in-production";

const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEX_PATTERN = /^[0-9a-fA-F]*$/;

export type RawPayloadDecryptErrorCode =
  | "RAW_PAYLOAD_DECRYPT_FAILED"
  | "RAW_PAYLOAD_KEY_MISSING"
  | "RAW_PAYLOAD_FORMAT_INVALID";

/**
 * Raised when stored raw payload ciphertext cannot be decrypted.
 *
 * The callers must not convert this into an empty payload. `code` is stable
 * and intended for metrics/alert routing:
 *   - RAW_PAYLOAD_FORMAT_INVALID: not a v1/v2 envelope, or malformed hex/length
 *   - RAW_PAYLOAD_KEY_MISSING:   ciphertext keyId is not the active keyId
 *   - RAW_PAYLOAD_DECRYPT_FAILED: authentication failed (tamper or wrong key)
 */
export class RawPayloadDecryptError extends Error {
  readonly code: RawPayloadDecryptErrorCode;

  constructor(
    code: RawPayloadDecryptErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RawPayloadDecryptError";
    this.code = code;
  }
}

/**
 * Raised by `resolveIntegrationKeys` when the key configuration is unsafe.
 * The API/worker should let this abort startup (fail-closed).
 */
export class IntegrationKeyConfigError extends Error {
  readonly code = "INTEGRATION_KEY_CONFIG_INVALID" as const;
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      "Refusing to configure integration webhook cryptography:\n" +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
    this.name = "IntegrationKeyConfigError";
    this.problems = [...problems];
  }
}

export interface IntegrationCryptoOptions {
  /** Environment source; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Environment name; defaults to `env.NODE_ENV` then `"development"`. */
  nodeEnv?: string;
  /** Explicit signing secret (tests / dependency injection). */
  signingSecret?: string;
  /** Explicit raw payload encryption key (tests / dependency injection). */
  rawEncryptionKey?: string;
  /** Envelope key id; defaults to `env.WEBHOOK_KEY_ID` then `"v1"`. */
  keyId?: string;
  /**
   * Keyring for rotation (KMS/Vault exported map): keyId -> raw key.
   * New ciphertexts use the active key; old keyIds remain decryptable.
   */
  rawKeys?: Record<string, string>;
  /** Verification keyring: keyId -> signing secret (dual-signature window). */
  signingKeys?: Record<string, string>;
  /**
   * Clock injection (tests / deterministic health ages). Defaults to the real
   * clock; only used for load timestamps, age and alert timestamps.
   */
  now?: () => Date;
  /**
   * Maximum key age in days; defaults to `env.WEBHOOK_KEY_MAX_AGE_DAYS`
   * (default 90, valid range 1-3650).
   */
  maxAgeDays?: number;
}

export interface ResolvedIntegrationKeys {
  /** HMAC server secret used to derive per-routing-key signatures. */
  signingKey: string;
  /** AES-256-GCM key material for raw webhook payloads. */
  rawKey: string;
  /** Key id written into new v2 ciphertexts. */
  keyId: string;
  /** True when at least one development fallback secret was used. */
  usedDevDefaults: boolean;
  /** All raw keys available for decryption (active first). */
  rawKeys: Record<string, string>;
  /** All signing secrets available for verification (active first). */
  signingKeys: Record<string, string>;
  /**
   * Where the key material came from: `FILE` for the KMS/Vault projected
   * keyring file, `ENV` for environment / explicit injection.
   */
  source: IntegrationKeySource;
}

/** Source of the keyring material (never includes the material itself). */
export type IntegrationKeySource = "FILE" | "ENV";

/**
 * Keyless rotation-health snapshot. It must never carry key material; the
 * admin endpoint returns it verbatim, so every field is safe to publish.
 */
export interface IntegrationKeyHealth {
  /** False when the active key is over age or the last reload failed. */
  ok: boolean;
  /** Key id used for new ciphertexts. */
  activeKeyId: string;
  /** Number of raw keys currently in the keyring. */
  keyCount: number;
  /** Raw key ids in the keyring (ids only, never values). */
  keyIds: string[];
  /** FILE when the keyring came from WEBHOOK_KEYRING_FILE, else ENV. */
  source: IntegrationKeySource;
  /** ISO timestamp of the last successful keyring load (process-local). */
  lastLoadedAt: string;
  /** Age of the active key material in days (2 decimals). */
  ageDays: number;
  /** True when ageDays > the configured maximum age. */
  rotationDue: boolean;
  /** The maximum age in force (WEBHOOK_KEY_MAX_AGE_DAYS, default 90). */
  maxAgeDays: number;
  /** True when the process fell back to public development keys. */
  usedDevDefaults: boolean;
  /** Sanitized reason of the last failed reload; never contains key material. */
  lastError?: string;
}

export interface IntegrationCrypto {
  /** HMAC-SHA256(signingKey, routingKey) as lowercase hex. */
  signingKeyFor(routingKey: string): string;
  /** Encrypts UTF-8 text into a `v2:<keyId>:<iv>:<tag>:<data>` envelope. */
  encryptRawPayload(text: string): string;
  /** Decrypts a v2 envelope or a legacy `v1:<iv>:<tag>:<data>` envelope. */
  decryptRawPayload(stored: string): string;
  /**
   * All verification keys for a routing key, active first. During rotation
   * this lets the webhook endpoint accept signatures from the old key while
   * the new key becomes active.
   */
  signatureKeysFor(routingKey: string): string[];
  /** Re-reads the keyring file / env and swaps keys atomically. */
  reload(): void;
  /**
   * Keyless rotation-health snapshot (age, rotationDue, lastError, source).
   * `at` overrides the clock for the age computation.
   */
  keyHealth(at?: Date): IntegrationKeyHealth;
  readonly keyId: string;
  readonly keyIds: string[];
  readonly usedDevDefaults: boolean;
}

interface ParsedCiphertext {
  version: typeof RAW_PAYLOAD_ENVELOPE_VERSION | "v1";
  keyId?: string;
  iv: Buffer;
  tag: Buffer;
  data: Buffer;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolves `WEBHOOK_KEY_MAX_AGE_DAYS` (default 90, valid range 1-3650).
 *
 * An unusable value never blocks startup (rotation health is advisory); it is
 * reported as a warning so the API can log it once and keep the default.
 */
export function resolveWebhookKeyMaxAgeDays(
  env: NodeJS.ProcessEnv = process.env,
): { days: number; warning?: string } {
  const raw = env.WEBHOOK_KEY_MAX_AGE_DAYS;
  if (!hasText(raw)) return { days: DEFAULT_WEBHOOK_KEY_MAX_AGE_DAYS };
  const parsed = Number(raw.trim());
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_WEBHOOK_KEY_MAX_AGE_DAYS ||
    parsed > MAX_WEBHOOK_KEY_MAX_AGE_DAYS
  ) {
    return {
      days: DEFAULT_WEBHOOK_KEY_MAX_AGE_DAYS,
      warning:
        `WEBHOOK_KEY_MAX_AGE_DAYS must be an integer between ` +
        `${MIN_WEBHOOK_KEY_MAX_AGE_DAYS} and ${MAX_WEBHOOK_KEY_MAX_AGE_DAYS} ` +
        `(got ${JSON.stringify(raw)}); using ${DEFAULT_WEBHOOK_KEY_MAX_AGE_DAYS}`,
    };
  }
  return { days: parsed };
}

/**
 * Turns a failed keyring load into a publishable reason.
 *
 * `IntegrationKeyConfigError.problems` describe configuration names and key
 * ids only, never values; any other error is reduced to a generic message so a
 * future error shape (or a file read failure) cannot leak material through
 * `GET /api/v1/integration-keys/health`.
 */
function describeKeyLoadError(error: unknown): string {
  const message =
    error instanceof IntegrationKeyConfigError
      ? error.problems.join("; ") || "integration key configuration is invalid"
      : "integration key reload failed; see server logs for details";
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatError(message: string): RawPayloadDecryptError {
  return new RawPayloadDecryptError("RAW_PAYLOAD_FORMAT_INVALID", message);
}

function parseHex(value: string, label: string): Buffer {
  if (!HEX_PATTERN.test(value) || value.length % 2 !== 0) {
    throw formatError(`raw payload ciphertext ${label} is not valid hexadecimal`);
  }
  return Buffer.from(value, "hex");
}

function parseFixedHex(value: string, bytes: number, label: string): Buffer {
  if (value.length !== bytes * 2) {
    throw formatError(
      `raw payload ciphertext ${label} must be ${bytes} bytes (${bytes * 2} hex characters)`,
    );
  }
  return parseHex(value, label);
}

function parseCiphertext(stored: unknown): ParsedCiphertext {
  if (typeof stored !== "string" || stored.length === 0) {
    throw formatError("raw payload ciphertext must be a non-empty string");
  }

  const parts = stored.split(":");
  const version = parts[0];

  if (version === "v1") {
    if (parts.length !== 4) {
      throw formatError(
        "legacy v1 ciphertext must have 4 colon-separated fields (v1:<iv>:<tag>:<data>)",
      );
    }
    const ivHex = parts[1]!;
    const tagHex = parts[2]!;
    const dataHex = parts[3]!;
    return {
      version,
      iv: parseFixedHex(ivHex, 12, "iv"),
      tag: parseFixedHex(tagHex, 16, "authentication tag"),
      data: parseHex(dataHex, "data"),
    };
  }

  if (version === RAW_PAYLOAD_ENVELOPE_VERSION) {
    if (parts.length !== 5) {
      throw formatError(
        "v2 ciphertext must have 5 colon-separated fields (v2:<keyId>:<iv>:<tag>:<data>)",
      );
    }
    const keyId = parts[1]!;
    const ivHex = parts[2]!;
    const tagHex = parts[3]!;
    const dataHex = parts[4]!;
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw formatError("v2 ciphertext keyId is missing or malformed");
    }
    return {
      version,
      keyId,
      iv: parseFixedHex(ivHex, 12, "iv"),
      tag: parseFixedHex(tagHex, 16, "authentication tag"),
      data: parseHex(dataHex, "data"),
    };
  }

  throw formatError(
    `unsupported raw payload ciphertext version ${JSON.stringify(version ?? "")}; expected "v1" or "v2"`,
  );
}

/**
 * Resolves and validates the integration signing key and raw encryption key.
 *
 * Rules:
 *   - explicit `signingSecret` / `rawEncryptionKey` win (tests, DI);
 *   - otherwise `env.WEBHOOK_SIGNING_SECRET` / `env.WEBHOOK_RAW_KEY`;
 *   - production: both required, each >= 32 chars, and different, else throw;
 *   - non-production: missing values fall back to public dev defaults and set
 *     `usedDevDefaults: true`; values that are present must still differ;
 *   - `SESSION_SECRET` is never consulted.
 */
export function resolveIntegrationKeys(
  options: IntegrationCryptoOptions = {},
): ResolvedIntegrationKeys {
  const env = options.env ?? process.env;
  const nodeEnv = options.nodeEnv ?? env.NODE_ENV ?? "development";
  const production = nodeEnv === "production";
  const problems: string[] = [];

  const requestedKeyId = hasText(options.keyId)
    ? options.keyId
    : hasText(env.WEBHOOK_KEY_ID)
      ? env.WEBHOOK_KEY_ID
      : DEFAULT_WEBHOOK_KEY_ID;
  if (!KEY_ID_PATTERN.test(requestedKeyId)) {
    problems.push(
      `WEBHOOK_KEY_ID must be 1-64 characters of [A-Za-z0-9._-] and start alphanumeric ` +
        `(got ${JSON.stringify(requestedKeyId)})`,
    );
  }

  const fileKeyring = loadKeyringFile(env, problems);
  const rawKeyring: Record<string, string> = {
    ...(fileKeyring?.rawKeys ?? {}),
    ...parseKeyring(options.rawKeys, "rawKeys", problems),
    ...parseKeyring(
      jsonKeyring(env.WEBHOOK_RAW_KEYS_JSON, "WEBHOOK_RAW_KEYS_JSON", problems),
      "WEBHOOK_RAW_KEYS_JSON",
      problems,
    ),
  };
  const signingKeyring: Record<string, string> = {
    ...(fileKeyring?.signingKeys ?? {}),
    ...parseKeyring(options.signingKeys, "signingKeys", problems),
    ...parseKeyring(
      jsonKeyring(
        env.WEBHOOK_SIGNING_KEYS_JSON,
        "WEBHOOK_SIGNING_KEYS_JSON",
        problems,
      ),
      "WEBHOOK_SIGNING_KEYS_JSON",
      problems,
    ),
  };

  // Source is provenance only: FILE when the KMS/Vault projection supplied at
  // least one key, ENV for env vars / explicit injection.
  const fileKeyringHasKeys = Boolean(
    fileKeyring &&
      (Object.keys(fileKeyring.rawKeys).length > 0 ||
        Object.keys(fileKeyring.signingKeys).length > 0),
  );
  const source: IntegrationKeySource = fileKeyringHasKeys ? "FILE" : "ENV";

  let signingKey: string | undefined = hasText(options.signingSecret)
    ? options.signingSecret
    : hasText(env.WEBHOOK_SIGNING_SECRET)
      ? env.WEBHOOK_SIGNING_SECRET
      : signingKeyring[requestedKeyId];
  let rawKey: string | undefined = hasText(options.rawEncryptionKey)
    ? options.rawEncryptionKey
    : hasText(env.WEBHOOK_RAW_KEY)
      ? env.WEBHOOK_RAW_KEY
      : rawKeyring[requestedKeyId];

  let usedDevDefaults = false;

  if (!signingKey) {
    if (production) {
      problems.push(
        "WEBHOOK_SIGNING_SECRET is required in production (>= 32 characters, " +
          "independent from SESSION_SECRET)",
      );
    } else {
      signingKey = DEV_SIGNING_KEY;
      usedDevDefaults = true;
    }
  }

  if (!rawKey) {
    if (production) {
      problems.push(
        "WEBHOOK_RAW_KEY is required in production (>= 32 characters, " +
          "independent from WEBHOOK_RAW_KEY)",
      );
    } else {
      rawKey = DEV_RAW_KEY;
      usedDevDefaults = true;
    }
  }

  if (production) {
    if (signingKey && signingKey.length < MIN_INTEGRATION_KEY_LENGTH) {
      problems.push(
        `WEBHOOK_SIGNING_SECRET must be at least ${MIN_INTEGRATION_KEY_LENGTH} characters ` +
          `in production (got ${signingKey.length}); use a high-entropy random secret`,
      );
    }
    if (rawKey && rawKey.length < MIN_INTEGRATION_KEY_LENGTH) {
      problems.push(
        `WEBHOOK_RAW_KEY must be at least ${MIN_INTEGRATION_KEY_LENGTH} characters ` +
          `in production (got ${rawKey.length}); use a high-entropy random key`,
      );
    }
    for (const [keyId, value] of Object.entries(rawKeyring)) {
      if (value.length < MIN_INTEGRATION_KEY_LENGTH) {
        problems.push(
          `WEBHOOK_RAW_KEYS_JSON[${keyId}] must be at least ${MIN_INTEGRATION_KEY_LENGTH} characters in production`,
        );
      }
    }
    for (const [keyId, value] of Object.entries(signingKeyring)) {
      if (value.length < MIN_INTEGRATION_KEY_LENGTH) {
        problems.push(
          `WEBHOOK_SIGNING_KEYS_JSON[${keyId}] must be at least ${MIN_INTEGRATION_KEY_LENGTH} characters in production`,
        );
      }
    }
  }

  if (!signingKey || !rawKey) {
    // 保留 fail-closed：即使上面的分支被改动，也绝不返回空密钥。
    if (production) {
      throw new IntegrationKeyConfigError(problems);
    }
    signingKey ??= DEV_SIGNING_KEY;
    rawKey ??= DEV_RAW_KEY;
  }

  const signingKeyId = hasText(options.keyId)
    ? options.keyId
    : hasText(env.WEBHOOK_SIGNING_KEY_ID)
      ? env.WEBHOOK_SIGNING_KEY_ID
      : requestedKeyId;
  if (!KEY_ID_PATTERN.test(signingKeyId)) {
    problems.push(
      `WEBHOOK_SIGNING_KEY_ID must be 1-64 characters of [A-Za-z0-9._-] and start alphanumeric`,
    );
  }

  const allSigning = { ...signingKeyring, [signingKeyId]: signingKey };
  const allRaw = { ...rawKeyring, [requestedKeyId]: rawKey };
  for (const [signingId, signingValue] of Object.entries(allSigning)) {
    for (const [rawId, rawValue] of Object.entries(allRaw)) {
      if (signingValue === rawValue) {
        problems.push(
          `signing key ${JSON.stringify(signingId)} and raw key ${JSON.stringify(rawId)} ` +
            "must be different values; webhook signing must never double as payload encryption",
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new IntegrationKeyConfigError(problems);
  }

  return {
    signingKey,
    rawKey,
    keyId: requestedKeyId,
    usedDevDefaults,
    rawKeys: allRaw,
    signingKeys: allSigning,
    source,
  };
}

/**
 * Optional KMS/Vault bridge: a file containing
 * `{ "rawKeys": {...}, "signingKeys": {...} }`.
 *
 * Kubernetes CSI / Vault Agent / AWS Secrets Manager sidecars can project the
 * keyring to a file without putting secrets in process environment (which is
 * readable via /proc/<pid>/environ and crash dumps). The file is read once at
 * startup; rotating it requires a restart or an external reload.
 */
function loadKeyringFile(
  env: NodeJS.ProcessEnv,
  problems: string[],
): { rawKeys: Record<string, string>; signingKeys: Record<string, string> } | undefined {
  const path = env.WEBHOOK_KEYRING_FILE;
  if (!hasText(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      problems.push("WEBHOOK_KEYRING_FILE must contain a JSON object");
      return undefined;
    }
    const record = parsed as {
      rawKeys?: Record<string, string>;
      signingKeys?: Record<string, string>;
    };
    return {
      rawKeys: parseKeyring(record.rawKeys, "WEBHOOK_KEYRING_FILE.rawKeys", problems),
      signingKeys: parseKeyring(
        record.signingKeys,
        "WEBHOOK_KEYRING_FILE.signingKeys",
        problems,
      ),
    };
  } catch (error) {
    // Never echo error.message: a JSON.parse error embeds a snippet of the
    // file, which may be raw key material. errno codes are safe.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    problems.push(
      "WEBHOOK_KEYRING_FILE cannot be read: " +
        (typeof code === "string" ? code : "invalid JSON or unreadable file"),
    );
    return undefined;
  }
}

function jsonKeyring(
  value: string | undefined,
  label: string,
  problems: string[],
): Record<string, string> | undefined {
  if (!hasText(value)) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      problems.push(`${label} must be a JSON object of { keyId: secret }`);
      return undefined;
    }
    return parsed as Record<string, string>;
  } catch {
    problems.push(`${label} is not valid JSON`);
    return undefined;
  }
}

function parseKeyring(
  input: Record<string, string> | undefined,
  label: string,
  problems: string[],
): Record<string, string> {
  if (!input) return {};
  const result: Record<string, string> = {};
  if (typeof input !== "object" || Array.isArray(input)) {
    problems.push(`${label} must be an object of { keyId: secret }`);
    return result;
  }
  for (const [keyId, value] of Object.entries(input)) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      problems.push(`${label} key id ${JSON.stringify(keyId)} is malformed`);
      continue;
    }
    if (typeof value !== "string" || value.length === 0) {
      problems.push(`${label}[${keyId}] must be a non-empty string`);
      continue;
    }
    result[keyId] = value;
  }
  return result;
}

/**
 * Builds the webhook signing/encryption helpers from validated keys.
 *
 * The returned functions are pure closures over the resolved key material:
 * there is no module-level mutable state, so separate API/worker instances
 * can safely use different keys (for example during rotation).
 */
export function createIntegrationCrypto(
  options: IntegrationCryptoOptions = {},
): IntegrationCrypto {
  let keys = resolveIntegrationKeys(options);
  let rawKeys: Record<string, Buffer> = {};
  let activeRawKey: Buffer = Buffer.alloc(32);
  let keyId = keys.keyId;

  const env = options.env ?? process.env;
  const clock = options.now ?? (() => new Date());
  /** keyId -> when this process first saw that key material. */
  let keyLoads = new Map<string, { fingerprint: string; loadedAt: number }>();
  let lastLoadedAt = 0;
  let source: IntegrationKeySource = keys.source;
  let maxAgeDays = DEFAULT_WEBHOOK_KEY_MAX_AGE_DAYS;
  let lastError: string | undefined;

  const resolveMaxAge = (): number => {
    if (options.maxAgeDays === undefined) {
      return resolveWebhookKeyMaxAgeDays(env).days;
    }
    const value = options.maxAgeDays;
    if (
      !Number.isInteger(value) ||
      value < MIN_WEBHOOK_KEY_MAX_AGE_DAYS ||
      value > MAX_WEBHOOK_KEY_MAX_AGE_DAYS
    ) {
      throw new TypeError(
        `maxAgeDays must be an integer between ${MIN_WEBHOOK_KEY_MAX_AGE_DAYS} ` +
          `and ${MAX_WEBHOOK_KEY_MAX_AGE_DAYS} (got ${String(value)})`,
      );
    }
    return value;
  };

  const apply = (next: ResolvedIntegrationKeys): void => {
    // Validate plus derive everything before mutating, so a failed reload keeps
    // the previous keyring fully intact (atomic swap).
    const nextMaxAge = resolveMaxAge();
    const loadedAtMs = clock().getTime();
    const nextKeys: Record<string, Buffer> = {};
    const nextLoads = new Map<
      string,
      { fingerprint: string; loadedAt: number }
    >();
    for (const [id, value] of Object.entries(next.rawKeys)) {
      const derived = createHash("sha256").update(value, "utf8").digest();
      nextKeys[id] = derived;
      const fingerprint = derived.toString("hex");
      const previous = keyLoads.get(id);
      // Same material => keep the original load time: a no-op reload must not
      // hide an overdue rotation. New/rotated material starts its own clock.
      nextLoads.set(
        id,
        previous && previous.fingerprint === fingerprint
          ? previous
          : { fingerprint, loadedAt: loadedAtMs },
      );
    }
    keys = next;
    rawKeys = nextKeys;
    keyLoads = nextLoads;
    activeRawKey = rawKeys[next.keyId]!;
    keyId = next.keyId;
    source = next.source;
    lastLoadedAt = loadedAtMs;
    maxAgeDays = nextMaxAge;
    lastError = undefined;
  };
  apply(keys);

  const signatureKeysFor = (routingKey: string): string[] => {
    if (typeof routingKey !== "string") {
      throw new TypeError("signatureKeysFor expects a routing key string");
    }
    const seen = new Set<string>();
    const result: string[] = [];
    for (const secret of Object.values(keys.signingKeys)) {
      const derived = createHmac("sha256", secret)
        .update(routingKey, "utf8")
        .digest("hex");
      if (!seen.has(derived)) {
        seen.add(derived);
        result.push(derived);
      }
    }
    return result;
  };

  return {
    get keyId() {
      return keyId;
    },
    get keyIds() {
      return Object.keys(rawKeys);
    },
    get usedDevDefaults() {
      return keys.usedDevDefaults;
    },

    reload(): void {
      try {
        apply(resolveIntegrationKeys(options));
      } catch (error) {
        // Keep serving the previous keyring, but publish why the new one was
        // rejected. describeKeyLoadError never echoes key material.
        lastError = describeKeyLoadError(error);
        throw error;
      }
    },

    keyHealth(at?: Date): IntegrationKeyHealth {
      const nowMs = (at ?? clock()).getTime();
      const active = keyLoads.get(keyId);
      const ageDays = round2(
        active ? Math.max(0, (nowMs - active.loadedAt) / DAY_MS) : 0,
      );
      const rotationDue = ageDays > maxAgeDays;
      return {
        ok: !rotationDue && lastError === undefined,
        activeKeyId: keyId,
        keyCount: Object.keys(rawKeys).length,
        keyIds: Object.keys(rawKeys),
        source,
        lastLoadedAt: new Date(lastLoadedAt).toISOString(),
        ageDays,
        rotationDue,
        maxAgeDays,
        usedDevDefaults: keys.usedDevDefaults,
        ...(lastError === undefined ? {} : { lastError }),
      };
    },

    signatureKeysFor,

    signingKeyFor(routingKey: string): string {
      return signatureKeysFor(routingKey)[0]!;
    },

    encryptRawPayload(text: string): string {
      if (typeof text !== "string") {
        throw new TypeError("encryptRawPayload expects a string");
      }
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", activeRawKey, iv);
      const data = Buffer.concat([
        cipher.update(text, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return [
        RAW_PAYLOAD_ENVELOPE_VERSION,
        keyId,
        iv.toString("hex"),
        tag.toString("hex"),
        data.toString("hex"),
      ].join(":");
    },

    decryptRawPayload(stored: string): string {
      const parsed = parseCiphertext(stored);

      if (parsed.version === RAW_PAYLOAD_ENVELOPE_VERSION) {
        const key = parsed.keyId ? rawKeys[parsed.keyId] : undefined;
        if (!key) {
          throw new RawPayloadDecryptError(
            "RAW_PAYLOAD_KEY_MISSING",
            `raw payload ciphertext was encrypted with keyId ${JSON.stringify(parsed.keyId)} ` +
              `but the keyring only has ${JSON.stringify(Object.keys(rawKeys))}; ` +
              "retain the old key in WEBHOOK_RAW_KEYS_JSON to read it",
          );
        }
        try {
          const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv);
          decipher.setAuthTag(parsed.tag);
          return Buffer.concat([
            decipher.update(parsed.data),
            decipher.final(),
          ]).toString("utf8");
        } catch (cause) {
          throw new RawPayloadDecryptError(
            "RAW_PAYLOAD_DECRYPT_FAILED",
            "raw payload decryption failed: authentication tag mismatch " +
              "(ciphertext was tampered with or the raw key is wrong)",
            { cause },
          );
        }
      }

      let lastError: unknown;
      const candidates: Array<[string, Buffer]> = [
        [keyId, activeRawKey],
        ...Object.entries(rawKeys).filter(([id]) => id !== keyId),
      ];
      for (const [, key] of candidates) {
        try {
          const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv);
          decipher.setAuthTag(parsed.tag);
          return Buffer.concat([
            decipher.update(parsed.data),
            decipher.final(),
          ]).toString("utf8");
        } catch (cause) {
          lastError = cause;
        }
      }
      throw new RawPayloadDecryptError(
        "RAW_PAYLOAD_DECRYPT_FAILED",
        "legacy v1 raw payload could not be decrypted with any key in the keyring",
        { cause: lastError },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Rotation health alerting (WEBHOOK_KEY_ALERT_URL) / startup + periodic check
// ---------------------------------------------------------------------------

export type IntegrationKeyAlertEvent = "rotation_due" | "reload_failed";

/**
 * Exact JSON body POSTed to `WEBHOOK_KEY_ALERT_URL`. It contains key *ids* and
 * ages only; key material must never appear here.
 */
export interface IntegrationKeyAlertPayload {
  event: IntegrationKeyAlertEvent;
  activeKeyId: string;
  ageDays: number;
  at: string;
}

export interface IntegrationKeyAlertResult {
  sent: boolean;
  status?: number;
  error?: string;
}

export interface SendIntegrationKeyAlertOptions {
  url: string;
  payload: IntegrationKeyAlertPayload;
  /** fetch injection for tests; defaults to the runtime global fetch. */
  fetchImpl?: typeof fetch;
  /** Timeout in ms; defaults to KEY_ALERT_TIMEOUT_MS (5s). */
  timeoutMs?: number;
}

/**
 * POSTs one rotation alert.
 *
 * Contract:
 *   - the URL must be an absolute http(s) URL; anything else is refused;
 *   - the request is aborted after `timeoutMs` (default 5s);
 *   - it NEVER throws and NEVER retries, so alerting cannot recurse into
 *     another alert; the failure is returned for the caller to log once.
 */
export async function sendIntegrationKeyAlert(
  options: SendIntegrationKeyAlertOptions,
): Promise<IntegrationKeyAlertResult> {
  const timeoutMs = Math.max(1, options.timeoutMs ?? KEY_ALERT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { sent: false, error: "fetch is unavailable in this runtime" };
  }

  let url: URL;
  try {
    url = new URL(String(options.url).trim());
  } catch {
    return { sent: false, error: "WEBHOOK_KEY_ALERT_URL is not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      sent: false,
      error: "WEBHOOK_KEY_ALERT_URL must be an absolute http(s) URL",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        sent: false,
        status: response.status,
        error: `alert endpoint returned ${response.status}`,
      };
    }
    return { sent: true, status: response.status };
  } catch (error) {
    return {
      sent: false,
      error: controller.signal.aborted
        ? `alert POST timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "alert POST failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal logger surface the health monitor needs (Fastify's `app.log` fits). */
export interface KeyRotationLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface KeyRotationMonitorOptions {
  /** Anything that can answer `keyHealth()` (a crypto instance or a stub). */
  crypto: Pick<IntegrationCrypto, "keyHealth">;
  /** `WEBHOOK_KEY_ALERT_URL`; blank/omitted disables POSTing (health still works). */
  alertUrl?: string;
  fetchImpl?: typeof fetch;
  /** Alert POST timeout; defaults to KEY_ALERT_TIMEOUT_MS (5s). */
  timeoutMs?: number;
  logger?: KeyRotationLogger;
  countEvent?: (event: string) => void;
  now?: () => Date;
  /** Check interval; <= 0 runs the startup check only. Default 1h. */
  intervalMs?: number;
}

export interface KeyRotationMonitor {
  /**
   * Runs one check and resolves with the health snapshot. Alert delivery and
   * logging failures never throw (an over-age key is never fatal).
   */
  check(): Promise<IntegrationKeyHealth>;
  /**
   * Records (logs + alerts) a failed reload. Call it from the rotate/reload
   * routes after the crypto instance rejected the new keyring. Never throws.
   */
  reportReloadFailure(): Promise<void>;
  /** Startup check (not awaited) plus the periodic timer; never blocks startup. */
  start(): void;
  stop(): void;
}

/**
 * Builds the rotation health monitor used by the integration routes.
 *
 * Behaviour (deliberately non-fatal):
 *   - the startup check runs without blocking listen(); an over-age key only
 *     produces a logger warning + counter, never an exception;
 *   - an over-age key POSTs `rotation_due` at most once per (event, activeKeyId)
 *     per process — a later rotation changes activeKeyId and re-arms it;
 *   - every failed reload POSTs `reload_failed` (it is an operation, not a
 *     recurring state);
 *   - a failed alert POST is logged and counted, never retried inline.
 */
export function createKeyRotationMonitor(
  options: KeyRotationMonitorOptions,
): KeyRotationMonitor {
  const clock = options.now ?? (() => new Date());
  const intervalMs = options.intervalMs ?? DEFAULT_KEY_HEALTH_INTERVAL_MS;
  const alertUrl = hasText(options.alertUrl) ? options.alertUrl.trim() : undefined;
  const alertedStates = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let stopped = false;

  const warn = (message: string, meta?: Record<string, unknown>): void => {
    try {
      options.logger?.warn(message, meta);
    } catch {
      /* logging must never break the check */
    }
  };

  const send = async (
    event: IntegrationKeyAlertEvent,
    health: IntegrationKeyHealth,
  ): Promise<void> => {
    if (!alertUrl) return;
    const payload: IntegrationKeyAlertPayload = {
      event,
      activeKeyId: health.activeKeyId,
      ageDays: health.ageDays,
      at: clock().toISOString(),
    };
    let result: IntegrationKeyAlertResult;
    try {
      result = await sendIntegrationKeyAlert({
        url: alertUrl,
        payload,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      // sendIntegrationKeyAlert never throws; keep the monitor total anyway.
      result = {
        sent: false,
        error: error instanceof Error ? error.message : "alert POST failed",
      };
    }
    if (result.sent) {
      options.countEvent?.("integration_keys_alert_sent");
      return;
    }
    options.countEvent?.("integration_keys_alert_failed");
    // 告警投递失败只记日志：不重试、不再触发新的告警（不递归）。
    warn("integration key rotation alert delivery failed", {
      event,
      activeKeyId: payload.activeKeyId,
      error: result.error,
    });
  };

  /** Applies the alerting policy for one snapshot; never throws. */
  const evaluate = async (health: IntegrationKeyHealth): Promise<void> => {
    if (!health.rotationDue) return;
    warn("integration webhook key rotation is overdue", {
      activeKeyId: health.activeKeyId,
      ageDays: health.ageDays,
      maxAgeDays: health.maxAgeDays,
    });
    options.countEvent?.("integration_keys_rotation_due");
    const state = `rotation_due:${health.activeKeyId}`;
    if (alertedStates.has(state)) return;
    alertedStates.add(state);
    await send("rotation_due", health);
  };

  const guardedCheck = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const health = options.crypto.keyHealth(clock());
      await evaluate(health);
    } catch (error) {
      // 健康检查绝不阻断启动或进程。
      warn("integration key health check failed", {
        error: error instanceof Error ? error.message : "unknown error",
      });
    } finally {
      running = false;
    }
  };

  return {
    async check(): Promise<IntegrationKeyHealth> {
      const health = options.crypto.keyHealth(clock());
      await evaluate(health);
      return health;
    },

    async reportReloadFailure(): Promise<void> {
      let health: IntegrationKeyHealth;
      try {
        health = options.crypto.keyHealth(clock());
      } catch {
        return;
      }
      warn(
        "integration webhook keyring reload failed; previous keys stay active",
        {
          activeKeyId: health.activeKeyId,
          error: health.lastError ?? "unknown keyring error",
        },
      );
      options.countEvent?.("integration_keys_reload_failed");
      await send("reload_failed", health);
    },

    start(): void {
      if (stopped || timer !== undefined) return;
      // 启动检查不阻塞 listen()：超龄只告警日志，不阻断启动。
      void guardedCheck();
      if (intervalMs > 0) {
        timer = setInterval(() => {
          void guardedCheck();
        }, intervalMs);
        timer.unref?.();
      }
    },

    stop(): void {
      stopped = true;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
