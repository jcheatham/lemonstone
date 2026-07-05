// Shared time formatting for the status bar's sync clock, the repo/commit
// label's commit age, and the vault detail panel's "Last synced" row, so
// their phrasing stays consistent.

/** Relative "how long ago" label, e.g. "3m ago", "2h ago", "yesterday". */
export function formatAgo(ms: number): string {
  if (ms < 30_000) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

/**
 * Absolute clock-face label — lets the reader do their own "how long ago"
 * math against a fixed point instead of a relative label that goes stale
 * between re-renders. Leads with the time (the part you actually glance at)
 * and appends only as much date context as the gap needs:
 *   - same calendar day  → "15:58:09"
 *   - same year          → "15:58:09, Jul 4"
 *   - other year         → "15:58:09, Jul 4, 2025"
 */
export function formatClockTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(
    [],
    sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
  );
  return `${time}, ${date}`;
}
