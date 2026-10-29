export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Small fixed-window limiter for a single API process.
 *
 * Production deployments with more than one replica should enforce a shared
 * limit at the gateway as well; this limiter protects a single process and
 * keeps the API dependency-free.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private checks = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("rate limit must be a positive integer");
    }
    if (!Number.isInteger(windowMs) || windowMs < 1) {
      throw new Error("rate limit window must be a positive integer");
    }
  }

  check(key: string): RateLimitDecision {
    const now = this.now();
    this.checks += 1;
    if (this.checks % 1000 === 0) this.sweep(now);

    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return {
        allowed: true,
        remaining: this.limit - 1,
        retryAfterSeconds: 0,
      };
    }
    if (current.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.resetAt - now) / 1000),
        ),
      };
    }
    current.count += 1;
    return {
      allowed: true,
      remaining: this.limit - current.count,
      retryAfterSeconds: 0,
    };
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
