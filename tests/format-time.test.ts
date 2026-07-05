// formatAgo powers the status bar's sync clock, the repo/commit label's
// commit age, and the vault detail panel's "Last synced" row — it was
// previously duplicated (and drifted slightly) across all three call sites.

import { describe, it, expect } from "vitest";
import { formatAgo, formatClockTime } from "../src/ui/format-time.ts";

describe("formatAgo", () => {
  it("collapses anything under 30s to 'just now'", () => {
    expect(formatAgo(0)).toBe("just now");
    expect(formatAgo(29_999)).toBe("just now");
  });

  it("shows seconds between 30s and 60s", () => {
    expect(formatAgo(30_000)).toBe("30s ago");
    expect(formatAgo(59_000)).toBe("59s ago");
  });

  it("shows minutes between 1m and 60m", () => {
    expect(formatAgo(60_000)).toBe("1m ago");
    expect(formatAgo(59 * 60_000)).toBe("59m ago");
  });

  it("shows hours between 1h and 24h", () => {
    expect(formatAgo(60 * 60_000)).toBe("1h ago");
    expect(formatAgo(23 * 60 * 60_000)).toBe("23h ago");
  });

  it("special-cases exactly one day as 'yesterday'", () => {
    expect(formatAgo(24 * 60 * 60_000)).toBe("yesterday");
  });

  it("shows day counts beyond a day", () => {
    expect(formatAgo(2 * 24 * 60 * 60_000)).toBe("2d ago");
    expect(formatAgo(10 * 24 * 60 * 60_000)).toBe("10d ago");
  });
});

// Assertions avoid hardcoding locale-formatted strings (CI may run under a
// different locale/timezone than a dev machine) — they check structural
// shape instead: same-day is a bare time, other days prefix a date, and the
// year only shows up once the timestamp crosses into a different year.
describe("formatClockTime", () => {
  it("renders a bare time (no date prefix) for a same-day timestamp", () => {
    const result = formatClockTime(Date.now() - 5_000);
    expect(result).not.toContain(",");
    expect(result).toMatch(/\d.*:\d/);
  });

  it("prefixes the date for a timestamp from a different day", () => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60_000;
    const result = formatClockTime(threeDaysAgo);
    expect(result).toContain(",");
    expect(result).toMatch(/\d.*:\d/);
  });

  it("omits the year for a different day within the current year", () => {
    // Two candidates six months apart guarantee at least one is both
    // same-year and not literally "today," regardless of when this runs.
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1, 10, 0, 0);
    const jul1 = new Date(now.getFullYear(), 6, 1, 10, 0, 0);
    const candidate = jan1.toDateString() !== now.toDateString() ? jan1 : jul1;
    const result = formatClockTime(candidate.getTime());
    expect(result).toContain(",");
    expect(result).not.toMatch(/\b\d{4}\b/);
  });

  it("includes the year for a timestamp from a previous year", () => {
    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1, 5, 15);
    const result = formatClockTime(lastYear.getTime());
    expect(result).toContain(String(lastYear.getFullYear()));
  });
});
