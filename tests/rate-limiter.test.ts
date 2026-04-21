import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateLimiter } from "../src/sync/rate-limiter.ts";

describe("RateLimiter", () => {
  let rl: RateLimiter;

  beforeEach(() => {
    rl = new RateLimiter();
    vi.useFakeTimers();
  });

  it("is not rate-limited by default", () => {
    expect(rl.isRateLimited).toBe(false);
  });

  it("parses x-ratelimit-remaining header", () => {
    rl.consumeHeaders({ "x-ratelimit-remaining": "42" });
    expect(rl.isRateLimited).toBe(false); // not paused, just low
  });

  it("activates secondary rate limit pause from retry-after header", () => {
    // retry-after: 60 seconds
    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    rl.consumeHeaders({ "retry-after": "60" });
    expect(rl.isRateLimited).toBe(true);
  });

  it("clears secondary pause after the retry-after period elapses", () => {
    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    rl.consumeHeaders({ "retry-after": "60" });
    vi.advanceTimersByTime(61_000);
    expect(rl.isRateLimited).toBe(false);
  });

  it("consumeHeaders accepts array header values", () => {
    rl.consumeHeaders({ "x-ratelimit-remaining": ["99", "ignored"] });
    // Should not throw
    expect(rl.isRateLimited).toBe(false);
  });

  it("waitIfPaused resolves immediately when not rate-limited", async () => {
    const onPaused = vi.fn();
    const p = rl.waitIfPaused(onPaused);
    vi.runAllTimers();
    await p;
    expect(onPaused).not.toHaveBeenCalled();
  });

  it("waitIfPaused calls onPaused callback when rate-limited", async () => {
    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    rl.consumeHeaders({ "retry-after": "30" });
    const onPaused = vi.fn();
    const p = rl.waitIfPaused(onPaused);
    vi.runAllTimers();
    await p;
    expect(onPaused).toHaveBeenCalledOnce();
  });
});
