// <ls-file-tree> — sidebar file list, grouped by folder.
//
// Properties:
//   notes — string[] of vault paths
//   activePath — currently open path (highlighted)
//   zones — { prefix, unlocked }[] for rendering lock glyphs on encrypted folders
//
// Events (bubbles, composed):
//   file-open   — detail: { path: string }
//   file-new    — detail: { folder: string; kind: "note" | "canvas" | "folder"; name: string }
//   file-rename — detail: { oldPath: string; newPath: string }
//   zone-toggle — detail: { prefix: string; unlocked: boolean } — user clicked the lock badge
//
// The "+" button opens a small menu letting the user pick note/canvas/folder.

const style = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: 13px;
  }
  .tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ls-color-fg-muted, #64748b);
    flex-shrink: 0;
  }
  .tree-header button {
    background: none;
    border: none;
    color: var(--ls-color-fg-muted, #64748b);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
    border-radius: 3px;
  }
  .tree-header button:hover { color: var(--ls-color-fg, #e0e0e0); background: rgba(255,255,255,0.07); }
  .tree-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0 8px;
  }
  .folder-label {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ls-color-fg-muted, #64748b);
    cursor: pointer;
    user-select: none;
  }
  .folder-label:hover { color: var(--ls-color-fg, #e0e0e0); }
  .folder-label .new-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    opacity: 0;
    border-radius: 3px;
  }
  .folder-label:hover .new-btn { opacity: 1; }
  .folder-label .new-btn:hover { background: rgba(255,255,255,0.1); }
  .folder-arrow { font-size: 9px; transition: transform 0.15s; display: inline-block; }
  .folder-label.collapsed .folder-arrow { transform: rotate(-90deg); }
  .folder-children {
    /* Visual indent per nesting level. Stacks recursively for deep trees
       (e.g. daily/YYYY/MM/DD/events.md). The border-left acts as a subtle
       guide line connecting a folder's descendants. */
    margin-left: 16px;
    border-left: 1px solid var(--ls-color-border, #2a2a3e);
  }
  .folder-children.hidden { display: none; }
  .file-item {
    display: flex;
    align-items: center;
    padding: 3px 12px 3px 24px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ls-color-fg, #e0e0e0);
    border-radius: 0;
  }
  .file-item:hover { background: rgba(255,255,255,0.05); }
  .file-item.active {
    background: rgba(124,106,247,0.18);
    color: var(--ls-color-accent, #7c6af7);
    font-weight: 500;
  }
  .file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .rename-input {
    flex: 1;
    background: var(--ls-color-bg-input, #0f0f1a);
    border: 1px solid var(--ls-color-accent, #7c6af7);
    border-radius: 3px;
    color: var(--ls-color-fg, #e0e0e0);
    font-size: 13px;
    font-family: inherit;
    padding: 1px 5px;
    outline: none;
    min-width: 0;
  }
  .empty-hint {
    padding: 16px 12px;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 12px;
    font-style: italic;
  }
  .zone-badge {
    margin-left: 6px;
    font-size: 10px;
    line-height: 1;
    opacity: 0.75;
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 0 2px;
    border-radius: 3px;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .zone-badge:hover { opacity: 1; background: rgba(255,255,255,0.08); }
  .zone-badge.locked { color: #fcd34d; }
  .zone-badge.unlocked { color: #86efac; }
  .new-menu {
    position: fixed;
    display: none;
    background: var(--ls-color-bg-overlay, #1e1e2e);
    border: 1px solid var(--ls-color-border, #2a2a3e);
    border-radius: 6px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.45);
    padding: 4px;
    width: 140px;
    z-index: 200;
    font-size: 13px;
  }
  .new-menu.visible { display: block; }
  .new-menu button {
    display: block;
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
  .new-menu button:hover { background: rgba(255,255,255,0.08); }
  .new-row {
    display: flex;
    align-items: center;
    padding: 3px 12px 3px 24px;
  }
  .new-row.folder {
    padding: 3px 12px 3px 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ls-color-fg-muted, #64748b);
  }
  .new-row input {
    flex: 1;
    background: var(--ls-color-bg-input, #0f0f1a);
    border: 1px solid var(--ls-color-accent, #7c6af7);
    border-radius: 3px;
    color: var(--ls-color-fg, #e0e0e0);
    font-size: 13px;
    font-family: inherit;
    padding: 1px 5px;
    outline: none;
    min-width: 0;
  }
`;

const MENU_WIDTH = 140;
const MENU_MARGIN = 8;

export interface ZoneInfo {
  /** Folder prefix, always ending in "/". */
  prefix: string;
  /** Whether the zone's identity is held in memory right now. */
  unlocked: boolean;
}

export class LSFileTree extends HTMLElement {
  #notes: string[] = [];
  #activePath = "";
  #collapsedFolders = new Set<string>();
  #zones: ZoneInfo[] = [];
  #shadow: ShadowRoot;
  #menu!: HTMLElement;
  #menuFolder = "";
  #menuDocClickHandler: ((e: MouseEvent) => void) | null = null;
  #inlineActive = false;
  #renderSuppressedDuringInline = false;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#buildMenu();
  }

  #buildMenu(): void {
    this.#menu = document.createElement("div");
    this.#menu.className = "new-menu";

    const items: Array<{ label: string; kind: "note" | "canvas" | "folder" }> = [
      { label: "New note", kind: "note" },
      { label: "New canvas", kind: "canvas" },
      { label: "New folder", kind: "folder" },
    ];
    for (const item of items) {
      const btn = document.createElement("button");
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const folder = this.#menuFolder;
        this.#hideMenu();
        this.#startInline(folder, item.kind);
      });
      this.#menu.appendChild(btn);
    }
    this.#shadow.appendChild(this.#menu);
  }

  /**
   * Show the menu anchored to the LEFT of the `+` button (menu's right edge
   * sits just left of the button). Clamps horizontally so the menu stays
   * within the viewport, which matters on narrow / mobile-dominant layouts
   * where the file tree is close to the left edge.
   */
  #showMenu(anchor: HTMLElement, folder: string): void {
    this.#menuFolder = folder;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    // Preferred: to the left of the button.
    let left = rect.left - MENU_WIDTH - 4;
    // If that pushes off-screen on the left, fall back to showing it below-right.
    if (left < MENU_MARGIN) left = Math.min(rect.left, viewportWidth - MENU_WIDTH - MENU_MARGIN);
    // Final guard: never let it extend past the right edge.
    left = Math.max(MENU_MARGIN, Math.min(left, viewportWidth - MENU_WIDTH - MENU_MARGIN));

    this.#menu.style.left = `${left}px`;
    this.#menu.style.top = `${rect.top}px`;
    this.#menu.classList.add("visible");

    // Dismiss on any outside click. Register on next tick so the click that
    // opened the menu doesn't immediately close it.
    setTimeout(() => {
      this.#menuDocClickHandler = () => this.#hideMenu();
      document.addEventListener("click", this.#menuDocClickHandler, { once: true });
    }, 0);
  }

  #hideMenu(): void {
    this.#menu.classList.remove("visible");
    if (this.#menuDocClickHandler) {
      document.removeEventListener("click", this.#menuDocClickHandler);
      this.#menuDocClickHandler = null;
    }
  }

  connectedCallback(): void {
    this.#render();
  }

  get notes(): string[] { return this.#notes; }
  set notes(v: string[]) {
    this.#notes = v;
    // Never blow away an in-progress inline-create input. Defer the render
    // until the user commits or cancels so their typing isn't wiped by a
    // sync tick.
    if (this.#inlineActive) {
      this.#renderSuppressedDuringInline = true;
      return;
    }
    this.#render();
  }

  get activePath(): string { return this.#activePath; }
  set activePath(v: string) {
    this.#activePath = v;
    // Fast update: just swap active class without full re-render.
    this.#shadow.querySelectorAll(".file-item").forEach((el) => {
      el.classList.toggle("active", (el as HTMLElement).dataset["path"] === v);
    });
  }

  get zones(): ZoneInfo[] { return this.#zones; }
  set zones(v: ZoneInfo[]) {
    this.#zones = v;
    if (!this.#inlineActive) this.#render();
  }

  /** Which zone, if any, is rooted exactly at this folder. */
  #zoneAtFolder(folder: string): ZoneInfo | undefined {
    const prefix = folder + "/";
    return this.#zones.find((z) => z.prefix === prefix);
  }

  #zoneBadge(zone: ZoneInfo): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `zone-badge ${zone.unlocked ? "unlocked" : "locked"}`;
    // U+1F512 = padlock, U+1F513 = open padlock. Hue matters more than glyph
    // for at-a-glance state, but both cues together make it unambiguous.
    btn.textContent = zone.unlocked ? "🔓" : "🔒";
    btn.title = zone.unlocked
      ? `Unlocked — click to lock ${zone.prefix}`
      : `Locked — click to unlock ${zone.prefix}`;
    btn.addEventListener("click", (e) => {
      // Don't let the click bubble to the folder-label (which would toggle
      // collapse state) or to the document (which would dismiss any open menu).
      e.stopPropagation();
      this.dispatchEvent(
        new CustomEvent("zone-toggle", {
          bubbles: true,
          composed: true,
          detail: { prefix: zone.prefix, unlocked: zone.unlocked },
        }),
      );
    });
    return btn;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  #render(): void {
    // Remove previous tree content (keep the style element).
    const existing = this.#shadow.getElementById("tree-root");
    if (existing) existing.remove();

    const root = document.createElement("div");
    root.id = "tree-root";
    root.style.cssText = "display:flex;flex-direction:column;height:100%;overflow:hidden;";

    // Header
    const header = document.createElement("div");
    header.className = "tree-header";
    header.textContent = "Notes";
    const newBtn = document.createElement("button");
    newBtn.title = "New note, canvas, or folder";
    newBtn.textContent = "+";
    newBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#showMenu(newBtn, "");
    });
    header.appendChild(newBtn);
    root.appendChild(header);

    // Scroll container
    const scroll = document.createElement("div");
    scroll.className = "tree-scroll";
    scroll.dataset["folder"] = "";

    if (this.#notes.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "No notes yet. Create one!";
      scroll.appendChild(hint);
    } else {
      const tree = this.#buildTree(this.#notes);
      this.#renderTree(tree, scroll, "");
    }

    root.appendChild(scroll);
    this.#shadow.appendChild(root);
  }

  #buildTree(paths: string[]): Map<string, string[]> {
    // Returns folder → file[] map; root files under key "". Intermediate folder
    // keys are added even when they contain no direct children so the render
    // pass can find them (e.g. daily/2026 shows up above daily/2026/04/16).
    const folders = new Map<string, string[]>();
    folders.set("", []);
    for (const p of [...paths].sort()) {
      const slash = p.lastIndexOf("/");
      const folder = slash >= 0 ? p.slice(0, slash) : "";
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder)!.push(p);

      // Seed every ancestor folder so the tree walker can traverse through
      // paths that only contain subdirectories (no direct files of their own).
      let ancestor = folder;
      while (ancestor) {
        const up = ancestor.lastIndexOf("/");
        ancestor = up >= 0 ? ancestor.slice(0, up) : "";
        if (!folders.has(ancestor)) folders.set(ancestor, []);
      }
    }
    return folders;
  }

  #renderTree(
    tree: Map<string, string[]>,
    container: HTMLElement,
    parentPrefix: string
  ): void {
    const topFolders = [...tree.keys()]
      .filter((k) => {
        if (parentPrefix === "") return !k.includes("/") || k === "";
        return k.startsWith(parentPrefix + "/") && !k.slice(parentPrefix.length + 1).includes("/");
      })
      .sort();

    // Root-level files first
    const rootFiles = tree.get(parentPrefix) ?? [];
    for (const path of rootFiles) {
      container.appendChild(this.#fileItem(path));
    }

    // Then folders
    for (const folder of topFolders) {
      if (folder === parentPrefix || folder === "") continue;
      const folderName = folder.split("/").pop()!;
      const collapsed = this.#collapsedFolders.has(folder);

      const label = document.createElement("div");
      label.className = "folder-label" + (collapsed ? " collapsed" : "");
      label.dataset["folderLabel"] = folder;

      const arrow = document.createElement("span");
      arrow.className = "folder-arrow";
      arrow.textContent = "▾";

      const name = document.createElement("span");
      name.textContent = folderName;

      const zone = this.#zoneAtFolder(folder);
      const badge = zone ? this.#zoneBadge(zone) : null;

      const addBtn = document.createElement("button");
      addBtn.className = "new-btn";
      addBtn.title = `New in ${folder}`;
      addBtn.textContent = "+";
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.#showMenu(addBtn, folder);
      });

      label.append(arrow, name);
      if (badge) label.append(badge);
      label.append(addBtn);

      const children = document.createElement("div");
      children.className = "folder-children" + (collapsed ? " hidden" : "");
      children.dataset["folder"] = folder;

      label.addEventListener("click", () => {
        const isNowCollapsed = !this.#collapsedFolders.has(folder);
        if (isNowCollapsed) {
          this.#collapsedFolders.add(folder);
        } else {
          this.#collapsedFolders.delete(folder);
        }
        label.classList.toggle("collapsed", isNowCollapsed);
        children.classList.toggle("hidden", isNowCollapsed);
      });

      container.appendChild(label);
      container.appendChild(children);
      this.#renderTree(tree, children, folder);
    }
  }

  #fileItem(path: string): HTMLElement {
    const div = document.createElement("div");
    div.className = "file-item" + (path === this.#activePath ? " active" : "");
    div.dataset["path"] = path;
    div.title = path;
    div.tabIndex = 0;

    const base = path.split("/").pop() ?? path;
    const displayName = base.endsWith(".md") ? base.slice(0, -3) : base;

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-name";
    nameSpan.textContent = displayName;
    div.appendChild(nameSpan);

    let clickTimer: ReturnType<typeof setTimeout> | null = null;

    div.addEventListener("click", () => {
      // Single click opens; double-click triggers rename.
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        this.#startRename(div, nameSpan, path);
        return;
      }
      clickTimer = setTimeout(() => {
        clickTimer = null;
        this.dispatchEvent(
          new CustomEvent("file-open", { bubbles: true, composed: true, detail: { path } })
        );
      }, 220);
    });

    div.addEventListener("keydown", (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        this.#startRename(div, nameSpan, path);
      } else if (e.key === "Enter") {
        this.dispatchEvent(
          new CustomEvent("file-open", { bubbles: true, composed: true, detail: { path } })
        );
      }
    });

    return div;
  }

  #startRename(div: HTMLElement, nameSpan: HTMLElement, oldPath: string): void {
    const base = oldPath.split("/").pop() ?? oldPath;
    const displayName = base.endsWith(".md") ? base.slice(0, -3) : base;
    const dir = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/") + 1) : "";

    const input = document.createElement("input");
    input.className = "rename-input";
    input.value = displayName;
    nameSpan.replaceWith(input);

    // Select the name without triggering further rename.
    requestAnimationFrame(() => { input.select(); });

    const commit = (): void => {
      const newName = input.value.trim();
      if (newName && newName !== displayName) {
        const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : ".md";
        const newPath = dir + newName + (newName.endsWith(ext) ? "" : ext);
        this.dispatchEvent(
          new CustomEvent("file-rename", {
            bubbles: true,
            composed: true,
            detail: { oldPath, newPath },
          })
        );
      }
      // Restore span whether or not rename happened.
      nameSpan.textContent = input.value.trim() || displayName;
      input.replaceWith(nameSpan);
      div.focus();
    };

    const cancel = (): void => {
      input.replaceWith(nameSpan);
      div.focus();
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { e.preventDefault(); input.removeEventListener("blur", commit); cancel(); }
    });
    // Prevent the click on the input from bubbling to file-open.
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  #emitNew(folder: string, kind: "note" | "canvas" | "folder", name: string): void {
    this.dispatchEvent(
      new CustomEvent("file-new", {
        bubbles: true,
        composed: true,
        detail: { folder, kind, name },
      })
    );
  }

  /**
   * Insert an inline placeholder row with a focused text input. Fires
   * `file-new` with the typed name on Enter, cancels on Escape, or commits
   * on blur (empty input cancels). Matches the double-click-to-rename UX
   * pattern so the new-file flow feels like a natural extension of it.
   */
  #startInline(folder: string, kind: "note" | "canvas" | "folder"): void {
    // Expand the parent folder if it's collapsed so the placeholder is visible.
    if (folder && this.#collapsedFolders.has(folder)) {
      this.#collapsedFolders.delete(folder);
      const label = this.#shadow.querySelector<HTMLElement>(`[data-folder-label="${CSS.escape(folder)}"]`);
      const children = this.#shadow.querySelector<HTMLElement>(`[data-folder="${CSS.escape(folder)}"]`);
      label?.classList.remove("collapsed");
      children?.classList.remove("hidden");
    }

    const container = folder === ""
      ? this.#shadow.querySelector<HTMLElement>('.tree-scroll')
      : this.#shadow.querySelector<HTMLElement>(`[data-folder="${CSS.escape(folder)}"]`);
    if (!container) return;

    this.#inlineActive = true;

    const row = document.createElement("div");
    row.className = kind === "folder" ? "new-row folder" : "new-row";

    if (kind === "folder") {
      const arrow = document.createElement("span");
      arrow.className = "folder-arrow";
      arrow.textContent = "▾";
      row.appendChild(arrow);
    }

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = kind === "folder"
      ? "folder name"
      : kind === "canvas"
        ? "canvas name"
        : "note name";
    row.appendChild(input);

    // Place at top of the container so it's visible even if the folder has
    // many children and the scroll position is deep.
    container.prepend(row);
    requestAnimationFrame(() => input.focus());

    let done = false;

    const finish = (): void => {
      if (done) return;
      done = true;
      this.#inlineActive = false;
      row.remove();
      // If a sync tick arrived while we were editing, refresh now.
      if (this.#renderSuppressedDuringInline) {
        this.#renderSuppressedDuringInline = false;
        this.#render();
      }
    };

    const commit = (): void => {
      if (done) return;
      const name = input.value.trim();
      if (!name) { finish(); return; }
      finish();
      this.#emitNew(folder, kind, name);
    };

    const cancel = (): void => {
      if (done) return;
      input.removeEventListener("blur", commit);
      finish();
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("click", (e) => e.stopPropagation());
  }
}

customElements.define("ls-file-tree", LSFileTree);
