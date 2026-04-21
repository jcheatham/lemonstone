// <ls-file-tree> — sidebar file list, grouped by folder.
//
// Properties:
//   notes — string[] of vault paths
//   activePath — currently open path (highlighted)
//
// Events (bubbles, composed):
//   file-open   — detail: { path: string }
//   file-new    — detail: { folder: string }
//   file-rename — detail: { oldPath: string; newPath: string }

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
  .folder-children { }
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
`;

export class LSFileTree extends HTMLElement {
  #notes: string[] = [];
  #activePath = "";
  #collapsedFolders = new Set<string>();
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

  get notes(): string[] { return this.#notes; }
  set notes(v: string[]) {
    this.#notes = v;
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
    newBtn.title = "New note";
    newBtn.textContent = "+";
    newBtn.addEventListener("click", () => this.#emitNew(""));
    header.appendChild(newBtn);
    root.appendChild(header);

    // Scroll container
    const scroll = document.createElement("div");
    scroll.className = "tree-scroll";

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
    // Returns folder → file[] map; root files under key "".
    const folders = new Map<string, string[]>();
    for (const p of [...paths].sort()) {
      const slash = p.lastIndexOf("/");
      const folder = slash >= 0 ? p.slice(0, slash) : "";
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder)!.push(p);
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

      const arrow = document.createElement("span");
      arrow.className = "folder-arrow";
      arrow.textContent = "▾";

      const name = document.createElement("span");
      name.textContent = folderName;

      const addBtn = document.createElement("button");
      addBtn.className = "new-btn";
      addBtn.title = `New note in ${folder}`;
      addBtn.textContent = "+";
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.#emitNew(folder);
      });

      label.append(arrow, name, addBtn);

      const children = document.createElement("div");
      children.className = "folder-children" + (collapsed ? " hidden" : "");

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

  #emitNew(folder: string): void {
    this.dispatchEvent(
      new CustomEvent("file-new", {
        bubbles: true,
        composed: true,
        detail: { folder },
      })
    );
  }
}

customElements.define("ls-file-tree", LSFileTree);
