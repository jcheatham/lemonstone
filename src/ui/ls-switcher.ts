// <ls-switcher> — quick note switcher (Ctrl/Cmd+P).
//
// Properties:
//   notes — string[] of vault paths to search
//
// Events (bubbles, composed):
//   file-open — detail: { path: string }

const style = `
  :host { display: none; }
  :host(.open) { display: block; }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    z-index: 200;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
  }
  .panel {
    width: min(540px, 90vw);
    background: var(--ls-color-bg-overlay, #1e1e2e);
    border: 1px solid var(--ls-color-border, #333);
    border-radius: 8px;
    box-shadow: 0 24px 48px rgba(0,0,0,0.6);
    overflow: hidden;
  }
  .search-row {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    gap: 8px;
    border-bottom: 1px solid var(--ls-color-border, #333);
  }
  .search-icon { color: var(--ls-color-fg-muted, #64748b); font-size: 15px; flex-shrink: 0; }
  input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--ls-color-fg, #e0e0e0);
    font-size: 14px;
    font-family: inherit;
    caret-color: var(--ls-color-accent, #7c6af7);
  }
  .list { max-height: 320px; overflow-y: auto; padding: 4px 0; }
  .note-item {
    display: flex;
    align-items: center;
    padding: 7px 14px;
    cursor: pointer;
    gap: 8px;
  }
  .note-item:hover, .note-item.selected { background: rgba(124,106,247,0.12); }
  .note-name { font-size: 13px; color: var(--ls-color-fg, #e0e0e0); }
  .note-path { font-size: 11px; color: var(--ls-color-fg-muted, #64748b); margin-left: auto; }
  .empty-hint {
    padding: 20px;
    text-align: center;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 13px;
  }
`;

export class LSSwitcher extends HTMLElement {
  #notes: string[] = [];
  #filtered: string[] = [];
  #selectedIndex = 0;
  #shadow: ShadowRoot;
  #input!: HTMLInputElement;
  #list!: HTMLElement;
  /** When set, selections resolve this promise instead of firing file-open. */
  #pickResolver: ((path: string | null) => void) | null = null;
  #defaultPlaceholder = "Jump to note…";

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#buildDOM();
  }

  connectedCallback(): void {
    document.addEventListener("keydown", this.#onGlobalKey);
  }

  disconnectedCallback(): void {
    document.removeEventListener("keydown", this.#onGlobalKey);
  }

  get notes(): string[] { return this.#notes; }
  set notes(v: string[]) { this.#notes = v; }

  open(): void {
    this.#input.placeholder = this.#defaultPlaceholder;
    this.#input.value = "";
    this.#filter("");
    this.classList.add("open");
    requestAnimationFrame(() => this.#input.focus());
  }

  /**
   * Open the switcher in "pick" mode. Instead of dispatching file-open on
   * selection, returns a Promise that resolves with the picked path (or null
   * if the user closed without choosing).
   */
  pick(options: { placeholder?: string } = {}): Promise<string | null> {
    // If there's already a pending pick, cancel it.
    if (this.#pickResolver) {
      this.#pickResolver(null);
      this.#pickResolver = null;
    }
    return new Promise<string | null>((resolve) => {
      this.#pickResolver = resolve;
      this.#input.placeholder = options.placeholder ?? "Pick a note…";
      this.#input.value = "";
      this.#filter("");
      this.classList.add("open");
      requestAnimationFrame(() => this.#input.focus());
    });
  }

  close(): void {
    this.classList.remove("open");
    if (this.#pickResolver) {
      this.#pickResolver(null);
      this.#pickResolver = null;
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  #buildDOM(): void {
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) this.close();
    });

    const panel = document.createElement("div");
    panel.className = "panel";

    const searchRow = document.createElement("div");
    searchRow.className = "search-row";
    const icon = document.createElement("span");
    icon.className = "search-icon";
    icon.textContent = "🔍";
    this.#input = document.createElement("input");
    this.#input.type = "text";
    this.#input.placeholder = "Jump to note…";
    this.#input.setAttribute("autocomplete", "off");
    this.#input.addEventListener("input", () => this.#filter(this.#input.value));
    this.#input.addEventListener("keydown", this.#onInputKey);
    searchRow.append(icon, this.#input);

    this.#list = document.createElement("div");
    this.#list.className = "list";

    panel.append(searchRow, this.#list);
    backdrop.appendChild(panel);
    this.#shadow.appendChild(backdrop);
  }

  #filter(query: string): void {
    const q = query.toLowerCase().trim();
    if (!q) {
      this.#filtered = [...this.#notes].slice(0, 50);
    } else {
      this.#filtered = this.#notes
        .filter((p) => p.toLowerCase().includes(q))
        .sort((a, b) => {
          const aBase = (a.split("/").pop() ?? a).toLowerCase();
          const bBase = (b.split("/").pop() ?? b).toLowerCase();
          const aStarts = aBase.startsWith(q) ? -1 : 0;
          const bStarts = bBase.startsWith(q) ? -1 : 0;
          return aStarts - bStarts || aBase.localeCompare(bBase);
        })
        .slice(0, 50);
    }
    this.#selectedIndex = 0;
    this.#renderList();
  }

  #renderList(): void {
    this.#list.innerHTML = "";
    if (this.#filtered.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "No notes found";
      this.#list.appendChild(hint);
      return;
    }
    this.#filtered.forEach((path, i) => {
      const item = document.createElement("div");
      item.className = "note-item" + (i === this.#selectedIndex ? " selected" : "");

      const base = path.split("/").pop() ?? path;
      const name = document.createElement("span");
      name.className = "note-name";
      name.textContent = base;

      item.appendChild(name);

      if (path.includes("/")) {
        const folder = path.slice(0, path.lastIndexOf("/"));
        const pathSpan = document.createElement("span");
        pathSpan.className = "note-path";
        pathSpan.textContent = folder;
        item.appendChild(pathSpan);
      }

      item.addEventListener("click", () => this.#select(i));
      this.#list.appendChild(item);
    });
  }

  #select(index: number): void {
    const path = this.#filtered[index];
    if (!path) return;
    const resolver = this.#pickResolver;
    this.#pickResolver = null;
    this.classList.remove("open");
    if (resolver) {
      resolver(path);
      return;
    }
    this.dispatchEvent(
      new CustomEvent("file-open", {
        bubbles: true,
        composed: true,
        detail: { path },
      })
    );
  }

  #onGlobalKey = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key === "p") {
      e.preventDefault();
      this.classList.contains("open") ? this.close() : this.open();
    }
    if (this.classList.contains("open") && e.key === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  #onInputKey = (e: KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.#selectedIndex = Math.min(this.#selectedIndex + 1, this.#filtered.length - 1);
      this.#renderList();
      this.#list.querySelectorAll(".note-item")[this.#selectedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.#selectedIndex = Math.max(this.#selectedIndex - 1, 0);
      this.#renderList();
      this.#list.querySelectorAll(".note-item")[this.#selectedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.#select(this.#selectedIndex);
    }
  };
}

customElements.define("ls-switcher", LSSwitcher);
