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
  #sidebar {
    width: 240px;
    min-width: 180px;
    max-width: 400px;
    border-right: 1px solid var(--ls-color-border, #2a2a3e);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--ls-color-bg-sidebar, #16162a);
  }
  #sidebar-nav {
    display: flex;
    border-bottom: 1px solid var(--ls-color-border, #2a2a3e);
    flex-shrink: 0;
  }
  #sidebar-nav button {
    flex: 1;
    background: none;
    border: none;
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 11px;
    font-family: inherit;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 6px 4px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.1s;
  }
  #sidebar-nav button:hover { color: var(--ls-color-fg, #e0e0e0); }
  #sidebar-nav button.active {
    color: var(--ls-color-accent, #7c6af7);
    border-bottom-color: var(--ls-color-accent, #7c6af7);
  }
  #sidebar-top {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  #sidebar-top .tab-panel { display: none; flex: 1; overflow: hidden; flex-direction: column; min-height: 0; }
  #sidebar-top .tab-panel.active { display: flex; }
  #sidebar-panels {
    flex-shrink: 0;
    max-height: 40vh;
    overflow-y: auto;
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
  #editor: LSEditor | null = null;
  #activePath = "";
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

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
  };

  hideAuthOverlay(): void {
    this.#authOverlay.classList.remove("visible");
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────

  #buildLayout(): void {
    // Sidebar
    const sidebar = document.createElement("div");
    sidebar.id = "sidebar";

    // Tab nav: Files | Search
    const sidebarNav = document.createElement("div");
    sidebarNav.id = "sidebar-nav";
    const filesBtn = document.createElement("button");
    filesBtn.textContent = "Files";
    filesBtn.className = "active";
    const searchBtn = document.createElement("button");
    searchBtn.textContent = "Search";
    sidebarNav.append(filesBtn, searchBtn);
    sidebar.appendChild(sidebarNav);

    const sidebarTop = document.createElement("div");
    sidebarTop.id = "sidebar-top";

    // Files tab panel
    const filesPanel = document.createElement("div");
    filesPanel.className = "tab-panel active";

    this.#fileTree = document.createElement("ls-file-tree") as LSFileTree;
    this.#fileTree.style.cssText = "flex:1;min-height:0;overflow:hidden;";
    this.#fileTree.addEventListener("file-open", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      navigateTo(path);
    });
    this.#fileTree.addEventListener("file-new", (e) => {
      const { folder } = (e as CustomEvent<{ folder: string }>).detail;
      this.#newNote(folder);
    });
    this.#fileTree.addEventListener("file-rename", (e) => {
      const { oldPath, newPath } = (e as CustomEvent<{ oldPath: string; newPath: string }>).detail;
      this.#renameNote(oldPath, newPath);
    });
    filesPanel.appendChild(this.#fileTree);

    // Search tab panel
    const searchPanel = document.createElement("div");
    searchPanel.className = "tab-panel";

    this.#search = document.createElement("ls-search") as LSSearch;
    this.#search.style.cssText = "flex:1;min-height:0;";
    this.#search.addEventListener("file-open", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      navigateTo(path);
      filesBtn.click(); // switch back to files tab after opening
    });
    searchPanel.appendChild(this.#search);

    sidebarTop.append(filesPanel, searchPanel);
    sidebar.appendChild(sidebarTop);

    // Tab switching logic
    filesBtn.addEventListener("click", () => {
      filesBtn.className = "active";
      searchBtn.className = "";
      filesPanel.className = "tab-panel active";
      searchPanel.className = "tab-panel";
    });
    searchBtn.addEventListener("click", () => {
      searchBtn.className = "active";
      filesBtn.className = "";
      searchPanel.className = "tab-panel active";
      filesPanel.className = "tab-panel";
      requestAnimationFrame(() => this.#search.focus());
    });

    const sidebarPanels = document.createElement("div");
    sidebarPanels.id = "sidebar-panels";

    this.#outline = document.createElement("ls-outline") as LSOutline;
    this.#outline.addEventListener("outline-jump", (e) => {
      const { line } = (e as CustomEvent<{ line: number }>).detail;
      this.#editor?.scrollToLine(line);
    });

    this.#backlinks = document.createElement("ls-backlinks") as LSBacklinks;
    this.#backlinks.addEventListener("file-open", (e) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      navigateTo(path);
    });

    sidebarPanels.append(this.#outline, this.#backlinks);
    sidebar.appendChild(sidebarPanels);

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

    this.#shadow.append(sidebar, main, this.#authOverlay, this.#palette, this.#switcher);

    // Hash router
    window.addEventListener("route", this.#onRoute as EventListener);
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
    const notes = await vaultService.listNotes();
    const paths = notes.map((n) => n.path);
    this.#fileTree.notes = paths;
    this.#fileTree.activePath = this.#activePath;
    this.#switcher.notes = paths;
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
    this.#conflictBanner.classList.remove("visible");

    let content = "";
    try {
      const note = await vaultService.readNote(path);
      content = note ?? "";
    } catch {
      content = "";
    }

    this.#mountEditor(path, content);
    this.#updateSidebarPanels(path, content);
  }

  async #reloadActiveNote(): Promise<void> {
    if (!this.#activePath || !this.#editor) return;
    try {
      const note = await vaultService.readNote(this.#activePath);
      if (note !== null && note !== this.#editor.value) {
        this.#editor.value = note;
        this.#updateSidebarPanels(this.#activePath, note);
      }
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

  #renameNote(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    vaultService.renameNote(oldPath, newPath)
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
    this.#palette.register({ id: "quick-open", label: "Quick open note", description: "Jump to a note by name", shortcut: "Ctrl+P" });
    this.#palette.register({ id: "search", label: "Search notes", description: "Full-text search across vault", shortcut: "Ctrl+Shift+F" });
    this.#palette.register({ id: "go-home", label: "Go to home", description: "Show the welcome screen" });
    this.#palette.register({ id: "sync", label: "Sync now", description: "Push and pull from GitHub" });
  }

  #onPaletteCommand(id: string): void {
    switch (id) {
      case "new-note":
        this.#newNote("").catch(console.error);
        break;
      case "quick-open":
        this.#switcher.open();
        break;
      case "search":
        this.#openSearchTab();
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
    // Click the Search nav button — it handles panel swap + focus.
    const searchBtn = this.#shadow.querySelector<HTMLButtonElement>("#sidebar-nav button:last-child");
    searchBtn?.click();
  }
}

customElements.define("ls-app", LSApp);
