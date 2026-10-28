export interface TokenProvider {
  getToken(): Promise<string>;
}

/** Fixed bearer token, useful for local service accounts and tests. */
export class StaticTokenProvider implements TokenProvider {
  constructor(private readonly token: string) {}

  async getToken(): Promise<string> {
    return this.token;
  }
}

export interface ClientCredentialsConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
  /** Refresh this many seconds before expiry. Defaults to 60. */
  refreshMarginSeconds?: number;
  fetchImpl?: typeof fetch;
}

/**
 * OAuth 2.0 client-credentials token provider.
 *
 * Used by the worker so it can call an OIDC-protected API without a human
 * token. Access tokens are cached until shortly before expiry.
 */
export class ClientCredentialsTokenProvider implements TokenProvider {
  private cached?: { token: string; expiresAt: number };
  private inFlight?: Promise<string>;

  constructor(private readonly config: ClientCredentialsConfig) {}

  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached.token;
    }
    if (!this.inFlight) {
      this.inFlight = this.fetchToken().finally(() => {
        this.inFlight = undefined;
      });
    }
    return this.inFlight;
  }

  private async fetchToken(): Promise<string> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
    });
    if (this.config.scope) body.set("scope", this.config.scope);
    if (this.config.audience) body.set("audience", this.config.audience);

    const response = await fetchImpl(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(
          `${this.config.clientId}:${this.config.clientSecret}`,
        ).toString("base64")}`,
      },
      body: body.toString(),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !payload.access_token) {
      throw new Error(
        `OIDC client credentials failed: ${
          payload.error_description ?? payload.error ?? response.status
        }`,
      );
    }

    const expiresIn = Number(payload.expires_in ?? 300);
    const margin = this.config.refreshMarginSeconds ?? 60;
    const ttlSeconds = Math.max(expiresIn - margin, 5);
    this.cached = {
      token: payload.access_token,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    return payload.access_token;
  }
}
