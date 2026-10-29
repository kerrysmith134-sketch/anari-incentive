import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Feishu/Lark event signature: SHA256 over
 * `${timestamp}${nonce}${encryptKey}${body}` as a hex string.
 */
export function computeFeishuSignature(input: {
  encryptKey: string;
  timestamp: string;
  nonce: string;
  body: string | Buffer;
}): string {
  return createHash("sha256")
    .update(input.timestamp)
    .update(input.nonce)
    .update(input.encryptKey)
    .update(input.body)
    .digest("hex");
}

export function verifyFeishuSignature(input: {
  encryptKey: string;
  timestamp: string | undefined;
  nonce: string | undefined;
  body: string | Buffer;
  signature: string | undefined;
}): boolean {
  if (
    input.timestamp === undefined ||
    input.nonce === undefined ||
    input.signature === undefined
  ) {
    return false;
  }
  const expected = computeFeishuSignature({
    encryptKey: input.encryptKey,
    timestamp: input.timestamp,
    nonce: input.nonce,
    body: input.body,
  });
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(input.signature, "utf8");
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

export class FeishuTokenError extends Error {
  readonly code = "FEISHU_TOKEN_ERROR";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FeishuTokenError";
  }
}

export interface FeishuToken {
  accessToken: string;
  expiresAt: number;
}

export interface FeishuTenantTokenConfig {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  refreshSkewMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface FeishuTokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

/** Tenant access token source with in-memory caching and coalesced refresh. */
export class FeishuTenantTokenSource {
  private token?: FeishuToken;
  private pending?: Promise<FeishuToken>;

  constructor(private readonly config: FeishuTenantTokenConfig) {}

  async getToken(): Promise<string> {
    const now = this.now();
    const skew = this.config.refreshSkewMs ?? 30_000;
    if (this.token && this.token.expiresAt - skew > now) {
      return this.token.accessToken;
    }
    if (this.pending) return (await this.pending).accessToken;
    this.pending = this.fetchToken().finally(() => {
      this.pending = undefined;
    });
    return (await this.pending).accessToken;
  }

  private now(): number {
    return this.config.now ? this.config.now() : Date.now();
  }

  private async fetchToken(): Promise<FeishuToken> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const baseUrl = this.config.baseUrl ?? "https://open.feishu.cn";
    const response = await fetchImpl(
      `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new FeishuTokenError(
        `tenant token endpoint returned ${response.status}`,
        response.status,
      );
    }
    let json: FeishuTokenResponse;
    try {
      json = JSON.parse(text) as FeishuTokenResponse;
    } catch {
      throw new FeishuTokenError("tenant token endpoint returned invalid JSON");
    }
    if (json.code !== undefined && json.code !== 0) {
      throw new FeishuTokenError(
        `tenant token error ${json.code}: ${json.msg ?? "unknown"}`,
      );
    }
    if (!json.tenant_access_token) {
      throw new FeishuTokenError(
        "tenant token response is missing tenant_access_token",
      );
    }
    const token: FeishuToken = {
      accessToken: json.tenant_access_token,
      expiresAt: this.now() + Number(json.expire ?? 7200) * 1000,
    };
    this.token = token;
    return token;
  }
}
