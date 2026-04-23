// <ls-app> — root shell. Owns the sidebar, editor pane, and overlays.
//
// Wires together:
//   <ls-file-tree>, <ls-editor>, <ls-backlinks>, <ls-outline>,
//   <ls-command-palette>, <ls-switcher>, hash router, vaultService.

import { isAuthenticated, loadTokens } from "../auth/index.ts";
import { vaultService } from "../vault/index.ts";
import { getDB } from "../storage/db.ts";
import { currentRoute, navigateTo, navigateHome } from "./router.ts";
import type { Route } from "./router.ts";
import { parseHeadings } from "./ls-outline.ts";
import "./ls-modal.ts";
import "./ls-file-tree.ts";
import "./ls-backlinks.ts";
import "./ls-outline.ts";
import "./ls-command-palette.ts";
import "./ls-switcher.ts";
import "./ls-editor.ts";
import "./ls-search.ts";
import "./ls-category-nav.ts";
import type { LSCategoryNav } from "./ls-category-nav.ts";
import "./ls-calendar.ts";
import type { LSCalendar } from "./ls-calendar.ts";
import "./ls-canvas.ts";
import type { LSCanvas } from "./ls-canvas.ts";
import "./ls-history.ts";
import type { LSHistory, CommitSummary } from "./ls-history.ts";
import "./ls-unlock-modal.ts";
import type { LSUnlockModal } from "./ls-unlock-modal.ts";
import "./ls-enable-encryption-modal.ts";
import type { LSEncryptFolderModal } from "./ls-enable-encryption-modal.ts";
import { parseCanvas, serializeCanvas, emptyCanvas, mergeCanvases } from "../canvas/index.ts";
import { canInstall, triggerInstall } from "../pwa.ts";
import { getToast } from "./ls-toast.ts";
import type { LSFileTree } from "./ls-file-tree.ts";
import type { LSBacklinks } from "./ls-backlinks.ts";
import type { LSOutline } from "./ls-outline.ts";
import type { LSCommandPalette } from "./ls-command-palette.ts";
import type { LSSwitcher } from "./ls-switcher.ts";
import type { LSEditor } from "./ls-editor.ts";
import type { LSSearch } from "./ls-search.ts";

