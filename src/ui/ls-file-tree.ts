// <ls-file-tree> — sidebar file list, grouped by folder.
//
// Properties:
//   notes — string[] of vault paths
//   activePath — currently open path (highlighted)
//   zones — { prefix, unlocked }[] for rendering lock glyphs on encrypted folders
//   commands — readonly PaletteCommand[] — the app's command registry, used to
//     populate the right-click/"..." context menu with applicable commands
//
// Events (bubbles, composed):
//   file-open     — detail: { path: string }
//   file-new      — detail: { folder: string; kind: "note" | "canvas" | "folder" | "snippet"; name: string }
//   file-rename   — detail: { oldPath: string; newPath: string }
//   folder-rename — detail: { oldPath: string; newPath: string } — folder renamed/moved via its own inline edit
//   file-command  — detail: { id: string; path: string; kind: TargetKind } — a registry command chosen from the context menu
//   zone-toggle   — detail: { prefix: string; unlocked: boolean } — user clicked the lock badge
//
// The header's "+" button opens a small menu for creating at the vault root.
// Per-folder creation lives in the "Create" group of that folder's context
// menu instead (right-click, long-press, or its "..." button) — see
// #buildContextMenuGroups.

import type { PaletteCommand, CommandTarget, TargetKind } from "./command-types.ts";
import "./ls-context-menu.ts";
import type { LSContextMenu, ContextMenuGroup, ContextMenuItem } from "./ls-context-menu.ts";
import { fileKind } from "../util/file-kind.ts";

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
  .row-menu-btn {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 4px;
    opacity: 0;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .file-item:hover .row-menu-btn,
  .folder-label:hover .row-menu-btn {
    opacity: 1;
  }
  .row-menu-btn:hover { background: rgba(255,255,255,0.1); }
  /* The file-tree panel is 220-400px wide even on desktop, so panel width
     can't distinguish "mobile" from "desktop sidebar" — hover capability
     can. Touch devices have no hover, so they need an always-visible tap
     target instead of the hover-reveal desktop uses. */
  @media (hover: none) {
    .row-menu-btn { opacity: 1; }
  }
  /* file-item's .file-name is flex:1 and already pushes trailing buttons to
     the end; folder-label has no such spacer, so its "+"/"..." rely on an
     auto left margin to sit flush right instead. */
  .folder-label .row-menu-btn { margin-left: auto; }
  [draggable="true"] { cursor: grab; }
  .dragging { opacity: 0.5; }
  .folder-label.drag-over,
  .tree-scroll.drag-over {
    outline: 2px solid var(--ls-color-accent, #7c6af7);
    outline-offset: -2px;
    background: rgba(124,106,247,0.10);
  }
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
    /* Long-press on mobile can accidentally trigger iOS selection callouts
       or text selection, which fights with our own rename-on-long-press.
       These two lines keep the press clean. The name still shows a caret
       when the inline input takes over. */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
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
    /* Re-enable text selection inside the rename input — the file-item it
       replaces disables selection to keep long-press clean. */
    -webkit-user-select: auto;
    user-select: auto;
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
  #commands: readonly PaletteCommand[] = [];
  #shadow: ShadowRoot;
  #menu!: HTMLElement;
  #menuFolder = "";
  #menuDocClickHandler: ((e: MouseEvent) => void) | null = null;
  #inlineActive = false;
  #renderSuppressedDuringInline = false;
  #ctxMenu!: LSContextMenu;
  #ctxMenuTarget: { path: string; kind: TargetKind; row: HTMLElement; nameSpan: HTMLElement } | null = null;
  // dataTransfer.getData() is unreadable during dragover (only at drop), so
  // the in-flight drag payload is tracked here instead.
  #currentDrag: { path: string; kind: TargetKind } | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#buildMenu();
    this.#buildContextMenu();
  }

  #buildContextMenu(): void {
    this.#ctxMenu = document.createElement("ls-context-menu") as LSContextMenu;
    this.#ctxMenu.addEventListener("menu-select", (e) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      const target = this.#ctxMenuTarget;
      this.#ctxMenuTarget = null;
      if (!target) return;
      if (id === "__rename") {
        if (target.kind === "folder") this.#startFolderRename(target.nameSpan, target.path);
        else this.#startRename(target.row, target.nameSpan, target.path);
      } else if (id.startsWith("__new:")) {
        const subkind = id.slice("__new:".length) as "note" | "canvas" | "snippet" | "folder";
        this.#startInline(target.path, subkind);
      } else {
        this.dispatchEvent(
          new CustomEvent("file-command", {
            bubbles: true,
            composed: true,
            detail: { id, path: target.path, kind: target.kind },
          })
        );
      }
    });
    this.#shadow.appendChild(this.#ctxMenu);
  }

  set commands(cmds: readonly PaletteCommand[]) {
    this.#commands = cmds;
  }

  /** Builds the category-grouped, applicability-filtered menu content for a
   *  right-click / long-press / "..." on a given row. */
  #buildContextMenuGroups(path: string, kind: TargetKind): ContextMenuGroup[] {
    const groups: ContextMenuGroup[] = [];

    if (kind === "folder") {
      groups.push({
        category: "Create",
        items: [
          { id: "__new:note", label: "New note here" },
          { id: "__new:canvas", label: "New canvas here" },
          { id: "__new:snippet", label: "New snippet here" },
          { id: "__new:folder", label: "New folder here" },
        ],
      });
    }

    const target: CommandTarget = { path, kind };
    const registryItems: ContextMenuItem[] = this.#commands
      .filter((c) => c.isApplicable?.(target))
      .map((c) => ({
        id: c.id,
        label: c.label,
        shortcut: c.shortcut,
        destructive: c.id.startsWith("delete-"),
      }));

    groups.push({
      category: kind === "folder" ? "Folder" : "File",
      items: [{ id: "__rename", label: "Rename" }, ...registryItems],
    });

    return groups;
  }

  #openContextMenu(x: number, y: number, path: string, kind: TargetKind, row: HTMLElement, nameSpan: HTMLElement): void {
    this.#ctxMenuTarget = { path, kind, row, nameSpan };
    this.#ctxMenu.open(x, y, this.#buildContextMenuGroups(path, kind));
  }

  // ── Drag-to-move ─────────────────────────────────────────────────────────

  #isValidDropTarget(drag: { path: string; kind: TargetKind }, targetFolder: string): boolean {
    if (drag.kind === "folder") {
      if (drag.path === targetFolder) return false;
      if (targetFolder.startsWith(drag.path + "/")) return false;
    }
    const currentParent = drag.path.includes("/") ? drag.path.slice(0, drag.path.lastIndexOf("/")) : "";
    return currentParent !== targetFolder;
  }

  #handleDrop(targetFolder: string): void {
    const drag = this.#currentDrag;
    this.#currentDrag = null;
    if (!drag || !this.#isValidDropTarget(drag, targetFolder)) return;
    const base = drag.path.split("/").pop()!;
    const newPath = targetFolder ? `${targetFolder}/${base}` : base;
    if (drag.kind === "folder") {
      this.dispatchEvent(
        new CustomEvent("folder-rename", { bubbles: true, composed: true, detail: { oldPath: drag.path, newPath } })
      );
    } else {
      this.dispatchEvent(
        new CustomEvent("file-rename", { bubbles: true, composed: true, detail: { oldPath: drag.path, newPath } })
      );
    }
  }

  connectedCallback(): void {
    this.#render();
  }

  #buildMenu(): void {
    this.#menu = document.createElement("div");
    this.#menu.className = "new-menu";

    const items: Array<{ label: string; kind: "note" | "canvas" | "folder" | "snippet" }> = [
      { label: "New note", kind: "note" },
      { label: "New canvas", kind: "canvas" },
      { label: "New snippet", kind: "snippet" },
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
    // Root drop target — only when the drag is over genuine background, not
    // bubbling up from a row (rows handle their own drop targets).
    scroll.addEventListener("dragover", (e) => {
      if ((e.target as HTMLElement).closest(".folder-label, .file-item")) return;
      if (!this.#currentDrag || !this.#isValidDropTarget(this.#currentDrag, "")) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      scroll.classList.add("drag-over");
    });
    scroll.addEventListener("dragleave", (e) => {
      if (e.target === scroll) scroll.classList.remove("drag-over");
    });
    scroll.addEventListener("drop", (e) => {
      if ((e.target as HTMLElement).closest(".folder-label, .file-item")) return;
      e.preventDefault();
      scroll.classList.remove("drag-over");
      this.#handleDrop("");
    });

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
      label.draggable = true;
      label.addEventListener("dragstart", (e) => {
        this.#currentDrag = { path: folder, kind: "folder" };
        label.classList.add("dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", folder);
        }
      });
      label.addEventListener("dragend", () => {
        label.classList.remove("dragging");
        this.#currentDrag = null;
      });
      label.addEventListener("dragover", (e) => {
        if (!this.#currentDrag || !this.#isValidDropTarget(this.#currentDrag, folder)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        label.classList.add("drag-over");
      });
      label.addEventListener("dragleave", () => label.classList.remove("drag-over"));
      label.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        label.classList.remove("drag-over");
        this.#handleDrop(folder);
      });

      const arrow = document.createElement("span");
      arrow.className = "folder-arrow";
      arrow.textContent = "▾";

      const name = document.createElement("span");
      name.textContent = folderName;

      const zone = this.#zoneAtFolder(folder);
      const badge = zone ? this.#zoneBadge(zone) : null;

      const menuBtn = document.createElement("button");
      menuBtn.type = "button";
      menuBtn.className = "row-menu-btn";
      menuBtn.title = "More actions";
      menuBtn.textContent = "⋯";
      menuBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const r = menuBtn.getBoundingClientRect();
        this.#openContextMenu(r.left, r.bottom + 4, folder, "folder", label, name);
      });

      label.append(arrow, name);
      if (badge) label.append(badge);
      label.append(menuBtn);

      const children = document.createElement("div");
      children.className = "folder-children" + (collapsed ? " hidden" : "");
      children.dataset["folder"] = folder;

      // Right-click / long-press → contextual command menu, mirroring the
      // file-item gesture handling below.
      let folderLongPressTimer: ReturnType<typeof setTimeout> | null = null;
      let folderLongPressFired = false;
      let folderPressStart: { x: number; y: number } | null = null;
      const FOLDER_LONG_PRESS_MS = 500;
      const FOLDER_MOVE_CANCEL_PX = 10;
      const cancelFolderLongPress = (): void => {
        if (folderLongPressTimer) {
          clearTimeout(folderLongPressTimer);
          folderLongPressTimer = null;
        }
        folderPressStart = null;
      };
      label.addEventListener("click", (e) => {
        // A long-press is followed by a synthetic click on most touch
        // devices — swallow it so it doesn't also toggle collapse state.
        if (folderLongPressFired) {
          folderLongPressFired = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const isNowCollapsed = !this.#collapsedFolders.has(folder);
        if (isNowCollapsed) {
          this.#collapsedFolders.add(folder);
        } else {
          this.#collapsedFolders.delete(folder);
        }
        label.classList.toggle("collapsed", isNowCollapsed);
        children.classList.toggle("hidden", isNowCollapsed);
      });

      label.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        folderLongPressFired = false;
        folderPressStart = { x: e.clientX, y: e.clientY };
        folderLongPressTimer = setTimeout(() => {
          folderLongPressTimer = null;
          folderLongPressFired = true;
          const p = folderPressStart!;
          if (typeof navigator.vibrate === "function") navigator.vibrate(10);
          this.#openContextMenu(p.x, p.y, folder, "folder", label, name);
        }, FOLDER_LONG_PRESS_MS);
      });
      label.addEventListener("pointermove", (e) => {
        if (!folderPressStart) return;
        const dx = Math.abs(e.clientX - folderPressStart.x);
        const dy = Math.abs(e.clientY - folderPressStart.y);
        if (dx > FOLDER_MOVE_CANCEL_PX || dy > FOLDER_MOVE_CANCEL_PX) cancelFolderLongPress();
      });
      label.addEventListener("pointerup", cancelFolderLongPress);
      label.addEventListener("pointercancel", cancelFolderLongPress);
      label.addEventListener("pointerleave", cancelFolderLongPress);
      label.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        cancelFolderLongPress();
        this.#openContextMenu(e.clientX, e.clientY, folder, "folder", label, name);
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
    div.draggable = true;
    div.addEventListener("dragstart", (e) => {
      this.#currentDrag = { path, kind: fileKind(path) };
      div.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", path);
      }
    });
    div.addEventListener("dragend", () => {
      div.classList.remove("dragging");
      this.#currentDrag = null;
    });

    const base = path.split("/").pop() ?? path;

    // Snippets (.html) get a distinct </> glyph so they read differently from
    // markdown notes and canvases in the tree.
    if (base.toLowerCase().endsWith(".html")) {
      const icon = document.createElement("span");
      icon.className = "file-icon";
      icon.textContent = "</>";
      icon.style.cssText = "font: 10px ui-monospace, monospace; opacity: 0.6; margin-right: 5px;";
      div.appendChild(icon);
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-name";
    nameSpan.textContent = base;
    div.appendChild(nameSpan);

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "row-menu-btn";
    menuBtn.title = "More actions";
    menuBtn.textContent = "⋯";
    menuBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = menuBtn.getBoundingClientRect();
      this.#openContextMenu(r.left, r.bottom + 4, path, fileKind(path), div, nameSpan);
    });
    div.appendChild(menuBtn);

    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressFired = false;
    let pressStart: { x: number; y: number } | null = null;
    const LONG_PRESS_MS = 500;
    const MOVE_CANCEL_PX = 10;

    const cancelLongPress = (): void => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      pressStart = null;
    };

    div.addEventListener("pointerdown", (e) => {
      // Only primary button for mouse; touch/pen always proceed.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      longPressFired = false;
      pressStart = { x: e.clientX, y: e.clientY };
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
        // Cancel any pending single-click open; we're going into the menu.
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        // A short haptic buzz confirms "menu open" on phones that support it.
        // Noop on desktop / iOS Safari.
        if (typeof navigator.vibrate === "function") navigator.vibrate(10);
        const p = pressStart!;
        this.#openContextMenu(p.x, p.y, path, fileKind(path), div, nameSpan);
      }, LONG_PRESS_MS);
    });

    div.addEventListener("pointermove", (e) => {
      if (!pressStart) return;
      const dx = Math.abs(e.clientX - pressStart.x);
      const dy = Math.abs(e.clientY - pressStart.y);
      // A scroll gesture starts with a pointerdown on a file; if the finger
      // moves past the threshold we bail out so we don't mis-fire rename.
      if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) cancelLongPress();
    });

    div.addEventListener("pointerup", cancelLongPress);
    div.addEventListener("pointercancel", cancelLongPress);
    div.addEventListener("pointerleave", cancelLongPress);

    div.addEventListener("click", (e) => {
      // A long-press is followed by a synthetic click on most touch devices —
      // swallow it so we don't also open the note behind the rename input.
      if (longPressFired) {
        longPressFired = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
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

    // Right-click opens the contextual command menu, replacing the browser's
    // default context menu (which on mobile can show text-selection actions
    // that don't apply to a virtual list row).
    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      cancelLongPress();
      this.#openContextMenu(e.clientX, e.clientY, path, fileKind(path), div, nameSpan);
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
    const dir = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/") + 1) : "";

    const input = document.createElement("input");
    input.className = "rename-input";
    input.value = base;
    nameSpan.replaceWith(input);

    // Pre-select just the stem (before the final dot) so typing replaces the
    // name without clobbering the extension — the common case.
    requestAnimationFrame(() => {
      input.focus();
      const dot = base.lastIndexOf(".");
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    });

    const commit = (): void => {
      const newName = input.value.trim();
      if (newName && newName !== base) {
        // If the user typed a name without an extension, preserve the original
        // extension so "my-note" renaming "foo.md" stays a .md file.
        const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
        const newPath = dir + (newName.includes(".") ? newName : newName + ext);
        this.dispatchEvent(
          new CustomEvent("file-rename", {
            bubbles: true,
            composed: true,
            detail: { oldPath, newPath },
          })
        );
      }
      // Restore span whether or not rename happened.
      nameSpan.textContent = input.value.trim() || base;
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

  /** Inline rename for a folder row — same input-swap UX as #startRename, but
   *  folders have no extension to preserve and fire `folder-rename` instead. */
  #startFolderRename(nameSpan: HTMLElement, oldFolder: string): void {
    const base = oldFolder.split("/").pop() ?? oldFolder;
    const dir = oldFolder.includes("/") ? oldFolder.slice(0, oldFolder.lastIndexOf("/") + 1) : "";

    const input = document.createElement("input");
    input.className = "rename-input";
    input.value = base;
    nameSpan.replaceWith(input);

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });

    const commit = (): void => {
      const newName = input.value.trim();
      if (newName && newName !== base) {
        const newPath = dir + newName;
        this.dispatchEvent(
          new CustomEvent("folder-rename", {
            bubbles: true,
            composed: true,
            detail: { oldPath: oldFolder, newPath },
          })
        );
      }
      nameSpan.textContent = input.value.trim() || base;
      input.replaceWith(nameSpan);
    };

    const cancel = (): void => {
      input.replaceWith(nameSpan);
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { e.preventDefault(); input.removeEventListener("blur", commit); cancel(); }
    });
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  #emitNew(folder: string, kind: "note" | "canvas" | "folder" | "snippet", name: string): void {
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
  #startInline(folder: string, kind: "note" | "canvas" | "folder" | "snippet"): void {
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
        : kind === "snippet"
          ? "snippet name"
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
