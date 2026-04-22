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
import { parseCanvas, serializeCanvas, emptyCanvas } from "../canvas/index.ts";
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
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    font-family: var(--ls-font-ui, system-ui, sans-serif);
    background: var(--ls-color-bg, #1a1a2e);
    color: var(--ls-color-fg, #e0e0e0);
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
  #calendar!: LSCalendar;
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
    ];
    this.#categoryNav.previewed = this.#previewedCategory;
    this.#categoryNav.addEventListener("category-preview", (e) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id;
      this.#onCategoryPreview(id);
    });
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
      const { folder } = (e as CustomEvent<{ folder: string }>).detail;
      this.#newNote(folder);
    });
    this.#fileTree.addEventListener("file-rename", (e) => {
      const { oldPath, newPath } = (e as CustomEvent<{ oldPath: string; newPath: string }>).detail;
      this.#renameNote(oldPath, newPath);
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

    this.#categoryPanel.append(filesPanel, calendarPanel, searchPanel);
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
    main.appendChild(statusBar);

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

    this.#shadow.append(
      this.#categoryNav,
      this.#categoryPanel,
      main,
      this.#authOverlay,
      this.#palette,
      this.#switcher
    );

    // Hash router
    window.addEventListener("route", this.#onRoute as EventListener);
  }

  // ── Category nav orchestration ────────────────────────────────────────────

  #showPanel(id: string): void {
    this.#categoryPanel.querySelectorAll<HTMLElement>(".panel-content").forEach((el) => {
      el.classList.toggle("active", el.dataset["category"] === id);
    });
  }

  #onCategoryPreview(id: string): void {
    this.#previewedCategory = id;
    this.#showPanel(id);
    this.#categoryPanel.classList.remove("dimmed");
    if (id === "search") requestAnimationFrame(() => this.#search.focus());
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
  }

  #drillInto(id: string): void {
    this.#activeCategory = id;
    this.#previewedCategory = id;
    this.#categoryNav.active = id;
    this.#categoryNav.previewed = id;
    this.#categoryNav.mode = "rail";
    this.#showPanel(id);
    this.#categoryPanel.classList.remove("dimmed");
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
    let text = "";
    try {
      const existing = await vaultService.readCanvas(path);
      text = existing ?? "";
    } catch { text = ""; }
    const doc = text ? parseCanvas(text) : emptyCanvas();

    this.#editorWrap.innerHTML = "";
    const canvas = document.createElement("ls-canvas") as LSCanvas;
    canvas.style.cssText = "display:block;height:100%;width:100%;";
    canvas.document = doc;
    canvas.addEventListener("canvas-change", (e) => {
      const nextDoc = (e as CustomEvent<{ document: unknown }>).detail.document as ReturnType<typeof parseCanvas>;
      this.#saveCanvasDebounced(path, nextDoc);
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

  async #newCanvas(): Promise<void> {
    const base = `Untitled-${Date.now()}`;
    const path = `${base}.canvas`;
    await vaultService.writeCanvas(path, serializeCanvas(emptyCanvas()));
    navigateTo(path);
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
    // Sync ensures IndexedDB is populated even if clone was a no-op.
    vaultService.sync().catch(console.error);
    this.#setStatus("ok", "Ready");
    await this.#loadNoteList();
    await this.#handleRoute(currentRoute());
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

    vaultService.addEventListener("vault:synced", (e) => {
      this.#setStatus("ok", "Synced");
      const headOid = (e as CustomEvent).detail?.headOid as string | undefined;
      if (headOid) this.#setRepoSha(headOid);
      // Refresh the file list — catches remote adds/removes that don't emit
      // per-note events (reconcileFromOPFS writes directly to IndexedDB).
      this.#loadNoteList().catch(console.error);
      // Reload active note if it changed.
      if (this.#activePath) this.#reloadActiveNote().catch(console.error);
    });

    vaultService.addEventListener("vault:syncError", (e) => {
      const msg = (e as CustomEvent<{ message?: string }>).detail?.message ?? "Sync error";
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

  async #loadNoteList(): Promise<void> {
    const entries = await vaultService.list();
    const paths = entries.map((e) => e.path).sort();
    this.#fileTree.notes = paths;
    this.#fileTree.activePath = this.#activePath;
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
      return;
    }
    await this.#openNote(route.path);
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

    let content = "";
    try {
      const note = await vaultService.readNote(path);
      content = note ?? "";
    } catch {
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

  async #newNote(folder: string): Promise<void> {
    const base = `Untitled-${Date.now()}`;
    const path = folder ? `${folder}/${base}.md` : `${base}.md`;
    await vaultService.writeNote(path, `# ${base}\n\n`);
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
    this.#palette.register({ id: "go-home", label: "Go to home", description: "Show the welcome screen" });
    this.#palette.register({ id: "sync", label: "Sync now", description: "Push and pull from GitHub" });
  }

  #onPaletteCommand(id: string): void {
    switch (id) {
      case "new-note":
        this.#newNote("").catch(console.error);
        break;
      case "new-canvas":
        this.#newCanvas().catch(console.error);
        break;
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
    }
  }

  #openSearchTab(): void {
    this.#drillInto("search");
    requestAnimationFrame(() => this.#search.focus());
  }
}

customElements.define("ls-app", LSApp);
