// <ls-outline> — heading-based document outline for the active note.
//
// Properties:
//   headings — HeadingEntry[] parsed from the note content
//
// Events (bubbles, composed):
//   outline-jump — detail: { line: number }

export interface HeadingEntry {
  level: number; // 1–6
  text: string;
  line: number;  // 1-based line number in the document
}

/** Parse headings from raw markdown text. */
export function parseHeadings(content: string): HeadingEntry[] {
  const entries: HeadingEntry[] = [];
  let inFence = false;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (ln.startsWith("```") || ln.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+)/.exec(ln);
    if (m) {
      entries.push({ level: m[1]!.length, text: m[2]!.trim(), line: i + 1 });
    }
  }
  return entries;
}

const style = `
  :host {
    display: flex;
    flex-direction: column;
    font-size: 13px;
    padding: 8px 0;
    border-top: 1px solid var(--ls-color-border, #333);
  }
  .section-label {
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ls-color-fg-muted, #64748b);
  }
  .heading-item {
    padding: 3px 12px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ls-color-fg, #e0e0e0);
  }
  .heading-item:hover { background: rgba(255,255,255,0.05); }
  .h1 { padding-left: 16px; font-weight: 600; }
  .h2 { padding-left: 24px; }
  .h3 { padding-left: 32px; font-size: 12px; color: var(--ls-color-fg-muted, #94a3b8); }
  .h4, .h5, .h6 { padding-left: 40px; font-size: 12px; color: var(--ls-color-fg-muted, #94a3b8); }
  .empty {
    padding: 4px 20px;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 12px;
    font-style: italic;
  }
`;

export class LSOutline extends HTMLElement {
  #headings: HeadingEntry[] = [];
  #shadow: ShadowRoot;

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

  get headings(): HeadingEntry[] { return this.#headings; }
  set headings(v: HeadingEntry[]) { this.#headings = v; this.#render(); }

  #render(): void {
    const existing = this.#shadow.getElementById("ol-root");
    if (existing) existing.remove();

    const root = document.createElement("div");
    root.id = "ol-root";

    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = "Outline";
    root.appendChild(label);

    if (this.#headings.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No headings";
      root.appendChild(empty);
    } else {
      for (const h of this.#headings) {
        const item = document.createElement("div");
        item.className = `heading-item h${h.level}`;
        item.textContent = h.text;
        item.title = h.text;
        item.addEventListener("click", () => {
          this.dispatchEvent(
            new CustomEvent("outline-jump", {
              bubbles: true,
              composed: true,
              detail: { line: h.line },
            })
          );
        });
        root.appendChild(item);
      }
    }

    this.#shadow.appendChild(root);
  }
}

customElements.define("ls-outline", LSOutline);
