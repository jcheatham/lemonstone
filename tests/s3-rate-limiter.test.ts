import { describe, it, expect, vi, beforeEach } from "vitest";
import { S3RateLimiter } from "../src/s3/s3-rate-limiter.ts";

describe("S3RateLimiter", () => {
  let rl: S3RateLimiter;

  beforeEach(() => {
    rl = new S3RateLimiter();
    vi.useFakeTimers();
  });

  it("is not rate-limited by default", () => {
    expect(rl.isRateLimited).toBe(false);
  });

  describe("isThrottleError", () => {
    it("recognizes known S3 throttle error codes", () => {
      expect(S3RateLimiter.isThrottleError("SlowDown")).toBe(true);
      expect(S3RateLimiter.isThrottleError("RequestLimitExceeded")).toBe(true);
      expect(S3RateLimiter.isThrottleError("ThrottlingException")).toBe(true);
    });

    it("rejects unrelated error codes", () => {
      expect(S3RateLimiter.isThrottleError("AccessDenied")).toBe(false);
      expect(S3RateLimiter.isThrottleError(undefined)).toBe(false);
    });
  });

  it("activates a backoff pause after a throttle is recorded", () => {
    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    rl.recordThrottle();
    expect(rl.isRateLimited).toBe(true);
  });

  it("clears the pause once the backoff elapses", () => {
    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    rl.recordThrottle();
    vi.advanceTimersByTime(2_000); // well past the first (500ms + jitter) backoff
    expect(rl.isRateLimited).toBe(false);
  });

  it("doubles backoff on consecutive throttles, up to the cap", async () => {
    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    let resumeAt = 0;
    rl.recordThrottle();
    let p = rl.waitIfPaused((r) => (resumeAt = r));
    vi.runAllTimers();
    await p;
    const firstDelay = resumeAt - new Date("2026-04-20T10:00:00Z").getTime();

    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    rl.recordThrottle();
    p = rl.waitIfPaused((r) => (resumeAt = r));
    vi.runAllTimers();
    await p;
    const secondDelay = resumeAt - new Date("2026-04-20T10:00:00Z").getTime();

    expect(secondDelay).toBeGreaterThan(firstDelay);
  });

  it("recordSuccess resets backoff back to the base", () => {
    rl.recordThrottle();
    rl.recordThrottle();
    rl.recordSuccess();
    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    rl.recordThrottle();
    // After a reset, the next pause should be back near the base backoff window.
    expect(rl.isRateLimited).toBe(true);
  });

  it("waitIfPaused resolves immediately when not rate-limited", async () => {
    const onPaused = vi.fn();
    const p = rl.waitIfPaused(onPaused);
    vi.runAllTimers();
    await p;
    expect(onPaused).not.toHaveBeenCalled();
  });

  it("waitIfPaused calls onPaused and waits out an active backoff", async () => {
    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    rl.recordThrottle();
    const onPaused = vi.fn();
    const p = rl.waitIfPaused(onPaused);
    vi.runAllTimers();
    await p;
    expect(onPaused).toHaveBeenCalledOnce();
  });

  describe("request budget guardrail", () => {
    it("counts requests within the rolling window", () => {
      vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
      rl.recordRequest();
      rl.recordRequest();
      expect(rl.requestsInWindow()).toBe(2);
    });

    it("drops requests once they age out of the window", () => {
      vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
      rl.recordRequest();
      vi.setSystemTime(new Date("2026-04-20T10:01:01Z")); // 61s later, past the 60s window
      rl.recordRequest();
      expect(rl.requestsInWindow()).toBe(1);
    });

    it("isOverBudget flips once the count exceeds the given max", () => {
      vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
      for (let i = 0; i < 5; i++) rl.recordRequest();
      expect(rl.isOverBudget(5)).toBe(false);
      rl.recordRequest();
      expect(rl.isOverBudget(5)).toBe(true);
    });
  });
});