const style = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    font-family: var(--ls-font-ui, system-ui, sans-serif);
    background: var(--ls-color-bg, #1a1a2e);
    color: var(--ls-color-fg, #e0e0e0);
  }
  /* Row layout that houses the three main panes. Sits between the optional
     mobile breadcrumb (on top) and the always-visible status bar (at bottom). */
  #layout {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-height: 0;
    overflow: hidden;
  }
  #category-panel {
    width: 280px;
    min-width: 220px;
    max-width: 400px;
    border-right: 1px solid var(--ls-color-border, #2a2a3e);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--ls-color-bg-sidebar, #16162a);
    transition: opacity 180ms ease;
  }
  #category-panel.dimmed { opacity: 0.5; }
  #category-panel > .panel-content {
    display: none;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  #category-panel > .panel-content.active { display: flex; }
  .panel-header {
    padding: 10px 14px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ls-color-fg-muted, #64748b);
    flex-shrink: 0;
  }
  .panel-top {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .panel-bottom {
    flex-shrink: 0;
    max-height: 40vh;
    overflow-y: auto;
    border-top: 1px solid var(--ls-color-border, #2a2a3e);
  }
  .panel-placeholder {
    padding: 24px 16px;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 12px;
    font-style: italic;
    text-align: center;
  }

  /* Commands category list */
  .commands-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .command-row {
    display: block;
    width: 100%;
    padding: 8px 14px;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  .command-row:hover { background: rgba(255,255,255,0.05); }
  .command-row .command-main {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 13px;
  }
  .command-row .command-label { flex: 1; color: var(--ls-color-fg, #e0e0e0); }
  .command-row .command-shortcut {
    color: var(--ls-color-fg-muted, #64748b);
    font-family: var(--ls-font-mono, monospace);
    font-size: 11px;
    white-space: nowrap;
  }
  .command-row .command-desc {
    font-size: 11px;
    color: var(--ls-color-fg-muted, #64748b);
    margin-top: 2px;
  }
  #main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }
  #editor-wrap {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  ls-editor {
    display: block;
    height: 100%;
  }
  #welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--ls-color-fg-muted, #64748b);
  }
  #welcome h2 { margin: 0; font-size: 20px; color: var(--ls-color-fg, #e0e0e0); }
  #welcome p { margin: 0; font-size: 13px; }
  #welcome kbd {
    background: rgba(255,255,255,0.08);
    border: 1px solid var(--ls-color-border, #333);
    border-radius: 4px;
    padding: 1px 6px;
    font-family: var(--ls-font-mono, monospace);
    font-size: 12px;
  }
  #status-bar {
    height: 24px;
    padding: 0 10px;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-top: 1px solid var(--ls-color-border, #2a2a3e);
    background: var(--ls-color-bg-subtle, #0f0f1a);
    color: var(--ls-color-fg-muted, #64748b);
    flex-shrink: 0;
  }
  .status-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--ls-color-fg-muted, #64748b);
    flex-shrink: 0;
  }
  .status-dot.syncing { background: #f59e0b; }
  .status-dot.ok { background: #86efac; }
  .status-dot.error { background: #f87171; }
  .status-dot.conflict { background: #f59e0b; }
  #auth-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  #auth-overlay.visible { display: flex; }

  /* Conflict banner */
  #conflict-banner {
    display: none;
    padding: 6px 14px;
    background: rgba(245,158,11,0.12);
    border-bottom: 1px solid #f59e0b;
    font-size: 12px;
    color: #f59e0b;
    gap: 8px;
    align-items: center;
  }
  #conflict-banner.visible { display: flex; }
  #conflict-banner button {
    margin-left: auto;
    background: none;
    border: 1px solid #f59e0b;
    color: #f59e0b;
    border-radius: 4px;
    padding: 1px 8px;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
  }
  #conflict-banner button:hover { background: rgba(245,158,11,0.15); }

  /* Mobile breadcrumb — hidden on desktop, visible at level 1+ on narrow screens. */
  #mobile-breadcrumb {
    display: none;
    align-items: center;
    gap: 2px;
    padding: 10px 12px;
    background: var(--ls-color-bg-sidebar, #16162a);
    border-bottom: 1px solid var(--ls-color-border, #2a2a3e);
    font-size: 13px;
    flex-shrink: 0;
  }
  #mobile-breadcrumb .bc-segment {
    background: none;
    border: none;
    color: var(--ls-color-fg, #e0e0e0);
    cursor: pointer;
    font: inherit;
    padding: 4px 8px;
    border-radius: 4px;
    max-width: 60vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #mobile-breadcrumb .bc-segment:first-of-type {
    color: var(--ls-color-accent, #7c6af7);
  }
  #mobile-breadcrumb .bc-segment:hover { background: rgba(255,255,255,0.05); }
  #mobile-breadcrumb .bc-sep { color: var(--ls-color-fg-muted, #64748b); font-size: 14px; padding: 0 2px; }

  @media (max-width: 720px) {
    /* Level 0 — category nav fills the pane; panel/main hidden. */
    :host([data-mobile-level="0"]) ls-category-nav {
      width: 100%;
      max-width: none;
      min-width: 0;
      border-right: none;
    }
    :host([data-mobile-level="0"]) #category-panel { display: none; }
    :host([data-mobile-level="0"]) #main { display: none; }

    /* Level 1 — breadcrumb + category panel full-width. */
    :host([data-mobile-level="1"]) ls-category-nav { display: none; }
    :host([data-mobile-level="1"]) #category-panel {
      width: 100%;
      max-width: none;
      min-width: 0;
      border-right: none;
    }
    :host([data-mobile-level="1"]) #main { display: none; }
    :host([data-mobile-level="1"]) #mobile-breadcrumb { display: flex; }

    /* Level 2 — breadcrumb + main pane full-width. */
    :host([data-mobile-level="2"]) ls-category-nav,
    :host([data-mobile-level="2"]) #category-panel { display: none; }
    :host([data-mobile-level="2"]) #main { width: 100%; }
    :host([data-mobile-level="2"]) #mobile-breadcrumb { display: flex; }
  }
`;

/**
 * Extract the YYYY-MM-DD date from a daily-note path.
 * Supports both the current nested layout (daily/YYYY/MM/DD/events.md) and
 * the legacy flat layout (daily/YYYY-MM-DD.md).
 */
function dailyDateFromPath(path: string, dailyFolder: string): string | null {
  const prefix = dailyFolder ? `${dailyFolder}/` : "";
  if (!path.startsWith(prefix)) return null;
  const rel = path.slice(prefix.length);
  const nested = /^(\d{4})\/(\d{2})\/(\d{2})\/[^/]+\.md$/.exec(rel);
  if (nested) return `${nested[1]}-${nested[2]}-${nested[3]}`;
  const flat = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(rel);
  if (flat) return flat[1]!;
  return null;
}

/**
 * Build the preferred (nested) path for a daily note.
 */
function dailyPathFor(date: string, dailyFolder: string): string {
  const [year, month, day] = date.split("-");
  const tail = `${year}/${month}/${day}/events.md`;
  return dailyFolder ? `${dailyFolder}/${tail}` : tail;
}

/**
 * Pull a short one-liner out of a daily note for the Upcoming/Recent lists.
 * Returns null when the note only contains template/date-heading content, so
 * effectively-empty notes don't clutter the events lists.
 */
function extractEventSummary(content: string, date: string): string | null {
  if (!content) return null;
  const dateHeading = `# ${date}`;
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed === dateHeading) continue;
    const cleaned = trimmed
      .replace(/^#+\s*/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^>\s+/, "")
      .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1");
    if (!cleaned) continue;
    return cleaned.length > 80 ? cleaned.slice(0, 80) + "…" : cleaned;
  }
  return null;
}

export class LSApp extends HTMLElement {
  #shadow!: ShadowRoot;
  #authOverlay!: HTMLElement;
  #editorWrap!: HTMLElement;
  #statusDot!: HTMLElement;
  #statusText!: HTMLElement;
  #repoLabel!: HTMLElement;
  #conflictBanner!: HTMLElement;
  #fileTree!: LSFileTree;
  #backlinks!: LSBacklinks;
  #outline!: LSOutline;
  #palette!: LSCommandPalette;
  #switcher!: LSSwitcher;
  #search!: LSSearch;
  #categoryNav!: LSCategoryNav;
  #categoryPanel!: HTMLElement;
  #mobileBreadcrumb!: HTMLElement;
  #statusBar!: HTMLElement;
  #calendar!: LSCalendar;
  #history!: LSHistory;
  #activeCommitOid = "";
  #commandsPanel!: HTMLElement;
  #unlockModal!: LSUnlockModal;
  #encryptFolderModal!: LSEncryptFolderModal;
  readonly #dailyFolder = "daily";
  #previewedCategory = "files";
  #activeCategory: string | null = null;
  #editor: LSEditor | null = null;
  #activePath = "";
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingContent = ""; // template content seeded into the editor when opening a not-yet-existing daily note
  #lastLoadedContent = ""; // content baseline for the active note — reload is safe only while editor matches this

  connectedCallback(): void {
    this.#shadow = this.attachShadow({ mode: "open" });

    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);

    this.#buildLayout();
    this.#registerCommands();
    this.#wireVaultEvents();
    this.#init().catch(console.error);
    document.addEventListener("keydown", this.#onGlobalKey);
  }

  disconnectedCallback(): void {
    window.removeEventListener("route", this.#onRoute);
    document.removeEventListener("keydown", this.#onGlobalKey);
  }

  #onGlobalKey = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && e.key === "F") {
      e.preventDefault();
      this.#openSearchTab();
    }
    if (mod && !e.shiftKey && e.key === "n") {
      e.preventDefault();
      this.#newNote("").catch(console.error);
    }
    if (mod && !e.shiftKey && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      this.#openDailyNote(this.#dailyDateFor(0)).catch(console.error);
    }
  };

  hideAuthOverlay(): void {
    this.#authOverlay.classList.remove("visible");
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────

  #buildLayout(): void {
    // Category nav column (wide picker or narrow rail)
    this.#categoryNav = document.createElement("ls-category-nav") as LSCategoryNav;
    this.#categoryNav.categories = [
      { id: "files", label: "Files" },
      { id: "calendar", label: "Calendar" },
      { id: "search", label: "Search" },
      { id: "history", label: "History" },
      { id: "commands", label: "Commands" },
    ];
    this.#categoryNav.previewed = this.#previewedCategory;
    this.#categoryNav.addEventListener("category-drill", (e) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id;
      this.#onCategoryDrill(id);
    });
    this.#categoryNav.addEventListener("rail-expand", () => this.#onRailExpand());

    // Category panel (second column, shows the previewed/active category's content)
    this.#categoryPanel = document.createElement("div");
    this.#categoryPanel.id = "category-panel";

    // Files panel: file tree + outline + backlinks stacked
    const filesPanel = document.createElement("div");
    filesPanel.className = "panel-content";
    filesPanel.dataset["category"] = "files";

    const filesTop = document.createElement("div");
    filesTop.className = "panel-top";
    this.#fileTree = document.createElement("ls-file-tree") as LSFileTree;
    this.#fileTree.style.cssText = "flex:1;min-height:0;overflow:hidden;";
    this.#fileTree.addEventListener("file-open", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      navigateTo(path);
      this.#drillInto("files");
    });
    this.#fileTree.addEventListener("file-new", (e) => {
      const { folder, kind, name } = (e as CustomEvent<{ folder: string; kind: "note" | "canvas" | "folder"; name: string }>).detail;
      switch (kind) {
        case "note":
          this.#newNote(folder, name).catch(console.error);
          break;
        case "canvas":
          this.#newCanvas(folder, name).catch(console.error);
          break;
        case "folder":
          this.#newFolder(folder, name).catch(console.error);
          break;
      }
    });
    this.#fileTree.addEventListener("file-rename", (e) => {
      const { oldPath, newPath } = (e as CustomEvent<{ oldPath: string; newPath: string }>).detail;
      this.#renameNote(oldPath, newPath);
    });
    this.#fileTree.addEventListener("zone-toggle", (e) => {
      const { prefix, unlocked } = (e as CustomEvent<{ prefix: string; unlocked: boolean }>).detail;
      this.#toggleZone(prefix, unlocked);
    });
    filesTop.appendChild(this.#fileTree);
    filesPanel.appendChild(filesTop);

    const filesBottom = document.createElement("div");
    filesBottom.className = "panel-bottom";
    this.#outline = document.createElement("ls-outline") as LSOutline;
    this.#outline.addEventListener("outline-jump", (e) => {
      const { line } = (e as CustomEvent<{ line: number }>).detail;
      this.#editor?.scrollToLine(line);
    });
    this.#backlinks = document.createElement("ls-backlinks") as LSBacklinks;
    this.#backlinks.addEventListener("file-open", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      navigateTo(path);
      this.#drillInto("files");
    });
    filesBottom.append(this.#outline, this.#backlinks);
    filesPanel.appendChild(filesBottom);

    // Calendar panel
    const calendarPanel = document.createElement("div");
    calendarPanel.className = "panel-content";
    calendarPanel.dataset["category"] = "calendar";
    this.#calendar = document.createElement("ls-calendar") as LSCalendar;
    this.#calendar.dailyFolder = this.#dailyFolder;
    this.#calendar.addEventListener("daily-open", (e) => {
      const { date, path } = (e as CustomEvent<{ date: string; path: string }>).detail;
      this.#openDailyNote(date, path).catch(console.error);
    });
    calendarPanel.appendChild(this.#calendar);

    // Search panel
    const searchPanel = document.createElement("div");
    searchPanel.className = "panel-content";
    searchPanel.dataset["category"] = "search";
    this.#search = document.createElement("ls-search") as LSSearch;
    this.#search.style.cssText = "flex:1;min-height:0;";
    this.#search.addEventListener("file-open", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      navigateTo(path);
      this.#drillInto("files");
    });
    searchPanel.appendChild(this.#search);

    // History panel
    const historyPanel = document.createElement("div");
    historyPanel.className = "panel-content";
    historyPanel.dataset["category"] = "history";
    this.#history = document.createElement("ls-history") as LSHistory;
    this.#history.style.cssText = "flex:1;min-height:0;";
    this.#history.addEventListener("commit-select", (e) => {
      const { oid } = (e as CustomEvent<{ oid: string }>).detail;
      this.#openCommit(oid).catch(console.error);
      this.#drillInto("history");
    });
    this.#history.addEventListener("history-refresh", () => {
      this.#loadHistory().catch(console.error);
    });
    historyPanel.appendChild(this.#history);

    // Commands panel — rendered lazily after #registerCommands runs, since
    // commands aren't registered until after buildLayout completes.
    this.#commandsPanel = document.createElement("div");
    this.#commandsPanel.className = "panel-content";
    this.#commandsPanel.dataset["category"] = "commands";

    this.#categoryPanel.append(filesPanel, calendarPanel, searchPanel, historyPanel, this.#commandsPanel);
    this.#showPanel(this.#previewedCategory);

    // If the panel is dimmed (rail was expanded back to picker), any click
    // inside the panel re-drills into the currently-previewed category.
    this.#categoryPanel.addEventListener("click", () => {
      if (this.#categoryPanel.classList.contains("dimmed")) {
        this.#drillInto(this.#previewedCategory);
      }
    }, true);

    // Main area
    const main = document.createElement("div");
    main.id = "main";

    // Conflict banner
    this.#conflictBanner = document.createElement("div");
    this.#conflictBanner.id = "conflict-banner";
    this.#conflictBanner.innerHTML =
      "<span>⚡ This note has a merge conflict. Resolve it in the editor.</span>";
    const resolveBtn = document.createElement("button");
    resolveBtn.textContent = "Mark resolved";
    resolveBtn.addEventListener("click", () => this.#resolveConflict());
    this.#conflictBanner.appendChild(resolveBtn);
    main.appendChild(this.#conflictBanner);

    this.#editorWrap = document.createElement("div");
    this.#editorWrap.id = "editor-wrap";
    main.appendChild(this.#editorWrap);

    // Show welcome screen initially
    this.#showWelcome();

    // Status bar
    const statusBar = document.createElement("div");
    statusBar.id = "status-bar";
    this.#statusDot = document.createElement("div");
    this.#statusDot.className = "status-dot";
    this.#statusText = document.createElement("span");
    this.#statusText.textContent = "Ready";
    const mutedLinkCss =
      "color:var(--ls-color-fg-muted,#64748b);font-size:11px;text-decoration:none;" +
      "font-family:var(--ls-font-mono,monospace);white-space:nowrap;";

    const buildLabel = document.createElement("a");
    buildLabel.textContent = `build ${__BUILD_SHA__}`;
    buildLabel.title = "Source commit for this build";
    buildLabel.target = "_blank";
    buildLabel.rel = "noopener noreferrer";
    buildLabel.style.cssText = `margin-left:auto;${mutedLinkCss}`;
    if (__BUILD_REPO__ && __BUILD_SHA__ !== "dev") {
      buildLabel.href = `https://github.com/${__BUILD_REPO__}/commit/${__BUILD_SHA__}`;
    }

    this.#repoLabel = document.createElement("span");
    this.#repoLabel.style.cssText =
      `margin-left:12px;${mutedLinkCss}overflow:hidden;text-overflow:ellipsis;max-width:240px;`;

    const signOutBtn = document.createElement("button");
    signOutBtn.textContent = "Sign out";
    signOutBtn.style.cssText =
      "margin-left:8px;background:none;border:none;color:var(--ls-color-fg-muted,#64748b);" +
      "font-size:11px;font-family:inherit;cursor:pointer;padding:0 4px;flex-shrink:0;";
    signOutBtn.addEventListener("mouseenter", () => { signOutBtn.style.color = "var(--ls-color-fg,#e0e0e0)"; });
    signOutBtn.addEventListener("mouseleave", () => { signOutBtn.style.color = "var(--ls-color-fg-muted,#64748b)"; });
    signOutBtn.addEventListener("click", () => this.#signOut());
    statusBar.append(this.#statusDot, this.#statusText, buildLabel, this.#repoLabel, signOutBtn);
    // Status bar is intentionally NOT appended to #main. It sits at the root
    // so it stays visible regardless of which pane is showing on mobile.
    this.#statusBar = statusBar;

    // Auth overlay
    this.#authOverlay = document.createElement("div");
    this.#authOverlay.id = "auth-overlay";
    const modal = document.createElement("ls-modal");
    modal.id = "auth-modal";
    modal.addEventListener("auth-complete", () => {
      this.hideAuthOverlay();
      this.#postAuthInit().catch(console.error);
    });
    this.#authOverlay.appendChild(modal);

    // Vault encryption modals
    this.#unlockModal = document.createElement("ls-unlock-modal") as LSUnlockModal;
    this.#unlockModal.addEventListener("vault-unlock", (e) => {
      const { passphrase, zoneId } = (e as CustomEvent<{ passphrase: string; zoneId: string }>).detail;
      this.#handleUnlock(zoneId, passphrase).catch(console.error);
    });
    this.#unlockModal.addEventListener("vault-unlock-cancel", () => {
      // User dismissed without unlocking. If they were parked on a locked
      // file, kick them to home so they're not staring at a placeholder
      // with no action they can take.
      if (this.#activePath) {
        const zones = vaultService.applicableZones(this.#activePath);
        const stillLocked = zones.some((z) => !vaultService.isZoneUnlocked(z.id));
        if (stillLocked) navigateHome();
      }
    });
    this.#encryptFolderModal = document.createElement("ls-encrypt-folder-modal") as LSEncryptFolderModal;
    this.#encryptFolderModal.addEventListener("zone-create", (e) => {
      const { prefix, passphrase } = (e as CustomEvent<{ prefix: string; passphrase: string }>).detail;
      this.#handleCreateZone(prefix, passphrase).catch(console.error);
    });

    // Palette + switcher (appended to shadow root, not inside a flex child)
    this.#palette = document.createElement("ls-command-palette") as LSCommandPalette;
    this.#palette.addEventListener("palette-command", (e) => {
      this.#onPaletteCommand((e as CustomEvent<{ id: string }>).detail.id);
    });

    this.#switcher = document.createElement("ls-switcher") as LSSwitcher;
    this.#switcher.addEventListener("file-open", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      navigateTo(path);
    });

    this.#mobileBreadcrumb = document.createElement("div");
    this.#mobileBreadcrumb.id = "mobile-breadcrumb";

    const layout = document.createElement("div");
    layout.id = "layout";
    layout.append(this.#categoryNav, this.#categoryPanel, main);

    this.#shadow.append(
      this.#mobileBreadcrumb,
      layout,
      this.#statusBar,
      this.#authOverlay,
      this.#unlockModal,
      this.#encryptFolderModal,
      this.#palette,
      this.#switcher
    );

    this.#updateMobileState();

    // Hash router
    window.addEventListener("route", this.#onRoute as EventListener);
  }

  // ── Category nav orchestration ────────────────────────────────────────────

  #showPanel(id: string): void {
    this.#categoryPanel.querySelectorAll<HTMLElement>(".panel-content").forEach((el) => {
      el.classList.toggle("active", el.dataset["category"] === id);
    });
  }

  #onCategoryDrill(id: string): void {
    this.#drillInto(id);
  }

  #onRailExpand(): void {
    // Rail → picker with the panel dimmed until user re-commits.
    this.#categoryNav.mode = "picker";
    this.#categoryNav.previewed = this.#activeCategory ?? this.#previewedCategory;
    this.#previewedCategory = this.#categoryNav.previewed;
    this.#showPanel(this.#previewedCategory);
    this.#categoryPanel.classList.add("dimmed");
    this.#updateMobileState();
  }

  #drillInto(id: string): void {
    this.#activeCategory = id;
    this.#previewedCategory = id;
    this.#categoryNav.active = id;
    this.#categoryNav.previewed = id;
    this.#categoryNav.mode = "rail";
    this.#showPanel(id);
    this.#categoryPanel.classList.remove("dimmed");
    // Category-specific activation that used to live in the preview handler:
    if (id === "search") requestAnimationFrame(() => this.#search.focus());
    if (id === "history") this.#loadHistory().catch(console.error);
    this.#updateMobileState();
  }

  // ── Mobile drill-down state ──────────────────────────────────────────────

  #currentLeafLabel(): string | null {
    if (this.#activePath) {
      return this.#activePath.split("/").pop() ?? this.#activePath;
    }
    if (this.#activeCommitOid && this.#categoryNav.active === "history") {
      return this.#activeCommitOid.slice(0, 7);
    }
    return null;
  }

  #updateMobileState(): void {
    if (!this.#mobileBreadcrumb) return;
    let level = 0;
    if (this.#categoryNav.mode === "rail") level = 1;
    if (this.#currentLeafLabel()) level = 2;
    this.dataset["mobileLevel"] = String(level);
    this.#renderMobileBreadcrumb();
  }

  #renderMobileBreadcrumb(): void {
    const bc = this.#mobileBreadcrumb;
    bc.replaceChildren();
    const activeId = this.#categoryNav.active;
    if (!activeId) return;

    const cat = this.#categoryNav.categories.find((c) => c.id === activeId);
    const catLabel = cat?.label ?? activeId;

    const catBtn = document.createElement("button");
    catBtn.className = "bc-segment";
    catBtn.textContent = catLabel;
    catBtn.title = `Back to ${catLabel}`;
    catBtn.addEventListener("click", () => this.#mobileUnwindTo(0));
    bc.appendChild(catBtn);

    const leaf = this.#currentLeafLabel();
    if (leaf) {
      const sep = document.createElement("span");
      sep.className = "bc-sep";
      sep.textContent = "›";
      bc.appendChild(sep);

      const leafBtn = document.createElement("button");
      leafBtn.className = "bc-segment";
      leafBtn.textContent = leaf;
      leafBtn.title = `Back to ${catLabel}`;
      leafBtn.addEventListener("click", () => this.#mobileUnwindTo(1));
      bc.appendChild(leafBtn);
    }
  }

  /** Go back to a given mobile level by undoing the state that drove above it. */
  #mobileUnwindTo(level: number): void {
    // Always clear content-level state first.
    if (this.#activePath || this.#activeCommitOid) {
      this.#activeCommitOid = "";
      if (this.#activePath) navigateHome();
      else this.#showWelcome();
    }
    if (level <= 0) {
      // Also undrill back to picker.
      this.#categoryNav.mode = "picker";
      this.#categoryNav.active = null;
      this.#activeCategory = null;
      this.#categoryPanel.classList.remove("dimmed");
    }
    this.#updateMobileState();
  }

  #showWelcome(): void {
    this.#editorWrap.innerHTML = "";
    this.#editor = null;
    const welcome = document.createElement("div");
    welcome.id = "welcome";
    welcome.innerHTML = `
      <h2>Lemonstone</h2>
      <p>Select a note from the sidebar or press <kbd>Ctrl+P</kbd> to jump to one.</p>
      <p>Press <kbd>Ctrl+Shift+P</kbd> for commands.</p>
    `;
    this.#editorWrap.appendChild(welcome);
  }

  async #openCanvas(path: string): Promise<void> {
    if (this.#promptUnlockIfLocked(path)) {
      this.#mountLockedPlaceholder(path);
      return;
    }

    const record = await vaultService.readCanvasRecord(path);
    let text = "";
    try {
      text = (await vaultService.readCanvas(path)) ?? "";
    } catch (err) {
      if ((err as Error)?.name === "ZoneLockedError") {
        this.#promptUnlockIfLocked(path);
        this.#mountLockedPlaceholder(path);
        return;
      }
      text = "";
    }
    const doc = text ? parseCanvas(text) : emptyCanvas();
    const inConflict = record?.syncState === "conflict" && !!record.conflict;

    this.#editorWrap.innerHTML = "";
    const canvas = document.createElement("ls-canvas") as LSCanvas;
    canvas.style.cssText = "display:block;height:100%;width:100%;";
    canvas.document = doc;
    canvas.setConflict(inConflict);
    canvas.addEventListener("canvas-change", (e) => {
      const nextDoc = (e as CustomEvent<{ document: unknown }>).detail.document as ReturnType<typeof parseCanvas>;
      this.#saveCanvasDebounced(path, nextDoc);
    });
    canvas.addEventListener("canvas-resolve-conflict", (e) => {
      const choice = (e as CustomEvent<{ choice: "mine" | "theirs" | "both" }>).detail.choice;
      this.#resolveCanvasConflict(path, choice).catch(console.error);
    });
    canvas.addEventListener("file-open", (e) => {
      const target = (e as CustomEvent<{ path: string }>).detail.path;
      if (target) navigateTo(target);
    });
    canvas.addEventListener("request-file-pick", () => {
      this.#switcher.pick({ placeholder: "Pick a file for this node…" })
        .then((picked) => {
          if (picked) canvas.insertFileNodeAtCenter(picked);
        })
        .catch(console.error);
    });
    this.#editorWrap.appendChild(canvas);
    this.#editor = null;
    requestAnimationFrame(() => canvas.focus());

    // Canvas has no outline/backlinks today — clear the sidebar panels.
    this.#outline.headings = [];
    this.#backlinks.path = path;
    this.#backlinks.links = vaultService.getBacklinks(path);

    this.#lastLoadedContent = serializeCanvas(doc);
  }

  async #resolveCanvasConflict(path: string, choice: "mine" | "theirs" | "both"): Promise<void> {
    const record = await vaultService.readCanvasRecord(path);
    if (!record || !record.conflict) return;

    const ours = parseCanvas(new TextDecoder().decode(record.content));
    const theirs = parseCanvas(new TextDecoder().decode(record.conflict.theirs));
    let resolved;
    switch (choice) {
      case "mine":   resolved = ours; break;
      case "theirs": resolved = theirs; break;
      case "both":   resolved = mergeCanvases(ours, theirs); break;
    }
    const serialized = serializeCanvas(resolved);
    await vaultService.writeCanvas(path, serialized);
    // writeCanvas doesn't clear the conflict field — do it explicitly so
    // future opens of the file don't re-surface the banner.
    await vaultService.clearCanvasConflict(path);
    this.#setStatus("ok", "Conflict resolved");
    // Reload the canvas view from the new state.
    await this.#openCanvas(path);
  }

  #saveCanvasDebounced(path: string, doc: ReturnType<typeof parseCanvas>): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#setStatus("syncing", "Saving…");
    this.#saveTimer = setTimeout(async () => {
      this.#saveTimer = null;
      try {
        const text = serializeCanvas(doc);
        await vaultService.writeCanvas(path, text);
        this.#lastLoadedContent = text;
        this.#setStatus("ok", "Saved");
      } catch (err) {
        this.#setStatus("error", "Save failed");
        console.error(err);
      }
    }, 400);
  }

  // ── History view ─────────────────────────────────────────────────────────

  async #loadHistory(): Promise<void> {
    try {
      const commits = await vaultService.recentCommits(50);
      this.#history.commits = commits as CommitSummary[];
      this.#history.activeOid = this.#activeCommitOid;
    } catch (err) {
      console.error(err);
    }
  }

  async #openCommit(oid: string): Promise<void> {
    this.#activeCommitOid = oid;
    this.#history.activeOid = oid;
    this.#activePath = "";
    this.#fileTree.activePath = "";
    this.#calendar.activePath = "";
    this.#updateMobileState();

    const details = await vaultService.commitDetails(oid);
    if (!details) {
      this.#showWelcome();
      getToast().show("Couldn't read that commit.", "error", 4000);
      return;
    }

    this.#editorWrap.innerHTML = "";
    this.#editor = null;
    this.#outline.headings = [];
    this.#backlinks.links = [];
    this.#conflictBanner.classList.remove("visible");

    const view = document.createElement("div");
    view.style.cssText =
      "height:100%;overflow:auto;padding:24px 32px;font-size:13px;" +
      "color:var(--ls-color-fg,#e0e0e0);";

    const title = document.createElement("h2");
    title.textContent = details.message.split("\n")[0] ?? "(no message)";
    title.style.cssText = "margin:0 0 12px;font-size:18px;font-weight:600;";

    const meta = document.createElement("div");
    meta.style.cssText =
      "color:var(--ls-color-fg-muted,#64748b);font-size:12px;margin-bottom:20px;" +
      "font-family:var(--ls-font-mono,monospace);";
    const when = new Date(details.date).toLocaleString();
    meta.textContent = `${details.oid}  ·  ${details.author}  ·  ${when}`;

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;";
    const restoreBtn = document.createElement("button");
    restoreBtn.textContent = "Restore to this commit";
    restoreBtn.style.cssText =
      "background:var(--ls-color-accent,#7c6af7);color:white;border:none;" +
      "padding:6px 14px;border-radius:4px;font:inherit;font-size:13px;cursor:pointer;";
    restoreBtn.addEventListener("click", () => this.#restoreToCommit(details.oid));
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy SHA";
    copyBtn.style.cssText =
      "background:rgba(255,255,255,0.06);color:inherit;border:1px solid var(--ls-color-border,#2a2a3e);" +
      "padding:6px 14px;border-radius:4px;font:inherit;font-size:13px;cursor:pointer;";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(details.oid).catch(console.error);
      getToast().show("SHA copied to clipboard.", "info", 2500);
    });
    actions.append(restoreBtn, copyBtn);

    const changesHeader = document.createElement("h3");
    changesHeader.textContent = `${details.changes.length} file${details.changes.length === 1 ? "" : "s"} changed`;
    changesHeader.style.cssText = "margin:0 0 10px;font-size:13px;font-weight:600;";

    const list = document.createElement("ul");
    list.style.cssText = "list-style:none;padding:0;margin:0;";
    if (details.changes.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "(no changes)";
      empty.style.cssText = "color:var(--ls-color-fg-muted,#64748b);font-style:italic;";
      list.appendChild(empty);
    } else {
      for (const change of details.changes) {
        const item = document.createElement("li");
        item.style.cssText =
          "display:flex;gap:10px;padding:4px 0;font-family:var(--ls-font-mono,monospace);font-size:12px;";
        const status = document.createElement("span");
        status.textContent = change.status;
        const color =
          change.status === "A" ? "#86efac" :
          change.status === "D" ? "#f87171" : "#fcd34d";
        status.style.cssText = `color:${color};font-weight:600;width:14px;flex-shrink:0;`;
        const name = document.createElement("span");
        name.textContent = change.path;
        name.style.cssText = "color:var(--ls-color-fg,#e0e0e0);word-break:break-all;";
        item.append(status, name);
        list.appendChild(item);
      }
    }

    view.append(title, meta, actions, changesHeader, list);
    this.#editorWrap.appendChild(view);
  }

  async #restoreToCommit(oid: string): Promise<void> {
    const dirtyNotes = (await vaultService.listNotes()).filter((n) => n.syncState === "dirty");
    if (dirtyNotes.length > 0 && !confirm(
      `You have ${dirtyNotes.length} unsynced change(s) that will be lost if you restore. Continue?`
    )) return;
    if (!confirm(
      `Restore to commit ${oid.slice(0, 7)}?\n\nThis creates a new commit that sets every file to its state at that point. Files added since then will be removed; modified files will revert.`
    )) return;

    this.#setStatus("syncing", `Restoring to ${oid.slice(0, 7)}…`);
    try {
      await vaultService.restoreToCommit(oid);
      await this.#loadNoteList();
      await this.#loadHistory();
      this.#setStatus("ok", "Restored");
      getToast().show(`Restored to ${oid.slice(0, 7)}. Sync in progress.`, "success", 4000);
      navigateHome();
    } catch (err) {
      console.error(err);
      this.#setStatus("error", "Restore failed");
      getToast().show("Restore failed. See console.", "error", 5000);
    }
  }

  async #newCanvas(folder = "", name?: string): Promise<void> {
    const base = name?.trim() || `Untitled-${Date.now()}`;
    const filename = base.endsWith(".canvas") ? base : `${base}.canvas`;
    const path = folder ? `${folder}/${filename}` : filename;
    if ((await vaultService.readCanvas(path)) !== null) {
      getToast().show(`${path} already exists`, "info", 4000);
      navigateTo(path);
      return;
    }
    await vaultService.writeCanvas(path, serializeCanvas(emptyCanvas()));
    navigateTo(path);
  }

  // ── Folder operations ────────────────────────────────────────────────────
  // Git doesn't track empty folders, so "new folder" creates a README.md
  // placeholder inside it. Rename/delete operate on all files under a
  // trailing-slash prefix.

  #normalizeFolder(input: string | null): string | null {
    if (!input) return null;
    const cleaned = input.trim().replace(/^\/+|\/+$/g, "");
    return cleaned || null;
  }

  async #newFolder(parent = "", name?: string): Promise<void> {
    // When called from the file tree we already have the single-segment name;
    // from the palette we fall back to a free-form prompt so power users can
    // still type a multi-segment path ("projects/work") in one shot.
    let cleaned: string | null;
    if (name !== undefined) {
      cleaned = this.#normalizeFolder(name);
    } else {
      const promptText = parent
        ? `New folder name (inside ${parent}):`
        : "New folder path (e.g. projects/work):";
      cleaned = this.#normalizeFolder(prompt(promptText));
    }
    if (!cleaned) return;
    const folder = parent ? `${parent}/${cleaned}` : cleaned;
    const path = `${folder}/README.md`;
    const existing = await vaultService.readNote(path);
    if (existing !== null) {
      getToast().show(`${path} already exists`, "info", 4000);
      navigateTo(path);
      return;
    }
    const label = folder.split("/").pop() ?? folder;
    await vaultService.writeNote(path, `# ${label}\n\n`);
    await this.#loadNoteList();
    navigateTo(path);
  }

  async #renameFolder(): Promise<void> {
    const oldFolder = this.#normalizeFolder(prompt("Rename folder — current path:"));
    if (!oldFolder) return;
    const newFolder = this.#normalizeFolder(prompt("Rename folder — new path:", oldFolder));
    if (!newFolder || newFolder === oldFolder) return;
    const oldPrefix = oldFolder + "/";
    const newPrefix = newFolder + "/";

    const entries = (await vaultService.list()).filter((e) => e.path.startsWith(oldPrefix));
    if (entries.length === 0) {
      getToast().show(`No files under "${oldFolder}"`, "info", 4000);
      return;
    }

    this.#setStatus("syncing", `Renaming ${entries.length} file(s)…`);
    try {
      for (const entry of entries) {
        const nextPath = newPrefix + entry.path.slice(oldPrefix.length);
        await vaultService.rename(entry.path, nextPath);
      }
      await this.#loadNoteList();
      if (this.#activePath.startsWith(oldPrefix)) {
        navigateTo(newPrefix + this.#activePath.slice(oldPrefix.length));
      }
      this.#setStatus("ok", "Folder renamed");
    } catch (err) {
      console.error(err);
      this.#setStatus("error", "Rename folder failed");
    }
  }

  async #showHistory(): Promise<void> {
    try {
      const commits = await vaultService.recentCommits(30);
      if (commits.length === 0) {
        getToast().show("No commits yet (or repo not yet cloned).", "info", 4000);
        return;
      }
      const lines = commits.map((c) => {
        const short = c.oid.slice(0, 7);
        const when = new Date(c.date).toISOString().slice(0, 16).replace("T", " ");
        return `${short} ${when} ${c.author}: ${c.message}`;
      });
      // Drop the full list into the console for detail; toast a summary.
      console.log("[history] recent commits:\n" + lines.join("\n"));
      getToast().show(
        `${commits.length} recent commit(s) logged to the console (see DevTools).`,
        "info",
        5000
      );
    } catch (err) {
      console.error(err);
      getToast().show("Couldn't read commit history.", "error", 4000);
    }
  }

  async #deleteFolder(): Promise<void> {
    const folder = this.#normalizeFolder(prompt("Delete folder — path:"));
    if (!folder) return;
    const prefix = folder + "/";
    const entries = (await vaultService.list()).filter((e) => e.path.startsWith(prefix));
    if (entries.length === 0) {
      getToast().show(`No files under "${folder}"`, "info", 4000);
      return;
    }
    if (!confirm(`Delete ${entries.length} file(s) under "${folder}"? This cannot be undone.`)) return;

    this.#setStatus("syncing", `Deleting ${entries.length} file(s)…`);
    try {
      for (const entry of entries) {
        await vaultService.delete(entry.path);
      }
      await this.#loadNoteList();
      if (this.#activePath.startsWith(prefix)) navigateHome();
      this.#setStatus("ok", "Folder deleted");
    } catch (err) {
      console.error(err);
      this.#setStatus("error", "Delete folder failed");
    }
  }

  #mountEditor(path: string, content: string): void {
    this.#editorWrap.innerHTML = "";
    const ed = document.createElement("ls-editor") as LSEditor;
    ed.path = path;
    ed.value = content;
    ed.addEventListener("input", (e) => {
      // Guard: CodeMirror's contenteditable also fires native InputEvents that
      // bubble out of the shadow DOM with detail=0. Only handle our CustomEvent.
      const detail = (e as CustomEvent<{ content: string; path: string }>).detail;
      if (!detail || typeof detail.content !== "string") return;
      this.#onEditorInput(detail.content, detail.path);
    });
    this.#editorWrap.appendChild(ed);
    this.#editor = ed;
    this.#lastLoadedContent = content;
    requestAnimationFrame(() => ed.focus());
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async #init(): Promise<void> {
    const authed = await isAuthenticated();
    if (!authed) {
      this.#authOverlay.classList.add("visible");
      return;
    }
    const tokens = await loadTokens();
    if (tokens) this.#setRepoLabel(tokens.repoFullName);
    // Tokens exist — kick off a sync (auto-clones on first run).
    vaultService.sync().catch(console.error);
    await this.#loadNoteList();
    await this.#handleRoute(currentRoute());
  }

  #currentRepo = "";
  #currentSha = "";

  #renderRepoLabel(): void {
    this.#repoLabel.replaceChildren();
    if (!this.#currentRepo) return;

    const repoLink = document.createElement("a");
    repoLink.textContent = this.#currentRepo;
    repoLink.href = `https://github.com/${this.#currentRepo}`;
    repoLink.target = "_blank";
    repoLink.rel = "noopener noreferrer";
    repoLink.style.cssText = "color:inherit;text-decoration:none;";
    this.#repoLabel.appendChild(repoLink);

    if (this.#currentSha) {
      const sep = document.createTextNode("#");
      const shaLink = document.createElement("a");
      shaLink.textContent = this.#currentSha.slice(0, 7);
      shaLink.href = `https://github.com/${this.#currentRepo}/commit/${this.#currentSha}`;
      shaLink.target = "_blank";
      shaLink.rel = "noopener noreferrer";
      shaLink.title = "Last synced commit";
      shaLink.style.cssText = "color:inherit;text-decoration:none;";
      this.#repoLabel.append(sep, shaLink);
    }
  }

  #setRepoLabel(repoFullName: string): void {
    this.#currentRepo = repoFullName;
    this.#renderRepoLabel();
  }

  #setRepoSha(headOid: string): void {
    if (!headOid || headOid === this.#currentSha) return;
    this.#currentSha = headOid;
    this.#renderRepoLabel();
  }

  async #postAuthInit(): Promise<void> {
    const tokens = await loadTokens();
    if (tokens) this.#setRepoLabel(tokens.repoFullName);

    this.#setStatus("syncing", "Cloning repository…");
    try {
      await vaultService.clone();
    } catch (err) {
      console.warn("Clone skipped or failed:", err);
    }

    // Zones (if any) are loaded lazily — identities stay locked until the
    // user opens a file in one, at which point we intercept the
    // ZoneLockedError and show the unlock modal. No eager prompt here.
    await this.#continuePostAuthInit();
  }

  async #continuePostAuthInit(): Promise<void> {
    // Sync ensures IndexedDB is populated even if clone was a no-op.
    vaultService.sync().catch(console.error);
    this.#setStatus("ok", "Ready");
    await this.#loadNoteList();
    await this.#handleRoute(currentRoute());
  }

  async #handleUnlock(zoneId: string, passphrase: string): Promise<void> {
    this.#unlockModal.setBusy(true);
    try {
      await vaultService.unlockZone(zoneId, passphrase);
      this.#unlockModal.hide();
      await this.#loadNoteList();
      // Re-open the active path. If it's a nested-zone file and a deeper
      // zone is still locked, this will prompt for the next one; otherwise
      // the editor mounts with real content.
      if (this.#activePath) {
        this.#openNote(this.#activePath).catch(console.error);
      }
    } catch (err) {
      console.warn("unlock failed:", err);
      this.#unlockModal.setError("Wrong passphrase — try again.");
    } finally {
      this.#unlockModal.setBusy(false);
    }
  }

  async #handleCreateZone(prefix: string, passphrase: string): Promise<void> {
    this.#encryptFolderModal.setBusy("Encrypting folder…");
    try {
      const zone = await vaultService.createZone({ prefix, passphrase });
      this.#encryptFolderModal.hide();
      this.#setStatus("ok", "Folder encrypted");
      getToast().show(
        `"${zone.prefix}" is now an encrypted zone. The next sync will push the encrypted files.`,
        "success",
        6000
      );
      await this.#loadNoteList();
    } catch (err) {
      console.error(err);
      this.#encryptFolderModal.setError((err as Error).message || "Failed to encrypt folder.");
    }
  }

  // ── Vault event wiring ────────────────────────────────────────────────────

  #wireVaultEvents(): void {
    vaultService.addEventListener("vault:ready", () => {
      this.#loadNoteList().catch(console.error);
      this.#setStatus("ok", "Ready");
    });

    vaultService.addEventListener("note:changed", () => {
      this.#loadNoteList().catch(console.error);
    });

    vaultService.addEventListener("note:deleted", () => {
      this.#loadNoteList().catch(console.error);
    });

    for (const ev of ["vault:zoneCreated", "vault:zoneRemoved", "vault:zoneUnlocked", "vault:zoneLocked", "vault:allZonesLocked", "vault:zonesReloaded"]) {
      vaultService.addEventListener(ev, () => this.#refreshZoneBadges());
    }
    // When a zone locks, an actively-open file inside that zone should be
    // evicted: the editor is still showing plaintext in memory, and edits
    // would silently fail on save (the codec can't encode without the
    // identity). Re-opening routes through the locked-placeholder path.
    for (const ev of ["vault:zoneLocked", "vault:allZonesLocked"]) {
      vaultService.addEventListener(ev, () => this.#evictIfActiveLocked());
    }

    vaultService.addEventListener("vault:synced", (e) => {
      this.#setStatus("ok", "Synced");
      const headOid = (e as CustomEvent).detail?.headOid as string | undefined;
      if (headOid) this.#setRepoSha(headOid);
      // Refresh the file list — catches remote adds/removes that don't emit
      // per-note events (reconcileFromOPFS writes directly to IndexedDB).
      this.#loadNoteList().catch(console.error);
      this.#loadHistory().catch(console.error);
      // Reload active note if it changed.
      if (this.#activePath) this.#reloadActiveNote().catch(console.error);
    });

    vaultService.addEventListener("vault:syncError", (e) => {
      const detail = (e as CustomEvent<{ message?: string; reason?: string; dropped?: string[] }>).detail;
      if (detail?.reason === "unsafe_push") {
        this.#setStatus("error", "Sync blocked — merge would remove remote files");
        const n = detail.dropped?.length ?? 0;
        const preview = (detail.dropped ?? []).slice(0, 3).join(", ");
        getToast().showAction(
          `Sync refused: local copy is out of date and would silently delete ${n} remote file(s)${preview ? ` (e.g. ${preview})` : ""}. Use "Force pull from remote" to reset local, or "Show recent commits" to inspect.`,
          "Dismiss",
          () => { /* noop */ },
          "warning"
        );
        return;
      }
      const msg = detail?.message ?? "Sync error";
      this.#setStatus("error", msg);
    });

    vaultService.addEventListener("vault:conflictDetected", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      if (path === this.#activePath) {
        this.#conflictBanner.classList.add("visible");
      }
    });

    // Sync-in-progress indicator (synthetic: watch for repeated syncStarted events).
    vaultService.addEventListener("vault:synced", () => {
      setTimeout(() => {
        if (this.#statusDot.classList.contains("syncing")) {
          this.#setStatus("ok", "Synced");
        }
      }, 200);
    });
  }

  #setStatus(state: "ok" | "syncing" | "error" | "conflict", text: string): void {
    this.#statusDot.className = `status-dot ${state}`;
    this.#statusText.textContent = text;
  }

  // ── Note list ─────────────────────────────────────────────────────────────

  #refreshZoneBadges(): void {
    this.#fileTree.zones = vaultService.listZones().map((z) => ({
      prefix: z.prefix,
      unlocked: vaultService.isZoneUnlocked(z.id),
    }));
  }

  async #loadNoteList(): Promise<void> {
    const entries = await vaultService.list();
    const paths = entries.map((e) => e.path).sort();
    this.#fileTree.notes = paths;
    this.#fileTree.activePath = this.#activePath;
    this.#refreshZoneBadges();
    this.#switcher.notes = paths;
    this.#calendar.notes = paths;
    this.#calendar.activePath = this.#activePath;

    // Collect daily-note events for the calendar's Upcoming/Recent lists.
    const events: { date: string; summary: string; path: string }[] = [];
    for (const path of paths) {
      const date = dailyDateFromPath(path, this.#dailyFolder);
      if (!date) continue;
      const content = await vaultService.readNote(path);
      if (!content) continue;
      const summary = extractEventSummary(content, date);
      if (!summary) continue;
      events.push({ date, summary, path });
    }
    this.#calendar.events = events;
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  #onRoute = async (e: Event): Promise<void> => {
    await this.#handleRoute((e as CustomEvent<Route>).detail);
  };

  async #handleRoute(route: Route): Promise<void> {
    if (route.type === "home") {
      this.#activePath = "";
      this.#showWelcome();
      this.#fileTree.activePath = "";
      this.#outline.headings = [];
      this.#backlinks.links = [];
      this.#conflictBanner.classList.remove("visible");
      this.#updateMobileState();
      return;
    }
    await this.#openNote(route.path);
    // Route-driven opens (deep links, palette quick-open, switcher picks, daily
    // notes opened from calendar) don't drill into a category by themselves.
    // Default-drill into Files so the mobile breadcrumb has a valid ancestor
    // to render. #drillInto() updates mobile state internally.
    if (!this.#categoryNav.active) {
      this.#drillInto("files");
    } else {
      this.#updateMobileState();
    }
  }

  async #openNote(path: string): Promise<void> {
    this.#activePath = path;
    this.#fileTree.activePath = path;
    this.#calendar.activePath = path;
    this.#conflictBanner.classList.remove("visible");

    // Route by file extension. .canvas → <ls-canvas>, everything else → editor.
    if (path.endsWith(".canvas")) {
      await this.#openCanvas(path);
      return;
    }

    // If any zone on this path is locked, stop here and ask for its
    // passphrase. After a successful unlock, #handleUnlock re-runs this method
    // — nested zones get prompted one at a time.
    if (this.#promptUnlockIfLocked(path)) {
      this.#mountLockedPlaceholder(path);
      return;
    }

    let content = "";
    try {
      const note = await vaultService.readNote(path);
      content = note ?? "";
    } catch (err) {
      if ((err as Error)?.name === "ZoneLockedError") {
        // Race with a lock state change between check and read — treat
        // the same as the proactive branch above.
        this.#promptUnlockIfLocked(path);
        this.#mountLockedPlaceholder(path);
        return;
      }
      content = "";
    }

    // If the file doesn't exist yet and we have template content staged
    // (from a daily-note click), seed the editor with it. The template only
    // becomes a real file once the user starts typing.
    if (!content && this.#pendingContent) {
      content = this.#pendingContent;
    }
    this.#pendingContent = "";

    this.#mountEditor(path, content);
    this.#updateSidebarPanels(path, content);
  }

  /** Called when any zone just locked. If the active file is inside a locked
   *  zone, cancel any pending save and evict the editor to the home screen.
   *  We don't auto-prompt for unlock here — the user just asked to lock, so
   *  forcing a modal back at them would be hostile. They can re-open the file
   *  (which prompts) or click the lock badge when they want in again. */
  #evictIfActiveLocked(): void {
    if (!this.#activePath) return;
    const zones = vaultService.applicableZones(this.#activePath);
    const stillLocked = zones.some((z) => !vaultService.isZoneUnlocked(z.id));
    if (!stillLocked) return;
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    this.#lastLoadedContent = "";
    navigateHome();
  }

  /** If `path` is inside any locked zone, shows the unlock modal for the
   *  first (outermost) locked zone and returns true. Otherwise returns false. */
  #promptUnlockIfLocked(path: string): boolean {
    const zones = vaultService.applicableZones(path);
    const locked = zones.find((z) => !vaultService.isZoneUnlocked(z.id));
    if (!locked) return false;
    this.#unlockModal.setZone(locked.id, locked.prefix);
    this.#unlockModal.show();
    return true;
  }

  /** Swap the editor pane for a "this note is in a locked folder" placeholder.
   *  The unlock modal is already showing on top of this. */
  #mountLockedPlaceholder(path: string): void {
    this.#editorWrap.innerHTML = "";
    this.#editor = null;
    const zones = vaultService.applicableZones(path);
    const locked = zones.find((z) => !vaultService.isZoneUnlocked(z.id));
    const placeholder = document.createElement("div");
    placeholder.style.cssText =
      "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "height:100%;padding:32px;text-align:center;color:var(--ls-color-fg-muted,#64748b);" +
      "font-size:13px;line-height:1.6;gap:8px;";
    const title = document.createElement("div");
    title.style.cssText = "font-size:16px;color:var(--ls-color-fg,#e0e0e0);";
    title.textContent = "🔒 Locked";
    const sub = document.createElement("div");
    sub.textContent = locked
      ? `This file is in the encrypted folder "${locked.prefix}". Enter the passphrase to read it.`
      : "This file is in an encrypted folder. Enter the passphrase to read it.";
    placeholder.append(title, sub);
    this.#editorWrap.appendChild(placeholder);
    // Clear sidebar panels since we can't parse locked content.
    this.#outline.headings = [];
    this.#backlinks.path = path;
    this.#backlinks.links = [];
  }

  async #reloadActiveNote(): Promise<void> {
    if (!this.#activePath || !this.#editor) return;
    // A debounced save is in flight — IDB is older than the editor, and
    // reading it back would destroy whatever the user just typed and reset
    // the cursor to position 0. Wait for the save to land.
    if (this.#saveTimer) return;
    try {
      const note = await vaultService.readNote(this.#activePath);
      if (note === null || note === this.#editor.value) return;
      // Editor has diverged from the last baseline we loaded — the user has
      // unsaved edits. Don't clobber them even if IDB has newer content.
      if (this.#editor.value !== this.#lastLoadedContent) return;
      this.#editor.value = note;
      this.#lastLoadedContent = note;
      this.#updateSidebarPanels(this.#activePath, note);
    } catch { /* ignore */ }
  }

  #updateSidebarPanels(path: string, content: string): void {
    this.#outline.headings = parseHeadings(content);
    this.#backlinks.path = path;
    const incoming = vaultService.getBacklinks(path);
    this.#backlinks.links = incoming;
  }

  // ── Editor input → save ───────────────────────────────────────────────────

  #onEditorInput(content: string, path: string): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#setStatus("syncing", "Saving…");
    this.#saveTimer = setTimeout(async () => {
      this.#saveTimer = null;
      try {
        await vaultService.writeNote(path, content);
        // Only advance the baseline if the editor hasn't moved on since this
        // save fired. If it has, the next save tick handles it.
        if (this.#editor && this.#editor.value === content) {
          this.#lastLoadedContent = content;
        }
        this.#setStatus("ok", "Saved");
        this.#updateSidebarPanels(path, content);
      } catch (err) {
        this.#setStatus("error", "Save failed");
        console.error(err);
      }
    }, 500);
  }

  // ── New note ──────────────────────────────────────────────────────────────

  async #newNote(folder: string, name?: string): Promise<void> {
    const base = name?.trim() || `Untitled-${Date.now()}`;
    const filename = base.endsWith(".md") ? base : `${base}.md`;
    const path = folder ? `${folder}/${filename}` : filename;
    if ((await vaultService.readNote(path)) !== null) {
      getToast().show(`${path} already exists`, "info", 4000);
      navigateTo(path);
      return;
    }
    const title = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
    await vaultService.writeNote(path, `# ${title}\n\n`);
    navigateTo(path);
  }

  // ── Daily notes ───────────────────────────────────────────────────────────

  #dailyDateFor(offset: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async #openDailyNote(date: string, path?: string): Promise<void> {
    // Caller may pass an explicit path (e.g. a legacy flat note from the
    // calendar). Otherwise prefer the new nested layout and fall back to the
    // legacy flat path only if a file already exists there.
    let targetPath = path ?? dailyPathFor(date, this.#dailyFolder);
    let existing = await vaultService.readNote(targetPath);
    if (existing === null && !path) {
      const legacyPath = this.#dailyFolder ? `${this.#dailyFolder}/${date}.md` : `${date}.md`;
      const legacy = await vaultService.readNote(legacyPath);
      if (legacy !== null) {
        targetPath = legacyPath;
        existing = legacy;
      }
    }

    if (existing === null) {
      // Seed the editor with the template but DON'T persist anything yet — the
      // file only gets written on the first real edit. Stops the calendar from
      // looking like empty days have content.
      const templatePath = this.#dailyFolder ? `${this.#dailyFolder}/_template.md` : "_template.md";
      const template = await vaultService.readNote(templatePath);
      this.#pendingContent = template
        ? template.replace(/\{\{date\}\}/g, date)
        : `# ${date}\n\n`;
    }
    navigateTo(targetPath);
  }

  #moveActiveNote(): void {
    if (!this.#activePath) {
      this.#setStatus("error", "No active note to move");
      return;
    }
    const oldPath = this.#activePath;
    const dot = oldPath.lastIndexOf(".");
    const ext = dot >= 0 ? oldPath.slice(dot) : ".md";
    const newPath = prompt(`Move to (full path, including ${ext}):`, oldPath);
    if (!newPath || newPath === oldPath) return;
    const normalized = newPath.endsWith(ext) ? newPath : `${newPath}${ext}`;
    vaultService.rename(oldPath, normalized)
      .then(async () => {
        await this.#loadNoteList();
        if (this.#activePath === oldPath) navigateTo(normalized);
      })
      .catch((err) => {
        this.#setStatus("error", "Move failed");
        console.error(err);
      });
  }

  async #forcePull(): Promise<void> {
    const ok = confirm(
      "Force pull will discard ALL local changes and re-download everything from GitHub.\n\n" +
      "Any unsaved notes, pending commits, and unsent edits will be lost.\n\n" +
      "Continue?"
    );
    if (!ok) return;
    this.#setStatus("syncing", "Force-pulling…");
    try {
      await vaultService.forcePull();
      await this.#loadNoteList();
      navigateHome();
      this.#setStatus("ok", "Synced");
      getToast().show("Local vault reset to match remote.", "success", 4000);
    } catch (err) {
      this.#setStatus("error", "Force pull failed");
      console.error(err);
    }
  }

  async #forcePush(): Promise<void> {
    const ok = confirm(
      "Force push will overwrite the remote branch with your local state.\n\n" +
      "Any commits on GitHub that aren't already in your local copy will be lost.\n\n" +
      "Continue?"
    );
    if (!ok) return;
    this.#setStatus("syncing", "Force-pushing…");
    try {
      await vaultService.forcePush();
      this.#setStatus("ok", "Synced");
      getToast().show("Remote overwritten with local state.", "success", 4000);
    } catch (err) {
      this.#setStatus("error", "Force push failed");
      console.error(err);
    }
  }

  async #showStorageQuota(): Promise<void> {
    if (!navigator.storage?.estimate) {
      getToast().show("Storage quota API not supported in this browser.", "warning", 5000);
      return;
    }
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const fmt = (n: number): string => {
        if (n > 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
        if (n > 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
        if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${n} B`;
      };
      const pct = quota > 0 ? Math.round((usage / quota) * 100) : 0;
      const persisted = (await navigator.storage.persisted?.()) ?? false;
      const persistNote = persisted ? " · persistent" : " · best-effort";
      getToast().show(
        `Storage: ${fmt(usage)} of ${fmt(quota)} (${pct}%)${persistNote}`,
        pct > 90 ? "warning" : "info",
        8000
      );
    } catch (err) {
      console.error(err);
      getToast().show("Couldn't read storage quota.", "error", 4000);
    }
  }

  async #deleteActiveNote(): Promise<void> {
    if (!this.#activePath) {
      this.#setStatus("error", "No active note to delete");
      return;
    }
    if (!confirm(`Delete "${this.#activePath}"? This cannot be undone.`)) return;
    const toDelete = this.#activePath;
    try {
      await vaultService.delete(toDelete);
      await this.#loadNoteList();
      navigateHome();
    } catch (err) {
      this.#setStatus("error", "Delete failed");
      console.error(err);
    }
  }

  #renameNote(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    vaultService.rename(oldPath, newPath)
      .then(async () => {
        await this.#loadNoteList();
        if (this.#activePath === oldPath) {
          navigateTo(newPath);
        }
      })
      .catch((err) => {
        this.#setStatus("error", "Rename failed");
        console.error(err);
      });
  }

  async #signOut(): Promise<void> {
    if (!confirm("Sign out and clear stored credentials?")) return;
    this.#setStatus("syncing", "Signing out…");
    vaultService.lockAll();
    // Wipe the OPFS git cache so the next sign-in always does a fresh clone.
    if (typeof navigator?.storage?.getDirectory === "function") {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry("lemonstone-git", { recursive: true });
      } catch { /* directory may not exist yet */ }
    }
    // Clear each object store individually — deleteDatabase would block because
    // the idb library holds an open connection that never explicitly closes.
    try {
      const db = await getDB();
      await Promise.all([
        db.clear("auth"),
        db.clear("notes"),
        db.clear("canvas"),
        db.clear("attachments"),
        db.clear("indexes-snapshot"),
        db.clear("config"),
        db.clear("tombstones"),
      ]);
    } catch (err) {
      console.error("Failed to clear local DB:", err);
    }
    location.reload();
  }

  // ── Conflict resolution ───────────────────────────────────────────────────

  #resolveConflict(): void {
    if (!this.#activePath) return;
    vaultService.resolveConflict(this.#activePath).catch(console.error);
    this.#conflictBanner.classList.remove("visible");
  }

  // ── Command palette ───────────────────────────────────────────────────────

  #registerCommands(): void {
    this.#palette.register({ id: "new-note", label: "New note", description: "Create a new note", shortcut: "Ctrl+N" });
    this.#palette.register({ id: "new-canvas", label: "New canvas", description: "Create a new JSON Canvas file" });
    this.#palette.register({ id: "show-history", label: "Show recent commits", description: "List the last 30 commits on the current branch" });
    this.#palette.register({ id: "new-folder", label: "New folder…", description: "Create a folder with a placeholder README" });
    this.#palette.register({ id: "rename-folder", label: "Rename folder…", description: "Rename a folder and all files inside" });
    this.#palette.register({ id: "delete-folder", label: "Delete folder…", description: "Delete a folder and everything inside it" });
    this.#palette.register({ id: "canvas-edit-text", label: "Canvas: edit selected text node", description: "Enter edit mode on a selected text node (fallback for when double-click fails)" });
    this.#palette.register({ id: "quick-open", label: "Quick open note", description: "Jump to a note by name", shortcut: "Ctrl+P" });
    this.#palette.register({ id: "search", label: "Search notes", description: "Full-text search across vault", shortcut: "Ctrl+Shift+F" });
    this.#palette.register({ id: "daily-today", label: "Open today's daily note", description: "Create or open today's daily note", shortcut: "Ctrl+D" });
    this.#palette.register({ id: "daily-yesterday", label: "Open yesterday's daily note" });
    this.#palette.register({ id: "daily-tomorrow", label: "Open tomorrow's daily note" });
    this.#palette.register({ id: "move-note", label: "Move active note…", description: "Change the path of the currently-open note" });
    this.#palette.register({ id: "delete-note", label: "Delete active note", description: "Delete the currently-open note" });
    this.#palette.register({ id: "install-app", label: "Install Lemonstone", description: "Install as a PWA on this device" });
    this.#palette.register({ id: "storage-quota", label: "Show storage quota", description: "How much browser storage the vault is using" });
    this.#palette.register({ id: "force-pull", label: "Force pull from remote (discard local changes)", description: "Wipe local cache and re-download everything from GitHub" });
    this.#palette.register({ id: "force-push", label: "Force push to remote (overwrite remote changes)", description: "Push local state to GitHub, discarding any commits that aren't in your local copy" });
    this.#palette.register({ id: "encrypt-folder", label: "Encrypt folder…", description: "Create an encrypted zone at a folder; files inside are encrypted" });
    this.#palette.register({ id: "decrypt-folder", label: "Decrypt folder…", description: "Remove an encryption zone; its files become plaintext" });
    this.#palette.register({ id: "unlock-folder", label: "Unlock folder…", description: "Unwrap a locked encryption zone with its passphrase" });
    this.#palette.register({ id: "lock-folder", label: "Lock folder…", description: "Drop one encryption zone's identity from memory" });
    this.#palette.register({ id: "lock-all", label: "Lock all folders", description: "Drop every encryption zone identity from memory" });
    this.#palette.register({ id: "list-zones", label: "List encryption zones", description: "Show every encrypted folder, its algorithm, and whether it's unlocked" });
    this.#palette.register({ id: "go-home", label: "Go to home", description: "Show the welcome screen" });
    this.#palette.register({ id: "sync", label: "Sync now", description: "Push and pull from GitHub" });

    // Commands category panel mirrors the palette contents.
    this.#populateCommandsPanel();
  }

  #populateCommandsPanel(): void {
    const panel = this.#commandsPanel;
    panel.replaceChildren();
    const list = document.createElement("div");
    list.className = "commands-list";
    for (const cmd of this.#palette.commands) {
      const row = document.createElement("button");
      row.className = "command-row";
      row.dataset["id"] = cmd.id;

      const main = document.createElement("div");
      main.className = "command-main";
      const label = document.createElement("span");
      label.className = "command-label";
      label.textContent = cmd.label;
      main.appendChild(label);
      if (cmd.shortcut) {
        const short = document.createElement("span");
        short.className = "command-shortcut";
        short.textContent = cmd.shortcut;
        main.appendChild(short);
      }
      row.appendChild(main);
      if (cmd.description) {
        const desc = document.createElement("div");
        desc.className = "command-desc";
        desc.textContent = cmd.description;
        row.appendChild(desc);
      }
      row.addEventListener("click", () => this.#onPaletteCommand(cmd.id));
      list.appendChild(row);
    }
    panel.appendChild(list);
  }

  #onPaletteCommand(id: string): void {
    switch (id) {
      case "new-note":
        this.#newNote("").catch(console.error);
        break;
      case "new-canvas":
        this.#newCanvas().catch(console.error);
        break;
      case "new-folder":
        this.#newFolder().catch(console.error);
        break;
      case "rename-folder":
        this.#renameFolder().catch(console.error);
        break;
      case "delete-folder":
        this.#deleteFolder().catch(console.error);
        break;
      case "show-history":
        this.#showHistory().catch(console.error);
        break;
      case "canvas-edit-text": {
        const canvas = this.#editorWrap.querySelector("ls-canvas") as LSCanvas | null;
        if (!canvas) {
          getToast().show("No canvas is open.", "info", 3000);
          break;
        }
        if (!canvas.beginEditSelectedText()) {
          getToast().show("Select a text node first.", "info", 3000);
        }
        break;
      }
      case "quick-open":
        this.#switcher.open();
        break;
      case "search":
        this.#openSearchTab();
        break;
      case "daily-today":
        this.#openDailyNote(this.#dailyDateFor(0)).catch(console.error);
        break;
      case "daily-yesterday":
        this.#openDailyNote(this.#dailyDateFor(-1)).catch(console.error);
        break;
      case "daily-tomorrow":
        this.#openDailyNote(this.#dailyDateFor(1)).catch(console.error);
        break;
      case "move-note":
        this.#moveActiveNote();
        break;
      case "delete-note":
        this.#deleteActiveNote();
        break;
      case "install-app":
        if (!canInstall()) {
          getToast().show(
            "Install not available. Your browser may not support PWA install, or Lemonstone is already installed.",
            "info",
            6000
          );
        } else {
          triggerInstall().catch(console.error);
        }
        break;
      case "storage-quota":
        this.#showStorageQuota().catch(console.error);
        break;
      case "force-pull":
        this.#forcePull().catch(console.error);
        break;
      case "force-push":
        this.#forcePush().catch(console.error);
        break;
      case "go-home":
        navigateHome();
        break;
      case "sync":
        this.#setStatus("syncing", "Syncing…");
        vaultService.sync().catch((err) => {
          this.#setStatus("error", "Sync failed");
          console.error(err);
        });
        break;
      case "encrypt-folder":
        this.#promptEncryptFolder();
        break;
      case "decrypt-folder":
        this.#promptDecryptFolder().catch(console.error);
        break;
      case "unlock-folder":
        this.#promptUnlockFolder();
        break;
      case "lock-folder":
        this.#promptLockFolder();
        break;
      case "lock-all":
        vaultService.lockAll();
        getToast().show("All encrypted folders locked.", "info", 3000);
        break;
      case "list-zones":
        this.#listZones();
        break;
    }
  }

  #promptEncryptFolder(): void {
    const raw = prompt("Folder to encrypt (e.g. journal/private/):");
    if (!raw) return;
    const prefix = raw.replace(/^\/+/, "").replace(/\/+$/, "") + "/";
    const existing = vaultService.listZones();
    if (existing.some((z) => z.prefix === prefix)) {
      getToast().show(`A zone already exists at ${prefix}.`, "warning", 4000);
      return;
    }
    this.#encryptFolderModal.setPrefix(prefix);
    this.#encryptFolderModal.show();
  }

  async #promptDecryptFolder(): Promise<void> {
    const zones = vaultService.listZones();
    if (zones.length === 0) {
      getToast().show("No encrypted folders to decrypt.", "info", 3000);
      return;
    }
    const list = zones.map((z, i) => `${i + 1}. ${z.prefix}`).join("\n");
    const pick = prompt(`Pick a folder to decrypt (enter number):\n${list}`);
    if (!pick) return;
    const idx = Number(pick) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= zones.length) {
      getToast().show("Invalid selection.", "warning", 3000);
      return;
    }
    const zone = zones[idx]!;
    if (!vaultService.isZoneUnlocked(zone.id)) {
      this.#unlockModal.setZone(zone.id, zone.prefix);
      this.#unlockModal.show();
      return;
    }
    if (!confirm(`Decrypt ${zone.prefix}? Files will become plaintext in git.`)) return;
    try {
      await vaultService.removeZone(zone.id);
      getToast().show(`"${zone.prefix}" decrypted.`, "success", 4000);
      await this.#loadNoteList();
    } catch (err) {
      console.error(err);
      getToast().show("Failed to decrypt folder. See console.", "error", 4000);
    }
  }

  /** Lock badge click handler: lock the zone if currently unlocked, else open
   *  the unlock modal for it. Badge click always targets exactly one zone. */
  #toggleZone(prefix: string, currentlyUnlocked: boolean): void {
    const zone = vaultService.listZones().find((z) => z.prefix === prefix);
    if (!zone) return;
    if (currentlyUnlocked) {
      vaultService.lockZone(zone.id);
      getToast().show(`"${zone.prefix}" locked.`, "info", 3000);
      return;
    }
    this.#unlockModal.setZone(zone.id, zone.prefix);
    this.#unlockModal.show();
  }

  #promptUnlockFolder(): void {
    const locked = vaultService.listZones().filter((z) => !vaultService.isZoneUnlocked(z.id));
    if (locked.length === 0) {
      getToast().show("No locked folders.", "info", 3000);
      return;
    }
    const list = locked.map((z, i) => `${i + 1}. ${z.prefix}`).join("\n");
    const pick = prompt(`Pick a folder to unlock (enter number):\n${list}`);
    if (!pick) return;
    const idx = Number(pick) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= locked.length) return;
    const zone = locked[idx]!;
    this.#unlockModal.setZone(zone.id, zone.prefix);
    this.#unlockModal.show();
  }

  #promptLockFolder(): void {
    const unlocked = vaultService.listZones().filter((z) => vaultService.isZoneUnlocked(z.id));
    if (unlocked.length === 0) {
      getToast().show("No unlocked folders.", "info", 3000);
      return;
    }
    const list = unlocked.map((z, i) => `${i + 1}. ${z.prefix}`).join("\n");
    const pick = prompt(`Pick a folder to lock (enter number):\n${list}`);
    if (!pick) return;
    const idx = Number(pick) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= unlocked.length) return;
    const zone = unlocked[idx]!;
    vaultService.lockZone(zone.id);
    getToast().show(`"${zone.prefix}" locked.`, "info", 3000);
  }

  #listZones(): void {
    const zones = vaultService.listZones();
    if (zones.length === 0) {
      getToast().show("No encrypted folders in this vault.", "info", 4000);
      return;
    }
    const lines = zones.map((z) => {
      const state = vaultService.isZoneUnlocked(z.id) ? "unlocked" : "locked";
      return `${z.prefix} — ${z.algorithm} (${state})`;
    });
    alert(`Encryption zones:\n\n${lines.join("\n")}`);
  }

  #openSearchTab(): void {
    this.#drillInto("search");
    requestAnimationFrame(() => this.#search.focus());
  }
}

customElements.define("ls-app", LSApp);
