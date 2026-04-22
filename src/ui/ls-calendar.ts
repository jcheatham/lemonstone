// <ls-calendar> — month-grid calendar for daily-note navigation.
//
// Properties:
//   notes        — string[] of all note paths (used to detect which dates have notes)
//   dailyFolder  — folder prefix for daily notes, default "daily"
//   activePath   — currently-open note path (highlights cell if it's a daily note)
//
// Events (bubbles, composed):
//   daily-open — detail: { date: string (YYYY-MM-DD), path: string }
//                User clicked a date; caller decides whether to create or just open.

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  summary: string;
  path: string;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const style = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    font-size: 13px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 6px;
    flex-shrink: 0;
  }
  .month-label {
    font-weight: 600;
    color: var(--ls-color-fg, #e0e0e0);
    font-size: 13px;
  }
  .nav-group { display: flex; gap: 2px; align-items: center; }
  .nav-btn {
    background: none;
    border: none;
    color: var(--ls-color-fg-muted, #64748b);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: inherit;
  }
  .nav-btn:hover { color: var(--ls-color-fg, #e0e0e0); background: rgba(255,255,255,0.05); }
  .today-btn {
    font-size: 11px;
    padding: 2px 8px;
    border: 1px solid var(--ls-color-border, #2a2a3e);
    border-radius: 4px;
    margin-left: 6px;
  }
  .grid-wrap { padding: 0 8px 10px; }
  .weekdays, .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .weekdays {
    padding-bottom: 4px;
    border-bottom: 1px solid var(--ls-color-border, #2a2a3e);
    margin-bottom: 4px;
  }
  .weekday {
    text-align: center;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--ls-color-fg-muted, #64748b);
    padding: 2px 0;
    text-transform: uppercase;
  }
  .day {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    font-size: 12px;
    color: var(--ls-color-fg, #e0e0e0);
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    padding: 0;
  }
  .day:hover { background: rgba(255,255,255,0.05); }
  .day.outside { color: var(--ls-color-fg-muted, #64748b); opacity: 0.45; }
  .day.today { border-color: var(--ls-color-accent, #7c6af7); font-weight: 600; }
  .day.active {
    background: var(--ls-color-accent, #7c6af7);
    color: white;
  }
  .day .marker {
    position: absolute;
    bottom: 2px;
    left: 50%;
    transform: translateX(-50%);
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--ls-color-accent, #7c6af7);
  }
  .day.active .marker { background: white; }

  /* Event lists */
  .events-section { padding: 4px 0 10px; }
  .events-section + .events-section { border-top: 1px solid var(--ls-color-border, #2a2a3e); }
  .events-header {
    padding: 8px 12px 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ls-color-fg-muted, #64748b);
  }
  .events-empty {
    padding: 4px 12px 6px;
    font-size: 12px;
    font-style: italic;
    color: var(--ls-color-fg-muted, #64748b);
    opacity: 0.7;
  }
  .event {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 12px;
    background: none;
    border: none;
    color: var(--ls-color-fg, #e0e0e0);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-left: 2px solid transparent;
  }
  .event:hover { background: rgba(255,255,255,0.05); }
  .event.active {
    color: var(--ls-color-accent, #7c6af7);
    border-left-color: var(--ls-color-accent, #7c6af7);
    background: rgba(124,106,247,0.08);
  }
  .event .event-date {
    display: inline-block;
    min-width: 44px;
    color: var(--ls-color-fg-muted, #64748b);
    font-variant-numeric: tabular-nums;
    margin-right: 6px;
  }
  .event.active .event-date { color: inherit; opacity: 0.85; }
`;

export class LSCalendar extends HTMLElement {
  #shadow: ShadowRoot;
  #notes: string[] = [];
  #events: CalendarEvent[] = [];
  #dailyFolder = "daily";
  #activePath = "";
  #viewYear: number;
  #viewMonth: number; // 0-11

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    const now = new Date();
    this.#viewYear = now.getFullYear();
    this.#viewMonth = now.getMonth();
  }

  connectedCallback(): void {
    this.#render();
  }

  get notes(): string[] { return this.#notes; }
  set notes(v: string[]) { this.#notes = v; this.#render(); }

  get events(): CalendarEvent[] { return this.#events; }
  set events(v: CalendarEvent[]) { this.#events = v; this.#render(); }

  get dailyFolder(): string { return this.#dailyFolder; }
  set dailyFolder(v: string) { this.#dailyFolder = v; this.#render(); }

  get activePath(): string { return this.#activePath; }
  set activePath(v: string) { this.#activePath = v; this.#render(); }

  /** Jump the view to a specific date (without opening anything). */
  viewDate(date: Date): void {
    this.#viewYear = date.getFullYear();
    this.#viewMonth = date.getMonth();
    this.#render();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  #notedDates(): Set<string> {
    const out = new Set<string>();
    // Use the event list as the source of truth: it's already been filtered
    // down to notes that have real (non-template) content.
    for (const ev of this.#events) out.add(ev.date);
    return out;
  }

  #render(): void {
    // Keep only the <style> element; rebuild the rest.
    const style = this.#shadow.querySelector("style");
    this.#shadow.replaceChildren();
    if (style) this.#shadow.appendChild(style);

    const noted = this.#notedDates();
    const today = new Date();
    const activeDate = this.#extractDailyDate(this.#activePath);

    // Header
    const header = document.createElement("div");
    header.className = "header";

    const monthLabel = document.createElement("div");
    monthLabel.className = "month-label";
    monthLabel.textContent = `${MONTH_NAMES[this.#viewMonth]} ${this.#viewYear}`;

    const navGroup = document.createElement("div");
    navGroup.className = "nav-group";
    const prev = document.createElement("button");
    prev.className = "nav-btn";
    prev.textContent = "‹";
    prev.title = "Previous month";
    prev.addEventListener("click", () => this.#shiftMonth(-1));
    const next = document.createElement("button");
    next.className = "nav-btn";
    next.textContent = "›";
    next.title = "Next month";
    next.addEventListener("click", () => this.#shiftMonth(1));
    const todayBtn = document.createElement("button");
    todayBtn.className = "nav-btn today-btn";
    todayBtn.textContent = "Today";
    todayBtn.addEventListener("click", () => {
      const t = new Date();
      this.#viewYear = t.getFullYear();
      this.#viewMonth = t.getMonth();
      this.#render();
      this.#emitOpen(t);
    });
    navGroup.append(prev, next, todayBtn);
    header.append(monthLabel, navGroup);

    // Grid
    const gridWrap = document.createElement("div");
    gridWrap.className = "grid-wrap";

    const wk = document.createElement("div");
    wk.className = "weekdays";
    for (const w of WEEKDAYS) {
      const c = document.createElement("div");
      c.className = "weekday";
      c.textContent = w;
      wk.appendChild(c);
    }
    gridWrap.appendChild(wk);

    const days = document.createElement("div");
    days.className = "days";

    // Fill grid with 6 weeks worth of cells, Monday-first.
    const firstOfMonth = new Date(this.#viewYear, this.#viewMonth, 1);
    // getDay: 0=Sun..6=Sat. Convert to Mo=0..Su=6.
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(this.#viewYear, this.#viewMonth, 1 - startOffset);

    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const iso = formatDate(d);
      const inMonth = d.getMonth() === this.#viewMonth;
      const isToday = sameDay(d, today);
      const isActive = activeDate !== null && sameDay(d, activeDate);

      const cell = document.createElement("button");
      cell.className = "day"
        + (!inMonth ? " outside" : "")
        + (isToday ? " today" : "")
        + (isActive ? " active" : "");
      cell.textContent = String(d.getDate());
      cell.title = iso;
      cell.addEventListener("click", () => this.#emitOpen(d));

      if (noted.has(iso)) {
        const dot = document.createElement("span");
        dot.className = "marker";
        cell.appendChild(dot);
      }

      days.appendChild(cell);
    }

    gridWrap.appendChild(days);

    this.#shadow.append(header, gridWrap);

    // Events sections — splits events into future (upcoming) and past (recent).
    if (this.#events.length > 0) {
      const todayIso = formatDate(today);
      const sorted = [...this.#events].sort((a, b) => a.date.localeCompare(b.date));
      const upcoming = sorted.filter(e => e.date >= todayIso);
      const recent = sorted.filter(e => e.date < todayIso).reverse();

      this.#shadow.appendChild(this.#renderEventsSection("Upcoming", upcoming));
      this.#shadow.appendChild(this.#renderEventsSection("Recent", recent));
    }
  }

  #renderEventsSection(title: string, events: CalendarEvent[]): HTMLElement {
    const section = document.createElement("div");
    section.className = "events-section";

    const header = document.createElement("div");
    header.className = "events-header";
    header.textContent = title;
    section.appendChild(header);

    if (events.length === 0) {
      const empty = document.createElement("div");
      empty.className = "events-empty";
      empty.textContent = title === "Upcoming" ? "Nothing scheduled." : "No past entries.";
      section.appendChild(empty);
      return section;
    }

    for (const ev of events) {
      const row = document.createElement("button");
      row.className = "event" + (ev.path === this.#activePath ? " active" : "");
      row.title = `${ev.date} — ${ev.summary}`;
      row.addEventListener("click", () => {
        this.dispatchEvent(
          new CustomEvent("daily-open", {
            bubbles: true,
            composed: true,
            detail: { date: ev.date, path: ev.path },
          })
        );
      });

      const dateSpan = document.createElement("span");
      dateSpan.className = "event-date";
      const d = new Date(+ev.date.slice(0, 4), +ev.date.slice(5, 7) - 1, +ev.date.slice(8, 10));
      dateSpan.textContent = `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;

      const summarySpan = document.createElement("span");
      summarySpan.textContent = ev.summary;

      row.append(dateSpan, summarySpan);
      section.appendChild(row);
    }

    return section;
  }

  #shiftMonth(delta: number): void {
    const d = new Date(this.#viewYear, this.#viewMonth + delta, 1);
    this.#viewYear = d.getFullYear();
    this.#viewMonth = d.getMonth();
    this.#render();
  }

  #extractDailyDate(path: string): Date | null {
    const prefix = this.#dailyFolder ? `${this.#dailyFolder}/` : "";
    if (!path.startsWith(prefix)) return null;
    const rel = path.slice(prefix.length);
    const nested = /^(\d{4})\/(\d{2})\/(\d{2})\/[^/]+\.md$/.exec(rel);
    if (nested) return new Date(+nested[1]!, +nested[2]! - 1, +nested[3]!);
    const flat = /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(rel);
    if (flat) return new Date(+flat[1]!, +flat[2]! - 1, +flat[3]!);
    return null;
  }

  #emitOpen(date: Date): void {
    // Path is intentionally omitted: let the parent (ls-app) decide between
    // the nested default and any legacy flat file that may exist for this date.
    this.dispatchEvent(
      new CustomEvent("daily-open", {
        bubbles: true,
        composed: true,
        detail: { date: formatDate(date) },
      })
    );
  }
}

customElements.define("ls-calendar", LSCalendar);
