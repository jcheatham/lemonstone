// Tracks GitHub API rate limit state and enforces backoff per §4.5.

export class RateLimiter {
  private remaining = 5000;
  private resetAt = 0; // Unix ms
  private pauseUntil = 0; // Unix ms — secondary rate limit pause

  /** Parse rate limit headers from a GitHub API response. */
  consumeHeaders(headers: Record<string, string | string[]>): void {
    const get = (k: string): string | undefined => {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    };
    const remaining = get("x-ratelimit-remaining");
    const reset = get("x-ratelimit-reset");
    const retryAfter = get("retry-after");

    if (remaining !== undefined) this.remaining = parseInt(remaining, 10);
    if (reset !== undefined) this.resetAt = parseInt(reset, 10) * 1000;
    if (retryAfter !== undefined) {
      const seconds = parseInt(retryAfter, 10);
      this.pauseUntil = Date.now() + seconds * 1000;
    }
  }

  /** If secondary rate limit is active, wait it out and emit an event. */
  async waitIfPaused(
    onPaused?: (resumeAt: number) => void
  ): Promise<void> {
    const now = Date.now();
    if (this.pauseUntil > now) {
      onPaused?.(this.pauseUntil);
      await sleep(this.pauseUntil - now);
    }
  }

  /** Throttle if primary rate limit is running low. */
  async throttleIfNeeded(): Promise<void> {
    if (this.remaining < 100 && this.resetAt > Date.now()) {
      // Space out requests — 5s per request until reset.
      await sleep(5000);
    }
  }

  get isRateLimited(): boolean {
    return this.pauseUntil > Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
