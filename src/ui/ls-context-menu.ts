// <ls-context-menu> — small floating popup listing category-grouped actions,
// anchored at a point. Used for both desktop right-click and the mobile
// "..." row button — the caller decides what commands are applicable and
// passes them in; this component only renders and reports a selection.
//
// Events (bubbles, composed):
//   menu-select — detail: { id: string }

const style = `
  :host { display: none; }
  :host(.open) { display: block; }
  .menu {
    position: fixed;
    background: var(--ls-color-bg-overlay, #1e1e2e);
    border: 1px solid var(--ls-color-border, #2a2a3e);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    padding: 4px;
    min-width: 180px;
    max-width: 260px;
    z-index: 200;
    font-size: 13px;
  }
  .group-header {
    padding: 6px 10px 2px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ls-color-fg-muted, #64748b);
  }
  .group-header:first-child { padding-top: 4px; }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    background: none;
    border: none;
    color: var(--ls-color-fg, #e0e0e0);
    padding: 6px 10px;
    text-align: left;
    cursor: pointer;
    border-radius: 3px;
    font: inherit;
  }
  .menu-item:hover { background: rgba(255,255,255,0.08); }
  .menu-item.destructive { color: #f87171; }
  .menu-item-label { flex: 1; }
  .menu-item-shortcut {
    font-size: 11px;
    color: var(--ls-color-fg-muted, #64748b);
    font-family: var(--ls-font-mono, monospace);
  }
`;

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  destructive?: boolean;
}

export interface ContextMenuGroup {
  /** Already-resolved display label (caller owns category → label mapping). */
  category: string;
  items: ContextMenuItem[];
}

export class LSContextMenu extends HTMLElement {
  #shadow: ShadowRoot;
  #menu!: HTMLElement;
  #docClickHandler: ((e: MouseEvent) => void) | null = null;
  #keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#menu = document.createElement("div");
    this.#menu.className = "menu";
    this.#shadow.appendChild(this.#menu);
  }

  get isOpen(): boolean {
    return this.classList.contains("open");
  }

  open(x: number, y: number, groups: ContextMenuGroup[]): void {
    this.close();

    this.#menu.replaceChildren();
    for (const group of groups) {
      if (group.items.length === 0) continue;
      const header = document.createElement("div");
      header.className = "group-header";
      header.textContent = group.category;
      this.#menu.appendChild(header);
      for (const item of group.items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "menu-item" + (item.destructive ? " destructive" : "");
        btn.dataset["id"] = item.id;

        const label = document.createElement("span");
        label.className = "menu-item-label";
        label.textContent = item.label;
        btn.appendChild(label);

        if (item.shortcut) {
          const sc = document.createElement("span");
          sc.className = "menu-item-shortcut";
          sc.textContent = item.shortcut;
          btn.appendChild(sc);
        }

        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.close();
          this.dispatchEvent(
            new CustomEvent("menu-select", { bubbles: true, composed: true, detail: { id: item.id } })
          );
        });
        this.#menu.appendChild(btn);
      }
    }

    // Position off-screen first so we can measure it before clamping to the
    // viewport on both axes (the anchor point can be arbitrarily close to
    // any edge — right-click near the bottom of the window, "..." button
    // near the right edge of a narrow panel, etc).
    this.#menu.style.left = "-9999px";
    this.#menu.style.top = "-9999px";
    this.classList.add("open");
    requestAnimationFrame(() => {
      const rect = this.#menu.getBoundingClientRect();
      const margin = 8;
      const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
      const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
      this.#menu.style.left = `${left}px`;
      this.#menu.style.top = `${top}px`;
    });

    // Dismiss on outside click (deferred a tick so the opening click/tap
    // doesn't immediately close it) or Escape.
    setTimeout(() => {
      this.#docClickHandler = () => this.close();
      document.addEventListener("click", this.#docClickHandler, { once: true });
    }, 0);
    this.#keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener("keydown", this.#keyHandler);
  }

  close(): void {
    this.classList.remove("open");
    if (this.#docClickHandler) {
      document.removeEventListener("click", this.#docClickHandler);
      this.#docClickHandler = null;
    }
    if (this.#keyHandler) {
      document.removeEventListener("keydown", this.#keyHandler);
      this.#keyHandler = null;
    }
  }
}

customElements.define("ls-context-menu", LSContextMenu);
