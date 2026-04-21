// <ls-command-palette> — keyboard-driven command launcher (Ctrl/Cmd+Shift+P).
//
// Usage: register commands via palette.register(cmd), open via palette.open().
//
// Events (bubbles, composed):
//   palette-command — detail: { id: string }  (fired when a command is selected)

export interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
}

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
    width: min(600px, 90vw);
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
  .list {
    max-height: 360px;
    overflow-y: auto;
    padding: 4px 0;
  }
  .cmd-item {
    display: flex;
    align-items: center;
    padding: 8px 14px;
    cursor: pointer;
    gap: 10px;
  }
  .cmd-item:hover, .cmd-item.selected {
    background: rgba(124,106,247,0.12);
  }
  .cmd-label {
    flex: 1;
    font-size: 13px;
    color: var(--ls-color-fg, #e0e0e0);
  }
  .cmd-desc {
    font-size: 11px;
    color: var(--ls-color-fg-muted, #64748b);
  }
  .cmd-shortcut {
    font-size: 11px;
    color: var(--ls-color-fg-muted, #64748b);
    background: rgba(255,255,255,0.07);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: var(--ls-font-mono, monospace);
  }
  .empty-hint {
    padding: 20px;
    text-align: center;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 13px;
  }
`;

export class LSCommandPalette extends HTMLElement {
  #commands: PaletteCommand[] = [];
  #filtered: PaletteCommand[] = [];
  #selectedIndex = 0;
  #shadow: ShadowRoot;
  #input!: HTMLInputElement;
  #list!: HTMLElement;

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

  register(cmd: PaletteCommand): void {
    this.#commands.push(cmd);
  }

  open(): void {
    this.#input.value = "";
    this.#filter("");
    this.classList.add("open");
    requestAnimationFrame(() => this.#input.focus());
  }

  close(): void {
    this.classList.remove("open");
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
    icon.textContent = "⌘";
    this.#input = document.createElement("input");
    this.#input.type = "text";
    this.#input.placeholder = "Type a command…";
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
    this.#filtered = q
      ? this.#commands.filter(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            (c.description ?? "").toLowerCase().includes(q)
        )
      : [...this.#commands];
    this.#selectedIndex = 0;
    this.#renderList();
  }

  #renderList(): void {
    this.#list.innerHTML = "";
    if (this.#filtered.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "No matching commands";
      this.#list.appendChild(hint);
      return;
    }
    this.#filtered.forEach((cmd, i) => {
      const item = document.createElement("div");
      item.className = "cmd-item" + (i === this.#selectedIndex ? " selected" : "");
      item.dataset["id"] = cmd.id;

      const label = document.createElement("span");
      label.className = "cmd-label";
      label.textContent = cmd.label;

      item.appendChild(label);
      if (cmd.description) {
        const desc = document.createElement("span");
        desc.className = "cmd-desc";
        desc.textContent = cmd.description;
        item.appendChild(desc);
      }
      if (cmd.shortcut) {
        const sc = document.createElement("span");
        sc.className = "cmd-shortcut";
        sc.textContent = cmd.shortcut;
        item.appendChild(sc);
      }
      item.addEventListener("click", () => this.#select(i));
      this.#list.appendChild(item);
    });
  }

  #select(index: number): void {
    const cmd = this.#filtered[index];
    if (!cmd) return;
    this.close();
    this.dispatchEvent(
      new CustomEvent("palette-command", {
        bubbles: true,
        composed: true,
        detail: { id: cmd.id },
      })
    );
  }

  #onGlobalKey = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && e.key === "P") {
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
      this.#scrollSelected();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.#selectedIndex = Math.max(this.#selectedIndex - 1, 0);
      this.#renderList();
      this.#scrollSelected();
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.#select(this.#selectedIndex);
    }
  };

  #scrollSelected(): void {
    const items = this.#list.querySelectorAll(".cmd-item");
    items[this.#selectedIndex]?.scrollIntoView({ block: "nearest" });
  }
}

customElements.define("ls-command-palette", LSCommandPalette);
