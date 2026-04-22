// <ls-history> — recent-commits list for the History category panel.
//
// Properties:
//   commits    — Array<{ oid, message, author, date }>
//   activeOid  — currently-opened commit (highlights the matching row)
//
// Events (bubbles, composed):
//   commit-select — detail: { oid }

export interface CommitSummary {
  oid: string;
  message: string;
  author: string;
  date: number;
}

const style = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: 13px;
  }
  .header {
    padding: 10px 12px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ls-color-fg-muted, #64748b);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .header button {
    background: none;
    border: none;
    color: var(--ls-color-fg-muted, #64748b);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .header button:hover { color: var(--ls-color-fg, #e0e0e0); background: rgba(255,255,255,0.05); }
  .list { flex: 1; overflow-y: auto; padding: 4px 0 8px; }
  .commit {
    padding: 6px 12px;
    cursor: pointer;
    border-left: 2px solid transparent;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .commit:hover { background: rgba(255,255,255,0.04); }
  .commit.active {
    background: rgba(124,106,247,0.12);
    border-left-color: var(--ls-color-accent, #7c6af7);
  }
  .message {
    color: var(--ls-color-fg, #e0e0e0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
  }
  .meta {
    font-size: 10px;
    color: var(--ls-color-fg-muted, #64748b);
    font-family: var(--ls-font-mono, monospace);
  }
  .empty {
    padding: 18px 14px;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 12px;
    font-style: italic;
  }
`;

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toISOString().slice(0, 10);
}

export class LSHistory extends HTMLElement {
  #shadow: ShadowRoot;
  #commits: CommitSummary[] = [];
  #activeOid = "";

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
  }

  connectedCallback(): void {
    this.#render();
  }

  get commits(): CommitSummary[] { return this.#commits; }
  set commits(v: CommitSummary[]) { this.#commits = v; this.#render(); }

  get activeOid(): string { return this.#activeOid; }
  set activeOid(v: string) {
    this.#activeOid = v;
    // Just toggle active class instead of full re-render.
    this.#shadow.querySelectorAll<HTMLElement>(".commit").forEach((el) => {
      el.classList.toggle("active", el.dataset["oid"] === v);
    });
  }

  #render(): void {
    const existing = this.#shadow.querySelector(".root");
    if (existing) existing.remove();

    const root = document.createElement("div");
    root.className = "root";
    root.style.cssText = "display:flex;flex-direction:column;height:100%;min-height:0;";

    const header = document.createElement("div");
    header.className = "header";
    const label = document.createElement("span");
    label.textContent = "Recent commits";
    const refresh = document.createElement("button");
    refresh.textContent = "↻";
    refresh.title = "Refresh";
    refresh.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("history-refresh", { bubbles: true, composed: true }));
    });
    header.append(label, refresh);
    root.appendChild(header);

    const list = document.createElement("div");
    list.className = "list";

    if (this.#commits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No commits yet.";
      list.appendChild(empty);
    } else {
      for (const c of this.#commits) {
        const row = document.createElement("div");
        row.className = "commit" + (c.oid === this.#activeOid ? " active" : "");
        row.dataset["oid"] = c.oid;
        row.title = `${c.oid}\n${c.message}\n${c.author}`;

        const message = document.createElement("div");
        message.className = "message";
        message.textContent = c.message;

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `${c.oid.slice(0, 7)}  ${formatDate(c.date)}`;

        row.append(message, meta);
        row.addEventListener("click", () => {
          this.dispatchEvent(new CustomEvent("commit-select", {
            bubbles: true, composed: true,
            detail: { oid: c.oid },
          }));
        });
        list.appendChild(row);
      }
    }

    root.appendChild(list);
    this.#shadow.appendChild(root);
  }
}

customElements.define("ls-history", LSHistory);
