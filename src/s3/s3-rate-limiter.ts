// Tracks S3 throttling state and enforces backoff, mirroring the shape of
// src/sync/rate-limiter.ts. Unlike GitHub, S3 exposes no remaining-quota
// headers at all — there's nothing to read proactively, only errors to react
// to (503 SlowDown / RequestLimitExceeded / ThrottlingException) — so this
// reacts rather than budgets off headers.
//
// It also tracks a local, per-card request count over a rolling window as a
// self-imposed circuit breaker: not an AWS-enforced limit, just a defensive
// guard against a runaway recursive-listing bug or an accidental loop
// generating real charges with no backend around to notice.

const THROTTLE_CODES = new Set(["SlowDown", "RequestLimitExceeded", "ThrottlingException"]);
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const REQUEST_WINDOW_MS = 60_000;

export class S3RateLimiter {
  private pauseUntil = 0; // Unix ms
  private backoffMs = BASE_BACKOFF_MS;
  private requestTimestamps: number[] = [];

  /** True if a throttling error name/code should trigger backoff. */
  static isThrottleError(code: string | undefined): boolean {
    return !!code && THROTTLE_CODES.has(code);
  }

  /** Record a throttling response and compute the next backoff (exponential + jitter). */
  recordThrottle(): void {
    const jitter = Math.random() * this.backoffMs * 0.25;
    this.pauseUntil = Date.now() + this.backoffMs + jitter;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  /** Reset backoff after a request succeeds. */
  recordSuccess(): void {
    this.backoffMs = BASE_BACKOFF_MS;
  }

  /** If a backoff pause is active, wait it out and emit an event. */
  async waitIfPaused(onPaused?: (resumeAt: number) => void): Promise<void> {
    const now = Date.now();
    if (this.pauseUntil > now) {
      onPaused?.(this.pauseUntil);
      await sleep(this.pauseUntil - now);
    }
  }

  get isRateLimited(): boolean {
    return this.pauseUntil > Date.now();
  }

  /** Record one request against the local rolling-window guardrail counter. */
  recordRequest(): void {
    const now = Date.now();
    this.requestTimestamps.push(now);
    const cutoff = now - REQUEST_WINDOW_MS;
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0]! < cutoff) {
      this.requestTimestamps.shift();
    }
  }

  /** Requests recorded within the trailing REQUEST_WINDOW_MS window. */
  requestsInWindow(): number {
    const cutoff = Date.now() - REQUEST_WINDOW_MS;
    return this.requestTimestamps.filter((t) => t >= cutoff).length;
  }

  /** True once the local per-card soft budget is exceeded — a guardrail, not a hard AWS limit. */
  isOverBudget(maxRequestsPerWindow: number): boolean {
    return this.requestsInWindow() > maxRequestsPerWindow;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
