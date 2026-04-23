// <ls-switcher> — quick-pick overlay. Primary use is note-switching
// (Ctrl/Cmd+P), but also functions as a generic fuzzy picker for any list
// of items via pickItems(...).
//
// Properties:
//   notes — string[] of vault paths to search (used by open() and pick())
//
// Events (bubbles, composed):
//   file-open — detail: { path: string }   only fired from Ctrl+P mode

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

export interface PickerItem {
  /** Value handed back via the pick promise when this item is selected. */
  value: string;
  /** Main text shown on the left. */
  primary: string;
  /** Optional muted text shown on the right. */
  secondary?: string;
  /** Fuzzy-match text. Falls back to `${primary} ${secondary ?? ""}` if omitted. */
  search?: string;
}

export class LSSwitcher extends HTMLElement {
  #notes: string[] = [];
  /** Source items the picker is searching through — populated from #notes in
   *  file mode, or from the caller's items in pickItems mode. */
  #items: PickerItem[] = [];
  #filtered: PickerItem[] = [];
  #selectedIndex = 0;
  #shadow: ShadowRoot;
  #input!: HTMLInputElement;
  #list!: HTMLElement;
  /** When set, selections resolve this promise instead of firing file-open. */
  #pickResolver: ((value: string | null) => void) | null = null;
  #defaultPlaceholder = "Jump to note…";
  #emptyHint = "No notes found";

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
    this.#items = this.#notesToItems(this.#notes);
    this.#emptyHint = "No notes found";
    this.#input.placeholder = this.#defaultPlaceholder;
    this.#input.value = "";
    this.#filter("");
    this.classList.add("open");
    requestAnimationFrame(() => this.#input.focus());
  }

  /**
   * Open the switcher in "pick" mode for the current notes list. Instead of
   * dispatching file-open on selection, returns a Promise that resolves with
   * the picked path (or null if the user closed without choosing).
   */
  pick(options: { placeholder?: string } = {}): Promise<string | null> {
    this.#items = this.#notesToItems(this.#notes);
    this.#emptyHint = "No notes found";
    return this.#openPromise(options.placeholder ?? "Pick a note…");
  }

  /**
   * Generic item picker. Caller supplies the list; the switcher handles
   * fuzzy search, keyboard nav, and selection. Resolves with the chosen
   * item's `value`, or null if the user dismissed.
   */
  pickItems(
    items: readonly PickerItem[],
    options: { placeholder?: string; emptyHint?: string } = {},
  ): Promise<string | null> {
    this.#items = [...items];
    this.#emptyHint = options.emptyHint ?? "No matches";
    return this.#openPromise(options.placeholder ?? "Pick…");
  }

  close(): void {
    this.classList.remove("open");
    if (this.#pickResolver) {
      this.#pickResolver(null);
      this.#pickResolver = null;
    }
  }

  #notesToItems(notes: readonly string[]): PickerItem[] {
    return notes.map((path) => {
      const base = path.split("/").pop() ?? path;
      const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      return { value: path, primary: base, secondary: folder, search: path };
    });
  }

  #openPromise(placeholder: string): Promise<string | null> {
    if (this.#pickResolver) {
      this.#pickResolver(null);
      this.#pickResolver = null;
    }
    return new Promise<string | null>((resolve) => {
      this.#pickResolver = resolve;
      this.#input.placeholder = placeholder;
      this.#input.value = "";
      this.#filter("");
      this.classList.add("open");
      requestAnimationFrame(() => this.#input.focus());
    });
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
    const searchText = (item: PickerItem): string =>
      (item.search ?? `${item.primary} ${item.secondary ?? ""}`).toLowerCase();
    if (!q) {
      this.#filtered = [...this.#items].slice(0, 50);
    } else {
      this.#filtered = this.#items
        .filter((it) => searchText(it).includes(q))
        .sort((a, b) => {
          const aStarts = a.primary.toLowerCase().startsWith(q) ? -1 : 0;
          const bStarts = b.primary.toLowerCase().startsWith(q) ? -1 : 0;
          return aStarts - bStarts || a.primary.localeCompare(b.primary);
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
      hint.textContent = this.#emptyHint;
      this.#list.appendChild(hint);
      return;
    }
    this.#filtered.forEach((it, i) => {
      const item = document.createElement("div");
      item.className = "note-item" + (i === this.#selectedIndex ? " selected" : "");

      const name = document.createElement("span");
      name.className = "note-name";
      name.textContent = it.primary;
      item.appendChild(name);

      if (it.secondary) {
        const secondary = document.createElement("span");
        secondary.className = "note-path";
        secondary.textContent = it.secondary;
        item.appendChild(secondary);
      }

      item.addEventListener("click", () => this.#select(i));
      this.#list.appendChild(item);
    });
  }

  #select(index: number): void {
    const it = this.#filtered[index];
    if (!it) return;
    const resolver = this.#pickResolver;
    this.#pickResolver = null;
    this.classList.remove("open");
    if (resolver) {
      resolver(it.value);
      return;
    }
    this.dispatchEvent(
      new CustomEvent("file-open", {
        bubbles: true,
        composed: true,
        detail: { path: it.value },
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
