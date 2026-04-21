// <ls-backlinks> — shows notes that link to the current note.
//
// Properties:
//   path  — vault path of the note being viewed
//   links — string[] of paths that link here
//
// Events (bubbles, composed):
//   file-open — detail: { path: string }

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
  .link-item {
    padding: 3px 12px 3px 20px;
    cursor: pointer;
    color: var(--ls-color-accent, #7c6af7);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .link-item:hover { background: rgba(255,255,255,0.05); }
  .empty {
    padding: 4px 20px;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 12px;
    font-style: italic;
  }
`;

export class LSBacklinks extends HTMLElement {
  #path = "";
  #links: string[] = [];
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

  get path(): string { return this.#path; }
  set path(v: string) { this.#path = v; this.#render(); }

  get links(): string[] { return this.#links; }
  set links(v: string[]) { this.#links = v; this.#render(); }

  #render(): void {
    const existing = this.#shadow.getElementById("bl-root");
    if (existing) existing.remove();

    const root = document.createElement("div");
    root.id = "bl-root";

    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = `Backlinks (${this.#links.length})`;
    root.appendChild(label);

    if (this.#links.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No incoming links";
      root.appendChild(empty);
    } else {
      for (const p of this.#links) {
        const item = document.createElement("div");
        item.className = "link-item";
        const base = p.split("/").pop() ?? p;
        item.textContent = base.endsWith(".md") ? base.slice(0, -3) : base;
        item.title = p;
        item.addEventListener("click", () => {
          this.dispatchEvent(
            new CustomEvent("file-open", {
              bubbles: true,
              composed: true,
              detail: { path: p },
            })
          );
        });
        root.appendChild(item);
      }
    }

    this.#shadow.appendChild(root);
  }
}

customElements.define("ls-backlinks", LSBacklinks);
