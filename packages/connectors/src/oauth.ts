export class OAuthTokenError extends Error {
  readonly code = "OAUTH_TOKEN_ERROR";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OAuthTokenError";
  }
}

export interface OAuthToken {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
  scope?: string;
}

export interface ClientCredentialsConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
  /** Milliseconds before expiry at which a cached token is refreshed. */
  refreshSkewMs?: number;
  fetchImpl?: typeof fetch;
  /** Injectable clock in milliseconds, for tests. */
  now?: () => number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number | string;
  scope?: string;
  refresh_token?: string;
}

/**
 * Client-credentials token source with in-memory caching and coalesced
 * refreshes. Provider-specific connectors can call `getToken()` before each
 * request; the token is reused until shortly before expiry.
 */
export class ClientCredentialsTokenSource {
  private token?: OAuthToken;
  private pending?: Promise<OAuthToken>;

  constructor(private readonly config: ClientCredentialsConfig) {}

  async getToken(): Promise<string> {
    return (await this.getTokenRecord()).accessToken;
  }

  async getTokenRecord(): Promise<OAuthToken> {
    const now = this.now();
    const skew = this.config.refreshSkewMs ?? 30_000;
    if (this.token && this.token.expiresAt - skew > now) {
      return this.token;
    }
    if (this.pending) return this.pending;
    this.pending = this.fetchToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private now(): number {
    return this.config.now ? this.config.now() : Date.now();
  }

  private async fetchToken(): Promise<OAuthToken> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const body = new URLSearchParams({ grant_type: "client_credentials" });
    if (this.config.scope) body.set("scope", this.config.scope);
    if (this.config.audience) body.set("audience", this.config.audience);
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
      "utf8",
    ).toString("base64");
    const response = await fetchImpl(this.config.tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new OAuthTokenError(
        `token endpoint returned ${response.status}`,
        response.status,
      );
    }
    let json: TokenResponse;
    try {
      json = JSON.parse(text) as TokenResponse;
    } catch {
      throw new OAuthTokenError("token endpoint returned invalid JSON");
    }
    if (!json.access_token) {
      throw new OAuthTokenError("token response is missing access_token");
    }
    const expiresIn = Number(json.expires_in ?? 3600);
    const token: OAuthToken = {
      accessToken: json.access_token,
      tokenType: json.token_type ?? "Bearer",
      expiresAt: this.now() + expiresIn * 1000,
      scope: json.scope,
    };
    this.token = token;
    return token;
  }
}

export interface RefreshTokenConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  scope?: string;
  audience?: string;
  refreshSkewMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Refresh-token grant source for providers that issue long-lived refresh
 * tokens (for example HubSpot OAuth apps). Rotated refresh tokens are kept in
 * memory for subsequent refreshes.
 */
export class RefreshTokenSource {
  private token?: OAuthToken;
  private pending?: Promise<OAuthToken>;
  private refreshToken: string;

  constructor(private readonly config: RefreshTokenConfig) {
    this.refreshToken = config.refreshToken;
  }

  async getToken(): Promise<string> {
    return (await this.getTokenRecord()).accessToken;
  }

  async getTokenRecord(): Promise<OAuthToken> {
    const now = this.now();
    const skew = this.config.refreshSkewMs ?? 30_000;
    if (this.token && this.token.expiresAt - skew > now) {
      return this.token;
    }
    if (this.pending) return this.pending;
    this.pending = this.fetchToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private now(): number {
    return this.config.now ? this.config.now() : Date.now();
  }

  private async fetchToken(): Promise<OAuthToken> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
    });
    if (this.config.scope) body.set("scope", this.config.scope);
    if (this.config.audience) body.set("audience", this.config.audience);
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
      "utf8",
    ).toString("base64");
    const response = await fetchImpl(this.config.tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new OAuthTokenError(
        `token endpoint returned ${response.status}`,
        response.status,
      );
    }
    let json: TokenResponse;
    try {
      json = JSON.parse(text) as TokenResponse;
    } catch {
      throw new OAuthTokenError("token endpoint returned invalid JSON");
    }
    if (!json.access_token) {
      throw new OAuthTokenError("token response is missing access_token");
    }
    if (json.refresh_token) this.refreshToken = json.refresh_token;
    const expiresIn = Number(json.expires_in ?? 3600);
    const token: OAuthToken = {
      accessToken: json.access_token,
      tokenType: json.token_type ?? "Bearer",
      expiresAt: this.now() + expiresIn * 1000,
      scope: json.scope,
    };
    this.token = token;
    return token;
  }
}
